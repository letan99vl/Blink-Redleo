#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

/*
  BLINK TL - REDLEO ECU REAL BLE/UART BRIDGE
  ------------------------------------------
  Phone/Bluefy/Android <-> BLE <-> ESP32 <-> REDLEO ECU UART

  ECU protocol: 38400 baud, 8 data bits, even parity, 2 stop bits (8E2).
  BLE advertised name intentionally stays BLINK-REDLEO for compatibility with
  the existing iOS/Android device filter.

  IMPORTANT: set ECU_RX_PIN and ECU_TX_PIN to the two GPIOs actually wired to
  your ECU interface. They are intentionally -1 by default: guessing these
  pins could drive the wrong wire on real hardware.
*/

#ifndef ECU_RX_PIN
#define ECU_RX_PIN 26
#endif
#ifndef ECU_TX_PIN
#define ECU_TX_PIN 33
#endif
#ifndef ECU_RTS_PIN
#define ECU_RTS_PIN -1
#endif
#ifndef AFR_ADC_PIN
#define AFR_ADC_PIN 4
#endif
#ifndef AFR_INPUT_ENABLED
#define AFR_INPUT_ENABLED 1
#endif

static const uint32_t ECU_BAUD = 38400;
static const char *DEVICE_NAME  = "BLINK-REDLEO";
static const char *SERVICE_UUID = "afaf0001-7c35-4a6d-9f0e-2ea3117f1000";
static const char *LIVE_UUID    = "afaf0002-7c35-4a6d-9f0e-2ea3117f1000";
static const char *COMMAND_UUID = "afaf0003-7c35-4a6d-9f0e-2ea3117f1000";
static const char *MAP_UUID     = "afaf0004-7c35-4a6d-9f0e-2ea3117f1000";
static const char *STATUS_UUID  = "afaf0005-7c35-4a6d-9f0e-2ea3117f1000";

// Universal ATT-safe packets: 7-byte chunk header + 12-byte payload = 19 bytes.
static const uint8_t RAW_TX_MARKER = 0xE1;
static const uint8_t RAW_RX_MARKER = 0xE2;
static const size_t RAW_PAYLOAD_PER_PACKET = 12;
static const uint16_t RAW_NOTIFY_DELAY_MS = 6;
static const uint16_t RAW_NOTIFY_YIELD_EVERY = 24;
static const size_t TX_MAX = 2048;
static const size_t RX_MAX = 12000;

HardwareSerial EcuSerial(2);
BLEServer *bleServer = nullptr;
BLECharacteristic *liveChar = nullptr;
BLECharacteristic *commandChar = nullptr;
BLECharacteristic *mapChar = nullptr;
BLECharacteristic *statusChar = nullptr;
volatile bool deviceConnected = false;

uint8_t txBuf[TX_MAX];
uint16_t txExpected = 0;
uint16_t txGot = 0;
uint8_t txSid = 0;
volatile bool transactionReady = false;
uint16_t transactionLen = 0;
uint8_t transactionSid = 0;

uint8_t rxBuf[RX_MAX];
uint32_t lastAfrMs = 0;
bool uartReady = false;

static uint16_t le16(const uint8_t *p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static void put16le(uint8_t *p, uint16_t v) { p[0] = (uint8_t)(v & 0xFF); p[1] = (uint8_t)(v >> 8); }

static void notifyStatus(const String &msg) {
  if (!deviceConnected || !statusChar) return;
  // Keep status short for default 20-byte ATT payloads.
  String s = msg;
  if (s.length() > 18) s = s.substring(0, 18);
  statusChar->setValue((uint8_t *)s.c_str(), s.length());
  statusChar->notify();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    deviceConnected = true;
    Serial.println("BLE client connected");
  }
  void onDisconnect(BLEServer *s) override {
    deviceConnected = false;
    // Drop any half-assembled request so a reconnect cannot resume stale bytes.
    noInterrupts();
    transactionReady = false;
    transactionLen = 0;
    transactionSid = 0;
    txExpected = 0;
    txGot = 0;
    interrupts();
    delay(120);
    s->getAdvertising()->start();
    Serial.println("BLE advertising restarted");
  }
};

static void resetAssembler(uint8_t sid, uint16_t total) {
  txSid = sid;
  txExpected = total;
  txGot = 0;
}

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String raw = c->getValue();
    const size_t n = raw.length();
    if (!n) return;
    const uint8_t *p = (const uint8_t *)raw.c_str();

    // Compatibility / diagnostics.
    if (p[0] != RAW_TX_MARKER) {
      String text = raw;
      if (text == "PING") notifyStatus("PONG");
      return;
    }

    if (n < 7) {
      notifyStatus("ERR RAW HEADER");
      return;
    }
    const uint8_t sid = p[1];
    const uint8_t flags = p[2];
    const uint16_t total = le16(&p[3]);
    const uint16_t off = le16(&p[5]);
    const uint16_t payload = (uint16_t)(n - 7);

    if (!total || total > TX_MAX || off + payload > total) {
      notifyStatus("ERR RAW SIZE");
      return;
    }
    if ((flags & 0x01) || sid != txSid || total != txExpected) resetAssembler(sid, total);
    if (off != txGot) {
      // Sequential transport by design. Reject gaps rather than writing a partial ECU frame.
      notifyStatus("ERR RAW OFFSET");
      resetAssembler(sid, total);
      return;
    }
    memcpy(txBuf + off, p + 7, payload);
    txGot += payload;

    if ((flags & 0x02) || txGot >= txExpected) {
      if (txGot == txExpected && !transactionReady) {
        transactionSid = txSid;
        transactionLen = txExpected;
        transactionReady = true;
      } else if (txGot != txExpected) {
        notifyStatus("ERR RAW INCOMP");
      }
    }
  }
};

static bool exactPrefix(const uint8_t *a, size_t alen, const uint8_t *b, size_t blen) {
  if (alen < blen) return false;
  for (size_t i = 0; i < blen; ++i) if (a[i] != b[i]) return false;
  return true;
}

static uint32_t firstByteTimeoutFor(const uint8_t *tx, size_t n) {
  if (!n) return 1500;
  switch (tx[0]) {
    case 0xAB: return 5000;  // Read All
    case 0x77: return 30000; // TPS Study
    case 0xCD: return 3500;  // write page ACK
    case 0x8B: return 5000;  // restore
    default: return 2200;
  }
}

static uint32_t totalTimeoutFor(const uint8_t *tx, size_t n) {
  if (!n) return 3000;
  switch (tx[0]) {
    case 0xAB: return 10000;
    case 0x77: return 35000;
    case 0xCD: return 6000;
    default: return 5000;
  }
}

static size_t transactUart(const uint8_t *tx, size_t txLen, uint8_t *rx, size_t rxMax) {
  if (!uartReady) return 0;

  while (EcuSerial.available()) EcuSerial.read();
  if (ECU_RTS_PIN >= 0) digitalWrite(ECU_RTS_PIN, HIGH); // REDLEO: RTS ON

  EcuSerial.write(tx, txLen);
  EcuSerial.flush();

  const uint32_t t0 = millis();
  const uint32_t firstTimeout = firstByteTimeoutFor(tx, txLen);
  const uint32_t totalTimeout = totalTimeoutFor(tx, txLen);
  uint32_t lastRx = 0;
  size_t got = 0;
  bool first = false;

  while ((uint32_t)(millis() - t0) < totalTimeout && got < rxMax) {
    while (EcuSerial.available() && got < rxMax) {
      rx[got++] = (uint8_t)EcuSerial.read();
      lastRx = millis();
      first = true;
    }

    if (!first) {
      if ((uint32_t)(millis() - t0) >= firstTimeout) break;
    } else {
      // REDLEO full packets are continuous at 38400. 140ms idle is a safe frame boundary.
      if ((uint32_t)(millis() - lastRx) >= 140) break;
    }
    delay(1);
  }

  // Some UART adapters echo TX. Remove only an exact full prefix, never heuristic bytes.
  if (got > txLen && exactPrefix(rx, got, tx, txLen)) {
    memmove(rx, rx + txLen, got - txLen);
    got -= txLen;
  }
  return got;
}

static void sendRawResponse(uint8_t sid, const uint8_t *data, uint16_t total) {
  if (!deviceConnected || !mapChar) return;

  // Even a zero-byte ECU response gets one end packet so the browser Promise resolves.
  if (total == 0) {
    uint8_t pkt[7] = {RAW_RX_MARKER, sid, 0x03, 0, 0, 0, 0};
    mapChar->setValue(pkt, sizeof(pkt));
    mapChar->notify();
    return;
  }

  for (uint16_t off = 0; off < total && deviceConnected; off += RAW_PAYLOAD_PER_PACKET) {
    const uint8_t count = (uint8_t)min((size_t)RAW_PAYLOAD_PER_PACKET, (size_t)(total - off));
    uint8_t pkt[7 + RAW_PAYLOAD_PER_PACKET];
    pkt[0] = RAW_RX_MARKER;
    pkt[1] = sid;
    pkt[2] = (off == 0 ? 0x01 : 0x00) | ((off + count >= total) ? 0x02 : 0x00);
    put16le(&pkt[3], total);
    put16le(&pkt[5], off);
    memcpy(&pkt[7], data + off, count);
    mapChar->setValue(pkt, 7 + count);
    mapChar->notify();
    // Pace large ECU frames so the BLE stack / phone does not get flooded.
    delay(RAW_NOTIFY_DELAY_MS);
    if ((((off / RAW_PAYLOAD_PER_PACKET) + 1) % RAW_NOTIFY_YIELD_EVERY) == 0) {
      delay(18);
      yield();
    }
  }
}

static void processTransaction() {
  if (!transactionReady) return;
  noInterrupts();
  const uint16_t n = transactionLen;
  const uint8_t sid = transactionSid;
  transactionReady = false;
  interrupts();

  if (!uartReady) {
    notifyStatus("ERR SET ECU PINS");
    sendRawResponse(sid, nullptr, 0);
    return;
  }

  Serial.printf("ECU TX sid=%u len=%u cmd=%02X\n", sid, n, n ? txBuf[0] : 0);
  const size_t got = transactUart(txBuf, n, rxBuf, RX_MAX);
  Serial.printf("ECU RX sid=%u len=%u\n", sid, (unsigned)got);
  sendRawResponse(sid, rxBuf, (uint16_t)got);
}

static void sendAfrPacket() {
#if AFR_INPUT_ENABLED
  if (!deviceConnected || !liveChar) return;
  uint32_t mv = analogReadMilliVolts(AFR_ADC_PIN);
  if (mv > 5000) mv = 5000;
  uint8_t p[3];
  p[0] = 0xA3;
  put16le(&p[1], (uint16_t)mv);
  liveChar->setValue(p, sizeof(p));
  liveChar->notify();
#endif
}

void setup() {
  Serial.begin(115200);
  delay(250);
  Serial.println("\nBLINK TL REDLEO ECU REAL BRIDGE");
  Serial.printf("ECU UART: 38400 8E2 RX=%d TX=%d RTS=%d\n", ECU_RX_PIN, ECU_TX_PIN, ECU_RTS_PIN);

  if (ECU_RX_PIN >= 0 && ECU_TX_PIN >= 0) {
    EcuSerial.begin(ECU_BAUD, SERIAL_8E2, ECU_RX_PIN, ECU_TX_PIN);
    uartReady = true;
    if (ECU_RTS_PIN >= 0) {
      pinMode(ECU_RTS_PIN, OUTPUT);
      digitalWrite(ECU_RTS_PIN, HIGH);
    }
  } else {
    Serial.println("WARNING: set ECU_RX_PIN and ECU_TX_PIN before real ECU use.");
  }

#if AFR_INPUT_ENABLED
  pinMode(AFR_ADC_PIN, INPUT);
  analogReadResolution(12);
#endif

  BLEDevice::init(DEVICE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());
  BLEService *svc = bleServer->createService(SERVICE_UUID);

  liveChar = svc->createCharacteristic(LIVE_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  liveChar->addDescriptor(new BLE2902());

  commandChar = svc->createCharacteristic(COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  commandChar->setCallbacks(new CommandCallbacks());

  mapChar = svc->createCharacteristic(MAP_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  mapChar->addDescriptor(new BLE2902());

  statusChar = svc->createCharacteristic(STATUS_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  statusChar->addDescriptor(new BLE2902());

  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("Advertising as BLINK-REDLEO");
}

void loop() {
  processTransaction();
  const uint32_t now = millis();
  if (deviceConnected && !transactionReady && now - lastAfrMs >= 160) {
    lastAfrMs = now;
    sendAfrPacket();
  }
  delay(1);
}

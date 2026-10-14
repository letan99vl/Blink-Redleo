#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_bt.h>
#include "esp32-hal-bt.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <mbedtls/sha256.h>
#include <mbedtls/version.h>

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
#define ECU_RX_PIN 22
#endif
#ifndef ECU_TX_PIN
#define ECU_TX_PIN 23
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

#ifndef FW_VERSION
#define FW_VERSION "2.2"
#endif

static const char *OTA_MANIFEST_URL =
  "https://cdn.jsdelivr.net/gh/letan99vl/Blink-Redleo@main/ota/manifest.json";
static const char *OTA_MANIFEST_HOST = "cdn.jsdelivr.net";
static const char *OTA_MANIFEST_PATH = "/gh/letan99vl/Blink-Redleo@main/ota/manifest.json";

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
static const uint8_t RX_PROBE_MARKER = 0xE6;
static const uint8_t TX_PROBE_MARKER = 0xE7;
static const size_t RAW_SAFE_PAYLOAD = 12;
static const size_t RAW_JUMBO_PAYLOAD = 160;
static const uint16_t RAW_NOTIFY_DELAY_MS = 6;
static const uint16_t RAW_NOTIFY_YIELD_EVERY = 24;

// RX is conservative by default. The phone opts into 160-byte notifications
// only after FW1.7 PING + client-side MTU capability checks. This keeps old
// Bluefy/WebView/desktop clients byte-for-byte compatible.
static volatile uint16_t rawRxPayload = RAW_SAFE_PAYLOAD;
static volatile bool rawRxJumboEnabled = false;

// OTA control uses the same BLE command characteristic but a separate marker,
// so the existing REDLEO raw bridge protocol remains byte-for-byte compatible.
static const uint8_t OTA_TX_MARKER = 0xE3;
static const uint8_t OTA_CMD_WIFI_CHECK = 0x01;
static const uint8_t OTA_CMD_INSTALL = 0x02;
static const uint8_t OTA_CMD_WIFI_SCAN = 0x03;
static const uint8_t OTA_CMD_BLE_BEGIN = 0x04;
static const uint8_t OTA_CMD_BLE_END = 0x05;
static const uint8_t OTA_CMD_BLE_ABORT = 0x06;
static const uint8_t OTA_WIFI_SCAN_MARKER = 0xE4;
static const uint8_t OTA_BLE_DATA_MARKER = 0xE5;
static const size_t OTA_PAYLOAD_PER_PACKET = 12;
static const size_t OTA_MAX_PAYLOAD = 100;

// BLE pacing by response size. INJ VE current-map replies are ~843B and need
// a slower stream than the smaller one-byte REDLEO pages on iOS/Bluefy.
static uint16_t rawNotifyDelayFor(uint16_t total, uint16_t payloadSize) {
  if (payloadSize > RAW_SAFE_PAYLOAD) {
    if (total >= 8000) return 14;
    if (total >= 800) return 3;
    return 2;
  }
  if (total >= 800) return 14;
  if (total >= 400) return 9;
  return RAW_NOTIFY_DELAY_MS;
}
static uint16_t rawNotifyYieldEveryFor(uint16_t total, uint16_t payloadSize) {
  if (payloadSize > RAW_SAFE_PAYLOAD) {
    if (total >= 8000) return 4;
    if (total >= 800) return 8;
    return 12;
  }
  if (total >= 800) return 12;
  if (total >= 400) return 18;
  return RAW_NOTIFY_YIELD_EVERY;
}

static const size_t TX_MAX = 2048;
static const size_t RX_MAX = 12000;

HardwareSerial EcuSerial(2);
BLEServer *bleServer = nullptr;
BLECharacteristic *liveChar = nullptr;
BLECharacteristic *commandChar = nullptr;
BLECharacteristic *mapChar = nullptr;
BLECharacteristic *statusChar = nullptr;
volatile bool deviceConnected = false;

static void sendRxProbe(uint16_t payload) {
  if (!deviceConnected || !mapChar) return;
  if (payload < 16 || payload > RAW_JUMBO_PAYLOAD) payload = RAW_SAFE_PAYLOAD;
  uint8_t pkt[2 + RAW_JUMBO_PAYLOAD];
  pkt[0] = RX_PROBE_MARKER;
  pkt[1] = (uint8_t)payload;
  for (uint16_t i = 0; i < payload; ++i) pkt[2 + i] = (uint8_t)((i * 29U + 7U) & 0xFFU);
  mapChar->setValue(pkt, 2 + payload);
  mapChar->notify();
  Serial.printf("BLE RX probe sent payload=%u total=%u\n", (unsigned)payload, (unsigned)(payload + 2));
}

static bool validateTxProbe(const uint8_t *p, size_t n) {
  if (!p || n < 3 || p[0] != TX_PROBE_MARKER) return false;
  const uint16_t payload = p[1];
  if (payload < RAW_SAFE_PAYLOAD || payload > RAW_JUMBO_PAYLOAD) return false;
  if (n != (size_t)payload + 2U) return false;
  for (uint16_t i = 0; i < payload; ++i) {
    if (p[2 + i] != (uint8_t)((i * 31U + 11U) & 0xFFU)) return false;
  }
  return true;
}


uint8_t txBuf[TX_MAX];
uint8_t txSeen[TX_MAX];
uint16_t txExpected = 0;
uint16_t txGot = 0;
uint8_t txSid = 0;
bool txEndSeen = false;
volatile bool transactionReady = false;
volatile bool transactionBusy = false;
uint16_t transactionLen = 0;
uint8_t transactionSid = 0;
uint8_t activeTransactionSid = 0;
uint8_t lastProcessedSid = 0;
uint32_t lastProcessedMs = 0;
uint32_t lastRawChunkMs = 0;

uint32_t lastAfrMs = 0;
bool uartReady = false;

uint8_t otaBuf[OTA_MAX_PAYLOAD];
uint8_t otaSeen[OTA_MAX_PAYLOAD];
uint16_t otaExpected = 0;
uint16_t otaGot = 0;
uint8_t otaCmd = 0;
bool otaEndSeen = false;
volatile bool otaCommandReady = false;
uint16_t otaCommandLen = 0;
uint8_t otaCommandCode = 0;
bool otaBusy = false;
String otaSsid;
String otaPassword;
String otaAvailableVersion;
String otaAvailableUrl;
String otaAvailableSha256;

bool bleOtaActive = false;
bool bleOtaShaActive = false;
uint32_t bleOtaExpectedSize = 0;
uint32_t bleOtaWritten = 0;
uint8_t bleOtaExpectedSha[32] = {0};
mbedtls_sha256_context bleOtaSha;
int bleOtaLastPct = -1;

static bool writeBleOtaChunk(uint32_t offset, const uint8_t *data, size_t len);
static void abortBleOta(const char *status);

static uint16_t le16(const uint8_t *p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static uint32_t le32(const uint8_t *p) {
  return (uint32_t)p[0] |
         ((uint32_t)p[1] << 8) |
         ((uint32_t)p[2] << 16) |
         ((uint32_t)p[3] << 24);
}
static void put16le(uint8_t *p, uint16_t v) { p[0] = (uint8_t)(v & 0xFF); p[1] = (uint8_t)(v >> 8); }

static void notifyStatus(const String &msg) {
  if (!deviceConnected || !statusChar) return;
  // Keep status short for default 20-byte ATT payloads.
  String s = msg;
  if (s.length() > 18) s = s.substring(0, 18);
  statusChar->setValue((uint8_t *)s.c_str(), s.length());
  statusChar->notify();
}

static void resetOtaAssembler(uint8_t cmd, uint16_t total) {
  otaCmd = cmd;
  otaExpected = total;
  otaGot = 0;
  otaEndSeen = false;
  memset(otaSeen, 0, sizeof(otaSeen));
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    deviceConnected = true;
    Serial.println("BLE client connected");
  }
  void onDisconnect(BLEServer *s) override {
    deviceConnected = false;
    if (bleOtaActive) {
      Serial.println("BLE disconnected during OTA; aborting partial update");
      abortBleOta(nullptr);
    }
    // Drop any half-assembled request so a reconnect cannot resume stale bytes.
    noInterrupts();
    transactionReady = false;
    transactionBusy = false;
    transactionLen = 0;
    transactionSid = 0;
    activeTransactionSid = 0;
    lastProcessedSid = 0;
    lastProcessedMs = 0;
    lastRawChunkMs = 0;
    rawRxPayload = RAW_SAFE_PAYLOAD;
    rawRxJumboEnabled = false;
    txExpected = 0;
    txGot = 0;
    txEndSeen = false;
    memset(txSeen, 0, sizeof(txSeen));
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
  txEndSeen = false;
  lastRawChunkMs = millis();
  memset(txSeen, 0, sizeof(txSeen));
}

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String raw = c->getValue();
    const size_t n = raw.length();
    if (!n) return;
    const uint8_t *p = (const uint8_t *)raw.c_str();

    // BLE OTA firmware stream.
    // Packet: 0xE5 + offsetLE32 + firmware bytes.
    if (p[0] == OTA_BLE_DATA_MARKER) {
      if (n < 6) {
        notifyStatus("OTA:ERR=DATA");
        return;
      }
      const uint32_t off = le32(&p[1]);
      writeBleOtaChunk(off, &p[5], n - 5);
      return;
    }

    // OTA control frames: 7-byte header + up to 12 payload bytes.
    // Header: marker, command, flags, totalLE16, offsetLE16.
    if (p[0] == OTA_TX_MARKER) {
      if (n < 7) {
        notifyStatus("OTA:ERR=HEADER");
        return;
      }
      // Ignore duplicate OTA writes while the current OTA command is already
      // queued/running. Web Bluetooth stacks can occasionally replay the final
      // write; reporting BUSY here produces a false error in the UI.
      if (otaBusy || otaCommandReady) {
        return;
      }
      const uint8_t cmd = p[1];
      const uint8_t flags = p[2];
      const uint16_t total = le16(&p[3]);
      const uint16_t off = le16(&p[5]);
      const uint16_t payload = (uint16_t)(n - 7);

      if (total == 0) {
        if (off != 0 || payload != 0 || !(flags & 0x02)) {
          notifyStatus("OTA:ERR=SIZE");
          return;
        }
        otaCommandCode = cmd;
        otaCommandLen = 0;
        otaCommandReady = true;
        return;
      }
      if (total > OTA_MAX_PAYLOAD || off + payload > total) {
        notifyStatus("OTA:ERR=SIZE");
        return;
      }
      if (cmd != otaCmd || total != otaExpected) {
        resetOtaAssembler(cmd, total);
      } else if ((flags & 0x01) && otaGot == 0) {
        resetOtaAssembler(cmd, total);
      }
      for (uint16_t i = 0; i < payload; ++i) {
        const uint16_t pos = off + i;
        otaBuf[pos] = p[7 + i];
        if (!otaSeen[pos]) {
          otaSeen[pos] = 1;
          ++otaGot;
        }
      }
      if (flags & 0x02) otaEndSeen = true;
      if (otaEndSeen && otaGot == otaExpected) {
        otaCommandCode = otaCmd;
        otaCommandLen = otaExpected;
        otaCommandReady = true;
      }
      return;
    }

    // Desktop TX capability probe. This packet is consumed entirely by the
    // bridge and is NEVER forwarded to the ECU. It lets Windows Chrome/Edge
    // discover the largest stable GATT write payload without touching iOS or
    // Android transport behavior.
    if (p[0] == TX_PROBE_MARKER) {
      if (validateTxProbe(p, n)) {
        const uint16_t payload = (uint16_t)(n - 2U);
        notifyStatus(String("TXPROBE ") + payload);
        Serial.printf("BLE TX probe accepted payload=%u total=%u\n",
                      (unsigned)payload, (unsigned)n);
      } else {
        notifyStatus("TXPROBE ERR");
        Serial.printf("BLE TX probe rejected total=%u\n", (unsigned)n);
      }
      return;
    }

    // Compatibility / diagnostics.
    if (p[0] != RAW_TX_MARKER) {
      String text = raw;
      if (text == "PING") {
        notifyStatus(String("PONG FW") + FW_VERSION);
      } else if (text.startsWith("RXPROBE:")) {
        const int requested = text.substring(8).toInt();
        sendRxProbe((uint16_t)requested);
      } else if (text.startsWith("RXJUMBO:")) {
        const int requested = text.substring(8).toInt();
        if (requested >= 64 && requested <= (int)RAW_JUMBO_PAYLOAD) {
          rawRxPayload = (uint16_t)requested;
          rawRxJumboEnabled = true;
          notifyStatus(String("RXJUMBO ") + rawRxPayload);
          Serial.printf("BLE RX jumbo enabled payload=%u\n", (unsigned)rawRxPayload);
        } else {
          rawRxPayload = RAW_SAFE_PAYLOAD;
          rawRxJumboEnabled = false;
          notifyStatus("RXJUMBO OFF");
          Serial.println("BLE RX jumbo disabled");
        }
      }
      return;
    }

    if (bleOtaActive) {
      notifyStatus("OTA:BUSY");
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

    // Once a SID is executing on UART, late/duplicate BLE chunks for that SID
    // must never create a second ECU write. This is especially important when
    // mobile BLE stacks replay the final write-with-response packet.
    if (transactionBusy) {
      if (sid == activeTransactionSid) return;
      notifyStatus("RAW BUSY");
      return;
    }

    // Ignore a very late duplicate of a transaction that just completed.
    if (sid == lastProcessedSid && (uint32_t)(millis() - lastProcessedMs) < 3000U) {
      return;
    }

    // If a partial assembler has been abandoned for >3 s, allow a START chunk
    // with the same SID to restart it cleanly.
    const bool stalePartial = txExpected && txGot < txExpected &&
                              (uint32_t)(millis() - lastRawChunkMs) > 3000U;

    // Start a new frame only when SID/length changes, when a truly empty START
    // arrives, or when the previous partial frame is stale.
    if (sid != txSid || total != txExpected || stalePartial) {
      resetAssembler(sid, total);
    } else if ((flags & 0x01) && txGot == 0) {
      resetAssembler(sid, total);
    }
    lastRawChunkMs = millis();

    // Offset-addressed reassembly. BLE stacks may duplicate or reorder writes;
    // copy each byte into its declared position and count only first receipt.
    for (uint16_t i = 0; i < payload; ++i) {
      const uint16_t pos = off + i;
      txBuf[pos] = p[7 + i];
      if (!txSeen[pos]) {
        txSeen[pos] = 1;
        ++txGot;
      }
    }
    if (flags & 0x02) txEndSeen = true;

    // The END flag may arrive before an earlier chunk. Execute only after every
    // byte has actually been received. Duplicate chunks are harmless.
    if (txEndSeen && txGot == txExpected && !transactionReady) {
      transactionSid = txSid;
      transactionLen = txExpected;
      transactionReady = true;
      // Diagnostic/app-level acknowledgement: BLE frame is fully assembled.
      notifyStatus(String("RAWREADY ") + transactionSid);
    }
  }
};

static bool exactPrefix(const uint8_t *a, size_t alen, const uint8_t *b, size_t blen) {
  if (alen < blen) return false;
  for (size_t i = 0; i < blen; ++i) if (a[i] != b[i]) return false;
  return true;
}

// REDLEO reply checksum used by the desktop software.
static bool validRedleoFrame(const uint8_t *p, size_t n) {
  if (!p || n < 3) return false;
  if ((((uint16_t)p[0] + (uint16_t)p[n - 1]) & 0xFFU) != 0xFFU) return false;
  uint8_t sum = 0;
  for (size_t i = 0; i < n - 2; ++i) sum = (uint8_t)(sum + p[i]);
  return sum == p[n - 2];
}

static bool validWritePageFrame(const uint8_t *p, size_t n) {
  if (!p || n < 5 || p[0] != 0xCD) return false;
  if (p[n - 1] != (uint8_t)(n & 0xFFU)) return false;
  uint8_t sum = 0;
  for (size_t i = 0; i < n - 3; ++i) sum = (uint8_t)(sum + p[i]);
  if (p[n - 2] != sum) return false;
  return (uint8_t)(p[n - 3] + p[n - 2]) == 0xFFU;
}

static bool extractValidLive53(uint8_t *rx, size_t got) {
  if (!rx || got < 53) return false;
  for (size_t i = 0; i + 53 <= got; ++i) {
    if (rx[i] != 0xA1) continue;
    if (!validRedleoFrame(rx + i, 53)) continue;
    if (i != 0) memmove(rx, rx + i, 53);
    return true;
  }
  return false;
}

// For large known replies, checksum + exact known wire length is a stronger
// completion signal than waiting for a long UART idle gap. Alternate lengths
// automatically fall back to the legacy idle-gap path below.
static size_t extractValidKnownFrame(uint8_t *rx, size_t got,
                                     const uint8_t *starts, size_t startCount,
                                     const uint16_t *lengths, size_t lengthCount) {
  if (!rx || !starts || !lengths) return 0;
  for (size_t i = 0; i < got; ++i) {
    bool startOk = false;
    for (size_t s = 0; s < startCount; ++s) {
      if (rx[i] == starts[s]) { startOk = true; break; }
    }
    if (!startOk) continue;
    for (size_t k = 0; k < lengthCount; ++k) {
      const size_t n = lengths[k];
      if (i + n > got) continue;
      if (!validRedleoFrame(rx + i, n)) continue;
      if (i != 0) memmove(rx, rx + i, n);
      return n;
    }
  }
  return 0;
}

// Match the proven PC bridge timing: Read Current needs a much longer idle
// boundary than live polling; Read All also waits longer than the 53-byte live frame.
static bool isFuelCurrentPage(const uint8_t *tx, size_t n) {
  if (n < 2 || tx[0] != 0x9A) return false;
  // V8 fuel pages: 0x11..0x14 depending on ECU_MODE/bank.
  // V9+ fuel pages: 0x12/0x14/0x16/0x18.
  switch (tx[1]) {
    case 0x11: case 0x12: case 0x13: case 0x14:
    case 0x16: case 0x18:
      return true;
    default:
      return false;
  }
}

static uint32_t idleGapFor(const uint8_t *tx, size_t n) {
  if (!n) return 140;
  switch (tx[0]) {
    case 0x9A: return isFuelCurrentPage(tx,n) ? 950 : 650;
    case 0xAB: return 300;
    case 0x8B: return 300;
    case 0x77: return 150;
    default:   return 140;
  }
}

static uint32_t firstByteTimeoutFor(const uint8_t *tx, size_t n) {
  if (!n) return 1500;
  switch (tx[0]) {
    case 0xAB: return 5000;
    case 0x9A: return isFuelCurrentPage(tx,n) ? 7000 : 3000;
    case 0x77: return 30000;
    case 0xCD: return 3500;
    case 0x8B: return 5000;
    default: return 2200;
  }
}

static uint32_t totalTimeoutFor(const uint8_t *tx, size_t n) {
  if (!n) return 3000;
  switch (tx[0]) {
    case 0xAB: return 12000;
    case 0x9A: return isFuelCurrentPage(tx,n) ? 14000 : 8000;
    case 0x8B: return 12000;
    case 0x77: return 35000;
    case 0xCD: return 6000;
    default: return 5000;
  }
}

static bool exactPrefix(const uint8_t *a, size_t alen, const uint8_t *b, size_t blen);

// 0xCD write ACK is normally just CD + page. The generic UART path used to
// wait the full 140ms idle boundary even after that ACK was already complete.
// Finish after a short quiet window, but never mistake bytes inside a TX echo
// for the ACK. A real two-byte ACK becomes distinguishable from a partial echo
// because an echo at 38400 baud keeps delivering bytes continuously.
static bool writeAckSettled(const uint8_t *tx, size_t txLen,
                            const uint8_t *rx, size_t got,
                            uint32_t lastRxMs) {
  if (!tx || !rx || txLen < 2 || tx[0] != 0xCD || got < 2 || !lastRxMs) return false;
  if ((uint32_t)(millis() - lastRxMs) < 10U) return false;

  const uint8_t page = tx[1];

  // Direct no-echo ACK.
  if (got == 2 && rx[0] == 0xCD && rx[1] == page) return true;

  // If the buffer is still only a prefix of TX, it is an echo, not an ACK.
  if (got < txLen && exactPrefix(rx, got, tx, got)) return false;

  size_t from = 0;
  if (got >= txLen && exactPrefix(rx, got, tx, txLen)) from = txLen;
  if (got < from + 2) return false;

  // ACK should be at the tail after any exact TX echo/status noise.
  const size_t tailStart = got > 8 ? got - 8 : from;
  const size_t start = tailStart > from ? tailStart : from;
  for (size_t i = start; i + 1 < got; ++i) {
    if (rx[i] == 0xCD && rx[i + 1] == page) return true;
  }
  return false;
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
  const uint32_t idleGap = idleGapFor(tx, txLen);
  uint32_t lastRx = 0;
  size_t got = 0;
  bool first = false;

  while ((uint32_t)(millis() - t0) < totalTimeout && got < rxMax) {
    while (EcuSerial.available() && got < rxMax) {
      rx[got++] = (uint8_t)EcuSerial.read();
      lastRx = millis();
      first = true;
    }

    // Live 0x69 has a fixed, checksum-protected 53-byte A1 frame on the
    // supported REDLEO families. As soon as a complete valid frame is present,
    // finish immediately instead of burning the generic UART idle gap.
    // This also strips a TX echo/noise prefix by selecting the valid A1 frame.
    if (txLen > 0 && tx[0] == 0x69 && extractValidLive53(rx, got)) {
      return 53;
    }

    // Current fuel pages are checksum-protected and have verified V8/V9+
    // lengths. Finish immediately instead of waiting the 650-950 ms 0x9A idle gap.
    if (txLen > 1 && tx[0] == 0x9A && isFuelCurrentPage(tx, txLen)) {
      const uint8_t starts[] = { tx[1] };
      const uint16_t lengths[] = { 423, 424, 843, 844 };
      const size_t done = extractValidKnownFrame(rx, got, starts, 1, lengths, 4);
      if (done) return done;
    }

    // Known Read All / Restore images can also finish on checksum instead of a
    // post-frame idle wait. UART wire time still applies (~3 s for ~10 KB).
    if (txLen > 0 && (tx[0] == 0xAB || tx[0] == 0x8B)) {
      const uint8_t starts[] = { 0xAB, 0x8B, 0xAE };
      const uint16_t lengths[] = { 9767, 9895, 9958 };
      const size_t done = extractValidKnownFrame(rx, got, starts, 3, lengths, 3);
      if (done) return done;
    }

    // FW1.6+: a confirmed short write ACK does not need the generic 140ms
    // serial-idle wait. Break here, then run the normal exact TX-echo stripping.
    if (writeAckSettled(tx, txLen, rx, got, lastRx)) {
      break;
    }

    if (!first) {
      if ((uint32_t)(millis() - t0) >= firstTimeout) break;
    } else {
      // Command-specific serial idle boundary, matched to the working PC bridge.
      if ((uint32_t)(millis() - lastRx) >= idleGap) break;
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

  uint16_t payloadSize = rawRxJumboEnabled ? rawRxPayload : (uint16_t)RAW_SAFE_PAYLOAD;
  if (payloadSize < RAW_SAFE_PAYLOAD || payloadSize > RAW_JUMBO_PAYLOAD) payloadSize = RAW_SAFE_PAYLOAD;
  const uint16_t packetDelay = rawNotifyDelayFor(total, payloadSize);
  const uint16_t yieldEvery = rawNotifyYieldEveryFor(total, payloadSize);
  const bool longFrame = total >= 800;
  const bool jumbo = payloadSize > RAW_SAFE_PAYLOAD;

  // Negotiated jumbo needs far fewer ATT notifications, so the pre-stream gap
  // can be much shorter without overflowing the phone BLE queue.
  if (longFrame) delay(jumbo ? 8 : 40);

  const bool reliableHugeFrame = jumbo && total >= 8000;
  const uint8_t passes = reliableHugeFrame ? 2 : 1;

  // FW2.1 reliability rule for 8-10 KB Read All frames:
  // - pass 1 sends every chunk except the final END chunk;
  // - pass 2 sends the whole frame again, including END;
  // - browser reassembly is offset-addressed and de-duplicates repeats.
  // This gives every middle chunk two independent delivery chances while
  // deliberately preventing the browser from declaring 100% before pass 2.
  for (uint8_t pass = 0; pass < passes && deviceConnected; ++pass) {
    const bool firstReliablePass = reliableHugeFrame && pass == 0;

    for (uint16_t off = 0; off < total && deviceConnected; off += payloadSize) {
      const uint8_t count = (uint8_t)min((size_t)payloadSize, (size_t)(total - off));
      const bool finalChunk = (off + count >= total);

      // Hold the END chunk back from pass 1. The app therefore cannot resolve
      // the 0xAB Promise until pass 2 has completed the redundant stream.
      if (firstReliablePass && finalChunk) break;

      uint8_t pkt[7 + RAW_JUMBO_PAYLOAD];
      pkt[0] = RAW_RX_MARKER;
      pkt[1] = sid;
      pkt[2] = (off == 0 ? 0x01 : 0x00) | (finalChunk ? 0x02 : 0x00);
      put16le(&pkt[3], total);
      put16le(&pkt[5], off);
      memcpy(&pkt[7], data + off, count);

      mapChar->setValue(pkt, 7 + count);
      mapChar->notify();

      // START is repeated on each long pass so browser reassembly always has
      // a valid initialization point. END is repeated only on the final pass.
      if (longFrame && (off == 0 || (finalChunk && !firstReliablePass))) {
        delay(jumbo ? 8 : 22);
        mapChar->setValue(pkt, 7 + count);
        mapChar->notify();
      }

      delay(packetDelay);
      if ((((off / payloadSize) + 1) % yieldEvery) == 0) {
        delay(jumbo ? (total >= 8000 ? 24 : 14) : (longFrame ? 30 : 18));
        yield();
      }
    }

    if (reliableHugeFrame && pass == 0 && deviceConnected) {
      // Separate the passes enough that a short host-side notification backlog
      // cannot drop the same offset in both passes.
      delay(70);
      yield();
    }
  }
}

static void processTransaction() {
  if (!transactionReady || transactionBusy) return;
  noInterrupts();
  const uint16_t n = transactionLen;
  const uint8_t sid = transactionSid;
  transactionReady = false;
  transactionBusy = true;
  activeTransactionSid = sid;
  interrupts();

  if (!uartReady) {
    notifyStatus("ERR SET ECU PINS");
    sendRawResponse(sid, nullptr, 0);
    lastProcessedSid = sid; lastProcessedMs = millis();
    transactionBusy = false; activeTransactionSid = 0;
    return;
  }

  if (n > 0 && txBuf[0] == 0xCD && !validWritePageFrame(txBuf, n)) {
    Serial.printf("BLOCK BAD WRITE sid=%u len=%u\n", sid, n);
    notifyStatus("ERR TX FRAME");
    sendRawResponse(sid, nullptr, 0);
    lastProcessedSid = sid; lastProcessedMs = millis();
    transactionBusy = false; activeTransactionSid = 0;
    return;
  }

  uint8_t *rxBuf = (uint8_t *)malloc(RX_MAX);
  if (!rxBuf) {
    Serial.printf("ECU RX alloc failed need=%u heap=%u max=%u\n",
                  (unsigned)RX_MAX, ESP.getFreeHeap(), ESP.getMaxAllocHeap());
    notifyStatus("ERR ECU RAM");
    sendRawResponse(sid, nullptr, 0);
    lastProcessedSid = sid; lastProcessedMs = millis();
    transactionBusy = false; activeTransactionSid = 0;
    return;
  }

  Serial.printf("ECU TX sid=%u len=%u cmd=%02X\n", sid, n, n ? txBuf[0] : 0);
  const size_t got = transactUart(txBuf, n, rxBuf, RX_MAX);
  Serial.printf("ECU RX sid=%u len=%u", sid, (unsigned)got);
  if (got > 0) {
    Serial.printf(" first=%02X last=%02X valid=%u", rxBuf[0], rxBuf[got - 1], validRedleoFrame(rxBuf, got) ? 1 : 0);
  }
  Serial.println();
  if (got >= 800) {
    const uint16_t payloadSize = rawRxJumboEnabled ? rawRxPayload : (uint16_t)RAW_SAFE_PAYLOAD;
    Serial.printf("BLE stream sid=%u len=%u payload=%u pace=%ums long=1\n",
                  sid, (unsigned)got, (unsigned)payloadSize,
                  (unsigned)rawNotifyDelayFor((uint16_t)got, payloadSize));
  }
  sendRawResponse(sid, rxBuf, (uint16_t)got);
  free(rxBuf);

  // Mark completion only after RAW_RX has been emitted. Late duplicate BLE
  // chunks with this SID are ignored for a short window, preventing duplicate
  // flash writes while still allowing normal SID wrap much later.
  lastProcessedSid = sid;
  lastProcessedMs = millis();
  transactionBusy = false;
  activeTransactionSid = 0;
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

static bool jsonStringValue(const String &json, const char *key, String &out) {
  const String needle = String("\"") + key + "\"";
  int k = json.indexOf(needle);
  if (k < 0) return false;
  int colon = json.indexOf(':', k + needle.length());
  if (colon < 0) return false;
  int q1 = json.indexOf('"', colon + 1);
  if (q1 < 0) return false;
  int q2 = q1 + 1;
  while (true) {
    q2 = json.indexOf('"', q2);
    if (q2 < 0) return false;
    if (q2 == q1 + 1 || json[q2 - 1] != '\\') break;
    ++q2;
  }
  out = json.substring(q1 + 1, q2);
  out.replace("\\/", "/");
  return true;
}

static int nextVersionPart(const String &v, int &pos) {
  while (pos < (int)v.length() && (v[pos] < '0' || v[pos] > '9')) ++pos;
  int n = 0;
  bool any = false;
  while (pos < (int)v.length() && v[pos] >= '0' && v[pos] <= '9') {
    any = true;
    n = n * 10 + (v[pos] - '0');
    ++pos;
  }
  return any ? n : 0;
}

static int compareVersions(const String &a, const String &b) {
  int pa = 0, pb = 0;
  for (int i = 0; i < 4; ++i) {
    const int va = nextVersionPart(a, pa);
    const int vb = nextVersionPart(b, pb);
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

static void otaWifiOff() {
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_OFF);
}

static void sendWifiScanNetwork(uint8_t index, const String &ssid, int32_t rssi, bool secure) {
  if (!deviceConnected || !mapChar || !ssid.length()) return;
  const uint8_t total = (uint8_t)min((size_t)32, (size_t)ssid.length());
  const uint8_t chunkMax = 13; // 6-byte header + 13 bytes = 19 ATT-safe bytes.
  for (uint8_t off = 0; off < total && deviceConnected; off += chunkMax) {
    const uint8_t count = (uint8_t)min((uint8_t)chunkMax, (uint8_t)(total - off));
    uint8_t pkt[6 + chunkMax];
    pkt[0] = OTA_WIFI_SCAN_MARKER;
    pkt[1] = index;
    pkt[2] = (off == 0 ? 0x01 : 0x00) |
             ((off + count >= total) ? 0x02 : 0x00) |
             (secure ? 0x04 : 0x00);
    pkt[3] = total;
    pkt[4] = off;
    int32_t rssiClamped = rssi;
    if (rssiClamped > 0) rssiClamped = 0;
    if (rssiClamped < -127) rssiClamped = -127;
    pkt[5] = (uint8_t)(int8_t)rssiClamped;
    memcpy(&pkt[6], ssid.c_str() + off, count);
    mapChar->setValue(pkt, 6 + count);
    mapChar->notify();
    delay(9);
    yield();
  }
}

static bool scanOtaWifi() {
  notifyStatus("OTA:SCAN");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, true);
  delay(120);

  const int found = WiFi.scanNetworks(false, false);
  if (found < 0) {
    notifyStatus("OTA:ERR=SCAN");
    WiFi.scanDelete();
    WiFi.mode(WIFI_OFF);
    return false;
  }

  uint8_t sent = 0;
  const int limit = min(found, 20);
  for (int i = 0; i < limit && deviceConnected; ++i) {
    const String ssid = WiFi.SSID(i);
    if (!ssid.length()) continue;
    const bool secure = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    sendWifiScanNetwork(sent, ssid, WiFi.RSSI(i), secure);
    ++sent;
  }

  WiFi.scanDelete();
  WiFi.mode(WIFI_OFF);
  notifyStatus(String("OTA:SCAN_DONE=") + sent);
  return true;
}

static bool connectOtaWifi() {
  if (!otaSsid.length()) {
    notifyStatus("OTA:ERR=NO_WIFI");
    return false;
  }
  notifyStatus("OTA:WIFI");
  WiFi.mode(WIFI_STA);
  WiFi.begin(otaSsid.c_str(), otaPassword.c_str());
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && (uint32_t)(millis() - started) < 15000) {
    delay(100);
    yield();
  }
  if (WiFi.status() != WL_CONNECTED) {
    notifyStatus("OTA:WIFI_FAIL");
    otaWifiOff();
    return false;
  }
  notifyStatus("OTA:WIFI_OK");
  return true;
}

static int otaManifestHttpCode = 0;
static int otaNetDiagCode = 0; // 0=ok, 1=DNS, 2=TCP443, 3=HTTPS

static bool otaNetworkPreflight() {
  otaNetDiagCode = 0;
  IPAddress ip;
  if (!WiFi.hostByName("cdn.jsdelivr.net", ip)) {
    otaNetDiagCode = 1;
    Serial.printf("OTA preflight DNS FAIL heap=%u max=%u\n",
                  ESP.getFreeHeap(), ESP.getMaxAllocHeap());
    return false;
  }

  WiFiClient tcp;
  tcp.setTimeout(5);
  if (!tcp.connect(ip, 443)) {
    otaNetDiagCode = 2;
    Serial.printf("OTA preflight TCP443 FAIL ip=%s heap=%u max=%u\n",
                  ip.toString().c_str(), ESP.getFreeHeap(), ESP.getMaxAllocHeap());
    tcp.stop();
    return false;
  }
  tcp.stop();

  Serial.printf("OTA preflight OK ip=%s heap=%u max=%u\n",
                ip.toString().c_str(), ESP.getFreeHeap(), ESP.getMaxAllocHeap());
  return true;
}

static bool readHttpLine(WiFiClientSecure &client, String &line, uint32_t timeoutMs) {
  line = "";
  const uint32_t started = millis();
  while ((uint32_t)(millis() - started) < timeoutMs) {
    while (client.available()) {
      const char c = (char)client.read();
      if (c == '\n') {
        if (line.endsWith("\r")) line.remove(line.length() - 1);
        return true;
      }
      if (line.length() < 512) line += c;
    }
    if (!client.connected() && !client.available()) return line.length() > 0;
    delay(1);
    yield();
  }
  return false;
}

static bool fetchManifest(String &version, String &url, String &sha256) {
  otaManifestHttpCode = 0;

  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(15);
  client.setTimeout(10000);

  Serial.printf("OTA direct TLS connect host=%s heap=%u max=%u\n",
                OTA_MANIFEST_HOST, ESP.getFreeHeap(), ESP.getMaxAllocHeap());

  if (!client.connect(OTA_MANIFEST_HOST, 443, 15000)) {
    char sslErrText[96] = {0};
    const int sslErr = client.lastError(sslErrText, sizeof(sslErrText));
    otaManifestHttpCode = (sslErr < 0) ? sslErr : -1;
    Serial.printf("OTA TLS connect FAIL ssl=%d (%s) heap=%u max=%u\n",
                  sslErr, sslErrText, ESP.getFreeHeap(), ESP.getMaxAllocHeap());
    client.stop();
    return false;
  }

  Serial.printf("OTA TLS connected heap=%u max=%u\n",
                ESP.getFreeHeap(), ESP.getMaxAllocHeap());

  client.print("GET ");
  client.print(OTA_MANIFEST_PATH);
  client.print(" HTTP/1.0\r\nHost: ");
  client.print(OTA_MANIFEST_HOST);
  client.print("\r\nUser-Agent: Blink-Redleo-ESP32/");
  client.print(FW_VERSION);
  client.print("\r\nAccept: application/json\r\nConnection: close\r\n\r\n");

  String line;
  if (!readHttpLine(client, line, 10000)) {
    otaManifestHttpCode = -1002;
    client.stop();
    return false;
  }

  Serial.printf("OTA manifest status: %s\n", line.c_str());
  int httpCode = 0;
  const int sp = line.indexOf(' ');
  if (sp >= 0 && line.length() >= sp + 4) httpCode = line.substring(sp + 1, sp + 4).toInt();
  otaManifestHttpCode = httpCode;
  if (httpCode != 200) {
    client.stop();
    return false;
  }

  int contentLength = -1;
  bool chunked = false;
  while (readHttpLine(client, line, 10000)) {
    if (!line.length()) break;
    String lower = line;
    lower.toLowerCase();
    if (lower.startsWith("content-length:")) {
      contentLength = line.substring(15).toInt();
    } else if (lower.indexOf("transfer-encoding: chunked") >= 0) {
      chunked = true;
    }
  }

  String json;
  json.reserve((contentLength > 0 && contentLength < 4096) ? contentLength + 1 : 512);

  if (chunked) {
    while (true) {
      if (!readHttpLine(client, line, 10000)) {
        otaManifestHttpCode = -1003;
        client.stop();
        return false;
      }
      const int chunkSize = (int)strtol(line.c_str(), nullptr, 16);
      if (chunkSize <= 0) break;
      int remaining = chunkSize;
      const uint32_t chunkStart = millis();
      while (remaining > 0 && (uint32_t)(millis() - chunkStart) < 10000) {
        while (client.available() && remaining > 0) {
          json += (char)client.read();
          --remaining;
          if (json.length() > 4096) {
            otaManifestHttpCode = -1004;
            client.stop();
            return false;
          }
        }
        if (remaining > 0) {
          delay(1);
          yield();
        }
      }
      if (remaining != 0) {
        otaManifestHttpCode = -1003;
        client.stop();
        return false;
      }
      // consume CRLF after each chunk
      uint32_t crlfStart = millis();
      while (client.available() < 2 && (uint32_t)(millis() - crlfStart) < 1000) {
        delay(1);
      }
      if (client.available()) client.read();
      if (client.available()) client.read();
    }
  } else {
    const uint32_t bodyStart = millis();
    while ((client.connected() || client.available()) &&
           (uint32_t)(millis() - bodyStart) < 10000) {
      while (client.available()) {
        json += (char)client.read();
        if (json.length() > 4096) {
          otaManifestHttpCode = -1004;
          client.stop();
          return false;
        }
      }
      delay(1);
      yield();
    }
  }

  client.stop();

  const bool parsed =
    jsonStringValue(json, "version", version) &&
    jsonStringValue(json, "url", url) &&
    jsonStringValue(json, "sha256", sha256);

  if (!parsed) {
    otaManifestHttpCode = -1001;
    Serial.printf("OTA manifest JSON parse failed len=%u\n", (unsigned)json.length());
  }
  return parsed;
}

static String sha256Hex(const uint8_t digest[32]) {
  static const char hex[] = "0123456789abcdef";
  String out;
  out.reserve(64);
  for (int i = 0; i < 32; ++i) {
    out += hex[(digest[i] >> 4) & 0x0F];
    out += hex[digest[i] & 0x0F];
  }
  return out;
}

static void shaStart(mbedtls_sha256_context &ctx) {
  mbedtls_sha256_init(&ctx);
#if defined(MBEDTLS_VERSION_MAJOR) && MBEDTLS_VERSION_MAJOR >= 3
  mbedtls_sha256_starts(&ctx, 0);
#else
  mbedtls_sha256_starts_ret(&ctx, 0);
#endif
}

static void shaUpdate(mbedtls_sha256_context &ctx, const uint8_t *data, size_t len) {
#if defined(MBEDTLS_VERSION_MAJOR) && MBEDTLS_VERSION_MAJOR >= 3
  mbedtls_sha256_update(&ctx, data, len);
#else
  mbedtls_sha256_update_ret(&ctx, data, len);
#endif
}

static void shaFinish(mbedtls_sha256_context &ctx, uint8_t digest[32]) {
#if defined(MBEDTLS_VERSION_MAJOR) && MBEDTLS_VERSION_MAJOR >= 3
  mbedtls_sha256_finish(&ctx, digest);
#else
  mbedtls_sha256_finish_ret(&ctx, digest);
#endif
  mbedtls_sha256_free(&ctx);
}

static void abortBleOta(const char *status) {
  if (bleOtaActive) Update.abort();
  if (bleOtaShaActive) {
    mbedtls_sha256_free(&bleOtaSha);
    bleOtaShaActive = false;
  }
  bleOtaActive = false;
  bleOtaExpectedSize = 0;
  bleOtaWritten = 0;
  bleOtaLastPct = -1;
  if (status) notifyStatus(status);
}

static bool beginBleOta(const uint8_t *payload, uint16_t len) {
  if (!payload || len != 36) {
    notifyStatus("OTA:ERR=BEGIN");
    return false;
  }

  abortBleOta(nullptr);
  const uint32_t total = le32(payload);
  if (!total) {
    notifyStatus("OTA:ERR=SIZE");
    return false;
  }

  if (!Update.begin((size_t)total, U_FLASH)) {
    notifyStatus("OTA:ERR=PARTITION");
    return false;
  }

  memcpy(bleOtaExpectedSha, payload + 4, 32);
  bleOtaExpectedSize = total;
  bleOtaWritten = 0;
  bleOtaLastPct = -1;
  shaStart(bleOtaSha);
  bleOtaShaActive = true;
  bleOtaActive = true;

  Serial.printf("BLE OTA begin size=%u heap=%u max=%u\n",
                (unsigned)bleOtaExpectedSize, ESP.getFreeHeap(), ESP.getMaxAllocHeap());
  notifyStatus("OTA:BSTART");
  return true;
}

static bool writeBleOtaChunk(uint32_t offset, const uint8_t *data, size_t len) {
  if (!bleOtaActive || !data || !len) {
    notifyStatus("OTA:ERR=DATA");
    return false;
  }

  // A retry of an already acknowledged packet is harmless. This makes
  // browser-side retries safe if a GATT response is lost.
  if (offset < bleOtaWritten) {
    if ((uint64_t)offset + len <= bleOtaWritten) return true;
    abortBleOta("OTA:ERR=SEQ");
    return false;
  }

  if (offset != bleOtaWritten ||
      (uint64_t)bleOtaWritten + len > bleOtaExpectedSize) {
    abortBleOta("OTA:ERR=SEQ");
    return false;
  }

  const size_t wrote = Update.write((uint8_t *)data, len);
  if (wrote != len) {
    abortBleOta("OTA:ERR=FLASH");
    return false;
  }

  shaUpdate(bleOtaSha, data, len);
  bleOtaWritten += (uint32_t)len;

  const int pct = (int)(((uint64_t)bleOtaWritten * 100ULL) / bleOtaExpectedSize);
  if (pct == 100 || pct >= bleOtaLastPct + 5) {
    bleOtaLastPct = pct;
    notifyStatus(String("OTA:P=") + pct);
  }
  return true;
}

static bool finishBleOta() {
  if (!bleOtaActive || !bleOtaShaActive) {
    notifyStatus("OTA:ERR=BEGIN");
    return false;
  }
  if (bleOtaWritten != bleOtaExpectedSize) {
    abortBleOta("OTA:ERR=SIZE");
    return false;
  }

  uint8_t digest[32];
  shaFinish(bleOtaSha, digest);
  bleOtaShaActive = false;

  if (memcmp(digest, bleOtaExpectedSha, 32) != 0) {
    Update.abort();
    bleOtaActive = false;
    notifyStatus("OTA:ERR=HASH");
    return false;
  }

  if (!Update.end(true)) {
    bleOtaActive = false;
    notifyStatus("OTA:ERR=FLASH");
    return false;
  }

  bleOtaActive = false;
  notifyStatus("OTA:DONE");
  delay(650);
  ESP.restart();
  return true;
}

static bool checkOtaManifest() {
  notifyStatus(String("OTA:CUR=") + FW_VERSION);
  if (!connectOtaWifi()) return false;

  notifyStatus(String("OTA:MEM=") + ESP.getMaxAllocHeap());
  delay(35);

  String version, url, sha256;
  if (!otaNetworkPreflight()) {
    if (otaNetDiagCode == 1) notifyStatus("OTA:ERR=DNS");
    else if (otaNetDiagCode == 2) notifyStatus("OTA:ERR=TCP443");
    else notifyStatus("OTA:ERR=NET");
    otaWifiOff();
    return false;
  }

  const bool ok = fetchManifest(version, url, sha256);
  if (!ok) {
    if (otaManifestHttpCode == -1000) notifyStatus("OTA:ERR=TLS_BEGIN");
    else if (otaManifestHttpCode == -1001) notifyStatus("OTA:ERR=JSON");
    else if (otaManifestHttpCode < 0) notifyStatus(String("OTA:SSL=") + otaManifestHttpCode);
    else notifyStatus(String("OTA:HTTP=") + otaManifestHttpCode);
    otaWifiOff();
    return false;
  }

  version.trim();
  sha256.trim();
  sha256.toLowerCase();

  if (compareVersions(version, String(FW_VERSION)) <= 0) {
    otaAvailableVersion = "";
    otaAvailableUrl = "";
    otaAvailableSha256 = "";
    notifyStatus("OTA:NO_UPDATE");
    otaWifiOff();
    return true;
  }

  if (!url.startsWith("https://") || sha256.length() != 64) {
    notifyStatus("OTA:ERR=MANIFEST");
    otaWifiOff();
    return false;
  }

  otaAvailableVersion = version;
  otaAvailableUrl = url;
  otaAvailableSha256 = sha256;
  notifyStatus(String("OTA:NEW=") + version);
  otaWifiOff();
  return true;
}

static bool installOtaFirmware() {
  if (!otaAvailableVersion.length() || !otaAvailableUrl.length() || otaAvailableSha256.length() != 64) {
    notifyStatus("OTA:ERR=CHECK_FIRST");
    return false;
  }
  if (!connectOtaWifi()) return false;

  notifyStatus("OTA:START");
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.setTimeout(20000);

  if (!http.begin(client, otaAvailableUrl)) {
    notifyStatus("OTA:ERR=HTTP");
    otaWifiOff();
    return false;
  }
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    notifyStatus("OTA:ERR=HTTP");
    http.end();
    otaWifiOff();
    return false;
  }

  const int total = http.getSize();
  if (total <= 0) {
    notifyStatus("OTA:ERR=SIZE");
    http.end();
    otaWifiOff();
    return false;
  }
  if (!Update.begin((size_t)total, U_FLASH)) {
    notifyStatus("OTA:ERR=PARTITION");
    http.end();
    otaWifiOff();
    return false;
  }

  mbedtls_sha256_context sha;
  shaStart(sha);
  WiFiClient *stream = http.getStreamPtr();
  uint8_t buf[1024];
  int remaining = total;
  size_t received = 0;
  int lastPct = -1;
  uint32_t lastData = millis();
  bool writeOk = true;

  while (remaining > 0) {
    const size_t avail = stream->available();
    if (avail) {
      const size_t want = min((size_t)remaining, min(avail, sizeof(buf)));
      const int got = stream->readBytes(buf, want);
      if (got <= 0) {
        writeOk = false;
        break;
      }
      if (Update.write(buf, (size_t)got) != (size_t)got) {
        writeOk = false;
        break;
      }
      shaUpdate(sha, buf, (size_t)got);
      remaining -= got;
      received += (size_t)got;
      lastData = millis();

      const int pct = (int)((received * 100ULL) / (size_t)total);
      if (pct == 100 || pct >= lastPct + 10) {
        lastPct = pct;
        notifyStatus(String("OTA:P=") + pct);
      }
    } else {
      if (!http.connected()) break;
      if ((uint32_t)(millis() - lastData) > 20000) {
        writeOk = false;
        break;
      }
      delay(2);
      yield();
    }
  }

  uint8_t digest[32];
  shaFinish(sha, digest);
  http.end();

  if (!writeOk || remaining != 0) {
    Update.abort();
    notifyStatus("OTA:ERR=DOWNLOAD");
    otaWifiOff();
    return false;
  }

  const String actualSha = sha256Hex(digest);
  if (!actualSha.equalsIgnoreCase(otaAvailableSha256)) {
    Update.abort();
    notifyStatus("OTA:ERR=HASH");
    otaWifiOff();
    return false;
  }

  if (!Update.end(true)) {
    notifyStatus("OTA:ERR=FLASH");
    otaWifiOff();
    return false;
  }

  notifyStatus("OTA:DONE");
  delay(600);
  ESP.restart();
  return true;
}

static void processOtaCommand() {
  if (!otaCommandReady || otaBusy) return;

  noInterrupts();
  const uint8_t cmd = otaCommandCode;
  const uint16_t len = otaCommandLen;
  otaCommandReady = false;
  interrupts();

  if (transactionReady) {
    notifyStatus("OTA:ERR=ECU_BUSY");
    return;
  }

  otaBusy = true;
  if (cmd == OTA_CMD_WIFI_SCAN) {
    scanOtaWifi();
  } else if (cmd == OTA_CMD_WIFI_CHECK) {
    if (len < 2) {
      notifyStatus("OTA:ERR=WIFI_DATA");
    } else {
      const uint8_t ssidLen = otaBuf[0];
      if (!ssidLen || ssidLen > 32 || (uint16_t)(1 + ssidLen) > len || (len - 1 - ssidLen) > 63) {
        notifyStatus("OTA:ERR=WIFI_DATA");
      } else {
        otaSsid = "";
        otaPassword = "";
        for (uint8_t i = 0; i < ssidLen; ++i) otaSsid += (char)otaBuf[1 + i];
        for (uint16_t i = 1 + ssidLen; i < len; ++i) otaPassword += (char)otaBuf[i];
        checkOtaManifest();
      }
    }
  } else if (cmd == OTA_CMD_INSTALL) {
    installOtaFirmware();
  } else if (cmd == OTA_CMD_BLE_BEGIN) {
    beginBleOta(otaBuf, len);
  } else if (cmd == OTA_CMD_BLE_END) {
    finishBleOta();
  } else if (cmd == OTA_CMD_BLE_ABORT) {
    abortBleOta("OTA:ABORT");
  } else {
    notifyStatus("OTA:ERR=CMD");
  }
  otaBusy = false;
}

void setup() {
  Serial.begin(115200);
  delay(250);
  Serial.printf("\nBLINK TL REDLEO ECU REAL BRIDGE ESP32 FW%s\n", FW_VERSION);
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

#if CONFIG_IDF_TARGET_ESP32
  // This product uses BLE only. Free the unused Bluetooth Classic controller
  // + host memory before BLE starts, then start the controller explicitly in
  // BLE-only mode. This leaves substantially more contiguous internal RAM for
  // mbedTLS/HTTPS during OTA.
  Serial.printf("Heap before BLE-only prep: free=%u max=%u\n",
                ESP.getFreeHeap(), ESP.getMaxAllocHeap());
  const esp_err_t classicRelease = esp_bt_mem_release(ESP_BT_MODE_CLASSIC_BT);
  Serial.printf("Release BT Classic memory: %d free=%u max=%u\n",
                (int)classicRelease, ESP.getFreeHeap(), ESP.getMaxAllocHeap());
  if (!btStartMode(BT_MODE_BLE)) {
    Serial.println("ERROR: failed to start Bluetooth controller in BLE-only mode");
  }
  Serial.printf("BLE-only controller ready: free=%u max=%u\n",
                ESP.getFreeHeap(), ESP.getMaxAllocHeap());
#endif

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(185);
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
  processOtaCommand();
  if (!otaBusy && !bleOtaActive) processTransaction();
  const uint32_t now = millis();
  if (!otaBusy && !bleOtaActive && deviceConnected && !transactionReady && now - lastAfrMs >= 160) {
    lastAfrMs = now;
    sendAfrPacket();
  }
  delay(1);
}

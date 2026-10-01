#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
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

#ifndef FW_VERSION
#define FW_VERSION "1.3"
#endif

static const char *OTA_MANIFEST_URL =
  "https://raw.githubusercontent.com/letan99vl/Blink-Redleo/main/ota/manifest.json";

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

// OTA control uses the same BLE command characteristic but a separate marker,
// so the existing REDLEO raw bridge protocol remains byte-for-byte compatible.
static const uint8_t OTA_TX_MARKER = 0xE3;
static const uint8_t OTA_CMD_WIFI_CHECK = 0x01;
static const uint8_t OTA_CMD_INSTALL = 0x02;
static const size_t OTA_PAYLOAD_PER_PACKET = 12;
static const size_t OTA_MAX_PAYLOAD = 100;

// BLE pacing by response size. INJ VE current-map replies are ~843B and need
// a slower stream than the smaller one-byte REDLEO pages on iOS/Bluefy.
static uint16_t rawNotifyDelayFor(uint16_t total) {
  if (total >= 800) return 14;
  if (total >= 400) return 9;
  return RAW_NOTIFY_DELAY_MS;
}
static uint16_t rawNotifyYieldEveryFor(uint16_t total) {
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

uint8_t txBuf[TX_MAX];
uint8_t txSeen[TX_MAX];
uint16_t txExpected = 0;
uint16_t txGot = 0;
uint8_t txSid = 0;
bool txEndSeen = false;
volatile bool transactionReady = false;
uint16_t transactionLen = 0;
uint8_t transactionSid = 0;

uint8_t rxBuf[RX_MAX];
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
    // Drop any half-assembled request so a reconnect cannot resume stale bytes.
    noInterrupts();
    transactionReady = false;
    transactionLen = 0;
    transactionSid = 0;
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
  memset(txSeen, 0, sizeof(txSeen));
}

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String raw = c->getValue();
    const size_t n = raw.length();
    if (!n) return;
    const uint8_t *p = (const uint8_t *)raw.c_str();

    // OTA control frames: 7-byte header + up to 12 payload bytes.
    // Header: marker, command, flags, totalLE16, offsetLE16.
    if (p[0] == OTA_TX_MARKER) {
      if (n < 7) {
        notifyStatus("OTA:ERR=HEADER");
        return;
      }
      if (otaBusy || otaCommandReady) {
        notifyStatus("OTA:BUSY");
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

    // Compatibility / diagnostics.
    if (p[0] != RAW_TX_MARKER) {
      String text = raw;
      if (text == "PING") notifyStatus(String("PONG FW") + FW_VERSION);
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

    // Start a new frame only when SID/length changes, or when START arrives for
    // a frame that has not collected any bytes yet. Do NOT reset merely because
    // a duplicate START chunk is delivered by Bluefy/iOS.
    if (sid != txSid || total != txExpected) {
      resetAssembler(sid, total);
    } else if ((flags & 0x01) && txGot == 0) {
      resetAssembler(sid, total);
    }

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

  const uint16_t packetDelay = rawNotifyDelayFor(total);
  const uint16_t yieldEvery = rawNotifyYieldEveryFor(total);
  const bool longFrame = total >= 800;

  // Long 0x9A INJ VE frames need a brief quiet gap before BLE streaming.
  if (longFrame) delay(40);

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

    // First and last chunks are critical for browser reassembly. Repeat them
    // on long frames so a single lost notification does not cause 0x9A timeout.
    if (longFrame && (off == 0 || off + count >= total)) {
      delay(22);
      mapChar->setValue(pkt, 7 + count);
      mapChar->notify();
    }

    delay(packetDelay);
    if ((((off / RAW_PAYLOAD_PER_PACKET) + 1) % yieldEvery) == 0) {
      delay(longFrame ? 30 : 18);
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

  if (n > 0 && txBuf[0] == 0xCD && !validWritePageFrame(txBuf, n)) {
    Serial.printf("BLOCK BAD WRITE sid=%u len=%u\n", sid, n);
    notifyStatus("ERR TX FRAME");
    sendRawResponse(sid, nullptr, 0);
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
    Serial.printf("BLE stream sid=%u len=%u pace=%ums long=1\n",
                  sid, (unsigned)got, (unsigned)rawNotifyDelayFor((uint16_t)got));
  }
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

static bool fetchManifest(String &version, String &url, String &sha256) {
  WiFiClientSecure client;
  // V1 intentionally keeps certificate maintenance simple; the downloaded
  // firmware is still checked against the SHA-256 in the manifest.
  // For locked commercial distribution, sign the manifest in a later hardening step.
  client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.setTimeout(15000);
  if (!http.begin(client, OTA_MANIFEST_URL)) return false;
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    return false;
  }
  const String json = http.getString();
  http.end();
  return jsonStringValue(json, "version", version) &&
         jsonStringValue(json, "url", url) &&
         jsonStringValue(json, "sha256", sha256);
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

static bool checkOtaManifest() {
  notifyStatus(String("OTA:CUR=") + FW_VERSION);
  if (!connectOtaWifi()) return false;

  String version, url, sha256;
  const bool ok = fetchManifest(version, url, sha256);
  if (!ok) {
    notifyStatus("OTA:ERR=MANIFEST");
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
  if (cmd == OTA_CMD_WIFI_CHECK) {
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
  processOtaCommand();
  if (!otaBusy) processTransaction();
  const uint32_t now = millis();
  if (!otaBusy && deviceConnected && !transactionReady && now - lastAfrMs >= 160) {
    lastAfrMs = now;
    sendAfrPacket();
  }
  delay(1);
}

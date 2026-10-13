# BLINK ESP32 FW2.4 AUTO UART + 5s REDLINE GUARD — LAB CANDIDATE

Date: 2026-10-13. **UNPUBLISHED. REAL ECU VALIDATION PENDING.**
Branch: feature/blink-fw24-autopin-redline5s-20261013
Production main branch remains byte-for-byte ESP32 FW2.2, and public OTA manifest remains pinned to FW2.2.

## Source of truth / build
- Firmware: firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino
- **Single Arduino .ino only**. No firmware .h dependency.
- BLE PING: PONG FW2.4
- Arduino: classic ESP32, ESP32 Arduino core 3.3.12, partition scheme min_spiffs.
- Branch CI: .github/workflows/check-fw24-autopin-redline5s.yml
- CI creates single source INO and FW app BIN as a lab artifact; never publishes OTA or touches main.

## UART auto pins (known production wiring only)
- Slot 0: RX22 / TX23
- Slot 1: RX26 / TX33
- UART2 at 38400 baud, 8E2. AFR/RTS/BLE UUID/RAW E1/E2/OTA transport inherit FW2.2.
- Boot uses NVS namespace blinkuart key slot if valid, otherwise slot0.
- On startup, use the same read-only 0x5A ECU handshake sent by Blink or autonomous guard. A complete checksum-protected ECU frame with sane active-map field proves the slot. If absent, switch UART pins and replay ONLY THE SAME READ-ONLY command once. Restore original slot if neither works.
- The existing legacy read-only 0x69 request can also discover a slot while unconfirmed.
- Do not replay a write, restore, or arbitrary ECU transaction on the alternative slot.
- NVS changes only on validated ECU reply. After pin confirmation, a bad frame does not switch ports. Reboot ESP32 if hardware is moved after confirmation.
- A 0x5A host first-time discovery with no ECU can take about 4.5 s; Blink 0x5A timeout is 6 s. Background guard uses 950ms first-byte limits. BLE connection alone is not ECU authentication.

## Redline Guard behavior
- Guard logic rebased additively against verified FW2.2 production single-file INO, not released from failed FW2.3 main.
- Fresh flash NVS blinkguard.enabled defaults false. User enables from Blink only with recently validated stationary RPM.
- When armed, ESP32 autonomously verifies V9.1x/V9.2x 0x5A ECU identity, reads validated 0x62/0x64/0x66/0x68 ECU page6 RPM limits, and samples 0x69 live 53-byte frames if the phone is absent. Other ECU versions fail closed.
- RPM at or above (MAP current limit - 250 RPM) for 5000 ms accumulative triggers MAP4 request; dips longer than 350ms reset and data gaps longer than 600ms reset.
- MAP4 change must be verified with 0x5A map index. Three failures yield RG:FAULT; no fake success.
- MAP4 latch lasts until switched key power cycle or disabling guard with validated stopped engine. While guarded/tripped/faulted, block live map overrides and ECU write/restore.
- Commands/status remain RG?, RGON, RGOFF; Blink PB3.79.78 Settings control accepts FW>=2.3.
- Add BLE connect grace 2500ms to prioritize the app ECU authentication. UART operations only in loop, phone RAW ready takes priority.

## Test gates / release rules
1. CI must pass actual extracted C++ core tests, Blink UI check and Arduino classic ESP32 build. Compile does NOT prove the motorcycle is safe.
2. With engine OFF, use a genuine ECU to test both physical wiring pairs with PB3.79.78: BLE PING, 0x5A auth, MAP selection, page6 READ, READ ALL.
3. Power-cycle each ESP32, check learned UART pin pair and NVS guard setting in serial logs.
4. On simulator: 53B A1 frames, exact 5s limit, short/long dips, stale frames, corrupt frames, MAP4 verify and faults, BLE disconnect/reconnect.
5. Guard OFF must preserve FW2.2 full map read/write. Guard ON must not block initial handshake or long read. Unsupported ECU must never trigger MAP4.
6. On real ECU do only stationary controlled bench confirmation of MAP4 index after verifying map configuration. Do NOT sustain limiter on a real motorbike on public roads.

## Recovery / known risks
- Previous FW2.3 + PB3.79.76 caused owner-reported 0x5A authentication failures. FW2.4 is NOT yet verified to fix them in hardware.
- ESP32-to-ECU UART electrical levels may require conditioning; only use existing proven wiring/interface.
- On auth failure, turn engine OFF and restore the original FW2.2 using current Blink recovery or tested flashing tool. Keep production OTA pinned 2.2.
- Redline Guard is not a replacement for physical RPM limiting; five seconds near limit and abrupt MAP4 selection can damage engine.

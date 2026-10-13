# BLINK ESP32 FW2.4 AUTO UART + 5s REDLINE GUARD — PUBLIC OTA + BENCH QA

Date: 2026-10-13. **PUBLIC OTA FW2.4 PUBLISHED. REAL ECU HARDWARE VALIDATION STILL PENDING.**
Candidate branch: feature/blink-fw24-autopin-redline5s-20261013
Release main commit: 2719c1a5fbdd280a7b5a40f4f4f5ba1e84f37a78; OTA binary commit: f2e043e5467d3827977300fcf9b254302287a28f.
Public ota/manifest.json version 2.4 SHA256: 00c779dcabab06d90fa559a61fc8280e6d17593d19d74423696ba7f6ea404358.
GitHub Actions release run 38392942724: SUCCESS; binary SHA verified against manifest.
Blink PB3.79.80 removes the FW2.2 rollback control, retaining old firmware only in historical Git for USB bench repair.

## Source of truth / build
- Firmware: firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino
- **Single Arduino .ino only**. No firmware .h dependency.
- BLE PING: PONG FW2.4
- Arduino: classic ESP32, ESP32 Arduino core 3.3.12, partition scheme min_spiffs.
- Branch CI: .github/workflows/check-fw24-autopin-redline5s.yml
- Release workflow compiles source, runs C++/UI checks and publishes application BIN and SHA256 manifest only after explicit [RELEASE_FW24] marker or manual dispatch. Lab workflow stays build-only.

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
- Commands/status remain RG?, RGON, RGOFF; Blink PB3.79.80 Settings control requires FW>=2.4.
- Add BLE connect grace 2500ms to prioritize the app ECU authentication. UART operations only in loop, phone RAW ready takes priority.

## Completed CI checks and pending physical acceptance tests
1. DONE: CI passed extracted C++ core tests, Blink UI checks, Arduino classic ESP32 compile and BIN SHA verification. Compile does NOT prove motorcycle operation is safe.
2. With engine OFF, use a genuine ECU to test both physical wiring pairs with PB3.79.80: BLE PING, 0x5A auth, MAP selection, page6 READ, READ ALL.
3. Power-cycle each ESP32, check learned UART pin pair and NVS guard setting in serial logs.
4. On simulator: 53B A1 frames, exact 5s limit, short/long dips, stale frames, corrupt frames, MAP4 verify and faults, BLE disconnect/reconnect.
5. Guard OFF must preserve FW2.2 full map read/write. Guard ON must not block initial handshake or long read. Unsupported ECU must never trigger MAP4.
6. On real ECU do only stationary controlled bench confirmation of MAP4 index after verifying map configuration. Do NOT sustain limiter on a real motorbike on public roads.

## Recovery / known risks
- Previous FW2.3 + PB3.79.76 caused owner-reported 0x5A authentication failures. FW2.4 is NOT yet verified to fix them in hardware.
- ESP32-to-ECU UART electrical levels may require conditioning; only use existing proven wiring/interface.
- On ECU authentication failure, turn engine OFF. The in-app FW2.2 recovery control is intentionally removed by owner request; historical original FW2.2 BIN via a proven USB flasher remains the emergency bench repair option. Current public OTA is FW2.4. Never reflash during engine operation.
- Redline Guard is not a replacement for physical RPM limiting; five seconds near limit and abrupt MAP4 selection can damage engine.

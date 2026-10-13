# Blink FW2.6 – Multi-family Redline Guard, controlled lab release

Date: 2026-10-13. **NOT RELEASED OTA. No claim of physical ECU safety until hardware validation.**
Source: `firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino`, single-file Arduino.
Blink UI on branch: `index.html` PB3.79.83. Public main OTA still FW2.5 / public Blink PB3.79.82.

## Why 10.3 showed "ĐANG ĐỌC GIỚI HẠN RPM 4 MAP..."
- FW2.5 Redline Guard could persist ON and repeatedly read all page6 limits, but `BlinkGuard::parseLimit` accepted *only* old V9 checksum frames with exactly 33/65/66 bytes.
- REDLEO 10.x app protocol uses page6 writable data **18 bytes**, vs REDLEO 9.1X **30 bytes**, 9.2X **62 bytes**, Ultra Pro1 **42 bytes**. Using V9 page-length tests for 10.3 produces false READ forever.
- Blink's browser can correctly decode V10.3 on its normal Idle/Limit page, but the ESP32 autonomous Redline Guard had a completely separate, V9-only decoder.

## New FW2.6 family-aware contract
- Full checksum-protected 0x5A handshake identifies exact four-character firmware and 16-byte ASCII ECU ID; active map f[33] must be 0..3. Family must be unambiguous:
  - V9.1x: page 0x62/64/66/68 checksum frame **33 bytes**, maxSpeed is Idle uint16-BE index 2 -> response f[5..6].
  - V9.2x: **65 or 66 bytes**, maxSpeed f[5..6].
  - V10.x, including V10.3 non-Ultra: **21 or 22 bytes**, maxSpeed f[5..6].
  - Ultra Pro1 V10.x with ECU ID containing ULTRA: **45 or 46 bytes**, maxSpeed is uint16-BE index 3 -> f[7..8].
  - V8/legacy (sometimes single-MAP), V11/ATE and Ultra Pro2 V11 (4x3 encoded Idle page): **UNSUPPORTED** for automatic MAP4. Never guess max RPM, read a mismatched model's page, or send MAP4.
- All page6 reads are read-only 0x9A; max RPM must be 3000..18000 and frame checksum valid.
- RGON in FW2.6 checks identity, verifies all four MAPs' limits, then requires 3+ fresh checksum-valid 0xA1 RPM=0 packets over >=1s. Only then persist guard ON. It NEVER persists ON with merely partial page6 data.
- Each map gets at most 5 autonomous read attempts, spaced 1150ms; after failure RG:LIMITERR:M1..M4, disable guard NVS, stop all retries. Identity boot retries also bounded (6). No more infinite RG:READING.
- MAP4 selection 0x69 must be followed by full 0x5A readback: same verified family, firmware, ECU ID and map 4. A plausible A1 Live packet alone never counts as successful selection.
- Auto RX22/TX23 and RX26/TX33, historical BLE transport and original 5000ms near-RPM timer unchanged.
- New profile parser invalidates limits on physical ECU identity/profile change.
- FW2.6 NVS schema migration **forces old FW2.5 Redline Guard ON setting back to OFF once**. User must explicitly arm again after the new four-page and engine-stopped proof. This prevents stale V9/V10 pairings from commanding MAP4 after firmware upgrade.
- Public OTA and GitHub main untouched; lab workflow has contents:read only and produces a .bin/.ino artifact, NEVER publishes to customers.

## Still not physically verified
- V10.3 and Ultra Pro1 0x9A replies still require comparison with real ESP32 serial logs or the original direct-read data under ignition ON engine OFF. The *app's verified data lengths* are the basis of the parser; a passing fake frame/compile is not a motorcycle test.
- Verify exact real 0x5A string + MAP, 0x9A frames for MAP1/2/3/4, decoded maxSpeed matches Blink's normal Idle/Limit panel; confirm RGON only at verified RPM=0; successful RG:ON means four limits verified. An unsupported version must report RG:UNSUP and never attempt transition.
- MAP4 must be independently configured as safe for the motorcycle. MAP changes at high RPM can be damaging; do not simulate on a running vehicle and do not conduct public-road redline testing.
- For V11/Ultra Pro2 need proof of which RPM/64 row3 column corresponds to actual rev cutoff and its effect on MAP4. V8 single-bank mode cannot guarantee a MAP4 refuge at all. Do not broaden those until actual per-model handshake/page/map switch fixtures are verified.

## Follow-up: REDLEO V9.13 normal MAP1 READ works, guard RG:LIMITERR:M1 (2026-10-13)
- Owner confirmed Blink's normal Idle/ECT Motor MAP1 **READ succeeds on physical V9.13**; previously pictured MAP4/0x68 progress was not itself proof of READ success, but MAP1 success was explicitly confirmed. Therefore ECU can serve at least one correct 0x9A page6 frame over this link. This does **not** establish the actual byte count because no raw hex/serial log was supplied.
- Root mismatch identified in source: Blink web `selectDirectPageFrame` uses `findValidCommandFrame(rx,page,minData+3)` and demands **at least 30 bytes** page6 data for 9.1x; first FW2.6 candidate's `parseLimitForFamily` demanded **exactly 33 response bytes**. Valid checksum-protected reply-only tails were discarded in guard but accepted by normal Blink.
- Revised lab FW2.6 on the same feature branch: family verified by checksum-protected 0x5A remains mandatory; V9.1/V9.2/V10/Ultra minimum page6 frame sizes remain 33/65/21/45; guard now scans the received buffer for the **longest complete page-matched checksum-valid command frame** (same as Blink), allowing extra reply-only data. RPM still comes from the same model-specific writable-word offset (5 for V9/V10, 7 Ultra), must be plausible 3000..18000, and all 4 MAP limits and fresh RPM=0 proof remain mandatory before enabling. Invalid checksum/short frames still reject.
- C++ regression simulations cover extra valid suffix lengths, serial noise/echo prefixes, invalid CRC, truncated frames, unsupported ECU and redline timing; these are synthetic fixtures, **not** the real physical V9.13 wire capture.
- **A successful Blink MAP1 READ does not by itself prove this patch resolves RG:LIMITERR:M1**: for example guard autonomous UART may have received 0 bytes, ECU limit may be outside plausible range, or requested MAP may be different. On next key-ON engine-OFF test collect ESP32 Serial line `REDLINE limit MAP1 invalid ECU profile=... attempt=... bytes=...` if the failure persists. Do not bypass fail-closed guard protection.
- No public OTA release for the lab revision. Customer OTA remains 2.5.

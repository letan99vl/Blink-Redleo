# BLINK Ultra Pro1 IGN degree scale — 2026-10-14 (LAB)

## Observed real screenshots (same ECU/MAP1/TPS100)
The owner provided original REDLEO PC Ultra Pro1 software and Blink iOS screenshots:
| RPM | Original PC (degrees) | Current Blink (degrees) | raw byte implied |
|---|---:|---:|---:|
| 3000 | 15.1 | 10.8 | 107 |
| 4000 | 19.0 | 13.5 | 118 |
| 4500 | 21.1 | 15.0 | 124 |
| 7000 | 23.2 | 16.5 | 130 |
| 7500 | 25.0 | 17.8 | 135 |

All five exactly match current Blink decode `r1((raw-64)/4)` compared with original PC `r1((raw-64)/4*360/256)`. The factor is `1.40625` relative to the unrounded legacy result; the old Blink result is 71.111% of original PC. This is an ECU-unit conversion error, **not RPM/TPS row/column offset**.

## Changes on feature branch
- `redleo_real_protocol.js` `decMainIgn` uses `decEctIgn(raw)` ONLY for `isUltraDirect()` / **Ultra Pro1** (REDLEO MODERN_V10 with ULTRA in checksum-verified 0x5A identity).
- `encMainIgn` uses inverse `encEctIgn(v)` for the SAME family: avoids corrupting page 0x3x IGN bytes when saving a displayed value. V9 (including 9.13) and non-Ultra V10.x maintain legacy `decIgn/encIgn`. V11/Ultra Pro2 retains verified 0.28125 degrees/step mapping. Live IGN, INJ degree, axes and page addresses untouched.
- `parseCanonicalReadAll` and legacy `writeBankAll` route IGN through the same family-specific main IGN codec, avoiding a latent inconsistent read-all path. Existing direct page 0x32/0x34/0x36/0x38 writer already calls `encMainIgn`.
- Regression `tools/check-ultra-pro1-ign-degree.js` asserts 5 screenshot values, complete RAW 0..255 round-trip, 14x30 orientation, independent old V9/normal V10/V11 codec, original pre-5s PB3.79.72 preserved, OTA server remains disabled.
- CI branch `fix/blink-ultra-pro1-ign-degree-scale-20261014` Green run `38555563894`: entire Check REDLEO Protocol JS workflow PASS, including Ultra page6/A2 test suites.
- **Candidate has NOT been deployed to customer `main` / GitHub Pages or iOS.** This commit only prepares a fix and tests until Ultra Pro1 read-back can be compared to PC software. Do not GHI ECU ignition on old Blink UI until fixed (wrong physical unit used for encoder); run bench tests with ignition ON engine OFF.

## Verification/rollout
1. Under test, capture an ECU 0x5A identity with literal ULTRA (via `window.BlinkRealProtocol.handshake` or UI info) and read MAP1 Page 0x32 without writing.
2. Compare five known TPS100/RPM cells to original Windows app; expected at 3000 15.1, 4000 19.0, 4500 21.1, 7000 23.2 and 7500 25.0 ONLY IF ECU data has not been changed since screenshots.
3. Then test inverse round-trip by reading same unchanged page twice, and only consider a controlled physical write validation with a safe known baseline. No high-RPM or vehicle tests.
4. To release, merge candidate PR after physical confirmation. `redleo_real_protocol.js` is loaded remotely by Blink web/app (subject to client caching); `index.html` should remain PB3.79.72 pre-5s with target AFR keypad, OTA `version:0.0.0` disabled, and ESP32 firmware source untouched.

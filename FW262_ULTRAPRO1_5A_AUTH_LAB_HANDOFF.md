# BLINK ESP32 FW2.6.2 LAB — Ultra Pro1 0x5A compatibility

Date: 2026-10-14. **LAB ONLY. NOT PUBLIC OTA.** Public OTA is still FW2.5.

## Customer observation

- REDLEO Ultra Pro1 ECU authenticates and reads normally using ESP32 FW2.2 with the same Blink client, but does not complete 0x5A authentication on the experimental ESP32 FW2.6.1.
- The failure is observed before ECU map access. A Bluetooth pairing success alone does not establish ECU authentication.

## Proven source-level incompatibility and likely cause

- FW2.2's bridge does not gate incoming 0x5A replies by REDLEO family, decoded active MAP, printable firmware bytes, or a fixed allowed 0x5A response length. It transparently forwards UART response bytes to the Blink protocol client.
- FW2.6.1 added UART pin auto-discovery using `BlinkAutoPins::validHandshakeReply`; the function required a 9-byte reply or a 35–96B reply, `p[33]<=3`, and printable version bytes `p[17..20]`. It returned false even for an otherwise fully checksum-valid Ultra Pro1 reply that the Blink JS `parseHandshake` would accept.
- If that happened on the actual connected UART pair, FW2.6.1 attempted a SECOND `0x5A` read on the OTHER pins. If it also failed, an oversize (>128B) original reply could be discarded by the fallback buffer. The app would report ECU authentication failure.
- These gates were added specifically for **autonomous Redline Guard** model safety but were inappropriately applied to the **general BLE/UART handshake**. Actual Ultra Pro1 raw `0x5A` frame from owner's unit has not yet been captured, so this is a strongly grounded probable root cause, not a measured proof.

## FW2.6.2 changes

- `BlinkAutoPins::validHandshakeReply` now accepts an ECU reply when it begins `0x5A`, length is 9–512B, and REDLEO complement+sum checksum is valid. It no longer imposes a MAP/firmware encoding on the transport layer.
- `BlinkAutoPins::normalizeHandshake` finds the **longest checksum-valid complete frame** after optional UART prefix, including an Ultra Pro1 response longer than 41B. It does not truncate to an accidental 9B/37B/41B prefix. Preserves the selected known RX/TX pair, preventing needless pin switching.
- The **separate** `BlinkGuard::parseHandshake` is unchanged and **still fails closed** on unsupported ECU, untrusted MAP identity, or unknown limit layout. NO relaxation of MAP4 trigger, 5-second timer, or ECU write safety.
- Original FW2.6.1 multi-ECU page6 model-aware logic and key-on zero-RPM proof are retained. No changes to client JS/iOS bundle, the 0xE1/0xE2 BLE protocol or production OTA manifest.

## Safety and acceptance

1. Disconnect engine from any running/tuning session. Switch ignition ON with engine OFF and retain a known-good FW2.2 binary/USB flasher for emergency rollback.
2. Flash this lab INO or application BIN with the **correct** ESP32 partition offset. Do not flash app BIN at address 0x0.
3. Check Blink reports `FW2.6.2`, then connect to Ultra Pro1 and verify actual ECU authentication `0x5A`, ECU identity, and ordinary READ MAP1/READ other maps.
4. If the handshake still fails, collect Arduino Serial logs around `ECU TX sid=... cmd=5A`, `ECU RX sid=... len=...`, `ECU UART active RX=... TX=...`, the ECU Ultra firmware string and client timeout. Never send map writes or test the limiter while troubleshooting.
5. Do not enable the 5-second autonomous Redline Guard until all 4 page6 limits and MAP4 read-back have been verified on this physical ECU. `RG:UNSUP` does not prevent ordinary map reading and must not be bypassed just to enable protection.
6. Run host core tests and real ESP32 Arduino compile before distributing the lab candidate; synthetic fixture PASS does not establish success on Ultra hardware.

## Provenance

- Branch: `feature/blink-fw262-ultra-pro1-handshake-20261014`
- Based on FW2.6.1 lab branch. Specific ECU wire capture still needed to confirm whether MAP/version, framing length, or pin probe timing caused the failure.
- Public FW2.5 release should not be replaced until user verifies both Ultra Pro1 read paths and no regressions on REDLEO 9.13/10.3.

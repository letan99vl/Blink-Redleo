# FW 2.3 Redline Guard — isolated lab candidate

Status: **candidate, NOT shipped or published to public OTA**.
Baseline retained on `main`: Blink PB 3.79.72 + ESP32 FW 2.2.
Candidate branch: `feature/fw23-autonomous-redline-guard-20261013`.

## Goal
Once explicitly armed from Blink with the motorcycle engine stopped, the ESP32 remembers the setting in NVS. From the next ignition-power cycle onward, the ESP32 itself talks to the REDLEO ECU over the existing 38400 8E2 UART even with *no phone connected*. A validated RPM signal at the current MAP's own ECU RPM limit for a cumulative 5 seconds triggers a *verified* selection of MAP 4. MAP 4 remains selected until key-off/power-cycle or the rider turns the protection off while stationary. It never auto-jumps back on deceleration.

## Integration
- FW2.3 keeps RX22/TX23, existing BLE UUID, RAW E1/E2 framing, UART checksum and original ECU write path.
- ESP32 opens UART on boot as in FW2.2; if and **only if** `blinkguard.enabled=true` in ESP32 NVS, main-loop autonomous scheduler sends ECU 0x5A handshake, checks V9.1x/9.2x identification and MAP, and reads **all four** 0x9A page-6 limits (0x62/0x64/0x66/0x68).
- Limit = first 9 x 16-bit-BE Idle/Limit payload's `maxSpeed` at offset 4. Response must have valid 33/65/66 byte checksum frame and RPM 3000..18000. Other ECU families **fail closed**; especially V8, Ultra/V10 and ATE/V11.
- Periodic 0x69 MAP request returns 53-byte checksum-protected 0xA1 frame. RPM = big-endian reply bytes 6..7. When Blink is connected its existing 0x69 replies feed the same tracker; auto poll resumes if Blink is absent or quiet. Entire firmware uses one UART owner: `loop` alone calls `transactUart()`, with completed phone requests preferred and partial BLE frames yielding.
- Redline detector uses 250-RPM near-margin; only valid near-limit samples accumulate real elapsed ms up to 5000. A gap over 600ms or a dip over 350ms resets counter, preventing stale/fake Live samples.
- After trip: send 0x69 MAP4, then verify via checksum-protected 0x5A active-map index = 3 (No.4), allow max 3 attempts, then latch. A Live ACK alone is not enough; if not verified report `RG:FAULT`, never claim success. Incoming phone 0x69 is pinned to No.4 when latched/pending; phone 0xCD/restore 0x8B blocked until protection disabled stationary. Read-only operation still available. This is **not** a replacement for hard ECU rev-limiter or safe riding.
- If page6 edited via phone, invalidate its limit cache and suspend redline decisions until ECU re-read; do not guess stale settings.
- Only NVS `enabled` persists; the trip latch is volatile and deliberately not restored across a power cycle. Power should come from a switched key circuit.

## New BLE text controls on COMMAND characteristic
- `RG?`: query human-readable status, for example `RG:OFF`, `RG:WAIT`, `RG:READING`, `RG:ON:M1:12000`, `RG:TRIP:M4`, `RG:FAULT`.
- `RGON` / `RGOFF`: opt in/out (stored in ESP32 NVS) **only** when a recently validated live RPM <= 800 is available. Otherwise `RG:STOP`. Firmware v2.2 does not support these commands.
- In Blink candidate PB3.79.76, Settings > AN TOÀN REDLINE gives controls and confirms MAP4 was safely prepared. The app stops live Auto Tune / 3-run and latches display MAP4 on status `RG:TRIP:M4`.

## Safety and release rules
- **Do NOT update** `ota/manifest.json` to 2.3 until real-ECU validation, and do not silently enable this on current customers.
- Github Actions branch workflow `FW2.3 Redline Guard Candidate Checks`: C++ checksum/RPM/timer tests, Blink UI syntax/safety assertions, compile full ESP32 sketch and attach LAB-CANDIDATE binary artifact. This proves source compiles, not that on-bike switching works.
- Hardware test first with engine stopped/ECU powered: test 0x5A V9 handshake, all 4 page6 limits, RGON NVS persistence, actual selected ECU map, power interruption and BLE disconnect. Then on controlled bench using a simulated 53B A1 stream verify exactly 5s and signal gaps. Only then try gentle, supervised real-ECU test, with map4 verified in advance.
- **Do not test intentional 5-second limiter bouncing on public roads.** Long redline episodes can cause engine damage before any automatic protection acts.
- If your ECU is unsupported, settings/status say RG:UNSUP instead of inventing limits; feature stays inert, although auto-reads continue while enabled. If no 0x5A/read, investigate wiring and power; don't raise timeout to force activation.
- Switching MAP at high RPM can abruptly change injection, ignition or rev limits. This is an additional safeguard for an opt-in expert, never a guarantee against mechanical damage.

- On three failed MAP4 verification attempts the firmware reports RG:FAULT and continues preferring 0x69 MAP4 requests, without claiming the ECU switch was proven; it blocks stale phone selection/writes until the engine stops and the guard is disabled. The UI also blocks manual switching under RG:FAULT.

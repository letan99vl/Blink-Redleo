# Blink FW 2.5 · Key ON / engine OFF Redline Guard arming fix (LAB)
Date: 2026-10-13

**Branch ONLY — do not publish OTA until physically tested.** Public OTA stays FW2.4. Public Blink stays PB3.79.81.

## Root cause confirmed in FW2.4
In the BLE callback, RGON checked a valid Live 0x69 RPM <=200 less than 700ms old, with >=1000ms of stationary time, before starting any verification. But autonomous 0x69 polling in guardAutonomousTick returned immediately when guardEnabled was false. With ignition ON and engine OFF, no valid 0-RPM packets meant immediate RG:STOP even though the vehicle was stopped.

## FW2.5 change (single .ino, no .h)
- RGON is a deferred arming request, **not** immediate NVS enable. Respond RG:CHECK.
- Main-loop guardTryArm runs even with protection OFF. It first obtains a fresh validated 0x5A ECU identity (supported V9.1x/V9.2x), thus learns current MAP. Only then does it send 0x69 Live reads on that same current MAP if the phone has not recently supplied a validated frame.
- Actual checksum-valid 53B A1 frames need to report **RPM == 0**, at least 3 samples across >=1000ms, with gaps <=700ms. First valid zero must be after RGON. A nonzero RPM aborts (RG:RUNNING). Absent frames time out (RG:NORPM). Missing supported 0x5A identity times out (RG:NOECU). Unsupported ECU returns RG:UNSUP. Never infer RPM 0 from silence.
- On success, guardEnabled=true is set **only inside guardTryArm after the proof** and NVS blinkguard/enabled=true persisted; original FW2.4 independent 5000ms redline detection, 4-MAP limit reads, MAP4 switch and verification remain unchanged.
- The BLE callback does **not** send UART requests; phone RAW transaction and initial 0x5A handshake retain priority. RGOFF cancels an unarmed check safely. Disabling an already armed guard still requires original stopped-engine proof.
- Blink PB3.79.82 (branch only) describes progress and error state.

## Test results / outstanding
- Host C++ tests include absence of RPM, 1-sec zero witness, short/long gaps, positive RPM rejection, millis rollover, original 5s redline logic and auto-pin checksum.
- CI branch workflow additionally validates UI contracts, Arduino classic ESP32 compile; no OTA publishing permissions.
- **Real ECU test still needed with ignition ON, engine not started**, verifying valid 0x5A and 53B 0xA1 zero-RPM replies, final RG:WAIT/READING/ON, power-cycle NVS, both UART pairs.
- Some ECUs do not return live RPM while crankshaft is not rotating; then RG:NORPM is the expected safe failure and firmware cannot silently assume engine stopped. Read ECU Serial debug first, do not bypass or force-enable.
- Do not test 5 seconds at redline on an operating motorcycle.

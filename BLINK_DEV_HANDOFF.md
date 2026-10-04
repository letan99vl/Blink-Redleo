# BLINK REDLEO - DEV HANDOFF / CONTINUITY NOTE

> MUST READ FIRST in every new ChatGPT/dev session before changing protocol code.
> MUST UPDATE THIS FILE after every meaningful protocol/UI milestone, bug discovery, hardware test, rollback, or PB bump.
> Do not delete old findings. Append/update status so the next session does not repeat unsafe guesses.

## 1. Project / release context

- Repo: letan99vl/Blink-Redleo
- Product: BLINK REDLEO ECU tuning web/app + ESP32 BLE/UART bridge.
- User is preparing commercial release.
- Physical ECUs currently available for real testing: REDLEO 9.2 and ATE V11.1.
- Other REDLEO versions are being opened carefully from original PC software analysis.
- Generic ECU Pro 2017 / LEGACY remains SAFE MODE and is intentionally excluded.
- Current displayed PB: **3.79.40**.
- IMPORTANT: main currently contains protocol investigation commits newer than the PB bump. Do not claim page-0x62 write is fixed until real 9.2 hardware confirms ACK + readback.

## 2. Mandatory safety rules

1. READ length and WRITE/TX length are NOT automatically the same.
2. Never infer writable page length only from a successful read.
3. Before enabling a writer, identify:
   - real page/command,
   - exact writable region / TX length,
   - encoder/order,
   - required handshake/state,
   - expected ACK,
   - readback behavior.
4. Unknown/reserved bytes must not be guessed.
5. After write, prefer readback verification. Verify writable bytes and verify unrelated/tail bytes remain unchanged when a longer read frame exists.
6. If evidence is incomplete, keep writer locked and show an explanatory UI message instead of a silent disabled button.
7. Never broaden a writer from one ECU family to V10/Ultra/V11 just because profiles look similar.
8. Create a backup branch before risky protocol changes.
9. After every change:
   - parse all inline index.html scripts,
   - parse redleo_real_protocol.js,
   - check duplicate IDs,
   - confirm profile gates did not broaden unintentionally,
   - update PB only when appropriate,
   - update this handoff file.

## 3. Current real-hardware discovery: REDLEO 9.2

### Confirmed reads from real ECU

- A2 direct read returns **134B** on the user's REDLEO 9.2.
- Page 0x62 direct read returns **63B** on MAP No.1.
- Earlier strict equality gates 133B/30B were wrong and were removed.

### Critical page-0x62 status - PB 3.79.40 REAL-HARDWARE TRANSPORT PASS

Historical failures on PB <=3.79.39:
- Idle/Limit -> **ECU không ACK CD 62 · RX 0B**
- ECT Motor -> **ECU không ACK CD 62 · RX 0B**
- The failed experiments used wrong 30B/63B write assumptions.

PB 3.79.40 reproduces the original 9.2 page-6 serializer as **62 writable bytes**. On 2026-10-05 the user tested a real REDLEO 9.2 and reported that BOTH Idle/Limit and ECT Motor save successfully. Because the success path only reports after ECU ACK + post-write byte readback, page-0x62 transport/persistence is now considered REAL-HARDWARE PASS on this ECU. Final semantic-value certification (UI scale/physical meaning) still needs a controlled one-value change or original-PC cross-check.

### Important IL evidence from original REDLEO ECU Pro 9.2

Original EXE:
- /mnt/data/ecu_extract/REDLEO ECU Pro 9.2/REDLEO ECU Pro 9.2/ECU Pro 9.2.exe

Decompiled method flow from original software:

- `tspBtnWriter_Click`
  - if ECU_MODE < 4:
  - calls `RetPageNumber(...)`
  - then `proDgvEnter(write=true, page)`

- `RetPageNumber()`
  - `RetPage() * 16 + RetNumber()`

- `RetNumber()`
  - for firmware >= 9.1, selected MAP number is multiplied by 2.
  - therefore MAP No.1 low nibble is 2.
  - Idle page for MAP No.1 really is **0x62**. Blink's page number is NOT the current problem.

- `proDgvEnter(write=true, page)`
  - sets CurStateTem = 0xCD
  - sets WrNumPage = page
  - calls `proUartSendToEcu(page)`

- `proUartSendToEcu(0x62)`
  - starts TX with CD + page
  - high nibble 6 serializes, for the selected bank:
    - Dgv_Idle_Limit1 using `proUartDgvNumOption`
    - Dgv_Ect_Motor1 using `proUartDgvNum`
    - Dgv_EctStrt_Add1 using `proUartDgvNum`
  - then appends complement/checksum/length.

Confirmed byte structure from original IL:
- Idle/Limit: **9 x uint16-BE = 18B**.
- ECT Motor: **2 rows x 11 columns = 22B**.
- ECT Start Add: **2 rows x 11 columns = 22B**.
- Total writable payload: **62B**.
- Real 0x9A read on the user's 9.2 returns **63B**. Byte 63 is reply-only and MUST NOT be sent in CD 62.
- Original `proUartDgvNum` transmits DataGrid rows in reverse UI order. For ECT Motor:
  - first 11 wire bytes = UI `INJ VE(ms)` row,
  - next 11 wire bytes = UI `Step/Time` row.
- Original `proDgvUnit` encodes ECT Motor Step/Time:
  - solenoid: round(value / 2),
  - stepper: `Second_Or_200ms(value,0)` = round(value * 5).
- Blink PB 3.79.40 preserves the hidden 11B INJ row, edits the visible 11B Step/Time row, and preserves all 22B ECT Start Add.
- Idle UI language order from original LNG_EN:
  1. Idle Speed (Cold)
  2. Idle Speed (Hot)
  3. Idle Return INJ (Cold)
  4. Idle Return INJ (Hot)
  5. Maximum Speed
  6. Acceleration Setup Percentage
  7. Enter (leave) idle sensitivity
  8. Idle minimum inj (cold)
  9. Idle minimum inj (Hot)
  Blink exposes items 1..7 and preserves words 8..9 byte-for-byte.
- Original checksum/final-length generation matches Blink `finalizePage`. For 62B payload, complete CD62 frame is **67B**.

### Current task to solve next

1. Page 0x62 transport is no longer blocked: real 9.2 saves succeed on PB 3.79.40.
2. Do one controlled semantic test:
   - change ONE Idle value by a small known amount -> SAVE -> READ again -> confirm only that displayed Idle value changes;
   - change ONE ECT Motor cell by a small known amount -> SAVE -> READ again -> confirm only that displayed motor value changes.
3. Strongest optional cross-check: connect the same ECU with original REDLEO ECU Pro 9.2 and confirm the displayed values match Blink after the write.
4. If the controlled values match, page 0x62 can move from TRANSPORT PASS to RELEASE-CERTIFIED for this 9.2 hardware.

## 4. REDLEO 9.2 writer status

Confirmed/mostly established:
- Fuel main map
- INJ degree
- IGN degree
- Dwell / IGN time
- ECT INJ page 0x72
- ECT IGN page 0x82
- MAP INJ page 0x92

Needs hardware validation after recent refactors:
- IAT INJ / A2 path
- V-ECT / V-IAT / V-MAP
- MAP idle motor
- External adjustment
- Auto clutch

NEEDS REAL-HARDWARE TEST ON PB 3.79.40:
- Idle/Limit page 0x62 writer: exact 62B serializer reconstructed.
- ECT Motor page 0x62 writer: exact 11-point visible Step/Time row + hidden INJ row preservation reconstructed.

Historical PB <=3.79.39 failures remain evidence, but PB 3.79.40 is a materially different serializer. Do not advertise page-0x62 write as working until real ACK + readback passes.

## 5. 9.1X status

- Modern V9 family.
- Full-write safety gate is exact decoded READ ALL 9767B.
- A helper was added so a gated write can auto-run READ ALL first instead of silently requiring the user to do it manually.
- If READ ALL is not decoded 9767B, full-write remains locked.
- Do not loosen 9767B gate without new original-software/hardware evidence.

## 6. V10.2 status

- V10 and Ultra share MODERN_V10 profile in Blink, but original writers are NOT identical. Keep serializer gates separate.
- V10 vs Ultra is separated using handshake text containing ULTRA.
- Static IL from original V10.2 confirms:
  - page family 6 serializes **only Dgv_Idle_Limit[bank]** via `proUartDgvNumOption`; it does NOT serialize ECT Motor there.
  - therefore V10 page6 is structurally different from REDLEO 9.2 page6.
  - A2 writer starts with `proUartDgvNumVoltage`, which serializes TPS + RPM + vAFR + vECT + vIAT + vMAP + IAT INJ + MAP Motor (the known 140B prefix), then appends Options + ECT Motor + ECT Start Add + External Adjustment + password-related bytes.
  - firmware-dependent Spare may also be included in the voltage prefix on older firmware.
- IMPORTANT: A2 direct-write for V10 remains deliberately LOCKED because readable 140B does NOT prove the complete accepted TX length.
- V10 Idle/page6 writer also remains LOCKED in Blink until the exact original V10 Idle 18B TX/readback path is implemented separately.
- Never reuse the 9.2 62B page6 serializer for V10.

## 7. Ultra Pro1 status

- Ultra executable is highly similar to V10 but its original writer differs materially.
- Static IL from original Ultra Pro1 confirms:
  - page family 6 serializes **Idle Limit + AutoShift + Four-Spare** for the selected bank.
  - ECT Motor and ECT Start Add are NOT on page6; they are serialized in A2.
  - Ultra A2 serializes TPS/RPM/voltages/IAT INJ/MAP Motor prefix, then Options + ECT Motor + ECT Start Add + One-Spare + External Adjustment; newer firmware may also append CHG.
- Therefore Ultra must have its own page6/A2 writer and must NOT reuse V10.2 or 9.2 TX assumptions.
- Ultra remains LOCKED for these extended writers until exact block dimensions/TX length are reconstructed.
- Main fuel/angle/dwell support remains separate from this extended-writer work.

## 8. V8 status

- Dedicated V8 fuel/page logic exists.
- Main tune only is the conservative supported target.
- Options/TPS Study/Password/Restore/full-write remain restricted.
- Do not expand V8 until original V8 writer path is separately reconstructed.

## 9. ATE V11.1 status

- Real hardware available and broadly supported.
- Dedicated V11 layouts exist.
- A2 verified layouts: 272B and 286B.
- Full ReadAll verified layout: 9958B.
- Recent safety work added readback verification ideas to multiple partial writers.
- Be careful not to assume longer readable frames mean longer writable frames.
- V11 canonical writer lengths should follow verified original serializers/layouts.

## 10. UI work already completed

Recent mobile map editor work includes:
- Removed top +/- from fuel and 420-cell map toolbars.
- Added right-side +/- controls and numeric keypad behavior for 420-cell maps.
- Added keypad to ECT INJ.
- Removed COPY/PASTE from map toolbar.
- Toolbar optimized to avoid horizontal swiping.
- Back button moved into action row for easier tapping.
- Fuel-map header compacted.
- Landscape/fullscreen TPS row height optimized.
- Zoom HUD consists of:
  - ECT display (not a button)
  - THU NHỎ button
- Zoom HUD was moved away from the rotated right-side tool rail.

Do not reintroduce COPY/PASTE to fullscreen map UI unless explicitly requested.

## 11. PB / backup history highlights

Recent PB progression:
- 3.79.24 baseline before mobile-map UI changes
- 3.79.25 420-cell touch editor
- 3.79.26 toolbar cleanup
- 3.79.27 compact fuel header/TPS fit
- 3.79.28 larger back button
- 3.79.29 back button moved into action toolbar
- 3.79.30 ECT INJ keypad
- 3.79.31 fullscreen map height
- 3.79.32 V9.2 compensation write attempt
- 3.79.33 zoom HUD fix
- 3.79.34 9.1X auto full-write verification
- 3.79.35 9.2 A2/page6 unlock attempt
- 3.79.36 V10 work
- 3.79.37 9.2 readable-tail relaxation
- 3.79.38 direct-page safety hardening attempt
- 3.79.39 writable-length separation work
- 3.79.40 REDLEO 9.2 page6 exact 62B serializer + real 11-point ECT Motor grid; unverified V9.1/V10 page6 writers locked

Useful backup branches include:
- backup-pb-3.79.31-pre-v92-comp-write
- backup-pb-3.79.33-pre-v91-unlock
- backup-pb-3.79.34-pre-v92-a2-unlock
- backup-pb-3.79.35-pre-v10-unlock
- backup-pb-3.79.36-pre-v92-length-fix
- backup-pb-3.79.37-pre-direct-page-hardening
- backup-pb-3.79.38-pre-write-length-fix

## 12. Release/support labeling

Until hardware proof exists:
- Official: REDLEO 9.2 core tested, ATE V11.1 tested.
- Beta: 9.1X, V10.2, Ultra, V8.
- Not supported: generic ECU Pro 2017 legacy.

Do not claim an untested ECU family is guaranteed to write safely.

## 13. Regression protection added

- `tools/check-v92-page6.js` locks the verified REDLEO 9.2 page6 invariants:
  - 18B Idle + 22B ECT Motor + 22B ECT Start Add = 62B writable.
  - 63rd read byte is reply-only.
  - ECT Motor uses exactly 11 visible Step/Time points.
  - hidden 11B INJ row and 22B ECT Start Add are preserved.
  - old 30B page6 write assumption must not return.
  - V9.1X and V10 page6 writers remain locked.
- GitHub Actions `.github/workflows/check-redleo-protocol.yml` now runs this regression checker on protocol changes.
- Relevant commits:
  - `eb3b819157e5d576a8a5af80aeedd70e1c0f2769` exact REDLEO 9.2 62B serializer.
  - `8ad52b79f1dc2d3a4dd904396787db2657b1d09d` real 11-point ECT Motor + PB 3.79.40.
  - `b3dc8c09add6be8428ddf62118146cafaf34d19c` lock unverified V9.1/V10 page6.
  - `6ab62eb5d6a600ca7ae179264d792136cf3ae3ce` page6 regression checker.
  - `1949b418b8e6bbbe3ed66d8daf28ddee98fc227f` run page6 checker in CI.

## 14. Required handoff discipline

At the end of every meaningful session:
1. Update current PB.
2. Update last verified real-hardware behavior.
3. Record any failed experiment and why it failed.
4. Record exact original-software evidence used.
5. Mark writers as WORKING / NEEDS TEST / LOCKED / BROKEN.
6. Write the next exact task.
7. Commit this file in the same repo.

The next developer/ChatGPT MUST continue from this note, not restart protocol assumptions from scratch.


## Hardware confirmation update - 2026-10-05

- PB: 3.79.40
- REDLEO 9.2 real ECU:
  - Idle/Limit SAVE: **SUCCESS reported by user**
  - ECT Motor SAVE: **SUCCESS reported by user**
- Since the Blink success path requires ACK + post-write byte verification, this confirms the former `CD 62 · RX 0B` failure is fixed on the tested ECU.
- Remaining uncertainty is semantic scaling only, not byte persistence/collateral-page corruption.


## Hardware semantic certification update - 2026-10-05

- PB: 3.79.40
- REDLEO 9.2 real ECU page 0x62:
  - Controlled single-value Idle change -> SAVE -> READ back: **PASS reported by user**.
  - Controlled single-cell ECT Motor change -> SAVE -> READ back: **PASS reported by user**.
  - User reports behavior is correct after readback; no collateral-value issue observed in this controlled test.
- Status change:
  - Idle/Limit page 0x62: **RELEASE-CERTIFIED on tested REDLEO 9.2 hardware**.
  - ECT Motor page 0x62: **RELEASE-CERTIFIED on tested REDLEO 9.2 hardware**.
- Keep this certification scoped to the tested REDLEO 9.2 family. Do NOT reuse its 62B serializer for V9.1X, V10.2, Ultra Pro1, V8, or ATE V11.1.

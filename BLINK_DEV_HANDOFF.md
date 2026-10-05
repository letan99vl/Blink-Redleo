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
- Current displayed PB: **3.79.48**.
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
  - A2 writer starts with `proUartDgvNumVoltage`, then Options + ECT Motor + ECT Start Add + External Adjustment.
  - Deep IL reconstruction corrected the old 140B-prefix assumption for direct V10.2: TPS is **2 rows × 14B = 28B**, followed by RPM 60B and six 11B sensor/compensation blocks.
  - Modern V10.2 `programSpaceOut()` contributes **11B**: feature/config byte + AutoClutch RPM + 5 AutoClutch bytes + 4 password nibbles.
  - `Dgv_Option` contributes **18B** via `proUartDgvNumOption` (6 rows × 3 serialized values).
  - ECT Motor = 22B, ECT Start Add = 33B, External Adjustment = 30B.
  - Exact V10.2 A2 writable payload = **268B**.
  - firmware-dependent Spare applies only to older firmware path; V10.2 modern path uses programSpaceOut instead.
- PB 3.79.41: V10.2 Idle/page6 implemented as exact **18B Idle-only** writer.
- PB 3.79.42: direct V10.2 A2 reconstructed as exact **268B** read-modify-write baseline.
- V10.2 A2 partial writers now opened from a successful 268B direct read for: IAT INJ, MAP Idle Motor, ECT Idle Motor, External Adjustment, V-ECT, V-IAT, V-MAP.
- CONFIG/AutoClutch/password, Option and ECT Start Add are decoded/preserved where applicable but are NOT broadly editable yet in this pass.
- Ultra remains separate and must NOT use the V10.2 268B serializer.
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
- 3.79.41 V10.2 page6 exact 18B Idle/Limit serializer from original IL; ECT Motor removed from V10 page6 surface and routed to A2 work
- 3.79.42 V10.2 exact 268B A2 serializer; verified partial RMW writers for IAT/MAP motor/ECT motor/external/voltage; Ultra remains separate
- 3.79.43 V10.2 AutoClutch timer writer: edits only CONFIG bytes +2..+6 (raw=ms/5), preserves feature byte + Start RPM + password
- 3.79.44 V10.2 ECT Start Add 3x11 writer: exact original row labels/order/scale, A2 268B RMW, Ultra excluded
- 3.79.45 V10.2 Dgv_Option 18B writer: 15 verified semantic cells editable, reserved bytes 15..17 preserved raw, Ultra excluded
- 3.79.46 V10.2 TPS/RPM axis writers: exact original normalization + A2 offsets, TPS voltage row regenerated from Option Min/Max, Ultra excluded
- 3.79.47 Ultra Pro1 page6 exact 42B Idle writer: Idle 24B + AutoShift 9B + Four-Spare 9B; only 8 labeled Idle values editable; hidden/sibling blocks preserved
- 3.79.48 Ultra Pro1 exact A2 277/285B serializer: family-specific parser/RMW writers, correct CONFIG semantics, exact readback cache parser; Option/One-Spare/CHG/config remain raw-preserved

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


## V10.2 page6 implementation update - 2026-10-05

- PB: **3.79.41**.
- Source evidence: original **REDLEO ECU Pro 10.2** static IL.
- Confirmed original writer behavior:
  - page family 6 serializes **only Dgv_Idle_Limit[bank]** through `proUartDgvNumOption`.
  - Idle/Limit block is **9 x uint16-BE = exactly 18 writable bytes**.
  - V10 ECT Motor is **NOT** serialized on page6; it belongs to A2 and remains locked until complete A2 serializer/TX length is proven.
- Blink implementation:
  - V10 direct page6 READ now accepts >=18B, decodes only first 18B as Idle/Limit, and preserves any longer reply tail as reply-only/baseline data.
  - V10 Idle SAVE sends **exactly 18B** and preserves the 2 hidden Idle words (bytes 14..17).
  - Post-write verification checks all 18 writable bytes and also verifies any longer read tail remains unchanged.
  - The old 30B V10 Idle/ECT page6 assumption has been removed from the active writer path.
  - V10 ECT Motor feature is hidden/locked instead of incorrectly sharing page6.
- Regression protection:
  - `tools/check-v10-page6.js` forbids a return to the old 30B assumption and requires the 18B writer + A2 lock.
  - CI workflow runs this checker together with syntax, row-orientation, and REDLEO 9.2 page6 checks.
- Hardware status: **NEEDS REAL V10.2 TEST**. Do not call this release-certified until a real V10.2 performs READ -> small one-value Idle change -> SAVE -> READBACK successfully.
- Backup branch before this change: `backup-pb-3.79.40-pre-v10-idle18`.
- Core implementation commit: `9321d5e93f67d5176cb1d27752b50fd761f3e016`.
- Regression checker commit: `e1db6ee896648be64b27cd0595169655bce2e537`.
- CI wiring commit: `11e43e42f8973cc76e6499cc33efddbdf5e49fbb`.
- PB bump commit: `897f2f9658b5cffd22b5133df62ec05e0ecd340f`.


## V10.2 A2 reconstruction update - 2026-10-05

- PB: **3.79.42**.
- Original source analyzed: `Redleo ECU Pro Ver10/ECU Pro 10.2.exe` extracted from the archived original PC software.
- Relevant original IL methods:
  - `UartDatRx::proUartSendToEcu`
  - `proUartDgvNum`
  - `proUartDgvNumOption`
  - `proUartDgvNumVoltage`
  - `__UartToDgvTps`
  - `UartDat::programSpaceOut`
  - `UartDat::proReadAutoClutchPassword`
  - `ModlePassword::proUartPassword`
  - `Color_Moude::__IsMotorSolenoid`
- Corrected old assumption: direct V10.2 A2 is NOT a 140B writable page.
- Exact modern V10.2 A2 writable layout:
  - 0..13: hidden TPS row = 14B
  - 14..27: visible TPS breakpoint row = 14B, UI raw/2
  - 28..87: RPM axis = 30 × uint16-BE = 60B, UI raw×20
  - 88..98: vAFR = 11B
  - 99..109: vECT = 11B
  - 110..120: vIAT = 11B
  - 121..131: vMAP = 11B
  - 132..142: IAT INJ = 11B
  - 143..153: MAP Motor = 11B
  - 154..164: CONFIG + AutoClutch + password = 11B
  - 165..182: Option = 18B
  - 183..204: ECT Motor = 22B
  - 205..237: ECT Start Add = 33B
  - 238..267: External Adjustment = 30B
  - total writable payload = **268B**.
- V10.2 ECT Motor belongs to A2, NOT page6.
- V10.2 ECT Motor mode from original `__IsMotorSolenoid()`: `InfoChk[3] || InfoChk[4]`, mapped to handshake feature bits 3/4.
- V10.2 partial writers opened on exact 268B read-modify-write baseline:
  - IAT INJ
  - MAP Idle Motor
  - ECT Idle Motor
  - External Adjustment
  - V-ECT
  - V-IAT
  - V-MAP
- Each partial writer:
  - requires a successful direct A2 read of at least 268B first,
  - sends exactly the first 268 writable bytes,
  - preserves every sibling/unknown block byte-for-byte,
  - requires ECU ACK + readback verification,
  - verifies any read-only/reply tail beyond 268B remains unchanged.
- Still preserved/not exposed for V10.2 in this pass: hidden TPS row, TPS/RPM axis writes, vAFR, CONFIG/AutoClutch/password edits, Option edits, ECT Start Add edits.
- Ultra remains on its separate conservative/read-only path and is explicitly rejected by the V10.2 A2 writer.
- Regression protection:
  - `tools/check-v10-a2.js`
  - `tools/check-v10-page6.js`
  - `tools/check-v92-page6.js` cross-family boundary check
  - CI run **37242896117** passed syntax + row orientation + 9.2 page6 + V10.2 page6 + V10.2 A2.
- Backup before A2 implementation: `backup-pb-3.79.41-pre-v10-a2-268`.
- Core A2 commit: `c2bc3ba9ad09a5c340b2b3068e7c69366f5f0d7c`.
- Feature-gate hardening: `9029136f9b72bc4dd3ea1b1ac286c09d95aa6642`.
- A2 regression checker: `c3e09c8ecc616dc53d261e8355d0c88a49a5f6a3`.
- CI wiring: `e952f76695c4b152d8515e092f5e18f5e5bfc7f0`.
- Final regression repairs: `560a24e1ef6cce7ab77fbacce0b4042db5689a2b`, `d02fbc23c269c61b11e97601b277eec0a085a96e`.
- PB bump: `bd3a6d80aecb327585dd99c237e0d8e897b8c5f2`.
- Hardware status: **NEEDS REAL V10.2 TEST**. Do not release-certify A2 writers until real V10.2 READ -> one small controlled change -> SAVE -> READBACK passes.


## V10.2 AutoClutch update - 2026-10-05

- PB: **3.79.43**.
- Original V10.2 evidence re-checked in `UartDat::programSpaceOut` and `proReadAutoClutchPassword`.
- CONFIG block remains 11B:
  - byte +0: feature/config flags
  - byte +1: AutoClutch Start RPM (raw × 50 RPM)
  - bytes +2..+6: five AutoClutch timer values (UI ms = raw × 5)
  - bytes +7..+10: four password nibbles
- Blink now exposes the existing 1×5 AutoClutch table for direct V10.2 only.
- V10.2 AutoClutch writer patches ONLY CONFIG bytes +2..+6 using `raw = round(ms / 5)`.
- It preserves CONFIG feature byte, Start RPM, password, all other A2 blocks, and any reply-only tail.
- Ultra is not broadened: direct V10.2 gate remains mandatory.
- Backup: `backup-pb-3.79.42-pre-v10-autoclutch`.
- Core commit: `ce130db5f97029083e2119daf0edd5464450bc5e`.
- Regression extension: `d32d0c807053cb4ddba404e1f8bdf7bbdcea533f`.
- CI run **37243092053** passed syntax + row orientation + 9.2 page6 + V10.2 page6 + V10.2 A2 checks.
- PB bump: `0e82911ebfcfb4e9ac56fcdfc770e10d0a6cc574`.
- Hardware status: **NEEDS REAL V10.2 TEST**. Do not release-certify until a real V10.2 timer cell change survives SAVE + READBACK.
- Next exact V10 task: reconstruct and expose V10.2 **ECT Start Add 3×11 / 33B** with its row-specific units; keep Option/TPS-axis writes locked until separately proven.


## V10.2 ECT Start Add update - 2026-10-05

- PB: **3.79.44**.
- Original V10.2 EXE was re-extracted from `Redleo ECU Pro Ver10.rar` and decompiled directly.
- Relevant original methods verified:
  - `Initialise_Res1::proResetDgvEctStrtAdd`
  - `OutProgramFile::proDgvUnit`
  - `Initialise_Dgv::Second_Or_200ms`
  - `UartDatRx::UartToDgv`
  - `UartDatRx::__StrtAdd_EcuPc`
  - `UartDatRx::proUartDgvNum`
- Original UI row labels for V10.2 `Dgv_EctStrt_Add` are exactly:
  1. `Time(Second)`
  2. `INJ VE(ms)`
  3. `StrtAdd(ms)`
- Original serializer uses **3 rows × 11 columns = 33 writable bytes**.
- `proUartDgvNum` writes rows in reverse UI order on wire:
  - wire 0..10 = UI row 2 `StrtAdd(ms)`
  - wire 11..21 = UI row 1 `INJ VE(ms)`
  - wire 22..32 = UI row 0 `Time(Second)`
- Original row scales:
  - `Time(Second)`: `Second_Or_200ms(value,0)` = raw `round(value × 5)`; writer enforces minimum raw 1; decoder = raw × 0.2 second.
  - `INJ VE(ms)` and `StrtAdd(ms)`: original Oil scale, same `Oil_PcToEcu(...,1)` / `Oil_EcuToPc(...,1)` path used elsewhere in V10.
- Blink implementation:
  - V10.2 A2 parser decodes ECT Start Add at bytes **205..237** using the exact 3×11 codec.
  - V10.2 UI now renders Start Add as **3×11** instead of reusing the V11 4×11 surface.
  - Writer patches only the ECT_START 33B block inside the canonical A2 **268B** read-modify-write payload.
  - ACK + post-write readback + reply-tail preservation remain mandatory.
  - Ultra has an explicit Start Add guard and does NOT use the V10.2 semantic/serializer path.
- Backup: `backup-pb-3.79.43-pre-v10-ectstart`.
- Core codec/writer commit: `67a72b2688dade7144435dc7825b52746040dca9`.
- UI 3x11 profile commit: `6b87c3e7dab430eeb76a672e0103489fee233c69`.
- Regression update: `307b71b4c6ea1b2d5a600fcd880e2cca2df150bc`.
- Workflow now also triggers on `index.html` profile-layout changes: `13271be44aa2a812a53869c0be788928de09b4c7`.
- PB bump: `2f12e6570f8dae669acda24182e0cf6e57ad4aaa`.
- Local/source validation after final patch: JS syntax parse PASS; A2 routing PASS; 33B decoder PASS; 33B encoder PASS; exact block patch PASS; UI 3×11 PASS; Ultra guard PASS.
- GitHub Actions final run **37259543263** completed **SUCCESS** after PB 3.79.44; syntax + row orientation + 9.2 page6 + V10.2 page6 + V10.2 A2/Start Add regression all passed. CI success is not a substitute for real V10.2 hardware certification.
- Hardware status: **NEEDS REAL V10.2 TEST**. Recommended test: change one Start Add cell slightly -> SAVE -> READBACK -> confirm only that displayed cell changes.
- Next V10.2 target after hardware test or further static proof: Option 18B semantics and/or controlled Start RPM handling; TPS/RPM axis writes remain locked.


## V10.2 Dgv_Option update - 2026-10-05

- PB: **3.79.45**.
- Backup before change: `backup-pb-3.79.44-pre-v10-option18`.
- Original V10.2 evidence was taken from the extracted **ECU Pro 10.2.exe** plus embedded **LNG_EN.txt**.
- Original `Dgv_Option` grid is 8 columns × 6 rows, but `proUartDgvNumOption` serializes only the 3 value columns, yielding **18 writable bytes**.
- Flattened wire/UI semantic indexes 0..14 verified from `LanguageSetup::OutLanguage`, `proOptionToProgram`, `proWrDgvOption`, `proUartDgvNumOption`, and `proEcuToDgvOption`:
  1. TPS Voltage (Min.)
  2. TPS Voltage (Max.)
  3. Idle minimum inj (cold)
  4. Idle minimum inj (Hot)
  5. Idle Auto Regulation IGN(±°)
  6. Idle Auto Regulation INJ(±ms)
  7. Total steps of idle motor
  8. Open fan temperature
  9. O2S working (cylinder temperature voltage)
  10. O2S delay work
  11. O2S working speed
  12. O2S adjusts fuel injection
  13. Start the injection RPM
  14. Idle Motor Maximum
  15. Idle Motor Minimum
- Bytes **15..17** of the 18B block have no label/unit assignment in the original English resource and are treated as reserved/unknown.
- Safety rule: Blink **never regenerates or zeroes bytes 15..17**. They are copied byte-for-byte from the direct A2 read baseline on every Option write.
- Verified V10.2 conversion rules implemented:
  - indexes 0,1,8: voltage quarter-scale, matching Blink `encVolt/decVolt`.
  - indexes 2,3,5: original Oil time conversion, matching `encOil/decOil`.
  - index 4: original centered IGN option path `Ign_PcToEcu(value,1)-64` / inverse `raw+64`.
  - indexes 6,13,14: raw = UI/2; decode = raw×2.
  - index 7: ECT temperature ↔ voltage curve using the live V10.2 vECT table.
  - index 9: 200ms units, raw = seconds×5; decode raw×0.2s.
  - indexes 10,12: RPM/50.
  - index 11: O2 fuel adjustment uses original **0..25%** scale, encode `round(128×value/25)` with 128 clamped to 127; decode `round(25×raw/128)`.
- Blink UI now exposes a direct-V10-only **1×15** `Dgv_Option` table. The generic menu card is named **Tuỳ chọn ECU** so V11 still uses its existing 1×20 ATE Options surface.
- V10.2 writer behavior:
  - requires a successful direct A2 read baseline of at least 268B,
  - edits only the Option block at A2 bytes **165..182**,
  - only semantic bytes 0..14 inside that block may change,
  - reserved bytes 15..17 remain raw-identical,
  - all sibling A2 blocks and any reply-only tail remain unchanged,
  - ECU ACK + post-write readback verification remains mandatory.
- Ultra protection:
  - `ate_options` is NOT added to the shared `MODERN_V10` base feature set,
  - it is enabled only through the current-session `isV10Direct()` dynamic gate,
  - Ultra has an explicit guard and cannot use the V10.2 Option codec/writer.
- Core protocol commit: `8d8786d3ceb3a4b594280a56b2d8f2200b23c251`.
- Dedicated V10.2 Option UI commit: `d19bdb08b3127e5ed10e7b066999690eaec62ce3`.
- Regression protection commit: `10f2901f9c7cb1146689144da5ff0e60a2272d0d`.
- PB bump: `b5fe9ca8dca331268057f66cf8fb7ad87f320d62`.
- Final GitHub Actions run **37260282172**: **SUCCESS** — syntax, row orientation, 9.2 page6, V10.2 page6 and V10.2 A2/Option checks all passed.
- Hardware status: **NEEDS REAL V10.2 TEST**. Recommended controlled test: change one low-risk Option cell slightly (for example fan temperature or Idle Motor Maximum), SAVE, READBACK, and confirm only that semantic cell changes while the reserved tail remains untouched.
- Next V10.2 static-analysis targets: controlled AutoClutch Start RPM handling and TPS/RPM axis write path. Do not open either without verifying the exact original write semantics and preservation requirements.


## Scope decision - AutoClutch on unfinished ECU families - 2026-10-05

- User decision: **do not spend further work implementing AutoClutch on ECU families where it has not already been reconstructed/implemented**.
- Keep already-implemented V10.2/V11 AutoClutch paths as-is.
- For unfinished families (including Ultra/V8/other unverified REDLEO variants), AutoClutch may remain hidden/locked and is no longer a required release-unlock target.
- Do not broaden an existing AutoClutch serializer across families.
- Continue priority work on core tuning maps / axes / verified options instead.


## V10.2 TPS/RPM axis update - 2026-10-05

- PB: **3.79.46**.
- Backup before axis work: `backup-pb-3.79.45-pre-v10-axis`.
- Original V10.2 methods re-checked from **ECU Pro 10.2.exe**:
  - `UartDatRx::proUartDgvNumVoltage`
  - `UartDatRx::__UartToDgvTps`
  - `OutProgramFile::proDgvUnit`
  - `macroReckon::proCheckTpsOption`
  - `macroReckon::proCheckRpmOption`
  - `macroReckon::VoltageToNumber`
- Exact A2 axis layout:
  - bytes **0..13** = TPS derived voltage row (14 × uint8)
  - bytes **14..27** = visible TPS percentage row (14 × uint8, raw = TPS% × 2)
  - bytes **28..87** = RPM axis (30 × uint16-BE, raw = RPM / 20)
- TPS axis rules reproduced from original software:
  - exactly 14 points
  - point 1 forced to **0%**
  - range **0..100%**
  - values below 10% normalized to **0.5%** steps
  - values from 10% upward normalized to **1%** steps
  - all points must be strictly increasing after normalization
  - the 14-byte voltage row is regenerated from V10.2 Dgv_Option TPS Voltage Min/Max using `V = Min + (Max-Min) × TPS% / 100`, rounded to 2 decimals, then encoded with the original voltage conversion.
- RPM axis rules reproduced from original software:
  - exactly 30 points
  - range **500..15000 RPM**
  - normalized to **20 RPM** steps
  - all points must be strictly increasing after normalization
  - wire encoding is 30 × uint16-BE of `RPM/20`.
- Blink implementation:
  - dedicated direct-V10-only editors: **TPS Axis 1×14** and **RPM Axis 1×30**.
  - TPS writer patches only A2 bytes 0..27.
  - RPM writer patches only A2 bytes 28..87.
  - every axis write still starts from the exact V10.2 **268B A2 read baseline**, sends the canonical 268B payload, preserves all sibling blocks and any reply-only tail, and requires ECU ACK + post-write readback.
  - after verified READBACK, Blink reparses A2 and republishes the ECU TPS/RPM axes so the visible main-map headers/rows follow the confirmed ECU values.
- Ultra protection:
  - `tps_axis` and `rpm_axis` are NOT present in the shared MODERN_V10 base feature set.
  - they are enabled only through current-session `isV10Direct()`.
  - Ultra has an explicit axis guard and cannot use the V10.2 axis writer.
- Core axis protocol commit: `065406317105757aeb83049d05c611fa67d8f026`.
- Axis UI commit: `e0d78f4b3c63d60fa60bed4c29ad2f0c015d4efd`.
- A2 regression extension: `27df398f3e01494fcdc4d06a001aa82737402816`.
- Cross-family checker hardening commits: `2e2339e68fd0b4758f39feff8d5c61e3e799f4e2`, `c5fbc3d146ac35183b877084e579bd2f0ea14d24`, `36f2065c73591eff0e7e886707dbce1aad47c4d5`.
- PB bump: `34be9e8b5859744e4e036364ebcd623d5fdf3895`.
- Final GitHub Actions run **37261463129**: **SUCCESS** — syntax, row orientation, REDLEO 9.2 page6, V10.2 page6 and V10.2 A2/axis regression all passed.
- Hardware status: **NEEDS REAL V10.2 TEST**. Recommended order:
  1. RPM axis first: change one middle breakpoint by +20 RPM while preserving order -> SAVE -> READBACK -> confirm only that breakpoint/header changes.
  2. TPS axis second: make one small legal middle-point change -> SAVE -> READBACK -> confirm displayed TPS breakpoint and map row update, with the associated derived voltage row changing consistently.
- AutoClutch scope reminder: per user decision, do NOT spend further work implementing AutoClutch on unfinished ECU families. Keep already-completed V10.2/V11 implementations only.


## Ultra Pro1 page6 implementation update - 2026-10-05

- PB: **3.79.47**.
- Backup before change: `backup-pb-3.79.46-pre-ultra-page6`.
- Original archive: `Redleo ECU Ultra Pro1(1).rar`; original executable extracted as `ECU Pro Ultra Pro1.exe`.
- Static IL/readback evidence confirms selected-bank page-family 6 ordering:
  1. `Dgv_Idle_Limit[bank]` through `proUartDgvNumOption`
  2. `Dgv_AutoShift[bank]` through `proUartDgvNum`
  3. `Dgv_Four_Spare[bank]` through `proUartDgvNum`
- Exact original writable dimensions:
  - Idle Limit: grid 4 rows × 3 transmitted values; each value uint16-BE = **24B**
  - AutoShift: 1 × 9 byte values = **9B**
  - Four-Spare: 1 × 9 byte values = **9B**
  - total selected-bank page6 writable payload = **42B**.
- Ultra Idle 24B = 12 uint16-BE values. Embedded original LNG_EN + IL provide labels/semantics for indexes 0..7:
  - 0 Idle Speed (Cold)
  - 1 Idle Speed (Hot)
  - 2 Enter (leave) idle sensitivity
  - 3 Maximum Speed
  - 4 Idle Return INJ (Cold)
  - 5 Idle Return INJ (Hot)
  - 6 Acceleration Setup Percentage
  - 7 VVT Open RPM
- Idle indexes **8..11 have no verified original labels** and are preserved byte-for-byte.
- Acceleration Setup Percentage conversion follows original percent path:
  - decode `round(raw × 50 / 64)`
  - encode `round(value × 64 / 50)`.
- Blink implementation:
  - adds explicit `isUltraDirect()` using handshake identity text containing `ULTRA`.
  - Ultra Idle READ requires at least 42B and splits exactly 24B Idle + 9B AutoShift + 9B Four-Spare.
  - only the first 8 Idle uint16 values can be modified.
  - bytes 16..23 (4 hidden Idle words), bytes 24..32 (AutoShift), bytes 33..41 (Four-Spare), and any reply-only tail are preserved.
  - writer sends exactly 42B using `writeWritablePrefixPage`, therefore ECU ACK + post-write readback + tail preservation are mandatory.
  - Ultra-only `VVT Open RPM` input is shown on the dedicated Idle screen.
  - co-located ECT Motor panel stays hidden on the Ultra Idle/page6 screen because Ultra ECT Motor belongs to the separate A2 editor; its A2 serializer is implemented from PB 3.79.48.
- AutoShift/Four-Spare remain read-preserved only; they are not editable.
- AutoClutch Ultra remains out of scope per user decision.
- Core protocol commit: `c504efa46189c0c07e19e475171f9e48619778b6`.
- UI commit: `2104785532ea2bea5f3cc0659193f0dc0a02462f`.
- Ultra regression checker: `b961c79a15608b8f62d96e1d990b6e429309a0c5`.
- CI wiring: `dbed8fc8e7441de0f7e2db9808fd2ea6c2e01afd`.
- Cross-family checker repair: `869ee7bc7a566ecac7b2d68aeb844b1fdebc2298`.
- PB bump: `263fa070af965e744502735e89d82841c4085821`.
- Final GitHub Actions run **37262145034**: **SUCCESS** — syntax, row orientation, REDLEO 9.2 page6, V10.2 page6, V10.2 A2 and Ultra page6 regression all passed.
- Hardware status: **NEEDS REAL ULTRA PRO1 TEST**. Recommended test: READ Idle -> change one low-risk known Idle value slightly -> SAVE -> READBACK -> verify only that semantic value changes; then optionally test VVT Open RPM separately.
- Ultra-specific A2 serializer was reconstructed in PB 3.79.48. Never reuse the V10.2 268B A2 layout; AutoClutch remains out of scope.


## Ultra Pro1 A2 implementation update - 2026-10-05

- PB: **3.79.48**.
- Backup before change: `backup-pb-3.79.47-pre-ultra-a2`.
- Original source: `Redleo ECU Ultra Pro1(1).rar` / extracted `ECU Pro Ultra Pro1.exe`.
- Relevant original methods re-checked include `proUartSendToEcu`, `proUartDgvNumVoltage`, `proUartDgvNumOption`, `programSpaceOut`, `PasswordPcToEcu`, TPS/RPM readback methods, and the common grid codecs.
- Original Ultra page A2 order and exact writable offsets:
  - 0..13: TPS derived voltage row = 14B
  - 14..27: visible TPS percentage row = 14B
  - 28..87: RPM axis = 30 × uint16-BE = 60B
  - 88..98: vAFR = 11B
  - 99..109: vECT = 11B
  - 110..120: vIAT = 11B
  - 121..131: vMAP = 11B
  - 132..142: IAT INJ = 11B
  - 143..153: MAP Idle Motor = 11B
  - 154..164: Ultra CONFIG = **feature flags 1B + Spare Built-in 6B + password 4B**
  - 165..182: Option = 18B
  - 183..204: ECT Motor = 22B
  - 205..237: ECT Start Add = 33B
  - 238..246: One-Spare = 9B
  - 247..276: External Adjustment = 30B
  - 277..284: CHG = 8B only when original firmware condition `myEcuVer > 10.2` is true.
- Therefore the exact Ultra writable A2 size is:
  - firmware **≤10.2: 277B**
  - firmware **>10.2: 285B**.
- If Blink cannot determine the exact Ultra 10.x minor firmware, **A2 write stays locked** rather than guessing 277B vs 285B.
- Critical family difference: Ultra bytes 154..164 are **NOT V10.2 AutoClutch**. They are feature flags + 6 Spare Built-in bytes + 4 password bytes. Never decode or patch them with the V10 AutoClutch codec.
- PB 3.79.48 adds `ULTRA_A2`, `ultraA2LayoutForSession()`, and `parseUltraA2Data()`; active Ultra reads no longer use the historical 140B prefix parser.
- Verified Ultra A2 editable surfaces now use exact 277/285B read-modify-write:
  - TPS Axis 1×14
  - RPM Axis 1×30
  - IAT INJ 1×11
  - MAP Idle Motor 1×11
  - ECT Motor **2×11**
  - ECT Start Add 3×11
  - External Adjustment 2×15
  - vECT 1×11
  - vIAT 1×11
  - vMAP 1×11.
- TPS axis uses the same original 14-point normalization and regenerates its 14B voltage row using Ultra Option raw TPS Min/Max bytes 0/1. Option itself is **not exposed for Ultra editing**.
- RPM axis remains 30 × uint16-BE with original 20-RPM unit rules.
- Ultra ECT Motor UI is corrected to **2×11** (Step/Time + INJ VE) and stays in the A2 editor, not the page6 Idle screen.
- Every Ultra A2 writer:
  - requires a successful A2 baseline matching the firmware-selected writable length,
  - copies the complete 277B/285B baseline,
  - patches only its verified block,
  - sends the exact canonical writable payload,
  - requires ECU ACK + post-write READBACK,
  - verifies any longer reply-only tail remains unchanged.
- Blocks intentionally preserved raw on all current Ultra A2 writes:
  - CONFIG 11B
  - Option 18B
  - One-Spare 9B
  - optional CHG 8B
  - vAFR 11B
  - every unrelated sibling block.
- AutoClutch Ultra remains out of scope per user decision. Do not infer it from the Ultra CONFIG block.
- Additional bug found/fixed during this pass: `cacheAckedPage(0xA2)` still parsed every `MODERN_V10` readback through the obsolete 140B parser. This could leave V10/Ultra sensor/axis cache semantically wrong even after a correct verified write. It now routes:
  - V10.2 -> `parseV10A2Data()` exact 268B layout
  - Ultra -> `parseUltraA2Data()` exact 277/285B layout
  - historical prefix parser only remains as a non-direct fallback.
- Core Ultra A2 commit: `045d69c666a274b6ca24738d8af51a93dc150926`.
- UI dimension/axis-label correction: `16dfb6afdabaf42c77a08a778fed75177e15e7d1`.
- Ultra A2 regression checker: `58f4432c1a6efc9ec1e6573d8800c68b7ba97d4b`.
- CI wiring: `bd53b5049dad02ca830c41c56be877d7cf3619f1`.
- V10/Ultra checker separation repairs: `6372a0faba029e54e3a3de3f2cc888bf3b68f8b3`, `51f8e3bb5529831f851119d41907e8243299bd3e`.
- Exact A2 ACK/readback cache parser fix: `aade9d4ee4cfc7f34a2f28a1b5493f0e84f65a1c`.
- Cache-parser regression guards: `425393f7be18a538334fd4671f5864cf92ceaf1a`, `aca45c279f686f7350c22c597ac4a28d1fa7ec1b`.
- PB bump: `c44e0416f83ed6788af5a685b44b7e897b61be93`.
- Final GitHub Actions run **37262942801**: **SUCCESS** — syntax, compensation orientation, REDLEO 9.2 page6, V10.2 page6, V10.2 A2, Ultra page6 and Ultra A2 checks all passed.
- Hardware status: **NEEDS REAL ULTRA PRO1 TEST** before release certification.
- Recommended real-hardware test order:
  1. READ A2 and note actual Ultra firmware/read length; Blink must select 277B or 285B consistently.
  2. Change one low-risk vIAT/vECT or IAT INJ point slightly -> SAVE -> READBACK.
  3. Test one ECT Motor cell, then one ECT Start cell.
  4. Change one middle RPM breakpoint by +20 RPM while preserving order -> SAVE -> READBACK.
  5. Finally make one small legal TPS breakpoint change and confirm the displayed TPS axis plus derived voltage row are consistent.
- Next family-level audit after Ultra: return to **REDLEO 9.1X** exact locked page6/full-write behavior, unless real Ultra hardware testing exposes a semantic mismatch first.

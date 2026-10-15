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
- Current displayed PB: **3.79.64**.
- REDLEO 9.2 page-0x62 has passed real-hardware ACK + readback and the user's controlled semantic test on PB 3.79.40. Treat the tested 9.2 page6 Idle/ECT Motor path as release-certified for that hardware; do not generalize it to other families.

## 1A. PB 3.79.64 injection-angle calculator - physical PW/RPM model

- PB 3.79.64 supersedes the PB 3.79.63 reference-curve-only strategy.
- Backup before this change: `backup-pb-3.79.63-pre-physical-cam-soi`.
- Main physical conversion is restored:
  - `pulseDeg = PW(ms) * RPM * 0.006`.
  - provisional REDLEO interpretation: `INJ degree` is SOI advance.
  - current EOI target is anchored at IVO, therefore `SOI = IVO + pulseDeg` in the displayed advance convention.
- Example regression anchors:
  - 8.0 ms @ 10,000 rpm = 480 crank degrees.
  - IVO 3 + 6.4 ms @ 5,000 rpm = 195 degrees.
  - IVO 3 + 7.0 ms @ 500 rpm = 24 degrees.
  - IVO 30 + 8.0 ms @ 10,000 rpm = 510 degrees before ECU-family encoding limits.
- The old fixed `INJ_CAM_STRATEGY_MAX=295` is removed from the physical calculation.
  - The user-supplied 3/31 curve remains only as a diagnostic comparison.
  - 295 degrees is NOT a universal physical ceiling.
  - Final output is limited/quantized only by the verified encoder domain for the connected ECU family (V11/Ultra Pro2 vs V8/V9/V10/Ultra Pro1).
- The old `durationScale`, `phaseAdjust`, and `base*durationScale+phaseAdjust` heuristic are removed from the active formula.
- IVC is still collected and used to report intake duration/center, but it does not currently inject an unverified EOI offset. Do not invent an IVC-based correction until there is stronger calibration or hardware evidence.
- Injector dead-time is NOT added separately because the ECU PW may already include voltage/dead-time compensation; adding it blindly risks double counting.
- Because the formula now needs actual PW, `ensureInjCamRequiredMaps()` is restored:
  - validates the active-bank fuel map,
  - auto-reads `inj_ve` when needed,
  - auto-reads `inj_degree` baseline when needed,
  - refuses calculation when fuel synchronization is unknown.
- APPLY remains local-only. The operator must still press GHI ECU separately.
- Critical unresolved hardware assumption:
  - we still have not scoped REDLEO CKP + injector to prove whether INJ degree is SOI or EOI and to prove the exact angular zero/direction.
  - keep this uncertainty visible in UI/docs.
  - when hardware becomes available, vary PW at fixed RPM and INJ degree: fixed leading edge => SOI; fixed trailing edge => EOI.
- Regression: `tools/check-injection-cam-calculator.js` now locks the physical formula, fuel preflight, no-295-cap behavior, and local-only apply safety.

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

- Original `ECU Pro 9.1X.exe` was re-audited against the stable 9.2/V11 safety model in PB 3.79.50.
- Exact selected-bank page6 writer from original software:
  - Idle/Limit = **9 × uint16-BE = 18B**
  - ECT Motor = **12B**
  - exact writable page6 = **30B**.
- ECT Motor original column #12 is labeled **SUM**. Blink exposes only the 11 physical ECT points and preserves SUM raw byte-for-byte.
- Exact A2 layout = **133B**:
  - TPS 14B
  - vAFR 11B
  - vECT 11B
  - vIAT 11B
  - vMAP 11B
  - IAT INJ 11B
  - MAP Motor 11B
  - CONFIG/AutoClutch/password 11B
  - Option 12B
  - External Adjustment 30B.
- Direct 9.1X RMW + ACK/readback is enabled only for verified blocks:
  - main tune angle/dwell
  - ECT INJ page 0x72
  - ECT IGN page 0x82
  - MAP INJ page 0x92
  - Idle/Limit
  - ECT Motor 11 visible ECT points
  - IAT INJ
  - MAP Idle Motor
  - External Adjustment
  - vECT / vIAT / vMAP.
- AutoClutch 9.1X is hidden/out of scope per user decision.
- Whole Option 12B write remains locked; Option/CONFIG/AutoClutch/password bytes are preserved raw by partial A2 writers.
- Full-write safety gate remains exact decoded READ ALL **9767B**. If READ ALL is not decoded 9767B, full-write stays locked.
- Do not reuse the 9.2 62B page6 serializer on 9.1X.
- Status: **STATIC-ANALYSIS IMPLEMENTED / NEED REAL 9.1X HARDWARE TEST** before release certification.

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

- Ultra executable is highly similar to V10 but its original writers differ materially; serializer gates remain separate.
- PB 3.79.47 reconstructed the selected-bank page6 writer as **42B = Idle 24B + AutoShift 9B + Four-Spare 9B**. Blink edits only the 8 labeled Idle values and preserves the remaining Idle words, AutoShift and Four-Spare raw.
- PB 3.79.48 reconstructed Ultra A2 independently:
  - **277B** for firmware ≤10.2.
  - **285B** for firmware >10.2 because CHG 8B is appended.
  - CONFIG 11B is feature flags + 6 Spare Built-in + 4 password, **not V10 AutoClutch**.
- Verified Ultra A2 edit surfaces are TPS axis, RPM axis, IAT INJ, MAP Idle Motor, ECT Motor 2×11, ECT Start 3×11, External Adjustment 2×15, vECT, vIAT and vMAP.
- Original Ultra Pro1 also verifies dedicated compensation pages **0x72 ECT INJ / 0x82 ECT IGN / 0x92 MAP INJ**. PB 3.79.50 enables their direct RMW writers with baseline + ACK + readback, matching the already-visible ECU editor cards.
- Option 18B, One-Spare 9B, CONFIG 11B, vAFR and optional CHG remain raw-preserved; Ultra AutoClutch stays out of scope.
- If exact Ultra firmware minor cannot be determined, A2 write remains locked rather than guessing 277B vs 285B.
- Ultra page6/A2 are **STATIC-ANALYSIS IMPLEMENTED / NEED REAL ULTRA HARDWARE TEST**. Do not release-certify until controlled SAVE + READBACK passes on a real Ultra ECU.
- Never reuse V10.2 268B A2 or REDLEO 9.2 62B page6 assumptions for Ultra.

## 8. V8 status

- Original `ECU Pro Ver 8.exe` main-tune writer/read paths were re-audited in PB 3.79.50.
- Blink V8 MAIN TUNE matches the original conversion/page rules:
  - Fuel/Oil Time: UI ms ↔ raw byte with **raw = ms × 20**, max 12.75 ms.
  - Injection Angle: original OilAngle transform.
  - Ignition Angle: **raw = degree × 4 + 64**.
  - Ignition Time/Dwell: original Oil true-time path using the 50/64 conversion.
  - ECU_MODE page-low routing remains mode-specific (mode1→2, mode4→1, multi-map modes→bank).
- Supported V8 editor surface intentionally remains **MAIN TUNE only**:
  - Injection VE / Fuel Time
  - Injection Angle
  - Ignition Angle
  - Ignition Time.
- All auxiliary writers (Options/Idle/ECT compensation/TPS Study/Password/Restore/full-write) remain hidden or restricted because their V8-specific layouts are not release targets.
- Regression `tools/check-v8-main.js` prevents a future V9/V10/V11 scale or feature surface from leaking into V8.
- Status: main tune is **STATIC ORIGINAL-SOFTWARE VERIFIED**; real V8 hardware testing is still required for release certification.

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
- 3.79.49 REDLEO Ultra Pro2 support: V11-generation detection, exact page6 43B + strict A2-286 routing, product-specific UI labels; AutoClutch hidden by scope decision
- 3.79.50 cross-family ECU I/O audit: 9.1X exact 30B page6 + 133B A2 RMW, V8 original main-tune regression, Ultra Pro1 compensation writers, cross-family feature-surface CI matrix

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
- Beta: 9.1X, V10.2, Ultra Pro1, **Ultra Pro2**, V8.
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


## REDLEO Ultra Pro2 implementation update - 2026-10-05

- PB: **3.79.49**.
- User-supplied original archive: `Redleo ECU Ultra Pro2.rar`.
- Extracted original PC executable analyzed: `ECU Pro 11.exe`.
- SHA256 of analyzed executable: `c41b8d987afa60ec9025e42d68c2b92a094c6a5f2afa2f52971411db568a49b4`.
- Original executable identity:
  - namespace / product generation: `tqmcu_ECU_V11`
  - assembly version: **11.1.7.0**
  - embedded product string: **Ultra Pro2**
  - original product selector reports **REDLEO=true**, **ATE=false**.
- Architectural conclusion: **Ultra Pro2 is a REDLEO-branded V11-generation ECU, not Ultra Pro1/V10**.
- Critical detection fix:
  - before PB 3.79.49, `profileFromHandshake()` checked generic `ULTRA` before firmware major and could misclassify Ultra Pro2 as MODERN_V10 / Ultra Pro1.
  - PB 3.79.49 recognizes explicit `ULTRA PRO2` or `ULTRA + firmware major 11` first and routes it to **MODERN_V11**.
  - generic Ultra / Ultra Pro1 remains MODERN_V10.
- Ultra Pro2 page-family 6 original writer matches V11 exactly:
  - Idle/Limit = **12B**
  - AutoShift = **9B** at offset 12
  - ECT Motor = **22B** at offset 21
  - total writable page6 = **43B**.
- Ultra Pro2 A2 original writer is **exactly the V11 A2-286 layout**:
  - 0..13 TPS voltage row = 14B
  - 14..27 TPS percentage row = 14B
  - 28..87 RPM axis = 60B
  - 88..98 vAFR = 11B
  - 99..109 vECT = 11B
  - 110..120 vIAT = 11B
  - 121..131 vMAP = 11B
  - 132..142 IAT INJ = 11B
  - 143..153 MAP Motor = 11B
  - 154..164 CONFIG/Dzfm/password = 11B
  - 165..194 Option = 30B
  - 195..238 ECT Start = 44B
  - 239..247 One-Spare / Global Aux = 9B
  - 248..277 External Adjustment = 30B
  - 278..285 CHG = 8B
  - total writable A2 = **286B**.
- Safety rule for Pro2: direct Ultra Pro2 sessions accept **only A2-286**. A 272B V11 page is not accepted as a Pro2 A2 baseline.
- Blink reuses the already reconstructed V11 serializers only where the Pro2 original EXE proves the byte layout is the same; it does **not** route Pro2 through Ultra Pro1 277/285B or V10.2 268B serializers.
- Current Pro2 V11 surfaces include the existing verified V11 feature set such as page6 Idle/AutoShift/ECT Motor, A2 Option/ECT Start/External/CHG/Alternate, sensor compensation and main tune.
- Per user scope decision, **AutoClutch is intentionally hidden/blocked for Ultra Pro2** even though the original Pro2 EXE contains the V11 `Dgv_Dzfm` structure. Do not spend further work on Pro2 AutoClutch unless the user explicitly changes scope.
- Full ReadAll / full-image safety:
  - current V11 full-image writer still requires exact decoded **9958B** through `v11FullImageReady()`.
  - Ultra Pro2 static analysis did **not** independently prove a different full-ReadAll length, so PB 3.79.49 does not loosen the 9958B gate.
  - if real Pro2 ReadAll does not decode to the verified 9958B layout, full-send remains safely locked.
- Product/UI identification:
  - ECU badge/status shows **ULTRA PRO2** rather than generic ATE.
  - editor descriptions use **REDLEO Ultra Pro2** for the Pro2 V11 variant.
  - Options editor title is **Tuỳ chọn REDLEO Ultra Pro2**.
- Backup before work: `backup-pb-3.79.48-pre-ultra-pro2`.
- Core detection/routing commit: `e3f52c7d315edc84d4915ac7547a7b97747cef59`.
- Pro2 regression checker: `3455d579014105bea3d79f3178f0ce57c4740c64`.
- CI wiring: `1e75e3a9053a5c7432a6e4f2c0eda80b18d4424a`.
- V10 cross-family checker adjustment: `65c594c7d63e3a8824bed5d0fe61b74894877cd9`.
- Pro2 checker repairs: `70c00cf5a2a259a063b3ecda7e59dd3336249909`, `916ee70bbfaa5c42ddc160b26365c6ec0b5fd3b7`.
- PB bump: `6ee1471d38ab48c5b054c625afa155537413e5e6`.
- Variant state/UI labels: `1ecd8322a0c0464306595da31de72ed9633f4009`, `0822274e1d706bfeabfeebe818814c84f8122aba`.
- UI-label regression protection: `521a232a412211d847da3dad9c0c716b13eaf6e9`.
- Final GitHub Actions run **37264169593**: **SUCCESS** — syntax, compensation orientation, REDLEO 9.2, V10.2 page6/A2, Ultra Pro1 page6/A2 and Ultra Pro2 regression all passed.
- Hardware status: **NEEDS REAL ULTRA PRO2 TEST** before release certification.
- Recommended first real-hardware test order:
  1. connect and verify badge/profile reads **ULTRA PRO2**, not Ultra Pro1/V10 or ATE;
  2. open an A2-backed table and confirm the direct A2 read is **286B**;
  3. make one small low-risk vECT/vIAT or IAT INJ change -> SAVE -> READBACK;
  4. test one page6 Idle value -> SAVE -> READBACK;
  5. then test ECT Motor / ECT Start / Option / CHG one block at a time;
  6. test READ ALL; full-send must remain locked unless exact 9958B decoding succeeds.


## Cross-family ECU editor I/O audit - PB 3.79.50 - 2026-10-05

- Audit reference/golden behavior: user-tested REDLEO 9.2 and ATE V11.1 plus their original PC software.
- Audit rule used for every remaining family: original page/command -> READ region -> exact writable/TX region -> cell order/scale -> hidden/reserved preservation -> ACK -> post-write readback -> UI feature routing.
- Backup before this audit: `backup-pb-3.79.49-pre-v91-v8-audit`.
- Findings/fixes:
  - **REDLEO 9.1X**: old safety state was incomplete. Original software proves page6 **30B = Idle 18B + ECT Motor 12B** and A2 **133B**. Blink now uses direct baseline RMW + ACK/readback for the verified 9.1X blocks. ECT Motor SUM byte stays raw-preserved. Whole Options write and AutoClutch stay locked/hidden.
  - **REDLEO V8**: no scale/page bug found in the four exposed MAIN TUNE surfaces. Fuel, angle, ignition and dwell conversions match the original V8 software. Auxiliary V8 surfaces remain hidden rather than borrowing newer serializers.
  - **V10.2**: existing exact page6 18B + A2 268B + Option/Start/axes gates remain intact; no cross-family regression found.
  - **Ultra Pro1**: original software confirms compensation pages 0x72/0x82/0x92. The cards were already visible but their writer was not direct-enabled; PB 3.79.50 fixes this by routing them through the same verified baseline + ACK/readback page writer. Ultra Pro1 Option/CONFIG/One-Spare/CHG remain raw-preserved/locked as previously documented.
  - **Ultra Pro2**: V11-286/page6-43 detection and serializers remain intact. Shared ECU control labels were made variant-aware so Pro2 no longer shows ATE wording for A2 read, map subtitle or TPS Study.
- New regression layers:
  - `tools/check-v91.js`: exact 9.1X page6/A2/compensation/lock invariants.
  - `tools/check-v8-main.js`: original V8 MAIN TUNE page/scale/feature-surface invariants.
  - `tools/check-ecu-feature-surfaces.js`: cross-family matrix that verifies visible ECU cards, direct page routing, writer readiness, real READ/WRITE button capture, and anti-fallback boundaries.
  - Existing 9.2/V10/Ultra/Pro2 regressions continue to run in the same CI job.
- Important design result: a feature is no longer considered safe merely because its card exists. WRITE readiness requires **verified family feature + exact page route + successful page baseline in cache**. Unsupported features are hidden/locked.
- Final CI after PB bump: GitHub Actions run **37266795473 = SUCCESS**. It passed syntax, row orientation, ECU feature-surface matrix, V8, 9.1X, 9.2, V10.2, Ultra Pro1 page6/A2 and Ultra Pro2 checks.
- Hardware certification status after this audit:
  - REDLEO 9.2: hardware-certified on tested ECU for the previously controlled page6 tests; use as golden reference.
  - ATE V11.1: user-tested/golden reference.
  - 9.1X: static original-software verified; **needs real ECU test**.
  - V8: exposed MAIN TUNE static original-software verified; **needs real ECU test**.
  - V10.2: static serializer verified; **needs real ECU test**.
  - Ultra Pro1: static serializer verified; **needs real ECU test**.
  - Ultra Pro2: static V11-286 serializer verified; **needs real ECU test**.
- Do not describe the untested families as “99% hardware stable” until controlled real-hardware READ -> one-cell change -> SAVE -> READBACK tests pass.


## V9 firmware-generation routing safety fix - PB 3.79.51 - 2026-10-05

- Follow-up audit after PB 3.79.50 found a real family-routing hazard in the shared V9 detector.
- REDLEO handshake exposes firmware in only **4 ASCII bytes** (`parseHandshake(): ascii(a,17,4)`). Real V9 strings can therefore appear as forms such as `9.12` / `9.20`.
- Previous `firmwareNumbers()` parsed the entire decimal suffix as a numeric minor:
  - `9.12` -> minor `12`;
  - `usesNewThermalAxis()` checked `minor >= 2`;
  - therefore a 9.1X firmware such as `9.12` could be misrouted into the **9.2+** page6/A2 serializer family.
- PB 3.79.51 fix:
  - added `v9GenerationDigit()`;
  - for V9 family routing, only the **first digit after the decimal point** selects generation: `9.1x -> generation 1`, `9.2x -> generation 2`;
  - `isV91Direct()` now requires explicit V9 generation digit `1`;
  - `usesNewThermalAxis()` treats V9 as 9.2+ only when generation digit is `>=2`;
  - V10/V11 version handling is unchanged.
- Extra safety gate:
  - a decoded **9767B** ReadAll is no longer sufficient by itself to authorize generic V9 full-write;
  - `profileCap('fullWrite')` now also requires a positively recognized **9.1X or 9.2+** generation.
  - malformed/unknown V9 firmware remains readable where safe but cannot fall through to a generic full-image writer.
- Regression protection:
  - new `tools/check-v9-version-routing.js`;
  - representative cases include `9.10`, `9.12`, `9.19`, `9.20`, `9.21`, and `9.2`;
  - `tools/check-v91.js` updated for the new generation detector;
  - `.github/workflows/check-redleo-protocol.yml` now runs the V9 routing regression.
- Backup before change: `backup-pb-3.79.50-pre-v9-version-classifier`.
- Core fix commit: `c563f0693cc8a0fccd3800e7da9114c81e7cafa1`.
- Regression commits: `60a3bbf4ab9842ca8086e801c3d86bc088b6b328`, `7a1a15fb1d571941e924f7881f38a55ffa83f0b0`, `dba9c30254cf87feba10a885a472c5af7db09b4d`, `71f7794765dc230133927956c20f93eae8953d22`.
- PB bump commit: `cece84670b1af23bf2e7e1da23dfd7468656f848`.
- Hardware meaning:
  - this is primarily a **prevent-wrong-family-write** fix;
  - it does not claim new hardware certification for 9.1X or 9.2;
  - REDLEO 9.2 tested hardware remains the golden reference, while 9.1X still needs a controlled real-ECU READ -> one-cell edit -> SAVE -> READBACK test.

- Final CI for PB 3.79.51: GitHub Actions run **37268197492 = SUCCESS**. Syntax + row orientation + ECU feature matrix + V8 + V9 routing + 9.1X + 9.2 + V10.2 + Ultra Pro1 + Ultra Pro2 regressions all passed.


## Two-corner rectangular map selection - PB 3.79.52 - 2026-10-05

- User requested keeping the existing drag/scan selection while adding a mobile-friendly two-corner rectangular selection mode.
- Main fuel/target map behavior when QUÉT is OFF:
  - first tap selects corner #1 and shows a prompt to tap the opposite corner;
  - second tap outside the current highlighted cell/range completes the rectangle;
  - corner order does not matter (top-left/bottom-right or reverse both work);
  - tapping any cell already inside the highlighted selection cancels the whole selection;
  - tapping outside a completed selection starts a new corner #1.
- Existing QUÉT CHỌN remains available:
  - drag behavior is preserved;
  - a simple tap on an already-highlighted region while scan mode is ON cancels selection;
  - dragging from that region still starts a new scan and does not accidentally cancel after movement.
- Applied the same selection UX to REDLEO multi-cell feature editors:
  - two-corner rectangle when QUÉT is OFF;
  - tap selected cell to cancel;
  - scan drag remains available;
  - keypad / +/- / AFR ON-OFF operations now require an active red-map selection instead of silently operating on the default 0,0 cell.
- Removed the older duplicate touch pointerdown selector so one physical tap cannot be processed twice.
- Selection state now explicitly tracks pending first-corner vs completed rectangle.
- Backup before change: `backup-pb-3.79.51-pre-two-corner-selection`.
- Core implementation commit: `38469824d2c1026d9f505ece3e2d486ce1fe48fc`.
- Protocol CI run **37306927432**: **SUCCESS**. Syntax plus all existing ECU family regressions passed; this UI change did not broaden any ECU protocol writer.


## Top-left-first two-corner selection - PB 3.79.53 - 2026-10-05

- User changed the two-corner selection rule: reverse-order corner selection is no longer allowed.
- QUÉT drag mode remains unchanged.
- When QUÉT is OFF:
  - first tap is always treated as the **top-left origin**;
  - second tap must satisfy row >= origin row AND column >= origin column;
  - if the second tap is above or left of the origin, Blink keeps the first corner and shows: `Góc 2 phải nằm bên phải / phía dưới góc 1`;
  - same-row and same-column ranges remain valid as long as the second point is not above/left;
  - tapping inside the currently highlighted selection still cancels the selection.
- Applied to both:
  - main fuel/target map;
  - REDLEO multi-cell feature editors.
- Backup: `backup-pb-3.79.52-pre-top-left-selection`.
- Core implementation commit: `42c6460bf1dd4ac2745b3c057bdaf5f922c27829`.
- Regression: `tools/check-map-selection.js` added and wired into protocol CI.


## Tap selected rectangle -> single cell - PB 3.79.54 - 2026-10-05

- User refined the selection UX again: after a rectangle has already been selected (by drag/QUÉT or two-corner mode), tapping any cell must immediately leave **only that cell selected**.
- Previous PB 3.79.52/53 behavior that cleared the selection when tapping inside the highlighted rectangle is superseded.
- New behavior:
  - tap any cell inside an existing highlighted rectangle -> selection collapses to exactly that cell in one tap;
  - in two-corner mode, that cell also becomes the new corner #1 so the next valid lower-right tap can form a new rectangle;
  - in QUÉT mode, a simple tap leaves exactly one selected cell;
  - dragging in QUÉT mode still creates a rectangle normally.
- Top-left-first rule from PB 3.79.53 remains unchanged for two-corner mode.
- Applied to main fuel/target maps and REDLEO multi-cell editors.
- Backup: `backup-pb-3.79.53-pre-tap-collapse-to-cell`.
- Core implementation commit: `5602f07d7c9b54b21440d2c6590e5df1301cb7c3`.
- `tools/check-map-selection.js` updated so regression now requires one-tap collapse-to-cell instead of tap-to-cancel.

- Final CI for PB 3.79.54: GitHub Actions run **37307497978 = SUCCESS**. Selection regression plus all ECU family regressions passed.


## Free single-cell navigation with top-left rectangle rule - PB 3.79.55 - 2026-10-05

- UX correction after PB 3.79.54:
  - top-left-first must constrain only rectangle creation;
  - it must never block moving a single-cell selection around the map.
- New behavior:
  - if current corner/origin is at a lower-right cell and user taps a cell above or left, Blink immediately moves the single selected cell to the new tap;
  - that new cell becomes the new corner #1;
  - no reverse rectangle is created;
  - the next tap can create a rectangle only if it is at/right and at/below the new origin.
- Existing behavior remains:
  - tapping inside an already selected rectangle collapses directly to that single cell;
  - QUÉT drag still works normally.
- Applied to main fuel/target maps and REDLEO multi-cell editors.
- Backup: `backup-pb-3.79.54-pre-anchor-relocate`.
- Core commit: `175ff604e2164b8b64bc47db303b83cf87449f62`.
- Regression update: `b62c89cd79ca371da34648b43d0b7ff9d678bbf4`.
- Final CI run **37308785976 = SUCCESS**.


## All-map keypad / floating controls + small-map single-cell UX - PB 3.79.56 - 2026-10-05

- User requested that simple/short tables such as **IGN Time / Dwell 1×30** must not use two-corner or scan selection.
- User also requested numeric keypad and floating **SAVE / + / -** controls on every editable ECU map, not only large 420-cell editors.
- New editor capability split:
  - **redValueEditor** = every REDLEO value-table editor except the dedicated fuel editor; gets numeric keypad + floating save/+/-.
  - **redRangeEditor** = dense 2D maps only: rows > 1, cols > 1, total cells >= 100; gets QUÉT + two-corner selection.
- Consequences:
  - 14×30 and 11×30 maps keep QUÉT / two-corner rectangle selection.
  - 1×30 Dwell, 1×11 sensor/IAT tables, 2×15 External Adjustment, 4×11 ECT Start, 2×11 ECT Motor, Options, AutoShift, axes, etc. use **single-cell tap only**.
  - simple-table tap always selects exactly one cell; no pending corner state is created.
  - keypad and floating `↓ / + / -` remain available on those simple tables.
- `openFeature()` now resets scan state on every editor transition so scan mode from a large map cannot leak into a small table.
- The legacy Idle/Limit editor is a special screen outside `redleoEditorScreen`; its ECT Motor row now also has:
  - direct single-cell selection;
  - floating save/+/-;
  - numeric keypad;
  - floating save routes to the existing verified `idleLimitWriteBtn` writer.
- Backup before this work: `backup-pb-3.79.55-pre-editor-controls-all-maps`.
- Main all-map controls commit: `b9f64248f26814dfe64ba06b8f58c15aa8728c6c`.
- Legacy Idle ECT controls commit: `d350ed7d6143187c829dcf404c00d03a4df7b509`.
- Regression protection extended in `tools/check-map-selection.js` by commits `b4c064dc83e1e1f8a3c90535c2653aabc7f55de3` and `56dac9997835f89233424b5cfd830482af6fe1e5`.

- Final CI for PB 3.79.56: GitHub Actions run **37309555962 = SUCCESS**. Map-selection/editor-control regression plus all ECU family regressions passed.


## Corrected hardware finding: Ultra Pro1/Ultra Pro2 software share only partial current-page compatibility with REDLEO 9.2 - 2026-10-05

- Real-hardware findings on the tested REDLEO **9.2 ECU**:
  - original **Ultra Pro2 PC software** can **Đọc hiện tại / Lưu hiện tại** on the specific main maps the user tested: **map phun xăng, map đánh lửa, góc đánh lửa**;
  - original **Ultra Pro1 PC software** can also **Đọc hiện tại** on the 9.2 ECU in a similar way.
- Scope discipline:
  - Ultra Pro1 is currently confirmed here only for **Đọc hiện tại**; do not assume Ultra Pro1 Lưu hiện tại / Đọc tất cả / Ghi tất cả until separately hardware-tested;
  - Ultra Pro2 **Đọc tất cả** is wrong;
  - Ultra Pro2 **Ghi/Lưu tất cả** is wrong.
- Interpretation: multiple REDLEO generations likely reuse some **current-page read/write commands or page serializers**, especially for main tune pages, while their full-image layouts and auxiliary pages diverge.
- This is NOT evidence of complete backward compatibility, one common serializer, or safe cross-family restore/full-write behavior.
- Important existing wire differences remain:
  - REDLEO 9.2 page6 uses the verified **62B writable layout**;
  - Ultra Pro1 has its own verified V10/Ultra page6/A2 layouts;
  - Ultra Pro2 / V11-generation uses its own **43B page6 / A2-286** path.
- Blink must keep 9.2, Ultra Pro1 and Ultra Pro2 full-image/auxiliary serializers strictly separated.
- Original Ultra Pro1/Ultra Pro2 software may be used as **limited references for only the hardware-verified current-page operations** above. Do not use either app as a 9.2 full-image reference without a matching real-hardware pass.
- Future reverse engineering should compare the shared current-page command path across 9.2 / Ultra Pro1 / Ultra Pro2, then identify exactly where each application diverges for auxiliary pages and full-image operations.

## Original ECU Air fuel ratio split from Blink AFR target - PB 3.79.57 - 2026-10-05

- User requirement: every supported ECU generation must expose **two separate AFR concepts**:
  - **AFR mục tiêu của Blink**: lives only inside Blink Auto Tune and is used by Blink's own tuning algorithm.
  - **Air fuel ratio**: original ECU auto-tuner/AFR table, lives under **Bản đồ**, keeps original ECU semantics, and has ON/OFF per cell.
- Source evidence:
  - Original Ultra Pro1 software screenshot shows an **Air fuel ratio** table with OFF/ON control.
  - DN multi-generation APK independently confirms the original target-AFR table across ECU systems:
    - table/page family = **0x5x**;
    - payload = **420 bytes = 14×30**;
    - ON cell wire byte = AFR×10 in range **90..180**;
    - OFF cell toggles bit **0x80**; decoder restores the hidden AFR with **raw XOR 0x80**, then /10.
- Blink implementation:
  - afr_map is now visible for **V8, V9.x, V10/Ultra Pro1, V11/Ultra Pro2**.
  - Direct read uses 0x9A + page(5,bank) and requires 420 data bytes.
  - Direct write uses cached page baseline + exact 420-byte payload + ECU ACK + post-write readback verification.
  - Canonical Read All now decodes and publishes the original ECU Air fuel ratio instead of preserving it only as hidden raw bytes.
  - Legacy/modern SEND ALL now carries edited Air fuel ratio values + ON/OFF state instead of always preserving afRaw unchanged.
  - V11/Ultra Pro2 continues using the same proven 420B codec, now through the generic cross-family implementation.
- UI:
  - Bản đồ card/title is now exactly **Air fuel ratio**, subtitle **Auto tuner zin của ECU**.
  - Auto Tune labels are explicit: **AFR ĐO (BLINK)** / **AFR MỤC TIÊU (BLINK)**.
  - OFF cells use original-style dark display with **-**, while the hidden numeric AFR remains preserved in data-value so turning the cell ON restores the target.
  - ON/OFF controls now appear for Air fuel ratio on every supported ECU profile.
- Compatibility:
  - protocol accepts both old source label Air fuel ratio map and new Air fuel ratio.
  - old blinkV11AfrMeta remains as a compatibility alias; new generic state is blinkEcuAfrMeta.
- Backup before change: backup-pb-3.79.56-pre-all-ecu-air-fuel-ratio.
- Main protocol commit: 8b4a5e0c30929e2631a54eed520d9ddb6788e388.
- Alias fix: f2218b43718fa7117a86b7ddabdd3a5c8a9f2078.
- UI / naming commit: 4c7d85daf1d2dae6d9447afbf5c8a0f7ef1c52a1.
- Source-label routing commit: d8170d7ec6c1bed3b9969f910ae69f433b7ef99c.
- Regression updates: bb5f04a7e07db45316a55b7a19aa682aca11a4c6, 68dba9e4a87d6a763a439f90e7330ac3418a7d9c, 3d9189f3e3a7656263ebfa445a542dbf9586c7af, f395c1f3a4796c2e5c08342b1de3cbe763ac07de.
- Final CI run **37324845570 = SUCCESS**. All protocol regressions passed.

## Adaptive injection-angle calculator from cam closing angle - PB 3.79.58 - 2026-10-05

- Added directly inside the **INJ degree / Góc phun** editor.
- Working convention explicitly chosen by the user for this calculator:
  - 0° = compression TDC;
  - larger INJ degree = injection starts earlier before TDC.
- Inputs:
  - intake valve closing angle **IVC in degrees ABDC**;
  - desired injection end margin in degrees **before IVC**.
- Formula per TPS × RPM cell:
  - EOI target BTDC = 180 - IVC_ABDC + margin;
  - injection duration deg = PW_ms × RPM × 0.006;
  - SOI recommendation = EOI target + injection duration deg.
- The calculator uses the current **INJ VE / fuel-time map from the same MAP bank** for PW.
- Family-adaptive quantization:
  - V8 / V9.x / V10 / Ultra Pro1: legacy ~720° domain, round-tripped through the original OilAngle conversion, max displayed ~717°;
  - V11 / Ultra Pro2: ~360° domain, round-tripped through the V11 main injection-angle conversion, max 360°.
- Safety behavior:
  - requires a valid current fuel map;
  - rejects fuel maps latched as unknown after a failed write;
  - requires a valid existing INJ degree baseline before calculation;
  - PW <= 0 cells are preserved unchanged;
  - preview shows changed/skipped/clamped counts and sample 100% TPS values;
  - **APPLY only changes the local INJ degree map**; ECU is not written until the operator separately presses GHI ECU.
- UI button: **TÍNH GÓC PHUN THEO GÓC CAM**.
- Backup: backup-pb-3.79.57-pre-injection-cam-calculator.
- Main implementation commit: 1f7c56f98c64432434a5982e098074a843535db5.
- Regression commit: 228ee45b7dca6f10c62c2110c8b33ccef814f531.
- CI wiring commit: 44dc4a5fd6734fb992323a5d58510750540673f0.
- Final CI run **37332812725 = SUCCESS**. All 17 checks passed.

## IVO/IVC cam model + built-in keypad - PB 3.79.59 - 2026-10-05

- Replaced the PB 3.79.58 manual IVC + EOI-margin UI with exactly two cam inputs:
  - IN OPEN / IVO in degrees BTDC;
  - IN CLOSE / IVC in degrees ABDC.
- Blink computes intake duration automatically: 180 + IVO + IVC.
- The EOI safety margin is no longer entered by the user. Current heuristic is 5% of intake duration, clamped to 8–20 degrees.
- Per-cell injection timing still uses the current fuel PW map and RPM:
  - EOI target = 180 - IVC + automatic margin;
  - injection duration deg = PW(ms) × RPM × 0.006;
  - SOI recommendation = EOI + injection duration deg.
- Angle quantization remains family adaptive:
  - V8 / V9.x / V10 / Ultra Pro1: legacy ~720-degree domain;
  - V11 / Ultra Pro2: ~360-degree domain.
- Mobile input requirement:
  - IVO and IVC inputs are readonly text inputs with inputmode=none;
  - tapping a field does not open iOS/Android keyboard;
  - values are entered only through the built-in numeric keypad inside the dialog;
  - keypad includes digits, decimal point, clear, backspace, next-field and done.
- Safety remains unchanged: requires valid fuel and injection-angle baselines, preview first, APPLY only edits local map, separate GHI ECU is still required.
- Backup: backup-pb-3.79.58-pre-ivo-ivc-cam-model.
- Main implementation commit: 99af73c6ace25a764d38991e1f72290ae64b5211.
- Regression update: 2276a858d49af1031538f898055619583649cc17.
- Final CI run **37334627131 = SUCCESS**.

## Cam calculator action-button runtime fix - PB 3.79.60 - 2026-10-05

- Fixed user-reported issue where **TÍNH THỬ** / **ÁP DỤNG VÀO MAP** appeared silent.
- Root UX problem: APPLY was physically disabled until preview succeeded, so taps could produce no feedback; dialog errors could also be less visible than expected.
- New behavior:
  - APPLY is always clickable; before a valid preview it shows an in-dialog message explaining that TÍNH THỬ is required;
  - TÍNH THỬ immediately writes `Đang tính MAP góc phun...` into the dialog;
  - calculation failures are shown directly inside the cam dialog, including missing fuel map / unknown fuel state / missing baseline;
  - preview/apply handlers were renamed and explicitly wired to avoid ambiguous global/id naming;
  - action buttons use type=button and touch-action=manipulation for mobile reliability.
- No change to the IVO/IVC model, angle-family quantization, or ECU writer.
- Backup: backup-pb-3.79.59-pre-cam-dialog-button-fix.
- Main fix commit: 7de4cdb9499b086c7f74cef3ebd9d842d75c0192.
- Regression update: 883cee7f150ab71d4d738c26490cf834e3880aef.
- Final CI run **37335952882 = SUCCESS**. All 17 protocol/UI checks passed.

## Cam calculator auto-reads required ECU maps - PB 3.79.61 - 2026-10-05

- Fixed user case where TÍNH THỬ reported MAP fuel row 1 / col 1 empty while the operator was already inside the INJ degree editor.
- Root cause: the calculator depended on `state.inject` for the same bank, but that fuel map may not have been read yet in the current session.
- New behavior:
  - TÍNH THỬ now runs an async preflight;
  - if the current bank fuel map is missing/invalid/unknown, Blink automatically calls the real-protocol current fuel reader for that same MAP bank;
  - if the INJ degree baseline is missing, Blink automatically reads the INJ degree page for the same MAP bank;
  - progress is shown inside the cam dialog: checking data -> auto-reading fuel / angle -> calculating;
  - duplicate TÍNH THỬ taps are ignored while the preflight/read is already running;
  - after successful auto-read, normal IVO/IVC calculation continues;
  - if ECU is disconnected or auto-read fails, the dialog explains the failure instead of asking the user to manually visit another map first.
- No change to the IVO/IVC formula, family angle quantization, or explicit GHI ECU requirement.
- Backup: backup-pb-3.79.60-pre-cam-auto-read-required-maps.
- Main implementation commit: 4ab234da28da1152a63b7c691dbc822e2d89937f.
- Regression updates: 70e2a509d14fdb282a0a554cb76aecb60e561c4f and dfa98763433fe758db17fd959cd6ee803caf2580.
- Final CI run **37338194002 = SUCCESS**. All 17 checks passed.

## Corrected cam-phase model after 3/31 test - PB 3.79.62 - 2026-10-05

- User tested IVO=3 BTDC / IVC=31 ABDC and observed clearly over-advanced output (e.g. ~177° at 500 rpm).
- Root cause: PB 3.79.61 treated IVC as an absolute BTDC EOI anchor, creating an artificial ~160° base offset across the map.
- This was inconsistent with the original REDLEO 9.2 INJ degree map supplied by the user, where low-rpm values are near zero.
- Corrected heuristic:
  - intake duration = 180 + IVO + IVC;
  - target EOI phase = 5% into the intake-open window, clamped to 8–20° after IVO;
  - EOI relative to TDC = target phase after IVO - IVO;
  - injection duration deg = PW(ms) × RPM × 0.006;
  - recommended SOI advance = max(0, injection duration deg - EOI_ATDC).
- For IVO=3 / IVC=31: duration=214°, target EOI phase=11° after IVO, so EOI≈8° ATDC. There is no longer a +160° base offset.
- Existing auto-read preflight, virtual keypad, family-specific quantization, local-only APPLY, and explicit GHI ECU safety remain unchanged.
- Backup: backup-pb-3.79.61-pre-correct-cam-phase-model.
- Main implementation commit: 8c87a08d6bcfc9263e7508d00ade20d8e94439d9.
- Regression update: 5853aa04794661ef056a774e7e0d53ba65558731.
- Final CI run **37338924774 = SUCCESS**. All 17 checks passed.

## Cam calculator calibrated to 3/31 REDLEO reference curve - PB 3.79.63 - 2026-10-05

- User provided the expected INJ degree table for cam **IVO 3 / IVC 31** and reported the prior model producing impossible values such as ~523° at 100% / 15000 rpm.
- Root cause: previous cam models incorrectly tied strategy output to PW and/or the ECU's raw 720° encoding domain. The encoding range is not the desired tuning range.
- New strategy model:
  - the user-provided 3/31 TPS×RPM table is the reference calibration;
  - strategic INJ degree is hard-limited to **0–295°**;
  - 3/31 reproduces key reference anchors such as 100%/500=24°, 100%/3500=138°, 100%/5000=195°, 100%/7500=291°, 100%/15000=295°, IDLE/15000=208°;
  - the curve is piecewise interpolated by TPS row and RPM;
  - IVO/IVC values other than 3/31 make conservative adjustments using intake duration and intake center, bounded to avoid extreme outputs.
- Important architecture change:
  - cam strategy no longer depends on the current INJ VE / fuel-time map;
  - no automatic fuel-map read is required for cam calculation;
  - ECU 720°/360° domains are treated only as writer/encoding details, not as the strategy maximum.
- APPLY still edits only the local INJ degree table; the operator must explicitly press GHI ECU.
- Backup: backup-pb-3.79.62-pre-cam-reference-curve.
- Main implementation commit: 524415d2572af73ba191cd5920411498e09962d9.
- Regression commit: af4bfc06a2c97eb07945581997f751ebc619739a.
- Final CI run **37340103880 = SUCCESS**. All 17 checks passed.


## Live ECT/IAT A2 cache · P.b 3.79.66
- ECT/IAT/MAP live from frame 0xA1 require sensor voltage-relation calibration (vEct/vIat/vMap).
- After handshake, Blink now restores cached calibration for the exact ECU identity (profile + ident + firmware + ecuId).
- If no cache exists and profile supports Options/Voltage, Blink schedules one background A2 read after live settles (~0.9s). readA2SensorPageReal() pauses 0x69 safely, validates A2, then resumes live.
- Successful A2 calibration is persisted in localStorage under BLINK_SENSOR_CAL_V1, keeping up to 8 ECU identities.
- V8 is intentionally excluded from automatic A2 warmup because its Options/Voltage layout is still not verified safe.
- No automatic READ ALL was added. No ESP32 firmware change is required.
- Protocol commit: 6a6967230ef75e749a76f025d91a56c978725894
- PB bump: 6db5f64f55ca90616f0bb16f6c2ca166de190324
- Regression test stale PB assertion fixed in a5c13214f2265a217e7a13d0d036450016ab1693.
- Check REDLEO Protocol JS run 37652761144: SUCCESS.


## ESP32 FW 2.1 · redundant two-pass Read All BLE stream · 2026-10-09

- Ported the proven QH FW2.1 large-frame transport hardening into Blink-Redleo.
- ECU command flow is unchanged: Read All still sends ECU command 0xAB only once and keeps the returned 8-10 KB image in ESP32 RAM.
- For negotiated jumbo BLE and responses >= 8000 bytes, ESP32 now sends the same offset-addressed RAW_RX frame in two BLE passes:
  - pass 1 sends every chunk except the final END chunk;
  - wait 70 ms;
  - pass 2 sends the whole frame again and includes END.
- Browser/app reassembly already de-duplicates repeated offsets, so a chunk lost in pass 1 can be filled by pass 2 without a second ECU transaction.
- START is repeated on each pass; END is emitted only on the final pass so the app cannot resolve Read All before redundancy has completed.
- Existing FW2.0 pacing remains: >=8 KB jumbo streams use 14 ms packet pacing, yield every 4 packets, and 24 ms jumbo yield pauses.
- Existing app-side Read All stall watchdog + one automatic full retry remain unchanged as an additional fallback.
- Firmware version advanced from 2.0 to 2.1. OTA workflow now publishes manifest version 2.1 and builds the matching binary.
- No BLE UUID, RAW E1/E2 packet format, ECU UART command, map write format, OTA transport contract, or protocol JS change was made.
- Pre-change backup branch: backup-blink-fw20-pre-qh-fw21-readall-20261009.


## ESP32 FW 2.2 · ECU UART pins moved to RX22 / TX23 · 2026-10-09

- Blink classic ESP32 ECU UART default pins changed from RX26 / TX33 to RX22 / TX23.
- UART electrical/protocol settings remain 38400 baud, 8E2; only the default GPIO routing changed.
- FW2.1 two-pass redundant Read All BLE transport remains unchanged.
- BLE UUIDs, RAW E1/E2 framing, OTA protocol, ECU commands, map formats, and protocol JS remain unchanged.
- Firmware version advanced from 2.1 to 2.2 so devices already on 2.1 can detect and install the pin-routing update through OTA.
- OTA workflow now publishes manifest version 2.2 and the matching binary.
- Source filename still contains GPIO26_33 for repository/workflow compatibility; the active compiled defaults inside the source are RX22 / TX23.
- Pre-change backup branch: backup-blink-fw21-rx26-tx33-pre-rx22-tx23-20261009.


## PB 3.79.78 · BLE connected but ECU not authenticated = MAP tiles silently disabled (2026-10-13)

User report: After public FW2.3 + Blink PB3.79.76, tapping every ECU MAP tile is silent even though the app reports "BLE connected." Reverting the PB3.79.77 AFR-target-keypad UI back to 3.79.76 did NOT resolve it.

Actual source analysis:
- `index.html` `connectBle()` called `setBleUi(true)`, which previously set `state.ecuPhase='live'` and displayed **"ECU ĐÃ KẾT NỐI · OK"** immediately after *GATT* linking, before `redleo_real_protocol.js` received valid ECU 0x5A. This is a false-positive success label.
- `redleo_real_protocol.js` `applyProfileUi()` strictly disables every `[data-feature]` when the current profile is UNKNOWN; the browser ignores taps on a disabled HTML button. This correctly prevents unsafe operations but used to be silent about the BLE-vs-ECU distinction.
- Original `boot()` attempted `initializeRealSession()` only ONCE per BLE characteristic lifetime (after 450ms). If 0x5A/0x69 failed once, there was no retry unless the user disconnected/reconnected.
- PB3.79.76 `connectBle()` published `window.blinkCommandChar` and `window.blinkMapChar` to the real ECU protocol *before* finishing bridge `PING`, `RXJUMBO`, desktop TX probes, and the newly-added FW2.3 `RG?`. The real protocol could start a raw 0x5A GATT write concurrently with bridge control writes on that SAME characteristic. This plausible race is mitigated by finishing bridge probe writes BEFORE publishing the characteristics to the REAL layer.
- FW2.3 autonomous guard itself only enters `guardAutonomousTick()` when `guardEnabled` NVS is true (default OFF). If the user has enabled Guard, its autonomous UART 0x5A/0x9A/0x69 activity might still compete with the initial app handshake despite `processTransaction` priority; this hardware explanation has NOT been verified on real ECU. Do not claim FW2.3 is conclusively responsible.

PB3.79.78 hotfix changes:
- `setBleUi(true)` sets `ecuPhase='ble-linked'`, **not** `live`. Status explicitly says Bluetooth connected, waiting for real ECU 0x5A.
- Finish PING/RX/TX bridge setup BEFORE publishing raw BLE characteristics; move automatic RG? out of this competing startup period (manual Settings button still works).
- After transport is available, attempt REAL ECU 0x5A -> profile detection; up to 3 bounded attempts on errors with delays; show error details and a manual "↻ XÁC THỰC LẠI ECU" control on the MAP page.
- Keep `setProfileDisabled(el,!supported,...)` and ALL ECU read/write gates unchanged. UNKNOWN/LEGACY profiles do NOT unlock any ECU MAP. Valid but unsupported ECU profile stays SAFE MODE without retry spam.
- `tools/check-ecu-auth-unlock.js` asserts no premature success, correct bridge-probe ordering, safe profile gate, and a mocked real ECU handshake-failure -> manual recovery flow.
- `index.html` and `redleo_real_protocol.js` changed; ESP32 OTA FW2.3 and manifest unchanged.
- `feature/debug-map-nav-pb37977-20261013` is a discarded diagnostic branch that allows offline previews. **DO NOT MERGE** it: requirement is to unlock only after ECU identity verification.
- If a customer stays blocked in PB3.79.78, record text shown in MAP auth banner and Settings > ECU diagnostic status, and ask them to read `RG?` to see whether guard is on. Test same hardware with the existing "Khôi phục FW2.2" BLE control *while engine OFF* to isolate FW2.3 vs UART wiring/profile.


## 2026-10-13 · Restore entire firmware/ folder to FW 2.2 (user request)

- Production ECU authentication error persisted at 0x5A with ESP32 FW 2.3. Owner requested the GitHub `firmware/` folder be put back to FW 2.2, in addition to the already restored public OTA.
- `firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino` is now **byte-for-byte the original FW2.2 source blob** `a2c9724b9aff9c8d0b69cdce84b395254bcb717e` from commit `efb101e67f80da252b81b7f03931ab357fec4778`.
- Removed `firmware/redline_guard_core.h`; the `firmware/` directory contains **one self-contained INO only**. The experimental FW2.3 sources remain preserved in the Git history and on branch `backup-fw23-firmware-source-before-restore-fw22-20261013`.
- Removed the FW2.3-only CI workflow and C++ redline tests from active main. The standard ESP32 build compiles the one INO file with **no header dependency**, uploads a FW2.2 build artifact, and does not automatically change the OTA binary or manifest. Publishing an OTA from CI requires explicitly choosing the `publish_ota` checkbox in manual workflow dispatch.
- Production `ota/blink_esp32.bin` is already the original FW2.2 blob `b5bb40eea95a55e951a6668cc41085b6fecf586c`, and `ota/manifest.json` is pinned to FW 2.2 / SHA256 `ce18b7d20e6cee223bda4f29b2932d9d236f3f2181fbc209a740015ebda25c8e`. Never reinstate FW2.3 from an archived workflow or test branch without hardware validation.
- The public Blink web UI is still PB3.79.78 with handshake-status diagnostics and FW2.2 recovery option, not the earlier PB3.79.72 UI. Restoring code on GitHub **does not remotely flash ESP32 modules already running FW2.3**; use the explicit BLE FW2.2 restore control with engine off.


## 2026-10-13 · Blink PB3.79.79 AFR target keypad RELEASED; FW2.4 OTA HELD FOR HARDWARE TEST

- Production Blink main index.html PB3.79.79 released at commit d8841c9b37e0f256ff469bd43e4689640be75ee3: supports a custom virtual keypad for Blink-only AFR Target, target-only save button, floating +/- and multi-cell selection. AFR Target changes save in Blink localStorage; they DO NOT send ECU write commands. User can edit in software landscape as in the fuel keypad.
- FW2.4 candidate remains on branch feature/blink-fw24-autopin-redline5s-20261013; draft PR #5. It is single-file Arduino INO, UART autoselect known 22/23 and 26/33 pairs + NVS persistence, and opt-in autonomous 5-second guard. Redline guard stays OFF for fresh NVS installs.
- Lab automated pure-C++ tests, Blink UI contract assertions and Arduino compile passed on prior FW2.4 commits; latest branch CI should be checked before flashing any device.
- IMPORTANT: prior FW2.3 experimental release broke ECU 0x5A authentication for customers. FW2.4 has NOT yet been verified with a physical ECU on both wiring layouts and has NOT been published to customer OTA. Production firmware/ and ota/manifest.json remain FW2.2. Do not use public OTA as substitute for a real ECU 0x5A/Read All/MAP4 bench test.
- Candidate handoff: FW24_AUTOPIN_REDLINE_LAB_HANDOFF.md in branch; PR: https://github.com/letan99vl/Blink-Redleo/pull/5

## 2026-10-13 · FW2.4 PUBLISHED to public OTA; Blink PB3.79.80 no FW2.2 rollback

**This supersedes the earlier 2026-10-13 status "FW2.4 OTA HELD FOR HARDWARE TEST".** The owner expressly requested public FW2.4 release and removal of the FW2.2 downgrade UI.

- MAIN release source commit: `2719c1a5fbdd280a7b5a40f4f4f5ba1e84f37a78`, `firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino` reports `FW_VERSION "2.4"`.
- GitHub Actions build / public OTA publish: run `38392942724` SUCCESS; OTA commit `f2e043e5467d3827977300fcf9b254302287a28f`.
- Live manifest: `ota/manifest.json` version **2.4**; URL raw main `ota/blink_esp32.bin`; SHA-256 **`00c779dcabab06d90fa559a61fc8280e6d17593d19d74423696ba7f6ea404358`**. The Actions build artifact was independently extracted and its BIN SHA-256 matched the published manifest.
- FW2.4 supports **auto ECU UART RX22/TX23 or RX26/TX33**, learns matching UART pair from checksum-verified 0x5A/0xA1 read response, remembers slot in ESP32 NVS `blinkuart/slot`, and keeps the pair fixed after a valid confirmation while running.
- The opt-in **5-second Redline Guard** is available from PB3.79.80, default OFF on fresh NVS. In supported V9.1x/V9.2x ECUs it reads RPM limit, requests MAP4 on a qualifying near-limit window and independently verifies map index. Old 0x5A regressions from FW2.3 are NOT proven resolved on a physical ECU yet. Real boards and MAP4 switching need controlled bench tests. Do not use the 5-second mode as the ECU rev limiter on public roads.
- Blink UI `index.html` is **PB3.79.80**. It keeps PB3.79.79 Blink AFR Target virtual keypad / floating +/- and local-only save; removes the `KHÔI PHỤC FW 2.2` button, `LAST_GOOD_FW22`, `otaRollbackToFW22` and event listeners; guard controls now require FW>=2.4. OTA installation blocks active Auto Tune and measured RPM >200, with explicit engine-off confirmation.
- Historical FW2.2 source/BIN remains in Git history for emergency recovery using USB when the engine is fully stopped; do not re-add the app rollback UI unless the owner requests it.
- Regression CI `Check REDLEO Protocol JS` passed after fixing an outdated test-only PB3.79.78 literal in `tools/check-ecu-auth-unlock.js`; production 0x5A profile safety gates and auth retry behavior were not bypassed.
- Workflow `.github/workflows/build-esp32-firmware.yml` publishes only on explicit `[RELEASE_FW24]` main push or approved manual dispatch. Routine pushes do not republish OTA.
- Detailed release/hardware testing instructions: `FW24_AUTOPIN_REDLINE_LAB_HANDOFF.md` on main.

## 2026-10-13 · PB3.79.81 Redline Guard GATT collision repair (web/JS only)

- Customer screenshot showed `RG:ERROR GATT operation already in progress.` with FW2.4 actually installed. This error is a host Web Bluetooth GATT collision, NOT an ECU UART busy reply, NOT a verified Guard OFF/ON state.
- Root cause: `guardControlCommand('RG?')` called `commandChar.writeValueWithResponse` while real REDLEO `rawExchange` / Live 0x69 could already be using the same BLE link. `busy` only protected concurrent RAW exchanges, not Redline Guard control writes.
- PB3.79.81 `index.html`: one-click in-flight guard mutex, disables control buttons during action, calls `window.BlinkRealProtocol.beginBridgeGuardControl()` before touching GATT, bounded up to four attempts for only idempotent `RG?`/`RGON`/`RGOFF` when browser explicitly reports GATT in progress. Post-enable/disable `RG?` verifies status; only actual notification `RG:...` may establish ON/OFF/TRIP. On terminal error UI says BLE GATT unavailable rather than presenting false ECU guard state. OTA GUI temporarily disabled while guard control active.
- `redleo_real_protocol.js`: `bridgeControlReserved` gate blocks new `rawExchange` and Live 0x69, waits for ongoing RAW/manual MAP read/write and initial ECU 0x5A handshake to finish before the guard BLE control, then restores Live. Old-session leases cannot unlock a newer BLE connection. It does not alter physical ECU UART or NVS guard logic.
- New regression test `tools/check-redline-gatt-lock.js` extracts actual JS functions and verifies simultaneous Live and `RG?`, blocking pending RAW, priority for manual map write and 0x5A authentication, bounded GATT retry, duplicate taps and cleanup after failed write. `Check REDLEO Protocol JS` GitHub Actions additionally runs `tools/test-fw24-ui.js`.
- **Firmware OTA and manifest remain FW2.4**, with previously verified SHA256 `00c779dcabab06d90fa559a61fc8280e6d17593d19d74423696ba7f6ea404358`; customers should reload Blink to pick up PB3.79.81, NO ESP32 reflash needed. This is software-level validation; end-to-end phone + real ECU test still recommended.

## 2026-10-13 · Key ON, motor OFF still yields RG:STOP in FW2.4; FW2.5 bench candidate

- Customer physically confirms ignition switch ON but engine has **never been started**, yet Redline Guard RGON reports `RG:STOP` despite ESP32 FW2.4 and corrected Web BLE GATT queue. This is **not evidence the motor is running**.
- Code cause in public FW2.4: CommandCallbacks rejects RGON unless an existing checksum-valid 0xA1 Live RPM sample is <=700ms old and stationary for >=1000ms. But ESP32's autonomous `guardAutonomousTick()` returns immediately when `guardEnabled == false`, so it never proactively samples RPM before enabling. The ECU may also refuse live 0x69 responses at key-on before crank.
- Candidate lab FW2.5 + Blink PB3.79.82: draft [PR #6](https://github.com/letan99vl/Blink-Redleo/pull/6), branch `feature/blink-fw25-keyon-safe-guard-arm-20261013`. RGON queues a main-loop stationary/ECU identity check; after fresh supported V9.1x/9.2x 0x5A, ESP32 polls 0x69 of the **actual current map** and requires 3 checksum-valid RPM=0 samples over >=1 second with <=700ms gaps. Motion/missing 0x5A/missing RPM fail closed with distinct RG: statuses, NVS remains OFF. This neither bypasses engine-stopped safety nor weakens 5000ms MAP4 switching verification. Single-file .ino remains intact.
- Test run `38398502568` PASS core simulations, firmware UI static checks, Arduino ESP32 compile; built ZIP (lab only) with .ino/.bin and SHA-256. **Not yet tested with physical ECU**.
- **Public OTA is STILL FW2.4; public Blink is PB3.79.81.** Do not publish FW2.5 or mark this issue solved on all hardware unless a real engine-off ECU reports valid RPM 0 and the 2.5 hardware bench test succeeds. If the ECU doesn't emit A1 frames before crank, RG:NORPM must be treated as an unsatisfied safety precondition, never automatically treated as 0.


## 2026-10-13 · PUBLIC OTA FW2.5 and Blink PB3.79.82 RELEASED (supersedes FW2.4 OTA and FW2.5 lab-only note)

- Owner requested immediate FW2.5 public OTA. Release source commit: `1cb701ea52c5dfc79b9fa47b91c33b7744b0ce56`. GitHub Actions build and release run `38399914538`: all steps PASS including extracted C++ stationary proof, 5000ms redline/auto-pin tests, Blink UI safety contract and classic ESP32 Arduino compilation.
- GitHub Actions rebase/published OTA commit on main: `20986ac256882dcd84da74538b6e321b0b82dbbe`. Public `ota/manifest.json` version **2.5**, points at `ota/blink_esp32.bin`. SHA256 **`98d86910015085f837158b50b1a2804c3f307eab1bcd5b710c206d0b7f9e01b3`**. Independent extraction + SHA256 of build artifact `BLINK_FW25_BUILD` (artifact ID 11814643500) exactly matches the public manifest.
- Main `index.html` PB**3.79.82**, GitHub Pages deployment for this revision succeeded. Exposes FW2.5 statuses RG:CHECK, RG:NORPM, RG:NOECU, RG:RUNNING, RG:UNSUP, RG:OTA, plus original RG:OFF/WAIT/READING/ON/TRIP/FAULT.
- Firmware 2.5 replaces FW2.4 immediate (and frequently false) RG:STOP when key ON, engine never started, with a main-loop autonomous arming check. RGON verifies CURRENT ECU 0x5A identity (supported REDLEO V9.1x/V9.2x) and then >=3 checksum-valid ECU Live 0xA1 samples with **RPM exactly 0** spanning >=1000ms (samples gaps <=700ms). Only then sets `guardEnabled=true` and persists NVS. Missing RPM or ECU stays OFF (fail closed); do not remove this gate just to force-enable guard.
- Keeps original FW2.4 5000ms near-limit guard, verified switch to MAP4, UART auto-pair RX22/TX23 vs RX26/TX33 remembered in NVS, BLE/RAW OTA and no in-app rollback FW2.2.
- The workflow `.github/workflows/build-esp32-firmware.yml` now requires FW2.5 and explicit `[RELEASE_FW25]` commit marker or manual `publish_ota`; it does not release automatically on generic pushes. Note any next release must update both workflow version guard and tag.
- The separate `Check REDLEO Protocol JS` CI passed after fixing its version-pinned test-only GATT lock assertion; production BLE GATT mutex is unchanged from PB3.79.81.
- **Real ECU bench acceptance still pending**. Prior FW2.3 caused 0x5A failures, and the ECU may return no Live RPM=0 while key ON stationary. Do not claim real hardware protection is proven until actual 0x5A, 0RPM arming, long-page Read All, persistent NVS, and MAP4 read-back pass on both UART wiring variants with the motor stopped. A missing 0RPM signal must remain RG:NORPM rather than guessing 0.
- Candidate test provenance: draft PR #6 branch `feature/blink-fw25-keyon-safe-guard-arm-20261013`; release was applied directly to main to retain later handoff updates, so do not merge PR again. Historical FW2.4 and FW2.2 remain in Git history for stopped-engine USB recovery if needed.

## 2026-10-13 · FW2.6 branch lab: ECU V10.3 RG:READING permanent loop / multi-family guard

- Customer confirmed REDLEO 10.3 Redline Guard after FW2.5 reports "ĐANG ĐỌC GIỚI HẠN RPM MAP 4" indefinitely. Cause: autonomous FW2.5 guard only accepts 9.1x/9.2x 0x9A page6 checksum frames (33,65,66B), while Blink's verified app page6 layouts are V10.x 18B, Ultra Pro1 42B, V9.1 30B, V9.2 62B. FW2.5 also persisted guard ON before full 4 MAP limit verification, masking incomplete protection.
- **Candidate source FW2.6 is LAB ONLY**, branch `feature/blink-fw26-multifamily-guard-20261013`, draft PR [#7](https://github.com/letan99vl/Blink-Redleo/pull/7). UI branch PB3.79.83, public Blink PB3.79.82 and public OTA FW2.5 **unchanged**.
- Firmware recognizes checksum-valid 0x5A V9.1x,V9.2x,V10.x (10.3), Ultra Pro1 (ID=ULTRA), with guarded 0x9A page6 reply lengths 33,65/66,21/22,45/46 respectively; maxSpeed offset 5 for V9/V10 and 7 for Ultra. For V8, V11, Ultra Pro2, legacy unknown it **does not attempt MAP4** and reports RG:UNSUP; V8 sometimes single map; V11 has 4x3 byte Idle/Limit with unclear RPM threshold semantics.
- Five read attempts per missing MAP limit (at >=1150ms intervals); then `RG:LIMITERR:M1..4`, force `guardEnabled=false` + NVS OFF, stop re-reads. Identity check after reboot bounded at 6 attempts; never claim RG:ON without every page6 valid.
- RGON: verify supported ECU identity, all 4 limits, then >=3 fresh RPM0 0xA1 samples across >=1000ms, THEN persist guard. MAP4 still must be confirmed by a fresh 0x5A with same family+ECU ID+firmware. FW2.6 migration resets previous FW2.5 NVS guard-enabled state to OFF once; rearm explicitly for new profile.
- GitHub Actions FW2.6 lab run `38417222156`: **PASS** actual C++ parser fixtures for V9/V10/Ultra/unsupported, 5s timer, Blink JS UI contract and ESP32 Arduino compiler. Lab ZIP artifact `BLINK_FW26_MULTIFAMILY_GUARD_LAB` (artifact ID `11824913279`). CI only builds, NEVER releases OTA. All samples are software fixtures, not captures from real ECU.
- To complete V10.3 acceptance: key ON motor OFF, compare real 0x5A ECU 10.3 identification plus page6 0x62/64/66/68 replies against Blink direct Idle/Limit maxSpeed for each bank. Confirm RGON waits for all four valid pages and fresh RPM0 before RG:ON. Independently verify MAP4 switching only in stationary controlled bench and never test sustained limiter on road. If any real V10.3 reply length differs from 21/22 with complete checksum, adjust only its model-specific decoder after raw frame evidence.
- See `FW26_MULTIFAMILY_GUARD_LAB_HANDOFF.md` on candidate branch. Do not promote V11/V8 to supported by guessing limit bytes or assuming 0x69 MAP4 exists.


## 2026-10-14 · OWNER-REQUESTED WEB APP ROLLBACK TO PRE-5S BLINK PB3.79.72

- **ACTIVE APP on `main` is restored PB3.79.72**. Owner explicitly requested the complete app version before the first Redline Guard 5-second controls, to troubleshoot failed Ultra Pro1 0x5A authentication even after ESP32 downgrade.
- Restoration commit: `3f4ef9453c228274db84fa7e6258677e1f0c94e6`. Three original blobs restored atomically from historical commit `efb101e67f80`:
  - `index.html` exact SHA `78ee2331155bb122b3fc6e660dcd03964ae1511b`, PB3.79.72; **no RG?/RGON/RGOFF UI**.
  - `redleo_real_protocol.js` exact SHA `0795b33b407d164497c8a36c50be123b8b778001`.
  - `.github/workflows/check-redleo-protocol.yml` exact SHA `982ee0d65bcdb44d15464123a57d5f223f2d9fd7` to match the pre-guard app contract.
- Pre-rollback full main snapshot is preserved as branch **`backup-blink-pb37982-before-pre5s-rollback-20261014`** from commit `ced0d5627cf226efc2e390fda9cfc6c211c7b4d4`. It contains PB3.79.82 and its later BLE/auth fixes and local AFR Target keypad. All discarded UI features can be compared or restored from that branch.
- **ESP32 firmware source and public OTA binary+manifest were NOT touched. Public OTA still FW2.5.** Do not assume the OTA was downgraded because the browser UI version is now 3.79.72.
- Notable behavior differences: PB3.79.72 predates PB3.79.78 ECU-auth-before-map-access banner and GATT probe-order fix; the old UI can show Bluetooth connected before a real 0x5A ECU auth. It also predates PB3.79.79 AFR Target virtual keypad and PB3.79.81 GATT mutex for Guard. This is intentional for exact historical regression testing, NOT a claim old app is more secure or correct on all ECUs.
- **Safety: a FW2.5 ESP32 with Redline Guard already enabled in NVS can continue autonomous MAP4 switching after this app rollback**, because the earlier app cannot show or send RG? or RGOFF. To disable it, while the engine is stopped, use compatible controls on a separate verified utility/app revision or properly flash firmware that does not run Guard; never assume removing the app button turns off the MCU safety mode. If a unit is FW2.2, it has no active guard loop.
- Real Ultra Pro1 0x5A auth should be retested with confirmed UART pin pair and actual firmware version under ignition ON and engine not running; old app showing BLE OK is NOT proof of ECU authentication.
- GitHub Actions `Check REDLEO Protocol JS` run `38519092824` PASSED on restored historical files. GitHub Pages should deploy PB3.79.72; refresh/reopen clients to load historical HTML and JS. The native iOS IPA binary was not repackaged in this rollback; the remote content changes are only visible in clients which load GitHub-hosted web assets.

## 2026-10-14 · Temporary HOLD on ESP32 firmware server OTA (user requested)

- Reason: owner is troubleshooting Ultra Pro1 ECU authentication on ESP32 FW2.2 with historical Blink PB3.79.72 and requested to temporarily block 'update server' so customers cannot unintentionally upgrade back to FW2.5.
- **ACTIVE GitHub Pages app is still PB3.79.72 pre-5s.** The original `redleo_real_protocol.js` blob remains EXACTLY unchanged (`0795b33b407d164497c8a36c50be123b8b778001`). `index.html` includes an OTA-only hotfix marker `BLINK_OTA_HOLD_REVISION = '2026-10-14'` and `BLINK_SERVER_OTA_PAUSED=true`. Display PB number stays `3.79.72` to preserve old protocol and CI regression contract.
- In Settings > Firmware, server OTA is visibly labeled 'TẠM KHÓA': SCAN WI-FI / CHECK FIRMWARE / INSTALL all disabled. Hard guards block JS `writeOtaCommand` for all commands other than cancel, `writeBleFirmwareChunk`, `transferFirmwareBle`, `otaCheck`, `otaInstall`, `fetchOtaManifestWeb` and previous OTA notification from re-enabling install. BLE `0x5A` and read/write MAP paths were NOT modified.
- **Server `ota/manifest.json` now uses `version:"0.0.0"`, `ota_enabled:false`, `maintenance:true`**. The version downgrade in the *manifest* deliberately makes legacy firmware that ignores `ota_enabled` report NO UPDATE for every normal released FW1.x/FW2.x; it is NOT a firmware downgrade on any chip. Existing `url` and SHA256 of the FW2.5 application BIN are intact, so no rebuild is needed to re-open updates.
- Backed up the entire `main` snapshot before the hold: `backup-blink-fw25-manifest-before-ota-pause-20261014` at commit `891e179e8440509db7a60ee8f731763c860f81ad`. This backup contains the exact original manifest v2.5, unmodified pre-5s PB3.79.72 HTML and the corresponding workflow.
- New `tools/check-ota-server-pause.js` regression verifies manifest semantics for legacy FW1.8–FW2.6, disabled buttons, blocked JS BLE/Wi-Fi update paths, unchanged 0x5A parser and syntax. It's wired to `.github/workflows/check-redleo-protocol.yml`, whose run `38520674696` PASSED; the prior test-run failures during OTA-only version suffix experiment were fixed by keeping version exactly PB3.79.72.
- Public `firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino` remains FW2.5; `ota/blink_esp32.bin` bytes were not touched. Existing ECUs and ESP32 retain existing firmware and maps.
- **Important limitation**: cached older OTA manifests in CDNs or already-loaded iOS/Android pages, previously prepared on-device `otaAvailableVersion`, or manual third-party OTA packets may still be able to initiate an update until caches/old sessions are cleared. This is a normal app/server publication HOLD, not a cryptographic revocation or hardware-wide forced OTA disable. To guarantee an individual lab device stays at FW2.2, don't press update on any old cached UI; disconnect Wi-Fi/Internet during bench tests, and verify FW with PONG.
- **To resume updates** at owner's explicit request: restore `ota/manifest.json` fields from the backup (version 2.5 with original binary URL/SHA256, remove maintenance flag or set enabled true); set `BLINK_SERVER_OTA_PAUSED=false` in `index.html`; re-enable three OTA buttons and restore UI labels/hints, then update the OTA hold regression checks and ensure CI/Pages deploy PASS. NEVER accidentally restore PB3.79.82/5s UI unless specifically requested.

## 2026-10-14 · PB3.79.72 pre-5s + AFR target keypad restoration (AFR-KP1)

- Owner noticed that rolling Blink back to its actual pre-5s PB3.79.72 removed the virtual keypad for **AFR MỤC TIÊU (BLINK)**, which was first added on PB3.79.79 (historical commit `d8841c9b37e0f256ff469bd43e4689640be75ee3`). This was a real functionality loss in the earlier whole-app rollback.
- New **ACTIVE** app preserves `BLINK_PB_VERSION = '3.79.72'`, pre-5s behavior/no RGON/RGOFF, and **`BLINK_AFR_TARGET_KEYPAD_REVISION = 'AFR-KP1'`**. Dashboard version label now displays `P.b v3.79.72 · AFR-KP1` to distinguish the backport. Other historical pre-guard code retained.
- Surgical `index.html` backport from PB3.79.79: target-only keypad CSS (including portrait/fullscreen and software landscape), keyboard toggle for target tab, `afrTargetKeypadSave` and `afrTargetLocalSaveBtn` buttons, safe `saveTargetAfrLocal()` (Blink localStorage ONLY), target-tab styling on `setTab`, `beginEdit` opens virtual keypad for target, floating +/- pad visible on target, floating Save routes target -> `saveTargetAfrLocal()` and injection -> pre-existing ECU save, model-aware `selectedFuelMeta` and `applyFuelKeypadLive` keeps `state.target` separate from `state.inject` (AFR 0..30, 2 decimals; fuel retains existing ms codec).
- Guard safety: Target editing/saving blocked while 3-run mode active. Target local Save does NOT call ECU RAW or `writeMapBtn`. Existing ECU original `afr_map` remains separate from Blink AFR target.
- **`redleo_real_protocol.js` unchanged exact historical blob SHA `0795b33b407d164497c8a36c50be123b8b778001`**; no firmware or BLE transport changes. **OTA SERVER HOLD remains ACTIVE**: manifest `version:"0.0.0"`, `ota_enabled:false`; `index.html` `BLINK_SERVER_OTA_PAUSED=true`, OTA buttons/packets disabled.
- Safety backup before this patch: branch `backup-blink-pb37972-ota-hold-pre-afrkeypad-20261014` from `8ad891762aaa66dc24fbd88c9b9601b5c690e2dc`.
- New `tools/check-afr-target-keypad-backport.js`: real-function JS VM dynamic exercises target multi-cell input/limits, separate INJ VE behavior, 3-run lock, local-only Save, tab switching, UI markers and OTA hold. CI workflow `.github/workflows/check-redleo-protocol.yml` includes this test. **CI run `38536165180` PASS**, including the new test, OTA hold, and original V8/V9/V10/Ultra Pro1/Ultra Pro2 protocol regression matrix. Original app syntax checked.
- Firmware source on main still FW2.5; previously manually flashed FW2.2 devices unchanged. The OTA manifest remains suspended. This change does NOT re-enable 5-second guard or update iOS native IPA binaries. Clients downloading GitHub Pages HTML receive the keypad on refresh/reopen.

## 2026-10-14 · ULTRA PRO1 IGN DEGREE 0.3515625 SCALE — shared iOS/Android hosted protocol FIX

- USER REPORTED: Actual REDLEO Ultra Pro1 **MAP1 IGN degree** on Blink iOS displays low versus the exact same RPM/TPS MAP1 grid in the REDLEO original PC software. Example: at TPS 100%, RPM 3500 PC 16.9° vs Blink 12°; RPM 4000 PC 19° vs Blink 13.5°; RPM 8000 PC 25° vs Blink 17.8°. At TPS 30% RPM 7000 PC 33° vs Blink 23.5°.
- PROVEN display-unit mismatch from actual screenshots and on-wire byte conversion: old Blink `decIgn(raw)=(raw-64)/4`; Ultra original PC uses **`(raw-64) * 360/1024`** (0.3515625 degrees/raw). Examples raw112 -> original16.9 vs old12.0; raw135 -> original25.0 vs old17.8; raw158 -> original33.0 vs old23.5; raw181 -> original41.1 vs old29.3. Every screenshot sample matches precisely after one-decimal rounding. Not a TPS/RPM row/column offset.
- Implemented narrow conditional `isUltraDirect()` **only for authenticated MODERN_V10 Ultra Pro1 identity** in `redleo_real_protocol.js`: `decMainIgn` uses 0.3515625/raw, `encMainIgn` uses exact inverse so writing a visible degree never mis-scales the ECU payload. The generic V8/V9/V10.2 decoder and V11/Ultra Pro2 unit 0.28125 are UNCHANGED. Also `parseCanonicalReadAll` uses `decMainIgn` (same old result for V9; correct for Ultra) to prevent contradictory read paths. Direct 0x9A page3 serializes exactly 420 bytes and retains ACK+readback.
- **Shared hosted client deployment:** pre-5s Blink **PB3.79.72 remains**, keypad `AFR-KP1` remains, and server OTA hold `version=0.0.0/ota_enabled=false` remains. `index.html` now exposes `BLINK_ULTRA_PRO1_IGN_REVISION='ULTRA-IGN-3515625'`, adds query arg `ig=` plus existing `cb=Date.now()` when downloading `redleo_real_protocol.js`, and build label includes `UP1-IGN`.
- Android native wrapper source in `android/android-app-source.zip` (read-only inspected by `tools/check-android-remote-web.py`, ignoring the archived MainActivity CRC mismatch **for inspection only**) is a WebView shell with **`START_URL="https://letan99vl.github.io/Blink-Redleo/?android=1"`** and `webView.loadUrl(START_URL)`. It does NOT embed `index.html` or `redleo_real_protocol.js`, so the installed Android shell fetches this GitHub-hosted update on page refresh/relaunch; **no new APK binary was created or needed for this live-URL shell**. Never distribute the CRC-invalid Android source zip as a verified/rebuilt APK.
- iOS: This update applies to an IPA **if it loads Blink's GitHub-hosted HTML/protocol dynamically**, as expected from the user's prior iOS/remote-engine packaging. There is no native iOS source/IPA in this repository to verify every installed IPA build; do NOT claim a new IPA/TestFlight build or verified physical iOS device. Reopen/reload app to fetch new protocol, verify `UP1-IGN` marker, then READ MAP1 ignition with engine off and compare REDLEO original. If an installed IPA embeds a fixed frozen offline JS asset, it needs an IPA rebuild instead.
- Regression added `tools/check-ultra-ign-degree-codec.js` and wired into `Check REDLEO Protocol JS` GitHub Actions. Tests: 10 PC screenshot/old Blink samples, **256 of 256** 8-bit raw values exact codec roundtrip (quantized 0.1°), no codec drift for V9/V10.2/V11, correct direct reader/writer, matching canonical ReadAll, OTA hold and keypad intact. `tools/check-android-remote-web.py` audits actual Android shell URL and fails if the shell bundles stale HTML/protocol.
- Physical bench work still required: user to close/reopen iOS and Android hosted clients, confirm visible `UP1-IGN` marker, **READ only** Ultra Pro1 MAP1 IGN after ignition ON and engine OFF, compare selected matching cells. Screenshot and synthetic regression do not replace actual over-the-wire physical verification; avoid ECU IGN writes until matching values are confirmed.
- BACKUP before this protocol update: branch `backup-blink-pre-ultra-ign-codec-20261014` based on `98b881301ec69319142170392ae69a7ad4f0bef2`.


## 2026-10-14 · ORIGINAL REDLEO WINDOWS IGNITION CODEC AUDIT (5 ORIGINAL EXES)

- Actual user-supplied EXEs examined via ECMA-335 .NET IL (not just PC screenshots): **ECU Pro Ver 8, 9.1X, 9.2, 10.2, Ultra Pro1**. Proof and exact functions documented in REDLEO_ORIGINAL_IGN_EXE_AUDIT.md.
- ORIGINAL TrueFalse.Ign_EcuToPc / Ign_PcToEcu are controlled by Chk_TrueFalse -> static B_True; constructor initializes B_True=false, Ver78_Angle=4. OFF displays (raw-64)/4, ON displays (raw-64)*360/1024. ON .NET Math.Round(Double,1) is MIDPOINT-TO-EVEN (raw96 -> 11.2 deg, raw224 -> 56.2 deg), not JavaScript Math.round.
- Original ON reverse encoder first rounds (display * 256/360) to a 0.1 raw/4 increment before *4 and round to integer, then adds 64. Blink now mirrors this using one decMainIgn / encMainIgn dispatch for direct 0x9A, canonical ReadAll, and direct/fallback write paths.
- Blink defaults ON for REDLEO **9.2** and **Ultra Pro1** as proven by owner's PC screenshots; defaults OFF for V8, 9.1X, normal V10.2 as in original EXE initial B_True state. The IGN main-map editor offers both original PC unit modes for the five audited families; selecting units sends NO WRITE.
- Safety: switching mode requires explicit confirmation, invalidates ReadAll and all four cached main IGN 0x3x pages; clears four local IGN editor tables and RE-READS actual ECU IGN page. Unsaved IGN edits are discarded only after confirmation; no old-units values can be accidentally rescaled and written.
- Other/unknown V9 generations, other ECUs and V11/Ultra Pro2 are NOT generalized into this converter. Unknown V9 keeps old converter and has no mode switch. V11/Ultra Pro2 keeps independently audited V11 scale 0.28125. Source EXE for V11/Ultra Pro2 not present in accessible originals.
- PR #11 expands original PC IGN regression to V8/9.1X/9.2/10.2/Ultra1 x2 modes x256 raw values, .NET midpoint-even, cache invalidation, unknown-V9 isolation, iOS/Android hosted loader revision. REDLEO protocol CI passed on PR head; physical hardware read-only comparison is still required before any controlled IGN writes.
- **Retain PB3.79.72**, AFR Target keypad backport and temporary server OTA hold, with no ESP32 firmware change.

## 2026-10-14 · Firmware source naming: FW2.2 + FW2.5 side by side

- The firmware/ directory now contains exactly **2.2.ino** and **2.5.ino**, replacing the long-name ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino file. Both are byte-for-byte original blobs; no build flags, pins or code were rewritten.
- **2.2.ino** was restored from original GitHub commit 90c869f116781ef23af8c0963d382d6240d6912e, same blob as backup-release-pb37972-fw22-20261013, Git blob a2c9724b9aff9c8d0b69cdce84b395254bcb717e. FW_VERSION=2.2; ECU RX22 TX23; does NOT implement Redline Guard 5-second logic.
- **2.5.ino** is the exact previous main production source blob 15be5bb924ae14f024f6477f44e70229ab9565b4, FW_VERSION=2.5, with guarded RGON/5-second engine logic; no changes other than path.
- Build ESP32 Firmware and firmware safety-test scripts now point to firmware/2.5.ino, retaining the exact same FW2.5 production build/OTA release gate. Experimental FW2.4 workflow points to 2.5.ino on main (its own feature branch is independent).
- `ota/manifest.json` remains ota_enabled=false, maintenance=true, version=0.0.0; do NOT auto-publish FW2.5 or enable server updates. Blink web PB3.79.72 stays unchanged.
- To compile manually in Arduino IDE, **copy one desired .ino into its own sketch folder and rename its filename to match that folder**, because Arduino concatenates multiple .ino files in one sketch and version labels containing dots may not be accepted as sketch directory names. These concise names are repository download names, not a combined multi-file sketch.

## 2026-10-14 - AUTO TUNE DIRECT AFR EDITOR ENTRY (AT-DIRECT-1)

- Owner wants AUTO TUNE tab/home shortcut to enter "AFR do cua Blink" 14x30 measured AFR map directly, skipping #tuneScreen. PB3.79.57-PB3.79.77 and the rolled-back PB3.79.72 bound all [data-nav] to showScreen(e.dataset.nav), hence tune opened the intermediate hub. No exact historical direct-entry release was confirmed.
- Both [data-nav=tune] controls now route to openOurEditor('measured',true,'dashboard'). The direct editor highlights bottom AUTO TUNE rather than MAPS, and toolbar back returns dashboard rather than intermediary.
- New small #autoTuneQuickBar inside mapEditorScreen, except standalone fuel map. One button starts/stops AFR via the existing original #recordBtn handler and mirrors actual recording state. Another optional MODE / 3 RUN button opens the existing original hub only when deliberately requested for starting, ending or canceling a three-run Auto Tune session.
- The quick AFR record control is disabled during three-run sessions or three-run mode, and automatic ECU write is never invoked by entering the editor. Existing AFR capture, local target editor, adjusted-map write safety, 3-run state machine, profile guards are unchanged.
- Web PB3.79.72, OTA pause, firmware/2.2.ino and firmware/2.5.ino are unchanged. Client-visible AT-DIRECT marker identifies hosted UI revision for Android/iOS remote WebView shells.
- CI tools/check-auto-tune-direct.js checks true navigation event callbacks from homepage/bottom, 3-run opt-in, recorder mirroring, editor back/nav state and OTA hold. No new ESP32 firmware needed.

## 2026-10-15 - Corrected Auto Tune MAP first-tap false blue waiting (CORR-1T)

- User reported clicking "MAP PHUN DA BU -> ECU" once raised only a blue waiting-ECU status; apparently a second tap was required. Actual REAL protocol captureMapIo() displayed blue loading and awaited beginManualMapIo() to stop Live and drain its in-flight ECU traffic BEFORE the confirmed corrected-map writer was even invoked. This made the first tap appear inert during background polling. A cancel/no-changes early return could leave that blue loading message permanently with no truthful terminal state.
- Fix applies ONLY to manually confirmed corrected fuel MAP saving. The real protocol now installs captureMapIo with confirmFirst:true, locks both the editor applyCorrectedBtn and the hub tuneApplyCorrectedBtn immediately, but skips the blue ECU loading indicator and transport acquisition until AFTER the user explicitly confirms "GHI MAP". The corrected handler computes the changed-cell set locally, presents confirmation immediately, calls prepareTransport() exactly once after approval and proceeds in the same click flow into startFuelWrite with skipConfirm:true, rollbackMap and verifyReadback:true. Do not eliminate the safety confirmation or loosen profile gates.
- Cancel, zero changed cells, wrong/unknown MAP or disconnection produce truthful status without writing bytes. Changing bank during confirmation/transport prep aborts before touching local injection map. Duplicate taps are dropped; a thrown BLE wait restores controls and original local map. The 3-pass algorithm intentionally retains manual-transport-first semantics and all existing readback, rollback, and unknown-bank interlocks.
- Keep PB3.79.72, AFF keypad, server firmware OTA hold, iOS hybrid .64 separate bundled UI, FW2.2 and FW2.5 unchanged. Web/Android hosted build label now adds CORR-1T for version verification; existing installed iOS .64 hybrid must be handled separately if this *UI* change is needed there.
- tools/check-corrected-first-tap.js dynamically exercises captureMapIo and applyCorrectedAndWrite on fake button/ECU states, asserting confirmation-before-BLE, exactly one write + 420-cell readback, one-flight lock including hub shortcut, three-run preservation, cancellation/no-correction/map-switch/disconnect protection and BLE-wait failure. Enabled in REDLEO protocol CI.

## 2026-10-15 - AFR measured cursor appears to stop near 9,000 RPM

Detailed source audit of Blink Web/Android main PB3.79.72 and iOS hybrid bundled PB3.79.64:

1. No 9,000-RPM ceiling exists in the ECU Live decoder or AFR cell mapper. Original ECU A1 frame has two-byte big-endian RPM at offsets 6-7, mapped without a clamp by redleo_real_protocol.js parseLiveReal(). Fuel/AFR editor uses RPMS[30], initially 500, 1,000, ... 15,000, and nearestCol() scans ALL 30 cells. At 9,250 RPM the nearest cell is still 9,000, at 9,251 it changes to 9,500; RPM 10,000...15,000 map to their own columns.
2. A REAL A2 dynamic RPM axis on V10.2/Ultra Pro/V11 may legitimately end at 9,000 RPM. applyEcuAxes() takes the ECU's 30 strictly increasing breakpoints, with no requirement the last be 15,000. At higher live RPM the nearest-axis algorithm saturates on the final ECU column. This is NOT a global hardcoded 9k cap; compare actual last header and getBlinkEcuAxes().meta/source with ECU's real RPM at failure time.
3. A real UI bug exists for the 'software landscape' (appForceLandscape) rotation used by fullscreen/zoom: #mapEditorScreen is transformed rotate(90deg), but autoFollowCurrentCell() previously took getBoundingClientRect() screen X/Y displacements and applied them unchanged to wrap.scrollLeft/scrollTop (logical unrotated axes). As a result the highlight may keep moving beyond 9k but the viewport scrolls wrong and loses the RPM cursor. The rotated-only fix now uses layout offsetParent coordinates plus clientWidth/clientHeight/scrollWidth/scrollHeight; unrotated native landscape logic is UNCHANGED. Defers updating mapAutoFollowLastKey until valid geometry exists.
4. Independently, recording AFR values is gated by current ECU TPS freshness within 700ms, no deceleration/throttleClosingLock, AFR delay and cell settleMs. A user may have moving highlights above 9k but no measured AFR colors if one of those gates blocks samples. This is not a pointer-position limit.
5. tools/check-afr-cursor-fullrpm.js extracts the actual nearestCol/currentCell, recordSample and autoFollowCurrentCell from hosted HTML, checks 9,000->9,250 boundary, RPM 9,500..15,000 data recording, simulated real dynamic last axis 9,000, native vs CSS rotated coordinates, follow OFF and 3s user-touch pause. Geometry smoke test in container showed old rotated follow can leave high-RPM columns off-screen, while the new layout-aware path keeps them visible.
6. The separate iOS hybrid 3.79.64 BUNDLED HTML contains the identical rotated-follow bug; patch its source on ios-hybrid-fallback separately for the NEXT IPA build, but existing installed IPA's UI cannot receive this correction via remote protocol JS alone. Web/Android use hosted main and can receive it after a successful GitHub Pages deployment. Note that GitHub Actions has recently returned startup_failure, so a commit to main does not by itself verify deployment.
7. No changes to ECU live decode/protocol, dynamic RPM axes, measured AFR recording logic, ECU writes, original PC IGN fixes, FW2.2/FW2.5, Blink UI PB version or disabled OTA.

## 2026-10-15 - GitHub Pages redeploy after owner email verification

- Repository owner confirmed GitHub account email is now Verified. This documentation-only commit triggers a new deployment for the already-committed AFR-CURSOR source without altering Blink app logic, ECU protocol, iOS IPA, ESP32 firmware, or locked OTA configuration.
- Previous Pages run 38752151245 remained queued without jobs; multiple push runs showed startup_failure / BuildFailed with zero jobs. A new Pages run is required to confirm whether the account's Actions execution block was cleared; a successful commit alone does not establish deployed site status.
- If freshly-triggered Actions still fails before job creation, check billing payment authorization and account Actions/budget restrictions, then GitHub Support; do not modify working Blink ECU protocol to workaround a workflow startup failure.

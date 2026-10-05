# BLINK REDLEO - PROJECT STATE

> Source of truth for cross-chat continuity.
> Last verified: 2026-10-05 (Asia/Ho_Chi_Minh).
> Read this file before making changes in a new chat.
> After any meaningful architecture/release change, update this file on the active branches.

## 1. Repository

- Repository: https://github.com/letan99vl/Blink-Redleo
- Repository is currently public.
- Do not store Apple certificates, provisioning profiles, API keys, passwords, or other secrets in this repository.

## 2. Branch roles

### `main`
Production Android/web line.

Current verified head when this checkpoint was written:
`cece84670b1af23bf2e7e1da23dfd7468656f848`

Current UI version marker:
`BLINK_PB_VERSION = 3.79.56`

Important current state:
- Main ECU protocol was rolled back to the PB 3.79 state and has since been safety-hardened through PB 3.79.19.
- PB 3.79.19 release hardening:
  - Production AFR A3 uses the same user calibration path as serial/test AFR; no median/EMA/fixed BLE-only AFR formula remains.
  - TPS falling detection is fed by REAL 0x69 live data; AFR recording is blocked while throttle is closing and while TPS/RPM telemetry is stale.
  - AFR delay never substitutes a current sample when delayed history is not yet available, and delayed samples captured while throttle was closing are rejected.
  - Automated corrected-map and 3-run fuel writes use read-back verification before clearing AFR or advancing passes.
  - Lost ACK / half-write failures trigger automatic READ CURRENT recovery. If ECU state cannot be read back, that bank is write-locked until a successful READ CURRENT.
  - Ambiguous/partial failed writes invalidate measured AFR so the same AFR cannot be applied twice.
  - Fuel guard rejects incomplete/non-finite/negative/out-of-protocol maps and 420/420 all-zero maps without imposing a new 16 ms limit.
  - V8 readback comparison accounts for 0.05 ms wire quantization; V9+ keeps the existing tighter tolerance.
  - Legacy BLE READ_MAP uses a temporary 420-cell buffer and never pre-clears the current map to zero.
- ATE V11 restore 0x8B flow is hardened: a valid 9958-byte restore image is authoritative, AB/AE/8B response headers are supported, and follow-up 0xAB is a secondary verification rather than a false-failure trigger.
- PB 3.79.24 fuel keypad live-entry UX:
  - Removed the keypad ENTER button.
  - Number/decimal entry updates the selected fuel cell/range immediately in local MAP state; ECU writes still require the existing SAVE action.
  - C clears the current entry and immediately sets the selected cell/range to 0.000 ms.
  - Backspace updates the selected cell/range after each deletion; deleting the final digit results in 0.000 ms.
  - C and backspace are placed in the right-side keypad action column in portrait; landscape/software-landscape remain compact.
  - Fixed fuel entry formatting so only a trailing decimal point is removed, never the last digit.
- PB 3.79.23 ATE V11 restore response fix:
  - V11 Restore 0x8B now has a dedicated strict checksum parser and is no longer forced through the 9958-byte 0xAB Read-All decoder.
  - A checksum-valid 0x8B response confirms the restore transaction response even when its length differs from 9958B.
  - Blink then retries 0xAB readback twice; only a decoded 9958B Read All is treated as full-image verification.
  - Alternate valid 0xAB lengths or temporary readback timeouts are reported as "restore executed but not fully verified" instead of a false restore failure.
  - V9 restore path remains unchanged.
- PB 3.79.22 Auto Tune quick-map actions:
  - Auto Tune keeps only the four quick views: AFR measured, AFR target, corrected fuel map, and injection time; no MAP 1-4 bank strip was added.
  - Removed the redundant XEM MAP button from Auto Tune.
  - Added a full-width MAP PHUN ĐÃ BÙ → ECU action in the Auto Tune quick-view cluster.
  - The new action delegates to the existing applyCorrectedBtn safe path, so profile gating, three-run routing, write recovery, and readback verification are preserved.
- PB 3.79.21 ATE V11 restore UX/safety fix:
  - Restore button has a dedicated capture handler and no longer shares the generic ECU command listener.
  - Restore uses Blink's in-app confirmation dialog instead of native `window.confirm()`, avoiding silent no-op behavior in Android/WebView launchers.
  - Tap feedback appears before confirmation, and the Restore button is locked from the first tap through completion/cancel to prevent double-dispatch.
  - Restore still sends the verified 0x8B flow and uses 0xAB as secondary readback.
- PB 3.79.20 fuel-map UI split:
  - INJ VE / Thời gian phun is a standalone clean editor state; Auto Tune AFR/target/corrected controls stay in the Auto Tune flow.
  - Manual XOAY NGANG button was removed. PHÓNG TO MAP remains the single control that enters Blink's software-landscape/fullscreen map mode.
  - Standalone fuel editor toolbar is compacted to READ / SAVE / ZOOM, live cards are condensed, and map area gets more vertical space.
  - Custom numeric fuel keypad was added with 0-9, decimal, C, backspace, confirm, and hide. It only edits local `state.inject`; ECU writes still require the existing SAVE path.
  - Keypad uses a tall portrait layout and compact two-row physical/software-landscape layout; it reserves map viewport space instead of covering active cells.
  - Floating ↓ save / + / − pad is now positioned in editor-local coordinates, fixing software-rotated fullscreen placement while keeping the original handlers.
  - Auto Tune links that open INJ VE use the standalone fuel editor and return to Auto Tune when Back is pressed.
- Treat `main` as Android/web production.
- Do not change Android/main while fixing iOS unless the user explicitly asks to sync both platforms.

### `ios-hybrid-fallback`
Runtime source for the currently built hybrid iOS app.

Current verified head:
`86e4024bdbffd873f0a0e2b4d3421e259d9fc036`

Current bundled iOS UI version marker:
`BLINK_PB_VERSION = 3.75`

Important:
- The currently built iOS app loads its UI locally from the IPA.
- The iOS app loads the ECU protocol remotely first from this branch:
  `ios/BlinkRedleo/Web/redleo_real_protocol.js`
- If the remote fetch/injection fails, it falls back to the copy bundled in the IPA.
- Do NOT assume `main` and iOS are currently at the same PB version.
- Do NOT blindly copy `main/index.html` or `main/redleo_real_protocol.js` into iOS without checking the user's intent.

### `testflight-handoff`
Source branch given to the TestFlight service/provider.

Current verified head:
`735fbe6f49322c76ac0ce9a3eea96b6e835984f1`

Purpose:
- Native iOS source handoff.
- Xcode project is generated from `ios/project.yml`.
- Includes `ios/prepare_xcode_project.sh`.
- Includes `TESTFLIGHT_HANDOFF.md`.
- Service/provider should build/sign/archive from this branch, not `main`.

## 3. iOS app identity

- App name: `BLINK REDLEO`
- Bundle ID: `vn.blinkredleo.app`
- Marketing version: `1.0`
- Build: `1`
- Minimum iOS: `15.0`
- Current target family: iPhone + iPad
- Home-screen/App Store icon: Blink TL
- Bluetooth purpose strings are present.
- `ITSAppUsesNonExemptEncryption = false`
- Privacy manifest exists.
- Launch screen exists.
- App is full-screen.

Current TestFlight situation at checkpoint:
- Build 1.0 (1) has been uploaded to TestFlight.
- Internal tester invitation flow has been confirmed working.
- External/Public Link approval state is not encoded here; always check App Store Connect for the live status.

## 4. iOS native architecture

The iOS app is NOT just an HTML app.

Native files:
- `ios/BlinkRedleo/AppDelegate.swift`
- `ios/BlinkRedleo/MainViewController.swift`
- `ios/BlinkRedleo/BLEBridge.swift`
- `ios/BlinkRedleo/Info.plist`
- `ios/BlinkRedleo/PrivacyInfo.xcprivacy`
- `ios/BlinkRedleo/LaunchScreen.storyboard`

Embedded web/UI files:
- `ios/BlinkRedleo/Web/index.html`
- `ios/BlinkRedleo/Web/redleo_real_protocol.js`
- `ios/BlinkRedleo/Resources/native_bridge_ios.js`
- `ios/BlinkRedleo/Resources/ios_fullscreen_fix.js`

Runtime:
1. Native Swift launches a `WKWebView`.
2. Local `index.html` is loaded from the IPA.
3. `BLEBridge.swift` provides native CoreBluetooth.
4. After local page load, `MainViewController.swift` fetches the remote iOS protocol JS.
5. Remote JS is evaluated if valid.
6. If remote JS is unavailable/invalid, the app injects the bundled protocol copy.

## 5. What can update on an already-installed iOS/TestFlight build

### Can update remotely without a new IPA
Only logic contained in the remote file:

`ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js`

Examples:
- ECU read/write protocol.
- ECU version/profile detection.
- TPS study protocol.
- AFR/RPM/TPS/ECT protocol-side parsing and calculations.
- Packet framing/retry/timeout logic implemented in the protocol JS.
- REDLEO/ATE protocol fixes implemented in that file.

The app uses a no-cache URL request. Normally the user should fully close and reopen the app to load the new remote protocol.

### Requires a new TestFlight build
- `index.html` UI/CSS/layout changes.
- Adding/removing visible UI controls.
- iPhone portrait/landscape layout changes.
- `BLEBridge.swift` changes.
- `MainViewController.swift` changes.
- Native Bluetooth behavior.
- App icon.
- App name.
- Bundle ID.
- Info.plist permissions/settings.
- Launch screen.
- Other files compiled/bundled into the IPA.

## 6. Remote protocol validation/fallback

Current `MainViewController.swift` remote source:

`https://raw.githubusercontent.com/letan99vl/Blink-Redleo/ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js`

Remote protocol acceptance currently requires:
- HTTP 200.
- More than 50,000 bytes.
- Contains `window.BlinkRealProtocol`.
- Contains `initializeRealSession`.

Otherwise the bundled `redleo_real_protocol.js` is used.

## 7. BLE contract

Device prefix:
`BLINK-REDLEO`

Service UUID:
`afaf0001-7c35-4a6d-9f0e-2ea3117f1000`

LIVE:
`afaf0002-7c35-4a6d-9f0e-2ea3117f1000`

COMMAND:
`afaf0003-7c35-4a6d-9f0e-2ea3117f1000`

MAP:
`afaf0004-7c35-4a6d-9f0e-2ea3117f1000`

STATUS:
`afaf0005-7c35-4a6d-9f0e-2ea3117f1000`

Do not change these UUIDs unless both firmware and all clients are intentionally migrated together.

## 8. iOS build handoff

From the `testflight-handoff` branch on macOS:

```bash
git checkout testflight-handoff
cd ios
brew install xcodegen
chmod +x prepare_xcode_project.sh
./prepare_xcode_project.sh
```

This generates:
`ios/BlinkRedleo.xcodeproj`

Then:
1. Open the project in Xcode.
2. Select target `BlinkRedleo`.
3. Select the Apple Developer Team.
4. Use bundle ID `vn.blinkredleo.app`.
5. Product -> Archive.
6. Distribute App -> App Store Connect -> Upload.

The previously generated unsigned IPA cannot be uploaded directly to App Store Connect. App Store/TestFlight distribution requires valid signing and an embedded App Store Connect provisioning profile.

## 9. App Store/TestFlight review note

Current hybrid design downloads and evaluates remote JavaScript that contains ECU functionality.

This is convenient for live protocol fixes, but it can create App Review risk under Apple's rules about downloaded executable code.

If preparing a conservative External TestFlight/App Store review build:
- Prefer protocol engine bundled locally in the IPA.
- If remote updates are needed, prefer remote JSON/config/data consumed by locally bundled code.
- Provide clear review notes because the app needs BLINK-REDLEO/ECU BLE hardware.
- A short real-device demo video is useful for review when the reviewer cannot reproduce the hardware setup.

Do not silently convert the current live hybrid build to local-only without the user's approval; it changes the remote-update behavior.

## 10. App icon history

The first IPA was patched after build, which caused Sideloadly preview and the iPhone Home Screen to disagree because iOS used the compiled `Assets.car`.

Correct method now:
- Generate Blink TL icon assets before Xcode build.
- Compile them through the asset catalog into `Assets.car`.
- Do not patch only loose PNG files after build.

## 11. Safety rules for future work

1. Before editing, identify the requested platform: Android/main, iOS runtime protocol, or TestFlight source.
2. Never assume a change should affect both Android and iOS.
3. For iOS online protocol fixes, edit only `ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js` unless the user asks otherwise.
4. For iOS UI/native changes, edit the appropriate iOS source and create a new TestFlight build.
5. Back up or preserve a known-good commit before large ECU protocol changes.
6. When the user asks to roll back to a named PB/version, verify the actual target commit/file state before overwriting.
7. Do not expose signing secrets in GitHub.
8. Update this file after meaningful architecture, branch-role, release, TestFlight, or protocol-source changes.

## 12. New-chat recovery procedure

In a new chat, the user can say:

`Read PROJECT_STATE.md in letan99vl/Blink-Redleo and continue the BLINK REDLEO project.`

The assistant should then:
1. Read this file.
2. Check the current heads of `main`, `ios-hybrid-fallback`, and `testflight-handoff`.
3. Compare them with the checkpoint SHAs above.
4. If branch heads moved, inspect the new commits before assuming this file is still current.
5. Read the exact runtime source file involved in the requested task.
6. Continue without re-asking information already documented here.

## 13. Current checkpoint summary

- Android/web production: `main`, currently PB 3.79.56.
- iOS installed/TestFlight UI lineage: currently PB 3.75.
- iOS remote protocol live source: `ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js`.
- iOS protocol has IPA fallback.
- TestFlight handoff source: `testflight-handoff`.
- App identity: BLINK REDLEO / `vn.blinkredleo.app` / 1.0 (1) / iOS 15+.
- BLE UUID contract is documented above.
- Do not merge/sync platform branches automatically.


## 14. Latest main protocol checkpoint - PB 3.79.41

- REDLEO 9.2 page 0x62 Idle/Limit + ECT Motor has passed controlled real-hardware SAVE + READBACK tests and is release-certified on the tested 9.2 ECU.
- REDLEO V10.2 page family 6 has now been corrected from the old unsafe 30B assumption to the original-software serializer: **Idle/Limit only, exactly 18 writable bytes**.
- V10.2 ECT Motor is not on page6; it remains locked with the incomplete A2 writer until the full A2 TX layout is proven.
- V10.2 Idle/Limit still requires a real V10.2 hardware test before release certification.
- Regression checks now cover both REDLEO 9.2 page6 and REDLEO V10.2 page6 invariants.


## 15. V10.2 A2 checkpoint - PB 3.79.42

- Original ECU Pro 10.2 IL corrected the previous V10/Ultra 140B A2-prefix assumption for direct V10.2.
- Direct V10.2 A2 writable payload is now reconstructed as **268B** with exact block offsets.
- Opened safe read-modify-write paths: IAT INJ, MAP Idle Motor, ECT Idle Motor, External Adjustment, V-ECT, V-IAT, V-MAP.
- All partial writes require a 268B direct-read baseline and perform ACK + post-write readback while preserving sibling blocks and any longer reply tail.
- CONFIG/AutoClutch/password, Option, ECT Start Add, TPS/RPM axis writes and vAFR remain preserved/not broadly editable in this pass.
- Ultra remains a separate serializer target and is not allowed to use the V10.2 268B writer.
- CI run 37242896117 passed all protocol regression checks.
- V10.2 A2 is **NEEDS REAL HARDWARE TEST**, not release-certified yet.


## 16. V10.2 AutoClutch checkpoint - PB 3.79.43

- Direct V10.2 AutoClutch 1×5 timer table is now enabled on the exact 268B A2 read-modify-write baseline.
- Writer edits only CONFIG bytes +2..+6 with raw = ms/5.
- CONFIG feature flags, Start RPM, password and all sibling A2 blocks remain preserved.
- Ultra remains excluded from this writer.
- CI run 37243092053 passed all protocol checks.
- Still needs real V10.2 hardware SAVE + READBACK validation.
- Next V10.2 target: ECT Start Add 3×11 / 33B.


## 17. V10.2 ECT Start Add checkpoint - PB 3.79.44

- V10.2 original EXE was re-extracted and decompiled to verify `Dgv_EctStrt_Add` directly.
- Exact V10.2 Start Add surface is **3×11 = 33B** with UI rows: Time(Second), INJ VE(ms), StrtAdd(ms).
- Wire row order is reversed: StrtAdd, INJ VE, Time.
- Time uses 0.2-second raw steps (`raw = round(sec×5)`, minimum raw 1); both INJ rows use the original V10 Oil time scale.
- Blink V10.2 UI now uses a dedicated 3×11 profile and no longer reuses the V11 4×11 Start Add table.
- Writer patches only A2 bytes 205..237 inside the exact 268B RMW payload and preserves every sibling block/tail.
- Ultra remains explicitly separated from this V10.2 path.
- Local/source validation passed; real V10.2 hardware SAVE + READBACK is still required before release certification.


## 18. V10.2 Option checkpoint - PB 3.79.45

- Original ECU Pro 10.2 IL + embedded LNG_EN resource verified the V10.2 `Dgv_Option` serializer as **18B**.
- Blink exposes only the **15 labeled/semantic Option cells**; the final **3 unlabeled bytes are preserved raw** on every write.
- Direct V10.2 Option now uses the canonical 268B A2 read-modify-write baseline at offset 165..182 with ACK + readback/tail verification.
- Ultra remains excluded: Option is enabled only by the live `isV10Direct()` gate and is not present in the shared MODERN_V10 base feature set.
- V10.2 uses a dedicated 1×15 UI; ATE V11 keeps its existing 1×20 ATE Options UI.
- Final CI run **37260282172** passed syntax, row orientation, 9.2 page6, V10.2 page6 and V10.2 A2/Option regression checks.
- Hardware status remains **NEEDS REAL V10.2 TEST**.
- Next V10.2 targets: AutoClutch Start RPM and TPS/RPM axis write path; keep both locked until exact original writer semantics are verified.


## 19. V10.2 TPS/RPM axis checkpoint - PB 3.79.46

- Original ECU Pro 10.2 writer paths verified the direct V10.2 A2 axis layout: TPS voltage row 14B + TPS percent row 14B + RPM 30×uint16-BE/60B.
- Blink now exposes direct-V10-only TPS Axis 1×14 and RPM Axis 1×30 editors.
- TPS follows original normalization: first point 0%, <10% uses 0.5% steps, >=10% uses 1% steps, 0..100%, strict increasing. Its companion voltage row is regenerated from Dgv_Option TPS Min/Max.
- RPM follows original normalization: 500..15000 RPM, 20 RPM steps, strict increasing, wire raw = RPM/20 big-endian.
- Both use the canonical 268B A2 RMW path with ACK + readback + sibling/tail preservation, then republish axes from verified readback.
- Ultra remains excluded from these V10.2 axis writers.
- Final CI run **37261463129** passed all protocol checks.
- Real V10.2 hardware validation is still required before release certification.
- User scope decision: AutoClutch on ECU families not already implemented is no longer a required work item; keep it hidden/locked instead of spending further reverse-engineering time.


## 20. Ultra Pro1 page6 checkpoint - PB 3.79.47

- Original Ultra Pro1 EXE confirms selected-bank page6 = **Idle Limit 24B + AutoShift 9B + Four-Spare 9B = 42B writable**.
- Blink opens only the 8 Idle values with verified original labels, including VVT Open RPM; 4 unlabeled Idle uint16 values remain raw-preserved.
- AutoShift and Four-Spare are preserved byte-for-byte and are not editable in this pass.
- Ultra page6 uses a direct 42B baseline with ECU ACK + post-write readback + reply-tail verification.
- Ultra ECT Motor is hidden from the co-located Idle/page6 screen because it belongs to the separate A2 editor. Ultra A2 was reconstructed in PB 3.79.48.
- AutoClutch Ultra remains out of scope per user decision.
- Ultra A2 is separate from V10.2 and uses exact 277/285B layouts; V10.2 268B serializer must not be reused.
- Final CI run **37262145034** passed all protocol checks including the new Ultra page6 regression.
- Hardware status: **NEEDS REAL ULTRA PRO1 TEST**.


## 21. Ultra Pro1 exact A2 checkpoint - PB 3.79.48

- Original Ultra Pro1 A2 serializer is now reconstructed separately from V10.2.
- Exact writable lengths:
  - **277B** for Ultra firmware ≤10.2
  - **285B** for Ultra firmware >10.2 because the original writer appends CHG 8B.
- Ultra A2 CONFIG at bytes 154..164 is **feature flags + 6 Spare Built-in + 4 password**, not V10.2 AutoClutch.
- Verified Ultra A2 editable surfaces: TPS axis, RPM axis, IAT INJ, MAP Idle Motor, ECT Motor 2×11, ECT Start 3×11, External Adjustment 2×15, vECT, vIAT, vMAP.
- Ultra Option 18B, One-Spare 9B, CONFIG 11B, optional CHG 8B and vAFR remain raw-preserved on these writes.
- AutoClutch Ultra remains out of scope by user decision.
- Exact firmware minor is mandatory before A2 write; Blink locks rather than guessing 277B vs 285B.
- All Ultra A2 writes are full canonical baseline RMW with ECU ACK + post-write readback + reply-tail preservation.
- UI corrected MODERN_V10 ECT Motor to **2×11** and labels TPS/RPM axis as V10 / Ultra.
- Important cache bug fixed: after A2 readback, V10 now reparses with exact 268B parser and Ultra with exact 277/285B parser; the old 140B prefix parser is no longer used for direct V10/Ultra sessions.
- Final CI run **37262942801** passed syntax, 9.2 page6, V10.2 page6/A2, Ultra page6 and Ultra A2 regression checks.
- Hardware status: **NEEDS REAL ULTRA PRO1 TEST** before release certification.
- Next static family audit: REDLEO 9.1X page6/full-write behavior, unless Ultra real-hardware testing finds a semantic issue first.


## 22. REDLEO Ultra Pro2 checkpoint - PB 3.79.49

- User supplied original `Redleo ECU Ultra Pro2.rar`; extracted/analyzed `ECU Pro 11.exe` (SHA256 `c41b8d987afa60ec9025e42d68c2b92a094c6a5f2afa2f52971411db568a49b4`).
- Original executable is `tqmcu_ECU_V11`, assembly **11.1.7.0**, product selector REDLEO=true / ATE=false.
- Architectural result: **Ultra Pro2 is REDLEO V11-generation**, not Ultra Pro1/V10.
- Detection fixed so explicit Ultra Pro2 or Ultra + firmware major 11 routes to MODERN_V11 before the generic Ultra->MODERN_V10 fallback.
- Pro2 page6 uses exact V11 **43B = Idle 12B + AutoShift 9B + ECT Motor 22B**.
- Pro2 A2 uses exact **A2-286B** only. Pro2 direct sessions do not accept the alternate V11 A2-272 layout.
- Pro2 shares the verified V11 byte serializers where the original Pro2 EXE proves identity; it never uses V10.2 268B or Ultra Pro1 277/285B A2 paths.
- AutoClutch is intentionally hidden/blocked for Pro2 per user scope decision.
- Full ReadAll/full-image still requires exact decoded **9958B**; this gate was not loosened for Pro2 because static analysis did not independently prove a different full-image size.
- UI/badge uses **ULTRA PRO2 / REDLEO Ultra Pro2** naming instead of generic ATE text.
- Regression checker `tools/check-ultra-pro2.js` protects product detection, V11-286 routing, page6 43B, 9958B full-image gate, AutoClutch scope and Pro2 UI labels.
- Final CI run **37264169593** passed all protocol checks across 9.2, V10.2, Ultra Pro1 and Ultra Pro2.
- Hardware status: **NEEDS REAL ULTRA PRO2 TEST**. First real test should verify Ultra Pro2 badge + A2 286B, then one low-risk A2 SAVE/READBACK and one page6 Idle SAVE/READBACK.


## 23. Cross-family ECU I/O audit checkpoint - PB 3.79.50

- Audit baseline/golden reference: real-hardware REDLEO 9.2 and ATE V11.1 plus their original PC software.
- Audit method for every remaining ECU family: original command/page -> exact READ layout -> exact writable/TX region -> units/order/scale -> hidden/reserved preservation -> ACK -> post-write readback -> UI feature/read/write routing.
- **REDLEO V8** original software main-tune audit passed. Current exposed V8 surfaces remain only Fuel Time, Injection Angle, Ignition Angle and Ignition Time/Dwell; their original page routing and conversion scales are protected by `tools/check-v8-main.js`. Auxiliary V8 features remain hidden/restricted.
- **REDLEO 9.1X** original software audit found the previously incomplete area and fixed it:
  - page6 exact writable = **30B = Idle 18B + ECT Motor 12B**;
  - ECT Motor exposes 11 physical points; original 12th `SUM` byte is preserved raw;
  - A2 exact writable baseline = **133B**;
  - verified direct RMW writers now cover compensation pages 0x72/0x82/0x92, Idle, ECT Motor, IAT INJ, MAP Idle Motor, External Adjustment and vECT/vIAT/vMAP;
  - AutoClutch remains hidden/out of scope;
  - whole Option 12B write remains locked and CONFIG/AutoClutch/password/Option bytes stay raw-preserved;
  - full-write remains gated by exact decoded **9767B ReadAll**.
- **V10.2** exact 18B page6 / 268B A2 / Option / Start / TPS-RPM-axis protections were rechecked; no new serializer or cross-family regression was found.
- **Ultra Pro1** audit found a UI/write mismatch: original software proves compensation pages 0x72/0x82/0x92, cards were visible, but direct WRITE was not enabled. PB 3.79.50 now routes those pages through cached-baseline RMW + ACK + READBACK. Existing 42B page6 and 277/285B A2 protections remain unchanged.
- **Ultra Pro2** remains REDLEO V11-generation with page6 **43B** and strict **A2-286B**. Shared ECU controls were made variant-aware so Pro2 labels no longer say ATE. AutoClutch stays hidden by user scope decision; 9958B full-image gate remains unchanged.
- New CI regression layers:
  - `tools/check-v8-main.js`
  - `tools/check-v91.js`
  - `tools/check-ecu-feature-surfaces.js`
- `check-ecu-feature-surfaces.js` freezes the actual user-visible ECU editor matrix: a visible feature must have the correct family read/write route, exact page baseline gate and real protocol button capture; unverified surfaces must remain hidden/locked.
- Final CI run **37266795473** on PB 3.79.50 completed **SUCCESS**: syntax, compensation orientation, ECU feature-surface matrix, V8, 9.1X, 9.2, V10.2, Ultra Pro1 page6/A2 and Ultra Pro2 all passed.
- Hardware certification state:
  - REDLEO 9.2: tested hardware/golden reference for the certified path.
  - ATE V11.1: user-tested/golden reference.
  - V8 exposed main tune: static original-software verified; needs real V8 test for hardware certification.
  - 9.1X: static original-software verified; needs real 9.1X test.
  - V10.2: static serializer verified; needs real V10.2 test.
  - Ultra Pro1: static serializer verified; needs real Ultra Pro1 test.
  - Ultra Pro2: static V11-286 serializer verified; needs real Ultra Pro2 test.
- Do not call the untested families 99% hardware-stable until controlled one-cell READ -> edit -> SAVE -> READBACK tests pass on real ECUs.


## 24. V9 firmware-generation routing checkpoint - PB 3.79.51

- Post-audit safety review found that the V9 family detector could misinterpret four-character firmware strings such as `9.12`.
- Root cause: `firmwareNumbers()` treated the complete decimal suffix as numeric minor, so `9.12` became minor `12`; the old `minor >= 2` test could therefore select the 9.2+ serializer family.
- PB 3.79.51 adds `v9GenerationDigit()` and uses the first decimal digit strictly for V9 generation routing:
  - `9.1x` -> REDLEO 9.1X serializer family;
  - `9.2x` and later V9 decimal generations -> 9.2+ thermal/page family.
- `isV91Direct()` now requires generation digit 1.
- `usesNewThermalAxis()` requires V9 generation digit >=2; V10/V11 behavior is unchanged.
- V9 full-image write gate was tightened: exact decoded 9767B is necessary but no longer sufficient; the firmware must also be positively classified as 9.1X or 9.2+.
- Unknown/malformed V9 strings can no longer obtain generic full-write permission merely because a 9767B image was decoded.
- Regression protection:
  - `tools/check-v9-version-routing.js`;
  - `tools/check-v91.js` updated to the new detector;
  - `check-redleo-protocol.yml` runs the new classifier test.
- Backup branch: `backup-pb-3.79.50-pre-v9-version-classifier`.
- Relevant commits: `c563f0693cc8a0fccd3800e7da9114c81e7cafa1`, `60a3bbf4ab9842ca8086e801c3d86bc088b6b328`, `7a1a15fb1d571941e924f7881f38a55ffa83f0b0`, `dba9c30254cf87feba10a885a472c5af7db09b4d`, `71f7794765dc230133927956c20f93eae8953d22`, `cece84670b1af23bf2e7e1da23dfd7468656f848`.
- This fix does **not** expand hardware certification. 9.1X still requires a real ECU one-cell SAVE/READBACK validation; tested REDLEO 9.2 and ATE V11.1 remain the hardware references.

- Final protocol CI for PB 3.79.51: run **37268197492 = SUCCESS**; all family regression layers including the new V9 firmware-generation classifier passed.


## 25. Two-corner map selection checkpoint - PB 3.79.52

- Multi-cell maps now support two selection methods simultaneously:
  - existing drag/QUÉT selection;
  - two-corner rectangle selection by tapping corner #1 then the opposite corner.
- Tapping a cell already inside the current highlighted rectangle cancels the selection.
- Tapping outside a completed rectangle starts a new rectangle.
- The behavior is implemented for both the main fuel/target map and REDLEO multi-cell map editors.
- REDLEO keypad, +/- and AFR region controls now require a real active selection, preventing accidental edits to the default first cell when nothing is selected.
- Duplicate legacy touch selection handler was removed to prevent double-processing on mobile/iOS.
- Backup: `backup-pb-3.79.51-pre-two-corner-selection`.
- Implementation commit: `38469824d2c1026d9f505ece3e2d486ce1fe48fc`.
- Final protocol CI run **37306927432 = SUCCESS**.


## 26. Top-left-first two-corner selection checkpoint - PB 3.79.53

- Two-corner tap selection now requires top-left first.
- Second corner must be at/right and at/below the first corner; reverse order is rejected without changing the anchor.
- Tap-inside-to-cancel remains unchanged.
- QUÉT drag selection remains bidirectional and unchanged.
- Applied to main fuel/target maps and REDLEO multi-cell editors.
- New regression: `tools/check-map-selection.js`.
- Backup: `backup-pb-3.79.52-pre-top-left-selection`.
- Core commit: `42c6460bf1dd4ac2745b3c057bdaf5f922c27829`.


## 27. Tap rectangle to one cell checkpoint - PB 3.79.54

- Existing highlighted rectangle no longer requires a cancel tap followed by a second tap.
- One tap on a cell inside the current selection immediately collapses selection to that single cell.
- In two-corner mode the touched cell becomes the new top-left origin/corner #1.
- In QUÉT mode a simple tap leaves one cell selected; drag behavior is unchanged.
- Top-left-first two-corner direction rule remains active.
- Applied consistently to main maps and REDLEO multi-cell editors.
- Backup: `backup-pb-3.79.53-pre-tap-collapse-to-cell`.
- Core commit: `5602f07d7c9b54b21440d2c6590e5df1301cb7c3`.
- Regression update commit: `7dc76e81ba0b4fe94bee6e0c43f9bf646ac1795d`.


## 28. Free single-cell navigation checkpoint - PB 3.79.55

- Top-left-first remains a rectangle-creation rule only.
- A single selected cell can now move freely in any direction by tapping another cell.
- If the next tap is above/left of the current origin, Blink relocates the origin to that cell instead of rejecting it.
- Reverse rectangles are still not created.
- Tap-inside rectangle -> collapse to one cell remains active.
- Applied to main maps and REDLEO multi-cell editors.
- Backup: `backup-pb-3.79.54-pre-anchor-relocate`.
- Core commit: `175ff604e2164b8b64bc47db303b83cf87449f62`.
- Regression commit: `b62c89cd79ca371da34648b43d0b7ff9d678bbf4`.
- Final CI run **37308785976 = SUCCESS**.


## 29. All-map editing controls checkpoint - PB 3.79.56

- Small/simple ECU tables no longer use QUÉT or two-corner selection.
- Range selection is now reserved for dense 2D REDLEO tables: rows > 1, cols > 1, total cells >= 100.
- Dwell 1×30 and other short/simple tables use direct single-cell tap.
- Every REDLEO value-table editor now receives the numeric keypad and floating SAVE/+/- controls.
- Scan state is reset when opening a new feature so a large-map scan mode cannot leak into a simple map.
- Legacy Idle/Limit ECT Motor table, which lives in a separate screen, also received single-cell keypad + floating SAVE/+/- controls.
- Backup: `backup-pb-3.79.55-pre-editor-controls-all-maps`.
- Main UI commit: `b9f64248f26814dfe64ba06b8f58c15aa8728c6c`.
- Idle ECT controls commit: `d350ed7d6143187c829dcf404c00d03a4df7b509`.
- Regression commits: `b4c064dc83e1e1f8a3c90535c2653aabc7f55de3`, `56dac9997835f89233424b5cfd830482af6fe1e5`.

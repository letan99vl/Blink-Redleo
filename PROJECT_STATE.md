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
`60017e5c76432afa98108afeecc6c8886b6d4799`

Current UI version marker:
`BLINK_PB_VERSION = 3.79.22`

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

- Android/web production: `main`, currently PB 3.79.
- iOS installed/TestFlight UI lineage: currently PB 3.75.
- iOS remote protocol live source: `ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js`.
- iOS protocol has IPA fallback.
- TestFlight handoff source: `testflight-handoff`.
- App identity: BLINK REDLEO / `vn.blinkredleo.app` / 1.0 (1) / iOS 15+.
- BLE UUID contract is documented above.
- Do not merge/sync platform branches automatically.

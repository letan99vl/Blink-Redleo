# BLINK REDLEO - iOS / TestFlight Service Handoff

## Release identity
- Product: BLINK REDLEO
- Bundle ID: vn.blinkredleo.app
- Marketing version: 1.0
- Prepared build number: 119
- Bundled UI / PB: 3.79.126
- Minimum iOS: 15.0
- Devices: iPhone + iPad
- Source branch: ios-hybrid-fallback

If build 119 is already used in App Store Connect, increase CURRENT_PROJECT_VERSION to a higher unused integer before upload.

## Runtime architecture
- UI is bundled locally in the IPA at ios/BlinkRedleo/Web/index.html.
- Native shell: Swift + WKWebView.
- Bluetooth transport: native CoreBluetooth bridge.
- ECU protocol: remote-first from:
  https://raw.githubusercontent.com/letan99vl/Blink-Redleo/ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js
- Bundled fallback protocol:
  ios/BlinkRedleo/Web/redleo_real_protocol.js
- The installed iOS app does NOT use GitHub Pages for the UI.

## Build on macOS
Requirements:
- Xcode
- XcodeGen
- Apple Developer signing access for vn.blinkredleo.app

From the repository/package root:

```bash
cd ios
brew install xcodegen
chmod +x prepare_xcode_project.sh
./prepare_xcode_project.sh
open BlinkRedleo.xcodeproj
```

In Xcode:
1. Select target BlinkRedleo.
2. Select the owner's Apple Developer Team.
3. Confirm Bundle Identifier = vn.blinkredleo.app.
4. Confirm Version = 1.0.
5. Confirm Build = 119 or any higher unused integer.
6. Product -> Archive.
7. Validate App.
8. Distribute App -> App Store Connect -> Upload.
9. In App Store Connect/TestFlight, assign the processed build to the requested tester group.

## Existing app
Reuse the existing BLINK REDLEO App Store Connect application and bundle identifier vn.blinkredleo.app.
Do not create a second app or change the bundle identifier unless the owner explicitly requests it.

## Signing / credentials
No Apple password, private API key, distribution certificate, provisioning profile, or signing secret is included in this ZIP.

The build service needs one of these privately from the owner:

### Option A - Account access
- Required Apple Developer / App Store Connect access to the existing BLINK REDLEO app and team.

### Option B - Manual signing assets
- Apple Team ID
- App Store Connect API Key ID
- App Store Connect Issuer ID
- API private key (.p8)
- Apple Distribution certificate (.p12) and password if manual signing is used
- App Store provisioning profile for vn.blinkredleo.app if manual signing is used

Do not upload these credentials to a public GitHub repository.

## Important files
- ios/BlinkRedleo/AppDelegate.swift
- ios/BlinkRedleo/MainViewController.swift
- ios/BlinkRedleo/BLEBridge.swift
- ios/BlinkRedleo/Info.plist
- ios/BlinkRedleo/PrivacyInfo.xcprivacy
- ios/BlinkRedleo/LaunchScreen.storyboard
- ios/BlinkRedleo/Assets.xcassets/
- ios/BlinkRedleo/Resources/
- ios/BlinkRedleo/Web/index.html
- ios/BlinkRedleo/Web/redleo_real_protocol.js
- ios/project.yml
- ios/prepare_xcode_project.sh
- ios/tools/

## New in PB3.79.126 — on-device ECU backup library
- Local WKWebView uses `configuration.websiteDataStore = .default()`; IndexedDB stores named selective ECU backups inside this installed application, NOT on ESP32 and NOT on GitHub.
- App UI: ECU > SAO LƯU ECU VÀO APP / KHO BACKUP TRONG APP. Choose MAP1–4, fuel, IGN, INJ angle, Dwell, ECU AFR target (archive), A2 Options (archive), name backup; read fresh ECU and save verified data.
- Reading/importing/exporting/deleting local backups does not require ECU connection or LIVE RPM. Staging a backup into Blink RAM requires the same verified ECU identity, firmware and TPS/RPM axes. No direct ECU write is performed.
- iOS native `BackupExportBridge.swift` securely opens the iOS Files/AirDrop share sheet for JSON backup export; native WKWebView file input handles importing JSON. Firmware 2.2/2.5 unchanged, OTA server remains paused.
- User can lose IndexedDB backups if the IPA is deleted, iOS clears app data, or a different bundle identifier/WebView origin is used. EXPLICITLY instruct testers to export a file before deleting any IPA. App updates using the same bundle ID normally preserve its app container.
- AFR ON/OFF and raw A2 options are archived but NOT auto-written to ECU. No live RPM is required for backup restore; key ON and ECU authentication are needed for stage/readback only.
- Test on physical iPhone: create two named backups, force close/reopen app, verify both remain; power off ECU, verify library browse/export/import/delete still works; reconnect same ECU with engine OFF and confirm staging; try different ECU ID and verify staging is blocked.
- This ZIP is a source handoff for an existing app, not a signed IPA. App Store Connect signing and TestFlight upload must be performed by the owner/service. If build 119 was previously used, increment to an unused number.

## Verification before upload
- Bundled UI reports P.b v3.79.126.
- Bundle ID is vn.blinkredleo.app.
- Native BLE picker can discover BLINK-REDLEO hardware.
- MainViewController keeps remote-first protocol loading.
- The bundled fallback protocol exists and exports window.BlinkRealProtocol.
- Archive validates in Xcode.
- Version/build are accepted by App Store Connect.

## TestFlight review note
BLINK REDLEO is an ECU tuning/diagnostic companion app that connects to dedicated BLINK-REDLEO hardware over Bluetooth Low Energy. Core ECU functions require the companion hardware. The app includes no account login and does not collect tracking data.

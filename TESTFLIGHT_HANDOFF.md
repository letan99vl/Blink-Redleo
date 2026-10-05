# BLINK REDLEO - TestFlight Service Handoff

Use branch `testflight-handoff` as the source of the iOS/TestFlight build.

## Release identity
- Product name: **BLINK REDLEO**
- Bundle ID: `vn.blinkredleo.app`
- Marketing version: `1.0`
- Build number prepared in source: `2`
- UI / PB: `3.79.64`
- Minimum iOS: `15.0`
- Target devices: iPhone + iPad

Important: TestFlight already has build **1.0 (1)**. Do not upload build number 1 again. Use build **2** or any higher unused integer.

## Existing App Store Connect app
Reuse the existing BLINK REDLEO App Store Connect application and existing bundle identifier `vn.blinkredleo.app`.
Do not create a second application or a different bundle ID unless the owner explicitly requests it.

## Build procedure
From repository root on macOS:

```bash
cd ios
brew install xcodegen
chmod +x prepare_xcode_project.sh
./prepare_xcode_project.sh
open BlinkRedleo.xcodeproj
```

In Xcode:
1. Select target `BlinkRedleo`.
2. Select the owner's Apple Developer Team.
3. Confirm bundle ID `vn.blinkredleo.app`.
4. Confirm Version `1.0`.
5. Confirm Build is `2` or higher and unused.
6. Product -> Archive.
7. Distribute App -> App Store Connect -> Upload.
8. After processing, assign the uploaded build to the existing TestFlight tester group as requested by the owner.

## Runtime architecture
- UI is bundled locally in the IPA.
- Native shell: Swift + WKWebView.
- Bluetooth: native CoreBluetooth bridge.
- ECU protocol is remote-first from the dedicated iOS runtime branch, with a bundled local fallback.
- Remote protocol source:
  `https://raw.githubusercontent.com/letan99vl/Blink-Redleo/ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js`
- Android/web `main` is not the runtime URL for the installed iOS UI.

## App review / hardware note
The app communicates with BLINK-REDLEO BLE hardware and a motorcycle ECU. A reviewer without the physical BLE interface cannot fully reproduce ECU communication.

Suggested TestFlight review note:
> BLINK REDLEO is an ECU tuning/diagnostic companion app that connects to dedicated BLINK-REDLEO hardware over Bluetooth Low Energy. Core ECU functions require the companion hardware. The app includes no account login and does not collect tracking data.

## Privacy / export compliance
- Bluetooth purpose strings are included in `Info.plist`.
- `ITSAppUsesNonExemptEncryption = false`.
- Privacy manifest declares no tracking and no collected data types.
- No signing secret, Apple password, API private key, certificate, or provisioning profile is stored in this repository/package.

## Credentials the owner must provide privately to the build service
Choose one signing/upload method:

### Method A - Service added to Apple accounts
Provide the service the required Apple Developer / App Store Connect access for the existing app and team.

### Method B - App Store Connect API + signing assets
Provide privately:
- Apple Team ID
- App Store Connect API Key ID
- App Store Connect Issuer ID
- API private key (.p8)
- Apple Distribution certificate (.p12) and password, if manual signing is used
- App Store provisioning profile for `vn.blinkredleo.app`, if manual signing is used

Never send these credentials through the public GitHub repository.

## Files that must remain in the build
- `ios/BlinkRedleo/AppDelegate.swift`
- `ios/BlinkRedleo/MainViewController.swift`
- `ios/BlinkRedleo/BLEBridge.swift`
- `ios/BlinkRedleo/Info.plist`
- `ios/BlinkRedleo/PrivacyInfo.xcprivacy`
- `ios/BlinkRedleo/LaunchScreen.storyboard`
- `ios/BlinkRedleo/Assets.xcassets`
- `ios/BlinkRedleo/Resources/`
- `ios/BlinkRedleo/Web/index.html`
- `ios/BlinkRedleo/Web/redleo_real_protocol.js`
- `ios/project.yml`
- `ios/tools/`
- `ios/prepare_xcode_project.sh`

## Verification before upload
- App launches without GitHub Pages.
- UI reports PB 3.79.64.
- Bluetooth picker opens and can discover BLINK-REDLEO hardware.
- Bundle ID is exactly `vn.blinkredleo.app`.
- Version/build is 1.0 (2) or higher.
- Archive validates successfully in Xcode before upload.

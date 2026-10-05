# BLINK REDLEO iOS / TestFlight

Native iOS wrapper for BLINK REDLEO.

## Current release
- UI / PB: 3.79.64
- App version: 1.0
- Build: 2
- Bundle ID: `vn.blinkredleo.app`
- Minimum iOS: 15.0
- Device family: iPhone + iPad

## Runtime architecture
- `WKWebView` loads the bundled local `ios/BlinkRedleo/Web/index.html`.
- Native `CoreBluetooth` is implemented by `BLEBridge.swift`.
- `native_bridge_ios.js` exposes the native BLE bridge to the web UI.
- ECU protocol is remote-first from:
  `ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js`
- If the remote protocol cannot be fetched or validated, the app falls back to the bundled protocol copy inside the IPA.
- The app does not depend on GitHub Pages for its UI.

## Build
On macOS with Xcode:

```bash
cd ios
brew install xcodegen
chmod +x prepare_xcode_project.sh
./prepare_xcode_project.sh
open BlinkRedleo.xcodeproj
```

Then:
1. Select target `BlinkRedleo`.
2. Select the owner's Apple Developer Team.
3. Keep bundle ID `vn.blinkredleo.app`.
4. Use Version `1.0`, Build `2` or a higher unused build number.
5. Archive with Release configuration.
6. Distribute to App Store Connect / TestFlight.

## Signing / App Store Connect
Signing credentials are intentionally not stored in this repository.

For CI or a build service, provide signing/access credentials privately:
- Apple Team ID
- App Store Connect access or API key
- Apple Distribution certificate / provisioning profile when manual signing is used

The repository already includes:
- Bluetooth usage descriptions
- `ITSAppUsesNonExemptEncryption = false`
- Privacy manifest
- Launch screen
- App icon assets

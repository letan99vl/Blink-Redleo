# BLINK REDLEO iOS / TestFlight

Native iOS wrapper for the existing BLINK REDLEO web UI.

It uses WKWebView for the interface and CoreBluetooth for BLE. The iOS bridge uses the same BLE UUIDs as the Android app and ESP32, so the firmware does not need a separate iOS protocol.

The app loads:
`https://letan99vl.github.io/Blink-Redleo/?ios=1&v=1`

## Local build
1. Install Xcode and XcodeGen.
2. Run `python3 tools/make_icons.py`.
3. Run `xcodegen generate`.
4. Open `BlinkRedleo.xcodeproj`.
5. Select your Apple Developer Team and bundle ID.
6. Test on a real iPhone.

## TestFlight secrets
The manual TestFlight workflow needs:
- APPLE_TEAM_ID
- IOS_BUNDLE_ID
- IOS_DISTRIBUTION_CERT_BASE64
- IOS_DISTRIBUTION_CERT_PASSWORD
- IOS_PROVISION_PROFILE_BASE64
- APPSTORE_KEY_ID
- APPSTORE_ISSUER_ID
- APPSTORE_API_KEY_P8_BASE64

Build check runs automatically on the ios-testflight branch.

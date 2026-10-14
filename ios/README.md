# BLINK REDLEO iOS 3.79.64 hybrid / TestFlight

The shipped **3.79.64** hybrid iOS app is a native WKWebView shell with bundled HTML UI and a **remote-first** JavaScript REDLEO protocol. It uses native CoreBluetooth through the same ESP32 bridge as Android.

Native loader source: `ios/BlinkRedleo/MainViewController.swift`
- UI stays embedded: `ios/BlinkRedleo/Web/index.html`, `window.BLINK_PB_VERSION='3.79.64'`.
- On each new web page load, the app fetches the following protocol with URLSession and ignores the local URL cache:

  `https://raw.githubusercontent.com/letan99vl/Blink-Redleo/ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js`

- If network download succeeds and JS injection works, `window.BLINK_PROTOCOL_SOURCE='github-remote'`. The protocol exposes `window.BLINK_IOS64_IGN_REVISION='IOS64-IGN-PC-20261014'` after this repair.
- If network or JS injection fails, it uses the **old protocol bundled in the already-installed IPA**: `window.BLINK_PROTOCOL_SOURCE='ipa-fallback'`. Updating GitHub cannot rewrite this offline fallback in an already installed app.

## Original PC ignition map repair (2026-10-14)

For the already distributed iOS **3.79.64**, update the **exact** remote protocol file on branch `ios-hybrid-fallback`. Updating branch `main` alone does **not** update this iOS app.

This repair synchronizes main IGN decoding and encoding from original REDLEO Windows EXE analysis for V8/9.1X/9.2/V10.2/Ultra Pro1. V9.2 and Ultra Pro1 default to PC 360/1024; V8/9.1X/V10.2 retain original /4 display; ATE V11/Ultra Pro2 remains on its separate codec. Applies to direct read/write, canonical Read All, and whole-bank/full-image fallback. Uses original .NET midpoint-to-even rounding.

The existing iOS 3.79.64 bundled HTML does not contain the later Android/web PC unit selector. Do not attempt to push full later HTML to .64 via the remote protocol; do not replace its UI or change its version for an ignition-only repair. A new IPA will be necessary if the **bundled fallback** itself must change for people without internet.

Before writing ignition angles, always test **read-only** on a real ECU and compare against the original REDLEO software. No iOS or firmware OTA is required just to download the remote protocol. Do not conflate the paused ESP32 firmware OTA with remote JavaScript protocol fetch.

Run `node tools/check-ios64-original-ign.js` to test signed original-PC samples, 256 raw-byte roundtrips, other ECU families, and every read/write path. The iOS build workflow runs the test before Xcode build.

## Building for TestFlight

1. Install Xcode and XcodeGen.
2. Run `python3 tools/make_icons.py` inside `ios`.
3. Run `xcodegen generate`.
4. Open `BlinkRedleo.xcodeproj`.
5. Select your Apple Developer Team and bundle ID.
6. Test on a real iPhone.

The manual TestFlight workflow needs `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`,
`IOS_DISTRIBUTION_CERT_BASE64`, `IOS_DISTRIBUTION_CERT_PASSWORD`,
`IOS_PROVISION_PROFILE_BASE64`, `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID`,
`APPSTORE_API_KEY_P8_BASE64`.

# BLINK REDLEO — TestFlight Build Handoff / PB3.79.166

This is a **full XcodeGen source ZIP**, not a signed IPA. The old app identity is preserved:
- App Store Connect Bundle ID: **vn.blinkredleo.app**
- Marketing version: **1.0**
- Proposed build: **166** (increment to the next unused App Store Connect build if necessary)
- Bundled UI & Smart Auto Tune: **PB3.79.166**
- Minimum supported: **iOS 15.0**, iPhone and iPad.
- GitHub Web UI source: commit `7e5ae8fdddca01c93018f07502c5c5b4e6f6bcc2`
- Existing native Swift source: branch `ios-hybrid-fallback`, SHA `1e91ca8a37364f4385a0dbf9b3e29f759de06315`

## Build on a macOS machine
```bash
cd ios
brew install xcodegen
chmod +x prepare_xcode_project.sh
./prepare_xcode_project.sh
open BlinkRedleo.xcodeproj
```
Xcode > target BlinkRedleo > Signing & Capabilities: choose the existing owner's team and verify bundle ID `vn.blinkredleo.app`. Use auto signing where possible. Pick Generic iOS Device > Product > Archive > Organizer > Distribute App > App Store Connect > Upload. Use the existing App Store Connect app; do not create a new app or change Bundle ID. Build 166 must be unused; if taken, increment `CURRENT_PROJECT_VERSION` in `ios/project.yml` and regenerate XcodeGen.

For manual signing supply the development team ID and Apple Distribution signing assets **privately** to the build provider. Never commit P8/P12/profiles/passwords to GitHub. An unsigned IPA cannot be uploaded to TestFlight.

## Architecture / important difference versus old IPA
- Local bundled UI `Web/index.html` is **PB3.79.166**.
- This release expressly enables SMART Auto Tuner and base fuel calculator for **native** iOS; old native IPA was gated off. New native app UA preserves real iPhone/iPad tokens and appends `BLINK-REDLEO-IOS/1.0`.
- `MainViewController.swift` loads the shared `main/redleo_real_protocol.js` remotely first with local PB166 fallback; bundled HTML skips duplicate protocol injection. Remote JavaScript loading may raise Apple review policy questions; follow review feedback.
- Native CoreBluetooth is provided by `BLEBridge.swift` and `native_bridge_ios.js`. No Bluefy needed.
- ECU firmware OTA remains disabled; ZIP does not change ESP32 firmware.

## Acceptance checklist
- Display shows `P.b v3.79.166` in native app.
- Auto Tune has one-row navigation/read/clear AFR/BU ECU buttons, 3+2 LIVE cards, SMART + THONG GA, and 10 visible RPM columns portrait.
- Smart only activates after calculating/saving real machine/injector settings in base fuel calculator.
- Native BLE discovers ESP32 and ECU authentication succeeds on real hardware.
- Read-only map/LIVE/AFR behavior before any write; original map backup and 420-cell readback required after a controlled write.
- Test real iPhone, disconnect/reconnect, portrait/landscape, offline bundled protocol fallback and app-restart persistence.
- Verify valid RGB icons before submission and sign with existing App Store Connect identity.
- This package was statically validated, but **not compiled or signed here on macOS** and **not tested on a real ECU**.

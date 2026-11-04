# BLINK REDLEO IPA BUILD PACKAGE — PB3.79.166

Download this GitHub branch as ZIP and send the complete ZIP to your iOS build service.

**START HERE:** `README_BUILD_IPA_VI.md` (Vietnamese).  
**BUILD PROVIDER:** `BUILD_SERVICE_HANDOFF_EN.md` (English).

Native XcodeGen project is in `ios/`. Run `ios/prepare_xcode_project.sh` on Mac to generate `ios/BlinkRedleo.xcodeproj`.

Bundle ID: `vn.blinkredleo.app` — preserve it. UI PB3.79.166, proposed Apple build 166. No Apple signing secrets included. Requires Xcode/Apple Developer to make signed IPA / TestFlight upload.

IMPORTANT: Source ZIP does **not** contain a signed IPA. The packaged UI is PB3.79.166 rather than the old iOS UI; native CoreBluetooth and remote-first protocol with bundled fallback are included.

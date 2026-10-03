# BLINK REDLEO - TestFlight Handoff

Use this branch for the iOS/TestFlight build.

## Branch
`testflight-handoff`

## App identity
- App name: BLINK REDLEO
- Bundle ID: `vn.blinkredleo.app`
- Version: `1.0`
- Build: `1`
- Minimum iOS: `15.0`

## Build
From the repository root:

```bash
cd ios
python3 tools/make_icons.py
xcodegen generate
open BlinkRedleo.xcodeproj
```

Then in Xcode:
1. Select the BlinkRedleo target.
2. Set the Apple Developer Team.
3. Keep bundle identifier `vn.blinkredleo.app` if available in the team. If not, create/assign the matching App ID in the developer account before archiving.
4. Enable automatic signing or select a valid App Store Connect provisioning profile.
5. Product > Archive.
6. Distribute App > App Store Connect > Upload.

## Runtime architecture
- The UI is bundled locally in the app.
- ECU protocol is remote-first from the iOS-only branch and has a bundled fallback.
- Bluetooth uses the native CoreBluetooth bridge.
- Blink TL AppIcon is generated before Xcode asset compilation.
- Android/main is not required for this TestFlight build.

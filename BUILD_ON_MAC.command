#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/ios"
echo "BLINK PB3.79.166: validating iOS project..."
chmod +x verify_bundle.sh prepare_xcode_project.sh
./verify_bundle.sh
if ! command -v xcodegen >/dev/null; then
 echo "XcodeGen not installed. On Mac run: brew install xcodegen"
 exit 1
fi
./prepare_xcode_project.sh
echo "Open Xcode project and configure Apple Signing Team (vn.blinkredleo.app)."
open BlinkRedleo.xcodeproj

#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen is not installed."
  echo "Install it first with: brew install xcodegen"
  exit 1
fi

python3 tools/make_icons.py
xcodegen generate

echo
echo "Generated: $(pwd)/BlinkRedleo.xcodeproj"
echo "Next:"
echo "  1. open BlinkRedleo.xcodeproj"
echo "  2. Select target BlinkRedleo > Signing & Capabilities"
echo "  3. Select your Apple Developer Team"
echo "  4. Product > Archive"
echo "  5. Distribute App > App Store Connect > Upload"

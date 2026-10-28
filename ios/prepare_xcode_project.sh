#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen not found. Install with: brew install xcodegen"
  exit 1
fi
python3 tools/make_icons.py
xcodegen generate
echo "Generated: $(pwd)/BlinkRedleo.xcodeproj"

#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Checking Blink PB3.79.166 iOS bundle source..."
test -f BlinkRedleo/Web/index.html
test -f BlinkRedleo/Web/redleo_real_protocol.js
test -f BlinkRedleo/Web/fuel_map_calculator.js
test -f BlinkRedleo/Web/smart_auto_tuner_pc.js
test -f BlinkRedleo/Resources/native_bridge_ios.js
test -f BlinkRedleo/BLEBridge.swift
test -f BlinkRedleo/BackupImportBridge.swift
grep -q "BLINK-REDLEO-IOS" BlinkRedleo/Web/index.html
grep -q "BLINK_NATIVE_IPA" BlinkRedleo/Web/index.html
grep -q "3.79.166" BlinkRedleo/Web/index.html
grep -q "3.79.166" BlinkRedleo/Web/smart_auto_tuner_pc.js
grep -q "CURRENT_PROJECT_VERSION: \"166\"" project.yml
grep -q "PRODUCT_BUNDLE_IDENTIFIER: vn.blinkredleo.app" project.yml
grep -q "applicationNameForUserAgent" BlinkRedleo/MainViewController.swift
grep -q "backupImportBridge" BlinkRedleo/MainViewController.swift
grep -q "BLINK_SMART_TUNE" BlinkRedleo/Web/index.html
if command -v node >/dev/null; then
  for name in redleo_real_protocol fuel_map_calculator smart_auto_tuner_pc; do
    node --check "BlinkRedleo/Web/${name}.js"
  done
fi
if command -v plutil >/dev/null; then
  plutil -lint BlinkRedleo/Info.plist
fi
echo "PB3.79.166 source checklist OK (NOT a substitute for Xcode compile, signed IPA or real BLE/ECU QA)."

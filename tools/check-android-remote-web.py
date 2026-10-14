#!/usr/bin/env python3
"""Inspect Android Blink wrapper without exposing signing keystore or full APK.
Used to decide whether changing hosted protocol JS reaches native Android app.
"""
import re
from pathlib import Path
from zipfile import ZipFile

zpath=Path("android/android-app-source.zip")
with ZipFile(zpath) as z:
    source=z.read("app/src/main/java/vn/blinkredleo/app/MainActivity.java").decode("utf-8")
    bridge=z.read("app/src/main/assets/native_bridge.js").decode("utf-8")
    names=z.namelist()

print("Android Blink wrapper contains main Java activity:", bool(source))
print("Android wrapper assets:", [x for x in names if x.startswith("app/src/main/assets/")])
print("Embedded index.html:", any(x.endswith("/index.html") for x in names))
print("Embedded redleo_real_protocol.js:", any(x.endswith("/redleo_real_protocol.js") for x in names))
print("MainActivity WebView references (non-secret):")
for i,line in enumerate(source.splitlines(),1):
    if any(p in line for p in ("loadUrl(", "https://", "WEB_URL", "webUrl", "setJavaScriptEnabled", "evaluateJavascript(", "loadDataWithBaseURL", "shouldInterceptRequest", "setWebViewClient(")):
        print(f"L{i}: {line.strip()[:260]}")
print("Native BLE bridge APIs:", {
    "javascript_interface": "JavascriptInterface" in source,
    "web_bluetooth_shim": "requestDevice" in bridge,
    "remote_web_view": "loadUrl(" in source,
    "local_html_asset": "file:///android_asset/" in source or "file:///" in source,
})

#!/usr/bin/env python3
"""Inspect Android Blink wrapper without exposing signing keystore or full APK.
Used to decide whether changing hosted protocol JS reaches native Android app.
"""
import re
from pathlib import Path
from zipfile import ZipFile

zpath=Path("android/android-app-source.zip")
with ZipFile(zpath) as z:
    def read_source(name):
        info=z.getinfo(name)
        try:
            return z.read(info).decode("utf-8")
        except Exception as e:
            if "Bad CRC-32" not in str(e):
                raise
            # The historically committed Android SOURCE archive has damaged
            # CRC metadata on MainActivity.java; inspect decoded text ONLY.
            # Do NOT treat this as a verified build/signing asset or ship it!
            print("WARNING: source ZIP CRC mismatch:",name,"(read for inspection only)")
            info.CRC=None
            return z.read(info).decode("utf-8")
    source=read_source("app/src/main/java/vn/blinkredleo/app/MainActivity.java")
    bridge=read_source("app/src/main/assets/native_bridge.js")
    names=z.namelist()

# Android shell holds only a native BLE shim. The actual app/protocol
# MUST load live GitHub Pages, otherwise pushing JS alone would not update APK.
assert 'private static final String START_URL = "https://letan99vl.github.io/Blink-Redleo/?android=1"' in source, (
    "Android must load the shared hosted Blink page (not a frozen APK snapshot)"
)
assert 'webView.loadUrl(START_URL)' in source, "Android WebView remote entrypoint changed"
assert not any(x.endswith("/index.html") or x.endswith("/redleo_real_protocol.js") for x in names), (
    "Android now bundles a stale protocol and may need an APK rebuild"
)
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

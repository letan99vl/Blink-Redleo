# Blink-Redleo: repository split plan

Status: public. No content has been moved yet.

Keep accessible for deployed clients: index.html, redleo_real_protocol.js, ota/manifest.json, ota/blink_esp32.bin.

Move development assets to a separate private source repository after backup: firmware/, android/, windows/, tools/, CI workflows and internal handoff notes.

The page at https://letan99vl.github.io/Blink-Redleo/ still loads redleo_real_protocol.js directly. Do not remove it before testing a replacement.

Read BLINK_DEV_HANDOFF.md and PROJECT_STATE.md before development. Avoid re-enabling paused server OTA.

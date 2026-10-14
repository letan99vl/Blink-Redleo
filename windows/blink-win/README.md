# Blink TL Windows fullscreen EXE

This standalone Electron Windows wrapper loads the current production Blink REDLEO GitHub Pages site over HTTPS. Blink UI and redleo_real_protocol.js remain on the existing server; the wrapper does not change ECU logic or firmware and does not ship a frozen protocol copy.

Build: run the Build Blink TL Windows EXE GitHub Actions workflow, or on Windows run npm install and npm run dist:win in this directory. Download the Blink-TL-Fullscreen-Windows artifact and extract the one Blink-TL-Fullscreen-Windows.exe file. No separate Node or Electron installation is required for users.

- Windows 10/11 x64, working Internet connection and Bluetooth adapter required.
- Opens fullscreen with no browser URL bar. Press F11 to toggle fullscreen; Ctrl+Q or Alt+F4 quits.
- When Blink asks for a Bluetooth or serial adapter, a native app chooser lets the user select the intended device. No silent automatic pairing/selection.
- Uses persistent Blink app browser data for normal settings and browser permissions; does not alter ECU or ESP32 storage.
- Do not ship as validated for live ECU write operations without real Windows hardware testing of handshake, readback, BLE reconnect and map write.
- The EXE is currently unsigned; SmartScreen warnings are possible.

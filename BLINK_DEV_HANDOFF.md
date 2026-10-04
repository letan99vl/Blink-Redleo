# BLINK REDLEO - DEV HANDOFF / CONTINUITY NOTE

> MUST READ FIRST in every new ChatGPT/dev session before changing protocol code.
> MUST UPDATE THIS FILE after every meaningful protocol/UI milestone, bug discovery, hardware test, rollback, or PB bump.
> Do not delete old findings. Append/update status so the next session does not repeat unsafe guesses.

## 1. Project / release context

- Repo: letan99vl/Blink-Redleo
- Product: BLINK REDLEO ECU tuning web/app + ESP32 BLE/UART bridge.
- User is preparing commercial release.
- Physical ECUs currently available for real testing: REDLEO 9.2 and ATE V11.1.
- Other REDLEO versions are being opened carefully from original PC software analysis.
- Generic ECU Pro 2017 / LEGACY remains SAFE MODE and is intentionally excluded.
- Current displayed PB: **3.79.39**.
- IMPORTANT: main currently contains protocol investigation commits newer than the PB bump. Do not claim page-0x62 write is fixed until real 9.2 hardware confirms ACK + readback.

## 2. Mandatory safety rules

1. READ length and WRITE/TX length are NOT automatically the same.
2. Never infer writable page length only from a successful read.
3. Before enabling a writer, identify:
   - real page/command,
   - exact writable region / TX length,
   - encoder/order,
   - required handshake/state,
   - expected ACK,
   - readback behavior.
4. Unknown/reserved bytes must not be guessed.
5. After write, prefer readback verification. Verify writable bytes and verify unrelated/tail bytes remain unchanged when a longer read frame exists.
6. If evidence is incomplete, keep writer locked and show an explanatory UI message instead of a silent disabled button.
7. Never broaden a writer from one ECU family to V10/Ultra/V11 just because profiles look similar.
8. Create a backup branch before risky protocol changes.
9. After every change:
   - parse all inline index.html scripts,
   - parse redleo_real_protocol.js,
   - check duplicate IDs,
   - confirm profile gates did not broaden unintentionally,
   - update PB only when appropriate,
   - update this handoff file.

## 3. Current real-hardware discovery: REDLEO 9.2

### Confirmed reads from real ECU

- A2 direct read returns **134B** on the user's REDLEO 9.2.
- Page 0x62 direct read returns **63B** on MAP No.1.
- Earlier strict equality gates 133B/30B were wrong and were removed.

### Critical open bug - DO NOT ASSUME FIXED

Both of these still fail on real 9.2 hardware:

- Idle/Limit -> write attempt -> **ECU không ACK CD 62 · RX 0B**
- ECT Motor -> write attempt -> **ECU không ACK CD 62 · RX 0B**

Testing both 63B and 30B-style assumptions has not solved it.

### Important IL evidence from original REDLEO ECU Pro 9.2

Original EXE:
- /mnt/data/ecu_extract/REDLEO ECU Pro 9.2/REDLEO ECU Pro 9.2/ECU Pro 9.2.exe

Decompiled method flow from original software:

- `tspBtnWriter_Click`
  - if ECU_MODE < 4:
  - calls `RetPageNumber(...)`
  - then `proDgvEnter(write=true, page)`

- `RetPageNumber()`
  - `RetPage() * 16 + RetNumber()`

- `RetNumber()`
  - for firmware >= 9.1, selected MAP number is multiplied by 2.
  - therefore MAP No.1 low nibble is 2.
  - Idle page for MAP No.1 really is **0x62**. Blink's page number is NOT the current problem.

- `proDgvEnter(write=true, page)`
  - sets CurStateTem = 0xCD
  - sets WrNumPage = page
  - calls `proUartSendToEcu(page)`

- `proUartSendToEcu(0x62)`
  - starts TX with CD + page
  - high nibble 6 serializes, for the selected bank:
    - Dgv_Idle_Limit1 using `proUartDgvNumOption`
    - Dgv_Ect_Motor1 using `proUartDgvNum`
    - Dgv_EctStrt_Add1 using `proUartDgvNum`
  - then appends complement/checksum/length.
  - This strongly explains the real read length: **18B Idle + 12B ECT Motor + ~33B ECT Start Add = 63B**.
  - Therefore the 33B beyond the first 30B are NOT garbage tail; they are likely ECT Start Add writable data.

### Current task to solve next

Do NOT test random lengths on the user's ECU.

Reconstruct the exact original `CD 62` payload byte-for-byte from:
- `proUartDgvNumOption`
- `proUartDgvNum`
- Dgv_Idle_Limit1 dimensions/order
- Dgv_Ect_Motor1 dimensions/order/encoder
- Dgv_EctStrt_Add1 dimensions/order/encoder
- `__EctMotor_EcuPc`
- `__EctStrtAdd_EcuPc`
- `proDgvUnit`
- checksum/complement/length generation

Then make Blink's page-0x62 writer reproduce the original TX format. Only after that test on real ECU.

## 4. REDLEO 9.2 writer status

Confirmed/mostly established:
- Fuel main map
- INJ degree
- IGN degree
- Dwell / IGN time
- ECT INJ page 0x72
- ECT IGN page 0x82
- MAP INJ page 0x92

Needs hardware validation after recent refactors:
- IAT INJ / A2 path
- V-ECT / V-IAT / V-MAP
- MAP idle motor
- External adjustment
- Auto clutch

OPEN/BROKEN:
- Idle/Limit page 0x62 write
- ECT Motor page 0x62 write

Do not advertise page-0x62 write as working until real ACK + readback passes.

## 5. 9.1X status

- Modern V9 family.
- Full-write safety gate is exact decoded READ ALL 9767B.
- A helper was added so a gated write can auto-run READ ALL first instead of silently requiring the user to do it manually.
- If READ ALL is not decoded 9767B, full-write remains locked.
- Do not loosen 9767B gate without new original-software/hardware evidence.

## 6. V10.2 status

- V10 and Ultra share MODERN_V10 profile, so gate carefully.
- V10 vs Ultra is separated using handshake text containing ULTRA.
- Known read A2 prefix: first **140B**:
  - TPS 14B
  - RPM 60B
  - vAFR 11B
  - vECT 11B
  - vIAT 11B
  - vMAP 11B
  - IAT INJ 11B
  - MAP Motor 11B
- IMPORTANT: A2 direct-write for V10 was deliberately re-locked because readable 140B does NOT prove accepted TX length.
- Do not re-enable V10 A2 until original V10 writer TX length is reconstructed.
- V10 page6 assumptions must also be verified against original V10 software before real hardware claims.

## 7. Ultra Pro1 status

- Ultra executable is highly similar to V10 but must be treated as a separate writer-validation target.
- Ultra remains excluded from V10 direct writer gates until separately proven.
- Next planned ECU family after 9.2 page-0x62 is solved.

## 8. V8 status

- Dedicated V8 fuel/page logic exists.
- Main tune only is the conservative supported target.
- Options/TPS Study/Password/Restore/full-write remain restricted.
- Do not expand V8 until original V8 writer path is separately reconstructed.

## 9. ATE V11.1 status

- Real hardware available and broadly supported.
- Dedicated V11 layouts exist.
- A2 verified layouts: 272B and 286B.
- Full ReadAll verified layout: 9958B.
- Recent safety work added readback verification ideas to multiple partial writers.
- Be careful not to assume longer readable frames mean longer writable frames.
- V11 canonical writer lengths should follow verified original serializers/layouts.

## 10. UI work already completed

Recent mobile map editor work includes:
- Removed top +/- from fuel and 420-cell map toolbars.
- Added right-side +/- controls and numeric keypad behavior for 420-cell maps.
- Added keypad to ECT INJ.
- Removed COPY/PASTE from map toolbar.
- Toolbar optimized to avoid horizontal swiping.
- Back button moved into action row for easier tapping.
- Fuel-map header compacted.
- Landscape/fullscreen TPS row height optimized.
- Zoom HUD consists of:
  - ECT display (not a button)
  - THU NHỎ button
- Zoom HUD was moved away from the rotated right-side tool rail.

Do not reintroduce COPY/PASTE to fullscreen map UI unless explicitly requested.

## 11. PB / backup history highlights

Recent PB progression:
- 3.79.24 baseline before mobile-map UI changes
- 3.79.25 420-cell touch editor
- 3.79.26 toolbar cleanup
- 3.79.27 compact fuel header/TPS fit
- 3.79.28 larger back button
- 3.79.29 back button moved into action toolbar
- 3.79.30 ECT INJ keypad
- 3.79.31 fullscreen map height
- 3.79.32 V9.2 compensation write attempt
- 3.79.33 zoom HUD fix
- 3.79.34 9.1X auto full-write verification
- 3.79.35 9.2 A2/page6 unlock attempt
- 3.79.36 V10 work
- 3.79.37 9.2 readable-tail relaxation
- 3.79.38 direct-page safety hardening attempt
- 3.79.39 writable-length separation work

Useful backup branches include:
- backup-pb-3.79.31-pre-v92-comp-write
- backup-pb-3.79.33-pre-v91-unlock
- backup-pb-3.79.34-pre-v92-a2-unlock
- backup-pb-3.79.35-pre-v10-unlock
- backup-pb-3.79.36-pre-v92-length-fix
- backup-pb-3.79.37-pre-direct-page-hardening
- backup-pb-3.79.38-pre-write-length-fix

## 12. Release/support labeling

Until hardware proof exists:
- Official: REDLEO 9.2 core tested, ATE V11.1 tested.
- Beta: 9.1X, V10.2, Ultra, V8.
- Not supported: generic ECU Pro 2017 legacy.

Do not claim an untested ECU family is guaranteed to write safely.

## 13. Required handoff discipline

At the end of every meaningful session:
1. Update current PB.
2. Update last verified real-hardware behavior.
3. Record any failed experiment and why it failed.
4. Record exact original-software evidence used.
5. Mark writers as WORKING / NEEDS TEST / LOCKED / BROKEN.
6. Write the next exact task.
7. Commit this file in the same repo.

The next developer/ChatGPT MUST continue from this note, not restart protocol assumptions from scratch.

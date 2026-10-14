# REDLEO original EXE ignition-map codec audit — 2026-10-14

Original user-provided RAR archives were extracted and each Windows .NET assembly was inspected via ECMA-335 IL disassembly. No third-party ECU formula was inferred.

| Original software | .NET owner | Main IGN B_True OFF | Main IGN B_True ON | Initial static B_True |
|---|---|---|---|---|
| ECU Pro Ver 8.exe | tqECU.TrueFalse | (raw-64)/4 | (raw-64)*360/1024 | false |
| ECU Pro 9.1X.exe | tqmcu_ECU_V9.TrueFalse | same | same | false |
| ECU Pro 9.2.exe | tqmcu_ECU_V9.TrueFalse | same | same | false |
| ECU Pro 10.2.exe | tqmcu_ECU_V10.TrueFalse | same | same | false |
| ECU Pro Ultra Pro1.exe | tqmcu_ECU_V10.TrueFalse | same | same | false |

Verified in each EXE: TrueFalse.Ign_EcuToPc, Ign_PcToEcu, Ign_TrueFalse, Ign_TrueOrFalse; module .cctor sets Ver78_Angle=4 and B_True=false; Chk_TrueFalse_CheckedChanged calls proTrueFalse to toggle display conversion. The option affects displayed numbers, NOT stored ECU byte values.

With B_True ON, the original EXE does the 360/256 conversion on (raw-64)/4 and rounds to 0.1 degree via .NET Math.Round(Double,1), MidpointToEven. It first rounds the inverse by 0.1 raw/4 units, then multiplies by 4 and rounds to the integer byte before adding 64. Thus raw=96 -> 11.2°, raw=224 -> 56.2°, not 11.3° or 56.3°. All 256 byte values are round-trippable with this two-stage rounding.

With B_True OFF, V8's main GUI preserves two decimals for small values (<10) and rounds 1 decimal at >=10; V9/V10 main GUI appends another Round(...,1). The owner REDLEO 9.2 and Ultra Pro1 PC screenshots show the ON-mode values (e.g. raw92 -> 9.8°), so Blink retains their already-released ON default. V8/9.1X/standard V10.2 retain OFF defaults but now support explicit ON switch too.

Safety contract: changing PC display units must invalidate cached main-IGN 0x3x pages and decoded ReadAll, discard all four local main IGN grids after explicit user confirmation, then READ ECU anew. No WRITE command during switching. Direct page writes, fallback whole-bank writes and ReadAll use one matching selected codec. Other maps, ECT compensation, settings, server OTA hold and ESP32 firmware must remain unchanged.

**Not certified by these source files:** ATE V11 and REDLEO Ultra Pro2 original Windows binaries are absent. Their existing 0.28125 main-IGN codec is left unchanged. Static/CI checks are not equivalent to physical hardware verification; test read-only first, then controlled write/readback with engine stopped.

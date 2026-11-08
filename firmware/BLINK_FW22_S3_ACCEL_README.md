# BLINK FW2.2 ESP32-S3 — AUTO ACCEL MAP (LAB ONLY)

> **TRANG THAI:** Sketch thu nghiem, chua kiem chung tren ECU that. Khong dung tren xe dang chay truoc khi test ECU tren ban. FW 2.2 goc va OTA production KHONG thay doi.

## Tep nguon

- `firmware/BLINK_FW22_S3_ACCEL_LAB.ino` — single-file Arduino sketch
- `.github/workflows/build-fw22-s3-accel-lab.yml` — compile **ESP32-S3**, khong xuat ban OTA
- GitHub Actions: vao tab Actions -> "Compile ESP32-S3 ACC LAB (NO OTA)" de xem trang thai build va (neu thanh cong) tai artifact `BLINK_FW22_S3_ACCEL_LAB`.

## Chan / board

| Tinh nang | Chan ESP32-S3 |
|---|---|
| ECU UART RX (nhan tu ECU TX) | GPIO16 |
| ECU UART TX (gui toi ECU RX) | GPIO17 |
| ECU GND | GND chung |
| AFR input ADC tuy chon | GPIO4 |
| BLE | ten `BLINK-REDLEO` nhu FW2.2 |
| ECU serial | 38400, 8E2 |

**LUU Y:** Khong cap UART 5V truc tiep vao ESP32-S3. Can mach giao tiep muc dien ap phu hop. GPIO4 chi duoc nhan dien ap trong gioi han an toan cua ESP32-S3; neu AFR ra 5V phai chia ap/bao ve ngo vao.

Arduino IDE: Board `ESP32S3 Dev Module`, Arduino-ESP32 core `3.3.12`; nen bat `USB CDC On Boot` neu dung Serial Monitor qua USB. Serial Monitor 115200 baud, line ending Newline. Sketch chi chay tren ESP32-S3 (cac ESP32 khac bi chan compile).

## Nguyen ly ACC

1. Giu nguyen raw bridge FW2.2. Mode **OFF** mac dinh. Cau hinh luu trong NVS (Preferences).
2. Sau ACC ON, phai nhan `0x5A` full va checksum hop le, firmware REDLEO **9.1x / 9.2x**. V8 / V10 / V11 / Ultra khong cho phep AUTO.
3. Doc LIVE ECU `0x69` -> `0xA1` 53 byte checksum hop le; TPS lay tu `a[1]` + `a[47]`, RPM tu `a[6..7]`. Khong can MAP sensor.
4. De ARMED can >=3 LIVE voi RPM <=10 tren it nhat 1 giay (xe dung, khoa dien bat), moi chu ky boot.
5. Triggers: RPM >=2500, TPS>=35% va TPS tang >=15 diem phan tram / ~200-400ms; hoac TPS>=60% lien tuc 400ms. Chuyen MAP1 -> MAP2.
6. Giua MAP2 it nhat 1500ms. Chi tra MAP1 neu TPS<=20% lien tuc 800ms.
7. Moi lan chuyen: gui 0x69 MAP dich + check 53B LIVE, sau do doc lai 0x5A va doi chieu MAP thuc te. Neu 2 lan fail thi ACC OFF va bao loi. Khong thuc hien blind write.
8. Khi Blink tren dien thoai / PC yeu cau mot MAP khac, phan mem duoc uu tien: ACC tu OFF, KHONG sua tham so trong lenh cua Blink. Khong duoc xem ACC la cung hoat dong voi thao tac chon MAP bang tay.
9. Neu ACC OFF khi ECU dang MAP2 thi ESP32 **khong tu chuyen ve MAP1** khi chua verify; nguoi dung phai chon MAP an toan bang Blink / dung may kiem tra.

**CANH BAO:** Doi REDLEO MAP1/2 la doi *ca* map danh lua/han muc RPM... khong chi thoi gian phun. Chi dung khi hai bo map da duoc test, thong so phun/lua an toan, va khong thu tren duong cong cong.

## Cau hinh qua USB Serial Monitor / lenh BLE ASCII

Giao dien Blink chua co panel setup ACC; phien ban LAB cau hinh bang **USB Serial** (115200 baud, Newline). Ban co the gui cung chuoi ASCII tren BLE command characteristic hien co neu co BLE terminal phu hop.

Sau khi ket noi:
```
ACC?
ACC CAL 500 4500
ACC MAP 1 2
ACC RPM 2500
ACC TPS 35
ACC RISE 15
ACC HIGH 60
ACC DWELL 400
ACC HOLD 1500
ACC BACK 20
ACC BACKMS 800
ACC ON
ACC?
```

**ACC CAL 500 4500 chi la vi du:** 500mV la dien ap TPS dong ga, 4500mV la TPS mo het. CAN do/kiem tra dua tren Live TPS voltage thuc cua REDLEO; khong lay ngau nhien. ACC ON chi khi ECU da nap bo map co the chuyen an toan. Sau ON, **bat khoa dien, giu dong co dung** cho toi khi trang thai `ACC:ARMED`, `ACC:MAP_NORMAL` duoc xac nhan. Neu ECU dang chay, no khong ARM.

Lenh tat, xoa NVS:
```
ACC OFF
ACC RESET
```

ACC status Serial report gom: ready, boost, ecuMap, RPM va TPS mV; BLE status packet chi dai toi da 18 byte (tuong thich FW2.2).

## Firmware/OTA

- PONG cua FW S3 la `PONG FW2.2 ACCS3`, cho phep Blink tu phat hien tinh nang; so phien ban FW2.2 van giu de dam bao RAW bridge cu.
- Firmware cu tra `PONG FW2.2` (hoac FW1.x/FW2.5) KHONG co chuoi `ACCS3`, Blink an hoan toan bang setup moi.
- `ACC GET` tra ve 2 frame BLE MAP UUID marker 0xB3, 18B+16B, co so sequence va checksum XOR.
- Blink doc lai sau moi lan LUU; khong coi thanh cong neu 12 gia tri khong trung voi trang thai ESP32.
- Serial in `S3ACC-LAB1` de phan biet firmware thuc nghiem.
- **OTA tren firmware S3 nay bi chan**; build LAB khong sua `ota/manifest.json`, khong ghi `ota/blink_esp32.bin`.
- Khong nap `ota/blink_esp32.bin` danh cho ESP32 thuong len ESP32-S3.
- Blink Web/Android/Bluefy PB3.79.176 nap `blink_accel_map_settings.js`; vao THIET LAP -> AUTO ACCEL MAP ESP32-S3 (chi xuat hien khi ESP32 tra PONG chinh xac `PONG FW2.2 ACCS3`).
- Giao dien co cac thong so MAP 1/2, RPM, TPS cao, TPS tang nhanh, thoi gian giu va tra, cal TPS mV; co ban phim so noi bo; DOC / LUU / BAT / TAT.
- LUU ra 10 lenh ACC duoc firmware ACK; sau do readback 2 frame B3 va doi chieu 12 gia tri. Firmware cu khong thay giao dien, khong gui ACC.
- Trong luc thiet lap, Blink dung live poll trong mot khoang ngan bang co che `beginManualMapIo` co san, roi tiep tuc LIVE khi xong; khong sua ECU RAW transport.
- Ung dung iOS native IPA dong goi HTML can rebuild neu khong nap index hosted; Bluefy web da duoc ho tro.

## Giới hạn còn phải kiểm tra thực tế

- Phien ban ECU/handshake 0x5A, toc do live 0x69 va thoi gian phan hoi khi xe no may.
- Hieu chinh TPS dong/mo ga, dam bao khong bi nhieu ADC/ECU.
- Chuyen MAP2 va readback 0x5A khi dong co chay tren ban thu; doi chieu MAP/IGN/AFR.
- Neu mat LIVE hoac loi giao tiep, de cao: ECU co the tiep tuc o MAP2. Dung may/hoan nguyen bang tay thay vi du doan MAP.
- Thu nghiem voi BLE ket noi Blink/khong ket noi Blink va rut/restart ESP32.

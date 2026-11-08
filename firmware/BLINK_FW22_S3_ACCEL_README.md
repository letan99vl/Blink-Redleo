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
8. **FW ACCS3R2:** Khi Blink dang ket noi BLE, AUTO van o trang thai **DA BAT** nhung tam dung tu dong chuyen MAP (app uu tien). MAP2 do Blink chon KHONG lam AUTO tu OFF ngay khi arming. Sau khi ngat BLE, ESP32-S3 doc lai `0x5A` de biet MAP ECU thuc, roi moi poll LIVE `0x69` va xet dieu kien ACC. Khong tu phat `0x69 MAP1` chi vi base MAP=1; khong ghi de bang phun danh lua. Neu MAP thuc khong thuoc MAP thuong/tang toc, FW fail closed va AUTO OFF.
9. Neu ACC OFF khi ECU dang MAP2 thi ESP32 **khong tu chuyen ve MAP1** khi chua verify; nguoi dung phai chon MAP an toan bang Blink / dung may kiem tra.
10. Khi app ghi/khôi phuc ECU (0xCD/0x8B), firmware tu OFF ACC truoc khi giao tiep ghi; lenh ghi ECU van giu nguyen. Neu nguoi dung mo Blink trong khi ACC dang chay, app uu tien dieu khien.

**CANH BAO:** Doi REDLEO MAP1/2 la doi *ca* map danh lua/han muc RPM... khong chi thoi gian phun. Chi dung khi hai bo map da duoc test, thong so phun/lua an toan, va khong thu tren duong cong cong.

## Cau hinh qua USB Serial Monitor / lenh BLE ASCII

Blink Web/Bluefy/Android co muc **THIET LAP -> AUTO ACCEL MAP ESP32-S3** chi khi firmware tra capability ACCS3/ACCS3R2. Co the cai dat bang app hoac **USB Serial** (115200 baud, Newline). Ban co the gui cung chuoi ASCII tren BLE command characteristic neu can kiem tra thuan.

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

**ACC CAL 500 4500 chi la vi du:** 500mV la dien ap TPS dong ga, 4500mV la TPS mo het. CAN do/kiem tra dua tren Live TPS voltage thuc cua REDLEO; khong lay ngau nhien. ACC ON chi khi ECU da nap bo map co the chuyen an toan. Sau ON, **bat khoa dien, giu dong co dung** cho toi khi trang thai `ACC:ARMED` duoc xac nhan. Khi Blink van ket noi, APP uu tien chon MAP, nen khong bat buoc nhan `ACC:MAP_NORMAL` ngay. Neu ECU dang chay, no khong ARM.

Lenh tat, xoa NVS:
```
ACC OFF
ACC RESET
```

ACC status Serial report gom: ready, boost, ecuMap, RPM va TPS mV; BLE status packet chi dai toi da 18 byte (tuong thich FW2.2).

## Firmware/OTA

- Ban S3 R2 tra `PONG FW2.2 ACCS3R2` (18 byte) de nhan biet ro FW da sua loi tu OFF khi Blink dang MAP2. Ban S3 cu tra `PONG FW2.2 ACCS3` van duoc app ho tro. RAW bridge FW2.2 duoc giu nguyen.
- Firmware cu tra `PONG FW2.2` (hoac FW1.x/FW2.5) KHONG co chuoi `ACCS3`, Blink an hoan toan bang setup moi.
- `ACC GET` tra ve 2 frame BLE MAP UUID marker 0xB3, 18B+16B, co so sequence va checksum XOR.
- Blink doc lai sau moi lan LUU; khong coi thanh cong neu 12 gia tri khong trung voi trang thai ESP32.
- Serial in `S3ACC-LAB2` de phan biet firmware S3 R2 da sua.
- **OTA tren firmware S3 nay bi chan**; build LAB khong sua `ota/manifest.json`, khong ghi `ota/blink_esp32.bin`.
- Khong nap `ota/blink_esp32.bin` danh cho ESP32 thuong len ESP32-S3.
- Blink Web/Android/Bluefy PB3.79.179 nap `blink_accel_map_settings.js`; vao THIET LAP -> AUTO ACCEL MAP ESP32-S3 (chi xuat hien khi PONG co marker ACCS3 hoac ACCS3R2). App hien "DA BAT - TAM DUNG" khi BLE van ket noi thay vi tu nghi AUTO da tat.
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

## Sua loi ACCS3R2 (2026-11-08)

- Trieu chung ban ACCS3 cu: khi ACC ON voi ECU dang MAP2 nhung Base MAP=1, sau khi xe dung >=1s va ACC ARMED, app Blink lien tuc gui LIVE 0x69 MAP2. Firmware cu goi ACC:APP_MAP va tat ACC. Hien thi AUTO ACCEL: DANG TAT du CAL OK / RPM0.
- R2 khong tu tat do app dang dung MAP2: AUTO ON phai giu enabled=1, ready sau 3 mau RPM0 hop le, va **khong tu chuyen MAP khi BLE con ket noi**.
- Neu ngat ket noi Blink khi ECU dang MAP2, firmware R2 xac minh lai 0x5A, xem MAP2 la MAP dang chay (boost) thay vi ep ve MAP1. Muon bat dau tu MAP1, hay chon MAP1 tren Blink va xac nhan MAP1 tren ECU truoc khi ngat ket noi.
- Neu ECU doc ve MAP3 trong khi cap Base/Boost chi la MAP1/2, firmware ngung AUTO thay vi tu doan hoac chuyen MAP.
- Trang thai \`CAL OK\` la bo gia tri TPS da luu, khong phai TPS thuc su dung. Neu TPS live khi dong ga la 410mV nhung da nhap min 550mV, sai khac 140mV: nen hoc lai TPS ECU khi dong ga, khong lay gia dinh 550mV.
- Can **nap lai file INO S3 R2 bang USB/Arduino IDE**. Chi update web Blink khong sua firmware ACCS3 cu. OTA san xuat van KHOA.
- Chua co xac nhan compiler va chay tren xe; test bench/xac nhan 0x5A, LIVE, MAP phun/danh lua an toan truoc.

## Sua loi R3 / Blink PB3.79.181 (2026-11-08)

Trieu chung: bam BAT AUTO ACCEL, dong canh bao mau cam nhay qua nhanh, sau do hien DANG TAT. Screenshot da gui truoc day co Firmware hien tai `2.2 ACCS3` (ban R1). Cap nhat web app KHONG thay the firmware nay tren chip ESP32.

- Giao dien PB3.79.181 luu lai **ma su kien ACC:... va nguyen nhan** trong vung `CANH BAO LUU LAI` va muc `NHAT KY AUTO ACCEL`, khong de ket qua readback `DANG TAT` ghi de dong loi.
- Khi ESP32 tra `PONG FW2.2 ACCS3` (R1), nut BAT tu choi de khong tiep tuc kich hoat mot firmware co loi xung dot MAP. Van DOC/LUU/TAT binh thuong.
- Firmware S3 **R3** tra `PONG FW2.2 ACCS3R3`, Serial build `S3ACC-LAB3`. R2 tra `PONG FW2.2 ACCS3R2`. Blink van co the DOC/LUU/TAT ban R2.
- R3 **khong tu gui UART** 0x5A/0x69 khi BLE Blink dang ket noi. No chi quan sat 0x5A/0x69 checksum hop le do Blink phat, bao gom handshake khi AUTO dang tat.
- Khi bam ON voi BLE dang ket noi, phai co `0x5A` da xac thuc ECU cua lan ket noi hien tai. Neu chua co, tra `ACC:AUTH_FIRST` va AUTO van OFF. Khong nen co tu polling ECU de tranh uart song song.
- Khi AUTO ON va BLE van ket noi, trang thai la `DA BAT - TAM DUNG`. Sau ngat BLE, S3 se clear quyen tin MAP cu, doc lai ECU 0x5A roi moi poll LIVE / chuyen MAP.
- R3 chap nhan chuoi phien ban ECU `9.1/9.2` voi ky tu thu 4 la so, NUL hoac khoang trang; chi ban dung family duoc phep, phai co checksum hop le, byte33 MAP 0..3 va identity khop.
- `ACC:APP_WRITE` la chu dong fail-safe khi host gui lenh ghi/restore, khong duoc bo qua.
- Nho nap `firmware/BLINK_FW22_S3_ACCEL_LAB.ino` vao ESP32-S3 bang USB. OTA server van khoa; ban FW 2.2 goc cho ESP32 thuong KHONG doi.
- Test cap nhat: ngat ket noi -> nap FW S3 R3 -> mo Blink PB3.79.181 -> ket noi ECU 0x5A -> DOC TU ESP32 -> xac nhan MAP (trong cap) -> bam BAT khi RPM=0 -> doc lai `enabled=1` / `DA BAT - TAM DUNG`. Neu khong duoc, chup vung CANH BAO LUU LAI va NHAT KY, KHONG thu chay xe.

**Chua kiem nghiem thuc te tren ECU / xe.** Truoc khi dung de tu chuyen khi xe dang chay, can kiem nghiem chuyen MAP va map danh lua/phun tren ban thu.

- Blink PB3.79.181 tu choi ngay ACK `ACC:AUTH_FIRST`, `ACC:MAP_CONFLICT` va hien ma loi vao nhat ky, khong doi 4 giay de bao `Thieu ACK` sai. Cac loi tren cho thay firmware khong du dieu kien BAT, AUTO van OFF.

## ACCS3R4 + Blink PB3.79.182: LIVE MAP confirmed + floating keypad + RPM=0 TEST

**Firmware ESP32-S3:** file `BLINK_FW22_S3_ACCEL_LAB.ino`, marker PONG `FW2.2 ACCS3R4` (`S3ACC-LAB4` tren Serial). Co the tai tu GitHub va nap tay bang USB Arduino IDE. Khong thay FW 2.2 goc, khong xuat ban OTA production.

**Giao dien Blink:** mo `THIET LAP -> AUTO ACCEL MAP ESP32-S3`, bam o nhap so: ban phim hien noi canh goc duoi phai, bam `⌨` de hien / `AN` de dong. Khong can cuon den vi tri ban phim. De nhap RPM=0, can ACCS3R4; ban R3 va cu van chi nhan RPM>=1000.

**Test khi may dung:** dat RPM kich hoat **0** (nguong thu nghiem); du cam bien TPS da hieu chuan, live 0x69 hop le va ECU xac nhan 0x5A. Firmware va app deu chan tu chuyen MAP neu RPM>10 trong che do test nay. Sau khi thu phai doi RPM lai gia tri dung cho xe, neu khong se khong auto trigger khi no may. Chi thu voi dong co DUNG, khoa dien bat, MAP1/2 an toan. Day la mot phep thu giao tiep, khong phai xac nhan an toan hoat dong tren duong.

**Quan sat MAP doi that khi ket noi Blink:** bat AUTO tren S3 -> doi den READY sau nhieu mau RPM=0 -> tick hop an toan -> bat `CHO BLINK TU CHUYEN MAP KHI KET NOI` (khong tu bat moi phien). App chi chay logic TPS/RPM theo ngưong da luu neu S3 R3/R4 ho tro. Khi du dieu kien, app gui `0x69` de chon MAP, sau do phai lay `0x5A` full checksum/ID hop le xac nhan MAP thuc moi cap nhat so MAP tai Trang chu / Ban do va thong bao `ECU 0x5A DA XAC NHAN`. Neu 0x5A that bai, ung dung khoa lai LIVE 0x69 de khong vo tinh dao MAP ve gia tri cu; can ngat/ket noi lai de doc MAP thuc.

**Thu cong luon uu tien:** neu bam chon MAP thu cong, app dung AUTO cua phien do. Khi Blink disconnect, ESP32-S3 phai doc lai MAP thuc 0x5A roi moi tiep tuc tu dong. Can bam `TAT AUTO ACCEL` neu khong muon AUTO tai kich hoat sau khi dong ket noi.

**Firmware cu:** khong co capability ACCS3 thi Blink khong hien phan AUTO ACCEL, giao tiep/OTA RAW FW cu nhu truoc.

**Gioi han:** can test bench thuc te; chu ky 0x69/0x5A va TPS/RPM chua duoc xac nhan tren tung ECU. Khong dung tren duong cong cong truoc khi chung minh ca map phun va map danh lua an toan.

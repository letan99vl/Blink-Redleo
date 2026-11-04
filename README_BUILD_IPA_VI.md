# BLINK REDLEO — HUONG DAN BUILD IPA / TESTFLIGHT (PB 3.79.166)

**Day la ZIP ma nguon Xcode de GUI BEN DICH VU BUILD, CHUA PHAI IPA DA KY.**
- Ung dung: BLINK REDLEO
- Bundle ID GOC: `vn.blinkredleo.app` (GIU NGUYEN de cap nhat app/TestFlight cu)
- Marketing Version: `1.0`
- Xcode Build Number du kien: `166` (neu App Store Connect da dung 166, tang len so CHUA DUNG, khong giam)
- PB giao dien/Smart Tuner da dong goi: `3.79.166`
- iOS toi thieu: `15.0`; thiet bi: iPhone va iPad
- Nguon Web PB166: commit `7e5ae8fdddca01c93018f07502c5c5b4e6f6bcc2`
- Nguon native iOS: branch `ios-hybrid-fallback`, commit `1e91ca8a37364f4385a0dbf9b3e29f759de06315`

## 1. Binh thuong can chuan bi gi?

Mac chay macOS co Xcode va Command Line Tools; Apple Developer Team co quyen ky app `vn.blinkredleo.app`. Can ket noi iPhone that va BLINK-REDLEO ESP32 (CoreBluetooth). Khong can copy key hay mat khau vao ZIP.

## 2. Khoi tao project Xcode

Giai nen ZIP, mo Terminal tai thu muc chua file nay, chay:

```bash
cd ios
brew install xcodegen
chmod +x prepare_xcode_project.sh
./prepare_xcode_project.sh
open BlinkRedleo.xcodeproj
```

Neu chua co Homebrew, cai Homebrew tren may Mac truoc. `prepare_xcode_project.sh` tao icon va Xcode project tu `project.yml`. Khong mo `.xcodeproj` truoc khi chay script.

## 3. Ky ung dung va build

1. Trong Xcode chon **BlinkRedleo** > TARGETS > BlinkRedleo > **Signing & Capabilities**.
2. Chon dung Apple Developer **Team** dang quan ly ung dung BLINK REDLEO tren App Store Connect. Co the bat **Automatically manage signing**.
3. Kiem tra **Bundle Identifier** phai dung **`vn.blinkredleo.app`**; khong tao bundle ID moi neu muon cap nhat TestFlight cu.
4. **Version: 1.0**, **Build: 166** hoac SO MOI cao hon neu 166 da duoc upload.
5. Chon device **Any iOS Device (arm64)** / **Generic iOS Device**.
6. Trong menu Xcode chon **Product > Archive**. Kiem tra Archive ket thuc khong loi.
7. Mo **Organizer** > **Distribute App** > **App Store Connect** > Upload, sau do chon TestFlight cho nhom tester cu.
8. Neu dich vu can file **signed IPA** thay vi upload truc tiep, export App Store distribution tu Archive bang signing assets cua Team, khong dung unsigned IPA de upload.

Khi build tu ZIP nay, icon Blink duoc tao TU SVG trong `ios/tools/BlinkTL-AppIcon.svg` qua `sips` tren macOS. **Khong thay icon trong IPA sau khi compile**, se lech voi Assets.car.

## 4. Kiem tra nhanh truoc khi giao

1. Tren iPhone, vao Auto Tune xac nhan giao dien **P.b v3.79.166**.
2. Xac nhan co **BẬT SMART**, **THÒNG GA > BÙ** va nut **BÙ → ECU** o cung hang tren; bang MAP doc thay khoang 10 cot RPM va keo ngang duoc het 30 cot.
3. Vao **THỜI GIAN PHUN -> ƒx TÍNH MAP NỀN**, nhap thong so MAY/KIM that, bam **TÍNH & XEM TRƯỚC**, sau do moi bat Smart.
4. Connect native BLE, xac thuc ECU, doc LIVE va MAP; kiem tra AFR, TPS, RPM va du lieu tinh co gia tri hop le.
5. Thu doc MAP 420 o; KHONG thuc hien ghi ECU khi chua sao luu ban goc va kiem chung day du tren xe/dyno.
6. Thu dong/mo app khi khong co mang: UI PB166 van co trong IPA va giao thuc co fallback local.
7. Kiem tra IndexedDB/backups neu dang dung; tren native iOS phai test doc/luu/nhap file tren may that.

## 5. Kien truc quan trong

- Swift `MainViewController.swift` tai **UI da dong goi cuc bo** tu `ios/BlinkRedleo/Web/index.html`.
- `BLEBridge.swift` cung cap native CoreBluetooth va shim `Resources/native_bridge_ios.js`; KHONG can Bluefy de chay IPA.
- Native app tu lay ECU protocol moi nhat `main/redleo_real_protocol.js` qua HTTPS khi khoi dong; neu mang loi / JS loi, fallback sang protocol PB166 **dong goi**.
- De tranh dua hai luong BLE, HTML dong goi **khong tu nap** giao thuc khi nhan user-agent `BLINK-REDLEO-IOS/1.0`.
- User agent giu phan goc iPhone/iPad + duoi Blink, de Smart Tuner va bo tinh VE dung.
- Firmware ESP32, OTA, Android va web PUBLIC MAIN KHONG DUOC SUA boi ZIP nay.

**Canh bao danh gia Apple:** cach tai JavaScript giao thuc ECU tu xa co the bi xem xet theo App Review Guideline 2.5.2. Neu review yeu cau, dich vu co the de nghi chuyen sang chay giao thuc dong goi-only va build lai. Khong duoc cam ket TestFlight/App Store duyet truoc.

## 6. Phan biet loai file

- **ZIP nay = MA NGUON DAY DU DE BUILD** (co Swift/XcodeGen/HTML/JS/logo).
- **.xcodeproj** = sinh tren Mac bang `./prepare_xcode_project.sh`.
- **.xcarchive** = tao trong Xcode sau Product > Archive.
- **.ipa** = xuat/ky tu .xcarchive; can chung chi Apple cua chu app.
- **Unsigned IPA** khong duoc upload thay cho ban signed TestFlight.

Khong gui mat khau, token, file p8, p12 hay provisioning profile trong chat/cong khai.

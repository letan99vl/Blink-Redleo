/* BLINK ACCS3: optional ESP32-S3 acceleration MAP setup.
   Legacy firmware: no marker, no visible UI, no ACC commands. */
(function(w){
'use strict';
const $=id=>document.getElementById(id);
const host=$('settingsScreen');
if(!host)return;
const cap=/^PONG\s+FW2\.2\s+ACCS3(?:R2|R3|R4|R5)?$/i;
// Existing Blink CSS forces .settings display:block!important; explicitly
// restore hidden semantics for firmware without the ACCS3 capability.
const style=document.createElement('style');
style.textContent='#settingsScreen #blinkAccelSettingsS3[hidden]{display:none!important}'+
 '#accS3Pad{position:fixed!important;left:auto!important;right:max(10px,env(safe-area-inset-right))!important;'+
 'bottom:calc(150px + env(safe-area-inset-bottom))!important;top:auto!important;'+
 'z-index:250050!important;width:min(348px,calc(100vw - 20px))!important;max-width:348px!important;'+
 'height:min(300px,calc(100dvh - 230px))!important;min-height:170px!important;'+
 'margin:0!important;border:1px solid #79313e!important;border-radius:14px!important;'+
 'box-shadow:0 12px 38px #000d!important;overflow:hidden!important}'+
 '#accS3Pad .fuelKeypadGrid{min-height:0;grid-template-rows:repeat(4,minmax(36px,1fr))}'+
 '#accS3Pad .fuelKeypadGrid button{min-height:36px}'+
 '#accS3FloatKey{position:fixed;right:max(12px,env(safe-area-inset-right));'+
 'bottom:calc(88px + env(safe-area-inset-bottom));z-index:250060;width:58px;height:53px;'+
 'min-width:58px;min-height:53px;border-radius:15px;border:1px solid #f06476;'+
 'background:#24141c;color:white;font-size:20px;font-weight:900;'+
 'box-shadow:0 9px 25px #000b;touch-action:manipulation}'+
 '#accS3FloatKey[hidden]{display:none!important}';
document.head.appendChild(style);
const panel=document.createElement('details');
panel.className='settings tuneSettingsDetails';
panel.id='blinkAccelSettingsS3';
panel.hidden=true;
const specs=[
 ['Base','MAP bình thường','1:4',1],['Boost','MAP tăng tốc','1:4',2],
 ['Rpm','RPM kích hoạt (0 = TEST)','0:15000',2500],['Tps','TPS kích hoạt (%)','10:90',35],
 ['Rise','TPS tăng trong 200–400ms (%)','3:40',15],['High','TPS cao duy trì (%)','10:95',60],
 ['Dwell','Giữ TPS cao (ms)','200:2000',400],['Hold','Giữ MAP tăng tốc (ms)','500:10000',1500],
 ['Back','TPS trả MAP thường (%)','5:70',20],['BackMs','Trễ trả MAP (ms)','300:3000',800],
 ['IdleMv','TPS đóng ga (mV)','200:2000',500],['WideMv','TPS mở hết (mV)','3000:5000',4500]
];
const mapOptions=[1,2,3,4].map(n=>'<option value="'+n+'">MAP '+n+'</option>').join('');
const fields=specs.map(([id,label,range,val],ix)=>'<div class="field"><label for="accS3'+id+'">'+label+'</label>'+
 (ix<2?'<select id="accS3'+id+'">'+mapOptions+'</select>':
 '<input id="accS3'+id+'" type="text" inputmode="none" readonly data-acc-range="'+range+'" value="'+val+'">')+'</div>').join('');
panel.innerHTML=[
'<summary>AUTO ACCEL MAP · ESP32-S3</summary>',
'<div class="tuneSettingsGroup"><h3 class="tuneSettingsGroupHeading">TỰ CHUYỂN MAP KHI TĂNG GA</h3>',
'<div class="tuneSettingHelp">S3 R3/R4/R5: Blink tự chuyển MAP theo TPS/RPM khi BLE kết nối nếu bật công tắc cho phép; phải xác minh ECU 0x5A rồi mới đổi MAP hiển thị. R4 cho phép RPM=0 để test máy dừng. Ngắt Blink thì ESP32 tự xử lý. Chỉ REDLEO 9.1x/9.2x; MAP phun/lửa phải an toàn.</div>',
'<div class="settingsGrid tuneSettingsGrid">'+fields+'</div>',
'<div class="tuneSettingHelp" style="color:#ffc37c">RPM = 0 chỉ để TEST khi máy dừng, khóa điện bật. Thử xong đặt lại ngưỡng RPM an toàn trước khi chạy xe. Chế độ xung ga thử nghiệm: MAP tăng tốc có thể trả MAP thường sau thời gian GIỮ nếu TPS dưới 40% và RPM gần ổn định; nhả hết ga có thể trả sớm trong khoảng 250ms. MAP thường phải được hiệu chỉnh an toàn cho tải ổn định trước khi thử với ECU; khi ngắt BLE cần firmware ACCS3R5 để có cùng logic.</div>',
'<div class="toolrow" style="margin-top:8px">',
'<button type="button" id="accS3UseTps">LẤY TPS ĐÃ HỌC</button>',
'<button type="button" id="accS3Read" class="primary">ĐỌC TỪ ESP32</button>',
'<button type="button" id="accS3Save" class="good">LƯU VÀO ESP32</button></div>',
'<div id="accS3Pad" class="fuelKeypad" style="display:none" aria-hidden="true">',
'<div class="fuelKeypadHead"><span id="accS3PadLabel">Nhập số</span><strong id="accS3PadValue">--</strong></div>',
'<div class="fuelKeypadGrid">',
...['1','2','3','C','4','5','6','⌫','7','8','9','ẨN','0'].map((v,i)=>'<button type="button" data-acc-key="'+v+'"'+(i===12?' style="grid-column:span 4"':'')+'>'+v+'</button>'),
'</div></div>',
'<label class="toggleItem" style="margin:10px 0;display:flex;align-items:flex-start;gap:8px"><input type="checkbox" id="accS3Safety"><span>Đã kiểm tra MAP thường/tăng tốc, đánh lửa, giới hạn tua và động cơ đang dừng khi bật.</span></label>',
'<div class="toolrow"><button type="button" id="accS3On" class="good">BẬT AUTO ACCEL</button><button type="button" id="accS3Off" class="danger">TẮT AUTO ACCEL</button></div>',
'<div class="tuneSettingHelp" id="accS3State" role="status">Đang nhận diện firmware ESP32.</div>',
'<label class="toggleItem" id="accS3LiveControlRow" style="margin:10px 0;display:none;align-items:flex-start;gap:8px"><input type="checkbox" id="accS3DriveLive"><span><b>CHO BLINK TỰ CHUYỂN MAP KHI KẾT NỐI</b> · Chỉ S3 R3/R4/R5. Cần bật thủ công mỗi phiên và xác nhận an toàn.</span></label>',
'<label class="toggleItem" id="accS3PulseModeRow" style="margin:10px 0;display:none;align-items:flex-start;gap:8px"><input type="checkbox" id="accS3PulseMode"><span><b>THỬ NGHIỆM: TRẢ MAP KHI GA ỔN ĐỊNH / NHẢ GA NHANH</b> · Blink ghi nhớ dấu tích trên trình duyệt này sau khi tắt khóa/đóng app. Đây chỉ là lựa chọn thuật toán, KHÔNG tự cấp quyền chuyển MAP: mỗi lần kết nối phải bật riêng CHO BLINK TỰ CHUYỂN MAP và xác nhận an toàn. Với S3 R4, khi ngắt BLE thuật toán mới chưa chạy độc lập. TPS/RPM ổn định KHÔNG chứng minh tải động cơ nhẹ; chỉ thử trên bàn ECU.</span></label>',
'<div class="tuneSettingHelp" id="accS3ControlHint" style="display:none;color:#ffc37c"></div>',
'<div class="tuneSettingHelp" id="accS3LiveWatch" role="status" aria-live="off">ECU LIVE 0xA1: chờ TPS và RPM hợp lệ...</div>',
'<div class="tuneSettingHelp" id="accS3PulseDiag" role="status" aria-live="off">CHẨN ĐOÁN TRẢ MAP: Chế độ thử nghiệm mặc định TẮT. Khi thử, xem dòng này để biết điều kiện chưa đạt.</div>',
'<div class="tuneSettingHelp" id="accS3LiveProof" role="status">MAP ECU: chờ xác minh · chưa tự chuyển qua Blink.</div>',
'<div class="tuneSettingHelp" id="accS3LastFault" role="alert" style="display:none;color:#ffb09e;border:1px solid #803d30;border-radius:9px;padding:10px;white-space:pre-wrap"></div>',
'<details id="accS3Events" style="margin:10px 0"><summary>NHẬT KÝ AUTO ACCEL · LỆNH / CẢNH BÁO</summary><pre id="accS3Log" style="white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace;max-height:230px;overflow:auto;margin:8px 0"></pre><button type="button" id="accS3ClearLog">XÓA NHẬT KÝ</button></details>',
'<div class="tuneSettingHelp">S3 R3: app tự chuyển MAP qua 0x69/0x5A khi đã bật tùy chọn trên; khi ngắt BLE, ESP32 tự chuyển. Tắt AUTO không tự trả về MAP thường. Chưa kiểm chứng trên xe: chỉ thử với động cơ dừng và hai MAP an toàn.</div></div>'
].join('');
$('accS3Base'); // panel attached below
const ota=$('otaSettings');if(ota)ota.before(panel);else host.appendChild(panel);
// Pop out of settings scroll container so keyboard stays at viewport corner.
const padNode=$('accS3Pad');if(padNode)document.body.appendChild(padNode);
const padToggle=document.createElement('button');padToggle.id='accS3FloatKey';padToggle.type='button';
padToggle.textContent='⌨';padToggle.title='Hiện hoặc ẩn bàn phím AUTO ACCEL';
padToggle.setAttribute('aria-label','Hiện bàn phím nhập số AUTO ACCEL');
padToggle.hidden=true;document.body.appendChild(padToggle);
$('accS3Base').value='1';$('accS3Boost').value='2';
const ids=specs.map(x=>x[0]);
let available=false,attached=null,lastSnap=null,hasRead=false,busy=false;
let ack=null,readPromise=null,parts=new Map(),padField=null,lastTry=0;
let lastFault=null;const events=[];
const capR3=/^PONG\s+FW2\.2\s+ACCS3(?:R3|R4|R5)$/i;
const capR4=/^PONG\s+FW2\.2\s+ACCS3(?:R4|R5)$/i;
// Persist the user's algorithm CHOICE only. Never persist or auto-arm the
// connected BLE MAP-control permission. One browser's preference is not an
// ESP32 firmware setting and cannot activate autonomous R4 switching.
const ACC_PULSE_PREF_KEY='blinkAccS3PulseChoiceV1';
function readPulsePreference(){
 try{return w.localStorage?.getItem(ACC_PULSE_PREF_KEY)==='1';}
 catch(_e){return false;}
}
let pulsePreference=readPulsePreference();
function savePulsePreference(on){
 pulsePreference=!!on;
 try{w.localStorage?.setItem(ACC_PULSE_PREF_KEY,pulsePreference?'1':'0');}
 catch(_e){}
}
let autoSamples=[],autoHighSince=0,autoBackSince=0,autoBoostSince=0;
let autoLastSampleAt=0,autoCooldownUntil=0,autoTransitionBusy=false,autoManualHold=false;
let autoLastMap=0,lastWatchMs=0;
let autoRearmLow=null; // Real checksum-valid TPS<=3% sample before verified MAP2->MAP1.
const ACC_REARM_MAX_AGE_MS=900; // One short, bounded handoff; never infer an unseen TPS.
const fatalCodes={
 'ACC:APP_MAP':'FW ACCS3 cũ tự tắt AUTO vì MAP Blink khác MAP thường. Nạp S3 ACCS3R2 bằng USB.',
 'ACC:APP_WRITE':'ESP32 tắt AUTO vì Blink gửi lệnh ghi/khôi phục ECU.',
 'ACC:ECU_REJECT':'ECU không vượt qua xác minh 0x5A hoặc không khớp ECU đã lưu.',
 'ACC:MAP_CONFLICT':'MAP thực tế không thuộc cặp MAP thường/tăng tốc đã đặt.',
 'ACC:TPS_RANGE':'Điện áp TPS LIVE nằm ngoài biên hiệu chuẩn cho phép. Kiểm tra TPS đóng/mở.',
 'ACC:MAP_VERIFY':'Chuyển MAP nhưng ECU không xác minh được MAP đích.',
 'ACC:CAL_FIRST':'ESP32 từ chối BẬT vì chưa hiệu chuẩn TPS hoặc cặp MAP chưa hợp lệ.',
 'ACC:AUTH_FIRST':'ESP32 chưa nhận handshake ECU 0x5A hợp lệ từ phiên Blink hiện tại hoặc ECU khác mã đã ghim. Hãy ngắt/kết nối lại Blink, xác thực ECU trước khi BẬT.',
 'ACC:OFF_FIRST':'ESP32 yêu cầu tắt AUTO trước khi thay đổi thiết lập.',
 'ACC:BAD_CMD':'Lệnh cài đặt không được firmware nhận.',
 'ACC:BAD_CAL':'Giá trị TPS đóng/mở không hợp lệ.',
 'ACC:BAD_MAP':'Cặp MAP thường/tăng tốc không hợp lệ.',
 'ACC:BAD_VALUE':'Giá trị thiết lập nằm ngoài phạm vi.',
 'ACC:CMD_BUSY':'ESP32 đang xử lý lệnh khác; không nhận thêm.'
};
function logEvent(code){
 const entry=new Date().toLocaleTimeString('vi-VN',{hour12:false})+'  '+String(code);
 events.push(entry);if(events.length>35)events.shift();
 const el=$('accS3Log');if(el)el.textContent=events.join('\n');
}
function retainFault(code,reason){
 lastFault={code:String(code),reason:String(reason||''),at:new Date().toLocaleTimeString('vi-VN',{hour12:false})};
 const el=$('accS3LastFault');
 if(el){el.style.display='block';el.textContent='CẢNH BÁO LƯU LẠI · '+lastFault.at+
   '\n'+lastFault.code+' · '+lastFault.reason+'\nKhông tự xóa khi trạng thái AUTO chuyển sang TẮT.';}
 const d=$('accS3Events');if(d)d.open=true;
}
const previous=typeof w.onBlinkStatus==='function'?w.onBlinkStatus:null;
function info(t,error){const el=$('accS3State');if(el){el.textContent=String(t);el.style.color=error?'#ffb2a4':'';}}
function lock(on){busy=on;for(const id of ['Read','Save','On','Off','UseTps']){const el=$('accS3'+id);if(el)el.disabled=on||!available;}}
function padVisible(){return $('accS3Pad').getAttribute('aria-hidden')==='false';}
function stopPad(){
 $('accS3Pad').style.display='none';
 $('accS3Pad').setAttribute('aria-hidden','true');
 padToggle.textContent='⌨';padToggle.setAttribute('aria-label','Hiện bàn phím AUTO ACCEL');
}
function showPad(input){
 padField=input||padField||$('accS3Rpm');
 if(!padField)return;
 const key=padField.id.replace('accS3','');
 $('accS3PadLabel').textContent=specs.find(x=>x[0]===key)?.[1]||'Nhập số';
 $('accS3PadValue').textContent=String(padField.value||'0');
 $('accS3Pad').style.display='flex';
 $('accS3Pad').setAttribute('aria-hidden','false');
 padToggle.textContent='ẨN';padToggle.setAttribute('aria-label','Ẩn bàn phím AUTO ACCEL');
}
function syncPadToggle(){
 const visible=available&&panel.open&&host.classList.contains('active');
 padToggle.hidden=!visible;
 if(!visible&&padVisible())stopPad();
}
function syncLiveControllerAvailability(){
 const canDrive=available&&capR3.test(String(w.blinkBridgeFirmwareStatus||''));
 const row=$('accS3LiveControlRow'),hint=$('accS3ControlHint');
 const pulseRow=$('accS3PulseModeRow');
 if(row)row.style.display=canDrive?'flex':'none';
 if(pulseRow)pulseRow.style.display=canDrive?'flex':'none';
 if(hint){
   hint.style.display=available&&!canDrive?'block':'none';
   if(available&&!canDrive)hint.textContent='Firmware '+String(w.blinkBridgeFirmwareStatus||'').replace('PONG ','')+
     ' không cho Blink tự đổi MAP khi đang kết nối BLE. ESP32 chỉ tự chuyển sau khi ngắt Blink và đã ARMED. Muốn đổi MAP trên điện thoại cần S3 R3/R4/R5; RPM=0 cần R4/R5.';
 }
 if(!canDrive&&$('accS3DriveLive').checked){
   $('accS3DriveLive').checked=false;resetAutoTrend();
 }
 if(!canDrive&&$('accS3PulseMode').checked){
   $('accS3PulseMode').checked=false;resetAutoTrend();
 }
}
function support(on){
 if(available===!!on){syncLiveControllerAvailability();return;}
 available=!!on;panel.hidden=!available;hasRead=false;lastSnap=null;
 resetAutoTrend();autoManualHold=false;
 $('accS3DriveLive').checked=false; // real ECU MAP control still requires explicit consent each BLE session
 // A remembered algorithm choice is inert until the user separately enables
 // connected auto-map control and the ECU is ARMED / identity verified.
 $('accS3PulseMode').checked=available&&
   capR3.test(String(w.blinkBridgeFirmwareStatus||''))&&pulsePreference;
 syncLiveControllerAvailability();
 if(!available){
   lastFault=null;const el=$('accS3LastFault');if(el)el.style.display='none';
 }
 if(!available){
   stopPad();parts.clear();
   if(ack){const p=ack;ack=null;p.reject(new Error('Mất kết nối S3 ACC'));}
   if(readPromise){const p=readPromise;readPromise=null;p.reject(new Error('Mất kết nối S3 ACC'));}
 }else{
   info('ESP32-S3 ACCS3 được phát hiện · đang đọc cấu hình...');
   if(/^PONG\s+FW2\.2\s+ACCS3$/i.test(String(w.blinkBridgeFirmwareStatus||''))){
     retainFault('FW2.2 ACCS3','Đây là firmware S3 đời đầu. Bản này có lỗi AUTO tự tắt khi Blink đang chọn MAP khác MAP thường. Cần nạp ACCS3R2 trên ESP32-S3, chỉ cập nhật Blink không sửa được.');
   }
 }
 lock(false);
}
function onStatus(s){
 s=String(s||'').trim();
 if(/^PONG\b/i.test(s))support(cap.test(s));
 if(!available||!s.startsWith('ACC:'))return;
 logEvent(s);
 if(fatalCodes[s])retainFault(s,fatalCodes[s]);
 else if(s.startsWith('ACC:BAD_'))retainFault(s,'ESP32 từ chối lệnh; hãy kiểm tra cấu hình.');
 if(ack){
   if(s===ack.ok){const t=ack;ack=null;t.resolve();}
   else if(/^ACC:(?:BAD_|OFF_FIRST|CAL_FIRST|AUTH_FIRST|ECU_REJECT|CMD_BUSY|MAP_CONFLICT|MAP_VERIFY|TPS_RANGE|APP_WRITE|APP_MAP)/.test(s)){
     const t=ack;ack=null;t.reject(new Error(s));
   }
 }
 if(s==='ACC:APP_MAP')info('Firmware ACCS3 đời đầu đã tự tắt vì MAP Blink không trùng MAP thường. Nạp FW2.2 ACCS3R2 để sửa.',true);
 if(s==='ACC:APP_WRITE')info('AUTO đã tắt vì Blink đang ghi/khôi phục dữ liệu ECU.');
 if(s==='ACC:APP_PAUSED')info('Blink đang kết nối: tạm ngừng tự chuyển MAP, app ưu tiên quyền điều khiển.');
 if(s==='ACC:MAP_BOOST')info('ESP32 vừa xác nhận MAP tăng tốc.');
 if(s==='ACC:MAP_NORMAL')info('ESP32 vừa xác nhận MAP thường.');
}
w.onBlinkStatus=function(s){try{previous?.(s);}finally{onStatus(s);}};
function xorOk(v){let n=0x5d;for(let i=0;i<v.byteLength-1;i++)n^=v.getUint8(i);return n===v.getUint8(v.byteLength-1);}
function mapPacket(e){
 if(!available)return;
 const d=e.target.value;if(!d||(d.byteLength!==18&&d.byteLength!==16))return;
 const v=new DataView(d.buffer,d.byteOffset,d.byteLength);
 if(v.getUint8(0)!==0xB3||v.getUint8(1)!==1||!xorOk(v))return;
 const seq=v.getUint8(2),part=v.getUint8(3);
 if((part===0&&d.byteLength!==18)||(part===1&&d.byteLength!==16)||part>1)return;
 let p=parts.get(seq);if(!p){p={t:Date.now()};parts.set(seq,p);}
 p[part]=v;
 for(const [key,val] of parts)if(Date.now()-val.t>4500)parts.delete(key);
 if(!p[0]||!p[1])return;parts.delete(seq);
 const a=p[0],b=p[1],f=a.getUint8(4);
 const s={enabled:!!(f&1),ready:!!(f&2),boost:!!(f&4),fault:!!(f&8),
  cal:!!(f&16),pinned:!!(f&32),
  Base:a.getUint8(5),Boost:a.getUint8(6),Tps:a.getUint8(7),
  Rise:a.getUint8(8),High:a.getUint8(9),Back:a.getUint8(10),
  Rpm:a.getUint16(11,true),Hold:a.getUint16(13,true),BackMs:a.getUint16(15,true),
  Dwell:b.getUint16(4,true),IdleMv:b.getUint16(6,true),
  WideMv:b.getUint16(8,true),ecuMap:b.getUint8(10),
  liveRpm:b.getUint16(11,true),liveMv:b.getUint16(13,true)};
 if(s.Base<1||s.Base>4||s.Boost<1||s.Boost>4||s.Base===s.Boost||s.Rpm<0||
    s.Rpm>15000||s.IdleMv<200||s.WideMv<3000||s.WideMv-s.IdleMv<2000)return;
 hasRead=true;lastSnap=s;
 if(s.enabled&&s.ready&&s.boost&&!autoBoostSince)autoBoostSince=performance.now();
 if(!s.enabled){resetAutoTrend();autoLastMap=0;}
 if(!busy)paint(s);
 if(readPromise){const p=readPromise;readPromise=null;p.resolve(s);}
}
function paint(s){
 ids.forEach(k=>{$('accS3'+k).value=String(s[k]);});
 const drive=capR3.test(String(w.blinkBridgeFirmwareStatus||''))&&
   $('accS3DriveLive').checked&&$('accS3Safety').checked&&!autoManualHold;
 const phase=!s.enabled?'ĐANG TẮT':
   !s.ready?'ĐÃ BẬT · CHỜ XÁC THỰC ECU VÀ RPM=0':
   w.blinkCommandChar
     ?drive?'ĐÃ BẬT · BLINK TỰ CHUYỂN MAP KHI ĐỦ ĐIỀU KIỆN'
       :'ĐÃ BẬT · ĐANG NHƯỜNG QUYỀN MAP CHO BLINK'
     :s.boost?'ĐANG CHẠY MAP TĂNG TỐC':'ĐANG CHẠY MAP THƯỜNG';
 const offset=s.liveRpm<=10&&s.liveMv>0&&s.IdleMv>s.liveMv+100?
   ' · CHÚ Ý: TPS LIVE THẤP HƠN TPS ĐÓNG '+(s.IdleMv-s.liveMv)+'mV, NÊN HỌC LẠI TPS':'';
 info('AUTO ACCEL: '+phase+' · ECU MAP '+(s.ecuMap||'?')+
   ' · RPM '+s.liveRpm+' · TPS '+s.liveMv+'mV · CAL '+(s.cal?'OK':'CHƯA')+
   (s.fault?' · CÓ LỖI':'')+offset);
}
// Optional client-side controller: the S3 R3 keeps autonomous UART OFF
// while BLE is linked, so Blink itself uses the same stored TPS/RPM thresholds.
// Only a fresh verified ECU 0x5A may authorize an on-screen MAP change.
// Pulse boost: keep MAP2 for sustained/high demand, but release a verified
// short acceleration pulse once moderate TPS and RPM have settled.
function accelTpsSteady(samples,now,tps,rpm,highTps){
 if(tps>Math.min(40,highTps-5))return false;
 let loT=tps,hiT=tps,loR=rpm,hiR=rpm,covered=false;
 for(let i=samples.length-1;i>=0;i--){
   const p=samples[i],age=now-p.t;
   if(age<0)return false;
   if(age>950)break;
   loT=Math.min(loT,p.tps);hiT=Math.max(hiT,p.tps);
   loR=Math.min(loR,p.rpm);hiR=Math.max(hiR,p.rpm);
   if(age>=500)covered=true;
 }
 return covered&&hiT-loT<=2&&hiR-loR<=250;
}
function accelReturnReason(cfg,now,tps,rpm,boostSince,backSince,samples){
 const boostAge=now-boostSince,backAge=backSince?now-backSince:0;
 if(tps<=3&&backSince&&backAge>=250&&boostAge>=250)
   return 'TPS ĐÓNG GA / TRẢ NHANH';
 if(boostAge<cfg.Hold)return '';
 if(backSince&&backAge>=cfg.BackMs)return 'TPS GIẢM / TRẢ MAP';
 if(accelTpsSteady(samples,now,tps,rpm,cfg.High))
   return 'GA VÀ RPM ỔN ĐỊNH / TRẢ MAP';
 return '';
}
// Explain exactly which pulse-release gate is preventing a verified MAP2
// return. Diagnostic ONLY: this never authorizes an ECU command.
function accelPulseDiagnostic(cfg,now,tps,rpm,boostSince,backSince,samples){
 const boostAge=Math.max(0,now-boostSince),backAge=backSince?now-backSince:0;
 if(tps<=3)return 'TPS đóng '+Math.min(250,Math.round(backAge))+'/250ms để xét trả nhanh.';
 if(boostAge<cfg.Hold)return 'MAP2 mới giữ '+Math.round(boostAge)+'/'+cfg.Hold+'ms.';
 if(tps<=cfg.Back)return 'TPS đã về ngưỡng '+cfg.Back+'%; trễ trả '+Math.round(backAge)+'/'+cfg.BackMs+'ms.';
 const ceiling=Math.min(40,cfg.High-5);
 if(tps>ceiling)return 'TPS '+tps+'% cao hơn ngưỡng xét ga ổn định '+ceiling+'%.';
 let loT=tps,hiT=tps,loR=rpm,hiR=rpm,covered=false,oldest=0;
 for(let i=samples.length-1;i>=0;i--){
   const p=samples[i],age=now-p.t;
   if(age<0)break;
   if(age>950)break;
   loT=Math.min(loT,p.tps);hiT=Math.max(hiT,p.tps);
   loR=Math.min(loR,p.rpm);hiR=Math.max(hiR,p.rpm);
   oldest=Math.max(oldest,age);
   if(age>=500)covered=true;
 }
 if(!covered)return 'Cần >=500ms mẫu LIVE liên tục (mới có '+Math.round(oldest)+'ms).';
 if(hiT-loT>2)return 'TPS dao động '+(hiT-loT)+' điểm %, giới hạn 2.';
 if(hiR-loR>250)return 'RPM dao động '+(hiR-loR)+' vòng trong cửa sổ, giới hạn 250.';
 return 'TPS/RPM đã ổn định. Đang chờ điều kiện xác minh chuyển MAP 1.';
}
// In opt-in pulse mode, a fast 0% -> 30% reopen can finish BEFORE the
// first 200ms sample arrives. The newest 200-400ms reference may already
// read 30%, so compare the lowest verified reference in that same window.
// Preserve original one-reference behavior outside experimental pulse mode.
function accelLowestTpsReference(samples,now){
 let reference=null;
 for(let j=samples.length-1;j>=0;j--){
   const p=samples[j],age=now-p.t;
   if(age>400)break;
   if(age>=200&&age<=400&&(!reference||p.tps<reference.tps))
     reference=p;
 }
 return reference;
}
// A repeated pulse is allowed only from a genuinely observed 0xA1 closed
// TPS sample, with bounded age; RPM and ECU 0x5A gates are checked by caller.
function accelIsVerifiedReopen(cfg,now,tps,rearmLow){
 return !!(rearmLow&&rearmLow.tps<=3&&now>=rearmLow.t&&
   now-rearmLow.t>=200&&now-rearmLow.t<=ACC_REARM_MAX_AGE_MS&&
   tps>=cfg.Tps&&tps-rearmLow.tps>=cfg.Rise);
}
function accelPulseReopenDiagnostic(cfg,now,tps,rpm,cooldownUntil,samples,highSince,rearmLow){
 const wait=Math.max(0,Math.ceil(cooldownUntil-now));
 if(wait>0)return 'MAP1: chờ '+wait+'ms khóa tái kích hoạt sau xác minh 0x5A.';
 if(rpm<cfg.Rpm)return 'MAP1: RPM '+Math.round(rpm)+' thấp hơn ngưỡng '+cfg.Rpm+'.';
 if(tps<cfg.Tps)return 'MAP1: TPS '+tps+'% chưa đạt '+cfg.Tps+'%.';
 if(accelIsVerifiedReopen(cfg,now,tps,rearmLow))
   return 'MAP1: phát hiện mở ga lại +'+(tps-rearmLow.tps)+
          ' điểm %, từ mẫu TPS đóng đã xác minh trước khi trả MAP1.';
 const ref=accelLowestTpsReference(samples,now);
 if(ref){
   const delta=tps-ref.tps;
   if(delta>=cfg.Rise)return 'MAP1: đã có xung TPS +'+delta+' điểm %, đang xét lệnh ECU.';
   return 'MAP1: TPS tăng '+delta+'/'+cfg.Rise+' điểm % trong cửa sổ 200-400ms.';
 }
 if(highSince)return 'MAP1: chờ TPS '+cfg.High+'% duy trì '+cfg.Dwell+'ms hoặc mẫu mở nhanh.';
 return 'MAP1: chưa có mẫu TPS đối chiếu 200-400ms; cú vặn quá nhanh có thể bị bỏ lỡ nếu LIVE gián đoạn.';
}
function resetAutoTrend(){
 autoSamples=[];autoHighSince=0;autoBackSince=0;
 autoLastSampleAt=0;autoBoostSince=0;autoLastMap=0;autoRearmLow=null;
}
function liveProof(message,isError=false){
 const el=$('accS3LiveProof');
 if(el){el.textContent=String(message);el.style.color=isError?'#ffb09e':'';}
}
function onManualMapSelection(bank){
 if(!available||!lastSnap?.enabled)return;
 autoManualHold=true;$('accS3DriveLive').checked=false;resetAutoTrend();
 logEvent('BLINK: Người dùng tự chọn MAP '+bank+' · dừng AUTO trên app');
 const again=capR3.test(String(w.blinkBridgeFirmwareStatus||''))?
   'Để cho phép tự chuyển tiếp, tích lại CHO BLINK TỰ CHUYỂN MAP KHI KẾT NỐI.':
   'FW S3 R1/R2 chỉ tự đổi MAP sau khi ngắt BLE.';
 liveProof('Đã ưu tiên MAP người dùng chọn. AUTO trên Blink tạm dừng. '+again+
   ' Bấm TẮT AUTO ACCEL nếu muốn dừng cả ESP32.',true);
}
function onVerifiedLive(sample){
 if(!available)return;
 const now=Number(sample?.receivedAt),rpm=Number(sample?.rpm),mv=Number(sample?.tpsMv);
 if(!Number.isFinite(now)||!Number.isFinite(rpm)||!Number.isFinite(mv)||
    rpm<0||rpm>20000||mv<0||mv>5000)return;
 const cfg=lastSnap,api=w.BlinkRealProtocol;
 const pulseDiag=$('accS3PulseDiag');
 if(pulseDiag){
   const capOk=capR3.test(String(w.blinkBridgeFirmwareStatus||''));
   const pulseOn=$('accS3PulseMode').checked;
   const driveOn=$('accS3DriveLive').checked;
   let reason=!capOk?'Firmware chưa hỗ trợ điều khiển khi kết nối.':
      !pulseOn?'Chưa bật THỬ NGHIỆM: TRẢ MAP KHI GA ỔN ĐỊNH / NHẢ GA NHANH.':
      !driveOn?'Chưa bật CHO BLINK TỰ CHUYỂN MAP KHI KẾT NỐI.':
      autoManualHold?'Đang dừng vì đã chọn MAP thủ công.':
      !$('accS3Safety').checked?'Chưa xác nhận an toàn.':
      !cfg?.enabled?'AUTO ESP32 đang TẮT.':
      cfg?.fault?'ESP32 báo lỗi AUTO.':
      !cfg?.ready?'AUTO chưa ARMED (cần xác thực ECU khi máy dừng).':
      cfg.Rpm===0&&rpm>10?'RPM=0 chỉ TEST khi máy dừng.':
      'Đã bật chế độ xung ga; chờ dữ liệu ECU MAP.';
   pulseDiag.textContent='CHẨN ĐOÁN TRẢ MAP: '+reason;
 }
 // Diagnostic only: show validated ECU 0xA1 measurements even if switching
 // is paused. Do not bypass any MAP-safety gates below.
 if(!lastWatchMs||now-lastWatchMs>=250||now<lastWatchMs){
   lastWatchMs=now;
   const el=$('accS3LiveWatch');
   if(el){
     const pct=cfg&&cfg.WideMv>cfg.IdleMv?
       Math.max(0,Math.min(100,(mv-cfg.IdleMv)*100/(cfg.WideMv-cfg.IdleMv))):NaN;
     let why='Đang xét TPS mở nhanh / giữ TPS cao đủ thời gian.';
     if(!capR3.test(String(w.blinkBridgeFirmwareStatus||'')))why='S3 R1/R2 chỉ tự chuyển sau khi ngắt BLE.';
     else if(autoManualHold)why='Đã chọn MAP thủ công; tích lại CHO BLINK TỰ CHUYỂN MAP.';
     else if(!$('accS3DriveLive').checked)why='Chưa tích CHO BLINK TỰ CHUYỂN MAP KHI KẾT NỐI.';
     else if(!$('accS3Safety').checked)why='Chưa xác nhận điều kiện thử an toàn.';
     else if(!cfg?.enabled)why='AUTO ESP32 đang TẮT.';
     else if(cfg.fault)why='ESP32 báo lỗi AUTO.';
     else if(!cfg.ready)why='ESP32 chưa ARMED.';
     else if(cfg.Rpm===0&&rpm>10)why='RPM=0 chỉ dùng khi máy dừng.';
     else if(rpm<cfg.Rpm)why='RPM chưa đạt '+cfg.Rpm+'.';
     else if(Number.isFinite(pct)&&pct<cfg.Tps)why='TPS chưa đạt '+cfg.Tps+'%.';
     el.textContent='ECU LIVE 0xA1 · RPM '+Math.round(rpm)+' · TPS '+Math.round(mv)+'mV'+
       (Number.isFinite(pct)?' ('+Math.round(pct)+'%)':'')+' · '+why;
   }
 }
 if(!capR3.test(String(w.blinkBridgeFirmwareStatus||''))||
   !$('accS3DriveLive').checked||!$('accS3Safety').checked||
   autoManualHold||autoTransitionBusy||busy)return;
 if(!cfg?.enabled||!cfg.ready||cfg.fault||cfg.WideMv<=cfg.IdleMv||
    !api?.switchS3AutoMapVerified||api.manualIoActive||api.isBusy||
    api.s3AutoMapBusy||api.otaPaused||api.diagnostics?.mapReadOnly)return;
 // RPM trigger zero is a laboratory setting: do NOT auto-switch a running
 // engine if a user forgets to restore the normal RPM threshold.
 if(cfg.Rpm===0 && rpm>10){resetAutoTrend();return;}
 const physical=Number(api.handshake?.activeMap),wire=Number(api.diagnostics?.wireMap);
 if(!Number.isInteger(physical)||physical!==wire||
    ![cfg.Base,cfg.Boost].includes(physical)){
   liveProof('MAP ECU chưa được xác minh 0x5A trong cặp đã thiết lập. Không tự đổi.',true);
   return;
 }
 const pulseEnabled=$('accS3PulseMode').checked===true;
 if(autoLastMap!==physical){resetAutoTrend();autoLastMap=physical;if(physical===cfg.Boost)autoBoostSince=now;}
 if(autoRearmLow&&(now<autoRearmLow.t||now-autoRearmLow.t>ACC_REARM_MAX_AGE_MS))
   autoRearmLow=null;
 if(autoLastSampleAt&&(now-autoLastSampleAt>650||now<autoLastSampleAt)){
   // Only a real, short-lived TPS<=3% sample survives the LIVE gap caused by
   // the verified MAP2->MAP1 transaction. Never invent a fresh low sample.
   const low=pulseEnabled&&physical===cfg.Base?autoRearmLow:null;
   resetAutoTrend();autoLastMap=physical;autoRearmLow=low;
   if(physical===cfg.Boost)autoBoostSince=now;
 }
 autoLastSampleAt=now;
 const pct=Math.max(0,Math.min(100,(mv-cfg.IdleMv)*100/(cfg.WideMv-cfg.IdleMv)));
 const rounded=Math.round(pct);
 let prior=null;
 for(let j=autoSamples.length-1;j>=0;j--){
   const age=now-autoSamples[j].t;
   if(age>=200&&age<=400){prior=autoSamples[j];break;}
 }
 autoSamples.push({t:now,tps:rounded,rpm});
 if(autoSamples.length>32)autoSamples.shift();
 if(rounded>=cfg.High){if(!autoHighSince)autoHighSince=now;}else autoHighSince=0;
 const riseReference=pulseEnabled?accelLowestTpsReference(autoSamples,now):prior;
 const fast=riseReference!==null&&rounded>=cfg.Tps&&rounded-riseReference.tps>=cfg.Rise;
 const verifiedReopen=!!(pulseEnabled&&physical===cfg.Base&&
   accelIsVerifiedReopen(cfg,now,rounded,autoRearmLow));
 const high=autoHighSince>0&&now-autoHighSince>=cfg.Dwell;
 if(pulseDiag&&pulseEnabled){
   const mode=physical===cfg.Boost?'MAP '+cfg.Boost+' (tăng tốc)':'MAP '+cfg.Base+' (thường)';
   pulseDiag.textContent='CHẨN ĐOÁN TRẢ MAP: '+mode+' · '+
     (physical===cfg.Boost?
        accelPulseDiagnostic(cfg,now,rounded,rpm,autoBoostSince,autoBackSince,autoSamples):
        accelPulseReopenDiagnostic(cfg,now,rounded,rpm,
                                   autoCooldownUntil,autoSamples,autoHighSince,autoRearmLow));
 }
 let target=0,reason='';
 if(physical===cfg.Base){
   if(now>=autoCooldownUntil&&rpm>=cfg.Rpm&&(fast||verifiedReopen||high)){
     target=cfg.Boost;
     reason=verifiedReopen?'TPS MỞ LẠI SAU XÁC MINH MAP1':
            fast?'TPS MỞ NHANH':'TPS CAO GIỮ';
   }
 }else{
   if(!autoBoostSince)autoBoostSince=now;
   if(pulseEnabled){
     if(rounded<=cfg.Back){
       if(!autoBackSince)autoBackSince=now;
     }else autoBackSince=0;
     reason=accelReturnReason(cfg,now,rounded,rpm,
                              autoBoostSince,autoBackSince,autoSamples);
     if(reason)target=cfg.Base;
   }else if(now-autoBoostSince>=cfg.Hold&&rounded<=cfg.Back){
     // Legacy behavior remains unchanged unless pulse mode was opted into.
     if(!autoBackSince)autoBackSince=now;
     if(now-autoBackSince>=cfg.BackMs){
       target=cfg.Base;reason='TPS GIẢM / TRẢ MAP';
     }
   }else autoBackSince=0;
 }
 if(!target||target===physical)return;
 autoTransitionBusy=true;autoCooldownUntil=now+1200;
 logEvent('BLINK: ĐỀ NGHỊ MAP '+physical+' → MAP '+target+' · '+reason+
   ' · TPS '+rounded+'% · RPM '+Math.round(rpm));
 liveProof('Đang gửi ECU 0x69, chờ đọc lại 0x5A · MAP '+physical+' → '+target+'...');
 Promise.resolve(api.switchS3AutoMapVerified(target)).then(result=>{
   if(!result?.verified||result.map!==target)throw new Error('ECU chưa xác minh đúng MAP mới bằng 0x5A.');
   lastSnap={...lastSnap,ecuMap:target,boost:target===cfg.Boost};
   resetAutoTrend();autoLastMap=target;
   const verifiedAt=performance.now();
   autoCooldownUntil=verifiedAt+(target===cfg.Boost||!pulseEnabled?1200:180);
   if(target===cfg.Boost)autoBoostSince=verifiedAt;
   else if(pulseEnabled){
     // The prior TPS value came from a real 0xA1 sample at "now", NOT from
     // the later 0x5A verification time. Retain only a recent fully closed
     // sample. It expires after 900ms and still requires NEW verified LIVE
     // TPS/RPM, the existing RPM/Rise gates and the ECU 0x5A authority.
     if(rounded<=3 && verifiedAt>=now &&
        verifiedAt-now<=ACC_REARM_MAX_AGE_MS){
       autoRearmLow={t:now,tps:rounded,rpm};
       autoSamples=[{t:now,tps:rounded,rpm}];
       logEvent('BLINK: MAP1 ĐÃ XÁC MINH · giữ chứng cứ TPS '+rounded+
         '% từ LIVE thật ('+Math.round(verifiedAt-now)+'ms trước) tối đa 900ms để xét cú mở ga lại.');
     }
     autoLastSampleAt=verifiedAt;
   }
   const msg='ĐÃ CHUYỂN THẬT · MAP '+physical+' → MAP '+target+
     ' · ECU 0x5A XÁC NHẬN · '+new Date().toLocaleTimeString('vi-VN');
   liveProof(msg);logEvent(msg);
   if(!busy)paint(lastSnap);
 }).catch(e=>{
   resetAutoTrend();autoManualHold=true;$('accS3DriveLive').checked=false;
   const desc=String(e?.message||e);
   retainFault('ACC:APP_VERIFY','Không xác minh được MAP sau tự chuyển: '+desc+
     '. Đã ngừng AUTO ở Blink, kiểm tra MAP ECU trước khi thử lại.');
   logEvent('AUTO BLINK DỪNG: '+desc);
   liveProof('LỖI CHUYỂN MAP · '+desc,true);
 }).finally(()=>{autoTransitionBusy=false;});
}
async function withBridgeSlot(task){
 const api=w.BlinkRealProtocol;
 if(api?.manualIoActive)throw new Error('Có tác vụ đọc/ghi ECU đang thực hiện.');
 let ctx=null;
 try{
  if(api?.handshake && typeof api.beginManualMapIo==='function'){
   ctx=await api.beginManualMapIo('ACCEL MAP S3',{silentStatus:true});
  }
  return await task();
 }finally{
  if(ctx&&typeof api.endManualMapIo==='function')api.endManualMapIo(ctx);
 }
}
async function send(cmd){
 if(!available||!cap.test(String(w.blinkBridgeFirmwareStatus||''))||
    !w.blinkCommandChar||!w.blinkMapChar||!w.blinkWriteCommand)
   throw new Error('ESP32 firmware này không hỗ trợ AUTO ACCEL.');
 const api=w.BlinkRealProtocol;
 if(api&&(api.isBusy||api.otaPaused))throw new Error('ECU đang đọc/ghi; thử lại khi rảnh.');
 // Bluefy's write-without-response shim may send successfully but leave
 // the returned Promise unresolved. Match Blink's proven PING safe-start;
 // correctness still depends on the explicit ACC ACK / B3 readback below.
 const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||
   (/Macintosh/i.test(navigator.userAgent)&&Number(navigator.maxTouchPoints)>1);
 if(ios&&typeof w.blinkCommandChar.writeValueWithoutResponse==='function'){
   const bytes=new TextEncoder().encode(cmd);
   if(bytes.length>64)throw new Error('ACC command quá dài.');
   const p=w.blinkCommandChar.writeValueWithoutResponse(bytes);
   if(p&&typeof p.catch==='function')p.catch(()=>{});
   await new Promise(res=>setTimeout(res,45));
 }else await w.blinkWriteCommand(cmd);
}
function command(cmd,ok){
 if(ack)return Promise.reject(new Error('Đang có lệnh chờ phản hồi.'));
 return new Promise((resolve,reject)=>{
   const wait={ok,resolve:()=>{clearTimeout(timer);resolve();},reject:e=>{clearTimeout(timer);reject(e);}};
   const timer=setTimeout(()=>{if(ack===wait){ack=null;reject(new Error('Thiếu ACK: '+cmd));}},4000);
   ack=wait;
   send(cmd).catch(e=>{if(ack===wait){ack=null;wait.reject(e);}});
 });
}
function get(){
 if(readPromise)return Promise.reject(new Error('Đang đọc cấu hình.'));
 return new Promise((resolve,reject)=>{
   const wait={resolve:s=>{clearTimeout(timer);resolve(s);},reject:e=>{clearTimeout(timer);reject(e);}};
   const timer=setTimeout(()=>{if(readPromise===wait){readPromise=null;reject(new Error('Thiếu 2 khung đọc lại ACC'));}},8000);
   readPromise=wait;
   send('ACC GET').catch(e=>{if(readPromise===wait){readPromise=null;wait.reject(e);}});
 });
}
async function read(quiet){
 if(busy)return;
 lock(true);
 try{const s=await withBridgeSlot(()=>get());paint(s);return s;}catch(e){if(!quiet)info('ĐỌC LỖI: '+e.message,true);throw e;}
 finally{lock(false);}
}
function getValues(){
 const o={};
 for(const [k,,limits] of specs){
   const input=$('accS3'+k),raw=String(input.value).trim();
   if(!/^[0-9]+$/.test(raw))throw new Error('Cần nhập số nguyên: '+k);
   const n=Number(raw),[min,max]=limits.split(':').map(Number);
   if(n<min||n>max)throw new Error(k+' chỉ nhận '+min+'–'+max);
   o[k]=n;
 }
 if(o.Rpm===0&&!capR4.test(String(w.blinkBridgeFirmwareStatus||'')))
   throw new Error('RPM = 0 cần firmware ESP32-S3 ACCS3R4/R5. R3 trở xuống chỉ nhận RPM từ 1000.');
 if(o.Base===o.Boost)throw new Error('Hai MAP phải khác nhau.');
 if(o.Back>=o.Tps)throw new Error('TPS trả về phải thấp hơn TPS kích hoạt.');
 if(o.High<o.Tps)throw new Error('TPS cao phải lớn hơn hoặc bằng TPS kích hoạt.');
 if(o.WideMv-o.IdleMv<2000)throw new Error('TPS MIN/MAX cách nhau tối thiểu 2000 mV.');
 return o;
}
// ESP32 validates every threshold command against its CURRENT saved neighbors.
// Keep BACK < TPS <= HIGH valid at every intermediate step (not just at the end).
function orderedAccelTpsSteps(current,next){
 if(!current||![current.Back,current.Tps,current.High].every(Number.isInteger))
   throw new Error('Chưa đọc đủ 3 ngưỡng TPS hiện tại từ ESP32.');
 if(!(current.Back<current.Tps&&current.Tps<=current.High))
   throw new Error('Ngưỡng TPS trong ESP32 đang không hợp lệ. Hãy kiểm tra trước khi lưu.');
 const highFirst=Math.max(current.High,next.High,next.Tps);
 const backFirst=Math.min(current.Back,next.Back);
 const steps=[];
 const set=(field,value)=>steps.push(['ACC '+field+' '+value,'ACC:SET_OK']);
 if(highFirst!==current.High)set('HIGH',highFirst);
 if(backFirst!==current.Back)set('BACK',backFirst);
 if(next.Tps!==current.Tps)set('TPS',next.Tps);
 if(next.Back!==backFirst)set('BACK',next.Back);
 if(next.High!==highFirst)set('HIGH',next.High);
 return steps;
}
async function save(){
 if(busy)return;
 let data;try{data=getValues();}catch(e){info(e.message,true);return;}
 if(!hasRead){info('Hãy bấm ĐỌC trước khi lưu.',true);return;}
 if(lastSnap.enabled){info('Tắt AUTO trước khi đổi thông số.',true);return;}
 lock(true);
 try{
  await withBridgeSlot(async()=>{
   // Read a fresh saved snapshot without repainting the user's unsaved fields.
   const current=await get();
   if(current.enabled)throw new Error('Tắt AUTO trước khi thay đổi thiết lập.');
   const steps=[
    ['ACC CAL '+data.IdleMv+' '+data.WideMv,'ACC:CAL_OK'],
    ['ACC MAP '+data.Base+' '+data.Boost,'ACC:MAPS_OK'],
    ['ACC RPM '+data.Rpm,'ACC:SET_OK'],
    ...orderedAccelTpsSteps(current,data),
    ['ACC RISE '+data.Rise,'ACC:SET_OK'],
    ['ACC DWELL '+data.Dwell,'ACC:SET_OK'],
    ['ACC HOLD '+data.Hold,'ACC:SET_OK'],
    ['ACC BACKMS '+data.BackMs,'ACC:SET_OK']];
   for(let i=0;i<steps.length;i++){info('Đang lưu '+(i+1)+'/'+steps.length+'...');await command(...steps[i]);}
   const stored=await get();
   if(!ids.every(k=>stored[k]===data[k]))throw new Error('ESP32 đọc lại không khớp, hãy đọc và kiểm tra.');
   paint(stored);info('ĐÃ LƯU VÀ XÁC MINH 12 THÔNG SỐ · AUTO vẫn tắt.');
  });
 }catch(e){info('LƯU LỖI: '+e.message+' · Bấm ĐỌC để đối chiếu.',true);}
 finally{lock(false);}
}
async function switchAuto(on){
 if(busy||!hasRead)return;
 if(on&&/^PONG\s+FW2\.2\s+ACCS3$/i.test(String(w.blinkBridgeFirmwareStatus||''))){
   retainFault('FW2.2 ACCS3','Không bật AUTO từ Blink với firmware S3 đời đầu vì lỗi tự tắt/MAP xung đột. Nạp ACCS3R2 rồi kết nối lại.');
   return;
 }
 if(on&&!$('accS3Safety').checked){info('Chưa xác nhận an toàn và động cơ đang dừng.',true);return;}
 if(on&&!lastSnap.cal){info('Phải hiệu chuẩn TPS và lưu trước khi bật.',true);return;}
 lock(true);
 try{
  await withBridgeSlot(async()=>{
   await command(on?'ACC ON':'ACC OFF',on?'ACC:WAIT_ZERO':'ACC:OFF');
   const s=await get();
   paint(s);
   if(s.enabled!==on){
     const reason=lastFault?.code?(' · '+lastFault.code+' · '+lastFault.reason):' · Mở NHẬT KÝ AUTO ACCEL để xem phản hồi.';
     retainFault('ACC:VERIFY_OFF','Đã gửi '+(on?'BẬT':'TẮT')+' nhưng ESP32 đọc lại không khớp'+reason);
     throw new Error('ESP32 không xác nhận bật/tắt'+reason);
   }
  });
 }catch(e){info('BẬT/TẮT LỖI: '+e.message,true);}
 finally{lock(false);}
}
for(const k of ids.slice(2)){
 $('accS3'+k).addEventListener('click',e=>{
   if(!available||busy)return;padField=e.currentTarget;
   showPad(padField);
 });
}
padNode.querySelectorAll('[data-acc-key]').forEach(b=>b.addEventListener('click',()=>{
 const key=b.dataset.accKey;if(key==='ẨN'){stopPad();return;}
 if(!padField)return;let v=padField.value;
 if(key==='C')v='';else if(key==='⌫')v=v.slice(0,-1);
 else if(v.length<6)v+=key;
 padField.value=v;$('accS3PadValue').textContent=v||'0';
}));
padToggle.onclick=()=>{if(padVisible())stopPad();else showPad(padField||$('accS3Rpm'));};
panel.addEventListener('toggle',syncPadToggle);
$('accS3UseTps').onclick=()=>{
 const a=Number($('tpsMin')?.value),b=Number($('tpsMax')?.value);
 if(!Number.isFinite(a)||!Number.isFinite(b)||a<.2||a>2||b<3||b>5||b-a<2){
   info('TPS Blink chưa được học MIN/MAX hợp lệ.',true);return;
 }
 $('accS3IdleMv').value=Math.round(a*1000);
 $('accS3WideMv').value=Math.round(b*1000);
 info('Đã điền TPS từ Blink. Bấm LƯU để gửi sang ESP32-S3.');
};
$('accS3Read').onclick=()=>{void read(false).catch(()=>{});};
$('accS3Save').onclick=()=>{stopPad();void save();};
$('accS3On').onclick=()=>{stopPad();void switchAuto(true);};
$('accS3Off').onclick=()=>{stopPad();void switchAuto(false);};
$('accS3DriveLive').onchange=()=>{
 autoManualHold=false;resetAutoTrend();
 if($('accS3DriveLive').checked&&(!$('accS3Safety').checked||
    !capR3.test(String(w.blinkBridgeFirmwareStatus||'')))){
   $('accS3DriveLive').checked=false;
   liveProof('Phải có FW ACCS3R3/R4/R5 và đã xác nhận MAP an toàn ở trên.',true);return;
 }
 liveProof($('accS3DriveLive').checked?
   'BLINK TỰ CHUYỂN ĐÃ CHỌN · Chờ AUTO ARMED, RPM/TPS hợp lệ.':
   'ĐÃ TẮT CHUYỂN MAP TỰ ĐỘNG TRONG BLINK.');
 if(lastSnap)paint(lastSnap);
};
$('accS3PulseMode').onchange=()=>{
 resetAutoTrend();
 if($('accS3PulseMode').checked&&
    (!$('accS3Safety').checked||
     !capR3.test(String(w.blinkBridgeFirmwareStatus||'')))){
   $('accS3PulseMode').checked=false;
   liveProof('Chỉ được thử xung ga với S3 R3/R4/R5 và khi đã xác nhận an toàn.',true);
   return;
 }
 savePulsePreference($('accS3PulseMode').checked);
 liveProof($('accS3PulseMode').checked?
   'ĐÃ LƯU DẤU TÍCH THỬ NGHIỆM TRÊN TRÌNH DUYỆT · chờ bật riêng quyền Blink tự chuyển MAP và xác minh ECU. Không thử trên đường.':
   'CHẾ ĐỘ XUNG GA THỬ NGHIỆM ĐÃ TẮT: dùng điều kiện trả MAP cũ.');
 if(lastSnap)paint(lastSnap);
};
$('accS3ClearLog').onclick=()=>{
 events.length=0;lastFault=null;
 $('accS3Log').textContent='';$('accS3LastFault').style.display='none';
};
function update(){
 const mc=w.blinkMapChar||null;
 if(attached!==mc){
  if(attached)try{attached.removeEventListener('characteristicvaluechanged',mapPacket);}catch(_e){}
  attached=mc;hasRead=false;lastSnap=null;
  if(mc)mc.addEventListener('characteristicvaluechanged',mapPacket);
 }
 const okay=!!mc&&!!w.blinkCommandChar&&cap.test(String(w.blinkBridgeFirmwareStatus||''));
 if(!okay){support(false);syncPadToggle();return;}
 support(true);syncPadToggle();
 if(!hasRead&&!busy&&!readPromise&&Date.now()-lastTry>6500){
  lastTry=Date.now();void read(true).catch(()=>{});
 }
}
w.BlinkAccelSettings={get supported(){return available;},get snapshot(){return lastSnap?{...lastSnap}:null;},read,onVerifiedLive,onManualMapSelection};
setInterval(update,650);
update();
})(window);
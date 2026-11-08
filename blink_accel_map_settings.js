/* BLINK ACCS3: optional ESP32-S3 acceleration MAP setup.
   Legacy firmware: no marker, no visible UI, no ACC commands. */
(function(w){
'use strict';
const $=id=>document.getElementById(id);
const host=$('settingsScreen');
if(!host)return;
const cap=/^PONG\s+FW2\.2\s+ACCS3(?:R2|R3|R4)?$/i;
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
'<div class="tuneSettingHelp">S3 R3/R4: Blink tự chuyển MAP theo TPS/RPM khi BLE kết nối nếu bật công tắc cho phép; phải xác minh ECU 0x5A rồi mới đổi MAP hiển thị. R4 cho phép RPM=0 để test máy dừng. Ngắt Blink thì ESP32 tự xử lý. Chỉ REDLEO 9.1x/9.2x; MAP phun/lửa phải an toàn.</div>',
'<div class="settingsGrid tuneSettingsGrid">'+fields+'</div>',
'<div class="tuneSettingHelp" style="color:#ffc37c">RPM = 0 chỉ để TEST khi máy dừng, khóa điện bật. Thử xong đặt lại ngưỡng RPM an toàn trước khi chạy xe.</div>',
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
'<label class="toggleItem" id="accS3LiveControlRow" style="margin:10px 0;display:none;align-items:flex-start;gap:8px"><input type="checkbox" id="accS3DriveLive"><span><b>CHO BLINK TỰ CHUYỂN MAP KHI KẾT NỐI</b> · Chỉ S3 R3/R4. Cần bật thủ công mỗi phiên và xác nhận an toàn.</span></label>',
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
const capR3=/^PONG\s+FW2\.2\s+ACCS3(?:R3|R4)$/i;
const capR4=/^PONG\s+FW2\.2\s+ACCS3R4$/i;
let autoSamples=[],autoHighSince=0,autoBackSince=0,autoBoostSince=0;
let autoLastSampleAt=0,autoCooldownUntil=0,autoTransitionBusy=false,autoManualHold=false;
let autoLastMap=0;
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
function support(on){
 if(available===!!on)return;
 available=!!on;panel.hidden=!available;hasRead=false;lastSnap=null;
 resetAutoTrend();autoManualHold=false;
 const driveRow=$('accS3LiveControlRow');
 if(driveRow)driveRow.style.display=on&&capR3.test(String(w.blinkBridgeFirmwareStatus||''))?'flex':'none';
 $('accS3DriveLive').checked=false; // explicit opt-in each BLE session
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
function resetAutoTrend(){
 autoSamples=[];autoHighSince=0;autoBackSince=0;
 autoLastSampleAt=0;autoBoostSince=0;autoLastMap=0;
}
function liveProof(message,isError=false){
 const el=$('accS3LiveProof');
 if(el){el.textContent=String(message);el.style.color=isError?'#ffb09e':'';}
}
function onManualMapSelection(bank){
 if(!available||!lastSnap?.enabled)return;
 autoManualHold=true;$('accS3DriveLive').checked=false;resetAutoTrend();
 logEvent('BLINK: Người dùng tự chọn MAP '+bank+' · dừng AUTO trên app');
 liveProof('Đã ưu tiên MAP người dùng chọn. AUTO trên Blink tạm dừng; nếu cần dừng luôn ESP32 khi ngắt BLE, hãy bấm TẮT AUTO ACCEL.',true);
}
function onVerifiedLive(sample){
 if(!available||!capR3.test(String(w.blinkBridgeFirmwareStatus||''))||
   !$('accS3DriveLive').checked||!$('accS3Safety').checked||
   autoManualHold||autoTransitionBusy||busy)return;
 const cfg=lastSnap,api=w.BlinkRealProtocol;
 if(!cfg?.enabled||!cfg.ready||cfg.fault||
    !api?.switchS3AutoMapVerified||api.manualIoActive||api.isBusy||
    api.s3AutoMapBusy||api.otaPaused||api.diagnostics?.mapReadOnly)return;
 const now=Number(sample?.receivedAt),rpm=Number(sample?.rpm),mv=Number(sample?.tpsMv);
 if(!Number.isFinite(now)||!Number.isFinite(rpm)||!Number.isFinite(mv)||
    rpm<0||rpm>20000||mv<0||mv>5000||cfg.WideMv<=cfg.IdleMv)return;
 // RPM trigger zero is a laboratory setting: do NOT auto-switch a running
 // engine if a user forgets to restore the normal RPM threshold.
 if(cfg.Rpm===0 && rpm>10){resetAutoTrend();return;}
 const physical=Number(api.handshake?.activeMap),wire=Number(api.diagnostics?.wireMap);
 if(!Number.isInteger(physical)||physical!==wire||
    ![cfg.Base,cfg.Boost].includes(physical)){
   liveProof('MAP ECU chưa được xác minh 0x5A trong cặp đã thiết lập. Không tự đổi.',true);
   return;
 }
 if(autoLastMap!==physical){resetAutoTrend();autoLastMap=physical;if(physical===cfg.Boost)autoBoostSince=now;}
 if(autoLastSampleAt&&(now-autoLastSampleAt>650||now<autoLastSampleAt)){
   resetAutoTrend();autoLastMap=physical;
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
 autoSamples.push({t:now,tps:rounded});
 if(autoSamples.length>12)autoSamples.shift();
 if(rounded>=cfg.High){if(!autoHighSince)autoHighSince=now;}else autoHighSince=0;
 const fast=prior!==null&&rounded>=cfg.Tps&&rounded-prior.tps>=cfg.Rise;
 const high=autoHighSince>0&&now-autoHighSince>=cfg.Dwell;
 let target=0,reason='';
 if(physical===cfg.Base){
   if(now>=autoCooldownUntil&&rpm>=cfg.Rpm&&(fast||high)){
     target=cfg.Boost;reason=fast?'TPS MỞ NHANH':'TPS CAO GIỮ';
   }
 }else{
   if(!autoBoostSince)autoBoostSince=now;
   if(now-autoBoostSince>=cfg.Hold&&rounded<=cfg.Back){
     if(!autoBackSince)autoBackSince=now;
     if(now-autoBackSince>=cfg.BackMs){target=cfg.Base;reason='TPS GIẢM / TRẢ MAP';}
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
   autoCooldownUntil=performance.now()+1200;
   if(target===cfg.Boost)autoBoostSince=performance.now();
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
   throw new Error('RPM = 0 cần firmware ESP32-S3 ACCS3R4. R3 trở xuống chỉ nhận RPM từ 1000.');
 if(o.Base===o.Boost)throw new Error('Hai MAP phải khác nhau.');
 if(o.Back>=o.Tps)throw new Error('TPS trả về phải thấp hơn TPS kích hoạt.');
 if(o.High<o.Tps)throw new Error('TPS cao phải lớn hơn hoặc bằng TPS kích hoạt.');
 if(o.WideMv-o.IdleMv<2000)throw new Error('TPS MIN/MAX cách nhau tối thiểu 2000 mV.');
 return o;
}
async function save(){
 if(busy)return;
 let data;try{data=getValues();}catch(e){info(e.message,true);return;}
 if(!hasRead){info('Hãy bấm ĐỌC trước khi lưu.',true);return;}
 if(lastSnap.enabled){info('Tắt AUTO trước khi đổi thông số.',true);return;}
 lock(true);
 try{
  await withBridgeSlot(async()=>{
   const steps=[
    ['ACC CAL '+data.IdleMv+' '+data.WideMv,'ACC:CAL_OK'],
    ['ACC MAP '+data.Base+' '+data.Boost,'ACC:MAPS_OK'],
    ['ACC RPM '+data.Rpm,'ACC:SET_OK'],['ACC TPS '+data.Tps,'ACC:SET_OK'],
    ['ACC RISE '+data.Rise,'ACC:SET_OK'],['ACC HIGH '+data.High,'ACC:SET_OK'],
    ['ACC DWELL '+data.Dwell,'ACC:SET_OK'],['ACC HOLD '+data.Hold,'ACC:SET_OK'],
    ['ACC BACK '+data.Back,'ACC:SET_OK'],['ACC BACKMS '+data.BackMs,'ACC:SET_OK']];
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
   liveProof('Phải có FW ACCS3R3/R4 và đã xác nhận MAP an toàn ở trên.',true);return;
 }
 liveProof($('accS3DriveLive').checked?
   'BLINK TỰ CHUYỂN ĐÃ CHỌN · Chờ AUTO ARMED, RPM/TPS hợp lệ.':
   'ĐÃ TẮT CHUYỂN MAP TỰ ĐỘNG TRONG BLINK.');
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
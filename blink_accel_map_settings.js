/* BLINK ACCS3: optional ESP32-S3 acceleration MAP setup.
   Legacy firmware: no marker, no visible UI, no ACC commands. */
(function(w){
'use strict';
const $=id=>document.getElementById(id);
const host=$('settingsScreen');
if(!host)return;
const cap=/^PONG\s+FW2\.2\s+ACCS3(?:R2)?$/i;
// Existing Blink CSS forces .settings display:block!important; explicitly
// restore hidden semantics for firmware without the ACCS3 capability.
const style=document.createElement('style');
style.textContent='#settingsScreen #blinkAccelSettingsS3[hidden]{display:none!important}'+
 '#accS3Pad{height:auto!important;z-index:1!important;left:auto!important;right:auto!important;bottom:auto!important}';
document.head.appendChild(style);
const panel=document.createElement('details');
panel.className='settings tuneSettingsDetails';
panel.id='blinkAccelSettingsS3';
panel.hidden=true;
const specs=[
 ['Base','MAP bình thường','1:4',1],['Boost','MAP tăng tốc','1:4',2],
 ['Rpm','RPM kích hoạt','1000:15000',2500],['Tps','TPS kích hoạt (%)','10:90',35],
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
'<div class="tuneSettingHelp">Chỉ hiện với FW2.2 ACCS3 / ACCS3R2. Dùng TPS + RPM, không cần cảm biến MAP. AUTO bật nhưng tạm ngừng chuyển khi Blink còn kết nối; bản R2 đọc lại MAP ECU trước khi tự chạy. Chỉ dùng với ECU 9.1x/9.2x đã xác minh. Hai MAP phải an toàn về cả phun và đánh lửa.</div>',
'<div class="settingsGrid tuneSettingsGrid">'+fields+'</div>',
'<div class="toolrow" style="margin-top:8px">',
'<button type="button" id="accS3UseTps">LẤY TPS ĐÃ HỌC</button>',
'<button type="button" id="accS3Read" class="primary">ĐỌC TỪ ESP32</button>',
'<button type="button" id="accS3Save" class="good">LƯU VÀO ESP32</button></div>',
'<div id="accS3Pad" class="fuelKeypad" style="display:none;position:relative;inset:auto;max-width:400px;margin:9px 0;padding:8px" aria-hidden="true">',
'<div class="fuelKeypadHead"><span id="accS3PadLabel">Nhập số</span><strong id="accS3PadValue">--</strong></div>',
'<div class="fuelKeypadGrid">',
...['1','2','3','C','4','5','6','⌫','7','8','9','ẨN','0'].map((v,i)=>'<button type="button" data-acc-key="'+v+'"'+(i===12?' style="grid-column:span 4"':'')+'>'+v+'</button>'),
'</div></div>',
'<label class="toggleItem" style="margin:10px 0;display:flex;align-items:flex-start;gap:8px"><input type="checkbox" id="accS3Safety"><span>Đã kiểm tra MAP thường/tăng tốc, đánh lửa, giới hạn tua và động cơ đang dừng khi bật.</span></label>',
'<div class="toolrow"><button type="button" id="accS3On" class="good">BẬT AUTO ACCEL</button><button type="button" id="accS3Off" class="danger">TẮT AUTO ACCEL</button></div>',
'<div class="tuneSettingHelp" id="accS3State" role="status">Đang nhận diện firmware ESP32.</div>',
'<div class="tuneSettingHelp">Cài đặt lưu trên ESP32-S3. Khi Blink còn kết nối BLE, app ưu tiên MAP và AUTO tạm ngừng chuyển; ngắt kết nối Blink để ESP32 tự chuyển theo TPS/RPM. Tắt AUTO khi đang MAP tăng tốc không tự đổi về MAP thường: phải kiểm tra và chọn MAP an toàn bằng Blink.</div></div>'
].join('');
$('accS3Base'); // panel attached below
const ota=$('otaSettings');if(ota)ota.before(panel);else host.appendChild(panel);
$('accS3Base').value='1';$('accS3Boost').value='2';
const ids=specs.map(x=>x[0]);
let available=false,attached=null,lastSnap=null,hasRead=false,busy=false;
let ack=null,readPromise=null,parts=new Map(),padField=null,lastTry=0;
const previous=typeof w.onBlinkStatus==='function'?w.onBlinkStatus:null;
function info(t,error){const el=$('accS3State');if(el){el.textContent=String(t);el.style.color=error?'#ffb2a4':'';}}
function lock(on){busy=on;for(const id of ['Read','Save','On','Off','UseTps']){const el=$('accS3'+id);if(el)el.disabled=on||!available;}}
function stopPad(){padField=null;$('accS3Pad').style.display='none';$('accS3Pad').setAttribute('aria-hidden','true');}
function support(on){
 if(available===!!on)return;
 available=!!on;panel.hidden=!available;hasRead=false;lastSnap=null;
 if(!available){
   stopPad();parts.clear();
   if(ack){const p=ack;ack=null;p.reject(new Error('Mất kết nối S3 ACC'));}
   if(readPromise){const p=readPromise;readPromise=null;p.reject(new Error('Mất kết nối S3 ACC'));}
 }else info('ESP32-S3 ACCS3 được phát hiện · đang đọc cấu hình...');
 lock(false);
}
function onStatus(s){
 s=String(s||'').trim();
 if(/^PONG\b/i.test(s))support(cap.test(s));
 if(!available||!s.startsWith('ACC:'))return;
 if(ack){
   if(s===ack.ok){const t=ack;ack=null;t.resolve();}
   else if(/^ACC:(?:BAD_|OFF_FIRST|CAL_FIRST|ECU_REJECT|CMD_BUSY|MAP_VERIFY|TPS_RANGE)/.test(s)){
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
 if(s.Base<1||s.Base>4||s.Boost<1||s.Boost>4||s.Base===s.Boost||s.Rpm<1000||
    s.Rpm>15000||s.IdleMv<200||s.WideMv<3000||s.WideMv-s.IdleMv<2000)return;
 hasRead=true;lastSnap=s;
 if(!busy)paint(s);
 if(readPromise){const p=readPromise;readPromise=null;p.resolve(s);}
}
function paint(s){
 ids.forEach(k=>{$('accS3'+k).value=String(s[k]);});
 const phase=!s.enabled?'ĐANG TẮT':
   !s.ready?'ĐÃ BẬT · CHỜ XÁC THỰC ECU VÀ RPM=0':
   w.blinkCommandChar?'ĐÃ BẬT · TẠM DỪNG CHUYỂN MAP KHI BLINK KẾT NỐI':
   s.boost?'ĐANG CHẠY MAP TĂNG TỐC':'ĐANG CHẠY MAP THƯỜNG';
 const offset=s.liveRpm<=10&&s.liveMv>0&&s.IdleMv>s.liveMv+100?
   ' · CHÚ Ý: TPS LIVE THẤP HƠN TPS ĐÓNG '+(s.IdleMv-s.liveMv)+'mV, NÊN HỌC LẠI TPS':'';
 info('AUTO ACCEL: '+phase+' · ECU MAP '+(s.ecuMap||'?')+
   ' · RPM '+s.liveRpm+' · TPS '+s.liveMv+'mV · CAL '+(s.cal?'OK':'CHƯA')+
   (s.fault?' · CÓ LỖI':'')+offset);
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
 if(on&&!$('accS3Safety').checked){info('Chưa xác nhận an toàn và động cơ đang dừng.',true);return;}
 if(on&&!lastSnap.cal){info('Phải hiệu chuẩn TPS và lưu trước khi bật.',true);return;}
 lock(true);
 try{
  await withBridgeSlot(async()=>{
   await command(on?'ACC ON':'ACC OFF',on?'ACC:WAIT_ZERO':'ACC:OFF');
   const s=await get();
   paint(s);
   if(s.enabled!==on)throw new Error('ESP32 không xác nhận bật/tắt.');
  });
 }catch(e){info('BẬT/TẮT LỖI: '+e.message,true);}
 finally{lock(false);}
}
for(const k of ids.slice(2)){
 $('accS3'+k).addEventListener('click',e=>{
   if(!available||busy)return;padField=e.currentTarget;
   $('accS3PadLabel').textContent=specs.find(x=>x[0]===k)[1];
   $('accS3PadValue').textContent=padField.value;
   $('accS3Pad').style.display='block';$('accS3Pad').setAttribute('aria-hidden','false');
 });
}
panel.querySelectorAll('[data-acc-key]').forEach(b=>b.addEventListener('click',()=>{
 const key=b.dataset.accKey;if(key==='ẨN'){stopPad();return;}
 if(!padField)return;let v=padField.value;
 if(key==='C')v='';else if(key==='⌫')v=v.slice(0,-1);
 else if(v.length<6)v+=key;
 padField.value=v;$('accS3PadValue').textContent=v||'0';
}));
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
function update(){
 const mc=w.blinkMapChar||null;
 if(attached!==mc){
  if(attached)try{attached.removeEventListener('characteristicvaluechanged',mapPacket);}catch(_e){}
  attached=mc;hasRead=false;lastSnap=null;
  if(mc)mc.addEventListener('characteristicvaluechanged',mapPacket);
 }
 const okay=!!mc&&!!w.blinkCommandChar&&cap.test(String(w.blinkBridgeFirmwareStatus||''));
 if(!okay){support(false);return;}
 support(true);
 if(!hasRead&&!busy&&!readPromise&&Date.now()-lastTry>6500){
  lastTry=Date.now();void read(true).catch(()=>{});
 }
}
w.BlinkAccelSettings={get supported(){return available;},get snapshot(){return lastSnap?{...lastSnap}:null;},read};
setInterval(update,650);
update();
})(window);
/* BLINK TL - REDLEO 9.1X REAL ECU PROTOCOL
 * Source of truth: static IL analysis of ECU Pro 9.1X.exe (assembly 9.1.2.15).
 * Transport: E1/E2 raw BLE chunks via ESP32-S3 real bridge.
 * REDLEO ECU UART: 38400 8E2.
 */
(function(){
'use strict';

const TAG='[BLINK TL REAL]';
const RAW_TX=0xE1, RAW_RX=0xE2, RAW_CHUNK=12;
const READ_ALL_LEN=9767;
const VER_TIME=2, VER_ANGLE=4;
let sid=(Math.random()*220+1)|0;
let pending=new Map();
let installedChar=null;
let busy=false;
let liveTimer=null;
let liveRunning=false;
let handshakeInfo=null;
let readCache=null;
let loginState=false;
let transportCmdChar=null;
let transportMapChar=null;
let sessionInitPromise=null;
let transportEpoch=0;

const FEAT={
  'INJ degree':'inj_degree',
  'IGN degree':'ign_degree',
  'IGN Time':'ign_time',
  'ECT Comp INJ':'ect_inj',
  'ECT Comp IGN':'ect_ign',
  'MAP Comp INJ':'map_inj',
  'IAT Compensating Injection':'iat_inj',
  'Intake pressure compensation idle motor':'map_idle_motor',
  'Temperature-idle motor relationship':'ect_idle_motor',
  'External adjustment':'external_adjust',
  'Automatic clutch':'auto_clutch',
  'Spare':'spare',
  'ECT - Voltage Relation':'v_ect',
  'IAT - Voltage Relation':'v_iat',
  'MAP - Voltage Relation':'v_map'
};
const N={inj_degree:2,ign_degree:3,ign_time:4,idle_limit:5,ect_idle_motor:6,ect_inj:7,ect_ign:8,map_inj:9,iat_inj:10,map_idle_motor:11,external_adjust:12,auto_clutch:13,spare:14,v_ect:15,v_iat:16,v_map:17};

function log(...a){console.log(TAG,...a)}
function err(...a){console.error(TAG,...a)}
function clamp(v,a,b){v=Number(v);return Math.max(a,Math.min(b,Number.isFinite(v)?v:0))}
function r1(v){return Math.round(v*10)/10}
function r2(v){return Math.round(v*100)/100}
function checksum8(a,n=a.length){let s=0;for(let i=0;i<n;i++)s=(s+(a[i]&255))&255;return s}
function req5(cmd,arg){const s=(cmd+arg)&255;return new Uint8Array([cmd,arg,(255-s)&255,s,5])}
function validFrame(f){return !!f&&f.length>=3&&(((f[0]+f[f.length-1])&255)===255)&&checksum8(f,f.length-2)===f[f.length-2]}
function pageLow(bank){return [0,2,4,6,8][clamp(Math.round(bank),1,4)]}
function page(high,bank){return (high<<4)|pageLow(bank)}
function u16be(a,i){return ((a[i]<<8)|a[i+1])>>>0}
function push16be(a,v){v=clamp(Math.round(v),0,65535);a.push((v>>8)&255,v&255)}
function finalizePage(a){const s=checksum8(a);a.push((255-s)&255,s,(a.length+3)&255);return new Uint8Array(a)}
function pageFrame(pg,payload){return finalizePage([0xCD,pg,...payload])}

// ----- REDLEO conversions (EXE TrueFalse / macroReckon) -----
function decVolt(raw){return r2(raw*20/1024)}
function encVolt(v){return clamp(Math.round(Number(v)*1024/20),0,255)}
function decOil(raw){return r2((raw/20)*(64/50))} // Oil_EcuToPc(raw,1), Ver78_Time=2
function encOil(v){return clamp(Math.round(Math.max(0,Number(v))*20*(50/64)),0,255)}
function decOilTab(raw){return r2(raw/500)} // verified on REDLEO 9.1X visible INJ VE: raw/500 = ms
function encOilTab(v){return clamp(Math.round(Math.max(0,Number(v))*500),0,65535)}
function decOilAngle(raw){return Math.round(raw*2*360/256)}
function encOilAngle(v){return clamp(Math.round((Number(v)/2)*256/360),0,255)}
function decIgn(raw){return r1((raw-64)/VER_ANGLE)}
function encIgn(v){return clamp(Math.round(Number(v)*VER_ANGLE)+64,0,255)}
function decEctIgn(raw){return r1(((raw-64)/VER_ANGLE)*360/256)}
function encEctIgn(v){return clamp(Math.round((Number(v)*256/360)*VER_ANGLE)+64,0,255)}
function decPct(raw){return Math.round(raw*50/64)}
function encPct(v){return clamp(Math.round(Math.max(0,Number(v))*64/50),0,255)}
function decMapInj(raw){return Math.round((raw-100)/10)}
function encMapInj(v){return clamp(Math.round((Number(v)+10)*10),0,255)}
function decExtPct(raw){return Math.round(((raw-128)/128)*100)}
function encExtPct(v){return clamp(Math.round(Number(v)*128/100+128),0,255)}
function decExtIgn(raw){return raw-128}
function encExtIgn(v){return clamp(Math.round(Number(v)+128),0,255)}
function decSeconds(raw,factor){const x=raw*factor*5/1000;return factor===64?Math.round(x):r1(x)}
function encSeconds(sec,factor){return clamp(Math.round(Math.max(0,Number(sec))*1000/5/factor),0,255)}
function decColdStart(raw){return r1((raw*64/50)/20)}
function encColdStart(v){return clamp(Math.round(Math.max(0,Number(v))*20*50/64),0,255)}
function decAutoRpm(raw){return raw*50}
function encAutoRpm(v){return clamp(Math.round(Number(v)/50),0,255)}

function decodeRowsByte(a,off,rows,cols,dec=x=>x){
  const out=Array.from({length:rows},()=>Array(cols).fill(0));let p=off;
  for(let wr=0;wr<rows;wr++){const ur=rows-1-wr;for(let c=0;c<cols;c++)out[ur][c]=dec(a[p++]);}
  return {data:out,next:p};
}
function encodeRowsByte(m,enc=x=>x){const out=[];for(let wr=0;wr<m.length;wr++){const ur=m.length-1-wr;for(let c=0;c<m[ur].length;c++)out.push(clamp(Math.round(enc(m[ur][c])),0,255));}return out}
function decodeRowsU16(a,off,rows,cols,dec=x=>x){
  const out=Array.from({length:rows},()=>Array(cols).fill(0));let p=off;
  for(let wr=0;wr<rows;wr++){const ur=rows-1-wr;for(let c=0;c<cols;c++){out[ur][c]=dec(u16be(a,p));p+=2;}}
  return {data:out,next:p};
}
function encodeRowsU16(m,enc=x=>x){const out=[];for(let wr=0;wr<m.length;wr++){const ur=m.length-1-wr;for(let c=0;c<m[ur].length;c++)push16be(out,enc(m[ur][c]));}return out}

function ectTempToRaw(temp, vEct){
  temp=Number(temp);if(!Number.isFinite(temp))temp=0;
  const vals=vEct&&vEct.length?vEct:Array(11).fill(0);
  if(temp<=0)return encVolt(vals[0]);
  if(temp>=140)return encVolt(vals[10]);
  const idx=Math.min(9,Math.floor(temp/14));
  const t0=idx*14,t1=(idx+1)*14,v0=Number(vals[idx]),v1=Number(vals[idx+1]);
  const v=v0+(v1-v0)*(temp-t0)/(t1-t0);
  return encVolt(v);
}
function ectRawToTemp(raw,vEct){
  const v=decVolt(raw),vals=vEct&&vEct.length?vEct:Array(11).fill(0);
  // REDLEO curve is normally descending. Search adjacent pair inclusively.
  for(let i=0;i<10;i++){
    const a=Number(vals[i]),b=Number(vals[i+1]);
    if((v<=a&&v>=b)||(v>=a&&v<=b)){
      if(Math.abs(b-a)<1e-9)return i*14;
      return Math.round(i*14+(v-a)/(b-a)*14);
    }
  }
  return 140;
}

function curveVoltageToAxis(v,curve,step){
  const vals=Array.from(curve||[],Number);
  if(vals.length<2||!Number.isFinite(v))return NaN;
  for(let i=0;i<vals.length-1;i++){
    const a=vals[i],b=vals[i+1];
    if(!Number.isFinite(a)||!Number.isFinite(b))continue;
    if((v>=Math.min(a,b)&&v<=Math.max(a,b))){
      if(Math.abs(b-a)<1e-9)return i*step;
      return i*step+((v-a)/(b-a))*step;
    }
  }
  // Clamp to closest endpoint rather than extrapolate wildly.
  const d0=Math.abs(v-vals[0]),d1=Math.abs(v-vals[vals.length-1]);
  return d0<=d1?0:(vals.length-1)*step;
}
function liveVolt10(raw){return Number(raw)*5/1024}
function ascii(a,start,len){let out='';for(let i=0;i<len&&start+i<a.length;i++){const x=a[start+i];if(!x)break;if(x>=32&&x<=126)out+=String.fromCharCode(x);}return out.trim()}
function parseHandshake(a){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a);
  if(a.length<9||a[0]!==0x5A||!validFrame(a))throw new Error('Handshake 0x5A không hợp lệ · '+a.length+'B');
  const info={raw:a.slice(),short:a.length===9,activeMap:1,ecuId:1,password:null};
  if(a.length>=35){
    info.ident=ascii(a,1,16);
    info.firmware=ascii(a,17,4);
    info.date=ascii(a,21,6);
    info.classify=a[27]&15;
    info.features=a[28];
    info.sumSignal=a[29];
    info.zeroIgn=(a[30]||0)+1;
    info.zeroInj=(a[31]||0)+1;
    info.activeMap=clamp((a[33]||0)+1,1,4);
    info.ecuId=a[34]||1;
    if(a.length>=41)info.password=Array.from(a.slice(35,39));
  }
  return info;
}
function classNameFromCode(n){return ['HONDA','YAMAHA','SUZUKI','BENELLI','PIAGGIO'][n]||'OTHER'}
function syncHandshakeInfo(info){
  handshakeInfo=info;
  if(typeof state!=='undefined'){
    state.ecuConnected=true;state.ecuPhase='live';state.ecuId=info.ecuId||1;
    if(info.activeMap>=1&&info.activeMap<=4&&!state.threeRun?.active){state.activeMap=info.activeMap;const ms=document.getElementById('mapSelect');if(ms)ms.value=String(info.activeMap);}
  }
  const vals=[classNameFromCode(info.classify),info.ident||'ECU Blink','ID '+(info.ecuId||1),'Signal '+(info.sumSignal??'—'),String(info.zeroIgn??'—'),String(info.zeroInj??'—'),info.firmware||'9.1X',info.date||'—'];
  document.querySelectorAll('[data-ecuinfo]').forEach((e,i)=>e.textContent=vals[i]||'—');
  const b=document.getElementById('ecuBadge');if(b){b.textContent='ECU: REAL · MAP No.'+(info.activeMap||1)+' · ID '+(info.ecuId||1);b.className='badge ok';}
  try{syncMirrors();}catch(_e){}
}
function syncCapabilityFlags(info){
  if(!info||!Number.isFinite(info.features))return;
  // REDLEO InfoChk order from resources: ECT, IAT, O2S, Idle Motor, Solenoid, Single Stand, Starting Relay, MAP.
  const map={idleMotor:3,solenoid:4,sideStand:5,startRelay:6};
  for(const[k,bit] of Object.entries(map)){const e=document.querySelector('[data-ecutoggle="'+k+'"]');if(e){e.checked=!!(info.features&(1<<bit));e.disabled=true;e.dataset.localOnly='0';const small=e.parentElement?.querySelector('small');if(small&&!small.textContent.includes('ECU INFO'))small.textContent+=' · ECU INFO';}}
}
function parseLiveReal(a){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a);
  if(a.length!==53||a[0]!==0xA1||!validFrame(a))throw new Error('Live frame 0xA1 không hợp lệ · '+a.length+'B');
  if(typeof state==='undefined')return;
  const rawTps=a[1]*4+(a[47]&3);
  state.live.tpsV=liveVolt10(rawTps);
  const den=Number(state.cal?.tpsMax)-Number(state.cal?.tpsMin);
  state.live.tps=Math.abs(den)<.05?0:clamp((state.live.tpsV-state.cal.tpsMin)/den*100,0,100);
  state.live.rpm=u16be(a,6);
  // Injection table contribution and ignition angle use REDLEO live conversion.
  state.live.pw=u16be(a,16)/500;
  state.live.ign=u16be(a,28)/32-16;
  state.live.batt=u16be(a,42)*55/1024;
  if(readCache){
    state.live.ect=curveVoltageToAxis(decVolt(a[2]),readCache.vEct,14);
    state.live.iat=curveVoltageToAxis(decVolt(a[3]),readCache.vIat,6);
    state.live.mapKpa=curveVoltageToAxis(liveVolt10(u16be(a,4)),readCache.vMap,12);
  }
  const put=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=val};
  if(Number.isFinite(state.live.ect))put('ectLive',r1(state.live.ect).toFixed(1)+' °C');
  if(Number.isFinite(state.live.iat))put('iatLive',r1(state.live.iat).toFixed(1)+' °C');
  if(Number.isFinite(state.live.mapKpa))put('mapKpaLive',r1(state.live.mapKpa).toFixed(1)+' kPa');
  if(Number.isFinite(state.live.ign))put('ignLive',r1(state.live.ign).toFixed(1)+'°');
  if(Number.isFinite(state.live.batt))put('battLive',r1(state.live.batt).toFixed(1)+' V');
  const pw=document.getElementById('dashPw');if(pw&&Number.isFinite(state.live.pw))pw.textContent=state.live.pw.toFixed(2)+' ms';
  try{updateLive();highlightCurrent();syncMirrors();}catch(_e){}
}
function installAfrListener(){
  const ch=window.blinkLiveChar;if(!ch||ch.__blinkRealAfr)return;ch.__blinkRealAfr=true;
  ch.addEventListener('characteristicvaluechanged',ev=>{
    const d=ev.target.value;if(!d||d.byteLength<3)return;const v=new DataView(d.buffer,d.byteOffset,d.byteLength);if(v.getUint8(0)!==0xA3)return;
    const mv=v.getUint16(1,true),volts=mv/1000;if(typeof state==='undefined')return;state.live.afrV=volts;
    // Keep Blink's established analog AFR calibration used by this project.
    state.live.afr=10+clamp(volts,0,2.8)*(10/2.8);
    const now=performance.now();if(Array.isArray(state.afrHistory)){state.afrHistory.push({t:now,v:state.live.afr});while(state.afrHistory.length&&now-state.afrHistory[0].t>5000)state.afrHistory.shift();}
    try{updateLive();if(state.recording)recordSample(now);highlightCurrent();}catch(_e){}
  });
}
async function handshakeReal(){
  const rx=await rawExchange(req5(0x5A,0x5A),6000);const info=parseHandshake(rx);syncHandshakeInfo(info);syncCapabilityFlags(info);return info;
}
async function liveOnce(){
  if(!cmdChar()||busy||document.hidden)return;
  try{const mapNo=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4);const rx=await rawExchange(req5(0x69,mapNo),5000);parseLiveReal(rx);}catch(e){if(!/bận/.test(String(e.message||e)))console.warn(TAG,'live',e);}
}
function startLiveLoop(){
  if(liveRunning)return;liveRunning=true;clearInterval(liveTimer);liveTimer=setInterval(()=>{liveOnce();},180);
}
function stopLiveLoop(){liveRunning=false;if(liveTimer){clearInterval(liveTimer);liveTimer=null;}}
async function initializeRealSession(){
  if(sessionInitPromise)return sessionInitPromise;
  const epoch=transportEpoch;
  sessionInitPromise=(async()=>{
    installRawListener();installAfrListener();
    if(typeof state!=='undefined')state.ecuPhase='handshake';
    const info=await handshakeReal();
    if(epoch!==transportEpoch)throw new Error('BLE đổi kết nối trong lúc handshake');
    if(typeof state!=='undefined')state.ecuPhase='readall';
    try{await readAll();}catch(e){notice('error','READ ALL ECU',e.message||String(e));}
    if(epoch!==transportEpoch)throw new Error('BLE đổi kết nối trong lúc Read All');
    if(typeof state!=='undefined')state.ecuPhase='live';
    startLiveLoop();
    return info;
  })();
  try{return await sessionInitPromise;}
  finally{sessionInitPromise=null;}
}

// ----- raw BLE transport -----
function mapChar(){return window.blinkMapChar||null}
function cmdChar(){return window.blinkCommandChar||null}
function abortRawTransport(reason='BLE disconnected'){
  transportEpoch++;
  stopLiveLoop();
  for(const [id,p] of pending){
    try{clearTimeout(p.to);}catch(_e){}
    try{p.reject(new Error(reason));}catch(_e){}
  }
  pending.clear();
  busy=false;
  sessionInitPromise=null;
  handshakeInfo=null;
  if(typeof state!=='undefined'){
    state.ecuPhase='idle';
    // state.ecuConnected is owned by the BLE layer; do not force it true here.
  }
  log('raw transport reset:',reason);
}

function installRawListener(){
  const ch=mapChar();
  if(!ch)return false;
  if(installedChar===ch)return true;
  installedChar=ch;
  ch.addEventListener('characteristicvaluechanged',ev=>{
    const d=ev.target.value;if(!d||d.byteLength<7)return;
    const v=new DataView(d.buffer,d.byteOffset,d.byteLength);if(v.getUint8(0)!==RAW_RX)return;
    const id=v.getUint8(1),flags=v.getUint8(2),total=v.getUint16(3,true),off=v.getUint16(5,true);
    const p=pending.get(id);if(!p)return;
    if(flags&1){p.total=total;p.buf=new Uint8Array(total);p.got=0;p.seen=new Set();}
    if(!p.buf||off+(d.byteLength-7)>p.buf.length)return;
    const bytes=new Uint8Array(d.buffer,d.byteOffset+7,d.byteLength-7);
    p.buf.set(bytes,off);
    // Count each offset only once; reconnect/retransmit must not make got exceed total.
    if(!p.seen)p.seen=new Set();
    if(!p.seen.has(off)){p.seen.add(off);p.got+=bytes.length;}
    if((flags&2)||p.got>=p.total){
      clearTimeout(p.to);pending.delete(id);p.resolve(p.buf||new Uint8Array(0));
    }
  });
  log('raw listener installed on current BLE characteristic');
  return true;
}

async function waitForEcuIdle(maxWait=16000){
  const t0=performance.now();
  while(busy){
    if(!cmdChar()||!mapChar())throw new Error('BLE đã ngắt trong khi chờ ECU');
    if(performance.now()-t0>maxWait)throw new Error('ECU bận quá lâu; transaction trước chưa hoàn tất');
    await new Promise(r=>setTimeout(r,40));
  }
}

async function rawExchange(bytes,timeout=12000){
  if(!installRawListener())throw new Error('Chưa có BLE MAP characteristic');
  const ch=cmdChar();if(!ch)throw new Error('Chưa kết nối ECU Blink BLE');
  await waitForEcuIdle(Math.max(4000,timeout+1500));
  busy=true;
  const myEpoch=transportEpoch;
  try{
    const id=(sid=(sid%250)+1),data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),total=data.length;
    const response=new Promise((resolve,reject)=>{
      const to=setTimeout(()=>{
        pending.delete(id);
        reject(new Error('ECU timeout cmd 0x'+data[0].toString(16).toUpperCase()));
      },timeout);
      pending.set(id,{resolve,reject,to,total:0,buf:null,got:0,seen:new Set(),epoch:myEpoch});
    });
    for(let off=0;off<total;off+=RAW_CHUNK){
      if(myEpoch!==transportEpoch)throw new Error('BLE transport đã thay đổi');
      const cur=cmdChar();if(!cur)throw new Error('BLE đã ngắt');
      const n=Math.min(RAW_CHUNK,total-off),pkt=new Uint8Array(7+n);
      pkt[0]=RAW_TX;pkt[1]=id;pkt[2]=(off===0?1:0)|((off+n>=total)?2:0);pkt[3]=total&255;pkt[4]=(total>>8)&255;pkt[5]=off&255;pkt[6]=(off>>8)&255;pkt.set(data.subarray(off,off+n),7);
      if(cur.writeValueWithoutResponse)await cur.writeValueWithoutResponse(pkt);else await cur.writeValue(pkt);
      if(total>48)await new Promise(r=>setTimeout(r,2));
    }
    const rx=await response;
    if(myEpoch!==transportEpoch)throw new Error('BLE transport đã đổi trước khi nhận xong ECU');
    log('TX',data.length,'0x'+data[0].toString(16),'RX',rx.length);
    return rx;
  }finally{
    busy=false;
  }
}

// ----- ReadAll layout -----
function parseCanonicalReadAll(a,sourceLength=9767,layoutInfo='9767-native'){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a);
  if(a.length!==9767)throw new Error('Canonical Read All phải 9767B, got '+a.length);
  const C={raw:a.slice(),sourceLength,layoutInfo,tpsRaw:a.slice(1,15),vAfrRaw:a.slice(15,26),afRaw:[],banks:[],hidden:{}};
  C.vEct=Array.from(a.slice(26,37),decVolt);C.vIat=Array.from(a.slice(37,48),decVolt);C.vMap=Array.from(a.slice(48,59),decVolt);
  C.iatInj=Array.from(a.slice(59,70),decOil);C.mapMotor=Array.from(a.slice(70,81),x=>x);
  C.bitfield=a[81];C.autoStart=decAutoRpm(a[82]);C.auto=Array.from(a.slice(83,88),x=>x*5);C.password=Array.from(a.slice(88,92));
  C.optionRaw=Array.from(a.slice(92,104));
  C.options=decodeOptions(C.optionRaw,C.vEct,C.bitfield,C.autoStart);
  let q=decodeRowsByte(a,104,11,30,decPct);C.ectInj=q.data;
  q=decodeRowsByte(a,q.next,11,30,decEctIgn);C.ectIgn=q.data;
  q=decodeRowsByte(a,q.next,11,30,decMapInj);C.mapInj=q.data;
  let p=q.next;
  for(let bank=1;bank<=4;bank++){
    const b={bank};let z=decodeRowsU16(a,p,14,30,decOilTab);b.inj=z.data;p=z.next;
    z=decodeRowsByte(a,p,14,30,decOilAngle);b.injDegree=z.data;p=z.next;
    z=decodeRowsByte(a,p,14,30,decIgn);b.ignDegree=z.data;p=z.next;
    z=decodeRowsByte(a,p,1,30,decOil);b.ignTime=z.data;p=z.next;
    b.afRaw=a.slice(p,p+420);p+=420;
    const idle=[];for(let i=0;i<9;i++){idle.push(u16be(a,p));p+=2;}b.idle=idle;
    b.ectMotor=[Array.from(a.slice(p,p+12),x=>x*2)];p+=12;
    C.banks.push(b);C.afRaw.push(b.afRaw);
  }
  C.external=[Array(15).fill(0),Array(15).fill(0)];
  for(let col=0;col<15;col++)C.external[1][col]=decExtIgn(a[p++]);
  for(let col=0;col<15;col++)C.external[0][col]=decExtPct(a[p++]);
  C.meta=a[p++];
  if(p!==9765)throw new Error('Canonical layout lệch offset: checksum expected 9765, got '+p);
  return C;
}

function readAllPlausibility(C){
  let score=0,total=0;
  // Real injection maps in this ECU family are overwhelmingly below 50 ms.
  for(const b of C.banks){
    for(const row of b.inj)for(const v of row){total+=3;if(Number.isFinite(v)&&v>=0&&v<=50)score+=3;}
    for(const v of b.idle){total+=2;if(Number.isFinite(v)&&v>=0&&v<=20000)score+=2;}
    for(const row of b.ignTime)for(const v of row){total+=1;if(Number.isFinite(v)&&v>=0&&v<=20)score+=1;}
  }
  // TPS calibration should not be inverted after decode.
  total+=8;
  if(C.options.tpsMinEcu>=0&&C.options.tpsMinEcu<=5)score+=2;
  if(C.options.tpsMaxEcu>=0&&C.options.tpsMaxEcu<=5)score+=2;
  if(C.options.tpsMaxEcu>C.options.tpsMinEcu+0.05)score+=4;
  return total?score/total:0;
}

function canonicalFromContiguousExtension(a,cut,len=128,label='extra128'){
  const bodyEnd=a.length-2;
  if(cut<1||cut+len>bodyEnd)return null;
  const body=new Uint8Array(9765);
  const before=a.subarray(0,cut),after=a.subarray(cut+len,bodyEnd);
  if(before.length+after.length!==9765)return null;
  body.set(before,0);body.set(after,before.length);
  const out=new Uint8Array(9767);out.set(body,0);
  const s=checksum8(body);out[9765]=s;out[9766]=(255-out[0])&255;
  return {bytes:out,label:label+'@'+cut,extra:[cut,cut+len]};
}

function canonicalFromPerBank32(a,rel){
  const bodyEnd=a.length-2;
  const outBody=new Uint8Array(9765);
  // Prefix through MAP Comp INJ is identical.
  outBody.set(a.subarray(0,1094),0);
  let src=1094,dst=1094;
  const OLD_BANK=2160,NEW_BANK=2192,EXTRA=32;
  for(let bank=0;bank<4;bank++){
    const bankStart=src;
    outBody.set(a.subarray(bankStart,bankStart+rel),dst);dst+=rel;
    outBody.set(a.subarray(bankStart+rel+EXTRA,bankStart+NEW_BANK),dst);dst+=OLD_BANK-rel;
    src+=NEW_BANK;
  }
  // External adjustment + meta should consume exactly 31 bytes.
  const tail=a.subarray(src,bodyEnd);
  if(dst+tail.length!==9765)return null;
  outBody.set(tail,dst);
  const out=new Uint8Array(9767);out.set(outBody,0);
  const s=checksum8(outBody);out[9765]=s;out[9766]=(255-out[0])&255;
  return {bytes:out,label:'32B-per-bank@rel'+rel,extra:null};
}

function normalizeReadAll9895(a){
  const candidates=[];
  // Model A: one contiguous 128-byte extension at a known structural boundary.
  const boundaries=[104,434,764,1094,3254,5414,7574,9734,9764,9765];
  for(const cut of boundaries){
    const x=canonicalFromContiguousExtension(a,cut,128,'128B-block');
    if(x)candidates.push(x);
  }
  // Model B: 32 extra bytes in every MAP bank. Try every REDLEO sub-block boundary.
  const rels=[0,840,1260,1680,1710,2130,2148,2160];
  for(const rel of rels){
    const x=canonicalFromPerBank32(a,rel);if(x)candidates.push(x);
  }
  let best=null;
  for(const x of candidates){
    try{
      const parsed=parseCanonicalReadAll(x.bytes,9895,x.label);
      const sc=readAllPlausibility(parsed);
      if(!best||sc>best.score)best={...x,parsed,score:sc};
    }catch(_e){}
  }
  if(!best||best.score<0.72)throw new Error('Read All 9895B: không xác định được vị trí extension 128B an toàn · score '+(best?best.score.toFixed(3):'none'));
  best.parsed.extension128={model:best.label,score:best.score,rawLength:9895};
  log('ReadAll 9895 normalized:',best.label,'score',best.score.toFixed(3));
  return best.parsed;
}

function findValidCommandFrame(a,start,minLen=3){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a);
  const tail=(255-start)&255;
  for(let i=0;i<a.length;i++){
    if(a[i]!==start)continue;
    for(let end=a.length-1;end>=i+minLen-1;end--){
      if(a[end]!==tail)continue;
      const f=a.slice(i,end+1);
      if(validFrame(f))return f;
    }
  }
  return null;
}
function parseReadAll(a){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a);
  const f=findValidCommandFrame(a,0xAB,100)||findValidCommandFrame(a,0x8B,100);
  if(!f)throw new Error('Read All không tìm thấy frame checksum hợp lệ trong RX '+a.length+'B');

  // 9767 is the legacy 9.1X layout that is already fully decoded by Blink.
  if(f.length===9767)return parseCanonicalReadAll(f,9767,'9767-native');

  // Newer / alternate REDLEO builds use different Read-All lengths.
  // Preserve the exact frame instead of forcing it into the 9767 layout.
  // Current-map 0x9A reads are used for safe fuel-map decoding on these ECUs.
  return {
    raw:f.slice(),
    sourceLength:f.length,
    layoutInfo:'raw-'+f.length,
    rawOnly:true,
    banks:[],
    hidden:{}
  };
}
function decodeOptions(raw,vEct,bits,startRpm){
  return {
    tpsMinEcu:decVolt(raw[0]),tpsMaxEcu:decVolt(raw[1]),idleMinCold:decOil(raw[2]),idleMinHot:decOil(raw[3]),
    idleIgnReg:decEctIgn(raw[4]),idleInjReg:decOil(raw[5]),afrDelayCold:decSeconds(raw[6],64),afrDelayHot:decSeconds(raw[7],64),
    coldStartInj:decColdStart(raw[8]),coldStartDelay:decSeconds(raw[9],16),fanTemp:ectRawToTemp(raw[10],vEct),
    afrControl:(bits&1)===0,singleTpsIgn:!!(bits&2),dontMap:!!(bits&4),password:!!(bits&8),tps100Power:!!(bits&16),
    externalAxis:(bits&32)?'tps':'rpm',autoClutchEnable:!!(bits&64),o2Source:(bits&128)?'external':'original',autoClutchStartRpm:startRpm
  };
}

function bitfieldFromUI(base=0){
  let b=base&255;
  const chk=(sel)=>document.querySelector(sel);
  const afr=chk('#afrControlToggle'); if(afr){if(afr.checked)b&=~1;else b|=1;}
  const map={singleTpsIgn:1,dontMap:2,password:3,tps100Power:4,autoClutchEnable:6};
  for(const [k,bit] of Object.entries(map)){const e=chk('[data-ecutoggle="'+k+'"]');if(e){if(e.checked)b|=(1<<bit);else b&=~(1<<bit);}}
  const axis=document.getElementById('redAxisMode');if(axis){if(axis.value==='tps')b|=32;else b&=~32;}
  const o2=document.getElementById('o2SourceSelect');if(o2){if(o2.value==='external')b|=128;else b&=~128;}
  return b&255;
}
function inputVal(name,def=0){const e=document.querySelector('[data-ecuopt="'+name+'"]');const v=e?Number(e.value):NaN;return Number.isFinite(v)?v:def}
function optionRawFromUI(cache){
  const old=(cache&&cache.optionRaw?cache.optionRaw:Array(12).fill(0)).slice();const vEct=cache.vEct;
  old[0]=encVolt(inputVal('tpsMinEcu',decVolt(old[0])));old[1]=encVolt(inputVal('tpsMaxEcu',decVolt(old[1])));
  old[2]=encOil(inputVal('idleMinCold',decOil(old[2])));old[3]=encOil(inputVal('idleMinHot',decOil(old[3])));
  old[4]=clamp(Math.round((Math.max(0,inputVal('idleIgnReg',decEctIgn(old[4])))*256/360)*4),0,255); // option stores centered value without +64
  old[5]=encOil(inputVal('idleInjReg',decOil(old[5])));
  // 6/7 AFR delay work are deliberately hidden: preserve exact raw bytes.
  old[8]=encColdStart(inputVal('coldStartInj',decColdStart(old[8])));
  old[9]=encSeconds(inputVal('coldStartDelay',decSeconds(old[9],16)),16);
  old[10]=ectTempToRaw(inputVal('fanTemp',ectRawToTemp(old[10],vEct)),vEct);
  old[11]=bitfieldFromUI(cache.bitfield);
  return old;
}

function emitFeature(n,m,bank=0){
  if(typeof window.onBlinkFeaturePacket!=='function'||!m)return;
  for(let r=0;r<m.length;r++)for(let c=0;c<m[r].length;c+=3){
    const count=Math.min(3,m[r].length-c),buf=new ArrayBuffer(6+count*4),v=new DataView(buf);
    v.setUint8(0,0xB2);v.setUint8(1,n);v.setUint8(2,bank);v.setUint8(3,r);v.setUint8(4,c);v.setUint8(5,count);
    for(let i=0;i<count;i++)v.setFloat32(6+i*4,Number(m[r][c+i]||0),true);
    window.onBlinkFeaturePacket(v);
  }
}
function syncFuel(cache){
  if(typeof state==='undefined'||!cache)return;
  cache.banks.forEach((b,i)=>{if(state.mapBanks&&state.mapBanks[i])state.mapBanks[i].inject=b.inj.map(r=>r.slice())});
  try{render();updateLive();saveSoon();}catch(_e){}
}
function setValue(sel,val){const e=document.querySelector(sel);if(!e)return;e.value=String(val);e.dispatchEvent(new Event('change',{bubbles:true}));}
function setCheck(sel,val){const e=document.querySelector(sel);if(!e)return;e.checked=!!val;e.dispatchEvent(new Event('change',{bubbles:true}));}
function syncOptions(C){
  const o=C.options;
  ['tpsMinEcu','tpsMaxEcu','idleMinCold','idleMinHot','idleIgnReg','idleInjReg','coldStartInj','coldStartDelay','fanTemp'].forEach(k=>setValue('[data-ecuopt="'+k+'"]',o[k]));
  setValue('[data-ecuopt="autoClutchStartRpm"]',C.autoStart);
  setCheck('#afrControlToggle',o.afrControl);setValue('#o2SourceSelect',o.o2Source);
  setCheck('[data-ecutoggle="singleTpsIgn"]',o.singleTpsIgn);setCheck('[data-ecutoggle="dontMap"]',o.dontMap);setCheck('[data-ecutoggle="password"]',o.password);setCheck('[data-ecutoggle="tps100Power"]',o.tps100Power);setCheck('[data-ecutoggle="autoClutchEnable"]',o.autoClutchEnable);
  try{if(window.syncAfrSensorUi)syncAfrSensorUi();}catch(_e){}
}
function idleObject(b){return {idleCold:b.idle[0],idleHot:b.idle[1],maxSpeed:b.idle[2],returnCold:b.idle[3],returnHot:b.idle[4],accelPct:Math.round(b.idle[5]*50/64),idleSensitivity:b.idle[6]};}
function syncIdle(bank){if(!readCache)return;const b=readCache.banks[bank-1],o=idleObject(b);for(const[k,v]of Object.entries(o))setValue('[data-idleopt="'+k+'"]',v);emitFeature(N.ect_idle_motor,b.ectMotor,bank);}
function syncAll(C){
  readCache=C;window.blinkReadAllLayout={length:C.sourceLength,layout:C.layoutInfo,extension:C.extension128||null};syncFuel(C);syncOptions(C);
  for(const b of C.banks){emitFeature(N.inj_degree,b.injDegree,b.bank);emitFeature(N.ign_degree,b.ignDegree,b.bank);emitFeature(N.ign_time,b.ignTime,b.bank);emitFeature(N.ect_idle_motor,b.ectMotor,b.bank);}
  emitFeature(N.ect_inj,C.ectInj);emitFeature(N.ect_ign,C.ectIgn);emitFeature(N.map_inj,C.mapInj);emitFeature(N.iat_inj,[C.iatInj]);emitFeature(N.map_idle_motor,[C.mapMotor]);emitFeature(N.external_adjust,C.external);emitFeature(N.auto_clutch,[C.auto]);emitFeature(N.v_ect,[C.vEct]);emitFeature(N.v_iat,[C.vIat]);emitFeature(N.v_map,[C.vMap]);
  syncIdle((typeof state!=='undefined'&&state.activeMap)||1);
  document.querySelectorAll('[data-feature]').forEach(b=>{const id=b.dataset.feature;if(id==='spare'){b.dataset.protocol='legacy';}else{b.dataset.protocol='real';}});
  const s=document.getElementById('redIoStatus');if(s)s.textContent='ECU REAL · Read All '+C.sourceLength+'B OK · '+C.layoutInfo;
}

function syncCurrentFuel(bank,matrix,frameLen){
  if(typeof state==='undefined')return;
  bank=clamp(Math.round(bank),1,4);
  if(state.mapBanks&&state.mapBanks[bank-1])state.mapBanks[bank-1].inject=matrix.map(r=>r.slice());
  try{
    if(state.activeMap===bank)render();
    updateLive();
    saveSoon();
  }catch(_e){}
  const s=document.getElementById('redIoStatus');
  if(s)s.textContent='ECU REAL · READ CURRENT MAP No.'+bank+' · '+frameLen+'B OK';
}
function parseCurrentFuelFrame(a,bank){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a);
  bank=clamp(Math.round(bank),1,4);
  const pg=page(1,bank); // No.1=0x12, No.2=0x14, No.3=0x16, No.4=0x18
  const f=findValidCommandFrame(a,pg,843);
  if(!f)throw new Error('READ CURRENT MAP No.'+bank+' · không tìm thấy frame page 0x'+pg.toString(16).toUpperCase()+' hợp lệ trong RX '+a.length+'B');
  if(f.length<843)throw new Error('READ CURRENT MAP thiếu dữ liệu · '+f.length+'B');

  const out=Array.from({length:14},()=>Array(30).fill(0));
  let p=1;
  for(let wireRow=0;wireRow<14;wireRow++){
    const uiRow=13-wireRow;
    for(let c=0;c<30;c++){
      const raw=u16be(f,p);p+=2;
      out[uiRow][c]=decOilTab(raw);
    }
  }
  return {frame:f,matrix:out,page:pg};
}
async function readCurrentFuelBank(bank=((typeof state!=='undefined'&&state.activeMap)||1)){
  bank=clamp(Math.round(bank),1,4);
  const pg=page(1,bank);
  const rx=await rawExchange(req5(0x9A,pg),8000);
  const R=parseCurrentFuelFrame(rx,bank);
  syncCurrentFuel(bank,R.matrix,R.frame.length);
  log('READ CURRENT MAP No.'+bank,'page 0x'+pg.toString(16).toUpperCase(),'RX',rx.length,'frame',R.frame.length);
  return R;
}
async function readAll(cmd=0xAB){
  const rx=await rawExchange(req5(cmd,cmd),16000);
  const C=parseReadAll(rx);
  window.blinkReadAllRaw=C.raw.slice();
  window.blinkReadAllLayout={length:C.sourceLength,layout:C.layoutInfo,rawOnly:!!C.rawOnly};
  if(C.rawOnly){
    const s=document.getElementById('redIoStatus');
    if(s)s.textContent='ECU REAL · READ ALL '+C.sourceLength+'B OK · RAW backup';
    log('ReadAll raw frame accepted:',C.sourceLength+'B');
  }else{
    syncAll(C);
  }
  return C;
}

// ----- write builders -----
function matrixFromRedTable(rows,cols){
  const m=Array.from({length:rows},()=>Array(cols).fill(0));
  document.querySelectorAll('#redTable [data-rr][data-rc]').forEach(td=>{const r=+td.dataset.rr,c=+td.dataset.rc;if(r<rows&&c<cols){const n=Number(td.textContent);if(Number.isFinite(n))m[r][c]=n;}});return m;
}
function currentSource(){return (document.getElementById('redSourceName')?.textContent||'').trim()}
function currentFeatureId(){return FEAT[currentSource()]||null}
function assertSafeWriteLayout(){
  if(!readCache)throw new Error('Cần ĐỌC TOÀN BỘ ECU trước khi ghi.');
  if(readCache.sourceLength===9895){
    const sc=Number(readCache.extension128&&readCache.extension128.score);
    if(!Number.isFinite(sc)||sc<0.90){
      throw new Error('ECU 9895B đã đọc được nhưng layout 128B mở rộng chưa đủ chắc để GHI. Score='+(Number.isFinite(sc)?sc.toFixed(3):'--'));
    }
  }
}
async function writePageChecked(pg,payload,requireReadAll=true){
  if(requireReadAll)assertSafeWriteLayout();
  const tx=pageFrame(pg,payload),rx=await rawExchange(tx,8000);
  if(!(rx.length>=2&&rx[0]===0xCD&&rx[1]===pg))throw new Error('ECU không ACK CD '+pg.toString(16).toUpperCase()+' · RX '+rx.length+'B');
  return true;
}
function idlePayload(bank,fromUI=true){
  if(!readCache)throw new Error('Cần ĐỌC TOÀN BỘ trước để bảo toàn dữ liệu page Idle');
  const b=readCache.banks[bank-1],vals=b.idle.slice();
  if(fromUI){
    const get=k=>Number(document.querySelector('[data-idleopt="'+k+'"]')?.value);
    const set=(i,k,enc=x=>x)=>{const x=get(k);if(Number.isFinite(x))vals[i]=enc(x)};
    set(0,'idleCold',Math.round);set(1,'idleHot',Math.round);set(2,'maxSpeed',Math.round);set(3,'returnCold',Math.round);set(4,'returnHot',Math.round);set(5,'accelPct',v=>Math.round(v*64/50));set(6,'idleSensitivity',Math.round);
  }
  const out=[];vals.forEach(v=>push16be(out,v));
  // ECT motor: prefer current custom table DOM, fallback cache.
  let motor=b.ectMotor[0].slice();const cells=[...document.querySelectorAll('#idleEctTable [data-idlect]')];if(cells.length===12)motor=cells.map(td=>Number(td.textContent)||0);
  out.push(...motor.map(v=>clamp(Math.round(v/2),0,255)));return out;
}
function a2Payload(){
  if(!readCache)throw new Error('Cần ĐỌC TOÀN BỘ trước khi ghi Sensor/Options để bảo toàn byte ẩn');
  const C=readCache,out=[];
  out.push(...C.tpsRaw); // exact preserve 14 TPS-module bytes
  out.push(...C.vAfrRaw); // AFR-voltage map deliberately hidden, preserve exact
  const vEct=matrixFromMaybe('v_ect',C.vEct),vIat=matrixFromMaybe('v_iat',C.vIat),vMap=matrixFromMaybe('v_map',C.vMap);
  out.push(...vEct.map(encVolt),...vIat.map(encVolt),...vMap.map(encVolt));
  const iat=matrixFromMaybe('iat_inj',C.iatInj),mm=matrixFromMaybe('map_idle_motor',C.mapMotor);out.push(...iat.map(encOil),...mm.map(v=>clamp(Math.round(v),0,255)));
  const bits=bitfieldFromUI(C.bitfield);out.push(bits);
  out.push(encAutoRpm(inputVal('autoClutchStartRpm',C.autoStart)));
  const ac=matrixFromMaybe('auto_clutch',C.auto);out.push(...ac.map(v=>clamp(Math.round(v/5),0,255)));
  out.push(...C.password); // exact 4-nibble password bytes
  out.push(...optionRawFromUI({...C,vEct}));
  const ex=matrixFromMaybe2('external_adjust',C.external);for(let c=0;c<15;c++)out.push(encExtIgn(ex[1][c]));for(let c=0;c<15;c++)out.push(encExtPct(ex[0][c]));
  if(out.length!==133)throw new Error('A2 payload phải 133B, hiện '+out.length+'B');return out;
}
function matrixFromMaybe(id,fallback){
  if(currentFeatureId()===id){const cells=[...document.querySelectorAll('#redTable [data-rr][data-rc]')];if(cells.length){const cols=Math.max(...cells.map(x=>+x.dataset.rc))+1;const m=matrixFromRedTable(1,cols);return m[0];}}
  return fallback.slice();
}
function matrixFromMaybe2(id,fallback){if(currentFeatureId()===id){const cells=[...document.querySelectorAll('#redTable [data-rr][data-rc]')];if(cells.length)return matrixFromRedTable(2,15);}return fallback.map(r=>r.slice())}

async function writeFeatureReal(id){
  if(!readCache)await readAll();const bank=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4);let m,pg,payload;
  switch(id){
    case 'inj_degree':m=matrixFromRedTable(14,30);pg=page(2,bank);payload=encodeRowsByte(m,encOilAngle);break;
    case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);payload=encodeRowsByte(m,encIgn);break;
    case 'ign_time':m=matrixFromRedTable(1,30);pg=page(4,bank);payload=encodeRowsByte(m,encOil);break;
    case 'ect_inj':m=matrixFromRedTable(11,30);pg=0x72;payload=encodeRowsByte(m,encPct);break;
    case 'ect_ign':m=matrixFromRedTable(11,30);pg=0x82;payload=encodeRowsByte(m,encEctIgn);break;
    case 'map_inj':m=matrixFromRedTable(11,30);pg=0x92;payload=encodeRowsByte(m,encMapInj);break;
    case 'ect_idle_motor':pg=page(6,bank);payload=idlePayload(bank,false);{let motor=matrixFromRedTable(1,12)[0];for(let i=0;i<12;i++)payload[18+i]=clamp(Math.round(motor[i]/2),0,255);}break;
    case 'iat_inj':case 'map_idle_motor':case 'external_adjust':case 'auto_clutch':case 'v_ect':case 'v_iat':case 'v_map':pg=0xA2;payload=a2Payload();break;
    case 'spare':throw new Error('Spare là bảng firmware <9.0; ECU 9.1X dùng AutoClutch/Password thay thế. Không ghi để tránh hỏng A-page.');
    default:throw new Error('Chưa có page thật cho '+id);
  }
  await writePageChecked(pg,payload);await readAll();notice('success','ECU REAL · GHI OK',id+' · page 0x'+pg.toString(16).toUpperCase()+' · đã Read All verify');
}
async function writeIdleReal(){assertSafeWriteLayout();if(!readCache)await readAll();const bank=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4),pg=page(6,bank);await writePageChecked(pg,idlePayload(bank,true));await readAll();notice('success','IDLE/LIMIT GHI OK','MAP No.'+bank+' · page 0x'+pg.toString(16).toUpperCase())}
async function writeOptionsReal(){assertSafeWriteLayout();if(!readCache)await readAll();await writePageChecked(0xA2,a2Payload());await readAll();notice('success','OPTIONS GHI OK','AFR Control/O2 + Options + Sensor page A2 đã verify')}

async function writeFuelBank(bank){
  bank=clamp(Math.round(bank),1,4);
  const inj=state.mapBanks[bank-1].inject,low=pageLow(bank),halves=[[13,12,11,10,9,8,7],[6,5,4,3,2,1,0]];
  if(!inj||inj.length!==14||inj.some(r=>!Array.isArray(r)||r.length!==30))throw new Error('MAP hiện tại chưa có đủ dữ liệu 14x30 để ghi.');
  for(let h=0;h<2;h++){
    const payload=[];
    for(const r of halves[h])for(let c=0;c<30;c++)push16be(payload,encOilTab(inj[r][c]));
    // Fuel half-pages contain the complete 7x30 payload, so READ ALL is not
    // required. This enables READ CURRENT -> edit -> WRITE CURRENT directly.
    await writePageChecked(0x10|low|h,payload,false);
  }
}
async function writeBankAll(bank){
  if(!readCache)await readAll();const b=readCache.banks[bank-1];await writeFuelBank(bank);
  await writePageChecked(page(2,bank),encodeRowsByte(b.injDegree,encOilAngle));
  await writePageChecked(page(3,bank),encodeRowsByte(b.ignDegree,encIgn));
  await writePageChecked(page(4,bank),encodeRowsByte(b.ignTime,encOil));
  // Hidden REDLEO AFR table is never exposed/modified by Blink, but Send All preserves it byte-for-byte.
  await writePageChecked(page(5,bank),Array.from(b.afRaw));
  await writePageChecked(page(6,bank),idlePayload(bank,false));
}
async function sendAllReal(){
  if(!readCache)await readAll();
  await writePageChecked(0x72,encodeRowsByte(readCache.ectInj,encPct));await writePageChecked(0x82,encodeRowsByte(readCache.ectIgn,encEctIgn));await writePageChecked(0x92,encodeRowsByte(readCache.mapInj,encMapInj));await writePageChecked(0xA2,a2Payload());
  for(let b=1;b<=4;b++)await writeBankAll(b);await readAll();notice('success','SEND ALL REAL OK','Đã ghi toàn bộ page hỗ trợ và Read All verify');
}

async function copyBankReal(dest){
  if(!readCache)await readAll();const src=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4),dests=dest==='all'?[1,2,3,4].filter(x=>x!==src):[Number(dest)];
  const s=readCache.banks[src-1];for(const d of dests){const t=readCache.banks[d-1];t.inj=s.inj.map(r=>r.slice());t.injDegree=s.injDegree.map(r=>r.slice());t.ignDegree=s.ignDegree.map(r=>r.slice());t.ignTime=s.ignTime.map(r=>r.slice());t.idle=s.idle.slice();t.ectMotor=s.ectMotor.map(r=>r.slice());state.mapBanks[d-1].inject=t.inj.map(r=>r.slice());await writeBankAll(d);}await readAll();notice('success','COPY MAP REAL OK','MAP No.'+src+' → '+(dest==='all'?'ALL':dest));
}

async function restoreReal(){if(!confirm('KHÔI PHỤC DỮ LIỆU GỐC ECU?\n\nLệnh thật 0x8B sẽ thay đổi dữ liệu ECU. Chỉ tiếp tục khi nguồn ECU ổn định.'))return;const C=await readAll(0x8B);notice('success','RESTORE ECU OK','ECU trả frame 0x8B '+C.raw.length+'B và đã nạp lại dữ liệu')}
async function tpsStudyReal(){const rx=await rawExchange(req5(0x77,0x77),38000);if(rx.length<100||rx[0]!==0x77||!validFrame(rx))throw new Error('TPS Study 0x77 response không hợp lệ');const min=rx[92]*20/1024,max=rx[93]*20/1024;if(!(max>min+.1))throw new Error('TPS Study trả calibration không hợp lệ');state.cal.tpsMin=min;state.cal.tpsMax=max;try{syncControls();saveSoon();}catch(_e){}notice('success','TPS STUDY REAL OK',min.toFixed(3)+' V → '+max.toFixed(3)+' V')}
async function testInjectorReal(){const s=Number(prompt('Thời gian test kim phun (giây, >1):','3'));if(!Number.isFinite(s)||s<=1)return;const sec=clamp(Math.round(s),2,30);await rawExchange(req5(0xDC,sec+1),6000);notice('info','TEST INJECTOR','ECU đang test '+sec+' giây');setTimeout(()=>rawExchange(req5(0xDC,0),5000).catch(console.warn),sec*1000+200)}

function passwordDigitsToBytes(p){p=(String(p||'')+'FFFF').slice(0,4).toUpperCase();if(!/^[0-9A-F]{4}$/.test(p))throw new Error('Mật khẩu chỉ dùng 0-9/A-F, tối đa 4 ký tự');return Array.from(p,ch=>parseInt(ch,16));}
function passwordBytesToString(a){return Array.from(a||[]).map(x=>(x&15).toString(16).toUpperCase()).join('').replace(/F+$/,'')}
function loginReal(){if(!readCache)return notice('error','LOGIN','Hãy ĐỌC TOÀN BỘ trước');const p=prompt('Nhập mật khẩu ECU:','');if(p==null)return;const ok=passwordBytesToString(passwordDigitsToBytes(p))===passwordBytesToString(readCache.password);loginState=ok;notice(ok?'success':'error',ok?'LOGIN OK':'SAI MẬT KHẨU',ok?'Đã đăng nhập cục bộ theo password ECU':'Mật khẩu không khớp ECU')}
function logoutReal(){loginState=false;notice('info','LOGOUT','Đã đăng xuất')}
async function changePasswordReal(){if(!readCache)await readAll();const old=prompt('Mật khẩu cũ:','');if(old==null)return;if(passwordBytesToString(passwordDigitsToBytes(old))!==passwordBytesToString(readCache.password))throw new Error('Mật khẩu cũ sai');const p=prompt('Mật khẩu mới (tối đa 4 ký tự hex 0-9/A-F):','');if(p==null)return;const bytes=passwordDigitsToBytes(p),payload=[...bytes,0,0];await writePageChecked(0xB2,payload);readCache.password=bytes;loginState=true;notice('success','ĐỔI MẬT KHẨU OK','Page B2 đã ACK')}

function ecuInfoFromCache(){if(handshakeInfo){syncHandshakeInfo(handshakeInfo);return;}if(!readCache)return;const fields=[
  'REDLEO ECU 9.1X','ECU Blink','Protocol 38400 8E2','ReadAll '+readCache.raw.length+'B','—','—','9.1+','P.b v1.2'
];document.querySelectorAll('[data-ecuinfo]').forEach((e,i)=>e.textContent=fields[i]||'—');}

function notice(type,title,detail){if(typeof window.showEcuNotice==='function')showEcuNotice(type,title,detail,4500);else alert(title+'\n'+detail)}
function protect(fn){return async e=>{if(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();}try{await fn(e)}catch(x){err(x);notice('error','ECU REAL',x.message||String(x))}}}
function capture(id,handler){const e=document.getElementById(id);if(e)e.addEventListener('click',protect(handler),true)}

function installUI(){
  // Bank-specific Idle fields do not belong in global Option grid; keep them only in Idle/Limit screen.
  ['idleCold','idleHot','returnCold','returnHot','maxSpeed','accelPct','idleSensitivity'].forEach(k=>{const e=document.querySelector('#ecuScreen [data-ecuopt="'+k+'"]');if(e)e.closest('.optionField').style.display='none';});
  const open=document.querySelector('#ecuScreen [data-ecuopt="openingSpeed"]');if(open){open.disabled=true;open.closest('.optionField').title='Opening Speed chưa có vị trí ECU được chứng minh trong EXE 9.1X; khóa để không ghi nhầm.';}
  // Software/display toggles not present in ECU bitfield are local UI settings by design.
  ['idleMotor','solenoid','sideStand','startRelay','tpsVoltDisp','tempVoltDisp','injColor','realData','mapVoltDisp'].forEach(k=>{const e=document.querySelector('[data-ecutoggle="'+k+'"]');if(e){e.dataset.localOnly='1';const small=e.parentElement?.querySelector('small');if(small&&!small.textContent.includes('LOCAL'))small.textContent+=' · LOCAL';}});
  const spare=document.querySelector('[data-feature="spare"]');if(spare){spare.disabled=true;spare.title='Firmware 9.1X thay Spare bằng AutoClutch + password block.';}

  capture('redReadBtn',async()=>{await readAll();const id=currentFeatureId();notice('success','ĐỌC ECU REAL OK',(id||currentSource())+' đã cập nhật từ frame 9767B')});
  capture('redWriteBtn',async()=>{const id=currentFeatureId();if(!id)throw new Error('Không xác định REDLEO feature');await writeFeatureReal(id)});
  capture('idleLimitReadBtn',async()=>{await readAll();syncIdle(state.activeMap);notice('success','IDLE/LIMIT READ','MAP No.'+state.activeMap)});
  capture('idleLimitWriteBtn',writeIdleReal);

  // Fuel editor: REDLEO "Read Current" is 0x9A + current fuel page.
  capture('readMapBtn',async()=>{const R=await readCurrentFuelBank(state.activeMap);notice('success','ĐỌC HIỆN TẠI OK','MAP No.'+state.activeMap+' · page 0x'+R.page.toString(16).toUpperCase()+' · '+R.frame.length+'B')});
  capture('writeMapBtn',async()=>{await writeFuelBank(state.activeMap);const R=await readCurrentFuelBank(state.activeMap);notice('success','MAP PHUN WRITE REAL','MAP No.'+state.activeMap+' CD pair + VERIFY 0x9A · '+R.frame.length+'B')});
  capture('applyCorrectedBtn',async()=>{
    if(typeof correctedMatrix!=='function')throw new Error('Không có correctedMatrix');const corr=correctedMatrix();for(let r=0;r<14;r++)for(let c=0;c<30;c++)if(corr[r][c]!=null)state.inject[r][c]=corr[r][c];await writeFuelBank(state.activeMap);const R=await readCurrentFuelBank(state.activeMap);notice('success','MAP ĐÃ BÙ → ECU REAL','Đã ghi + verify READ CURRENT · '+R.frame.length+'B');
  });
  capture('studyTpsBtn',tpsStudyReal);

  document.querySelectorAll('[data-ecucmd]').forEach(b=>b.addEventListener('click',protect(async()=>{
    const cmd=b.dataset.ecucmd;
    if(cmd==='READ_CURRENT'){const R=await readCurrentFuelBank(state.activeMap);notice('success','READ CURRENT OK','MAP No.'+state.activeMap+' · page 0x'+R.page.toString(16).toUpperCase()+' · '+R.frame.length+'B');return;}
    if(cmd==='READ_ALL'){const C=await readAll();notice('success','READ ALL OK',C.sourceLength+'B · '+(C.rawOnly?'RAW backup':'decoded'));return;}
    if(cmd==='SEND_ALL'){await sendAllReal();return;}
    if(cmd==='SEND_CURRENT'){await writeFuelBank(state.activeMap);const R=await readCurrentFuelBank(state.activeMap);notice('success','GHI HIỆN TẠI OK','MAP No.'+state.activeMap+' · VERIFY 0x9A · '+R.frame.length+'B');return;}
    if(cmd==='RESTORE'){await restoreReal();return;}
    if(cmd==='TPS_TEST'){await tpsStudyReal();return;}
    if(cmd==='TEST_INJ'){await testInjectorReal();return;}
    if(cmd==='OPTIONS_READ'){await readAll();notice('success','OPTIONS READ REAL','A-page/options đã cập nhật');return;}
    if(cmd==='OPTIONS_WRITE'){await writeOptionsReal();return;}
    if(cmd==='ECU_INFO'){ecuInfoFromCache();return;}
    if(cmd==='LOGIN'){loginReal();return;}
    if(cmd==='LOGOUT'){logoutReal();return;}
    if(cmd==='CHANGE_PASSWORD'){await changePasswordReal();return;}
  }),true));
  document.querySelectorAll('[data-copybank]').forEach(b=>b.addEventListener('click',protect(()=>copyBankReal(b.dataset.copybank)),true));

  document.getElementById('idleLimitBankSelect')?.addEventListener('change',()=>setTimeout(()=>{if(readCache)syncIdle(state.activeMap)},0),true);
  // AFR/O2 + mapped ECU bit toggles auto-write A2 immediately, with rollback by reread on failure.
  ['#afrControlToggle','#o2SourceSelect','[data-ecutoggle="singleTpsIgn"]','[data-ecutoggle="dontMap"]','[data-ecutoggle="password"]','[data-ecutoggle="tps100Power"]','[data-ecutoggle="autoClutchEnable"]'].forEach(sel=>{
    const e=document.querySelector(sel);if(!e)return;e.addEventListener('change',()=>{
      if(!state.ecuConnected||!readCache)return;
      setTimeout(()=>writeOptionsReal().catch(async x=>{notice('error','OPTION WRITE FAIL',x.message);try{await readAll()}catch(_e){}}),0);
    },false);
  });

  // Mark status visibly.
  document.querySelectorAll('.sourceNote').forEach(e=>{if(!e.textContent.includes('ECU REAL'))e.textContent+=' · ECU REAL protocol layer active.';});
}

// ReadAll after BLE becomes connected. Poll for exposed chars because connect handler lives in another IIFE.
function boot(){
  installUI();
  let lastCmd=null,lastMap=null,settleTimer=null;
  setInterval(()=>{
    const cc=cmdChar(),mc=mapChar();
    const changed=(cc!==lastCmd)||(mc!==lastMap);
    if(!changed)return;
    lastCmd=cc;lastMap=mc;

    if(settleTimer){clearTimeout(settleTimer);settleTimer=null;}

    if(!cc||!mc){
      transportCmdChar=null;transportMapChar=null;installedChar=null;
      abortRawTransport('BLE disconnected');
      return;
    }

    // New BLE characteristic objects = a fresh connection/reconnection.
    abortRawTransport('BLE transport reconnected');
    transportCmdChar=cc;transportMapChar=mc;
    installRawListener();installAfrListener();
    log('transport ready / reconnect detected');
    settleTimer=setTimeout(()=>{
      if(cmdChar()!==cc||mapChar()!==mc)return;
      initializeRealSession()
        .then(()=>notice('success','ECU REAL ONLINE','Handshake + Read All + Live polling đã hoạt động'))
        .catch(e=>{err(e);notice('error','ECU REAL CHƯA ONLINE',e.message||String(e));});
    },450);
  },150);

  window.addEventListener('pagehide',()=>abortRawTransport('pagehide'));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stopLiveLoop();
    else if(cmdChar()&&mapChar()&&handshakeInfo)startLiveLoop();
  });
}

window.BlinkRealProtocol={rawExchange,readAll,readCurrentFuelBank,parseCurrentFuelFrame,parseReadAll,parseHandshake,parseLiveReal,handshakeReal,initializeRealSession,writeFeatureReal,writeOptionsReal,writeIdleReal,sendAllReal,copyBankReal,restoreReal,tpsStudyReal,testInjectorReal,abortRawTransport,get cache(){return readCache},get handshake(){return handshakeInfo},get isBusy(){return busy}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

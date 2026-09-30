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
let readCache=null;          // populated only by explicit READ ALL
let sensorCalCache=null;     // populated by lightweight A2 page read
let sensorCalIdentity=null;   // prevents calibration from a different ECU being reused
let pageCache=new Map();     // page-specific lazy reads
let fuelPagePrimed=new Set();// banks whose large INJ VE page has read successfully this BLE session
let loginState=false;
let ecuProfile=null;
let transportCmdChar=null;
let transportMapChar=null;
let sessionInitPromise=null;
let transportEpoch=0;

const FEAT={
  'Idle and limit':'idle_limit',
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
  'Automatic shift':'auto_shift',
  'Automatic clutch':'auto_clutch',
  'Charger Parameters':'chg_params',
  'ATE options':'ate_options',
  'Start Add Injection':'ect_start',
  'Spare':'spare',
  'ECT - Voltage Relation':'v_ect',
  'IAT - Voltage Relation':'v_iat',
  'MAP - Voltage Relation':'v_map'
};
const N={inj_degree:2,ign_degree:3,ign_time:4,idle_limit:5,ect_idle_motor:6,ect_inj:7,ect_ign:8,map_inj:9,iat_inj:10,map_idle_motor:11,external_adjust:12,auto_clutch:13,spare:14,v_ect:15,v_iat:16,v_map:17,auto_shift:18,chg_params:19,ate_options:20,ect_start:21};

const ECU_PROFILE_DEFS=Object.freeze({
  MODERN_V9:Object.freeze({key:'MODERN_V9',label:'REDLEO MODERN 9.x',short:'MODERN 9.x',family:'modern',caps:{live:true,pageRead:true,optionsRead:true,idleRead:true,fuelRead:true,readAll:true,fuelWrite:true,mainWrite:true,restore:true,tpsStudy:true,testInjector:true,password:true}}),
  MODERN_V10:Object.freeze({key:'MODERN_V10',label:'REDLEO MODERN 10.x / ULTRA',short:'MODERN 10.x',family:'modern',caps:{live:true,pageRead:true,optionsRead:true,idleRead:true,fuelRead:true,readAll:true,fuelWrite:true,mainWrite:true,restore:false,tpsStudy:true,testInjector:true,password:false}}),
  MODERN_V11:Object.freeze({key:'MODERN_V11',label:'ATE / REDLEO 11.x · EXTENDED TUNE',short:'ATE 11.x',family:'v11',caps:{live:true,pageRead:true,optionsRead:true,idleRead:true,fuelRead:true,readAll:true,fuelWrite:true,mainWrite:true,restore:true,tpsStudy:true,testInjector:true,password:true}}),
  LEGACY_V8:Object.freeze({key:'LEGACY_V8',label:'REDLEO V8 · MAIN TUNE',short:'V8',family:'v8',caps:{live:true,pageRead:true,optionsRead:false,idleRead:false,fuelRead:true,readAll:true,fuelWrite:true,mainWrite:true,restore:false,tpsStudy:false,testInjector:false,password:false}}),
  LEGACY_PROBE:Object.freeze({key:'LEGACY_PROBE',label:'REDLEO LEGACY · SAFE MODE',short:'LEGACY SAFE',family:'legacy',caps:{live:false,pageRead:false,optionsRead:false,idleRead:false,fuelRead:false,readAll:false,fuelWrite:false,restore:false,tpsStudy:false,testInjector:false,password:false}}),
  UNKNOWN:Object.freeze({key:'UNKNOWN',label:'ECU CHƯA XÁC ĐỊNH · SAFE MODE',short:'UNKNOWN SAFE',family:'unknown',caps:{live:false,pageRead:false,optionsRead:false,idleRead:false,fuelRead:false,readAll:false,fuelWrite:false,restore:false,tpsStudy:false,testInjector:false,password:false}})
});
ecuProfile=ECU_PROFILE_DEFS.UNKNOWN;

const LEGACY_TPS_PCT=Object.freeze([0,2,5,8,14,20,30,40,50,60,70,80,90,100]);
const LEGACY_RPM_AXIS=Object.freeze(Array.from({length:30},(_,i)=>(i+1)*500));
const OLD_ECT_AXIS=Object.freeze(Array.from({length:11},(_,i)=>i*14));
const NEW_ECT_AXIS=Object.freeze(Array.from({length:11},(_,i)=>-14+i*14));
const OLD_IAT_AXIS=Object.freeze(Array.from({length:11},(_,i)=>i*6));
const NEW_IAT_AXIS=Object.freeze(Array.from({length:11},(_,i)=>-14+i*7));
const MAP_KPA_AXIS=Object.freeze(Array.from({length:11},(_,i)=>i*12));

function firmwareNumbers(info=handshakeInfo){
  const txt=(String(info&&info.firmware||'')+' '+String(info&&info.ident||'')).toUpperCase();
  const m=txt.match(/(?:V|VER(?:SION)?)?\s*(8|9|10|11)(?:\.(\d+))?/);
  if(!m)return {major:NaN,minor:NaN};
  return {major:Number(m[1]),minor:m[2]==null?NaN:Number(m[2])};
}
function usesNewThermalAxis(info=handshakeInfo){
  const v=firmwareNumbers(info);
  if(v.major>=10)return true;
  if(v.major===9&&Number.isFinite(v.minor)&&v.minor>=2)return true;
  return false;
}
function currentAuxAxes(){
  const newer=usesNewThermalAxis();
  return {
    ect:(newer?NEW_ECT_AXIS:OLD_ECT_AXIS).slice(),
    iat:(newer?NEW_IAT_AXIS:OLD_IAT_AXIS).slice(),
    map:MAP_KPA_AXIS.slice(),
    generation:newer?'9.2+':'8/9.1'
  };
}
function validDynamicAxes(tpsPct,rpmAxis){
  if(!Array.isArray(tpsPct)||tpsPct.length!==14||!Array.isArray(rpmAxis)||rpmAxis.length!==30)return false;
  const t=tpsPct.map(Number),r=rpmAxis.map(Number);
  if(t.some(x=>!Number.isFinite(x)||x<0||x>100)||r.some(x=>!Number.isFinite(x)||x<=0||x>30000))return false;
  for(let i=1;i<t.length;i++)if(t[i]<t[i-1])return false;
  for(let i=1;i<r.length;i++)if(r[i]<=r[i-1])return false;
  return true;
}
function publishEcuAxes(tpsPct,rpmAxis,source='ECU'){
  const aux=currentAuxAxes();
  let t=Array.from(tpsPct||[],Number),r=Array.from(rpmAxis||[],Number);
  if(!validDynamicAxes(t,r)){t=LEGACY_TPS_PCT.slice();r=LEGACY_RPM_AXIS.slice();}
  const payload={profile:ecuProfile?.key||'UNKNOWN',firmware:handshakeInfo?.firmware||'',tpsPct:t.slice(),rpmAxis:r.slice(),ectAxis:aux.ect,iatAxis:aux.iat,mapAxis:aux.map,source};
  window.blinkEcuAxes=payload;
  try{window.applyEcuAxes?.(payload);}catch(_e){}
  return payload;
}
function publishProfileAxisFallback(source='PROFILE'){
  // V8/V9 use the fixed main TPS/RPM breakpoints proven in their original EXEs.
  // V10/Ultra/V11 will be replaced by the ECU-provided A2 axis as soon as it is read.
  return publishEcuAxes(LEGACY_TPS_PCT.slice(),LEGACY_RPM_AXIS.slice(),source);
}

function profileFromHandshake(info){
  if(info&&info.legacyProbe)return ECU_PROFILE_DEFS.LEGACY_PROBE;
  const fw=String(info&&info.firmware||'').trim().toUpperCase();
  const ident=String(info&&info.ident||'').trim().toUpperCase();
  const all=(fw+' '+ident).trim();
  if(/ULTRA/.test(all))return ECU_PROFILE_DEFS.MODERN_V10;

  // Firmware bytes are authoritative. Do not classify from arbitrary model
  // numbers in ECU ident strings such as 125/150/250.
  let major=NaN;
  const fm=fw.match(/(?:V|VER)?\s*(\d{1,2})(?:\.|\b)/);
  if(fm)major=Number(fm[1]);
  if(!Number.isFinite(major)){
    const im=ident.match(/(?:^|\s)(?:V|VER(?:SION)?)\s*(8|9|10|11)(?:\.|\b)/);
    if(im)major=Number(im[1]);
  }
  if(major===11)return ECU_PROFILE_DEFS.MODERN_V11;
  if(major===10)return ECU_PROFILE_DEFS.MODERN_V10;
  if(major===9)return ECU_PROFILE_DEFS.MODERN_V9;
  if(major===8||/\bV8\b|\bVER\s*8\b/.test(all))return ECU_PROFILE_DEFS.LEGACY_V8;
  return ECU_PROFILE_DEFS.UNKNOWN;
}
function v11FullImageReady(){
  return !!(ecuProfile&&ecuProfile.family==='v11'&&readCache&&readCache.v11Decoded&&readCache.sourceLength===9958);
}
function profileCap(name){
  if(name==='fullWrite'){
    return !!(ecuProfile&&ecuProfile.key==='MODERN_V9'&&readCache&&!readCache.rawOnly&&readCache.sourceLength===9767);
  }
  const cap=!!(ecuProfile&&ecuProfile.caps&&ecuProfile.caps[name]);
  if(cap&&ecuProfile&&ecuProfile.family==='v11'&&(name==='tpsStudy'||name==='testInjector')){
    const mode=Number(handshakeInfo&&handshakeInfo.ecuMode);
    if(Number.isFinite(mode)&&mode>=4)return false;
  }
  return cap;
}
function mainFeaturePage(id,bank){
  bank=normalizeBankForProfile(bank);
  if(id==='inj_degree')return page(2,bank);
  if(id==='ign_degree')return page(3,bank);
  if(id==='ign_time')return page(4,bank);
  if(id==='ect_inj')return 0x72;
  if(id==='ect_ign')return 0x82;
  if(id==='map_inj')return 0x92;
  if(ecuProfile&&ecuProfile.family==='v11'&&['idle_limit','ect_idle_motor','auto_shift'].includes(id))return page(6,bank);
  if(ecuProfile&&ecuProfile.family==='v11'&&['iat_inj','map_idle_motor','external_adjust','auto_clutch','chg_params','ate_options','ect_start','v_ect','v_iat','v_map'].includes(id))return 0xA2;
  return null;
}
function isDirectVerifiedFeature(id){
  if(['inj_degree','ign_degree','ign_time'].includes(id))return true;
  return !!(ecuProfile&&ecuProfile.family==='v11'&&['idle_limit','ect_idle_motor','auto_shift','auto_clutch','chg_params','ate_options','ect_start','ect_inj','ect_ign','map_inj','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map'].includes(id));
}
function mainFeatureReady(id,bank){
  const pg=mainFeaturePage(id,bank);
  return pg!=null&&profileCap('mainWrite')&&isDirectVerifiedFeature(id)&&pageCache.has(pg);
}
function requireProfile(name,action='Thao tác ECU'){
  if(profileCap(name))return true;
  const label=ecuProfile?.label||ECU_PROFILE_DEFS.UNKNOWN.label;
  throw new Error(label+' · '+action+' chưa được xác nhận an toàn cho đời ECU này.');
}
function setProfileDisabled(el,blocked,reason=''){
  if(!el)return;
  if(blocked){
    el.dataset.profileBlocked='1';
    el.disabled=true;
    if(reason)el.title=reason;
  }else if(el.dataset.profileBlocked==='1'){
    delete el.dataset.profileBlocked;
    el.disabled=false;
    if(el.title&&el.title.includes('ECU Profile'))el.title='';
  }
}
function applyProfileUi(){
  const p=ecuProfile||ECU_PROFILE_DEFS.UNKNOWN;
  document.querySelectorAll('[data-ecuprofile]').forEach(e=>e.textContent=p.label);
  // V11 handshake exposes a four-nibble ECU PIN. This is distinct from the
  // original ATE service/master login handled by FtcECU.dll, which Blink does
  // not emulate. Label the controls according to what Blink actually verifies.
  const loginBtn=document.querySelector('[data-ecucmd="LOGIN"]');
  const logoutBtn=document.querySelector('[data-ecucmd="LOGOUT"]');
  const changePwBtn=document.querySelector('[data-ecucmd="CHANGE_PASSWORD"]');
  if(loginBtn)loginBtn.textContent=p.family==='v11'?'XÁC NHẬN PIN ECU':'ĐĂNG NHẬP ECU';
  if(logoutBtn)logoutBtn.textContent=p.family==='v11'?'XÓA XÁC NHẬN PIN':'ĐĂNG XUẤT';
  if(changePwBtn)changePwBtn.textContent=p.family==='v11'?'ĐỔI PIN ECU':'ĐỔI MẬT KHẨU';
  const sub=document.querySelector('#ecuScreen .screenSub');
  if(sub)sub.textContent='AUTO ECU PROFILE · '+p.label;
  const mapSub=document.getElementById('mapsProfileSub');
  if(mapSub){
    if(p.family==='v11')mapSub.textContent='ATE / REDLEO 11.x · giao diện V11 · AFR/Auto Tune dùng Blink';
    else if(p.family==='modern')mapSub.textContent=p.label+' · giao diện REDLEO · AFR/Auto Tune dùng Blink';
    else if(p.family==='v8')mapSub.textContent=p.label+' · chỉ hiện các bảng đã xác minh';
    else mapSub.textContent='AUTO ECU PROFILE · chờ nhận diện';
  }
  document.body.dataset.ecuProfile=p.key||'UNKNOWN';
  const reason='ECU Profile: '+p.label+' · chức năng này đang bị khóa để tránh dùng sai protocol.';

  ['writeMapBtn','applyCorrectedBtn'].forEach(id=>setProfileDisabled(document.getElementById(id),!profileCap('fuelWrite'),reason));
  const mainFeatureIds=new Set(['idle_limit','ect_idle_motor','auto_shift','inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map']);
  if(p.family==='v11'){mainFeatureIds.add('auto_clutch');mainFeatureIds.add('chg_params');mainFeatureIds.add('ate_options');mainFeatureIds.add('ect_start');}
  let activeFeatureId=null;
  try{activeFeatureId=currentFeatureId();}catch(_e){}
  const canRedWrite=mainFeatureIds.has(activeFeatureId)
    ?mainFeatureReady(activeFeatureId,(typeof state!=='undefined'&&state.activeMap)||1)
    :profileCap('fullWrite');
  setProfileDisabled(document.getElementById('redWriteBtn'),!canRedWrite,reason);
  setProfileDisabled(document.getElementById('idleLimitWriteBtn'),!profileCap('fullWrite'),reason);
  setProfileDisabled(document.getElementById('readMapBtn'),!profileCap('fuelRead'),reason);
  setProfileDisabled(document.getElementById('redReadBtn'),!profileCap('pageRead'),reason);
  setProfileDisabled(document.getElementById('idleLimitReadBtn'),!profileCap('idleRead'),reason);

  document.querySelectorAll('[data-ecucmd]').forEach(b=>{
    const c=b.dataset.ecucmd;
    let ok=true;
    if(c==='READ_CURRENT')ok=profileCap('fuelRead');
    else if(c==='OPTIONS_READ')ok=profileCap('optionsRead');
    else if(c==='READ_ALL')ok=profileCap('readAll');
    else if(c==='TPS_TEST')ok=profileCap('tpsStudy');
    else if(c==='LOGIN'||c==='LOGOUT')ok=profileCap('password');
    else if(c==='SEND_CURRENT')ok=profileCap('fuelWrite');
    else if(c==='SEND_ALL')ok=p.family==='v11'?v11FullImageReady():profileCap('fullWrite');
    else if(c==='OPTIONS_WRITE')ok=profileCap('fullWrite');
    else if(c==='RESTORE')ok=profileCap('restore');
    else if(c==='CHANGE_PASSWORD')ok=profileCap('password')&&(p.family==='v11'||profileCap('fullWrite'));
    else if(c==='TEST_INJ')ok=profileCap('testInjector');
    setProfileDisabled(b,!ok,reason);
  });
  document.querySelectorAll('[data-copybank]').forEach(b=>setProfileDisabled(b,!(profileCap('fullWrite')||v11FullImageReady()),reason));

  const singleV8=p.family==='v8'&&((handshakeInfo?.ecuMode===1)||(handshakeInfo?.ecuMode===4));
  document.querySelectorAll('.mapBankBtn').forEach(b=>{
    const blocked=singleV8&&Number(b.dataset.mapbank)>1;
    setProfileDisabled(b,blocked,blocked?'ECU Profile: '+p.label+' · ECU_MODE này chỉ có một MAP.':'');
  });

  // V8 and V11 MAIN TUNE intentionally expose only page families whose exact
  // page mapping, byte width and unit conversion were verified from their EXEs.
  const limitedMain=new Set(['inj_ve','idle_limit','ect_idle_motor','auto_shift','auto_clutch','chg_params','ate_options','ect_start','inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map']);
  document.querySelectorAll('[data-feature]').forEach(el=>{
    const id=el.dataset.feature;
    const limited=(p.family==='v8'||p.family==='v11');
    const v11Only=(id==='auto_shift'||id==='chg_params'||id==='ate_options'||id==='ect_start');
    const blocked=(limited&&!limitedMain.has(id))||(v11Only&&p.family!=='v11')||(id==='auto_clutch'&&p.family==='v8');
    setProfileDisabled(el,blocked,blocked?'ECU Profile: '+p.label+' · bảng này chưa được giải mã an toàn cho profile này.':'');
    // Clean profile-specific UI: V11-only cards do not appear on REDLEO V8/V9/V10.
    if(v11Only)el.style.display=p.family==='v11'?'':'none';
    // Spare is a pre-9.x concept and is not part of the verified ATE V11 UI.
    if(id==='spare'&&p.family==='v11')el.style.display='none';
    else if(id==='spare'&&p.family!=='v11')el.style.display='';
  });
}
function setEcuProfile(p){
  ecuProfile=p||ECU_PROFILE_DEFS.UNKNOWN;
  if(typeof state!=='undefined')state.ecuProfile=ecuProfile.key;
  applyProfileUi();
  log('ECU PROFILE',ecuProfile.key,ecuProfile.label);
  return ecuProfile;
}

function log(...a){console.log(TAG,...a)}
function err(...a){console.error(TAG,...a)}
function clamp(v,a,b){v=Number(v);return Math.max(a,Math.min(b,Number.isFinite(v)?v:0))}
function r1(v){return Math.round(v*10)/10}
function r2(v){return Math.round(v*100)/100}
function r3(v){return Math.round(v*1000)/1000}
function checksum8(a,n=a.length){let s=0;for(let i=0;i<n;i++)s=(s+(a[i]&255))&255;return s}
function req5(cmd,arg){const s=(cmd+arg)&255;return new Uint8Array([cmd,arg,(255-s)&255,s,5])}
function validFrame(f){return !!f&&f.length>=3&&(((f[0]+f[f.length-1])&255)===255)&&checksum8(f,f.length-2)===f[f.length-2]}
function normalizeBankForProfile(bank){
  bank=clamp(Math.round(bank),1,4);
  if(ecuProfile&&ecuProfile.family==='v8'){
    const mode=Number(handshakeInfo&&handshakeInfo.ecuMode)||0;
    if(mode===1||mode===4)return 1;
  }
  return bank;
}
function pageLow(bank){
  bank=normalizeBankForProfile(bank);
  if(ecuProfile&&ecuProfile.family==='v8'){
    const mode=Number(handshakeInfo&&handshakeInfo.ecuMode)||0;
    if(mode===1)return 2; // PC ECU mode: REDLEO V8 forces page low nibble 2.
    if(mode===4)return 1; // OEM mode: REDLEO V8 forces page low nibble 1.
    return bank;          // Four/Eight/exFour/exEight: pages 1..4.
  }
  return [0,2,4,6,8][bank];
}
function page(high,bank){return (high<<4)|pageLow(bank)}
function u16be(a,i){return ((a[i]<<8)|a[i+1])>>>0}
function push16be(a,v){v=clamp(Math.round(v),0,65535);a.push((v>>8)&255,v&255)}
function finalizePage(a){const s=checksum8(a);a.push((255-s)&255,s,(a.length+3)&255);return new Uint8Array(a)}
function pageFrame(pg,payload){return finalizePage([0xCD,pg,...payload])}
function validateOutgoingPageFrame(tx,pg,payloadLen){
  if(!(tx instanceof Uint8Array))tx=new Uint8Array(tx||[]);
  const expectedLen=Number(payloadLen)+5;
  if(tx.length!==expectedLen)throw new Error('WRITE FRAME sai độ dài · '+tx.length+'B / '+expectedLen+'B');
  if(tx[0]!==0xCD||tx[1]!==((pg)&255))throw new Error('WRITE FRAME sai command/page.');
  if(tx[tx.length-1]!==((tx.length)&255))throw new Error('WRITE FRAME sai length byte.');
  const sum=checksum8(tx,tx.length-3);
  if(tx[tx.length-2]!==sum||(((tx[tx.length-3]+sum)&255)!==255))throw new Error('WRITE FRAME sai checksum.');
  return true;
}
function bridgeRawWriteSafe(){
  const t=String(window.blinkBridgeFirmwareStatus||'');
  const m=t.match(/FW\s*(\d+)\.(\d+)/i);
  if(!m)return false;
  const major=Number(m[1]),minor=Number(m[2]);
  return major>1||(major===1&&minor>=1);
}

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

// ATE / REDLEO V11 changed the main injection-angle and ignition-angle unit
// transforms while keeping the same page families and byte widths.
// Derived from V11 __InjAngle_PcEcu_Unit / __Ign_To_PcEcu with the original
// application's default B_True=false mode.
function isV11Profile(){return !!(ecuProfile&&ecuProfile.key==='MODERN_V11')}
function decMainInjAngle(raw){
  if(isV11Profile())return clamp(Math.round((Number(raw)*512/360)/2)*2,0,360);
  return decOilAngle(raw);
}
function encMainInjAngle(v){
  if(isV11Profile())return clamp(Math.round(Number(v)*360/512),0,255);
  return encOilAngle(v);
}
function decMainIgn(raw){
  if(isV11Profile())return r1((Number(raw)-64)*0.28125);
  return decIgn(raw);
}
function encMainIgn(v){
  if(isV11Profile())return clamp(Math.round(Number(v)/0.28125)+64,0,255);
  return encIgn(v);
}
function decLiveIgn(raw){
  if(isV11Profile())return r2((Number(raw)/32-16)*1.125);
  return Number(raw)/32-16;
}
function decMainDwell(raw){
  if(isV11Profile())return r2(Number(raw)/20);
  return decOil(raw);
}
function encMainDwell(v){
  if(isV11Profile())return clamp(Math.round(Math.max(0,Number(v))*20),0,255);
  return encOil(v);
}
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
// ATE V11 EX_ADJ uses the V11 ignition-angle unit path, centered at raw 128.
// Verified from proUartDgvNum/Uart_DatToDgv: 1 raw step = 0.28125 degree.
function decV11ExtIgn(raw){return r2((Number(raw)-128)*0.28125)}
function encV11ExtIgn(v){return clamp(Math.round(Number(v)/0.28125)+128,0,255)}
function decV11ExtPct(raw){return Math.round(((Number(raw)-128)*100)/128)}
function encV11ExtPct(v){return clamp(Math.round(Number(v)*128/100)+128,0,255)}
// ATE V11 Automatic Clutch (Dgv_Dzfm) lives in A2 configRaw[1..6].
// Cols: Low RPM, High RPM, Low Angle, High Angle, Close RPM, ECT-On Voltage.
function v11RoundEven(x){
  x=Number(x);if(!Number.isFinite(x))return 0;
  const f=Math.floor(x),d=x-f;
  if(Math.abs(d-0.5)<1e-12)return (f%2===0)?f:f+1;
  return Math.round(x);
}
function decV11Option(index,raw,vEct){
  raw=Number(raw)&255;
  if(index===0||index===1||index===12||index===13)return r2(raw*5/256);
  if(index===2||index===3)return r3(raw*0.064);
  if(index===4)return r2(raw*0.140625);
  if(index===5||index===8)return r3(raw*0.016);
  if(index===6||index===19)return raw*20;
  if(index===7)return r2(raw*0.03515625);
  if(index===9)return ectRawToTemp(raw,vEct);
  if(index===10)return r2(raw*100/128);
  if(index===11)return r2(raw*6.25);
  if(index>=14&&index<=18)return raw*2;
  return raw;
}
function encV11Option(index,v,vEct){
  v=Number(v);if(!Number.isFinite(v))v=0;
  if(index===0||index===1||index===12||index===13)return clamp(Math.round(v*256/5),0,255);
  if(index===2||index===3)return clamp(Math.round(Math.max(0,v)/0.064),0,255);
  if(index===4)return clamp(Math.round(Math.max(0,v)/0.140625),0,127);
  if(index===5||index===8)return clamp(Math.round(Math.max(0,v)/0.016),0,127);
  if(index===6||index===19)return clamp(Math.round(Math.max(500,v)/20),0,255);
  if(index===7)return clamp(Math.round(Math.max(0,v)/0.03515625),0,127);
  if(index===9)return clamp(Math.round(ectTempToRaw(v,vEct)),0,255);
  if(index===10)return clamp(Math.round(v*128/100),0,255);
  if(index===11)return clamp(Math.round(Math.max(0,v)/6.25),0,255);
  if(index>=14&&index<=17)return clamp(Math.round(Math.max(0,v)/2),0,255);
  if(index===18)return clamp(Math.round(Math.max(0,v)/2),0,127);
  return clamp(Math.round(v),0,255);
}
function decodeV11Options20(raw,vEct){
  raw=raw instanceof Uint8Array?raw:new Uint8Array(raw||[]);
  if(raw.length<30)throw new Error('ATE V11 Options cần đủ 30 byte.');
  return [Array.from({length:20},(_,i)=>decV11Option(i,raw[i],vEct))];
}
function encV11Options20(matrix,vEct){
  if(!Array.isArray(matrix)||matrix.length!==1||!Array.isArray(matrix[0])||matrix[0].length!==20)throw new Error('ATE V11 Options cần bảng 1 × 20.');
  const v=matrix[0].map(Number);
  if(v.some(x=>!Number.isFinite(x)))throw new Error('ATE V11 Options có giá trị không hợp lệ.');
  if(v[0]<0||v[0]>5||v[1]<0||v[1]>5||v[0]>=v[1])throw new Error('TPS Voltage Min/Max phải trong 0–5V và Min < Max.');
  if(v[9]<0||v[9]>140)throw new Error('Fan temperature phải trong 0–140°C.');
  return new Uint8Array(v.map((x,i)=>encV11Option(i,x,vEct)));
}

function decV11EctStartCell(uiRow,raw){
  raw=Number(raw)&255;
  if(uiRow===0)return r1(raw*0.2);          // Delayed (Second)
  if(uiRow===1||uiRow===3)return r2(raw/20); // INJ add / Not Started add (ms)
  if(uiRow===2)return raw;                  // Not Delayed (Number)
  return raw;
}
function encV11EctStartCell(uiRow,v){
  v=Number(v);if(!Number.isFinite(v))v=0;
  if(uiRow===0)return clamp(Math.round(Math.max(0,v)*5),0,255);
  if(uiRow===1||uiRow===3)return clamp(Math.round(Math.max(0,v)*20),0,255);
  if(uiRow===2)return clamp(Math.round(Math.max(1,v)),1,255);
  return clamp(Math.round(v),0,255);
}
function decodeV11EctStart44(raw){
  raw=raw instanceof Uint8Array?raw:new Uint8Array(raw||[]);
  if(raw.length<44)throw new Error('ATE V11 ECT Start cần 44 byte.');
  const m=Array.from({length:4},()=>Array(11).fill(0));
  let p=0;
  // Original proUartDgvNum/Uart_DatToDgv reverse UI rows on the wire.
  for(let wireRow=0;wireRow<4;wireRow++){
    const uiRow=3-wireRow;
    for(let c=0;c<11;c++,p++)m[uiRow][c]=decV11EctStartCell(uiRow,raw[p]);
  }
  return m;
}
function encodeV11EctStart44(matrix){
  if(!Array.isArray(matrix)||matrix.length!==4||matrix.some(r=>!Array.isArray(r)||r.length!==11))throw new Error('ATE V11 ECT Start cần bảng 4 × 11.');
  const out=new Uint8Array(44);let p=0;
  for(let wireRow=0;wireRow<4;wireRow++){
    const uiRow=3-wireRow;
    for(let c=0;c<11;c++,p++)out[p]=encV11EctStartCell(uiRow,matrix[uiRow][c]);
  }
  return out;
}

function decV11Chg(col,raw){
  raw=Number(raw)&255;
  if(col<=2){
    if(raw===0)return 0;
    return v11RoundEven((250000/raw)/10)*10;
  }
  if(col<=5)return r2((180*raw/1024)+28.125);
  if(col===6)return r2((25*raw/1024)+13.8);
  if(col===7)return r2((25*raw/1024)+14.8);
  return raw;
}
function encV11Chg(col,v){
  v=Number(v);if(!Number.isFinite(v))v=0;
  if(col<=2){
    v=Math.max(800,v);
    return clamp(v11RoundEven(250000/v),0,255);
  }
  if(col<=5){
    const adj=v>28.125?v-28.125:0;
    return clamp(v11RoundEven(1024*adj/180),0,255);
  }
  if(col===6){
    const adj=v>13.8?v-13.8:0;
    return clamp(v11RoundEven(adj*1024/25),0,255);
  }
  if(col===7){
    const adj=v>14.8?v-14.8:0;
    return clamp(v11RoundEven(adj*1024/25),0,255);
  }
  return clamp(v11RoundEven(v),0,255);
}
function decodeV11Chg8(raw){
  raw=raw instanceof Uint8Array?raw:new Uint8Array(raw||[]);
  if(raw.length<8)throw new Error('ATE V11 CHG cần 8 byte.');
  return [Array.from({length:8},(_,i)=>decV11Chg(i,raw[i]))];
}
function encV11Chg8(matrix){
  if(!Array.isArray(matrix)||matrix.length!==1||!Array.isArray(matrix[0])||matrix[0].length!==8)throw new Error('ATE V11 CHG cần bảng 1 × 8.');
  const v=matrix[0].map(Number);
  if(v.some(x=>!Number.isFinite(x)))throw new Error('ATE V11 CHG có giá trị không hợp lệ.');
  if(v[0]>v[1]||v[1]>v[2])throw new Error('CHG RPM phải theo thứ tự Min ≤ Mid ≤ Max.');
  if(v[3]>v[4]||v[4]>v[5])throw new Error('CHG Current phải theo thứ tự Min ≤ Mid ≤ Max.');
  return new Uint8Array(v.map((x,i)=>encV11Chg(i,x)));
}

function decV11Dzfm(col,raw){
  raw=Number(raw)&255;
  if(col===0||col===1||col===4)return raw*20;
  if(col===2||col===3)return -Math.round(raw*0.28125);
  if(col===5)return r2(raw*5/256);
  return raw;
}
function encV11Dzfm(col,v){
  v=Number(v);if(!Number.isFinite(v))v=0;
  if(col===0||col===1||col===4)return clamp(Math.round(Math.max(500,v)/20),0,255);
  if(col===2||col===3)return clamp(Math.round(Math.min(40,Math.abs(v))/0.28125),0,255);
  if(col===5)return clamp(Math.round(v*256/5),0,255);
  return clamp(Math.round(v),0,255);
}
function decodeV11AutoClutch(configRaw){
  const r=configRaw instanceof Uint8Array?configRaw:new Uint8Array(configRaw||[]);
  if(r.length<11)throw new Error('ATE V11 config block cần 11 byte.');
  return [Array.from({length:6},(_,i)=>decV11Dzfm(i,r[1+i]))];
}
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
  if(!(a.length>=9&&a[0]===0x5A&&validFrame(a))){
    const f=findValidCommandFrame(a,0x5A,9);
    if(!f)throw new Error('Handshake 0x5A không hợp lệ · '+a.length+'B');
    a=f;
  }
  const info={raw:a.slice(),short:a.length===9,activeMap:1,ecuId:1,password:null};
  if(a.length>=35){
    info.ident=ascii(a,1,16);
    info.firmware=ascii(a,17,4);
    info.date=ascii(a,21,6);
    info.classify=a[27]&15;
    info.ecuMode=(a[27]>>4)&15;
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
  const p=info.profile||profileFromHandshake(info);
  setEcuProfile(p);
  if(typeof state!=='undefined'){
    state.ecuConnected=true;state.ecuPhase='identified';state.ecuId=info.ecuId||1;
    if(info.activeMap>=1&&info.activeMap<=4&&!state.threeRun?.active){state.activeMap=info.activeMap;const ms=document.getElementById('mapSelect');if(ms)ms.value=String(info.activeMap);}
  }
  const cls=Number.isFinite(info.classify)?classNameFromCode(info.classify):(p.family==='legacy'?'LEGACY':'OTHER');
  const profileText=p.family==='v8'?(p.label+' · ECU_MODE '+(info.ecuMode??'—')):p.label;
  const vals=[cls,info.ident||p.label,'ID '+(info.ecuId||1),'Signal '+(info.sumSignal??'—'),String(info.zeroIgn??'—'),String(info.zeroInj??'—'),info.firmware||'—',info.date||'—',profileText];
  document.querySelectorAll('[data-ecuinfo]').forEach((e,i)=>e.textContent=vals[i]||'—');

  // V8 mode 1 and mode 4 are single-bank layouts in the original REDLEO app.
  const singleV8=p.family==='v8'&&(info.ecuMode===1||info.ecuMode===4);
  if(singleV8&&typeof state!=='undefined')state.activeMap=1;
  ['mapSelect','redBankSelect','idleLimitBankSelect'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(singleV8)el.value='1';
    [...el.options||[]].forEach(o=>o.disabled=singleV8&&Number(o.value)>1);
  });
  applyProfileUi();
  const b=document.getElementById('ecuBadge');if(b){b.textContent='ECU: '+p.short+' · MAP No.'+((typeof state!=='undefined'&&state.activeMap)||info.activeMap||1)+' · ID '+(info.ecuId||1);b.className='badge ok';}
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
  state.live.pw=u16be(a,16)/(ecuProfile&&ecuProfile.family==='v8'?640:500);
  state.live.ign=decLiveIgn(u16be(a,28));
  state.live.batt=u16be(a,42)*55/1024;
  const liveCal=readCache||sensorCalCache;
  if(liveCal){
    state.live.ect=curveVoltageToAxis(decVolt(a[2]),liveCal.vEct,14);
    state.live.iat=curveVoltageToAxis(decVolt(a[3]),liveCal.vIat,6);
    state.live.mapKpa=curveVoltageToAxis(liveVolt10(u16be(a,4)),liveCal.vMap,12);
  }else{
    state.live.ect=NaN;
    state.live.iat=NaN;
    state.live.mapKpa=NaN;
  }
  const put=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=val};
  put('ectLive',Number.isFinite(state.live.ect)?r1(state.live.ect).toFixed(1)+' °C':'--');
  put('iatLive',Number.isFinite(state.live.iat)?r1(state.live.iat).toFixed(1)+' °C':'--');
  put('mapKpaLive',Number.isFinite(state.live.mapKpa)?r1(state.live.mapKpa).toFixed(1)+' kPa':'--');
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
  let firstErr=null;
  try{
    const rx=await rawExchange(req5(0x5A,0x5A),6000);
    const info=parseHandshake(rx);
    info.profile=profileFromHandshake(info);
    if(info.profile.family==='v8'){
      // REDLEO V8 byte33 is serial/config related, not the V9 active-map byte.
      info.activeMap=1;
      info.ecuId=1;
    }
    syncHandshakeInfo(info);
    syncCapabilityFlags(info);
    return info;
  }catch(e){
    firstErr=e;
    log('0x5A handshake failed, trying safe legacy 0x69 probe:',String(e&&e.message||e));
  }

  // V3 / very old REDLEO builds do not use the modern 0x5A flow.
  // 0x69 is read-only; use one probe only to identify a legacy ECU, then lock
  // all modern page/write operations until a dedicated legacy parser exists.
  try{
    const rx=await rawExchange(req5(0x69,1),8000);
    const f=findValidCommandFrame(rx,0xA1,3);
    if(!f)throw new Error('Legacy probe không có frame A1 checksum hợp lệ');
    const info={raw:new Uint8Array(0),short:true,activeMap:1,ecuId:1,password:null,ident:'REDLEO LEGACY',firmware:'LEGACY',date:'—',legacyProbe:true,legacyLiveLength:f.length,profile:ECU_PROFILE_DEFS.LEGACY_PROBE};
    syncHandshakeInfo(info);
    return info;
  }catch(e){
    throw new Error('Không nhận diện được ECU. 5A: '+String(firstErr&&firstErr.message||firstErr)+' · legacy 69: '+String(e&&e.message||e));
  }
}
let v8LiveSlot=0;
async function liveOnce(){
  if(!cmdChar()||busy||document.hidden)return;
  try{
    const mapNo=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4);
    let arg=mapNo;
    if(ecuProfile&&ecuProfile.family==='v8'){
      v8LiveSlot=(v8LiveSlot+1)%10;
      arg=((v8LiveSlot&15)<<4)|(pageLow(mapNo)&15);
    }
    const rx=await rawExchange(req5(0x69,arg),5000);
    parseLiveReal(rx);
  }catch(e){if(!/bận/.test(String(e.message||e)))console.warn(TAG,'live',e);}
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

    // Every new connection starts with a visibly empty ECU map UI.
    // This prevents stale values from looking like a successful ECU read.
    try{window.resetEcuMapUiForNewSession?.();}catch(_e){}
    readCache=null;
    pageCache.clear();
    fuelPagePrimed.clear();
    v8LiveSlot=0;

    if(typeof state!=='undefined')state.ecuPhase='handshake';
    taskUi('loading','ĐANG XÁC NHẬN ECU...');
    const info=await handshakeReal();
    if(epoch!==transportEpoch)throw new Error('BLE đổi kết nối trong lúc handshake');
    const newCalIdentity=[
      ecuProfile?.key||'UNKNOWN',info.ident||'',info.firmware||'',info.ecuId||1
    ].join('|');
    if(sensorCalCache&&sensorCalIdentity!==newCalIdentity){
      sensorCalCache=null;
      sensorCalIdentity=null;
      log('sensor calibration cache cleared: ECU identity changed');
    }

    // Profiles explicitly advertising live support enter the live pipeline.
    // Unknown/legacy profiles remain connected in SAFE MODE with write gates closed.
    if(profileCap('live')){
      if(typeof state!=='undefined')state.ecuPhase='live';
      startLiveLoop();
      taskUi('success','ECU ONLINE · '+ecuProfile.short+' · LIVE 0x69 · OK');
      // If the user connected while already viewing a supported ECU table,
      // lazily read only that visible table. INJ VE itself remains manual-read.
      setTimeout(()=>{try{window.autoReadVisibleEcuPage?.('connect')}catch(_e){}},250);
      // Do NOT auto-read the large V11 A2 page on connect. It blocks the ECU
      // for several seconds on Bluefy/iOS and can collide with the user's first action.
      // A2 is read lazily only when an A2-backed feature is opened or explicitly requested.
    }else{
      stopLiveLoop();
      if(typeof state!=='undefined')state.ecuPhase='profile-locked';
      taskUi('success','ECU ONLINE · '+ecuProfile.short+' · SAFE MODE');
      notice('info','ECU ĐÃ NHẬN DIỆN',ecuProfile.label+'\nĐã khóa các lệnh chưa được xác nhận để tránh ghi sai protocol.');
    }
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
  readCache=null;
  pageCache.clear();
  fuelPagePrimed.clear();
  v8LiveSlot=0;
  ecuProfile=ECU_PROFILE_DEFS.UNKNOWN;
  try{applyProfileUi();}catch(_e){}
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
    if(flags&1){
      // Firmware may deliberately repeat the first START chunk on long frames.
      // Initialize once; do not wipe chunks already received if that duplicate
      // START is delivered late by the browser/BLE stack.
      if(!p.buf||p.total!==total){
        p.total=total;p.buf=new Uint8Array(total);p.got=0;p.seen=new Set();
      }
    }
    if(!p.buf||p.total!==total||off+(d.byteLength-7)>p.buf.length)return;
    const bytes=new Uint8Array(d.buffer,d.byteOffset+7,d.byteLength-7);
    p.buf.set(bytes,off);
    // Count each offset only once; reconnect/retransmit must not make got exceed total.
    if(!p.seen)p.seen=new Set();
    if(!p.seen.has(off)){p.seen.add(off);p.got+=bytes.length;}
    // Do not trust the END flag alone. Large INJ VE streams can lose one BLE
    // notification on iOS; only resolve after every unique payload offset arrived.
    if(p.got>=p.total){
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

async function writeRawBleChunk(cur,pkt,reliable){
  // ESP32 bridge assembles RAW chunks strictly by offset. For multi-chunk frames
  // (fuel writes, A2 writes, etc.) use ATT write-with-response so the next offset
  // is not sent until the previous chunk has been accepted by the bridge.
  if(reliable){
    if(typeof cur.writeValueWithResponse==='function'){await cur.writeValueWithResponse(pkt);return;}
    if(typeof cur.writeValue==='function'){await cur.writeValue(pkt);return;}
    if(typeof cur.writeValueWithoutResponse==='function'){
      await cur.writeValueWithoutResponse(pkt);
      await new Promise(r=>setTimeout(r,14));
      return;
    }
  }
  if(typeof cur.writeValueWithoutResponse==='function'){await cur.writeValueWithoutResponse(pkt);return;}
  if(typeof cur.writeValueWithResponse==='function'){await cur.writeValueWithResponse(pkt);return;}
  if(typeof cur.writeValue==='function'){await cur.writeValue(pkt);return;}
  throw new Error('BLE characteristic không hỗ trợ ghi RAW');
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
    try{
      const reliableChunks=total>RAW_CHUNK;
      for(let off=0;off<total;off+=RAW_CHUNK){
        if(myEpoch!==transportEpoch)throw new Error('BLE transport đã thay đổi');
        const cur=cmdChar();if(!cur)throw new Error('BLE đã ngắt');
        const n=Math.min(RAW_CHUNK,total-off),pkt=new Uint8Array(7+n);
        pkt[0]=RAW_TX;pkt[1]=id;pkt[2]=(off===0?1:0)|((off+n>=total)?2:0);pkt[3]=total&255;pkt[4]=(total>>8)&255;pkt[5]=off&255;pkt[6]=(off>>8)&255;pkt.set(data.subarray(off,off+n),7);
        await writeRawBleChunk(cur,pkt,reliableChunks);
        // With-response already provides flow control. Keep only a tiny yield on
        // long frames so Bluefy/iOS can service notifications/UI between chunks.
        if(reliableChunks&&((off/RAW_CHUNK+1)%12===0))await new Promise(r=>setTimeout(r,2));
      }
    }catch(e){
      const p=pending.get(id);
      if(p){clearTimeout(p.to);pending.delete(id);}
      throw e;
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
  const prefix=new Uint32Array(a.length+1);
  for(let i=0;i<a.length;i++)prefix[i+1]=prefix[i]+a[i];
  for(let i=0;i<a.length;i++){
    if(a[i]!==start)continue;
    const minEnd=i+minLen-1;
    for(let end=a.length-1;end>=minEnd;end--){
      if(a[end]!==tail)continue;
      // checksum byte is end-1; checksum covers i..end-2.
      const sum=(prefix[end-1]-prefix[i])&255;
      if(sum===a[end-1])return a.slice(i,end+1);
    }
  }
  return null;
}
function parseV11ReadAll9958(f){
  if(!(f instanceof Uint8Array))f=new Uint8Array(f||[]);
  if(f.length!==9958||f[0]!==0xAE&&f[0]!==0xAB&&f[0]!==0x8B)throw new Error('ATE V11 Read All phải 9958B');
  if(!validFrame(f))throw new Error('ATE V11 Read All 9958B checksum không hợp lệ');
  let p=1;
  const C={
    raw:f.slice(),sourceLength:f.length,layoutInfo:'ATE-V11-9958',rawOnly:false,v11Decoded:true,
    banks:[],hidden:{}
  };
  C.tpsRaw=f.slice(p,p+28);p+=28;
  C.tpsVolt=Array.from(C.tpsRaw.slice(0,14),decVolt);
  C.tpsPct=Array.from(C.tpsRaw.slice(14,28),x=>Number(x)/2);
  C.rpmRaw=f.slice(p,p+60);p+=60;
  C.rpmAxis=[];for(let i=0;i<60;i+=2)C.rpmAxis.push(u16be(C.rpmRaw,i)*20);
  C.vAfrRaw=f.slice(p,p+11);p+=11;
  C.vEctRaw=f.slice(p,p+11);C.vEct=Array.from(C.vEctRaw,decVolt);p+=11;
  C.vIatRaw=f.slice(p,p+11);C.vIat=Array.from(C.vIatRaw,decVolt);p+=11;
  C.vMapRaw=f.slice(p,p+11);C.vMap=Array.from(C.vMapRaw,decVolt);p+=11;
  C.iatInjRaw=f.slice(p,p+11);C.iatInj=Array.from(C.iatInjRaw,x=>r2(Number(x)/20));p+=11;
  C.mapMotorRaw=f.slice(p,p+11);C.mapMotor=Array.from(C.mapMotorRaw,x=>Number(x));p+=11;
  C.configRaw=f.slice(p,p+11);
  C.autoClutch=decodeV11AutoClutch(C.configRaw);
  p+=11;

  // V11 option area after Config/PW. Keep exact raw until each cell semantic
  // is mapped; offsets and lengths are proven from the V11 grid serializer.
  C.optionRawV11=f.slice(p,p+24);p+=24;
  C.ectStartRaw=f.slice(p,p+33);p+=33;
  C.globalAuxRaw=f.slice(p,p+9);p+=9;

  C.ectInjRaw=f.slice(p,p+330);let z=decodeRowsByte(f,p,11,30,decPct);C.ectInj=z.data;p=z.next;
  C.ectIgnRaw=f.slice(p,p+330);z=decodeRowsByte(f,p,11,30,decMainIgn);C.ectIgn=z.data;p=z.next;
  C.mapInjRaw=f.slice(p,p+330);z=decodeRowsByte(f,p,11,30,decMapInj);C.mapInj=z.data;p=z.next;

  for(let bank=1;bank<=4;bank++){
    const B={bank};
    B.injRaw=f.slice(p,p+840);
    z=decodeRowsU16(f,p,14,30,decOilTab);B.inj=z.data;p=z.next;
    B.injDegreeRaw=f.slice(p,p+420);
    z=decodeRowsByte(f,p,14,30,decMainInjAngle);B.injDegree=z.data;p=z.next;
    B.ignDegreeRaw=f.slice(p,p+420);
    z=decodeRowsByte(f,p,14,30,decMainIgn);B.ignDegree=z.data;p=z.next;
    B.ignTimeRaw=f.slice(p,p+30);
    z=decodeRowsByte(f,p,1,30,decMainDwell);B.ignTime=z.data;p=z.next;
    B.afRaw=f.slice(p,p+420);p+=420;
    B.idleRaw=f.slice(p,p+24);p+=24;
    B.auxRaw=f.slice(p,p+9);p+=9;
    B.ectMotorRaw=f.slice(p,p+11);p+=11;
    C.banks.push(B);
  }
  C.externalRaw=f.slice(p,p+30);p+=30;
  C.external=[Array(15).fill(0),Array(15).fill(0)];
  for(let c=0;c<15;c++)C.external[1][c]=decV11ExtIgn(C.externalRaw[c]);
  for(let c=0;c<15;c++)C.external[0][c]=decV11ExtPct(C.externalRaw[15+c]);
  C.chgRaw=f.slice(p,p+8);p+=8;
  if(p!==f.length-2)throw new Error('ATE V11 Read All layout lệch offset '+p+' / checksum '+(f.length-2));
  C.hidden.tailData=f.slice(p,f.length-2);
  return C;
}

function syncV11ReadAll(C){
  readCache=C;
  window.blinkReadAllLayout={length:C.sourceLength,layout:C.layoutInfo,rawOnly:false,v11Decoded:true};
  window.blinkV11ReadAll={
    length:C.sourceLength,
    optionRaw:Array.from(C.optionRawV11||[]),
    ectStartRaw:Array.from(C.ectStartRaw||[]),
    globalAuxRaw:Array.from(C.globalAuxRaw||[]),
    externalRaw:Array.from(C.externalRaw||[]),
    chgRaw:Array.from(C.chgRaw||[]),
    bankIdleRaw:(C.banks||[]).map(b=>Array.from(b.idleRaw||[])),
    bankAuxRaw:(C.banks||[]).map(b=>Array.from(b.auxRaw||[])),
    bankEctMotorRaw:(C.banks||[]).map(b=>Array.from(b.ectMotorRaw||[]))
  };
  syncFuel(C);
  sensorCalCache={
    raw:C.raw.slice(),tpsRaw:C.tpsRaw.slice(),tpsVolt:C.tpsVolt.slice(),tpsPct:C.tpsPct.slice(),
    rpmRaw:C.rpmRaw.slice(),rpmAxis:C.rpmAxis.slice(),vAfrRaw:C.vAfrRaw.slice(),
    vEct:C.vEct.slice(),vIat:C.vIat.slice(),vMap:C.vMap.slice(),
    iatInj:C.iatInj.slice(),mapMotor:C.mapMotor.slice(),configRaw:C.configRaw.slice()
  };
  sensorCalIdentity=handshakeInfo?[
    ecuProfile?.key||'UNKNOWN',handshakeInfo.ident||'',handshakeInfo.firmware||'',handshakeInfo.ecuId||1
  ].join('|'):null;
  if(typeof state!=='undefined'&&C.tpsVolt.length===14){
    const lo=Number(C.tpsVolt[0]),hi=Number(C.tpsVolt[13]);
    if(Number.isFinite(lo)&&Number.isFinite(hi)&&Math.abs(hi-lo)>.1){state.cal.tpsMin=lo;state.cal.tpsMax=hi;}
  }
  for(const b of C.banks){
    emitFeature(N.inj_degree,b.injDegree,b.bank);
    emitFeature(N.ign_degree,b.ignDegree,b.bank);
    emitFeature(N.ign_time,b.ignTime,b.bank);
  }
  emitFeature(N.ect_inj,C.ectInj);
  emitFeature(N.ect_ign,C.ectIgn);
  emitFeature(N.map_inj,C.mapInj);
  emitFeature(N.iat_inj,[C.iatInj]);
  emitFeature(N.map_idle_motor,[C.mapMotor]);
  // Read-All 9958 has a different compact partition after configRaw.
  // Do not populate direct-A2 External/CHG UI from those bytes.
  if(C.autoClutch)emitFeature(N.auto_clutch,C.autoClutch);
  emitFeature(N.v_ect,[C.vEct]);
  emitFeature(N.v_iat,[C.vIat]);
  emitFeature(N.v_map,[C.vMap]);
  try{syncControls();render();updateLive();saveSoon();applyProfileUi();}catch(_e){}
  const st=document.getElementById('redIoStatus');
  if(st)st.textContent='ATE V11 · READ ALL 9958B · KNOWN TABLES DECODED · UNKNOWN BYTES PRESERVED';
}

function parseReadAll(a){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a);
  const f=findValidCommandFrame(a,0xAB,100)||findValidCommandFrame(a,0x8B,100)||findValidCommandFrame(a,0xAE,100);
  if(!f)throw new Error('Read All không tìm thấy frame AB/8B/AE checksum hợp lệ trong RX '+a.length+'B');

  // ATE V11.1 exact full-image layout reconstructed from the original EXE.
  if(isV11Profile()&&f.length===9958)return parseV11ReadAll9958(f);

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
function syncIdle(bank){
  if(!readCache)return;
  bank=clamp(Math.round(bank),1,4);
  const b=readCache.banks&&readCache.banks[bank-1];
  if(!b)return;
  if(readCache.v11Decoded){
    // V11 stores a 44-byte Idle family per bank (24 Idle + 9 Aux + 11 ECT Motor),
    // not the V9 idle[]/ectMotor structure. Never feed V11 raw bytes into V9 UI.
    const st=document.getElementById('redIoStatus');
    if(st)st.textContent='ATE V11 · IDLE MAP '+bank+' · READ-ONLY RAW '+((b.idleRaw?.length||0)+(b.auxRaw?.length||0)+(b.ectMotorRaw?.length||0))+'B';
    return;
  }
  if(!Array.isArray(b.idle)||!Array.isArray(b.ectMotor))return;
  const o=idleObject(b);
  for(const[k,v]of Object.entries(o))setValue('[data-idleopt="'+k+'"]',v);
  emitFeature(N.ect_idle_motor,b.ectMotor,bank);
}
function syncAll(C){
  readCache=C;window.blinkReadAllLayout={length:C.sourceLength,layout:C.layoutInfo,extension:C.extension128||null};syncFuel(C);syncOptions(C);
  try{applyProfileUi();}catch(_e){}
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
  const pg=page(1,bank);

  if(ecuProfile&&ecuProfile.family==='v8'){
    const f=findValidCommandFrame(a,pg,423);
    if(!f)throw new Error('V8 READ CURRENT MAP No.'+bank+' · không tìm thấy frame page 0x'+pg.toString(16).toUpperCase()+' hợp lệ trong RX '+a.length+'B');
    const out=Array.from({length:14},()=>Array(30).fill(0));
    let p=1;
    for(let wireRow=0;wireRow<14;wireRow++){
      const uiRow=13-wireRow;
      for(let c=0;c<30;c++)out[uiRow][c]=r2(f[p++]/20);
    }
    return {frame:f,matrix:out,page:pg,rawPayload:f.slice(1,f.length-2)};
  }

  // V9+ fuel uses uint16 BE cells: No.1=0x12, No.2=0x14, No.3=0x16, No.4=0x18.
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
  return {frame:f,matrix:out,page:pg,rawPayload:f.slice(1,f.length-2)};
}
function encodeFuelVerifyRaw(matrix){
  if(!Array.isArray(matrix)||matrix.length!==14||matrix.some(r=>!Array.isArray(r)||r.length!==30))throw new Error('MAP verify cần ma trận 14x30.');
  const out=[];
  const v8=ecuProfile&&ecuProfile.family==='v8';
  for(let r=13;r>=0;r--)for(let c=0;c<30;c++){
    const v=Number(matrix[r][c]);
    if(v8)out.push(clamp(Math.round(v*20),0,255));
    else push16be(out,encOilTab(v));
  }
  return new Uint8Array(out);
}
function parseV11A2Data(data){
  if(!(data instanceof Uint8Array))data=new Uint8Array(data);
  // Direct A2 page layout from the original ATE 11.1 serializer:
  // 165B prefix + Option 30B + ECT Start 44B + Spare 9B + External 30B + CHG 8B = 286B.
  if(data.length<165)throw new Error('ATE V11 page A2 thiếu dữ liệu · '+data.length+'B / cần tối thiểu 165B');
  let p=0;
  const tpsRaw=data.slice(p,p+28);p+=28;
  const tpsVolt=Array.from(tpsRaw.slice(0,14),decVolt);
  const tpsPct=Array.from(tpsRaw.slice(14,28),x=>Number(x)/2);
  const rpmRaw=data.slice(p,p+60);p+=60;
  const rpmAxis=[];for(let i=0;i<60;i+=2)rpmAxis.push(u16be(rpmRaw,i)*20);
  const vAfrRaw=data.slice(p,p+11);p+=11;
  const vEct=Array.from(data.slice(p,p+11),decVolt);p+=11;
  const vIat=Array.from(data.slice(p,p+11),decVolt);p+=11;
  const vMap=Array.from(data.slice(p,p+11),decVolt);p+=11;
  const iatInj=Array.from(data.slice(p,p+11),x=>r2(Number(x)/20));p+=11;
  const mapMotor=Array.from(data.slice(p,p+11),x=>Number(x));p+=11;
  const configRaw=data.slice(p,p+11);p+=11;
  const autoClutch=decodeV11AutoClutch(configRaw);
  // V11 ECU PIN is NOT read from this A2 config block. The original ATE
  // reads the four PIN nibbles from handshake 0x5A bytes 35..38.
  const C={tpsRaw,tpsVolt,tpsPct,rpmRaw,rpmAxis,vAfrRaw,vEct,vIat,vMap,iatInj,mapMotor,configRaw,autoClutch,v11PrefixLength:p,raw:data.slice()};
  if(data.length>=286){
    C.optionRawV11=data.slice(p,p+30);C.ateOptions=decodeV11Options20(C.optionRawV11,C.vEct);p+=30;
    C.ectStartRaw=data.slice(p,p+44);C.ectStart=decodeV11EctStart44(C.ectStartRaw);p+=44;
    C.globalAuxRaw=data.slice(p,p+9);p+=9;
    C.externalRaw=data.slice(p,p+30);p+=30;
    C.external=[Array(15).fill(0),Array(15).fill(0)];
    for(let c=0;c<15;c++)C.external[1][c]=decV11ExtIgn(C.externalRaw[c]);
    for(let c=0;c<15;c++)C.external[0][c]=decV11ExtPct(C.externalRaw[15+c]);
    C.chgRaw=data.slice(p,p+8);C.chg=decodeV11Chg8(C.chgRaw);p+=8;
    C.v11A2KnownLength=p;
  }
  return C;
}
function parseA2Data(data){
  if(!(data instanceof Uint8Array))data=new Uint8Array(data);
  if(data.length<133)throw new Error('Page A2 thiếu dữ liệu · '+data.length+'B / cần 133B');
  const C={
    tpsRaw:data.slice(0,14),
    vAfrRaw:data.slice(14,25),
    vEct:Array.from(data.slice(25,36),decVolt),
    vIat:Array.from(data.slice(36,47),decVolt),
    vMap:Array.from(data.slice(47,58),decVolt),
    iatInj:Array.from(data.slice(58,69),decOil),
    mapMotor:Array.from(data.slice(69,80),x=>x),
    bitfield:data[80],
    autoStart:decAutoRpm(data[81]),
    auto:Array.from(data.slice(82,87),x=>x*5),
    password:Array.from(data.slice(87,91)),
    optionRaw:Array.from(data.slice(91,103))
  };
  C.options=decodeOptions(C.optionRaw,C.vEct,C.bitfield,C.autoStart);
  C.external=[Array(15).fill(0),Array(15).fill(0)];
  for(let c=0;c<15;c++)C.external[1][c]=decExtIgn(data[103+c]);
  for(let c=0;c<15;c++)C.external[0][c]=decExtPct(data[118+c]);
  return C;
}
async function exchangePage9A(pg,label='PAGE',attempts=3,settleMs=260,replyTimeout=10000,showUi=true){
  pg&=255;
  const resumeLive=liveRunning;
  stopLiveLoop();

  let lastErr=null;
  try{
    // A live 0x69 may already be in flight when the user taps READ.
    // Wait for it to finish, then give the ECU a quiet gap before 0x9A.
    await waitForEcuIdle(Math.max(8000,replyTimeout+1500));
    await new Promise(r=>setTimeout(r,settleMs));

    for(let attempt=1;attempt<=attempts;attempt++){
      try{
        if(showUi)taskUi('loading','ĐANG ĐỌC '+label+' · LẦN '+attempt+'/'+attempts);
        const rx=await rawExchange(req5(0x9A,pg),replyTimeout);
        return rx;
      }catch(e){
        lastErr=e;
        log('0x9A retry page 0x'+pg.toString(16).toUpperCase(),attempt+'/'+attempts,String(e&&e.message||e));
        if(attempt<attempts){
          if(showUi)taskUi('loading','ECU CHƯA TRẢ LỜI · THỬ LẠI '+(attempt+1)+'/'+attempts);
          // Let the ECU/parser fully settle before repeating the same read.
          await new Promise(r=>setTimeout(r,450+(attempt-1)*250));
        }
      }
    }
    throw lastErr||new Error('ECU không trả lời page 0x'+pg.toString(16).toUpperCase());
  }finally{
    if(resumeLive&&cmdChar()&&mapChar()&&handshakeInfo){
      setTimeout(()=>{if(cmdChar()&&mapChar()&&handshakeInfo)startLiveLoop();},320);
    }
  }
}

async function readDirectPageReal(pg,minData=0,label='PAGE',showUi=true){
  requireProfile('pageRead','Đọc page 0x9A');
  pg&=255;
  if(showUi)taskUi('loading','ĐANG ĐỌC '+label+' · PAGE 0x'+pg.toString(16).toUpperCase());
  const rx=await exchangePage9A(pg,label,3,260,10000,showUi);
  const f=findValidCommandFrame(rx,pg,minData+3);
  if(!f)throw new Error(label+' · page 0x'+pg.toString(16).toUpperCase()+' không có frame hợp lệ · RX '+rx.length+'B');
  const data=f.slice(1,-2);
  if(data.length<minData)throw new Error(label+' · page 0x'+pg.toString(16).toUpperCase()+' thiếu dữ liệu '+data.length+'B / '+minData+'B');
  pageCache.set(pg,data.slice());
  try{applyProfileUi();}catch(_e){}
  return {page:pg,frame:f,data,rxLength:rx.length};
}
async function readA2SensorPageReal(showUi=true){
  requireProfile('optionsRead','Đọc Options/Voltage');
  if(ecuProfile&&ecuProfile.family==='v8')throw new Error('REDLEO V8: page Options/Voltage dùng layout riêng, chưa mở ở profile MAIN TUNE.');
  const v11=isV11Profile();
  const R=await readDirectPageReal(0xA2,v11?286:133,v11?'ATE V11 · A2 / OPTIONS':'CẢM BIẾN / OPTIONS',showUi);
  const C=v11?parseV11A2Data(R.data):parseA2Data(R.data);
  sensorCalCache=C;
  sensorCalIdentity=handshakeInfo?[
    ecuProfile?.key||'UNKNOWN',handshakeInfo.ident||'',handshakeInfo.firmware||'',handshakeInfo.ecuId||1
  ].join('|'):null;

  // Keep TPS live calibration aligned with the ECU without requiring Read All.
  if(typeof state!=='undefined'&&C.options){
    if(Number.isFinite(C.options.tpsMinEcu))state.cal.tpsMin=C.options.tpsMinEcu;
    if(Number.isFinite(C.options.tpsMaxEcu))state.cal.tpsMax=C.options.tpsMaxEcu;
    try{syncControls();}catch(_e){}
  }else if(typeof state!=='undefined'&&v11&&Array.isArray(C.tpsVolt)&&C.tpsVolt.length===14){
    const lo=Number(C.tpsVolt[0]),hi=Number(C.tpsVolt[13]);
    if(Number.isFinite(lo)&&Number.isFinite(hi)&&Math.abs(hi-lo)>.1){
      state.cal.tpsMin=lo;state.cal.tpsMax=hi;
      try{syncControls();saveSoon();}catch(_e){}
    }
  }

  // On initial connect we only need calibration for live sensors.
  // When the user actually opens an A2-backed page, also sync that page's UI.
  if(showUi){
    if(!v11){try{syncOptions(C);}catch(_e){}}
    try{
      emitFeature(N.iat_inj,[C.iatInj]);
      emitFeature(N.map_idle_motor,[C.mapMotor]);
      if(C.external)emitFeature(N.external_adjust,C.external);
      if(v11&&C.autoClutch)emitFeature(N.auto_clutch,C.autoClutch);
      if(v11&&C.chg)emitFeature(N.chg_params,C.chg);
      if(v11&&C.ateOptions)emitFeature(N.ate_options,C.ateOptions);
      if(v11&&C.ectStart)emitFeature(N.ect_start,C.ectStart);
      if(!v11&&C.auto)emitFeature(N.auto_clutch,[C.auto]);
      emitFeature(N.v_ect,[C.vEct]);
      emitFeature(N.v_iat,[C.vIat]);
      emitFeature(N.v_map,[C.vMap]);
    }catch(_e){}
    taskUi('success',v11?'ATE V11 · SENSOR CAL · OK':'CẢM BIẾN / OPTIONS · OK');
  }
  return {...R,cache:C};
}
function decV11IdleCell(row,raw){
  raw=Number(raw)&255;
  if(row===0||row===1)return raw*20;
  if(row===3)return Math.round((raw*64/50))*50;
  return raw;
}
function encV11IdleCell(row,value){
  let v=Number(value);
  if(!Number.isFinite(v))v=0;
  if(row===0||row===1)return clamp(Math.round(Math.max(500,v)/20),0,255);
  if(row===3)return clamp(Math.round(v/64),0,255);
  return clamp(Math.round(v),0,255);
}
function v11IdleMotorMode(requireKnown=false){
  const raw=handshakeInfo&&handshakeInfo.features;
  const n=Number(raw);
  if(!Number.isFinite(n)){
    if(requireKnown)throw new Error('ATE V11 chưa có feature byte từ handshake 0x5A; không ghi ECT Motor.');
    return {known:false,solenoid:false,limit128:false,label:'UNKNOWN'};
  }
  // Original ATE maps handshake byte 28 bit0..7 -> InfoChk[1]..InfoChk[8].
  // __IsMotorSolenoid() = InfoChk[5] || InfoChk[4].
  const info4=!!(n&(1<<3)),info5=!!(n&(1<<4));
  return {known:true,solenoid:info4||info5,limit128:info5,label:(info4||info5)?'SOLENOID':'STEPPER',features:n&255};
}
function decV11EctMotorInj(raw){return r2((Number(raw)&255)*0.064)}
function encV11EctMotorInj(v){return clamp(Math.round(Math.max(0,Number(v))*15.625),0,255)}
function decodeV11EctMotor22(raw,mode=v11IdleMotorMode(false)){
  raw=raw instanceof Uint8Array?raw:new Uint8Array(raw||[]);
  if(raw.length<22)throw new Error('ATE V11 ECT Motor cần 22 byte.');
  const out=[Array(11).fill(0),Array(11).fill(0)];
  // proUartDgvNum reverses UI rows: wire 0..10 = UI INJ VE row,
  // wire 11..21 = UI Step/Time row.
  for(let c=0;c<11;c++)out[1][c]=decV11EctMotorInj(raw[c]);
  for(let c=0;c<11;c++){
    const x=raw[11+c]&255;
    out[0][c]=mode.known?(mode.solenoid?x*2:r1(x*0.2)):x;
  }
  return out;
}
function encodeV11EctMotor22(matrix,mode=v11IdleMotorMode(true)){
  if(!Array.isArray(matrix)||matrix.length!==2||matrix.some(r=>!Array.isArray(r)||r.length!==11))throw new Error('ATE V11 ECT Motor cần bảng 2 × 11.');
  if(!mode.known)throw new Error('Không xác định được loại motor garanti từ handshake.');
  const out=new Uint8Array(22);
  for(let c=0;c<11;c++)out[c]=encV11EctMotorInj(matrix[1][c]);
  for(let c=0;c<11;c++){
    let v=Number(matrix[0][c]);
    if(!Number.isFinite(v))v=0;
    if(mode.solenoid){
      if(mode.limit128)v=Math.min(v,128);
      out[11+c]=clamp(Math.round(v/2),0,255);
    }else{
      out[11+c]=clamp(Math.round(Math.max(0,v)*5),0,255);
    }
  }
  return out;
}
function decodeV11AutoShift9(raw){
  raw=raw instanceof Uint8Array?raw:new Uint8Array(raw||[]);
  if(raw.length<9)throw new Error('ATE V11 AutoShift cần 9 byte.');
  return [[
    raw[0]&255,
    (raw[1]&255)*20,
    Math.round((raw[2]&255)*100/128),
    (raw[3]&255)-128,
    raw[4]&255,raw[5]&255,raw[6]&255,raw[7]&255,raw[8]&255
  ]];
}
function encodeV11AutoShift9(matrix){
  if(!Array.isArray(matrix)||matrix.length!==1||!Array.isArray(matrix[0])||matrix[0].length!==9)throw new Error('ATE V11 AutoShift cần bảng 1 × 9.');
  const v=matrix[0].map(Number);
  if(v.some(x=>!Number.isFinite(x)))throw new Error('ATE V11 AutoShift có giá trị không hợp lệ.');
  const out=new Uint8Array(9);
  out[0]=clamp(Math.round(v[0]),0,255);
  out[1]=clamp(Math.round(Math.max(500,v[1])/20),0,255);
  out[2]=clamp(Math.round(v[2]*128/100),0,255);
  out[3]=clamp(Math.round(clamp(v[3],-128,128)+128),0,255);
  for(let i=4;i<9;i++)out[i]=clamp(Math.round(v[i]),0,255);
  return out;
}
function v11AutoShiftConfigText(raw){
  raw=Number(raw)&255;
  return 'INJ '+((raw&1)?'ON':'OFF')+' · IGN '+((raw&2)?'ON':'OFF')+' · LIMIT '+((raw&4)?'IGN':'INJ')+' · spare bits '+((raw>>3)&31);
}
function decodeV11Idle12(raw){
  raw=raw instanceof Uint8Array?raw:new Uint8Array(raw||[]);
  if(raw.length<12)throw new Error('ATE V11 Idle cần 12 byte.');
  const m=Array.from({length:4},()=>Array(3).fill(0));
  for(let group=0;group<3;group++)for(let row=0;row<4;row++)m[row][group]=decV11IdleCell(row,raw[group*4+row]);
  return m;
}
function encodeV11Idle12(matrix){
  if(!Array.isArray(matrix)||matrix.length!==4||matrix.some(r=>!Array.isArray(r)||r.length!==3))throw new Error('ATE V11 Idle cần bảng 4 × 3.');
  const out=new Uint8Array(12);
  for(let group=0;group<3;group++)for(let row=0;row<4;row++)out[group*4+row]=encV11IdleCell(row,matrix[row][group]);
  return out;
}

async function readIdlePageReal(bank=((typeof state!=='undefined'&&state.activeMap)||1),showUi=true){
  requireProfile('idleRead','Đọc Idle/Limit');
  if(ecuProfile&&ecuProfile.family==='v8')throw new Error('REDLEO V8: Idle/Limit có layout Option riêng, chưa mở ở profile MAIN TUNE.');
  bank=normalizeBankForProfile(bank);
  const pg=page(6,bank);

  if(isV11Profile()){
    // Exact ATE V11 page-6 serializer (selected MAP only):
    //   Dgv_Idle_Limit : 4 rows × 3 transmitted groups = 12B
    //   Dgv_AutoShift  : 9B
    //   Dgv_Ect_Motor  : 2 rows × 11 transmitted columns = 22B
    // Total = 43B. Only the first 12B are editable in this phase.
    const R=await readDirectPageReal(pg,43,'ATE V11 · IDLE / LIMIT · MAP NO.'+bank,showUi);
    const C={
      page:pg,
      raw:R.data.slice(),
      idleRaw:R.data.slice(0,12),
      autoShiftRaw:R.data.slice(12,21),
      ectMotorRaw:R.data.slice(21,43),
      tailRaw:R.data.slice(43)
    };
    C.idleMatrix=decodeV11Idle12(C.idleRaw);
    C.autoShiftMatrix=decodeV11AutoShift9(C.autoShiftRaw);
    C.motorMode=v11IdleMotorMode(false);
    C.ectMotorMatrix=decodeV11EctMotor22(C.ectMotorRaw,C.motorMode);
    emitFeature(N.idle_limit,C.idleMatrix,bank);
    emitFeature(N.auto_shift,C.autoShiftMatrix,bank);
    emitFeature(N.ect_idle_motor,C.ectMotorMatrix,bank);
    if(!window.blinkV11IdleRaw)window.blinkV11IdleRaw={};
    window.blinkV11IdleRaw[bank]={
      page:pg,
      raw:Array.from(C.raw),
      idleRaw:Array.from(C.idleRaw),
      autoShiftRaw:Array.from(C.autoShiftRaw),
      autoShift:C.autoShiftMatrix[0].slice(),
      autoShiftConfig:v11AutoShiftConfigText(C.autoShiftRaw[0]),
      ectMotorRaw:Array.from(C.ectMotorRaw),
      motorMode:C.motorMode,
      tailRaw:Array.from(C.tailRaw)
    };
    const st=document.getElementById('redIoStatus');
    if(st)st.textContent='ATE V11 · PAGE 6x MAP '+bank+' · 43B · Idle 12B + AutoShift 9B + ECT Motor 22B decoded · '+C.motorMode.label;
    if(showUi)notice('success','ATE V11 · PAGE 6x READ OK','MAP No.'+bank+' · Idle 12B + AutoShift 9B + ECT Motor 22B đã giải mã · '+C.motorMode.label+'.');
    return {...R,...C,readOnly:false};
  }

  const R=await readDirectPageReal(pg,30,'IDLE / LIMIT · MAP NO.'+bank,showUi);
  let p=0;const idle=[];
  for(let i=0;i<9;i++){idle.push(u16be(R.data,p));p+=2;}
  const motor=[Array.from(R.data.slice(p,p+12),x=>x*2)];
  const o={idleCold:idle[0],idleHot:idle[1],maxSpeed:idle[2],returnCold:idle[3],returnHot:idle[4],accelPct:Math.round(idle[5]*50/64),idleSensitivity:idle[6]};
  for(const[k,v]of Object.entries(o))setValue('[data-idleopt="'+k+'"]',v);
  emitFeature(N.ect_idle_motor,motor,bank);
  if(showUi)taskUi('success','IDLE / LIMIT · MAP NO.'+bank+' · OK');
  return {...R,idle,motor};
}
async function readFeaturePageReal(id,bank=((typeof state!=='undefined'&&state.activeMap)||1),showUi=true){
  bank=normalizeBankForProfile(bank);
  if(id==='inj_ve')return readCurrentFuelBank(bank,showUi);
  if(ecuProfile&&ecuProfile.family==='v8'&&!['inj_degree','ign_degree','ign_time'].includes(id)){
    throw new Error(ecuProfile.label+': hiện chỉ mở phần chính (Thời gian phun / Góc phun / Góc lửa / Ignition Time). Bảng '+id+' vẫn khóa chờ layout riêng.');
  }
  if(ecuProfile&&ecuProfile.family==='v11'&&!['idle_limit','ect_idle_motor','auto_shift','auto_clutch','chg_params','ate_options','ect_start','inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map'].includes(id)){
    throw new Error(ecuProfile.label+': bảng '+id+' vẫn khóa chờ layout V11 được xác nhận.');
  }
  if(id==='idle_limit')return readIdlePageReal(bank,showUi);

  let pg=0,rows=0,cols=0,dec=x=>x,n=0,label=id;
  switch(id){
    case 'inj_degree':pg=page(2,bank);rows=14;cols=30;dec=decMainInjAngle;n=N.inj_degree;label='GÓC PHUN';break;
    case 'ign_degree':pg=page(3,bank);rows=14;cols=30;dec=decMainIgn;n=N.ign_degree;label='GÓC ĐÁNH LỬA';break;
    case 'ign_time':pg=page(4,bank);rows=1;cols=30;dec=decMainDwell;n=N.ign_time;label='DWELL BOBIN';break;
    case 'ect_idle_motor':case 'auto_shift':return readIdlePageReal(bank,showUi);
    case 'ect_inj':pg=0x72;rows=11;cols=30;dec=decPct;n=N.ect_inj;label='BÙ PHUN ECT';break;
    case 'ect_ign':pg=0x82;rows=11;cols=30;dec=isV11Profile()?decMainIgn:decEctIgn;n=N.ect_ign;label='BÙ ĐÁNH LỬA ECT';break;
    case 'map_inj':pg=0x92;rows=11;cols=30;dec=decMapInj;n=N.map_inj;label='BÙ PHUN MAP';break;
    case 'iat_inj':case 'map_idle_motor':case 'external_adjust':case 'auto_clutch':case 'chg_params':case 'ate_options':case 'ect_start':
    case 'v_ect':case 'v_iat':case 'v_map':
      return readA2SensorPageReal(showUi);
    case 'spare':throw new Error('Spare không dùng trên firmware 9.1X');
    default:throw new Error('Chưa có page đọc riêng cho '+id);
  }

  const R=await readDirectPageReal(pg,rows*cols,label+(rows>1&&pg<0x70?' · MAP NO.'+bank:''),showUi);
  const z=decodeRowsByte(R.data,0,rows,cols,dec);
  emitFeature(n,z.data,pg<0x70?bank:0);
  if(showUi)taskUi('success',label+(pg<0x70?' · MAP NO.'+bank:'')+' · OK');
  return {...R,matrix:z.data};
}
async function readCurrentFuelBank(bank=((typeof state!=='undefined'&&state.activeMap)||1),showUi=true){
  requireProfile('fuelRead','Đọc MAP thời gian phun');
  bank=normalizeBankForProfile(bank);
  if(showUi)taskUi('loading','ĐANG ĐỌC HIỆN TẠI · MAP NO.'+bank);
  const pg=page(1,bank);
  const first=!fuelPagePrimed.has(bank);
  const isV8=ecuProfile&&ecuProfile.family==='v8';

  // First INJ VE read after a fresh BLE session is measurably slower on this ECU.
  // Give the ECU enough quiet/compute time and keep the browser timeout longer
  // than the bridge UART timeout. Once one read succeeds, return to normal timing.
  const rx=await exchangePage9A(
    pg,
    'MAP NO.'+bank,
    first ? (isV8?3:4) : 2,
    first ? (isV8?450:900) : 260,
    18000,
    showUi
  );
  const R=parseCurrentFuelFrame(rx,bank);
  fuelPagePrimed.add(bank);
  syncCurrentFuel(bank,R.matrix,R.frame.length);
  log('READ CURRENT MAP No.'+bank,'page 0x'+pg.toString(16).toUpperCase(),'RX',rx.length,'frame',R.frame.length,'primed',first?'first':'warm');
  if(showUi)taskUi('success','ĐỌC HIỆN TẠI · MAP NO.'+bank+' · OK');
  return R;
}
async function readAll(cmd=0xAB){
  if(cmd===0x8B)requireProfile('restore','Khôi phục ECU');
  else requireProfile('readAll','Đọc toàn bộ ECU');
  taskUi('loading',cmd===0x8B?'ĐANG KHÔI PHỤC ECU...':'ĐANG ĐỌC TẤT CẢ ECU...');
  const rx=await rawExchange(req5(cmd,cmd),35000);
  let C=parseReadAll(rx);
  // Never decode a legacy/V8 Read All using the modern 9.x memory layout,
  // even if its byte length happens to collide with a known modern length.
  if(ecuProfile.family!=='modern'&&!C.rawOnly&&!C.v11Decoded){
    C={raw:C.raw.slice(),sourceLength:C.sourceLength,layoutInfo:'raw-'+C.sourceLength+'-'+ecuProfile.key,rawOnly:true,banks:[],hidden:{}};
  }
  window.blinkReadAllRaw=C.raw.slice();
  window.blinkReadAllLayout={length:C.sourceLength,layout:C.layoutInfo,rawOnly:!!C.rawOnly};
  if(C.rawOnly){
    // Never keep a decoded cache from an earlier Read All when the newest
    // response could only be preserved as RAW.
    readCache=null;
    const s=document.getElementById('redIoStatus');
    if(s)s.textContent='ECU REAL · READ ALL '+C.sourceLength+'B OK · RAW backup'+(ecuProfile&&ecuProfile.family==='v8'?' · V8 expected ~8087B':ecuProfile&&ecuProfile.family==='v11'?' · ATE V11 full image preserved':'');
    log('ReadAll raw frame accepted:',C.sourceLength+'B');
  }else if(C.v11Decoded){
    syncV11ReadAll(C);
  }else{
    syncAll(C);
  }
  try{applyProfileUi();}catch(_e){}
  taskUi('success',(cmd===0x8B?'KHÔI PHỤC ECU':'ĐỌC TẤT CẢ ECU')+' · OK');
  return C;
}

// ----- write builders -----
function matrixFromRedTable(rows,cols){
  const m=Array.from({length:rows},()=>Array(cols).fill(0));
  document.querySelectorAll('#redFeatureTable [data-rr][data-rc], #redTable [data-rr][data-rc]').forEach(td=>{const r=+td.dataset.rr,c=+td.dataset.rc;if(r<rows&&c<cols){const n=Number(td.textContent);if(Number.isFinite(n))m[r][c]=n;}});return m;
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
function hasWriteAck(rx,pg){
  if(!(rx instanceof Uint8Array))rx=new Uint8Array(rx||[]);
  const want=pg&255;
  if(rx.length>=2&&rx[rx.length-2]===0xCD&&rx[rx.length-1]===want)return true;
  // Some bridges prepend a few status/echo bytes. Only inspect the short tail,
  // never the whole response where arbitrary map data could mimic CD+page.
  const from=Math.max(0,rx.length-8);
  for(let i=from;i+1<rx.length;i++)if(rx[i]===0xCD&&rx[i+1]===want)return true;
  return false;
}
async function writePageChecked(pg,payload,requireReadAll=true,retries=0,cap=null){
  requireProfile(cap||(requireReadAll?'fullWrite':'fuelWrite'),'Ghi dữ liệu ECU');
  if(requireReadAll)assertSafeWriteLayout();
  if(requireReadAll)taskUi('loading','ĐANG GHI ECU · PAGE 0x'+pg.toString(16).toUpperCase());
  const tx=pageFrame(pg,payload);
  validateOutgoingPageFrame(tx,pg,payload.length);
  if(tx.length>RAW_CHUNK&&!bridgeRawWriteSafe()){
    throw new Error('ESP32 bridge chưa xác nhận FW1.1+ an toàn cho RAW multi-chunk. Hãy nạp firmware bridge mới và kết nối lại; PING phải hiện FW1.1 hoặc mới hơn.');
  }
  let lastErr=null;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const rx=await rawExchange(tx,10000);
      if(hasWriteAck(rx,pg))return true;
      throw new Error('ECU không ACK CD '+pg.toString(16).toUpperCase()+' · RX '+rx.length+'B');
    }catch(e){
      lastErr=e;
      if(attempt>=retries)break;
      log('retry write page 0x'+pg.toString(16).toUpperCase(),attempt+1,String(e&&e.message||e));
      await new Promise(r=>setTimeout(r,220));
    }
  }
  throw lastErr||new Error('Ghi page 0x'+pg.toString(16).toUpperCase()+' thất bại');
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
  if(currentFeatureId()===id){const cells=[...document.querySelectorAll('#redFeatureTable [data-rr][data-rc], #redTable [data-rr][data-rc]')];if(cells.length){const cols=Math.max(...cells.map(x=>+x.dataset.rc))+1;const m=matrixFromRedTable(1,cols);return m[0];}}
  return fallback.slice();
}
function matrixFromMaybe2(id,fallback){if(currentFeatureId()===id){const cells=[...document.querySelectorAll('#redFeatureTable [data-rr][data-rc], #redTable [data-rr][data-rc]')];if(cells.length)return matrixFromRedTable(2,15);}return fallback.map(r=>r.slice())}

async function writeV11AutoShift(bank){
  if(!isV11Profile())throw new Error('AutoShift writer chỉ dùng cho ATE V11.');
  bank=normalizeBankForProfile(bank);
  const pg=page(6,bank),cached=pageCache.get(pg);
  if(!cached||cached.length<43)throw new Error('Hãy ĐỌC AutoShift MAP No.'+bank+' thành công trước khi GHI.');
  const m=matrixFromRedTable(1,9);
  const shift=encodeV11AutoShift9(m);
  const payload=new Uint8Array(cached);
  payload.set(shift,12);
  taskUi('loading','ATE V11 · GHI AUTOSHIFT MAP NO.'+bank+' · GIỮ NGUYÊN IDLE + ECT MOTOR');
  await writePageChecked(pg,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  const R=await readIdlePageReal(bank,true);
  if(R.data.length<payload.length)throw new Error('VERIFY AutoShift V11 thiếu dữ liệu.');
  for(let i=0;i<payload.length;i++)if((R.data[i]&255)!==(payload[i]&255)){
    throw new Error('VERIFY AutoShift V11 sai byte '+i+' · ghi '+payload[i]+' đọc '+R.data[i]);
  }
  notice('success','GHI + VERIFY AUTOSHIFT ATE V11 OK','MAP No.'+bank+' · 9B AutoShift đã ghi · 34B Idle/ECT Motor giữ nguyên · '+v11AutoShiftConfigText(shift[0])+'.');
  return R;
}

async function writeV11EctMotor(bank){
  if(!isV11Profile())throw new Error('ECT Motor writer chỉ dùng cho ATE V11.');
  bank=normalizeBankForProfile(bank);
  const mode=v11IdleMotorMode(true),pg=page(6,bank);
  const cached=pageCache.get(pg);
  if(!cached||cached.length<43)throw new Error('Hãy ĐỌC Temperature–Idle Motor MAP No.'+bank+' thành công trước khi GHI.');
  const m=matrixFromRedTable(2,11);
  if(m.some(r=>r.some(v=>!Number.isFinite(Number(v)))))throw new Error('ECT Motor V11 chưa có đủ 22 giá trị hợp lệ.');
  const motor=encodeV11EctMotor22(m,mode);
  const payload=new Uint8Array(cached);
  payload.set(motor,21);
  taskUi('loading','ATE V11 · GHI ECT MOTOR MAP NO.'+bank+' · '+mode.label+' · GIỮ NGUYÊN IDLE + AUTOSHIFT');
  await writePageChecked(pg,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  const R=await readIdlePageReal(bank,true);
  if(R.data.length<payload.length)throw new Error('VERIFY ECT Motor V11 thiếu dữ liệu.');
  for(let i=0;i<payload.length;i++)if((R.data[i]&255)!==(payload[i]&255)){
    throw new Error('VERIFY ECT Motor V11 sai byte '+i+' · ghi '+payload[i]+' đọc '+R.data[i]);
  }
  notice('success','GHI + VERIFY ECT MOTOR ATE V11 OK','MAP No.'+bank+' · 22B ECT Motor đã ghi · 21B Idle/AutoShift giữ nguyên byte-for-byte · '+mode.label+'.');
  return R;
}

async function writeV11IdleLimit(bank){
  if(!isV11Profile())throw new Error('Idle V11 writer chỉ dùng cho ATE V11.');
  bank=normalizeBankForProfile(bank);
  const pg=page(6,bank);
  const cached=pageCache.get(pg);
  if(!cached||cached.length<43)throw new Error('Hãy ĐỌC Idle/Limit MAP No.'+bank+' thành công trước khi GHI.');
  const m=matrixFromRedTable(4,3);
  if(m.some(r=>r.some(v=>!Number.isFinite(Number(v)))))throw new Error('Idle/Limit V11 chưa có đủ 12 giá trị hợp lệ.');
  const idle=encodeV11Idle12(m);
  const payload=new Uint8Array(cached);
  payload.set(idle,0);
  taskUi('loading','ATE V11 · GHI IDLE/LIMIT MAP NO.'+bank+' · GIỮ NGUYÊN AUTOSHIFT + ECT MOTOR');
  await writePageChecked(pg,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  const R=await readIdlePageReal(bank,true);
  if(R.data.length<payload.length)throw new Error('VERIFY Idle V11 thiếu dữ liệu.');
  for(let i=0;i<payload.length;i++)if((R.data[i]&255)!==(payload[i]&255)){
    throw new Error('VERIFY Idle V11 sai byte '+i+' · ghi '+payload[i]+' đọc '+R.data[i]);
  }
  notice('success','GHI + VERIFY IDLE ATE V11 OK','MAP No.'+bank+' · 12B Idle đã ghi · 31B AutoShift/ECT Motor giữ nguyên byte-for-byte.');
  return R;
}

async function writeV11EctStart(){
  if(!isV11Profile())throw new Error('ECT Start writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<286)throw new Error('Hãy ĐỌC ECT Start thành công trước khi GHI đủ page A2 286B.');
  const m=matrixFromRedTable(4,11);
  const raw44=encodeV11EctStart44(m);
  const payload=new Uint8Array(cached);
  payload.set(raw44,195);
  taskUi('loading','ATE V11 · GHI ECT START 44B · GIỮ NGUYÊN A2 CÒN LẠI');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  let R;
  try{R=await readA2SensorPageReal(true);}
  catch(e){throw new Error('ECU đã ACK A2 nhưng VERIFY ECT Start đọc lại thất bại: '+String(e&&e.message||e));}
  if(!R.cache||!R.cache.ectStartRaw||R.cache.ectStartRaw.length!==44)throw new Error('VERIFY ECT Start không đọc đủ 44 byte.');
  for(let i=0;i<286;i++)if((R.data[i]&255)!==(payload[i]&255)){
    throw new Error('VERIFY ECT Start sai A2 byte '+i+' · ghi '+payload[i]+' đọc '+R.data[i]);
  }
  notice('success','GHI + VERIFY ECT START ATE V11 OK','44 byte · A2 offset 195..238 · toàn page A2 286B đã verify.');
  return R;
}

async function writeV11Options20(){
  if(!isV11Profile())throw new Error('ATE Options writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<286)throw new Error('Hãy ĐỌC ATE Options thành công trước khi GHI đủ page A2 286B.');
  const C=parseV11A2Data(cached);
  const m=matrixFromRedTable(1,20);
  const raw20=encV11Options20(m,C.vEct);
  const expected30=new Uint8Array(C.optionRawV11);
  expected30.set(raw20,0);
  const payload=new Uint8Array(cached);
  payload.set(expected30,165);
  taskUi('loading','ATE V11 · GHI OPTIONS 20 MỤC · GIỮ NGUYÊN AFR/O2 + RESERVED');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  let R;
  try{R=await readA2SensorPageReal(true);}
  catch(e){throw new Error('ECU đã ACK A2 nhưng VERIFY Options đọc lại thất bại: '+String(e&&e.message||e));}
  const got=R.cache&&R.cache.optionRawV11;
  if(!got||got.length!==30)throw new Error('VERIFY Options không đọc đủ 30 byte.');
  for(let i=0;i<30;i++)if((got[i]&255)!==(expected30[i]&255)){
    throw new Error('VERIFY Options sai byte '+i+' · ghi '+expected30[i]+' đọc '+got[i]);
  }
  notice('success','GHI + VERIFY ATE OPTIONS V11 OK','20 byte Option đã chỉnh · 7 byte AFR/O2 + 3 byte reserved giữ nguyên byte-for-byte.');
  return R;
}

async function writeV11Chg(){
  if(!isV11Profile())throw new Error('CHG writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<286)throw new Error('Hãy ĐỌC Charger Parameters thành công trước khi GHI đủ page A2 286B.');
  const m=matrixFromRedTable(1,8);
  const raw=encV11Chg8(m);
  const payload=new Uint8Array(cached);
  payload.set(raw,278);
  taskUi('loading','ATE V11 · GHI CHARGER PARAMETERS · GIỮ NGUYÊN 261 BYTE A2 KHÁC');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  let R;
  try{R=await readA2SensorPageReal(true);}
  catch(e){throw new Error('ECU đã ACK A2 nhưng VERIFY CHG đọc lại thất bại: '+String(e&&e.message||e));}
  if(!R.cache||!R.cache.chgRaw||R.cache.chgRaw.length!==8)throw new Error('VERIFY CHG không đọc đủ 8 byte.');
  for(let i=0;i<8;i++)if((R.cache.chgRaw[i]&255)!==(raw[i]&255)){
    throw new Error('VERIFY CHG sai byte '+i+' · ghi '+raw[i]+' đọc '+R.cache.chgRaw[i]);
  }
  if(readCache&&readCache.v11Decoded){
    readCache.chgRaw=new Uint8Array(R.cache.chgRaw);
    readCache.chg=R.cache.chg.map(r=>r.slice());
  }
  notice('success','GHI + VERIFY CHG ATE V11 OK','8 byte Charger Parameters · offset A2 278..285 · các byte khác giữ nguyên.');
  return R;
}

async function writeV11AutoClutch(){
  if(!isV11Profile())throw new Error('Automatic Clutch writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<286)throw new Error('Hãy ĐỌC Automatic Clutch thành công trước khi GHI đủ page A2 286B.');
  const m=matrixFromRedTable(1,6),vals=m[0]||[];
  if(vals.length!==6||vals.some(v=>!Number.isFinite(Number(v))))throw new Error('Automatic Clutch V11 chưa có đủ 6 giá trị hợp lệ.');
  const config=new Uint8Array(cached.slice(154,165));
  const expected=new Uint8Array(config);
  for(let i=0;i<6;i++)expected[1+i]=encV11Dzfm(i,vals[i]);
  const payload=new Uint8Array(cached);
  payload.set(expected,154);
  taskUi('loading','ATE V11 · GHI AUTOMATIC CLUTCH · GIỮ NGUYÊN ENABLE + PIN');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  let R;
  try{R=await readA2SensorPageReal(true);}
  catch(e){throw new Error('ECU đã ACK A2 nhưng VERIFY Automatic Clutch đọc lại thất bại: '+String(e&&e.message||e));}
  const got=R.cache&&R.cache.configRaw;
  if(!got||got.length!==11)throw new Error('VERIFY Automatic Clutch không đọc đủ configRaw 11B.');
  for(let i=0;i<11;i++)if((got[i]&255)!==(expected[i]&255)){
    throw new Error('VERIFY Automatic Clutch sai config byte '+i+' · ghi '+expected[i]+' đọc '+got[i]);
  }
  if(readCache&&readCache.v11Decoded){
    readCache.configRaw=new Uint8Array(got);
    readCache.autoClutch=R.cache.autoClutch.map(r=>r.slice());
  }
  notice('success','GHI + VERIFY AUTOMATIC CLUTCH ATE V11 OK','6 byte Dgv_Dzfm đã ghi · config enable và 4 byte password cũ được giữ nguyên.');
  return R;
}

async function writeV11ExternalAdjust(){
  if(!isV11Profile())throw new Error('External Adjustment writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<286)throw new Error('Hãy ĐỌC External Adjustment thành công trước khi GHI đủ page A2 286B.');
  const m=matrixFromRedTable(2,15);
  if(m.length!==2||m.some(r=>!Array.isArray(r)||r.length!==15||r.some(v=>!Number.isFinite(Number(v)))))throw new Error('External Adjustment chưa có đủ dữ liệu 2 × 15.');
  const payload=Array.from(cached);
  const expected=[];
  // Original ATE proUartDgvNum serializes row 1 first (IGN), then row 0 (INJ %).
  for(let c=0;c<15;c++){const raw=encV11ExtIgn(m[1][c]);payload[248+c]=raw;expected.push(raw);}
  for(let c=0;c<15;c++){const raw=encV11ExtPct(m[0][c]);payload[263+c]=raw;expected.push(raw);}
  taskUi('loading','ATE V11 · GHI EXTERNAL ADJUSTMENT · GIỮ NGUYÊN BYTE A2 KHÁC');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,240));
  const R=await readA2SensorPageReal(true);
  if(!R.cache||!R.cache.externalRaw||R.cache.externalRaw.length!==30)throw new Error('ECU đã ACK A2 nhưng VERIFY External Adjustment không đọc đủ 30 byte.');
  const got=Array.from(R.cache.externalRaw);
  for(let i=0;i<30;i++)if(got[i]!==expected[i])throw new Error('VERIFY External Adjustment sai byte '+i+' · ghi '+expected[i]+' đọc '+got[i]);
  if(readCache&&readCache.v11Decoded){
    readCache.externalRaw=new Uint8Array(got);
    readCache.external=R.cache.external.map(r=>r.slice());
  }
  notice('success','GHI + VERIFY ATE V11 OK','External Adjustment · A2 offset 248..277 · 30 byte · các byte A2 khác được giữ nguyên');
  return R;
}

function v11A2PatchSpec(id){
  switch(id){
    case 'v_ect':return {off:99,enc:encVolt,label:'ECT VOLTAGE'};
    case 'v_iat':return {off:110,enc:encVolt,label:'IAT VOLTAGE'};
    case 'v_map':return {off:121,enc:encVolt,label:'MAP VOLTAGE'};
    case 'iat_inj':return {off:132,enc:v=>clamp(Math.round(Math.max(0,Number(v))*20),0,255),label:'IAT COMP INJ'};
    case 'map_idle_motor':return {off:143,enc:v=>clamp(Math.round(Number(v)),0,255),label:'MAP IDLE MOTOR'};
    default:return null;
  }
}
async function writeV11A2KnownFeature(id){
  if(!isV11Profile())throw new Error('A2 partial writer chỉ dùng cho ATE V11.');
  const spec=v11A2PatchSpec(id);
  if(!spec)throw new Error('ATE V11 chưa có A2 patch spec cho '+id);
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<286)throw new Error('Hãy ĐỌC bảng '+id+' thành công trước khi GHI đủ page A2 286B.');
  const m=matrixFromRedTable(1,11);
  const vals=m[0]||[];
  if(vals.length!==11||vals.some(v=>!Number.isFinite(Number(v))))throw new Error('Bảng '+id+' chưa có đủ 11 giá trị hợp lệ.');
  const payload=Array.from(cached);
  const expected=[];
  for(let i=0;i<11;i++){const raw=clamp(Math.round(spec.enc(vals[i])),0,255);payload[spec.off+i]=raw;expected.push(raw);}
  taskUi('loading','ATE V11 · GHI '+spec.label+' · GIỮ NGUYÊN BYTE ẨN');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  await new Promise(r=>setTimeout(r,220));
  let R;
  try{R=await readA2SensorPageReal(true);}
  catch(e){throw new Error('ECU đã ACK A2 nhưng VERIFY đọc lại thất bại: '+String(e&&e.message||e));}
  const got=Array.from(R.cache.raw.slice(spec.off,spec.off+11));
  for(let i=0;i<11;i++)if(got[i]!==expected[i])throw new Error('VERIFY '+id+' không khớp byte '+i+' · ghi '+expected[i]+' đọc '+got[i]);
  notice('success','GHI + VERIFY ATE V11 OK',spec.label+' · page A2 · 11 byte · byte ẩn được bảo toàn');
  return R;
}
async function writeFeatureReal(id){
  const bank=normalizeBankForProfile((typeof state!=='undefined'&&state.activeMap)||1);
  const isMain=isDirectVerifiedFeature(id);

  if(isMain){
    if(isV11Profile()&&id==='idle_limit')return writeV11IdleLimit(bank);
    if(isV11Profile()&&id==='auto_shift')return writeV11AutoShift(bank);
    if(isV11Profile()&&id==='ect_idle_motor')return writeV11EctMotor(bank);
    if(isV11Profile()&&id==='auto_clutch')return writeV11AutoClutch();
    if(isV11Profile()&&id==='chg_params')return writeV11Chg();
    if(isV11Profile()&&id==='ate_options')return writeV11Options20();
    if(isV11Profile()&&id==='ect_start')return writeV11EctStart();
    if(isV11Profile()&&id==='external_adjust')return writeV11ExternalAdjust();
    if(isV11Profile()&&v11A2PatchSpec(id))return writeV11A2KnownFeature(id);
    requireProfile('mainWrite','Ghi bảng '+id);
    const expectedPage=mainFeaturePage(id,bank);
    if(expectedPage==null||!pageCache.has(expectedPage)){
      throw new Error('Hãy ĐỌC bảng '+id+' của MAP hiện tại thành công trước khi GHI để tránh ghi dữ liệu trống.');
    }
    let m,pg,payload,enc;
    switch(id){
      case 'inj_degree':m=matrixFromRedTable(14,30);pg=page(2,bank);enc=encMainInjAngle;payload=encodeRowsByte(m,enc);break;
      case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);enc=encMainIgn;payload=encodeRowsByte(m,enc);break;
      case 'ign_time':m=matrixFromRedTable(1,30);pg=page(4,bank);enc=encMainDwell;payload=encodeRowsByte(m,enc);break;
      case 'ect_inj':m=matrixFromRedTable(11,30);pg=0x72;enc=encPct;payload=encodeRowsByte(m,enc);break;
      case 'ect_ign':m=matrixFromRedTable(11,30);pg=0x82;enc=isV11Profile()?encMainIgn:encEctIgn;payload=encodeRowsByte(m,enc);break;
      case 'map_inj':m=matrixFromRedTable(11,30);pg=0x92;enc=encMapInj;payload=encodeRowsByte(m,enc);break;
    }
    await writePageChecked(pg,payload,false,1,'mainWrite');
    await new Promise(r=>setTimeout(r,220));
    let R;
    try{R=await readFeaturePageReal(id,bank,true);}
    catch(e){throw new Error('ECU đã ACK ghi '+id+' nhưng VERIFY đọc lại thất bại: '+String(e&&e.message||e));}
    const verifyPayload=encodeRowsByte(R.matrix,enc);
    if(verifyPayload.length!==payload.length)throw new Error('VERIFY '+id+' sai kích thước');
    for(let i=0;i<payload.length;i++){
      if(verifyPayload[i]!==payload[i])throw new Error('VERIFY '+id+' không khớp tại byte '+i+' · ghi '+payload[i]+' đọc '+verifyPayload[i]);
    }
    notice('success','GHI + VERIFY OK',id+' · page 0x'+pg.toString(16).toUpperCase());
    return R;
  }

  requireProfile('fullWrite','Ghi bảng '+id);
  if(!readCache)await readAll();let m,pg,payload;
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
async function writeIdleReal(){requireProfile('fullWrite','Ghi Idle/Limit');assertSafeWriteLayout();if(!readCache)await readAll();const bank=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4),pg=page(6,bank);await writePageChecked(pg,idlePayload(bank,true));await readAll();notice('success','IDLE/LIMIT GHI OK','MAP No.'+bank+' · page 0x'+pg.toString(16).toUpperCase())}
async function writeOptionsReal(){requireProfile('fullWrite','Ghi Options');assertSafeWriteLayout();if(!readCache)await readAll();await writePageChecked(0xA2,a2Payload());await readAll();notice('success','OPTIONS GHI OK','AFR Control/O2 + Options + Sensor page A2 đã verify')}

async function writeFuelBank(bank){
  requireProfile('fuelWrite','Ghi MAP thời gian phun');
  bank=normalizeBankForProfile(bank);
  const inj=state.mapBanks[bank-1].inject,low=pageLow(bank),halves=[[13,12,11,10,9,8,7],[6,5,4,3,2,1,0]];
  if(!inj||inj.length!==14||inj.some(r=>!Array.isArray(r)||r.length!==30))throw new Error('MAP hiện tại chưa có đủ dữ liệu 14x30 để ghi.');
  if(inj.some(r=>r.some(v=>v==null||v===''||!Number.isFinite(Number(v)))))throw new Error('MAP hiện tại đang trống/chưa đọc đủ từ ECU. Hãy chờ ĐỌC HIỆN TẠI báo OK trước khi ghi.');

  const fuelMax=ecuProfile&&ecuProfile.family==='v8'?12.75:(65535/500);
  let badCell=null;
  outer:for(let r=0;r<14;r++)for(let c=0;c<30;c++){
    const v=Number(inj[r][c]);
    if(v<0||v>fuelMax){badCell={r,c,v};break outer;}
  }
  if(badCell)throw new Error('MAP phun vượt giới hạn 0–'+fuelMax.toFixed(3)+' ms tại TPS row '+(badCell.r+1)+', RPM col '+(badCell.c+1)+' · '+badCell.v+' ms');

  if(ecuProfile&&ecuProfile.family==='v8'){
    taskUi('loading','ĐANG GHI V8 MAP NO.'+bank+' · PAGE 0x'+page(1,bank).toString(16).toUpperCase());
    const payload=encodeRowsByte(inj,v=>Math.round(Math.max(0,Number(v))*20));
    await writePageChecked(page(1,bank),payload,false,1,'fuelWrite');
    return;
  }

  for(let h=0;h<2;h++){
    if(typeof state!=='undefined')state.ecuPhase=h===0?'write1':'write2';
    taskUi('loading','ĐANG GHI MAP NO.'+bank+' · PHẦN '+(h+1)+'/2');
    const payload=[];
    for(const r of halves[h])for(let c=0;c<30;c++)push16be(payload,encOilTab(inj[r][c]));
    // Re-sending the exact same half-page is safe if its ACK was lost.
    await writePageChecked(0x10|low|h,payload,false,1);
    if(h===0)await new Promise(r=>setTimeout(r,120));
  }
}
async function readCurrentFuelBankRetry(bank){
  // readCurrentFuelBank already owns the 0x9A retry loop. Do not multiply it
  // with another retry layer or a failed verify can block the UI for minutes.
  return readCurrentFuelBank(bank,false);
}
async function writeCurrentFuelAndVerify(bank){
  requireProfile('fuelWrite','Ghi hiện tại MAP thời gian phun');
  bank=normalizeBankForProfile(bank);
  const resumeLive=liveRunning;
  const previousPhase=typeof state!=='undefined'?state.ecuPhase:'live';
  const mapSelect=document.getElementById('mapSelect');
  stopLiveLoop();
  if(typeof state!=='undefined')state.ecuPhase='write1';
  if(mapSelect)mapSelect.disabled=true;
  taskUi('loading','ĐANG GHI HIỆN TẠI · MAP NO.'+bank);
  try{
    const intended=state.mapBanks[bank-1].inject.map(r=>r.map(Number));
    const expectedRaw=encodeFuelVerifyRaw(intended);
    await writeFuelBank(bank);
    // Let ECU finish its flash/page commit before the 0x9A read-back.
    taskUi('loading','ECU ĐÃ ACK · ĐANG VERIFY MAP NO.'+bank);
    await new Promise(r=>setTimeout(r,260));
    let R;
    try{
      R=await readCurrentFuelBankRetry(bank);
    }catch(e){
      throw new Error('ECU đã ACK ghi MAP nhưng VERIFY đọc lại thất bại: '+String(e&&e.message||e));
    }
    const gotRaw=R.rawPayload instanceof Uint8Array?R.rawPayload:new Uint8Array(R.rawPayload||[]);
    if(gotRaw.length!==expectedRaw.length)throw new Error('VERIFY MAP sai kích thước raw · ghi '+expectedRaw.length+'B đọc '+gotRaw.length+'B');
    for(let i=0;i<expectedRaw.length;i++){
      if(gotRaw[i]!==expectedRaw[i]){
        const bytesPerCell=ecuProfile&&ecuProfile.family==='v8'?1:2;
        const cell=Math.floor(i/bytesPerCell),wireRow=Math.floor(cell/30),c=cell%30,r=13-wireRow;
        throw new Error('VERIFY MAP raw sai tại TPS row '+(r+1)+', RPM col '+(c+1)+' · byte '+i+' · ghi '+expectedRaw[i]+' đọc '+gotRaw[i]);
      }
    }
    taskUi('success','GHI + VERIFY RAW · MAP NO.'+bank+' · 420/420 Ô OK');
    return R;
  }finally{
    if(typeof state!=='undefined')state.ecuPhase=(previousPhase==='write1'||previousPhase==='write2')?'live':previousPhase;
    if(mapSelect)mapSelect.disabled=!!(typeof state!=='undefined'&&state.threeRun&&state.threeRun.active);
    if(resumeLive&&cmdChar()&&mapChar()&&handshakeInfo){
      setTimeout(()=>{if(cmdChar()&&mapChar()&&handshakeInfo)startLiveLoop();},350);
    }
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
function v11ValueChanged(a,b,tol=1e-4){
  a=Number(a);b=Number(b);
  return !Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>tol;
}
function patchRowsBytePreserve(raw,edited,base,enc){
  const out=new Uint8Array(raw||[]);
  if(!Array.isArray(edited)||!Array.isArray(base)||edited.length!==base.length)return out;
  let p=0;
  for(let wr=0;wr<base.length;wr++){
    const ur=base.length-1-wr;
    for(let c=0;c<base[ur].length;c++,p++){
      if(v11ValueChanged(edited[ur][c],base[ur][c]))out[p]=clamp(Math.round(enc(edited[ur][c])),0,255);
    }
  }
  return out;
}
function patchRowsU16Preserve(raw,edited,base,enc){
  const out=new Uint8Array(raw||[]);
  if(!Array.isArray(edited)||!Array.isArray(base)||edited.length!==base.length)return out;
  let p=0;
  for(let wr=0;wr<base.length;wr++){
    const ur=base.length-1-wr;
    for(let c=0;c<base[ur].length;c++,p+=2){
      if(v11ValueChanged(edited[ur][c],base[ur][c])){
        const x=clamp(Math.round(enc(edited[ur][c])),0,65535);
        out[p]=(x>>8)&255;out[p+1]=x&255;
      }
    }
  }
  return out;
}
function patchLinearPreserve(raw,edited,base,enc){
  const out=new Uint8Array(raw||[]);
  for(let i=0;i<out.length&&i<edited.length&&i<base.length;i++){
    if(v11ValueChanged(edited[i],base[i]))out[i]=clamp(Math.round(enc(edited[i])),0,255);
  }
  return out;
}
function v11StoreMatrix(id,bank,fallback){
  try{
    if(typeof F!=='undefined'&&F[id]&&typeof featureData==='function'){
      const def=(typeof featureForProfile==='function'&&featureForProfile(id))||F[id];
      const d=featureData(def,bank);
      if(Array.isArray(d)&&d.length&&d.every(r=>Array.isArray(r)&&r.length&&r.every(v=>v!=null&&Number.isFinite(Number(v)))))return d.map(r=>r.map(Number));
    }
  }catch(_e){}
  return fallback.map(r=>r.slice());
}
function v11FuelMatrix(bank,fallback){
  try{
    const d=state&&state.mapBanks&&state.mapBanks[bank-1]&&state.mapBanks[bank-1].inject;
    if(Array.isArray(d)&&d.length===14&&d.every(r=>Array.isArray(r)&&r.length===30&&r.every(v=>v!=null&&Number.isFinite(Number(v)))))return d.map(r=>r.map(Number));
  }catch(_e){}
  return fallback.map(r=>r.slice());
}
function v11OneRow(id,fallback){
  const m=v11StoreMatrix(id,0,[fallback]);
  return m[0].slice();
}
function v11PatchChgRaw(raw,edited,base){
  const out=new Uint8Array(raw||[]);
  if(out.length!==8||!Array.isArray(edited)||edited.length!==1||!Array.isArray(base)||base.length!==1)return out;
  const vals=edited[0],old=base[0];
  if(!Array.isArray(vals)||!Array.isArray(old)||vals.length!==8||old.length!==8)return out;
  if(vals[0]>vals[1]||vals[1]>vals[2])throw new Error('CHG RPM phải theo thứ tự Min ≤ Mid ≤ Max.');
  if(vals[3]>vals[4]||vals[4]>vals[5])throw new Error('CHG Current phải theo thứ tự Min ≤ Mid ≤ Max.');
  for(let i=0;i<8;i++)if(v11ValueChanged(vals[i],old[i]))out[i]=encV11Chg(i,vals[i]);
  return out;
}
function v11PatchExternalRaw(raw,edited,base){
  const out=new Uint8Array(raw||[]);
  if(out.length!==30||!Array.isArray(edited)||edited.length!==2||!Array.isArray(base)||base.length!==2)return out;
  for(let c=0;c<15;c++){
    if(v11ValueChanged(edited[1][c],base[1][c]))out[c]=encV11ExtIgn(edited[1][c]);
    if(v11ValueChanged(edited[0][c],base[0][c]))out[15+c]=encV11ExtPct(edited[0][c]);
  }
  return out;
}
function v11BuildA2Payload(){
  const base=pageCache.get(0xA2);
  if(!base||base.length<286)throw new Error('ATE V11 SEND ALL cần đọc trực tiếp page A2 đủ 286B trước.');
  const C=parseV11A2Data(base);
  if(C.v11A2KnownLength!==286)throw new Error('ATE V11 A2 direct layout chưa đủ 286B.');
  const out=new Uint8Array(base);

  const vEct=v11OneRow('v_ect',C.vEct),vIat=v11OneRow('v_iat',C.vIat),vMap=v11OneRow('v_map',C.vMap);
  const iat=v11OneRow('iat_inj',C.iatInj),mapMotor=v11OneRow('map_idle_motor',C.mapMotor);
  out.set(patchLinearPreserve(out.slice(99,110),vEct,C.vEct,encVolt),99);
  out.set(patchLinearPreserve(out.slice(110,121),vIat,C.vIat,encVolt),110);
  out.set(patchLinearPreserve(out.slice(121,132),vMap,C.vMap,encVolt),121);
  out.set(patchLinearPreserve(out.slice(132,143),iat,C.iatInj,v=>clamp(Math.round(Math.max(0,Number(v))*20),0,255)),132);
  out.set(patchLinearPreserve(out.slice(143,154),mapMotor,C.mapMotor,v=>clamp(Math.round(Number(v)),0,255)),143);

  const clutch=v11StoreMatrix('auto_clutch',0,C.autoClutch);
  if(Array.isArray(clutch)&&clutch.length===1&&clutch[0].length===6){
    for(let i=0;i<6;i++)if(v11ValueChanged(clutch[0][i],C.autoClutch[0][i]))out[155+i]=encV11Dzfm(i,clutch[0][i]);
  }

  const opts=v11StoreMatrix('ate_options',0,C.ateOptions);
  if(Array.isArray(opts)&&opts.length===1&&opts[0].length===20){
    const raw20=encV11Options20(opts,vEct);
    for(let i=0;i<20;i++)if(v11ValueChanged(opts[0][i],C.ateOptions[0][i]))out[165+i]=raw20[i];
  }

  const start=v11StoreMatrix('ect_start',0,C.ectStart);
  if(Array.isArray(start)&&start.length===4&&start.every(r=>Array.isArray(r)&&r.length===11)){
    const raw44=encodeV11EctStart44(start);
    for(let i=0;i<44;i++)if(v11ValueChanged(raw44[i],C.ectStartRaw[i],0))out[195+i]=raw44[i];
  }

  const external=v11StoreMatrix('external_adjust',0,C.external);
  out.set(v11PatchExternalRaw(C.externalRaw,external,C.external),248);
  const chg=v11StoreMatrix('chg_params',0,C.chg);
  out.set(v11PatchChgRaw(C.chgRaw,chg,C.chg),278);
  return out;
}
function v11BuildFullWritePlan(){
  if(!v11FullImageReady())throw new Error('ATE V11 cần READ ALL 9958B trước khi GỬI TOÀN BỘ.');
  const C=readCache;
  const allPlan=[];
  const a2Base=new Uint8Array(pageCache.get(0xA2)||[]);
  if(a2Base.length<286)throw new Error('ATE V11 SEND ALL thiếu baseline A2 direct 286B.');
  const a2=v11BuildA2Payload();
  const ect=v11StoreMatrix('ect_inj',0,C.ectInj),ectIgn=v11StoreMatrix('ect_ign',0,C.ectIgn),mapInj=v11StoreMatrix('map_inj',0,C.mapInj);
  const ectRaw=patchRowsBytePreserve(C.ectInjRaw,ect,C.ectInj,encPct);
  const ectIgnRaw=patchRowsBytePreserve(C.ectIgnRaw,ectIgn,C.ectIgn,encMainIgn);
  const mapInjRaw=patchRowsBytePreserve(C.mapInjRaw,mapInj,C.mapInj,encMapInj);
  allPlan.push({pg:0xA2,payload:new Uint8Array(a2),baseline:a2Base,label:'A2'});
  allPlan.push({pg:0x72,payload:new Uint8Array(ectRaw),baseline:new Uint8Array(C.ectInjRaw),label:'ECT INJ'});
  allPlan.push({pg:0x82,payload:new Uint8Array(ectIgnRaw),baseline:new Uint8Array(C.ectIgnRaw),label:'ECT IGN'});
  allPlan.push({pg:0x92,payload:new Uint8Array(mapInjRaw),baseline:new Uint8Array(C.mapInjRaw),label:'MAP INJ'});

  const bankExpected=[];
  for(let b=1;b<=4;b++){
    const old=C.banks[b-1];
    const inj=v11FuelMatrix(b,old.inj);
    const injAngle=v11StoreMatrix('inj_degree',b,old.injDegree);
    const ign=v11StoreMatrix('ign_degree',b,old.ignDegree);
    const dwell=v11StoreMatrix('ign_time',b,old.ignTime);
    const injRaw=patchRowsU16Preserve(old.injRaw,inj,old.inj,encOilTab);
    const injDegreeRaw=patchRowsBytePreserve(old.injDegreeRaw,injAngle,old.injDegree,encMainInjAngle);
    const ignDegreeRaw=patchRowsBytePreserve(old.ignDegreeRaw,ign,old.ignDegree,encMainIgn);
    const ignTimeRaw=patchRowsBytePreserve(old.ignTimeRaw,dwell,old.ignTime,encMainDwell);
    const afRaw=new Uint8Array(old.afRaw);
    const idleRaw=new Uint8Array(old.idleRaw),auxRaw=new Uint8Array(old.auxRaw),ectMotorRaw=new Uint8Array(old.ectMotorRaw);
    const low=pageLow(b);
    allPlan.push({pg:0x10|low,payload:injRaw.slice(0,420),baseline:new Uint8Array(old.injRaw.slice(0,420)),label:'MAP '+b+' FUEL 1/2'});
    allPlan.push({pg:0x10|low|1,payload:injRaw.slice(420),baseline:new Uint8Array(old.injRaw.slice(420)),label:'MAP '+b+' FUEL 2/2'});
    allPlan.push({pg:page(2,b),payload:injDegreeRaw,baseline:new Uint8Array(old.injDegreeRaw),label:'MAP '+b+' INJ ANGLE'});
    allPlan.push({pg:page(3,b),payload:ignDegreeRaw,baseline:new Uint8Array(old.ignDegreeRaw),label:'MAP '+b+' IGN'});
    allPlan.push({pg:page(4,b),payload:ignTimeRaw,baseline:new Uint8Array(old.ignTimeRaw),label:'MAP '+b+' DWELL'});
    // AFR / Idle / Aux / ECT Motor are preserved from Read All and are only
    // verified. Blink does not rewrite these unsupported V11 blocks.
    bankExpected.push({injRaw,injDegreeRaw,ignDegreeRaw,ignTimeRaw,afRaw,idleRaw,auxRaw,ectMotorRaw});
  }
  const plan=allPlan.filter(x=>!bytesEqual(x.payload,x.baseline));
  return {plan,totalCandidates:allPlan.length,a2:new Uint8Array(a2),ectRaw:new Uint8Array(ectRaw),ectIgnRaw:new Uint8Array(ectIgnRaw),mapInjRaw:new Uint8Array(mapInjRaw),bankExpected};
}
function verifyV11FullWrite(C,E){
  if(!C||!C.v11Decoded||C.sourceLength!==9958)throw new Error('VERIFY Full Write không nhận được Read All V11 9958B.');
  // A2 direct page has a different 286B layout from the compact Read-All partition.
  // It is verified separately with a direct 0xA2 read after this Read-All check.
  if(!bytesEqual(C.ectInjRaw,E.ectRaw))throw new Error('VERIFY Full Write sai ECT INJ.');
  if(!bytesEqual(C.ectIgnRaw,E.ectIgnRaw))throw new Error('VERIFY Full Write sai ECT IGN.');
  if(!bytesEqual(C.mapInjRaw,E.mapInjRaw))throw new Error('VERIFY Full Write sai MAP INJ.');
  for(let b=1;b<=4;b++)assertV11BankMatch(C.banks[b-1],E.bankExpected[b-1],'FULL MAP '+b);
}
async function sendAllV11Real(){
  if(!v11FullImageReady())await readAll();
  if(!v11FullImageReady())throw new Error('ATE V11 chỉ cho GỬI TOÀN BỘ sau READ ALL 9958B hợp lệ.');
  if(!pageCache.get(0xA2)||pageCache.get(0xA2).length<286)await readA2SensorPageReal(false);
  if(!confirm('ATE V11 · GỬI TOÀN BỘ ECU\n\nApp dùng Read All 9958B cho các bank và page A2 trực tiếp 286B cho Options/AUX. Chỉ byte đã sửa mới thay đổi và tất cả page sẽ được verify.\n\nGiữ nguồn ECU ổn định.'))return;
  const E=v11BuildFullWritePlan();
  const resume=liveRunning;stopLiveLoop();
  try{
    for(let i=0;i<E.plan.length;i++){
      const x=E.plan[i];
      taskUi('loading','ATE V11 · FULL WRITE '+(i+1)+'/'+E.plan.length+' · '+x.label);
      await writePageChecked(x.pg,x.payload,false,1,'mainWrite');
      await new Promise(r=>setTimeout(r,70));
    }
    taskUi('loading','ATE V11 · '+E.plan.length+' PAGE ĐÃ THAY ĐỔI · ĐANG READ ALL VERIFY...');
    await new Promise(r=>setTimeout(r,300));
    const C=await readAll();
    verifyV11FullWrite(C,E);
    const A=await readA2SensorPageReal(false);
    if(!bytesEqual(A.data,E.a2))throw new Error('VERIFY Full Write sai page A2 direct 286B.');
    notice('success','GỬI TOÀN BỘ ATE V11 OK',E.plan.length+' page thay đổi / '+E.totalCandidates+' page hỗ trợ · Read All + A2 direct 286B VERIFY byte-level.');
    return C;
  }finally{
    if(resume&&cmdChar()&&mapChar()&&handshakeInfo)setTimeout(()=>startLiveLoop(),320);
  }
}
async function sendAllReal(){
  if(isV11Profile())return sendAllV11Real();
  requireProfile('fullWrite','Ghi toàn bộ ECU');
  taskUi('loading','ĐANG GHI TOÀN BỘ ECU...');
  if(!readCache)await readAll();
  await writePageChecked(0x72,encodeRowsByte(readCache.ectInj,encPct));await writePageChecked(0x82,encodeRowsByte(readCache.ectIgn,encEctIgn));await writePageChecked(0x92,encodeRowsByte(readCache.mapInj,encMapInj));await writePageChecked(0xA2,a2Payload());
  for(let b=1;b<=4;b++)await writeBankAll(b);await readAll();notice('success','SEND ALL REAL OK','Đã ghi toàn bộ page hỗ trợ và Read All verify');
}

function bytesEqual(a,b){
  if(!a||!b||a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if((a[i]&255)!==(b[i]&255))return false;
  return true;
}
function v11BankSnapshot(B){
  return {
    injRaw:new Uint8Array(B.injRaw||[]),
    injDegreeRaw:new Uint8Array(B.injDegreeRaw||[]),
    ignDegreeRaw:new Uint8Array(B.ignDegreeRaw||[]),
    ignTimeRaw:new Uint8Array(B.ignTimeRaw||[]),
    afRaw:new Uint8Array(B.afRaw||[]),
    idleRaw:new Uint8Array(B.idleRaw||[]),
    auxRaw:new Uint8Array(B.auxRaw||[]),
    ectMotorRaw:new Uint8Array(B.ectMotorRaw||[])
  };
}
function assertV11BankMatch(B,S,label){
  const pairs=[
    ['Fuel',B.injRaw,S.injRaw],['INJ angle',B.injDegreeRaw,S.injDegreeRaw],
    ['IGN angle',B.ignDegreeRaw,S.ignDegreeRaw],['Dwell',B.ignTimeRaw,S.ignTimeRaw],
    ['AFR raw',B.afRaw,S.afRaw],['Idle',B.idleRaw,S.idleRaw],
    ['Aux',B.auxRaw,S.auxRaw],['ECT Motor',B.ectMotorRaw,S.ectMotorRaw]
  ];
  for(const [name,a,b] of pairs)if(!bytesEqual(a,b))throw new Error('VERIFY COPY '+label+' sai block '+name);
}
async function copyBankV11Real(dest){
  if(!v11FullImageReady())await readAll();
  if(!v11FullImageReady())throw new Error('ATE V11 cần READ ALL 9958B hợp lệ trước khi Copy MAP.');
  const src=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4);
  const dests=dest==='all'?[1,2,3,4].filter(x=>x!==src):[clamp(Number(dest),1,4)];
  if(dests.includes(src)&&dests.length===1)return notice('info','COPY MAP','MAP nguồn và MAP đích giống nhau.');
  const srcBase=readCache.banks[src-1];
  const srcInj=v11FuelMatrix(src,srcBase.inj);
  const srcInjAngle=v11StoreMatrix('inj_degree',src,srcBase.injDegree);
  const srcIgn=v11StoreMatrix('ign_degree',src,srcBase.ignDegree);
  const srcDwell=v11StoreMatrix('ign_time',src,srcBase.ignTime);
  const S={
    injRaw:patchRowsU16Preserve(srcBase.injRaw,srcInj,srcBase.inj,encOilTab),
    injDegreeRaw:patchRowsBytePreserve(srcBase.injDegreeRaw,srcInjAngle,srcBase.injDegree,encMainInjAngle),
    ignDegreeRaw:patchRowsBytePreserve(srcBase.ignDegreeRaw,srcIgn,srcBase.ignDegree,encMainIgn),
    ignTimeRaw:patchRowsBytePreserve(srcBase.ignTimeRaw,srcDwell,srcBase.ignTime,encMainDwell)
  };
  if(S.injRaw.length!==840||S.injDegreeRaw.length!==420||S.ignDegreeRaw.length!==420||S.ignTimeRaw.length!==30){
    throw new Error('ATE V11 source bank chưa đủ 4 block tune chính để Copy an toàn.');
  }
  const hiddenBefore={};
  for(const d of dests){
    const D=v11BankSnapshot(readCache.banks[d-1]);
    hiddenBefore[d]={afRaw:D.afRaw,idleRaw:D.idleRaw,auxRaw:D.auxRaw,ectMotorRaw:D.ectMotorRaw};
  }
  if(!confirm('ATE V11 · COPY MAP NO.'+src+' → '+(dest==='all'?'ALL':dests.join(','))+'\n\nChỉ copy 4 bảng đã xác nhận: Fuel + Góc phun + Góc lửa + Dwell. AFR/Idle/Aux/ECT Motor của MAP đích được giữ nguyên và VERIFY không đổi.'))return;

  const resume=liveRunning;stopLiveLoop();
  try{
    for(const d of dests){
      const low=pageLow(d);
      taskUi('loading','ATE V11 · COPY TUNE MAP '+src+' → '+d+'...');
      await writePageChecked(0x10|low,S.injRaw.slice(0,420),false,1,'mainWrite');
      await writePageChecked(0x10|low|1,S.injRaw.slice(420,840),false,1,'mainWrite');
      await writePageChecked(page(2,d),S.injDegreeRaw,false,1,'mainWrite');
      await writePageChecked(page(3,d),S.ignDegreeRaw,false,1,'mainWrite');
      await writePageChecked(page(4,d),S.ignTimeRaw,false,1,'mainWrite');
      await new Promise(r=>setTimeout(r,140));
    }
    const C=await readAll();
    if(!C.v11Decoded)throw new Error('COPY đã ACK nhưng Read All VERIFY không trả layout ATE V11 9958B.');
    for(const d of dests){
      const B=C.banks[d-1],H=hiddenBefore[d];
      if(!bytesEqual(B.injRaw,S.injRaw))throw new Error('VERIFY COPY MAP '+d+' sai Fuel');
      if(!bytesEqual(B.injDegreeRaw,S.injDegreeRaw))throw new Error('VERIFY COPY MAP '+d+' sai Góc phun');
      if(!bytesEqual(B.ignDegreeRaw,S.ignDegreeRaw))throw new Error('VERIFY COPY MAP '+d+' sai Góc lửa');
      if(!bytesEqual(B.ignTimeRaw,S.ignTimeRaw))throw new Error('VERIFY COPY MAP '+d+' sai Dwell');
      if(!bytesEqual(B.afRaw,H.afRaw)||!bytesEqual(B.idleRaw,H.idleRaw)||!bytesEqual(B.auxRaw,H.auxRaw)||!bytesEqual(B.ectMotorRaw,H.ectMotorRaw)){
        throw new Error('VERIFY COPY MAP '+d+' phát hiện block ẩn bị thay đổi ngoài ý muốn.');
      }
    }
    notice('success','COPY MAP ATE V11 OK','MAP No.'+src+' → '+(dest==='all'?'ALL':dests.join(','))+' · 4 bảng tune đã copy · block ẩn giữ nguyên.');
  }finally{
    if(resume&&cmdChar()&&mapChar()&&handshakeInfo)setTimeout(()=>startLiveLoop(),320);
  }
}
async function copyBankReal(dest){
  if(isV11Profile())return copyBankV11Real(dest);
  requireProfile('fullWrite','Sao chép/Ghi MAP');
  if(!readCache)await readAll();const src=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4),dests=dest==='all'?[1,2,3,4].filter(x=>x!==src):[Number(dest)];
  const s=readCache.banks[src-1];for(const d of dests){const t=readCache.banks[d-1];t.inj=s.inj.map(r=>r.slice());t.injDegree=s.injDegree.map(r=>r.slice());t.ignDegree=s.ignDegree.map(r=>r.slice());t.ignTime=s.ignTime.map(r=>r.slice());t.idle=s.idle.slice();t.ectMotor=s.ectMotor.map(r=>r.slice());state.mapBanks[d-1].inject=t.inj.map(r=>r.slice());await writeBankAll(d);}await readAll();notice('success','COPY MAP REAL OK','MAP No.'+src+' → '+(dest==='all'?'ALL':dest));
}

async function restoreReal(){
  requireProfile('restore','Khôi phục dữ liệu gốc');
  if(!confirm('KHÔI PHỤC DỮ LIỆU GỐC ECU?\n\nATE gốc dùng lệnh 0x8B. Thao tác này thay đổi dữ liệu ECU. Giữ nguồn ECU ổn định và không tắt khóa điện giữa chừng.'))return;
  const resume=liveRunning;stopLiveLoop();
  try{
    taskUi('loading','ATE · RESTORE 0x8B · ĐANG CHỜ ECU...');
    const restored=await readAll(0x8B);
    if(isV11Profile()){
      if(!restored||!restored.v11Decoded||restored.sourceLength!==9958)throw new Error('ATE V11 Restore 0x8B không trả full image 9958B hợp lệ.');
      await new Promise(r=>setTimeout(r,350));
      taskUi('loading','ATE V11 · RESTORE ACK · READ ALL VERIFY...');
      const verify=await readAll(0xAB);
      if(!verify||!verify.v11Decoded||verify.sourceLength!==9958)throw new Error('Restore đã trả dữ liệu nhưng READ ALL verify không hợp lệ.');
      const a=restored.raw.slice(1,-2),b=verify.raw.slice(1,-2);
      if(!bytesEqual(a,b))throw new Error('RESTORE VERIFY: dữ liệu sau 0x8B khác lần READ ALL xác nhận.');
      try{await refreshV11PasswordHandshake();}catch(e){
        if(handshakeInfo)handshakeInfo.password=null;
        log('Restore OK nhưng refresh PIN handshake thất bại:',String(e&&e.message||e));
      }
      notice('success','RESTORE ATE V11 OK','0x8B + Read All 9958B verify byte-level · PIN handshake đã làm mới.');
      return verify;
    }
    notice('success','RESTORE ECU OK','0x8B hoàn tất · ECU trả '+restored.raw.length+'B.');
    return restored;
  }finally{
    if(resume&&cmdChar()&&mapChar()&&handshakeInfo)setTimeout(()=>startLiveLoop(),350);
  }
}
async function tpsStudyReal(){
  requireProfile('tpsStudy','Học TPS');
  if(isV11Profile()){
    if(!confirm('ATE V11 · HỌC TPS\n\nSau khi tiếp tục, vặn ga từ MIN → MAX → MIN ít nhất 3 lần theo hướng dẫn ATE. Giữ nguồn ECU ổn định.'))return;
    taskUi('loading','ATE V11 · HỌC TPS · MIN ↔ MAX > 3 LẦN...');
    const rx=await rawExchange(req5(0x77,0x77),38000);
    const f=findValidCommandFrame(rx,0x77,168);
    if(!f)throw new Error('ATE V11 TPS Study không có frame 0x77 checksum hợp lệ');
    const C=parseV11A2Data(f.slice(1,-2));
    sensorCalCache=C;
    sensorCalIdentity=handshakeInfo?[ecuProfile?.key||'UNKNOWN',handshakeInfo.ident||'',handshakeInfo.firmware||'',handshakeInfo.ecuId||1].join('|'):null;
    const min=Number(C.tpsVolt&&C.tpsVolt[0]),max=Number(C.tpsVolt&&C.tpsVolt[13]);
    if(Number.isFinite(min)&&Number.isFinite(max)&&Math.abs(max-min)>.1){
      state.cal.tpsMin=min;state.cal.tpsMax=max;
      try{syncControls();saveSoon();}catch(_e){}
    }
    notice('success','TPS STUDY ATE V11 OK',Number.isFinite(min)&&Number.isFinite(max)?min.toFixed(3)+' V → '+max.toFixed(3)+' V':'ECU đã trả calibration mới');
    return C;
  }
  taskUi('loading','ĐANG HỌC TPS · CHỜ ECU...');
  const rx=await rawExchange(req5(0x77,0x77),38000);
  if(rx.length<100||rx[0]!==0x77||!validFrame(rx))throw new Error('TPS Study 0x77 response không hợp lệ');
  const min=rx[92]*20/1024,max=rx[93]*20/1024;
  if(!(max>min+.1))throw new Error('TPS Study trả calibration không hợp lệ');
  state.cal.tpsMin=min;state.cal.tpsMax=max;try{syncControls();saveSoon();}catch(_e){}
  notice('success','TPS STUDY REAL OK',min.toFixed(3)+' V → '+max.toFixed(3)+' V');
}
async function testInjectorReal(){
  requireProfile('testInjector','Thử kim phun');
  const s=Number(prompt('Thời gian test kim phun (giây, >1):','3'));
  if(!Number.isFinite(s)||s<=1)return;
  const sec=clamp(Math.round(s),2,30);
  if(isV11Profile()){
    if(!confirm('ATE V11 · TEST KIM PHUN '+sec+' GIÂY\n\nĐộng cơ phải tắt. Đảm bảo khu vực an toàn trước khi kích kim phun.'))return;
    const resume=liveRunning;stopLiveLoop();
    const until=Date.now()+sec*1000;
    try{
      // Original ATE state machine arms/stops with DC 00 and repeatedly sends
      // DC AA while B_TestInj is active.
      await rawExchange(req5(0xDC,0x00),6000);
      await new Promise(r=>setTimeout(r,120));
      while(Date.now()<until){
        await rawExchange(req5(0xDC,0xAA),6000);
        await new Promise(r=>setTimeout(r,80));
      }
    }finally{
      try{await rawExchange(req5(0xDC,0x00),6000)}catch(_e){}
      if(resume&&cmdChar()&&mapChar()&&handshakeInfo)setTimeout(()=>startLiveLoop(),320);
    }
    notice('success','TEST INJECTOR ATE V11 XONG',sec+' giây · đã gửi DC 00 stop');
    return;
  }
  await rawExchange(req5(0xDC,sec+1),6000);
  notice('info','TEST INJECTOR','ECU đang test '+sec+' giây');
  setTimeout(()=>rawExchange(req5(0xDC,0),5000).catch(console.warn),sec*1000+200);
}

function passwordDigitsToBytes(p){p=(String(p||'')+'FFFF').slice(0,4).toUpperCase();if(!/^[0-9A-F]{4}$/.test(p))throw new Error('Mật khẩu chỉ dùng 0-9/A-F, tối đa 4 ký tự');return Array.from(p,ch=>parseInt(ch,16));}
function passwordBytesToString(a){return Array.from(a||[]).map(x=>(x&15).toString(16).toUpperCase()).join('').replace(/F+$/,'')}
function v11PasswordDigitsToBytes(p){
  p=String(p??'').trim();
  if(!/^[0-9]{1,4}$/.test(p))throw new Error('ATE V11 PIN chỉ dùng số 0–9, từ 1 đến 4 số.');
  return Array.from((p+'FFFF').slice(0,4),ch=>parseInt(ch,16));
}
function currentPasswordBytes(){
  if(isV11Profile()){
    return handshakeInfo&&Array.isArray(handshakeInfo.password)&&handshakeInfo.password.length===4
      ?handshakeInfo.password.slice():null;
  }
  return readCache&&Array.isArray(readCache.password)?readCache.password.slice():null;
}
async function refreshV11PasswordHandshake(){
  if(!isV11Profile())return currentPasswordBytes();
  const rx=await rawExchange(req5(0x5A,0x5A),7000);
  const info=parseHandshake(rx);
  const p=profileFromHandshake(info);
  if(!p||p.family!=='v11')throw new Error('Handshake verify sau PIN không còn nhận diện ATE V11.');
  if(!Array.isArray(info.password)||info.password.length!==4)throw new Error('ATE V11 handshake không trả đủ 4 byte PIN.');
  // Refresh the authoritative ECU identity/PIN cache without resetting maps.
  if(handshakeInfo){
    for(const k of ['raw','short','activeMap','ecuId','ident','firmware','date','classify','ecuMode','features','sumSignal','zeroIgn','zeroInj','password'])handshakeInfo[k]=info[k];
    handshakeInfo.profile=p;
  }else{
    handshakeInfo=info;handshakeInfo.profile=p;
  }
  return info.password.slice();
}
async function ensureV11PasswordCache(){
  if(!isV11Profile())return currentPasswordBytes();
  return currentPasswordBytes()||await refreshV11PasswordHandshake();
}
async function loginReal(){
  requireProfile('password','Đăng nhập ECU');
  let cur=currentPasswordBytes();
  if(isV11Profile()&&!cur)cur=await ensureV11PasswordCache();
  if(!cur)return notice('error','LOGIN','Chưa đọc được PIN ECU.');
  const p=prompt(isV11Profile()?'Nhập PIN ECU hiện tại (1–4 số):':'Nhập mật khẩu ECU:','');
  if(p==null)return;
  const inBytes=isV11Profile()?v11PasswordDigitsToBytes(p):passwordDigitsToBytes(p);
  const ok=passwordBytesToString(inBytes)===passwordBytesToString(cur);
  loginState=ok;
  notice(ok?'success':'error',isV11Profile()?(ok?'PIN ECU OK':'SAI PIN ECU'):(ok?'LOGIN OK':'SAI MẬT KHẨU'),ok?(isV11Profile()?'PIN khớp handshake 0x5A của ECU':'Mật khẩu khớp dữ liệu ECU'):(isV11Profile()?'PIN không khớp handshake ECU':'Mật khẩu không khớp ECU'));
}
function logoutReal(){loginState=false;notice('info','LOGOUT','Đã đăng xuất')}
async function changePasswordReal(){
  requireProfile('password','Đổi mật khẩu ECU');

  if(isV11Profile()){
    let cur=await ensureV11PasswordCache();
    if(!cur)throw new Error('Không đọc được PIN hiện tại từ ATE V11.');
    const old=prompt('PIN ATE hiện tại (1–4 số):','');
    if(old==null)return;
    if(passwordBytesToString(v11PasswordDigitsToBytes(old))!==passwordBytesToString(cur))throw new Error('PIN cũ sai.');
    const p=prompt('PIN ATE mới (1–4 số, chỉ 0–9):','');
    if(p==null)return;
    const bytes=v11PasswordDigitsToBytes(p);

    // Original ATE V11 Change Password calls proDgvEnter(..., 0xB0).
    // The B0 serializer emits: CD B0 + 4 password nibbles + 00 00 + checksum.
    const payload=[...bytes,0,0];
    taskUi('loading','ATE V11 · ĐANG ĐỔI PIN PAGE B0...');
    await writePageChecked(0xB0,payload,false,1,'password');
    await new Promise(r=>setTimeout(r,260));

    // Original ATE reads ECU PIN from 0x5A offsets 35..38. Verify the same way.
    const got=await refreshV11PasswordHandshake();
    if(passwordBytesToString(got)!==passwordBytesToString(bytes)){
      throw new Error('ECU đã ACK B0 nhưng VERIFY PIN qua handshake 0x5A không khớp.');
    }
    loginState=true;
    notice('success','ĐỔI PIN ATE V11 OK','Page B0 ACK + handshake 0x5A verify · PIN mới đã xác nhận.');
    return;
  }

  requireProfile('fullWrite','Đổi mật khẩu ECU');
  if(!readCache)await readAll();
  const old=prompt('Mật khẩu cũ:','');if(old==null)return;
  if(passwordBytesToString(passwordDigitsToBytes(old))!==passwordBytesToString(readCache.password))throw new Error('Mật khẩu cũ sai');
  const p=prompt('Mật khẩu mới (tối đa 4 ký tự hex 0-9/A-F):','');if(p==null)return;
  const bytes=passwordDigitsToBytes(p),payload=[...bytes,0,0];
  await writePageChecked(0xB2,payload);
  readCache.password=bytes;loginState=true;
  notice('success','ĐỔI MẬT KHẨU OK','Page B2 đã ACK');
}

function ecuInfoFromCache(){if(handshakeInfo){syncHandshakeInfo(handshakeInfo);return;}if(!readCache)return;const fields=[
  'REDLEO','ECU Blink','Protocol 38400 8E2','ReadAll '+readCache.raw.length+'B','—','—','—','—',ecuProfile.label
];document.querySelectorAll('[data-ecuinfo]').forEach((e,i)=>e.textContent=fields[i]||'—');}

function taskUi(kind,text,holdMs){try{if(typeof window.setEcuTaskStatus==='function')window.setEcuTaskStatus(kind,text,holdMs)}catch(_e){}}
function notice(type,title,detail){
  if(type==='success')taskUi('success',title+' · OK');
  else if(type==='error')taskUi('error',title+' · LỖI',6500);
  if(typeof window.showEcuNotice==='function')showEcuNotice(type,title,detail,4500);else alert(title+'\n'+detail)
}
function protect(fn){return async e=>{if(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();}try{await fn(e)}catch(x){err(x);taskUi('error','ECU · LỖI: '+String(x&&x.message||x),6500);notice('error','ECU REAL',x.message||String(x))}}}
function capture(id,handler){const e=document.getElementById(id);if(e)e.addEventListener('click',protect(handler),true)}

function installUI(){
  // Bank-specific Idle fields do not belong in global Option grid; keep them only in Idle/Limit screen.
  ['idleCold','idleHot','returnCold','returnHot','maxSpeed','accelPct','idleSensitivity'].forEach(k=>{const e=document.querySelector('#ecuScreen [data-ecuopt="'+k+'"]');if(e)e.closest('.optionField').style.display='none';});
  const open=document.querySelector('#ecuScreen [data-ecuopt="openingSpeed"]');if(open){open.disabled=true;open.closest('.optionField').title='Opening Speed chưa có vị trí ECU được chứng minh trong EXE 9.1X; khóa để không ghi nhầm.';}
  // Software/display toggles not present in ECU bitfield are local UI settings by design.
  ['idleMotor','solenoid','sideStand','startRelay','tpsVoltDisp','tempVoltDisp','injColor','realData','mapVoltDisp'].forEach(k=>{const e=document.querySelector('[data-ecutoggle="'+k+'"]');if(e){e.dataset.localOnly='1';const small=e.parentElement?.querySelector('small');if(small&&!small.textContent.includes('LOCAL'))small.textContent+=' · LOCAL';}});
  const spare=document.querySelector('[data-feature="spare"]');if(spare){spare.disabled=true;spare.title='Firmware 9.1X thay Spare bằng AutoClutch + password block.';}

  capture('redReadBtn',async()=>{const id=currentFeatureId();if(!id)throw new Error('Không xác định REDLEO feature');await readFeaturePageReal(id,state.activeMap);notice('success','ĐỌC TRANG ECU OK',(id||currentSource())+' · page riêng')});
  capture('redWriteBtn',async()=>{const id=currentFeatureId();if(!id)throw new Error('Không xác định REDLEO feature');await writeFeatureReal(id)});
  capture('idleLimitReadBtn',async()=>{await readIdlePageReal(state.activeMap);notice('success','IDLE/LIMIT READ','MAP No.'+state.activeMap+' · page riêng')});
  capture('idleLimitWriteBtn',writeIdleReal);

  // Fuel editor: REDLEO "Read Current" is 0x9A + current fuel page.
  capture('readMapBtn',async()=>{const R=await readCurrentFuelBank(state.activeMap);notice('success','ĐỌC HIỆN TẠI OK','MAP No.'+state.activeMap+' · page 0x'+R.page.toString(16).toUpperCase()+' · '+R.frame.length+'B')});
  capture('writeMapBtn',async()=>{
    if(typeof startFuelWrite==='function'){await startFuelWrite();return;}
    const R=await writeCurrentFuelAndVerify(state.activeMap);notice('success','MAP PHUN WRITE REAL','MAP No.'+normalizeBankForProfile(state.activeMap)+' · GHI + VERIFY RAW · '+R.frame.length+'B');
  });
  capture('applyCorrectedBtn',async()=>{
    if(typeof applyCorrectedAndWrite==='function'){await applyCorrectedAndWrite();return;}
    throw new Error('Không tìm thấy luồng MAP ĐÃ BÙ an toàn.');
  });
  capture('studyTpsBtn',tpsStudyReal);

  document.querySelectorAll('[data-ecucmd]').forEach(b=>b.addEventListener('click',protect(async()=>{
    const cmd=b.dataset.ecucmd;
    if(cmd==='READ_CURRENT'){const R=await readCurrentFuelBank(state.activeMap);notice('success','READ CURRENT OK','MAP No.'+state.activeMap+' · page 0x'+R.page.toString(16).toUpperCase()+' · '+R.frame.length+'B');return;}
    if(cmd==='READ_ALL'){const C=await readAll();notice('success','READ ALL OK',C.sourceLength+'B · '+(C.rawOnly?'RAW backup':'decoded'));return;}
    if(cmd==='SEND_ALL'){await sendAllReal();return;}
    if(cmd==='SEND_CURRENT'){const R=await writeCurrentFuelAndVerify(state.activeMap);notice('success','GHI HIỆN TẠI OK','MAP No.'+state.activeMap+' · VERIFY 0x9A · '+R.frame.length+'B');return;}
    if(cmd==='RESTORE'){await restoreReal();return;}
    if(cmd==='TPS_TEST'){await tpsStudyReal();return;}
    if(cmd==='TEST_INJ'){await testInjectorReal();return;}
    if(cmd==='OPTIONS_READ'){await readA2SensorPageReal();notice('success','OPTIONS READ REAL','Page A2 đã cập nhật');return;}
    if(cmd==='OPTIONS_WRITE'){await writeOptionsReal();return;}
    if(cmd==='ECU_INFO'){ecuInfoFromCache();return;}
    if(cmd==='LOGIN'){loginReal();return;}
    if(cmd==='LOGOUT'){logoutReal();return;}
    if(cmd==='CHANGE_PASSWORD'){await changePasswordReal();return;}
  }),true));
  document.querySelectorAll('[data-copybank]').forEach(b=>b.addEventListener('click',protect(()=>copyBankReal(b.dataset.copybank)),true));

  document.getElementById('idleLimitBankSelect')?.addEventListener('change',()=>setTimeout(()=>{if(readCache)syncIdle(state.activeMap)},0),true);
  // Options are edit-local only. Never write A2 merely because a control
  // changed or because Read All synchronized values into the UI.
  // The ECU is modified only by the explicit GHI TÙY CHỌN action.

  document.querySelectorAll('[data-feature]').forEach(e=>e.addEventListener('click',()=>setTimeout(()=>{try{applyProfileUi()}catch(_e){}},0),false));

  // Mark status visibly.
  document.querySelectorAll('.sourceNote').forEach(e=>{if(!e.textContent.includes('ECU REAL'))e.textContent+=' · ECU REAL protocol layer active.';});
}

// ReadAll after BLE becomes connected. Poll for exposed chars because connect handler lives in another IIFE.
function boot(){
  installUI();
  applyProfileUi();
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
        .then(()=>notice('success','ECU REAL ONLINE',(ecuProfile?.label||'ECU')+(profileCap('live')?' · Handshake + Live 0x69':' · SAFE MODE')+' · không tự Read All'))
        .catch(e=>{err(e);notice('error','ECU REAL CHƯA ONLINE',e.message||String(e));});
    },450);
  },150);

  window.addEventListener('pagehide',()=>abortRawTransport('pagehide'));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stopLiveLoop();
    else if(cmdChar()&&mapChar()&&handshakeInfo&&profileCap('live'))startLiveLoop();
  });
}

window.BlinkRealProtocol={rawExchange,exchangePage9A,readAll,readCurrentFuelBank,readFeaturePageReal,readIdlePageReal,readA2SensorPageReal,writeCurrentFuelAndVerify,parseCurrentFuelFrame,parseReadAll,parseHandshake,parseLiveReal,handshakeReal,initializeRealSession,writeFeatureReal,writeOptionsReal,writeIdleReal,sendAllReal,copyBankReal,restoreReal,tpsStudyReal,testInjectorReal,abortRawTransport,profileFromHandshake,normalizeBank:normalizeBankForProfile,refreshProfileUi:applyProfileUi,get cache(){return readCache},get sensorCache(){return sensorCalCache},get handshake(){return handshakeInfo},get profile(){return ecuProfile},get isBusy(){return busy}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

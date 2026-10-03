/* BLINK TL - REDLEO 9.1X REAL ECU PROTOCOL
 * Source of truth: static IL analysis of ECU Pro 9.1X.exe (assembly 9.1.2.15).
 * Transport: E1/E2 raw BLE chunks via ESP32-S3 real bridge.
 * REDLEO ECU UART: 38400 8E2.
 */
(function(){
'use strict';

const TAG='[BLINK TL REAL]';
const RAW_TX=0xE1, RAW_RX=0xE2, RAW_CHUNK=13, RAW_JUMBO_CHUNK=160;
const READ_ALL_LEN=9767;
const VER_TIME=2, VER_ANGLE=4;
let sid=(Math.random()*220+1)|0;
let pending=new Map();
let installedChar=null;
let busy=false;
let liveTimer=null;
let liveRunning=false;
let liveResumeTimer=null;
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
let otaPaused=false;
// Large 0xCD upload strategy.
// FW1.5 advertises MTU 185. TURBO therefore tries ~160B RAW payload chunks
// (7B protocol header + 160B data) and uses write-without-response bursts with
// periodic write-with-response barriers. If the client cannot accept jumbo MTU,
// the same transaction transparently falls back to 13B chunks. Any retry uses
// the conservative all-with-response path.
let rawWritePacingMode='safe'; // 'turbo' | 'safe'
let rawJumboSessionCap=null;   // null=unknown, true=works, false=use 13B fallback
function isAppleMobileBleClient(){
  const ua=String(navigator.userAgent||'');
  const platform=String(navigator.platform||'');
  return /iPhone|iPad|iPod/i.test(ua)||/iPhone|iPad|iPod/i.test(platform)||
         (platform==='MacIntel'&&Number(navigator.maxTouchPoints||0)>1);
}

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
  'Air fuel ratio map':'afr_map',
  'Automatic shift':'auto_shift',
  'Automatic clutch':'auto_clutch',
  'Charger Parameters':'chg_params',
  'ATE options':'ate_options',
  'Start Add Injection':'ect_start',
  'Alternate Table':'alternate_table',
  'Spare':'spare',
  'ECT - Voltage Relation':'v_ect',
  'IAT - Voltage Relation':'v_iat',
  'MAP - Voltage Relation':'v_map'
};
const N={inj_degree:2,ign_degree:3,ign_time:4,idle_limit:5,ect_idle_motor:6,ect_inj:7,ect_ign:8,map_inj:9,iat_inj:10,map_idle_motor:11,external_adjust:12,auto_clutch:13,spare:14,v_ect:15,v_iat:16,v_map:17,auto_shift:18,chg_params:19,ate_options:20,ect_start:21,alternate_table:22,afr_map:23};

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
const V11_A2=Object.freeze({
  NAME:'A2-272',LEN:272,
  TPS:0,RPM:14,VAFR:74,VECT:85,VIAT:96,VMAP:107,
  IAT_INJ:118,MAP_MOTOR:129,CONFIG:140,OPTION:151,
  ECT_START:181,GLOBAL_AUX:225,EXTERNAL:234,CHG:264
});
// Some ATE V11 builds expose the older 286-byte direct A2 serializer:
// 14B TPS-voltage + 14B TPS-% + 60B RPM, then the same logical blocks.
const V11_A2_286=Object.freeze({
  NAME:'A2-286',LEN:286,
  TPS_VOLT:0,TPS:14,RPM:28,VAFR:88,VECT:99,VIAT:110,VMAP:121,
  IAT_INJ:132,MAP_MOTOR:143,CONFIG:154,OPTION:165,
  ECT_START:195,GLOBAL_AUX:239,EXTERNAL:248,CHG:278
});
function normalizeV11AxisOrder(tpsPct,rpmAxis){
  let t=Array.from(tpsPct||[],Number),r=Array.from(rpmAxis||[],Number);
  // Some V11 serializers expose the same breakpoints in reverse display order.
  // Normalize only a fully descending axis; never sort arbitrary/corrupt data.
  if(t.length===14&&t.every(Number.isFinite)&&t[0]>t[t.length-1]){
    let desc=true;for(let i=1;i<t.length;i++)if(t[i]>t[i-1]){desc=false;break;}
    if(desc)t=t.slice().reverse();
  }
  if(r.length===30&&r.every(Number.isFinite)&&r[0]>r[r.length-1]){
    let desc=true;for(let i=1;i<r.length;i++)if(r[i]>=r[i-1]){desc=false;break;}
    if(desc)r=r.slice().reverse();
  }
  return {tpsPct:t,rpmAxis:r,axesValid:validDynamicAxes(t,r)};
}
function v11AxesForLayout(data,L){
  if(!(data instanceof Uint8Array))data=new Uint8Array(data||[]);
  if(!L||data.length<L.RPM+60)return null;
  const tpsRaw=data.slice(L.TPS,L.TPS+14);
  const tpsDecoded=Array.from(tpsRaw,x=>Number(x)/2);
  const rpmRaw=data.slice(L.RPM,L.RPM+60);
  const rpmDecoded=[];for(let i=0;i<60;i+=2)rpmDecoded.push(u16be(rpmRaw,i)*20);
  const N=normalizeV11AxisOrder(tpsDecoded,rpmDecoded);
  return {tpsRaw,tpsPct:N.tpsPct,rpmRaw,rpmAxis:N.rpmAxis,axesValid:N.axesValid,rawTpsPct:tpsDecoded,rawRpmAxis:rpmDecoded};
}
function detectV11A2Layout(data){
  if(!(data instanceof Uint8Array))data=new Uint8Array(data||[]);
  const layouts=[V11_A2,V11_A2_286];

  // A checksum-valid direct A2 frame with an exact verified wire length is
  // authoritative for layout selection. Axis bytes are useful metadata, but
  // must not make the whole V11 page unreadable on an ECU build with fixed or
  // differently encoded breakpoints.
  const exactL=layouts.find(L=>data.length===L.LEN);
  if(exactL){
    const A=v11AxesForLayout(data,exactL);
    if(A)return {L:exactL,A,axesValid:!!A.axesValid,match:'length'};
  }

  const candidates=[];
  for(const L of layouts){
    if(data.length<L.LEN)continue;
    const A=v11AxesForLayout(data,L);
    if(A&&A.axesValid)candidates.push({L,A,axesValid:true,match:'axes'});
  }
  if(!candidates.length)return null;
  if(candidates.length===1)return candidates[0];
  candidates.sort((a,b)=>Math.abs(data.length-a.L.LEN)-Math.abs(data.length-b.L.LEN));
  return candidates[0];
}
function requireV11A2Layout(data){
  const d=detectV11A2Layout(data);
  if(d)return d;
  const n=data&&data.length||0;
  throw new Error('ATE V11 A2 '+n+'B không khớp layout trực tiếp 272B/286B đã xác minh.');
}
function v11A2LayoutOf(data){return requireV11A2Layout(data).L;}

function firmwareNumbers(info=handshakeInfo){
  const txt=(String(info&&info.firmware||'')+' '+String(info&&info.ident||'')).toUpperCase();
  const m=txt.match(/(?:V|VER(?:SION)?)?\s*(8|9|10|11)(?:\.(\d+))?/);
  if(!m)return {major:NaN,minor:NaN};
  return {major:Number(m[1]),minor:m[2]==null?NaN:Number(m[2])};
}
function usesNewThermalAxis(info=handshakeInfo){
  if(ecuProfile&&(ecuProfile.key==='MODERN_V10'||ecuProfile.key==='MODERN_V11'))return true;
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
// Compensation tables are not TPS tables. On the newer thermal-axis generation
// (REDLEO 9.2+, V10/Ultra and ATE/V11), page 0x72/0x82/0x92 rows are stored
// low->high on wire, matching the ascending ECT/MAP physical axes. Older 8/9.1
// software uses the legacy reversed-row serializer, so preserve it there.
function compRowsForwardOnWire(info=handshakeInfo){
  return usesNewThermalAxis(info);
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
  const payload={profile:ecuProfile?.key||'UNKNOWN',firmware:handshakeInfo?.firmware||'',tpsPct:t.slice(),rpmAxis:r.slice(),ectAxis:aux.ect,iatAxis:aux.iat,mapAxis:aux.map,compRowOrder:compRowsForwardOnWire()?'forward':'legacy-reverse',source};
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
  // ATE V11 TPS Study (0x77) is valid independently of the injector-test
  // ecuMode safety gate. Gating TPS here made the Settings button silently
  // disabled on otherwise supported V11 ECUs.
  if(cap&&ecuProfile&&ecuProfile.family==='v11'&&name==='testInjector'){
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
  if(ecuProfile&&ecuProfile.family==='v11'&&id==='afr_map')return page(5,bank);
  if(id==='ect_inj')return 0x72;
  if(id==='ect_ign')return 0x82;
  if(id==='map_inj')return 0x92;
  if(ecuProfile&&ecuProfile.family==='v11'&&['idle_limit','ect_idle_motor','auto_shift'].includes(id))return page(6,bank);
  if(ecuProfile&&ecuProfile.family==='v11'&&['iat_inj','map_idle_motor','external_adjust','auto_clutch','chg_params','ate_options','ect_start','alternate_table','v_ect','v_iat','v_map'].includes(id))return 0xA2;
  return null;
}
function isDirectVerifiedFeature(id){
  if(['inj_degree','ign_degree','ign_time'].includes(id))return true;
  return !!(ecuProfile&&ecuProfile.family==='v11'&&['idle_limit','ect_idle_motor','auto_shift','afr_map','auto_clutch','chg_params','ate_options','ect_start','alternate_table','ect_inj','ect_ign','map_inj','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map'].includes(id));
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
    el.disabled=el.dataset.ioBusy==='1';
    if(el.title&&el.title.includes('ECU Profile'))el.title='';
  }
}
const PROFILE_FEATURES=Object.freeze({
  LEGACY_V8:new Set(['inj_ve','inj_degree','ign_degree','ign_time']),
  MODERN_V9:new Set(['inj_ve','inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj','iat_inj','idle_limit','ect_idle_motor','map_idle_motor','external_adjust','auto_clutch','v_ect','v_iat','v_map']),
  MODERN_V10:new Set(['inj_ve','inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj','iat_inj','idle_limit','ect_idle_motor','map_idle_motor','v_ect','v_iat','v_map']),
  MODERN_V11:new Set(['inj_ve','inj_degree','ign_degree','ign_time','afr_map','ect_inj','ect_ign','map_inj','iat_inj','ect_start','idle_limit','ect_idle_motor','map_idle_motor','external_adjust','auto_shift','auto_clutch','chg_params','ate_options','alternate_table','v_ect','v_iat','v_map']),
  LEGACY_PROBE:new Set(),
  UNKNOWN:new Set()
});
function profileSupportsFeature(id,p=ecuProfile){
  const set=PROFILE_FEATURES[p?.key||'UNKNOWN']||PROFILE_FEATURES.UNKNOWN;
  return set.has(id);
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
  const optionsReadBtn=document.querySelector('[data-ecucmd="OPTIONS_READ"]');
  const optionsWriteBtn=document.querySelector('[data-ecucmd="OPTIONS_WRITE"]');
  if(loginBtn)loginBtn.textContent=p.family==='v11'?'XÁC NHẬN PIN ECU':'ĐĂNG NHẬP ECU';
  if(logoutBtn)logoutBtn.textContent=p.family==='v11'?'XÓA XÁC NHẬN PIN':'ĐĂNG XUẤT';
  if(changePwBtn)changePwBtn.textContent=p.family==='v11'?'ĐỔI PIN ECU':'ĐỔI MẬT KHẨU';
  if(optionsReadBtn){
    if(p.family==='v11')optionsReadBtn.textContent='ĐỌC A2 / TÙY CHỌN ATE';
    else if(p.key==='MODERN_V10')optionsReadBtn.textContent='ĐỌC A2 / TRỤC + SENSOR';
    else optionsReadBtn.textContent='ĐỌC TÙY CHỌN';
  }
  if(optionsWriteBtn)optionsWriteBtn.style.display=p.key==='MODERN_V9'?'':'none';
  const legacyOptionsPanel=document.getElementById('legacyEcuOptionsPanel');
  if(legacyOptionsPanel)legacyOptionsPanel.style.display=p.key==='MODERN_V9'?'':'none';
  const sub=document.querySelector('#ecuScreen .screenSub');
  if(sub)sub.textContent='AUTO ECU PROFILE · '+p.label;
  const mapSub=document.getElementById('mapsProfileSub');
  if(mapSub){
    const fw=String(handshakeInfo&&handshakeInfo.firmware||'').trim();
    if(p.family==='v11')mapSub.textContent='ATE '+(fw||'11.x')+' · bảng V11 thích nghi + AFR/O2 map gốc + Auto Tune Blink';
    else if(p.family==='modern')mapSub.textContent=p.label+(fw?' · FW '+fw:'')+' · giao diện REDLEO thích nghi';
    else if(p.family==='v8')mapSub.textContent=p.label+' · ECU_MODE '+(handshakeInfo?.ecuMode??'—')+' · chỉ hiện bảng đã xác minh';
    else mapSub.textContent='AUTO ECU PROFILE · chờ nhận diện';
  }
  document.body.dataset.ecuProfile=p.key||'UNKNOWN';
  const reason='ECU Profile: '+p.label+' · chức năng này đang bị khóa để tránh dùng sai protocol.';

  // TPS Study has one UI entry point in Settings. Keep that single button
  // profile-aware so the user cannot accidentally run a study sequence that
  // belongs to another ECU family.
  const studyTpsBtn=document.getElementById('studyTpsBtn');
  if(studyTpsBtn){
    if(p.key==='MODERN_V11')studyTpsBtn.textContent='HỌC TPS ECU · ATE V11';
    else if(p.key==='MODERN_V10')studyTpsBtn.textContent='HỌC TPS ECU · V10 / ULTRA';
    else if(p.key==='MODERN_V9')studyTpsBtn.textContent='HỌC TPS ECU · V9';
    else studyTpsBtn.textContent='HỌC TPS ECU · CHƯA HỖ TRỢ';
    setProfileDisabled(studyTpsBtn,!profileCap('tpsStudy'),reason);
  }

  ['writeMapBtn','applyCorrectedBtn'].forEach(id=>setProfileDisabled(document.getElementById(id),!profileCap('fuelWrite'),reason));
  const mainFeatureIds=new Set(['idle_limit','ect_idle_motor','auto_shift','afr_map','inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map']);
  if(p.family==='v11'){mainFeatureIds.add('auto_clutch');mainFeatureIds.add('chg_params');mainFeatureIds.add('ate_options');mainFeatureIds.add('ect_start');mainFeatureIds.add('alternate_table');}
  let activeFeatureId=null;
  try{activeFeatureId=currentFeatureId();}catch(_e){}
  const activeFeatureSupported=!activeFeatureId||profileSupportsFeature(activeFeatureId,p);
  const directReady=activeFeatureId?mainFeatureReady(activeFeatureId,(typeof state!=='undefined'&&state.activeMap)||1):false;
  const legacyFullReady=activeFeatureId&&activeFeatureSupported&&profileCap('fullWrite');
  const canRedWrite=activeFeatureId?(directReady||legacyFullReady):profileCap('fullWrite');
  setProfileDisabled(document.getElementById('redWriteBtn'),!canRedWrite,reason);
  setProfileDisabled(document.getElementById('idleLimitWriteBtn'),!profileCap('fullWrite'),reason);
  setProfileDisabled(document.getElementById('readMapBtn'),!profileCap('fuelRead')||!profileSupportsFeature('inj_ve',p),reason);
  setProfileDisabled(document.getElementById('redReadBtn'),!profileCap('pageRead')||!activeFeatureSupported,reason);
  setProfileDisabled(document.getElementById('idleLimitReadBtn'),!profileCap('idleRead')||!profileSupportsFeature('idle_limit',p),reason);

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

  // Show only features whose parser/writer surface is verified for the
  // detected ECU profile. Before identification keep cards visible but locked.
  document.querySelectorAll('[data-feature]').forEach(el=>{
    const id=el.dataset.feature;
    const pending=p.key==='UNKNOWN'||p.key==='LEGACY_PROBE';
    const supported=profileSupportsFeature(id,p);
    setProfileDisabled(el,!supported,!supported?'ECU Profile: '+p.label+' · bảng này chưa được giải mã an toàn cho profile này.':'');
    el.style.display=(pending||supported)?'':'none';
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
function bridgeFirmwareAtLeast(reqMajor,reqMinor){
  const t=String(window.blinkBridgeFirmwareStatus||'');
  const m=t.match(/FW\s*(\d+)\.(\d+)/i);
  if(!m)return false;
  const major=Number(m[1]),minor=Number(m[2]);
  return major>reqMajor||(major===reqMajor&&minor>=reqMinor);
}
function bridgeRawWriteSafe(){
  return bridgeFirmwareAtLeast(1,1);
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

function decodeV11Afr420(raw){
  raw=raw instanceof Uint8Array?raw:new Uint8Array(raw||[]);
  if(raw.length<420)throw new Error('ATE V11 AFR cần 420 byte.');
  const matrix=Array.from({length:14},()=>Array(30).fill(0));
  const enabled=Array.from({length:14},()=>Array(30).fill(true));
  let p=0;
  for(let wr=0;wr<14;wr++){
    const ur=13-wr;
    for(let c=0;c<30;c++,p++){
      const x=(raw[p]&255)/10;
      const on=x>=9&&x<=18;
      enabled[ur][c]=on;
      matrix[ur][c]=r1(on?x:(x<9?x+12.8:x-12.8));
    }
  }
  return {matrix,enabled,raw:raw.slice(0,420)};
}
function setV11AfrMeta(bank,decoded){
  bank=clamp(Math.round(bank),1,4);
  if(!window.blinkV11AfrMeta)window.blinkV11AfrMeta={};
  window.blinkV11AfrMeta[bank]={
    enabled:decoded.enabled.map(r=>r.slice()),
    baseEnabled:decoded.enabled.map(r=>r.slice()),
    baseMatrix:decoded.matrix.map(r=>r.slice()),
    raw:Array.from(decoded.raw||[])
  };
}
function encodeV11AfrChanged(matrix,meta,baselineRaw){
  if(!Array.isArray(matrix)||matrix.length!==14||matrix.some(r=>!Array.isArray(r)||r.length!==30))throw new Error('ATE V11 AFR cần bảng 14 × 30.');
  if(!meta||!Array.isArray(meta.enabled)||!Array.isArray(meta.baseEnabled)||!Array.isArray(meta.baseMatrix))throw new Error('ATE V11 AFR chưa có trạng thái ON/OFF từ ECU. Hãy ĐỌC bảng trước.');
  const out=new Uint8Array(baselineRaw||[]);
  if(out.length<420)throw new Error('ATE V11 AFR baseline thiếu 420 byte.');
  let p=0;
  for(let wr=0;wr<14;wr++){
    const ur=13-wr;
    for(let c=0;c<30;c++,p++){
      const v=Number(matrix[ur][c]),base=Number(meta.baseMatrix[ur][c]);
      const on=meta.enabled[ur][c]!==false,baseOn=meta.baseEnabled[ur][c]!==false;
      if(!v11ValueChanged(v,base)&&on===baseOn)continue;
      if(!Number.isFinite(v)||v<9||v>18)throw new Error('AFR phải trong 9.0–18.0 tại TPS row '+(ur+1)+', RPM col '+(c+1)+' · '+v);
      let wire=v;
      if(!on)wire=v>=12.8?v-12.8:v+12.8;
      out[p]=clamp(Math.round(wire*10),0,255);
    }
  }
  return out;
}

function decodeRowsByte(a,off,rows,cols,dec=x=>x){
  const out=Array.from({length:rows},()=>Array(cols).fill(0));let p=off;
  for(let wr=0;wr<rows;wr++){const ur=rows-1-wr;for(let c=0;c<cols;c++)out[ur][c]=dec(a[p++]);}
  return {data:out,next:p};
}
function encodeRowsByte(m,enc=x=>x){const out=[];for(let wr=0;wr<m.length;wr++){const ur=m.length-1-wr;for(let c=0;c<m[ur].length;c++)out.push(clamp(Math.round(enc(m[ur][c])),0,255));}return out}

// ATE V11 compensation pages are stored in the same low->high order as their
// physical axes (-14->126C for ECT, 0->120 kPa for MAP). Do not reuse the
// TPS-map row reversal here: doing so made cold enrichment appear at the hot end.
function decodeRowsByteForward(a,off,rows,cols,dec=x=>x){
  const out=Array.from({length:rows},()=>Array(cols).fill(0));let p=off;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)out[r][c]=dec(a[p++]);
  return {data:out,next:p};
}
function encodeRowsByteForward(m,enc=x=>x){
  const out=[];
  for(let r=0;r<m.length;r++)for(let c=0;c<m[r].length;c++)out.push(clamp(Math.round(enc(m[r][c])),0,255));
  return out;
}
function decodeRowsU16(a,off,rows,cols,dec=x=>x){
  const out=Array.from({length:rows},()=>Array(cols).fill(0));let p=off;
  for(let wr=0;wr<rows;wr++){const ur=rows-1-wr;for(let c=0;c<cols;c++){out[ur][c]=dec(u16be(a,p));p+=2;}}
  return {data:out,next:p};
}
function encodeRowsU16(m,enc=x=>x){const out=[];for(let wr=0;wr<m.length;wr++){const ur=m.length-1-wr;for(let c=0;c<m[ur].length;c++)push16be(out,enc(m[ur][c]));}return out}

function valueToCurveVoltage(value,curve,axis){
  const vals=Array.from(curve||[],Number),ax=Array.from(axis||[],Number);
  value=Number(value);
  if(vals.length<2||vals.length!==ax.length||!Number.isFinite(value))return NaN;
  if(value<=ax[0])return vals[0];
  if(value>=ax[ax.length-1])return vals[vals.length-1];
  for(let i=0;i<ax.length-1;i++){
    const x0=ax[i],x1=ax[i+1];
    if(value<x0||value>x1)continue;
    if(Math.abs(x1-x0)<1e-9)return vals[i];
    return vals[i]+(vals[i+1]-vals[i])*(value-x0)/(x1-x0);
  }
  return vals[0];
}
function ectTempToRaw(temp,vEct){
  const v=valueToCurveVoltage(temp,vEct,currentAuxAxes().ect);
  return encVolt(Number.isFinite(v)?v:0);
}
function curveVoltageToAxis(v,curve,axis){
  const vals=Array.from(curve||[],Number);
  const ax=Array.isArray(axis)?Array.from(axis,Number):Array.from({length:vals.length},(_,i)=>i*Number(axis||1));
  if(vals.length<2||vals.length!==ax.length||!Number.isFinite(v))return NaN;
  for(let i=0;i<vals.length-1;i++){
    const a=vals[i],b=vals[i+1];
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(ax[i])||!Number.isFinite(ax[i+1]))continue;
    if(v>=Math.min(a,b)&&v<=Math.max(a,b)){
      if(Math.abs(b-a)<1e-9)return ax[i];
      return ax[i]+((v-a)/(b-a))*(ax[i+1]-ax[i]);
    }
  }
  // Clamp to the closest calibration endpoint rather than extrapolate wildly.
  const d0=Math.abs(v-vals[0]),d1=Math.abs(v-vals[vals.length-1]);
  return d0<=d1?ax[0]:ax[ax.length-1];
}
function ectRawToTemp(raw,vEct){
  const t=curveVoltageToAxis(decVolt(raw),vEct,currentAuxAxes().ect);
  return Number.isFinite(t)?Math.round(t):currentAuxAxes().ect[0];
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
  publishProfileAxisFallback(p.key==='MODERN_V10'||p.key==='MODERN_V11'?'PROFILE · CHỜ A2 TPS/RPM':'PROFILE · AXIS CỐ ĐỊNH');
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
  // Verified profile-specific live injection SUM:
  // V10/Ultra = byte14..15 /640; ATE V11 = byte14..15 /500.
  // V8/V9 retain their previously verified paths.
  if(ecuProfile&&ecuProfile.key==='MODERN_V10')state.live.pw=u16be(a,14)/640;
  else if(isV11Profile())state.live.pw=u16be(a,14)/500;
  else state.live.pw=u16be(a,16)/(ecuProfile&&ecuProfile.family==='v8'?640:500);
  state.live.ign=decLiveIgn(u16be(a,28));
  state.live.batt=u16be(a,42)*55/1024;
  const liveCal=readCache||sensorCalCache;
  if(liveCal){
    const aux=currentAuxAxes();
    state.live.ect=curveVoltageToAxis(decVolt(a[2]),liveCal.vEct,aux.ect);
    state.live.iat=curveVoltageToAxis(decVolt(a[3]),liveCal.vIat,aux.iat);
    // ATE V11 NumberToVoltage uses raw*5/256 for the 16-bit MAP live field.
    // V8/V9/V10 use the existing raw*5/1024 path here.
    const mapV=isV11Profile()?decVolt(u16be(a,4)):liveVolt10(u16be(a,4));
    state.live.mapKpa=curveVoltageToAxis(mapV,liveCal.vMap,aux.map);
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
    const afrVCal=clamp(volts,0,2.66); state.live.afr=afrVCal<=1.271 ? 9+(afrVCal/1.271)*3.1 : 12.1+((afrVCal-1.271)/(2.66-1.271))*5.9;
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
  if(otaPaused || (typeof window.blinkOtaTransferActive==='function' && window.blinkOtaTransferActive()))return;
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
  if(liveResumeTimer){clearTimeout(liveResumeTimer);liveResumeTimer=null;}
  if(liveRunning)return;
  liveRunning=true;
  clearInterval(liveTimer);
  liveTimer=setInterval(()=>{liveOnce();},180);
}
function stopLiveLoop(){
  liveRunning=false;
  if(liveTimer){clearInterval(liveTimer);liveTimer=null;}
  // Cancel a delayed restart left by the previous read/write. Without this,
  // that stale timer can restart 0x69 in the middle of the next manual command.
  if(liveResumeTimer){clearTimeout(liveResumeTimer);liveResumeTimer=null;}
}
function scheduleLiveResume(ms=350){
  if(liveResumeTimer)clearTimeout(liveResumeTimer);
  liveResumeTimer=setTimeout(()=>{
    liveResumeTimer=null;
    if(cmdChar()&&mapChar()&&handshakeInfo&&profileCap('live')&&!otaPaused)startLiveLoop();
  },ms);
}

async function pauseForOta(){
  otaPaused=true;
  stopLiveLoop();
  const t0=performance.now();
  while(busy){
    if(performance.now()-t0>6000)throw new Error('ECU đang bận, chưa thể bắt đầu OTA');
    await new Promise(r=>setTimeout(r,25));
  }
  return true;
}

function resumeAfterOta(){
  otaPaused=false;
  if(cmdChar()&&mapChar()&&handshakeInfo&&profileCap('live'))startLiveLoop();
}
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
    publishProfileAxisFallback(ecuProfile&&ecuProfile.family==='v8'?'V8 · AXIS CỐ ĐỊNH':(ecuProfile&&ecuProfile.key==='MODERN_V9'?'V9 · AXIS CỐ ĐỊNH':'CHỜ A2 AXIS · '+(ecuProfile?.short||'ECU')));
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
function statusChar(){return window.blinkStatusChar||null}
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
  rawJumboSessionCap=null;
  v8LiveSlot=0;
  ecuProfile=ECU_PROFILE_DEFS.UNKNOWN;
  publishEcuAxes(LEGACY_TPS_PCT.slice(),LEGACY_RPM_AXIS.slice(),'DISCONNECTED');
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

let manualMapIoDepth=0;
let manualMapIoResumeLive=false;
async function beginManualMapIo(label='MAP'){
  manualMapIoDepth++;
  if(manualMapIoDepth>1)return {nested:true,resumeLive:false};

  // Manual READ/WRITE always has priority over background live polling.
  // Stop scheduling new 0x69 packets first, then wait only for the one that is
  // already in flight. Never reject a user action merely because it landed in
  // the middle of a live sample.
  manualMapIoResumeLive=!!(liveRunning||liveResumeTimer);
  stopLiveLoop();

  const t0=performance.now();
  if(busy){
    updateActiveMapIoText('⏳ CHỜ LIVE NHẢ ECU...');
    taskUi('loading','ĐANG CHỜ LIVE KẾT THÚC · '+String(label||'MAP').toUpperCase());
  }
  await waitForEcuIdle(8000);
  const waited=Math.round(performance.now()-t0);
  if(waited>60)log('manual MAP I/O waited for background transaction',waited+'ms',label);

  return {nested:false,resumeLive:manualMapIoResumeLive,waitedMs:waited};
}
function endManualMapIo(ctx){
  if(manualMapIoDepth>0)manualMapIoDepth--;
  if(manualMapIoDepth>0)return;

  const shouldResume=!!(ctx&&ctx.resumeLive)||manualMapIoResumeLive;
  manualMapIoResumeLive=false;
  if(shouldResume&&cmdChar()&&mapChar()&&handshakeInfo&&profileCap('live')&&!otaPaused){
    scheduleLiveResume(380);
  }
}

async function acquireEcuTransaction(maxWait=16000){
  const t0=performance.now();
  while(true){
    if(!cmdChar()||!mapChar())throw new Error('BLE đã ngắt trong khi chờ ECU');
    // Check + set occurs in one JS turn before any await, so only one caller
    // can acquire the transport. This closes the race between Live 0x69 and
    // READ/WRITE buttons that existed in waitForEcuIdle()+busy=true.
    if(!busy){busy=true;return true;}
    if(performance.now()-t0>maxWait)throw new Error('ECU bận quá lâu; transaction trước chưa hoàn tất');
    await new Promise(r=>setTimeout(r,25));
  }
}

async function writeRawBleChunk(cur,pkt,mode='response'){
  if(mode==='no-response'){
    if(typeof cur.writeValueWithoutResponse==='function'){await cur.writeValueWithoutResponse(pkt);return;}
    // Some Web Bluetooth shims expose only the generic API. It is still safe;
    // it simply becomes a barrier for this packet.
    if(typeof cur.writeValue==='function'){await cur.writeValue(pkt);return;}
    if(typeof cur.writeValueWithResponse==='function'){await cur.writeValueWithResponse(pkt);return;}
  }else{
    if(typeof cur.writeValueWithResponse==='function'){await cur.writeValueWithResponse(pkt);return;}
    if(typeof cur.writeValue==='function'){await cur.writeValue(pkt);return;}
    if(typeof cur.writeValueWithoutResponse==='function'){
      await cur.writeValueWithoutResponse(pkt);
      await new Promise(r=>setTimeout(r,8));
      return;
    }
  }
  throw new Error('BLE characteristic không hỗ trợ ghi RAW');
}

function dataViewText(d){
  try{
    if(!d)return '';
    const u=d instanceof DataView
      ?new Uint8Array(d.buffer,d.byteOffset,d.byteLength)
      :(d.buffer?new Uint8Array(d.buffer,d.byteOffset||0,d.byteLength||d.length||0):new Uint8Array(d));
    return new TextDecoder().decode(u).trim();
  }catch(_e){return ''}
}

async function confirmBridgeRawReady(id,p){
  if(p&&p.bridgeReadyAt)return true;
  // If RAW_RX already completed while we were finishing TX, the bridge could
  // only have reached UART after fully assembling the frame.
  if(!pending.has(id))return true;
  const sc=statusChar();
  if(!sc||typeof sc.readValue!=='function')return null;

  // A final write-with-response barrier has already completed. Read the status
  // characteristic a few times to make RAWREADY an application-level ACK that
  // the ESP32 assembler truly has every byte before we wait on the ECU.
  for(let i=0;i<3;i++){
    if(i)await new Promise(r=>setTimeout(r,18));
    try{
      const d=await sc.readValue();
      const t=dataViewText(d);
      if(t===('RAWREADY '+id)){
        if(p&&!p.bridgeReadyAt)p.bridgeReadyAt=performance.now();
        return true;
      }
    }catch(e){
      log('RAWREADY status read unavailable',String(e&&e.message||e));
      return null;
    }
    if(p&&p.bridgeReadyAt)return true;
  }
  return false;
}

function rejectPending(p,err){
  try{p&&p.reject&&p.reject(err);}catch(_e){}
}

let lastExchangeMeta=null;
const previousBlinkStatusHandler=typeof window.onBlinkStatus==='function'?window.onBlinkStatus:null;
window.onBlinkStatus=function(text){
  const s=String(text||'').trim();
  const m=s.match(/^RAWREADY\s+(\d+)$/i);
  if(m){
    const id=Number(m[1])&255;
    const p=pending.get(id);
    if(p){
      p.bridgeReadyAt=performance.now();
      const dt=p.txDoneAt?Math.max(0,Math.round(p.bridgeReadyAt-p.txDoneAt)):0;
      if(ecuMapIoUiBusy&&ecuMapIoKind==='write'){
        taskUi('loading','BLE ĐÃ RÁP ĐỦ FRAME'+(dt?' · '+dt+' ms':'')+' · ECU ĐANG XỬ LÝ...');
      }
    }
  }
  if(previousBlinkStatusHandler){
    try{previousBlinkStatusHandler(text)}catch(_e){}
  }
};

async function rawExchange(bytes,timeout=12000){
  if(otaPaused || (typeof window.blinkOtaTransferActive==='function' && window.blinkOtaTransferActive())){
    throw new Error('OTA ESP32 đang chạy');
  }
  if(!installRawListener())throw new Error('Chưa có BLE MAP characteristic');
  const ch=cmdChar();if(!ch)throw new Error('Chưa kết nối ECU Blink BLE');
  await acquireEcuTransaction(Math.max(4000,timeout+1500));
  const myEpoch=transportEpoch;
  try{
    const id=(sid=(sid%250)+1),data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),total=data.length;

    // This is the first truthful point at which the command owns the ECU
    // transport. UI may have acknowledged the tap earlier, but only now should
    // it say ĐANG ĐỌC / ĐANG GHI.
    markEcuMapTransportStarted(data[0],data);
    // Register the pending SID before TX so an extremely fast reply cannot be
    // missed, but DO NOT start the ECU-reply timeout yet. Large 0xCD writes are
    // split into many ATT write-with-response chunks; Android/WebView can spend
    // several seconds uploading those chunks before the ESP32 even has the full
    // frame. Counting that upload time as ECU response time caused false
    // "ECU timeout cmd 0xCD" while reads (single BLE chunk) worked normally.
    let pendingState=null;
    const exchangeStarted=performance.now();
    const response=new Promise((resolve,reject)=>{
      pendingState={resolve,reject,to:null,total:0,buf:null,got:0,seen:new Set(),epoch:myEpoch,txDoneAt:0,bridgeReadyAt:0};
      pending.set(id,pendingState);
    });
    try{
      const isWritePage=data[0]===0xCD&&total>RAW_CHUNK;
      const turboWrite=isWritePage&&rawWritePacingMode==='turbo'&&bridgeFirmwareAtLeast(1,5);
      const txStarted=performance.now();

      const sendPass=async(chunkSize,burstMode)=>{
        const chunks=Math.ceil(total/chunkSize);
        // iOS gets a barrier every 2 packets; Android/desktop every 3. With
        // 160B jumbo chunks a 425B half-map is only three writes total.
        const barrierEvery=isAppleMobileBleClient()?2:3;
        for(let off=0,k=0;off<total;off+=chunkSize,k++){
          if(myEpoch!==transportEpoch)throw new Error('BLE transport đã thay đổi');
          const cur=cmdChar();if(!cur)throw new Error('BLE đã ngắt');
          const n=Math.min(chunkSize,total-off),pkt=new Uint8Array(7+n);
          pkt[0]=RAW_TX;pkt[1]=id;pkt[2]=(off===0?1:0)|((off+n>=total)?2:0);
          pkt[3]=total&255;pkt[4]=(total>>8)&255;pkt[5]=off&255;pkt[6]=(off>>8)&255;
          pkt.set(data.subarray(off,off+n),7);

          const last=(k===chunks-1);
          const barrier=!burstMode||last||(((k+1)%barrierEvery)===0);
          await writeRawBleChunk(cur,pkt,barrier?'response':'no-response');
        }
      };

      let usedJumbo=false;
      const nativeAndroid=/BLINK-REDLEO-ANDROID\//i.test(String(navigator.userAgent||''));
      const nativeMtu=Number(window.__androidBleMtu||0);
      const jumboAllowed=!nativeAndroid||nativeMtu>=170;
      if(turboWrite&&rawJumboSessionCap!==false&&jumboAllowed){
        try{
          await sendPass(RAW_JUMBO_CHUNK,true);
          usedJumbo=true;
          rawJumboSessionCap=true;
        }catch(e){
          const msg=String(e&&e.message||e);
          if(!cmdChar()||!mapChar()||/disconnect|ngắt|mất kết nối/i.test(msg))throw e;
          // Browser/client did not accept the negotiated MTU size. Re-send the
          // whole offset-addressed frame with 13B burst chunks; already received
          // bytes are harmless duplicates and fill accounting remains exact.
          rawJumboSessionCap=false;
          log('JUMBO RAW fallback to 13B burst',msg);
          if(ecuMapIoUiBusy&&ecuMapIoKind==='write')updateActiveMapIoText('⚡ TURBO 13B · ĐANG GHI...');
          await sendPass(RAW_CHUNK,true);
        }
      }else if(turboWrite){
        if(nativeAndroid&&!jumboAllowed){
          log('ANDROID MTU chưa đủ jumbo',nativeMtu||23,'→ 13B reliable path');
        }
        await sendPass(RAW_CHUNK,true);
      }else{
        // Retry / legacy path: every packet is an ATT barrier.
        await sendPass(RAW_CHUNK,false);
      }

      // Final GATT barrier is complete. On FW1.5+, verify assembler completion
      // through RAWREADY before waiting for the ECU ACK. If a readable status
      // characteristic proves bytes are missing, fail immediately so the caller
      // retries via the conservative path instead of burning a 12s ECU timeout.
      if(turboWrite){
        await new Promise(r=>setTimeout(r,8));
        const ready=await confirmBridgeRawReady(id,pendingState);
        if(ready===false){
          if(usedJumbo)rawJumboSessionCap=false;
          throw new Error('BLE bridge chưa ráp đủ frame RAW · chuyển sang retry an toàn');
        }
      }

      const txDoneNow=performance.now();
      const txMs=Math.round(txDoneNow-txStarted);
      const p=pending.get(id);
      if(p){
        p.txDoneAt=txDoneNow;
        p.to=setTimeout(()=>{
          const q=pending.get(id);
          if(q!==p)return;
          pending.delete(id);
          const cmdHex=data[0].toString(16).toUpperCase();
          const hint=(data[0]===0xCD&&data.length>RAW_CHUNK)?' · bridge không trả RAW_RX sau frame '+data.length+'B':'';
          rejectPending(p,new Error('ECU timeout cmd 0x'+cmdHex+' sau khi TX xong'+hint));
        },timeout);
      }
      log('TX BLE complete',total+'B',txMs+'ms','cmd 0x'+data[0].toString(16).toUpperCase());
    }catch(e){
      const p=pending.get(id);
      if(p){if(p.to)clearTimeout(p.to);pending.delete(id);}
      throw e;
    }
    const rx=await response;
    if(myEpoch!==transportEpoch)throw new Error('BLE transport đã đổi trước khi nhận xong ECU');
    const doneAt=performance.now();
    lastExchangeMeta={
      sid:id,
      cmd:data[0],
      bytes:data.length,
      totalMs:Math.round(doneAt-exchangeStarted),
      txMs:pendingState&&pendingState.txDoneAt?Math.round(pendingState.txDoneAt-exchangeStarted):null,
      readyAfterTxMs:pendingState&&pendingState.bridgeReadyAt&&pendingState.txDoneAt?Math.round(pendingState.bridgeReadyAt-pendingState.txDoneAt):null,
      replyAfterTxMs:pendingState&&pendingState.txDoneAt?Math.round(doneAt-pendingState.txDoneAt):null,
      rxBytes:rx.length
    };
    log('TX',data.length,'0x'+data[0].toString(16),'RX',rx.length,'meta',lastExchangeMeta);
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
  const compDecode=compRowsForwardOnWire()?decodeRowsByteForward:decodeRowsByte;
  let q=compDecode(a,104,11,30,decPct);C.ectInj=q.data;
  q=compDecode(a,q.next,11,30,decEctIgn);C.ectIgn=q.data;
  q=compDecode(a,q.next,11,30,decMapInj);C.mapInj=q.data;
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

// Some ATE V11 direct 0x9A table replies use the same protected trailer shape
// as the page serializer: [complement-of-sum, sum, length-low-byte].
// Example: a 420-byte table becomes exactly 424 bytes:
//   1 page byte + 420 data + 3 trailer bytes.
// Keep this as a second STRICT validator; never accept an unchecked RX buffer.
function findValidLengthPageFrame(a,start,minData=0){
  if(!(a instanceof Uint8Array))a=new Uint8Array(a||[]);
  const minLen=1+Math.max(0,Number(minData)||0)+3;
  for(let i=0;i<a.length;i++){
    if(a[i]!==start)continue;
    for(let end=a.length-1;end>=i+minLen-1;end--){
      const n=end-i+1;
      if(a[end]!==((n)&255))continue;
      const sumIndex=end-1,compIndex=end-2;
      let sum=0;
      for(let p=i;p<compIndex;p++)sum=(sum+a[p])&255;
      if(a[sumIndex]!==sum)continue;
      if(((a[compIndex]+a[sumIndex])&255)!==255)continue;
      return a.slice(i,end+1);
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
  C.globalAuxRaw=f.slice(p,p+9);C.alternateRaw=C.globalAuxRaw.slice();C.alternateTable=[Array.from(C.alternateRaw,x=>Number(x))];p+=9;

  // V11 compensation blocks follow their ascending physical axes on wire.
  C.ectInjRaw=f.slice(p,p+330);let z=decodeRowsByteForward(f,p,11,30,decPct);C.ectInj=z.data;p=z.next;
  C.ectIgnRaw=f.slice(p,p+330);z=decodeRowsByteForward(f,p,11,30,decMainIgn);C.ectIgn=z.data;p=z.next;
  C.mapInjRaw=f.slice(p,p+330);z=decodeRowsByteForward(f,p,11,30,decMapInj);C.mapInj=z.data;p=z.next;

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
    B.afRaw=f.slice(p,p+420);
    {const A=decodeV11Afr420(B.afRaw);B.afr=A.matrix;B.afrEnabled=A.enabled;}
    p+=420;
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
  // V11 TPS/RPM axes are sourced from direct A2 only; compact Read All is reconciled in a separate pass.
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
  // Do not overwrite direct-A2 sensor/axis cache with the compact Read-All prefix.
  for(const b of C.banks){
    emitFeature(N.inj_degree,b.injDegree,b.bank);
    emitFeature(N.ign_degree,b.ignDegree,b.bank);
    emitFeature(N.ign_time,b.ignTime,b.bank);
    if(b.afr&&b.afrEnabled){
      setV11AfrMeta(b.bank,{matrix:b.afr,enabled:b.afrEnabled,raw:b.afRaw});
      emitFeature(N.afr_map,b.afr,b.bank);
    }
  }
  emitFeature(N.ect_inj,C.ectInj);
  emitFeature(N.ect_ign,C.ectIgn);
  emitFeature(N.map_inj,C.mapInj);
  emitFeature(N.iat_inj,[C.iatInj]);
  emitFeature(N.map_idle_motor,[C.mapMotor]);
  // Read-All 9958 has a different compact partition after configRaw.
  // Do not populate direct-A2 External/CHG UI from those bytes.
  if(C.autoClutch)emitFeature(N.auto_clutch,C.autoClutch);
  if(C.alternateTable)emitFeature(N.alternate_table,C.alternateTable);
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
    if(st)st.textContent='ATE V11 · IDLE MAP '+bank+' · READ ALL RAW SNAPSHOT '+((b.idleRaw?.length||0)+(b.auxRaw?.length||0)+(b.ectMotorRaw?.length||0))+'B · dùng Page 6 trực tiếp để chỉnh/verify';
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
    // Verify only the 420 map-cell bytes consumed above. Some REDLEO V8
    // replies carry an extra protocol byte before checksum/tail.
    return {frame:f,matrix:out,page:pg,rawPayload:f.slice(1,1+420)};
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
  // Verify exactly the 420 x uint16 map cells consumed above (840 bytes).
  // REDLEO 9.1 can return one additional protocol byte before checksum/tail;
  // it is not part of the fuel table and must not enter byte-for-byte verify.
  return {frame:f,matrix:out,page:pg,rawPayload:f.slice(1,1+840)};
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
  if(data.length<151)throw new Error('ATE V11 page A2 thiếu dữ liệu · '+data.length+'B');
  const D=requireV11A2Layout(data),L=D.L;
  const {tpsRaw,tpsPct,rpmRaw,rpmAxis}=D.A;
  const vAfrRaw=data.slice(L.VAFR,L.VAFR+11);
  const vEct=Array.from(data.slice(L.VECT,L.VECT+11),decVolt);
  const vIat=Array.from(data.slice(L.VIAT,L.VIAT+11),decVolt);
  const vMap=Array.from(data.slice(L.VMAP,L.VMAP+11),decVolt);
  const iatInj=Array.from(data.slice(L.IAT_INJ,L.IAT_INJ+11),x=>r2(Number(x)/20));
  const mapMotor=Array.from(data.slice(L.MAP_MOTOR,L.MAP_MOTOR+11),x=>Number(x));
  const configRaw=data.slice(L.CONFIG,L.CONFIG+11);
  const autoClutch=decodeV11AutoClutch(configRaw);
  const C={
    tpsRaw,tpsPct,rpmRaw,rpmAxis,vAfrRaw,vEct,vIat,vMap,iatInj,mapMotor,configRaw,autoClutch,
    v11PrefixLength:L.OPTION,v11A2Layout:L.NAME,v11A2LayoutDef:L,
    v11AxesValid:!!D.axesValid,v11A2LayoutMatch:D.match||'axes',raw:data.slice()
  };
  if(Number.isFinite(L.TPS_VOLT)){
    const vr=data.slice(L.TPS_VOLT,L.TPS_VOLT+14);
    C.tpsVoltRaw=vr;C.tpsVolt=Array.from(vr,decVolt);
  }
  if(data.length>=L.LEN){
    C.optionRawV11=data.slice(L.OPTION,L.OPTION+30);
    C.ateOptions=decodeV11Options20(C.optionRawV11,C.vEct);
    C.ectStartRaw=data.slice(L.ECT_START,L.ECT_START+44);
    C.ectStart=decodeV11EctStart44(C.ectStartRaw);
    C.globalAuxRaw=data.slice(L.GLOBAL_AUX,L.GLOBAL_AUX+9);
    C.alternateRaw=C.globalAuxRaw.slice();
    C.alternateTable=[Array.from(C.alternateRaw,x=>Number(x))];
    C.externalRaw=data.slice(L.EXTERNAL,L.EXTERNAL+30);
    C.external=[Array(15).fill(0),Array(15).fill(0)];
    for(let c=0;c<15;c++)C.external[1][c]=decV11ExtIgn(C.externalRaw[c]);
    for(let c=0;c<15;c++)C.external[0][c]=decV11ExtPct(C.externalRaw[15+c]);
    C.chgRaw=data.slice(L.CHG,L.CHG+8);
    C.chg=decodeV11Chg8(C.chgRaw);
    C.v11A2KnownLength=L.LEN;
  }
  return C;
}
function parseModernA2Prefix(data){
  if(!(data instanceof Uint8Array))data=new Uint8Array(data);
  // V10 / Ultra original parser: 14 one-byte TPS breakpoints (raw/2),
  // followed by 30 uint16-BE RPM breakpoints (raw*20), then six 11-byte blocks.
  // Stop at 140B here: layouts after MapMotor vary between V10-family builds.
  if(data.length<140)throw new Error('REDLEO V10/ULTRA A2 thiếu dữ liệu · '+data.length+'B / cần tối thiểu 140B');
  let p=0;
  const tpsRaw=data.slice(p,p+14);p+=14;
  const tpsPct=Array.from(tpsRaw,x=>Number(x)/2);
  const rpmRaw=data.slice(p,p+60);p+=60;
  const rpmAxis=[];for(let i=0;i<60;i+=2)rpmAxis.push(u16be(rpmRaw,i)*20);
  const vAfrRaw=data.slice(p,p+11);p+=11;
  const vEct=Array.from(data.slice(p,p+11),decVolt);p+=11;
  const vIat=Array.from(data.slice(p,p+11),decVolt);p+=11;
  const vMap=Array.from(data.slice(p,p+11),decVolt);p+=11;
  const iatInjRaw=data.slice(p,p+11);p+=11;
  const iatInj=Array.from(iatInjRaw,decOil);
  const mapMotorRaw=data.slice(p,p+11);p+=11;
  const mapMotor=Array.from(mapMotorRaw,x=>Number(x));
  return {tpsRaw,tpsPct,rpmRaw,rpmAxis,vAfrRaw,vEct,vIat,vMap,iatInjRaw,iatInj,mapMotorRaw,mapMotor,modernPrefixLength:p,raw:data.slice()};
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
async function exchangePage9A(pg,label='PAGE',attempts=3,settleMs=260,replyTimeout=10000,showUi=true,validateRx=null){
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
        if(typeof validateRx==='function'){
          const ok=validateRx(rx);
          if(ok===false)throw new Error(label+' · RX chưa đạt kiểm tra frame');
        }
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
      scheduleLiveResume(380);
    }
  }
}

function selectDirectPageFrame(rx,pg,minData=0){
  pg&=255;
  let f=findValidCommandFrame(rx,pg,minData+3);
  let trailer=2,frameFormat='reply-checksum';
  if(!f&&isV11Profile()){
    f=findValidLengthPageFrame(rx,pg,minData);
    if(f){trailer=3;frameFormat='page-length';}
  }
  if(!f)return null;
  const dataLen=f.length-1-trailer;
  if(dataLen<minData)return null;
  return {f,trailer,frameFormat,dataLen};
}
function directPageFrameError(rx,pg,label,minData){
  const head=Array.from(rx.slice(0,8),x=>x.toString(16).padStart(2,'0').toUpperCase()).join(' ');
  const tail=Array.from(rx.slice(Math.max(0,rx.length-8)),x=>x.toString(16).padStart(2,'0').toUpperCase()).join(' ');
  return new Error(label+' · page 0x'+(pg&255).toString(16).toUpperCase()+' frame chưa hợp lệ · RX '+rx.length+'B · cần data ≥'+minData+'B · head '+head+' · tail '+tail);
}
async function readDirectPageReal(pg,minData=0,label='PAGE',showUi=true){
  requireProfile('pageRead','Đọc page 0x9A');
  pg&=255;
  if(showUi)taskUi('loading','ĐANG ĐỌC '+label+' · PAGE 0x'+pg.toString(16).toUpperCase());
  const validate=rx=>{
    const s=selectDirectPageFrame(rx,pg,minData);
    if(!s)throw directPageFrameError(rx,pg,label,minData);
    return true;
  };
  const rx=await exchangePage9A(pg,label,3,300,12000,showUi,validate);
  const selected=selectDirectPageFrame(rx,pg,minData);
  if(!selected)throw directPageFrameError(rx,pg,label,minData);
  const {f,trailer,frameFormat}=selected;
  const data=f.slice(1,-trailer);
  if(data.length<minData)throw new Error(label+' · page 0x'+pg.toString(16).toUpperCase()+' thiếu dữ liệu '+data.length+'B / '+minData+'B');
  pageCache.set(pg,data.slice());
  log('READ DIRECT page 0x'+pg.toString(16).toUpperCase(),'RX',rx.length,'frame',f.length,'data',data.length,'format',frameFormat);
  try{applyProfileUi();}catch(_e){}
  return {page:pg,frame:f,data,rxLength:rx.length,frameFormat};
}
async function readA2SensorPageReal(showUi=true){
  requireProfile('optionsRead','Đọc Options/Voltage');
  if(ecuProfile&&ecuProfile.family==='v8')throw new Error('REDLEO V8: page Options/Voltage dùng layout riêng, chưa mở ở profile MAIN TUNE.');
  const v11=isV11Profile();
  const v10=!!(ecuProfile&&ecuProfile.key==='MODERN_V10');
  const minData=v11?V11_A2.LEN:(v10?140:133);
  const label=v11?'ATE V11 · A2 / OPTIONS':(v10?'REDLEO V10/ULTRA · A2 / AXIS':'CẢM BIẾN / OPTIONS');
  const R=await readDirectPageReal(0xA2,minData,label,showUi);
  const C=v11?parseV11A2Data(R.data):(v10?parseModernA2Prefix(R.data):parseA2Data(R.data));
  sensorCalCache=C;
  sensorCalIdentity=handshakeInfo?[
    ecuProfile?.key||'UNKNOWN',handshakeInfo.ident||'',handshakeInfo.firmware||'',handshakeInfo.ecuId||1
  ].join('|'):null;

  const a2AxesOk=Array.isArray(C.tpsPct)&&Array.isArray(C.rpmAxis)&&validDynamicAxes(C.tpsPct,C.rpmAxis);
  if(a2AxesOk){
    publishEcuAxes(C.tpsPct,C.rpmAxis,v11?'A2 ECU · V11':'A2 ECU · V10/ULTRA');
  }else if(v11&&C.v11A2Layout){
    // A valid V11 direct A2 page may come from a build whose breakpoint bytes
    // are fixed/differently encoded. Keep all verified A2 sensor/options data
    // and use Blink's proven 14x30 standard axes instead of blocking the ECU.
    publishProfileAxisFallback('ATE V11 · '+C.v11A2Layout+' · AXIS FALLBACK');
    log('ATE V11 A2 axis fallback',C.v11A2Layout,'len',R.data.length);
  }else if(ecuProfile&&ecuProfile.key==='MODERN_V9'){
    publishProfileAxisFallback('ECU V9 · AXIS CỐ ĐỊNH');
  }

  // TPS sensor voltage calibration is not the same thing as TPS map breakpoints.
  // V11 voltage Min/Max lives in ATE Options; never reinterpret TPS breakpoint bytes as volts.
  if(typeof state!=='undefined'&&C.options){
    if(Number.isFinite(C.options.tpsMinEcu))state.cal.tpsMin=C.options.tpsMinEcu;
    if(Number.isFinite(C.options.tpsMaxEcu))state.cal.tpsMax=C.options.tpsMaxEcu;
    try{syncControls();}catch(_e){}
  }else if(typeof state!=='undefined'&&v11&&C.ateOptions&&C.ateOptions[0]){
    const lo=Number(C.ateOptions[0][0]),hi=Number(C.ateOptions[0][1]);
    if(Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo+.1){
      state.cal.tpsMin=lo;state.cal.tpsMax=hi;
      try{syncControls();saveSoon();}catch(_e){}
    }
  }

  if(showUi){
    if(!v11&&!v10){try{syncOptions(C);}catch(_e){}}
    try{
      emitFeature(N.iat_inj,[C.iatInj]);
      emitFeature(N.map_idle_motor,[C.mapMotor]);
      if(C.external)emitFeature(N.external_adjust,C.external);
      if(v11&&C.autoClutch)emitFeature(N.auto_clutch,C.autoClutch);
      if(v11&&C.chg)emitFeature(N.chg_params,C.chg);
      if(v11&&C.ateOptions)emitFeature(N.ate_options,C.ateOptions);
      if(v11&&C.ectStart)emitFeature(N.ect_start,C.ectStart);
      if(v11&&C.alternateTable)emitFeature(N.alternate_table,C.alternateTable);
      if(!v11&&C.auto)emitFeature(N.auto_clutch,[C.auto]);
      emitFeature(N.v_ect,[C.vEct]);
      emitFeature(N.v_iat,[C.vIat]);
      emitFeature(N.v_map,[C.vMap]);
    }catch(_e){}
    taskUi('success',v11?('ATE V11 · '+(C.v11A2Layout||'A2')+' · '+(a2AxesOk?'AXIS ECU':'AXIS FALLBACK')+' + SENSOR · OK'):(v10?'V10/ULTRA · AXIS + SENSOR · OK':'CẢM BIẾN / OPTIONS · OK'));
  }
  return {...R,cache:C};
}
async function ensureEcuAxesReal(showUi=false){
  if(!handshakeInfo)throw new Error('Chưa nhận diện ECU để lấy trục TPS/RPM.');
  if(ecuProfile&&((ecuProfile.family==='v8')||ecuProfile.key==='MODERN_V9')){
    return publishProfileAxisFallback((ecuProfile.key==='MODERN_V9'?'V9':'V8')+' · AXIS CỐ ĐỊNH');
  }
  if(ecuProfile&&(ecuProfile.key==='MODERN_V10'||ecuProfile.key==='MODERN_V11')){
    if(sensorCalCache&&validDynamicAxes(sensorCalCache.tpsPct,sensorCalCache.rpmAxis)){
      return publishEcuAxes(sensorCalCache.tpsPct,sensorCalCache.rpmAxis,'CACHE A2 ECU · '+ecuProfile.short);
    }
    if(ecuProfile.key==='MODERN_V11'&&sensorCalCache&&sensorCalCache.v11A2Layout){
      return publishProfileAxisFallback('CACHE '+sensorCalCache.v11A2Layout+' · AXIS FALLBACK');
    }
    // V11 Read All 9958 has its own compact layout and is reconciled separately.
    // Direct page A2 is authoritative for V10/Ultra/V11 sensor/options layout.
    // Dynamic axes are preferred, but an exact verified V11 A2 wire length may
    // safely fall back to the standard 14x30 axes without blocking map access.
    const R=await readA2SensorPageReal(showUi);
    const C=R&&R.cache;
    if(C&&validDynamicAxes(C.tpsPct,C.rpmAxis))return window.blinkEcuAxes;
    if(ecuProfile.key==='MODERN_V11'&&C&&C.v11A2Layout){
      return publishProfileAxisFallback('A2 '+C.v11A2Layout+' · AXIS FALLBACK');
    }
    throw new Error(ecuProfile.label+' · không đọc được trục TPS/RPM hợp lệ từ A2.');
  }
  return publishProfileAxisFallback('SAFE FALLBACK');
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
  if(ecuProfile&&(ecuProfile.key==='MODERN_V10'||ecuProfile.key==='MODERN_V11')&&['inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj'].includes(id)){
    await ensureEcuAxesReal(false);
  }
  if(ecuProfile&&ecuProfile.family==='v8'&&!['inj_degree','ign_degree','ign_time'].includes(id)){
    throw new Error(ecuProfile.label+': hiện chỉ mở phần chính (Thời gian phun / Góc phun / Góc lửa / Ignition Time). Bảng '+id+' vẫn khóa chờ layout riêng.');
  }
  if(ecuProfile&&ecuProfile.family==='v11'&&!['idle_limit','ect_idle_motor','auto_shift','afr_map','auto_clutch','chg_params','ate_options','ect_start','alternate_table','inj_degree','ign_degree','ign_time','ect_inj','ect_ign','map_inj','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map'].includes(id)){
    throw new Error(ecuProfile.label+': bảng '+id+' vẫn khóa chờ layout V11 được xác nhận.');
  }
  if(id==='idle_limit')return readIdlePageReal(bank,showUi);
  if(id==='afr_map'){
    const pg=page(5,bank);
    const R=await readDirectPageReal(pg,420,'ATE V11 · AFR / O2 TARGET · MAP NO.'+bank,showUi);
    const A=decodeV11Afr420(R.data.slice(0,420));
    setV11AfrMeta(bank,A);
    emitFeature(N.afr_map,A.matrix,bank);
    if(showUi)taskUi('success','ATE V11 · AFR MAP NO.'+bank+' · 420B OK');
    return {...R,matrix:A.matrix,enabled:A.enabled,rawPayload:R.data.slice(0,420)};
  }

  let pg=0,rows=0,cols=0,dec=x=>x,n=0,label=id;
  switch(id){
    case 'inj_degree':pg=page(2,bank);rows=14;cols=30;dec=decMainInjAngle;n=N.inj_degree;label='GÓC PHUN';break;
    case 'ign_degree':pg=page(3,bank);rows=14;cols=30;dec=decMainIgn;n=N.ign_degree;label='GÓC ĐÁNH LỬA';break;
    case 'ign_time':pg=page(4,bank);rows=1;cols=30;dec=decMainDwell;n=N.ign_time;label='DWELL BOBIN';break;
    case 'ect_idle_motor':case 'auto_shift':return readIdlePageReal(bank,showUi);
    case 'ect_inj':pg=0x72;rows=11;cols=30;dec=decPct;n=N.ect_inj;label='BÙ PHUN ECT';break;
    case 'ect_ign':pg=0x82;rows=11;cols=30;dec=isV11Profile()?decMainIgn:decEctIgn;n=N.ect_ign;label='BÙ ĐÁNH LỬA ECT';break;
    case 'map_inj':pg=0x92;rows=11;cols=30;dec=decMapInj;n=N.map_inj;label='BÙ PHUN MAP';break;
    case 'iat_inj':case 'map_idle_motor':case 'external_adjust':case 'auto_clutch':case 'chg_params':case 'ate_options':case 'ect_start':case 'alternate_table':
    case 'v_ect':case 'v_iat':case 'v_map':
      return readA2SensorPageReal(showUi);
    case 'spare':throw new Error('Spare không dùng trên firmware 9.1X');
    default:throw new Error('Chưa có page đọc riêng cho '+id);
  }

  const R=await readDirectPageReal(pg,rows*cols,label+(rows>1&&pg<0x70?' · MAP NO.'+bank:''),showUi);
  const forwardComp=['ect_inj','ect_ign','map_inj'].includes(id)&&compRowsForwardOnWire();
  const z=forwardComp
    ?decodeRowsByteForward(R.data,0,rows,cols,dec)
    :decodeRowsByte(R.data,0,rows,cols,dec);
  emitFeature(n,z.data,pg<0x70?bank:0);
  if(showUi)taskUi('success',label+(pg<0x70?' · MAP NO.'+bank:'')+' · OK');
  return {...R,matrix:z.data};
}
async function readCurrentFuelBank(bank=((typeof state!=='undefined'&&state.activeMap)||1),showUi=true){
  requireProfile('fuelRead','Đọc MAP thời gian phun');
  await ensureEcuAxesReal(false);
  bank=normalizeBankForProfile(bank);
  if(showUi)taskUi('loading','ĐANG ĐỌC HIỆN TẠI · MAP NO.'+bank);
  const pg=page(1,bank);
  const first=!fuelPagePrimed.has(bank);
  const isV8=ecuProfile&&ecuProfile.family==='v8';

  // First INJ VE read after a fresh BLE session is measurably slower on this ECU.
  // Give the ECU enough quiet/compute time and keep the browser timeout longer
  // than the bridge UART timeout. Once one read succeeds, return to normal timing.
  const fuelValidate=rx=>{parseCurrentFuelFrame(rx,bank);return true;};
  const rx=await exchangePage9A(
    pg,
    'MAP NO.'+bank,
    first ? (isV8?3:4) : 3,
    first ? (isV8?450:900) : 320,
    18000,
    showUi,
    fuelValidate
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
    // Self-heal a missed PONG notification before blocking a safe multi-chunk write.
    if(typeof window.ensureBlinkBridgeFirmwareStatus==='function'){
      try{await window.ensureBlinkBridgeFirmwareStatus(3)}catch(_e){}
    }
    if(!bridgeRawWriteSafe()){
      throw new Error('ESP32 bridge chưa xác nhận FW1.1+ an toàn cho RAW multi-chunk. Đã thử PING lại nhưng chưa nhận được PONG FW...; hãy ngắt/kết nối BLE rồi thử lại.');
    }
  }
  let lastErr=null;
  // Old V11 builds forced at least 3 attempts because the BLE bridge could
  // lose long 0xCD frames. FW1.6 has MTU burst reassembly, RAWREADY and
  // duplicate-SID protection, so ATE no longer needs that permanent slow path.
  // On FW1.6+ use the exact same retry policy as REDLEO 9.x; keep the old
  // conservative V11 allowance only for older bridge firmware.
  const modernReliableBridge=bridgeFirmwareAtLeast(1,6);
  const maxRetries=(isV11Profile()&&!modernReliableBridge)?Math.max(retries,2):retries;
  const totalAttempts=maxRetries+1;
  const phase=(typeof state!=='undefined'&&state.ecuPhase==='write1')?'PHẦN 1/2':
              (typeof state!=='undefined'&&state.ecuPhase==='write2')?'PHẦN 2/2':
              ('PAGE 0x'+pg.toString(16).toUpperCase());
  for(let attempt=0;attempt<=maxRetries;attempt++){
    const tryNo=attempt+1;
    const attemptStarted=performance.now();
    try{
      if(ecuMapIoUiBusy&&ecuMapIoKind==='write'){
        updateActiveMapIoText('⟳ ĐANG GHI · '+phase+' · LẦN '+tryNo+'/'+totalAttempts);
      }
      const turboFirst=(attempt===0&&bridgeFirmwareAtLeast(1,5));
      rawWritePacingMode=turboFirst?'turbo':'safe';
      taskUi('loading','ĐANG GHI · '+phase+' · LẦN '+tryNo+'/'+totalAttempts+(turboFirst?' · TURBO':''));
      if(ecuMapIoUiBusy&&ecuMapIoKind==='write'&&turboFirst){
        updateActiveMapIoText('⚡ TURBO · '+phase);
      }
      let rx;
      try{
        rx=await rawExchange(tx,12000);
      }finally{
        rawWritePacingMode='safe';
      }
      const elapsed=Math.round(performance.now()-attemptStarted);
      if(hasWriteAck(rx,pg)){
        const meta=lastExchangeMeta;
        const detail=meta&&Number.isFinite(meta.replyAfterTxMs)?(' · ACK '+meta.replyAfterTxMs+' ms sau TX'):(' · '+elapsed+' ms');
        const txDetail=meta&&Number.isFinite(meta.txMs)?(' · BLE '+meta.txMs+' ms'):'';
        taskUi('loading','ECU ACK · '+phase+' · LẦN '+tryNo+'/'+totalAttempts+txDetail+detail);
        log('write ACK page 0x'+pg.toString(16).toUpperCase(),'attempt',tryNo+'/'+totalAttempts,'elapsed',elapsed,'meta',meta);
        return true;
      }
      throw new Error('ECU không ACK CD '+pg.toString(16).toUpperCase()+' · RX '+rx.length+'B');
    }catch(e){
      const elapsed=Math.round(performance.now()-attemptStarted);
      lastErr=e;
      const msg=String(e&&e.message||e);
      log('write attempt failed page 0x'+pg.toString(16).toUpperCase(),'attempt',tryNo+'/'+totalAttempts,'elapsed',elapsed,msg,lastExchangeMeta);

      // A retry only makes sense while the same BLE transport is still alive.
      // If MAP/CMD characteristic vanished, stop immediately. Retrying after a
      // disconnect only produces misleading "LẦN 2/2" UI and can never reach ECU.
      const transportLost=!cmdChar()||!mapChar()||
        /BLE.*(?:ngắt|mất|disconnect|characteristic|kết nối)|Chưa có BLE MAP characteristic|Chưa kết nối ECU Blink BLE/i.test(msg);
      if(transportLost){
        if(ecuMapIoUiBusy&&ecuMapIoKind==='write')updateActiveMapIoText('✕ MẤT KẾT NỐI BLE');
        taskUi('error','BLE ESP32 ĐÃ NGẮT TRONG LÚC GHI',6500);
        throw new Error('BLE ESP32 đã ngắt trong lúc ghi · dừng retry để tránh trạng thái giả. Kết nối lại ECU Blink rồi đọc/ghi lại.');
      }

      if(attempt>=maxRetries)break;
      if(ecuMapIoUiBusy&&ecuMapIoKind==='write'){
        updateActiveMapIoText('↻ MẤT ACK · THỬ LẠI '+(tryNo+1)+'/'+totalAttempts);
      }
      taskUi('loading','MẤT ACK · '+phase+' · LẦN '+tryNo+'/'+totalAttempts+' · '+elapsed+' ms · THỬ LẠI...');
      // FW1.6 guarantees the previous BLE frame is complete and protects
      // duplicate SIDs. A short settle is enough before a retry; older bridges
      // retain the longer V11 recovery gap.
      const retryGap=modernReliableBridge?(90+attempt*60):(420+attempt*220);
      await new Promise(r=>setTimeout(r,retryGap));
    }
  }
  throw lastErr||new Error('Ghi page 0x'+pg.toString(16).toUpperCase()+' thất bại');
}
function cloneAckCacheValue(v){
  if(v instanceof Uint8Array)return v.slice();
  if(Array.isArray(v))return v.map(cloneAckCacheValue);
  return v;
}
function cacheAckedPage(pg,payload){
  pg&=255;
  const u=payload instanceof Uint8Array?payload.slice():Uint8Array.from(payload||[]);
  pageCache.set(pg,u);

  // Read-back is intentionally disabled after normal MAP writes. Keep the
  // local baseline synchronized with the ACKed payload so a later partial write
  // preserves the bytes changed by this write instead of restoring stale cache.
  if(pg===0xA2){
    try{
      const C=isV11Profile()?parseV11A2Data(u):
        (ecuProfile&&ecuProfile.key==='MODERN_V10'?parseModernA2Prefix(u):parseA2Data(u));
      sensorCalCache=C;
      sensorCalIdentity=handshakeInfo?[
        ecuProfile?.key||'UNKNOWN',handshakeInfo.ident||'',handshakeInfo.firmware||'',handshakeInfo.ecuId||1
      ].join('|'):sensorCalIdentity;

      if(readCache){
        const keys=[
          'tpsRaw','tpsPct','rpmRaw','rpmAxis','vAfrRaw','vEct','vIat','vMap',
          'iatInj','iatInjRaw','mapMotor','mapMotorRaw','bitfield','autoStart','auto',
          'password','optionRaw','optionRawV11','ateOptions','configRaw','autoClutch',
          'ectStartRaw','ectStart','globalAuxRaw','alternateRaw','alternateTable',
          'externalRaw','external','chgRaw','chg'
        ];
        for(const k of keys)if(C[k]!==undefined)readCache[k]=cloneAckCacheValue(C[k]);
      }
    }catch(e){log('local A2 ACK cache update skipped',String(e&&e.message||e));}
  }
  return u;
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
  cacheAckedPage(pg,payload);
  notice('success','GHI AUTOSHIFT ATE V11 OK','MAP No.'+bank+' · ECU ACK · 9B AutoShift đã ghi · 34B Idle/ECT Motor giữ nguyên · '+v11AutoShiftConfigText(shift[0])+'.');
  return {ack:true,page:pg,payload:new Uint8Array(payload)};
}

async function writeV11AfrMap(bank){
  if(!isV11Profile())throw new Error('AFR writer chỉ dùng cho ATE V11.');
  bank=normalizeBankForProfile(bank);
  const pg=page(5,bank),cached=pageCache.get(pg);
  if(!cached||cached.length<420)throw new Error('Hãy ĐỌC AFR MAP No.'+bank+' thành công trước khi GHI.');
  const meta=window.blinkV11AfrMeta&&window.blinkV11AfrMeta[bank];
  if(!meta)throw new Error('Thiếu trạng thái AFR ON/OFF của MAP No.'+bank+'. Hãy ĐỌC lại bảng.');
  const m=matrixFromRedTable(14,30);
  const afrRaw=encodeV11AfrChanged(m,meta,cached.slice(0,420));
  const payload=new Uint8Array(cached);
  payload.set(afrRaw,0);
  taskUi('loading','ATE V11 · GHI AFR MAP NO.'+bank+' · PAGE 0x'+pg.toString(16).toUpperCase());
  await writePageChecked(pg,payload,false,1,'mainWrite');
  cacheAckedPage(pg,payload);
  notice('success','GHI AFR ATE V11 OK','MAP No.'+bank+' · ECU ACK · 420 ô + ON/OFF đã gửi.');
  return {ack:true,page:pg,payload:new Uint8Array(payload)};
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
  cacheAckedPage(pg,payload);
  notice('success','GHI ECT MOTOR ATE V11 OK','MAP No.'+bank+' · ECU ACK · 22B ECT Motor đã ghi · 21B Idle/AutoShift giữ nguyên · '+mode.label+'.');
  return {ack:true,page:pg,payload:new Uint8Array(payload)};
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
  cacheAckedPage(pg,payload);
  notice('success','GHI IDLE ATE V11 OK','MAP No.'+bank+' · ECU ACK · 12B Idle đã ghi · 31B AutoShift/ECT Motor giữ nguyên.');
  return {ack:true,page:pg,payload:new Uint8Array(payload)};
}

async function writeV11EctStart(){
  if(!isV11Profile())throw new Error('ECT Start writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<272)throw new Error('Hãy ĐỌC ECT Start thành công trước khi GHI page A2.');
  const L=v11A2LayoutOf(cached);
  const m=matrixFromRedTable(4,11);
  const raw44=encodeV11EctStart44(m);
  const payload=new Uint8Array(cached);
  payload.set(raw44,L.ECT_START);
  taskUi('loading','ATE V11 · GHI ECT START 44B · GIỮ NGUYÊN A2 CÒN LẠI');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  cacheAckedPage(0xA2,payload);
  notice('success','GHI ECT START ATE V11 OK','ECU ACK · 44 byte · '+L.NAME+'.');
  return {ack:true,page:0xA2,payload:new Uint8Array(payload)};
}

async function writeV11AlternateTable(){
  if(!isV11Profile())throw new Error('Alternate Table writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<272)throw new Error('Hãy ĐỌC Alternate Table thành công trước khi GHI page A2.');
  const L=v11A2LayoutOf(cached);
  const m=matrixFromRedTable(1,9),vals=m[0]||[];
  if(vals.length!==9||vals.some(v=>!Number.isFinite(Number(v))))throw new Error('Alternate Table V11 chưa có đủ 9 giá trị hợp lệ.');
  let bad=-1;
  for(let i=0;i<9;i++)if(Number(vals[i])<0||Number(vals[i])>255){bad=i;break;}
  if(bad>=0)throw new Error('Alternate Table chỉ chấp nhận raw 0–255 · cột '+(bad+1)+' = '+vals[bad]);
  const raw=Uint8Array.from(vals,v=>clamp(Math.round(Number(v)),0,255));
  const payload=new Uint8Array(cached);
  payload.set(raw,L.GLOBAL_AUX);
  taskUi('loading','ATE V11 · GHI ALTERNATE TABLE 9B · GIỮ NGUYÊN BYTE A2 KHÁC');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  cacheAckedPage(0xA2,payload);
  notice('success','GHI ALTERNATE TABLE V11 OK','ECU ACK · 9 byte raw · '+L.NAME+'.');
  return {ack:true,page:0xA2,payload:new Uint8Array(payload)};
}

async function writeV11Options20(){
  if(!isV11Profile())throw new Error('ATE Options writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<272)throw new Error('Hãy ĐỌC ATE Options thành công trước khi GHI page A2.');
  const L=v11A2LayoutOf(cached);
  const C=parseV11A2Data(cached);
  const m=matrixFromRedTable(1,20);
  const raw20=encV11Options20(m,C.vEct);
  const expected30=new Uint8Array(C.optionRawV11);
  expected30.set(raw20,0);
  const payload=new Uint8Array(cached);
  payload.set(expected30,L.OPTION);
  taskUi('loading','ATE V11 · GHI OPTIONS 20 MỤC · GIỮ NGUYÊN AFR/O2 + RESERVED');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  cacheAckedPage(0xA2,payload);
  notice('success','GHI ATE OPTIONS V11 OK','ECU ACK · 20 byte Option đã chỉnh · AFR/O2 + reserved giữ nguyên.');
  return {ack:true,page:0xA2,payload:new Uint8Array(payload)};
}

async function writeV11Chg(){
  if(!isV11Profile())throw new Error('CHG writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<272)throw new Error('Hãy ĐỌC Charger Parameters thành công trước khi GHI page A2.');
  const L=v11A2LayoutOf(cached);
  const m=matrixFromRedTable(1,8);
  const raw=encV11Chg8(m);
  const payload=new Uint8Array(cached);
  payload.set(raw,L.CHG);
  taskUi('loading','ATE V11 · GHI CHARGER PARAMETERS · GIỮ NGUYÊN BYTE A2 KHÁC');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  cacheAckedPage(0xA2,payload);
  notice('success','GHI CHG ATE V11 OK','ECU ACK · 8 byte Charger Parameters · '+L.NAME+'.');
  return {ack:true,page:0xA2,payload:new Uint8Array(payload)};
}

async function writeV11AutoClutch(){
  if(!isV11Profile())throw new Error('Automatic Clutch writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<272)throw new Error('Hãy ĐỌC Automatic Clutch thành công trước khi GHI page A2.');
  const L=v11A2LayoutOf(cached);
  const m=matrixFromRedTable(1,6),vals=m[0]||[];
  if(vals.length!==6||vals.some(v=>!Number.isFinite(Number(v))))throw new Error('Automatic Clutch V11 chưa có đủ 6 giá trị hợp lệ.');
  const config=new Uint8Array(cached.slice(L.CONFIG,L.CONFIG+11));
  const expected=new Uint8Array(config);
  for(let i=0;i<6;i++)expected[1+i]=encV11Dzfm(i,vals[i]);
  const payload=new Uint8Array(cached);
  payload.set(expected,L.CONFIG);
  taskUi('loading','ATE V11 · GHI AUTOMATIC CLUTCH · GIỮ NGUYÊN ENABLE + PIN');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  cacheAckedPage(0xA2,payload);
  notice('success','GHI AUTOMATIC CLUTCH ATE V11 OK','ECU ACK · 6 byte Dgv_Dzfm đã ghi · enable + password cũ giữ nguyên.');
  return {ack:true,page:0xA2,payload:new Uint8Array(payload)};
}

async function writeV11ExternalAdjust(){
  if(!isV11Profile())throw new Error('External Adjustment writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<272)throw new Error('Hãy ĐỌC External Adjustment thành công trước khi GHI page A2.');
  const L=v11A2LayoutOf(cached);
  const m=matrixFromRedTable(2,15);
  if(m.length!==2||m.some(r=>!Array.isArray(r)||r.length!==15||r.some(v=>!Number.isFinite(Number(v)))))throw new Error('External Adjustment chưa có đủ dữ liệu 2 × 15.');
  const payload=Array.from(cached);
  for(let c=0;c<15;c++)payload[L.EXTERNAL+c]=encV11ExtIgn(m[1][c]);
  for(let c=0;c<15;c++)payload[L.EXTERNAL+15+c]=encV11ExtPct(m[0][c]);
  taskUi('loading','ATE V11 · GHI EXTERNAL ADJUSTMENT · GIỮ NGUYÊN BYTE A2 KHÁC');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  cacheAckedPage(0xA2,payload);
  notice('success','GHI EXTERNAL ADJUSTMENT ATE V11 OK','ECU ACK · '+L.NAME+' · 30 byte · byte A2 khác giữ nguyên.');
  return {ack:true,page:0xA2,payload:Uint8Array.from(payload)};
}

function v11A2PatchSpec(id,L=V11_A2){
  switch(id){
    case 'v_ect':return {off:L.VECT,enc:encVolt,label:'ECT VOLTAGE'};
    case 'v_iat':return {off:L.VIAT,enc:encVolt,label:'IAT VOLTAGE'};
    case 'v_map':return {off:L.VMAP,enc:encVolt,label:'MAP VOLTAGE'};
    case 'iat_inj':return {off:L.IAT_INJ,enc:v=>clamp(Math.round(Math.max(0,Number(v))*20),0,255),label:'IAT COMP INJ'};
    case 'map_idle_motor':return {off:L.MAP_MOTOR,enc:v=>clamp(Math.round(Number(v)),0,255),label:'MAP IDLE MOTOR'};
    default:return null;
  }
}
async function writeV11A2KnownFeature(id){
  if(!isV11Profile())throw new Error('A2 partial writer chỉ dùng cho ATE V11.');
  const cached=pageCache.get(0xA2);
  if(!cached||cached.length<272)throw new Error('Hãy ĐỌC bảng '+id+' thành công trước khi GHI page A2.');
  const L=v11A2LayoutOf(cached);
  const spec=v11A2PatchSpec(id,L);
  if(!spec)throw new Error('ATE V11 chưa có A2 patch spec cho '+id);
  const m=matrixFromRedTable(1,11);
  const vals=m[0]||[];
  if(vals.length!==11||vals.some(v=>!Number.isFinite(Number(v))))throw new Error('Bảng '+id+' chưa có đủ 11 giá trị hợp lệ.');
  const payload=Array.from(cached);
  for(let i=0;i<11;i++)payload[spec.off+i]=clamp(Math.round(spec.enc(vals[i])),0,255);
  taskUi('loading','ATE V11 · GHI '+spec.label+' · GIỮ NGUYÊN BYTE ẨN');
  await writePageChecked(0xA2,payload,false,1,'mainWrite');
  cacheAckedPage(0xA2,payload);
  notice('success','GHI ATE V11 OK',spec.label+' · page A2 · ECU ACK · 11 byte · byte ẩn giữ nguyên.');
  return {ack:true,page:0xA2,payload:Uint8Array.from(payload)};
}
async function writeFeatureReal(id){
  const bank=normalizeBankForProfile((typeof state!=='undefined'&&state.activeMap)||1);
  const isMain=isDirectVerifiedFeature(id);

  if(isMain){
    if(isV11Profile()&&id==='idle_limit')return writeV11IdleLimit(bank);
    if(isV11Profile()&&id==='afr_map')return writeV11AfrMap(bank);
    if(isV11Profile()&&id==='auto_shift')return writeV11AutoShift(bank);
    if(isV11Profile()&&id==='ect_idle_motor')return writeV11EctMotor(bank);
    if(isV11Profile()&&id==='auto_clutch')return writeV11AutoClutch();
    if(isV11Profile()&&id==='chg_params')return writeV11Chg();
    if(isV11Profile()&&id==='ate_options')return writeV11Options20();
    if(isV11Profile()&&id==='ect_start')return writeV11EctStart();
    if(isV11Profile()&&id==='alternate_table')return writeV11AlternateTable();
    if(isV11Profile()&&id==='external_adjust')return writeV11ExternalAdjust();
    if(isV11Profile()&&v11A2PatchSpec(id))return writeV11A2KnownFeature(id);

    requireProfile('mainWrite','Ghi bảng '+id);
    const expectedPage=mainFeaturePage(id,bank);
    if(expectedPage==null||!pageCache.has(expectedPage)){
      throw new Error('Hãy ĐỌC bảng '+id+' của MAP hiện tại thành công trước khi GHI để tránh ghi dữ liệu trống.');
    }

    let m,pg,payload;
    switch(id){
      case 'inj_degree':m=matrixFromRedTable(14,30);pg=page(2,bank);payload=encodeRowsByte(m,encMainInjAngle);break;
      case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);payload=encodeRowsByte(m,encMainIgn);break;
      case 'ign_time':m=matrixFromRedTable(1,30);pg=page(4,bank);payload=encodeRowsByte(m,encMainDwell);break;
      case 'ect_inj':m=matrixFromRedTable(11,30);pg=0x72;payload=compRowsForwardOnWire()?encodeRowsByteForward(m,encPct):encodeRowsByte(m,encPct);break;
      case 'ect_ign':m=matrixFromRedTable(11,30);pg=0x82;payload=compRowsForwardOnWire()?encodeRowsByteForward(m,isV11Profile()?encMainIgn:encEctIgn):encodeRowsByte(m,encEctIgn);break;
      case 'map_inj':m=matrixFromRedTable(11,30);pg=0x92;payload=compRowsForwardOnWire()?encodeRowsByteForward(m,encMapInj):encodeRowsByte(m,encMapInj);break;
      default:throw new Error('Chưa có page ghi trực tiếp cho '+id);
    }

    const resumeLive=liveRunning;
    stopLiveLoop();
    try{
      await waitForEcuIdle(16000);
      await new Promise(r=>setTimeout(r,bridgeFirmwareAtLeast(1,5)?25:120));
      await writePageChecked(pg,payload,false,1,'mainWrite');
      cacheAckedPage(pg,payload);
      notice('success','GHI ECU OK',id+' · page 0x'+pg.toString(16).toUpperCase()+' · ECU ACK');
      return {ack:true,page:pg,payload:Uint8Array.from(payload)};
    }finally{
      if(resumeLive&&cmdChar()&&mapChar()&&handshakeInfo)scheduleLiveResume(380);
    }
  }

  requireProfile('fullWrite','Ghi bảng '+id);
  if(!readCache)await readAll();
  let m,pg,payload;
  switch(id){
    case 'inj_degree':m=matrixFromRedTable(14,30);pg=page(2,bank);payload=encodeRowsByte(m,encOilAngle);break;
    case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);payload=encodeRowsByte(m,encIgn);break;
    case 'ign_time':m=matrixFromRedTable(1,30);pg=page(4,bank);payload=encodeRowsByte(m,encOil);break;
    case 'ect_inj':m=matrixFromRedTable(11,30);pg=0x72;payload=compRowsForwardOnWire()?encodeRowsByteForward(m,encPct):encodeRowsByte(m,encPct);break;
    case 'ect_ign':m=matrixFromRedTable(11,30);pg=0x82;payload=compRowsForwardOnWire()?encodeRowsByteForward(m,encEctIgn):encodeRowsByte(m,encEctIgn);break;
    case 'map_inj':m=matrixFromRedTable(11,30);pg=0x92;payload=compRowsForwardOnWire()?encodeRowsByteForward(m,encMapInj):encodeRowsByte(m,encMapInj);break;
    case 'ect_idle_motor':pg=page(6,bank);payload=idlePayload(bank,false);{let motor=matrixFromRedTable(1,12)[0];for(let i=0;i<12;i++)payload[18+i]=clamp(Math.round(motor[i]/2),0,255);}break;
    case 'iat_inj':case 'map_idle_motor':case 'external_adjust':case 'auto_clutch':case 'v_ect':case 'v_iat':case 'v_map':pg=0xA2;payload=a2Payload();break;
    case 'spare':throw new Error('Spare là bảng firmware <9.0; ECU 9.1X dùng AutoClutch/Password thay thế. Không ghi để tránh hỏng A-page.');
    default:throw new Error('Chưa có page thật cho '+id);
  }
  await writePageChecked(pg,payload);
  cacheAckedPage(pg,payload);
  notice('success','ECU REAL · GHI OK',id+' · page 0x'+pg.toString(16).toUpperCase()+' · ECU ACK');
  return {ack:true,page:pg,payload:Uint8Array.from(payload)};
}
async function writeIdleReal(){
  requireProfile('fullWrite','Ghi Idle/Limit');
  assertSafeWriteLayout();
  if(!readCache)await readAll();
  const bank=clamp((typeof state!=='undefined'&&state.activeMap)||1,1,4),pg=page(6,bank);
  const payload=idlePayload(bank,true);
  await writePageChecked(pg,payload);
  cacheAckedPage(pg,payload);
  notice('success','IDLE/LIMIT GHI OK','MAP No.'+bank+' · page 0x'+pg.toString(16).toUpperCase()+' · ECU ACK');
  return {ack:true,page:pg,payload:Uint8Array.from(payload)};
}
async function writeOptionsReal(){
  requireProfile('fullWrite','Ghi Options');
  assertSafeWriteLayout();
  if(!readCache)await readAll();
  const payload=a2Payload();
  await writePageChecked(0xA2,payload);
  cacheAckedPage(0xA2,payload);
  notice('success','OPTIONS GHI OK','AFR Control/O2 + Options + Sensor page A2 · ECU ACK');
  return {ack:true,page:0xA2,payload:Uint8Array.from(payload)};
}

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
    if(h===0)await new Promise(r=>setTimeout(r,bridgeFirmwareAtLeast(1,6)?15:60));
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

  const wholeWriteStarted=performance.now();

  // Keep V11 axis fallback logic, but normal save no longer performs a readback.
  if(ecuProfile&&ecuProfile.key==='MODERN_V11'){
    if(sensorCalCache&&validDynamicAxes(sensorCalCache.tpsPct,sensorCalCache.rpmAxis)){
      publishEcuAxes(sensorCalCache.tpsPct,sensorCalCache.rpmAxis,'WRITE CACHE A2 ECU · '+ecuProfile.short);
    }else{
      publishProfileAxisFallback('ATE V11 · WRITE MAP · AXIS FALLBACK');
    }
  }else{
    await ensureEcuAxesReal(false);
  }

  const resumeLive=liveRunning;
  const previousPhase=typeof state!=='undefined'?state.ecuPhase:'live';
  const mapSelect=document.getElementById('mapSelect');
  stopLiveLoop();
  if(typeof state!=='undefined')state.ecuPhase='write1';
  if(mapSelect)mapSelect.disabled=true;
  taskUi('loading','ĐANG GHI HIỆN TẠI · MAP NO.'+bank);
  try{
    await writeFuelBank(bank);
    fuelPagePrimed.delete(bank);
    const wholeMs=Math.round(performance.now()-wholeWriteStarted);
    taskUi('success','GHI MAP NO.'+bank+' OK · ECU ACK · '+(wholeMs/1000).toFixed(1)+'s');
    log('fuel write ACK-only total',wholeMs+'ms','MAP',bank);
    return {ack:true,bank,elapsedMs:wholeMs};
  }finally{
    if(typeof state!=='undefined')state.ecuPhase=(previousPhase==='write1'||previousPhase==='write2')?'live':previousPhase;
    if(mapSelect)mapSelect.disabled=!!(typeof state!=='undefined'&&state.threeRun&&state.threeRun.active);
    if(resumeLive&&cmdChar()&&mapChar()&&handshakeInfo){
      scheduleLiveResume(380);
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
function patchRowsByteForwardPreserve(raw,edited,base,enc){
  const out=new Uint8Array(raw||[]);
  if(!Array.isArray(edited)||!Array.isArray(base)||edited.length!==base.length)return out;
  let p=0;
  for(let r=0;r<base.length;r++){
    for(let c=0;c<base[r].length;c++,p++){
      if(v11ValueChanged(edited[r][c],base[r][c]))out[p]=clamp(Math.round(enc(edited[r][c])),0,255);
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
function v11MatrixChanged(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return true;
  for(let r=0;r<a.length;r++){
    if(!Array.isArray(a[r])||!Array.isArray(b[r])||a[r].length!==b[r].length)return true;
    for(let c=0;c<a[r].length;c++)if(v11ValueChanged(a[r][c],b[r][c]))return true;
  }
  return false;
}
function v11PatchEncodedBlock(raw,edited,base,encode,label){
  const out=new Uint8Array(raw||[]);
  const prev=encode(base),next=encode(edited);
  if(prev.length!==out.length||next.length!==out.length)throw new Error('ATE V11 '+label+' encode length không khớp baseline.');
  for(let i=0;i<out.length;i++)if((next[i]&255)!==(prev[i]&255))out[i]=next[i]&255;
  return out;
}
function v11BuildPage6Payload(bank){
  bank=normalizeBankForProfile(bank);
  const pg=page(6,bank),cached=new Uint8Array(pageCache.get(pg)||[]);
  if(cached.length<43)throw new Error('ATE V11 SEND/COPY cần đọc trực tiếp page 6 của MAP No.'+bank+' đủ 43B trước.');

  const out=new Uint8Array(cached.slice(0,43));
  const baseIdle=decodeV11Idle12(cached.slice(0,12));
  const baseShift=decodeV11AutoShift9(cached.slice(12,21));
  const mode=v11IdleMotorMode(false);
  const baseMotor=decodeV11EctMotor22(cached.slice(21,43),mode);

  const idle=v11StoreMatrix('idle_limit',bank,baseIdle);
  const shift=v11StoreMatrix('auto_shift',bank,baseShift);
  const motor=v11StoreMatrix('ect_idle_motor',bank,baseMotor);

  out.set(v11PatchEncodedBlock(cached.slice(0,12),idle,baseIdle,encodeV11Idle12,'Idle/Limit'),0);
  out.set(v11PatchEncodedBlock(cached.slice(12,21),shift,baseShift,encodeV11AutoShift9,'AutoShift'),12);

  if(mode.known){
    out.set(v11PatchEncodedBlock(
      cached.slice(21,43),motor,baseMotor,
      m=>encodeV11EctMotor22(m,mode),'ECT Motor'
    ),21);
  }else if(v11MatrixChanged(motor,baseMotor)){
    throw new Error('ATE V11 không xác định được Stepper/Solenoid từ handshake; không thể ghi thay đổi ECT Motor an toàn.');
  }
  return out;
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
  if(!base||base.length<272)throw new Error('ATE V11 SEND ALL cần đọc trực tiếp page A2 trước.');
  const C=parseV11A2Data(base),L=C.v11A2LayoutDef||v11A2LayoutOf(base);
  if(C.v11A2KnownLength!==L.LEN)throw new Error('ATE V11 A2 direct layout chưa đủ '+L.LEN+'B.');
  const out=new Uint8Array(base);

  const vEct=v11OneRow('v_ect',C.vEct),vIat=v11OneRow('v_iat',C.vIat),vMap=v11OneRow('v_map',C.vMap);
  const iat=v11OneRow('iat_inj',C.iatInj),mapMotor=v11OneRow('map_idle_motor',C.mapMotor);
  out.set(patchLinearPreserve(out.slice(L.VECT,L.VECT+11),vEct,C.vEct,encVolt),L.VECT);
  out.set(patchLinearPreserve(out.slice(L.VIAT,L.VIAT+11),vIat,C.vIat,encVolt),L.VIAT);
  out.set(patchLinearPreserve(out.slice(L.VMAP,L.VMAP+11),vMap,C.vMap,encVolt),L.VMAP);
  out.set(patchLinearPreserve(out.slice(L.IAT_INJ,L.IAT_INJ+11),iat,C.iatInj,v=>clamp(Math.round(Math.max(0,Number(v))*20),0,255)),L.IAT_INJ);
  out.set(patchLinearPreserve(out.slice(L.MAP_MOTOR,L.MAP_MOTOR+11),mapMotor,C.mapMotor,v=>clamp(Math.round(Number(v)),0,255)),L.MAP_MOTOR);

  const clutch=v11StoreMatrix('auto_clutch',0,C.autoClutch);
  if(Array.isArray(clutch)&&clutch.length===1&&clutch[0].length===6){
    for(let i=0;i<6;i++)if(v11ValueChanged(clutch[0][i],C.autoClutch[0][i]))out[L.CONFIG+1+i]=encV11Dzfm(i,clutch[0][i]);
  }

  const opts=v11StoreMatrix('ate_options',0,C.ateOptions);
  if(Array.isArray(opts)&&opts.length===1&&opts[0].length===20){
    const raw20=encV11Options20(opts,vEct);
    for(let i=0;i<20;i++)if(v11ValueChanged(opts[0][i],C.ateOptions[0][i]))out[L.OPTION+i]=raw20[i];
  }

  const start=v11StoreMatrix('ect_start',0,C.ectStart);
  if(Array.isArray(start)&&start.length===4&&start.every(r=>Array.isArray(r)&&r.length===11)){
    const raw44=encodeV11EctStart44(start);
    for(let i=0;i<44;i++)if(v11ValueChanged(raw44[i],C.ectStartRaw[i],0))out[L.ECT_START+i]=raw44[i];
  }

  const alternate=v11StoreMatrix('alternate_table',0,C.alternateTable);
  if(Array.isArray(alternate)&&alternate.length===1&&Array.isArray(alternate[0])&&alternate[0].length===9){
    for(let i=0;i<9;i++){
      const v=Number(alternate[0][i]);
      if(!Number.isFinite(v)||v<0||v>255)throw new Error('Alternate Table SEND ALL chỉ chấp nhận raw 0–255 tại cột '+(i+1)+'.');
      if(v11ValueChanged(v,C.alternateTable[0][i]))out[L.GLOBAL_AUX+i]=clamp(Math.round(v),0,255);
    }
  }

  const external=v11StoreMatrix('external_adjust',0,C.external);
  out.set(v11PatchExternalRaw(C.externalRaw,external,C.external),L.EXTERNAL);
  const chg=v11StoreMatrix('chg_params',0,C.chg);
  out.set(v11PatchChgRaw(C.chgRaw,chg,C.chg),L.CHG);
  return out;
}
function v11BuildFullWritePlan(){
  if(!v11FullImageReady())throw new Error('ATE V11 cần READ ALL 9958B trước khi GỬI TOÀN BỘ.');
  const C=readCache;
  const allPlan=[];
  const a2Base=new Uint8Array(pageCache.get(0xA2)||[]);
  if(a2Base.length<272)throw new Error('ATE V11 SEND ALL thiếu baseline A2 direct.');
  const a2=v11BuildA2Payload();
  const ect=v11StoreMatrix('ect_inj',0,C.ectInj),ectIgn=v11StoreMatrix('ect_ign',0,C.ectIgn),mapInj=v11StoreMatrix('map_inj',0,C.mapInj);
  const ectRaw=patchRowsByteForwardPreserve(C.ectInjRaw,ect,C.ectInj,encPct);
  const ectIgnRaw=patchRowsByteForwardPreserve(C.ectIgnRaw,ectIgn,C.ectIgn,encMainIgn);
  const mapInjRaw=patchRowsByteForwardPreserve(C.mapInjRaw,mapInj,C.mapInj,encMapInj);
  allPlan.push({pg:0xA2,payload:new Uint8Array(a2),baseline:a2Base,label:'A2'});
  allPlan.push({pg:0x72,payload:new Uint8Array(ectRaw),baseline:new Uint8Array(C.ectInjRaw),label:'ECT INJ'});
  allPlan.push({pg:0x82,payload:new Uint8Array(ectIgnRaw),baseline:new Uint8Array(C.ectIgnRaw),label:'ECT IGN'});
  allPlan.push({pg:0x92,payload:new Uint8Array(mapInjRaw),baseline:new Uint8Array(C.mapInjRaw),label:'MAP INJ'});

  const bankExpected=[],page6Expected=[];
  for(let b=1;b<=4;b++){
    const old=C.banks[b-1];
    const inj=v11FuelMatrix(b,old.inj);
    const injAngle=v11StoreMatrix('inj_degree',b,old.injDegree);
    const ign=v11StoreMatrix('ign_degree',b,old.ignDegree);
    const dwell=v11StoreMatrix('ign_time',b,old.ignTime);
    const afr=v11StoreMatrix('afr_map',b,old.afr);
    const afrMeta=window.blinkV11AfrMeta&&window.blinkV11AfrMeta[b];
    if(!afrMeta)throw new Error('ATE V11 SEND ALL thiếu AFR ON/OFF baseline MAP No.'+b+'. Hãy READ ALL lại.');
    const injRaw=patchRowsU16Preserve(old.injRaw,inj,old.inj,encOilTab);
    const injDegreeRaw=patchRowsBytePreserve(old.injDegreeRaw,injAngle,old.injDegree,encMainInjAngle);
    const ignDegreeRaw=patchRowsBytePreserve(old.ignDegreeRaw,ign,old.ignDegree,encMainIgn);
    const ignTimeRaw=patchRowsBytePreserve(old.ignTimeRaw,dwell,old.ignTime,encMainDwell);
    const afRaw=encodeV11AfrChanged(afr,afrMeta,old.afRaw);
    const idleRaw=new Uint8Array(old.idleRaw),auxRaw=new Uint8Array(old.auxRaw),ectMotorRaw=new Uint8Array(old.ectMotorRaw);
    const page6Base=new Uint8Array(pageCache.get(page(6,b))||[]);
    if(page6Base.length<43)throw new Error('ATE V11 SEND ALL thiếu baseline page 6 trực tiếp của MAP No.'+b+'.');
    const page6Payload=v11BuildPage6Payload(b);
    const low=pageLow(b);
    allPlan.push({pg:0x10|low,payload:injRaw.slice(0,420),baseline:new Uint8Array(old.injRaw.slice(0,420)),label:'MAP '+b+' FUEL 1/2'});
    allPlan.push({pg:0x10|low|1,payload:injRaw.slice(420),baseline:new Uint8Array(old.injRaw.slice(420)),label:'MAP '+b+' FUEL 2/2'});
    allPlan.push({pg:page(2,b),payload:injDegreeRaw,baseline:new Uint8Array(old.injDegreeRaw),label:'MAP '+b+' INJ ANGLE'});
    allPlan.push({pg:page(3,b),payload:ignDegreeRaw,baseline:new Uint8Array(old.ignDegreeRaw),label:'MAP '+b+' IGN'});
    allPlan.push({pg:page(4,b),payload:ignTimeRaw,baseline:new Uint8Array(old.ignTimeRaw),label:'MAP '+b+' DWELL'});
    allPlan.push({pg:page(5,b),payload:afRaw,baseline:new Uint8Array(old.afRaw),label:'MAP '+b+' AFR/O2 TARGET'});
    allPlan.push({pg:page(6,b),payload:page6Payload,baseline:page6Base.slice(0,43),label:'MAP '+b+' IDLE/AUTOSHIFT/ECT MOTOR'});
    // ATE V11 AFR/O2 target map and Page 6 are verified writers; unrelated bytes stay byte-identical.
    bankExpected.push({injRaw,injDegreeRaw,ignDegreeRaw,ignTimeRaw,afRaw,idleRaw,auxRaw,ectMotorRaw});
    page6Expected.push(new Uint8Array(page6Payload));
  }
  const plan=allPlan.filter(x=>!bytesEqual(x.payload,x.baseline));
  const a2Layout=v11A2LayoutOf(a2Base);
  return {plan,totalCandidates:allPlan.length,a2:new Uint8Array(a2),a2Layout,ectRaw:new Uint8Array(ectRaw),ectIgnRaw:new Uint8Array(ectIgnRaw),mapInjRaw:new Uint8Array(mapInjRaw),bankExpected,page6Expected};
}
function verifyV11FullWrite(C,E){
  if(!C||!C.v11Decoded||C.sourceLength!==9958)throw new Error('VERIFY Full Write không nhận được Read All V11 9958B.');
  // Direct A2 (272B or 286B depending on V11 build) differs from the compact
  // Read-All partition and is verified separately after this Read-All check.
  if(!bytesEqual(C.ectInjRaw,E.ectRaw))throw new Error('VERIFY Full Write sai ECT INJ.');
  if(!bytesEqual(C.ectIgnRaw,E.ectIgnRaw))throw new Error('VERIFY Full Write sai ECT IGN.');
  if(!bytesEqual(C.mapInjRaw,E.mapInjRaw))throw new Error('VERIFY Full Write sai MAP INJ.');
  for(let b=1;b<=4;b++)assertV11MainAndAfrMatch(C.banks[b-1],E.bankExpected[b-1],'FULL MAP '+b);
}
async function sendAllV11Real(){
  if(!v11FullImageReady())await readAll();
  if(!v11FullImageReady())throw new Error('ATE V11 chỉ cho GỬI TOÀN BỘ sau READ ALL 9958B hợp lệ.');
  if(!pageCache.get(0xA2)||pageCache.get(0xA2).length<272)await readA2SensorPageReal(false);
  for(let b=1;b<=4;b++){
    const p6=pageCache.get(page(6,b));
    if(!p6||p6.length<43)await readIdlePageReal(b,false);
  }
  const currentA2Layout=v11A2LayoutOf(pageCache.get(0xA2));
  if(!confirm('ATE V11 · GỬI TOÀN BỘ ECU\n\nApp dùng Read All 9958B + '+currentA2Layout.NAME+' trực tiếp '+currentA2Layout.LEN+'B + Page 5 AFR/O2 + Page 6 trực tiếp 43B/MAP. Chỉ byte đã sửa mới thay đổi; AFR target, Idle, AutoShift và ECT Motor đều được đưa vào Full Write.\n\nGiữ nguồn ECU ổn định.'))return;
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
    if(!bytesEqual(A.data,E.a2))throw new Error('VERIFY Full Write sai '+E.a2Layout.NAME+' direct '+E.a2Layout.LEN+'B.');
    for(let b=1;b<=4;b++){
      const P=await readIdlePageReal(b,false);
      if(!bytesEqual(P.data.slice(0,43),E.page6Expected[b-1]))throw new Error('VERIFY Full Write sai page 6 trực tiếp MAP No.'+b+'.');
    }
    notice('success','GỬI TOÀN BỘ ATE V11 OK',E.plan.length+' page thay đổi / '+E.totalCandidates+' page hỗ trợ · Read All + '+E.a2Layout.NAME+' '+E.a2Layout.LEN+'B + AFR Page5 + Page6 43B/MAP VERIFY byte-level.');
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
  const compEncode=compRowsForwardOnWire()?encodeRowsByteForward:encodeRowsByte;
  await writePageChecked(0x72,compEncode(readCache.ectInj,encPct));await writePageChecked(0x82,compEncode(readCache.ectIgn,encEctIgn));await writePageChecked(0x92,compEncode(readCache.mapInj,encMapInj));await writePageChecked(0xA2,a2Payload());
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
function assertV11MainAndAfrMatch(B,S,label){
  const pairs=[
    ['Fuel',B.injRaw,S.injRaw],['INJ angle',B.injDegreeRaw,S.injDegreeRaw],
    ['IGN angle',B.ignDegreeRaw,S.ignDegreeRaw],['Dwell',B.ignTimeRaw,S.ignTimeRaw],
    ['AFR raw',B.afRaw,S.afRaw]
  ];
  for(const [name,a,b] of pairs)if(!bytesEqual(a,b))throw new Error('VERIFY '+label+' sai block '+name);
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
  const srcPg6=page(6,src);
  if(!pageCache.get(srcPg6)||pageCache.get(srcPg6).length<43)await readIdlePageReal(src,false);
  const srcPage6=v11BuildPage6Payload(src);
  const srcAfr=v11StoreMatrix('afr_map',src,srcBase.afr);
  const srcAfrMeta=window.blinkV11AfrMeta&&window.blinkV11AfrMeta[src];
  if(!srcAfrMeta)throw new Error('ATE V11 COPY thiếu AFR ON/OFF baseline MAP nguồn. Hãy READ ALL lại.');
  const srcAfRaw=encodeV11AfrChanged(srcAfr,srcAfrMeta,srcBase.afRaw);
  const srcInj=v11FuelMatrix(src,srcBase.inj);
  const srcInjAngle=v11StoreMatrix('inj_degree',src,srcBase.injDegree);
  const srcIgn=v11StoreMatrix('ign_degree',src,srcBase.ignDegree);
  const srcDwell=v11StoreMatrix('ign_time',src,srcBase.ignTime);
  const S={
    injRaw:patchRowsU16Preserve(srcBase.injRaw,srcInj,srcBase.inj,encOilTab),
    injDegreeRaw:patchRowsBytePreserve(srcBase.injDegreeRaw,srcInjAngle,srcBase.injDegree,encMainInjAngle),
    ignDegreeRaw:patchRowsBytePreserve(srcBase.ignDegreeRaw,srcIgn,srcBase.ignDegree,encMainIgn),
    ignTimeRaw:patchRowsBytePreserve(srcBase.ignTimeRaw,srcDwell,srcBase.ignTime,encMainDwell),
    afRaw:srcAfRaw
  };
  if(S.injRaw.length!==840||S.injDegreeRaw.length!==420||S.ignDegreeRaw.length!==420||S.ignTimeRaw.length!==30||S.afRaw.length!==420||srcPage6.length!==43){
    throw new Error('ATE V11 source bank chưa đủ các block tune/page6 để Copy an toàn.');
  }
  for(const d of dests){
    const p6=page(6,d);
    if(!pageCache.get(p6)||pageCache.get(p6).length<43)await readIdlePageReal(d,false);
  }
  if(!confirm('ATE V11 · COPY MAP NO.'+src+' → '+(dest==='all'?'ALL':dests.join(','))+'\n\nCopy 8 nhóm đã xác nhận: Fuel + Góc phun + Góc lửa + Dwell + AFR/O2 target + Idle/Limit + AutoShift + ECT Motor.'))return;

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
      await writePageChecked(page(5,d),S.afRaw,false,1,'mainWrite');
      await writePageChecked(page(6,d),srcPage6,false,1,'mainWrite');
      await new Promise(r=>setTimeout(r,140));
    }
    const C=await readAll();
    if(!C.v11Decoded)throw new Error('COPY đã ACK nhưng Read All VERIFY không trả layout ATE V11 9958B.');
    for(const d of dests){
      const B=C.banks[d-1];
      if(!bytesEqual(B.injRaw,S.injRaw))throw new Error('VERIFY COPY MAP '+d+' sai Fuel');
      if(!bytesEqual(B.injDegreeRaw,S.injDegreeRaw))throw new Error('VERIFY COPY MAP '+d+' sai Góc phun');
      if(!bytesEqual(B.ignDegreeRaw,S.ignDegreeRaw))throw new Error('VERIFY COPY MAP '+d+' sai Góc lửa');
      if(!bytesEqual(B.ignTimeRaw,S.ignTimeRaw))throw new Error('VERIFY COPY MAP '+d+' sai Dwell');
      if(!bytesEqual(B.afRaw,S.afRaw))throw new Error('VERIFY COPY MAP '+d+' sai AFR/O2 target.');
      const P=await readIdlePageReal(d,false);
      if(!bytesEqual(P.data.slice(0,43),srcPage6))throw new Error('VERIFY COPY MAP '+d+' sai page 6 Idle/AutoShift/ECT Motor.');
    }
    notice('success','COPY MAP ATE V11 OK','MAP No.'+src+' → '+(dest==='all'?'ALL':dests.join(','))+' · 8 nhóm tune/page5/page6 đã copy + verify.');
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
  const profileKey=ecuProfile?.key||'UNKNOWN';

  // V11 uses a dedicated 0x77 study payload. Do NOT feed this short study
  // frame into parseV11A2Data(): the A2 parser now expects the 272/286-byte
  // table layouts, while TPS Study returns the older compact calibration
  // layout with TPS voltage bytes first.
  if(profileKey==='MODERN_V11'){
    if(!confirm('ATE V11 · HỌC TPS\n\nSau khi tiếp tục, vặn ga từ MIN → MAX → MIN ít nhất 3 lần. Giữ nguồn ECU ổn định.'))return;
  }else if(profileKey!=='MODERN_V9'&&profileKey!=='MODERN_V10'){
    throw new Error((ecuProfile?.label||profileKey)+' · chưa có quy trình Học TPS đã xác minh.');
  }

  const resume=liveRunning;
  stopLiveLoop();
  try{
    // A live 0x69 may already be in flight at the moment the button is tapped.
    // Wait for that exchange to complete before starting the long 0x77 study.
    await waitForEcuIdle(9000);
    await new Promise(r=>setTimeout(r,180));

    const label=profileKey==='MODERN_V11'?'ATE V11':(profileKey==='MODERN_V10'?'REDLEO V10/ULTRA':'REDLEO V9');
    const infoEl=document.getElementById('studyTpsInfo');
    if(infoEl)infoEl.textContent=label+' · đang học TPS, chờ ECU trả calibration...';
    taskUi('loading',label+' · ĐANG HỌC TPS...');

    const rx=await rawExchange(req5(0x77,0x77),38000);
    const f=findValidCommandFrame(rx,0x77,100);
    if(!f)throw new Error(label+' · không tìm thấy frame 0x77 checksum hợp lệ');

    let min,max;

    if(profileKey==='MODERN_V11'){
      // Proven compact V11 TPS-study layout:
      // payload[0..13] = TPS voltage breakpoints
      // payload[14..27] = TPS percentage breakpoints
      const payload=f.slice(1,-2);
      if(payload.length<28)throw new Error('ATE V11 TPS Study payload quá ngắn · '+payload.length+'B');
      const tpsVolt=Array.from(payload.slice(0,14),decVolt);
      const tpsPct=Array.from(payload.slice(14,28),x=>Number(x)/2);
      min=Number(tpsVolt[0]);
      max=Number(tpsVolt[13]);

      // Preserve the existing sensor cache and update only the calibration
      // fields proven by the 0x77 response.
      if(sensorCalCache){
        sensorCalCache.tpsVolt=tpsVolt.slice();
        sensorCalCache.tpsPct=tpsPct.slice();
        sensorCalCache.tpsRaw=payload.slice(0,28);
      }
    }else{
      // REDLEO V9 / V10 option block: TPS Min/Max are bytes 92/93.
      if(f.length<=93)throw new Error(label+' · TPS Study frame quá ngắn · '+f.length+'B');
      min=f[92]*20/1024;
      max=f[93]*20/1024;
    }

    if(!Number.isFinite(min)||!Number.isFinite(max)||!(max>min+.1)){
      throw new Error(label+' · TPS calibration không hợp lệ · '+String(min)+' V → '+String(max)+' V');
    }

    state.cal.tpsMin=min;
    state.cal.tpsMax=max;
    try{syncControls();saveSoon();}catch(_e){}

    if(Number.isFinite(state.live.tpsV)){
      const den=max-min;
      state.live.tps=clamp((state.live.tpsV-min)/den*100,0,100);
      try{updateLive();highlightCurrent();}catch(_e){}
    }

    if(infoEl)infoEl.textContent='TPS Study OK · '+min.toFixed(3)+' V → '+max.toFixed(3)+' V';
    notice('success','TPS STUDY '+(profileKey==='MODERN_V11'?'ATE V11':(profileKey==='MODERN_V10'?'V10/ULTRA':'V9'))+' OK',min.toFixed(3)+' V → '+max.toFixed(3)+' V');
    return {frame:f,min,max};
  }catch(e){
    const infoEl=document.getElementById('studyTpsInfo');
    if(infoEl)infoEl.textContent='TPS Study lỗi · '+String(e&&e.message||e);
    throw e;
  }finally{
    if(resume&&cmdChar()&&mapChar()&&handshakeInfo&&profileCap('live')&&!otaPaused){
      scheduleLiveResume(380);
    }
  }
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

const ECU_MAP_IO_BUTTON_IDS=[
  'readMapBtn','writeMapBtn','applyCorrectedBtn',
  'redReadBtn','redWriteBtn',
  'idleLimitReadBtn','idleLimitWriteBtn'
];
const ECU_MAP_IO_SELECT_IDS=['mapSelect','redBankSelect','idleLimitBankSelect'];
let ecuMapIoUiBusy=false;
let ecuMapIoUiToken=0;
let ecuMapIoActiveId='';
let ecuMapIoKind='';
let ecuMapIoLabel='';
let ecuMapIoTransportStarted=false;

function mapIoButtons(){
  return ECU_MAP_IO_BUTTON_IDS.map(id=>document.getElementById(id)).filter(Boolean);
}
function updateActiveMapIoText(text){
  const active=ecuMapIoActiveId?document.getElementById(ecuMapIoActiveId):null;
  if(active&&active.dataset.ioBusy==='1')active.textContent=text;
}
function markEcuMapTransportStarted(cmd,data){
  if(!ecuMapIoUiBusy||ecuMapIoTransportStarted)return;
  // Only commands belonging to the active MAP user action should promote the
  // button from CHỜ to ĐANG ĐỌC/GHI. Handshake/live traffic must not do it.
  const isWrite=cmd===0xCD;
  const isRead=cmd===0x9A||cmd===0xAB||cmd===0x8B;
  if(ecuMapIoKind==='write'&&!isWrite)return;
  if(ecuMapIoKind==='read'&&!isRead)return;

  ecuMapIoTransportStarted=true;
  const what=String(ecuMapIoLabel||'MAP').toUpperCase();
  updateActiveMapIoText(ecuMapIoKind==='read'?'⟳ ĐANG ĐỌC...':'⟳ ĐANG GHI...');
  taskUi('loading',(ecuMapIoKind==='read'?'ĐANG ĐỌC ECU · ':'ĐANG GHI ECU · ')+what);
}
function setEcuMapIoUiBusy(activeId,kind,on,label=''){
  const buttons=mapIoButtons();
  const selectors=ECU_MAP_IO_SELECT_IDS.map(id=>document.getElementById(id)).filter(Boolean);

  if(on){
    // SINGLE-FLIGHT: never enqueue a second user MAP read/write behind the
    // current one. The protocol mutex is the last safety net, not a click queue.
    if(ecuMapIoUiBusy)return false;
    ecuMapIoUiBusy=true;
    ecuMapIoActiveId=activeId||'';
    ecuMapIoKind=kind||'';
    ecuMapIoLabel=label||'MAP';
    ecuMapIoTransportStarted=false;
    ++ecuMapIoUiToken;

    for(const btn of buttons){
      if(btn.dataset.ioBusy!=='1')btn.dataset.ioIdleText=btn.textContent;
      btn.dataset.ioBusy='1';
      btn.disabled=true;
    }
    for(const sel of selectors){
      sel.dataset.ioBusy='1';
      sel.disabled=true;
    }

    const active=document.getElementById(activeId);
    if(active){
      // This is only a tap acknowledgement. It deliberately does NOT say
      // "ĐANG GHI" yet. That state is promoted by rawExchange only after the
      // real ECU transport mutex has been acquired.
      active.textContent=kind==='read'?'⏳ ĐANG CHỜ ĐỌC...':'⏳ ĐANG CHỜ GHI...';
      try{
        active.animate(
          [{transform:'scale(1)',filter:'brightness(1)'},{transform:'scale(.95)',filter:'brightness(1.5)'},{transform:'scale(1)',filter:'brightness(1)'}],
          {duration:220,easing:'ease-out'}
        );
      }catch(_e){}
    }

    const what=String(label||'MAP').toUpperCase();
    taskUi('loading',(kind==='read'?'ĐÃ NHẤN ĐỌC · ':'ĐÃ NHẤN GHI · ')+what+' · ĐANG CHỜ ECU...');
    return true;
  }

  ecuMapIoUiBusy=false;
  ecuMapIoActiveId='';
  ecuMapIoKind='';
  ecuMapIoLabel='';
  ecuMapIoTransportStarted=false;
  ++ecuMapIoUiToken;

  for(const btn of buttons){
    delete btn.dataset.ioBusy;
    if(btn.dataset.ioIdleText!=null){
      btn.textContent=btn.dataset.ioIdleText;
      delete btn.dataset.ioIdleText;
    }
    btn.disabled=btn.dataset.profileBlocked==='1';
  }
  // Fuel button has a dynamic label in 3-run mode.
  const writeMap=document.getElementById('writeMapBtn');
  if(writeMap)writeMap.textContent=(typeof state!=='undefined'&&state.threeRun?.active)?'▣ GHI TAY':'▣ LƯU HIỆN TẠI';

  for(const sel of selectors){
    delete sel.dataset.ioBusy;
    if(sel.id==='mapSelect')sel.disabled=!!(typeof state!=='undefined'&&(state.threeRun?.active||state.ecuPhase==='write1'||state.ecuPhase==='write2'));
    else if(sel.id==='idleLimitBankSelect')sel.disabled=false;
    else if(sel.id==='redBankSelect')sel.disabled=false;
  }
  try{applyProfileUi()}catch(_e){}
  return true;
}

function captureMapIo(id,kind,handler,labelFn){
  const el=document.getElementById(id);
  if(!el)return;
  // The base page and BLE-test shim both assign legacy onclick handlers to
  // these same controls. REAL ECU mode is the sole owner here; removing the
  // stale onclick prevents two independent state machines from reacting to one tap.
  el.onclick=null;
  el.dataset.realIoOwner='1';
  el.addEventListener('click',async e=>{
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    const label=typeof labelFn==='function'?labelFn():labelFn;
    if(!setEcuMapIoUiBusy(id,kind,true,label||'MAP'))return;
    let manualCtx=null;
    try{
      manualCtx=await beginManualMapIo(label||'MAP');
      await handler(e);
    }catch(x){
      err(x);
      taskUi('error','ECU · LỖI: '+String(x&&x.message||x),6500);
      notice('error','ECU REAL',x&&x.message||String(x));
    }finally{
      try{endManualMapIo(manualCtx)}catch(_e){}
      setEcuMapIoUiBusy(null,null,false);
    }
  },true);
}

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

  // Every MAP editor now uses one shared SINGLE-FLIGHT UI transaction.
  // This covers Fuel, Injection Angle, Ignition Angle, Dwell, AFR, compensation
  // tables and Idle/Limit. Repeated taps are dropped at the UI layer instead of
  // being queued behind the protocol mutex.
  captureMapIo('redReadBtn','read',async()=>{
    const id=currentFeatureId();if(!id)throw new Error('Không xác định REDLEO feature');
    await readFeaturePageReal(id,state.activeMap);
    notice('success','ĐỌC TRANG ECU OK',(id||currentSource())+' · page riêng');
  },()=>currentFeatureId()||currentSource()||'MAP');

  captureMapIo('redWriteBtn','write',async()=>{
    const id=currentFeatureId();if(!id)throw new Error('Không xác định REDLEO feature');
    await writeFeatureReal(id);
  },()=>currentFeatureId()||currentSource()||'MAP');

  captureMapIo('idleLimitReadBtn','read',async()=>{
    await readIdlePageReal(state.activeMap);
    notice('success','IDLE/LIMIT READ','MAP No.'+state.activeMap+' · page riêng');
  },'IDLE/LIMIT');

  captureMapIo('idleLimitWriteBtn','write',writeIdleReal,'IDLE/LIMIT');

  // Fuel editor: REDLEO "Read Current" is 0x9A + current fuel page.
  captureMapIo('readMapBtn','read',async()=>{
    if(state.threeRun?.active){
      notice('info','MODE 3 LƯỢT ĐANG HOẠT ĐỘNG','ĐỌC HIỆN TẠI bị chặn để không ghi đè MAP đang dùng cho lượt '+state.threeRun.pass+'/3. Hãy kết thúc hoặc hủy phiên trước.');
      return;
    }
    const R=await readCurrentFuelBank(state.activeMap);
    notice('success','ĐỌC HIỆN TẠI OK','MAP No.'+state.activeMap+' · page 0x'+R.page.toString(16).toUpperCase()+' · '+R.frame.length+'B');
  },'THỜI GIAN PHUN');

  captureMapIo('writeMapBtn','write',async()=>{
    if(typeof startFuelWrite==='function'){await startFuelWrite();return;}
    await writeCurrentFuelAndVerify(state.activeMap);
    notice('success','MAP PHUN WRITE REAL','MAP No.'+normalizeBankForProfile(state.activeMap)+' · ECU ACK · KHÔNG ĐỌC LẠI');
  },'THỜI GIAN PHUN');

  captureMapIo('applyCorrectedBtn','write',async()=>{
    if(typeof applyCorrectedAndWrite==='function'){await applyCorrectedAndWrite();return;}
    throw new Error('Không tìm thấy luồng MAP ĐÃ BÙ an toàn.');
  },'MAP ĐÃ BÙ');
  capture('studyTpsBtn',tpsStudyReal);

  document.querySelectorAll('[data-ecucmd]').forEach(b=>b.addEventListener('click',protect(async()=>{
    const cmd=b.dataset.ecucmd;
    if(cmd==='READ_CURRENT'){const R=await readCurrentFuelBank(state.activeMap);notice('success','READ CURRENT OK','MAP No.'+state.activeMap+' · page 0x'+R.page.toString(16).toUpperCase()+' · '+R.frame.length+'B');return;}
    if(cmd==='READ_ALL'){const C=await readAll();notice('success','READ ALL OK',C.sourceLength+'B · '+(C.rawOnly?'RAW backup':'decoded'));return;}
    if(cmd==='SEND_ALL'){await sendAllReal();return;}
    if(cmd==='SEND_CURRENT'){taskUi('loading','ĐÃ NHẬN NÚT GỬI HIỆN TẠI · MAP NO.'+state.activeMap);await writeCurrentFuelAndVerify(state.activeMap);notice('success','GHI HIỆN TẠI OK','MAP No.'+state.activeMap+' · ECU ACK · KHÔNG ĐỌC LẠI');return;}
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
    else if(!otaPaused&&cmdChar()&&mapChar()&&handshakeInfo&&profileCap('live'))startLiveLoop();
  });
}

window.BlinkRealProtocol={rawExchange,exchangePage9A,readAll,readCurrentFuelBank,readFeaturePageReal,readIdlePageReal,readA2SensorPageReal,ensureAxes:ensureEcuAxesReal,writeCurrentFuelAndVerify,parseCurrentFuelFrame,parseReadAll,parseHandshake,parseLiveReal,handshakeReal,initializeRealSession,writeFeatureReal,writeOptionsReal,writeIdleReal,sendAllReal,copyBankReal,restoreReal,tpsStudyReal,testInjectorReal,abortRawTransport,pauseForOta,resumeAfterOta,beginManualMapIo,endManualMapIo,profileFromHandshake,normalizeBank:normalizeBankForProfile,refreshProfileUi:applyProfileUi,get axes(){return window.blinkEcuAxes||null},get cache(){return readCache},get sensorCache(){return sensorCalCache},get handshake(){return handshakeInfo},get profile(){return ecuProfile},get isBusy(){return busy},get manualIoActive(){return manualMapIoDepth>0},get otaPaused(){return otaPaused}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

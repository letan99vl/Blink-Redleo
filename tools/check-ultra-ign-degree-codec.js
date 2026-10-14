#!/usr/bin/env node
'use strict';
// Targeted regression: REDLEO Ultra Pro1 original PC IGN degree versus Blink.
// Screenshot comparisons on actual MAP1 (October 14, 2026) prove the original
// displayed angle is (raw-64) * 360/1024, NOT Blink's old (raw-64)/4.
// All five original REDLEO Windows EXEs expose B_True ON/OFF for main ignition.
// Screenshot defaults remain ON on 9.2/Ultra1; other original PC versions default OFF.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');
const ui=fs.readFileSync('index.html','utf8');

function between(a,b){
 const i=src.indexOf(a),j=src.indexOf(b,i+a.length);
 assert(i>=0&&j>i,'Missing source section: '+a);
 return src.slice(i,j);
}
const codec=between('function decIgn(raw)','function decLiveIgn(raw)');
const identity=between('function v10FamilyIdentityText()','function v10A2UiMatrix(');
const v9route=between('function firmwareNumbers(info=handshakeInfo)','function currentAuxAxes()');
const v91route=between('function isV91Direct(info=handshakeInfo)','function requireCachedPageAtLeast(');
const sb=vm.createContext({
  console,VER_ANGLE:4,
  ecuProfile:{key:'MODERN_V10'},
  handshakeInfo:{ident:'REDLEO ULTRA PRO1',firmware:'10.3',classify:0},
  r1:v=>Math.round(Number(v)*10)/10,
  clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),
  busy:false,ecuMapIoUiBusy:false,manualMapIoDepth:0,mainIgnUnitOverride:null,
  readCache:null,pageCache:new Map(),
  page:(hi,bank)=>(hi<<4)|(bank*2),
});
vm.runInContext(codec+'\n'+identity+'\n'+v9route+'\n'+v91route+'\nthis.codec={decMainIgn,encMainIgn,decIgn,encIgn,isUltraDirect,isV11Profile,isV92MainIgnProfile,isOriginalPcIgnFamily,mainIgnUnitMode,setMainIgnUnitMode,roundOriginalPcIgn,ULTRA_PRO1_MAIN_IGN_SCALE,REDLEO_V92_MAIN_IGN_SCALE};',sb);
const C=sb.codec;
assert.strictEqual(C.ULTRA_PRO1_MAIN_IGN_SCALE,0.3515625);
assert.strictEqual(C.REDLEO_V92_MAIN_IGN_SCALE,0.3515625);
assert.strictEqual(C.isUltraDirect(),true,'Ultra identity was not routed');
assert.strictEqual(C.mainIgnUnitMode(),'degrees360','Ultra1 screenshot expects B_True ON');
assert.strictEqual(C.roundOriginalPcIgn(11.25,1),11.2,'Original .NET midpoint-even');
assert.strictEqual(C.decMainIgn(96),11.2,'raw96 PC is 11.2 deg, not 11.3');
assert.strictEqual(C.decMainIgn(224),56.2,'raw224 PC is 56.2 deg, not 56.3');
const cases=[
 // Original REDLEO PC visible values and the old Blink mismatched figures:
 // [raw byte, PC IGN degree, former Blink IGN degree].
 [92,9.8,7.0],
 [107,15.1,10.8],
 [112,16.9,12.0],
 [118,19.0,13.5],
 [124,21.1,15.0],
 [130,23.2,16.5],
 [135,25.0,17.8],
 [158,33.0,23.5],
 [172,38.0,27.0],
 [181,41.1,29.3]
];
for(const [raw,pc,oldBlink] of cases){
  assert.strictEqual(C.decMainIgn(raw),pc,'Ultra Pro1 MAP1 codec mismatches original REDLEO PC raw='+raw);
  assert.strictEqual(C.encMainIgn(pc),raw,'Ultra Pro1 encoder cannot round-trip raw='+raw);
  assert.strictEqual(C.decIgn(raw),oldBlink,'Old 0.25 scale did not reproduce screenshot mismatch raw='+raw);
}
for(let raw=0;raw<256;raw++){
  const roundTrip=C.encMainIgn(C.decMainIgn(raw));
  assert.strictEqual(roundTrip,raw,'Ultra raw-byte roundtrip failed '+raw);
}
// Real REDLEO 9.2 original software screenshots versus Blink 0.25-scale.
for(const firmware of ['9.20','9.21','9.29']){
  sb.ecuProfile={key:'MODERN_V9'};
  sb.handshakeInfo={ident:'REDLEO ECU PRO 9.2',firmware};
  vm.runInContext('mainIgnUnitOverride=null',sb);
  assert.strictEqual(C.isV92MainIgnProfile(),true,firmware);
  assert.strictEqual(C.mainIgnUnitMode(),'degrees360','V9.2 owner screenshot B_True ON');
  for(const [raw,pc] of [[56,-2.8],[58,-2.1],[92,9.8],[112,16.9],[130,23.2],[146,28.8],[158,33.0],[169,36.9]]){
    assert.strictEqual(C.decMainIgn(raw),pc,'V9.2 PC display at raw '+raw);
    assert.strictEqual(C.encMainIgn(pc),raw,'V9.2 symmetric write raw '+raw);
  }
  for(let raw=0;raw<256;raw++)assert.strictEqual(C.encMainIgn(C.decMainIgn(raw)),raw,'V9.2 256-byte roundtrip '+raw);
}
for(const [profile,ident] of [
  ['LEGACY_V8','REDLEO 8.0'],['MODERN_V9','REDLEO 9.13'],['MODERN_V9','REDLEO 9.30'],['MODERN_V10','REDLEO ECU Pro 10.2'],
  ['MODERN_V11','REDLEO ULTRA PRO2']
]){
  sb.ecuProfile={key:profile};
  sb.handshakeInfo={ident,firmware:profile==='MODERN_V11'?'11.1':profile==='LEGACY_V8'?'8.0':profile==='MODERN_V9'?(ident.includes('9.30')?'9.30':'9.13'):'10.2'};
  vm.runInContext('mainIgnUnitOverride=null',sb);
  const raw=135,observed=C.decMainIgn(raw),reencoded=C.encMainIgn(observed);
  if(profile!=='MODERN_V11')assert.strictEqual(C.mainIgnUnitMode(),'raw4','legacy startup for '+ident);
  assert.strictEqual(reencoded,raw,'Other ECU family main angle encoder changed '+ident);
  assert.strictEqual(observed,profile==='MODERN_V11'?20.0:17.8,
    'The pre-existing '+profile+' degree scale must be unchanged');
  assert.strictEqual(C.isUltraDirect(),false);
  assert.strictEqual(C.isV92MainIgnProfile(),false);
  if(ident.includes('9.30')){
    assert.strictEqual(C.isOriginalPcIgnFamily(),false,'unknown 9.30 never masquerades as original audited 9.2');
    assert.throws(()=>C.setMainIgnUnitMode('degrees360'),/Chỉ đổi đơn vị/,'do not expose switch for unknown V9');
  }
}
// Both original PC modes must roundtrip for every raw byte, on each of five families.
for(const [profile,fw,ident,kind] of [
 ['LEGACY_V8','8.0','REDLEO V8','v8'],
 ['MODERN_V9','9.13','REDLEO 9.1X','modern'],
 ['MODERN_V9','9.20','REDLEO 9.2','modern'],
 ['MODERN_V10','10.2','REDLEO ECU Pro 10.2','modern'],
 ['MODERN_V10','10.3','REDLEO ULTRA PRO1','modern'],
]){
  sb.ecuProfile={key:profile,family:kind};
  sb.handshakeInfo={ident,firmware:fw,classify:0};
  vm.runInContext('mainIgnUnitOverride=null',sb);
  const start=C.mainIgnUnitMode();
  assert.strictEqual(start,['9.20','10.3'].includes(fw)?'degrees360':'raw4','family startup '+ident);
  for(const mode of ['raw4','degrees360']){
    sb.readCache={oldDecoded:true};
    for(let bank=1;bank<=4;bank++)sb.pageCache.set(sb.page(3,bank),Uint8Array.from([1,2]));
    C.setMainIgnUnitMode(mode);
    assert.strictEqual(C.mainIgnUnitMode(),mode,'mode selection '+ident);
    if(mode!==start)assert.strictEqual(sb.readCache,null,'stale ReadAll cache '+ident);
    if(mode!==start)for(let bank=1;bank<=4;bank++)assert.strictEqual(sb.pageCache.has(sb.page(3,bank)),false,'stale IGN page '+bank);
    for(let raw=0;raw<256;raw++){
      const value=C.decMainIgn(raw),actual=C.encMainIgn(value);
      assert.strictEqual(actual,raw,'original EXE roundtrip '+ident+' '+mode+' raw '+raw+' value '+value);
    }
  }
  C.setMainIgnUnitMode('raw4');
  assert.strictEqual(C.decMainIgn(69),profile==='LEGACY_V8'?1.25:1.2,'V8 vs V9 RAW GUI rounding '+ident);
  C.setMainIgnUnitMode('degrees360');
  assert.strictEqual(C.decMainIgn(96),11.2,'midpoint-to-even raw96 '+ident);
  assert.strictEqual(C.decMainIgn(224),56.2,'midpoint-to-even raw224 '+ident);
}
sb.ecuProfile={key:'MODERN_V11',family:'v11'};
sb.handshakeInfo={ident:'REDLEO ULTRA PRO2',firmware:'11.1'};
assert.strictEqual(C.mainIgnUnitMode(),'v11','V11 is a separate generation');
assert.throws(()=>C.setMainIgnUnitMode('degrees360'),/Chỉ đổi đơn vị/);
assert.strictEqual(C.decMainIgn(135),20.0,'V11 separate IGN unit must be unchanged');
assert(src.includes("z=decodeRowsByte(a,p,14,30,decMainIgn);b.ignDegree=z.data;p=z.next;"),
  'Canonical Read All must use same generation-correct decoder as 0x9A direct read');
assert(src.includes("case 'ign_degree':pg=page(3,bank);rows=14;cols=30;dec=decMainIgn;"),
  'Direct IGN page read must route through corrected model-specific decoder');
assert(src.includes("case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);known=encodeRowsByte(m,encMainIgn);"),
  'Direct Ultra IGN writes must encode exactly the same model-specific angle scale');
assert(src.includes("writeWritablePrefixPage(pg,payload,baseline,id.toUpperCase(),'mainWrite',1)"),
  'Direct serializer still requires baseline + ACK + readback, never blind writes');
assert(ui.includes("window.BLINK_PB_VERSION = '3.79.72'"),'Restore pre-5s Blink app identity');
assert(ui.includes("window.BLINK_ULTRA_PRO1_IGN_REVISION = 'ULTRA-IGN-3515625'"),
  'iOS/Android shared app must expose the updated Ultra Pro1 protocol revision');
assert(ui.includes("'&ig='+encodeURIComponent(window.BLINK_ULTRA_PRO1_IGN_REVISION)"),
  'Shared dynamic JS loader must force a new IGN protocol URL for both platforms');
assert(ui.includes("window.BLINK_V92_IGN_REVISION = 'V92-IGN-3515625'"),'V9.2 updated hosted revision absent');
assert(ui.includes("'&ig92='+encodeURIComponent(window.BLINK_V92_IGN_REVISION)"),'V9.2 cache buster absent');
assert(src.includes("case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);payload=encodeRowsByte(m,encMainIgn);"),'Fallback main IGN writer must use family codec');
assert(src.includes('await writePageChecked(page(3,bank),encodeRowsByte(b.ignDegree,encMainIgn));'),'writeBankAll main IGN writer must use family codec');
assert(ui.includes("window.BLINK_ORIGINAL_IGN_REVISION = 'ORIGINAL-IGN-DUAL-MIDPOINT-EVEN'"),'original-exe revision missing');
assert(ui.includes('id="redIgnUnitMode"'),'PC ignition mode selector absent');
assert(ui.includes('const supported=!!window.BlinkRealProtocol?.mainIgnSelectable;'),'unknown profile must not see ignition mode switch');
assert(src.includes('if(!isOriginalPcIgnFamily())return decIgn(raw);'),'unknown profile decoder must remain legacy');
assert(src.includes('if(!isOriginalPcIgnFamily())return encIgn(v);'),'unknown profile encoder must remain legacy');
assert(ui.includes("for(let b=1;b<=4;b++)delete featureStore['ign_degree:'+b]"),'stale client IGN grids not discarded');
assert(ui.includes("api.setMainIgnUnitMode(next)"),'selector not connected to codec');
assert(ui.includes("await api.readFeaturePageReal('ign_degree',state.activeMap,true)"),'switch must READ map again');
assert(ui.includes("'&igpc='+encodeURIComponent(window.BLINK_ORIGINAL_IGN_REVISION)"),'iOS/Android loader missing fresh revision');
assert(ui.includes('BLINK_SERVER_OTA_PAUSED=true'), 'Do not reactivate ESP32 OTA update');
assert(ui.includes('BLINK_AFR_TARGET_KEYPAD_REVISION'), 'Do not lose restored AFR-target keypad');
assert(!ui.includes("guardControlCommand('RGON')"),'No 5-second guard must be shipped accidentally');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));
assert.strictEqual(manifest.ota_enabled,false,'ESP32 server OTA must remain paused');
console.log('PASS original REDLEO IGN B_True dual-mode: five EXE variants x2 modes x256 raw roundtrips; midpoint-even; stale cache protection; V11 isolation; shared iOS/Android loader, OTA hold');

#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert'),vm=require('vm');
const src=fs.readFileSync('ios/BlinkRedleo/Web/redleo_real_protocol.js','utf8');
const app=fs.readFileSync('ios/BlinkRedleo/Web/index.html','utf8');
const native=fs.readFileSync('ios/BlinkRedleo/MainViewController.swift','utf8');
const section=(a,b)=>{
  const i=src.indexOf(a),j=src.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'Missing iOS remote protocol region: '+a+' -> '+b);
  return src.slice(i,j);
};

assert(app.includes("window.BLINK_PB_VERSION = '3.79.64'"),'iOS UI version 3.79.64 must NOT be changed');
assert(app.includes("ios-native-remote-first"),'iOS bundled UI must not be switched to web UI');
assert(native.includes('ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js'),
       'Existing PB3.79.64 must continue fetching exactly this remote protocol');
assert(native.includes('cachePolicy: .reloadIgnoringLocalCacheData'),
       'Existing iOS hybrid must bypass cached protocol');
assert(src.includes("window.BLINK_IOS64_IGN_REVISION='IOS64-IGN-PC-20261014'"),
       'Missing iOS remote IGN codec revision marker');

// Exercise the actual shipped implementation, not duplicated formula logic.
const fwRoute=section('function firmwareNumbers(info=handshakeInfo){','function currentAuxAxes(){');
const v91=section('function isV91Direct(info=handshakeInfo){','function requireCachedPageAtLeast(');
const ultra=section('function v10FamilyIdentityText(){','function v10A2UiMatrix(');
const codec=section('const IOS64_ORIGINAL_IGN_360_SCALE=','function decLiveIgn(raw){');
const context={
  handshakeInfo:null,
  ecuProfile:null,
  Math,
  VER_ANGLE:4,
  r1:v=>Math.round(v*10)/10,
  decIgn:v=>Math.round((v-64)/4*10)/10,
  encIgn:v=>Math.max(0,Math.min(255,Math.round(Number(v)*4)+64)),
  isV11Profile(){return context.ecuProfile?.key==='MODERN_V11'},
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
};
vm.createContext(context);
vm.runInContext(fwRoute+'\n'+v91+'\n'+ultra+'\n'+codec+'\n'+
'this.codec={decMainIgn,encMainIgn,ios64IgnPcMode,isV92IosIgnProfile,isAuditedOriginalPcIgnProfile,ios64PcRound};',context);
const C=context.codec;
const cases=[
 {key:'LEGACY_V8',family:'v8',fw:'8.0',ident:'REDLEO ECU PRO V8',mode:'raw4'},
 {key:'MODERN_V9',family:'v9',fw:'9.13',ident:'REDLEO ECU PRO 9.1X',mode:'raw4'},
 {key:'MODERN_V9',family:'v9',fw:'9.20',ident:'REDLEO ECU PRO 9.2',mode:'degrees360'},
 {key:'MODERN_V9',family:'v9',fw:'9.29',ident:'REDLEO ECU PRO 9.2',mode:'degrees360'},
 {key:'MODERN_V9',family:'v9',fw:'9.30',ident:'UNKNOWN REDLEO V9.3',mode:'raw4',unknown:true},
 {key:'MODERN_V10',family:'v10',fw:'10.2',ident:'REDLEO ECU PRO 10.2',mode:'raw4'},
 {key:'MODERN_V10',family:'v10',fw:'10.3',ident:'REDLEO ULTRA PRO1',mode:'degrees360'},
 {key:'MODERN_V11',family:'v11',fw:'11.1',ident:'REDLEO ULTRA PRO2',mode:'v11',unknown:true}
];
assert.strictEqual(C.ios64PcRound(11.25,1),11.2,'.NET even midpoint at 11.25');
assert.strictEqual(C.ios64PcRound(-11.25,1),-11.2,'negative even midpoint');
assert.strictEqual(C.ios64PcRound(56.25,1),56.2,'high even midpoint');
assert.strictEqual(C.ios64PcRound(33.75,1),33.8,'odd midpoint rounds up');
for(const t of cases){
  context.ecuProfile={key:t.key,family:t.family};
  context.handshakeInfo={firmware:t.fw,ident:t.ident,classify:0};
  if(t.mode!=='v11')assert.strictEqual(C.ios64IgnPcMode(),t.mode,'Incorrect original PC mode '+t.ident);
  assert.strictEqual(C.isAuditedOriginalPcIgnProfile(),!t.unknown,'Unexpected audited family '+t.ident);
  for(let raw=0;raw<256;raw++){
    const observed=C.decMainIgn(raw),reencoded=C.encMainIgn(observed);
    assert.strictEqual(reencoded,raw,t.ident+' raw '+raw+' -> '+observed+' -> '+reencoded);
  }
  if(t.mode==='degrees360'){
    for(const [raw,expected] of [
      [56,-2.8],[58,-2.1],[92,9.8],[96,11.2],[112,16.9],
      [118,19.0],[130,23.2],[146,28.8],[158,33],[169,36.9],[224,56.2]
    ])assert.strictEqual(C.decMainIgn(raw),expected,
      t.ident+' original REDLEO PC raw '+raw);
  }else if(t.mode==='raw4'&&t.family==='v8'){
    assert.strictEqual(C.decMainIgn(69),1.25,'V8 original precise low angle');
  }else if(t.mode==='raw4'&&t.unknown){
    assert.strictEqual(C.decMainIgn(69),1.3,'Unknown V9 must keep legacy JavaScript /4');
  }else if(t.mode==='raw4'){
    assert.strictEqual(C.decMainIgn(69),1.2,'V9/V10 original display rounded one decimal');
  }else{
    assert.strictEqual(C.decMainIgn(135),20.0,'V11 must keep separate raw scale 0.28125');
  }
}

// Every ignition data path must use the family-sensitive pair, not hard-coded raw4.
assert(src.includes("z=decodeRowsByte(a,p,14,30,decMainIgn);b.ignDegree=z.data;p=z.next;"),
  'iOS native Read All IGN decode bypasses the main-family decoder');
assert(src.includes('case \'ign_degree\':pg=page(3,bank);rows=14;cols=30;dec=decMainIgn;'),
  'iOS direct READ ignores family-specific IGN codec');
assert(src.includes('case \'ign_degree\':m=matrixFromRedTable(14,30);pg=page(3,bank);known=encodeRowsByte(m,encMainIgn);'),
  'iOS direct WRITE missing symmetric IGN encoder');
assert(src.includes('case \'ign_degree\':m=matrixFromRedTable(14,30);pg=page(3,bank);payload=encodeRowsByte(m,encMainIgn);'),
  'iOS fallback WRITE still encodes old IGN /4');
assert(src.includes('await writePageChecked(page(3,bank),encodeRowsByte(b.ignDegree,encMainIgn));'),
  'iOS full-image whole-bank WRITE still uses wrong IGN /4 encoder');
assert(src.includes('patchRowsBytePreserve(old.ignDegreeRaw,ign,old.ignDegree,encMainIgn)'),
  'iOS safe ReadAll patch writer ignores selected IGN codec');
for(const old of [
 'decodeRowsByte(a,p,14,30,decIgn)',
 'encodeRowsByte(m,encIgn)',
 'encodeRowsByte(b.ignDegree,encIgn)'
])assert(!src.includes(old),'Unsafe legacy ignition path remains: '+old);
console.log('PASS iOS PB3.79.64 original REDLEO IGN: 8 ECU variants x256 raw bytes, signed samples, .NET midpoint-even, direct read/write, ReadAll, full image, V11 isolation, remote URL and UI unchanged');

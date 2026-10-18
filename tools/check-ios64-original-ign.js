#!/usr/bin/env node
'use strict';
// PB3.79.64 iOS remote protocol: one fixed 360-degree display, no unit picker.
// REDLEO V8/V9/V10 use REDLEO .NET B_True=ON rounding/encoder; V11
// retains its separate 0.28125 degree raw scale.
const fs=require('fs'),assert=require('assert'),vm=require('vm');
const src=fs.readFileSync('ios/BlinkRedleo/Web/redleo_real_protocol.js','utf8');
const app=fs.readFileSync('ios/BlinkRedleo/Web/index.html','utf8');
const native=fs.readFileSync('ios/BlinkRedleo/MainViewController.swift','utf8');
new vm.Script(src,{filename:'ios-redleo-protocol.js'});
const section=(a,b)=>{
  const i=src.indexOf(a),j=src.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'Missing protocol region '+a);
  return src.slice(i,j);
};
assert(app.includes("window.BLINK_PB_VERSION = '3.79.64'"),'Keep IPA bundled PB3.79.64 UI intact');
assert(app.includes('ios-native-remote-first'),'Keep existing remote loader');
assert(native.includes('ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js'),'iOS must continue loading this published branch');
assert(native.includes('cachePolicy: .reloadIgnoringLocalCacheData'),'iOS should not cache the old protocol');
assert(src.includes("window.BLINK_IOS64_IGN_REVISION='IOS64-IGN-FIXED360-20261018'"),'New remote revision marker missing');
assert(!app.includes('redIgnUnitMode'),'iOS must have no ignition unit selector');
assert(!src.includes('ios64IgnPcMode'),'Old /4 mode selector must not remain');

const codec=section('const IOS64_ORIGINAL_IGN_360_SCALE=','function decLiveIgn(raw){');
const context={
  handshakeInfo:null,ecuProfile:null,VER_ANGLE:4,
  r1:v=>Math.round(Number(v)*10)/10,
  decIgn:v=>Math.round((v-64)/4*10)/10,
  encIgn:v=>Math.max(0,Math.min(255,Math.round(Number(v)*4)+64)),
  isV11Profile(){return context.ecuProfile?.key==='MODERN_V11'},
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
};
vm.createContext(context);
vm.runInContext(codec+'\nthis.codec={decMainIgn,encMainIgn,isRedleoClassicIgnProfile,ios64PcRound,IOS64_ORIGINAL_IGN_360_SCALE};',context);
const C=context.codec;
assert.strictEqual(C.IOS64_ORIGINAL_IGN_360_SCALE,360/1024);
assert.strictEqual(C.ios64PcRound(11.25,1),11.2);
assert.strictEqual(C.ios64PcRound(-11.25,1),-11.2);
assert.strictEqual(C.ios64PcRound(56.25,1),56.2);
assert.strictEqual(C.ios64PcRound(33.75,1),33.8);
const samples=[
  [56,-2.8],[58,-2.1],[92,9.8],[96,11.2],[107,15.1],
  [112,16.9],[118,19.0],[124,21.1],[130,23.2],
  [135,25.0],[146,28.8],[158,33.0],[169,36.9],[224,56.2]
];
const classic=[
 {key:'LEGACY_V8',family:'v8',fw:'8.0',ident:'REDLEO ECU PRO V8'},
 {key:'MODERN_V9',family:'modern',fw:'9.13',ident:'REDLEO ECU PRO 9.1X'},
 {key:'MODERN_V9',family:'modern',fw:'9.20',ident:'REDLEO ECU PRO 9.2'},
 {key:'MODERN_V9',family:'modern',fw:'9.29',ident:'REDLEO ECU PRO 9.2'},
 {key:'MODERN_V9',family:'modern',fw:'9.30',ident:'REDLEO ECU PRO 9.3'},
 {key:'MODERN_V10',family:'modern',fw:'10.2',ident:'REDLEO ECU PRO 10.2'},
 {key:'MODERN_V10',family:'modern',fw:'10.3',ident:'REDLEO ULTRA PRO1'}
];
for(const t of classic){
  context.ecuProfile={key:t.key,family:t.family};
  context.handshakeInfo={firmware:t.fw,ident:t.ident,classify:0};
  assert.strictEqual(C.isRedleoClassicIgnProfile(),true,t.ident);
  for(const [raw,expected] of samples){
    assert.strictEqual(C.decMainIgn(raw),expected,t.ident+' decode '+raw);
    assert.strictEqual(C.encMainIgn(expected),raw,t.ident+' encode '+expected);
  }
  for(let raw=0;raw<256;raw++){
    const degrees=C.decMainIgn(raw);
    assert.strictEqual(C.encMainIgn(degrees),raw,t.ident+' roundtrip raw '+raw);
  }
}
context.ecuProfile={key:'MODERN_V11',family:'v11'};
context.handshakeInfo={firmware:'11.1',ident:'REDLEO ULTRA PRO2'};
assert.strictEqual(C.isRedleoClassicIgnProfile(),false);
assert.strictEqual(C.decMainIgn(135),20.0,'Ultra Pro2 V11 remains 0.28125 degree/step');
for(let raw=0;raw<256;raw++)
  assert.strictEqual(C.encMainIgn(C.decMainIgn(raw)),raw,'Ultra Pro2 roundtrip '+raw);
context.ecuProfile={key:'UNKNOWN',family:'unknown'};
assert.strictEqual(C.isRedleoClassicIgnProfile(),false,'No guessed codec for unknown ECU');

// Direct pages, legacy full-image and patch read/write must share model codec.
assert(src.includes("z=decodeRowsByte(a,p,14,30,decMainIgn);b.ignDegree=z.data;p=z.next;"),'iOS ReadAll IGN decode');
assert(src.includes("case 'ign_degree':pg=page(3,bank);rows=14;cols=30;dec=decMainIgn;"),'iOS direct IGN read');
assert(src.includes("case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);known=encodeRowsByte(m,encMainIgn);"),'iOS direct IGN write');
assert(src.includes("case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);payload=encodeRowsByte(m,encMainIgn);"),'iOS fallback IGN write');
assert(src.includes('await writePageChecked(page(3,bank),encodeRowsByte(b.ignDegree,encMainIgn));'),'iOS full bank IGN write');
assert(src.includes('patchRowsBytePreserve(old.ignDegreeRaw,ign,old.ignDegree,encMainIgn)'),'iOS safe ReadAll patched writer');
console.log('PASS iOS PB3.79.64 remote fixed 360-degree REDLEO IGN: 7 classic variants x256 raw roundtrips, V11 unchanged, remote-first loader, bundled UI unchanged');

#!/usr/bin/env node
'use strict';
// Targeted regression: REDLEO Ultra Pro1 original PC IGN degree versus Blink.
// Screenshot comparisons on actual MAP1 (October 14, 2026) prove the original
// displayed angle is (raw-64) * 360/1024, NOT Blink's old (raw-64)/4.
// DO NOT generalize this to V9, non-Ultra V10.2, or V11/Ultra Pro2.
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
const sb=vm.createContext({
  console,VER_ANGLE:4,
  ecuProfile:{key:'MODERN_V10'},
  handshakeInfo:{ident:'REDLEO ULTRA PRO1',firmware:'10.3',classify:0},
  r1:v=>Math.round(Number(v)*10)/10,
  clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),
});
vm.runInContext(codec+'\n'+identity+'\nthis.codec={decMainIgn,encMainIgn,decIgn,encIgn,isUltraDirect,isV11Profile,ULTRA_PRO1_MAIN_IGN_SCALE};',sb);
const C=sb.codec;
assert.strictEqual(C.ULTRA_PRO1_MAIN_IGN_SCALE,0.3515625);
assert.strictEqual(C.isUltraDirect(),true,'Ultra identity was not routed');
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
for(const [profile,ident] of [
  ['MODERN_V9','REDLEO 9.13'],['MODERN_V10','REDLEO ECU Pro 10.2'],
  ['MODERN_V11','REDLEO ULTRA PRO2']
]){
  sb.ecuProfile={key:profile};
  sb.handshakeInfo={ident,firmware:profile==='MODERN_V11'?'11.1':profile==='MODERN_V9'?'9.13':'10.2'};
  const raw=135,observed=C.decMainIgn(raw),reencoded=C.encMainIgn(observed);
  assert.strictEqual(reencoded,raw,'Other ECU family main angle encoder changed '+ident);
  assert.strictEqual(observed,profile==='MODERN_V11'?20.0:17.8,
    'The pre-existing '+profile+' degree scale must be unchanged');
  assert.strictEqual(C.isUltraDirect(),false);
}
assert(src.includes("z=decodeRowsByte(a,p,14,30,decMainIgn);b.ignDegree=z.data;p=z.next;"),
  'Canonical Read All must use same generation-correct decoder as 0x9A direct read');
assert(src.includes("case 'ign_degree':pg=page(3,bank);rows=14;cols=30;dec=decMainIgn;"),
  'Direct IGN page read must route through corrected model-specific decoder');
assert(src.includes("case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);known=encodeRowsByte(m,encMainIgn);"),
  'Direct Ultra IGN writes must encode exactly the same model-specific angle scale');
assert(src.includes("writeWritablePrefixPage(pg,payload,baseline,id.toUpperCase(),'mainWrite',1)"),
  'Direct serializer still requires baseline + ACK + readback, never blind writes');
assert(ui.includes("window.BLINK_PB_VERSION = '3.79.72'"),'Restore pre-5s Blink app identity');
assert(ui.includes('BLINK_SERVER_OTA_PAUSED=true'), 'Do not reactivate ESP32 OTA update');
assert(ui.includes('BLINK_AFR_TARGET_KEYPAD_REVISION'), 'Do not lose restored AFR-target keypad');
assert(!ui.includes("guardControlCommand('RGON')"),'No 5-second guard must be shipped accidentally');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));
assert.strictEqual(manifest.ota_enabled,false,'ESP32 server OTA must remain paused');
console.log('PASS Ultra Pro1 IGN: 10 original PC screenshot values matched; 256/256 raw bytes roundtrip; V9/V10 normal/V11 unchanged; selected read/write & ReadAll consistent; PB3.79.72+keypad+OTA freeze intact');

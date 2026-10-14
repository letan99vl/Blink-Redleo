#!/usr/bin/env node
'use strict';
// Ultra Pro1 IGN units, original REDLEO PC versus Blink proof (2026-10-14).
// Does not send ECU commands. Checks the ACTUAL codec functions extracted
// from redleo_real_protocol.js in isolation with representative ECU identity.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');
const section=(a,b)=>{
  const st=src.indexOf(a),end=src.indexOf(b,st+a.length);
  assert(st>=0&&end>st,'Codec source anchors missing: '+a+' ... '+b);
  return src.slice(st,end);
};
const core=[
  'const VER_ANGLE=4;',
  'function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}',
  'function r1(v){return Math.round(v*10)/10;}',
  'let ecuProfile=null,handshakeInfo=null;',
  section('function decIgn(raw)','function decLiveIgn(raw)'),
  section('function decEctIgn(raw)','function decPct(raw)'),
  section('function decodeRowsByte(a,off,rows,cols','function decodeRowsByteForward('),
  section('function isUltraDirect(){','function v10A2UiMatrix('),
  'globalThis.codec={decMainIgn,encMainIgn,decIgn,encIgn,decEctIgn,encEctIgn,decodeRowsByte,encodeRowsByte,isUltraDirect,setIdentity:(key,ident,firmware)=>{ecuProfile={key};handshakeInfo={ident,firmware}}};'
].join('\n');
const context=vm.createContext({});
vm.runInContext(core,context);
const x=context.codec;
const cases=[
  [107,15.1,10.8,3000],[118,19.0,13.5,4000],[124,21.1,15.0,4500],
  [130,23.2,16.5,7000],[135,25.0,17.8,7500]
]; // All screenshots are TPS100, MAP1, same RPM axis.
const ultra=()=>x.setIdentity('MODERN_V10','REDLEO ULTRA PRO1','10.3');
ultra();
assert(x.isUltraDirect(),'Expected recognized Ultra Pro1 identity');
for(const [raw,pc,oldBlink,rpm] of cases){
  assert.strictEqual(x.decIgn(raw),oldBlink,'Unexpected old Blink 1/4 scaling at '+rpm);
  assert.strictEqual(x.decMainIgn(raw),pc,'Ultra Pro1 physical angle mismatch at '+rpm);
  assert.strictEqual(x.encMainIgn(pc),raw,'Ultra Pro1 inverse encoder would change ECU raw at '+rpm);
}
for(let raw=0;raw<=255;raw++){
  const deg=x.decMainIgn(raw);
  const roundtrip=x.encMainIgn(deg);
  assert.strictEqual(roundtrip,raw,'Ultra 8-bit IGN raw->deg->raw must roundtrip: '+raw+' became '+roundtrip);
}
const data=new Uint8Array(420).fill(92); // bottom TPS rows 9.8°
data.fill(124,390,420); // top TPS100 row: 21.1° over 30 RPM columns.
const d=x.decodeRowsByte(data,0,14,30,x.decMainIgn).data;
assert.strictEqual(d[0][0],21.1,'TPS row order swapped');
assert.strictEqual(d[13][0],9.8,'Idle TPS row order swapped');
const back=x.encodeRowsByte(d,x.encMainIgn);
assert.deepStrictEqual(Array.from(back),Array.from(data),'Ultra full matrix raw roundtrip');

x.setIdentity('MODERN_V9','REDLEO 9.13','9.13');
assert(!x.isUltraDirect(),'V9.13 not Ultra');
assert.strictEqual(x.decMainIgn(124),15,'V9 9.13 codec MUST remain unchanged');
assert.strictEqual(x.encMainIgn(15),124,'V9 9.13 encoder MUST remain unchanged');
x.setIdentity('MODERN_V10','REDLEO V10.2','10.2');
assert(!x.isUltraDirect(),'Normal V10 not Ultra');
assert.strictEqual(x.decMainIgn(124),15,'Normal V10.2 codec MUST remain unchanged');
assert.strictEqual(x.encMainIgn(15),124,'Normal V10.2 encoder MUST remain unchanged');
x.setIdentity('MODERN_V11','REDLEO ULTRA PRO2','11.1');
assert(!x.isUltraDirect(),'Ultra Pro2 must remain independent V11');
assert.strictEqual(x.decMainIgn(124),16.9,'Ultra Pro2 V11 decoder MUST remain unchanged');
assert.strictEqual(x.encMainIgn(16.9),124,'Ultra Pro2 V11 encoder MUST remain unchanged');
assert(src.includes('z=decodeRowsByte(a,p,14,30,decMainIgn);b.ignDegree=z.data;p=z.next;'),
  'Read-All IGN decode must route through family codec');
assert(src.includes('await writePageChecked(page(3,bank),encodeRowsByte(b.ignDegree,encMainIgn));'),
  'Full writer IGN encode must route through family codec');
assert(src.includes("case 'ign_degree':m=matrixFromRedTable(14,30);pg=page(3,bank);known=encodeRowsByte(m,encMainIgn);"),
  'Direct write must use the corrected inverse family codec');
assert(!src.includes('z=decodeRowsByte(a,p,14,30,decIgn);b.ignDegree=z.data;p=z.next;'),
  'Legacy Read-All must not bypass the corrected Ultra codec');
const html=fs.readFileSync('index.html','utf8');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));
assert(html.includes("BLINK_PB_VERSION = '3.79.72'"),'Historical pre-redline Blink PB changed');
assert(!html.includes('RGON')&&!html.includes('RGOFF'),'5s auto-MAP4 must remain absent from app');
assert(html.includes('const BLINK_SERVER_OTA_PAUSED=true;'),'OTA lock accidentally removed');
assert(manifest.ota_enabled===false&&manifest.version==='0.0.0','OTA server pause accidentally removed');
console.log('PASS Ultra Pro1 IGN 360/256 PC-scale 5 screenshot matches + all 256 raw roundtrips + row orientation; V9, normal V10, Ultra Pro2, OTA lock remain unchanged.');

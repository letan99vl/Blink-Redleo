#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');

function must(re,msg){
  if(!re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}
function mustNot(re,msg){
  if(re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}

// Original REDLEO ECU Pro V8 audit: only MAIN TUNE is exposed in Blink.
// Original default conversion constants: B_True=false, Ver78_Time=2, Ver78_Angle=4.
// Fuel Oil Time uses raw=ms*20; Injection Angle uses OilAngle transform;
// Ignition Angle uses raw=deg*4+64; Ignition Time uses Oil raw with true-time scale.
must(/LEGACY_V8:Object\.freeze\(\{key:'LEGACY_V8'[\s\S]*caps:\{live:true,pageRead:true,optionsRead:false,idleRead:false,fuelRead:true,readAll:true,fuelWrite:true,mainWrite:true,restore:false,tpsStudy:false,testInjector:false,password:false\}/,
  'V8 capability safety profile changed');
must(/LEGACY_V8:new Set\(\['inj_ve','inj_degree','ign_degree','ign_time'\]\)/,
  'V8 UI feature set must remain MAIN TUNE only');
mustNot(/LEGACY_V8:new Set\(\[[^\]]*(?:idle_limit|ect_idle_motor|iat_inj|external_adjust|auto_clutch|ate_options)/,
  'V8 must not expose unverified auxiliary writers');

must(/function pageLow\(bank\)[\s\S]*family==='v8'[\s\S]*if\(mode===1\)return 2[\s\S]*if\(mode===4\)return 1[\s\S]*return bank/,
  'V8 ECU_MODE page-low routing changed');

// Fuel read/write = 420 one-byte cells, raw/20 <-> ms.
must(/const v8=ecuProfile&&ecuProfile\.family==='v8';[\s\S]*if\(v8\)out\.push\(clamp\(Math\.round\(v\*20\),0,255\)\)/,
  'V8 fuel encoder must stay raw=ms*20');
must(/if\(ecuProfile&&ecuProfile\.family==='v8'\)[\s\S]*for\(let wireRow=0;wireRow<14;wireRow\+\+\)[\s\S]*out\[uiRow\]\[c\]=r2\(f\[p\+\+\]\/20\)/,
  'V8 fuel decoder must stay ms=raw/20 with reversed wire-row order');
must(/const fuelMax=ecuProfile&&ecuProfile\.family==='v8'\?12\.75:/,
  'V8 fuel upper bound must remain 12.75ms for uint8 raw*20');

// Main angle/dwell converters must keep original non-V11 path.
must(/function decOilAngle\(raw\)\{return Math\.round\(raw\*2\*360\/256\)\}/,
  'V8 injection-angle decoder changed');
must(/function encOilAngle\(v\)\{return clamp\(Math\.round\(\(Number\(v\)\/2\)\*256\/360\),0,255\)\}/,
  'V8 injection-angle encoder changed');
must(/function decIgn\(raw\)\{return r1\(\(raw-64\)\/VER_ANGLE\)\}/,
  'V8 ignition decoder changed');
must(/function encIgn\(v\)\{return clamp\(Math\.round\(Number\(v\)\*VER_ANGLE\)\+64,0,255\)\}/,
  'V8 ignition encoder changed');
must(/VER_ANGLE=4/,
  'V8/V9 ignition angle factor must remain 4');
must(/function decMainDwell\(raw\)[\s\S]*if\(isV11Profile\(\)\)return r2\(Number\(raw\)\/20\);[\s\S]*return decOil\(raw\)/,
  'V8 dwell decoder must stay on original Oil_EcuToPc true-time path');
must(/function encMainDwell\(v\)[\s\S]*if\(isV11Profile\(\)\)[\s\S]*return encOil\(v\)/,
  'V8 dwell encoder must stay on original Oil_PcToEcu true-time path');
must(/function decOil\(raw\)\{return r2\(\(raw\/20\)\*\(64\/50\)\)\}/,
  'V8 dwell/Oil true-time decoder scale changed');
must(/function encOil\(v\)\{return clamp\(Math\.round\(Math\.max\(0,Number\(v\)\)\*20\*\(50\/64\)\),0,255\)\}/,
  'V8 dwell/Oil true-time encoder scale changed');

// Main direct writer must read baseline and read back instead of broad full write.
must(/case 'inj_degree':m=matrixFromRedTable\(14,30\);pg=page\(2,bank\);known=encodeRowsByte\(m,encMainInjAngle\)/,
  'V8 Injection Angle direct writer missing');
must(/case 'ign_degree':m=matrixFromRedTable\(14,30\);pg=page\(3,bank\);known=encodeRowsByte\(m,encMainIgn\)/,
  'V8 Ignition Angle direct writer missing');
must(/case 'ign_time':m=matrixFromRedTable\(1,30\);pg=page\(4,bank\);known=encodeRowsByte\(m,encMainDwell\)/,
  'V8 Ignition Time direct writer missing');
must(/writeWritablePrefixPage\(pg,payload,baseline,id\.toUpperCase\(\),'mainWrite',1\)/,
  'V8 main angle/dwell writes must use ACK + readback verification');

// Read layer hard-blocks every non-main V8 feature.
must(/if\(ecuProfile&&ecuProfile\.family==='v8'&&!\['inj_degree','ign_degree','ign_time'\]\.includes\(id\)\)[\s\S]*hiện chỉ mở phần chính/,
  'V8 read guard for auxiliary features missing');

// Single-map ECU modes must stay normalized to bank 1.
must(/if\(ecuProfile&&ecuProfile\.family==='v8'\)[\s\S]*if\(mode===1\|\|mode===4\)return 1/,
  'V8 single-map bank normalization changed');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: REDLEO V8 MAIN TUNE page routing and original fuel/angle/dwell scales remain locked down.');

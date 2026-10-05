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
function between(a,b){
  const i=src.indexOf(a),j=src.indexOf(b,i+a.length);
  if(i<0||j<0){console.error('FAIL: cannot isolate '+a);process.exitCode=1;return '';}
  return src.slice(i,j);
}

// REDLEO Ultra Pro2 original PC software:
// - tqmcu_ECU_V11 / ECU Pro 11 / assembly 11.1.7.0
// - REDLEO product branch, V11-generation protocol
// - page6 = Idle 12B + AutoShift 9B + ECT Motor 22B = 43B
// - A2 = exact V11 A2-286 layout
must(/function isUltraPro2Identity\(info=handshakeInfo\)[\s\S]*ULTRA\\s\*PRO\\s\*2[\s\S]*\/ULTRA\/.test\(all\)&&v\.major===11/,
  'Ultra Pro2 identity must recognize explicit PRO2 and ULTRA + firmware major 11');
must(/function isUltraPro2Direct\(\)[\s\S]{0,220}ecuProfile\.key==='MODERN_V11'[\s\S]{0,180}isUltraPro2Identity/,
  'Ultra Pro2 direct session must require MODERN_V11');
must(/REDLEO ULTRA PRO2 · V11 EXTENDED TUNE/,
  'Ultra Pro2 product label missing');
must(/return 'ULTRA PRO2'/,
  'Ultra Pro2 short product label missing');

const profile=between('function profileFromHandshake','function v11FullImageReady');
must(/if\(isUltraPro2Identity\(info\)\|\|\(\/ULTRA\/.test\(all\)&&major===11\)\)return ECU_PROFILE_DEFS\.MODERN_V11/,
  'Ultra Pro2 must classify as MODERN_V11');
must(/if\(\/ULTRA\/.test\(all\)\)return ECU_PROFILE_DEFS\.MODERN_V10/,
  'Generic Ultra/Pro1 fallback must remain MODERN_V10');
const p2=profile.indexOf('isUltraPro2Identity');
const p1=profile.indexOf("if(/ULTRA/.test(all))return ECU_PROFILE_DEFS.MODERN_V10");
if(p2<0||p1<0||p2>p1){
  console.error('FAIL: Ultra Pro2 classification must occur before generic Ultra V10 fallback');
  process.exitCode=1;
}

// Exact Pro2 A2-286 layout.
must(/const V11_A2_286=Object\.freeze\(\{[\s\S]*NAME:'A2-286',LEN:286,[\s\S]*TPS_VOLT:0,TPS:14,RPM:28,VAFR:88,VECT:99,VIAT:110,VMAP:121,[\s\S]*IAT_INJ:132,MAP_MOTOR:143,CONFIG:154,OPTION:165,[\s\S]*ECT_START:195,GLOBAL_AUX:239,EXTERNAL:248,CHG:278/,
  'Ultra Pro2 V11 A2-286 offsets changed');
must(/const layouts=isUltraPro2Direct\(\)\?\[V11_A2_286\]:\[V11_A2,V11_A2_286\]/,
  'Ultra Pro2 must accept only A2-286, never A2-272');
must(/const ultra2=v11&&isUltraPro2Direct\(\)[\s\S]*const minData=v11\?\(ultra2\?V11_A2_286\.LEN:V11_A2\.LEN\)/,
  'Ultra Pro2 A2 direct read must require 286B minimum');
must(/ultra2\?'REDLEO ULTRA PRO2 · A2 286B'/,
  'Ultra Pro2 A2 status label must state 286B');

// V11 page6 contract used by Ultra Pro2.
const idle=between('async function writeV11IdleLimit','async function writeV11EctStart');
must(/cached\.length<43/.test(idle) && /payload=baseline\.slice\(0,43\)/.test(idle),
  'V11/Ultra Pro2 page6 must use exact 43B baseline/payload');
must(/payload\.set\(idle,0\)/.test(idle),
  'Ultra Pro2 Idle must occupy page6 offset 0');
must(/payload\.set\(shift,12\)/.test(idle),
  'Ultra Pro2 AutoShift must occupy page6 offset 12');
must(/payload\.set\(motor,21\)/.test(idle),
  'Ultra Pro2 ECT Motor must occupy page6 offset 21');
must(/GHI IDLE\/LIMIT[\s\S]*12B Idle/.test(idle),
  'Ultra Pro2/V11 Idle 12B invariant missing');
must(/GHI AUTOSHIFT[\s\S]*9B AutoShift/.test(idle),
  'Ultra Pro2/V11 AutoShift 9B invariant missing');
must(/GHI ECT MOTOR[\s\S]*22B ECT Motor/.test(idle),
  'Ultra Pro2/V11 ECT Motor 22B invariant missing');

// AutoClutch intentionally out of scope on newly added Ultra Pro2.
must(/if\(p===ecuProfile&&isUltraPro2Direct\(\)&&id==='auto_clutch'\)return false/,
  'Ultra Pro2 AutoClutch must stay hidden by scope decision');
must(/if\(isUltraPro2Direct\(\)&&id==='auto_clutch'\)return false/,
  'Ultra Pro2 AutoClutch write gate missing');

// ReadAll/full-image safety must remain unchanged.
must(/function v11FullImageReady\(\)[\s\S]*sourceLength===9958/,
  'V11/Ultra Pro2 full-image write must still require exact 9958B decoded ReadAll');
mustNot(/isUltraPro2Direct\(\)[\s\S]{0,500}sourceLength===\s*(?!9958)\d+/,
  'Ultra Pro2 must not introduce a looser full-image length gate');

// Product display and connection label must not say ATE for direct Pro2.
must(/sessionProfileLabel\(p,info\)/,
  'Ultra Pro2 ECU info must use variant-aware product label');
must(/sessionProfileShort\(ecuProfile,info\)/,
  'Ultra Pro2 online status must use variant-aware short label');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: REDLEO Ultra Pro2 stays V11-generation with exact page6 43B, A2-286, 9958B full-image safety gate, and AutoClutch out of scope.');

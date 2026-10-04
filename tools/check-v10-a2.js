#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');

function must(re,msg){
  if(!re.test(src)){ console.error('FAIL:',msg); process.exitCode=1; }
}
function mustNot(re,msg){
  if(re.test(src)){ console.error('FAIL:',msg); process.exitCode=1; }
}
function between(a,b){
  const i=src.indexOf(a),j=src.indexOf(b,i+a.length);
  if(i<0||j<0){ console.error('FAIL: cannot isolate '+a); process.exitCode=1; return ''; }
  return src.slice(i,j);
}

// Original REDLEO ECU Pro 10.2 A2 serializer:
// TPS 2x14 (28B) + RPM 30xu16 (60B) +
// vAFR/vECT/vIAT/vMAP/IAT_INJ/MAP_MOTOR 6x11 (66B) +
// CONFIG/AutoClutch/password 11B + Option 18B +
// ECT Motor 22B + ECT Start Add 33B + EX_ADJ 30B = 268B.
must(/const V10_A2=Object\.freeze\(\{[\s\S]*LEN:268,[\s\S]*TPS_HIDDEN:0,TPS:14,RPM:28,VAFR:88,VECT:99,VIAT:110,VMAP:121,[\s\S]*IAT_INJ:132,MAP_MOTOR:143,CONFIG:154,OPTION:165,ECT_MOTOR:183,[\s\S]*ECT_START:205,EXTERNAL:238/,
  'V10.2 A2 canonical 268B offsets changed');
must(/if\(data\.length<V10_A2\.LEN\).*cần.*V10_A2\.LEN/,
  'V10.2 exact parser must reject reads shorter than 268B');
must(/tpsHiddenRaw=data\.slice\(L\.TPS_HIDDEN,L\.TPS_HIDDEN\+14\)[\s\S]*tpsRaw=data\.slice\(L\.TPS,L\.TPS\+14\)/,
  'V10.2 must preserve hidden TPS row and decode visible TPS row separately');
must(/rpmRaw=data\.slice\(L\.RPM,L\.RPM\+60\)/,
  'V10.2 RPM axis must consume 60B');
must(/configRaw=data\.slice\(L\.CONFIG,L\.CONFIG\+11\)/,
  'V10.2 CONFIG/AutoClutch/password block must be 11B');
must(/optionRaw=data\.slice\(L\.OPTION,L\.OPTION\+18\)/,
  'V10.2 Option block must be 18B');
must(/ectMotorRaw=data\.slice\(L\.ECT_MOTOR,L\.ECT_MOTOR\+22\)/,
  'V10.2 ECT Motor block must be 22B');
must(/ectStartRaw=data\.slice\(L\.ECT_START,L\.ECT_START\+33\)/,
  'V10.2 ECT Start Add block must be 33B');
must(/externalRaw=data\.slice\(L\.EXTERNAL,L\.EXTERNAL\+30\)/,
  'V10.2 External Adjustment block must be 30B');

// Direct V10 must use exact 268B parser. Ultra remains on conservative,
// separate read-only prefix path and may not use the V10 serializer.
must(/const minData=v11\?V11_A2\.LEN:\(v10Direct\?V10_A2\.LEN:\(v10Family\?140:133\)\)/,
  'V10 direct A2 read must require 268B while Ultra stays separate');
must(/v10Direct\?parseV10A2Data\(R\.data\):\(v10Family\?parseModernA2Prefix\(R\.data\):parseA2Data\(R\.data\)\)/,
  'V10 direct/Ultra A2 parser separation missing');
must(/writeV10A2KnownFeature[\s\S]{0,250}if\(!isV10Direct\(\)\)throw/,
  'V10 A2 writer must reject Ultra');

// Every partial A2 write starts from exact 268B read baseline, sends exactly
// 268 writable bytes, and lets writeWritablePrefixPage verify any reply tail.
must(/requireCachedPageAtLeast\(0xA2,V10_A2\.LEN,'REDLEO V10\.2 A2'\)/,
  'V10 A2 writer must require a 268B direct-read baseline');
must(/const payload=baseline\.slice\(0,V10_A2\.LEN\)/,
  'V10 A2 writer must send exactly the canonical writable 268B payload');
must(/writeWritablePrefixPage\(0xA2,payload,baseline,'REDLEO V10\.2 '\+label,'mainWrite',1\)/,
  'V10 A2 writer must use ACK + readback + tail verification');
must(/A2 TX 268B/,
  'V10 A2 status must expose exact TX length');

// Only verified editable surfaces are patched in this pass.
must(/\['iat_inj','map_idle_motor','ect_idle_motor','external_adjust','auto_clutch','v_ect','v_iat','v_map'\]\.includes\(id\)/,
  'V10 A2 verified feature dispatch changed');
must(/payload\[V10_A2\.IAT_INJ\+i\]=encOil/,
  'IAT INJ patch must stay at exact block');
must(/payload\[V10_A2\.MAP_MOTOR\+i\]=/,
  'MAP Motor patch must stay at exact block');
must(/payload\.set\(encodeV10EctMotor22\(m,v10IdleMotorMode\(true\)\),V10_A2\.ECT_MOTOR\)/,
  'ECT Motor patch must stay at exact A2 block');
must(/payload\[V10_A2\.EXTERNAL\+c\]=encExtIgn[\s\S]{0,150}payload\[V10_A2\.EXTERNAL\+15\+c\]=encExtPct/,
  'External Adjustment patch order changed');
must(/payload\[V10_A2\.CONFIG\+2\+i\]=clamp\(Math\.round\(Math\.max\(0,Number\(v\[i\]\)\)\/5\),0,255\)/,
  'AutoClutch must patch only CONFIG timer bytes +2..+6 using raw=ms/5');
must(/autoStart=decAutoRpm\(configRaw\[1\]\)[\s\S]{0,120}auto=Array\.from\(configRaw\.slice\(2,7\),x=>Number\(x\)\*5\)[\s\S]{0,120}password=Array\.from\(configRaw\.slice\(7,11\)\)/,
  'V10 CONFIG layout must remain feature/startRPM/5 timers/password');

// Partial writers preserve Option, ECT Start, TPS/RPM, vAFR and every sibling
// block. AutoClutch is allowed to patch only CONFIG bytes +2..+6; config byte0,
// Start RPM byte1 and password bytes +7..+10 remain untouched.
const writer=between('async function writeV10A2KnownFeature(id){','async function writeV10EctMotor');
for(const forbidden of ['V10_A2.OPTION','V10_A2.ECT_START','V10_A2.TPS_HIDDEN','V10_A2.TPS','V10_A2.RPM','V10_A2.VAFR']){
  if(writer.includes('payload['+forbidden)||writer.includes('payload.set('+forbidden)){
    console.error('FAIL: partial V10 A2 writer patches preserved block '+forbidden);
    process.exitCode=1;
  }
}


// AutoClutch must not patch the CONFIG feature byte, Start RPM or password.
mustNot(/payload\[V10_A2\.CONFIG\](?!\+)/,
  'AutoClutch must preserve CONFIG feature byte');
mustNot(/payload\[V10_A2\.CONFIG\+1\]/,
  'AutoClutch must preserve Start RPM byte');
for(const n of [7,8,9,10]){
  if(writer.includes('payload[V10_A2.CONFIG+'+n+']')){
    console.error('FAIL: AutoClutch must preserve password byte CONFIG+'+n);
    process.exitCode=1;
  }
}

// Original V10.2 motor mode is InfoChk[3] || InfoChk[4], i.e. handshake bits 3/4.
must(/const info3=!!\(n&\(1<<3\)\),info4=!!\(n&\(1<<4\)\)/,
  'V10 motor-mode feature bits changed');
must(/solenoid:info3\|\|info4/,
  'V10 motor-mode rule must remain InfoChk[3] || InfoChk[4]');

// The historical 140B parser may remain for Ultra read-only compatibility,
// but direct V10 must never be documented/routed as a 140B writer again.
mustNot(/writeV10A2KnownFeature[\s\S]{0,900}(140B|slice\(0,140\))/,
  'old 140B V10 direct-write assumption reintroduced');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: REDLEO V10.2 A2 exact 268B layout and RMW writer invariants hold.');

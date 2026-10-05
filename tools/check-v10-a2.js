#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');
const ui=fs.readFileSync('index.html','utf8');

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
must(/const V10_A2=Object\.freeze\(\{[\s\S]*LEN:268,[\s\S]*TPS_VOLT:0,TPS_HIDDEN:0,TPS:14,RPM:28,VAFR:88,VECT:99,VIAT:110,VMAP:121,[\s\S]*IAT_INJ:132,MAP_MOTOR:143,CONFIG:154,OPTION:165,ECT_MOTOR:183,[\s\S]*ECT_START:205,EXTERNAL:238/,
  'V10.2 A2 canonical 268B offsets changed');
must(/if\(data\.length<V10_A2\.LEN\).*cần.*V10_A2\.LEN/,
  'V10.2 exact parser must reject reads shorter than 268B');
must(/tpsVoltRaw=data\.slice\(L\.TPS_VOLT,L\.TPS_VOLT\+14\)[\s\S]*tpsHiddenRaw=tpsVoltRaw\.slice\(\)[\s\S]*tpsRaw=data\.slice\(L\.TPS,L\.TPS\+14\)/,
  'V10.2 must decode TPS voltage row and visible TPS-percent row separately');
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
must(/\['iat_inj','map_idle_motor','ect_idle_motor','external_adjust','auto_clutch','ate_options','ect_start','tps_axis','rpm_axis','v_ect','v_iat','v_map'\]\.includes\(id\)/,
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

// Partial writers preserve vAFR and every sibling block. TPS/RPM are now verified
// dedicated axis writers and are checked separately below.
const writer=between('async function writeV10A2KnownFeature(id){','async function writeV10EctMotor');
for(const forbidden of ['V10_A2.VAFR']){
  if(writer.includes('payload['+forbidden)||writer.includes('payload.set('+forbidden)){
    console.error('FAIL: partial V10 A2 writer patches preserved block '+forbidden);
    process.exitCode=1;
  }
}




// V10.2 TPS/RPM axis semantics reconstructed from original proCheckTpsOption,
// proCheckRpmOption, proUartDgvNumVoltage, proDgvUnit and __UartToDgvTps.
must(/function normalizeV10TpsAxis\(values\)[\s\S]*out\[0\]=0[\s\S]*v>=10\?Math\.round\(v\):\(Math\.round\(v\*2\)\/2\)[\s\S]*v<0\|\|v>100[\s\S]*out\[i\]>out\[i-1\]/,
  'V10 TPS axis normalization/range/order changed');
must(/function encodeV10TpsAxis28\(values,tpsMinV,tpsMaxV\)[\s\S]*const v=r2\(lo\+\(span\/100\)\*pct\[i\]\)[\s\S]*out\[i\]=encVolt\(v\)[\s\S]*out\[14\+i\]=clamp\(Math\.round\(pct\[i\]\*2\),0,200\)/,
  'V10 TPS 28B voltage+percent encoding changed');
must(/function normalizeV10RpmAxis\(values\)[\s\S]*Math\.round\(out\[i\]\/20\)\*20[\s\S]*out\[i\]<500\|\|out\[i\]>15000[\s\S]*out\[i\]>out\[i-1\]/,
  'V10 RPM axis normalization/range/order changed');
must(/function encodeV10RpmAxis60\(values\)[\s\S]*Math\.floor\(rpm\[i\]\/20\)[\s\S]*out\[i\*2\]=\(raw>>8\)&255[\s\S]*out\[i\*2\+1\]=raw&255/,
  'V10 RPM 30xu16-BE encoding changed');
must(/payload\.set\(enc\.raw,V10_A2\.TPS_VOLT\)/,
  'V10 TPS axis writer must patch exact A2 bytes 0..27');
must(/payload\.set\(enc\.raw,V10_A2\.RPM\)/,
  'V10 RPM axis writer must patch exact A2 bytes 28..87');
must(/if\(v10Direct&&C\.tpsPct\)emitFeature\(N\.tps_axis,\[C\.tpsPct\]\)[\s\S]*if\(v10Direct&&C\.rpmAxis\)emitFeature\(N\.rpm_axis,\[C\.rpmAxis\]\)/,
  'V10 axis surfaces must be emitted after A2 read');
must(/if\(id==='tps_axis'\|\|id==='rpm_axis'\)[\s\S]*parseV10A2Data\(got\)[\s\S]*publishEcuAxes\(C\.tpsPct,C\.rpmAxis,'A2 READBACK · V10\.2'\)/,
  'V10 axis write must refresh live map axes from verified A2 readback');
must(/currentV10Direct&&\[[^\]]*'tps_axis'[^\]]*'rpm_axis'[^\]]*\]\.includes\(id\)/,
  'V10 axes must be direct-V10 dynamic features only');
mustNot(/MODERN_V10:new Set\(\[[^\]]*'(tps_axis|rpm_axis)'/,
  'Base MODERN_V10 profile must not expose V10 axes to Ultra');
if(!/data-feature="tps_axis"[\s\S]{0,500}data-feature="rpm_axis"/.test(ui)){
  console.error('FAIL: V10 TPS/RPM axis menu cards missing');
  process.exitCode=1;
}
if(!/"id":"tps_axis"[\s\S]{0,500}"rows":1,"cols":14[\s\S]{0,900}"id":"rpm_axis"[\s\S]{0,500}"rows":1,"cols":30/.test(ui)){
  console.error('FAIL: V10 TPS/RPM axis editor dimensions changed');
  process.exitCode=1;
}
if(!/REDLEO ULTRA · trục TPS\/RPM A2 phải xác minh serializer riêng/.test(src)){
  console.error('FAIL: Ultra axis writer guard missing');
  process.exitCode=1;
}
// Only the dedicated branches may patch the axis offsets.
const tpsBranch=between("}else if(id==='tps_axis'){","}else if(id==='rpm_axis'){");
const rpmBranch=between("}else if(id==='rpm_axis'){","}else{");
if(!tpsBranch.includes('payload.set(enc.raw,V10_A2.TPS_VOLT)')){
  console.error('FAIL: TPS axis branch missing exact TPS block patch');
  process.exitCode=1;
}
if(!rpmBranch.includes('payload.set(enc.raw,V10_A2.RPM)')){
  console.error('FAIL: RPM axis branch missing exact RPM block patch');
  process.exitCode=1;
}

// V10.2 Dgv_Option exact 18B semantics.
// Original UI exposes 15 labeled/unit cells; bytes 15..17 are unlabeled and
// Blink must preserve them byte-for-byte from the direct-read baseline.
must(/function decodeV10Option18\(raw,vEct\)[\s\S]*decVolt\(raw\[0\]\)[\s\S]*decEctIgn\(\(raw\[4\]&255\)\+64\)[\s\S]*ectRawToTemp\(raw\[7\]&255,vEct\)[\s\S]*decAutoRpm\(raw\[10\]\)[\s\S]*decV10OptionFuelPct\(raw\[11\]\)[\s\S]*decAutoRpm\(raw\[12\]\)[\s\S]*reserved:raw\.slice\(15,18\)/,
  'V10 Option 18B decoder mapping/reserved tail changed');
must(/function encV10OptionFuelPct\(v\)[\s\S]*Math\.round\(128\*v\/25\)[\s\S]*x>=128\?127/,
  'V10 Option O2 fuel-adjust 0..25% encoder changed');
must(/function encodeV10Option15\(matrix,baselineRaw,vEct\)[\s\S]*new Uint8Array\(baselineRaw\|\|\[\]\)[\s\S]*out\[0\]=encVolt\(v\[0\]\)[\s\S]*out\[4\]=clamp\(encEctIgn\(v\[4\]\)-64,0,255\)[\s\S]*out\[7\]=ectTempToRaw\(v\[7\],vEct\)[\s\S]*out\[9\]=clamp\(Math\.round\(Math\.max\(0,v\[9\]\)\*5\),0,255\)[\s\S]*out\[14\]=clamp\(Math\.round\(Math\.max\(0,v\[14\]\)\/2\),0,255\)/,
  'V10 Option encoder mapping changed');
const optionCodec=between('function encodeV10Option15','function decodeV10EctStart33');
for(const n of [15,16,17]){
  if(optionCodec.includes('out['+n+']=')){
    console.error('FAIL: V10 Option reserved byte '+n+' must remain from baseline');
    process.exitCode=1;
  }
}
must(/const v10Option=decodeV10Option18\(optionRaw,vEct\)[\s\S]*const optionReserved=v10Option\.reserved/,
  'V10 Option parser must retain semantic matrix and reserved tail');
must(/if\(v10Direct&&C\.v10Options\)emitFeature\(N\.ate_options,C\.v10Options\)/,
  'V10 Option must be emitted after A2 read');
must(/const baseOpt=baseline\.slice\(V10_A2\.OPTION,V10_A2\.OPTION\+18\)[\s\S]*encodeV10Option15\(m,baseOpt,parsed\.vEct\)[\s\S]*payload\.set\(opt,V10_A2\.OPTION\)/,
  'V10 Option writer must patch the exact 18B block from a baseline copy');
must(/currentV10Direct&&\[[^\]]*'ate_options'[^\]]*\]\.includes\(id\)/,
  'V10 Option must be enabled only by the direct-V10 dynamic feature gate');
mustNot(/MODERN_V10:new Set\(\[[^\]]*'ate_options'/,
  'Base MODERN_V10 profile must not expose V10 Option to Ultra');
if(!/id==='ate_options'&&state\.ecuProfile==='MODERN_V10'[\s\S]{0,900}source:'Dgv_Option'[\s\S]{0,120}rows:1,cols:15[\s\S]{0,700}TPS Voltage \(Min\.\)[\s\S]{0,700}O2S adjusts fuel injection[\s\S]{0,500}Idle Motor Minimum/.test(ui)){
  console.error('FAIL: index.html must render the dedicated V10.2 Option 1x15 surface');
  process.exitCode=1;
}
if(!/REDLEO ULTRA · Dgv_Option thuộc serializer A2 riêng/.test(src)){
  console.error('FAIL: Ultra Option must remain explicitly separated from V10.2');
  process.exitCode=1;
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


// V10.2 ECT Start Add exact 3x11 semantics from original IL:
// UI rows: Time(Second), INJ VE(ms), StrtAdd(ms); proUartDgvNum reverses rows on wire.
must(/function decodeV10EctStart33\(raw\)[\s\S]*out\[2\]\[c\]=decOil\(raw\[c\]\)[\s\S]*out\[1\]\[c\]=decOil\(raw\[11\+c\]\)[\s\S]*out\[0\]\[c\]=r1\(\(raw\[22\+c\]&255\)\*0\.2\)/,
  'V10 Start Add decoder row order/scale changed');
must(/function encodeV10EctStart33\(matrix\)[\s\S]*out\[c\]=encOil\(a\)[\s\S]*out\[11\+c\]=encOil\(b\)[\s\S]*out\[22\+c\]=clamp\(Math\.max\(1,Math\.round\(Math\.max\(0,sec\)\*5\)\),1,255\)/,
  'V10 Start Add encoder row order/scale changed');
must(/payload\.set\(encodeV10EctStart33\(m\),V10_A2\.ECT_START\)/,
  'V10 Start Add writer must patch only exact ECT_START block');
must(/const ectStart=decodeV10EctStart33\(ectStartRaw\)/,
  'V10 Start Add parser must decode the 33B block');
must(/if\(v10Direct&&C\.ectStart\)emitFeature\(N\.ect_start,C\.ectStart\)/,
  'V10 Start Add must be emitted to UI after A2 read');
if(!/id==='ect_start'&&state\.ecuProfile==='MODERN_V10'[\s\S]{0,400}rows:3,cols:11[\s\S]{0,300}Time\(Second\)[\s\S]{0,120}INJ VE\(ms\)[\s\S]{0,120}StrtAdd\(ms\)/.test(ui)){
  console.error('FAIL: index.html must render V10.2 Start Add as 3x11 with original row labels');
  process.exitCode=1;
}
if(!/REDLEO ULTRA · Start Add dùng serializer A2 riêng/.test(src)){
  console.error('FAIL: Ultra Start Add must remain explicitly separated from V10.2');
  process.exitCode=1;
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

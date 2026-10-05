#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');
const ui=fs.readFileSync('index.html','utf8');

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

// Original Ultra Pro1 A2:
// prefix through CONFIG/Password = 165B
// Option 18B -> 183
// ECT Motor 22B -> 205
// ECT Start 33B -> 238
// One-Spare 9B -> 247
// External 30B -> 277
// firmware >10.2 appends CHG 8B -> 285
must(/const ULTRA_A2=Object\.freeze\(\{[\s\S]*BASE_LEN:277,CHG_LEN:285,[\s\S]*TPS_VOLT:0,TPS:14,RPM:28,VAFR:88,VECT:99,VIAT:110,VMAP:121,[\s\S]*IAT_INJ:132,MAP_MOTOR:143,CONFIG:154,OPTION:165,ECT_MOTOR:183,[\s\S]*ECT_START:205,ONE_SPARE:238,EXTERNAL:247,CHG:277/,
  'Ultra A2 canonical offsets/lengths changed');
must(/function ultraA2LayoutForSession\(requireKnown=false\)[\s\S]*v\.major===10&&Number\.isFinite\(v\.minor\)[\s\S]*v\.minor>2\?ULTRA_A2\.CHG_LEN:ULTRA_A2\.BASE_LEN/,
  'Ultra A2 277/285 selection must follow original firmware >10.2 CHG condition');
must(/không xác định chính xác firmware 10\.x; chưa thể chọn TX 277B hay 285B an toàn/,
  'Ultra A2 writer must lock when exact 10.x minor firmware is unknown');

const parser=between('function parseUltraA2Data','function parseModernA2Prefix');
must(/data\.length<ULTRA_A2\.BASE_LEN/, 'Ultra A2 parser must require at least 277B');
must(/tpsVoltRaw=data\.slice\(L\.TPS_VOLT,L\.TPS_VOLT\+14\)[\s\S]*tpsRaw=data\.slice\(L\.TPS,L\.TPS\+14\)/,
  'Ultra A2 must keep both TPS rows: voltage 14B + percent 14B');
must(/rpmRaw=data\.slice\(L\.RPM,L\.RPM\+60\)[\s\S]*u16be\(rpmRaw,i\)\*20/,
  'Ultra RPM axis must remain 30xu16-BE raw*20');
must(/configRaw=data\.slice\(L\.CONFIG,L\.CONFIG\+11\)[\s\S]*featureFlags=configRaw\[0\]&255[\s\S]*builtInSpareRaw=configRaw\.slice\(1,7\)[\s\S]*password=Array\.from\(configRaw\.slice\(7,11\)\)/,
  'Ultra CONFIG must remain feature flags + 6 Spare Built-in + 4 password');
if(/autoStart|autoClutch|configRaw\.slice\(2,7\)/.test(parser)){
  console.error('FAIL: Ultra CONFIG must never be decoded as V10.2 AutoClutch');
  process.exitCode=1;
}
must(/optionRaw=data\.slice\(L\.OPTION,L\.OPTION\+18\)[\s\S]*optionTpsMin=decVolt\(optionRaw\[0\]\)[\s\S]*optionTpsMax=decVolt\(optionRaw\[1\]\)/,
  'Ultra TPS axis must derive Min/Max from raw Option bytes 0/1');
must(/ectMotorRaw=data\.slice\(L\.ECT_MOTOR,L\.ECT_MOTOR\+22\)[\s\S]*decodeV10EctMotor22/,
  'Ultra ECT Motor 22B codec changed');
must(/ectStartRaw=data\.slice\(L\.ECT_START,L\.ECT_START\+33\)[\s\S]*decodeV10EctStart33/,
  'Ultra ECT Start 33B codec changed');
must(/oneSpareRaw=data\.slice\(L\.ONE_SPARE,L\.ONE_SPARE\+9\)/,
  'Ultra One-Spare 9B boundary changed');
must(/externalRaw=data\.slice\(L\.EXTERNAL,L\.EXTERNAL\+30\)/,
  'Ultra External 30B boundary changed');
must(/chgRaw=data\.length>=L\.CHG\+8\?data\.slice\(L\.CHG,L\.CHG\+8\):new Uint8Array\(0\)/,
  'Ultra optional CHG 8B boundary changed');

// Exact read path must no longer use historical 140B parser for an Ultra session.
must(/const ultra=isUltraDirect\(\)[\s\S]*minData=[\s\S]*ultra\?\(ultraLayout\?ultraLayout\.len:ULTRA_A2\.BASE_LEN\)/,
  'Ultra A2 read minimum must use 277/285 exact layout');
must(/ultra\?parseUltraA2Data\(R\.data\)/,
  'Ultra A2 read must use parseUltraA2Data');
mustNot(/ultra\?parseModernA2Prefix\(R\.data\)/,
  'Ultra must never return to the old 140B prefix parser');

// Safe Ultra A2 feature surface. Option/AutoClutch/One-Spare/CHG stay unexposed.
must(/isUltraDirect\(\)&&\['idle_limit','iat_inj','map_idle_motor','ect_idle_motor','external_adjust','ect_start','tps_axis','rpm_axis','v_ect','v_iat','v_map'\]\.includes\(id\)/,
  'Ultra direct verified feature set changed');
must(/currentUltraDirect&&\['ect_idle_motor','external_adjust','ect_start','tps_axis','rpm_axis'\]\.includes\(id\)/,
  'Ultra dynamic feature gate changed');
mustNot(/currentUltraDirect&&\[[^\]]*'auto_clutch'/,
  'Ultra AutoClutch must remain out of scope');
mustNot(/currentUltraDirect&&\[[^\]]*'ate_options'/,
  'Ultra Option must remain locked until separately certified');

const writer=between('async function writeUltraA2KnownFeature','async function writeUltraIdleLimit');
must(/const layout=ultraA2LayoutForSession\(true\)[\s\S]*requireCachedPageAtLeast\(0xA2,layout\.len,[\s\S]*payload=baseline\.slice\(0,layout\.len\)/,
  'Ultra A2 writer must use exact firmware-selected baseline length');
must(/payload\[ULTRA_A2\.IAT_INJ\+i\]=encOil/,
  'Ultra IAT INJ writer offset/codec changed');
must(/payload\[ULTRA_A2\.MAP_MOTOR\+i\]=clamp\(Math\.round/,
  'Ultra MAP Motor writer offset changed');
must(/payload\.set\(encodeV10EctMotor22\(m,v10IdleMotorMode\(true\)\),ULTRA_A2\.ECT_MOTOR\)/,
  'Ultra ECT Motor writer changed');
must(/payload\.set\(encodeV10EctStart33\(m\),ULTRA_A2\.ECT_START\)/,
  'Ultra ECT Start writer changed');
must(/payload\[ULTRA_A2\.EXTERNAL\+c\]=encExtIgn[\s\S]*payload\[ULTRA_A2\.EXTERNAL\+15\+c\]=encExtPct/,
  'Ultra External writer row mapping changed');
must(/payload\.set\(enc\.raw,ULTRA_A2\.TPS_VOLT\)/,
  'Ultra TPS writer must patch exact 28B TPS block');
must(/payload\.set\(enc\.raw,ULTRA_A2\.RPM\)/,
  'Ultra RPM writer must patch exact 60B RPM block');
must(/writeWritablePrefixPage\(0xA2,payload,baseline,'REDLEO Ultra '\+label,'mainWrite',1\)/,
  'Ultra A2 write must require ACK + readback + tail verification');

for(const forbidden of ['ULTRA_A2.CONFIG','ULTRA_A2.OPTION','ULTRA_A2.ONE_SPARE','ULTRA_A2.CHG']){
  const assign=new RegExp('payload\\['+forbidden.replace('.','\\.')+'(?:\\+[^\\]]+)?\\]\\s*=');
  const set=new RegExp('payload\\.set\\([^;]+,'+forbidden.replace('.','\\.')+'\\)');
  if(assign.test(writer)||set.test(writer)){
    console.error('FAIL: Ultra A2 writer must preserve '+forbidden+' raw');
    process.exitCode=1;
  }
}
if(/auto_clutch/.test(writer)){
  console.error('FAIL: Ultra A2 writer must not implement AutoClutch');
  process.exitCode=1;
}

// UI dimensions must reflect original 2x11 ECT Motor for V10-family.
if(!/id==='ect_idle_motor'&&state\.ecuProfile==='MODERN_V10'[\s\S]{0,260}rows:2,cols:11[\s\S]{0,220}Step\/Time[\s\S]{0,120}INJ VE\(ms\)/.test(ui)){
  console.error('FAIL: MODERN_V10 ECT Motor UI must be 2x11');
  process.exitCode=1;
}
if(!/Trục TPS V10 \/ Ultra/.test(ui)||!/Trục RPM V10 \/ Ultra/.test(ui)){
  console.error('FAIL: V10/Ultra axis UI labels missing');
  process.exitCode=1;
}

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: REDLEO Ultra Pro1 A2 exact 277/285B parser/writers and preservation gates are intact.');

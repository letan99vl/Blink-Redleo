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

// Original REDLEO Ultra Pro1 selected-MAP page-family 6 serializer:
// Idle/Limit 4x3 uint16-BE = 24B
// AutoShift 1x9 = 9B
// Four-Spare 1x9 = 9B
// Exact writable payload = 42B.
must(/function isUltraDirect\(\)[\s\S]{0,220}MODERN_V10[\s\S]{0,180}\/ULTRA\//,
  'Ultra detector must require MODERN_V10 + ULTRA identity');
must(/if\(ultra&&id==='idle_limit'\)return page\(6,bank\)/,
  'Ultra idle_limit must route to page6');
must(/if\(isUltraDirect\(\)&&\['ect_inj','ect_ign','map_inj','idle_limit','iat_inj','map_idle_motor','ect_idle_motor','external_adjust','ect_start','tps_axis','rpm_axis','v_ect','v_iat','v_map'\]\.includes\(id\)\)return true/,
  'Ultra direct-write set must keep page6 Idle plus verified compensation/A2 surfaces');
{
  const router=between('function mainFeaturePage','function isDirectVerifiedFeature');
  if(!/if\(ultra&&id==='idle_limit'\)return page\(6,bank\);/.test(router)){
    console.error('FAIL: Ultra Idle must remain the only Ultra feature routed to page6');
    process.exitCode=1;
  }
  if(/ultra&&\[[^\]]*(?:ect_inj|ect_ign|map_inj|ect_idle_motor|external_adjust|ect_start|tps_axis|rpm_axis|v_ect|v_iat|v_map|iat_inj|map_idle_motor)[^\]]*\]\.includes\(id\)\)return page\(6,bank\)/.test(router)){
    console.error('FAIL: verified Ultra A2 surfaces must never be routed into page6');
    process.exitCode=1;
  }
}

const readBlock=between("if(isUltraDirect()){","if(isV92Direct()){");
if(!/readDirectPageReal\(pg,42,'REDLEO ULTRA/.test(readBlock)){
  console.error('FAIL: Ultra page6 read must require 42 writable bytes');
  process.exitCode=1;
}
if(!/const idleRaw=wire\.slice\(0,24\)/.test(readBlock) ||
   !/const autoShiftRaw=wire\.slice\(24,33\)/.test(readBlock) ||
   !/const fourSpareRaw=wire\.slice\(33,42\)/.test(readBlock)){
  console.error('FAIL: Ultra page6 must remain 24B Idle + 9B AutoShift + 9B Four-Spare');
  process.exitCode=1;
}
if(!/for\(let i=0;i<12;i\+\+\)idle\.push\(u16be\(idleRaw,i\*2\)\)/.test(readBlock)){
  console.error('FAIL: Ultra Idle must decode exactly 12 uint16-BE values');
  process.exitCode=1;
}
if(!/accelPct:Math\.round\(idle\[6\]\*50\/64\)/.test(readBlock)){
  console.error('FAIL: Ultra Acceleration Setup Percentage decoder changed');
  process.exitCode=1;
}
if(!/vvtOpenRpm:idle\[7\]/.test(readBlock)){
  console.error('FAIL: Ultra VVT Open RPM must remain Idle index 7');
  process.exitCode=1;
}
if(!/hiddenIdleWords:idle\.slice\(8,12\)/.test(readBlock)){
  console.error('FAIL: Ultra Idle u16 indexes 8..11 must stay classified hidden/reserved');
  process.exitCode=1;
}
if(!/replyOnlyTail:Array\.from\(R\.data\.slice\(42\)\)/.test(readBlock)){
  console.error('FAIL: Ultra page6 reply tail must remain outside writable 42B');
  process.exitCode=1;
}

const writer=between('async function writeUltraIdleLimit','async function writeV10IdleLimit');
if(!/requireCachedPageAtLeast\(pg,42,'REDLEO Ultra Idle\/Limit'\)/.test(writer) ||
   !/payload=baseline\.slice\(0,42\)/.test(writer)){
  console.error('FAIL: Ultra Idle writer must use exact 42B read baseline/payload');
  process.exitCode=1;
}
for(const pair of [
  ["idleCold",0],["idleHot",1],["idleSensitivity",2],["maxSpeed",3],
  ["returnCold",4],["returnHot",5],["accelPct",6],["vvtOpenRpm",7]
]){
  const [name,idx]=pair;
  if(!writer.includes("['"+name+"',"+idx+",")){
    console.error('FAIL: Ultra known Idle mapping missing '+name+' -> '+idx);
    process.exitCode=1;
  }
}
if(!writer.includes("['accelPct',6,v=>Math.round(v*64/50)]")){
  console.error('FAIL: Ultra Acceleration Setup Percentage encoder changed');
  process.exitCode=1;
}
if(!/Preserve Idle u16 #8\.\.#11 \(bytes 16\.\.23\), AutoShift bytes 24\.\.32,[\s\S]{0,120}Four-Spare bytes 33\.\.41/.test(writer)){
  console.error('FAIL: Ultra writer preservation boundary documentation missing');
  process.exitCode=1;
}
if(/payload\[(?:1[6-9]|2[0-9]|3[0-9]|4[01])\]\s*=/.test(writer)){
  console.error('FAIL: Ultra writer directly modifies hidden Idle/AutoShift/Four-Spare bytes');
  process.exitCode=1;
}
if(!/writeWritablePrefixPage\(pg,payload,baseline,'REDLEO Ultra Idle\/Limit MAP '\+bank,'mainWrite',1\)/.test(writer)){
  console.error('FAIL: Ultra writer must use ACK + readback + tail verification');
  process.exitCode=1;
}
must(/if\(isUltraDirect\(\)&&id==='idle_limit'\)return writeUltraIdleLimit\(bank\)/,
  'Feature writer must dispatch Ultra idle_limit to 42B writer');
must(/if\(isUltraDirect\(\)\)return writeUltraIdleLimit/,
  'Dedicated Idle writer must dispatch Ultra to 42B writer');

// AutoClutch was explicitly dropped from unfinished-family scope.
// Ultra must not inherit V10.2 AutoClutch. Verified Ultra A2 surfaces use their
// own 277/285B serializer and must never alter the 42B page6 contract.
mustNot(/isUltraDirect\(\)[^\n]*auto_clutch/,
  'Ultra AutoClutch must remain out of scope/locked');
mustNot(/MODERN_V10:new Set\(\[[^\]]*'auto_clutch'/,
  'Shared MODERN_V10 base set must not expose AutoClutch to Ultra');

// UI: Ultra-only VVT field; hide the legacy co-located ECT Motor panel because
// Ultra motor belongs to the dedicated A2 editor, not page6.
if(!/id="ultraVvtOpenField"[^>]*style="display:none"[\s\S]{0,300}data-idleopt="vvtOpenRpm"/.test(ui)){
  console.error('FAIL: Ultra-only VVT Open RPM field missing');
  process.exitCode=1;
}
if(!/id="idleEctPanel"/.test(ui)){
  console.error('FAIL: Idle ECT panel needs a stable id for Ultra hiding');
  process.exitCode=1;
}
must(/ultraVvtField\.style\.display=ultraIdle\?'':'none'/,
  'Ultra VVT field visibility must follow isUltraDirect');
must(/ultraMotorPanel\.style\.display=ultraIdle\?'none':''/,
  'Ultra ECT Motor must stay out of the page6 Idle panel and use its A2 editor');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: REDLEO Ultra Pro1 page6 remains exact 42B Idle-only edit surface with sibling preservation.');

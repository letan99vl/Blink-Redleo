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

// Original REDLEO ECU Pro 9.1X audit:
// page6 = Idle 9xu16-BE (18B) + ECT Motor 12B = exact 30B.
// ECT Motor physical ECT values are bytes 0..10, original col #12 is labelled SUM.
// A2 = exact 133B: TPS14 + six 11B blocks + CONFIG11 + Option12 + External30.
must(/function isV91Direct\(info=handshakeInfo\)[\s\S]{0,260}v\.major===9&&Number\.isFinite\(v\.minor\)&&v\.minor>=1&&v\.minor<2/,
  '9.1X direct detector must require explicit firmware 9.1x');
must(/if\(v91&&\['idle_limit','ect_idle_motor'\]\.includes\(id\)\)return page\(6,bank\)/,
  '9.1X Idle/ECT Motor must route to page6');
must(/if\(v91&&\['iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map'\]\.includes\(id\)\)return 0xA2/,
  '9.1X verified sensor/comp surfaces must route to A2');
must(/isV91Direct\(\)&&\['ect_inj','ect_ign','map_inj','idle_limit','ect_idle_motor','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map'\]\.includes\(id\)\)return true/,
  '9.1X exact direct-write feature set changed');
mustNot(/isV91Direct\(\)&&\[[^\]]*'auto_clutch'/,
  '9.1X AutoClutch must remain out of direct-write scope');

const readIdle=between('if(isV91Direct()){','if(isV92Direct()){');
if(!/readDirectPageReal\(pg,30,'REDLEO 9\.1X/.test(readIdle)){
  console.error('FAIL: 9.1X page6 read must require 30B');process.exitCode=1;
}
if(!/wire\.slice\(0,18\)/.test(readIdle) || !/motorRaw=wire\.slice\(18,30\)/.test(readIdle)){
  console.error('FAIL: 9.1X page6 must remain 18B Idle + 12B ECT Motor');process.exitCode=1;
}
if(!/motor=\[Array\.from\(motorRaw\.slice\(0,11\),x=>\(x&255\)\*2\)\]/.test(readIdle)){
  console.error('FAIL: 9.1X ECT Motor must expose only 11 physical points with UI=raw*2');process.exitCode=1;
}
if(!/ectMotorSumRaw:motorRaw\[11\]&255/.test(readIdle)){
  console.error('FAIL: 9.1X ECT Motor SUM byte must remain separately preserved');process.exitCode=1;
}

const idleWriter=between('async function writeV91IdleLimit','async function writeV92EctMotor');
if(!/requireCachedPageAtLeast\(pg,30,'REDLEO 9\.1X Idle\/Limit'\)/.test(idleWriter) ||
   !/payload=baseline\.slice\(0,30\)/.test(idleWriter)){
  console.error('FAIL: 9.1X Idle writer must use exact 30B baseline/payload');process.exitCode=1;
}
if(!/Preserve Idle words 7\/8 and the complete 12B ECT Motor block/.test(idleWriter)){
  console.error('FAIL: 9.1X Idle hidden-word/motor preservation invariant missing');process.exitCode=1;
}
if(!/writeWritablePrefixPage\(pg,payload,baseline,'REDLEO 9\.1X Idle\/Limit MAP '\+bank,'mainWrite',1\)/.test(idleWriter)){
  console.error('FAIL: 9.1X Idle must use ACK + readback + tail verification');process.exitCode=1;
}

const motorWriter=between('async function writeV91EctMotor','async function writeV91IdleLimit');
if(!/for\(let i=0;i<11;i\+\+\)payload\[18\+i\]=clamp\(Math\.round\(Math\.max\(0,Number\(m\[0\]\[i\]\)\)\/2\),0,255\)/.test(motorWriter)){
  console.error('FAIL: 9.1X ECT Motor must encode exactly 11 visible ECT points as raw=value/2');process.exitCode=1;
}
if(!/payload\[29\] is original UI column "SUM"/.test(motorWriter)){
  console.error('FAIL: 9.1X SUM preservation documentation missing');process.exitCode=1;
}
if(/payload\[29\]\s*=/.test(motorWriter)){
  console.error('FAIL: 9.1X ECT Motor SUM byte must never be edited');process.exitCode=1;
}

const a2=between('async function writeV91A2KnownFeature','async function writeV92A2KnownFeature');
if(!/requireCachedPageAtLeast\(0xA2,133,'REDLEO 9\.1X '\+id\)/.test(a2) ||
   !/payload=baseline\.slice\(0,133\)/.test(a2)){
  console.error('FAIL: 9.1X A2 writer must use exact 133B baseline/payload');process.exitCode=1;
}
for(const marker of [
  "case 'v_ect':row11(25,encVolt",
  "case 'v_iat':row11(36,encVolt",
  "case 'v_map':row11(47,encVolt",
  "case 'iat_inj':row11(58,encOil",
  "case 'map_idle_motor':row11(69",
  "payload[103+i]=encExtIgn",
  "payload[118+i]=encExtPct"
]){
  if(!a2.includes(marker)){console.error('FAIL: 9.1X A2 mapping missing '+marker);process.exitCode=1;}
}
// Never patch CONFIG/AutoClutch/password 80..90 or Option 91..102.
for(let n=80;n<=102;n++){
  if(a2.includes('payload['+n+']')){
    console.error('FAIL: 9.1X A2 writer must preserve byte '+n+' in CONFIG/password/Option');
    process.exitCode=1;
  }
}
if(/auto_clutch/.test(a2)){
  console.error('FAIL: 9.1X direct A2 writer must not implement AutoClutch');process.exitCode=1;
}

// Compensation pages are exact 11x30 one-byte pages and must go through direct readback.
must(/case 'ect_inj':m=matrixFromRedTable\(11,30\);pg=0x72/,
  '9.1X ECT INJ direct 11x30 writer missing');
must(/case 'ect_ign':m=matrixFromRedTable\(11,30\);pg=0x82/,
  '9.1X ECT IGN direct 11x30 writer missing');
must(/case 'map_inj':m=matrixFromRedTable\(11,30\);pg=0x92/,
  '9.1X MAP INJ direct 11x30 writer missing');
must(/writeWritablePrefixPage\(pg,payload,baseline,id\.toUpperCase\(\),'mainWrite',1\)/,
  '9.1X compensation direct writes must use ACK + readback');

// Original 133B generic parser must stay exact.
must(/function parseA2Data\(data\)[\s\S]*data\.length<133[\s\S]*tpsRaw:data\.slice\(0,14\)[\s\S]*vAfrRaw:data\.slice\(14,25\)[\s\S]*vEct:Array\.from\(data\.slice\(25,36\),decVolt\)[\s\S]*optionRaw:Array\.from\(data\.slice\(91,103\)\)/,
  '9.1X A2 133B parser offsets changed');

// User scope: unfinished AutoClutch remains hidden; legacy whole Option writer locked.
must(/if\(p===ecuProfile&&isV91Direct\(\)&&id==='auto_clutch'\)return false/,
  '9.1X AutoClutch UI gate missing');
must(/if\(isV91Direct\(\)\)throw new Error\('REDLEO 9\.1X · Ghi Options 12B vẫn khóa riêng/,
  '9.1X legacy Options writer must remain locked');
must(/optionsWriteBtn\.style\.display=\(p\.key==='MODERN_V9'&&!isV91Direct\(\)\)\?'':'none'/,
  '9.1X legacy Options write button must stay hidden');

// Full-image safety gate remains 9767B for any non-direct 9.x operations.
must(/Blink chỉ mở full-write khi decode đúng layout 9767B/,
  '9.x 9767B full-write safety gate changed');

if(!/9\.1X: byte SUM gốc được giữ nguyên tự động/.test(ui)){
  console.error('FAIL: UI must explain 9.1X SUM byte preservation');process.exitCode=1;
}

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: REDLEO 9.1X exact 30B page6, 133B A2, compensation RMW and safety locks hold.');

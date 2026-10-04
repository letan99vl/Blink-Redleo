const fs=require('fs');
const s=fs.readFileSync('redleo_real_protocol.js','utf8');

function must(re,msg){
  if(!re.test(s)){
    console.error('FAIL:',msg);
    process.exitCode=1;
  }
}
function mustNot(re,msg){
  if(re.test(s)){
    console.error('FAIL:',msg);
    process.exitCode=1;
  }
}
function between(a,b){
  const i=s.indexOf(a),j=s.indexOf(b,i+a.length);
  if(i<0||j<0){
    console.error('FAIL: cannot isolate '+a);
    process.exitCode=1;
    return '';
  }
  return s.slice(i,j);
}

// REDLEO 9.2 page 6x is NOT a 30B Idle+Motor page.
// Original ECU Pro 9.2 writer serializes:
//   Idle/Limit 9*u16 = 18B
//   ECT Motor 2*11 = 22B
//   ECT Start Add 2*11 = 22B
// Total writable payload = 62B.
// Real read replies may contain a 63rd reply-only byte.
must(/REDLEO 9\.2 original serializer for page 6x:[\s\S]{0,300}Idle\/Limit[\s\S]{0,100}= 18B[\s\S]{0,160}ECT Motor[\s\S]{0,100}= 22B[\s\S]{0,160}ECT Start Add[\s\S]{0,100}= 22B/,
  'missing documented 18+22+22 REDLEO 9.2 page6 layout');
must(/const R=await readDirectPageReal\(pg,62,[\s\S]{0,160}const wire=R\.data\.slice\(0,62\)/,
  '9.2 page6 read must require 62 writable bytes and strip reply-only tail');
must(/writableLength:62/,
  '9.2 page6 cache must record writable length 62');
must(/replyOnlyTail:Array\.from\(R\.data\.slice\(62\)\)/,
  '9.2 page6 reply-only tail must remain separated from writable bytes');

// ECT Motor uses 2x11 in original software. Blink exposes only Step/Time;
// hidden INJ VE row must be preserved.
must(/writeV92EctMotor[\s\S]{0,500}baseline=requireCachedPageAtLeast\(pg,62[\s\S]{0,100}payload=baseline\.slice\(0,62\)/,
  '9.2 ECT Motor writer must build exactly 62 writable bytes');
must(/matrixFromRedTable\(1,11\)/,
  '9.2 visible ECT Motor editor must use exactly 11 points');
must(/bytes 18\.\.28 = hidden INJ VE row[\s\S]{0,180}bytes 29\.\.39 = visible Step\/Time row/,
  '9.2 ECT Motor wire row order must preserve hidden INJ row then edit Step/Time');
must(/payload\[29\+i\]=/,
  '9.2 ECT Motor must patch only the second 11-byte motor row');
must(/bytes 40\.\.61 = ECT Start Add 2x11\. Preserve byte-for-byte/,
  '9.2 ECT Start Add must remain untouched during ECT Motor write');

// Idle writer must also transmit the whole 62-byte canonical page,
// while preserving hidden Idle words 7/8 and all other page6 blocks.
must(/writeV92IdleLimit[\s\S]{0,500}baseline=requireCachedPageAtLeast\(pg,62[\s\S]{0,100}payload=baseline\.slice\(0,62\)/,
  '9.2 Idle writer must build exactly 62 writable bytes');
must(/Preserve Idle words 7\/8, complete 22B ECT Motor and complete 22B ECT Start Add/,
  '9.2 Idle writer must preserve hidden words and sibling page6 blocks');

// Do not let the old failed assumptions creep back into the active 9.2 writer.
mustNot(/writeV92(?:IdleLimit|EctMotor)[\s\S]{0,700}slice\(0,30\)/,
  'old 30B page6 write assumption reintroduced');

// Other families must never reuse the REDLEO 9.2 62B serializer.
// V10.2 has its own 18B Idle-only page6 writer. Its ECT Motor lives in A2,
// so page6 regression only verifies the family boundary, not an A2 lock.
must(/if\(v10&&id==='idle_limit'\)return page\(6,bank\);[\s\S]{0,180}ect_idle_motor[\s\S]{0,100}return 0xA2/,
  'V10 ECT Motor must route to A2, not page6');
must(/writeV10EctMotor[\s\S]{0,180}writeV10A2KnownFeature\('ect_idle_motor'\)/,
  'V10 ECT Motor writer must delegate to A2 serializer');
mustNot(/writeV10IdleLimit[\s\S]{0,700}slice\(0,62\)/,
  'V10 must never reuse the REDLEO 9.2 62B page6 payload');
{
  const v10MotorWriter=between('async function writeV10EctMotor','async function writeV10IdleLimit');
  if(/page\(6,bank\)/.test(v10MotorWriter)){
    console.error('FAIL: V10 ECT Motor must never regain a page6 writer');
    process.exitCode=1;
  }
}
must(/REDLEO 9\.1X · Idle\/ECT Motor tạm khóa/,
  'V9.1 page6 safety lock missing');

if(process.exitCode)process.exit(process.exitCode);
console.log('REDLEO 9.2 page6 regression checks: OK');

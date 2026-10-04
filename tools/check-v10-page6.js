#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');

function must(re,msg){
  if(!re.test(src))throw new Error(msg);
}
function mustNot(re,msg){
  if(re.test(src))throw new Error(msg);
}

// REDLEO ECU Pro 10.2 original IL:
// page family 6 serializes ONLY Dgv_Idle_Limit[bank] via proUartDgvNumOption.
// That block is 9 x uint16-BE = 18 writable bytes.
// ECT Motor belongs to A2 on V10 and must never be appended to page6.

must(/isV10Direct\(\)&&\[[^\]]*'idle_limit'[^\]]*\]\.includes\(id\)/,
  'V10 idle_limit must remain a direct verified feature.');
must(/requireCachedPageAtLeast\(pg,18,'REDLEO V10\.2 Idle\/Limit'\),payload=baseline\.slice\(0,18\)/,
  'V10 Idle writer must use exactly 18 writable bytes.');
must(/REDLEO V10\.2 · GHI IDLE\/LIMIT[\s\S]*TX 18B/,
  'V10 Idle UI/status must state TX 18B.');
must(/if\(isV10Direct\(\)\)return writeV10IdleLimit/,
  'Dedicated Idle button must dispatch to V10 18B writer.');
must(/if\(isV10Direct\(\)&&id==='idle_limit'\)return writeV10IdleLimit/,
  'Feature writer must dispatch V10 idle_limit to 18B writer.');
must(/if\(v10&&id==='idle_limit'\)return page\(6,bank\);[\s\S]{0,180}ect_idle_motor[\s\S]{0,100}return 0xA2/,
  'V10 ECT Motor must remain separated from page6 and route to A2.');
must(/MODERN_V10:new Set\(\[[^\]]*'idle_limit'[^\]]*\]\)/,
  'V10 profile must expose Idle/Limit.');
mustNot(/MODERN_V10:new Set\(\[[^\]]*'ect_idle_motor'[^\]]*\]\)/,
  'V10 base profile must not expose ECT Motor to Ultra; direct V10 adds it dynamically.');
mustNot(/REDLEO V10 Idle\/Limit[^\n]*TX 30B/,
  'Old V10 30B Idle assumption must never return.');
mustNot(/requireCachedPageAtLeast\(pg,30,'REDLEO V10 Idle\/Limit'\)/,
  'Old V10 30B page6 baseline must never return.');

console.log('OK: REDLEO V10.2 page6 remains 18B Idle/Limit only; ECT Motor is isolated to A2.');

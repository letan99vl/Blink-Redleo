#!/usr/bin/env node
'use strict';

const fs=require('fs');
const s=fs.readFileSync('index.html','utf8');

function must(re,msg){
  if(!re.test(s)){console.error('FAIL:',msg);process.exitCode=1;}
}

// Two-corner selection must always start from top-left. The second corner may
// be on the same row/column, but may never be above or left of corner #1.
must(/function handleMapCornerTap\(r,c\)[\s\S]{0,1600}if\(r<state\.selection\.anchorR\|\|c<state\.selection\.anchorC\)[\s\S]{0,260}invalid-direction/,
  'main map must reject reverse two-corner selection');
must(/function handleRedCornerTap\(r,c\)[\s\S]{0,1400}if\(r<redSel\.r0\|\|c<redSel\.c0\)[\s\S]{0,260}invalid-direction/,
  'REDLEO map must reject reverse two-corner selection');
must(/Góc 2 phải nằm bên phải \/ phía dưới góc 1/,
  'user feedback for invalid corner direction missing');

// Existing tap-inside-to-cancel behavior must remain intact.
must(/function handleMapCornerTap\(r,c\)[\s\S]{0,500}selectionContainsCell\(r,c\)[\s\S]{0,160}Đã hủy vùng chọn/,
  'main map tap-inside cancel rule missing');
must(/function handleRedCornerTap\(r,c\)[\s\S]{0,500}redContainsCell\(r,c\)[\s\S]{0,160}Đã hủy vùng chọn/,
  'REDLEO map tap-inside cancel rule missing');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: two-corner selection is top-left-first only; tap-inside cancel remains enabled.');

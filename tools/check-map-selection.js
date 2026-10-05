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

// A tap after an existing rectangle must collapse directly to that one cell,
// never clear the selection and require a second tap.
must(/function handleMapCornerTap\(r,c\)[\s\S]{0,700}selectionContainsCell\(r,c\)[\s\S]{0,260}setSelection\(r,c,false\)[\s\S]{0,180}cornerPending=true/,
  'main map tap must collapse existing selection to one cell');
must(/function handleRedCornerTap\(r,c\)[\s\S]{0,700}redContainsCell\(r,c\)[\s\S]{0,320}redSel=\{r0:r,c0:c,r1:r,c1:c\}[\s\S]{0,180}redCornerPending=true/,
  'REDLEO map tap must collapse existing selection to one cell');

// Scan mode keeps drag selection, but a simple tap leaves exactly one cell.
must(/function endScan\(e\)[\s\S]{0,700}if\(wasTap\)[\s\S]{0,220}setSelection\(scanStartR,scanStartC,false\)/,
  'main scan tap must leave one selected cell');
must(/function endRedScan\(e\)[\s\S]{0,800}if\(wasTap\)[\s\S]{0,300}redSel=\{r0:redScanStartR,c0:redScanStartC,r1:redScanStartR,c1:redScanStartC\}/,
  'REDLEO scan tap must leave one selected cell');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: top-left-first two-corner selection and one-tap collapse-to-cell behavior hold.');

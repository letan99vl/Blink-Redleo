#!/usr/bin/env node
'use strict';

const fs=require('fs');
const s=fs.readFileSync('index.html','utf8');

function must(re,msg){
  if(!re.test(s)){console.error('FAIL:',msg);process.exitCode=1;}
}

// Two-corner selection still starts from top-left. If the next tap is above
// or left of the current origin, Blink must move the single-cell origin there
// instead of creating a reverse rectangle or blocking navigation.
must(/function handleMapCornerTap\(r,c\)[\s\S]{0,1800}if\(r<state\.selection\.anchorR\|\|c<state\.selection\.anchorC\)[\s\S]{0,360}setSelection\(r,c,false\)[\s\S]{0,180}cornerPending=true[\s\S]{0,160}anchor-moved/,
  'main map must relocate origin on above/left tap');
must(/function handleRedCornerTap\(r,c\)[\s\S]{0,1700}if\(r<redSel\.r0\|\|c<redSel\.c0\)[\s\S]{0,420}redSel=\{r0:r,c0:c,r1:r,c1:c\}[\s\S]{0,180}redCornerPending=true[\s\S]{0,160}anchor-moved/,
  'REDLEO map must relocate origin on above/left tap');

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
console.log('OK: top-left-first rectangles, free single-cell anchor relocation, and tap-collapse behavior hold.');

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


// Editor capability split: every REDLEO value map gets keypad + floating
// +/-/save controls, but only dense 2D maps get scan/two-corner selection.
must(/function redValueEditorActive\(\)\{return !!\(currentFeature&&currentFeature\.editor!=='fuel'\)\}/,
  'REDLEO value-editor capability missing');
must(/function redFeatureNeedsRangeSelection\(f=currentFeature\)[\s\S]{0,420}f\.rows>1&&f\.cols>1&&\(f\.rows\*f\.cols\)>=100/,
  'range-selection threshold must stay limited to dense 2D maps');
must(/#redleoEditorScreen\.redValueEditor \.redKeypadToggle\{display:grid;place-items:center\}/,
  'keypad toggle must be available on all REDLEO value maps');
must(/#redleoEditorScreen\.redValueEditor\.redMapKeypadOpen \.redKeypad\{display:flex\}/,
  'keypad must open on all REDLEO value maps');
must(/#redleoEditorScreen:not\(\.redRangeEditor\) #redScanToggle\{display:none!important\}/,
  'small REDLEO maps must hide scan control');
must(/function handleRedCornerTap\(r,c\)[\s\S]{0,650}if\(!redRangeEditorActive\(\)\)[\s\S]{0,260}redSel=\{r0:r,c0:c,r1:r,c1:c\}[\s\S]{0,180}return 'single'/,
  'small REDLEO maps must use direct single-cell selection');

// Concrete UX examples: Dwell 1x30 is simple; ECT/IGN compensation 11x30 and
// main 14x30 maps are dense enough to keep scan/two-corner selection.
{
  const needs=(rows,cols)=>rows>1&&cols>1&&(rows*cols)>=100;
  if(needs(1,30)||needs(1,11)||needs(2,15)||needs(4,11)){
    console.error('FAIL: simple/short tables must not enter range-selection mode');
    process.exitCode=1;
  }
  if(!needs(11,30)||!needs(14,30)){
    console.error('FAIL: dense compensation/main maps must retain range selection');
    process.exitCode=1;
  }
}


// Legacy Idle/Limit ECT-motor table lives outside redleoEditorScreen but must
// still receive the same single-cell editing controls.
must(/id="idleEctSelectionPad" class="mapSelectionPad idleEctSelectionPad"/,
  'legacy Idle ECT floating save/+/- pad missing');
must(/id="idleEctKeypadToggle" class="fuelKeypadToggle idleEctKeypadToggle"/,
  'legacy Idle ECT keypad toggle missing');
must(/id="idleEctKeypad" class="fuelKeypad idleEctKeypad"/,
  'legacy Idle ECT keypad missing');
must(/function selectIdleEctCell\(i\)[\s\S]{0,500}idleEctSelected=/,
  'legacy Idle ECT must support direct single-cell selection');
must(/idleEctFloatPlusBtn[\s\S]{0,260}bumpIdleEct\(1\)/,
  'legacy Idle ECT floating plus missing');
must(/idleEctFloatMinusBtn[\s\S]{0,260}bumpIdleEct\(-1\)/,
  'legacy Idle ECT floating minus missing');
must(/idleEctFloatSaveBtn[\s\S]{0,380}idleLimitWriteBtn/,
  'legacy Idle ECT floating save must route to the verified Idle/Limit writer');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: top-left-first rectangles, free single-cell anchor relocation, and tap-collapse behavior hold.');

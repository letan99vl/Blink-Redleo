#!/usr/bin/env node
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync('index.html','utf8');

assert(html.includes("window.BLINK_PB_VERSION = '3.79.77';"));
for (const marker of [
  'id="fuelKeypadSave"',
  'class="fuelTargetSave"',
  '#mapEditorScreen.targetAfrEditor.mapKeypadOpen .fuelKeypad{display:flex}',
  'body.mapZoomMode #mapEditorScreen.targetAfrEditor.mapKeypadOpen #mapWrap',
  'body.appForceLandscape #mapEditorScreen.targetAfrEditor',
  "tab==='target'?'Mở bàn phím nhập AFR mục tiêu'",
  "document.getElementById('mapEditorScreen')?.classList.toggle('targetAfrEditor',tab==='target')",
  "if(state.tab==='target'||(state.tab==='inject'&&window.BlinkFuelKeypad?.preferCustom?.()))",
  "state.tab==='target'?state.target:state.inject",
  "save(); // save local Blink target only; never write REDLEO ECU from this button",
  "if(!targetAfrKeypadEditorActive()||!isEditableTab())return;",
  "hideFuelKeypad();",
  "if(tab==='target') return fmt(Number(v),2);"
]) assert(html.includes(marker),'Missing AFR target feature: '+marker);

// Validate ALL inline JavaScript, not just the ECU protocol file.
let count=0;
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  const body=match[1].trim();
  if (!body) continue;
  new vm.Script(body,{filename:'index.html inline '+(++count)});
}
assert(count>=2,'Blink inline scripts missing');

function section(start,next) {
  const i=html.indexOf(start); assert(i>=0,'Source missing '+start);
  const j=html.indexOf(next,i+start.length); assert(j>i,'End missing '+next);
  return html.slice(i,j);
}
const code=[
  section('function selectedFuelMeta(){','function formatFuelEntry(v){'),
  section('function formatFuelEntry(v){','function syncFuelKeypadSelection('),
  section('function applyFuelKeypadLive(){','function fuelKeypadAppend('),
  section('function fuelKeypadAppend(ch){','function fuelKeypadBackspace()')
].join('\n');
const matrix=(v)=>Array.from({length:3},()=>Array(4).fill(v));
const targetBanks=Array.from({length:4},()=>matrix(13.2));
const fuelBanks=Array.from({length:4},()=>matrix(5.5));
const state={tab:'target',activeMap:1,selection:{active:true,focusR:2,focusC:3}};
Object.defineProperty(state,'target',{get:()=>targetBanks[state.activeMap-1]});
Object.defineProperty(state,'inject',{get:()=>fuelBanks[state.activeMap-1]});
let saveCalls=0,renderCalls=0;
const ctx={
  state,
  fuelKeypadBuffer:'14.25',fuelKeypadDirty:true,
  selectionBounds:()=>({r0:1,r1:2,c0:1,c1:3}),
  virtualKeypadEditorActive:()=>true,
  isEditableTab:()=>true,
  fuelProtocolMaxMs:()=>12.75,
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
  render:()=>renderCalls++,
  saveSoon:()=>saveCalls++,
  $:()=>({textContent:''}),
  requestAnimationFrame:fn=>fn(),
  updateMapSelectionPad:()=>{},
  keepFuelSelectionVisible:()=>{},
  syncFuelKeypadSelection:()=>{}
};
vm.createContext(ctx);
vm.runInContext(code,ctx);

// Fill a selected 2x3 AFR target block; do not alter fuel tables or other banks.
ctx.applyFuelKeypadLive();
for(let r=0;r<3;r++)for(let c=0;c<4;c++) {
  const expected=r>=1&&c>=1?14.25:13.2;
  assert.strictEqual(targetBanks[0][r][c],expected,`Target wrong at ${r},${c}`);
  assert.strictEqual(fuelBanks[0][r][c],5.5,'Keypad must NOT write ECU fuel map');
}
assert.strictEqual(targetBanks[1][1][1],13.2,'Other AFR bank must remain unchanged');
assert.strictEqual(saveCalls,1); assert.strictEqual(renderCalls,1);
assert.strictEqual(ctx.formatFuelEntry(14.25),'14.25');
assert(ctx.selectedFuelMeta().key.startsWith('target:1:'),'Keypad key must include bank and tab');

// AFR target restricted to 30 and two decimal places.
ctx.fuelKeypadBuffer='99';
ctx.applyFuelKeypadLive();
assert.strictEqual(targetBanks[0][1][1],30);
ctx.fuelKeypadBuffer='14.2';ctx.fuelKeypadDirty=true;
ctx.fuelKeypadAppend('5');
assert.strictEqual(ctx.fuelKeypadBuffer,'14.25');
assert.strictEqual(targetBanks[0][1][1],14.25);
ctx.fuelKeypadAppend('9');
assert.strictEqual(ctx.fuelKeypadBuffer,'14.25','More than two decimals must be ignored');
ctx.fuelKeypadBuffer='3';ctx.fuelKeypadDirty=true;
ctx.fuelKeypadAppend('1');
assert.strictEqual(ctx.fuelKeypadBuffer,'3','AFR over 30 must be rejected');

// Auto Tune 3-run locks editing on both pages.
ctx.isEditableTab=()=>false;
ctx.fuelKeypadBuffer='9.9';
ctx.applyFuelKeypadLive();
assert.strictEqual(targetBanks[0][1][1],14.25);
ctx.isEditableTab=()=>true;

// Existing INJ keypad precision and upper bound are unchanged.
state.tab='inject';
ctx.fuelKeypadBuffer='15.888';
ctx.applyFuelKeypadLive();
assert.strictEqual(fuelBanks[0][1][1],12.75);
assert.strictEqual(targetBanks[0][1][1],14.25);
assert.strictEqual(ctx.formatFuelEntry(2.125),'2.125');
assert(ctx.selectedFuelMeta().key.startsWith('inject:1:'));
state.tab='target';state.activeMap=2;
assert(ctx.selectedFuelMeta().key.startsWith('target:2:'),'Bank change must invalidate old keypad buffer');

console.log('PASS AFR target keypad: '+count+' inline scripts, two-decimal entry, safe selection/banks, local persistence, existing INJ semantics');

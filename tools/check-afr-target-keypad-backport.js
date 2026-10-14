#!/usr/bin/env node
'use strict';
// Backport regression, exercise real editor functions rather than UI markers.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const real=fs.readFileSync('redleo_real_protocol.js','utf8');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));
assert(html.includes("window.BLINK_PB_VERSION = '3.79.72'"));
assert(html.includes("window.BLINK_AFR_TARGET_KEYPAD_REVISION = 'AFR-KP1'"));
assert(html.includes("const BLINK_SERVER_OTA_PAUSED=true;"));
assert(manifest.ota_enabled===false&&manifest.version==='0.0.0');
assert(!html.includes("guardControlCommand('RGON')"),'Pre-5s must not have guard control');
assert(!html.includes("guardControlCommand('RGOFF')"));
assert(html.includes('id="afrTargetLocalSaveBtn"'));
assert(html.includes('id="afrTargetKeypadSave"'));
assert(html.includes('targetAfrEditor.mapKeypadOpen .fuelKeypad'));
assert(html.includes('body.appForceLandscape #mapEditorScreen.targetAfrEditor'));
assert(html.includes("document.getElementById('mapEditorScreen')?.classList.toggle('targetAfrEditor',tab==='target')"));
assert(html.includes("if(state.tab==='target'&&saveTargetAfrLocal())hideFuelKeypad()"));
assert(html.includes("const dst=isAfr?state.target:state.inject;"));
assert(html.includes("if(state.tab==='target')return true; // Never request the device keyboard for AFR targets."));
const i=html.indexOf("floatSaveBtn?.addEventListener('click'");
const j=html.indexOf('function refreshFuelEditorGeometry()',i);
assert(i>0&&j>i);
const float=html.slice(i,j);
assert(float.includes("if(state.tab==='target'){"));
assert(float.includes("if(saveTargetAfrLocal())hideFuelKeypad();"));
assert(float.indexOf("if(state.tab==='target'){")<float.indexOf("const btn=document.getElementById('writeMapBtn')"));
for(const hit of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
 if(hit[1].trim())new vm.Script(hit[1],{filename:'Blink pre-5s AFR keypad inline JS'});
}
new vm.Script(real,{filename:'Historical REDLEO protocol'});
function fn(name){
  const needle='function '+name+'(',from=html.indexOf(needle);
  assert(from>=0,'Missing '+name);
  const open=html.indexOf('{',from);
  let depth=0,quoted='',esc=false;
  for(let n=open;n<html.length;n++){
    const c=html[n];
    if(quoted){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===quoted)quoted='';continue;}
    if(c==="'"||c==='"'||c.charCodeAt(0)===96){quoted=c;continue;}
    if(c==='{')depth++;
    else if(c==='}'&&!--depth)return html.slice(from,n+1);
  }
  throw Error('Unterminated '+name);
}
const logs=[],selectionInfo={textContent:''};
const screenClasses=new Set(['active','targetAfrEditor']);
const screen={clientWidth:350,classList:{
 contains:v=>screenClasses.has(v),
 toggle:(v,on)=>on?screenClasses.add(v):screenClasses.delete(v)
}};
const state={tab:'target',threeRun:{active:false},activeMap:1,
 target:[[13.2,13.2],[13.2,13.2]],inject:[[3,4],[5,6]],
 selection:{active:true,focusR:0,focusC:1}
};
let saves=0,renders=0,soon=0;
const ctx={state,window:{},console,
 document:{getElementById(id){if(id==='mapEditorScreen')return screen;
                 if(id==='fuelKeypadToggle')return {setAttribute(){}};
                 return null;},querySelectorAll(){return []}},
 screen,
 selectionBounds:()=>({r0:0,c0:0,r1:1,c1:1}),
 clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),
 fuelProtocolMaxMs:()=>20,
 isEditableTab:()=>!state.threeRun.active&&(state.tab==='inject'||state.tab==='target'),
 requestAnimationFrame:()=>{},updateMapSelectionPad:()=>{},keepFuelSelectionVisible:()=>{},
 render:()=>{renders++},saveSoon:()=>{soon++},save:()=>{saves++},
 flashSave:(...args)=>logs.push(['flash',...args]),
 showEcuNotice:(...args)=>logs.push(['notice',...args]),
 $:id=>id==='selectionInfo'?selectionInfo:null,
 resetQuickType:()=>{},syncMeasuredClearButton:()=>{},
 TPS_ROWS:['100%','50%'],RPMS:[500,1000],
 fuelKeypad:{getAttribute:()=>false},fuelKeypadCell:{textContent:''},
 fuelKeypadValue:{textContent:''},fuelKeypadSelectionKey:'',
 fuelKeypadDirty:false,fuelKeypadBuffer:'14.25'
};
vm.createContext(ctx);
vm.runInContext([
 fn('standaloneFuelEditorActive'),fn('preferCustomFuelKeypad'),
 fn('selectedFuelMeta'),fn('formatFuelEntry'),fn('applyFuelKeypadLive'),
 fn('saveTargetAfrLocal'),fn('setTab'),
 'globalThis.test={standaloneFuelEditorActive,preferCustomFuelKeypad,selectedFuelMeta,formatFuelEntry,applyFuelKeypadLive,saveTargetAfrLocal,setTab};'
].join('\n'),ctx);
assert(ctx.test.standaloneFuelEditorActive());
assert(ctx.test.preferCustomFuelKeypad(),'Target must always use internal keyboard');
assert.strictEqual(ctx.test.selectedFuelMeta().v,13.2);
assert.strictEqual(ctx.test.formatFuelEntry(13.2),'13.2');
ctx.test.applyFuelKeypadLive();
assert.strictEqual(state.target[0][0],14.25);
assert.strictEqual(state.target[1][1],14.25);
assert.strictEqual(state.inject[0][0],3,'AFR keypad cannot overwrite injection map');
assert.strictEqual(state.inject[1][1],6);
assert(soon>0&&renders>0&&selectionInfo.textContent.includes('AFR'));
ctx.fuelKeypadBuffer='100';ctx.test.applyFuelKeypadLive();
assert.strictEqual(state.target[0][0],30,'AFR max clamp 30');
ctx.fuelKeypadBuffer='-10';ctx.test.applyFuelKeypadLive();
assert.strictEqual(state.target[1][0],0,'AFR min clamp 0');
assert.strictEqual(ctx.test.saveTargetAfrLocal(),true);
assert.strictEqual(saves,1,'AFR save must use local Blink save()');
state.threeRun.active=true;
assert.strictEqual(ctx.test.saveTargetAfrLocal(),false,'Active 3-run lock');
assert.strictEqual(saves,1);
state.threeRun.active=false;
ctx.test.setTab('inject');
assert(!screenClasses.has('targetAfrEditor'),'Target styling leaks into INJ VE');
assert.strictEqual(ctx.test.preferCustomFuelKeypad(),false);
screenClasses.add('standaloneFuel');
ctx.test.setTab('inject');
assert(ctx.test.standaloneFuelEditorActive(),'Original INJ VE keypad must work');
ctx.fuelKeypadBuffer='6.789';
ctx.test.applyFuelKeypadLive();
assert.strictEqual(state.inject[0][0],6.789,'Fuel ms precision');
assert.strictEqual(state.target[0][0],0,'Fuel edit cannot mutate AFR targets');
ctx.test.setTab('target');
assert(screenClasses.has('targetAfrEditor'));
assert(ctx.test.preferCustomFuelKeypad());
console.log('PASS pre-5s PB3.79.72: local AFR keypad, multi-cell, bounds, local save, 3-run lock, fuel isolation, tab switching; OTA paused');

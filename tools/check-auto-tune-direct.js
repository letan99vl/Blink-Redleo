#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const html=fs.readFileSync('index.html','utf8');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));
assert(html.includes("window.BLINK_PB_VERSION = '3.79.72'"),'PB3.79.72 rolled-back app must remain');
assert(html.includes("window.BLINK_AUTOTUNE_DIRECT_REVISION = 'AT-DIRECT-1'"),'Missing user-visible route revision');
assert(html.includes("IGN-PC · AT-DIRECT'"),'AT-DIRECT version flag missing');
assert(!html.includes("guardControlCommand('RGON')"),'Do not restore 5-second guard UI');
assert(manifest.ota_enabled===false&&manifest.maintenance===true,'Server OTA must stay disabled');

const navStart=html.indexOf('// Both bottom AUTO TUNE and homepage shortcut enter the AFR map directly.');
const navEnd=html.indexOf("document.querySelectorAll('.mapBankBtn')",navStart);
assert(navStart>=0&&navEnd>navStart,'Dedicated Auto Tune navigation route not found');
const navScript=html.slice(navStart,navEnd);
const makeNav=nav=>({dataset:{nav},click:null,addEventListener(type,handler){assert.strictEqual(type,'click');this.click=handler}});
const buttons=[makeNav('dashboard'),makeNav('maps'),makeNav('tune'),makeNav('ecu'),makeNav('tune')];
const effects=[];
vm.runInNewContext(navScript,{
  document:{querySelectorAll(sel){assert.strictEqual(sel,'[data-nav]');return buttons}},
  openOurEditor(...args){effects.push({kind:'editor',args})},
  showScreen(name){effects.push({kind:'screen',name})}
});
assert(buttons.every(b=>typeof b.click==='function'),'Missing bottom/home navigation listener');
for(const b of buttons.filter(x=>x.dataset.nav==='tune'))b.click();
assert.strictEqual(effects.length,2,'Auto Tune should trigger exactly one open per tap');
for(const result of effects){
  assert.strictEqual(result.kind,'editor','Auto Tune navigates to intermediate tune screen');
  assert.deepStrictEqual(Array.from(result.args),['measured',true,'dashboard'],'Auto Tune must open measured AFR grid and return home');
}
buttons.find(x=>x.dataset.nav==='maps').click();
assert.strictEqual(effects.at(-1).kind,'screen');
assert.strictEqual(effects.at(-1).name,'maps','Other navigation must continue unchanged');

assert(html.includes("let editorReturnScreen='maps',editorNavContext='maps';"),'Separate editor back/selected nav contexts required');
assert(html.includes("editorNavContext=(fromTune||returnScreen==='tune')?'tune':'maps';"),'Tune map must highlight Auto Tune tab');
assert(html.includes("const nav=name==='editor'?editorNavContext:name==='rededitor'?'maps':name;"),'Auto Tune map nav highlight missing');
assert(html.includes("window.hideFuelKeypad?.();showScreen(editorReturnScreen||'maps')"),'Back button not honoring direct navigation to dashboard');
assert(html.includes("id=\"autoTuneQuickBar\""),'Direct editor must expose a recording/3-run bar');
assert(html.includes("id=\"autoTuneQuickRecordBtn\""),'No recording control reachable without intermediary');
assert(html.includes("id=\"autoTuneQuickModeBtn\""),'Optional three-run mode unreachable');
assert(html.includes("document.getElementById('autoTuneQuickRecordBtn')?.addEventListener('click',()=>document.getElementById('recordBtn')?.click())"),'Quick record must reuse guarded original record button');
assert(html.includes("document.getElementById('autoTuneQuickModeBtn')?.addEventListener('click',()=>showScreen('tune'))"),'Optional 3-run controls must remain reachable');
assert(html.includes("quickRec.disabled=state.mode==='three'||state.threeRun.active;"),'Three-run recording quick-control must be gated');
assert(html.includes("body.mapZoomMode #mapEditorScreen .autoTuneQuickBar{display:none!important}"),'Zoom should prioritize table area');
assert(html.includes("editorNavContext=(fromTune||returnScreen==='tune')?'tune':'maps';"),'Navigation highlight must remain stable');

// Exercise the *actual* setRecording implementation to verify the one-tap
// editor button tracks ON/OFF without issuing a write command.
const recordStart=html.indexOf('function setRecording(on){');
const recordEnd=html.indexOf('function afrRunStats(',recordStart);
assert(recordStart>=0&&recordEnd>recordStart,'Cannot locate original recorder');
const recordCode=html.slice(recordStart,recordEnd);
const ui={
  recordBtn:{textContent:'',className:''},
  recordBadge:{textContent:'',className:''},
  autoTuneQuickRecordBtn:{
    textContent:'',
    classes:new Map([['good',true],['danger',false]]),
    get classList(){return {toggle:(key,value)=>this.classes.set(key,value)}}
  }
};
const ctx={state:{recording:false,lastCellKey:null,cellEnteredAt:0},performance:{now:()=>444},
  $:id=>ui[id],document:{getElementById:id=>ui[id]||null}};
vm.runInNewContext(recordCode+'\nthis.testSetRecording=setRecording;',ctx);
ctx.testSetRecording(true);
assert.strictEqual(ui.autoTuneQuickRecordBtn.textContent,'■ DỪNG GHI AFR');
assert.strictEqual(ui.autoTuneQuickRecordBtn.classes.get('danger'),true);
assert.strictEqual(ui.recordBtn.textContent,'Dừng ghi AFR');
ctx.testSetRecording(false);
assert.strictEqual(ui.autoTuneQuickRecordBtn.textContent,'● BẮT ĐẦU GHI AFR');
assert.strictEqual(ui.autoTuneQuickRecordBtn.classes.get('good'),true);

assert(html.includes("if(state.threeRun.active)return;"),'Existing three-run record guard must stay');
assert(html.includes("function startThreeRunSession()"),'Existing 3-run algorithm must remain');
assert(html.includes("function finishThreeRunPass()"),'Existing 3-run step algorithm must remain');
assert(html.includes("function applyCorrectedAndWrite()"),'ECU corrected-map write path must stay');
console.log('PASS Auto Tune direct measured AFR grid: two entry points, 3-run access, recording ON/OFF sync, back navigation, PB3.79.72 and OTA hold');

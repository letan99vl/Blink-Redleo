#!/usr/bin/env node
'use strict';
// User regression: tapping "MAP da bu -> ECU" once previously raised a blue
// waiting-for-ECU status before its confirmation. First click now goes straight
// to confirmation, then runs ONE guarded write + full 420-cell READBACK if approved.
const fs=require('fs'),assert=require('assert'),vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));
function between(s,a,b){
  const i=s.indexOf(a),j=s.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'missing region '+a+' -> '+b);
  return s.slice(i,j);
}

assert(html.includes("window.BLINK_PB_VERSION = '3.79.72'"),'Blink release rollback changed');
assert(html.includes("window.BLINK_CORRECTED_SAVE_REVISION = 'CORR-ONE-TAP-1'"),'corrected-save build marker missing');
assert(html.includes("IGN-PC · AT-DIRECT · CORR-1T"),'corrected-save footer marker missing');
assert(manifest.ota_enabled===false&&manifest.maintenance===true,'ESP32 OTA hold must remain');
assert(src.includes("captureMapIo('applyCorrectedBtn','write'"),'real codec must still own corrected-map control');
assert(src.includes("},'MAP ĐÃ BÙ',{confirmFirst:true});"),'confirmation-first route missing');
assert(src.includes("if(!opts.confirmFirst)taskUi('loading'"),'first click must not raise false blue loading');
assert(src.includes("'tuneApplyCorrectedBtn'"),'intermediate shortcut must be blocked during single-flight write');
assert(html.includes("await startFuelWrite({skipConfirm:true,rollbackMap:baseMap,verifyReadback:true})"),'do not remove 420-cell readback');
assert(html.includes("document.getElementById('tuneApplyCorrectedBtn')?.addEventListener('click'"),'legacy hub redirect must still work');

function fakeButton(id){
  return {id,dataset:{},textContent:id,disabled:false,
    addEventListener(name,fn){if(name==='click')this.clickHandler=fn;},
    animate(){},
    classList:{add(){},remove(){},toggle(){}}
  };
}

async function testCapture({accepted=true,threeRun=false}={}){
  const ids=['readMapBtn','writeMapBtn','applyCorrectedBtn','tuneApplyCorrectedBtn','redReadBtn','redWriteBtn','idleLimitReadBtn','idleLimitWriteBtn'];
  const elements=Object.fromEntries(ids.map(id=>[id,fakeButton(id)]));
  for(const name of ['mapSelect','redBankSelect','idleLimitBankSelect'])elements[name]=fakeButton(name);
  const trace=[];
  let resolveConfirmation;
  const ctx={
    document:{getElementById:id=>elements[id]||null},
    state:{threeRun:{active:threeRun},ecuPhase:'live'},
    performance:{now:()=>100},
    beginManualMapIo:async()=>{trace.push('manual-begin');return {resumeLive:false};},
    endManualMapIo:()=>{trace.push('manual-end')},
    taskUi:(kind,msg)=>trace.push('status:'+kind+':'+msg),
    err:e=>trace.push('error:'+e),
    notice:(kind,title)=>trace.push('notice:'+kind+':'+title),
    applyProfileUi:()=>{},
    console,
  };
  vm.createContext(ctx);
  const source=between(src,'const ECU_MAP_IO_BUTTON_IDS=[','function notice(type,title,detail){');
  vm.runInContext(source+'\nthis.installTestCapture=captureMapIo;',ctx);
  ctx.installTestCapture('applyCorrectedBtn','write',async(_event,beginTransport)=>{
    trace.push('handler');
    if(threeRun){trace.push('three-run-pass');return true;}
    const ok=await new Promise(resolve=>{resolveConfirmation=resolve;});
    if(!ok){trace.push('user-cancel');return false;}
    await beginTransport();
    trace.push('write-once');
    return true;
  },'MAP ĐÃ BÙ',{confirmFirst:true});
  const el=elements.applyCorrectedBtn;
  assert(typeof el.clickHandler==='function','capture handler was not registered');
  const event={preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}};
  const first=el.clickHandler(event);
  assert(trace.includes('handler'),'one tap must invoke corrected-map handler');
  assert(el.disabled,'real source button must lock immediately');
  assert(elements.tuneApplyCorrectedBtn.disabled,'tune hub shortcut must lock immediately');

  if(!threeRun){
    assert(!trace.some(x=>x.startsWith('status:loading')),'blue waiting status must NOT appear before confirmation');
    assert(!trace.includes('manual-begin'),'transport must NOT start before confirmation');
    // Simulate a rapid duplicate click; it must not enqueue a second write.
    const second=el.clickHandler(event);
    await second;
    assert.strictEqual(trace.filter(x=>x==='handler').length,1,'second press must not duplicate transaction');
    resolveConfirmation(accepted);
  }else{
    // The existing three-pass engine must retain manual I/O priority.
    assert(trace.includes('manual-begin'),'3-run must still start manual transport before engine');
  }
  await first;

  if(threeRun){
    assert(trace.includes('three-run-pass'));
    assert(!trace.includes('write-once'));
  }else if(accepted){
    assert(trace.indexOf('manual-begin')>trace.indexOf('handler'),'transport must start after confirmation');
    assert.strictEqual(trace.filter(x=>x==='manual-begin').length,1,'exactly one manual transaction');
    assert.strictEqual(trace.filter(x=>x==='write-once').length,1,'exactly one write');
    assert(trace.some(x=>x.startsWith('status:loading')),'show real waiting only after confirmation');
    assert.strictEqual(trace.filter(x=>x==='manual-end').length,1,'transport must release exactly once');
  }else{
    assert.strictEqual(trace.filter(x=>x==='manual-begin').length,0,'cancel must not touch ECU');
    assert.strictEqual(trace.filter(x=>x==='manual-end').length,0,'cancel must not release an unacquired lock');
    assert(!trace.some(x=>x.startsWith('status:loading')),'cancel must never leave blue spinner');
  }
  for(const btn of Object.values(elements))assert(!btn.disabled,'lock must release button/select '+btn.id);
}

function matrix(value){return Array.from({length:14},()=>Array(30).fill(value));}
function buildEditor(confirmation,change=true){
  const events=[];
  const state={ecuConnected:true,threeRun:{active:false},activeMap:1,
    inject:matrix(2.0),pendingAfrClearMapNo:0,tab:'corrected'};
  const ctx={
    state,R:14,C:30,
    fuelMapSyncUnknown:()=>false,
    inspectFuelMap:()=>({ok:true}),
    cloneMatrix:v=>v.map(row=>row.slice()),
    blankMatrix:matrix,
    num:(x,def)=>{const v=Number(x);return Number.isFinite(v)?v:def;},
    correctedMatrix:()=>{const m=matrix(2.0);if(change)m[0][0]=2.1;return m;},
    blinkConfirm:async()=>{events.push('confirm');return await confirmation(state);},
    showEcuNotice:(kind,title)=>{events.push('notice:'+kind+':'+title);},
    startFuelWrite:async(opts)=>{
      events.push('write');
      assert.strictEqual(opts.skipConfirm,true,'confirmation already happened');
      assert.strictEqual(opts.verifyReadback,true,'corrected map must verify 420 ECU cells');
      assert.strictEqual(state.inject[0][0],2.1,'new map must be staged before write');
      return true;
    },
    saveSoon:()=>{},render:()=>{},alert:msg=>events.push('alert:'+msg),
    finishThreeRunPass:()=>{},
  };
  vm.createContext(ctx);
  const code=between(html,'async function applyCorrectedAndWrite(options={}){','function setRecording(on){');
  vm.runInContext(code+'\nthis.tryCorrectedWrite=applyCorrectedAndWrite;',ctx);
  return {ctx,state,events};
}

(async()=>{
  await testCapture({accepted:true});
  await testCapture({accepted:false});
  await testCapture({threeRun:true});

  {
    const {ctx,state,events}=buildEditor(async()=>true);
    const result=await ctx.tryCorrectedWrite({prepareTransport:async()=>events.push('transport-begin')});
    assert.strictEqual(result,true,'confirmed first tap must finish writing');
    assert.deepStrictEqual(events.slice(0,3),['confirm','transport-begin','write'],
      'confirmation -> ECU transport -> ONE write/readback must all belong to first action');
    assert.strictEqual(state.pendingAfrClearMapNo,1,'AFR clear only after verified writer callback');
  }
  {
    const {ctx,state,events}=buildEditor(async()=>false);
    const result=await ctx.tryCorrectedWrite({prepareTransport:async()=>events.push('transport-begin')});
    assert.strictEqual(result,false);
    assert(!events.includes('transport-begin')&&!events.includes('write'),'cancel must never call ECU');
    assert.strictEqual(state.inject[0][0],2,'cancel must not modify local fuel map');
    assert.strictEqual(state.pendingAfrClearMapNo,0,'cancel must never clear AFR');
  }
  {
    const {ctx,state,events}=buildEditor(async()=>true,false);
    const result=await ctx.tryCorrectedWrite({prepareTransport:async()=>events.push('transport-begin')});
    assert.strictEqual(result,false,'no changed cell must block write');
    assert(!events.includes('confirm')&&!events.includes('transport-begin')&&!events.includes('write'));
    assert(events.some(s=>s.startsWith('notice:info:CHƯA CÓ Ô AFR CẦN BÙ')),
      'no changed cells need explicit reason, not blue loading');
    assert.strictEqual(state.inject[0][0],2);
  }
  {
    const {ctx,state,events}=buildEditor(async(state)=>{state.activeMap=2;return true;});
    const result=await ctx.tryCorrectedWrite({prepareTransport:async()=>events.push('transport-begin')});
    assert.strictEqual(result,false,'map switching mid-confirmation must block');
    assert(!events.includes('transport-begin')&&!events.includes('write'));
    assert.strictEqual(state.pendingAfrClearMapNo,0);
  }
  {
    const {ctx,state,events}=buildEditor(async()=>true);
    await assert.rejects(ctx.tryCorrectedWrite({prepareTransport:async()=>{throw Error('BLE offline')}}),/BLE offline/);
    assert.strictEqual(state.inject[0][0],2,'transport acquisition failure must not stage corrected map');
    assert.strictEqual(state.pendingAfrClearMapNo,0);
    assert(!events.includes('write'));
  }
  console.log('PASS corrected map first tap: confirm before BLE, no phantom blue spinner, one write+readback, button locks, cancel/no-delta/map-change/BLE-failure safety, 3-run unchanged, PB3.79.72 and OTA hold');
})().catch(e=>{console.error(e);process.exitCode=1;});

#!/usr/bin/env node
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('index.html','utf8');
const real=fs.readFileSync('redleo_real_protocol.js','utf8');
assert(html.includes("window.BLINK_PB_VERSION = '3.79.78'"));
assert(html.includes('id="ecuAuthNotice"'));
assert(html.includes('id="retryEcuAuthBtn"'));
assert(html.includes("state.ecuConnected=!!on;state.ecuPhase=on?'ble-linked':'idle'"));
assert(html.includes("ĐANG XÁC THỰC ECU 0x5A"));
assert(html.includes("FW2.3 RG? is deliberately not sent during the first 0x5A exchange."));
const idx=html.indexOf('async function connectBle(){');
const end=html.indexOf('function onDisconnected(){',idx);
const connect=html.slice(idx,end);
const bridgeProbe=connect.indexOf('await configureFastBridgeTx(bridgeFw)');
const exposeRaw=connect.indexOf('window.blinkCommandChar=commandChar');
assert(bridgeProbe>=0&&exposeRaw>bridgeProbe,'BLE RAW characteristics exposed before bridge probes complete');
assert(!connect.includes("setEcuTaskStatus('success','ECU ĐÃ KẾT NỐI · OK')"),'Premature ECU success before handshake');
assert(!connect.includes("writeBridgeControl('RG?')"),'RG control races ECU handshake');
assert(real.includes("setProfileDisabled(el,!supported"),'ECU profile safety gate removed');
assert(real.includes("el.style.display=(pending||supported)?'':'none';"),'Unknown profile safety gate changed');
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
 if(m[1].trim())new vm.Script(m[1],{filename:'Blink inline script'});
}
new vm.Script(real,{filename:'redleo_real_protocol.js'});

const begin=real.indexOf('function boot(){');
const stop=real.indexOf('window.BlinkRealProtocol=',begin);
assert(begin>0&&stop>begin,'Boot procedure not available');
const bootOnly=real.slice(begin,stop);
async function checkAuthScenario(shouldInitiallyFail){
  const timers=new Map(),intervals=[];
  let currentTimer=0,fail=shouldInitiallyFail,authorized=false;
  let commands=0,profileUiApplied=0;
  const messages=[];
  let cc={id:'command'},mc={id:'map'};
  const elements={};
  for(const id of ['ecuAuthNotice','ecuAuthNoticeText','retryEcuAuthBtn']){
    elements[id]={style:{display:'none'},textContent:'',disabled:false,listeners:{},
      addEventListener(type,fn){this.listeners[type]=fn;}};
  }
  const ctx={
    console,
    cmdChar:()=>cc,mapChar:()=>mc,
    installUI(){},applyProfileUi(){profileUiApplied++},
    installRawListener(){return true},installAfrListener(){},
    abortRawTransport(){authorized=false},
    initializeRealSession:async()=>{
      commands++;
      if(fail)throw new Error('ECU timeout 0x5A / 0x69 no frame');
      authorized=true;
      return {firmware:'9.13'};
    },
    profileCap:()=>authorized,
    ecuProfile:{key:'MODERN_V9',label:'REDLEO 9.13'},
    handshakeInfo:{firmware:'9.13'},
    sessionInitPromise:null,transportCmdChar:null,transportMapChar:null,installedChar:null,
    otaPaused:false,
    notice(type,title,detail){messages.push({type,title,detail})},
    taskUi(type,text){messages.push({type,text})},
    log(){},err(){},
    state:{ecuPhase:'ble-linked'},
    window:{addEventListener(){},blinkOtaTransferActive:()=>false},
    document:{getElementById(id){return elements[id]||null},addEventListener(){} ,hidden:false},
    setTimeout(fn,ms){const id=++currentTimer;timers.set(id,{fn,ms});return id},
    clearTimeout(id){timers.delete(id)},
    setInterval(fn){intervals.push(fn);return 1},
  };
  vm.createContext(ctx);
  vm.runInContext(bootOnly+'\nboot();',ctx,{filename:'auth-only.js'});
  assert.strictEqual(intervals.length,1);
  intervals[0](); // BLE command/map characteristics appear
  async function fireTimer(ms){
    const [id,t]=[...timers].find(([_,t])=>t.ms===ms)||[];
    assert(t,'Missing timer '+ms+'ms; pending: '+JSON.stringify([...timers].map(([_,x])=>x.ms)));
    timers.delete(id);t.fn();
    for(let i=0;i<9;i++)await Promise.resolve();
  }
  await fireTimer(380); // begin one ECU identification
  const banner=elements.ecuAuthNotice,button=elements.retryEcuAuthBtn;
  if(shouldInitiallyFail){
    assert.strictEqual(authorized,false,'Failed handshake must never authorize ECU');
    assert.strictEqual(ctx.state.ecuPhase,'auth-failed');
    assert(banner.style.display!=='none','Failed handshake banner missing');
    assert(elements.ecuAuthNoticeText.textContent.includes('CHƯA XÁC THỰC'),'Failure not explained');
    assert(ctx.window.blinkLastEcuAuthError.includes('timeout 0x5A'),'Missing real ECU failure reason');
    assert.strictEqual(commands,1);
    assert(timers.size===1,'Expected bounded retry after failed handshake');
    fail=false;
    assert.strictEqual(ctx.window.blinkRetryEcuAuth(),true,'Manual retry not wired');
    for(let i=0;i<8;i++)await Promise.resolve();
    assert.strictEqual(authorized,true,'Manual 0x5A recovery failed');
    assert.strictEqual(banner.style.display,'none','Successful ECU auth did not clear banner');
    assert.strictEqual(commands,2,'Manual retry sent unexpected duplicate commands');
    assert.strictEqual(timers.size,0,'Stale auto retry not canceled');
  }else{
    assert.strictEqual(authorized,true,'Success case did not authorize known ECU profile');
    assert.strictEqual(banner.style.display,'none');
    assert.strictEqual(commands,1);
    assert.strictEqual(timers.size,0,'Success scheduled unnecessary retry');
  }
  assert(profileUiApplied>0,'Profile UI not applied');
  assert(messages.some(x=>String(x.text||'').includes('0x5A')),'No user-visible handshake stage');
}
(async()=>{
 await checkAuthScenario(false);
 await checkAuthScenario(true);
 console.log('PASS PB3.79.78 ECU: bridge probes finish before RAW 0x5A; no fake BLE authorization; retry recovers; UNKNOWN profile tiles/writes stay locked');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});

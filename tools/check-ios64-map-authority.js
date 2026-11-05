#!/usr/bin/env node
'use strict';
// Offline iOS64 remote protocol regression. No physical ECU, serial, or BLE I/O.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const p=fs.readFileSync('ios/BlinkRedleo/Web/redleo_real_protocol.js','utf8');
const ui=fs.readFileSync('ios/BlinkRedleo/Web/index.html','utf8');
const native=fs.readFileSync('ios/BlinkRedleo/MainViewController.swift','utf8');
new vm.Script(p,{filename:'ios64-remote-protocol.js'});
assert(p.includes("IOS64-MAP-ECU5A-NO-AUTO1-20261106"));
assert(!p.includes('rawExchange(req5(0x69,1),8000)'),
 'failed 0x5A must not transmit 0x69 MAP1 probe');
assert(/function startLiveLoop\(\)\{\s*if\(!blinkIosHasVerifiedMap\(\)\)return/.test(p),
 'LIVE requires fresh ECU MAP authorization');
assert(/const mapNo=\(ecuProfile&&ecuProfile\.family==='v8'\)/.test(p),
 'modern live must use authorized ECU/user bank not bridge A1');
assert(/info\.activeMap=a\.length>=37&&a\[33\]<=3\?a\[33\]\+1:null/.test(p),
 'byte33 0..3 must be validated, not clamped');
assert(ui.includes('if(m>=1&&m<=4&&m!==state.activeMap'),
 'fixture must represent pre-existing IPA A1 overwrite');
assert(native.includes('ios-hybrid-fallback/ios/BlinkRedleo/Web/redleo_real_protocol.js'),
 'remote URL must remain compatible with installed IPA');
assert(native.includes('cachePolicy: .reloadIgnoringLocalCacheData'));
const init=p.indexOf('function classNameFromCode(n){');
const stop=p.indexOf('function syncHandshakeInfo(info){',init);
assert(init>=0&&stop>init);
const body=p.slice(init,stop);
const dropdown={value:'1'},handlers={},tasks=[];
const state={activeMap:2,ecuConnected:true,ecuPhase:'live'};
const raw=new Uint8Array(37);raw[0]=0x5A;raw[33]=1;raw[36]=0xA5;
const ctx={window:{},state,handshakeInfo:{raw,activeMap:2},
  ecuProfile:{family:'modern'},transportEpoch:7,
  document:{
    getElementById:id=>id==='mapSelect'?dropdown:null,
    addEventListener:(type,fn)=>{handlers[type]=fn}
  },
  setTimeout:fn=>{tasks.push(fn);return tasks.length},
  log:()=>{},normalizeBankForProfile:n=>n};
vm.createContext(ctx);
vm.runInContext(body,ctx);
vm.runInContext('blinkIosMapEpoch=7;blinkIosLiveBank=2;blinkIosInstallMapGuard();',ctx);
assert.equal(vm.runInContext('blinkIosHasVerifiedMap()',ctx),true);
state.activeMap=1; // simulate bundled IPA's obsolete A1 telemetry MAP1
assert.equal(state.activeMap,2,'bridge MAP1 must not override verified ECU MAP2');
for(const t of tasks.splice(0))t();
assert.equal(dropdown.value,'2','repair old bundled IPA dropdown');
handlers.click({target:{closest:()=>({dataset:{mapbank:'3'}})}});
state.activeMap=3; // explicit real UI click, not unsolicited bridge write
assert.equal(state.activeMap,3,'user must still be able to select MAP3');
assert.equal(vm.runInContext('blinkIosLiveBank',ctx),3);
state.activeMap=1;
assert.equal(state.activeMap,3,'bridge A1 must not revert MAP3 after user selection');
vm.runInContext('blinkIosMapEpoch=-1',ctx);
assert.equal(vm.runInContext('blinkIosHasVerifiedMap()',ctx),false,
 'reconnect must invalidate previous 0x5A MAP authority');
const a=p.indexOf('function parseHandshake(a){');
const b=p.indexOf('function classNameFromCode(n){',a);
assert(a>=0&&b>a);
const parserCtx={Uint8Array,Number,
 validFrame:f=>f.length>=3&&f[0]===0x5A&&f[f.length-1]===0xA5&&
   f.slice(0,-2).reduce((sum,v)=>(sum+v)&255,0)===f[f.length-2],
 findValidCommandFrame:()=>null,ascii:()=>'',clamp:(v,a,b)=>Math.max(a,Math.min(v,b))};
vm.createContext(parserCtx);
vm.runInContext(p.slice(a,b),parserCtx);
function frame(bank,len=37){
 const f=new Uint8Array(len);f[0]=0x5A;if(len>33)f[33]=bank;
 f[len-1]=0xA5;f[len-2]=f.slice(0,-2).reduce((sum,v)=>(sum+v)&255,0);return f;
}
for(let bank=0;bank<=3;bank++){
 parserCtx.frame=frame(bank);
 assert.equal(vm.runInContext('parseHandshake(frame).activeMap',parserCtx),bank+1);
}
for(const len of [9,35,36]){
 parserCtx.frame=frame(0,len);
 assert.equal(vm.runInContext('parseHandshake(frame).activeMap',parserCtx),null);
}
parserCtx.frame=frame(8);
assert.equal(vm.runInContext('parseHandshake(frame).activeMap',parserCtx),null);
console.log('PASS iOS64: original 9.2 ECU MAP1..4, short/invalid 0x5A fail-closed, bridge A1 ignored, user MAP3 accepted.');

#!/usr/bin/env node
'use strict';
// Test actual Blink FW2.4 guard and RAW GATT locking code, without physical ECU.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const {performance}=require('perf_hooks');
const raw=fs.readFileSync('redleo_real_protocol.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const between=(s,a,b)=>{
 const i=s.indexOf(a),j=s.indexOf(b,i+1);
 assert(i>=0&&j>i,'Missing source anchors: '+a);
 return s.slice(i,j);
};
const pb=html.match(/window\.BLINK_PB_VERSION = '3\.79\.(\d+)'/);
assert(pb && Number(pb[1])>=81,'GATT-lock test requires Blink PB3.79.81 or newer');
assert(raw.includes('if(!cmdChar()||busy||bridgeControlReserved||document.hidden)return;'));
assert(raw.includes('if(bridgeControlReserved || manualMapIoDepth>0)return;'));
const control=between(raw,'async function beginBridgeGuardControl(','let manualMapIoDepth=0;');
const acquire=between(raw,'async function acquireEcuTransaction(','async function writeRawBleChunk(');
const setup=[
 'let bridgeControlReserved=false,bridgeControlToken=0,manualMapIoDepth=0;',
 'let manualMapIoResumeLive=false,sessionInitPromise=null,busy=false;',
 'let transportEpoch=1,otaPaused=false,liveRunning=true,liveResumeTimer=null;',
 'let handshakeInfo={},connected=true,resumes=0;',
 'function cmdChar(){return connected?{}:null}',
 'function mapChar(){return connected?{}:null}',
 'function stopLiveLoop(){liveRunning=false;liveResumeTimer=null}',
 'function scheduleLiveResume(_ms){resumes++;liveRunning=true}',
 'function profileCap(_name){return true}',
].join('\n');
const exposed=[
 'globalThis.test={',
 'beginBridgeGuardControl,endBridgeGuardControl,acquireEcuTransaction,',
 'busy(v){if(v!==undefined)busy=v;return busy},',
 'depth(v){if(v!==undefined)manualMapIoDepth=v;return manualMapIoDepth},',
 'reserved(){return bridgeControlReserved},',
 'epoch(v){if(v!==undefined)transportEpoch=v;return transportEpoch},',
 'token(v){if(v!==undefined)bridgeControlToken=v;return bridgeControlToken},',
 'resumed(){return resumes},live(){return liveRunning},manualResume(){return manualMapIoResumeLive},',
 'session(v){sessionInitPromise=v},',
 'reset(){busy=false;bridgeControlReserved=false;manualMapIoDepth=0;sessionInitPromise=null;connected=true;liveRunning=true;manualMapIoResumeLive=false}',
 '};'
].join('\n');
const ctx=vm.createContext({setTimeout,clearTimeout,performance,console,window:{blinkOtaTransferActive:()=>false}});
vm.runInContext([setup,control,acquire,exposed].join('\n'),ctx);
const T=ctx.test,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function checkTransport(){
 T.reset();T.busy(true);
 const pending=T.beginBridgeGuardControl(2000);
 await sleep(45);assert(T.reserved());assert(!T.live());
 let rawGranted=false;
 const next=T.acquireEcuTransaction(2000).then(()=>{rawGranted=true});
 await sleep(35);assert(!rawGranted);
 T.busy(false);const lease=await pending;
 await sleep(35);assert(!rawGranted);
 T.endBridgeGuardControl(lease);
 await next;assert(rawGranted);T.busy(false);
 assert(T.resumed()>0,'Live resume not scheduled');
 T.reset();T.depth(1);
 const blocked=T.beginBridgeGuardControl(2000);
 await sleep(65);assert(!T.reserved(),'Interrupting manual map write');
 T.depth(0);T.endBridgeGuardControl(await blocked);
 T.reset();T.session(Promise.resolve());
 const handshaking=T.beginBridgeGuardControl(2000);
 await sleep(65);assert(!T.reserved(),'Interrupting ECU 0x5A');
 T.session(null);T.endBridgeGuardControl(await handshaking);
 T.reset();const oldLease=await T.beginBridgeGuardControl(2000);
 T.epoch(T.epoch()+1);T.token(T.token()+1);
 T.endBridgeGuardControl(oldLease);
 assert(T.reserved(),'Stale lease unlocked new session');
 T.reset();const lease2=await T.beginBridgeGuardControl(2000);
 T.depth(1);T.endBridgeGuardControl(lease2);
 assert(T.manualResume(),'Lost Live restart after overlapping manual map');
 T.depth(0);
}
const uiCode=between(html,'let guardControlInFlight=false;',"$('rgReadBtn')?.addEventListener");
const elements=new Map();
for(const id of ['rgStatus','rgReadBtn','rgEnableBtn','rgDisableBtn','otaScanBtn','otaCheckBtn','otaInstallBtn'])
 elements.set(id,{disabled:id==='otaInstallBtn',dataset:{},value:''});
let commands=[],errors=[],leases=0,collisions=2,alwaysFail=false;
const bridge={async beginBridgeGuardControl(){leases++;return {valid:true}},
 endBridgeGuardControl(lease){assert(lease.valid);leases--}};
const ui=vm.createContext({window:{BlinkRealProtocol:bridge},state:{ecuConnected:true},
 commandChar:{},otaBleTransferActive:false,$:id=>elements.get(id)||null,
 ensureBridgeFirmwareStatus:async()=> 'PONG FW2.4',
 bridgeStatusAtLeast:(v,a,b)=>v.includes('2.4')&&a===2&&b===4,
 writeBridgeControl:async a=>{
   commands.push(a);
   if(alwaysFail||(collisions-->0))throw Error('GATT operation already in progress.');
 },
 showEcuNotice:(...args)=>errors.push(args),setTimeout,console});
vm.runInContext(uiCode+'\nglobalThis.guards={run:guardControlCommand,busy:()=>guardControlInFlight}',ui);
async function checkUi(){
 const first=ui.guards.run('RG?'),dup=ui.guards.run('RG?');
 assert(ui.guards.busy());await Promise.all([first,dup]);
 assert.deepStrictEqual(commands,['RG?','RG?','RG?']);
 assert.strictEqual(errors.length,0,'Transient GATT should recover');
 assert.strictEqual(leases,0,'BLE lease leaked');
 assert(elements.get('otaInstallBtn').disabled,'OTA button previous state lost');
 assert(!elements.get('rgReadBtn').disabled);
 commands=[];collisions=0;await ui.guards.run('RGON');
 assert.deepStrictEqual(commands,['RGON','RG?'],'RGON must read back RG state');
 commands=[];errors=[];alwaysFail=true;await ui.guards.run('RG?');
 assert.strictEqual(commands.length,4,'Retries must be bounded');
 assert.strictEqual(leases,0);
 assert(elements.get('rgStatus').value.includes('BLUETOOTH GATT'));
 assert(errors.some(a=>String(a[2]).includes('KHÔNG phải ECU bận')));
}
(async()=>{await checkTransport();await checkUi();
 console.log('PASS PB3.79.81 GATT reservation, handshake/manual priority, bounded retry, truthful UI');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});

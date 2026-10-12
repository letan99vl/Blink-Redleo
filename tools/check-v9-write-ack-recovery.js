#!/usr/bin/env node
'use strict';

// No hardware is involved. This verifies safety-critical write decisions and
// the 420-byte half-map comparison after a lost REDLEO V9 0xCD acknowledgement.
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');

assert(src.includes("window.BLINK_REAL_PROTOCOL_BUILD='WR74-READBACK-V9';"));
const found=src.match(/async function readFuelHalfForAckRecovery\(bank,half,payload\)\{[\s\S]*?\n}\nasync function writeFuelBank\(bank\)\{[\s\S]*?\n}\nasync function readCurrentFuelBankRetry\(bank\)\{/);
assert(found,'Unable to extract real half-map recovery and V9 writer');
const snippet=found[0].replace(/\nasync function readCurrentFuelBankRetry\(bank\)\{$/,'');
assert(!snippet.includes('isBlinkNativeAndroidClient'), 'V9 recovery must not depend on APK userAgent');

function harness(opts={}){
  const wire=new Uint8Array(840);
  const attempts=[],reads=[];
  const map=Array.from({length:14},()=>Array(30).fill(3.5));
  let firstPageCalls=0;
  const ctx={
    state:{ecuPhase:'live',mapBanks:[{inject:map}]},
    ecuProfile:{key:opts.profile||'MODERN_V9',family:'modern'},
    requireProfile:()=>{},
    normalizeBankForProfile:n=>n,
    pageLow:()=>2,
    page:(n)=>((n<<4)|2),
    taskUi:()=>{},
    bridgeFirmwareAtLeast:()=>true,
    log:()=>{},
    cmdChar:()=>true,
    mapChar:()=>true,
    encOilTab:v=>Math.round(Number(v)*500),
    push16be:(arr,v)=>{arr.push((v>>8)&255,v&255);},
    writePageChecked:async(pg,payload,full,retries,cap,forceSafe)=>{
      attempts.push({pg,retries,forceSafe:!!forceSafe,bytes:payload.length});
      if(pg===0x12){
        firstPageCalls++;
        if(opts.lostAck&&firstPageCalls===1){
          if(opts.committedDespiteMissingAck)wire.set(payload,0);
          throw new Error('ECU timeout cmd 0xCD sau khi TX xong · bridge khong tra RAW_RX');
        }
        if(opts.retryFails&&firstPageCalls===2){
          throw new Error('ECU timeout cmd 0xCD sau khi TX xong');
        }
      }
      wire.set(payload,pg===0x12?0:420);
    },
    exchangePage9A:async(pg,label,tries,settle,timeout,show,valid)=>{
      reads.push(pg);
      if(opts.readFails)throw new Error('ECU readback unavailable');
      const dummy=new Uint8Array([0x12]);
      if(typeof valid==='function')valid(dummy);
      return dummy;
    },
    parseCurrentFuelFrame:()=>({rawPayload:wire.slice()}),
    Uint8Array,Number,Array,Error,String,Promise,setTimeout,Math,console
  };
  vm.createContext(ctx);
  vm.runInContext(snippet,ctx);
  return {ctx,wire,attempts,reads};
}

async function main(){
  const a=harness();
  const normal=await a.ctx.writeFuelBank(1);
  assert.strictEqual(normal.recoveredHalves,0);
  assert.deepStrictEqual(a.attempts.map(x=>x.pg),[0x12,0x13]);
  assert.strictEqual(a.reads.length,0,'Good ACK path must not add readback');

  const b=harness({lostAck:true,committedDespiteMissingAck:true});
  const lost=await b.ctx.writeFuelBank(1);
  assert.strictEqual(lost.recoveredHalves,1,'Missing BLE ACK but identical ECU bytes must be accepted');
  assert.deepStrictEqual(b.attempts.map(x=>x.pg),[0x12,0x13],'Do not blindly repeat a page if it is already written');
  assert.strictEqual(b.reads.length,1);

  const c=harness({lostAck:true});
  const retried=await c.ctx.writeFuelBank(1);
  assert.strictEqual(retried.recoveredHalves,1);
  assert.deepStrictEqual(c.attempts.map(x=>x.pg),[0x12,0x12,0x13]);
  assert(c.attempts[1].forceSafe,'Only the second verified-mismatch write must use safe 13B pacing');
  assert.strictEqual(c.reads.length,2);

  const d=harness({lostAck:true,retryFails:true});
  await assert.rejects(()=>d.ctx.writeFuelBank(1),/WR74\/CD12.*ghi chậm vẫn lệch/);
  assert.deepStrictEqual(d.attempts.map(x=>x.pg),[0x12,0x12],'Stop before writing second half if first half is unknown');

  const e=harness({lostAck:true,readFails:true});
  await assert.rejects(()=>e.ctx.writeFuelBank(1),/WR74\/CD12.*READBACK không thành công/);
  assert.deepStrictEqual(e.attempts.map(x=>x.pg),[0x12],'No blind retry when readback itself fails');

  const f=harness({profile:'MODERN_V10'});
  await f.ctx.writeFuelBank(1);
  assert.deepStrictEqual(f.attempts.map(x=>x.retries),[1,1],'Non-V9 builds keep original retry path');
  assert.strictEqual(f.reads.length,0);

  const g=harness();
  const upper=new Uint8Array(420).fill(77);
  g.wire.set(upper,420);
  const upperGood=await g.ctx.readFuelHalfForAckRecovery(1,1,upper);
  assert.strictEqual(upperGood.matches,true,'Second half must compare bytes 420..839');
  g.wire[2]^=1; // lower-half difference should be irrelevant to the upper comparison
  assert.strictEqual((await g.ctx.readFuelHalfForAckRecovery(1,1,upper)).matches,true);
  g.wire[421]^=1;
  assert.strictEqual((await g.ctx.readFuelHalfForAckRecovery(1,1,upper)).matches,false);

  console.log('PASS: WR74 V9 ACK recovery: normal, missing ACK/committed, one safe retry, two hard stops, non-V9, half offset');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

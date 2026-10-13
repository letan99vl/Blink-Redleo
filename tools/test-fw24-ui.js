#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert'),vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const fw=fs.readFileSync('firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino','utf8');
const handoff=fs.readFileSync('BLINK_FW23_REDLINE_GUARD_HANDOFF.md','utf8');
assert(html.includes("window.BLINK_PB_VERSION = '3.79.78'"));
for(const token of ['id="redlineGuardSettings"','id="rgReadBtn"','id="rgEnableBtn"',
  'id="rgDisableBtn"',"guardControlCommand('RGON')","guardControlCommand('RGOFF')",
  'RG:TRIP:M4','id="otaRollbackFw22Btn"',
  "sha256:'ce18b7d20e6cee223bda4f29b2932d9d236f3f2181fbc209a740015ebda25c8e'"])
  assert(html.includes(token),'Blink UI missing '+token);
for(const token of ['#define FW_VERSION "2.4"','namespace BlinkGuard {',
  'namespace BlinkAutoPins {','{{22,23},{26,33}}',
  'transactUartAutopin(txBuf, n, rxBuf, RX_MAX);',
  'guardAutonomousTick();','guardObserveHostTransaction(txBuf,n,rxBuf,got);',
  'guardEnabled=p.getBool("enabled",false);','guardLatched || guardPending',
  'if(n>0 && (txBuf[0]==0xCD || txBuf[0]==0x8B))',
  'guardLastValidRpmMs','if (ecuUartConfirmed) return got;'])
  assert(fw.includes(token),'FW2.4 missing '+token);
assert(!fw.includes('#include "redline_guard_core.h"'));
assert(!fw.includes('#include "blink_autopin_core.h"'));
const txn=fw.slice(fw.indexOf('static void processTransaction()'), fw.indexOf('static void sendAfrPacket()'));
assert(txn.includes('uint8_t *rxBuf = (uint8_t *)malloc(RX_MAX);'));
assert(txn.indexOf('if(guardEnabled && (guardLatched || guardPending || guardFault))') <
       txn.indexOf('uint8_t *rxBuf = (uint8_t *)malloc(RX_MAX);'),
       'Blocked ECU writes must not leak the 12KB receive buffer');
assert(fw.includes('BlinkAutoPins::normalizeHandshake'));
assert(fw.includes('BlinkAutoPins::normalizeLive'));
assert(fw.includes('HOLD_MS = 5000U'));
assert(handoff.includes('MAP 4'));
const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let scripts=0;
for (const hit of html.matchAll(re)) {
  if (!hit[1].trim()) continue;
  scripts++;
  new vm.Script(hit[1],{filename:'Blink inline script '+scripts});
}
assert(scripts>=2);
console.log('PASS: '+scripts+' inline Blink scripts; FW2.4 compatibility and no extra .h required');

#!/usr/bin/env node
'use strict';

// Production FW2.5 source regression, independent of Blink's optional
// 5-second guard UI. The released Blink PB3.79.72 deliberately omits RGON
// controls, but the FW2.5 source still contains its hardware safety logic.
// FW2.2 must stay an original, separate, unmodified legacy source.
const fs=require('fs');
const assert=require('assert');
const fw22=fs.readFileSync('firmware/2.2.ino','utf8');
const fw25=fs.readFileSync('firmware/2.5.ino','utf8');
const html=fs.readFileSync('index.html','utf8');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));

assert(/^#define FW_VERSION "2\.2"$/m.test(fw22),'FW2.2 version tag changed');
assert(/^#define ECU_RX_PIN 22$/m.test(fw22),'FW2.2 original RX22 changed');
assert(/^#define ECU_TX_PIN 23$/m.test(fw22),'FW2.2 original TX23 changed');
for(const needle of ['namespace BlinkGuard {','namespace BlinkGuardArm {','guardAutonomousTick();']){
  assert(!fw22.includes(needle),'FW2.2 must not inherit FW2.5 guard code: '+needle);
}

for(const needle of [
 '#define FW_VERSION "2.5"',
 'namespace BlinkGuard {',
 'namespace BlinkGuardArm {',
 'namespace BlinkAutoPins {',
 '{{22,23},{26,33}}',
 'transactUartAutopin(txBuf, n, rxBuf, RX_MAX);',
 'guardAutonomousTick();',
 'guardObserveHostTransaction(txBuf,n,rxBuf,got);',
 'guardEnabled=p.getBool("enabled",false);',
 'guardLatched || guardPending',
 'if(n>0 && (txBuf[0]==0xCD || txBuf[0]==0x8B))',
 'guardLastValidRpmMs',
 'if (ecuUartConfirmed) return got;',
 'guardTryArm(); // Runs even while normal protection is OFF, only after RGON.',
 'if(guardArmPending)guardArmProof.observe(guardLastValidRpmMs,rpm);',
 'BlinkGuard::parseHandshake(rx,n,ident)',
 'if(guardArmIdentityValidated && guardSupported && guardArmProof.ready(now))',
 'guardEnabled=true;',
 'guardStoreEnabled(true);',
 'guardControlRequest=1;',
 'notifyStatus("RG:CHECK");',
 'guardArmProof.reset();',
 'HOLD_MS = 5000U'
]){
  assert(fw25.includes(needle),'FW2.5 original guard invariant changed: '+needle);
}
const callbackStart=fw25.indexOf('if (text == "RG?" || text == "RGON" || text == "RGOFF")');
const callbackEnd=fw25.indexOf('if (text == "PING")');
assert(callbackStart>=0&&callbackEnd>callbackStart,'FW2.5 BLE guard command parser missing');
const callback=fw25.slice(callbackStart,callbackEnd);
assert(!callback.includes('guardEnabled=true;')&&!callback.includes('guardStoreEnabled(true);'),
  'BLE callback cannot arm guard without ECU zero-RPM proof');

const handlerStart=fw25.indexOf('static void guardHandleControlRequest()');
const handlerEnd=fw25.indexOf('uint8_t otaBuf[');
assert(handlerStart>=0&&handlerEnd>handlerStart,'FW2.5 deferred guard handler missing');
const handler=fw25.slice(handlerStart,handlerEnd);
assert(!handler.includes('guardEnabled=true;')&&!handler.includes('guardStoreEnabled(true);'),
  'RGON request cannot immediately persist protection');
assert(fw25.indexOf('guardArmIdentityValidated && guardSupported && guardArmProof.ready(now)')<
       fw25.indexOf('guardStoreEnabled(true);'),
       'Protection must be proven at zero RPM before storing ON');

const txStart=fw25.indexOf('static void processTransaction()');
const txEnd=fw25.indexOf('static void sendAfrPacket()');
assert(txStart>=0&&txEnd>txStart,'FW2.5 ECU transaction handler missing');
const tx=fw25.slice(txStart,txEnd);
assert(tx.includes('uint8_t *rxBuf = (uint8_t *)malloc(RX_MAX);'),'ECU RX buffer missing');
assert(tx.indexOf('if(guardEnabled && (guardLatched || guardPending || guardFault))')<
       tx.indexOf('uint8_t *rxBuf = (uint8_t *)malloc(RX_MAX);'),
       'Blocked writes must not allocate 12 KB ECU RX buffer');

assert(!fw25.includes('#include "redline_guard_core.h"'));
assert(!fw25.includes('#include "blink_autopin_core.h"'));
assert(html.includes("window.BLINK_PB_VERSION = '3.79.72'"),
  'Blink must remain at the requested pre-5s app version');
assert(!html.includes("guardControlCommand('RGON')"),
  'Do not accidentally restore 5s guard UI');
assert(manifest.ota_enabled===false&&manifest.maintenance===true&&manifest.version==='0.0.0',
  'Server OTA must remain on hold');
console.log('PASS FW2.2 original RX22/TX23 source, FW2.5 original safe guard logic, PB3.79.72 and OTA hold');

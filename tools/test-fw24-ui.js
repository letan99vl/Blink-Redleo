#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert'),vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const fw=fs.readFileSync('firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino','utf8');
const handoff=fs.readFileSync('BLINK_FW23_REDLINE_GUARD_HANDOFF.md','utf8');
assert(html.includes("window.BLINK_PB_VERSION = '3.79.83'"));
for(const token of ['id="redlineGuardSettings"','id="rgReadBtn"','id="rgEnableBtn"',
  'id="rgDisableBtn"',"guardControlCommand('RGON')","guardControlCommand('RGOFF')",
  'RG:TRIP:M4'])
  assert(html.includes(token),'Blink UI missing '+token);
for(const token of ['#define FW_VERSION "2.6"','namespace BlinkGuard {',
  'namespace BlinkAutoPins {','{{22,23},{26,33}}',
  'transactUartAutopin(txBuf, n, rxBuf, RX_MAX);',
  'guardAutonomousTick();','guardObserveHostTransaction(txBuf,n,rxBuf,got);',
  'guardEnabled=p.getBool("enabled",false);','guardLatched || guardPending',
  'if(n>0 && (txBuf[0]==0xCD || txBuf[0]==0x8B))',
  'guardLastValidRpmMs','if (ecuUartConfirmed) return got;'])
  assert(fw.includes(token),'FW2.4 missing '+token);
for(const token of ['namespace BlinkGuardArm {','guardTryArm(); // Runs even while normal protection is OFF, only after RGON.',
  'if(guardArmPending)guardArmProof.observe(guardLastValidRpmMs,rpm);',
  'BlinkGuard::parseHandshake(rx,n,ident)', 'guardArmIdentityValidated?(guardLimitMask==0x0FU?1:5):4',
  'if(guardArmIdentityValidated && guardSupported && guardLimitMask==0x0FU',
  'guardEnabled=true;','guardStoreEnabled(true);',
  'guardControlRequest=1;', 'notifyStatus("RG:CHECK");',
  'guardArmProof.ready(now)',
  'guardArmProof.reset();'])
  assert(fw.includes(token),'FW2.5 safe arm missing '+token);
for(const token of ["'RG:CHECK':'ĐANG KIỂM TRA ECU", "'RG:NORPM':'CHƯA BẬT", "'RG:NOECU':'CHƯA BẬT",
  "'RG:RUNNING':'TỪ CHỐI"])
  assert(html.includes(token),'FW2.5 Blink UI missing '+token);
// Multi-family guard source contract: never arm from a guessed RPM page.
for(const token of ['parseLimitForFamily(rx,n,page,guardIdentity.family,rpm)',
  'guardLimitMask==0x0FU','guardTryReadLimit(now);',
  'GUARD_MAX_LIMIT_RETRIES=5','guardLimitFailMap=bank;',
  'guardEnabled=false; // Stored protection cannot run with incomplete limits.',
  'if(guardUnsupported || guardLimitFailMap)return;',
  'BlinkGuard::parseHandshake(rx,hsSize,hs) && hs.map==4',
  'hs.family==guardIdentity.family','guardStoreEnabled(false);',
  'static const uint8_t GUARD_MAX_IDENTITY_RETRIES=6',
  'if(guardArmFailure==5)return "RG:LIMITERR";'])
 assert(fw.includes(token),'FW2.6 missing safety contract: '+token);
assert(html.includes('RG:ARMREAD:M')&&html.includes('RG:LIMITERR:M'),
  'Blink must display named MAP limit-reading state and failure');
assert(!fw.includes('if(!BlinkGuard::parseLimit(rx,n,page,rpm))return;'),
  'Unsafe V9-only page6 decode still in live MCU path');
const callback=fw.slice(fw.indexOf('if (text == "RG?" || text == "RGON" || text == "RGOFF")'),
                         fw.indexOf('if (text == "PING")'));
assert(!callback.includes('guardEnabled=true;')&&!callback.includes('guardStoreEnabled(true);'),
  'BLE callback must never arm guard directly');
const handler=fw.slice(fw.indexOf('static void guardHandleControlRequest()'),fw.indexOf('uint8_t otaBuf['));
assert(!handler.includes('guardEnabled=true;')&&!handler.includes('guardStoreEnabled(true);'),
  'RGON request must not persist protection before 0RPM proof');
assert(fw.indexOf('guardArmIdentityValidated && guardSupported && guardArmProof.ready(now)')<
       fw.indexOf('guardStoreEnabled(true);'),
  'Protection cannot persist before the valid 0RPM proof');
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
const required=[
'id="afrTargetLocalSaveBtn"','id="afrTargetKeypadSave"',
"if(state.tab==='target'&&saveTargetAfrLocal())hideFuelKeypad();",
"document.getElementById('mapEditorScreen')?.classList.toggle('targetAfrEditor',tab==='target')",
"return (state.tab==='inject'&&screen.classList.contains('standaloneFuel'))||",
"const values=state.tab==='target'?state.target:state.inject;",
"const dst=isAfr?state.target:state.inject;",
"if(state.tab==='target'){",
"save(); // Blink localStorage, never an ECU injection-map write."
];
for(const item of required)assert(html.includes(item),'Missing AFR target UI '+item);
for(const old of ['id="otaRollbackFw22Btn"', 'otaRollbackToFW22', 'LAST_GOOD_FW22', 'KHÔI PHỤC FW 2.2']){
  assert(!html.includes(old),'Obsolete rollback path must be removed: '+old);
}
assert(html.includes("if(!bridgeStatusAtLeast(version,2,6))"),'Guard must require FW2.6');
assert(html.includes("if(state.recording||state.threeRun?.active)throw new Error('Hãy dừng ghi AFR"),'OTA cannot run during recording');
assert(html.includes("if(Number.isFinite(otaRpm)&&otaRpm>200)"),'OTA must block measured running RPM');

const saveFn=html.slice(html.indexOf('function saveTargetAfrLocal(){'),html.indexOf('function setTab(tab){'));
assert(saveFn.includes('save();')&&!/writeCurrentFuelMap|writeMapBle|writeTest|rawExchange|writeCommand/.test(saveFn),
  'Target AFR local save must never write ECU');
assert(html.includes('beginBridgeGuardControl(20000)'),'Guard must reserve the whole BLE control sequence');
assert(html.includes('writeGuardControlWithRetry'),'Guard GATT retry wrapper missing');
assert(!html.includes('RG:ERROR '+String.fromCharCode(43)+'detail'),'Do not confuse BLE errors with actual ECU status');
const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let scripts=0;
for (const hit of html.matchAll(re)) {
  if (!hit[1].trim()) continue;
  scripts++;
  new vm.Script(hit[1],{filename:'Blink inline script '+scripts});
}
assert(scripts>=2);
console.log('PASS: '+scripts+' inline Blink scripts; FW2.6 multi-family RPM limit arming, no extra .h and safe error states');

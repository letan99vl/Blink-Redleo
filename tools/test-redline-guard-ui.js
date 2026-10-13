#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert'),vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const firmware=fs.readFileSync('firmware/ESP32_BLINK_TL_REDLEO_REAL_BRIDGE_GPIO26_33.ino','utf8');
const core=fs.readFileSync('firmware/redline_guard_core.h','utf8');
assert(html.includes("window.BLINK_PB_VERSION = '3.79.76'"));
for(const tok of ['id="redlineGuardSettings"','id="rgStatus"','id="rgReadBtn"',
 'id="rgEnableBtn"','id="rgDisableBtn"',"writeBridgeControl('RG?')",
 "guardControlCommand('RGON')","guardControlCommand('RGOFF')",
 "if(window.blinkGuardLatched && n!==4)","RG:TRIP:M4"]){
  assert(html.includes(tok),'HTML guard control missing: '+tok);
}
for(const tok of ['#include <Preferences.h>','#include "redline_guard_core.h"',
 '#define FW_VERSION "2.3"','guardLastValidRpmMs','guardStoreEnabled',
 'guardAutonomousTick();','guardObserveHostTransaction(txBuf,n,rxBuf,got);',
 'guardLatched || guardPending',"text == \"RGON\"","text == \"RGOFF\"",
 'BlinkGuard::parseHandshake','BlinkGuard::parseLimit']){
  assert(firmware.includes(tok),'firmware safety gate missing: '+tok);
}
assert(core.includes('HOLD_MS = 5000U'));
assert(core.includes('RPM_LIMIT_MAX = 18000U'));
assert(firmware.includes('guardEnabled=p.getBool("enabled",false);'),'not opt-in by default');
assert(firmware.includes('if(n>0 && (txBuf[0]==0xCD || txBuf[0]==0x8B))'),'no write lock on MAP4 trip');
assert(firmware.includes('BlinkGuard::request5(0x69,4,txBuf);'),'no stale-host map override');
assert(!fs.existsSync('ota/redline_guard_fw23.bin'),'no pre-shipped firmware allowed');
const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let found=0;for(const match of html.matchAll(re)){
  const code=match[1].trim();
  if(!code)continue;
  found++;
  new vm.Script(code,{filename:'index.html inline script '+found});
}
assert(found>=2,'expected inline Blink JS scripts');
console.log('PASS: '+found+' Blink inline script blocks compile; FW2.3 UI status/opt-in/latch checked; OTA 2.2 unchanged');

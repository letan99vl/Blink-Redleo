#!/usr/bin/env node
'use strict';
// Intentional temporary OTA hold. This test MUST fail if a future UI change
// accidentally re-enables firmware updates while the server hold is active.
const fs=require('fs'),assert=require('assert'),vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const manifest=JSON.parse(fs.readFileSync('ota/manifest.json','utf8'));

assert.equal(manifest.ota_enabled,false,'Server must explicitly disable OTA');
assert.equal(manifest.maintenance,true,'Server OTA maintenance marker missing');
assert.equal(manifest.version,'0.0.0','Legacy ESP32 firmware ignores ota_enabled; advertise NO update via 0.0.0');
assert(/^https:\/\/raw\.githubusercontent\.com\//.test(manifest.url),'Original FW binary location must remain recoverable');
assert(/^[0-9a-f]{64}$/.test(manifest.sha256),'Original firmware hash must remain intact');
function cmpVersion(a,b){
  const A=(String(a).match(/\d+/g)||[]).map(Number),B=(String(b).match(/\d+/g)||[]).map(Number);
  for(let i=0;i<4;++i){if((A[i]||0)!==(B[i]||0))return (A[i]||0)<(B[i]||0)?-1:1;}
  return 0;
}
for(const prior of ['1.8','1.9','2.0','2.1','2.2','2.3','2.4','2.5','2.6.2'])
  assert(cmpVersion(manifest.version,prior)<=0,'Old bridge may see a new OTA update: '+prior);

assert(html.includes("window.BLINK_PB_VERSION = '3.79.72.1'"),'Expected pre-5s app with OTA hold');
assert(html.includes('const BLINK_SERVER_OTA_PAUSED=true;'),'OTA lock must be enabled in app');
assert(html.includes('window.blinkServerOtaPaused=BLINK_SERVER_OTA_PAUSED;'));
assert(html.includes("if(m.ota_enabled===false)throw new Error(OTA_PAUSE_MSG)"),
  'Server maintenance flag must be honored');
assert(html.includes('OTA SERVER TẠM KHÓA'));
assert(html.includes('OTA firmware ESP32 đang tạm khóa trên server'));
for(const id of ['otaScanBtn','otaCheckBtn','otaInstallBtn']){
  const b=html.match(new RegExp('<button id="'+id+'"[^>]*>'));
  assert(b&&/\sdisabled(?:\s|>)/.test(b[0]),'Unsafe enabled OTA UI '+id);
}
const assertBlock=(start,end,match)=>{
  const i=html.indexOf(start),j=html.indexOf(end,i+start.length);
  assert(i>=0&&j>i,'Missing function block '+start);
  const body=html.slice(i,j);
  assert(body.includes(match),'Missing OTA gate in '+start);
  return body;
};
assertBlock('async function writeOtaCommand(', 'function resolveOtaStatusWaiters(', 'if(cmd!==OTA_BLE_ABORT)assertOtaUnlocked();');
assertBlock('async function otaScanWifi(', 'function handleOtaStatus(', 'if(BLINK_SERVER_OTA_PAUSED)');
assertBlock('function handleOtaStatus(', 'function compareFwVersion(', 'if(BLINK_SERVER_OTA_PAUSED)');
assertBlock('function setOtaControlsBusy(', 'function renderOtaWifiNetworks(', 'BLINK_SERVER_OTA_PAUSED');
assertBlock('async function fetchOtaManifestWeb(', 'async function otaCheck(', 'assertOtaUnlocked();');
assertBlock('async function otaCheck(', 'function hexToBytes(', 'if(BLINK_SERVER_OTA_PAUSED)');
assertBlock('async function writeBleFirmwareChunk(', 'async function transferFirmwareBle(', 'assertOtaUnlocked();');
assertBlock('async function transferFirmwareBle(', 'async function otaInstall(', 'assertOtaUnlocked();');
assertBlock('async function otaInstall(', "$('otaScanBtn').addEventListener", 'if(BLINK_SERVER_OTA_PAUSED)');
const real=fs.readFileSync('redleo_real_protocol.js','utf8');
assert(real.includes('async function handshakeReal()')&&real.includes('rawExchange(req5(0x5A,0x5A),6000)'),
 'Normal 0x5A ECU path must remain available');
assert(!html.includes('RGON')&&!html.includes('RGOFF'),'Historical PB3.79.72 must not accidentally gain 5s controls');
let scripts=0;
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
  if(m[1].trim()){new vm.Script(m[1],{filename:'Blink PB3.79.72.1 inline '+(++scripts)});}
}
new vm.Script(real,{filename:'REDLEO protocol'});
assert(scripts>=2,'Expected Blink HTML inline scripts');
console.log('PASS OTA server 0.0.0/disabled: PB3.79.72.1 UI, low-level BLE OTA gates, unchanged ECU 0x5A');

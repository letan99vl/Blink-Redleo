'use strict';
// Static/codec smoke checks. Does not claim that physical ECU testing is complete.
const fs=require('fs');
const assert=require('assert').strict;
const vm=require('vm');
const root=process.cwd();
const read=p=>fs.readFileSync(root+'/'+p,'utf8');
const f=read('firmware/BLINK_FW22_S3_ACCEL_LAB.ino');
const app=read('blink_accel_map_settings.js');
const html=read('index.html');
new vm.Script(app,{filename:'blink_accel_map_settings.js'});
assert(f.includes('CONFIG_IDF_TARGET_ESP32S3'));
assert(f.includes('#define FW_VERSION "2.2"'));
assert(f.includes('PONG FW')&&f.includes(' " ACCS3"'));
assert(f.includes('if(cmd=="ACC GET")'));
assert(f.includes('accNotifySnapshot()'));
assert(f.includes('0xB3,1,seq,0')&&f.includes('0xB3,1,seq,1'));
assert(f.includes('accCheckIdentity(rx,got,verified) && verified==mapNo'));
assert(f.includes('accStop("ACC:APP_MAP")'));
assert(f.includes('getBool("enabled",false)'));
assert(f.includes('OTA:S3_BLOCKED'));
assert(f.includes('accZeroCount>=3'));
assert(/blinkAccelSettingsS3\[hidden\]\{display:none!important\}/.test(app));
assert(/const cap=\/\^PONG\\s\+FW2\\\.2\\s\+ACCS3\$\/i/.test(app));
assert(app.includes('withBridgeSlot')&&app.includes('beginManualMapIo'));
assert(app.includes('ACC GET')&&app.includes('ACC CAL ')&&app.includes('ACC MAP '));
assert(app.includes("s.enabled!==on")&&app.includes('ĐÃ LƯU VÀ XÁC MINH'));
assert(html.includes("blink_accel_map_settings.js?v="));
assert(html.includes("window.BLINK_PC_SMART_TUNE ? '3.79.176'"));
assert(html.includes("if(text.startsWith('ACC:'))return;"));
assert(!html.includes('if(text.startsWith("ACC:"))throw'));
if(fs.existsSync(root+'/firmware/2.2.ino')){
 const base=read('firmware/2.2.ino');
 assert(base.includes('#define FW_VERSION "2.2"'));
 assert(base.includes('#define ECU_RX_PIN 22'));
 assert(!base.includes('ACC_LAB_BUILD_ID'));
}
// Reconstruct and decode BLE frames according to the firmware's packet layout.
const payload0=Buffer.from([0xB3,1,37,0,0x12,1,2,35,15,60,20,0xC4,0x09,0xDC,0x05,0x20,0x03,0]);
const payload1=Buffer.from([0xB3,1,37,1,0x90,0x01,0xF4,0x01,0x94,0x11,1,0,0,0xF4,0x01,0]);
function checksum(b){let x=0x5D;for(let i=0;i<b.length-1;i++)x^=b[i];return x;}
payload0[payload0.length-1]=checksum(payload0);
payload1[payload1.length-1]=checksum(payload1);
assert.equal(payload0.length,18);
assert.equal(payload1.length,16);
assert.equal(checksum(payload0),payload0[17]);
assert.equal(checksum(payload1),payload1[15]);
assert.equal(payload0.readUInt16LE(11),2500);
assert.equal(payload0.readUInt16LE(13),1500);
assert.equal(payload0.readUInt16LE(15),800);
assert.equal(payload1.readUInt16LE(4),400);
assert.equal(payload1.readUInt16LE(6),500);
assert.equal(payload1.readUInt16LE(8),4500);
payload1[7]^=1;
assert.notEqual(checksum(payload1),payload1[15], 'corruption must fail checksum');
console.log('ACCS3 protocol/client syntax and legacy-firmware isolation smoke checks: PASS');

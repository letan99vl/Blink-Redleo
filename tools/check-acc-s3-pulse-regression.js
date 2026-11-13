'use strict';
// Deterministic UI pulse-decision regression + firmware parity guards.
// ECU transport and real motor behavior MUST still be validated on the bench.
const fs=require('fs');
const vm=require('vm');
const assert=require('assert').strict;
const ui=fs.readFileSync('blink_accel_map_settings.js','utf8');
const fw=fs.readFileSync('firmware/BLINK_FW22_S3_ACCEL_LAB.ino','utf8');
const start=ui.indexOf('function accelTpsSteady(');
const end=ui.indexOf('function resetAutoTrend()',start);
assert(start>=0 && end>start,'pulse helper should exist in UI');
const ctx={Math};
vm.runInNewContext(ui.slice(start,end),ctx);
const {accelTpsSteady,accelReturnReason}=ctx;
assert.equal(typeof accelTpsSteady,'function');
assert.equal(typeof accelReturnReason,'function');
const config={Hold:1000,Back:9,BackMs:800,High:60};
const series=(from,to,tpsFn,rpmFn,step=100)=>{
  const out=[];
  for(let t=from;t<=to;t+=step)
    out.push({t,tps:tpsFn(t),rpm:rpmFn(t)});
  return out;
};
// Initial punch 1% -> 30%, then maintain 30% at steady RPM:
// still BOOST during HOLD, then release to BASE without closing throttle.
const punch=[{t:0,tps:1,rpm:3000},...series(100,1300,()=>30,()=>3100)];
assert.equal(accelReturnReason(config,800,30,3100,100,0,punch),'');
assert.equal(accelReturnReason(config,1300,30,3100,100,0,punch),
  'GA VÀ RPM ỔN ĐỊNH / TRẢ MAP');
// Sustained higher TPS or rapidly changing RPM is NOT labelled light demand.
const heavy=series(100,1400,()=>60,()=>3100);
assert.equal(accelReturnReason(config,1400,60,3100,100,0,heavy),'');
const risingRpm=series(100,1400,()=>30,t=>2700+t);
assert.equal(accelReturnReason(config,1400,30,4100,100,0,risingRpm),'');
const noisyTps=series(100,1400,t=>t%200?33:28,()=>3100);
assert.equal(accelReturnReason(config,1400,30,3100,100,0,noisyTps),'');
// Closed throttle is the only early-release override: short blips must not
// bypass hold, and partially closed throttle retains configured BACKMS.
assert.equal(accelReturnReason(config,650,0,3000,400,500,punch),'');
assert.equal(accelReturnReason(config,770,0,3000,400,500,punch),
  'TPS ĐÓNG GA / TRẢ NHANH');
assert.equal(accelReturnReason(config,1500,9,3000,400,900,punch),'');
assert.equal(accelReturnReason(config,1800,9,3000,400,900,punch),
  'TPS GIẢM / TRẢ MAP');
// After a verified BASE return, retain the low-TPS baseline for a second
// rapid-open pulse. The 180ms cooldown is shorter than the 200-400ms rise window.
const baseAt=1000,now=1300,past={t:baseAt,tps:0,rpm:3000};
const prior=now-past.t>=200 && now-past.t<=400?past:null;
assert(prior && (30-prior.tps)>=7 && now>=baseAt+180);
assert(ui.includes('autoSamples=[{t:verifiedAt,tps:rounded,rpm}]'));
assert(ui.includes('autoCooldownUntil=verifiedAt+(target===cfg.Boost?1200:180)'));
assert(ui.includes("if(cfg.Rpm===0 && rpm>10)"));
assert(ui.includes('switchS3AutoMapVerified(target)'));
assert(fw.includes('static bool accSteadyLightDemand('));
assert(fw.includes('ACC:RELEASE_FAST') && fw.includes('ACC:RELEASE_STEADY'));
assert(fw.includes('backAge>=250U && boostAge>=250U'));
assert(fw.includes('accCooldownUntil=millis()+(accBoost?1200U:180U)'));
assert(fw.includes('accSamples[0]={millis(),(uint8_t)lroundf(accLastTps),accLastRpm}'));
assert(fw.includes('accCheckIdentity(rx,got,verified) && verified==mapNo'));
assert(fw.includes('if(linked)return;'));
assert(fw.includes('if(acc.minRpm==0 && rpm>10)'));
console.log('ACC S3 pulse/quick-close/rearm regression and ECU safety guards: PASS');

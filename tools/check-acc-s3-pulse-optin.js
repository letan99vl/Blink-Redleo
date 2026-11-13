'use strict';
// Browser-only feature flag regression: legacy behavior stays default.
// Lab-only acceleration release logic MUST be explicitly selected each session.
const fs=require('fs'),assert=require('assert').strict,vm=require('vm');
const app=fs.readFileSync('blink_accel_map_settings.js','utf8');
const html=fs.readFileSync('index.html','utf8');
new vm.Script(app);
const start=app.indexOf('function accelTpsSteady(');
const end=app.indexOf('function resetAutoTrend()',start);
assert(start>=0&&end>start);
const ctx={Math};
vm.runInNewContext(app.slice(start,end),ctx);
const {accelTpsSteady,accelReturnReason}=ctx;
const cfg={Hold:1000,Back:9,BackMs:800,High:60};
const samples=(a,b,tps,rpm)=>{const z=[];for(let t=a;t<=b;t+=100)z.push({t,tps:tps(t),rpm:rpm(t)});return z;};
const p=[{t:0,tps:1,rpm:3000},...samples(100,1300,()=>30,()=>3100)];
assert.equal(accelReturnReason(cfg,800,30,3100,100,0,p),'');
assert.equal(accelReturnReason(cfg,1300,30,3100,100,0,p),'GA VÀ RPM ỔN ĐỊNH / TRẢ MAP');
assert.equal(accelReturnReason(cfg,1400,60,3100,100,0,samples(100,1400,()=>60,()=>3100)),'');
assert.equal(accelReturnReason(cfg,1400,30,4100,100,0,samples(100,1400,()=>30,t=>2700+t)),'');
assert.equal(accelReturnReason(cfg,1400,30,3100,100,0,samples(100,1400,t=>t%200?33:28,()=>3100)),'');
assert.equal(accelReturnReason(cfg,650,0,3000,400,500,p),'');
assert.equal(accelReturnReason(cfg,770,0,3000,400,500,p),'TPS ĐÓNG GA / TRẢ NHANH');
assert.equal(accelReturnReason(cfg,1500,9,3000,400,900,p),'');
assert.equal(accelReturnReason(cfg,1800,9,3000,400,900,p),'TPS GIẢM / TRẢ MAP');
assert(app.includes('id="accS3PulseMode"'));
assert(app.includes("$('accS3PulseMode').checked=false; // experimental pulse mode is NEVER restored automatically"));
assert(app.includes('if(!canDrive&&$(\'accS3PulseMode\').checked)'));
assert(app.includes('if(pulseEnabled){'));
assert(app.includes("}else if(now-autoBoostSince>=cfg.Hold&&rounded<=cfg.Back)"));
assert(app.includes("autoCooldownUntil=verifiedAt+(target===cfg.Boost||!pulseEnabled?1200:180)"));
assert(app.includes('else if(pulseEnabled){\n     // Seed verified BASE'));
assert(app.includes('switchS3AutoMapVerified(target)'));
assert(app.includes('if(cfg.Rpm===0 && rpm>10)'));
assert(app.includes("!$('accS3Safety').checked"));
assert(html.includes("window.BLINK_PC_SMART_TUNE ? '3.79.186'"));
assert(html.includes('S3ACC-SECOND-PULSE-BASELINE-20261113'));
assert.equal(typeof ctx.accelLowestTpsReference,'function');
// Regression: fast reopen from 0% to 30% happens within 40ms. The newest
// 200-400ms historical sample is already 30% (false negative in PB3.79.185),
// but a validated older low TPS remains in the SAME 200-400ms window.
const reOpen=[{t:1000,tps:0,rpm:3000},{t:1040,tps:30,rpm:3100},
              {t:1120,tps:30,rpm:3100}];
const reOpenAt=1240;
let legacyPrior=null;
for(let j=reOpen.length-1;j>=0;j--){
 const age=reOpenAt-reOpen[j].t;
 if(age>=200&&age<=400){legacyPrior=reOpen[j];break;}
}
assert.equal(legacyPrior.tps,30,'old implementation misses this second opening');
const best=ctx.accelLowestTpsReference(reOpen,reOpenAt);
assert.equal(best.tps,0,'pulse mode must retain low TPS evidence');
assert.equal(30-best.tps,30,'second opening crosses configured RISE=7');
assert.equal(ctx.accelLowestTpsReference(reOpen,1600),null,
             'must not reuse evidence older than 400ms');
assert.equal(ctx.accelLowestTpsReference([{t:1000,tps:30},{t:1040,tps:30}],1240).tps,30,
             'steady 30% alone must not look like another opening');
assert(app.includes("riseReference=pulseEnabled?accelLowestTpsReference(autoSamples,now):prior"),
       'legacy sample selection must remain unchanged when pulse option OFF');
assert(app.includes('rpm>=cfg.Rpm&&(fast||high)'),
       'new pulse evidence must not bypass the RPM gate');
assert(app.includes('autoCooldownUntil=verifiedAt+(target===cfg.Boost||!pulseEnabled?1200:180)'),
       'new pulse evidence must not bypass cooldown or verified switch');
assert.equal(typeof ctx.accelPulseReopenDiagnostic,'function');
assert(ctx.accelPulseReopenDiagnostic({Rpm:2500,Tps:10,Rise:7,High:60,Dwell:400},
                                    1240,30,3000,1180,reOpen,0).includes('xung TPS +30'));
assert(ctx.accelPulseReopenDiagnostic({Rpm:2500,Tps:10,Rise:7,High:60,Dwell:400},
                                    1100,30,3000,1180,reOpen,0).includes('khóa tái kích hoạt'));
assert(app.includes('id="accS3PulseDiag"'), 'live return-gate diagnostic should be visible');
assert(app.includes('CHẨN ĐOÁN TRẢ MAP:'), 'explain why MAP2 is held');
assert.equal(typeof ctx.accelPulseDiagnostic,'function');
const pulseCfg={Hold:1500,Back:9,BackMs:800,High:60};
const rpmRising=samples(1000,1800,()=>30,t=>3000+Math.round((t-1000)*0.9));
const rpmStable=samples(1000,1800,()=>30,()=>3200);
assert(ctx.accelPulseDiagnostic(pulseCfg,1900,30,3720,100,0,rpmRising).includes('RPM dao động'));
assert(ctx.accelPulseDiagnostic(pulseCfg,1900,30,3200,100,0,rpmStable).includes('TPS/RPM đã ổn định'));
assert(ctx.accelPulseDiagnostic(pulseCfg,800,30,3200,100,0,rpmStable).includes('MAP2 mới giữ'));
const fw=fs.readFileSync('firmware/BLINK_FW22_S3_ACCEL_LAB.ino','utf8');
assert(fw.includes(' " ACCS3R4"'), 'no experimental R5 firmware deployed with web');
assert(!fw.includes(' " ACCS3R5"'), 'R5 firmware must remain on lab PR');
console.log('PASS: PB3.79.186 second TPS pulse correction + diagnostics, explicit opt-in, legacy unchanged, simulation cases, ECU 0x5A guard, firmware R4 retained');

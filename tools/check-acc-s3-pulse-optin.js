'use strict';
// Browser preference regression: remember the experimental algorithm choice,
// never silently resume live ECU map control after reconnect.
const fs=require('fs'),assert=require('assert').strict,vm=require('vm');
const app=fs.readFileSync('blink_accel_map_settings.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const protocol=fs.readFileSync('redleo_real_protocol.js','utf8');
new vm.Script(app);
const start=app.indexOf('function accelTpsSteady(');
const end=app.indexOf('function resetAutoTrend()',start);
assert(start>=0&&end>start);
const ctx={Math};
vm.runInNewContext('const ACC_REARM_MAX_AGE_MS=900;\n'+app.slice(start,end),ctx);
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
// A saved experimental choice may reappear after reconnect / browser restart,
// but the MAP-control checkbox remains OFF until explicit human action.
const prefStart=app.indexOf('const ACC_PULSE_PREF_KEY=');
const prefEnd=app.indexOf('let autoSamples=',prefStart);
assert(prefStart>=0&&prefEnd>prefStart,'must define isolated persistence helpers');
function prefSession(localStorage){
 const scope={w:{localStorage}};
 vm.runInNewContext(app.slice(prefStart,prefEnd)+
   '\nthis.getChoice=()=>pulsePreference;this.saveChoice=savePulsePreference;this.loadChoice=readPulsePreference;',scope);
 return scope;
}
const store=new Map();
const browserStore={
 getItem:key=>store.has(key)?store.get(key):null,
 setItem:(key,value)=>store.set(key,String(value))
};
const first=prefSession(browserStore);
assert.equal(first.getChoice(),false,'new browser defaults OFF');
assert.equal(first.saveChoice(true),true,'user ON persists successfully');
assert.equal(prefSession(browserStore).getChoice(),true,'choice survives page restart');
assert.equal(prefSession(browserStore).saveChoice(false),true,'user OFF persists');
assert.equal(prefSession(browserStore).getChoice(),false,'OFF survives page restart');
const blocked=prefSession({getItem(){throw Error('private mode')},setItem(){throw Error('private mode')}});
assert.equal(blocked.getChoice(),false,'storage-blocked browsers fail closed');
assert.equal(blocked.saveChoice(true),false,'must not claim persistence when storage fails');
const supportBlock=app.slice(app.indexOf('function support(on)'),app.indexOf('function onStatus(s)'));
assert(supportBlock.includes("$('accS3DriveLive').checked=false"),'live MAP controller must be OFF per session');
assert(supportBlock.includes("&&pulsePreference"),'restore saved checkbox for compatible S3 only');
assert(!supportBlock.includes('savePulsePreference('),'connection state changes must not overwrite saved choice');
assert(app.includes("savePulsePreference($('accS3PulseMode').checked)"),'user toggle writes preference');
assert(protocol.includes('ACCS3(?:R3|R4|R5)'), 'protocol R5 capability must match UI');
assert(protocol.includes("ecuProfile?.key!=='MODERN_V9'"), 'do not bypass unknown ECU profile');
assert(app.includes('if(!canDrive&&$(\'accS3PulseMode\').checked)'));
assert(app.includes('if(pulseEnabled){'));
assert(app.includes("}else if(now-autoBoostSince>=cfg.Hold&&rounded<=cfg.Back)"));
assert(app.includes("autoCooldownUntil=verifiedAt+(target===cfg.Boost||!pulseEnabled?1200:180)"));
assert(app.includes('else if(pulseEnabled){\n     // The prior TPS value came from a real 0xA1 sample'));
assert(app.includes('switchS3AutoMapVerified(target)'));
assert(app.includes('if(cfg.Rpm===0 && rpm>10)'));
assert(app.includes("!$('accS3Safety').checked"));
assert(html.includes("window.BLINK_PC_SMART_TUNE ? '3.79.188'"));
assert(html.includes('S3ACC-VERIFIED-REARM-20261113'));
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
assert(app.includes('rpm>=cfg.Rpm&&(fast||verifiedReopen||high)'),
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
// Repeated throttle after MAP2->MAP1: 0% was actually observed before the
// 0x5A handshake, while live sampling temporarily stopped. Preserve its
// genuine monotonic timestamp briefly, NOT an invented verification timestamp.
const rearmCfg={Rpm:2500,Tps:10,Rise:7,High:60,Dwell:400};
const verifiedClosed={t:1000,tps:0,rpm:3100};
assert.equal(ctx.accelIsVerifiedReopen(rearmCfg,1400,30,verifiedClosed),true);
assert.equal(ctx.accelIsVerifiedReopen(rearmCfg,1590,30,verifiedClosed),true,
  'first fresh verified LIVE can recognize reopening after 0x5A');
assert.equal(ctx.accelIsVerifiedReopen(rearmCfg,1910,30,verifiedClosed),false,
  'low TPS evidence must expire after 900ms');
assert.equal(ctx.accelIsVerifiedReopen(rearmCfg,1199,30,verifiedClosed),false,
  'must not authorize reopening before 200ms');
assert.equal(ctx.accelIsVerifiedReopen(rearmCfg,1600,6,verifiedClosed),false,
  'still require minimum TPS');
assert.equal(ctx.accelIsVerifiedReopen(rearmCfg,1600,30,{t:1000,tps:5}),false,
  'baseline must be a genuine closed-throttle sample');
assert.equal(ctx.accelIsVerifiedReopen(rearmCfg,1600,30,null),false,
  'no low-TPS evidence means no inferred event');
assert(app.includes("rounded<=3 && verifiedAt>=now"));
assert(app.includes("verifiedAt-now<=ACC_REARM_MAX_AGE_MS"));
assert(app.includes("autoRearmLow={t:now,tps:rounded,rpm}"),
  'sample must retain actual observation timestamp');
assert(app.includes("const low=pulseEnabled&&physical===cfg.Base?autoRearmLow:null"),
  'only retain low TPS through the bounded MAP1 handoff gap');
assert(app.includes("if(now>=autoCooldownUntil&&rpm>=cfg.Rpm&&(fast||verifiedReopen||high))"),
  'must still honor RPM and cooldown gate');
assert(protocol.includes("if(ctx&&!ctx.nested)ctx.accelVerifiedResume=true"),
  'short LIVE resume allowed only on successful 0x5A verification');
assert(protocol.includes("scheduleLiveResume(ctx?.accelVerifiedResume===true?0:380)"),
  'ordinary/manual operations retain original 380ms resume delay');
assert(protocol.includes("if(!sameId||info.short||Number(info.activeMap)!==target)"),
  'ECU 0x5A identity and MAP must remain verified');
console.log('PASS: PB3.79.188 pulse preference survives reconnect, MAP control manual, R5 capability, ECU 0x5A guards');

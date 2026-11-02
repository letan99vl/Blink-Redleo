/* Blink TL PB3.79.146 | SMART AUTO TUNER | Chrome Windows PC only.
   Local 420-cell preview. No automatic ECU writes or firmware changes. */
(function(root){
'use strict';
const ua=String(root.navigator?.userAgent||'');
const pc=/Windows NT|Win64|Win32/i.test(ua)&&/Chrome\/\d+/i.test(ua)&&
  !/Edg\/|Edge\/|OPR\/|Opera\/|Electron|BLINK-REDLEO-ANDROID|Bluefy|Mobile|Android|iPhone|iPad/i.test(ua);
const bridge=root.blinkPcSmartBridge,doc=root.document;
if(!pc||root.BLINK_PC_SMART_TUNE!==true||!bridge||!doc?.getElementById('autoTuneQuickBar'))return;
const CFG=Object.freeze({traceMs:12000,minLiveSpan:1100,maxGap:650,tpsSpread:0.85,rpmSpread:160,
  minPointGap:850,maxAfrSpread:0.72,minAfr:10.15,maxAfr:19.85,
  maxPreviewPct:20,minWeight:0.18,minAfrEstimateWeight:0.25,minAfrEstimateCount:2,
  provisionalLiveMaxAge:450,provisionalAfrRange:2.8,provisionalCornerWeight:0.10,
  spatialMaxPerCell:36,spatialIndependentGapMs:850,spatialRatioTolerance:0.10,
  spatialPwTolerance:0.22,spatialNeighborRatioTolerance:0.12,
  spatialNeighborPwTolerance:0.25,spatialPendingMs:900,
  spatialWarmEctC:65,spatialMaxPreviewPct:20});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),get=id=>doc.getElementById(id);
const median=vs=>{const a=vs.slice().sort((x,y)=>x-y),n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
function coord(axis,x,descending=false){
  x=Number(x);const arr=axis.map(Number),n=arr.length;
  if(!Number.isFinite(x)||n<2||arr.some(v=>!Number.isFinite(v)))return null;
  if(descending){
    if(x>arr[0]+.04||x<arr[n-1]-.04)return null;
    for(let i=0;i<n-1;i++){
      const hi=arr[i],lo=arr[i+1];
      if(hi<=lo)return null;
      if(x>=lo&&x<=hi)return i+clamp((hi-x)/(hi-lo),0,1);
    }
  }else{
    if(x<arr[0]-.04||x>arr[n-1]+.04)return null;
    for(let i=0;i<n-1;i++){
      const lo=arr[i],hi=arr[i+1];
      if(hi<=lo)return null;
      if(x>=lo&&x<=hi)return i+clamp((x-lo)/(hi-lo),0,1);
    }
  }
  return Math.abs(x-arr[n-1])<=.04?n-1:null;
}
function sample2D(mat,u,v){
  const r=clamp(Math.floor(u),0,mat.length-1),rr=Math.min(r+1,mat.length-1);
  const c=clamp(Math.floor(v),0,mat[0].length-1),cc=Math.min(c+1,mat[0].length-1);
  const y=clamp(u-r,0,1),x=clamp(v-c,0,1);
  return Number(mat[r][c])*(1-y)*(1-x)+Number(mat[r][cc])*(1-y)*x+
    Number(mat[rr][c])*y*(1-x)+Number(mat[rr][cc])*y*x;
}
function findTrace(history,at){
  if(!history.length||at<history[0].t||at>history[history.length-1].t)return null;
  for(let k=1;k<history.length;k++){
    const a=history[k-1],b=history[k];
    if(a.t<=at&&b.t>=at){
      if(a.bank!==b.bank||b.t-a.t>CFG.maxGap)return null;
      const f=a.t===b.t?0:(at-a.t)/(b.t-a.t);
      return {t:at,bank:a.bank,tps:a.tps+(b.tps-a.tps)*f,
        rpm:a.rpm+(b.rpm-a.rpm)*f,pw:a.pw+(b.pw-a.pw)*f};
    }
  }
  return null;
}
// Diagnostic classifier with an identical Boolean gate to PB3.79.139.
function inspectStableTrace(history,at,p){
  const h=history.filter(a=>a.t>=at-1400&&a.t<=at+120);
  if(h.length<5)return {ok:false,code:'traceFewFrames'};
  if(h[h.length-1].t-h[0].t<CFG.minLiveSpan)return {ok:false,code:'traceShortWindow'};
  if(h.some(a=>a.bank!==p.bank))return {ok:false,code:'traceBankChanged'};
  const tps=h.map(a=>a.tps),rpm=h.map(a=>a.rpm);
  const dTps=Math.max(...tps)-Math.min(...tps);
  const dRpm=Math.max(...rpm)-Math.min(...rpm);
  const badTps=dTps>CFG.tpsSpread,badRpm=dRpm>Math.max(CFG.rpmSpread,p.rpm*.035);
  if(badTps&&badRpm)return {ok:false,code:'traceBothMoving'};
  if(badTps)return {ok:false,code:'traceTpsMoving'};
  if(badRpm)return {ok:false,code:'traceRpmMoving'};
  return {ok:true,code:'steady'};
}
function stableTrace(history,at,p){return inspectStableTrace(history,at,p).ok;}
function missingTraceReason(history,at){
  if(!history.length)return 'traceNoFrames';
  if(at<history[0].t)return 'traceTooOld';
  if(at>history[history.length-1].t)return 'traceWaitingLive';
  for(let i=1;i<history.length;i++){
    const x=history[i-1],y=history[i];
    if(x.t<=at&&y.t>=at){
      if(x.bank!==y.bank)return 'traceBankGap';
      if(y.t-x.t>CFG.maxGap)return 'traceFrameGap';
    }
  }
  return 'traceUnmatched';
}
function filterAfr(w){
  if(w.length!==7)return {ok:false,reason:'Chuỗi AFR chưa đủ'};
  const vs=w.map(a=>a.afr),center=vs[3];
  if(vs.some(x=>!Number.isFinite(x)||x<=CFG.minAfr||x>=CFG.maxAfr))
    return {ok:false,code:'afrInvalid',reason:'AFR sát giới hạn hoặc tín hiệu không hợp lệ'};
  const mid=median(vs),deviations=vs.map(x=>Math.abs(x-mid));
  const mad=median(deviations);
  // Reject a real CENTER spike. A lone outlier at either edge must NOT
  // automatically invalidate all six otherwise stable neighboring samples.
  // This never chooses samples merely because they are near AFR TARGET.
  if(Math.abs(center-mid)>Math.max(0.75,3*Math.max(mad,0.12)))
    return {ok:false,code:'afrSpike',reason:'AFR trung tâm đột biến: nghi bỏ lửa/nhiễu'};
  const core=vs.filter(x=>Math.abs(x-mid)<=0.55);
  if(core.length<5||Math.max(...core)-Math.min(...core)>Math.max(0.9,CFG.maxAfrSpread))
    return {ok:false,code:'afrUnstable',reason:'AFR dao động: không dùng học MAP'};
  // Use the robust observed AFR cluster. Also requires a stable ECU trace.
  return {ok:true,afr:median(core),support:core.length};
}
root.BlinkPcSmartMath=Object.freeze({coord,sample2D,findTrace,stableTrace,filterAfr});
let active=false,saving=false,awaitingRebase=false,afrHoldUntil=0,rebaseAfterTime=0,verifiedWrites=0,run=null,history=[],afrRing=[],recent=[],lastAccept=0,lastUI=0;
let provisionalSamples=0,provisionalSkipped=0,lastProvisionalUI=0;
let raw=0,accepted=0,rejected=0,suspected=0;
const emptyDiagnostics=()=>({afrInvalid:0,afrSpike:0,afrUnstable:0,traceMissing:0,
  traceUnstable:0,liveStale:0,pwInvalid:0,outsideAxis:0,targetInvalid:0,
  errorLarge:0,anchorConflict:0,spacing:0,nearTarget:0,idleOnly:0,
  traceFewFrames:0,traceShortWindow:0,traceBankChanged:0,
  traceBothMoving:0,traceTpsMoving:0,traceRpmMoving:0,
  traceNoFrames:0,traceTooOld:0,traceWaitingLive:0,
  traceFrameGap:0,traceBankGap:0,traceUnmatched:0});
let diagnostics=emptyDiagnostics();
const note=key=>{if(Object.prototype.hasOwnProperty.call(diagnostics,key))diagnostics[key]++;};
const readyAnchors=()=>run?Array.from(run.anchors.values()).filter(a=>a.n>=2).length:0;
let reason='Chưa bật SMART MAP · Chỉ Chrome Windows';
const clone=m=>m.map(row=>row.slice());
const keyOf=s=>JSON.stringify([s.bank,s.identity,s.tps,s.rpms,s.map,s.target]);
const log=v=>{recent.push(v);if(recent.length>900)recent.shift();};
function say(msg,isReject=false){
  reason=msg;if(isReject)rejected++;
  if(/đột biến|bỏ lửa|dao động|giới hạn|quá lệch/.test(msg))suspected++;
  ui();
}
function getSnapshot(){
  try{
    const s=bridge.snapshot();
    if(!s||!s.safe||s.unknown||!s.connected||!s.tpsSafe||s.ioBusy||
       !Array.isArray(s.map)||s.map.length!==14||
       !Array.isArray(s.target)||s.target.length!==14||
       !s.map.every(row=>Array.isArray(row)&&row.length===30&&row.every(v=>v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0))||
       !s.target.every(row=>Array.isArray(row)&&row.length===30&&row.every(v=>Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<21)))return null;
    return s;
  }catch(_e){return null;}
}
function startRun(){
  const s=getSnapshot();
  if(!s){say('Hãy kết nối, ĐỌC MAP ECU, xác minh TPS và AFR mục tiêu trước');return false;}
  if(s.autoIdle){say('Phải tắt TỰ LƯU MAP trước khi bật SMART');return false;}
  saving=false;awaitingRebase=false;history=[];afrRing=[];recent=[];raw=accepted=rejected=suspected=0;
  diagnostics=emptyDiagnostics();
  provisionalSamples=provisionalSkipped=0;lastProvisionalUI=0;
  lastAccept=lastUI=0;
  run={bank:s.bank,identity:s.identity,key:keyOf(s),base:clone(s.map),target:clone(s.target),
    tps:s.tps.slice(),rpms:s.rpms.slice(),anchors:new Map(),evidence:new Map(),provisional:new Map(),
    spatialBuckets:new Map(),spatialConfirmed:new Map(),spatialPending:[],
    spatial:{assigned:0,waiting:0,conflicts:0,corroborated:0,eligible:0,visual:0,previewOnly:0,missingTrace:0,
      invalidAfr:0,invalidPw:0,outsideAxes:0,cold:0,noDelay:0,sensorClip:0},
    sensorDelayMs:clamp(Number(bridge.live()?.afrDelayMs)||0,0,2500),lastSpatialEval:0,
    preview:clone(s.map),labels:s.map.map(row=>row.map(()=>'none')),estimated:0};
  return true;
}
function validRun(){
  if(!run||saving||awaitingRebase)return false;
  const s=getSnapshot();
  if(!s||keyOf(s)!==run.key){
    active=false;run=null;history=[];afrRing=[];
    say('MAP/AFR mục tiêu/ECU/trục thay đổi: SMART đã dừng. Cần bật lại.');
    try{bridge.refreshView()}catch(_e){}
    return false;
  }
  return true;
}
function makePreview(s){
  const anchors=Array.from(run.anchors.values()),base=run.base;
  const out=clone(base),labels=base.map(row=>row.map(()=>'none'));
  let changed=0;
  for(let r=0;r<base.length-1;r++)for(let c=0;c<base[r].length;c++){
    // Spatial preview may change ONLY cells actually visited by a TRACE or RAW AFR.
    // Never alter unobserved regions simply because a distant anchor exists.
    if(run.spatialBuckets&&!run.spatialBuckets.has(r+':'+c)&&!run.provisional.has(r+':'+c))continue;
    const original=Number(base[r][c]);
    if(original<=0||s.locked?.[r]?.[c]){labels[r][c]='locked';continue;}
    let total=0,sum=0,nearest=Infinity,localGood=false;
    for(const a of anchors){
      if(a.n<2)continue;
      const dy=(r-a.u)/1.45,dx=(c-a.v)/2.3,d=dy*dy+dx*dx;
      if(d>5.8)continue;
      const w=Math.exp(-d*.72)*Math.min(1,a.n/4);
      total+=w;sum+=w*(a.logSum/a.n);nearest=Math.min(nearest,d);
      if(d<.13&&a.n>=3&&a.applicationSafe===true)localGood=true;
    }
    if(total<CFG.minWeight||nearest>3.8)continue;
    const logK=clamp(sum/(total+.45),Math.log(1-CFG.maxPreviewPct/100),Math.log(1+CFG.maxPreviewPct/100));
    const next=clamp(original*Math.exp(logK),0,Number(s.maxMs)||131.07);
    if(Math.abs(next-original)<.001)continue;
    out[r][c]=Number(next.toFixed(3));
    labels[r][c]=localGood?'supported':'estimated';changed++;
  }
  run.preview=out;run.labels=labels;run.estimated=changed;
}

// VIEW-ONLY AFR accumulation for 1, 2 or 4 neighbor cells when a stable
// operating point lies BETWEEN RPM/TPS axes. Every candidate gets a ~ marker;
// these are *inferred* AFR values and are never stored as ECU-measured AFR.
// ECU corrections continue to use only stable samples & the target ratio.
function collectAfrEvidence(u,v,afr,atTarget,idle=false){
  if(!run||!Number.isFinite(afr)||!Number.isFinite(atTarget)||atTarget<=0)return;
  const loR=Math.floor(u),hiR=idle?loR:Math.min(run.tps.length-2,loR+1);
  const loC=Math.floor(v),hiC=Math.min(run.rpms.length-1,loC+1);
  const dr=idle?0:clamp(u-loR,0,1),dc=clamp(v-loC,0,1);
  const rs=hiR===loR?[[loR,1]]:[[loR,1-dr],[hiR,dr]];
  const cs=hiC===loC?[[loC,1]]:[[loC,1-dc],[hiC,dc]];
  const ratio=afr/atTarget;
  for(const [r,rw] of rs)for(const [c,cw] of cs){
    const weight=rw*cw;
    if(weight<0.12||r<0||r>=run.tps.length||c<0||c>=run.rpms.length)continue;
    const targetCell=Number(run.target[r][c]);
    if(!Number.isFinite(targetCell)||targetCell<=0)continue;
    const estimate=targetCell*ratio;
    if(!Number.isFinite(estimate)||estimate<=0||estimate>21)continue;
    const key=r+':'+c;
    let e=run.evidence.get(key);
    if(!e){e={sum:0,weight:0,n:0,last:0};run.evidence.set(key,e);}
    e.sum+=estimate*weight;e.weight+=weight;e.n++;e.last=lastAccept;
  }
}
// Blue AFR is spatial CORROBORATION, not an exact direct cell measurement.
// No strict 7-sample AFR or 1.1s throttle-stability gate is used in this mode.
function measuredEstimate(r,c){
  if(!active||!run||saving||awaitingRebase)return null;
  const x=run.spatialConfirmed.get(r+':'+c);
  return x?{afr:x.afr,n:x.n,weight:x.neighbors,kind:'spatial',note:x.note}:null;
}

// RAW TRACE DISPLAY ONLY: a fast TPS/RPM sweep still leaves an AFR sample.
// The sample may be affected by exhaust transport delay / accel fuel / misfire,
// so it is tagged "~" (provisional) and can NEVER become a fuel correction.
function provisionalTraceAt(at){
  const exact=findTrace(history,at);
  if(exact)return {...exact,source:'interpolated'};
  const last=history[history.length-1];
  // AFR can arrive between ECU 0xA1 frames. A recent last-known LIVE sample
  // is sufficient for a *provisional* display, never for verified learning.
  if(last&&at>=last.t&&at-last.t<=CFG.provisionalLiveMaxAge)
    return {...last,t:at,source:'recent-live',ageMs:at-last.t};
  return null;
}
// Every plausible received AFR is shown immediately as "~" without requiring
// seven AFR frames, throttle stability, or a three-point value filter.
// This is merely a display record: it is NEVER an ECU write or proof of AFR.
function collectProvisional(sample){
  if(!active||!run)return;
  const afr=Number(sample?.afr),t=Number(sample?.t);
  if(!Number.isFinite(afr)||afr<=0||afr>21||!Number.isFinite(t)){
    provisionalSkipped++;return;
  }
  const p=provisionalTraceAt(t-run.sensorDelayMs);
  if(!p||p.bank!==run.bank||!Number.isFinite(p.tps)||!Number.isFinite(p.rpm)){
    provisionalSkipped++;return;
  }
  const minTps=Number(run.tps[run.tps.length-2]);
  const idle=Number.isFinite(minTps)&&p.tps<Math.max(.05,minTps/2);
  const u=idle?run.tps.length-1:coord(run.tps.slice(0,-1),p.tps,true);
  const v=coord(run.rpms,p.rpm);
  if(u===null||v===null){provisionalSkipped++;return;}
  const targetAt=sample2D(run.target,u,v);
  if(!Number.isFinite(targetAt)||targetAt<=0){provisionalSkipped++;return;}
  const r0=Math.floor(u),r1=idle?r0:Math.min(run.tps.length-2,r0+1);
  const c0=Math.floor(v),c1=Math.min(run.rpms.length-1,c0+1);
  const dy=idle?0:clamp(u-r0,0,1),dx=clamp(v-c0,0,1);
  const rr=r0===r1?[[r0,1]]:[[r0,1-dy],[r1,dy]];
  const cc=c0===c1?[[c0,1]]:[[c0,1-dx],[c1,dx]];
  const changed=[];
  for(const [r,rw] of rr)for(const [c,cw] of cc){
    const w=rw*cw;
    if(w<CFG.provisionalCornerWeight||r<0||r>=run.tps.length||c<0||c>=run.rpms.length)continue;
    const targetCell=Number(run.target[r][c]);
    const estimated=targetCell*(afr/targetAt);
    if(!Number.isFinite(estimated)||estimated<=0||estimated>21)continue;
    const key=r+':'+c;
    let e=run.provisional.get(key);
    if(!e){e={samples:[],n:0,last:0,source:p.source};run.provisional.set(key,e);}
    e.samples.push({afr:estimated,w,t});
    if(e.samples.length>15)e.samples.shift();
    e.n++;e.last=t;e.source=p.source;
    changed.push({r,c});
  }
  if(!changed.length){provisionalSkipped++;return;}
  provisionalSamples++;
  try{bridge.refreshPendingCells?.(changed)}catch(_e){}
  if(t-lastProvisionalUI>450){lastProvisionalUI=t;ui();}
}

function pendingAfr(r,c){
  if(!active||!run||saving||awaitingRebase)return null;
  const e=run.provisional.get(r+':'+c);
  if(!e||!e.samples.length)return null;
  // A weighted median resists transient outliers without moving the real MAP.
  const samples=e.samples.slice().sort((a,b)=>a.afr-b.afr);
  const half=samples.reduce((sum,x)=>sum+x.w,0)/2;
  let sum=0,value=samples[samples.length-1].afr;
  for(const x of samples){sum+=x.w;if(sum>=half){value=x.afr;break;}}
  return Number.isFinite(value)?{afr:value,n:e.n,kind:'provisional',
    traceSource:e.source,last:e.last}:null;
}

// SPATIAL AFR CONSENSUS — local observation evidence on the entire 14x30 MAP.
// Never claim a sample is objectively real/fake from AFR and pulse width alone.
// Ratio AFR/target and normalized PW/live divided by BASE map are compared
// separately, preventing target AFR gradients and PW gradients from looking
// like invalid data. Neither ratio establishes fuel causality by itself.
function sampleIndependent(samples){
  let prev=-Infinity,independent=[];
  for(const x of samples.slice().sort((a,b)=>a.t-b.t)){
    if(x.t-prev>=CFG.spatialIndependentGapMs){
      independent.push(x);prev=x.t;
    }
  }
  return independent;
}
function suitableSpatial(s){
  return Number.isFinite(s.afr)&&s.afr>CFG.minAfr&&s.afr<CFG.maxAfr&&
    Number.isFinite(s.ratio)&&s.ratio>0&&Number.isFinite(s.pwFactor)&&
    s.pwFactor>.4&&s.pwFactor<2.5;
}
function spatialCellAssessment(key){
  if(!run)return {ok:false,kind:'inactive'};
  const bucket=run.spatialBuckets.get(key);
  if(!bucket)return {ok:false,kind:'empty'};
  const local=sampleIndependent(bucket.samples.filter(suitableSpatial));
  if(local.length<2)return {ok:false,kind:'needs-repeat'};
  const centerRatio=median(local.map(x=>x.ratio));
  const centerPw=median(local.map(x=>x.pwFactor));
  const agrees=local.filter(x=>Math.abs(Math.log(x.ratio/centerRatio))<=CFG.spatialRatioTolerance&&
    Math.abs(Math.log(x.pwFactor/centerPw))<=CFG.spatialPwTolerance);
  if(agrees.length<2)return {ok:false,kind:'local-conflict'};
  const ratio=median(agrees.map(x=>x.ratio)),pw=median(agrees.map(x=>x.pwFactor));
  const [r,c]=key.split(':').map(Number);
  const near=[];
  for(let dr=-1;dr<=1;dr++)for(let dc=-2;dc<=2;dc++){
    if(!dr&&!dc)continue;
    if(r===run.tps.length-1&&dr!==0)continue; // IDLE is a separate ECU row.
    if(r!==run.tps.length-1&&r+dr===run.tps.length-1)continue;
    const other=run.spatialBuckets.get((r+dr)+':'+(c+dc));
    if(!other)continue;
    const obs=sampleIndependent(other.samples.filter(suitableSpatial));
    if(!obs.length)continue;
    const nr=median(obs.map(x=>x.ratio)),np=median(obs.map(x=>x.pwFactor));
    if(Math.abs(Math.log(nr/ratio))<=CFG.spatialNeighborRatioTolerance&&
       Math.abs(Math.log(np/pw))<=CFG.spatialNeighborPwTolerance){
      near.push({ratio:nr,pw:np,r:r+dr,c:c+dc,
        warm:obs.some(x=>Number.isFinite(x.ect)&&x.ect>=CFG.spatialWarmEctC)});
    }
  }
  if(!near.length)return {ok:false,kind:'no-neighbor',n:agrees.length};
  // Keep own evidence dominant. Adjacent cells only corroborate a small part.
  const spatialRatio=ratio*.85+median(near.map(x=>x.ratio))*.15;
  const cellTarget=Number(run.target[r]?.[c]);
  if(!Number.isFinite(cellTarget)||cellTarget<=0)return {ok:false,kind:'no-target'};
  const afr=cellTarget*spatialRatio;
  const warmLocal=agrees.filter(x=>Number.isFinite(x.ect)&&x.ect>=CFG.spatialWarmEctC);
  const localWarm=warmLocal.length>=2;
  const neighborsWarm=near.some(x=>x.warm);
  // An AFR value stuck at a likely wideband lower limit, especially while
  // crossing multiple cells, is evidence of sensor clipping, not certainty.
  const nearFloor=afr<=10.5 && near.length>=2 &&
    Math.max(...agrees.map(x=>x.afr))-Math.min(...agrees.map(x=>x.afr))<.035;
  // No absolute AFR-vs-target percentage cutoff for the EXPERIMENTAL preview.
  // Large differences are still capped to +/-7% of fuel change per pass.
  const previewEligible=r!==run.tps.length-1&&run.sensorDelayMs>0&&!nearFloor;
  const fuelEligible=previewEligible&&localWarm&&neighborsWarm;
  const noteLabel=nearFloor?'AFR sát đáy thang đo, nghi kẹp cảm biến':
    (!run.sensorDelayMs?'Chưa cài độ trễ AFR':
     (!localWarm?'ECT chưa ấm: CHỈ XEM TRƯỚC':
      (!neighborsWarm?'Thiếu ô lân cận khi máy ấm: CHỈ XEM TRƯỚC':
       'Đã đối chiếu PW và AFR các ô')));
  return {ok:true,kind:'corroborated',afr,n:agrees.length,neighbors:near.length,
    ratio:spatialRatio,pwFactor:pw,previewEligible,fuelEligible,
    errorPct:(spatialRatio-1)*100,note:noteLabel,
    inputCount:bucket.count,r,c};
}
function recalculateSpatial(t){
  if(!active||!run)return;
  const previous=run.spatialConfirmed,oldPreview=run.preview;
  const next=new Map(),newAnchors=new Map();
  let waiting=0,conflicts=0,eligible=0,visual=0,previewOnly=0,cold=0,noDelay=0,sensorClip=0;
  for(const key of run.spatialBuckets.keys()){
    const x=spatialCellAssessment(key);
    if(!x.ok){
      if(x.kind==='local-conflict')conflicts++;
      else waiting++;
      continue;
    }
    next.set(key,x);
    if(x.note.includes('kẹp cảm biến'))sensorClip++;
    if(!x.fuelEligible){
      if(x.note.includes('ECT'))cold++;
      if(!run.sensorDelayMs)noDelay++;
    }else eligible++;
    if(!x.previewEligible)continue;
    visual++;
    if(!x.fuelEligible)previewOnly++;
    const nearTarget=Math.abs(x.afr-Number(run.target[x.r][x.c]))<=.3;
    const k=nearTarget?0:Math.log(x.ratio);
    // The old spatial-Gaussian preview remains bounded +/-7% per pass;
    // each supported cell is an anchor with >=2 truly separated observations.
    const n=Math.min(6,x.n+Math.min(2,x.neighbors));
    newAnchors.set(key,{u:x.r,v:x.c,n,logSum:k*n,applicationSafe:x.fuelEligible,
      afrSum:x.afr*n,targetSum:Number(run.target[x.r][x.c])*n});
  }
  run.spatialConfirmed=next;
  run.anchors=newAnchors;
  run.spatial.waiting=waiting;
  run.spatial.conflicts=conflicts;
  run.spatial.corroborated=next.size;
  run.spatial.eligible=eligible;
  run.spatial.visual=visual;
  run.spatial.previewOnly=previewOnly;
  run.spatial.cold=cold;
  run.spatial.noDelay=noDelay;
  run.spatial.sensorClip=sensorClip;
  const snapshot=getSnapshot();
  if(snapshot)makePreview(snapshot);
  const previewChanged=oldPreview.some((row,r)=>row.some((value,c)=>
    value!==run.preview[r][c]));
  const changedCells=[];
  for(const [key,x] of next){
    const before=previous.get(key);
    if(!before||Math.abs(before.afr-x.afr)>.005||before.note!==x.note)
      changedCells.push({r:x.r,c:x.c});
  }
  for(const [key,x] of previous)if(!next.has(key))changedCells.push({r:x.r,c:x.c});
  // Incrementally refresh inferred blue numbers when their estimate changes;
  // rerender full table only when the fuel preview or confirmation set changes.
  if(previous.size!==next.size||previewChanged){
    try{bridge.refreshView()}catch(_e){}
  }else if(changedCells.length){
    try{bridge.refreshPendingCells?.(changedCells)}catch(_e){}
  }
  run.spatial.lastPreviewCount=run.estimated;
  run.lastSpatialEval=t;
  reason=next.size?('Đối chiếu '+next.size+' vùng AFR/PW · '+visual+
    ' vùng gợi ý thử · '+previewOnly+' vùng CHỈ XEM TRƯỚC · ECU KHÔNG đổi'):
    'Đang gom nhiều lượt đi qua và so PW/AFR ô lân cận; chỉ hiển thị ~AFR';
  ui();
}
function appendSpatialSample(s,p){
  if(!active||!run||p.bank!==run.bank)return;
  const minTPS=Number(run.tps[run.tps.length-2]);
  const idle=Number.isFinite(minTPS)&&p.tps<Math.max(.05,minTPS/2);
  const u=idle?run.tps.length-1:coord(run.tps.slice(0,-1),p.tps,true);
  const v=coord(run.rpms,p.rpm);
  if(u===null||v===null){run.spatial.outsideAxes++;return;}
  const baseAt=sample2D(run.base,u,v),targetAt=sample2D(run.target,u,v);
  if(!Number.isFinite(baseAt)||baseAt<=0||!Number.isFinite(targetAt)||targetAt<=0)return;
  const afr=Number(s.afr),pw=Number(p.pw);
  if(!Number.isFinite(afr)||afr<=0||afr>21){run.spatial.invalidAfr++;return;}
  if(!Number.isFinite(pw)||pw<=0){run.spatial.invalidPw++;return;}
  const r=Math.round(u),c=Math.round(v),key=r+':'+c;
  let bucket=run.spatialBuckets.get(key);
  if(!bucket){bucket={r,c,samples:[],count:0};run.spatialBuckets.set(key,bucket);}
  const ectValue=bridge.live()?.ect;
  const ect=ectValue==null?NaN:Number(ectValue);
  bucket.samples.push({t:s.t,when:s.when,afr,pw,baseAt,targetAt,ratio:afr/targetAt,
    pwFactor:pw/baseAt,tps:p.tps,rpm:p.rpm,u,v,idle,
    ect:Number.isFinite(ect)?ect:null});
  bucket.count++;
  if(bucket.samples.length>CFG.spatialMaxPerCell)bucket.samples.shift();
  run.spatial.assigned++;
  log({t:s.t,when:s.when,afr,pw,tps:p.tps,rpm:p.rpm,
    quality:'spatial-candidate',cell:key,ratio:afr/targetAt,pwFactor:pw/baseAt});
  if(s.t-run.lastSpatialEval>=450)recalculateSpatial(s.t);
}
function flushSpatialSamples(now){
  if(!active||!run||!run.spatialPending.length)return;
  const remain=[];
  for(const s of run.spatialPending){
    const matched=findTrace(history,s.when);
    if(matched){appendSpatialSample(s,matched);continue;}
    const expired=now-s.t>=CFG.spatialPendingMs||
      (history.length&&s.when<history[0].t);
    if(expired){
      run.spatial.missingTrace++;
      log({t:s.t,afr:s.afr,quality:'display-only-unmatched-TRACE'});
    }else remain.push(s);
  }
  run.spatialPending=remain;
  if(now-run.lastSpatialEval>=600&&run.spatialBuckets.size)recalculateSpatial(now);
}

function addPoint(center,afr,point){
  if(!validRun())return;
  const s=getSnapshot();
  if(!s?.recording){say('Chờ BẮT ĐẦU GHI AFR');return;}
  // The real ECU's IDLE row has no numeric TPS breakpoint. Record only its
  // stable AFR for display: NEVER infer a fuel correction for IDLE.
  const minTps=Number(run.tps[run.tps.length-2]);
  const idle=Number.isFinite(minTps)&&point.tps<Math.max(0.05,minTps/2);
  const u=idle?run.tps.length-1:coord(run.tps.slice(0,-1),point.tps,true);
  const v=coord(run.rpms,point.rpm);
  if(u===null||v===null){note('outsideAxis');say('Ngoài vùng TPS/RPM có thể học');return;}
  const target=sample2D(run.target,u,v);
  if(!Number.isFinite(target)||target<9||target>18){note('targetInvalid');say('AFR mục tiêu ở vùng này không hợp lệ');return;}
  // Legacy helper is inactive in SPATIAL mode. No AFR/target % veto.
  if(center.t-lastAccept<CFG.minPointGap){note('spacing');return;}
  const near=Math.abs(afr-target)<=.3;
  const logK=near?0:Math.log(afr/target);
  // Only numeric TPS cells act as SMART fuel-correction anchors.
  if(!idle){
    const key=Math.round(u)+':'+Math.round(v);
    let a=run.anchors.get(key);
    if(a&&a.n>=2&&Math.abs(logK-a.logSum/a.n)>.115){
      note('anchorConflict');say('Các lượt đo trong một vùng mâu thuẫn: cần đo lại',true);return;
    }
    if(!a){a={u,v,n:0,logSum:0,afrSum:0,targetSum:0};run.anchors.set(key,a);}
    a.u=(a.u*a.n+u)/(a.n+1);a.v=(a.v*a.n+v)/(a.n+1);
    a.logSum+=logK;a.afrSum+=afr;a.targetSum+=target;a.n++;
  }
  lastAccept=center.t;accepted++;
  if(near)note('nearTarget');
  if(idle)note('idleOnly');
  // Keep measured AFR distinct from estimated AFR. Exact near-axis points
  // are written to state.measured; off-axis points only update view evidence.
  const onGrid=idle
    ?Math.abs(v-Math.round(v))<0.28
    :Math.abs(u-Math.round(u))<0.28&&Math.abs(v-Math.round(v))<0.28;
  if(onGrid){
    try{bridge.recordVerified(run.bank,Math.round(u),Math.round(v),afr,{idle})}catch(_e){}
  }
  collectAfrEvidence(u,v,afr,target,idle);
  if(!idle)makePreview(s);
  reason=(idle?'AFR IDLE ổn định':'Đã học TPS '+point.tps.toFixed(1)+'% / '+Math.round(point.rpm)+' RPM')+
    ' · AFR '+afr.toFixed(2)+' / mục tiêu '+target.toFixed(2)+
    (near?' · đạt':' · đang theo dõi bù')+
    (onGrid?' · ghi ô thật':' · hiện ≈ AFR ở ô lân cận');
  if(s.tab==='corrected'||s.tab==='measured')try{bridge.refreshView()}catch(_e){}
  ui();
}
function onLive(info){
  if(saving)return;
  if(!active||!info||![info.t,info.tps,info.rpm].every(Number.isFinite))return;
  if(awaitingRebase){
    const snap=getSnapshot();
    if(!snap||Number(info.bank)!==Number(snap.bank)||info.t<rebaseAfterTime)return;
    // Reload new ECU map as baseline and discard all pre-write AFR/PW history.
    if(!startRun())return;
    reason='SMART ON · ECU đã xác minh · bắt đầu học lượt mới trên MAP vừa ghi; AFR cũ đã bỏ.';
    ui();try{bridge.refreshView()}catch(_e){}
  }
  if(!run||!validRun())return;
  const p={t:info.t,bank:Number(info.bank),tps:info.tps,rpm:info.rpm,
    pw:Number.isFinite(info.pw)?info.pw:NaN};
  history.push(p);
  while(history.length&&p.t-history[0].t>CFG.traceMs)history.shift();
  if(history.length>1300)history.splice(0,history.length-1300);
  flushSpatialSamples(p.t);
  if(p.t-lastUI>900){lastUI=p.t;ui();}
}
function onAfr(info){
  if(saving||awaitingRebase)return true;
  if(Number.isFinite(Number(info?.t))&&Number(info.t)<afrHoldUntil)return true;
  if(!active||!run)return false;
  const t=Number(info?.t),afr=Number(info?.afr);
  if(!Number.isFinite(t)||!Number.isFinite(afr))return true;
  if(!bridge.live()?.recording)return true;
  if(!validRun())return true;
  raw++;
  // Do not apply the historical 7-AFR median, 1.1s steady-throttle gate,
  // or 850ms sample gap at ingestion. Every frame can leave a RAW marker.
  const s={t,when:t-run.sensorDelayMs,afr};
  collectProvisional(s);
  run.spatialPending.push(s);
  if(run.spatialPending.length>40){
    run.spatialPending.shift();
    run.spatial.missingTrace++;
  }
  flushSpatialSamples(t);
  return true;
}

function preview(bank){return active&&run&&!saving&&!awaitingRebase&&Number(bank)===run.bank?run.preview:null;}
function cellStatus(r,c){return active&&run&&!saving&&!awaitingRebase?run.labels[r]?.[c]||'none':'none';}
function ui(){
  const button=get('smartPcToggle'),status=get('smartPcStatus'),stats=get('smartPcStats'),
    detail=get('smartPcDiagnostics'),apply=get('smartPcApply');
  if(!button)return;
  button.textContent=saving?'⏳ SMART ĐANG GHI ECU':
    (active?'■ TẮT SMART MAP':'◆ BẬT SMART MAP (PC)');
  button.disabled=!!saving;
  button.classList.toggle('danger',active);
  if(status)status.textContent=reason;
  const x=run?.spatial;
  if(stats)stats.textContent='AFR nhận '+raw+' · mẫu RAW ~ '+provisionalSamples+
    ' · ô đã lướt '+(run?.provisional.size||0)+
    ' · mẫu khớp TRACE '+(x?.assigned||0)+
    ' · ô so khớp ≈ '+(x?.corroborated||0)+
    ' · ô chờ '+(x?.waiting||0)+
    ' · ô mâu thuẫn '+(x?.conflicts||0)+
    ' · vùng đề xuất THỬ '+(x?.visual||0)+
    ' · vùng đủ điều kiện ÁP DỤNG '+(x?.eligible||0)+
    ' · vùng CHỈ XEM '+(x?.previewOnly||0)+
    ' · ô MAP ĐÃ BÙ (XEM TRƯỚC) '+(saving||awaitingRebase?0:(run?.estimated||0))+
    ' · lần GHI ECU đã xác minh '+verifiedWrites;
  if(detail){
    const ectValue=bridge.live()?.ect;
    const ect=ectValue==null?NaN:Number(ectValue);
    const ectLabel=Number.isFinite(ect)?
      ('ECT '+ect.toFixed(1)+'°C'+(ect<CFG.spatialWarmEctC?' (máy chưa ấm: chỉ xem trước, khóa áp dụng)':'')):
      'ECT chưa có (chỉ xem trước, khóa áp dụng)';
    detail.textContent='ĐỐI CHIẾU TOÀN MAP: AFR/mục tiêu + PW thực/map phun gốc + ô kề, ≥2 lần ghi cách nhau '+
      CFG.spatialIndependentGapMs+'ms; không bắt giữ ga 1,1s hoặc gom 7 AFR. '+
      'Chờ ghép LIVE '+(run?.spatialPending.length||0)+
      ' · không khớp LIVE '+(x?.missingTrace||0)+
      ' · AFR ngoài dữ liệu '+(x?.invalidAfr||0)+
      ' · PW lỗi '+(x?.invalidPw||0)+
      ' · nghi kẹp cảm biến '+(x?.sensorClip||0)+' ô'+
      ' · '+ectLabel+
      (run?.sensorDelayMs?' · AFR delay '+run.sensorDelayMs+'ms':
        ' · AFR delay 0ms: chỉ xem, chưa được phép bù từ ga sốc.')+
      ' · KHÔNG giới hạn sai lệch AFR 18% trong phần xem thử; bù xăng giới hạn ±20%. '+
      'BẤM MAP ĐÃ BÙ → ECU để ghi 1 lần; không cần tắt GHI AFR hoặc SMART. '+
      'Trong khi truyền sẽ tạm bỏ mẫu, đọc lại ECU 420/420 rồi tự học MAP mới.';
  }
  // Local staging is operator-confirmed and NEVER a background ECU write.
  if(apply)apply.disabled=!active||!run||saving||awaitingRebase||
    !!bridge.live()?.recording||!run.estimated;
}

function stop(message){
  active=false;saving=false;awaitingRebase=false;afrHoldUntil=0;rebaseAfterTime=0;
  run=null;history=[];afrRing=[];
  reason=message||'SMART MAP đã tắt · không ghi ECU';
  ui();try{bridge.refreshView()}catch(_e){}
}
function toggle(){
  if(saving)return;
  if(active){stop('Đã hủy SMART MAP PC · MAP ECU giữ nguyên');return;}
  if(!startRun())return;
  if(!bridge.disableAutoIdle()){run=null;say('Không tắt được TỰ LƯU; SMART không bật');return;}
  active=true;reason='SMART SPATIAL: lưu dấu AFR mọi lượt ga; đối chiếu ô kề + PW, chỉ đề xuất khi đủ chứng cứ.';
  ui();try{bridge.refreshView()}catch(_e){}
}
async function applyLocal(){
  if(!active||!run||saving||!run.estimated){
    say('Chưa có MAP bù để lưu vào Blink');return false;
  }
  if(bridge.live()?.recording){say('DỪNG GHI AFR rồi mới lưu MAP bù');return false;}
  if(!validRun())return false;
  const s=run,proposal=clone(s.preview),baseline=clone(s.base);
  const unverified=s.spatial.previewOnly>0||s.spatial.eligible<2||
    s.sensorDelayMs<=0||!(Number(bridge.live()?.ect)>=CFG.spatialWarmEctC);
  const ok=await root.blinkConfirm('LƯU MAP BÙ VÀO BLINK · MAP NO.'+s.bank,
    'Bù tối đa ±'+CFG.maxPreviewPct+'% cho '+s.estimated+' ô. '+
    (unverified?'CẢNH BÁO: có dữ liệu chưa xác minh/ECT còn thấp. Đây chỉ là BẢN NHÁP.':
      'Các vùng đủ điều kiện vẫn cần xác minh AFR thực tế.')+
    '\n\nLưu chỉ đổi MAP trong Blink, KHÔNG GHI ECU. AFR cũ sẽ xóa tránh bù lặp. '+
    'Muốn ghi ECU sau đó phải chủ động chọn THỜI GIAN PHUN → LƯU HIỆN TẠI.',
    'LƯU VÀO BLINK','HỦY');
  if(!ok||!active||saving||run!==s||!validRun()||bridge.live()?.recording)return false;
  try{
    bridge.applyLocal({bank:s.bank,baseline,proposal});
    stop('ĐÃ LƯU MAP BÙ TRONG BLINK · CHƯA GHI ECU · phải kiểm tra lại');
    return true;
  }catch(e){say('Lưu MAP bù thất bại: '+String(e?.message||e));return false;}
}
// Direct ECU save uses only corroborated warm cells, not adjacent extrapolations.
// An explicit confirmation is required and the real writer verifies 420 cells.
function trustedForEcu(){
  if(!run)return null;
  const out=clone(run.base),included=[];
  for(const [key,x] of run.spatialConfirmed){
    if(!x.fuelEligible||x.r>=run.base.length-1)continue;
    const [r,c]=key.split(':').map(Number);
    if(run.labels[r]?.[c]==='locked')continue;
    const value=Number(run.preview[r]?.[c]);
    if(!Number.isFinite(value))continue;
    if(Math.abs(value-Number(run.base[r][c]))>.001){
      out[r][c]=value;included.push(key);
    }
  }
  return included.length?{proposal:out,included}:null;
}
// Single button press starts a verified ECU write without stopping GHI AFR
// or disabling SMART. Manual BLE I/O suspends LIVE 0x69 internally; isSaving()
// also drops AFR packets until the 420-cell verification has completed.
async function saveToEcu(prepareTransport){
  if(!active||!run||saving||awaitingRebase||!run.estimated){
    say('SMART chưa có MAP bù sẵn sàng để ghi ECU');return false;
  }
  if(!validRun())return false;
  const s=run,selected=trustedForEcu(),ect=Number(bridge.live()?.ect);
  if(!selected||s.spatial.eligible<2||s.sensorDelayMs<=0||
     !Number.isFinite(ect)||ect<CFG.spatialWarmEctC){
    say('CHƯA GHI: cần ECT ≥65°C, AFR delay và ≥2 vùng đối chiếu. SMART/GHI AFR vẫn ON.');
    return false;
  }
  const baseline=clone(s.base),confirmed=trustedForEcu();
  if(!confirmed||confirmed.included.join('|')!==selected.included.join('|')||
     confirmed.proposal.some((row,r)=>row.some((v,c)=>v!==selected.proposal[r][c]))||
     !active||run!==s||!validRun())return false;
  // A single intentional tap is the authorization. No second dialog.
  saving=true;
  reason='ĐANG GHI MAP ĐÃ BÙ → ECU · tạm bỏ qua mẫu AFR/LIVE, GHI AFR ON và SMART ON.';
  ui();
  let ok=false;
  try{
    ok=await bridge.writeSmartToEcu({
      bank:s.bank,baseline,proposal:confirmed.proposal,
      observed:confirmed.included,prepareTransport
    })===true;
    if(ok)verifiedWrites++;
    return ok;
  }catch(e){
    reason='GHI SMART ECU LỖI: '+String(e?.message||e)+
      ' · SMART vẫn ON, chờ ĐỌC HIỆN TẠI xác minh MAP.';
    return false;
  }finally{
    // A partial or uncertain write may leave a changed ECU MAP. Never reuse
    // previous correction evidence; wait for another verified MAP snapshot.
    saving=false;awaitingRebase=true;
    const now=Number(root.performance?.now?.());
    rebaseAfterTime=Number.isFinite(now)?now:0;
    const holdMs=Math.max(1800,(s.sensorDelayMs||0)+1000);
    afrHoldUntil=rebaseAfterTime+holdMs;
    history=[];afrRing=[];recent=[];
    if(ok){
      reason='ĐÃ GHI & ĐỌC LẠI 420/420 Ô · SMART ON, GHI AFR ON. '+
        'Đang đợi LIVE mới; bỏ AFR '+(holdMs/1000).toFixed(1)+'s để tránh bù lặp.';
    }else if(!reason.startsWith('GHI SMART ECU LỖI')){
      reason='GHI ECU CHƯA XÁC MINH · SMART VẪN ON; chờ MAP hợp lệ rồi mới học tiếp.';
    }
    ui();try{bridge.refreshView()}catch(_e){}
  }
}
function exportLog(){
  if(!run)return;
  const anchors=Array.from(run.anchors.entries()).map(([cell,a])=>({
    cell,tpsCoord:a.u,rpmCoord:a.v,count:a.n,
    afr:a.afrSum/a.n,target:a.targetSum/a.n,correctionPct:(Math.exp(a.logSum/a.n)-1)*100
  }));
  const payload={revision:'PB3.79.146',algorithm:'SPATIAL-AFR-PW-CONSENSUS-EXPERIMENT',bank:run.bank,identity:run.identity,
    config:CFG,stats:{raw,provisionalSamples,provisionalSkipped,
      traceAssigned:run.spatial.assigned,corroboratedCells:run.spatial.corroborated,
      fuelEligibleCells:run.spatial.eligible,visualCells:run.spatial.visual,
      previewOnlyCells:run.spatial.previewOnly,previewCells:run.estimated,
      readyAnchors:readyAnchors()},
    base:run.base,target:run.target,proposedMap:run.preview,anchors,
    evidence:Array.from(run.evidence.entries()),
    provisional:Array.from(run.provisional.entries()),
    spatialConfig:{minIndependentGapMs:CFG.spatialIndependentGapMs,
      minWarmECT:CFG.spatialWarmEctC,afrDelayMs:run.sensorDelayMs},
    spatialStats:run.spatial,
    spatialBuckets:Array.from(run.spatialBuckets.entries()),
    spatialConfirmed:Array.from(run.spatialConfirmed.entries()),
    pendingTrace:run.spatialPending,
    trace:history,recentAfr:recent};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=doc.createElement('a');
  link.href=url;link.download='BLINK_SMART_PC_MAP'+run.bank+'_'+Date.now()+'.json';
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function initUI(){
  const style=doc.createElement('style');
  style.textContent='#smartPcPanel{display:none;gap:7px;flex-wrap:wrap;align-items:center;'+
    'padding:7px 10px;margin:4px 8px;background:#0c2636;border:1px solid #267fa2;'+
    'border-radius:9px;color:#e6f7ff;font-size:12px}'+
    '#mapEditorScreen.autoTuneMap #smartPcPanel{display:flex}'+
    'body.mapZoomMode #mapEditorScreen #smartPcPanel{display:none!important}'+
    '#smartPcPanel button{min-height:34px;padding:4px 10px;font-size:12px;border-radius:7px;'+
    'border:1px solid #4c9ac8;font-weight:800}'+
    '#smartPcToggle{background:#075a55;color:#fff}#smartPcToggle.danger{background:#8c2635}'+
    '#smartPcStatus{flex:1 1 350px}#smartPcStats{flex:1 1 100%;color:#93cddf;font-size:11px}'+
    '#smartPcDiagnostics{flex:1 1 100%;color:#f3d3aa;font-size:11px;line-height:1.35}'+
    '#smartPcApply{background:#1b415a;color:#fff}#smartPcApply:disabled{opacity:.42}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-inferred{outline:1px dashed #6bc8fa;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-supported{outline:2px solid #38e2a7;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-afr-estimated{'+
    'color:#c3e8ff!important;background:rgba(15,92,126,.30)!important;'+
    'outline:1px dashed rgba(88,197,246,.75);outline-offset:-2px;font-style:italic}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-afr-provisional{'+
    'color:#ffe3a7!important;background:rgba(116,76,23,.34)!important;'+
    'outline:1px dotted rgba(255,184,75,.78);outline-offset:-2px;font-style:italic}';
  doc.head.appendChild(style);
  const panel=doc.createElement('div');
  panel.id='smartPcPanel';
  panel.innerHTML='<button type="button" id="smartPcToggle">◆ BẬT SMART MAP (PC)</button>'+
    '<span id="smartPcStatus" role="status">SMART MAP mặc định tắt.</span>'+
    '<button type="button" id="smartPcApply" disabled>✓ LƯU MAP BÙ VÀO BLINK</button>'+
    '<button type="button" id="smartPcExport">↓ XUẤT TRACE JSON</button>'+
    '<span id="smartPcStats">Chưa có mẫu</span>'+ 
    '<span id="smartPcDiagnostics" aria-live="polite">Chờ mẫu để chẩn đoán.</span>'+
    '<small>CHỈ CHROME WINDOWS · THỬ NGHIỆM. ~AFR màu vàng: TRACE TẠM khi lướt ga, '+
    'CHƯA đủ tin cậy và KHÔNG dùng bù xăng; ≈AFR màu xanh: nhiều lượt được đối chiếu AFR/PW ô kề, vẫn là suy luận. '+
    'Không lọc 7 mẫu/1,1s khi thu; giới hạn bù ±20% mỗi lượt. Sau DỪNG GHI AFR, '+
    'có thể LƯU bản nháp vào Blink. Một lần bấm MAP ĐÃ BÙ → ECU sẽ ghi các ô đủ điều kiện, '+
    'tự tạm giữ AFR/LIVE qua BLE, đọc lại 420 ô và học lượt mới. '+
    'GHI AFR và SMART vẫn ON; KHÔNG tự lưu nếu chưa bấm.</small>';
  get('autoTuneQuickBar').insertAdjacentElement('afterend',panel);
  get('smartPcToggle').addEventListener('click',toggle);
  get('smartPcApply').addEventListener('click',()=>{void applyLocal()});
  get('smartPcExport').addEventListener('click',exportLog);
  ui();
}
root.BlinkPcSmartAutoTune=Object.freeze({isActive:()=>active,onAfr,onLive,preview,cellStatus,stop,
  measuredEstimate,pendingAfr,saveToEcu,isSaving:()=>saving,
  getStats:()=>({active,saving,awaitingRebase,verifiedWrites,raw,accepted,rejected,suspected,
    provisionalSamples,provisionalSkipped,fuelEligible:Math.max(0,accepted-diagnostics.idleOnly),
    provisionalCells:run?.provisional.size||0,
    anchors:run?.anchors.size||0,estimated:run?.estimated||0,
    afrEstimates:run?.evidence.size||0,readyAnchors:readyAnchors(),
    diagnostics:{...diagnostics},
    spatial:run?{...run.spatial}:null,
    spatialBuckets:run?.spatialBuckets.size||0,
    corroborated:run?.spatialConfirmed.size||0,
    sensorDelayMs:run?.sensorDelayMs||0,reason})});
initUI();
})(window);

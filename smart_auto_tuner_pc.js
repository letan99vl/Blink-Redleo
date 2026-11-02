/* Blink TL PB3.79.153 | SMART AUTO TUNER | Chrome Windows PC only.
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
  spatialWarmEctC:65,spatialMaxPreviewPct:20,
  rowMaxAnchorGap:6,rowEdgeTaperCells:3,rowCurveGain:.9,
  rowHorizontalBlend:.12,rowVerticalBlend:.14,rowMaxLogStep:.0488,
  rowKinkLogThreshold:.09,trialMinEctC:60,
  fullRowMinAnchors:4,fullRowCurvatureWeight:2.8,fullRowAnchorWeight:16,
  fullRowExteriorDecay:6});
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
let active=false,saving=false,awaitingRebase=false,trialWriteArmed=false,trialWriteAuthorized=false,
  fullRowEnabled=false,fullRowWriteAuthorized=false,afrHoldUntil=0,rebaseAfterTime=0,verifiedWrites=0,run=null,history=[],afrRing=[],recent=[],lastAccept=0,lastUI=0;
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
  saving=false;awaitingRebase=false;trialWriteArmed=false;trialWriteAuthorized=false;history=[];afrRing=[];recent=[];raw=accepted=rejected=suspected=0;
  diagnostics=emptyDiagnostics();
  provisionalSamples=provisionalSkipped=0;lastProvisionalUI=0;
  lastAccept=lastUI=0;
  run={bank:s.bank,identity:s.identity,key:keyOf(s),base:clone(s.map),target:clone(s.target),
    tps:s.tps.slice(),rpms:s.rpms.slice(),anchors:new Map(),evidence:new Map(),provisional:new Map(),
    spatialBuckets:new Map(),spatialConfirmed:new Map(),spatialPending:[],
    spatial:{assigned:0,waiting:0,conflicts:0,corroborated:0,eligible:0,visual:0,previewOnly:0,missingTrace:0,
      invalidAfr:0,invalidPw:0,outsideAxes:0,cold:0,noDelay:0,sensorClip:0},
    sensorDelayMs:clamp(Number(bridge.live()?.afrDelayMs)||0,0,2500),lastSpatialEval:0,
    preview:clone(s.map),labels:s.map.map(row=>row.map(()=>'none')),
    rowApproved:new Set(),rowTrial:new Set(),fullRowCells:new Set(),fullRowWriteCells:new Set(),fullRowInterior:new Set(),fullRowExtra:new Set(),
    fullRowRows:new Set(),fullRowWritableRows:new Set(),
    fullRowMeta:{rows:0,writableRows:0,calculated:0,changed:0,unverified:0,extrapolated:0,protected:0,anchorCells:0,oldKinks:0,newKinks:0},
    rowMeta:{rows:0,segments:0,writeSegments:0,trialSegments:0,
      inferred:0,approved:0,trialCells:0,baseKinks:0},estimated:0};
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
// Entire-row SHAPE-PRESERVING fuel correction within measured RPM brackets.
// A TPS row needs >=2 independent AFR/PW-confirmed anchors. Interpolate the
// LOG of AFR/target instead of PW; retaining the stock PW(RPM,TPS) base shape.
// No extrapolation beyond corroborated anchor brackets. Two warm + valid
// anchor endpoints authorize the interior RPM cells for deliberate ECU write.
// WHOLE TPS ROW: model fuel shape only after >=2 independently corroborated
// WARM AFR/PW anchor cells on this SAME TPS row. The result is a PREVIEW
// across RPM, not proof of AFR at unmeasured points. Suspicious constant
// high-RPM 15.00ms plateaus are deliberately untouched.
function fullRowKinkCount(values,valid){
  let count=0;
  for(let c=1;c<values.length-1;c++){
    if(!valid[c-1]||!valid[c]||!valid[c+1])continue;
    const a=Math.log(values[c]/values[c-1]),b=Math.log(values[c+1]/values[c]);
    if(a*b<0&&Math.min(Math.abs(a),Math.abs(b))>.09)count++;
  }
  return count;
}
function fullRowProposals(r,s){
  // Same VE/airmass injector physics as fx TINH MAP PHUN NEN, not a visual
  // straight-line or an artificial 1/RPM decrease.
  const math=root.BlinkFuelModelMath;
  if(typeof math?.calculateStableFuelRow!=='function'){
    run.fullRowMeta.lastError='Chưa tải công thức ƒx TÍNH MAP NỀN.';return null;
  }
  let settings=null;
  try{
    const saved=root.localStorage?.getItem('blinkFuelModelSettingsV1');
    if(saved)settings=JSON.parse(saved);
  }catch(_e){}
  if(!settings){
    run.fullRowMeta.lastError='Nhập thông số động cơ/kim/áp/deadtime ở ƒx TÍNH MAP NỀN, bấm TÍNH & XEM TRƯỚC để lưu.';
    return null;
  }
  const base=run.base[r],target=run.target[r];
  const rows=Array.from(run.spatialConfirmed.values()).filter(x=>
    x.r===r&&x.previewEligible===true&&x.stableForVe===true&&
    Number.isInteger(x.c)&&x.c>=0&&x.c<base.length&&!s.locked?.[r]?.[x.c]&&
    Number.isFinite(x.livePw)&&x.livePw>0&&
    Number.isFinite(x.liveRpm)&&x.liveRpm>=500&&
    Number.isFinite(x.observedAfr)&&x.observedAfr>CFG.minAfr&&
    Number.isFinite(x.liveTps)&&x.liveTps>=0).sort((a,b)=>a.c-b.c);
  const dedup=[];
  for(const x of rows)if(!dedup.length||dedup[dedup.length-1].c!==x.c)dedup.push(x);
  if(dedup.length<CFG.fullRowMinAnchors)return null;
  let predicted;
  try{
    predicted=math.calculateStableFuelRow(settings,{
      tps:Number(run.tps[r]),rpms:run.rpms,targets:target,
      readings:dedup.map(x=>({c:x.c,tps:x.liveTps,rpm:x.liveRpm,
        afr:x.observedAfr,pw:x.livePw})),
      maxMs:Number(s.maxMs)||131.07
    });
  }catch(e){run.fullRowMeta.lastError=String(e?.message||e);return null;}
  if(predicted.aboveDuty){
    run.fullRowMeta.lastError='SMART VE: '+predicted.aboveDuty+
      ' ô duty >80%, kiểm tra kim/số lần phun/áp suất.';
    return null;
  }
  const valid=base.map((_,c)=>!s.locked?.[r]?.[c]&&Number(target[c])>0);
  const output=base.map((old,c)=>valid[c]?predicted.output[c]:old);
  // Detect existing 15ms placeholders ONLY for diagnostics, never as input.
  const placeholders=new Set();
  for(let c=1;c<base.length-3;c++){
    const v=Number(base[c]),prev=Number(base[c-1]);
    if(c<10||Math.abs(v-15)>.005||!(prev>0)||Math.abs(v/prev-1)<.35||
      ![1,2,3].every(k=>Math.abs(Number(base[c+k])-v)<.005))continue;
    for(let k=c;k<base.length&&Math.abs(Number(base[k])-v)<.005;k++)placeholders.add(k);
    break;
  }
  run.fullRowMeta.calibrated=(run.fullRowMeta.calibrated||0)+predicted.anchorCount;
  const oldKinks=fullRowKinkCount(base.map(Number),valid);
  const newKinks=fullRowKinkCount(output.map(Number),valid);
  // All modeled full-row cells are preview/local draft, never direct ECU write.
  return {row:r,first:predicted.first,last:predicted.last,
    anchorSet:new Set(predicted.nodes.map(x=>x.c)),safeSpan:new Set(),
    valid,output,placeholders,writeReady:false,
    oldKinks,newKinks,protected:placeholders.size};
}
function makePreview(s){
  if(!run)return;
  const base=run.base,rows=base.length-1,cols=base[0].length;
  run.rowApproved.clear();run.rowTrial.clear();
  run.fullRowCells.clear();run.fullRowWriteCells.clear();run.fullRowInterior.clear();run.fullRowExtra.clear();run.fullRowRows.clear();run.fullRowWritableRows.clear();
  run.fullRowMeta={rows:0,writableRows:0,calculated:0,changed:0,unverified:0,extrapolated:0,protected:0,anchorCells:0,oldKinks:0,newKinks:0};
  const out=clone(base),labels=base.map(row=>row.map(()=>'none'));
  const curve=Array.from({length:rows},()=>Array(cols).fill(null));
  const approved=Array.from({length:rows},()=>Array(cols).fill(false));
  const trial=Array.from({length:rows},()=>Array(cols).fill(false));
  const direct=Array.from({length:rows},()=>Array(cols).fill(false));
  const groupId=Array.from({length:rows},()=>Array(cols).fill(-1));
  const byRow=Array.from({length:rows},()=>[]);
  const rowMeta={rows:0,segments:0,writeSegments:0,trialSegments:0,
    inferred:0,approved:0,trialCells:0,baseKinks:0};
  const kinked=(r,start,end)=>{
    for(let c=start+1;c<end;c++){
      const x=Number(base[r][c-1]),y=Number(base[r][c]),z=Number(base[r][c+1]);
      if(x<=0||y<=0||z<=0)return true;
      const left=Math.log(y/x),right=Math.log(z/y);
      if(left*right<0&&Math.min(Math.abs(left),Math.abs(right))>CFG.rowKinkLogThreshold)
        return true;
    }
    return false;
  };
  for(const a of run.anchors.values()){
    const r=Number(a.u),c=Number(a.v);
    if(!Number.isInteger(r)||r<0||r>=rows||!Number.isInteger(c)||c<0||
       c>=cols||a.n<2||!Number.isFinite(a.logSum/a.n)||Number(base[r][c])<=0||
       s.locked?.[r]?.[c])continue;
    byRow[r].push(a);
  }
  for(let r=0;r<rows;r++){
    const nodes=byRow[r].sort((a,b)=>a.v-b.v);
    if(nodes.length<2)continue;
    let group=[],serial=0;
    const emit=()=>{
      if(group.length<2)return;
      const first=group[0].v,last=group[group.length-1].v;
      const badBaseline=kinked(r,first,last);
      if(badBaseline)rowMeta.baseKinks++;
      for(let i=1;i<group.length;i++){
        rowMeta.segments++;
        if(!badBaseline)rowMeta.trialSegments++;
        if(!badBaseline&&group[i-1].applicationSafe===true&&
          group[i].applicationSafe===true)rowMeta.writeSegments++;
      }
      for(let c=first;c<=last;c++){
        if(s.locked?.[r]?.[c]||Number(base[r][c])<=0)continue;
        let right=1;
        while(right<group.length-1&&c>group[right].v)right++;
        const p=group[right-1],q=group[right];
        const t=clamp((c-p.v)/(q.v-p.v),0,1);
        const logP=p.logSum/p.n,logQ=q.logSum/q.n;
        // Smoothly fade corrections near the ends of the measured RPM span;
        // unmeasured columns outside the span remain identical to MAP base.
        const taper=Math.min(1,(c-first+1)/CFG.rowEdgeTaperCells,
                              (last-c+1)/CFG.rowEdgeTaperCells);
        curve[r][c]=((1-t)*logP+t*logQ)*CFG.rowCurveGain*taper;
        approved[r][c]=!badBaseline&&p.applicationSafe===true&&
          q.applicationSafe===true;
        trial[r][c]=!badBaseline;
        direct[r][c]=group.some(a=>a.v===c);
        groupId[r][c]=serial;
      }
      serial++;
    };
    for(const a of nodes){
      if(!group.length){group=[a];continue;}
      const prev=group[group.length-1],gap=a.v-prev.v;
      let blocked=gap<1||gap>CFG.rowMaxAnchorGap;
      if(!blocked)for(let c=prev.v;c<=a.v;c++){
        if(s.locked?.[r]?.[c]||Number(base[r][c])<=0){blocked=true;break;}
      }
      if(blocked){emit();group=[a];}else group.push(a);
    }
    emit();
  }
  // Smooth factor changes within the same supported span only. Never smooth
  // or modify the original PW directly, and do not invent unmeasured RPM rows.
  const horizontal=curve.map((row,r)=>row.map((v,c)=>{
    if(v===null)return null;
    const left=c>0&&groupId[r][c-1]===groupId[r][c]?curve[r][c-1]:0;
    const right=c+1<cols&&groupId[r][c+1]===groupId[r][c]?curve[r][c+1]:0;
    return (1-2*CFG.rowHorizontalBlend)*v+
      CFG.rowHorizontalBlend*(left+right);
  }));
  const linked=horizontal.map((row,r)=>row.map((v,c)=>{
    if(v===null)return null;
    const neighbors=[];
    for(const rr of [r-1,r+1]){
      if(rr<0||rr>=rows)continue;
      const other=horizontal[rr][c];
      if(other!==null&&Math.abs(other-v)<=.12)neighbors.push(other);
    }
    if(!neighbors.length)return v;
    return (1-CFG.rowVerticalBlend)*v+
      CFG.rowVerticalBlend*(neighbors.reduce((a,b)=>a+b,0)/neighbors.length);
  }));
  // Restrict adjacent corrections to a small extra log-PW gradient and avoid
  // introducing a new slope inversion where the original MAP was monotonic.
  const low=Math.log(1-CFG.maxPreviewPct/100),high=Math.log(1+CFG.maxPreviewPct/100);
  const constrained=Array.from({length:rows},()=>Array(cols).fill(null));
  for(let r=0;r<rows;r++){
    let editedRow=false;
    for(let c=0;c<cols;c++){
      const k0=linked[r][c];
      if(k0===null)continue;
      let k=clamp(k0,low,high);
      // Guard each end of an observed span against the untouched baseline
      // immediately OUTSIDE it. Without this the very first corrected cell
      // may invert slope relative to the previous unobserved RPM column.
      if(c>0&&groupId[r][c]!==groupId[r][c-1]){
        const d=Math.log(Number(base[r][c])/Number(base[r][c-1]));
        if(d<-.004)k=Math.min(k,-d-.001);
        if(d>.004)k=Math.max(k,-d+.001);
      }
      if(c>0&&groupId[r][c]===groupId[r][c-1]&&
         constrained[r][c-1]!==null){
        // Use the ACTUALLY CONSTRAINED previous cell, not its unbounded
        // neighbor estimate. Otherwise a 2.75 -> 1.87 -> 2.32-style
        // inversion can survive even though each individual step was tested.
        const previous=constrained[r][c-1];
        const deltaBase=Math.log(Number(base[r][c])/Number(base[r][c-1]));
        let minK=previous-CFG.rowMaxLogStep,maxK=previous+CFG.rowMaxLogStep;
        if(deltaBase<-.01)maxK=Math.min(maxK,previous-deltaBase-.001);
        if(deltaBase>.01)minK=Math.max(minK,previous-deltaBase+.001);
        if(minK<=maxK)k=clamp(k,minK,maxK);
      }
      // The last measured column must also join the untouched column on its
      // right without introducing a NEW peak or trough.
      if(c+1<cols&&groupId[r][c]!==groupId[r][c+1]){
        const d=Math.log(Number(base[r][c+1])/Number(base[r][c]));
        if(d<-.004)k=Math.max(k,d+.001);
        if(d>.004)k=Math.min(k,d-.001);
      }
      k=clamp(k,low,high);
      constrained[r][c]=k;
      const original=Number(base[r][c]);
      const value=Number(clamp(original*Math.exp(k),0,Number(s.maxMs)||131.07).toFixed(3));
      if(Math.abs(value-original)<.001)continue;
      out[r][c]=value;
      editedRow=true;
      if(trial[r][c]){run.rowTrial.add(r+':'+c);rowMeta.trialCells++;}
      if(approved[r][c]){
        labels[r][c]=direct[r][c]?'supported':'row-inferred';
        run.rowApproved.add(r+':'+c);
        rowMeta.approved++;
        if(!direct[r][c])rowMeta.inferred++;
      }else labels[r][c]='estimated';
    }
    if(editedRow)rowMeta.rows++;
  }
  if(fullRowEnabled){
    // No 2-anchor partial preview leaks into 4-anchor full-row mode.
    run.rowApproved.clear();run.rowTrial.clear();
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){out[r][c]=base[r][c];labels[r][c]='none';}
      const result=fullRowProposals(r,s);
      if(!result)continue;
      run.fullRowRows.add(r);
      run.fullRowMeta.rows++;
      let writeCellCount=0;
      run.fullRowMeta.oldKinks+=result.oldKinks;
      run.fullRowMeta.newKinks+=result.newKinks;
      run.fullRowMeta.protected+=result.protected;
      // Replace the partial-row data for this row only; do not accidentally
      // authorize unchanged cells or old preview changes from other modes.
      for(const key of Array.from(run.rowApproved))
        if(Number(key.split(':')[0])===r)run.rowApproved.delete(key);
      for(const key of Array.from(run.rowTrial))
        if(Number(key.split(':')[0])===r)run.rowTrial.delete(key);
      for(let c=0;c<cols;c++){
        const value=Number(result.output[c]),baseline=Number(base[r][c]);
        if(result.valid[c])run.fullRowMeta.calculated++;
        if(!result.valid[c]||Math.abs(value-baseline)<.001){
          out[r][c]=base[r][c];labels[r][c]='none';continue;
        }
        out[r][c]=value;
        const key=r+':'+c,
          exterior=c<result.first||c>result.last||!result.safeSpan.has(c);
        run.fullRowCells.add(key);run.fullRowMeta.changed++;
        const eligible=result.writeReady&&!exterior&&!result.placeholders.has(c)&&
          baseline>0&&Math.abs(value/baseline-1)<=CFG.maxPreviewPct/100+.001;
        if(eligible){
          run.fullRowWriteCells.add(key);writeCellCount++;
          run.fullRowInterior.add(key);run.rowApproved.add(key);run.rowTrial.add(key);
          labels[r][c]=result.anchorSet.has(c)?'fullrow-anchor':'fullrow-interior';
          if(result.anchorSet.has(c))run.fullRowMeta.anchorCells++;
        }else{
          run.fullRowMeta.unverified++;
          if(exterior){
            run.fullRowExtra.add(key);run.fullRowMeta.extrapolated++;
            labels[r][c]='fullrow-extrapolated';
          }else labels[r][c]='fullrow-unverified';
        }
      }
      if(writeCellCount){run.fullRowWritableRows.add(r);run.fullRowMeta.writableRows++;}
    }
  }
  if(fullRowEnabled){
    rowMeta.rows=run.fullRowMeta.rows;rowMeta.segments=0;
    rowMeta.writeSegments=0;rowMeta.trialSegments=0;rowMeta.baseKinks=0;
    rowMeta.approved=run.rowApproved.size;
    rowMeta.trialCells=run.rowTrial.size;
    rowMeta.inferred=Array.from(run.rowApproved).filter(key=>{
      const [r,c]=key.split(':').map(Number);
      return labels[r]?.[c]!=='supported'&&labels[r]?.[c]!=='fullrow-anchor';
    }).length;
  }
  run.preview=out;
  run.labels=labels;
  run.estimated=out.reduce((n,row,r)=>n+row.filter((v,c)=>v!==base[r][c]).length,0);
  run.rowMeta=rowMeta;
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
  const livePw=median(agrees.map(x=>x.pw)),liveRpm=median(agrees.map(x=>x.rpm)),
    liveTps=median(agrees.map(x=>x.tps)),observedAfr=median(agrees.map(x=>x.afr));
  const span=a=>Math.max(...a)-Math.min(...a);
  const stableReading=agrees.length>=2&&
    span(agrees.map(x=>x.afr))<=.55&&
    span(agrees.map(x=>x.pw))/Math.max(.05,livePw)<=.14&&
    span(agrees.map(x=>x.rpm))<=500&&span(agrees.map(x=>x.tps))<=2.5;
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
  const stableForVe=previewEligible&&localWarm&&stableReading;
  const noteLabel=nearFloor?'AFR sát đáy thang đo, nghi kẹp cảm biến':
    (!run.sensorDelayMs?'Chưa cài độ trễ AFR':
     (!localWarm?'ECT chưa ấm: CHỈ XEM TRƯỚC':
      (!neighborsWarm?'Thiếu ô lân cận khi máy ấm: CHỈ XEM TRƯỚC':
       'Đã đối chiếu PW và AFR các ô')));
  return {ok:true,kind:'corroborated',afr,n:agrees.length,neighbors:near.length,
    ratio:spatialRatio,pwFactor:pw,previewEligible,fuelEligible,
    stableForVe,livePw,liveRpm,liveTps,observedAfr,
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
  if(!active||!run)return;
  // When the final AFR has already been time-matched, the queue may be empty.
  // Still recompute the row field from recently added spatial buckets on LIVE.
  // Otherwise completed sweeps can leave the last TPS rows visually stale.
  if(!run.spatialPending.length){
    if(now-run.lastSpatialEval>=600&&run.spatialBuckets.size)recalculateSpatial(now);
    return;
  }
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
    detail=get('smartPcDiagnostics'),apply=get('smartPcApply'),trialButton=get('smartPcTrialMode'),
    curveButton=get('smartPcFullRowMode');
  if(!button)return;
  button.textContent=saving?'⏳ SMART ĐANG GHI ECU':
    (active?'■ TẮT SMART MAP':'◆ BẬT SMART MAP (PC)');
  button.disabled=!!saving;
  button.classList.toggle('danger',active);
  if(trialButton){
    trialButton.textContent=fullRowEnabled?'GHI THỬ ECU: KHÓA (VE DỰ ĐOÁN)':
      (trialWriteArmed?'⚠ GHI THỬ ECU: BẬT':'GHI THỬ ECU: TẮT');
    trialButton.disabled=!active||saving||awaitingRebase||fullRowEnabled;
    trialButton.classList.toggle('danger',trialWriteArmed);
  }
  if(curveButton){
    curveButton.textContent=fullRowEnabled?'SỬA CONG CẢ HÀNG: BẬT':'SỬA CONG CẢ HÀNG: TẮT';
    curveButton.disabled=!active||saving||awaitingRebase;
    curveButton.classList.toggle('danger',fullRowEnabled);
  }
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
    ' · hàng TPS bù '+(run?.rowMeta?.rows||0)+
    ' · đoạn RPM có 2 neo '+(run?.rowMeta?.segments||0)+
    ' · đoạn đủ điều kiện GHI '+(run?.rowMeta?.writeSegments||0)+
    ' · ô NỘI SUY được duyệt '+(run?.rowMeta?.inferred||0)+
    ' · ô được duyệt GHI '+(run?.rowMeta?.approved||0)+
    ' · ô GHI THỬ có 2 neo '+(run?.rowMeta?.trialCells||0)+
    ' · hàng SỬA CONG XEM TRƯỚC '+(run?.fullRowMeta?.rows||0)+
    ' · hàng VE đủ 4 neo ổn định '+(run?.fullRowMeta?.rows||0)+
    ' · neo VE từ AFR/PW LIVE '+(run?.fullRowMeta?.calibrated||0)+
    ' · ô sửa cong '+(run?.fullRowMeta?.changed||0)+
    ' · ô CHỜ XÁC MINH '+(run?.fullRowMeta?.unverified||0)+
    ' · ô NGOẠI SUY chưa đo '+(run?.fullRowMeta?.extrapolated||0)+
    ' · ô 15ms KHÔNG làm nền '+(run?.fullRowMeta?.protected||0)+
    (fullRowEnabled&&run?.fullRowMeta?.lastError?' · VE đang chờ: '+run.fullRowMeta.lastError:'')+
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
      'BÙ THEO ĐƯỜNG CONG CẢ HÀNG TPS: nội suy chỉ GIỮA 2 neo AFR/PW đã đối chiếu '+
      '(mỗi đoạn tối đa '+CFG.rowMaxAnchorGap*500+' RPM); không ngoại suy ngoài vùng đo. '+
      'Cảnh báo MAP nền gãy '+(run?.rowMeta?.baseKinks||0)+' đoạn (không tự ghi). '+
      'Ô viền xanh đứt: nội suy trong đoạn đủ neo, được ghi khi ECT ấm. '+
      'GHI THỬ ECU chỉ cho đoạn có 2 neo, không gãy MAP nền, ECT ≥'+CFG.trialMinEctC+'°C và xác nhận riêng. '+
      'SỬA CONG CẢ HÀNG (VE): từ ít nhất 4 vị trí RPM có AFR + PW LIVE ổn định khi ECT đủ ấm trên CÙNG TPS, '+
      'suy VE theo đúng công thức ƒx TÍNH MAP PHUN NỀN · TRIUMPH mg khí → AFR → ms. '+
      'Nội suy hệ số hiệu chỉnh VE theo RPM, ngoại suy về VE nền, rồi tính TGP bằng AFR MỤC TIÊU từng cột. '+
      'Không ép TGP giảm tuyến tính và KHÔNG lấy thời gian phun cũ của ô chưa đo/15ms làm nền. '+
      'Cần nhập và lưu thông số piston/dên/kim/áp/deadtime/số xung trong ƒx trước khi dựng VE. '+
      'Toàn hàng VE chỉ XEM/LƯU NHÁP BLINK; GHI ECU trực tiếp bị KHÓA. '+
      'GHI AFR và SMART vẫn ON; đọc lại đủ 420 ô.';
  }
  // Local staging is operator-confirmed and NEVER a background ECU write.
  if(apply)apply.disabled=!active||!run||saving||awaitingRebase||
    !!bridge.live()?.recording||!run.estimated;
}

function stop(message){
  active=false;saving=false;awaitingRebase=false;trialWriteArmed=false;trialWriteAuthorized=false;fullRowEnabled=false;fullRowWriteAuthorized=false;afrHoldUntil=0;rebaseAfterTime=0;
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
function toggleFullRowMode(){
  if(!active||saving||awaitingRebase||!run)return;
  fullRowEnabled=!fullRowEnabled;
  if(fullRowEnabled)trialWriteArmed=false;
  const snapshot=getSnapshot();
  if(snapshot&&validRun()){
    makePreview(snapshot);
    try{bridge.refreshView()}catch(_e){}
  }
  reason=fullRowEnabled?
    'SỬA CONG CẢ HÀNG: 4 AFR/PW LIVE ổn định cùng TPS → VE theo ƒx TÍNH MAP NỀN → 30 RPM; chỉ XEM/LƯU NHÁP.':
    'SỬA CONG CẢ HÀNG TẮT: chỉ nội suy trong đoạn RPM có dữ liệu.';
  ui();
}
function toggleTrialMode(){
  if(!active||saving||awaitingRebase)return;
  if(fullRowEnabled){say('GHI THỬ ECU bị khóa với MAP VE cả hàng.');return;}
  trialWriteArmed=!trialWriteArmed;
  reason=trialWriteArmed?
    'CHẾ ĐỘ GHI THỬ ĐANG BẬT: chỉ bấm MAP ĐÃ BÙ → ECU khi đã sao lưu MAP gốc; ghi trong đoạn có 2 neo, xác nhận riêng.':
    'CHẾ ĐỘ GHI THỬ ĐÃ TẮT: chỉ ghi các đoạn đủ điều kiện bình thường.';
  ui();
}
async function applyLocal(){
  if(!active||!run||saving||!run.estimated){
    say('Chưa có MAP bù để lưu vào Blink');return false;
  }
  if(bridge.live()?.recording){say('DỪNG GHI AFR rồi mới lưu MAP bù');return false;}
  if(!validRun())return false;
  const s=run,proposal=clone(s.preview),baseline=clone(s.base);
  const modeledFullRow=fullRowEnabled&&s.fullRowMeta.rows>0;
  const unverified=modeledFullRow||s.spatial.previewOnly>0||s.spatial.eligible<2||
    s.sensorDelayMs<=0||!(Number(bridge.live()?.ect)>=CFG.spatialWarmEctC);
  const ok=await root.blinkConfirm('LƯU MAP BÙ VÀO BLINK · MAP NO.'+s.bank,
    (modeledFullRow?
      'BẢN NHÁP VE từ PW LIVE/AFR ổn định: '+s.fullRowMeta.rows+' HÀNG, '+s.estimated+
      ' Ô. Những RPM chưa đo/15ms có thể khác MAP gốc hơn 20%, cần xác minh thực tế. ':
      'Bù tối đa ±'+CFG.maxPreviewPct+'% cho '+s.estimated+' ô. ')+
    (unverified?'ĐÂY CHỈ LÀ SUY LUẬN CHƯA ĐƯỢC KIỂM CHỨNG. ':'')+
    '\n\nChỉ lưu vào BLINK, KHÔNG GHI ECU. Không sử dụng MAP chưa đo để chạy xe; '+
    'cần kiểm tra độc lập cả dải RPM trước khi ghi ECU.',
    'LƯU BẢN NHÁP','HỦY');
  if(!ok||!active||saving||run!==s||!validRun()||bridge.live()?.recording)return false;
  try{
    bridge.applyLocal({bank:s.bank,baseline,proposal,fullRowDraft:modeledFullRow});
    stop('ĐÃ LƯU MAP BÙ TRONG BLINK · CHƯA GHI ECU · phải kiểm tra lại');
    return true;
  }catch(e){say('Lưu MAP bù thất bại: '+String(e?.message||e));return false;}
}
// A TRIAL preview includes only RPM columns BETWEEN two corroborated AFR/PW
// anchors in the same TPS row with a non-kinked base; no open-ended guesswork.
function trustedForEcu({trial=false}={}){
  // Experimental full-row opt-in includes explicitly marked extrapolated
  // cells; the normal one-click route never includes them.
  const allowedCells=trial&&fullRowEnabled?
    run?.fullRowWriteCells:trial?run?.rowTrial:run?.rowApproved;
  if(!run||!allowedCells?.size)return null;
  const out=clone(run.base),included=[];
  for(const key of Array.from(allowedCells).sort((a,b)=>{
    const [ra,ca]=a.split(':').map(Number),[rb,cb]=b.split(':').map(Number);
    return ra-rb||ca-cb;
  })){
    const [r,c]=key.split(':').map(Number);
    if(r>=run.base.length-1||run.labels[r]?.[c]==='locked')continue;
    const value=Number(run.preview[r]?.[c]),baseline=Number(run.base[r]?.[c]);
    if(!Number.isFinite(value)||!Number.isFinite(baseline)||baseline<=0||
       Math.abs(value/baseline-1)>CFG.maxPreviewPct/100+.001)continue;
    if(Math.abs(value-baseline)>.001){out[r][c]=value;included.push(key);}
  }
  return included.length?{proposal:out,included,interpolated:included.filter(key=>
    run.labels[Number(key.split(':')[0])]?.[Number(key.split(':')[1])]==='row-inferred').length}:null;
}
// Single button press starts a verified ECU write without stopping GHI AFR
// or disabling SMART. Manual BLE I/O suspends LIVE 0x69 internally; isSaving()
// also drops AFR packets until the 420-cell verification has completed.
async function saveToEcu(prepareTransport){
  if(fullRowEnabled){
    say('KHÔNG GHI ECU: VE toàn hàng là mô hình; phải đo kiểm AFR/PW thực tế trước.');
    return false;
  }
  if(!active||!run||saving||awaitingRebase||!run.estimated){
    say('SMART chưa có ô MAP bù để ghi ECU. Chế độ cả hàng cần 4 neo xanh cùng TPS.');return false;
  }
  if(!validRun())return false;
  const s=run,trial=trialWriteArmed,
    fullRowTrial=trial&&fullRowEnabled,
    selected=trustedForEcu({trial}),
    ectValue=bridge.live()?.ect,ect=ectValue==null?NaN:Number(ectValue);
  const minEct=fullRowTrial?CFG.spatialWarmEctC:
    trial?CFG.trialMinEctC:CFG.spatialWarmEctC;
  const supported=fullRowTrial?s.fullRowMeta.writableRows>=1:
    trial?s.rowMeta.trialSegments>=1:
    (s.rowMeta.writeSegments>=1||s.fullRowInterior.size>=2)&&s.spatial.eligible>=2;
  if(!selected||!supported||s.sensorDelayMs<=0||!Number.isFinite(ect)||ect<minEct){
    say('CHƯA GHI ECU: cần 2 neo AFR/PW cùng TPS, delay AFR, MAP nền không gãy và ECT ≥'+
      minEct+'°C. '+(fullRowEnabled?'Hàng xem trước từ 4 ô xanh chưa chắc đủ 4 neo ẤM để ghi ECU.':trial?'GHI THỬ đã bật nhưng chưa đủ điều kiện.':'Có thể bật GHI THỬ nếu ECT 60–65°C.'));
    return false;
  }
  const baseline=clone(s.base),confirmed=trustedForEcu({trial});
  if(!confirmed||confirmed.included.join('|')!==selected.included.join('|')||
     confirmed.proposal.some((row,r)=>row.some((v,c)=>v!==selected.proposal[r][c]))||
     !active||run!==s||!validRun())return false;
  // A NORMAL write remains one-click; a TRIAL write is additionally confirmed.
  if(trial){
    const warned=await root.blinkConfirm('⚠ GHI THỬ MAP BÙ VÀO ECU · NO.'+s.bank,
      'Đây là bản thử nghiệm, có thể dựa trên dữ liệu AFR/PW chưa được xác nhận khi máy đủ ấm. '+
      'ECT '+ect.toFixed(1)+'°C, AFR delay '+s.sensorDelayMs+'ms. '+
      'Sẽ ghi '+confirmed.included.length+' ô '+
      (fullRowTrial?'GIỮA 4+ NEO ẤM (KHÔNG gồm ngoại suy)':'GIỮA neo cùng TPS')+
      ', giới hạn ±20%. '+
      (fullRowTrial?
        'CẢNH BÁO: 4 ô AFR/PW vẫn không chứng minh đúng lượng phun ở RPM chưa đo. '+
        'Không thử ở tải lớn hoặc trên đường công cộng. Dải 15ms dự đoán KHÔNG ghi ECU. ':
        'KHÔNG đổi IDLE, ô khóa, RPM chưa đo hoặc đoạn MAP nền gãy. ')+
      '\n\n'+
      'CHỈ tiếp tục khi đã SAO LƯU MAP GỐC và thử trong điều kiện kiểm soát. '+
      'Blink sao lưu MAP nền trên trình duyệt, ghi ECU rồi ĐỌC LẠI 420/420 ô. '+
      'SMART và GHI AFR vẫn ON, không tự ghi thêm.',
      'TÔI ĐÃ SAO LƯU · GHI THỬ','HỦY');
    if(!warned||!active||run!==s||saving||awaitingRebase||!validRun())return false;
    const still=trustedForEcu({trial:true});
    if(!still||still.included.join('|')!==confirmed.included.join('|')||
       still.proposal.some((row,r)=>row.some((v,c)=>v!==confirmed.proposal[r][c]))||
       !(Number(bridge.live()?.ect)>=minEct)||fullRowEnabled!==(fullRowTrial||!trial&&fullRowEnabled))return false;
  }
  saving=true;trialWriteAuthorized=trial;fullRowWriteAuthorized=fullRowTrial;
  reason=(trial?'ĐANG GHI THỬ ':'ĐANG GHI ')+'MAP BÙ TPS → ECU · '+confirmed.included.length+
    (fullRowTrial?' ô TRONG KHOẢNG NEO (ngoại suy KHÔNG ghi)':' ô trong vùng neo')+
    '; GHI AFR ON / SMART ON · xác minh 420 ô.';
  ui();
  let ok=false;
  try{
    ok=await bridge.writeSmartToEcu({
      bank:s.bank,baseline,proposal:confirmed.proposal,
      approved:confirmed.included,trialMode:trial,fullRowMode:fullRowTrial,prepareTransport
    })===true;
    if(ok)verifiedWrites++;
    return ok;
  }catch(e){
    reason='GHI SMART ECU LỖI: '+String(e?.message||e)+
      ' · SMART vẫn ON, chờ ĐỌC HIỆN TẠI xác minh MAP.';
    return false;
  }finally{
    saving=false;trialWriteAuthorized=false;trialWriteArmed=false;fullRowWriteAuthorized=false;awaitingRebase=true;
    const now=Number(root.performance?.now?.());
    rebaseAfterTime=Number.isFinite(now)?now:0;
    const holdMs=Math.max(1800,(s.sensorDelayMs||0)+1000);
    afrHoldUntil=rebaseAfterTime+holdMs;
    history=[];afrRing=[];recent=[];
    if(ok){
      reason='ĐÃ GHI '+(trial?'THỬ ':'')+'& ĐỌC LẠI 420/420 · SMART/GHI AFR VẪN ON. '+
        'Đợi LIVE mới, bỏ AFR cũ '+(holdMs/1000).toFixed(1)+'s.';
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
  const payload={revision:'PB3.79.153',algorithm:'STABLE-LIVE-AFR-PW-SHARED-VE-PHYSICS',bank:run.bank,identity:run.identity,
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
    spatialStats:run.spatial,rowCorrection:run.rowMeta,
    rowApprovedCells:Array.from(run.rowApproved),rowTrialCells:Array.from(run.rowTrial),
    fullRowCells:Array.from(run.fullRowCells),fullRowWriteCells:Array.from(run.fullRowWriteCells),
    fullRowExtrapolated:Array.from(run.fullRowExtra),
    fullRowMeta:run.fullRowMeta,
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
    '#smartPcTrialMode{background:#493325;color:#ffe8ba}#smartPcTrialMode.danger{background:#b85b13;color:#fff}'+
    '#smartPcFullRowMode{background:#164450;color:#d6ffff}#smartPcFullRowMode.danger{background:#076d82;color:#fff}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-fullrow-outside{outline:2px dashed #a657ee;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-fullrow-unverified{outline:2px dashed #c478ef;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-fullrow-interior{outline:2px dashed #18e5cd;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-fullrow-anchor{outline:2px solid #00e6ad;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-inferred{outline:1px dashed #6bc8fa;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-supported{outline:2px solid #38e2a7;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-row-inferred{outline:2px dashed #4fe2c6;outline-offset:-2px}'+
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
    '<button type="button" id="smartPcFullRowMode">SỬA CONG CẢ HÀNG: TẮT</button>'+
    '<button type="button" id="smartPcTrialMode">GHI THỬ ECU: TẮT</button>'+
    '<button type="button" id="smartPcApply" disabled>✓ LƯU MAP BÙ VÀO BLINK</button>'+
    '<button type="button" id="smartPcExport">↓ XUẤT TRACE JSON</button>'+
    '<span id="smartPcStats">Chưa có mẫu</span>'+ 
    '<span id="smartPcDiagnostics" aria-live="polite">Chờ mẫu để chẩn đoán.</span>'+
    '<small>CHỈ CHROME WINDOWS · THỬ NGHIỆM. ~AFR màu vàng: TRACE TẠM khi lướt ga, '+
    'CHƯA đủ tin cậy và KHÔNG dùng bù xăng; ≈AFR màu xanh: nhiều lượt được đối chiếu AFR/PW ô kề, vẫn là suy luận. '+
    'Không lọc 7 mẫu/1,1s khi thu; ±20% mỗi lượt. BÙ theo cả đoạn hàng TPS giữa ≥2 neo '+
    'AFR/PW, làm mượt theo RPM và liên kết hàng TPS kề. Không tự bù các vùng chưa đo; '+
    'không thay hàng IDLE hoặc ô khóa. Một lần bấm MAP ĐÃ BÙ → ECU sẽ ghi cả ô nội suy '+
    'đủ điều kiện, đọc lại 420 ô; GHI AFR và SMART vẫn ON. '+
    'SỬA CONG CẢ HÀNG lấy ít nhất 4 ô có AFR/PW LIVE đã đo ổn định khi máy ấm cùng TPS để suy VE. '+
    'Dùng cùng công thức ƒx TÍNH MAP NỀN với thông số động cơ/kim đã lưu để dựng cả 30 RPM. '+
    'Không dùng TGP cũ ô chưa chạy, kể cả 15ms; không ép tuyến tính giảm. '+
    'Ngoài vùng đo là NGOẠI SUY. Chỉ XEM/LƯU NHÁP BLINK; GHI THỬ/ GHI ECU trực tiếp bị KHÓA trong chế độ này. '+
    'Phải xác minh AFR thật trên động cơ trước khi sử dụng.</small>';
  get('autoTuneQuickBar').insertAdjacentElement('afterend',panel);
  get('smartPcToggle').addEventListener('click',toggle);
  get('smartPcTrialMode').addEventListener('click',toggleTrialMode);
  get('smartPcFullRowMode').addEventListener('click',toggleFullRowMode);
  get('smartPcApply').addEventListener('click',()=>{void applyLocal()});
  get('smartPcExport').addEventListener('click',exportLog);
  ui();
}
root.BlinkPcSmartAutoTune=Object.freeze({isActive:()=>active,onAfr,onLive,preview,cellStatus,stop,
  measuredEstimate,pendingAfr,saveToEcu,isSaving:()=>saving,
  isTrialWriteAuthorized:()=>saving&&trialWriteAuthorized,
  isTrialCellApproved:(r,c)=>saving&&trialWriteAuthorized&&(
    !!run?.rowTrial?.has(r+':'+c)||!!(fullRowWriteAuthorized&&run?.fullRowWriteCells?.has(r+':'+c))),
  isFullRowWriteAuthorized:()=>saving&&trialWriteAuthorized&&fullRowWriteAuthorized,
  isFullRowMode:()=>active&&fullRowEnabled&&!saving&&!awaitingRebase,
  isFullRowDraftCell:(r,c)=>active&&fullRowEnabled&&!saving&&!awaitingRebase&&
    !!run?.fullRowCells?.has(r+':'+c),
  getStats:()=>({active,saving,awaitingRebase,trialWriteArmed,fullRowEnabled,verifiedWrites,raw,accepted,rejected,suspected,
    provisionalSamples,provisionalSkipped,fuelEligible:Math.max(0,accepted-diagnostics.idleOnly),
    provisionalCells:run?.provisional.size||0,
    anchors:run?.anchors.size||0,estimated:run?.estimated||0,
    afrEstimates:run?.evidence.size||0,readyAnchors:readyAnchors(),
    diagnostics:{...diagnostics},
    spatial:run?{...run.spatial}:null,row:run?{...run.rowMeta}:null,
    fullRow:run?{...run.fullRowMeta}:null,
    approvedCells:run?.rowApproved?.size||0,trialCells:run?.rowTrial?.size||0,
    spatialBuckets:run?.spatialBuckets.size||0,
    corroborated:run?.spatialConfirmed.size||0,
    sensorDelayMs:run?.sensorDelayMs||0,reason})});
initUI();
})(window);

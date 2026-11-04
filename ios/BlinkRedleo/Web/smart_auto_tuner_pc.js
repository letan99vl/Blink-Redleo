/* Blink TL PB3.79.166 | SMART AUTO TUNER | Chrome PC + Android + iOS Bluefy + native iOS IPA.
   Explicit recording and ECU-write actions; no automatic write or firmware changes. */
(function(root){
'use strict';
const ua=String(root.navigator?.userAgent||'');
const ios=/iPhone|iPad|iPod/i.test(ua)||
  (/Macintosh/i.test(ua)&&Number(root.navigator?.maxTouchPoints)>1);
const bluefy=ios&&/Bluefy/i.test(ua);
const android=/Android|BLINK-REDLEO-ANDROID/i.test(ua);
const pc=/Windows NT|Win64|Win32/i.test(ua)&&/Chrome\/\d+/i.test(ua)&&
  !/Edg\/|Edge\/|OPR\/|Opera\/|Electron|BLINK-REDLEO-ANDROID|Bluefy|Mobile|Android|iPhone|iPad/i.test(ua);
const nativeIOS=/BLINK-REDLEO-IOS\//i.test(ua);
const supported=pc||android||bluefy||nativeIOS;
const bridge=root.blinkPcSmartBridge,doc=root.document;
if(!supported||root.BLINK_PC_SMART_TUNE!==true||!bridge||!doc?.getElementById('autoTuneQuickBar'))return;
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
  fullRowMinAnchors:3,fullRowCurvatureWeight:2.8,fullRowAnchorWeight:16,
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
  fullRowEnabled=true,fullRowWriteAuthorized=false,fullRowExplicitAuthorized=false,afrHoldUntil=0,rebaseAfterTime=0,verifiedWrites=0,run=null,history=[],afrRing=[],recent=[],lastAccept=0,lastUI=0;
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
let reason='Chưa bật SMART MAP · Chrome PC / Android / Bluefy';
const clone=m=>m.map(row=>row.slice());
const fuelSettingsSignature=()=>{
  // A different injector/engine/AFR-scale setting invalidates ALL old VE
  // anchors: the observed PW can no longer be interpreted with the same model.
  try{return String(root.localStorage?.getItem('blinkFuelModelSettingsV1')||'');}
  catch(_e){return '';}
};
const keyOf=s=>JSON.stringify([s.bank,s.identity,s.tps,s.rpms,s.map,s.target,
  fuelSettingsSignature()]);
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

function smartFuelProfileReady(){
  try{
    const saved=root.localStorage?.getItem('blinkFuelModelSettingsV1');
    const math=root.BlinkFuelModelMath;
    if(!saved||typeof math?.calculateStableFuelRow!=='function'||
       typeof math.validate!=='function')return false;
    // TINH & XEM TRUOC saves these values on each device independently.
    // An invalid or missing configuration cannot silently authorize VE fitting.
    const data=JSON.parse(saved);
    if(!data||typeof data!=='object'||Array.isArray(data))return false;
    math.validate(data);
    return true;
  }catch(_e){return false;}
}
function startRun(){
  const s=getSnapshot();
  if(!s){say('Hãy kết nối, ĐỌC MAP ECU, xác minh TPS và AFR mục tiêu trước');return false;}
  if(s.autoIdle){say('Phải tắt TỰ LƯU MAP trước khi bật SMART');return false;}
  if(!smartFuelProfileReady()){
    const info='Cần vào THỜI GIAN PHUN → ƒx TÍNH MAP NỀN, nhập thông số máy/kim '+
      'và bấm TÍNH & XEM TRƯỚC trước khi bật SMART MAP trên thiết bị này.';
    say(info);
    try{root.blinkAlert?.(info,'SMART MAP')}catch(_e){}
    return false;
  }
  saving=false;awaitingRebase=false;trialWriteArmed=false;trialWriteAuthorized=false;fullRowEnabled=true;fullRowWriteAuthorized=false;fullRowExplicitAuthorized=false;
  history=[];afrRing=[];recent=[];raw=accepted=rejected=suspected=0;
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
    fullRowMeta:{rows:0,writableRows:0,calculated:0,changed:0,unverified:0,extrapolated:0,protected:0,anchorCells:0,oldKinks:0,newKinks:0,calibrated:0,provisional:0,previewOnlyRows:0,lastError:''},
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
// Full-row VE fuel prediction: at least 3 independently corroborated
// LIVE AFR/PW measurements at different RPMs on the SAME TPS row.
// The model predicts all 30 RPM columns, including old 15.00ms placeholders.
// An explicit one-tap MAP DA BU -> ECU writes all changed VE cells from
// rows modeled by >=3 BLUE nodes, including unmeasured extrapolation.
// This does NOT prove AFR or fuel safety on a real engine.
// Source/live AFR validation and readback do not establish safe road fueling.
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
  // Two confidence tiers:
  // 3+ warm, steady LIVE nodes = calibrated VE row / local draft.
  // 3+ corroborated BLUE nodes = low-confidence VE row, also allowed to
  // stage LOCALLY after an explicit warning, never direct ECU writing.
  // BLUE means repeated spatial AFR/PW corroboration, NOT proof that fuel
  // injection has stabilized. Do not silently treat BLUE as write-safe.
  const rows=Array.from(run.spatialConfirmed.values()).filter(x=>
    x.r===r&&x.previewEligible===true&&
    Number.isInteger(x.c)&&x.c>=0&&x.c<base.length&&!s.locked?.[r]?.[x.c]&&
    Number.isFinite(x.livePw)&&x.livePw>0&&
    Number.isFinite(x.liveRpm)&&x.liveRpm>=500&&
    Number.isFinite(x.observedAfr)&&x.observedAfr>CFG.minAfr&&
    Number.isFinite(x.liveTps)&&x.liveTps>=0).sort((a,b)=>a.c-b.c);
  const dedup=xs=>{
    const out=[];for(const x of xs)if(!out.length||out[out.length-1].c!==x.c)out.push(x);
    return out;
  };
  const blue=dedup(rows),stable=dedup(rows.filter(x=>x.stableForVe===true));
  const verified=stable.length>=CFG.fullRowMinAnchors;
  const use=verified?stable:blue;
  if(use.length<CFG.fullRowMinAnchors)return null;
  let predicted;
  try{
    predicted=math.calculateStableFuelRow(settings,{
      tps:Number(run.tps[r]),rpms:run.rpms,targets:target,
      readings:use.map(x=>({c:x.c,tps:x.liveTps,rpm:x.liveRpm,
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
  if(verified)run.fullRowMeta.calibrated+=predicted.anchorCount;
  else{
    run.fullRowMeta.provisional+=predicted.anchorCount;
    run.fullRowMeta.previewOnlyRows++;
  }
  const oldKinks=fullRowKinkCount(base.map(Number),valid);
  const newKinks=fullRowKinkCount(output.map(Number),valid);
  // Direct ECU writes: 3+ WARM STABLE nodes, short measured brackets only.
  // Outside-node extrapolation and the 15ms placeholder band are preview-only.
  const safeSpan=new Set();
  if(verified){
    const cols=predicted.nodes.map(x=>x.c).sort((a,b)=>a-b);
    for(let i=1;i<cols.length;i++){
      const first=cols[i-1],last=cols[i];
      if(last-first>CFG.rowMaxAnchorGap)continue;
      let safe=true;
      for(let c=first;c<=last;c++)if(!valid[c]||placeholders.has(c)||
        !(Number(base[c])>0)){safe=false;break;}
      if(safe)for(let c=first;c<=last;c++)safeSpan.add(c);
    }
  }
  return {row:r,first:predicted.first,last:predicted.last,
    anchorSet:new Set(predicted.nodes.map(x=>x.c)),safeSpan,
    valid,output,placeholders,writeReady:verified&&newKinks<=oldKinks,
    lowConfidence:!verified,stableAnchorCount:stable.length,
    blueAnchorCount:blue.length,oldKinks,newKinks,protected:placeholders.size};
}
function makePreview(s){
  if(!run)return;
  const base=run.base,rows=base.length-1,cols=base[0].length;
  run.rowApproved.clear();run.rowTrial.clear();
  run.fullRowCells.clear();run.fullRowWriteCells.clear();run.fullRowInterior.clear();run.fullRowExtra.clear();run.fullRowRows.clear();run.fullRowWritableRows.clear();
  run.fullRowMeta={rows:0,writableRows:0,calculated:0,changed:0,unverified:0,extrapolated:0,protected:0,anchorCells:0,oldKinks:0,newKinks:0,calibrated:0,provisional:0,previewOnlyRows:0,lastError:''};
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
  // Only display a BLUE ≈ node if it is eligible for the VE learner.
  // Without calibrated AFR delay (or at a clipped sensor floor), show ~ amber
  // provisional trace instead: this node cannot seed a full-row prediction.
  return x?.previewEligible===true?
    {afr:x.afr,n:x.n,weight:x.neighbors,kind:'spatial',note:x.note}:null;
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
  // Use warm-time-matched samples for an actual VE calibration. Earlier
  // cold/warm-up excursions must NOT pollute otherwise stable warm PW/AFR.
  // A blue-only preview may still show the overall independently repeated
  // samples but remains explicitly low-confidence and cannot be staged.
  const warmSamples=agrees.filter(x=>Number.isFinite(x.ect)&&x.ect>=CFG.spatialWarmEctC);
  const physSamples=warmSamples.length>=2?warmSamples:agrees;
  const livePw=median(physSamples.map(x=>x.pw)),liveRpm=median(physSamples.map(x=>x.rpm)),
    liveTps=median(physSamples.map(x=>x.tps)),observedAfr=median(physSamples.map(x=>x.afr));
  const span=a=>Math.max(...a)-Math.min(...a);
  const stableReading=warmSamples.length>=2&&
    span(warmSamples.map(x=>x.afr))<=.55&&
    span(warmSamples.map(x=>x.pw))/Math.max(.05,livePw)<=.14&&
    span(warmSamples.map(x=>x.rpm))<=500&&
    span(warmSamples.map(x=>x.tps))<=2.5;
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
  const localWarm=warmSamples.length>=2;
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
    warmSamples:warmSamples.length,independentSamples:agrees.length,
    veReason:!previewEligible?'Đo gần ngưỡng / AFR delay':
      !localWarm?'Chưa đủ 2 mẫu ấm cùng vùng':
      !stableReading?'AFR/PW/RPM/TPS cùng vùng chưa đủ ổn định':'Đủ ổn định',
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
  const button=get('smartPcToggle');
  if(!button)return;
  const mobileUi=typeof root.matchMedia==='function'&&
    root.matchMedia('(max-width:920px), (pointer:coarse) and (max-width:1100px)').matches;
  const label=mobileUi?(saving?'⏳ ĐANG GHI ECU':(active?'■ TẮT SMART':'◆ BẬT SMART')):
    (saving?'⏳ SMART ĐANG GHI ECU':
     (active?'■ TẮT SMART MAP · SỬA CONG ON':'◆ BẬT SMART MAP'));
  if(button.textContent!==label)button.textContent=label;
  button.disabled=!!saving;
  button.classList.toggle('danger',active);
  button.setAttribute('aria-pressed',String(active));
  const panel=get('smartPcPanel');
  if(panel)panel.classList.toggle('smart-active',active);
  // Keep risk details on the button tooltip and mandatory ECU confirmations.
  button.title=(active?
    'SỬA CONG CẢ HÀNG: luôn ON. Ô RPM ngoại suy chưa đo AFR có thể gây hư hỏng động cơ. Chỉ bấm MAP ĐÃ BÙ → ECU sau khi sao lưu MAP gốc. ':
    'Khi bật SMART MAP, SỬA CONG CẢ HÀNG sẽ tự ON. ')+reason;
}

function stop(message){
  active=false;saving=false;awaitingRebase=false;trialWriteArmed=false;trialWriteAuthorized=false;fullRowEnabled=true;fullRowWriteAuthorized=false;fullRowExplicitAuthorized=false;afrHoldUntil=0;rebaseAfterTime=0;
  run=null;history=[];afrRing=[];
  reason=message||'SMART MAP đã tắt · không ghi ECU';
  ui();try{bridge.refreshView()}catch(_e){}
}
function toggle(){
  if(saving)return;
  if(active){stop('Đã hủy SMART MAP · MAP ECU giữ nguyên');return;}
  if(!startRun())return;
  if(!bridge.disableAutoIdle()){run=null;say('Không tắt được TỰ LƯU; SMART không bật');return;}
  active=true;reason='SMART SPATIAL: lưu dấu AFR mọi lượt ga; đối chiếu ô kề + PW, chỉ đề xuất khi đủ chứng cứ.';
  ui();try{bridge.refreshView()}catch(_e){}
}
function toggleFullRowMode(){
  if(!active||saving||awaitingRebase||!run)return;
  fullRowEnabled=!fullRowEnabled;
  fullRowExplicitAuthorized=false;
  if(fullRowEnabled)trialWriteArmed=false;
  const snapshot=getSnapshot();
  if(snapshot&&validRun()){
    makePreview(snapshot);
    try{bridge.refreshView()}catch(_e){}
  }
  reason=fullRowEnabled?
    'SỬA CONG CẢ HÀNG: 3 ô XANH cùng TPS dựng 30 RPM. Nhấn MAP ĐÃ BÙ → ECU 1 LẦN để ghi mọi ô bù đã hiện (kể cả ngoại suy); GHI AFR vẫn ON.':
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
  const lowConfidenceDraft=modeledFullRow&&s.fullRowMeta.previewOnlyRows>0;
  const unverified=modeledFullRow||s.spatial.previewOnly>0||s.spatial.eligible<2||
    s.sensorDelayMs<=0||!(Number(bridge.live()?.ect)>=CFG.spatialWarmEctC);
  const ok=await root.blinkConfirm('LƯU MAP BÙ VÀO BLINK · MAP NO.'+s.bank,
    (modeledFullRow?
      'BẢN NHÁP VE từ ít nhất 3 ô XANH cùng TPS: '+s.fullRowMeta.rows+
      ' hàng, '+s.estimated+' ô dự đoán. ':
      'Bù tối đa ±'+CFG.maxPreviewPct+'% cho '+s.estimated+' ô. ')+
    (lowConfidenceDraft?
      'CẢNH BÁO: '+s.fullRowMeta.previewOnlyRows+
      ' hàng chỉ có AFR/PW đối chiếu, CHƯA đủ ổn định để xác nhận lượng phun. '+
      'Chỉ được LƯU NHÁP BLINK; bản này sẽ bị CHẶN GHI ECU. ':
      (unverified?'ĐÂY LÀ MÔ HÌNH CHƯA KIỂM CHỨNG TOÀN DẢI RPM. ':''))+
    '\n\nÔ chưa đo và dải 15ms có thể khác MAP gốc nhiều hơn 20%. '+
    'Không ghi ECU, không sử dụng bản nháp này để chạy xe khi chưa đo AFR độc lập.',
    'CHỈ LƯU NHÁP BLINK','HỦY');
  if(!ok||!active||saving||run!==s||!validRun()||bridge.live()?.recording)return false;
  try{
    bridge.applyLocal({bank:s.bank,baseline,proposal,fullRowDraft:modeledFullRow,lowConfidenceDraft});
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
// Explicit high-risk writer; ONE user tap, no automatic write, no
// recording toggle, original map backup + 420/420 readback remain mandatory.
// PB3.79.157 ONE USER TAP: all shown corrected VE-row cells from >=3
// corroborated BLUE AFR/PW nodes are sent to the current ECU. This includes
// unmeasured RPM extrapolation and may cause a dangerous fuel mixture.
// Do not auto-write. Keep physical table limits, lock/identity validation,
// original-map backup, exclusive BLE transport and 420-cell readback.
async function saveFullRowToEcu(prepareTransport){
  if(!active||!fullRowEnabled||!run||saving||awaitingRebase||
     run.fullRowRows.size<1||run.fullRowCells.size<1){
    say('CHƯA GHI: chưa dựng được hàng TPS từ 3 ô AFR/PW XANH.');return false;
  }
  if(typeof prepareTransport!=='function'){
    say('CHƯA GHI: cần luồng ECU REAL độc quyền.');return false;
  }
  if(!validRun())return false;
  const snap=getSnapshot(),s=run;
  if(!snap||Number(snap.bank)!==Number(s.bank)||keyOf(snap)!==s.key){
    say('MAP/ECU đã đổi: hủy ghi bản dự đoán cũ.');return false;
  }
  const max=Number(snap.maxMs);
  if(!Number.isFinite(max)||max<=0)return false;
  const baseline=clone(s.base),proposal=clone(s.base),approved=[],writtenRows=new Set();
  const keys=Array.from(s.fullRowCells).sort((a,b)=>{
    const [ra,ca]=a.split(':').map(Number),[rb,cb]=b.split(':').map(Number);
    return ra-rb||ca-cb;
  });
  for(const key of keys){
    const a=key.split(':').map(Number),r=a[0],c=a[1];
    if(a.length!==2||!Number.isInteger(r)||!Number.isInteger(c)||
       r<0||r>=baseline.length-1||c<0||c>=baseline[r].length||
       !s.fullRowRows.has(r)||snap.locked?.[r]?.[c]||
       s.labels[r]?.[c]==='locked'){
      say('Hủy ghi: ô VE ngoài hàng TPS hoặc bị KHÓA AFR: '+key);return false;
    }
    const old=Number(baseline[r][c]),next=Number(s.preview[r]?.[c]);
    if(!(old>0)||!Number.isFinite(next)||next<=0||next>max){
      say('Hủy ghi: thời gian phun vượt giới hạn protocol tại '+key);return false;
    }
    if(Math.abs(next-old)<=.000001)continue;
    proposal[r][c]=next;approved.push(key);writtenRows.add(r);
  }
  if(!approved.length||approved.length!==s.fullRowCells.size){
    say('Danh sách ô VE không khớp MAP ĐÃ BÙ; chưa gửi ECU.');return false;
  }
  // Recording remains ON. SMART onAfr/onLive suppress samples while saving;
  // REAL ECU I/O owns a single-flight transport and pauses 0x69 internally.
  saving=true;trialWriteAuthorized=true;fullRowWriteAuthorized=true;
  fullRowExplicitAuthorized=true;
  const recording=!!bridge.live()?.recording;
  reason='ĐANG GHI '+approved.length+' Ô VE / '+writtenRows.size+
    ' HÀNG TPS · NGOẠI SUY CŨNG GHI · GHI AFR '+(recording?'ON':'OFF')+
    ' · SAO LƯU GỐC, XÁC MINH 420 Ô';
  ui();
  let ok=false;
  try{
    ok=await bridge.writeSmartToEcu({
      bank:s.bank,baseline,proposal,approved,trialMode:true,
      fullRowMode:true,fullRowExplicit:true,
      lowConfidence:s.fullRowMeta.previewOnlyRows>0,prepareTransport
    })===true;
    if(ok)verifiedWrites++;
    return ok;
  }catch(e){
    reason='LỖI GHI VE: '+String(e?.message||e)+
      ' · Phải ĐỌC HIỆN TẠI trước khi ghi lại.';return false;
  }finally{
    saving=false;trialWriteAuthorized=false;fullRowWriteAuthorized=false;
    fullRowExplicitAuthorized=false;trialWriteArmed=false;awaitingRebase=true;
    const now=Number(root.performance?.now?.());
    rebaseAfterTime=Number.isFinite(now)?now:0;
    afrHoldUntil=rebaseAfterTime+Math.max(1800,(s.sensorDelayMs||0)+1000);
    history=[];afrRing=[];recent=[];
    if(ok){
      reason='GHI '+approved.length+' Ô VE / '+writtenRows.size+
        ' HÀNG · READBACK 420/420 KHỚP · GHI AFR '+(recording?'VẪN ON':'OFF')+
        ' · DỮ LIỆU NGOẠI SUY CHƯA KIỂM CHỨNG AFR.';
    }else if(!reason.startsWith('LỖI GHI VE')){
      reason='GHI VE CHƯA XÁC MINH · ĐỌC HIỆN TẠI trước khi tiếp tục.';
    }
    ui();try{bridge.refreshView()}catch(_e){}
  }
}
async function saveToEcu(prepareTransport){
  if(fullRowEnabled)return saveFullRowToEcu(prepareTransport);
  if(!active||!run||saving||awaitingRebase||!run.estimated){
    say('SMART chưa có ô MAP bù để ghi ECU. Chế độ VE cả hàng 3 neo chỉ cho phép lưu nháp Blink, không ghi ECU.');return false;
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
      minEct+'°C. '+(fullRowEnabled?'Hàng VE từ 3 ô xanh chỉ được lưu nháp Blink; ghi ECU trực tiếp vẫn khóa.':trial?'GHI THỬ đã bật nhưng chưa đủ điều kiện.':'Có thể bật GHI THỬ nếu ECT 60–65°C.'));
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
        'CẢNH BÁO: 3 ô AFR/PW không chứng minh đúng lượng phun ở RPM chưa đo. '+
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
  const payload={revision:'PB3.79.158',algorithm:'THREE-BLUE-AFR-PW-VE-LOCAL-ONLY',bank:run.bank,identity:run.identity,
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
  style.textContent='#smartPcPanel{display:none;align-items:stretch;flex-direction:column;'+
    'gap:4px;box-sizing:border-box;min-width:0;max-width:100%;'+
    'padding:3px 8px;margin:2px 8px;background:transparent;border:0}'+
    '#mapEditorScreen.autoTuneMap #smartPcPanel{display:flex}'+
    'body.mapZoomMode #mapEditorScreen #smartPcPanel{display:none!important}'+
    '#smartPcToggle{width:100%;min-width:0;min-height:36px;padding:5px 12px;border-radius:7px;'+
    'touch-action:manipulation;white-space:normal;line-height:1.3;'+
    'border:1px solid #4c9ac8;font-size:12px;font-weight:800;background:#075a55;color:#fff}'+

    '@media(max-width:600px){#smartPcPanel{margin:1px 7px 5px;padding:1px 0}'+
    '#smartPcToggle{min-height:42px;font-size:12px}}'+
    '#smartPcToggle.danger{background:#8c2635}'+
    '#smartPcToggle:disabled{opacity:.7}'+
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
  panel.innerHTML='<button type="button" id="smartPcToggle" aria-pressed="false" '+
    'title="SMART MAP: sửa cong cả hàng luôn ON; RPM ngoại suy chưa được kiểm chứng AFR.">◆ BẬT SMART MAP</button>';
  // Keep the original SMART button and auto-idle checkbox on one mobile row.
  // On desktop the wrapper stays stacked; no change to BLE/ECU callbacks.
  const row=get('autoTuneSmartIdleRow');
  if(row&&get('autoIdleSaveControl')){
    row.insertBefore(panel,get('autoIdleSaveControl'));
    row.classList.add('smartMobileControls');
  }else{
    get('autoTuneQuickBar').insertAdjacentElement('afterend',panel);
  }
  get('smartPcToggle').addEventListener('click',toggle);
  ui();
}
root.BlinkPcSmartAutoTune=Object.freeze({isActive:()=>active,onAfr,onLive,preview,cellStatus,stop,
  measuredEstimate,pendingAfr,saveToEcu,isSaving:()=>saving,
  isTrialWriteAuthorized:()=>saving&&trialWriteAuthorized,
  isTrialCellApproved:(r,c)=>saving&&trialWriteAuthorized&&(
    !!run?.rowTrial?.has(r+':'+c)||
    !!(fullRowWriteAuthorized&&fullRowExplicitAuthorized&&run?.fullRowCells?.has(r+':'+c))||
    !!(fullRowWriteAuthorized&&!fullRowExplicitAuthorized&&run?.fullRowWriteCells?.has(r+':'+c))),
  isFullRowWriteAuthorized:()=>saving&&trialWriteAuthorized&&fullRowWriteAuthorized&&fullRowExplicitAuthorized,
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

/* Blink TL PB3.79.139 | SMART AUTO TUNER | Chrome Windows PC only.
   Local 420-cell preview. No automatic ECU writes or firmware changes. */
(function(root){
'use strict';
const ua=String(root.navigator?.userAgent||'');
const pc=/Windows NT|Win64|Win32/i.test(ua)&&/Chrome\/\d+/i.test(ua)&&
  !/Edg\/|Edge\/|OPR\/|Opera\/|Electron|BLINK-REDLEO-ANDROID|Bluefy|Mobile|Android|iPhone|iPad/i.test(ua);
const bridge=root.blinkPcSmartBridge,doc=root.document;
if(!pc||root.BLINK_PC_SMART_TUNE!==true||!bridge||!doc?.getElementById('autoTuneQuickBar'))return;
const CFG=Object.freeze({traceMs:12000,minLiveSpan:1100,maxGap:650,tpsSpread:0.85,rpmSpread:160,
  minPointGap:850,maxAfrSpread:0.72,minAfr:10.15,maxAfr:19.85,maxRelError:0.18,
  maxPreviewPct:7,minWeight:0.18,minAfrEstimateWeight:0.25,minAfrEstimateCount:2,
  provisionalLiveMaxAge:450,provisionalAfrRange:2.8,provisionalCornerWeight:0.10});
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
function stableTrace(history,at,p){
  const h=history.filter(a=>a.t>=at-1400&&a.t<=at+120);
  if(h.length<5||h[h.length-1].t-h[0].t<CFG.minLiveSpan||h.some(a=>a.bank!==p.bank))return false;
  const tps=h.map(a=>a.tps),rpm=h.map(a=>a.rpm);
  return Math.max(...tps)-Math.min(...tps)<=CFG.tpsSpread&&
    Math.max(...rpm)-Math.min(...rpm)<=Math.max(CFG.rpmSpread,p.rpm*.035);
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
let active=false,run=null,history=[],afrRing=[],recent=[],lastAccept=0,lastUI=0;
let provisionalSamples=0,provisionalSkipped=0,lastProvisionalUI=0;
let raw=0,accepted=0,rejected=0,suspected=0;
const emptyDiagnostics=()=>({afrInvalid:0,afrSpike:0,afrUnstable:0,traceMissing:0,
  traceUnstable:0,liveStale:0,pwInvalid:0,outsideAxis:0,targetInvalid:0,
  errorLarge:0,anchorConflict:0,spacing:0,nearTarget:0,idleOnly:0});
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
  history=[];afrRing=[];recent=[];raw=accepted=rejected=suspected=0;
  diagnostics=emptyDiagnostics();
  provisionalSamples=provisionalSkipped=0;lastProvisionalUI=0;
  lastAccept=lastUI=0;
  run={bank:s.bank,identity:s.identity,key:keyOf(s),base:clone(s.map),target:clone(s.target),
    tps:s.tps.slice(),rpms:s.rpms.slice(),anchors:new Map(),evidence:new Map(),provisional:new Map(),
    preview:clone(s.map),labels:s.map.map(row=>row.map(()=>'none')),estimated:0};
  return true;
}
function validRun(){
  if(!run)return false;
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
    const original=Number(base[r][c]);
    if(original<=0||s.locked?.[r]?.[c]){labels[r][c]='locked';continue;}
    let total=0,sum=0,nearest=Infinity,localGood=false;
    for(const a of anchors){
      if(a.n<2)continue;
      const dy=(r-a.u)/1.45,dx=(c-a.v)/2.3,d=dy*dy+dx*dx;
      if(d>5.8)continue;
      const w=Math.exp(-d*.72)*Math.min(1,a.n/4);
      total+=w;sum+=w*(a.logSum/a.n);nearest=Math.min(nearest,d);
      if(d<.13&&a.n>=3)localGood=true;
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
function measuredEstimate(r,c){
  if(!active||!run)return null;
  const e=run.evidence.get(r+':'+c);
  if(!e||e.n<CFG.minAfrEstimateCount||e.weight<CFG.minAfrEstimateWeight)return null;
  const afr=e.sum/e.weight;
  return Number.isFinite(afr)?{afr,n:e.n,weight:e.weight,kind:'inferred'}:null;
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
function collectProvisional(sample,neighbors){
  if(!active||!run||!Array.isArray(neighbors)||neighbors.length!==3)return;
  const values=neighbors.map(x=>Number(x.afr));
  if(values.some(v=>!Number.isFinite(v)||v<=CFG.minAfr||v>=CFG.maxAfr)){
    provisionalSkipped++;return;
  }
  const [before,center,after]=values;
  // A spike or unstable lambda segment must not paint a plausible-looking AFR
  // value over four cells. This rule is independent of AFR TARGET.
  if(Math.max(...values)-Math.min(...values)>CFG.provisionalAfrRange ||
     (Math.abs(center-before)>2&&Math.abs(center-after)>2&&Math.abs(before-after)<1)){
    provisionalSkipped++;return;
  }
  const delay=clamp(Number(bridge.live()?.afrDelayMs)||0,0,2500);
  const p=provisionalTraceAt(sample.t-delay);
  if(!p||p.bank!==run.bank||!Number.isFinite(p.pw)||p.pw<=0||
     !Number.isFinite(p.tps)||!Number.isFinite(p.rpm)){
    provisionalSkipped++;return;
  }
  const minimum=Number(run.tps[run.tps.length-2]);
  const idle=Number.isFinite(minimum)&&p.tps<Math.max(.05,minimum/2);
  const u=idle?run.tps.length-1:coord(run.tps.slice(0,-1),p.tps,true);
  const v=coord(run.rpms,p.rpm);
  if(u===null||v===null){provisionalSkipped++;return;}
  const atTarget=sample2D(run.target,u,v);
  if(!Number.isFinite(atTarget)||atTarget<9||atTarget>18){provisionalSkipped++;return;}
  const r0=Math.floor(u),r1=idle?r0:Math.min(run.tps.length-2,r0+1);
  const c0=Math.floor(v),c1=Math.min(run.rpms.length-1,c0+1);
  const dy=idle?0:clamp(u-r0,0,1),dx=clamp(v-c0,0,1);
  const rr=r0===r1?[[r0,1]]:[[r0,1-dy],[r1,dy]];
  const cc=c0===c1?[[c0,1]]:[[c0,1-dx],[c1,dx]];
  const changed=[];
  for(const [r,rw] of rr)for(const [c,cw] of cc){
    const w=rw*cw;
    if(w<CFG.provisionalCornerWeight||r<0||r>=run.tps.length||
       c<0||c>=run.rpms.length)continue;
    const targetCell=Number(run.target[r][c]);
    if(!Number.isFinite(targetCell)||targetCell<=0)continue;
    // An estimated AFR at a neighboring node is a DISPLAY value only.
    // It is NOT a measured AFR for that breakpoint.
    const inferredAfr=targetCell*(center/atTarget);
    if(!Number.isFinite(inferredAfr)||inferredAfr<=0||inferredAfr>=21)continue;
    const key=r+':'+c;
    let e=run.provisional.get(key);
    if(!e){e={samples:[],n:0,last:0,source:p.source};run.provisional.set(key,e);}
    e.samples.push({afr:inferredAfr,w,t:sample.t});
    if(e.samples.length>11)e.samples.shift();
    e.n++;e.last=sample.t;e.source=p.source;
    changed.push({r,c});
  }
  if(!changed.length){provisionalSkipped++;return;}
  provisionalSamples++;
  log({t:sample.t,afr:center,quality:'provisional-not-for-tuning',
    tps:p.tps,rpm:p.rpm,delayMs:delay,traceSource:p.source,cells:changed.length});
  try{bridge.refreshPendingCells?.(changed);}catch(_e){}
  if(sample.t-lastProvisionalUI>500){lastProvisionalUI=sample.t;ui();}
}
function pendingAfr(r,c){
  if(!active||!run)return null;
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
  if(Math.abs(afr/target-1)>CFG.maxRelError){
    note('errorLarge');say('AFR quá lệch mục tiêu: dừng học, kiểm tra bỏ lửa/thiếu dư xăng',true);return;
  }
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
  if(!active||!run||!info||![info.t,info.tps,info.rpm].every(Number.isFinite))return;
  if(!validRun())return;
  const p={t:info.t,bank:Number(info.bank),tps:info.tps,rpm:info.rpm,
    pw:Number.isFinite(info.pw)?info.pw:NaN};
  history.push(p);
  while(history.length&&p.t-history[0].t>CFG.traceMs)history.shift();
  if(history.length>1300)history.splice(0,history.length-1300);
  if(p.t-lastUI>900){lastUI=p.t;ui();}
}
function onAfr(info){
  if(!active||!run)return false;
  // Smart mode is the ONLY recorder while active, even for rejected samples.
  const t=Number(info?.t),value=Number(info?.afr);
  if(!Number.isFinite(t)||!Number.isFinite(value))return true;
  if(!bridge.live()?.recording)return true;
  if(!validRun())return true;
  raw++;
  afrRing.push({t,afr:value,handled:false,pendingHandled:false});
  if(afrRing.length>20)afrRing.shift();
  // Use a three-point local AFR window for EARLY, DISPLAY-ONLY trace markers.
  // Even if seven-point stable learning rejects this sequence, visible "~"
  // readings can show where usable historical AFR arrived during a sweep.
  if(afrRing.length>=3){
    const recentThree=afrRing.slice(-3),candidate=recentThree[1];
    if(!candidate.pendingHandled){
      candidate.pendingHandled=true;
      collectProvisional(candidate,recentThree);
    }
  }
  if(afrRing.length<7){reason='Đang gom chuỗi AFR để xác nhận tự bù';ui();return true;}
  const window=afrRing.slice(-7),mid=window[3];
  if(mid.handled)return true;
  mid.handled=true;
  const q=filterAfr(window);
  if(!q.ok){note(q.code);log({t:mid.t,afr:mid.afr,quality:'reject',reason:q.reason});say(q.reason,true);return true;}
  const delay=clamp(Number(bridge.live()?.afrDelayMs)||0,0,2500);
  const when=mid.t-delay;
  const p=findTrace(history,when);
  const fresh=!!history.length&&t-history[history.length-1].t<=900;
  const steady=!!p&&stableTrace(history,when,p);
  if(!p||!steady||!fresh){
    const diagnosis=!p?'traceMissing':!fresh?'liveStale':'traceUnstable';
    note(diagnosis);
    log({t:mid.t,afr:q.afr,quality:'reject',reason:diagnosis});
    say('Ga thay đổi / LIVE chưa ổn định: '+
      (provisionalSamples?'~AFR TẠM đã ghi vào bảng (không dùng học xăng)':'chờ thêm AFR + TRACE để hiện số tạm'),true);
    return true;
  }
  if(!Number.isFinite(p.pw)||p.pw<=0){note('pwInvalid');say('PW LIVE chưa hợp lệ',true);return true;}
  log({t:mid.t,afr:q.afr,quality:'stable',tps:p.tps,rpm:p.rpm,delayMs:delay});
  addPoint(mid,q.afr,p);
  return true;
}
function preview(bank){return active&&run&&Number(bank)===run.bank?run.preview:null;}
function cellStatus(r,c){return active&&run?run.labels[r]?.[c]||'none':'none';}
function ui(){
  const b=get('smartPcToggle'),s=get('smartPcStatus'),k=get('smartPcStats'),
    quality=get('smartPcDiagnostics'),apply=get('smartPcApply');
  if(!b)return;
  b.textContent=active?'■ TẮT SMART MAP':'◆ BẬT SMART MAP (PC)';
  b.classList.toggle('danger',active);
  if(s)s.textContent=reason;
  if(k)k.textContent='AFR nhận '+raw+' · mẫu tạm '+provisionalSamples+
    ' · ô AFR tạm '+(run?run.provisional.size:0)+
    ' · điểm học xăng '+accepted+' · loại/chờ '+rejected+
    ' · nghi vấn '+suspected+' · vùng neo '+(run?run.anchors.size:0)+
    ' · vùng neo đủ ≥2 mẫu '+readyAnchors()+
    ' · ô xăng suy luận '+(run?run.estimated:0)+
    ' · ô AFR ≈ '+(run?Array.from(run.evidence.keys()).filter(key=>{
      const p=key.split(':');return !!measuredEstimate(Number(p[0]),Number(p[1]));
    }).length:0);
  if(quality){
    const d=diagnostics;
    const reasons=[
      ['ga/LIVE chưa ổn định',d.traceUnstable],
      ['không khớp TRACE',d.traceMissing],
      ['LIVE quá cũ',d.liveStale],
      ['AFR dao động',d.afrUnstable],
      ['AFR đột biến',d.afrSpike],
      ['AFR ngoài ngưỡng',d.afrInvalid],
      ['cách nhau <850ms',d.spacing],
      ['lỗi PW',d.pwInvalid],
      ['ngoài trục TPS/RPM',d.outsideAxis],
      ['AFR mục tiêu lỗi',d.targetInvalid],
      ['AFR lệch >18%',d.errorLarge],
      ['hai lần đo mâu thuẫn',d.anchorConflict]
    ].filter(x=>x[1]>0).map(x=>x[0]+' '+x[1]);
    const status=readyAnchors()===0?'Chưa có vùng neo đủ 2 mẫu độc lập.':
      (run?.estimated===0?'Đã đủ mẫu vùng neo nhưng hiện chưa có ô cần bù.':'Đã có đề xuất bù CỤC BỘ, chưa ghi ECU.');
    quality.textContent='CHẨN ĐOÁN: '+status+
      (d.nearTarget?' · '+d.nearTarget+' điểm AFR sát mục tiêu (không cần bù)':'')+
      (d.idleOnly?' · '+d.idleOnly+' điểm IDLE chỉ đo, không bù':'')+
      (reasons.length?' | Không dùng học: '+reasons.join(' · '):'')+
      ' | Muốn học: giữ TPS/RPM ổn định ≥1,1s, AFR đều; ≥2 mẫu độc lập/cùng vùng.';
  }
  if(apply)apply.disabled=!active||!run||!run.estimated||!!bridge.live()?.recording;
}
function stop(message){
  active=false;run=null;history=[];afrRing=[];
  reason=message||'SMART MAP đã tắt · không ghi ECU';
  ui();try{bridge.refreshView()}catch(_e){}
}
function toggle(){
  if(active){stop('Đã hủy SMART MAP PC · MAP ECU giữ nguyên');return;}
  if(!startRun())return;
  if(!bridge.disableAutoIdle()){run=null;say('Không tắt được TỰ LƯU; SMART không bật');return;}
  active=true;reason='SMART đang bật. Bấm BẮT ĐẦU GHI AFR. Ga sốc chỉ ghi dấu, không dùng sửa MAP.';
  ui();try{bridge.refreshView()}catch(_e){}
}
async function applyLocal(){
  if(!active||!run||run.estimated<1){say('Chưa có đề xuất thay đổi MAP');return;}
  if(bridge.live()?.recording){say('Hãy DỪNG GHI AFR trước khi áp dụng');return;}
  if(!validRun())return;
  const s=run,proposal=clone(s.preview),baseline=clone(s.base);
  const ok=await root.blinkConfirm('SMART MAP · ÁP DỤNG CỤC BỘ',
    'MAP No.'+s.bank+': '+s.estimated+' ô đề xuất, giới hạn ±'+CFG.maxPreviewPct+
    '%/lượt. Chỉ đổi MAP trong Blink, KHÔNG ghi ECU.\n\n'+
    'Phải kiểm tra và đo xác minh lại sau khi áp dụng. AFR đo cũ sẽ xóa để tránh bù lặp.',
    'ÁP DỤNG BLINK','HỦY');
  if(!ok||!active||run!==s||!validRun()||bridge.live()?.recording)return;
  try{
    bridge.applyLocal({bank:s.bank,baseline,proposal});
    stop('ĐÃ ÁP DỤNG VÀO BLINK · KHÔNG GHI ECU · phải xác minh lại!');
  }catch(e){say('Áp dụng thất bại: '+String(e?.message||e));}
}
function exportLog(){
  if(!run)return;
  const anchors=Array.from(run.anchors.entries()).map(([cell,a])=>({
    cell,tpsCoord:a.u,rpmCoord:a.v,count:a.n,
    afr:a.afrSum/a.n,target:a.targetSum/a.n,correctionPct:(Math.exp(a.logSum/a.n)-1)*100
  }));
  const payload={revision:'PB3.79.139',bank:run.bank,identity:run.identity,
    config:CFG,stats:{raw,accepted,rejected,suspected,provisionalSamples,provisionalSkipped,
      readyAnchors:readyAnchors()},diagnostics:{...diagnostics},
    base:run.base,target:run.target,proposedMap:run.preview,anchors,
    evidence:Array.from(run.evidence.entries()),
    provisional:Array.from(run.provisional.entries()),
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
    '<button type="button" id="smartPcApply" disabled>✓ ÁP DỤNG VÀO BLINK</button>'+
    '<button type="button" id="smartPcExport">↓ XUẤT TRACE JSON</button>'+
    '<span id="smartPcStats">Chưa có mẫu</span>'+ 
    '<span id="smartPcDiagnostics" aria-live="polite">Chờ mẫu để chẩn đoán.</span>'+
    '<small>CHỈ CHROME WINDOWS · THỬ NGHIỆM. ~AFR màu vàng: TRACE TẠM khi lướt ga, '+
    'CHƯA đủ tin cậy và KHÔNG dùng bù xăng; ≈AFR màu xanh: suy luận từ các mẫu ổn định; '+
    'AFR số thường: đã nhận gần đúng breakpoint. '+
    'Chỉ điểm đạt bộ lọc chặt và AFR MỤC TIÊU mới học MAP. '+
    'MAP ĐÃ BÙ chỉ xem trước, KHÔNG tự ghi ECU. Độ trễ AFR chỉnh trong CÀI ĐẶT.</small>';
  get('autoTuneQuickBar').insertAdjacentElement('afterend',panel);
  get('smartPcToggle').addEventListener('click',toggle);
  get('smartPcApply').addEventListener('click',()=>{void applyLocal()});
  get('smartPcExport').addEventListener('click',exportLog);
  ui();
}
root.BlinkPcSmartAutoTune=Object.freeze({isActive:()=>active,onAfr,onLive,preview,cellStatus,stop,
  measuredEstimate,pendingAfr,getStats:()=>({active,raw,accepted,rejected,suspected,
    provisionalSamples,provisionalSkipped,provisionalCells:run?.provisional.size||0,
    anchors:run?.anchors.size||0,estimated:run?.estimated||0,
    afrEstimates:run?.evidence.size||0,readyAnchors:readyAnchors(),
    diagnostics:{...diagnostics},reason})});
initUI();
})(window);

/* Blink TL PB3.79.135 | SMART AUTO TUNER | Chrome Windows PC only.
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
  maxPreviewPct:7,minWeight:0.18});
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
  const vs=w.map(a=>a.afr);
  if(vs.some(x=>!Number.isFinite(x)||x<=CFG.minAfr||x>=CFG.maxAfr))
    return {ok:false,reason:'AFR sát giới hạn hoặc tín hiệu không hợp lệ'};
  const range=Math.max(...vs)-Math.min(...vs);
  if(range>CFG.maxAfrSpread){
    const a=vs[2],b=vs[3],c=vs[4];
    const isolated=Math.abs(b-a)>2.4&&Math.abs(b-c)>2.4&&Math.sign(b-a)===Math.sign(b-c);
    return {ok:false,reason:isolated?'AFR đột biến: nghi bỏ lửa/nhiễu':'AFR dao động: không dùng học MAP'};
  }
  return {ok:true,afr:median(vs)};
}
root.BlinkPcSmartMath=Object.freeze({coord,sample2D,findTrace,stableTrace,filterAfr});
let active=false,run=null,history=[],afrRing=[],recent=[],lastAccept=0,lastUI=0;
let raw=0,accepted=0,rejected=0,suspected=0;
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
  lastAccept=lastUI=0;
  run={bank:s.bank,identity:s.identity,key:keyOf(s),base:clone(s.map),target:clone(s.target),
    tps:s.tps.slice(),rpms:s.rpms.slice(),anchors:new Map(),preview:clone(s.map),
    labels:s.map.map(row=>row.map(()=>'none')),estimated:0};
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
function addPoint(center,afr,point){
  if(!validRun())return;
  const s=getSnapshot();
  if(!s?.recording){say('Chờ BẮT ĐẦU GHI AFR');return;}
  const u=coord(run.tps.slice(0,-1),point.tps,true);
  const v=coord(run.rpms,point.rpm);
  if(u===null||v===null){say('Ngoài vùng TPS/RPM có thể học');return;}
  const target=sample2D(run.target,u,v);
  if(!Number.isFinite(target)||target<9||target>18){say('AFR mục tiêu ở vùng này không hợp lệ');return;}
  if(Math.abs(afr/target-1)>CFG.maxRelError){
    say('AFR quá lệch mục tiêu: dừng học, kiểm tra bỏ lửa/thiếu dư xăng',true);return;
  }
  if(center.t-lastAccept<CFG.minPointGap)return;
  const near=Math.abs(afr-target)<=.3;
  const logK=near?0:Math.log(afr/target);
  const key=Math.round(u)+':'+Math.round(v);
  let a=run.anchors.get(key);
  if(a&&a.n>=2&&Math.abs(logK-a.logSum/a.n)>.115){
    say('Các lượt đo trong một vùng mâu thuẫn: cần đo lại',true);return;
  }
  if(!a){a={u,v,n:0,logSum:0,afrSum:0,targetSum:0};run.anchors.set(key,a);}
  a.u=(a.u*a.n+u)/(a.n+1);a.v=(a.v*a.n+v)/(a.n+1);
  a.logSum+=logK;a.afrSum+=afr;a.targetSum+=target;a.n++;
  lastAccept=center.t;accepted++;
  // All stable, attributable AFR observations are visible in measured cells;
  // only near-target values may become locked anchors via the existing gate.
  if(Math.abs(u-Math.round(u))<.28&&Math.abs(v-Math.round(v))<.28){
    try{bridge.recordVerified(run.bank,Math.round(u),Math.round(v),afr)}catch(_e){}
  }
  makePreview(s);
  reason='Đã học TPS '+point.tps.toFixed(1)+'% / '+Math.round(point.rpm)+
    ' RPM · AFR '+afr.toFixed(2)+' / mục tiêu '+target.toFixed(2)+(near?' · đạt':' · bù đề xuất');
  if(s.tab==='corrected')try{bridge.refreshView()}catch(_e){}
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
  afrRing.push({t,afr:value,handled:false});
  if(afrRing.length>20)afrRing.shift();
  if(afrRing.length<7){reason='Đang gom chuỗi AFR 7 mẫu';ui();return true;}
  const window=afrRing.slice(-7),mid=window[3];
  if(mid.handled)return true;
  mid.handled=true;
  const q=filterAfr(window);
  if(!q.ok){log({t:mid.t,afr:mid.afr,quality:'reject',reason:q.reason});say(q.reason,true);return true;}
  const delay=clamp(Number(bridge.live()?.afrDelayMs)||0,0,2500);
  const when=mid.t-delay;
  const p=findTrace(history,when);
  if(!p||!stableTrace(history,when,p)||
     !history.length||t-history[history.length-1].t>900){
    log({t:mid.t,afr:q.afr,quality:'reject',reason:'ga chuyển tiếp / thiếu trace'});
    say('Ga sốc hoặc lịch sử TPS/RPM chưa ổn định: chỉ lưu trace',true);return true;
  }
  if(!Number.isFinite(p.pw)||p.pw<=0){say('PW LIVE chưa hợp lệ',true);return true;}
  log({t:mid.t,afr:q.afr,quality:'stable',tps:p.tps,rpm:p.rpm,delayMs:delay});
  addPoint(mid,q.afr,p);
  return true;
}
function preview(bank){return active&&run&&Number(bank)===run.bank?run.preview:null;}
function cellStatus(r,c){return active&&run?run.labels[r]?.[c]||'none':'none';}
function ui(){
  const b=get('smartPcToggle'),s=get('smartPcStatus'),k=get('smartPcStats'),apply=get('smartPcApply');
  if(!b)return;
  b.textContent=active?'■ TẮT SMART MAP':'◆ BẬT SMART MAP (PC)';
  b.classList.toggle('danger',active);
  if(s)s.textContent=reason;
  if(k)k.textContent='AFR nhận '+raw+' · điểm học '+accepted+' · bị loại/chờ '+rejected+
    ' · nghi vấn '+suspected+' · vùng neo '+(run?run.anchors.size:0)+
    ' · ô suy luận '+(run?run.estimated:0);
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
  const payload={revision:'PB3.79.135',bank:run.bank,identity:run.identity,
    config:CFG,stats:{raw,accepted,rejected,suspected},base:run.base,target:run.target,
    proposedMap:run.preview,anchors,trace:history,recentAfr:recent};
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
    '#smartPcApply{background:#1b415a;color:#fff}#smartPcApply:disabled{opacity:.42}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-inferred{outline:1px dashed #6bc8fa;outline-offset:-2px}'+
    '#mapEditorScreen.autoTuneMap #mapTable td.smart-pc-supported{outline:2px solid #38e2a7;outline-offset:-2px}';
  doc.head.appendChild(style);
  const panel=doc.createElement('div');
  panel.id='smartPcPanel';
  panel.innerHTML='<button type="button" id="smartPcToggle">◆ BẬT SMART MAP (PC)</button>'+
    '<span id="smartPcStatus" role="status">SMART MAP mặc định tắt.</span>'+
    '<button type="button" id="smartPcApply" disabled>✓ ÁP DỤNG VÀO BLINK</button>'+
    '<button type="button" id="smartPcExport">↓ XUẤT TRACE JSON</button>'+
    '<span id="smartPcStats">Chưa có mẫu</span>'+
    '<small>CHỈ CHROME WINDOWS · THỬ NGHIỆM. Dùng AFR MỤC TIÊU theo TPS/RPM; '+
    'không học ga sốc/bỏ lửa; giữ MAP nền và khóa ô đạt. '+
    'Chỉ xem trước MAP ĐÃ BÙ, không tự ghi ECU. Trễ AFR chỉnh trong CÀI ĐẶT; '+
    '0 ms chỉ phù hợp khi giữ ga ổn định đủ lâu.</small>';
  get('autoTuneQuickBar').insertAdjacentElement('afterend',panel);
  get('smartPcToggle').addEventListener('click',toggle);
  get('smartPcApply').addEventListener('click',()=>{void applyLocal()});
  get('smartPcExport').addEventListener('click',exportLog);
  ui();
}
root.BlinkPcSmartAutoTune=Object.freeze({isActive:()=>active,onAfr,onLive,preview,cellStatus,stop,
  getStats:()=>({active,raw,accepted,rejected,suspected,anchors:run?.anchors.size||0,
    estimated:run?.estimated||0,reason})});
initUI();
})(window);

/* BLINK TL PB 3.79.86 — independent per-cell AFR response learning.
   This file only augments the ordinary manual "MAP ĐÃ BÙ -> ECU" flow.
   It never writes the ECU itself and never changes three-run optimization. */
(function(){
'use strict';
if(typeof state==='undefined'||typeof correctedMatrix!=='function'||typeof onFuelWriteVerified!=='function')return;
const STORAGE='blink-auto-tune-cell-learning-v1';
const MIN_SAMPLES=8,MIN_BEFORE_SAMPLES=5,MIN_PW_LOG=0.04,MIN_DELAY_MS=3000;
const clamp01=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x,f=0)=>Number.isFinite(Number(x))?Number(x):f;
const cellMatrix=x=>Array.from({length:14},()=>Array(30).fill(x));
const copy=m=>m.map(row=>row.slice());
const good=m=>Array.isArray(m)&&m.length===14&&m.every(r=>Array.isArray(r)&&r.length===30);
const blank=()=>({writes:0,key:'',axis:'',k:cellMatrix(null),n:cellMatrix(0),pending:null,at:0});
function identity(){
  const api=window.BlinkRealProtocol,h=api&&api.handshake,p=api&&api.profile;
  return h&&p?[String(p.key||p.family||''),String(h.ident||''),String(h.firmware||''),String(h.ecuId??'')].join('|'):'';
}
function axisKey(){return JSON.stringify([TPS_ROWS,RPMS]);}
function restore(){
  let saved=null;try{saved=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch(_e){}
  return Array.from({length:4},(_,i)=>{
    const s=saved&&saved.banks&&saved.banks[i],b=blank();
    if(!s)return b;
    b.writes=clamp01(Math.round(finite(s.writes)),0,100000);
    b.key=String(s.key||'').slice(0,220);b.axis=String(s.axis||'').slice(0,1500);b.at=finite(s.at);
    if(good(s.k))b.k=s.k.map(row=>row.map(x=>x!=null&&Number.isFinite(Number(x))&&Number(x)>=0.35&&Number(x)<=2.5?Number(x):null));
    if(good(s.n))b.n=s.n.map(row=>row.map(x=>clamp01(Math.round(finite(x)),0,100)));
    const p=s.pending;
    if(p&&good(p.p0)&&good(p.p1)&&good(p.a0)&&good(p.c0)){
      b.pending={p0:p.p0,p1:p.p1,a0:p.a0,c0:p.c0,
        post:cellMatrix(null),count:cellMatrix(0),
        status:good(p.status)?p.status:cellMatrix(0),
        verifiedAt:0,needsReadback:true};
    }
    return b;
  });
}
let banks=restore(),writeTicket=null;
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({version:1,banks}))}catch(_e){}}
function getBank(mapNo=state.activeMap){
  const idx=clamp01(Math.round(finite(mapNo,1)),1,4)-1,b=banks[idx];
  const id=identity(),ax=axisKey();
  // Do not compare saved ECU axes against startup defaults before handshake
  // and the real TPS/RPM axis loader have finished.
  const axesReady=!!(window.blinkEcuAxes&&Array.isArray(window.blinkEcuAxes.rpmAxis)&&window.blinkEcuAxes.rpmAxis.length===30);
  if((axesReady&&b.axis&&b.axis!==ax)||(id&&b.key&&id!==b.key)){
    b.k=cellMatrix(null);b.n=cellMatrix(0);b.pending=null;
    if(id&&b.key&&id!==b.key)b.writes=0;
    persist();
  }
  if(axesReady||!b.axis)b.axis=ax;
  if(id)b.key=id;
  return b;
}
function equalMap(a,b){
  if(!good(a)||!good(b))return false;
  const tol=window.BlinkRealProtocol&&window.BlinkRealProtocol.profile&&window.BlinkRealProtocol.profile.family==='v8'?0.026:0.006;
  for(let r=0;r<14;r++)for(let c=0;c<30;c++)
    if(Math.abs(finite(a[r][c])-finite(b[r][c]))>tol)return false;
  return true;
}
function pairStats(p){
  const result={learn:0,hold:0,wait:0};
  if(!p)return result;
  for(let r=0;r<14;r++)for(let c=0;c<30;c++){
    if(isIdleAutoTuneRow(r))continue;
    const p0=finite(p.p0[r][c]),p1=finite(p.p1[r][c]);
    if(p0<=0||p1<=0||Math.abs(Math.log(p1/p0))<MIN_PW_LOG||finite(p.c0[r][c])<MIN_BEFORE_SAMPLES)continue;
    const st=finite(p.status[r][c]);
    if(st===1)result.learn++;else if(st===2||st===3)result.hold++;else result.wait++;
  }
  return result;
}
let strip=null;
function showStatus(){
  if(!strip)return;
  const b=getBank(),p=pairStats(b.pending);
  let learned=0;for(let r=0;r<14;r++)for(let c=0;c<30;c++)if(!isIdleAutoTuneRow(r)&&finite(b.n[r][c])>0)learned++;
  strip.textContent='MAP No.'+state.activeMap+' · LƯU BÙ '+b.writes+' LẦN · HỌC '+learned+' Ô'+
    (p.hold?' · TẠM KHÓA '+p.hold+' Ô':'')+
    (b.pending?(b.pending.needsReadback?' · CHỜ ĐỌC MAP ECU':p.wait?' · CHỜ AFR '+p.wait+' Ô':' · ĐÃ CÓ PHẢN HỒI'):'');
  strip.title='Mỗi TPS/RPM học độc lập. Chỉ đếm khi ECU đọc lại đủ MAP sau ghi.';
}
function changedMap(base,newMap){
  if(!good(base)||!good(newMap))return false;
  for(let r=0;r<14;r++)for(let c=0;c<30;c++)if(Math.abs(finite(base[r][c])-finite(newMap[r][c]))>0.0005)return true;
  return false;
}
const originalCorrected=correctedMatrix;
function propose(){
  const result=cellMatrix(null),b=getBank(),p=b.pending;
  // Never apply another correction while the persisted reference map is
  // unverified, or while the current editable table differs from that anchor.
  if(p&&(p.needsReadback||!equalMap(state.inject,p.p1)))return copy(state.inject);
  const maxMs=typeof fuelProtocolMaxMs==='function'?fuelProtocolMaxMs():131.07;
  const limit=Math.min(0.30,Math.max(0,finite(state.cal.limitPct,100))/100);
  for(let r=0;r<14;r++)for(let c=0;c<30;c++){
    if(isIdleAutoTuneRow(r)){result[r][c]=state.inject[r][c];continue;}
    const pw=finite(state.inject[r][c]),afr=finite(state.measured[r][c]),target=finite(state.target[r][c]);
    if(pw<=0){result[r][c]=null;continue;}
    if(afr<=0||target<=0){result[r][c]=pw;continue;}
    const feedback=p&&!p.needsReadback?finite(p.status[r][c]):0;
    if(feedback===2||feedback===3){result[r][c]=pw;continue;}
    const learned=finite(b.n[r][c])>0&&b.k[r][c]!=null?Number(b.k[r][c]):1;
    const factor=Math.pow(afr/target,1/learned);
    result[r][c]=Number.isFinite(factor)?clamp01(pw*clamp01(factor,Math.max(0,1-limit),1+limit),0,maxMs):pw;
  }
  return result;
}
correctedMatrix=function(){
  if(state.mode==='three'||state.threeRun.active)return originalCorrected();
  return propose();
};
function commitReadback(mapNo,m){
  const b=getBank(mapNo),p=b.pending;
  if(!p)return;
  // Ordinary READ CURRENT detects out-of-band ECU changes. A different table
  // is expected while our own next verified correction is being written.
  if(!p.needsReadback){
    if(!(writeTicket&&writeTicket.mapNo===mapNo)&&!equalMap(m,p.p1)){
      b.pending=null;b.k=cellMatrix(null);b.n=cellMatrix(0);
      persist();showStatus();
    }
    return;
  }
  if(equalMap(m,p.p1)){
    p.needsReadback=false;p.verifiedAt=Date.now();
    p.post=cellMatrix(null);p.count=cellMatrix(0);
    // Preserve earlier no-response holds until fresh evidence proves recovery.
  }else{
    b.pending=null;b.k=cellMatrix(null);b.n=cellMatrix(0);
  }
  persist();showStatus();
}
window.onBlinkFuelMapReadback=function(bank,matrix){
  if(writeTicket&&writeTicket.mapNo===bank&&equalMap(matrix,writeTicket.proposal))writeTicket.readback=true;
  commitReadback(bank,matrix);
};
function commitWrite(mapNo){
  const t=writeTicket;
  if(!t||!t.readback||t.mapNo!==mapNo||!equalMap(state.mapBanks[mapNo-1].inject,t.proposal))return false;
  if((t.key&&identity()!==t.key)||t.axis!==axisKey())return false;
  const b=getBank(mapNo);
  b.writes++;b.at=Date.now();
  b.pending={p0:copy(t.p0),p1:copy(state.mapBanks[mapNo-1].inject),a0:copy(t.a0),c0:copy(t.c0),
    post:cellMatrix(null),count:cellMatrix(0),status:cellMatrix(0),
    verifiedAt:Date.now(),needsReadback:false};
  persist();showStatus();return true;
}
const oldApply=applyCorrectedAndWrite;
applyCorrectedAndWrite=async function(options){
  if(state.threeRun.active)return oldApply(options);
  const mapNo=state.activeMap,proposal=propose(),base=copy(state.inject);
  const t={mapNo,p0:base,a0:copy(state.measured),c0:copy(state.counts),
    proposal,key:identity(),axis:axisKey(),readback:false};
  if(writeTicket)return false;
  if(!changedMap(base,proposal))return oldApply(options);
  writeTicket=t;
  try{return await oldApply(options);}finally{writeTicket=null;showStatus();}
};
const oldVerified=onFuelWriteVerified;
onFuelWriteVerified=function(bank){
  if(writeTicket){
    commitWrite(bank);
  }else{
    // Manual save or three-run can alter the table outside this learned pair.
    const b=getBank(bank);
    if(b.pending){b.pending=null;persist();}
  }
  const ret=oldVerified(bank);showStatus();return ret;
};
const oldSample=recordSample;
function onSample(now,r,c,afr){
  if(isIdleAutoTuneRow(r))return; // AFR sample/count already recorded by oldSample.
  if(state.mode==='three'||state.threeRun.active)return;
  const b=getBank(),p=b.pending;
  if(!p||p.needsReadback||!p.verifiedAt||Date.now()-p.verifiedAt<MIN_DELAY_MS)return;
  if(now-state.cellEnteredAt<Math.max(650,finite(state.cal.settleMs)))return;
  const beforePw=finite(p.p0[r][c]),afterPw=finite(p.p1[r][c]),beforeAfr=Number(p.a0[r][c]);
  if(beforePw<=0||afterPw<=0||finite(p.c0[r][c])<MIN_BEFORE_SAMPLES)return;
  if(!Number.isFinite(beforeAfr)||beforeAfr<8||beforeAfr>21||afr<8||afr>21)return;
  const dp=Math.log(afterPw/beforePw);
  if(Math.abs(dp)<MIN_PW_LOG)return;
  if(finite(p.status[r][c])===1)return;
  const n=finite(p.count[r][c]);
  if(n>=120)return;
  const newMean=(n?finite(p.post[r][c],afr):afr)+(afr-(n?finite(p.post[r][c],afr):afr))/(n+1);
  p.post[r][c]=newMean;p.count[r][c]=n+1;
  if(n+1<MIN_SAMPLES)return;
  const da=-Math.log(newMean/beforeAfr),k=da/dp;
  const moved=Math.abs(newMean-beforeAfr)>Math.max(0.18,beforeAfr*0.015);
  const kind=!moved?2:Number.isFinite(k)&&k>=0.35&&k<=2.5?1:3;
  const old=finite(p.status[r][c]);
  if(kind===1&&old!==1){
    const prior=b.k[r][c],n0=finite(b.n[r][c]);
    b.k[r][c]=Number((n0&&prior!=null?0.6*Number(prior)+0.4*k:k).toFixed(4));
    b.n[r][c]=Math.min(100,n0+1);
  }
  p.status[r][c]=kind;
  if(old!==kind){persist();showStatus();if(state.tab==='corrected')render();}
}
recordSample=function(now){
  const cur=currentCell(),old=finite(state.counts[cur.r][cur.c]);
  const ret=oldSample(now);
  if(finite(state.counts[cur.r][cur.c])>old)onSample(now,cur.r,cur.c,finite(state.measured[cur.r][cur.c]));
  return ret;
};
const oldRender=render;
render=function(){const v=oldRender.apply(this,arguments);showStatus();return v;};
const oldSelect=selectMapBank;
selectMapBank=function(){const v=oldSelect.apply(this,arguments);showStatus();return v;};
const parent=document.getElementById('autoTuneQuickBar');
if(parent){
  strip=document.createElement('div');strip.id='autoTuneLearningStrip';
  strip.style.cssText='display:none;flex:0 0 auto;padding:2px 8px 3px;background:#16090f;border-top:1px solid #3a1720;border-bottom:1px solid #3a1720;color:#ffb8c2;font-size:10px;font-weight:800;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  parent.insertAdjacentElement('afterend',strip);
  const css=document.createElement('style');
  css.textContent='#mapEditorScreen.autoTuneMap:not(.standaloneFuel) #autoTuneLearningStrip{display:block!important}body.mapZoomMode #autoTuneLearningStrip{display:none!important}';
  document.head.appendChild(css);
}
showStatus();
window.BlinkAutoTuneLearner={getSummary:function(mapNo){
  const b=getBank(mapNo);let learned=0;
  for(let r=0;r<14;r++)for(let c=0;c<30;c++)if(!isIdleAutoTuneRow(r)&&finite(b.n[r][c])>0)learned++;
  return {mapNo:mapNo||state.activeMap,writes:b.writes,learnedCells:learned,pending:pairStats(b.pending)};
},getCell:function(mapNo,r,c){
  if(isIdleAutoTuneRow(r))return {k:null,learnedWrites:0,status:0};
  const b=getBank(mapNo);return {k:b.k[r][c],learnedWrites:b.n[r][c],status:b.pending&&!b.pending.needsReadback?b.pending.status[r][c]:0};
}};
})();

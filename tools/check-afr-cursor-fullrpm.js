#!/usr/bin/env node
'use strict';
/*
 * Blink measured-AFR cursor regression.
 * Exercise ACTUAL functions extracted from index.html (no copied codec):
 * default 30-column RPM axis 500..15000, selected cell, AFR sample 14x30,
 * manual scroll pause and 90-degree CSS-rotated auto-follow.
 * No ECU write command or BLE connection is used here.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const take=(from,to)=>{const a=html.indexOf(from),b=html.indexOf(to,a+from.length);assert(a>=0&&b>a,from+' -> '+to+' region missing');return html.slice(a,b)};
assert(html.includes("window.BLINK_AFR_CURSOR_REVISION = 'AFR-CURSOR-ROT90'"),'new cursor revision missing');
assert(html.includes('CORR-1T · AFR-CURSOR'),'app footer cursor revision missing');
assert(html.includes("window.BLINK_PB_VERSION = '3.79.72'"),'rolled-back Blink app version changed');
const fn=take('function nearestCol(rpm){','async function ensureActiveEcuAxes(');
const follow=take('function autoFollowCurrentCell(td,cur){','function highlightCurrent(){');
const recorder=take('function recordSample(now){','function updateLive(){');
const axis=Array.from({length:30},(_,i)=>(i+1)*500);
const rows=[100,90,80,70,60,50,40,30,20,14,8,5,2,'IDLE'];
const blank=val=>Array.from({length:14},()=>Array(30).fill(val));
const state={
 live:{rpm:0,tps:40,afr:14.1},cal:{settleMs:0},counts:blank(0),measured:blank(null),
 lastCellKey:'',cellEnteredAt:0,tab:'measured',
};
let tdFor=null,rotated=false;
const width=800,height=310;
let wrap={
  clientWidth:width,clientHeight:height,scrollWidth:1700,scrollHeight:530,scrollLeft:0,scrollTop:0,
  getBoundingClientRect(){return rotated
    ?{left:0,top:0,right:height,bottom:width,width:height,height:width}
    :{left:0,top:0,right:width,bottom:height,width,height};},
  scrollTo(first,other){
    const o=typeof first==='number'?{left:first,top:other}:first;
    this.scrollLeft=Math.min(this.scrollWidth-this.clientWidth,Math.max(0,o.left));
    this.scrollTop=Math.min(this.scrollHeight-this.clientHeight,Math.max(0,o.top));
  }
};
const table={offsetLeft:0,offsetTop:0,offsetParent:wrap};
const screen={classList:{contains:name=>name==='active'}};
const document={
 body:{classList:{contains:name=>name==='appForceLandscape'&&rotated}},
 activeElement:null,
 getElementById:id=>id==='mapWrap'?wrap:id==='mapEditorScreen'?screen:null,
 querySelector:()=>null
};
let pausedUntil=0,lastKey='',enabled=true;
const ctx={
 state,R:14,C:30,RPMS:axis,TPS_ROWS:rows,
 document,window:{},
 liveAutoFollowEnabled:true,
 mapAutoFollowPauseUntil:0,
 mapAutoFollowLastKey:'',
 performance:{now:()=>100},
 tpsTelemetryFresh:()=>true,throttleClosingLock:()=>false,delayedAfr:()=>14.1,
 fmt:(v,n)=>v.toFixed(n),saveSoon:()=>{},num:(v,d)=>Number.isFinite(Number(v))?Number(v):d,
 console,
};
vm.createContext(ctx);
vm.runInContext(fn+'\n'+follow+'\n'+recorder+'\nthis.api={nearestCol,currentCell,autoFollowCurrentCell,recordSample}',ctx);
const A=ctx.api;
assert.equal(axis.length,30);
assert.equal(axis[17],9000);
assert.equal(axis[18],9500);
assert.equal(axis[29],15000);
for(const [rpm,expected] of [
 [8500,8500],[8999,9000],[9000,9000],[9001,9000],[9250,9000],
 [9251,9500],[9500,9500],[10000,10000],[11000,11000],
 [12000,12000],[14000,14000],[15000,15000],[18000,15000]
]){
 state.live.rpm=rpm;
 const idx=A.nearestCol(rpm);
 assert.equal(ctx.RPMS[idx],expected,'unexpected RPM cursor at '+rpm);
 assert.equal(A.currentCell().c,idx,'currentCell did not honor RPM above 9k');
}
for(const rpm of [9500,10000,11000,12000,15000]){
  state.live.rpm=rpm;state.lastCellKey='';
  A.recordSample(1000);
  const col=A.currentCell().c,row=A.currentCell().r;
  assert.equal(state.counts[row][col],1,'measured AFR sample missing at '+rpm);
  assert.equal(state.measured[row][col],14.1,'measured AFR sample value wrong at '+rpm);
}
ctx.RPMS.splice(0,ctx.RPMS.length,...Array.from({length:30},(_,i)=>500+Math.round(i*8500/29)));
assert.equal(ctx.RPMS.at(-1),9000,'dynamic ECU axis max should be 9000 in diagnostic case');
assert.equal(ctx.RPMS[A.nearestCol(12000)],9000,
  'when REAL ECU dynamic RPM axis ends at 9000, pointer correctly stays at its final column');
ctx.RPMS.splice(0,ctx.RPMS.length,...axis);

const makeTd=(rpm)=>{
 const c=A.nearestCol(rpm),r=6;
 const x=64+54*c,y=r*34;
 return {
  dataset:{r:String(r),c:String(c)},
  offsetLeft:x,offsetTop:y,offsetWidth:54,offsetHeight:34,offsetParent:table,
  getBoundingClientRect(){return rotated
   ?{left:height-(y-wrap.scrollTop)-34,right:height-(y-wrap.scrollTop),top:x-wrap.scrollLeft,bottom:x-wrap.scrollLeft+54}
   :{left:x-wrap.scrollLeft,right:x-wrap.scrollLeft+54,top:y-wrap.scrollTop,bottom:y-wrap.scrollTop+34};}
 };
};
for(const isRotated of [false,true]){
 rotated=isRotated;wrap.scrollLeft=0;wrap.scrollTop=0;ctx.mapAutoFollowLastKey='';
 for(const rpm of [8000,8500,9000,9500,10000,10500,11000,12000,15000]){
   const td=makeTd(rpm),c=A.nearestCol(rpm),x=td.offsetLeft;
   A.autoFollowCurrentCell(td,{r:6,c,key:'6:'+c});
   assert(x>=wrap.scrollLeft&&x+td.offsetWidth<=wrap.scrollLeft+wrap.clientWidth,
      'cursor at '+rpm+' is outside scroll viewport when rotated='+isRotated+
      ' (scrollLeft='+wrap.scrollLeft+' cellX='+x+')');
 }
 assert(wrap.scrollLeft>400,'auto-follow must reach far columns rotated='+isRotated);
}
// Turning OFF follow stops scrolling, but leaves currentCell selection live.
rotated=true;wrap.scrollLeft=0;ctx.mapAutoFollowLastKey='';ctx.liveAutoFollowEnabled=false;
const td=makeTd(15000);A.autoFollowCurrentCell(td,{r:6,c:29,key:'6:29'});
assert.equal(wrap.scrollLeft,0,'manual follow OFF must not force scroll');
assert.equal(A.nearestCol(15000),29,'manual follow OFF must not cap the cursor');
ctx.liveAutoFollowEnabled=true;
// Touch pause is intentionally respected even in rotated mode.
ctx.mapAutoFollowLastKey='';ctx.mapAutoFollowPauseUntil=300;
A.autoFollowCurrentCell(td,{r:6,c:29,key:'6:29'});
assert.equal(wrap.scrollLeft,0,'touch pause must suppress auto-scroll');
console.log('PASS Blink AFR cursor: 30 RPM columns 500-15000; >9250 advances beyond 9000; 9500-15000 AFR samples; genuine A2 axis max=9000 case; CSS rotate90 follow vs normal; OFF and 3-second touch pause');

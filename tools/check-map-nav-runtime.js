#!/usr/bin/env node
'use strict';
const fs = require('fs');
const {JSDOM, VirtualConsole} = require('jsdom');
const file = process.argv[2] || 'index.html';
const html = fs.readFileSync(file, 'utf8');
const reports=[];
const vconsole=new VirtualConsole();
vconsole.on('jsdomError', e=>reports.push('JSDOM: '+e.message+' \n'+String(e.cause?.stack||e.stack)));
vconsole.on('error', s=>reports.push('console.error '+s));
const dom=new JSDOM(html,{
 url:'https://letan99vl.github.io/Blink-Redleo/',
 runScripts:'dangerously',
 pretendToBeVisual:true,
 virtualConsole:vconsole,
 beforeParse(w){
   w.matchMedia=()=>({matches:false,media:'',addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
   w.scrollTo=()=>{};
   w.alert=()=>{};
   w.confirm=()=>true;
   w.prompt=()=>null;
   w.performance.now=()=>Date.now();
   w.ResizeObserver=class{observe(){}disconnect(){}};
   w.HTMLCanvasElement.prototype.getContext=function(){return {clearRect(){},beginPath(){},arc(){},fill(){},moveTo(){},lineTo(){},stroke(){},save(){},restore(){},translate(){},rotate(){},setTransform(){},fillText(){},measureText(){return {width:50}}}};
   w.HTMLElement.prototype.scrollIntoView=function(){};
   w.HTMLElement.prototype.scrollTo=function(){};
   w.window.addEventListener('error',e=>{
      reports.push('WINDOW ERROR: '+e.message+' '+e.filename+':'+e.lineno+':'+e.colno+' '+(e.error?.stack||''));
      e.preventDefault();
   });
 }
});
const {document:doc}=dom.window;
function active(){
 return [...doc.querySelectorAll('section.screen.active')].map(e=>e.id);
}
function click(selector){
 const element=doc.querySelector(selector);
 if(!element)throw new Error('MISSING SELECTOR '+selector);
 element.click();
 return {selector,active:active()};
}
const results=[];
results.push({startup:active(),features:doc.querySelectorAll('[data-feature]').length});
results.push(click('.navBtn[data-nav="maps"]'));
for(const f of ['inj_ve','inj_degree','ign_degree','ign_time','afr_map','ect_inj','idle_limit']){
   click('.navBtn[data-nav="maps"]');
   results.push(click('[data-feature="'+f+'"]'));
}
results.push(click('.navBtn[data-nav="tune"]'));
results.push(click('[data-auto-tab="target"]'));
console.log('CHECK '+file+'\n'+JSON.stringify(results,null,2));
console.log('ERRORS '+JSON.stringify(reports.slice(0,20),null,2));
const bad=results.filter(x=>x.selector?.startsWith('[data-feature') &&
      !x.active.some(s=>['mapEditorScreen','redleoEditorScreen','idleLimitScreen'].includes(s)));
const badTab=results.some(x=>x.selector==='[data-auto-tab="target"]'&&!x.active.includes('mapEditorScreen'));
if(bad.length||badTab||reports.length){
 console.error('FAIL: map button errors '+JSON.stringify({bad:bad.map(x=>x.selector),badTab,errors:reports.length}));
 process.exitCode=1;
}else{
 console.log('PASS: every MAP tile opens its editor and AFR target opens');
}
dom.window.close();

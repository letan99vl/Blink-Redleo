#!/usr/bin/env node
'use strict';
const {chromium}=require('playwright-core');
const fs=require('fs');
const exe=process.env.CHROME_BIN || ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(p=>fs.existsSync(p));
if(!exe)throw new Error('Cannot find system Chrome on GH runner');
(async()=>{
const browser=await chromium.launch({executablePath:exe,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
let errors=[],failures=[];
for(const cfg of [{width:1280,height:900,mobile:false},{width:390,height:844,mobile:true}]){
 const context=await browser.newContext({viewport:{width:cfg.width,height:cfg.height},isMobile:cfg.mobile,hasTouch:cfg.mobile,deviceScaleFactor:1});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(cfg.mobile?'mobile: '+e.stack:'desktop: '+e.stack));
 await page.goto('http://127.0.0.1:8787/',{waitUntil:'load',timeout:15000});
 const title=await page.title();
 console.log('PAGE',cfg,'title:',title,'total feature cards:',await page.locator('[data-feature]').count());
 const nav=page.locator('.navBtn[data-nav="maps"]');
 await nav.click({timeout:6500});
 const features=['inj_ve','inj_degree','ign_degree','ign_time','afr_map','ect_inj','ect_ign','map_inj','iat_inj','idle_limit','ect_idle_motor','v_ect','v_iat','v_map','external_adjust'];
 for(const id of features){
  try{
   await nav.click({timeout:3500});
   const tile=page.locator('#mapsScreen [data-feature="'+id+'"]');
   await tile.click({timeout:3500});
   const active=await page.locator('section.screen.active').evaluateAll(es=>es.map(e=>e.id));
   if(!active.some(s=>['mapEditorScreen','redleoEditorScreen','idleLimitScreen'].includes(s)))failures.push({mobile:cfg.mobile,id,active});
   console.log('CLICK',cfg.mobile?'mobile':'desktop',id,active.join(','));
  }catch(e){failures.push({mobile:cfg.mobile,id,error:String(e).slice(0,800)});console.error('CLICK FAIL',cfg.mobile,id,String(e).slice(0,550))}
 }
 try{
  await page.locator('.navBtn[data-nav="tune"]').click({timeout:3000});
  await page.locator('[data-auto-tab="target"]').click({timeout:3000});
  const active=await page.locator('section.screen.active').evaluateAll(es=>es.map(e=>e.id));
  if(!active.includes('mapEditorScreen'))failures.push({mobile:cfg.mobile,id:'target',active});
  const kp=await page.locator('#fuelKeypadToggle').isVisible();
  console.log('AFR TARGET',cfg.mobile,active,kp);
 }catch(e){failures.push({mobile:cfg.mobile,id:'target',error:String(e).slice(0,500)})}
 await context.close();
}
console.log('PAGE ERRORS',JSON.stringify(errors.slice(0,12),null,2));
console.log('FAILURES',JSON.stringify(failures,null,2));
await browser.close();
if(errors.length||failures.length)process.exit(1);
console.log('PASS: 15 MAP feature tiles and AFR target physically clickable on desktop & Android-sized screen');
})().catch(e=>{console.error(e);process.exit(1)});

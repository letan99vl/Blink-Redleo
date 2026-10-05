#!/usr/bin/env node
'use strict';

const fs=require('fs');
const proto=fs.readFileSync('redleo_real_protocol.js','utf8');
const ui=fs.readFileSync('index.html','utf8');

function must(src,re,msg){
  if(!re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}
function mustNot(src,re,msg){
  if(re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}

// Original ECU Air fuel ratio must exist on every identified REDLEO generation.
must(proto,/LEGACY_V8:new Set\(\[[^\]]*'afr_map'/,'V8 Air fuel ratio surface missing');
must(proto,/MODERN_V9:new Set\(\[[^\]]*'afr_map'/,'V9 Air fuel ratio surface missing');
must(proto,/MODERN_V10:new Set\(\[[^\]]*'afr_map'/,'V10\/Ultra Air fuel ratio surface missing');
must(proto,/MODERN_V11:new Set\(\[[^\]]*'afr_map'/,'V11\/Ultra Pro2 Air fuel ratio surface missing');

// Page family and safe direct I/O path.
must(proto,/if\(id==='afr_map'&&ecuProfile&&\['v8','modern','v11'\]\.includes\(ecuProfile\.family\)\)return page\(5,bank\)/,
  'Air fuel ratio must stay on page family 0x5x');
must(proto,/readDirectPageReal\(pg,420,label,showUi\)/,'Air fuel ratio direct read must require 420 data bytes');
must(proto,/async function writeEcuAfrMap\(bank\)[\s\S]{0,1300}writeWritablePrefixPage\(pg,payload,baseline,label,'mainWrite',1\)/,
  'Air fuel ratio writer must use baseline + ACK + readback');
must(proto,/if\(id==='afr_map'\)return writeEcuAfrMap\(bank\)/,
  'Air fuel ratio generic write dispatch missing');

// DN/original encoding: 90..180 = ON; OFF toggles bit 0x80 while preserving AFR.
must(proto,/const on=b>=90&&b<=180/,'AFR ON byte range changed');
must(proto,/matrix\[ur\]\[c\]=r1\(\(on\?b:\(b\^0x80\)\)\/10\)/,'AFR OFF XOR decode changed');
must(proto,/const rawOn=clamp\(Math\.round\(v\*10\),90,180\)/,'AFR target encode range changed');
must(proto,/out\[p\]=on\?rawOn:\(rawOn\^0x80\)/,'AFR OFF XOR encode changed');
mustNot(proto,/function setEcuAfrMeta\(bank,decoded\)\{return setEcuAfrMeta/,
  'recursive AFR metadata alias reintroduced');

// Read All must decode/publish original ECU AFR instead of leaving it hidden raw.
must(proto,/b\.afRaw=a\.slice\(p,p\+420\);\{const A=decodeEcuAfr420\(b\.afRaw\);b\.afr=A\.matrix;b\.afrEnabled=A\.enabled;\}/,
  'canonical Read All AFR decode missing');
must(proto,/if\(b\.afr&&b\.afrEnabled\)\{setEcuAfrMeta\(b\.bank,[\s\S]{0,180}emitFeature\(N\.afr_map,b\.afr,b\.bank\)/,
  'canonical Read All AFR publish missing');

// UI separation: Blink Auto Tune target is not the ECU Air fuel ratio table.
must(ui,/data-feature="afr_map"[\s\S]{0,260}<h3>Air fuel ratio<\/h3>[\s\S]{0,180}Auto tuner zin của ECU/,
  'ECU map card must be named Air fuel ratio / auto tuner zin');
must(ui,/data-tab="target">AFR MỤC TIÊU \(BLINK\)<\/button>/,
  'Blink target tab label missing');
must(ui,/data-auto-tab="measured">AFR ĐO CỦA BLINK<\/button>/,
  'Blink measured AFR label missing');
must(ui,/data-auto-tab="target">AFR MỤC TIÊU CỦA BLINK<\/button>/,
  'Blink target shortcut label missing');

// Original-style OFF cells: dark/dash in UI while hidden numeric target survives in data-value.
must(ui,/const afr=f\.id==='afr_map';/,'AFR ON/OFF controls must be visible for all ECU profiles');
must(ui,/if\(currentFeature\?\.id!=='afr_map'\)return;/,'AFR ON/OFF action must be profile-generic');
must(ui,/const display=afrOff\?'-':fmtV\(d\[r\]\[c\]\)/,'AFR OFF cells must display dash');
must(ui,/data-value="'\+stored\+'"/,'AFR OFF hidden numeric value must survive rendering');

// Independent arithmetic sanity checks for the on-wire convention.
function decodeByte(b){
  b&=255;
  const on=b>=90&&b<=180;
  return {on,value:(on?b:(b^0x80))/10};
}
function encodeByte(v,on){
  const rawOn=Math.max(90,Math.min(180,Math.round(v*10)));
  return on?rawOn:(rawOn^0x80);
}
const cases=[
  {v:9.0,on:true,raw:90},
  {v:13.5,on:true,raw:135},
  {v:18.0,on:true,raw:180},
  {v:9.0,on:false,raw:218},
  {v:13.5,on:false,raw:7},
  {v:18.0,on:false,raw:52}
];
for(const c of cases){
  const raw=encodeByte(c.v,c.on),d=decodeByte(raw);
  if(raw!==c.raw||d.on!==c.on||Math.abs(d.value-c.v)>1e-9){
    console.error('FAIL: AFR wire case',c,'got',{raw,d});
    process.exitCode=1;
  }
}

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: Blink AFR target stays separate; original ECU Air fuel ratio 0x5x/420B ON-OFF codec is locked across families.');

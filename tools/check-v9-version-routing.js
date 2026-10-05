#!/usr/bin/env node
'use strict';

const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');

function must(re,msg){
  if(!re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}

// Static invariants: V9 routing must use the first decimal digit as the
// generation discriminator because handshake firmware is only 4 ASCII bytes.
must(/function v9GenerationDigit\(info=handshakeInfo\)/,
  'missing V9 generation discriminator');
must(/function isV91Direct\(info=handshakeInfo\)[\s\S]{0,220}g===1/,
  '9.1X detector no longer uses first decimal generation digit');
must(/function usesNewThermalAxis\(info=handshakeInfo\)[\s\S]{0,320}g>=2/,
  '9.2+ thermal-axis detector no longer uses first decimal generation digit');
must(/const knownV9=!!\(ecuProfile&&ecuProfile\.key==='MODERN_V9'&&\(isV91Direct\(\)\|\|isV92Direct\(\)\)\)/,
  'V9 full-write gate must require an explicitly known 9.1x or 9.2x generation');

// Runtime-check the extracted classifier logic against representative 4-byte
// handshake firmware strings used by REDLEO generations.
const block=src.match(/function firmwareNumbers\(info=handshakeInfo\)[\s\S]*?function currentAuxAxes\(\)/);
if(!block){
  console.error('FAIL: cannot isolate V9 classifier block');
  process.exitCode=1;
}else{
  const ctx={
    handshakeInfo:null,
    ecuProfile:{key:'MODERN_V9'},
    Number,
    String,
    console
  };
  vm.createContext(ctx);
  vm.runInContext(block[0].replace(/function currentAuxAxes\(\)[\s\S]*/,''),ctx);

  const cases=[
    ['9.10',1,false],
    ['9.12',1,false],
    ['9.19',1,false],
    ['9.20',2,true],
    ['9.21',2,true],
    ['9.2',2,true],
    ['9.99',9,true]
  ];
  for(const [fw,g,newer] of cases){
    const info={firmware:fw,ident:'REDLEO'};
    const gotG=ctx.v9GenerationDigit(info);
    if(gotG!==g){
      console.error('FAIL:',fw,'generation expected',g,'got',gotG);
      process.exitCode=1;
    }
    const gotNew=ctx.usesNewThermalAxis(info);
    if(gotNew!==newer){
      console.error('FAIL:',fw,'new thermal axis expected',newer,'got',gotNew);
      process.exitCode=1;
    }
  }
  ctx.handshakeInfo={firmware:'9.12',ident:'REDLEO'};
  if(!ctx.isV91Direct(ctx.handshakeInfo)){
    console.error('FAIL: 9.12 must route to 9.1X direct serializer');
    process.exitCode=1;
  }
  ctx.handshakeInfo={firmware:'9.20',ident:'REDLEO'};
  if(ctx.isV91Direct(ctx.handshakeInfo)){
    console.error('FAIL: 9.20 must not route to 9.1X');
    process.exitCode=1;
  }
}

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: V9 firmware 9.1x/9.2x routing uses handshake generation digit safely.');

#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('index.html','utf8');

function must(re,msg){
  if(!re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}

must(/BLINK_PB_VERSION = '3\.79\.58'/,'PB version not bumped to 3.79.58');
must(/id="injCamCalcBtn"[^>]*>◒ TÍNH GÓC PHUN THEO GÓC CAM</,'cam calculator button missing');
must(/id="injCamIvc"[^>]*min="0" max="180"/,'IVC ABDC input missing');
must(/id="injCamMargin"[^>]*min="0" max="90"/,'pre-IVC margin input missing');
must(/0° = TDC nén, số INJ degree càng lớn = bắt đầu phun càng sớm trước TDC/,'explicit injection-angle convention missing');
must(/EOI mục tiêu = 180° − IVC\(ABDC\) \+ khoảng an toàn/,'EOI formula explanation missing');
must(/thời lượng phun = PW\(ms\) × RPM × 0\.006/,'pulse-width-to-crank-degree formula missing');

must(/function injCamAngleSpec\(\)[\s\S]{0,300}state\.ecuProfile==='MODERN_V11'/,
  'calculator must adapt angle domain to ECU family');
must(/label:v11\?'360° · V11 \/ Ultra Pro2':'720° · V8 \/ 9\.x \/ V10 \/ Ultra Pro1'/,
  'angle-domain family labels changed');
must(/max:v11\?360:717/,'family-specific angle clamp changed');
must(/const raw=Math\.max\(0,Math\.min\(255,Math\.round\(v\*360\/512\)\)\)/,
  'V11/Ultra Pro2 injection-angle quantizer changed');
must(/const raw=Math\.max\(0,Math\.min\(255,Math\.round\(\(v\/2\)\*256\/360\)\)\)/,
  'V8/V9/V10/Ultra1 injection-angle quantizer changed');

must(/const eoi=180-ivc\+margin/,'EOI target calculation changed');
must(/const durationDeg=pw\*rpm\*0\.006/,'injection duration degree calculation changed');
must(/const rawTarget=eoi\+durationDeg/,'SOI calculation changed');
must(/if\(!Number\.isFinite\(pw\)\|\|pw<=0[\s\S]{0,120}skipped\+\+;continue/,
  'PW=0 cells must remain untouched');
must(/fuelMapSyncUnknown\(state\.activeMap\)/,'calculator must reject unknown fuel-map state');
must(/inspectFuelMap\(fuel\)/,'calculator must validate current INJ VE map');
must(/injCamMatrixReady\(angle\)/,'calculator must require current injection-angle baseline');
must(/Bấm ÁP DỤNG chỉ thay bảng cục bộ\. Muốn gửi ECU vẫn phải bấm GHI ECU/,'local-only preview safety message missing');
must(/saveFeatureStore\(\);renderFeature\(\)/,'calculator apply must update only local feature store before ECU write');
must(/camBtn\.style\.display=f\.id==='inj_degree'\?'':'none'/,'calculator must only appear in INJ degree editor');

// Independent arithmetic checks for the model.
function legacyQuant(v){
  v=Math.max(0,Math.min(717,Number(v)||0));
  const raw=Math.max(0,Math.min(255,Math.round((v/2)*256/360)));
  return Math.round(raw*2*360/256);
}
function v11Quant(v){
  v=Math.max(0,Math.min(360,Number(v)||0));
  const raw=Math.max(0,Math.min(255,Math.round(v*360/512)));
  return Math.max(0,Math.min(360,Math.round((raw*512/360)/2)*2));
}
const ivc=50,margin=10,pw=5,rpm=4000;
const eoi=180-ivc+margin;
const soi=eoi+pw*rpm*0.006;
if(eoi!==140||soi!==260||legacyQuant(soi)!==259||v11Quant(soi)!==260){
  console.error('FAIL: calculator arithmetic/quantization example changed',{eoi,soi,legacy:legacyQuant(soi),v11:v11Quant(soi)});
  process.exitCode=1;
}
if(legacyQuant(999)!==717||v11Quant(999)!==360){
  console.error('FAIL: family clamp behavior changed',{legacy:legacyQuant(999),v11:v11Quant(999)});
  process.exitCode=1;
}

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: adaptive injection-angle calculator keeps cam/PW/RPM formula, family quantization, baseline checks and local-only apply semantics.');

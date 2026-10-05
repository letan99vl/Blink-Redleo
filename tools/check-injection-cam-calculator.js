#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('index.html','utf8');

function must(re,msg){
  if(!re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}
function mustNot(re,msg){
  if(re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}

must(/BLINK_PB_VERSION = '3\.79\.61'/,'PB version not bumped to 3.79.61');
must(/id="injCamCalcBtn"[^>]*>◒ TÍNH GÓC PHUN THEO GÓC CAM</,'cam calculator button missing');

// Cam input must use only IVO + IVC and suppress native mobile keyboards.
must(/id="injCamIvo" type="text" inputmode="none" readonly[^>]*value="3"/,'IVO virtual-keypad input missing');
must(/id="injCamIvc" type="text" inputmode="none" readonly[^>]*value="31"/,'IVC virtual-keypad input missing');
mustNot(/id="injCamMargin"/,'manual EOI margin input must not return');
must(/id="injCamKeypad"/,'built-in cam keypad missing');
must(/data-injcam-key="1"/,'key 1 missing');
must(/data-injcam-key="2"/,'key 2 missing');
must(/data-injcam-key="3"/,'key 3 missing');
must(/data-injcam-key="4"/,'key 4 missing');
must(/data-injcam-key="5"/,'key 5 missing');
must(/data-injcam-key="6"/,'key 6 missing');
must(/data-injcam-key="7"/,'key 7 missing');
must(/data-injcam-key="8"/,'key 8 missing');
must(/data-injcam-key="9"/,'key 9 missing');
must(/data-injcam-key="0"/,'key 0 missing');
must(/data-injcam-key="\."/,'decimal key missing');
must(/data-injcam-key="clear"/,'clear key missing');
must(/data-injcam-key="backspace"/,'backspace key missing');
must(/data-injcam-key="next"/,'next key missing');
must(/data-injcam-key="done"/,'done key missing');
must(/pointerdown'[\s\S]{0,220}preventDefault\(\)[\s\S]{0,220}injCamSelectField/,'cam field tap must prevent native input focus/keyboard');
must(/function injCamKey\(key\)/,'virtual keypad handler missing');
must(/async function ensureInjCamRequiredMaps\(\)/,'cam calculator auto-read preflight missing');
must(/readFeaturePageReal\('inj_ve',bank,false\)/,'cam calculator must auto-read current fuel map when missing');
must(/readFeaturePageReal\('inj_degree',bank,false\)/,'cam calculator must auto-read injection-angle baseline when missing');
must(/async function runInjCamPreview\(\)/,'cam preview must be async for ECU auto-read');
must(/if\(injCamPreviewBusy\)return/,'cam preview must block duplicate concurrent taps');
must(/Đang tự đọc Thời gian phun · MAP No\./,'fuel auto-read progress message missing');
must(/Đang tự đọc Góc phun · MAP No\./,'angle auto-read progress message missing');
must(/nếu thiếu Thời gian phun\/Góc phun, Blink sẽ tự đọc đúng MAP này từ ECU/,'dialog auto-read guidance missing');
must(/id="injCamPreviewText" class="injCamPreview"/,'in-dialog preview/status element missing');
must(/id="injCamPreviewBtn" type="button" class="primary">TÍNH THỬ<\/button>/,'preview action button missing');
must(/id="injCamApplyBtn" type="button" class="danger" data-ready="0">ÁP DỤNG VÀO MAP<\/button>/,'apply button must stay clickable even before preview');
mustNot(/id="injCamApplyBtn"[^>]*disabled/,'apply button must not be disabled/silent');
must(/async function runInjCamPreview\(\)[\s\S]{0,1200}setInjCamDialogMessage\('Đang kiểm tra dữ liệu MAP hiện tại\.\.\.'\)[\s\S]{0,1200}setInjCamDialogMessage\('Đang tính MAP góc phun\.\.\.'\)/,'preview must show preflight and calculation progress in dialog');
must(/function runInjCamPreview\(\)[\s\S]{0,900}KHÔNG THỂ TÍNH/,'preview errors must be visible inside dialog');
must(/function applyInjCamPreview\(\)[\s\S]{0,500}CHƯA CÓ MAP ĐỀ XUẤT/,'apply-before-preview must show in-dialog feedback');
must(/injCamPreviewBtn'[\s\S]{0,180}runInjCamPreview\(\)/,'preview button event not wired');
must(/injCamApplyBtn'[\s\S]{0,180}applyInjCamPreview\(\)/,'apply button event not wired');

// Two-parameter cam model.
must(/duration cam nạp = 180 \+ IVO \+ IVC/,'intake-duration formula explanation missing');
must(/const camDuration=180\+ivo\+ivc/,'intake-duration calculation changed');
must(/const autoMargin=Math\.max\(8,Math\.min\(20,Math\.round\(camDuration\*0\.05\)\)\)/,'automatic EOI margin model changed');
must(/const eoi=180-ivc\+autoMargin/,'EOI target calculation changed');
must(/const durationDeg=pw\*rpm\*0\.006/,'injection duration degree calculation changed');
must(/const rawTarget=eoi\+durationDeg/,'SOI calculation changed');
must(/0° = TDC nén, INJ degree càng lớn = phun càng sớm/,'explicit injection-angle convention missing');

must(/function injCamAngleSpec\(\)[\s\S]{0,300}state\.ecuProfile==='MODERN_V11'/,'calculator must adapt angle domain to ECU family');
must(/label:v11\?'360° · V11 \/ Ultra Pro2':'720° · V8 \/ 9\.x \/ V10 \/ Ultra Pro1'/,'angle-domain family labels changed');
must(/max:v11\?360:717/,'family-specific angle clamp changed');
must(/const raw=Math\.max\(0,Math\.min\(255,Math\.round\(v\*360\/512\)\)\)/,'V11/Ultra Pro2 injection-angle quantizer changed');
must(/const raw=Math\.max\(0,Math\.min\(255,Math\.round\(\(v\/2\)\*256\/360\)\)\)/,'V8/V9/V10/Ultra1 injection-angle quantizer changed');

must(/if\(!Number\.isFinite\(pw\)\|\|pw<=0[\s\S]{0,120}skipped\+\+;continue/,'PW=0 cells must remain untouched');
must(/fuelMapSyncUnknown\(state\.activeMap\)/,'calculator must reject unknown fuel-map state');
must(/inspectFuelMap\(fuel\)/,'calculator must validate current INJ VE map');
must(/injCamMatrixReady\(angle\)/,'calculator must require current injection-angle baseline');
must(/Bấm ÁP DỤNG chỉ thay bảng cục bộ\. Muốn gửi ECU vẫn phải bấm GHI ECU/,'local-only apply safety message missing');
must(/saveFeatureStore\(\);renderFeature\(\)/,'calculator apply must remain local until GHI ECU');
must(/camBtn\.style\.display=f\.id==='inj_degree'\?'':'none'/,'calculator must only appear in INJ degree editor');

// Independent arithmetic check using IVO 3 / IVC 31.
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
const ivo=3,ivc=31,pw=5,rpm=4000;
const camDuration=180+ivo+ivc;
const autoMargin=Math.max(8,Math.min(20,Math.round(camDuration*0.05)));
const eoi=180-ivc+autoMargin;
const soi=eoi+pw*rpm*0.006;
if(camDuration!==214||autoMargin!==11||eoi!==160||soi!==280||legacyQuant(soi)!==281||v11Quant(soi)!==280){
  console.error('FAIL: IVO/IVC cam-model arithmetic changed',{camDuration,autoMargin,eoi,soi,legacy:legacyQuant(soi),v11:v11Quant(soi)});
  process.exitCode=1;
}
if(legacyQuant(999)!==717||v11Quant(999)!==360){
  console.error('FAIL: family clamp behavior changed',{legacy:legacyQuant(999),v11:v11Quant(999)});
  process.exitCode=1;
}

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: IVO/IVC cam calculator auto-reads required ECU maps, keeps responsive actions, family quantization and local-only apply safety.');

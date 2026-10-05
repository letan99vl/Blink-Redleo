#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('index.html','utf8');

function must(re,msg){ if(!re.test(src)){console.error('FAIL:',msg);process.exitCode=1;} }
function mustNot(re,msg){ if(re.test(src)){console.error('FAIL:',msg);process.exitCode=1;} }

must(/BLINK_PB_VERSION = '3\.79\.64'/,'PB version not bumped to 3.79.64');
must(/id="injCamCalcBtn"[^>]*>◒ TÍNH GÓC PHUN THEO GÓC CAM</,'cam calculator button missing');

// IVO/IVC-only input + built-in keypad.
must(/id="injCamIvo" type="text" inputmode="none" readonly[^>]*value="3"/,'IVO virtual-keypad input missing');
must(/id="injCamIvc" type="text" inputmode="none" readonly[^>]*value="31"/,'IVC virtual-keypad input missing');
mustNot(/id="injCamMargin"/,'manual margin input must not return');
must(/id="injCamKeypad"/,'built-in cam keypad missing');
must(/function injCamKey\(key\)/,'virtual keypad handler missing');
must(/pointerdown'[\s\S]{0,220}preventDefault\(\)[\s\S]{0,220}injCamSelectField/,'cam field tap must suppress native keyboard');

// Physical timing model: PW ms -> crank degrees, then back-calculate SOI from IVO/EOI target.
must(/function injCamPulseDegrees\(pwMs,rpm\)/,'PW-to-crank-degree helper missing');
must(/return pwMs\*rpm\*0\.006/,'physical PW x RPM x 0.006 conversion missing');
must(/const eoiTarget=ivo/,'EOI target must currently be anchored at IVO');
must(/const rawTarget=eoiTarget\+durationDeg/,'SOI must be back-calculated from EOI target + pulse duration');
must(/const camDuration=180\+ivo\+ivc/,'cam duration diagnostic missing');
must(/const intakeCenter=90\+\(ivc-ivo\)\/2/,'cam center diagnostic missing');
must(/Do NOT add injector dead-time separately here/,'dead-time double-count warning missing');

// The old heuristic must not drive the calculation anymore.
mustNot(/const INJ_CAM_STRATEGY_MAX=295/,'295 degree strategy cap must not drive physical model');
mustNot(/const durationScale=Math\.max\(0\.85/,'old duration scaling must be removed');
mustNot(/const phaseAdjust=Math\.max\(-20/,'old cam-center phase heuristic must be removed');
mustNot(/const unclamped=base\*durationScale\+phaseAdjust/,'old reference-curve formula must be removed');

// 3/31 table stays only as a comparison reference, never a clamp/driver.
must(/const INJ_CAM_REFERENCE_IVO=3/,'3/31 reference IVO missing');
must(/const INJ_CAM_REFERENCE_IVC=31/,'3/31 reference IVC missing');
must(/injCamReferenceAngle\(r,rpm\)/,'3/31 reference comparison missing');
must(/chỉ tham chiếu, không ép trần 295°/,'UI must explain 295 is reference-only');

// Fuel + angle preflight is required again because the physical model needs real PW.
must(/async function ensureInjCamRequiredMaps\(\)/,'cam auto-read preflight missing');
must(/inspectFuelMap\(state\.inject\)/,'cam preflight must validate fuel map');
must(/readFeaturePageReal\('inj_ve',bank,false\)/,'cam preflight must auto-read fuel map');
must(/readFeaturePageReal\('inj_degree',bank,false\)/,'cam preflight must auto-read angle baseline');
must(/const auto=await ensureInjCamRequiredMaps\(\)/,'preview must run preflight before calculation');

// Local-only apply remains mandatory.
must(/saveFeatureStore\(\);renderFeature\(\)/,'APPLY must remain local before GHI ECU');
must(/Bấm ÁP DỤNG chỉ thay bảng cục bộ/,'local-only apply guidance missing');

// Independent physics checks.
function pulseDeg(pw,rpm){ return pw*rpm*0.006; }
function soi(ivo,pw,rpm){ return ivo+pulseDeg(pw,rpm); }

const cases=[
  ['8ms @ 10000rpm pulse',pulseDeg(8,10000),480],
  ['3/31, 6.4ms @ 5000rpm SOI',soi(3,6.4,5000),195],
  ['3/31, 7ms @ 500rpm SOI',soi(3,7,500),24],
  ['30deg IVO, 8ms @ 10000rpm SOI',soi(30,8,10000),510]
];
for(const [name,got,want] of cases){
  if(Math.abs(got-want)>1e-9){
    console.error('FAIL:',name,'want',want,'got',got);
    process.exitCode=1;
  }
}

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: physical cam calculator uses SOI = IVO + PW*RPM*0.006, restores fuel preflight, keeps 3/31 as reference only, and preserves local-only apply safety.');

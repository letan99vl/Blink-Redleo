#!/usr/bin/env node
'use strict';

const fs=require('fs');
const src=fs.readFileSync('redleo_real_protocol.js','utf8');

function must(re,msg){
  if(!re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}
function mustNot(re,msg){
  if(re.test(src)){console.error('FAIL:',msg);process.exitCode=1;}
}

// This checker freezes the user-visible ECU editor surface against the
// family-specific serializers proven from original software. A visible card
// must either have a direct read/write path or be deliberately hidden/read-only.

// V8: MAIN TUNE only.
must(/LEGACY_V8:new Set\(\['inj_ve','inj_degree','ign_degree','ign_time'\]\)/,
  'V8 visible feature surface changed');
must(/family==='v8'&&!\['inj_degree','ign_degree','ign_time'\]\.includes\(id\)/,
  'V8 auxiliary direct-read guard missing');

// REDLEO 9.1X: verified direct pages, but AutoClutch and whole Options write stay out.
must(/isV91Direct\(\)&&\['ect_inj','ect_ign','map_inj','idle_limit','ect_idle_motor','iat_inj','map_idle_motor','external_adjust','v_ect','v_iat','v_map'\]\.includes\(id\)\)return true/,
  '9.1X direct feature matrix changed');
must(/if\(p===ecuProfile&&isV91Direct\(\)&&id==='auto_clutch'\)return false/,
  '9.1X AutoClutch must stay hidden');
must(/if\(isV91Direct\(\)\)throw new Error\('REDLEO 9\.1X · Ghi Options 12B vẫn khóa riêng/,
  '9.1X whole Options write must stay locked');

// REDLEO 9.2: keep direct compensation/page6/A2 surfaces separate from 9.1.
must(/ecuProfile&&ecuProfile\.key==='MODERN_V9'&&usesNewThermalAxis\(\)&&\['ect_inj','ect_ign','map_inj','idle_limit','ect_idle_motor','iat_inj','map_idle_motor','external_adjust','auto_clutch','v_ect','v_iat','v_map'\]\.includes\(id\)\)return true/,
  '9.2 direct feature matrix changed');

// V10.2 direct session: base features + the verified V10-only A2 surfaces.
must(/isV10Direct\(\)&&\['ect_inj','ect_ign','map_inj','idle_limit','iat_inj','map_idle_motor','ect_idle_motor','external_adjust','auto_clutch','ate_options','ect_start','tps_axis','rpm_axis','v_ect','v_iat','v_map'\]\.includes\(id\)\)return true/,
  'V10.2 direct feature matrix changed');
must(/currentV10Direct&&\['ect_idle_motor','external_adjust','auto_clutch','ate_options','ect_start','tps_axis','rpm_axis'\]\.includes\(id\)/,
  'V10.2 dynamic-only UI surface changed');

// Ultra Pro1: original software proves compensation pages + separate A2.
// Option and AutoClutch remain intentionally hidden.
must(/isUltraDirect\(\)&&\['ect_inj','ect_ign','map_inj','idle_limit','iat_inj','map_idle_motor','ect_idle_motor','external_adjust','ect_start','tps_axis','rpm_axis','v_ect','v_iat','v_map'\]\.includes\(id\)\)return true/,
  'Ultra Pro1 direct feature matrix changed');
must(/currentUltraDirect&&\['ect_idle_motor','external_adjust','ect_start','tps_axis','rpm_axis'\]\.includes\(id\)/,
  'Ultra Pro1 dynamic UI surface changed');
mustNot(/currentUltraDirect&&\[[^\]]*'ate_options'/,
  'Ultra Pro1 Option must stay hidden until separately certified');
mustNot(/currentUltraDirect&&\[[^\]]*'auto_clutch'/,
  'Ultra Pro1 AutoClutch must stay out of scope');

// V11 / Ultra Pro2 share proven V11 serializers; Pro2 specifically hides AutoClutch.
must(/MODERN_V11:new Set\(\['inj_ve','inj_degree','ign_degree','ign_time','afr_map','ect_inj','ect_ign','map_inj','iat_inj','ect_start','idle_limit','ect_idle_motor','map_idle_motor','external_adjust','auto_shift','auto_clutch','chg_params','ate_options','alternate_table','v_ect','v_iat','v_map'\]\)/,
  'V11 visible feature surface changed');
must(/if\(p===ecuProfile&&isUltraPro2Direct\(\)&&id==='auto_clutch'\)return false/,
  'Ultra Pro2 AutoClutch UI hide missing');
must(/if\(isUltraPro2Direct\(\)&&id==='auto_clutch'\)return false/,
  'Ultra Pro2 AutoClutch direct-write gate missing');

// Shared direct page routing must remain exact.
must(/if\(id==='ect_inj'\)return 0x72;[\s\S]{0,80}if\(id==='ect_ign'\)return 0x82;[\s\S]{0,80}if\(id==='map_inj'\)return 0x92;/,
  'Compensation page routing changed');
must(/if\(v91&&\['idle_limit','ect_idle_motor'\]\.includes\(id\)\)return page\(6,bank\)/,
  '9.1X page6 route missing');
must(/if\(v92&&\['idle_limit','ect_idle_motor'\]\.includes\(id\)\)return page\(6,bank\)/,
  '9.2 page6 route missing');
must(/if\(v10&&id==='idle_limit'\)return page\(6,bank\)/,
  'V10 page6 Idle route missing');
must(/if\(ultra&&id==='idle_limit'\)return page\(6,bank\)/,
  'Ultra Pro1 page6 Idle route missing');

// UI write enablement must require a verified direct page + baseline cache.
must(/function mainFeatureReady\(id,bank\)\{[\s\S]*pg!=null&&profileCap\('mainWrite'\)&&isDirectVerifiedFeature\(id\)&&pageCache\.has\(pg\)/,
  'Feature write-ready gate no longer requires exact page cache');
must(/const directReady=activeFeatureId\?mainFeatureReady\(activeFeatureId/,
  'ECU editor write button is not tied to direct-write readiness');
must(/setProfileDisabled\(document\.getElementById\('redReadBtn'\),!profileCap\('pageRead'\)\|\|!activeFeatureSupported/,
  'ECU editor READ button is not profile-aware');

// Actual UI I/O capture must route to the real read/write functions, not mock packet handlers.
must(/redReadBtn[\s\S]{0,1600}readFeaturePageReal/,
  'ECU feature READ button is not captured by real protocol handler');
must(/redWriteBtn[\s\S]{0,1600}writeFeatureReal/,
  'ECU feature WRITE button is not captured by real protocol handler');
must(/idleLimitReadBtn[\s\S]{0,1200}readIdlePageReal/,
  'Idle READ button is not captured by real protocol handler');
must(/idleLimitWriteBtn[\s\S]{0,1200}writeIdleReal/,
  'Idle WRITE button is not captured by real protocol handler');

// Cross-family anti-fallback rules. Check the exact dispatch lines rather than
// proximity: adjacent family branches are intentionally close in source.
must(/if\(isUltraDirect\(\)&&\[[^\]]*'iat_inj'[^\]]*\]\.includes\(id\)\)return writeUltraA2KnownFeature\(id\);/,
  'Ultra Pro1 must dispatch A2 edits to writeUltraA2KnownFeature');
must(/if\(isV10Direct\(\)&&\[[^\]]*'iat_inj'[^\]]*\]\.includes\(id\)\)return writeV10A2KnownFeature\(id\);/,
  'V10.2 must dispatch A2 edits to writeV10A2KnownFeature');
must(/if\(isV91Direct\(\)&&\[[^\]]*'iat_inj'[^\]]*\]\.includes\(id\)\)return writeV91A2KnownFeature\(id\);/,
  '9.1X must dispatch A2 edits to writeV91A2KnownFeature');
must(/if\(isV92Direct\(\)&&\[[^\]]*'iat_inj'[^\]]*\]\.includes\(id\)\)return writeV92A2KnownFeature\(id\);/,
  '9.2 must dispatch A2 edits to writeV92A2KnownFeature');

if(process.exitCode)process.exit(process.exitCode);
console.log('OK: ECU feature visibility/read/write matrix remains aligned with family-specific verified serializers.');

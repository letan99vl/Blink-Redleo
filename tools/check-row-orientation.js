const fs=require('fs');
const s=fs.readFileSync('redleo_real_protocol.js','utf8');
function must(re,msg){if(!re.test(s)){console.error('FAIL:',msg);process.exitCode=1;}}
function mustNot(re,msg){if(re.test(s)){console.error('FAIL:',msg);process.exitCode=1;}}

must(/function compRowsForwardOnWire\(info=handshakeInfo\)\{\s*return usesNewThermalAxis\(info\);\s*\}/,
  'missing generation-aware compensation row order');
must(/const compDecode=compRowsForwardOnWire\(\)\?decodeRowsByteForward:decodeRowsByte;/,
  'canonical Read-All is not profile-aware');
must(/const forwardComp=\['ect_inj','ect_ign','map_inj'\]\.includes\(id\)&&compRowsForwardOnWire\(\);/,
  'direct compensation reads are not profile-aware');
must(/case 'ect_inj':[\s\S]{0,180}compRowsForwardOnWire\(\)\?encodeRowsByteForward/,
  'ECT INJ direct writer is not profile-aware');
must(/case 'ect_ign':[\s\S]{0,220}compRowsForwardOnWire\(\)\?encodeRowsByteForward/,
  'ECT IGN direct writer is not profile-aware');
must(/case 'map_inj':[\s\S]{0,180}compRowsForwardOnWire\(\)\?encodeRowsByteForward/,
  'MAP INJ direct writer is not profile-aware');
must(/const compEncode=compRowsForwardOnWire\(\)\?encodeRowsByteForward:encodeRowsByte;/,
  'SEND ALL compensation writer is not profile-aware');

// Main TPS maps must remain on the reversed-row codec because the UI is 100% -> IDLE.
must(/B\.injDegreeRaw=f\.slice[\s\S]{0,180}decodeRowsByte\(f,p,14,30,decMainInjAngle\)/,
  'V11 TPS injection-angle map row order changed unexpectedly');
must(/B\.ignDegreeRaw=f\.slice[\s\S]{0,180}decodeRowsByte\(f,p,14,30,decMainIgn\)/,
  'V11 TPS ignition map row order changed unexpectedly');
mustNot(/decodeRowsByteForward\(f,p,14,30/,
  'forward codec leaked into 14x30 TPS maps');

if(process.exitCode)process.exit(process.exitCode);
console.log('Compensation row-orientation regression checks: OK');

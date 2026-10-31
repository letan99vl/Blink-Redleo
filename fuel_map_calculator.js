/* Blink Redleo | Fuel base map calculator: regional 2D TPS x RPM template | WEB/ANDROID + BLUEFY ONLY | PB3.79.131 */
(function(root){
  'use strict';
  const RPM_VE=[[500,.54],[1500,.61],[3000,.75],[4500,.85],[6000,.92],[6500,.94],[7500,.90],[9000,.82],[11000,.72],[15000,.60]];
  const TPS_FILL=[[0,.16],[2,.19],[5,.25],[8,.31],[14,.43],[20,.55],[30,.68],[40,.78],[50,.85],[60,.90],[70,.94],[80,.97],[90,.99],[100,1]];
  // Regional fuel-shape reference transcribed from the USER'S TPS x RPM screenshot,
  // NOT an independently measured VE map. Use SHAPE only; never copy reference ms.
  // Columns 500..9500 RPM in 500 RPM steps; rows 100..2% then IDLE(0%).
  const PHOTO_RPM_MIN=500, PHOTO_RPM_STEP=500, PHOTO_RPM_MAX=9500;
  const PHOTO_TPS=[100,90,80,70,60,50,40,30,20,14,8,5,2,0];
  const PHOTO_MS=[[7.67,7.67,7.67,7.67,7.39,7.39,6.76,6.39,6.39,6.48,6.76,7.11,7.18,7.18,7.18,7.03,6.8,6.76,6.34],[7.67,7.67,7.67,7.67,7.39,7.39,6.76,6.39,6.39,6.48,6.76,7.11,7.18,7.18,7.18,7.03,6.8,6.76,6.34],[7.67,7.67,7.67,7.67,7.39,7.39,6.76,6.39,6.39,6.48,6.76,7.08,7.11,7.11,7.11,6.99,6.76,6.71,6.25],[7.67,7.67,7.67,7.67,7.39,7.18,6.67,6.48,6.48,6.48,6.71,7.08,7.08,7.08,6.99,6.85,6.67,6.39,6.07],[7.67,7.67,7.67,7.67,7.39,7.18,6.67,6.48,6.48,6.48,6.53,6.8,6.89,6.76,6.62,6.48,6.25,5.98,5.66],[7.67,7.67,7.46,7.46,7.18,7.18,6.62,6.34,6.34,6.34,6.39,6.48,6.34,6.17,5.98,5.8,5.62,5.44,5.17],[7.39,7.39,7.25,7.25,6.99,6.93,6.53,6.17,5.89,5.75,5.75,5.75,5.62,5.39,5.17,5.03,4.89,4.62,4.39],[7.11,7.03,7.03,7.03,6.85,6.76,6.03,5.39,5.17,4.89,4.89,4.89,4.75,4.52,4.39,4.21,4.07,3.98,3.85],[6.21,6.21,6.21,6.21,5.98,5.62,4.8,4.3,4.07,3.89,3.85,3.8,3.75,3.62,3.48,3.35,3.25,3.25,3.21],[5.8,5.71,5.71,5.66,4.94,4.58,3.98,3.58,3.39,3.25,3.3,3.25,3.16,3.07,2.98,2.89,2.76,2.66,2.48],[4.89,4.89,4.8,4.66,4.21,3.71,3.21,2.98,2.84,2.76,2.66,2.57,2.44,2.35,2.3,2.35,2.3,2.25,2.08],[4.43,4.35,4.03,3.98,3.62,3.25,2.8,2.53,2.39,2.25,2.08,1.93,1.89,1.85,1.89,1.85,1.85,1.89,1.8],[3.67,3.35,2.89,2.62,2.25,2.02,1.8,1.76,1.71,1.62,1.62,1.62,1.62,1.62,1.62,1.62,1.62,1.57,1.48],[4.26,2.35,2.06,1.8,1.62,1.53,1.53,1.39,1.39,1.39,1.39,1.39,1.39,1.39,1.3,1.3,1.21,1.17,1.07]];
  // The reference ECU injector deadtime is unknown; 0.90 ms is an explicit
  // shape-extraction offset, NOT the actual new injector's deadtime.
  const PHOTO_OFFSET_MS=0.9;
  function photoRowMs(row,rpm){
    const x=Math.max(PHOTO_RPM_MIN,Math.min(PHOTO_RPM_MAX,rpm));
    const k=Math.min(PHOTO_MS[row].length-2,Math.floor((x-PHOTO_RPM_MIN)/PHOTO_RPM_STEP));
    const t=(x-(PHOTO_RPM_MIN+k*PHOTO_RPM_STEP))/PHOTO_RPM_STEP;
    const m=PHOTO_MS[row][k]+t*(PHOTO_MS[row][k+1]-PHOTO_MS[row][k]);
    if(rpm<=PHOTO_RPM_MAX)return m;
    // Above the supplied photo's final 9500 RPM point, taper using the
    // older WOT RPM prior. This is extrapolation, NOT measured from the photo.
    const taper=interp(RPM_VE,rpm)/interp(RPM_VE,PHOTO_RPM_MAX);
    return PHOTO_OFFSET_MS+(m-PHOTO_OFFSET_MS)*taper;
  }
  function photoRegionalMs(tps,rpm){
    if(tps>=PHOTO_TPS[0])return photoRowMs(0,rpm);
    for(let i=1;i<PHOTO_TPS.length;i++){
      if(tps>=PHOTO_TPS[i]){
        const hi=PHOTO_TPS[i-1],lo=PHOTO_TPS[i];
        const ratio=(tps-lo)/(hi-lo);
        return photoRowMs(i,rpm)*(1-ratio)+photoRowMs(i-1,rpm)*ratio;
      }
    }
    return photoRowMs(PHOTO_TPS.length-1,rpm);
  }
  function photoRegionalVe(tps,rpm,veAtWot6500){
    const numerator=Math.max(.01,photoRegionalMs(tps,rpm)-PHOTO_OFFSET_MS);
    const denominator=photoRegionalMs(100,6500)-PHOTO_OFFSET_MS;
    return veAtWot6500*(numerator/denominator);
  }
  // 2D region weight: 0% = legacy separable model, 100% = shape of supplied
  // reference; 95% preserves the low-rpm plateaus and TPS-specific peaks.
  const DEFAULTS={bore:72,stroke:72,throttle:32,flow:300,ratedBar:3,pressure:3.5,
    afr:13,afrScale:'gauge',iat:30,baroKpa:101.325,maxRpm:9000,peakVe:94,shapePct:95,deadtime:.9,
    pulses:'1',output:'command',scope:'full',model:'regional'};
  const specs={bore:[30,125],stroke:[30,140],throttle:[15,75],flow:[50,2000],
    ratedBar:[1,7],pressure:[1,7],afr:[9,18],iat:[-20,100],maxRpm:[500,30000],
    peakVe:[35,130],shapePct:[0,100],baroKpa:[80,110],deadtime:[0,4]};
  function valueNum(n){return Number(String(n).replace(',','.'));}
  function interp(curve,x){
    if(x<=curve[0][0])return curve[0][1];
    for(let i=1;i<curve.length;i++){
      if(x<=curve[i][0]){
        const a=curve[i-1],b=curve[i],t=(x-a[0])/(b[0]-a[0]);
        return a[1]+(b[1]-a[1])*t;
      }
    }
    return curve[curve.length-1][1];
  }
  function validate(raw){
    const p=Object.assign({},DEFAULTS,raw||{});
    for(const [key,range] of Object.entries(specs)){
      const v=valueNum(p[key]);
      if(!Number.isFinite(v)||v<range[0]||v>range[1])
        throw new Error(key+': nhập trong khoảng '+range[0]+'–'+range[1]+'.');
      p[key]=v;
    }
    if(!['gauge','e10'].includes(p.afrScale))throw new Error('Thang AFR không hợp lệ.');
    if(!['regional','airmass'].includes(p.model))throw new Error('Chế độ tính không hợp lệ.');
    if(!['1','2'].includes(String(p.pulses)))throw new Error('Số lần phun/720° không hợp lệ.');
    p.pulses=Number(p.pulses);
    if(!['command','effective'].includes(p.output))throw new Error('Kiểu thời gian phun không hợp lệ.');
    if(!['full','selected'].includes(p.scope))throw new Error('Vùng tính không hợp lệ.');
    return p;
  }
  function paramsPhysics(p){
    const displacement=Math.PI*p.bore*p.bore*p.stroke/4000; // cm3, one cylinder
    const rho=(p.model==='airmass'?p.baroKpa:101.325)*1000/(287.05*(273.15+p.iat)); // kg/m3 = mg/cm3
    const flow=p.flow*Math.sqrt(p.pressure/p.ratedBar); // cc/min; injector *differential* pressure
    const injectorMgPerMs=flow/60*.75; // E10 density approx. .75 g/cc
    return {displacement,rho,flow,injectorMgPerMs};
  }
  function baseVe(p,tps,rpm){
    // This is an Alpha-N 2D prior, NOT a measured air-mass map.
    const fill=interp(TPS_FILL,tps);
    const oldVe=interp(RPM_VE,rpm)*(p.peakVe/94)*fill;
    const refVe=photoRegionalVe(tps,rpm,p.peakVe/100);
    return oldVe*(1-p.shapePct/100)+refVe*(p.shapePct/100);
  }
  function inferVe(raw,reading){
    // Explicit manual steady-state reading only; never consume transient ECU AFR.
    const p=validate(Object.assign({},raw,{model:'airmass'}));
    if(!reading||typeof reading!=='object')throw new Error('Thiếu dữ liệu AFR đo và PW thực tế.');
    const tps=Number(reading.tps),rpm=Number(reading.rpm);
    const afr=valueNum(reading.afr),pw=valueNum(reading.pw);
    if(!Number.isFinite(tps)||tps<0||tps>100||!Number.isFinite(rpm)||rpm<500)
      throw new Error('TPS hoặc RPM ô đã chọn không hợp lệ.');
    if(!Number.isFinite(afr)||afr<9||afr>20)throw new Error('AFR đo phải trong khoảng 9–20.');
    if(!Number.isFinite(pw)||pw<=.05||pw>60)throw new Error('PW đang chạy phải trong khoảng 0,05–60 ms.');
    const {displacement,rho,flow,injectorMgPerMs}=paramsPhysics(p);
    const effectivePerPulse=pw-(p.output==='command'?p.deadtime:0);
    if(effectivePerPulse<=0)throw new Error('PW trừ deadtime không dương, không thể suy ra VE.');
    const lambda=afr/(p.afrScale==='gauge'?14.7:14.1);
    const realAfr=lambda*14.1;
    const fuelMg=effectivePerPulse*p.pulses*injectorMgPerMs;
    const airMg=fuelMg*realAfr;
    const ve=airMg/(displacement*rho);
    const prior=baseVe(p,tps,rpm);
    const departurePct=(ve/prior-1)*100;
    if(!Number.isFinite(ve)||ve<.03||ve>1.3)
      throw new Error('VE suy ra '+(ve*100).toFixed(1)+'% ngoài khoảng thẩm định 3–130%. Kiểm tra AFR/PW/áp suất/deadtime.');
    if(Math.abs(departurePct)>50)
      throw new Error('VE lệch '+departurePct.toFixed(1)+'% so với VE nền (giới hạn ±50% thử nghiệm). Kiểm tra điều kiện đo trước.');
    return {ve,vePct:ve*100,airMg,fuelMg,realAfr,lambda,prior,departurePct,
      flow,displacement,rho,tps,rpm,pw,afr};
  }
  function calculate(raw,axes,baseline,selected,calibrations){
    const p=validate(raw);
    if(!axes||!Array.isArray(axes.rpms)||!Array.isArray(axes.tps)||
       !axes.rpms.length||!axes.tps.length)throw new Error('Không có trục TPS/RPM hợp lệ.');
    if(!Array.isArray(baseline)||baseline.length!==axes.tps.length||
       baseline.some(row=>!Array.isArray(row)||row.length!==axes.rpms.length))
      throw new Error('MAP nền không khớp trục ECU.');
    if(p.scope==='selected'&&(!selected||![selected.r0,selected.r1,selected.c0,selected.c1].every(Number.isInteger)))
      throw new Error('Hãy chọn vùng TPS × RPM trên MAP trước.');
    const {displacement,rho,flow,injectorMgPerMs}=paramsPhysics(p);
    const lambda=p.afr/(p.afrScale==='gauge'?14.7:14.1);
    const actualE10Afr=14.1*lambda;
    const effective=[];
    const command=[];
    const output=[];
    const airMassMg=[];
    const veGrid=[];
    const correctedGrid=new Map();
    if(p.model==='airmass'&&Array.isArray(calibrations)){
      for(const a of calibrations){
        if(!a||!Number.isInteger(a.r)||!Number.isInteger(a.c)||a.r<0||a.c<0||
            a.r>=axes.tps.length||a.c>=axes.rpms.length||!Number.isFinite(a.ve)||a.ve<.03||a.ve>1.3)continue;
        correctedGrid.set(a.r+':'+a.c,a.ve);
      }
    }
    const candidate=baseline.map(row=>row.slice());
    let updated=0,min=Infinity,max=-Infinity,maxDuty=0,aboveDuty=0,maxVe=0,extrapolated=0,usedCalibrations=0;
    for(let r=0;r<axes.tps.length;r++){
      const effectiveRow=[],commandRow=[],outRow=[],mgRow=[],veRow=[];
      const rowLabel=axes.tps[r];
      const tps=String(rowLabel).toUpperCase()==='IDLE'?0:valueNum(rowLabel);
      if(!Number.isFinite(tps)||tps<0||tps>100)throw new Error('Trục TPS không hợp lệ ở hàng '+(r+1));
      for(let c=0;c<axes.rpms.length;c++){
        const rpm=Number(axes.rpms[c]);
        if(!Number.isFinite(rpm)||rpm<=0)throw new Error('Trục RPM không hợp lệ ở cột '+(c+1));
        const included=rpm<=p.maxRpm && (p.scope==='full'||(r>=selected.r0&&r<=selected.r1&&c>=selected.c0&&c<=selected.c1));
        if(!included){effectiveRow.push(null);commandRow.push(null);outRow.push(null);mgRow.push(null);veRow.push(null);continue;}
        const anchor=correctedGrid.get(r+':'+c);
        const ve=anchor===undefined?baseVe(p,tps,rpm):anchor;
        if(anchor!==undefined)usedCalibrations++;
        maxVe=Math.max(maxVe,ve);
        if(rpm>PHOTO_RPM_MAX)extrapolated++; // no photo data above 9500
        const airMg=displacement*rho*ve;
        mgRow.push(airMg);veRow.push(ve*100);
        const fuelMg=airMg/actualE10Afr;
        const pwEffective=fuelMg/injectorMgPerMs/p.pulses;
        const pwCommand=pwEffective+p.deadtime;
        const duty=p.pulses*pwCommand*rpm/120000*100; // 720-degree period
        if(!Number.isFinite(pwCommand)||pwCommand<=0)throw new Error('Kết quả thời gian phun không hợp lệ.');
        const result=p.output==='command'?pwCommand:pwEffective;
        const rounded=Math.round(result*1000)/1000;
        effectiveRow.push(pwEffective);commandRow.push(pwCommand);outRow.push(rounded);
        candidate[r][c]=rounded;updated++;
        min=Math.min(min,rounded);max=Math.max(max,rounded);
        maxDuty=Math.max(maxDuty,duty);
        if(duty>80)aboveDuty++;
      }
      effective.push(effectiveRow);command.push(commandRow);output.push(outRow);
      airMassMg.push(mgRow);veGrid.push(veRow);
    }
    if(!updated)throw new Error('Không có ô RPM nào trong phạm vi tính.');
    return {params:p,cc:displacement,rho,flow,injectorMgPerMs,lambda,actualE10Afr,
      effective,command,output,airMassMg,veGrid,candidate,updated,min,max,maxDuty,aboveDuty,maxVe,extrapolated,usedCalibrations};
  }
  root.BlinkFuelModelMath=Object.freeze({calculate,validate,inferVe,baseVe,interpolate:interp,referenceMs:photoRegionalMs,referenceTps:PHOTO_TPS.slice(),referenceRpmMin:PHOTO_RPM_MIN,referenceRpmMax:PHOTO_RPM_MAX,defaults:Object.freeze(Object.assign({},DEFAULTS))});

  const doc=root.document,nav=root.navigator||{},ua=String(nav.userAgent||'');
  const isIOS=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&Number(nav.maxTouchPoints)>1);
  const isBluefy=/Bluefy/i.test(ua);
  if((isIOS&&!isBluefy)||!doc||!doc.getElementById('mapEditorScreen')||!root.blinkFuelModelBridge)return;

  const bridge=root.blinkFuelModelBridge;
  const bar=doc.querySelector('#fuelAnchorBar .fuelAnchorActions');
  if(!bar)return;
  const launcher=doc.createElement('button');
  launcher.id='fuelModelCalcBtn';launcher.type='button';launcher.textContent='ƒx TÍNH MAP NỀN';
  launcher.title='Chọn MAP mẫu hoặc chế độ Triumph khối lượng khí/VE 2D, AFR mong muốn; không tự ghi ECU';
  bar.appendChild(launcher);
  const css=doc.createElement('style');
  css.textContent=[
    '#fuelModelCalcBtn{grid-column:1/-1!important;background:#13392c!important;border-color:#268e67!important;color:#b7ffdc!important;font-size:11px!important}',
    '#fuelModelDialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(96vw,950px);max-width:950px;max-height:94dvh;overflow:auto;padding:0;border:1px solid #337459;border-radius:14px;background:#101419;color:#eff8f2;z-index:999999;font:13px system-ui,-apple-system,sans-serif;box-shadow:0 18px 65px #000b}',
    '#fuelModelDialog::backdrop{background:rgba(0,0,0,.78)}',
    '#fuelModelDialog .fmc-head{position:sticky;top:0;z-index:3;background:#15251d;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #35684e}',
    '#fuelModelDialog h3{margin:0;font-size:17px;color:#a8ffca}',
    '#fuelModelDialog .fmc-close{width:34px;height:34px;flex-shrink:0}',
    '#fuelModelDialog .fmc-body{padding:12px;display:grid;gap:10px}',
    '#fuelModelDialog .fmc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    '#fuelModelDialog label{display:grid;gap:4px;min-width:0;font-size:11px;font-weight:700;color:#bacac5}',
    '#fuelModelDialog input[type=text],#fuelModelDialog select{width:100%;box-sizing:border-box;min-height:38px;padding:7px 9px;border-radius:8px;border:1px solid #416158;background:#090e10;color:#fff;font-size:15px}',
    '#fuelModelDialog input[type=text]:focus{outline:2px solid #53e6a6}',
    '#fuelModelDialog .fmc-important{border:1px solid #48af83;border-radius:10px;padding:9px;background:#102b20}',
    '#fuelModelDialog .fmc-important label{color:#a8ffca;font-size:12px}',
    '#fuelModelDialog .fmc-help{font-size:11px;color:#b9bab8;line-height:1.5}',
    '#fuelModelDialog .fmc-actions{display:flex;gap:7px;flex-wrap:wrap}',
    '#fuelModelDialog button{border-radius:9px;min-height:38px;padding:7px 11px;background:#26343a;color:#fff;border:1px solid #50615f;font-weight:800;font-size:12px;touch-action:manipulation}',
    '#fuelModelDialog button.fmc-primary{background:#176b47;border-color:#32b779}',
    '#fuelModelDialog button.fmc-danger{background:#6b3730;border-color:#df8e74}',
    '#fuelModelDialog button:disabled{opacity:.42;cursor:not-allowed}',
    '#fuelModelDialog .fmc-pad{display:none;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;padding:9px;border:1px solid #385f51;border-radius:10px;background:#192321}',
    '#fuelModelDialog .fmc-pad.show{display:grid}',
    '#fuelModelDialog .fmc-pad .fmc-pad-title{grid-column:1/-1;color:#b9f5da;font-size:11px}',
    '#fuelModelDialog .fmc-pad button{font-size:16px;min-height:39px}',
    '#fuelModelDialog .fmc-result{font-variant-numeric:tabular-nums;line-height:1.6;white-space:pre-line;background:#17212a;border:1px solid #42556c;border-radius:9px;padding:9px}',
    '#fuelModelDialog .fmc-tablebox{max-height:270px;max-width:100%;overflow:auto;border:1px solid #394744;border-radius:8px}',
    '#fuelModelDialog .fmc-preview{border-collapse:collapse;width:max-content;font-size:11px;min-width:100%}',
    '#fuelModelDialog .fmc-preview th,#fuelModelDialog .fmc-preview td{padding:5px 7px;text-align:center;border:1px solid #2a3d39;min-width:48px;white-space:nowrap}',
    '#fuelModelDialog .fmc-preview th{background:#235e83;color:#fff;position:sticky;top:0}',
    '#fuelModelDialog .fmc-preview .fmc-rowhead{background:#235e83;color:#fff;position:sticky;left:0}',
    '#fuelModelDialog .fmc-preview td.fmc-active{background:#1d5942;color:#dbffe9}',
    '#fuelModelDialog .fmc-preview td.fmc-skip{background:#14181e;color:#76847c}',
    '#fuelModelDialog .fmc-preview td.fmc-cal{background:#174e74!important;color:#f3ffff!important;font-weight:900}',
    '#fuelModelDialog .fmc-air-panel{border:1px solid #3b7290;border-radius:10px;padding:10px;display:grid;gap:8px;background:#10202b}',
    '#fuelModelDialog .fmc-air-panel h4{margin:0;font-size:13px;color:#97defe}',
    '#fuelModelDialog [hidden]{display:none!important}',
    '#fuelModelDialog .fmc-ack{display:flex;align-items:flex-start;gap:7px;font-weight:500;font-size:11px}',
    '#fuelModelDialog .fmc-ack input{margin-top:2px;flex-shrink:0}',
    '@media(max-width:560px){#fuelModelDialog .fmc-head{padding:8px}#fuelModelDialog .fmc-body{padding:8px;gap:8px}#fuelModelDialog .fmc-grid{gap:6px}#fuelModelDialog .fmc-grid label{font-size:10px}#fuelModelDialog h3{font-size:15px}}'
  ].join('\n');
  doc.head.appendChild(css);
  const dlg=doc.createElement('dialog');dlg.id='fuelModelDialog';
  const fields=[
    ['bore','Piston (mm)'],['stroke','Hành trình dên (mm)'],
    ['throttle','Họng ga (mm)'],['flow','Kim phun (cc/phút)'],
    ['ratedBar','Áp chuẩn kim (bar)'],['pressure','Chênh áp thực qua kim (bar)'],
    ['iat','Nhiệt độ khí nạp (°C)'],['baroKpa','Áp suất khí quyển (kPa)'],['maxRpm','Giới hạn tính (RPM)'],
    ['peakVe','VE quy chiếu WOT / 6500 (%)'],['shapePct','Độ bám dáng map mẫu (%)'],['deadtime','Deadtime kim (ms)']
  ];
  function numericField(key,label){
    return '<label>'+label+'<input id="fmc'+key.charAt(0).toUpperCase()+key.slice(1)+'" type="text" readonly inputmode="none" data-fmc-field="'+key+'" aria-label="'+label+'"></label>';
  }
  dlg.innerHTML=[
    '<div class="fmc-head"><h3>TÍNH MAP PHUN NỀN · AFR MONG MUỐN</h3><button type="button" class="fmc-close" id="fmcClose">✕</button></div>',
    '<div class="fmc-body">',
    '<div class="fmc-important"><label>CHỌN THUẬT TOÁN<select data-fmc-option="model" id="fmcModel"><option value="regional">MAP MẪU 2D (GIỮ NGUYÊN)</option><option value="airmass">TRIUMPH THỬ NGHIỆM · MG KHÍ → AFR → MS</option></select></label></div>',
    '<div class="fmc-important">'+numericField('afr','AFR MONG MUỐN (BẮT BUỘC)')+
    '<label style="margin-top:7px">Thang AFR<select data-fmc-option="afrScale"><option value="gauge">AFR đồng hồ xăng · 14,7</option><option value="e10">AFR thực E10 · 14,1</option></select></label></div>',
    '<div class="fmc-grid">'+fields.map(x=>numericField(x[0],x[1])).join('')+'</div>',
    '<div class="fmc-grid">',
    '<label>Số lần phun / 720°<select data-fmc-option="pulses"><option value="1">1 xung / chu kỳ</option><option value="2">2 xung / chu kỳ</option></select></label>',
    '<label>Đơn vị map tạo ra<select data-fmc-option="output"><option value="command">ms lệnh (cộng deadtime)</option><option value="effective">ms hữu hiệu (chưa cộng)</option></select></label>',
    '<label>Phạm vi áp dụng<select data-fmc-option="scope"><option value="full">Toàn bộ TPS đến RPM giới hạn</option><option value="selected">Chỉ vùng đang chọn trên map</option></select></label>',
    '<label>Nhiên liệu<select disabled><option>E10 · AFR stoich 14,1</option></select></label></div>',
    '<div class="fmc-help" id="fmcRegionalHelp">Bộ tính lấy hình dáng 14 hàng TPS × 19 cột RPM trong ẢNH MAP bạn gửi làm mẫu tương đối: vùng thấp 500–2000, vùng trũng khoảng 3500–4500, vùng đỉnh 6000–7500 và giảm sau đó. Nội suy hai chiều giữa các hàng TPS, KHÔNG sao chép số ms của ECU mẫu. VE quy chiếu tại 100% TPS / 6500 RPM. Độ bám dáng 0%=công thức cũ, 100%=theo ảnh. Các điểm trên 9500 RPM chỉ ngoại suy. Họng ga 32 mm chỉ là thông tin tham khảo, KHÔNG thể suy lưu lượng khí chính xác từ đường kính. Áp suất phải là chênh áp qua kim, không mặc định bằng áp đường rail. Kim được giả định định mức tại áp chuẩn nhập ở trên, E10 có khối lượng riêng giả định 0,75 g/cc. Độ trễ kim và số xung/chu kỳ chưa được xác minh với ECU.</div>',
    '<div class="fmc-help" id="fmcTriumphHelp" hidden>TRIUMPH PHONG CÁCH TÍNH: VE 2D (ước lượng) → KHỐI LƯỢNG KHÍ mg/chu kỳ → LƯỢNG XĂNG theo AFR mong muốn → THỜI GIAN KIM ms. Vẫn là mô hình Alpha-N TPS × RPM, không phải bảng F/L thật của Triumph và chưa dùng chuyển bảng MAP. Các ô VE được hiệu chỉnh thủ công từ AFR đo ổn định sẽ được giữ riêng theo MAP No. và đúng bộ thông số động cơ. KHÔNG tự học AFR khi tăng tốc, KHÔNG bù tăng tốc hoặc nhiệt độ động cơ vào map nền. Chênh áp kim, deadtime, số xung và đặc tính phun thực tế phải xác nhận trước khi sử dụng.</div>',
    '<section class="fmc-air-panel" id="fmcAirPanel" hidden>',
    '<h4>HIỆU CHỈNH VE TỪ AFR ĐO · CHỈ MỘT Ô TPS × RPM</h4>',
    '<div class="fmc-help" id="fmcCalStatus">Chọn một ô trên MAP INJ VE, rồi mở bộ tính lại để hiệu chỉnh.</div>',
    '<div class="fmc-grid">'+numericField('calAfr','AFR ĐO ỔN ĐỊNH (CÙNG THANG Ở TRÊN)')+numericField('calPw','PW TỔNG ĐANG CHẠY (ms)')+'</div>',
    '<div class="fmc-help">Giá trị PW được gợi ý từ ô MAP đang đọc; nếu ECU có bù ECT/IAT/MAP/điện áp hoặc chế độ điều khiển O2, phải nhập PW thực tế đã xác minh. Chỉ dùng AFR đo ở trạng thái ga/tải ổn định, không dùng AFR tăng tốc hoặc cảm biến đang trễ. Hiệu chỉnh một ô riêng lẻ, không lan sang các ô lân cận.</div>',
    '<label class="fmc-ack"><input id="fmcCalConfirm" type="checkbox">AFR và PW đã đo ổn định đúng ô, tôi đã kiểm tra áp suất kim/deadtime, không dùng giá trị lúc mở ga đột ngột.</label>',
    '<div class="fmc-actions"><button type="button" class="fmc-primary" id="fmcCalSave">LƯU VE Ô NÀY (TRONG BLINK)</button><button type="button" id="fmcCalRemove">XÓA VE Ô NÀY</button><button type="button" class="fmc-danger" id="fmcCalReset">XÓA VE MAP</button></div>',
    '</section>',
    '<div id="fmcPad" class="fmc-pad" aria-hidden="true"><span class="fmc-pad-title" id="fmcPadTitle">Chọn ô để nhập</span>',
    ['1','2','3','C','4','5','6','⌫','7','8','9','.','−','0','XONG'].map(k=>'<button type="button" data-fmc-key="'+k+'">'+k+'</button>').join(''),
    '</div>',
    '<div class="fmc-actions"><button type="button" class="fmc-primary" id="fmcPreview">TÍNH & XEM TRƯỚC</button><button type="button" id="fmcClose2">ĐÓNG</button></div>',
    '<div class="fmc-result" id="fmcResult" role="status" aria-live="polite">Chưa tính. AFR mong muốn luôn do bạn nhập, không lấy từ Auto Tune.</div>',
    '<div class="fmc-grid"><label>LOẠI BẢNG XEM TRƯỚC<select id="fmcView"><option value="pw">THỜI GIAN PHUN ms</option><option value="mg">KHỐI LƯỢNG KHÍ mg/chu kỳ</option><option value="ve">VE %</option></select></label></div>',
    '<div class="fmc-tablebox" id="fmcTableBox" hidden><table class="fmc-preview" id="fmcTable"></table></div>',
    '<label class="fmc-ack"><input type="checkbox" id="fmcAck">Tôi hiểu đây là ước tính khối lượng khí/VE, KHÔNG phải đo VE thực; đã xác minh cơ chế PW của ECU và sẽ kiểm tra AFR trên tải thực trước khi sử dụng.</label>',
    '<div class="fmc-actions"><button type="button" class="fmc-danger" id="fmcApply" disabled>ÁP DỤNG CỤC BỘ · KHÔNG GHI ECU</button></div>',
    '<div class="fmc-help">Chỉ thay các ô trong vùng tính, các cột RPM cao hơn giới hạn luôn giữ nguyên. Để áp dụng cần MAP hiện tại đủ 420 ô hợp lệ; nếu đang toàn 0, hãy ĐỌC HIỆN TẠI từ ECU. Không chạm lệnh GHI ECU.</div>',
    '</div>'
  ].join('');
  doc.body.appendChild(dlg);
  const el=(id)=>doc.getElementById(id);
  let preview=null,baseline=null,activeField=null;
  function readStored(){
    try{const x=JSON.parse(root.localStorage.getItem('blinkFuelModelSettingsV1')||'null');return x&&typeof x==='object'?x:null;}catch(_e){return null;}
  }
  const stored=Object.assign({},DEFAULTS,readStored()||{});
  function setFields(cfg){
    dlg.querySelectorAll('[data-fmc-field]').forEach(input=>{input.value=String(cfg[input.dataset.fmcField]??'');});
    dlg.querySelectorAll('[data-fmc-option]').forEach(input=>{input.value=String(cfg[input.dataset.fmcOption]??'');});
  }
  setFields(stored);
  function readFields(){
    const p={};
    dlg.querySelectorAll('[data-fmc-field]').forEach(input=>{if(!input.dataset.fmcField.startsWith('cal'))p[input.dataset.fmcField]=input.value;});
    dlg.querySelectorAll('[data-fmc-option]').forEach(input=>{p[input.dataset.fmcOption]=input.value;});
    return p;
  }
  function invalidate(){
    preview=null;el('fmcApply').disabled=true;el('fmcAck').checked=false;el('fmcTableBox').hidden=true;
    el('fmcResult').textContent='Đã sửa thông số. Bấm TÍNH & XEM TRƯỚC để cập nhật.';
    const mode=el('fmcModel')?.value==='airmass';
    el('fmcAirPanel').hidden=!mode;
    el('fmcRegionalHelp').hidden=mode;
    el('fmcTriumphHelp').hidden=!mode;
    if(mode)syncCalUI();
  }
  function showKeypad(input){
    activeField=input;el('fmcPad').classList.add('show');el('fmcPad').setAttribute('aria-hidden','false');
    el('fmcPadTitle').textContent=input.getAttribute('aria-label')||'Đang nhập';
    try{input.focus({preventScroll:true})}catch(_e){}
  }
  dlg.querySelectorAll('[data-fmc-field]').forEach(input=>{
    input.addEventListener('click',()=>showKeypad(input));
    input.addEventListener('focus',()=>showKeypad(input));
  });
  dlg.querySelectorAll('[data-fmc-option]').forEach(input=>input.addEventListener('change',invalidate));
  el('fmcView').addEventListener('change',()=>{if(preview)renderPreview(preview.out,preview.snap,preview.anchors);});
  dlg.querySelectorAll('[data-fmc-key]').forEach(key=>key.addEventListener('click',()=>{
    if(!activeField)return;
    const k=key.dataset.fmcKey;
    if(k==='XONG'){el('fmcPad').classList.remove('show');el('fmcPad').setAttribute('aria-hidden','true');return;}
    const s=activeField.value;
    if(k==='C')activeField.value='';
    else if(k==='⌫')activeField.value=s.slice(0,-1);
    else if(k==='−')activeField.value=s.startsWith('-')?s.slice(1):'-'+s;
    else if(k==='.') {if(!s.includes('.'))activeField.value=(s||'0')+'.';}
    else if(s.length<12)activeField.value=s+k;
    if(activeField.dataset.fmcField.startsWith('cal')){
      el('fmcCalConfirm').checked=false;
    }else invalidate();
  }));
  function msg(x){el('fmcResult').textContent=String(x);}

  const CAL_STORE_KEY='blinkFuelAirVeAnchorsV1';
  function calStorage(){
    try{const v=JSON.parse(root.localStorage.getItem(CAL_STORE_KEY)||'{}');return v&&typeof v==='object'&&v.banks&&typeof v.banks==='object'?v:{banks:{}};}
    catch(_e){return {banks:{}};}
  }
  function calSignature(p,snap){
    // Never re-use inferred VE after injector, ambient or axis changes.
    // AFR target/shape model are deliberately excluded: VE is air/fuel-independent.
    return JSON.stringify({rpms:snap.rpms,tps:snap.tps,
      engine:[p.bore,p.stroke,p.throttle,p.flow,p.ratedBar,p.pressure,p.iat,p.baroKpa,p.deadtime,p.pulses,p.output]});
  }
  function calStatus(p,snap){
    const db=calStorage(),item=db.banks[String(snap.bank)],signature=calSignature(p,snap);
    if(!item)return {db,signature,anchors:[],stale:false};
    if(item.signature!==signature)return {db,signature,anchors:[],stale:true};
    const anchors=Array.isArray(item.anchors)?item.anchors.filter(x=>Number.isInteger(x.r)&&
      Number.isInteger(x.c)&&Number.isFinite(x.ve)&&x.ve>=.03&&x.ve<=1.3):[];
    return {db,signature,anchors,stale:false};
  }
  function calSnapshotChanged(snap){
    if(!baseline||baseline.bank!==snap.bank||
      JSON.stringify(baseline.rpms)!==JSON.stringify(snap.rpms)||
      JSON.stringify(baseline.tps)!==JSON.stringify(snap.tps)||
      !Array.isArray(snap.map)||!Array.isArray(baseline.map))return true;
    for(let r=0;r<snap.map.length;r++){
      if(!Array.isArray(snap.map[r])||!Array.isArray(baseline.map[r])||
        snap.map[r].length!==baseline.map[r].length)return true;
      for(let c=0;c<snap.map[r].length;c++){
        if(!Object.is(snap.map[r][c],baseline.map[r][c]))return true;
      }
    }
    return false;
  }
  function currentSingle(snap){
    const s=snap?.selection;
    return s&&s.r0===s.r1&&s.c0===s.c1&&s.r0>=0&&s.c0>=0&&s.r0<snap.tps.length&&s.c0<snap.rpms.length
      ?{r:s.r0,c:s.c0,tps:String(snap.tps[s.r0]).toUpperCase()==='IDLE'?0:Number(snap.tps[s.r0]),rpm:snap.rpms[s.c0]}:null;
  }
  function syncCalUI(){
    if(el('fmcModel')?.value!=='airmass')return;
    try{
      const snap=bridge.snapshot(),p=validate(readFields()),one=currentSingle(snap),cal=calStatus(p,snap);
      const changed=calSnapshotChanged(snap);
      const info=changed?'DỮ LIỆU MAP ĐÃ THAY ĐỔI: đóng và mở lại bộ tính trước khi hiệu chỉnh.':(cal.stale?'Dữ liệu VE cũ không dùng vì trục TPS/RPM hoặc thông số động cơ đã thay đổi.':'Đã khóa '+cal.anchors.length+' ô VE cho MAP No.'+snap.bank+'.');
      const selected=one?'Ô '+one.tps+'% TPS / '+one.rpm+' RPM':'CHƯA CHỌN 1 Ô trên map INJ VE';
      const anchor=one&&cal.anchors.find(x=>x.r===one.r&&x.c===one.c);
      el('fmcCalStatus').textContent=selected+' · '+info+(anchor?' · VE đã lưu '+(anchor.ve*100).toFixed(1)+'%':'');
      el('fmcCalSave').disabled=!one||!snap.baselineValid||snap.unknown||snap.busy||changed;
      el('fmcCalRemove').disabled=!anchor||snap.busy||changed;
      if(one&&el('fmcCalPw').value==='')el('fmcCalPw').value=Number(snap.map[one.r][one.c]).toFixed(3);
    }catch(e){el('fmcCalStatus').textContent='Chưa sẵn sàng: '+String(e?.message||e);}
  }
  function changeCal(mode){
    try{
      const snap=bridge.snapshot();
      if(!snap.active||snap.busy||!snap.baselineValid||snap.unknown)throw new Error('Cần MAP ECU hợp lệ, không đang ghi/đọc.');
      if(calSnapshotChanged(snap))throw new Error('MAP/trục hoặc dữ liệu gốc đã đổi. Đóng và mở lại bộ tính trước khi lưu VE.');
      const p=validate(readFields());
      if(p.model!=='airmass')throw new Error('Chỉ dùng với chế độ Triumph – mg khí.');
      const one=currentSingle(snap);
      const entry=calStatus(p,snap);
      if(mode!=='reset'&&!one)throw new Error('Hãy chọn đúng một ô MAP INJ VE trước khi mở bộ tính.');
      if(mode==='save'){
        if(!el('fmcCalConfirm').checked)throw new Error('Phải xác nhận AFR và PW đo ổn định.');
        const result=inferVe(p,{tps:one.tps,rpm:one.rpm,afr:el('fmcCalAfr').value,pw:el('fmcCalPw').value});
        const arr=entry.anchors.filter(x=>!(x.r===one.r&&x.c===one.c));
        arr.push({r:one.r,c:one.c,ve:result.ve});
        entry.db.banks[String(snap.bank)]={signature:entry.signature,anchors:arr};
        if(!saveCalStorage(entry.db))throw new Error('Không thể lưu VE lên thiết bị.');
        el('fmcCalConfirm').checked=false;
        invalidate();syncCalUI();
        msg('Đã lưu VE ô '+one.tps+'% / '+one.rpm+' RPM = '+result.vePct.toFixed(1)+'%, dựa trên AFR đo '+result.afr+
          ' và PW '+result.pw.toFixed(3)+' ms. Sai khác '+result.departurePct.toFixed(1)+
          '% so với VE nền. Chỉ lưu trong Blink, CHƯA thay bảng INJ VE và CHƯA ghi ECU. Bấm TÍNH & XEM TRƯỚC.');
        return;
      }
      if(mode==='remove'){
        const arr=entry.anchors.filter(x=>!(x.r===one.r&&x.c===one.c));
        entry.db.banks[String(snap.bank)]={signature:entry.signature,anchors:arr};
        if(!saveCalStorage(entry.db))throw new Error('Không thể xóa VE lên bộ nhớ.');
        invalidate();syncCalUI();msg('Đã bỏ hiệu chỉnh VE một ô trên Blink, chưa ghi ECU.');return;
      }
      if(mode==='reset'){
        if(el('fmcCalReset').dataset.armed!=='yes'){
          el('fmcCalReset').dataset.armed='yes';
          el('fmcCalReset').textContent='NHẤN LẦN NỮA ĐỂ XÓA';
          return;
        }
        el('fmcCalReset').dataset.armed='no';
        el('fmcCalReset').textContent='XÓA VE MAP';
        delete entry.db.banks[String(snap.bank)];
        if(!saveCalStorage(entry.db))throw new Error('Không thể lưu thao tác xóa.');
        invalidate();syncCalUI();msg('Đã xóa hiệu chỉnh VE MAP No.'+snap.bank+' trên Blink, không thay MAP ECU.');
      }
    }catch(e){el('fmcCalStatus').textContent='LỖI HIỆU CHỈNH: '+String(e?.message||e);}
  }
  function saveCalStorage(db){
    try{root.localStorage.setItem(CAL_STORE_KEY,JSON.stringify(db));return true;}catch(_e){return false;}
  }
  function renderPreview(out,snap,anchors){
    const mode=el('fmcView').value;
    const matrix=mode==='mg'?out.airMassMg:mode==='ve'?out.veGrid:out.output;
    const locked=new Set((anchors||[]).map(a=>a.r+':'+a.c));
    const visible=snap.rpms.map((rpm,c)=>({rpm,c})).filter(x=>x.rpm<=out.params.maxRpm);
    const h=['<thead><tr><th class="fmc-rowhead">TPS</th>'];
    for(const x of visible)h.push('<th>'+x.rpm+'</th>');
    h.push('</tr></thead><tbody>');
    for(let r=0;r<snap.tps.length;r++){
      h.push('<tr><th class="fmc-rowhead">'+String(snap.tps[r])+(String(snap.tps[r]).toUpperCase()==='IDLE'?'':'%')+'</th>');
      for(const x of visible){
        const v=matrix[r][x.c],yes=v!==null;
        const css=''+(yes?(locked.has(r+':'+x.c)?'fmc-cal':'fmc-active'):'fmc-skip');
        h.push('<td class="'+css+'">'+(yes?Number(v).toFixed(2):'—')+'</td>');
      }
      h.push('</tr>');
    }
    h.push('</tbody>');
    el('fmcTable').innerHTML=h.join('');
    el('fmcTableBox').hidden=false;
  }
  function doPreview(){
    try{
      const snap=bridge.snapshot();
      if(!snap.active)throw new Error('Chức năng chỉ mở trong DỮ LIỆU → THỜI GIAN PHUN.');
      if(snap.busy)throw new Error('Đang chọn ô neo / ghi hoặc đọc ECU. Hãy kết thúc tác vụ trước.');
      const p=validate(readFields());
      const calibration=p.model==='airmass'?calStatus(p,snap):{anchors:[],stale:false};
      const out=calculate(p,{rpms:snap.rpms,tps:snap.tps},snap.map,snap.selection,calibration.anchors);
      preview={snap,out,anchors:calibration.anchors};
      el('fmcAck').checked=false;
      const canApply=snap.baselineValid&&!snap.unknown;
      el('fmcApply').disabled=!canApply;
      renderPreview(out,snap,calibration.anchors);
      if(p.model==='airmass')syncCalUI();
      msg('MAP NO.'+snap.bank+' · '+out.cc.toFixed(2)+' cc · kim '+out.flow.toFixed(1)+' cc/phút @ '+out.params.pressure+' bar\n'+
        'AFR mong muốn: '+out.params.afr+' ('+(out.params.afrScale==='gauge'?'đồng hồ 14,7':'E10 thực 14,1')+') · Lambda '+out.lambda.toFixed(3)+' · AFR E10 thực '+out.actualE10Afr.toFixed(2)+'\n'+
        'Tạo '+out.updated+' ô; '+out.min.toFixed(2)+'–'+out.max.toFixed(2)+' ms; duty lớn nhất '+out.maxDuty.toFixed(1)+'%'+(out.aboveDuty?' · '+out.aboveDuty+' ô duty trên 80%':'')+'\n'+
        (p.model==='airmass'?'TRIUMPH THỬ NGHIỆM: tính mg khí trước, sử dụng '+out.usedCalibrations+' ô VE đã đo'+(calibration.stale?' (BẢN VE CŨ BỊ BỎ QUA DO KHÁC THÔNG SỐ)':''):'MAP MẪU 2D: giữ thuật toán 3.79.129')+' · VE lớn nhất ước tính '+(out.maxVe*100).toFixed(1)+'%'+(out.extrapolated?' · '+out.extrapolated+' ô trên 9500 RPM là ngoại suy':'')+'\n'+
        'RPM > '+out.params.maxRpm+' giữ nguyên MAP cũ. VE chưa đo tại các ô chưa hiệu chỉnh; KHÔNG dùng tăng ga đột ngột để học VE. Chưa mô phỏng F/L, MAP chân không hoặc bù tăng tốc/ECT.\n'+
        (canApply?'Có thể áp dụng vào Blink CỤC BỘ sau khi xác nhận. Không tự ghi ECU.':'CHƯA THỂ ÁP DỤNG: MAP cũ chưa đủ 420 ô hợp lệ hoặc trạng thái chưa đồng bộ. Hãy ĐỌC HIỆN TẠI từ ECU.'));
      try{root.localStorage.setItem('blinkFuelModelSettingsV1',JSON.stringify(out.params));}catch(_e){}
    }catch(e){
      preview=null;el('fmcApply').disabled=true;el('fmcAck').checked=false;el('fmcTableBox').hidden=true;
      msg('KHÔNG TÍNH ĐƯỢC: '+String(e&&e.message||e));
    }
  }
  function doApply(){
    try{
      if(!preview)throw new Error('Chưa có kết quả xem trước hợp lệ.');
      if(!el('fmcAck').checked)throw new Error('Hãy xác nhận đã hiểu giới hạn của map mô hình.');
      if(preview.out.aboveDuty)throw new Error('Có ô duty trên 80%. Hãy kiểm tra kích cỡ kim, VE và số lần phun trước khi áp dụng.');
      const c=preview,ret=bridge.applyLocal(c.out.candidate,{
        bank:c.snap.bank,baseline:c.snap.map,rpms:c.snap.rpms,tps:c.snap.tps,
        maxRpm:c.out.params.maxRpm,scope:c.out.params.scope,selection:c.snap.selection
      });
      msg('ĐÃ ÁP DỤNG CỤC BỘ MAP NO.'+ret.bank+' · '+c.out.updated+' ô. Chưa ghi ECU. Bạn có thể xem lại map và tự bấm LƯU HIỆN TẠI sau khi kiểm tra.');
      el('fmcApply').disabled=true;preview=null;el('fmcAck').checked=false;
    }catch(e){msg('KHÔNG ÁP DỤNG: '+String(e&&e.message||e));}
  }
  function closeDialog(){el('fmcPad').classList.remove('show');el('fmcPad').setAttribute('aria-hidden','true');dlg.close();}
  launcher.addEventListener('click',()=>{
    const snap=bridge.snapshot();
    if(!snap.active||snap.busy){bridge.notice('info','MAP ĐANG BẬN','Hãy vào Thời gian phun và hoàn tất thao tác hiện tại.');return;}
    preview=null;baseline=snap;el('fmcAck').checked=false;el('fmcApply').disabled=true;el('fmcTableBox').hidden=true;
    el('fmcCalAfr').value='';el('fmcCalPw').value='';el('fmcCalConfirm').checked=false;
    el('fmcCalReset').dataset.armed='no';el('fmcCalReset').textContent='XÓA VE MAP';
    const isAir=el('fmcModel').value==='airmass';
    el('fmcAirPanel').hidden=!isAir;el('fmcTriumphHelp').hidden=!isAir;el('fmcRegionalHelp').hidden=isAir;
    if(isAir)syncCalUI();
    msg('MAP NO.'+snap.bank+' · AFR mong muốn do bạn nhập. Tính thử không thay đổi dữ liệu ECU. Trên 9.000 RPM sẽ giữ nguyên nếu giới hạn đang là 9.000.');
    dlg.showModal();
  });
  el('fmcPreview').addEventListener('click',doPreview);
  el('fmcCalSave').addEventListener('click',()=>changeCal('save'));
  el('fmcCalRemove').addEventListener('click',()=>changeCal('remove'));
  el('fmcCalReset').addEventListener('click',()=>changeCal('reset'));
  el('fmcApply').addEventListener('click',doApply);
  el('fmcClose').addEventListener('click',closeDialog);
  el('fmcClose2').addEventListener('click',closeDialog);
  root.BlinkFuelModelUi={preview:doPreview,math:root.BlinkFuelModelMath};
})(window);

/* Blink Redleo | Fuel base map calculator | WEB/ANDROID ONLY | PB3.79.128 */
(function(root){
  'use strict';
  const RPM_VE=[[500,.54],[1500,.61],[3000,.75],[4500,.85],[6000,.92],[6500,.94],[7500,.90],[9000,.82],[11000,.72],[15000,.60]];
  const TPS_FILL=[[0,.16],[2,.19],[5,.25],[8,.31],[14,.43],[20,.55],[30,.68],[40,.78],[50,.85],[60,.90],[70,.94],[80,.97],[90,.99],[100,1]];
  const DEFAULTS={bore:72,stroke:72,throttle:32,flow:300,ratedBar:3,pressure:3.5,
    afr:13,afrScale:'gauge',iat:30,maxRpm:9000,peakVe:94,deadtime:.9,
    pulses:'1',output:'command',scope:'full'};
  const specs={bore:[30,125],stroke:[30,140],throttle:[15,75],flow:[50,2000],
    ratedBar:[1,7],pressure:[1,7],afr:[9,18],iat:[-20,100],maxRpm:[500,30000],
    peakVe:[35,130],deadtime:[0,4]};
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
    if(!['1','2'].includes(String(p.pulses)))throw new Error('Số lần phun/720° không hợp lệ.');
    p.pulses=Number(p.pulses);
    if(!['command','effective'].includes(p.output))throw new Error('Kiểu thời gian phun không hợp lệ.');
    if(!['full','selected'].includes(p.scope))throw new Error('Vùng tính không hợp lệ.');
    return p;
  }
  function calculate(raw,axes,baseline,selected){
    const p=validate(raw);
    if(!axes||!Array.isArray(axes.rpms)||!Array.isArray(axes.tps)||
       !axes.rpms.length||!axes.tps.length)throw new Error('Không có trục TPS/RPM hợp lệ.');
    if(!Array.isArray(baseline)||baseline.length!==axes.tps.length||
       baseline.some(row=>!Array.isArray(row)||row.length!==axes.rpms.length))
      throw new Error('MAP nền không khớp trục ECU.');
    if(p.scope==='selected'&&(!selected||![selected.r0,selected.r1,selected.c0,selected.c1].every(Number.isInteger)))
      throw new Error('Hãy chọn vùng TPS × RPM trên MAP trước.');
    const rho=101325/(287.05*(273.15+p.iat)); // kg/m3; numerical mg/cc
    const displacement=Math.PI*p.bore*p.bore*p.stroke/4000; // cc
    // 300 cc/min at rated pressure -> at operating injector differential pressure.
    const flow=p.flow*Math.sqrt(p.pressure/p.ratedBar);
    const injectorMgPerMs=flow/60*.75; // E10 fuel density assumption: 0.75 g/cc
    const lambda=p.afr/(p.afrScale==='gauge'?14.7:14.1);
    const actualE10Afr=14.1*lambda;
    const effective=[];
    const command=[];
    const output=[];
    const candidate=baseline.map(row=>row.slice());
    let updated=0,min=Infinity,max=-Infinity,maxDuty=0,aboveDuty=0;
    for(let r=0;r<axes.tps.length;r++){
      const effectiveRow=[],commandRow=[],outRow=[];
      const rowLabel=axes.tps[r];
      const tps=String(rowLabel).toUpperCase()==='IDLE'?0:valueNum(rowLabel);
      if(!Number.isFinite(tps)||tps<0||tps>100)throw new Error('Trục TPS không hợp lệ ở hàng '+(r+1));
      const fill=interp(TPS_FILL,tps);
      for(let c=0;c<axes.rpms.length;c++){
        const rpm=Number(axes.rpms[c]);
        if(!Number.isFinite(rpm)||rpm<=0)throw new Error('Trục RPM không hợp lệ ở cột '+(c+1));
        const included=rpm<=p.maxRpm && (p.scope==='full'||(r>=selected.r0&&r<=selected.r1&&c>=selected.c0&&c<=selected.c1));
        if(!included){effectiveRow.push(null);commandRow.push(null);outRow.push(null);continue;}
        const ve=interp(RPM_VE,rpm)*(p.peakVe/94)*fill; // simplified Alpha-N assumption
        const airMg=displacement*rho*ve;
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
    }
    if(!updated)throw new Error('Không có ô RPM nào trong phạm vi tính.');
    return {params:p,cc:displacement,rho,flow,injectorMgPerMs,lambda,actualE10Afr,
      effective,command,output,candidate,updated,min,max,maxDuty,aboveDuty};
  }
  root.BlinkFuelModelMath=Object.freeze({calculate,validate,interpolate:interp,defaults:Object.freeze(Object.assign({},DEFAULTS))});

  const doc=root.document,nav=root.navigator||{},ua=String(nav.userAgent||'');
  const isIOS=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&Number(nav.maxTouchPoints)>1);
  if(isIOS||!doc||!doc.getElementById('mapEditorScreen')||!root.blinkFuelModelBridge)return;

  const bridge=root.blinkFuelModelBridge;
  const bar=doc.querySelector('#fuelAnchorBar .fuelAnchorActions');
  if(!bar)return;
  const launcher=doc.createElement('button');
  launcher.id='fuelModelCalcBtn';launcher.type='button';launcher.textContent='ƒx TÍNH MAP NỀN';
  launcher.title='Tính theo động cơ, VE giả định và AFR mong muốn; chỉ áp dụng cục bộ';
  bar.appendChild(launcher);
  const css=doc.createElement('style');
  css.textContent=[
    '#fuelModelCalcBtn{background:#13392c!important;border-color:#268e67!important;color:#b7ffdc!important}',
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
    ['iat','Nhiệt độ khí nạp (°C)'],['maxRpm','Giới hạn tính (RPM)'],
    ['peakVe','VE đỉnh giả định (%)'],['deadtime','Deadtime kim (ms)']
  ];
  function numericField(key,label){
    return '<label>'+label+'<input type="text" readonly inputmode="none" data-fmc-field="'+key+'" aria-label="'+label+'"></label>';
  }
  dlg.innerHTML=[
    '<div class="fmc-head"><h3>TÍNH MAP PHUN NỀN · AFR MONG MUỐN</h3><button type="button" class="fmc-close" id="fmcClose">✕</button></div>',
    '<div class="fmc-body">',
    '<div class="fmc-important">'+numericField('afr','AFR MONG MUỐN (BẮT BUỘC)')+
    '<label style="margin-top:7px">Thang AFR<select data-fmc-option="afrScale"><option value="gauge">AFR đồng hồ xăng · 14,7</option><option value="e10">AFR thực E10 · 14,1</option></select></label></div>',
    '<div class="fmc-grid">'+fields.map(x=>numericField(x[0],x[1])).join('')+'</div>',
    '<div class="fmc-grid">',
    '<label>Số lần phun / 720°<select data-fmc-option="pulses"><option value="1">1 xung / chu kỳ</option><option value="2">2 xung / chu kỳ</option></select></label>',
    '<label>Đơn vị map tạo ra<select data-fmc-option="output"><option value="command">ms lệnh (cộng deadtime)</option><option value="effective">ms hữu hiệu (chưa cộng)</option></select></label>',
    '<label>Phạm vi áp dụng<select data-fmc-option="scope"><option value="full">Toàn bộ TPS đến RPM giới hạn</option><option value="selected">Chỉ vùng đang chọn trên map</option></select></label>',
    '<label>Nhiên liệu<select disabled><option>E10 · AFR stoich 14,1</option></select></label></div>',
    '<div class="fmc-help">Mô hình Alpha-N giả định VE theo RPM và TPS; họng ga 32 mm chỉ là thông tin tham khảo, KHÔNG thể suy lưu lượng khí chính xác từ đường kính. Áp suất phải là chênh áp qua kim, không mặc định bằng áp đường rail. Kim được giả định định mức tại áp chuẩn nhập ở trên, E10 có khối lượng riêng giả định 0,75 g/cc. Độ trễ kim và số xung/chu kỳ chưa được xác minh với ECU.</div>',
    '<div id="fmcPad" class="fmc-pad" aria-hidden="true"><span class="fmc-pad-title" id="fmcPadTitle">Chọn ô để nhập</span>',
    ['1','2','3','C','4','5','6','⌫','7','8','9','.','−','0','XONG'].map(k=>'<button type="button" data-fmc-key="'+k+'">'+k+'</button>').join(''),
    '</div>',
    '<div class="fmc-actions"><button type="button" class="fmc-primary" id="fmcPreview">TÍNH & XEM TRƯỚC</button><button type="button" id="fmcClose2">ĐÓNG</button></div>',
    '<div class="fmc-result" id="fmcResult" role="status" aria-live="polite">Chưa tính. AFR mong muốn luôn do bạn nhập, không lấy từ Auto Tune.</div>',
    '<div class="fmc-tablebox" id="fmcTableBox" hidden><table class="fmc-preview" id="fmcTable"></table></div>',
    '<label class="fmc-ack"><input type="checkbox" id="fmcAck">Tôi hiểu đây chỉ là bản ước tính VE, đã xác minh kiểu ms của ECU và sẽ đo AFR/tải thực tế trước khi sử dụng.</label>',
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
    dlg.querySelectorAll('[data-fmc-field]').forEach(input=>{p[input.dataset.fmcField]=input.value;});
    dlg.querySelectorAll('[data-fmc-option]').forEach(input=>{p[input.dataset.fmcOption]=input.value;});
    return p;
  }
  function invalidate(){
    preview=null;el('fmcApply').disabled=true;el('fmcAck').checked=false;el('fmcTableBox').hidden=true;
    el('fmcResult').textContent='Đã sửa thông số. Bấm TÍNH & XEM TRƯỚC để cập nhật.';
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
    invalidate();
  }));
  function msg(x){el('fmcResult').textContent=String(x);}
  function renderPreview(out,snap){
    const visible=snap.rpms.map((rpm,c)=>({rpm,c})).filter(x=>x.rpm<=out.params.maxRpm);
    const h=['<thead><tr><th class="fmc-rowhead">TPS</th>'];
    for(const x of visible)h.push('<th>'+x.rpm+'</th>');
    h.push('</tr></thead><tbody>');
    for(let r=0;r<snap.tps.length;r++){
      h.push('<tr><th class="fmc-rowhead">'+String(snap.tps[r])+(String(snap.tps[r]).toUpperCase()==='IDLE'?'':'%')+'</th>');
      for(const x of visible){
        const v=out.output[r][x.c],yes=v!==null;
        h.push('<td class="'+(yes?'fmc-active':'fmc-skip')+'">'+(yes?v.toFixed(2):'—')+'</td>');
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
      const out=calculate(readFields(),{rpms:snap.rpms,tps:snap.tps},snap.map,snap.selection);
      preview={snap,out};
      el('fmcAck').checked=false;
      const canApply=snap.baselineValid&&!snap.unknown;
      el('fmcApply').disabled=!canApply;
      renderPreview(out,snap);
      msg('MAP NO.'+snap.bank+' · '+out.cc.toFixed(2)+' cc · kim '+out.flow.toFixed(1)+' cc/phút @ '+out.params.pressure+' bar\n'+
        'AFR mong muốn: '+out.params.afr+' ('+(out.params.afrScale==='gauge'?'đồng hồ 14,7':'E10 thực 14,1')+') · Lambda '+out.lambda.toFixed(3)+' · AFR E10 thực '+out.actualE10Afr.toFixed(2)+'\n'+
        'Tạo '+out.updated+' ô; '+out.min.toFixed(2)+'–'+out.max.toFixed(2)+' ms; duty lớn nhất '+out.maxDuty.toFixed(1)+'%'+(out.aboveDuty?' · '+out.aboveDuty+' ô duty trên 80%':'')+'\n'+
        'RPM > '+out.params.maxRpm+' giữ nguyên MAP cũ. VE giả định, chưa kiểm chứng cam/MAP thực tế.\n'+
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
    msg('MAP NO.'+snap.bank+' · AFR mong muốn do bạn nhập. Tính thử không thay đổi dữ liệu ECU. Trên 9.000 RPM sẽ giữ nguyên nếu giới hạn đang là 9.000.');
    dlg.showModal();
  });
  el('fmcPreview').addEventListener('click',doPreview);
  el('fmcApply').addEventListener('click',doApply);
  el('fmcClose').addEventListener('click',closeDialog);
  el('fmcClose2').addEventListener('click',closeDialog);
  root.BlinkFuelModelUi={preview:doPreview,math:root.BlinkFuelModelMath};
})(window);

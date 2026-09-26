from pathlib import Path
import re

p=Path("index.html")
s=p.read_text(encoding="utf-8")

s=s.replace("ECU PERFORMANCE · WEB v10","ECU PERFORMANCE · WEB v11")
s=s.replace("KẾT NỐI ESP32 BLE","KẾT NỐI BLINK")
s=s.replace("Bấm KẾT NỐI ESP32 BLE để kết nối lại.","Bấm KẾT NỐI BLINK để kết nối lại.")

css=r'''
  /* ===== v11 MAP FULL SCROLL + CONNECT FEEDBACK + ROTATE TOGGLE ===== */
  #mapWrap{
    overflow-x:auto!important;
    overflow-y:auto!important;
    overscroll-behavior:contain!important;
    touch-action:pan-x pan-y!important;
    scroll-behavior:auto!important;
    padding-bottom:82px!important;
  }
  #connectEcuBtn.connectAck{
    animation:blinkConnectAck .52s ease 0s 2;
    box-shadow:0 0 0 2px rgba(255,255,255,.92) inset,0 0 28px rgba(29,215,95,.85)!important;
  }
  @keyframes blinkConnectAck{
    0%,100%{transform:scale(1);filter:brightness(1)}
    50%{transform:scale(.97);filter:brightness(1.65)}
  }
  #rotateLandscapeBtn.rotateAck{animation:blinkRotateAck .45s ease 0s 2}
  @keyframes blinkRotateAck{0%,100%{filter:brightness(1)}50%{filter:brightness(1.75)}}
  @media (orientation:landscape){
    #mapWrap{padding-bottom:60px!important}
  }
'''
if "v11 MAP FULL SCROLL" not in s:
    s=s.replace("\n</style>",css+"\n</style>",1)

needle="""  async function connectBle(){
    try{"""
repl="""  async function connectBle(){
    const connectBtn=$('connectEcuBtn');
    if(connectBtn){
      connectBtn.classList.remove('connectAck');
      void connectBtn.offsetWidth;
      connectBtn.classList.add('connectAck');
      connectBtn.textContent='✓ ĐÃ NHẬN · ĐANG QUÉT...';
      setTimeout(()=>{
        connectBtn.classList.remove('connectAck');
        if(!state.ecuConnected)connectBtn.textContent='KẾT NỐI BLINK';
      },900);
    }
    try{"""
if needle in s and "✓ ĐÃ NHẬN · ĐANG QUÉT..." not in s:
    s=s.replace(needle,repl,1)

s=s.replace("BLE: ĐANG CHỌN ESP32...","BLE: ĐANG CHỌN BLINK...")
s=s.replace("device.name||'ESP32-S3'","device.name||'BLINK'")
s=s.replace("'ESP32-S3 ĐÃ NGẮT BLE'","'BLINK ĐÃ NGẮT BLE'")

pattern=re.compile(r"async function requestLandscape\(\)\{.*?\n\}\ndocument\.getElementById\('rotateLandscapeBtn'\)\?\.addEventListener\('click',requestLandscape\);",re.S)
rotate=r"""async function requestLandscape(){
  const screenEl=document.getElementById('mapEditorScreen');
  const btn=document.getElementById('rotateLandscapeBtn');
  const isLandscape=matchMedia('(orientation: landscape)').matches;
  const target=isLandscape?'portrait':'landscape';
  const nativeAndroid=!!(window.AndroidBLE&&typeof window.AndroidBLE.setOrientation==='function') || /BLINK-REDLEO-ANDROID/i.test(navigator.userAgent||'');

  if(btn){
    btn.classList.remove('rotateAck');
    void btn.offsetWidth;
    btn.classList.add('rotateAck');
    btn.textContent=target==='landscape'?'↻ ĐANG XOAY NGANG...':'↻ ĐANG XOAY DỌC...';
  }

  try{
    if(nativeAndroid){
      try{window.AndroidBLE&&window.AndroidBLE.setOrientation(target)}catch(_e){}
      screenEl?.classList.toggle('landscapeRequested',target==='landscape');
      setTimeout(()=>{syncRotateButton();highlightCurrent();},420);
      return;
    }

    if(!document.fullscreenElement && target==='landscape'){
      const root=document.documentElement;
      const req=root.requestFullscreen||root.webkitRequestFullscreen;
      if(req){try{await req.call(root)}catch(_e){}}
    }
    let locked=false;
    if(screen.orientation&&typeof screen.orientation.lock==='function'){
      try{await screen.orientation.lock(target);locked=true}catch(_e){}
    }
    screenEl?.classList.toggle('landscapeRequested',target==='landscape');
    if(!locked){
      showEcuNotice('info',target==='landscape'?'XOAY NGANG':'XOAY DỌC','Trình duyệt này không cho website ép hướng. Hãy xoay điện thoại bằng tay.',3200);
    }
  }catch(e){
    showEcuNotice('info','XOAY MÀN HÌNH','Không thể khóa hướng tự động trên trình duyệt này.',3000);
  }finally{
    setTimeout(syncRotateButton,500);
  }
}
function syncRotateButton(){
  const btn=document.getElementById('rotateLandscapeBtn');
  if(!btn)return;
  btn.classList.remove('rotateAck');
  const land=matchMedia('(orientation: landscape)').matches;
  btn.textContent=land?'↻ XOAY DỌC':'↻ XOAY NGANG';
}
document.getElementById('rotateLandscapeBtn')?.addEventListener('click',requestLandscape);"""
if "function syncRotateButton()" not in s:
    s,n=pattern.subn(rotate,s,count=1)
    if n!=1:
        raise SystemExit("rotate function patch failed")

s=s.replace(
"window.addEventListener('orientationchange',()=>{setTimeout(()=>{const land=matchMedia('(orientation: landscape)').matches;document.getElementById('mapEditorScreen')?.classList.toggle('landscapeRequested',land);highlightCurrent();},260)});",
"window.addEventListener('orientationchange',()=>{setTimeout(()=>{const land=matchMedia('(orientation: landscape)').matches;document.getElementById('mapEditorScreen')?.classList.toggle('landscapeRequested',land);syncRotateButton();highlightCurrent();},260)});"
)

s=s.replace(
"mapFollowWrap.addEventListener('pointerdown',()=>pauseMapAutoFollow(2600),{passive:true});\n  mapFollowWrap.addEventListener('touchstart',()=>pauseMapAutoFollow(2600),{passive:true});\n  mapFollowWrap.addEventListener('wheel',()=>pauseMapAutoFollow(2600),{passive:true});",
"mapFollowWrap.addEventListener('pointerdown',()=>pauseMapAutoFollow(8000),{passive:true});\n  mapFollowWrap.addEventListener('touchstart',()=>pauseMapAutoFollow(8000),{passive:true});\n  mapFollowWrap.addEventListener('wheel',()=>pauseMapAutoFollow(8000),{passive:true});\n  mapFollowWrap.addEventListener('scroll',()=>pauseMapAutoFollow(5000),{passive:true});"
)

if "syncRotateButton();\nupdateMapControls();" not in s:
    s=s.replace("updateMapControls();\n})();","syncRotateButton();\nupdateMapControls();\n})();",1)

p.write_text(s,encoding="utf-8")
print("patched v11")

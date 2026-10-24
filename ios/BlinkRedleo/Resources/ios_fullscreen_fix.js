(function(){
  'use strict';
  if (window.__BLINK_IOS_FULLSCREEN_FIX__) return;
  window.__BLINK_IOS_FULLSCREEN_FIX__ = true;

  function ensureViewport(){
    let meta=document.querySelector('meta[name="viewport"]');
    const value='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
    if(meta){ meta.setAttribute('content', value); return; }
    meta=document.createElement('meta');
    meta.name='viewport';
    meta.content=value;
    (document.head||document.documentElement).appendChild(meta);
  }

  function installStyle(){
    if(document.getElementById('blink-ios-fullscreen-style')) return;
    const s=document.createElement('style');
    s.id='blink-ios-fullscreen-style';
    s.textContent=`
      html,body{
        width:100%!important;
        height:100%!important;
        min-height:100%!important;
        margin:0!important;
        padding:0!important;
        overflow:hidden!important;
        background:#000!important;
      }
      body{
        position:fixed!important;
        inset:0!important;
        width:100vw!important;
        height:100dvh!important;
        min-height:100dvh!important;
      }
      .app{
        position:fixed!important;
        inset:0!important;
        width:100vw!important;
        height:100dvh!important;
        min-height:100dvh!important;
        margin:0!important;
      }
      .screen{
        top:0!important;
      }
      @supports (padding: env(safe-area-inset-top)){
        .screen{
          padding-top:max(6px,env(safe-area-inset-top))!important;
        }
        #mapEditorScreen{
          padding-top:max(6px,env(safe-area-inset-top))!important;
        }
      }
    `;
    (document.head||document.documentElement).appendChild(s);
  }

  ensureViewport();
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{ensureViewport();installStyle();},{once:true});
  }else{
    ensureViewport();installStyle();
  }

  const observer=new MutationObserver(()=>{
    ensureViewport();
    if(document.head) installStyle();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),5000);

  window.addEventListener('pageshow',()=>{ensureViewport();installStyle();});
  window.addEventListener('resize',()=>{
    try{
      document.documentElement.style.setProperty('--blink-vh', window.innerHeight+'px');
    }catch(_e){}
  },{passive:true});
})();
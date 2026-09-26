from pathlib import Path

p=Path("index.html")
s=p.read_text(encoding="utf-8")

css=r'''
  /* ===== v11.1 MAP EDITOR USES FULL VIEWPORT ===== */
  body.mapEditing .bottomNav{display:none!important}
  body.mapEditing #mapEditorScreen,
  body.mapEditing #redleoEditorScreen{
    inset:0!important;
    bottom:0!important;
  }
  body.mapEditing #mapWrap{
    min-height:0!important;
    height:0!important;
    flex:1 1 0!important;
    overflow:auto!important;
    -webkit-overflow-scrolling:touch!important;
  }
  body.mapEditing #mapTable{
    height:auto!important;
    min-height:0!important;
    margin-bottom:84px!important;
  }
  body.mapEditing #mapTable tbody{height:auto!important}
  body.mapEditing #mapTable tr{height:auto!important}
  body.mapEditing #mapTable th,
  body.mapEditing #mapTable td{
    height:42px!important;
    min-height:42px!important;
  }
  @media (orientation:landscape){
    body.mapEditing #mapTable th,
    body.mapEditing #mapTable td{
      height:34px!important;
      min-height:34px!important;
    }
    body.mapEditing #mapTable{margin-bottom:60px!important}
  }
'''
if "v11.1 MAP EDITOR USES FULL VIEWPORT" not in s:
    s=s.replace("\n</style>",css+"\n</style>",1)

old="function showScreen(name){Object.entries(screens).forEach(([k,id])=>document.getElementById(id)?.classList.toggle('active',k===name));document.querySelectorAll('.navBtn').forEach(b=>b.classList.toggle('active',b.dataset.nav===name||(name==='editor'||name==='rededitor')&&b.dataset.nav==='maps'));if(name==='editor')setTimeout(()=>{try{render();highlightCurrent()}catch(e){}},0)}"
new="function showScreen(name){document.body.classList.toggle('mapEditing',name==='editor'||name==='rededitor');Object.entries(screens).forEach(([k,id])=>document.getElementById(id)?.classList.toggle('active',k===name));document.querySelectorAll('.navBtn').forEach(b=>b.classList.toggle('active',b.dataset.nav===name||(name==='editor'||name==='rededitor')&&b.dataset.nav==='maps'));if(name==='editor')setTimeout(()=>{try{render();highlightCurrent()}catch(e){}},0)}"
if old in s:
    s=s.replace(old,new,1)

# Programmatic auto-follow must not disable itself; manual touch/pointer already pauses it.
s=s.replace("  mapFollowWrap.addEventListener('scroll',()=>pauseMapAutoFollow(5000),{passive:true});\n","")

p.write_text(s,encoding="utf-8")
print("patched v11.1")

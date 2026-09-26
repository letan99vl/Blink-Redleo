from pathlib import Path
p=Path("index.html")
s=p.read_text(encoding="utf-8")

s=s.replace("ECU PERFORMANCE · WEB v11","ECU PERFORMANCE · WEB v11.2")

css=r'''
  /* ===== v11.2 FIX INJ VE MAP HEIGHT ON ANDROID WEBVIEW ===== */
  body.mapEditing #mapEditorScreen.active{
    display:flex!important;
    flex-direction:column!important;
    top:0!important;
    right:0!important;
    bottom:0!important;
    left:0!important;
    height:100dvh!important;
    max-height:100dvh!important;
    min-height:0!important;
    overflow:hidden!important;
    padding-bottom:0!important;
    box-sizing:border-box!important;
  }
  body.mapEditing #mapEditorScreen > .screenHeader,
  body.mapEditing #mapEditorScreen > .editToolbar,
  body.mapEditing #mapEditorScreen > .editorInfo,
  body.mapEditing #mapEditorScreen > .editorTabs,
  body.mapEditing #mapEditorScreen > .editorStepBar,
  body.mapEditing #mapEditorScreen > .editorFooter{
    flex:0 0 auto!important;
  }
  body.mapEditing #mapEditorScreen #mapWrap{
    display:block!important;
    position:relative!important;
    flex:1 1 auto!important;
    height:auto!important;
    min-height:120px!important;
    max-height:none!important;
    width:100%!important;
    overflow-x:auto!important;
    overflow-y:auto!important;
    padding-bottom:24px!important;
    margin:0!important;
    overscroll-behavior:contain!important;
    -webkit-overflow-scrolling:touch!important;
  }
  body.mapEditing #mapEditorScreen #mapTable{
    display:table!important;
    height:auto!important;
    min-height:0!important;
    width:max-content!important;
    min-width:1650px!important;
    margin:0 0 56px 0!important;
    table-layout:fixed!important;
  }
  body.mapEditing #mapEditorScreen #mapTable tbody{
    display:table-row-group!important;
    height:auto!important;
  }
  body.mapEditing #mapEditorScreen #mapTable tr{
    display:table-row!important;
    height:auto!important;
  }
  body.mapEditing #mapEditorScreen #mapTable th,
  body.mapEditing #mapEditorScreen #mapTable td{
    display:table-cell!important;
    height:42px!important;
    min-height:42px!important;
  }
  body.mapEditing #mapEditorScreen .editorFooter{
    position:relative!important;
    bottom:auto!important;
    z-index:20!important;
  }
  @media (orientation:landscape){
    body.mapEditing #mapEditorScreen{
      height:100dvh!important;
      max-height:100dvh!important;
    }
    body.mapEditing #mapEditorScreen #mapWrap{
      min-height:90px!important;
      padding-bottom:12px!important;
    }
    body.mapEditing #mapEditorScreen #mapTable{
      margin-bottom:36px!important;
    }
    body.mapEditing #mapEditorScreen #mapTable th,
    body.mapEditing #mapEditorScreen #mapTable td{
      height:34px!important;
      min-height:34px!important;
    }
  }
'''
if "v11.2 FIX INJ VE MAP HEIGHT" not in s:
    s=s.replace("\n</style>",css+"\n</style>",1)

# Neutralize the bad v11.1 rule if present.
s=s.replace(
"""  body.mapEditing #mapWrap{
    min-height:0!important;
    height:0!important;
    flex:1 1 0!important;
    overflow:auto!important;
    -webkit-overflow-scrolling:touch!important;
  }""",
"""  body.mapEditing #mapWrap{
    min-height:0!important;
    height:auto!important;
    flex:1 1 auto!important;
    overflow:auto!important;
    -webkit-overflow-scrolling:touch!important;
  }"""
)

p.write_text(s,encoding="utf-8")
print("patched v11.2")

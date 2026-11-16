(function(){
  'use strict';
  if (window.__BLINK_IOS_BLE_POLYFILL__) return;
  window.__BLINK_IOS_BLE_POLYFILL__ = true;

  const SERVICE='afaf0001-7c35-4a6d-9f0e-2ea3117f1000';
  const COMMAND='afaf0003-7c35-4a6d-9f0e-2ea3117f1000';

  function post(message){ window.webkit.messageHandlers.iosBLE.postMessage(message); }
  function asU8(data){
    if(data instanceof Uint8Array)return data;
    if(data instanceof ArrayBuffer)return new Uint8Array(data);
    if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    return new Uint8Array(data||[]);
  }
  function bytesToBase64(data){
    const u8=asU8(data);let s='',step=0x4000;
    for(let i=0;i<u8.length;i+=step){
      const chunk=u8.subarray(i,Math.min(i+step,u8.length));
      s+=String.fromCharCode.apply(null,Array.from(chunk));
    }
    return btoa(s);
  }
  function base64ToBytes(b64){
    const s=atob(b64||''),u8=new Uint8Array(s.length);
    for(let i=0;i<s.length;i++)u8[i]=s.charCodeAt(i)&255;
    return u8;
  }
  function isRawE1(data){const u=asU8(data);return u.length>0&&u[0]===0xE1;}

  let nativeWriteSeq=0;
  const nativeWritePending=new Map();
  function nativeWriteWithResponse(uuid,data){
    return new Promise((resolve,reject)=>{
      const token=(nativeWriteSeq=(nativeWriteSeq%1000000)+1);
      const timer=setTimeout(()=>{
        nativeWritePending.delete(token);
        reject(new Error('iOS BLE write ACK timeout'));
      },5000);
      nativeWritePending.set(token,{resolve,reject,timer});
      try{post({action:'write',uuid,base64:bytesToBase64(data),withResponse:true,token});}
      catch(e){clearTimeout(timer);nativeWritePending.delete(token);reject(e);}
    });
  }
  window.__iosBleWriteDone=function(token,ok,status){
    token=Number(token)||0;
    const p=nativeWritePending.get(token);
    if(!p)return;
    nativeWritePending.delete(token);
    clearTimeout(p.timer);
    if(ok)p.resolve();else p.reject(new Error('iOS BLE write error '+status));
  };

  const chars=new Map();
  function makeCharacteristic(uuid){
    uuid=String(uuid).toLowerCase();
    if(chars.has(uuid))return chars.get(uuid);
    const listeners=[];
    const ch={
      uuid,
      startNotifications(){return Promise.resolve(ch);},
      stopNotifications(){return Promise.resolve(ch);},
      addEventListener(type,fn){
        if(type==='characteristicvaluechanged'&&typeof fn==='function')listeners.push(fn);
      },
      removeEventListener(type,fn){
        const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);
      },
      writeValueWithoutResponse(data){
        if(isRawE1(data))return nativeWriteWithResponse(uuid,data);
        post({action:'write',uuid,base64:bytesToBase64(data),withResponse:false,token:0});
        return Promise.resolve();
      },
      writeValueWithResponse(data){return nativeWriteWithResponse(uuid,data);},
      writeValue(data){
        if(isRawE1(data))return nativeWriteWithResponse(uuid,data);
        post({action:'write',uuid,base64:bytesToBase64(data),withResponse:false,token:0});
        return Promise.resolve();
      },
      __emit(bytes){
        const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        listeners.slice().forEach(fn=>{try{fn({target:{value:dv}});}catch(e){console.error(e);}});
      }
    };
    chars.set(uuid,ch);return ch;
  }

  const service={uuid:SERVICE,getCharacteristic(uuid){return Promise.resolve(makeCharacteristic(uuid));}};
  const server={
    connected:true,
    getPrimaryService(uuid){
      if(String(uuid).toLowerCase()!==SERVICE)return Promise.reject(new Error('BLE service mismatch.'));
      return Promise.resolve(service);
    }
  };

  const deviceListeners={disconnected:[]};
  const device={
    name:'BLINK-REDLEO',
    id:'ios-native-ble',
    gatt:{
      connected:false,
      connect(){this.connected=true;server.connected=true;return Promise.resolve(server);},
      disconnect(){try{post({action:'disconnect'});}catch(e){}}
    },
    addEventListener(type,fn){
      if(type==='gattserverdisconnected'&&typeof fn==='function')deviceListeners.disconnected.push(fn);
    },
    removeEventListener(type,fn){
      if(type==='gattserverdisconnected'){
        const i=deviceListeners.disconnected.indexOf(fn);if(i>=0)deviceListeners.disconnected.splice(i,1);
      }
    }
  };

  let pendingResolve=null,pendingReject=null,pendingTimer=null;
  function clearPendingTimer(){if(pendingTimer){clearTimeout(pendingTimer);pendingTimer=null;}}
  const bluetoothApi={
    requestDevice(){
      return new Promise((resolve,reject)=>{
        clearPendingTimer();
        pendingResolve=resolve;pendingReject=reject;
        pendingTimer=setTimeout(()=>{
          if(!pendingReject)return;
          const r=pendingReject;
          pendingResolve=pendingReject=null;pendingTimer=null;
          try{post({action:'disconnect'});}catch(_e){}
          r(new Error('iOS BLE timeout 15s'));
        },15000);
        try{post({action:'requestDevice'});}
        catch(e){clearPendingTimer();pendingResolve=pendingReject=null;reject(e);}
      });
    },
    getAvailability(){return Promise.resolve(true);},
    getDevices(){return Promise.resolve(device.gatt.connected?[device]:[]);},
    setScreenDimEnabled(enabled){
      try{post({action:'keepScreenOn',enabled:!enabled});}catch(e){}
      return Promise.resolve();
    }
  };

  try{Object.defineProperty(navigator,'bluetooth',{configurable:true,enumerable:true,value:bluetoothApi});}
  catch(e){try{navigator.bluetooth=bluetoothApi;}catch(_e){}}

  window.__iosBleConnected=function(name){
    clearPendingTimer();
    device.name=name||'BLINK-REDLEO';device.gatt.connected=true;server.connected=true;
    if(pendingResolve){const r=pendingResolve;pendingResolve=pendingReject=null;r(device);}
  };
  window.__iosBleConnectError=function(message){
    clearPendingTimer();
    const err=new Error(message||'Unable to connect to BLINK REDLEO.');
    if(pendingReject){const r=pendingReject;pendingResolve=pendingReject=null;r(err);}
  };
  window.__iosBleDisconnected=function(){
    device.gatt.connected=false;server.connected=false;
    deviceListeners.disconnected.slice().forEach(fn=>{try{fn({target:device});}catch(e){}});
  };
  window.__iosBlePacket=function(uuid,b64){
    try{makeCharacteristic(String(uuid).toLowerCase()).__emit(base64ToBytes(b64));}
    catch(e){console.error('iOS BLE packet',e);}
  };

  document.addEventListener('click',function(ev){
    const t=ev.target&&ev.target.closest?ev.target.closest('#rotateLandscapeBtn'):null;
    if(t){try{post({action:'setOrientation',value:'landscape'});}catch(e){}}
  },true);

  console.log('BLINK REDLEO iOS native BLE polyfill installed');
})();
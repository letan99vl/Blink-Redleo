from pathlib import Path
import re
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: patch_android_ble_turbo.py MainActivity.java native_bridge.js")

java_path = Path(sys.argv[1])
bridge_path = Path(sys.argv[2])
s = java_path.read_text(encoding="utf-8")
b = bridge_path.read_text(encoding="utf-8")

# ---- Java native GATT: MTU-aware, response-backed RAW writes ----
field_anchor = "    private boolean pickerScanActive = false;\n"
field_code = r'''    private int negotiatedMtu = 23;
    private boolean serviceDiscoveryStarted = false;

    private static final class BleWriteRequest {
        final String uuidText;
        final byte[] data;
        final int token;
        int attempts = 0;
        BleWriteRequest(String uuidText, byte[] data, int token) {
            this.uuidText = uuidText;
            this.data = data;
            this.token = token;
        }
    }

    private final ArrayDeque<BleWriteRequest> bleWriteQueue = new ArrayDeque<>();
    private BleWriteRequest activeBleWrite = null;
'''
if "private static final class BleWriteRequest" not in s:
    if field_anchor not in s:
        raise SystemExit("BLE turbo patch: field anchor not found")
    s = s.replace(field_anchor, field_anchor + field_code)

old_bridge_method = '''        @JavascriptInterface public void writeValue(String uuid, String base64) {
            main.post(() -> writeBle(uuid, base64));
        }
'''
new_bridge_method = '''        @JavascriptInterface public void writeValue(String uuid, String base64) {
            main.post(() -> writeBle(uuid, base64));
        }
        @JavascriptInterface public void writeValueWithResponse(String uuid, String base64, int token) {
            main.post(() -> enqueueBleWriteWithResponse(uuid, base64, token));
        }
        @JavascriptInterface public int getNegotiatedMtu() {
            return negotiatedMtu;
        }
'''
if "writeValueWithResponse(String uuid" not in s:
    if old_bridge_method not in s:
        raise SystemExit("BLE turbo patch: JS bridge writeValue anchor not found")
    s = s.replace(old_bridge_method, new_bridge_method)

old_connect = '''                gatt = bg;
                try { bg.requestMtu(185); } catch (Exception ignored) { }
                main.postDelayed(() -> { try { if (gatt == bg) bg.discoverServices(); } catch (Exception ignored) {} }, 300);
'''
new_connect = '''                gatt = bg;
                negotiatedMtu = 23;
                serviceDiscoveryStarted = false;
                try { bg.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH); } catch (Exception ignored) { }
                boolean mtuRequested = false;
                try { mtuRequested = bg.requestMtu(185); } catch (Exception ignored) { }
                if (!mtuRequested) main.post(() -> discoverServicesOnce(bg));
                // Safety fallback for phones that never call onMtuChanged.
                main.postDelayed(() -> discoverServicesOnce(bg), 500);
'''
if old_connect not in s:
    raise SystemExit("BLE turbo patch: connection MTU anchor not found")
s = s.replace(old_connect, new_connect)

services_anchor = '''        @Override
        @SuppressLint("MissingPermission")
        public void onServicesDiscovered(BluetoothGatt bg, int status) {
'''
mtu_callback = r'''        @Override
        @SuppressLint("MissingPermission")
        public void onMtuChanged(BluetoothGatt bg, int mtu, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS && mtu >= 23) negotiatedMtu = mtu;
            final int reportMtu = negotiatedMtu;
            main.post(() -> {
                if (webView != null) {
                    try { webView.evaluateJavascript("window.__androidBleMtuChanged&&window.__androidBleMtuChanged(" + reportMtu + ")", null); }
                    catch (Throwable ignored) { }
                }
                discoverServicesOnce(bg);
            });
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onCharacteristicWrite(BluetoothGatt bg, BluetoothGattCharacteristic characteristic, int status) {
            main.post(() -> finishBleWrite(status == BluetoothGatt.GATT_SUCCESS, status));
        }

'''
if "public void onMtuChanged(BluetoothGatt bg" not in s:
    if services_anchor not in s:
        raise SystemExit("BLE turbo patch: services callback anchor not found")
    s = s.replace(services_anchor, mtu_callback + services_anchor)

# Add discoverServicesOnce before callback declaration.
callback_anchor = "    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {\n"
discover_helper = r'''    @SuppressLint("MissingPermission")
    private void discoverServicesOnce(BluetoothGatt bg) {
        if (bg == null || gatt != bg || serviceDiscoveryStarted) return;
        serviceDiscoveryStarted = true;
        try {
            if (!bg.discoverServices()) {
                serviceDiscoveryStarted = false;
                main.postDelayed(() -> discoverServicesOnce(bg), 120);
            }
        } catch (Throwable t) {
            serviceDiscoveryStarted = false;
            main.postDelayed(() -> discoverServicesOnce(bg), 120);
        }
    }

'''
if "private void discoverServicesOnce(BluetoothGatt bg)" not in s:
    if callback_anchor not in s:
        raise SystemExit("BLE turbo patch: gatt callback anchor not found")
    s = s.replace(callback_anchor, discover_helper + callback_anchor)

# Add reliable write queue immediately before legacy writeBle().
m = re.search(r'\n    @SuppressLint\("MissingPermission"\)\n    private void writeBle\(String uuidText, String base64\) \{', s)
if not m:
    raise SystemExit("BLE turbo patch: writeBle method anchor not found")
write_helpers = r'''
    private void notifyBleWriteDone(int token, boolean ok, int status) {
        if (token <= 0 || webView == null) return;
        final String js = "window.__androidBleWriteDone&&window.__androidBleWriteDone(" +
                token + "," + (ok ? "true" : "false") + "," + status + ")";
        try { webView.evaluateJavascript(js, null); } catch (Throwable ignored) { }
    }

    private void enqueueBleWriteWithResponse(String uuidText, String base64, int token) {
        if (gatt == null || commandChar == null) {
            notifyBleWriteDone(token, false, -100);
            return;
        }
        UUID uuid;
        try { uuid = UUID.fromString(uuidText); }
        catch (Exception e) { notifyBleWriteDone(token, false, -101); return; }
        if (!COMMAND_UUID.equals(uuid)) {
            notifyBleWriteDone(token, false, -102);
            return;
        }
        byte[] data;
        try { data = Base64.decode(base64, Base64.DEFAULT); }
        catch (Exception e) { notifyBleWriteDone(token, false, -103); return; }

        bleWriteQueue.addLast(new BleWriteRequest(uuidText, data, token));
        drainBleWriteQueue();
    }

    @SuppressLint("MissingPermission")
    private void drainBleWriteQueue() {
        if (activeBleWrite != null) return;
        if (gatt == null || commandChar == null) {
            while (!bleWriteQueue.isEmpty()) {
                BleWriteRequest q = bleWriteQueue.pollFirst();
                if (q != null) notifyBleWriteDone(q.token, false, -104);
            }
            return;
        }
        BleWriteRequest q = bleWriteQueue.pollFirst();
        if (q == null) return;
        activeBleWrite = q;
        q.attempts++;

        boolean accepted = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                int rc = gatt.writeCharacteristic(
                        commandChar, q.data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                accepted = (rc == 0);
            } else {
                commandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                commandChar.setValue(q.data);
                accepted = gatt.writeCharacteristic(commandChar);
            }
        } catch (Throwable ignored) {
            accepted = false;
        }

        if (!accepted) {
            activeBleWrite = null;
            if (q.attempts < 8 && gatt != null) {
                bleWriteQueue.addFirst(q);
                main.postDelayed(this::drainBleWriteQueue, 6);
            } else {
                notifyBleWriteDone(q.token, false, -105);
                main.post(this::drainBleWriteQueue);
            }
        }
    }

    private void finishBleWrite(boolean ok, int status) {
        BleWriteRequest q = activeBleWrite;
        if (q == null) return; // ignore callbacks from legacy NO_RESPONSE writes
        activeBleWrite = null;

        if (!ok && q.attempts < 3 && gatt != null) {
            bleWriteQueue.addFirst(q);
            main.postDelayed(this::drainBleWriteQueue, 8);
            return;
        }

        notifyBleWriteDone(q.token, ok, status);
        main.post(this::drainBleWriteQueue);
    }
'''
if "private void enqueueBleWriteWithResponse(" not in s:
    s = s[:m.start()] + "\n" + write_helpers + s[m.start():]

# Clear reliable-write state on every disconnect path.
s = s.replace("                notifyQueue.clear();\n", "                notifyQueue.clear();\n                bleWriteQueue.clear(); activeBleWrite = null; negotiatedMtu = 23; serviceDiscoveryStarted = false;\n")
s = s.replace("        notifyQueue.clear();\n", "        notifyQueue.clear();\n        bleWriteQueue.clear(); activeBleWrite = null; negotiatedMtu = 23; serviceDiscoveryStarted = false;\n")

# ---- native_bridge.js: true Promise backed by Android onCharacteristicWrite ----
bridge_anchor = "  const chars = new Map();\n"
bridge_helpers = r'''  let nativeWriteSeq=0;
  const nativeWritePending=new Map();

  function asU8(data){
    if(data instanceof Uint8Array)return data;
    if(data instanceof ArrayBuffer)return new Uint8Array(data);
    if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    return new Uint8Array(data||[]);
  }

  function isRawE1(data){
    const u=asU8(data);
    return u.length>0 && u[0]===0xE1;
  }

  function nativeWriteWithResponse(uuid,data){
    return new Promise((resolve,reject)=>{
      const token=(nativeWriteSeq=(nativeWriteSeq%1000000)+1);
      const timer=setTimeout(()=>{
        nativeWritePending.delete(token);
        reject(new Error('Android BLE write ACK timeout'));
      },3500);
      nativeWritePending.set(token,{resolve,reject,timer});
      try{
        AndroidBLE.writeValueWithResponse(uuid,bytesToBase64(data),token);
      }catch(e){
        clearTimeout(timer);nativeWritePending.delete(token);reject(e);
      }
    });
  }

  window.__androidBleWriteDone=function(token,ok,status){
    token=Number(token)||0;
    const p=nativeWritePending.get(token);
    if(!p)return;
    nativeWritePending.delete(token);
    clearTimeout(p.timer);
    if(ok)p.resolve();
    else p.reject(new Error('Android GATT write lỗi '+status));
  };

  window.__androidBleMtu=23;
  window.__androidBleMtuChanged=function(mtu){
    mtu=Number(mtu)||23;
    window.__androidBleMtu=mtu;
  };
  try{window.__androidBleMtu=Number(AndroidBLE.getNegotiatedMtu())||23}catch(_e){}

'''
if "nativeWriteWithResponse(uuid,data)" not in b:
    if bridge_anchor not in b:
        raise SystemExit("BLE turbo patch: native bridge chars anchor not found")
    b = b.replace(bridge_anchor, bridge_helpers + bridge_anchor)

old_methods = """      writeValueWithoutResponse(data){ AndroidBLE.writeValue(uuid,bytesToBase64(data)); return Promise.resolve(); },
      writeValue(data){ AndroidBLE.writeValue(uuid,bytesToBase64(data)); return Promise.resolve(); },
"""
new_methods = """      // RAW E1 traffic (ECU live/read/write) gets a real Android GATT ACK.
      // With MTU185, a 425B half-map is only ~3 writes, so this is both fast and
      // much more reliable than fire-and-forget posting into Android's GATT stack.
      writeValueWithoutResponse(data){
        if(isRawE1(data))return nativeWriteWithResponse(uuid,data);
        AndroidBLE.writeValue(uuid,bytesToBase64(data));return Promise.resolve();
      },
      writeValueWithResponse(data){ return nativeWriteWithResponse(uuid,data); },
      writeValue(data){
        if(isRawE1(data))return nativeWriteWithResponse(uuid,data);
        AndroidBLE.writeValue(uuid,bytesToBase64(data));return Promise.resolve();
      },
"""
if old_methods not in b:
    raise SystemExit("BLE turbo patch: native bridge write methods anchor not found")
b = b.replace(old_methods, new_methods)

java_path.write_text(s, encoding="utf-8")
bridge_path.write_text(b, encoding="utf-8")
print("Android BLE turbo patch applied")

'use strict';
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const APP_URL = 'https://letan99vl.github.io/Blink-Redleo/';
const APP_ORIGIN = new URL(APP_URL).origin;
const PROFILE = 'persist:blinktl-windows';
const DEVICE_PERMISSIONS = new Set(['bluetooth', 'bluetoothScanning', 'serial']);
let mainWindow = null;
let pickerWindow = null;
let pendingPicker = null;
function isBlinkOrigin(url) {
  try { return new URL(url).origin === APP_ORIGIN; } catch { return false; }
}
function updatePicker() {
  if (!pendingPicker || !pickerWindow || pickerWindow.isDestroyed()) return;
  if (pickerWindow.webContents.isLoadingMainFrame()) return;
  pickerWindow.webContents.send('blink-picker:devices', {
    type: pendingPicker.type,
    devices: Array.from(pendingPicker.devices.values())
  });
}
function closePicker(choice = '') {
  const active = pendingPicker;
  pendingPicker = null;
  const oldWindow = pickerWindow;
  pickerWindow = null;
  if (oldWindow && !oldWindow.isDestroyed()) oldWindow.close();
  if (active) {
    try { active.callback(choice); } catch (error) {
      console.error('Device selection callback failed:', error);
    }
  }
}
function openPicker(type, devices, callback) {
  if (pendingPicker && pendingPicker.type !== type) closePicker();
  if (!pendingPicker) {
    pendingPicker = { type, callback, devices: new Map() };
    pickerWindow = new BrowserWindow({
      parent: mainWindow, modal: true, width: 490, height: 500,
      minWidth: 420, minHeight: 360, resizable: true,
      title: type === 'bluetooth' ? 'Blink TL - Bluetooth' : 'Blink TL - Serial',
      backgroundColor: '#101e2d', autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.cjs'),
        nodeIntegration: false, contextIsolation: true, sandbox: true
      }
    });
    pickerWindow.on('closed', () => {
      pickerWindow = null;
      if (pendingPicker) closePicker();
    });
    pickerWindow.webContents.on('did-finish-load', updatePicker);
    pickerWindow.loadFile(path.join(__dirname, 'picker.html'));
  } else {
    pendingPicker.callback = callback;
  }
  for (const device of devices || []) {
    const id = type === 'bluetooth' ? device.deviceId : device.portId;
    if (typeof id !== 'string' || id.length === 0) continue;
    const name = type === 'bluetooth'
      ? (device.deviceName || 'Bluetooth device')
      : (device.displayName || device.portName || 'Serial port');
    const info = type === 'serial'
      ? [device.vendorId, device.productId].filter(Boolean).join(' / ') : '';
    pendingPicker.devices.set(id, { id, name: String(name), info: String(info) });
  }
  updatePicker();
}
function setupDeviceAccess(ses, win) {
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
    isBlinkOrigin(requestingOrigin) && DEVICE_PERMISSIONS.has(permission));
  ses.setPermissionRequestHandler((webContents, permission, callback) =>
    callback(isBlinkOrigin(webContents.getURL()) && DEVICE_PERMISSIONS.has(permission)));
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (!isBlinkOrigin(win.webContents.getURL())) return callback('');
    openPicker('bluetooth', devices, callback);
  });
  ses.on('select-serial-port', (event, ports, webContents, callback) => {
    event.preventDefault();
    if (webContents !== win.webContents || !isBlinkOrigin(win.webContents.getURL())) return callback('');
    openPicker('serial', ports, callback);
  });
  ses.on('serial-port-added', (_event, port) => {
    if (pendingPicker && pendingPicker.type === 'serial') openPicker('serial', [port], pendingPicker.callback);
  });
  ses.on('serial-port-removed', (_event, port) => {
    if (pendingPicker && pendingPicker.type === 'serial') {
      pendingPicker.devices.delete(port.portId);
      updatePicker();
    }
  });
}
function createMainWindow() {
  const ses = session.fromPartition(PROFILE);
  const win = new BrowserWindow({
    title: 'Blink TL - ECU', width: 1366, height: 768,
    minWidth: 800, minHeight: 500, fullscreen: true, autoHideMenuBar: true,
    backgroundColor: '#0c1420', show: false,
    webPreferences: {
      partition: PROFILE, contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true
    }
  });
  mainWindow = win;
  setupDeviceAccess(ses, win);
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault(); win.setFullScreen(!win.isFullScreen());
    } else if (input.control && input.key.toLowerCase() === 'q') {
      event.preventDefault(); app.quit();
    }
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!isBlinkOrigin(target)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    if (pendingPicker) closePicker();
    mainWindow = null;
  });
  win.loadURL(APP_URL).catch((error) => {
    console.error('Unable to load Blink TL:', error);
    if (!win.isDestroyed()) {
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<body style="background:#0c1420;color:white;font:20px Segoe UI;padding:40px">' +
        '<h2>Blink TL</h2><p>Cannot open Blink. Check your Internet connection.</p>' +
        '<p>Press Ctrl+R after reconnecting, or Alt+F4 to exit.</p></body>'));
    }
  });
  return win;
}
ipcMain.on('blink-picker:select', (event, id) => {
  if (!pickerWindow || pickerWindow.isDestroyed()) return;
  if (event.sender !== pickerWindow.webContents || !pendingPicker) return;
  if (id === '') return closePicker();
  if (typeof id === 'string' && pendingPicker.devices.has(id)) closePicker(id);
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('vn.blinktl.windows');
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}
app.on('window-all-closed', () => app.quit());

'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('blinkPicker', {
  onDevices(handler) {
    if (typeof handler === 'function') {
      ipcRenderer.on('blink-picker:devices', (_event, data) => handler(data));
    }
  },
  select(id) { ipcRenderer.send('blink-picker:select', String(id)); },
  cancel() { ipcRenderer.send('blink-picker:select', ''); }
});

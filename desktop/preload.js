'use strict';
// Safe bridge between the chooser UI (renderer) and the main process. No Node access leaks to the
// page — only these three calls are exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tassel', {
  join: (url) => ipcRenderer.invoke('join', url),
  host: (opts) => ipcRenderer.invoke('host', opts),
  stop: () => ipcRenderer.invoke('stop'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, msg) => cb(msg)),
});

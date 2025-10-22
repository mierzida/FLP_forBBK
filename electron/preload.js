const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  openFile: (options) => ipcRenderer.invoke('open-file', options),
  captureAndSave: (options) => ipcRenderer.invoke('capture-and-save', options),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  setTransparentMode: (enabled) => {
    // removed: transparency control is no longer supported
    return Promise.resolve({ success: true });
  },
  getTransparentMode: () => {
    // removed: always report transparent = true
    return Promise.resolve({ success: true, transparent: true });
  },
  // snapshot features disabled: do not provide any snapshot-reading bridge
});

// listen for main asking to capture a snapshot - renderer should respond by
// sending 'app-snapshot' IPC with serialized data
ipcRenderer.on('capture-app-snapshot', () => {
  try {
    // snapshot capture disabled; always return null
    ipcRenderer.send('app-snapshot', null);
  } catch (e) {
    console.warn('[preload] failed to read app snapshot', e);
    ipcRenderer.send('app-snapshot', null);
  }
});

// remove transparent-mode event bridge: transparency is fixed


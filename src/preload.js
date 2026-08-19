const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hermesSigil', Object.freeze({
  onEvent: handler => {
    if (typeof handler !== 'function') throw new TypeError('Event handler must be a function');
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('sigil-event', listener);
    return () => ipcRenderer.removeListener('sigil-event', listener);
  },
  setClickThrough: value => ipcRenderer.invoke('set-click-through', value),
  beginDrag: () => ipcRenderer.invoke('begin-drag'),
  endDrag: () => ipcRenderer.invoke('end-drag'),
  resizeWindow: delta => ipcRenderer.invoke('resize-window', delta),
  getSettings: () => ipcRenderer.invoke('get-settings')
}));

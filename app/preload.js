const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  addWater: (ml, type) => ipcRenderer.invoke('add-water', ml, type || 'water'),
  deleteRecord: (id) => ipcRenderer.invoke('delete-record', id),
  undoLast: () => ipcRenderer.invoke('undo-last'),
  updateSettings: (obj) => ipcRenderer.invoke('update-settings', obj),
  resume: () => ipcRenderer.invoke('resume'),
  openMain: () => ipcRenderer.invoke('open-main'),
  onStateChanged: (cb) => {
    ipcRenderer.on('stateChanged', (_, data) => cb(data));
  },
  onReminder: (cb) => {
    ipcRenderer.on('reminder', (_, data) => cb(data));
  },
});

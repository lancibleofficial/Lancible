const { contextBridge, ipcRenderer } = require('electron');

// Единственный мост между рендерером и файловой системой.
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  exportXlsx: (payload) => ipcRenderer.invoke('export:xlsx', payload),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
});

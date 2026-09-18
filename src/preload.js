const { contextBridge, ipcRenderer } = require('electron');

// Единственный мост между рендерером и файловой системой.
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  exportXlsx: (payload) => ipcRenderer.invoke('export:xlsx', payload),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  setTitlebarOverlay: (theme) => ipcRenderer.invoke('theme:set-overlay', theme),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openNotificationSettings: () => ipcRenderer.invoke('shell:open-notification-settings'),
  onOAuthCallback: (cb) => ipcRenderer.on('auth:oauth-callback', (_e, data) => cb(data)),

  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, data) => cb(data)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, data) => cb(data)),
});

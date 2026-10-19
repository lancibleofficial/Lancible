const { contextBridge, ipcRenderer } = require('electron');

// Единственный мост между рендерером и файловой системой.
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  // Несколько аккаунтов: область данных (uid | null — гость) ставится до
  // load(); список аккаунтов — accounts.json в userData (core/accounts.js).
  setDataScope: (uid) => ipcRenderer.invoke('data:scope', uid),
  dataScopes: () => ipcRenderer.invoke('data:scopes'),
  dataRemove: (uid) => ipcRenderer.invoke('data:remove', uid),
  dataPeek: (uid) => ipcRenderer.invoke('data:peek', uid),
  dataWrite: (uid, data) => ipcRenderer.invoke('data:write', uid, data),
  accountsLoad: () => ipcRenderer.invoke('accounts:load'),
  accountsSave: (acc) => ipcRenderer.invoke('accounts:save', acc),
  // Случайный id установки для журнала правок — device.json в userData.
  deviceId: () => ipcRenderer.invoke('device:id'),
  exportXlsx: (payload) => ipcRenderer.invoke('export:xlsx', payload),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  setTitlebarOverlay: (theme, colors) => ipcRenderer.invoke('theme:set-overlay', theme, colors),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openNotificationSettings: () => ipcRenderer.invoke('shell:open-notification-settings'),
  onOAuthCallback: (cb) => ipcRenderer.on('auth:oauth-callback', (_e, data) => cb(data)),
  // lancible://project/<id> и подобные: главный процесс присылает маршрут.
  onRouteOpen: (cb) => ipcRenderer.on('route:open', (_e, data) => cb(data)),

  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, data) => cb(data)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, data) => cb(data)),
});

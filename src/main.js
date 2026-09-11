const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');
const { buildWorkbook } = require('./xlsx');

// Скачивание — только по явному запросу из рендерера (кнопка "Обновить"),
// не автоматически в фоне.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

const DATA_FILE = path.join(app.getPath('userData'), 'data.json');
const LEGACY_DATA_FILE = path.join(app.getPath('appData'), 'task-timer', 'data.json');
const EMPTY_STATE = { tasks: [], activeTimer: null };

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    /* нет своего файла — пробуем данные со старого имени приложения */
  }
  try {
    if (fs.existsSync(LEGACY_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf-8'));
      saveData(data); // переносим в %APPDATA%\Lancible
      return data;
    }
  } catch {
    /* игнорируем — начнём с чистого состояния */
  }
  return structuredClone(EMPTY_STATE);
}

function saveData(data) {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_FILE); // атомарная замена, чтобы не потерять файл при сбое
}

let mainWindow = null;

// ---------------------------------------------------------------------------
// Вход через Google: signInWithOAuth открывает системный браузер, тот после
// авторизации редиректит на lancible://auth-callback — Windows либо передаёт
// эту ссылку новому процессу (перехватываем через single-instance lock и
// second-instance), либо, если приложение ещё не запущено, она приходит
// прямо в process.argv первого запуска.
// ---------------------------------------------------------------------------

if (process.defaultApp) {
  // Дев-режим (electron .) — без явного exePath/args протокол зарегистрируется
  // на сам electron.exe с неверными аргументами и не сработает.
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('lancible', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('lancible');
}

function handleAuthCallbackUrl(url) {
  if (!mainWindow) return;
  mainWindow.webContents.send('auth:oauth-callback', { url });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith('lancible://'));
    if (url) handleAuthCallbackUrl(url);
  });
}

// Цвета нативных кнопок окна (minimize/maximize/close), рисуемых Windows поверх
// страницы через titleBarOverlay, — должны совпадать с --bg/--text-dim темы,
// иначе в светлой теме там остаётся тёмный "огрызок" тёмной темы.
const TITLEBAR_DARK = { color: '#2a2b2e', symbolColor: '#b9bbc1', height: 52 };
const TITLEBAR_LIGHT = { color: '#f6f7f3', symbolColor: '#5c6152', height: 52 };

function resolveTitlebarOverlay(theme) {
  const isDark = theme === 'dark' ? true : theme === 'light' ? false : nativeTheme.shouldUseDarkColors;
  return isDark ? TITLEBAR_DARK : TITLEBAR_LIGHT;
}

function createWindow(initialData) {
  const theme = (initialData && initialData.settings && initialData.settings.theme) || 'system';
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 500,
    title: 'Lancible',
    backgroundColor: resolveTitlebarOverlay(theme).color,
    titleBarStyle: 'hidden',
    titleBarOverlay: resolveTitlebarOverlay(theme),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const src = String(sourceId).split('/').pop();
      console.log(`[renderer:${level}] ${message} (${src}:${line})`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[did-fail-load] ${code} ${desc} ${url}`);
    });
    // Меню убрано — вешаем dev-хоткеи вручную.
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12') mainWindow.webContents.toggleDevTools();
      if (input.control && input.key.toLowerCase() === 'r') mainWindow.webContents.reload();
    });
  }

  // Внешние ссылки открываем в системном браузере, а не внутри приложения.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// Автообновление (electron-updater): проверка тихая, скачивание и установка —
// только по явному действию пользователя (кнопка в интерфейсе).
// ---------------------------------------------------------------------------

function setupAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', { version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', { percent: progress.percent });
  });
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:ready');
  });
  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err);
    mainWindow?.webContents.send('update:error', { message: err.message });
  });

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' };
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
    return true;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // убираем стандартный навбар File/Edit/View/…

  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (_event, data) => {
    saveData(data);
    return true;
  });
  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });
  ipcMain.handle('theme:set-overlay', (event, theme) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setTitleBarOverlay(resolveTitlebarOverlay(theme));
    return true;
  });
  ipcMain.handle('shell:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Выгрузка в .xlsx: рендерер присылает готовые листы, тут — диалог + запись файла.
  ipcMain.handle('export:xlsx', async (event, { defaultName, sheets }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const safeName = String(defaultName || 'export').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Сохранить выгрузку',
      defaultPath: `${safeName}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, buildWorkbook(sheets));
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  setupAutoUpdater();

  createWindow(loadData());
  const initialAuthUrl = process.argv.find((arg) => arg.startsWith('lancible://'));
  if (initialAuthUrl) {
    mainWindow.webContents.once('did-finish-load', () => handleAuthCallbackUrl(initialAuthUrl));
  }
  if (app.isPackaged) {
    // Небольшая задержка, чтобы не мешать первому рендеру окна.
    setTimeout(() => autoUpdater.checkForUpdates().catch((err) => console.error('[autoUpdater] startup check:', err.message)), 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(loadData());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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

// URL, с которым приложение запустили холодным стартом (до создания окна) —
// разбирается один раз в app.whenReady() ниже, откуда бы он ни пришёл.
let pendingAuthUrl = process.argv.find((arg) => arg.startsWith('lancible://')) || null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // Windows/Linux: повторный запуск с уже открытым окном ОС передаёт как
  // новый process argv, single-instance lock перенаправляет его сюда вместо
  // создания второго окна. На маке second-instance для deep link НЕ
  // срабатывает вообще — там за это отвечает open-url (см. ниже).
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith('lancible://'));
    if (url) handleAuthCallbackUrl(url);
  });
}

// Мак: свой механизм для кастомной url-схемы, не process.argv/second-instance
// — срабатывает и на холодном старте (Electron сам буферизует событие до
// app.whenReady(), если оно пришло раньше), и пока приложение уже открыто.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) handleAuthCallbackUrl(url);
  else pendingAuthUrl = url;
});

// Цвета нативных кнопок окна (minimize/maximize/close), рисуемых Windows поверх
// страницы через titleBarOverlay, — должны совпадать с --bg/--text-dim темы,
// иначе в светлой теме там остаётся тёмный "огрызок" тёмной темы. На маке
// titleBarOverlay (с цветом/symbolColor) не поддерживается вообще —
// Electron рисует там нативные трафик-лайты без возможности перекрасить их
// фон, только позиция (см. trafficLightPosition ниже); подгонка под тему
// там — через nativeTheme.themeSource (applyNativeTheme), а не через overlay.
const TITLEBAR_DARK = { color: '#2a2b2e', symbolColor: '#b9bbc1', height: 52 };
const TITLEBAR_LIGHT = { color: '#e7ecf1', symbolColor: '#4a5560', height: 52 };
const IS_MAC = process.platform === 'darwin';

function resolveTitlebarOverlay(theme) {
  const isDark = theme === 'dark' ? true : theme === 'light' ? false : nativeTheme.shouldUseDarkColors;
  return isDark ? TITLEBAR_DARK : TITLEBAR_LIGHT;
}

// nativeTheme.themeSource — глобальный переключатель, которым на маке
// пользуется сама ОС при отрисовке трафик-лайтов (и вообще любых нативных
// элементов) под тему приложения; на Windows дублирует то же самое, что
// titleBarOverlay уже даёт явным цветом, но не мешает.
function applyNativeTheme(theme) {
  nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system';
}

function createWindow(initialData) {
  const theme = (initialData && initialData.settings && initialData.settings.theme) || 'system';
  applyNativeTheme(theme);
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 500,
    title: 'Lancible',
    backgroundColor: resolveTitlebarOverlay(theme).color,
    titleBarStyle: 'hidden',
    // Трафик-лайты позиционируем вручную (обычная высота хедера тут 52px, не
    // системная ~28px) — сдвиг под них на странице см. body.platform-mac
    // в src/renderer/styles.css.
    ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 18 } } : { titleBarOverlay: resolveTitlebarOverlay(theme) }),
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
  // Убираем стандартный навбар File/Edit/View/… — на Windows/Linux он совсем
  // не нужен (Ctrl+C/V и т.п. там работают на уровне текстовых полей сами по
  // себе). На маке же Cmd+C/Cmd+V/Cmd+Q физически завязаны на пункты меню
  // (Cut/Copy/Paste/Quit) — Menu.setApplicationMenu(null) там сломал бы даже
  // копирование текста, поэтому даём минимальное App+Edit меню только там.
  if (IS_MAC) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

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
    applyNativeTheme(theme);
    // setTitleBarOverlay существует только на Windows/Linux — на маке самого
    // метода нет смысла звать, цвет трафик-лайтов там даёт themeSource выше.
    if (!IS_MAC) {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.setTitleBarOverlay(resolveTitlebarOverlay(theme));
    }
    return true;
  });
  // Отдельный канал, а не shell:open-external: тот намеренно пропускает
  // только https, а системные настройки открываются своей схемой.
  ipcMain.handle('shell:open-notification-settings', () => {
    shell.openExternal(process.platform === 'darwin'
      ? 'x-apple.systempreferences:com.apple.preference.notifications'
      : 'ms-settings:notifications');
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
  if (pendingAuthUrl) {
    const url = pendingAuthUrl;
    mainWindow.webContents.once('did-finish-load', () => handleAuthCallbackUrl(url));
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

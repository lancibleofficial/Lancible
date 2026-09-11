const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { buildWorkbook } = require('./xlsx');

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 500,
    title: 'Lancible',
    backgroundColor: '#2a2b2e',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#2a2b2e',
      symbolColor: '#b9bbc1',
      height: 52,
    },
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');
const { buildWorkbook } = require('./xlsx');
const { deepLinkRoute } = require('./renderer/core/route.js');

// Скачивание — только по явному запросу из рендерера (кнопка "Обновить"),
// не автоматически в фоне.
// Обновление скачивается само, в фоне, сразу как только найдено: пользователь
// не должен ходить на сайт и качать установщик руками. А вот ставится оно
// только по явному нажатию — установка перезапускает приложение, и делать это
// внезапно посреди работы нельзя. По той же причине выключена установка при
// выходе: момент выхода пользователь тоже не выбирал под обновление.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

const DATA_FILE = path.join(app.getPath('userData'), 'data.json');
const LEGACY_DATA_FILE = path.join(app.getPath('appData'), 'task-timer', 'data.json');
const EMPTY_STATE = { tasks: [], activeTimer: null };
// Цвета кнопок окна, которые страница прислала в прошлый запуск (см. ниже).
const WINDOW_COLORS_FILE = path.join(app.getPath('userData'), 'window-colors.json');

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

// URL lancible://, которому некуда прийти: приложение запустили холодным
// стартом (окна ещё нет) или, на маке, закрыли окно, оставив процесс, и
// ссылка пришла после этого. createWindow() отдаёт его странице, когда та
// загрузится, откуда бы окно ни появилось: на старте или по activate.
let pendingDeepLink = process.argv.find((arg) => arg.startsWith('lancible://')) || null;

// Тот же протокол несёт и ссылки на содержимое: lancible://project/<id>,
// lancible://task/<id>, lancible://doc/<id> открывают приложение сразу на
// нужном проекте, задаче или документе. Маршрут разбирает core/route.js, окну
// он уходит каналом route:open. Всё остальное — вход через Google
// (lancible://auth-callback?code=…) и незнакомые пути — идёт по-старому
// колбэком входа: страница берёт из него код и чужое игнорирует.
function handleDeepLink(url) {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    pendingDeepLink = url;
    return;
  }
  // Страница ещё грузится (окно создано, но слушателей в ней нет): сообщение,
  // отправленное сейчас, пропало бы. Отдаём его, когда загрузка закончится.
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => deliverDeepLink(win, url));
    return;
  }
  deliverDeepLink(win, url);
}

function deliverDeepLink(win, url) {
  if (win.isDestroyed()) {
    pendingDeepLink = url;
    return;
  }
  const route = deepLinkRoute(url);
  if (route) win.webContents.send('route:open', { route });
  else win.webContents.send('auth:oauth-callback', { url });
  // Окно, которое ещё не показали (ждёт первой картинки и цветов кнопок),
  // не трогаем: reveal() покажет его сам, а focus() на маке вывел бы его
  // раньше, чем придут цвета, — с тем самым миганием, которое reveal() и
  // предотвращает. Спрашиваем reveal, а не win.isVisible(): на маке isVisible()
  // ложно и у свёрнутого, и у закрытого другим приложением окна, а их-то и
  // нужно вывести вперёд.
  if (pendingReveal.has(win)) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

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
    if (url) handleDeepLink(url);
  });
}

// Мак: свой механизм для кастомной url-схемы, не process.argv/second-instance
// — срабатывает и на холодном старте (Electron сам буферизует событие до
// app.whenReady(), если оно пришло раньше), и пока приложение уже открыто.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Нативные кнопки окна (minimize/maximize/close) Windows рисует поверх
// страницы через titleBarOverlay, и их подложка обязана совпадать с тем, что
// лежит под ними: иначе в светлой теме там остаётся тёмный «огрызок», а после
// редизайна 7 октября цвета в этом файле разошлись с шапкой совсем. Поэтому
// цветов здесь нет: окно само читает фон поверхности под кнопками (шапка или
// панель полноэкранного редактора) и цвет текста из токенов styles.css и
// присылает их в theme:set-overlay — при старте, смене темы и входе в
// полноэкранный режим. Тут — только высота полосы, та же, что у #titlebar, и
// файл window-colors.json в данных пользователя: последние присланные цвета
// по теме. Они нужны одному — создать окно сразу с верной подложкой
// (backgroundColor и кнопки), чтобы на медленном холодном старте оно не было
// белым, пока страница не прислала свои. На самом первом запуске файла ещё нет,
// и окно берёт системную подложку: констант с цветами в этом файле нет.
//
// На маке titleBarOverlay (с цветом/symbolColor) не поддерживается вообще —
// Electron рисует там нативные трафик-лайты без возможности перекрасить их
// фон, только позиция (см. trafficLightPosition ниже); подгонка под тему
// там — через nativeTheme.themeSource (applyNativeTheme), а не через overlay.
const TITLEBAR_HEIGHT = 52;
const IS_MAC = process.platform === 'darwin';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Цвета от окна — или null, если пришло что-то кроме #rrggbb: в нативный
 *  вызов уходит только проверенное. */
function overlayFromWindow(colors) {
  const hex = (v) => typeof v === 'string' && HEX_COLOR.test(v);
  if (!colors || !hex(colors.color) || !hex(colors.symbolColor)) return null;
  return { color: colors.color, symbolColor: colors.symbolColor, height: TITLEBAR_HEIGHT };
}

/** Какой темой нарисовано окно: явный выбор человека или то, что сейчас у
 *  системы. Звать после applyNativeTheme(): themeSource уже выставлен. */
function appearanceOf(theme) {
  if (theme === 'dark' || theme === 'light') return theme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function loadWindowColors() {
  try {
    const saved = JSON.parse(fs.readFileSync(WINDOW_COLORS_FILE, 'utf-8'));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

/** Запомнить присланные цвета для следующего запуска. Это подложка, а не
 *  данные: не записалось — ничего страшного, окно возьмёт системную. */
function rememberWindowColors(theme, overlay) {
  const appearance = appearanceOf(theme);
  const saved = loadWindowColors();
  const prev = saved[appearance];
  if (prev && prev.color === overlay.color && prev.symbolColor === overlay.symbolColor) return;
  saved[appearance] = { color: overlay.color, symbolColor: overlay.symbolColor };
  try {
    fs.writeFileSync(WINDOW_COLORS_FILE, JSON.stringify(saved), 'utf-8');
  } catch {
    /* нет места или прав — не страшно */
  }
}

// Окно не показывается, пока не нарисована первая страница и не пришли цвета
// кнопок: без них оно открылось бы с системной подложкой кнопок и мигнуло бы
// чужим цветом на тёмной теме. Два запасных выхода, потому что ждём двух разных
// вещей. Цвета — не дольше COLORS_WAIT_MS: не пришли, кнопки останутся с
// запомненной (или системной) подложкой, но окно из-за них не держим. Первую
// картинку ждём дальше, до жёсткого потолка PAINT_CEILING_MS: показать окно
// раньше значило бы показать пустую заливку вместо приложения; потолок нужен,
// чтобы сломанная страница не оставила человека вовсе без окна.
const COLORS_WAIT_MS = 3000;
const PAINT_CEILING_MS = 8000;
const pendingReveal = new WeakMap();
function reveal(win, what) {
  const waiting = pendingReveal.get(win);
  if (!waiting) return;
  waiting.delete(what);
  if (waiting.size === 0) {
    pendingReveal.delete(win);
    if (!win.isDestroyed()) win.show();
  }
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
  // Цвета прошлого запуска для этой же темы — или null (первый запуск, чужой
  // файл): тогда окно без своей подложки, как на самом первом запуске.
  const remembered = overlayFromWindow(loadWindowColors()[appearanceOf(theme)]);
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 500,
    title: 'Lancible',
    show: false,
    ...(remembered ? { backgroundColor: remembered.color } : {}),
    titleBarStyle: 'hidden',
    // Трафик-лайты позиционируем вручную (обычная высота хедера тут 52px, не
    // системная ~28px) — сдвиг под них на странице см. body.platform-mac
    // в src/renderer/styles.css.
    ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 18 } } : { titleBarOverlay: remembered || { height: TITLEBAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  const win = mainWindow;
  // Закрытое окно не остаётся в mainWindow: на маке процесс живёт и без окна, и
  // open-url, пришедший после закрытия, писал бы в уничтоженный объект.
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  pendingReveal.set(win, new Set(['paint', 'colors']));
  win.once('ready-to-show', () => reveal(win, 'paint'));
  setTimeout(() => reveal(win, 'colors'), COLORS_WAIT_MS);
  setTimeout(() => {
    if (pendingReveal.delete(win) && !win.isDestroyed()) win.show();
  }, PAINT_CEILING_MS);

  // Ссылка, ждавшая окна, уходит странице, когда та загрузилась и слушает.
  if (pendingDeepLink) {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    win.webContents.once('did-finish-load', () => deliverDeepLink(win, url));
  }

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

// Раз в час, пока приложение открыто. До 10 октября 2026 проверка шла один раз
// при запуске: кто не закрывал приложение сутками, сидел на старой версии,
// хотя новая давно лежала в фиде.
const UPDATE_RECHECK_MS = 60 * 60 * 1000;

// Состояние обновления держит main, а не окно: событие autoUpdater приходит
// ровно один раз, а окно можно перезагрузить или открыть позже (на маке
// приложение живёт и без окна). Окно спрашивает его через update:status и
// по нему рисует кнопку. phase: idle | downloading | ready.
const IDLE_UPDATE = { phase: 'idle', version: null, percent: 0 };
let updateStatus = IDLE_UPDATE;

// На маке окно закрывают, а процесс остаётся: тогда mainWindow уже уничтожен.
function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Одна проверка на всех: и по таймеру, и по кнопке в Настройках. Пока
// обновление качается или уже скачано, сервер не спрашиваем — ответ известен.
async function checkForUpdate() {
  if (updateStatus.phase !== 'idle') return { ok: true, available: true, version: updateStatus.version };
  const res = await autoUpdater.checkForUpdates();
  // Ошибка скачивания уже ушла событием error — отдельный обработчик тут лишь
  // не даёт ей стать необработанным отказом промиса.
  res?.downloadPromise?.catch(() => {});
  return { ok: true, available: !!res?.isUpdateAvailable, version: res?.updateInfo?.version ?? null };
}

function setupAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    updateStatus = { phase: 'downloading', version: info.version, percent: 0 };
    sendToWindow('update:available', { version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    updateStatus = { ...updateStatus, phase: 'downloading', percent: progress.percent };
    sendToWindow('update:progress', { percent: progress.percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = { phase: 'ready', version: info?.version ?? updateStatus.version, percent: 100 };
    sendToWindow('update:ready');
  });
  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err);
    // Оборванное скачивание — снова «ничего нет»: следующая проверка найдёт
    // то же обновление и начнёт заново. Уже скачанное (ready) ошибкой не
    // теряется: файл на месте, установка от сети не зависит.
    if (updateStatus.phase === 'downloading') updateStatus = IDLE_UPDATE;
    sendToWindow('update:error', { message: err.message });
  });

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' };
    try {
      return await checkForUpdate();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('update:status', () => updateStatus);
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

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (_event, data) => {
    saveData(data);
    return true;
  });
  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });
  ipcMain.handle('theme:set-overlay', (event, theme, colors) => {
    applyNativeTheme(theme);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return true;
    // В системный вызов уходит только проверенное #rrggbb. А вот ждать цвета
    // после любого ответа окна незачем: прислало что-то другое (полупрозрачный
    // фон даёт не #rrggbb, а запись с прозрачностью) — значит, оно живо и
    // лучшего не пришлёт.
    const overlay = overlayFromWindow(colors);
    if (overlay) {
      win.setBackgroundColor(overlay.color);
      // setTitleBarOverlay существует только на Windows/Linux — на маке самого
      // метода нет смысла звать, цвет трафик-лайтов там даёт themeSource выше.
      if (!IS_MAC) win.setTitleBarOverlay(overlay);
      rememberWindowColors(theme, overlay);
    }
    reveal(win, 'colors');
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
  if (app.isPackaged) {
    const quietCheck = () => checkForUpdate().catch((err) => console.error('[autoUpdater] check:', err.message));
    // Небольшая задержка, чтобы не мешать первому рендеру окна.
    setTimeout(quietCheck, 3000);
    setInterval(quietCheck, UPDATE_RECHECK_MS);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(loadData());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Автообновление в главном процессе. Запуск: npm run test:unit
//
// Откуда тест. До 10 октября 2026 main проверял обновления один раз, при
// запуске: кто не закрывал приложение сутками, сидел на старой версии, хотя
// в фиде уже лежала новая (0.4.0 при вышедших 0.4.1 и 0.4.2). Теперь проверка
// повторяется раз в час, а состояние обновления держит main и отдаёт окну по
// update:status — так кнопка «Установить» переживает перезагрузку окна.
//
// Настоящий Electron тут не нужен: src/main.js грузится с подменёнными
// electron и electron-updater. Часы тоже подменены — час проходит мгновенно.
// Что делает окно с этим состоянием, проверяют smoke (десктоп) и e2e.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const MAIN = path.join(__dirname, '..', '..', 'src', 'main.js');
const PRELOAD = path.join(__dirname, '..', '..', 'src', 'preload.js');
const HOUR = 60 * 60 * 1000;

/** main.js с подменёнными electron/electron-updater. Возвращает всё, чем
 *  тест потом управляет: обработчики IPC, «сервер обновлений», окно. */
async function boot({ packaged = true } = {}) {
  const handlers = {};
  const sent = [];
  const updater = Object.assign(new EventEmitter(), {
    checks: 0,
    // Что «сервер» ответит на проверку; fail — отказ сети, downloadFails —
    // скачивание, которое начнётся само (autoDownload), оборвётся.
    answer: { isUpdateAvailable: false, updateInfo: { version: '0.4.2' }, downloadFails: false },
    fail: null,
    // Как настоящий: update-available приходит внутри проверки, до её итога.
    async checkForUpdates() {
      this.checks += 1;
      if (this.fail) throw this.fail;
      const { isUpdateAvailable, updateInfo, downloadFails } = this.answer;
      if (isUpdateAvailable) this.emit('update-available', updateInfo);
      return { isUpdateAvailable, updateInfo, downloadPromise: downloadFails ? Promise.reject(new Error('обрыв')) : null };
    },
  });
  const win = {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    loadFile() {},
    webContents: {
      on() {}, once() {}, setWindowOpenHandler() {},
      send: (channel, payload) => sent.push([channel, payload]),
    },
  };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-main-'));
  const electron = {
    app: {
      isPackaged: packaged,
      getVersion: () => '9.8.7',
      getPath: () => userData,
      setAsDefaultProtocolClient() {},
      requestSingleInstanceLock: () => true,
      on() {}, quit() {},
      whenReady: () => Promise.resolve(),
    },
    BrowserWindow: Object.assign(function BrowserWindow() { return win; }, { getAllWindows: () => [] }),
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: true },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    shell: {}, dialog: {}, clipboard: {},
  };

  const realLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'electron') return electron;
    if (request === 'electron-updater') return { autoUpdater: updater };
    return realLoad.call(this, request, ...rest);
  };
  delete require.cache[MAIN];
  try {
    require(MAIN);
    await new Promise((r) => setImmediate(r)); // app.whenReady().then(...)
  } finally {
    Module._load = realLoad;
    delete require.cache[MAIN];
  }
  return { handlers, sent, updater, win, userData };
}

/** Этот тест гоняет main без окна: ошибки автообновления он пишет в консоль. */
function quiet(t) {
  t.mock.method(console, 'error', () => {});
}

test('каждый канал preload обслуживается в main — опечатка не доживёт до окна', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { handlers, userData } = await boot();
  const src = fs.readFileSync(PRELOAD, 'utf8');
  const channels = [...src.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(channels.includes('app:version') && channels.includes('update:status'));
  for (const ch of channels) assert.equal(typeof handlers[ch], 'function', `в main нет обработчика ${ch}`);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('app:version отдаёт app.getVersion() — ту же строку, что веб берёт из package.json', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { handlers, userData } = await boot();
  assert.equal(await handlers['app:version'](), '9.8.7');
  fs.rmSync(userData, { recursive: true, force: true });
});

test('проверка: через 3 секунды после старта и дальше раз в час', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { updater, userData } = await boot();
  assert.equal(updater.checks, 0, 'проверка не должна мешать первому рендеру окна');
  t.mock.timers.tick(3000);
  await Promise.resolve();
  assert.equal(updater.checks, 1, 'нет проверки при запуске');
  t.mock.timers.tick(HOUR);
  t.mock.timers.tick(HOUR);
  await Promise.resolve();
  assert.equal(updater.checks, 3, 'не повторяется раз в час');
  fs.rmSync(userData, { recursive: true, force: true });
});

test('в неупакованной сборке сервер не спрашивают ни по таймеру, ни по кнопке', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { updater, handlers, userData } = await boot({ packaged: false });
  t.mock.timers.tick(3 * HOUR);
  assert.equal(updater.checks, 0);
  assert.deepEqual(await handlers['update:check'](), { ok: false, reason: 'dev' });
  fs.rmSync(userData, { recursive: true, force: true });
});

test('update:check: нашлось, не нашлось, сбой сети', async (t) => {
  quiet(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { updater, handlers, userData } = await boot();
  assert.deepEqual(await handlers['update:check'](), { ok: true, available: false, version: '0.4.2' });

  updater.answer = { isUpdateAvailable: true, updateInfo: { version: '0.5.0' }, downloadFails: true };
  assert.deepEqual(await handlers['update:check'](), { ok: true, available: true, version: '0.5.0' });
  assert.equal(updater.checks, 2);

  updater.emit('error', new Error('обрыв')); // скачивание оборвалось → снова «ничего нет»
  updater.fail = new Error('нет сети');
  assert.deepEqual(await handlers['update:check'](), { ok: false, error: 'нет сети' });
  fs.rmSync(userData, { recursive: true, force: true });
});

test('update:status следует за событиями autoUpdater и пока качается — не спрашивает сервер', async (t) => {
  quiet(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { updater, handlers, sent, userData } = await boot();
  assert.deepEqual(await handlers['update:status'](), { phase: 'idle', version: null, percent: 0 });

  updater.emit('update-available', { version: '0.5.0' });
  assert.deepEqual(await handlers['update:status'](), { phase: 'downloading', version: '0.5.0', percent: 0 });
  updater.emit('download-progress', { percent: 42 });
  assert.deepEqual(await handlers['update:status'](), { phase: 'downloading', version: '0.5.0', percent: 42 });

  // Пока качается, час прошёл — сервер не трогаем, а на кнопку отвечаем из состояния.
  t.mock.timers.tick(HOUR);
  assert.equal(updater.checks, 0);
  assert.deepEqual(await handlers['update:check'](), { ok: true, available: true, version: '0.5.0' });

  updater.emit('update-downloaded', { version: '0.5.0' });
  assert.deepEqual(await handlers['update:status'](), { phase: 'ready', version: '0.5.0', percent: 100 });
  t.mock.timers.tick(HOUR);
  assert.equal(updater.checks, 0, 'скачанное обновление перепроверять незачем');

  // Скачанное ошибка не отменяет: файл на месте.
  updater.emit('error', new Error('сеть'));
  assert.equal((await handlers['update:status']()).phase, 'ready');

  // Окно получает те же события, что и раньше, — а состояние теперь ещё и в main.
  assert.deepEqual(sent.map(([channel]) => channel),
    ['update:available', 'update:progress', 'update:ready', 'update:error']);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('оборванное скачивание забывается, и следующая проверка идёт заново', async (t) => {
  quiet(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { updater, handlers, userData } = await boot();
  t.mock.timers.tick(3000);
  await Promise.resolve();
  updater.emit('update-available', { version: '0.5.0' });
  updater.emit('error', new Error('обрыв'));
  assert.equal((await handlers['update:status']()).phase, 'idle');
  t.mock.timers.tick(HOUR);
  await Promise.resolve();
  assert.equal(updater.checks, 2, 'после ошибки час спустя проверка не возобновилась');
  fs.rmSync(userData, { recursive: true, force: true });
});

test('закрытое окно (мак держит процесс без окна) не роняет события обновления', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { updater, win, sent, handlers, userData } = await boot();
  win.destroyed = true;
  assert.doesNotThrow(() => updater.emit('update-available', { version: '0.5.0' }));
  assert.deepEqual(sent, []);
  // Состояние при этом копится: открытое позже окно спросит его через update:status.
  assert.equal((await handlers['update:status']()).phase, 'downloading');
  fs.rmSync(userData, { recursive: true, force: true });
});

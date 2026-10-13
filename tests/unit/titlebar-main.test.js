// Окно и его кнопки в главном процессе. Запуск: npm run test:unit
//
// Откуда тест. До 10 октября 2026 main.js красил подложку нативных кнопок
// окна (titleBarOverlay) своими константами; после редизайна они разошлись с
// шапкой, а в полноэкранном редакторе подложка должна быть другой вовсе.
// Теперь цвета присылает окно (theme:set-overlay), а main только проверяет их,
// передаёт системе и запоминает для следующего запуска — и не показывает окно,
// пока не нарисована первая страница и не пришли цвета, иначе оно мигнуло бы
// чужим цветом.
//
// Вторая половина — жизнь окна: на маке процесс живёт и без окна, и ссылка
// входа (lancible://…), пришедшая после его закрытия, не должна писать в
// уничтоженный объект, а должна дождаться нового окна.
//
// Настоящий Electron не нужен: src/main.js грузится с подменёнными electron и
// electron-updater, как в updater.test.js. Что окно присылает и совпадает ли
// это с тем, что под кнопками, проверяет смоук (scripts/smoke.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const MAIN = path.join(__dirname, '..', '..', 'src', 'main.js');

/** Как у настоящего: уничтоженное окно на любое обращение отвечает ошибкой. */
function makeWindow(options) {
  const alive = (w) => { if (w.destroyed) throw new Error('Object has been destroyed'); };
  const handlers = { win: {}, contents: {} };
  const on = (bucket) => (event, cb) => { (handlers[bucket][event] ||= []).push(cb); };
  const win = {
    options,
    shown: false,
    destroyed: false,
    backgroundColor: null,
    overlay: null,
    overlayCalls: 0,
    sent: [],
    focused: 0,
    minimized: false,
    loading: true, // страница грузится, пока тест не позовёт load()
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.shown; },
    isMinimized() { alive(this); return this.minimized; },
    restore() { alive(this); this.minimized = false; },
    focus() { alive(this); this.focused += 1; },
    show() { alive(this); this.shown = true; },
    once: on('win'),
    on: on('win'),
    loadFile() {},
    setBackgroundColor(c) { alive(this); this.backgroundColor = c; },
    setTitleBarOverlay(o) { alive(this); this.overlay = o; this.overlayCalls += 1; },
    webContents: {
      isLoading() { return win.loading; },
      on: on('contents'),
      once: on('contents'),
      setWindowOpenHandler() {},
      send(channel, payload) { alive(win); win.sent.push({ channel, payload }); },
    },
    /** Событие окна (ready-to-show, closed) или страницы (did-finish-load). */
    emit(event, bucket = 'win') { (handlers[bucket][event] || []).forEach((cb) => cb()); },
    /** Закрыть окно как Electron: объект уничтожен, потом приходит closed. */
    close() { this.destroyed = true; this.emit('closed'); },
    paint() { this.emit('ready-to-show'); },
    load() { this.loading = false; this.emit('did-finish-load', 'contents'); },
  };
  return win;
}

/** main.js с подменённым electron. platform — под какую систему грузить;
 *  userData — общая папка данных (второй запуск того же пользователя);
 *  theme — что записано в настройках; argv — аргументы холодного старта. */
async function boot({ platform = 'win32', userData: dir, theme, argv = [], dark = true } = {}) {
  const ipc = {};
  const appHandlers = {};
  const windows = [];
  const userData = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-titlebar-'));
  if (theme) {
    fs.writeFileSync(path.join(userData, 'data.json'), JSON.stringify({ tasks: [], activeTimer: null, settings: { theme } }));
  }
  const nativeTheme = { themeSource: 'system', shouldUseDarkColors: dark };
  const electron = {
    app: {
      isPackaged: false,
      getVersion: () => '9.8.7',
      getPath: () => userData,
      setAsDefaultProtocolClient() {},
      requestSingleInstanceLock: () => true,
      on(event, cb) { (appHandlers[event] ||= []).push(cb); },
      quit() {},
      whenReady: () => Promise.resolve(),
    },
    BrowserWindow: Object.assign(function BrowserWindow(options) {
      const win = makeWindow(options);
      windows.push(win);
      return win;
    }, {
      getAllWindows: () => windows.filter((w) => !w.destroyed),
      fromWebContents: () => windows[windows.length - 1],
    }),
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
    nativeTheme,
    ipcMain: { handle: (channel, fn) => { ipc[channel] = fn; } },
    shell: {}, dialog: {}, clipboard: {},
  };

  const realLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'electron') return electron;
    if (request === 'electron-updater') return { autoUpdater: Object.assign(new EventEmitter(), { checkForUpdates: async () => ({}) }) };
    return realLoad.call(this, request, ...rest);
  };
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const realArgv = process.argv;
  Object.defineProperty(process, 'platform', { value: platform });
  process.argv = [...realArgv, ...argv];
  delete require.cache[MAIN];
  try {
    require(MAIN);
    await new Promise((r) => setImmediate(r)); // app.whenReady().then(...)
  } finally {
    Module._load = realLoad;
    Object.defineProperty(process, 'platform', realPlatform);
    process.argv = realArgv;
    delete require.cache[MAIN];
  }
  return {
    handlers: ipc, windows, nativeTheme, userData,
    get win() { return windows[0]; },
    created: { get options() { return windows[windows.length - 1].options; } },
    paint: () => windows[windows.length - 1].paint(),
    /** Событие самого приложения: open-url, activate. */
    emitApp: (event, ...args) => (appHandlers[event] || []).forEach((cb) => cb(...args)),
    cleanup: () => fs.rmSync(userData, { recursive: true, force: true }),
  };
}

const COLORS = { color: '#111215', symbolColor: '#aeb1ba' };
const LIGHT = { color: '#eceef1', symbolColor: '#45454d' };
const event = { sender: {} };
const URL_A = 'lancible://auth-callback?code=aaa';
const URL_B = 'lancible://auth-callback?code=bbb';

test('первый запуск: окно скрыто и без подложки — запомненных цветов ещё нет', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { created, win, cleanup } = await boot();
  assert.equal(created.options.show, false);
  assert.equal(created.options.backgroundColor, undefined, 'цвет фона зашит в main');
  assert.deepEqual(created.options.titleBarOverlay, { height: 52 }, 'кнопки окна включены без цвета, одна высота полосы');
  assert.equal(win.shown, false);
  cleanup();
});

test('цвета из окна уходят в setTitleBarOverlay и в фон окна — те же, что пришли', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { handlers, win, nativeTheme, cleanup } = await boot();
  assert.equal(await handlers['theme:set-overlay'](event, 'dark', COLORS), true);
  assert.deepEqual(win.overlay, { ...COLORS, height: 52 });
  assert.equal(win.backgroundColor, COLORS.color);
  assert.equal(nativeTheme.themeSource, 'dark');
  await handlers['theme:set-overlay'](event, 'light', LIGHT);
  assert.deepEqual(win.overlay, { ...LIGHT, height: 52 }, 'смена темы перекрашивает кнопки');
  await handlers['theme:set-overlay'](event, 'system', COLORS);
  assert.equal(nativeTheme.themeSource, 'system');
  cleanup();
});

test('в системный вызов уходит только #rrggbb: всё остальное отбрасывается', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { handlers, win, userData, cleanup } = await boot();
  const bad = [
    undefined, null, 'dark', {}, { color: '#111215' }, { symbolColor: '#aeb1ba' },
    { color: 'red', symbolColor: '#aeb1ba' }, { color: '#111', symbolColor: '#aeb1ba' },
    { color: '#111215', symbolColor: 'rgb(1, 2, 3)' }, { color: '#11121500', symbolColor: '#aeb1ba' },
    { color: { toString: () => '#111215' }, symbolColor: '#aeb1ba' },
    { color: ['#111215'], symbolColor: '#aeb1ba' }, // регулярка сама приводит к строке
    { color: '#111215', symbolColor: 42 },
  ];
  for (const colors of bad) await handlers['theme:set-overlay'](event, 'dark', colors);
  assert.equal(win.overlayCalls, 0);
  assert.equal(win.backgroundColor, null);
  assert.equal(fs.existsSync(path.join(userData, 'window-colors.json')), false, 'чужое не запоминается');
  cleanup();
});

test('любой вызов от окна снимает ожидание цветов, но окно ждёт первую картинку', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  // Полупрозрачный фон даёт rgba(...), а не #rrggbb: main его не применяет, но
  // окно оно открыть обязано, а не держать до запасного выхода.
  const translucent = await boot();
  await translucent.handlers['theme:set-overlay'](event, 'dark', { color: 'rgba(17, 18, 21, 0.5)', symbolColor: '#aeb1ba' });
  assert.equal(translucent.win.overlayCalls, 0, 'rgba в нативный вызов не уходит');
  assert.equal(translucent.win.shown, false, 'картинки ещё нет — рано');
  translucent.paint();
  assert.equal(translucent.win.shown, true, 'ответ был, пусть и негодный: цвета ждать больше нечего');
  translucent.cleanup();

  // Порядок обратный: картинка уже есть, цвета непригодные.
  const nothing = await boot();
  nothing.paint();
  assert.equal(nothing.win.shown, false);
  await nothing.handlers['theme:set-overlay'](event, 'dark', undefined);
  assert.equal(nothing.win.shown, true);
  nothing.cleanup();
});

test('окно показывается, когда есть и первая картинка, и цвета — в любом порядке', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const first = await boot();
  first.paint();
  assert.equal(first.win.shown, false, 'картинка есть, цветов нет — рано');
  await first.handlers['theme:set-overlay'](event, 'dark', COLORS);
  assert.equal(first.win.shown, true);
  first.cleanup();

  const second = await boot();
  await second.handlers['theme:set-overlay'](event, 'dark', COLORS);
  assert.equal(second.win.shown, false, 'цвета есть, картинки нет — рано');
  second.paint();
  assert.equal(second.win.shown, true);
  second.cleanup();
});

test('цвета так и не пришли: через 3 секунды их ждать перестаём, картинку — нет', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const ready = await boot();
  ready.paint();
  t.mock.timers.tick(2900);
  assert.equal(ready.win.shown, false);
  t.mock.timers.tick(200);
  assert.equal(ready.win.shown, true, 'картинка есть, цветов нет: через 3 с окно открывается');
  ready.cleanup();

  // Медленный старт: через 3 с страница ещё не нарисована. Показывать пустую
  // заливку нельзя — ждём картинку, пока не придёт.
  const slow = await boot();
  t.mock.timers.tick(3100);
  assert.equal(slow.win.shown, false, 'картинки нет — окно не показываем, цвета тут ни при чём');
  slow.paint();
  assert.equal(slow.win.shown, true, 'как только картинка есть, окно открывается без цветов');
  slow.cleanup();
});

test('картинки нет вовсе: жёсткий потолок 8 секунд, иначе человек остался бы без окна', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { win, cleanup } = await boot();
  t.mock.timers.tick(7900);
  assert.equal(win.shown, false);
  t.mock.timers.tick(200);
  assert.equal(win.shown, true, 'без потолка сломанная страница оставила бы человека без окна');
  cleanup();
});

test('закрытое до показа окно таймеры не трогают', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { win, cleanup } = await boot();
  win.close();
  t.mock.timers.tick(9000); // show() у уничтоженного окна бросил бы ошибку
  assert.equal(win.shown, false);
  cleanup();
});

test('второй запуск: окно создаётся сразу с запомненной подложкой своей темы', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const first = await boot();
  await first.handlers['theme:set-overlay'](event, 'dark', COLORS);
  await first.handlers['theme:set-overlay'](event, 'light', LIGHT);
  const { userData } = first;
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'window-colors.json'), 'utf8'));
  assert.deepEqual(saved, { dark: COLORS, light: LIGHT }, 'по теме, и только цвета');

  const dark = await boot({ userData, theme: 'dark' });
  assert.equal(dark.created.options.backgroundColor, COLORS.color, 'тёмная тема — тёмный фон до первой картинки');
  assert.deepEqual(dark.created.options.titleBarOverlay, { ...COLORS, height: 52 });
  assert.equal(dark.created.options.show, false, 'подложка не заменяет ожидание картинки');

  const light = await boot({ userData, theme: 'light' });
  assert.equal(light.created.options.backgroundColor, LIGHT.color);
  assert.deepEqual(light.created.options.titleBarOverlay, { ...LIGHT, height: 52 });

  // «Системная» тема — по тому, что сейчас у ОС.
  const systemDark = await boot({ userData, theme: 'system', dark: true });
  assert.equal(systemDark.created.options.backgroundColor, COLORS.color);
  const systemLight = await boot({ userData, theme: 'system', dark: false });
  assert.equal(systemLight.created.options.backgroundColor, LIGHT.color);

  // Тема, для которой цветов ещё не присылали, остаётся без подложки.
  const half = await boot({ theme: 'light' });
  await half.handlers['theme:set-overlay'](event, 'dark', COLORS);
  const other = await boot({ userData: half.userData, theme: 'light' });
  assert.equal(other.created.options.backgroundColor, undefined);
  half.cleanup();

  first.cleanup();
});

test('запомненное проверяется так же, как присланное: чужой файл подложки не даёт', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lancible-titlebar-'));
  for (const content of ['не json', 'null', '[]', '{"dark":{"color":"red","symbolColor":"#aeb1ba"}}', '{"dark":"#111215"}']) {
    fs.writeFileSync(path.join(userData, 'window-colors.json'), content);
    const run = await boot({ userData, theme: 'dark' });
    assert.equal(run.created.options.backgroundColor, undefined, `файл «${content}»`);
    assert.deepEqual(run.created.options.titleBarOverlay, { height: 52 });
  }
  fs.rmSync(userData, { recursive: true, force: true });
});

test('на маке подложку кнопок не трогаем — там трафик-лайты, а цвет фона ставится', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { created, handlers, win, cleanup } = await boot({ platform: 'darwin' });
  assert.equal(created.options.titleBarOverlay, undefined);
  assert.deepEqual(created.options.trafficLightPosition, { x: 14, y: 18 });
  await handlers['theme:set-overlay'](event, 'dark', COLORS);
  assert.equal(win.overlayCalls, 0, 'setTitleBarOverlay на маке не звать');
  assert.equal(win.backgroundColor, COLORS.color);
  cleanup();
});

test('в main.js нет ни одного цвета: он приходит из окна, а источник — токены styles.css', () => {
  // Цвет в этом файле — это снова константа, которая разойдётся с шапкой.
  // Шаблон проверки присланного (HEX_COLOR) — не цвет: в нём нет цифр.
  const src = fs.readFileSync(MAIN, 'utf8').replace(/\r\n/g, '\n');
  const colors = [...src.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0]);
  assert.deepEqual(colors, [], `цвета в main.js: ${colors.join(', ')}`);
});

test('npm test гоняет и смоук: без него кнопки окна и полноэкранный редактор проверяются только руками', () => {
  // Всё, что доказывает подложку кнопок, место под ними и зоны перетаскивания
  // (no-drag у панели редактора), живёт в scripts/smoke.js — в настоящем окне
  // Electron. В npm test его не было, и такие проверки зеленели только у того,
  // кто не забыл запустить их сам. В CI смоука нет (там нет дисплея), поэтому
  // общий прогон на машине разработчика — единственное место.
  const { scripts } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.equal(scripts.smoke, 'electron scripts/smoke.js');
  assert.match(scripts.test, /npm run smoke\b/, 'npm test — «всё целиком», и смоук десктопа в нём тоже');
});

// --- ссылка входа и жизнь окна ------------------------------------------------

test('закрытое окно не остаётся в mainWindow: ссылка входа ждёт нового окна по activate', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ platform: 'darwin' });
  const first = app.win;
  first.load();
  first.close();
  assert.equal(app.windows.length, 1);

  // На маке окно закрыли, процесс остался, и пришла ссылка. Раньше она шла в
  // уничтоженное окно и роняла main-процесс ошибкой «Object has been destroyed».
  let prevented = 0;
  app.emitApp('open-url', { preventDefault: () => { prevented += 1; } }, URL_A);
  assert.equal(prevented, 1);
  assert.deepEqual(first.sent, [], 'в уничтоженное окно ничего не пишется');

  app.emitApp('activate');
  assert.equal(app.windows.length, 2, 'клик по значку в доке открыл новое окно');
  const second = app.windows[1];
  assert.deepEqual(second.sent, [], 'страница ещё не загрузилась и слушать не начала');
  second.load();
  assert.deepEqual(second.sent, [{ channel: 'auth:oauth-callback', payload: { url: URL_A } }], 'ссылка ушла новому окну после загрузки');
  assert.equal(second.focused, 0, 'окно ещё не показано: фокус не отнимаем, его покажет reveal');

  // Ссылка пришла один раз и не повторяется на следующем окне.
  second.close();
  app.emitApp('activate');
  const third = app.windows[2];
  third.load();
  assert.deepEqual(third.sent, []);

  // А пока окно есть, ссылка идёт ему сразу.
  app.emitApp('open-url', { preventDefault() {} }, URL_B);
  assert.deepEqual(third.sent, [{ channel: 'auth:oauth-callback', payload: { url: URL_B } }]);
  app.cleanup();
});

test('холодный старт со ссылкой: она уходит окну, когда страница загрузилась', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ argv: [URL_A] });
  assert.deepEqual(app.win.sent, [], 'до загрузки страницы слать рано');
  app.win.load();
  assert.deepEqual(app.win.sent, [{ channel: 'auth:oauth-callback', payload: { url: URL_A } }]);
  app.cleanup();
});

test('ссылка из open-url на холодном старте (мак буферизует её до готовности) тоже доходит', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ platform: 'darwin' });
  app.win.load();
  app.emitApp('open-url', { preventDefault() {} }, URL_A);
  assert.deepEqual(app.win.sent, [{ channel: 'auth:oauth-callback', payload: { url: URL_A } }]);
  app.cleanup();
});

// --- ссылки на проект, задачу и документ --------------------------------------
//
// Тот же протокол lancible:// несёт не только вход через Google: ссылка на
// проект, задачу или документ открывает приложение сразу на нём. Главный
// процесс разбирает путь (core/route.js) и присылает окну маршрут каналом
// route:open; вход идёт по-старому, колбэком.

const LINK_PROJECT = 'lancible://project/p-1';

/** Окно показано: первая картинка есть и цвета пришли. */
async function showWindow(app) {
  app.paint();
  await app.handlers['theme:set-overlay'](event, 'dark', COLORS);
  assert.equal(app.win.shown, true);
}
const ROUTE_PROJECT = { channel: 'route:open', payload: { route: { view: 'project', id: 'p-1', tab: 'list' } } };

test('lancible://project/<id> при открытом окне уходит ему маршрутом, а не колбэком входа', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot();
  app.win.load();
  await showWindow(app);

  // Windows/Linux: второй запуск приходит как second-instance с argv.
  app.emitApp('second-instance', {}, ['Lancible.exe', LINK_PROJECT]);
  assert.deepEqual(app.win.sent, [ROUTE_PROJECT]);
  assert.equal(app.win.focused, 1, 'окно выходит вперёд');

  app.win.minimized = true;
  app.emitApp('second-instance', {}, ['Lancible.exe', 'lancible://task/t-9']);
  assert.deepEqual(app.win.sent[1], { channel: 'route:open', payload: { route: { view: 'task', id: 't-9' } } });
  assert.equal(app.win.minimized, false, 'свёрнутое окно разворачивается');

  // Мак: open-url.
  app.emitApp('open-url', { preventDefault() {} }, 'lancible://doc/d-3');
  assert.deepEqual(app.win.sent[2], { channel: 'route:open', payload: { route: { view: 'docs', id: 'd-3' } } });
  assert.equal(app.win.sent.filter((m) => m.channel === 'auth:oauth-callback').length, 0, 'ни одна не ушла как вход');
  app.cleanup();
});

test('холодный старт со ссылкой на проект: маршрут уходит окну, когда страница загрузилась', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ argv: [LINK_PROJECT] });
  assert.deepEqual(app.win.sent, [], 'до загрузки страницы слать рано: слушателя ещё нет');
  app.win.load();
  assert.deepEqual(app.win.sent, [ROUTE_PROJECT]);
  app.cleanup();
});

test('ссылка пришла, пока страница ещё грузится: уходит окну после did-finish-load, а не теряется', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ platform: 'darwin' });
  // Окно уже есть (mainWindow задан), но слушателя route:open у страницы нет.
  app.emitApp('open-url', { preventDefault() {} }, LINK_PROJECT);
  app.emitApp('second-instance', {}, ['Lancible.exe', URL_A]);
  assert.deepEqual(app.win.sent, [], 'пока страница грузится, слать рано');
  assert.equal(app.win.focused, 0);

  app.win.load();
  assert.deepEqual(app.win.sent, [
    ROUTE_PROJECT,
    { channel: 'auth:oauth-callback', payload: { url: URL_A } },
  ], 'обе дошли и в том порядке, в каком пришли');

  // Загрузка кончилась: следующая ссылка идёт сразу, без ожидания.
  app.emitApp('open-url', { preventDefault() {} }, 'lancible://task/t-9');
  assert.equal(app.win.sent.length, 3);
  app.cleanup();
});

test('окно, которое ещё не показано, ссылка не фокусирует: на маке focus() вывел бы его до прихода цветов', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ platform: 'darwin' });
  app.win.load();
  assert.equal(app.win.shown, false, 'скрыто: ждёт картинки и цветов');
  app.emitApp('open-url', { preventDefault() {} }, LINK_PROJECT);
  assert.deepEqual(app.win.sent, [ROUTE_PROJECT], 'маршрут окну уходит и в скрытом виде');
  assert.equal(app.win.focused, 0, 'скрытое окно не фокусируется');
  assert.equal(app.win.shown, false, 'и ссылка сама окно не показывает: это дело reveal');

  await showWindow(app);
  app.emitApp('open-url', { preventDefault() {} }, 'lancible://task/t-9');
  assert.equal(app.win.focused, 1, 'показанное окно выходит вперёд, как раньше');
  app.cleanup();
});

test('холодный старт со ссылкой: окно не фокусируется, пока скрыто, а ссылка всё равно доходит', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ argv: [LINK_PROJECT] });
  app.win.load();
  assert.deepEqual(app.win.sent, [ROUTE_PROJECT]);
  assert.equal(app.win.focused, 0);
  app.cleanup();
});

test('мак: ссылка на задачу пришла, пока окна нет, — ждёт нового окна и приходит ему один раз', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot({ platform: 'darwin' });
  app.win.load();
  app.win.close();
  app.emitApp('open-url', { preventDefault() {} }, 'lancible://task/t-9');
  assert.deepEqual(app.win.sent, [], 'в уничтоженное окно ничего не пишется');

  app.emitApp('activate');
  const second = app.windows[1];
  second.load();
  assert.deepEqual(second.sent, [{ channel: 'route:open', payload: { route: { view: 'task', id: 't-9' } } }]);

  second.close();
  app.emitApp('activate');
  app.windows[2].load();
  assert.deepEqual(app.windows[2].sent, [], 'ссылка пришла один раз');
  app.cleanup();
});

test('вход через Google работает как прежде, ссылки на проект ему не мешают', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot();
  app.win.load();
  app.emitApp('open-url', { preventDefault() {} }, LINK_PROJECT);
  app.emitApp('open-url', { preventDefault() {} }, URL_A);
  app.emitApp('second-instance', {}, ['Lancible.exe', URL_B]);
  assert.deepEqual(app.win.sent, [
    ROUTE_PROJECT,
    { channel: 'auth:oauth-callback', payload: { url: URL_A } },
    { channel: 'auth:oauth-callback', payload: { url: URL_B } },
  ]);
  app.cleanup();
});

test('неизвестный путь маршрутом не становится: окно не уводят никуда', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = await boot();
  app.win.load();
  for (const url of ['lancible://garbage', 'lancible://project', 'lancible://project/', 'lancible://task']) {
    app.emitApp('open-url', { preventDefault() {} }, url);
  }
  assert.equal(app.win.sent.filter((m) => m.channel === 'route:open').length, 0);
  app.cleanup();
});

test('preload отдаёт странице route:open, а main — только проверенные маршруты из core/route.js', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload.js'), 'utf8');
  assert.match(preload, /onRouteOpen: \(cb\) => ipcRenderer\.on\('route:open'/);
  const main = fs.readFileSync(MAIN, 'utf8');
  assert.match(main, /require\('\.\/renderer\/core\/route\.js'\)/, 'разбор — один, в ядре, а не второй в main.js');
});

// Десктоп целиком, в Electron без окна. Запуск: npm run smoke
//
// Что здесь, а что в e2e. Экраны и их поведение подробно проверяет
// tests/e2e/ в браузере. Здесь — то, чего браузер не видит: preload и IPC
// (данные приходят из main-процесса и уходят туда же, выгрузка Excel пишет
// файл через main, рамка окна узнаёт о теме, кнопка обновления слушает
// события автообновления) и сквозной путь человека по настоящему окну.
// Итог — scripts/smoke-result.json; код выхода 0 только если прошло всё.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { buildWorkbook } = require('../src/xlsx');

const RESULT = path.join(__dirname, 'smoke-result.json');
const errors = [];
const exportsWritten = [];

// --- падать громко, а не висеть ---------------------------------------------
//
// До 10 октября 2026 прогон висел вечно. Проверки звали getComputedStyle и
// .click() на элементах, которых после редизайна нет; исключение внутри окна
// отклоняло executeJavaScript, его никто не ловил, app.quit() не вызывался.
// Теперь каждый шаг в окне ловит свою ошибку и возвращает её с именем шага,
// а пропавший элемент называется селектором (need). Сторож гасит прогон,
// если тот всё-таки повис. Любая проверка, вернувшая false, роняет итог.

/** Предел на весь прогон. Нормальный прогон укладывается в 15–20 секунд. */
const DEADLINE_MS = 120_000;

/** Помощник внутри окна: элемент или громкая ошибка с селектором. */
const PAGE_HELPERS = "const need = (s) => { const e = document.querySelector(s); if (!e) throw new Error('нет элемента ' + s); return e; };";

function finish(result) {
  clearTimeout(watchdog);
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2), 'utf-8');
  console.log('SMOKE RESULT:', JSON.stringify(result, null, 2));
  if (!result.ok) console.error(`SMOKE FAILED: ${result.fatal || `не прошли: ${result.failed.join(', ')}`}`);
  app.exit(result.ok ? 0 : 1);
}

function fail(message) {
  finish({ ok: false, fatal: message, failed: [], errors });
}

const watchdog = setTimeout(
  () => fail(`прогон не закончился за ${DEADLINE_MS / 1000} с — где-то ждёт элемента или события`),
  DEADLINE_MS,
);

/** Шаг в окне. Electron отдаёт наружу только «Script failed to execute»,
 *  поэтому ошибка ловится внутри страницы и возвращается текстом. */
async function inPage(win, name, code) {
  const wrapped = `(async () => { ${PAGE_HELPERS} try { return await (${code}); } catch (e) { return { __smokeError: String((e && e.message) || e) }; } })()`;
  const res = await win.webContents.executeJavaScript(wrapped);
  if (res && typeof res === 'object' && res.__smokeError) throw new Error(`${name}: ${res.__smokeError}`);
  return res;
}

/** Имена проверок, вернувших false: их список и есть причина провала. */
const falseChecks = (group, obj) => Object.entries(obj).filter(([, v]) => v === false).map(([k]) => `${group}.${k}`);

let store = {
  projects: [{ id: 'old-p', name: 'Старый проект', createdAt: '2026-08-20T10:00:00.000Z' }],
  tasks: [{
    id: 'old1', projectId: 'old-p', title: 'Старая задача', done: false, notes: null, totalMs: 3_600_000,
    sessions: [{ start: '2026-09-05T10:00:00.000Z', end: '2026-09-05T11:00:00.000Z', ms: 3_600_000 }],
    createdAt: '2026-09-01T00:00:00.000Z',
  }],
  activeTimer: null,
  ui: { projectId: 'old-p' },
  settings: { hourlyRate: 1000, currency: '₽' },
};

// Что окно сообщило о кнопках окна: { theme, colors } на каждый вызов.
let overlayCalls = [];
const lastOverlay = () => overlayCalls[overlayCalls.length - 1];
// Задержка ответа на data:load: пока она не нулевая, окно ещё грузит данные.
// Нужна одной проверке — ссылке lancible://, пришедшей до конца запуска.
let loadDelayMs = 0;
ipcMain.handle('data:load', async () => {
  if (loadDelayMs) await new Promise((r) => setTimeout(r, loadDelayMs));
  return store;
});
ipcMain.handle('data:save', (_e, d) => { store = d; return true; });
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('theme:set-overlay', (_e, theme, colors) => { overlayCalls.push({ theme, colors }); return true; });
// Что main отвечает окну про обновление: состояние (update:status) и итог
// ручной проверки (update:check). Смоук подменяет их, как и остальной IPC.
let updateStatus = { phase: 'idle', version: null, percent: 0 };
let updateCheckAnswer = { ok: true, available: false, version: '0.0.0' };
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', () => updateCheckAnswer);
ipcMain.handle('update:status', () => updateStatus);
ipcMain.handle('update:download', () => ({ ok: true }));
ipcMain.handle('update:install', () => true);
ipcMain.handle('shell:open-external', () => true);
ipcMain.handle('export:xlsx', (_e, { defaultName, sheets }) => {
  const buf = buildWorkbook(sheets);
  const file = path.join(__dirname, `_smoke-export-${exportsWritten.length + 1}.xlsx`);
  fs.writeFileSync(file, buf);
  exportsWritten.push({ file, defaultName, sheetCount: sheets.length });
  return { ok: true, filePath: file };
});

/** Контраст по WCAG 2 между двумя цветами #rrggbb. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Помощники внутри окна для проверки кнопок окна: что на самом деле лежит
 *  под ними (верхний правый угол) и какую ширину они занимают. */
const TITLEBAR_PRELUDE = String.raw`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (c) => '#' + c.match(/[\d.]+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  const bare = /^(transparent|rgba\(.*,\s*0\))$/;
  const under = () => {
    for (let n = document.elementFromPoint(innerWidth - 20, 10); n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (!bare.test(c)) return hex(c);
    }
    return null;
  };
  const controlsWidth = () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;height:1px;width:calc(100vw - env(titlebar-area-width, 100vw))';
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  // Зона перетаскивания окна. -webkit-app-region не наследуется: у кнопки
  // внутри no-drag-контейнера вычисленное значение — 'none', а действует
  // значение контейнера (его рамка и есть область). Поэтому «чей это регион»
  // ищется вверх по предкам, а надёжность — тем, что рамка владельца накрывает
  // элемент целиком и сам он идёт в документе ПОСЛЕ шапки: no-drag вычитает из
  // drag только позднейшее, раньше шапки он не помог бы.
  const region = (el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim();
  const regionOwner = (el) => {
    for (let n = el; n; n = n.parentElement) { const v = region(n); if (v && v !== 'none') return { value: v, owner: n }; }
    return { value: 'none', owner: null };
  };
  const noDragOver = (el) => {
    const { value, owner } = regionOwner(el);
    if (value !== 'no-drag') return false;
    const o = owner.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const covered = r.left >= o.left - 0.5 && r.right <= o.right + 0.5 && r.top >= o.top - 0.5 && r.bottom <= o.bottom + 0.5;
    const afterTitlebar = !!(document.getElementById('titlebar').compareDocumentPosition(owner) & Node.DOCUMENT_POSITION_FOLLOWING);
    return covered && afterTitlebar;
  };
`;

app.whenReady().then(async () => {
  try {
    await run();
  } catch (err) {
    fail(err.message);
  }
});

async function run() {
  const win = new BrowserWindow({
    show: false, titleBarStyle: 'hidden',
    // Как в src/main.js: на Windows и Linux кнопки окна — поверх страницы, и
    // страница узнаёт их ширину через env(titlebar-area-width). Окно скрыто,
    // но полоса считается: проверено, что ширина приходит и без показа.
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { height: 52 } }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      partition: 'nopersist:smoke',
      // Окно скрыто, а скрытому Chromium не даёт requestAnimationFrame: накладная
      // полоса прокрутки (attachOverlayScroll) рисуется в кадре и без этого не
      // появилась бы.
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    const entry = `[${level}] ${message} (${String(src).split('/').pop()}:${line})`;
    if (level >= 2) errors.push(entry);
    console.log(entry);
  });
  win.webContents.on('did-fail-load', (_e, c, d, u) => errors.push(`did-fail-load ${c} ${d} ${u}`));

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  // --- разметка окна ---------------------------------------------------------
  //
  // С 10 октября проверяются только устойчивые части — то, без чего десктоп
  // не работает. Подробности вида и поведения экранов — забота e2e
  // (tests/e2e/), которые гоняются на каждой правке; здесь у них был
  // устаревший дубль, и он-то и вешал прогон после редизайна.
  const probe = await inPage(win, 'разметка', `(() => ({
    shellPresent: !!document.getElementById('shell'),
    navHasAllViews: ['home', 'projects', 'docs', 'time', 'settings']
      .every((v) => !!document.querySelector('.nav-item[data-view="' + v + '"]')),
    editorWrapPresent: !!document.getElementById('editor-wrap'),
    sdlgUsesButtons: !!document.getElementById('sdlg-date-btn') && !document.getElementById('sdlg-date'),
    datePickerPresent: !!document.getElementById('dp-pop'),
    timePickerPresent: !!document.getElementById('tp-pop'),
    themeTabsPresent: document.querySelectorAll('.theme-tab').length === 3,
    langSelectRemoved: !document.getElementById('lang-select'),
    langTogglePresent: !!document.getElementById('lang-toggle'),
    updateBtnHiddenByDefault: need('#update-btn').hidden === true,
    supabaseClientLoaded: typeof window.supabase === 'object' && typeof window.supabase.createClient === 'function',
    accountBtnPresent: !!document.getElementById('account-btn'),
    authModalPresent: !!document.getElementById('auth-backdrop'),
    googleBtnPresent: !!document.getElementById('auth-google-btn'),
  }))()`);

  // --- сценарий: тем же путём, что и человек ---------------------------------
  const flow = await inPage(win, 'сценарий', `(async () => {
    const out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const visible = (el) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]');
    const typeInto = (sel, value) => {
      const input = need(sel);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const pickMenu = (text) => {
      const item = [...document.querySelectorAll('#ctx-menu .ctx-item')].find((b) => b.textContent.includes(text));
      if (!item) throw new Error('в меню нет пункта «' + text + '»');
      item.click();
    };

    // Данные пришли из main-процесса (data:load), а не из пустого состояния.
    out.storeLoadedFromMain = state.projects.some((p) => p.name === 'Старый проект');

    // --- язык: свой выпадающий список, а не системный <select> ---
    const homeLabel = () => need('.nav-item[data-view="home"] [data-i18n="nav.home"]').textContent.trim();
    out.defaultLangIsRu = homeLabel() === Core.T.ru['nav.home'];
    need('#lang-toggle').click();
    await wait(40);
    out.langMenuHasFourLanguages = document.querySelectorAll('#ctx-menu .ctx-item').length === 4;
    pickMenu('English');
    await wait(60);
    out.navTranslatedToEnglish = homeLabel() === Core.T.en['nav.home'];
    need('#lang-toggle').click();
    await wait(40);
    pickMenu('Русский');
    await wait(60);
    out.navBackToRussian = homeLabel() === Core.T.ru['nav.home'];

    // --- тема: три вкладки; рамку окна main-процесс узнаёт через IPC ---
    const html = document.documentElement;
    need('.theme-tab[data-theme="light"]').click();
    await wait(30);
    out.themeBecomesLight = html.getAttribute('data-theme') === 'light';
    need('.theme-tab[data-theme="dark"]').click();
    await wait(30);
    out.themeBecomesDark = html.getAttribute('data-theme') === 'dark';
    need('.theme-tab[data-theme="system"]').click();
    await wait(30);
    out.themeBackToSystem = !html.hasAttribute('data-theme');

    // --- проект и три задачи ---
    openView('projects');
    await wait(60);
    const createBtn = [...document.querySelectorAll('#create-project-btn, #home-empty-create')].find(visible);
    if (!createBtn) throw new Error('нет видимой кнопки «Создать проект» (#create-project-btn, #home-empty-create)');
    createBtn.click();
    await wait(60);
    typeInto('#pdlg-name', 'Проект №2');
    need('#pdlg-save').click();
    await wait(100);
    out.projectOpensAfterCreate = visible(need('#project-view')) && /Проект №2/.test(need('#project-view').textContent);
    for (const title of ['Задача A', 'Задача B', 'Задача C']) {
      need('#new-task-btn').click();
      await wait(60);
      typeInto('#task-title', title);
      need('#task-back').click();
      await wait(60);
    }
    out.projectListsThreeTasks = document.querySelectorAll('#task-list .task-item').length === 3;

    // --- таймер: старт и стоп пишут запись времени ---
    const taskA = [...document.querySelectorAll('#task-list .task-item')].find((t) => /Задача A/.test(t.textContent));
    if (!taskA) throw new Error('в #task-list нет «Задача A»');
    taskA.click();
    await wait(80);
    const label = () => need('#timer-btn-label').textContent.trim();
    out.timerShowsStart = label() === Core.T.ru['timer.start'];
    need('#timer-btn').click();
    await wait(1100);
    out.timerShowsStop = label() === Core.T.ru['timer.stop'];
    need('#timer-btn').click();
    await wait(80);
    const a = state.tasks.find((t) => t.title === 'Задача A');
    out.sessionRecorded = !!a && a.sessions.length === 1 && a.sessions[0].ms >= 1000;

    // --- запись времени вручную: свои дата и время, не системные поля ---
    need('.task-tabs button[data-tab="history"]').click();
    await wait(40);
    need('#add-session-btn').click();
    await wait(60);
    out.sessionDialogOpens = !need('#sdlg-backdrop').hidden;
    need('#sdlg-date-btn').click();
    await wait(40);
    out.datePickerOpens = !need('#dp-pop').hidden;
    need('#sdlg-cancel').click();
    await wait(40);
    out.sessionDialogCloses = need('#sdlg-backdrop').hidden;

    // --- теги: через настройки, как человек ---
    openView('settings');
    await wait(60);
    need('#tags-add').click();
    await wait(60);
    out.tagDialogOpens = !need('#tagdlg-backdrop').hidden;
    typeInto('#tagdlg-name', 'Срочное');
    need('#tagdlg-save').click();
    await wait(60);
    out.tagCreated = state.tags.some((t) => t.name === 'Срочное');

    // --- окно входа: открывается и закрывается без сети ---
    need('#account-btn').click();
    await wait(40);
    out.authModalOpens = !need('#auth-backdrop').hidden;
    need('#auth-cancel').click();
    await wait(40);
    out.authModalCloses = need('#auth-backdrop').hidden;

    // --- выгрузка проекта: файл пишет main-процесс (export:xlsx) ---
    const p2 = state.projects.find((p) => p.name === 'Проект №2');
    openProject(p2.id);
    await wait(80);
    need('#export-project-btn').click();
    await wait(200);

    // --- окно «Экспорт в Excel»: ядро выгрузки (core/export.js) подключено в
    // desktop-разметке, поля показывают период и проекты, «Отмена» закрывает ---
    openExportPeriodDialog();
    await wait(60);
    out.exportDialogOpens = !need('#expdlg-backdrop').hidden;
    out.exportDialogFields = need('#exp-period').textContent.trim() === t('export.period_all')
      && need('#exp-projects').textContent.trim() === t('filter.all_projects');
    out.exportDialogSummary = need('#exp-summary').textContent.trim().length > 0;
    need('#expdlg-cancel').click();
    await wait(40);
    out.exportDialogCloses = need('#expdlg-backdrop').hidden;

    return out;
  })()`);

  // Сохранение дошло до main-процесса (data:save): задачи лежат в его копии.
  // Сохраняет приложение с задержкой 400 мс (scheduleSave) — ждём дольше.
  await new Promise((r) => setTimeout(r, 800));
  flow.savedThroughMain = store.tasks.filter((t) => /^Задача [ABC]$/.test(t.title)).length === 3;

  await new Promise((r) => setTimeout(r, 200));

  // --- версия и ручная проверка обновлений: подвал Настроек ---
  //
  // Версию окно получает от main (app:version), а ссылка «Проверить
  // обновления» есть только на десктопе. Строки ниже записаны буквально, по
  // той же причине, что и у кнопки обновления: см. комментарий дальше.
  const appVersion = app.getVersion();
  const footer = await inPage(win, 'подвал настроек', `(async () => {
    openView('settings');
    await new Promise((r) => setTimeout(r, 60));
    const link = need('#settings-update-check');
    const out = {
      version: need('#settings-version').textContent,
      apiVersion: await window.api.getVersion(),
      statusPhase: (await window.api.getUpdateStatus()).phase,
      linkVisible: link.getClientRects().length > 0 && !link.closest('[hidden]'),
      linkLabel: link.textContent,
    };
    link.click();
    await new Promise((r) => setTimeout(r, 120));
    out.afterCheckLabel = link.textContent;
    return out;
  })()`);
  flow.footerShowsVersion = footer.version === `Lancible · ${appVersion}` && footer.apiVersion === appVersion;
  flow.updateStatusAnswers = footer.statusPhase === 'idle';
  flow.updateCheckLinkVisible = footer.linkVisible === true && footer.linkLabel === 'Проверить обновления';
  flow.updateCheckSaysLatest = footer.afterCheckLabel === 'Установлена последняя версия';

  // --- автообновление: кнопка реагирует на события из главного процесса ---
  win.webContents.send('update:available', { version: '9.9.9' });
  await new Promise((r) => setTimeout(r, 60));
  const updateAfterAvailable = await inPage(win, 'обновление: доступно', `
    JSON.stringify({ hidden: need('#update-btn').hidden, label: need('#update-btn-label').textContent })
  `);
  win.webContents.send('update:progress', { percent: 42 });
  await new Promise((r) => setTimeout(r, 30));
  win.webContents.send('update:ready');
  await new Promise((r) => setTimeout(r, 30));
  const updateAfterReady = await inPage(win, 'обновление: готово', `
    JSON.stringify({ label: need('#update-btn-label').textContent })
  `);
  flow.updateBtnShowsOnAvailable = !JSON.parse(updateAfterAvailable).hidden;
  // Строка должна совпадать с ключом update.ready из core/i18n.js. Здесь она
  // записана буквально намеренно: проверка обязана падать, если текст кнопки
  // поменяли не подумав, а не подстраиваться под него молча.
  flow.updateBtnLabelMatchesReady = JSON.parse(updateAfterReady).label === 'Установить и перезапустить';

  // Состояние переживает перезагрузку окна: событие «готово» пришло давно,
  // окно его не помнит, но main помнит и отвечает на update:status.
  updateStatus = { phase: 'ready', version: '9.9.9', percent: 100 };
  const reloaded = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.reload();
  await reloaded;
  await new Promise((r) => setTimeout(r, 800));
  const afterReload = await inPage(win, 'обновление: после перезагрузки', `
    JSON.stringify({ hidden: need('#update-btn').hidden, label: need('#update-btn-label').textContent, link: need('#settings-update-check').textContent })
  `);
  const restored = JSON.parse(afterReload);
  flow.updateBtnRestoredAfterReload = !restored.hidden && restored.label === 'Установить и перезапустить'
    && restored.link === 'Установить и перезапустить';

  // --- адреса экранов: последний экран и lancible:// -----------------------
  //
  // Всё про хэш и историю подробно проверяет tests/e2e/routes.spec.js в
  // браузере. Здесь — то, чего он не видит: pushState в окне, загруженном из
  // файла (Chromium пускает его на file:// только пока меняется один хэш),
  // последний экран, который свежий запуск берёт из сохранённых данных —
  // хэша у него нет, — и маршрут lancible://, который main присылает каналом
  // route:open (сам main проверяет tests/unit/titlebar-main.test.js).
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const routes = {};
  const first = await inPage(win, 'адреса: переходы', `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const a = state.tasks.find((t) => t.title === 'Задача A');
    const before = history.length;
    openProject(a.projectId);
    selectTask(a.id);
    await wait(100);
    const taskHash = '#/task/' + encodeURIComponent(a.id);
    const projectHash = '#/project/' + encodeURIComponent(a.projectId);
    const out = {
      pushedOnFile: location.protocol === 'file:' && location.hash === taskHash && history.length === before + 2,
      lastScreenRemembered: state.ui.route === taskHash,
      titleNamesTask: document.title === 'Задача A — Lancible',
      exposesRouteChannel: typeof window.api.onRouteOpen === 'function',
      // Десктоп копирует ссылку на боевую веб-версию, а не на file://.
      copiedLinkIsWeb: routeUrl({ view: 'task', id: a.id }) === 'https://lancible.vercel.app/app/' + taskHash,
    };
    history.back();
    await wait(150);
    out.backOpensProject = !need('#project-view').hidden && location.hash === projectHash;
    history.forward();
    await wait(150);
    out.forwardOpensTask = !need('#task-view').hidden && location.hash === taskHash;
    return { out, taskHash };
  })()`);
  Object.assign(routes, first.out);

  // Сохранение с задержкой 400 мс: последний экран доходит до main (data:save).
  await wait(800);
  routes.lastScreenSavedThroughMain = !!store.ui && store.ui.route === first.taskHash;

  // Обновление окна: хэш остаётся в адресе, экран — тот же.
  const afterReloadHash = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.reload();
  await afterReloadHash;
  await wait(800);
  const reloadedAt = await inPage(win, 'адреса: обновление', `({ hash: location.hash, task: !need('#task-view').hidden })`);
  routes.reloadKeepsScreen = reloadedAt.task && reloadedAt.hash === first.taskHash;

  // Свежий запуск: хэша нет, экран берётся из сохранённого.
  const freshLoaded = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await freshLoaded;
  await wait(800);
  const fresh = await inPage(win, 'адреса: свежий запуск', `({ hash: location.hash, task: !need('#task-view').hidden })`);
  routes.freshLaunchRestoresLastScreen = fresh.task && fresh.hash === first.taskHash;

  // Холодный старт со ссылкой: lancible:// приходит, пока окно ещё грузит
  // данные (ответ на data:load задержан), и ждёт конца запуска.
  loadDelayMs = 700;
  const coldLoaded = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.once('dom-ready', () => win.webContents.send('route:open', { route: { view: 'project', id: 'old-p', tab: 'board' } }));
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await coldLoaded;
  await wait(1800);
  loadDelayMs = 0;
  const cold = await inPage(win, 'адреса: холодный старт по lancible://', `({ hash: location.hash, board: !need('#proj-board').hidden })`);
  routes.coldStartDeepLinkWaitsForLaunch = cold.board && cold.hash === '#/project/old-p/board';

  // lancible://project/<id> из main: окно открывает проект; чужой id — «Сегодня».
  win.webContents.send('route:open', { route: { view: 'project', id: 'old-p', tab: 'list' } });
  await wait(300);
  const deep = await inPage(win, 'адреса: lancible://', `({ hash: location.hash, project: !need('#project-view').hidden, name: need('#ph-name').textContent })`);
  routes.deepLinkOpensProject = deep.project && deep.hash === '#/project/old-p' && deep.name === 'Старый проект';
  win.webContents.send('route:open', { route: { view: 'task', id: 'нет-такой' } });
  await wait(300);
  const unknown = await inPage(win, 'адреса: lancible:// с чужим id', `({ hash: location.hash, home: !need('#home-view').hidden })`);
  routes.deepLinkWithUnknownIdOpensToday = unknown.home && unknown.hash === '#/today';

  // --- кнопки окна: подложка и место под ними ------------------------------
  //
  // Браузер не видит ни нативных кнопок окна, ни env(titlebar-area-*), поэтому
  // это проверяется здесь, в настоящем окне. До 10 октября 2026 подложку
  // кнопок красил main.js своими константами, и после редизайна они разошлись
  // с шапкой; теперь цвет приходит из окна. Мерило — не код приложения, а то,
  // что реально лежит под кнопками: elementFromPoint в верхнем правом углу.
  // Что утверждается, в обеих темах:
  //   · цвет, который окно сообщило main-процессу, равен фону под кнопками;
  //   · символы кнопок читаются на нём (контраст не ниже 4.5:1);
  //   · то же в полноэкранном редакторе — под кнопками теперь его панель;
  //   · кнопка «Выйти из полного экрана» не заходит под кнопки окна;
  //   · Esc выходит из полного экрана, а подложка возвращается к шапке.
  const titlebar = {};
  const titlebarDetail = {};
  for (const theme of ['dark', 'light']) {
    const shell = await inPage(win, `кнопки окна (${theme}): шапка`, `(async () => {
      ${TITLEBAR_PRELUDE}
      need('.theme-tab[data-theme="${theme}"]').click();
      await wait(80);
      const a = state.tasks.find((t) => t.title === 'Задача A');
      openProject(a.projectId);
      selectTask(a.id);
      // Страница задачи выезжает анимацией, а пока у предка есть transform,
      // position: fixed считается от него, а не от окна — полный экран
      // «встал бы» не туда. Человек жмёт «во весь экран» позже; замеру ждать
      // некогда, поэтому анимации выключаются.
      if (!document.getElementById('smoke-calm')) {
        const calm = document.createElement('style');
        calm.id = 'smoke-calm';
        calm.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
        document.head.append(calm);
      }
      await wait(150);
      return { under: under(), region: region(need('#titlebar')) };
    })()`);
    const shellCall = lastOverlay();
    titlebar[`${theme}_titlebarDrags`] = shell.region === 'drag';
    titlebar[`${theme}_shellColorMatches`] = !!shellCall && shellCall.theme === theme && shellCall.colors.color === shell.under;
    titlebar[`${theme}_symbolsReadable`] = !!shellCall && contrast(shellCall.colors.color, shellCall.colors.symbolColor) >= 4.5;

    const full = await inPage(win, `кнопки окна (${theme}): полный экран`, `(async () => {
      ${TITLEBAR_PRELUDE}
      need('#editor-wrap .led-toolbar-end button').click();
      await wait(150);
      const toolbar = need('#editor-wrap .led-toolbar');
      return {
        fullscreen: need('#editor-wrap .led').classList.contains('led-fullscreen'),
        under: under(),
        controls: controlsWidth(),
        width: innerWidth,
        exit: rect(need('#editor-wrap .led-toolbar-end button')),
        first: rect(toolbar.querySelector('button')),
        toolbar: rect(toolbar),
        padding: getComputedStyle(toolbar).paddingRight + ' / ' + getComputedStyle(toolbar).paddingLeft,
        traffic: parseFloat(getComputedStyle(need('html')).getPropertyValue('--traffic-w')),
        // Шапка под редактором остаётся зоной перетаскивания, поэтому всё, что
        // лежит над ней, обязано быть no-drag: иначе щелчок мышью уйдёт окну.
        // button.click() этого не ловит — он минует мышь.
        titlebarRegion: region(need('#titlebar')),
        editorNoDrag: noDragOver(need('#editor-wrap .led')),
        toolbarNoDrag: noDragOver(toolbar),
        // Только кнопки в строке: что не влезло, лежит в меню групп (hidden),
        // у скрытой кнопки нет прямоугольника, и проверять над ней нечего.
        buttons: [...toolbar.querySelectorAll('button')].filter((b) => b.offsetParent !== null).length,
        buttonsNoDrag: [...toolbar.querySelectorAll('button')].filter((b) => b.offsetParent !== null).filter(noDragOver).length,
      };
    })()`);
    const fullCall = lastOverlay();
    titlebar[`${theme}_fullscreenEditorNoDrag`] = full.editorNoDrag === true;
    titlebar[`${theme}_fullscreenToolbarNoDrag`] = full.toolbarNoDrag === true;
    titlebar[`${theme}_fullscreenButtonsNoDrag`] = full.buttons > 0 && full.buttonsNoDrag === full.buttons;
    titlebar[`${theme}_titlebarStillDragsUnderneath`] = full.titlebarRegion === 'drag';
    titlebar[`${theme}_fullscreenOpens`] = full.fullscreen === true;
    titlebar[`${theme}_fullscreenColorMatches`] = !!fullCall && fullCall !== shellCall && fullCall.colors.color === full.under;
    titlebar[`${theme}_fullscreenSymbolsReadable`] = !!fullCall && contrast(fullCall.colors.color, fullCall.colors.symbolColor) >= 4.5;
    if (process.platform === 'darwin') {
      // На маке «светофор» слева: панель начинается правее него.
      titlebar[`${theme}_exitClearOfWindowButtons`] = full.first.left >= full.traffic;
    } else {
      // Кнопки окна справа: ширина должна прийти (иначе проверять нечего) и
      // «Выйти» стоит левее них.
      titlebar[`${theme}_windowButtonsMeasured`] = full.controls > 0;
      titlebar[`${theme}_exitClearOfWindowButtons`] = full.exit.right <= full.width - full.controls + 0.5;
    }
    titlebarDetail[theme] = { shell: shell.under, shellCall, full, fullCall };

    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await new Promise((r) => setTimeout(r, 200));
    const back = await inPage(win, `кнопки окна (${theme}): Esc`, `(async () => {
      ${TITLEBAR_PRELUDE}
      return { fullscreen: need('#editor-wrap .led').classList.contains('led-fullscreen'), under: under() };
    })()`);
    titlebar[`${theme}_escExitsFullscreen`] = back.fullscreen === false;
    const backCall = lastOverlay();
    titlebar[`${theme}_shellColorReturns`] = !!backCall && backCall !== fullCall && backCall.colors.color === back.under && back.under === shell.under;
  }
  // Остальные слои, что могут лечь на верхние 52 px: меню, всплывающие панели и
  // коробки диалогов тоже no-drag (правило «Слои поверх шапки» в styles.css).
  const layers = await inPage(win, 'слои поверх шапки', `(() => {
    ${TITLEBAR_PRELUDE}
    const out = {};
    for (const cls of ['ctx-menu', 'tag-pop', 'tp-pop', 'dp-pop', 'color-pop', 'modal']) {
      const probe = document.createElement('div');
      probe.className = cls;
      document.body.append(probe);
      out['.' + cls] = region(probe);
      probe.remove();
    }
    out['#notif-panel'] = region(need('#notif-panel'));
    return out;
  })()`);
  titlebar.overlaysNoDrag = Object.values(layers).every((v) => v === 'no-drag');
  titlebarDetail.layers = layers;
  titlebar.themesDiffer = titlebarDetail.dark.shell !== titlebarDetail.light.shell;
  titlebar.callsCarryHexColors = overlayCalls.length > 0 && overlayCalls.every((c) => c.colors
    && /^#[0-9a-f]{6}$/.test(c.colors.color) && /^#[0-9a-f]{6}$/.test(c.colors.symbolColor));
  if (Object.values(titlebar).some((v) => v === false)) console.log('TITLEBAR DETAIL:', JSON.stringify(titlebarDetail));

  // --- полоса прокрутки: в настоящем окне тоже своя, а нативная скрыта --------
  //
  // Подробно полоса проверена в e2e (tests/e2e/scrollbar.spec.js) на браузере;
  // здесь — что в Electron то же: у прокручиваемой области (длинное меню)
  // нативной полосы нет и места под неё никто не резервирует, а при прокрутке
  // поверх содержимого, у правого края области, появляется своя дорожка.
  const scrollbar = await inPage(win, 'полоса прокрутки', `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    openMenu(need('#lang-toggle'), Array.from({ length: 60 }, (_, i) => ({ label: 'Пункт ' + i, onClick() {} })));
    const m = need('#ctx-menu');
    await wait(100);
    out.menuScrolls = m.scrollHeight > m.clientHeight;
    out.areaAttached = m.hasAttribute('data-ovs');
    out.nativeBarHidden = m.offsetWidth - m.clientWidth - 2 * m.clientLeft === 0;
    out.noGutterReserved = getComputedStyle(m).scrollbarGutter === 'auto';
    out.noTrackAtRest = !document.querySelector('.ovs-track.on');
    m.scrollTop = 80;
    // Дорожка зажигается по событию прокрутки и кадру отрисовки, а в скрытом
    // окне кадры редки: фиксированные 300 мс то хватали, то нет. Ждём опросом,
    // до двух секунд.
    const shown = () => { const t = document.querySelector('.ovs-track.on'); return t && getComputedStyle(t).visibility === 'visible' ? t : null; };
    for (let i = 0; i < 40 && !shown(); i++) await wait(50);
    const track = document.querySelector('.ovs-track.on');
    const r = m.getBoundingClientRect();
    out.trackAppearsOnScroll = !!track && getComputedStyle(track).visibility === 'visible';
    out.trackOverContentAtRightEdge = !!track && Math.abs(track.getBoundingClientRect().right - r.right) <= 1.5;
    const thumb = track && track.firstElementChild.getBoundingClientRect();
    out.thumbInsideTrack = !!thumb && thumb.top >= track.getBoundingClientRect().top - 0.5 && thumb.bottom <= track.getBoundingClientRect().bottom + 0.5;
    closeMenu();
    return out;
  })()`);

  const unzip = (buf) => {
    const files = {};
    let i = 0;
    while (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const comp = buf.readUInt32LE(i + 18);
      const nl = buf.readUInt16LE(i + 26);
      const el2 = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + nl).toString('utf8');
      const start = i + 30 + nl + el2;
      const body = buf.slice(start, start + comp);
      files[name] = (method === 8 ? zlib.inflateRawSync(body) : body).toString('utf8');
      i = start + comp;
    }
    return files;
  };
  const exportOk = exportsWritten.length > 0 && (() => {
    try { unzip(fs.readFileSync(exportsWritten[0].file)); return true; } catch { return false; }
  })();

  const result = {
    probe,
    flow,
    routes,
    exportOk,
    overlaySyncedOnThemeChange: overlayCalls.some((c) => c.theme === 'light') && overlayCalls.some((c) => c.theme === 'dark'),
    titlebar,
    scrollbar,
    errors,
  };
  result.failed = [
    ...falseChecks('probe', probe),
    ...falseChecks('flow', flow),
    ...falseChecks('routes', routes),
    ...falseChecks('titlebar', titlebar),
    ...falseChecks('scrollbar', scrollbar),
    ...(exportOk ? [] : ['exportOk']),
    ...(result.overlaySyncedOnThemeChange ? [] : ['overlaySyncedOnThemeChange']),
  ];
  result.ok = errors.length === 0 && result.failed.length === 0;
  finish(result);
}

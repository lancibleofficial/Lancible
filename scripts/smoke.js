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

let overlayCalls = [];
ipcMain.handle('data:load', () => store);
ipcMain.handle('data:save', (_e, d) => { store = d; return true; });
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('theme:set-overlay', (_e, theme) => { overlayCalls.push(theme); return true; });
ipcMain.handle('update:check', () => ({ ok: false, reason: 'dev' }));
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
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      partition: 'nopersist:smoke',
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

    return out;
  })()`);

  // Сохранение дошло до main-процесса (data:save): задачи лежат в его копии.
  // Сохраняет приложение с задержкой 400 мс (scheduleSave) — ждём дольше.
  await new Promise((r) => setTimeout(r, 800));
  flow.savedThroughMain = store.tasks.filter((t) => /^Задача [ABC]$/.test(t.title)).length === 3;

  await new Promise((r) => setTimeout(r, 200));

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
    exportOk,
    overlaySyncedOnThemeChange: overlayCalls.includes('light') && overlayCalls.includes('dark'),
    errors,
  };
  result.failed = [
    ...falseChecks('probe', probe),
    ...falseChecks('flow', flow),
    ...(exportOk ? [] : ['exportOk']),
    ...(result.overlaySyncedOnThemeChange ? [] : ['overlaySyncedOnThemeChange']),
  ];
  result.ok = errors.length === 0 && result.failed.length === 0;
  finish(result);
}

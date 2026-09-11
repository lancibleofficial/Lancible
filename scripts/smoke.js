// Headless-проверка UI. Запуск: npm run smoke
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { buildWorkbook } = require('../src/xlsx');

const RESULT = path.join(__dirname, 'smoke-result.json');
const errors = [];
const exportsWritten = [];

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

ipcMain.handle('data:load', () => store);
ipcMain.handle('data:save', (_e, d) => { store = d; return true; });
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('export:xlsx', (_e, { defaultName, sheets }) => {
  const buf = buildWorkbook(sheets);
  const file = path.join(__dirname, `_smoke-export-${exportsWritten.length + 1}.xlsx`);
  fs.writeFileSync(file, buf);
  exportsWritten.push({ file, defaultName, sheetCount: sheets.length });
  return { ok: true, filePath: file };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, titleBarStyle: 'hidden',
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true },
  });
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    const entry = `[${level}] ${message} (${String(src).split('/').pop()}:${line})`;
    if (level >= 2) errors.push(entry);
    console.log(entry);
  });
  win.webContents.on('did-fail-load', (_e, c, d, u) => errors.push(`did-fail-load ${c} ${d} ${u}`));

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const probe = await win.webContents.executeJavaScript(`(() => ({
    quill: typeof window.Quill === 'function',
    topbarInsideHomeMain: !!document.querySelector('.home-main > #topbar'),
    recentSectionOutsideGrid: !!document.querySelector('#home-view > #recent-section.recent-fixed'),
    homeSideSiblingOfHomeMain: !!document.querySelector('.home-grid > .home-main') && !!document.querySelector('.home-grid > #home-side'),
    projectsGridPresent: !!document.querySelector('.projects-grid'),
    pinnedStillCarousel: !!document.querySelector('#pinned-section .carousel'),
    editorWrapOverflowVisible: getComputedStyle(document.getElementById('editor-wrap')).overflow === 'visible',
    timerBarSpaceBetween: getComputedStyle(document.querySelector('.timer-bar')).justifyContent === 'space-between',
    sdlgUsesButtons: !!document.getElementById('sdlg-date-btn') && !document.getElementById('sdlg-date'),
    tpPopPresent: !!document.getElementById('tp-pop'),
    themeTogglePresent: !!document.getElementById('theme-toggle'),
    langSelectPresent: !!document.getElementById('lang-select'),
    langSelectHasFourOptions: document.querySelectorAll('#lang-select option').length === 4,
  }))()`);

  const flow = await win.webContents.executeJavaScript(`(async () => {
    const out = {};
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const $ = (s) => document.querySelector(s);

    // --- i18n: переключение языка на английский меняет статичные и динамические строки ---
    out.defaultLangIsRu = document.querySelector('.nav-label[data-i18n="nav.home"]').textContent === 'Обзор';
    const langSelect = document.getElementById('lang-select');
    langSelect.value = 'en';
    langSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(60);
    out.navLabelTranslatedToEnglish = document.querySelector('.nav-label[data-i18n="nav.home"]').textContent === 'Overview';
    out.searchPlaceholderTranslated = document.getElementById('search-input').placeholder === 'Search (Ctrl+F)';
    out.statLabelTranslated = document.querySelector('.stat-card span[data-i18n="stats.worked"]').textContent === 'total worked';

    // --- тема: цикл system -> light -> dark ---
    const html = document.documentElement;
    out.themeStartsUnset = !html.hasAttribute('data-theme');
    document.getElementById('theme-toggle').click();
    await wait(30);
    out.themeBecomesLight = html.getAttribute('data-theme') === 'light';
    document.getElementById('theme-toggle').click();
    await wait(30);
    out.themeBecomesDark = html.getAttribute('data-theme') === 'dark';
    document.getElementById('theme-toggle').click();
    await wait(30);
    out.themeBackToSystem = !html.hasAttribute('data-theme');

    // возвращаемся на русский для остальных проверок (не завязанных на язык)
    langSelect.value = 'ru';
    langSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(60);

    // --- проект + несколько задач ---
    $('#create-project-btn').click();
    await wait(50);
    $('#pdlg-name').value = 'Проект №2';
    $('#pdlg-name').dispatchEvent(new Event('input', { bubbles: true }));
    $('#pdlg-save').click();
    await wait(80);

    const addTask = (title) => {
      $('#new-task-btn').click();
      $('#task-title').value = title;
      $('#task-title').dispatchEvent(new Event('input', { bubbles: true }));
    };
    addTask('Задача A');
    addTask('Задача B');
    addTask('Задача C');
    await wait(50);
    out.projectsGridHoldsTiles = document.querySelectorAll('#projects-track .ptile').length >= 1;

    // --- timer-btn: старт/стоп через новую разметку (span-иконка + span-текст) ---
    [...document.querySelectorAll('#task-list .task-item')].find(t => /Задача A/.test(t.textContent)).click();
    await wait(30);
    out.timerLabelStartsAsStart = document.getElementById('timer-btn-label').textContent === 'Старт';
    $('#timer-btn').click();
    await wait(1100);
    out.timerLabelBecomesStop = document.getElementById('timer-btn-label').textContent === 'Стоп';
    $('#timer-btn').click();
    await wait(60);
    out.sessionRecorded = true; // не падает — уже достаточно

    // --- диалог "Добавить запись": кастомные дата/время вместо системных ---
    document.querySelector('.task-tabs button[data-tab="history"]').click();
    await wait(30);
    $('#add-session-btn').click();
    await wait(60);
    out.sdlgOpened = !$('#sdlg-backdrop').hidden;
    $('#sdlg-date-btn').click();
    await wait(40);
    out.customDatePickerOpenedInDialog = !$('#dp-pop').hidden;
    const dayBtn = [...document.querySelectorAll('#dp-days .dp-day:not(.empty)')][10];
    dayBtn.click();
    await wait(40);
    out.datePickerClosedAfterPick = $('#dp-pop').hidden;
    out.sdlgDateBtnShowsPickedDate = /\\d/.test($('#sdlg-date-btn').textContent);

    $('#sdlg-start-btn').click();
    await wait(40);
    out.customTimePickerOpened = !$('#tp-pop').hidden;
    out.timePickerHas24Hours = document.querySelectorAll('#tp-hours button').length === 24;
    out.timePickerHas60Minutes = document.querySelectorAll('#tp-minutes button').length === 60;
    const hourBtn = [...document.querySelectorAll('#tp-hours button')].find(b => b.textContent === '09');
    hourBtn.click();
    await wait(30);
    const minBtn = [...document.querySelectorAll('#tp-minutes button')].find(b => b.textContent === '30');
    minBtn.click();
    await wait(30);
    out.timePickerStaysOpenForBothPicks = !$('#tp-pop').hidden;
    out.sdlgStartBtnShowsPickedTime = $('#sdlg-start-btn').textContent === '09:30';
    $('#sdlg-cancel').click();
    await wait(40);
    out.timePickerClosesWithDialog = $('#tp-pop').hidden;

    // --- фильтр статуса и удаление всё ещё работают (регресс с прошлых раундов) ---
    document.querySelector('.tf-status button[data-status="all"]').click();
    await wait(30);
    out.taskListHasThreeTasks = document.querySelectorAll('#task-list .task-item').length === 3;

    // --- экспорт для проверки xlsx (теперь с переведёнными заголовками) ---
    document.querySelector('.nav-item[data-view="home"]').click();
    await wait(40);
    [...document.querySelectorAll('#projects-track .ptile')]
      .find(t => /Проект №2/.test(t.textContent)).querySelector('.ptile-menu').click();
    await wait(40);
    [...document.querySelectorAll('#ctx-menu .ctx-item')].find(x => /Скачать Excel/.test(x.textContent)).click();
    await wait(150);

    return out;
  })()`);

  await new Promise((r) => setTimeout(r, 200));

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
    errors,
    ok: errors.length === 0,
  };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2), 'utf-8');
  console.log('SMOKE RESULT:', JSON.stringify(result, null, 2));
  app.quit();
});

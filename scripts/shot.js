// Скриншоты. Запуск: npm run shot → preview-home.png / preview-calendar.png / preview-project.png
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const now = Date.now();
const day = 86400000;
// сессии за последние ~3 недели, привязанные к дате
const S = (daysAgo, hour, ms) => {
  const d = new Date(now - daysAgo * day);
  d.setHours(hour, 0, 0, 0);
  return { start: d.toISOString(), end: new Date(d.getTime() + ms).toISOString(), ms, rate: null };
};

const demo = {
  projects: [
    { id: 'p1', name: 'Сайт клиента', color: '#5ec8f2', description: 'Лендинг + личный кабинет на React. Дедлайн — конец месяца.', createdAt: new Date(now - 22 * day).toISOString(), pinnedAt: new Date(now - 3 * day).toISOString() },
    { id: 'p2', name: 'Мобильное приложение', color: '#b98cf0', description: 'MVP для стартапа, Flutter.', createdAt: new Date(now - 40 * day).toISOString(), pinnedAt: null },
    { id: 'p3', name: 'Личное', color: '#f5c451', description: '', createdAt: new Date(now - 12 * day).toISOString(), pinnedAt: null },
    { id: 'p4', name: 'Консультации', color: '#87ff65', description: 'Почасовые созвоны.', createdAt: new Date(now - 60 * day).toISOString(), pinnedAt: null },
    { id: 'p5', name: 'Дизайн-система', color: '#f0736b', description: 'Библиотека компонентов.', createdAt: new Date(now - 15 * day).toISOString(), pinnedAt: null },
    { id: 'p6', name: 'Внутренний портал', color: '#f58cc0', description: '', createdAt: new Date(now - 8 * day).toISOString(), pinnedAt: null },
  ],
  ui: { view: 'home', projectId: 'p1' },
  settings: { hourlyRate: 2500, currency: 'RUB' },
  tasks: [
    {
      id: 'a', projectId: 'p1', title: 'Свёрстать лендинг', done: false, rate: 3000,
      pinnedAt: new Date(now - day).toISOString(),
      notes: { ops: [
        { insert: 'Осталось\n', attributes: { header: 3 } },
        { insert: 'Секция с ценами' }, { insert: '\n', attributes: { list: 'unchecked' } },
        { insert: 'Адаптив' }, { insert: '\n', attributes: { list: 'unchecked' } },
      ] },
      totalMs: 0,
      sessions: [S(20, 10, 3_600_000), S(6, 14, 7_200_000), S(2, 11, 5_400_000), S(0, 15, 4_800_000)],
      createdAt: new Date(now - 22 * day).toISOString(), updatedAt: new Date(now - day).toISOString(),
    },
    {
      id: 'b', projectId: 'p1', title: 'Настроить деплой', done: true, pinnedAt: null,
      notes: null, totalMs: 0, sessions: [S(5, 12, 5_400_000)],
      createdAt: new Date(now - 10 * day).toISOString(), updatedAt: new Date(now - 5 * day).toISOString(),
    },
    {
      id: 'c', projectId: 'p1', title: 'Форма обратной связи', done: false, pinnedAt: null,
      notes: null, totalMs: 0, sessions: [], createdAt: new Date(now - 3 * day).toISOString(),
    },
    {
      id: 'd', projectId: 'p2', title: 'Экран онбординга', done: true, pinnedAt: null,
      notes: null, totalMs: 0, sessions: [S(8, 10, 9_000_000)],
      createdAt: new Date(now - 30 * day).toISOString(), updatedAt: new Date(now - 8 * day).toISOString(),
    },
    {
      id: 'e', projectId: 'p2', title: 'Интеграция API', done: false, pinnedAt: null,
      notes: null, totalMs: 0, sessions: [S(6, 9, 6_300_000), S(1, 13, 6_300_000)],
      createdAt: new Date(now - 20 * day).toISOString(), updatedAt: new Date(now - day).toISOString(),
    },
    {
      id: 'f', projectId: 'p4', title: 'Созвон с командой X', done: true, pinnedAt: null, rate: 5000,
      notes: null, totalMs: 0, sessions: [S(4, 16, 3_600_000)],
      createdAt: new Date(now - 4 * day).toISOString(), updatedAt: new Date(now - 4 * day).toISOString(),
    },
  ],
  activeTimer: null,
};
// totalMs из сессий
for (const t of demo.tasks) t.totalMs = t.sessions.reduce((a, s) => a + s.ms, 0);

let store = demo;
ipcMain.handle('data:load', () => store);
ipcMain.handle('data:save', (_e, d) => { store = d; return true; });
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('export:xlsx', () => ({ ok: false, canceled: true }));
ipcMain.handle('theme:set-overlay', () => true);
ipcMain.handle('update:check', () => ({ ok: false, reason: 'dev' }));
ipcMain.handle('update:download', () => ({ ok: true }));
ipcMain.handle('update:install', () => true);

async function capture(win, file) {
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(path.join(__dirname, file), (await win.webContents.capturePage()).toPNG());
  console.log('saved', file);
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  const win = new BrowserWindow({
    width: 1220, height: 800, show: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#2a2b2e', symbolColor: '#b9bbc1', height: 52 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1100));
  await capture(win, 'preview-home.png');

  // Поиск — отступ между названием и второстепенным текстом
  await win.webContents.executeJavaScript(`
    document.getElementById('search-input').focus();
    document.getElementById('search-input').value = 'лендинг';
    document.getElementById('search-input').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 250));
  await capture(win, 'preview-search.png');
  await win.webContents.executeJavaScript(`
    document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.getElementById('search-input').blur();
  `);

  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-view="calendar"]').click()`);
  await new Promise((r) => setTimeout(r, 400));
  await win.webContents.executeJavaScript(
    `(() => { const c = [...document.querySelectorAll('#cal-days .cal-cell:not(.empty)')].filter(x => x.querySelector('.cc-time')); (c[c.length-1] || c[0])?.click(); })()`,
  );
  await capture(win, 'preview-calendar.png');

  // Режим "День" — почасовая разбивка задач
  await win.webContents.executeJavaScript(
    `document.querySelector('.cal-modes button[data-mode="day"]').click()`,
  );
  await new Promise((r) => setTimeout(r, 300));
  await capture(win, 'preview-calendar-day.png');

  // Период: включаем свитч на месячном виде и выбираем диапазон из двух дней с записями
  await win.webContents.executeJavaScript(
    `document.querySelector('.cal-modes button[data-mode="month"]').click()`,
  );
  await new Promise((r) => setTimeout(r, 200));
  await win.webContents.executeJavaScript(`document.getElementById('cal-period-toggle').click()`);
  await new Promise((r) => setTimeout(r, 150));
  await win.webContents.executeJavaScript(`
    (() => {
      const cells = [...document.querySelectorAll('#cal-days .cal-cell:not(.empty)')].filter(x => x.querySelector('.cc-time'));
      cells[0]?.click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 150));
  await win.webContents.executeJavaScript(`
    (() => {
      const cells = [...document.querySelectorAll('#cal-days .cal-cell:not(.empty)')].filter(x => x.querySelector('.cc-time'));
      cells[cells.length - 1]?.click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 300));
  await capture(win, 'preview-calendar-period.png');

  // Кастомный выбор даты (не системный) — открываем попап у кнопки "от"
  await win.webContents.executeJavaScript(`document.getElementById('range-from-btn').click()`);
  await new Promise((r) => setTimeout(r, 250));
  await capture(win, 'preview-datepicker.png');
  await win.webContents.executeJavaScript(`document.getElementById('cal-period-toggle').click()`);
  await new Promise((r) => setTimeout(r, 150));

  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-view="home"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.ptile')].find(t => /Мобильное/.test(t.textContent)).querySelector('.ptile-main').click()`,
  );
  await new Promise((r) => setTimeout(r, 300));
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('#task-list .task-item')].find(x => /Интеграция/.test(x.textContent)).click()`,
  );
  await new Promise((r) => setTimeout(r, 250));
  await win.webContents.executeJavaScript(`
    try {
      const q = Quill.find(document.getElementById('editor'));
      q.setText('Заметка про API\\n');
      q.formatText(7, 5, 'color', '#87ff65');
      q.getModule('table').insertTable(2, 3);
      const td = document.querySelector('#editor .ql-editor table td');
      q.setSelection(Quill.find(td).offset(q.scroll) + 1, 0);
      q.formatLine(Quill.find(td).offset(q.scroll), 1, 'cellBg', '#3a4a34');
    } catch (e) { console.log('shot editor err', e.message); }
    document.getElementById('task-title').focus();
  `).catch(() => {});
  await capture(win, 'preview-project.png');

  // Вкладка "История" — записи времени крупнее + кнопка Excel
  await win.webContents.executeJavaScript(`document.querySelector('.task-tabs button[data-tab="history"]').click()`);
  await new Promise((r) => setTimeout(r, 250));
  await capture(win, 'preview-history.png');

  // Кастомный диалог подтверждения удаления
  await win.webContents.executeJavaScript(`document.getElementById('delete-task-btn').click()`);
  await new Promise((r) => setTimeout(r, 250));
  await capture(win, 'preview-confirm.png');
  await win.webContents.executeJavaScript(`document.getElementById('confirm-cancel').click()`);

  // Диалог "Добавить запись" — свой календарь + свой выбор времени
  await win.webContents.executeJavaScript(`document.getElementById('add-session-btn').click()`);
  await new Promise((r) => setTimeout(r, 200));
  await win.webContents.executeJavaScript(`document.getElementById('sdlg-start-btn').click()`);
  await new Promise((r) => setTimeout(r, 200));
  await capture(win, 'preview-timepicker.png');
  await win.webContents.executeJavaScript(`document.getElementById('sdlg-cancel').click()`);

  // Подсказка ссылки в редакторе больше не обрезается
  await win.webContents.executeJavaScript(`document.querySelector('.task-tabs button[data-tab="notes"]').click()`);
  await new Promise((r) => setTimeout(r, 150));
  await win.webContents.executeJavaScript(`
    try {
      const q = Quill.find(document.getElementById('editor'));
      q.setText('Ссылка на детальное ТЗ проекта: подробности здесь\\n', 'user');
      q.formatText(33, 17, 'link', 'https://example.com/very/long/path/to/spec/document', 'user');
      q.setSelection(38, 0, 'user');
    } catch (e) { console.log('shot link err', e.message); }
  `).catch(() => {});
  await new Promise((r) => setTimeout(r, 250));
  await capture(win, 'preview-link-tooltip.png');

  // Светлая тема — теперь через icon-табы вместо цикличной кнопки
  await win.webContents.executeJavaScript(`document.querySelector('.theme-tab[data-theme="light"]').click()`);
  await new Promise((r) => setTimeout(r, 250));
  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-view="home"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  await capture(win, 'preview-theme-light.png');
  await win.webContents.executeJavaScript(`document.querySelector('.theme-tab[data-theme="dark"]').click()`);
  await new Promise((r) => setTimeout(r, 150));

  // Кастомный дропдаун языка (не системный <select>) — сначала сам открытый попап
  await win.webContents.executeJavaScript(`document.getElementById('lang-toggle').click()`);
  await new Promise((r) => setTimeout(r, 200));
  await capture(win, 'preview-lang-menu.png');
  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('#ctx-menu .ctx-item')].find(b => b.textContent.includes('English')).click();
  `);
  await new Promise((r) => setTimeout(r, 300));
  await capture(win, 'preview-lang-en.png');

  app.quit();
});

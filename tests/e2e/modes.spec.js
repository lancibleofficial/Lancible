// Режимы: «фрилансер» и «личное», таймер и счётчик заработка.
// Запуск: npm run test:e2e
//
// Откуда тест (17 октября 2026, пункт 12 круга): «режим фрилансеров, личное
// использование, вкл/выкл таймера и счётчика заработка». Правило одно на три
// поверхности и лежит в ядре (core/modes.js, Core.modeFlags):
//   · «личное» — денег нет нигде: ни ставки и валюты в настройках, у задачи и
//     проекта, ни сумм на «Сегодня», «Времени», в карточках и в выгрузке;
//   · счётчик заработка выключен — нет «заработано» (день, неделя, месяц,
//     строка в таймере), ставка и валюта остаются;
//   · таймер выключен — нет кнопок запуска (квадрат на задаче, .rl-play,
//     капсула и «Старт» в шапке, «Сейчас идёт»); записи времени и запись
//     вручную остаются.
// Экраны читают флаги только через Core.modeFlags — это проверено и по
// исходнику.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pinClock } = require('./clock');

const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

/** Проект со ставкой и задачей, по которой сегодня было полчаса. */
async function start(page) {
  await pinClock(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await page.evaluate(() => {
    const now = Date.now();
    state.settings.hourlyRate = 2000;
    state.settings.currency = 'RUB';
    state.projects.push({ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: new Date(now).toISOString(), tagIds: [], rate: null });
    seedProjectStatuses('p1');
    state.tasks.push({
      id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, notes: null, totalMs: 1800e3,
      sessions: [{ start: new Date(now - 3600e3).toISOString(), end: new Date(now - 1800e3).toISOString(), ms: 1800e3, rate: 2000 }],
      rate: null, pinnedAt: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
      statusId: defaultStatusId('p1', false), tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    render();
  });
}

const visible = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((n) => n.getClientRects().length > 0).length, sel);

test('по умолчанию — фрилансер: деньги, заработок и таймер на месте', async ({ page }) => {
  await start(page);
  expect(await page.evaluate(() => Core.modeFlags(state.settings))).toEqual({ mode: 'freelance', money: true, timer: true, earnings: true });
  await expect(page.locator('#st-today-money')).toHaveText('1 000 ₽');
  await expect(page.locator('#day-sub')).toContainText('₽');
  await expect(page.locator('#now-island')).toBeVisible();
  await expect(page.locator('#tb-start')).toBeVisible();
  expect(await page.evaluate(() => document.body.className)).not.toMatch(/no-(money|earnings|timer)/);
});

test('«личное» в «Основном» прячет деньги на «Сегодня», в задаче, проекте, «Времени» и в настройках', async ({ page }) => {
  await start(page);
  await page.evaluate(() => openSettings('main'));
  await page.locator('#settings-mode > button[data-mode="personal"]').click();
  expect(await page.evaluate(() => state.settings.mode)).toBe('personal');
  await expect(page.locator('#settings-mode > button.on')).toHaveText('Личное');
  await expect(page.locator('#settings-mode-hint')).toHaveText('Без денег: задачи и время, ни ставок, ни сумм.');
  expect(await page.evaluate(() => document.body.className)).toMatch(/\bno-money\b/);

  // Настройки «Работы»: ни ставки, ни валюты, ни переключателя заработка.
  await page.evaluate(() => openSettings('work'));
  await expect(page.locator('#settings-rate-row')).toBeHidden();
  await expect(page.locator('#settings-currency-row')).toBeHidden();
  await expect(page.locator('#settings-earnings-toggle')).toBeHidden();
  await expect(page.locator('#settings-timer-toggle')).toBeVisible();
  await page.evaluate(() => openSettings(null));
  await expect(page.locator('#settings-sec-main-value')).toHaveText('Русский · Личное');
  await expect(page.locator('#settings-sec-work-value')).toHaveText('');

  // «Сегодня»: числа без сумм, день — без денег.
  await page.locator('#navrail .nav-item[data-view="home"]').click();
  for (const id of ['st-today-money', 'st-week-money', 'st-money', 'now-money']) await expect(page.locator(`#${id}`)).toBeHidden();
  await expect(page.locator('#st-today')).toBeVisible();
  await expect(page.locator('#day-sub')).not.toContainText('₽');

  // Задача: нет группы «Ещё» со ставкой, нет суммы и ставки у таймера.
  await page.evaluate(() => openTask('t1'));
  await expect(page.locator('#task-more-group')).toBeHidden();
  await expect(page.locator('#task-more-label')).toBeHidden();
  await expect(page.locator('#timer-earned')).toBeHidden();
  await expect(page.locator('#timer-rate')).toBeHidden();
  await expect(page.locator('#timer-display')).toBeVisible();

  // Проект: ни суммы в шапке, ни у строк; окно проекта — без «Ставки и валюты».
  await page.evaluate(() => openProject('p1'));
  expect(await visible(page, '#project-view .kpi-money, #project-view .ti-money, #project-view .tg-money')).toBe(0);
  await expect(page.locator('#project-earned > b').first()).toBeVisible();
  await page.evaluate(() => openProjectDialog(getProject('p1')));
  await expect(page.locator('#pdlg-sec-money')).toBeHidden();
  await page.evaluate(() => closeProjectDialog());

  // «Проекты» и «Время»: ни сумм в карточках, ни «заработано».
  await page.locator('#navrail .nav-item[data-view="projects"]').click();
  expect(await visible(page, '.ptile-money')).toBe(0);
  await page.evaluate(() => { applyTimeMode('month'); openView('time'); });
  await expect(page.locator('#sp-money')).toBeHidden();
  await expect(page.locator('#sp-month')).toBeHidden();
  await expect(page.locator('#sp-time')).toBeVisible();
  expect(await visible(page, '.cc-money')).toBe(0);
  expect(await page.evaluate(() => fmtDurMoney(1800e3, 1000) === fmtDur(1800e3))).toBe(true);

  // Обратно — всё вернулось.
  await page.evaluate(() => { state.settings.mode = 'freelance'; render(); });
  await expect(page.locator('#sp-money')).toBeVisible();
  expect(await visible(page, '.cc-money')).toBeGreaterThan(0);
});

test('выгрузка в «личном» — без колонок ставки и суммы, формулы на своих местах', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    window.__exports = [];
    window.api.exportXlsx = async (p) => { window.__exports.push(p); return { ok: true }; };
    state.settings.mode = 'personal';
    render();
  });
  await page.evaluate(() => { selectedId = 't1'; exportTask(); exportProjectById('p1'); });
  await expect.poll(() => page.evaluate(() => window.__exports.length)).toBe(2);
  const sheets = await page.evaluate(() => window.__exports.flatMap((e) => e.sheets));
  const text = JSON.stringify(sheets);
  expect(text, 'ни одной подписи с валютой').not.toMatch(/₽/);
  expect(text).not.toMatch(/Ставка|Сумма|Заработано/);
  for (const sheet of sheets) {
    const head = sheet.rows.find((r) => r.length > 3 && r.every((c) => c && c.s === 1));
    expect(sheet.cols.length, `${sheet.name}: ширины колонок — по числу колонок`).toBe(head.length);
    for (const r of sheet.rows) expect(r.length).toBeLessThanOrEqual(head.length);
  }
  // Лист задачи: часы в F, сумма часов — та же формула, что была.
  const task = sheets[0];
  const total = task.rows[task.rows.length - 1];
  expect(total.map((c) => (c && c.f) || null).filter(Boolean)).toEqual(['SUM(F8:F8)']);
  // Фрилансер — те же листы с деньгами.
  await page.evaluate(() => { state.settings.mode = 'freelance'; render(); selectedId = 't1'; exportTask(); });
  await expect.poll(() => page.evaluate(() => window.__exports.length)).toBe(3);
  expect(JSON.stringify(await page.evaluate(() => window.__exports[2].sheets))).toMatch(/Сумма, ₽/);
});

/** Нет ли в листах денег: ни валюты, ни колонок ставки и суммы; ширины
 *  колонок — по числу колонок шапки, строки не длиннее шапки. */
function expectNoMoney(sheets, where) {
  const text = JSON.stringify(sheets);
  expect(text, `${where}: ни одной подписи с валютой`).not.toMatch(/₽/);
  expect(text, `${where}: колонок денег нет`).not.toMatch(/Ставка|Сумма|Заработано/);
  for (const sheet of sheets) {
    const head = sheet.rows.find((r) => r.length > 3 && r.every((c) => c && c.s === 1));
    if (!head) continue;
    expect(sheet.cols.length, `${where}, ${sheet.name}: ширины колонок — по числу колонок`).toBe(head.length);
    for (const r of sheet.rows) expect(r.length, `${where}, ${sheet.name}: строка длиннее шапки`).toBeLessThanOrEqual(head.length);
  }
}

test('выгрузка в «личном» через окно экспорта и из календаря — тоже без денег', async ({ page }) => {
  // Задача и проект — тестом выше; здесь две другие двери в ту же выгрузку:
  // окно «Экспорт» в «Времени» (всё время и период) и кнопка под днём
  // календаря месяца.
  await start(page);
  await page.evaluate(() => {
    window.__exports = [];
    window.api.exportXlsx = async (p) => { window.__exports.push(p); return { ok: true }; };
    state.settings.mode = 'personal';
    state.ui.view = 'time';
    state.ui.timeMode = 'month';
    render();
  });
  const exportsN = () => page.evaluate(() => window.__exports.length);
  const lastSheets = () => page.evaluate(() => window.__exports[window.__exports.length - 1].sheets);

  // Окно экспорта, «Всё время» — сводный лист и лист проекта.
  await page.locator('#export-period-btn').click();
  await expect(page.locator('#expdlg-backdrop')).toBeVisible();
  await page.locator('#expdlg-ok').click();
  await expect.poll(exportsN).toBe(1);
  const all = await lastSheets();
  expect(all.length).toBeGreaterThan(0);
  expectNoMoney(all, 'окно, всё время');

  // То же окно, «Этот месяц» — выгрузка за период.
  await page.locator('#export-period-btn').click();
  await page.locator('#exp-period').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Этот месяц' }).click();
  await page.locator('#expdlg-ok').click();
  await expect.poll(exportsN).toBe(2);
  const period = await lastSheets();
  expect(JSON.stringify(period), 'запись дня в выгрузке').toMatch(/Вёрстка/);
  expectNoMoney(period, 'окно, месяц');

  // Календарь месяца: «Экспорт» под днём.
  await expect(page.locator('#export-calendar-btn')).toBeVisible();
  await page.locator('#export-calendar-btn').click();
  await expect.poll(exportsN).toBe(3);
  const cal = await lastSheets();
  expect(JSON.stringify(cal)).toMatch(/Вёрстка/);
  expectNoMoney(cal, 'календарь');

  // Фрилансер — та же кнопка календаря даёт деньги: проверка зрячая.
  await page.evaluate(() => { state.settings.mode = 'freelance'; render(); });
  await page.locator('#export-calendar-btn').click();
  await expect.poll(exportsN).toBe(4);
  expect(JSON.stringify(await lastSheets())).toMatch(/Сумма, ₽/);
});

test('выключенный счётчик заработка прячет «заработано», ставка и валюта остаются', async ({ page }) => {
  await start(page);
  await page.evaluate(() => openSettings('work'));
  await page.locator('#settings-earnings-toggle').click();
  expect(await page.evaluate(() => Core.modeFlags(state.settings))).toEqual({ mode: 'freelance', money: true, timer: true, earnings: false });
  await expect(page.locator('#settings-earnings-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#settings-rate-row')).toBeVisible();
  await expect(page.locator('#settings-currency-row')).toBeVisible();
  await page.locator('#navrail .nav-item[data-view="home"]').click();
  await expect(page.locator('#st-today-money')).toBeHidden();
  await expect(page.locator('#day-sub')).not.toContainText('₽');
  await page.evaluate(() => openTask('t1'));
  await expect(page.locator('#timer-earned')).toBeHidden();
  await expect(page.locator('#task-more-group')).toBeVisible();
  await expect(page.locator('#rate-value')).toContainText('2 000 ₽');
  await page.evaluate(() => { applyTimeMode('month'); openView('time'); });
  await expect(page.locator('#sp-money')).toBeHidden();
});

test('выключенный таймер прячет квадрат, капсулу, «Старт» и «Сейчас идёт»; записи остаются', async ({ page }) => {
  await start(page);
  // Таймер идёт — выключение останавливает его и сохраняет запись.
  await page.evaluate(() => startTimer('t1'));
  await expect(page.locator('#tb-timer')).toBeVisible();
  await page.evaluate(() => { const at = state.activeTimer; at.startedAt = new Date(Date.now() - 60e3).toISOString(); });
  await page.evaluate(() => openSettings('work'));
  await page.locator('#settings-timer-toggle').click();
  await expect(page.locator('#settings-timer-toggle')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => state.activeTimer)).toBeNull();
  expect(await page.evaluate(() => getTask('t1').sessions.length)).toBe(2);
  expect(await page.evaluate(() => document.body.className)).toMatch(/\bno-timer\b/);

  await expect(page.locator('#tb-timer')).toBeHidden();
  await expect(page.locator('#tb-start')).toBeHidden();
  await page.locator('#navrail .nav-item[data-view="home"]').click();
  await expect(page.locator('#now-island')).toBeHidden();
  expect(await visible(page, '.rl-play')).toBe(0);
  await page.locator('#navrail .nav-item[data-view="projects"]').click();
  expect(await visible(page, '.rl-play')).toBe(0);
  await page.evaluate(() => openTask('t1'));
  await expect(page.locator('#timer-btn')).toBeHidden();
  await expect(page.locator('#timer-display')).toBeVisible();
  // Запустить нечем — ни кнопкой, ни из кода (горячая клавиша, «Старт»).
  await page.evaluate(() => { startTimer('t1'); toggleTimer(); });
  expect(await page.evaluate(() => state.activeTimer)).toBeNull();
  // История и запись вручную на месте.
  await page.evaluate(() => setTaskTab('history'));
  await expect(page.locator('#add-session-btn')).toBeVisible();
  await expect(page.locator('#session-list .session-item')).toHaveCount(2);
  await page.locator('#navrail .nav-item[data-view="home"]').click();
  await expect(page.locator('#day-add-entry')).toBeVisible();

  // Включили — всё вернулось.
  await page.evaluate(() => { state.settings.showTimer = true; render(); });
  await expect(page.locator('#now-island')).toBeVisible();
  expect(await visible(page, '.rl-play')).toBeGreaterThan(0);
});

test('режим — данные устройства и переживает перезагрузку', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { state.settings.mode = 'personal'; state.settings.showTimer = false; render(); scheduleSave(); return saveNow(); });
  await page.reload();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  expect(await page.evaluate(() => Core.modeFlags(state.settings))).toEqual({ mode: 'personal', money: false, timer: false, earnings: false });
  expect(await page.evaluate(() => document.body.className)).toMatch(/\bno-money\b.*\bno-timer\b|\bno-timer\b.*\bno-money\b/);
});

test('экраны читают режим только через Core.modeFlags', () => {
  // settings.mode, showTimer и showEarnings в app.js пишут только
  // переключатели настроек; читать их напрямую нельзя — правило в ядре.
  const code = APP.split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
  const reads = code.filter((line) => /settings\.(mode|showTimer|showEarnings)\b/.test(line)
    && !/^\s*state\.settings\.(mode|showTimer|showEarnings)\s*=(?!=)/.test(line));
  // Единственное чтение — положение переключателя заработка: он показывает
  // сам выбор, а не правило (в «личном» его не видно).
  expect(reads.map((l) => l.trim())).toEqual([
    "el.settingsEarningsToggle.setAttribute('aria-pressed', String(state.settings.showEarnings !== false));",
  ]);
  expect(APP).toMatch(/const modeFlags = \(\) => Core\.modeFlags\(state\.settings\);/);
});

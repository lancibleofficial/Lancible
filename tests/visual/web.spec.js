// Снимки веб-версии. Запуск: npm run test:visual
//
// Данные для снимка засеиваются вручную и время прибито: иначе каждый снимок
// отличался бы от предыдущего датами, подписями «сегодня» и бегущим
// таймером, и эталон пришлось бы пересоздавать каждый день.
//
// Адрес берётся явно: у набора снимков базовый адрес — лендинг, а веб живёт
// на своём порту.
const { test } = require('@playwright/test');
const { expectShot } = require('./shot');
const { pinClock } = require('../e2e/clock');
const { PORT_WEB } = require('../ports');

const WEB = `http://localhost:${PORT_WEB}`;

const VIEWS = [
  ['обзор', 'home'],
  ['проекты', 'projects'],
  ['доска', 'board'],
  ['время', 'time'],
  ['проект', 'project'],
  ['настройки', 'settings'],
];

async function seeded(page, theme) {
  await pinClock(page);
  await page.goto(`${WEB}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#shell');
  await page.evaluate((th) => {
    const now = new Date();
    const p = {
      id: 'p-1', name: 'Сайт клиента', color: '#87ff65', description: 'Вёрстка и правки',
      pinnedAt: null, createdAt: now.toISOString(), tagIds: [],
    };
    state.projects.push(p);
    state.tasks.push({
      id: 't-1', projectId: p.id, title: 'Главная страница', notes: '',
      statusId: null, done: false, totalMs: 5_400_000,
      sessions: [{ id: 's-1', start: now.toISOString(), ms: 5_400_000 }],
      createdAt: now.toISOString(), tagIds: [], dueAt: null,
    });
    state.ui.projectId = p.id;
    state.settings.theme = th;
    applyTheme();
    render();
  }, theme);
  await page.evaluate(() => document.fonts.ready);
  // Скелет загрузки уезжает по прозрачности — снимок до конца перехода
  // поймал бы его полупрозрачным.
  await page.waitForFunction(() => {
    const s = document.getElementById('app-skeleton');
    return !s || getComputedStyle(s).display === 'none' || getComputedStyle(s).opacity === '0';
  });
}

for (const theme of ['dark', 'light']) {
  for (const [label, view] of VIEWS) {
    test(`${label}, тема ${theme === 'dark' ? 'тёмная' : 'светлая'}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await seeded(page, theme);
      await page.evaluate((v) => { state.ui.view = v; render(); }, view);
      await expectShot(page, test, `веб-${label}-${theme}.png`, {
        fullPage: true,
        // Таймер в шапке считает настоящие миллисекунды даже при прибитой
        // дате — его закрашиваем.
        mask: [page.locator('.tb-timer')],
      });
    });
  }
}

// --- логотип ------------------------------------------------------------------
//
// На снимках целых экранов логотип есть, но занимает доли процента кадра:
// 10 октября 2026 его перевели с Basique Pro на Onest 800, и все снимки
// остались в допуске 1% — смену шрифта они не заметили бы вовсе. Поэтому
// знак снимается отдельно, элементом: в своём кадре другой шрифт — это
// заметная доля пикселей.
for (const theme of ['dark', 'light']) {
  test(`логотип, тема ${theme === 'dark' ? 'тёмная' : 'светлая'}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seeded(page, theme);
    await expectShot(page.locator('#tb-logo'), test, `веб-логотип-${theme}.png`);
  });
}

// --- календарь: месяц и неделя на насыщенных данных -------------------------
//
// Обычный снимок календаря открывает неделю с одной записью: ни дедлайна, ни
// повторения, ни переполненного дня в нём нет. А это ровно те ветки, которые
// решает отрисовка календаря. Здесь данных столько, чтобы показались все:
// четыре записи в один день (три чипа и «+1»), выполненный и открытый
// дедлайны, повторяющаяся задача с призраками будущих сроков.
async function busyCalendar(page, mode) {
  await seeded(page, 'dark');
  await page.evaluate((m) => {
    const day = (offset, h, min = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      d.setHours(h, min, 0, 0);
      return d;
    };
    const p2 = {
      id: 'p-2', name: 'Лендинг', color: '#5ec8f2', description: '',
      pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [],
    };
    state.projects.push(p2);
    const ses = (d, ms) => ({ start: d.toISOString(), end: new Date(d.getTime() + ms).toISOString(), ms });
    state.tasks.push({
      id: 't-busy', projectId: 'p-1', title: 'Плотный день', notes: '', statusId: null, done: false,
      totalMs: 4 * 1_800_000, createdAt: new Date().toISOString(), tagIds: [], dueAt: null,
      sessions: [ses(day(1, 9), 1_800_000), ses(day(1, 11), 1_800_000), ses(day(1, 14), 1_800_000), ses(day(1, 17), 1_800_000)],
    });
    state.tasks.push({
      id: 't-dl', projectId: 'p-2', title: 'Сдать макет', notes: '', statusId: null, done: false,
      totalMs: 0, sessions: [], createdAt: new Date().toISOString(), tagIds: [], dueAt: day(2, 18).toISOString(),
    });
    state.tasks.push({
      id: 't-done', projectId: 'p-2', title: 'Созвон', notes: '', statusId: null, done: true,
      totalMs: 0, sessions: [], createdAt: new Date().toISOString(), tagIds: [], dueAt: day(-1, 10).toISOString(),
    });
    state.tasks.push({
      id: 't-rep', projectId: 'p-1', title: 'Отчёт клиенту', notes: '', statusId: null, done: false,
      totalMs: 0, sessions: [], createdAt: new Date().toISOString(), tagIds: [], dueAt: day(0, 16).toISOString(),
      repeat: { freq: 'week', every: 1, weekdays: [], from: 'due', ends: { kind: 'never' } },
    });
    migrate();
    state.ui.view = 'time';
    state.ui.timeMode = m;
    render();
  }, mode);
}

for (const mode of ['month', 'week']) {
  test(`календарь с дедлайнами и повторениями: ${mode === 'month' ? 'месяц' : 'неделя'}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await busyCalendar(page, mode);
    await expectShot(page, test, `веб-календарь-насыщенный-${mode}.png`, {
      fullPage: true,
      mask: [page.locator('.tb-timer'), page.locator('.ag-now')],
    });
  });
}

// --- проект на крайних данных ---------------------------------------------------
//
// Замеры в tests/e2e/edge.spec.js говорят, что ничего не вылезло; снимок —
// чтобы посмотреть, хорошо ли это выглядит. Данные те же (edge-seed.js).
const { seedEdge } = require('../e2e/edge-seed');

for (const theme of ['dark', 'light']) {
  test(`проект на крайних данных, тема ${theme === 'dark' ? 'тёмная' : 'светлая'}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seeded(page, theme);
    await page.evaluate(`(${seedEdge.toString()})()`);
    await page.evaluate(() => { openProject('p-edge'); });
    await expectShot(page, test, `веб-проект-крайний-${theme}.png`, {
      fullPage: true,
      mask: [page.locator('.tb-timer')],
    });
  });
}

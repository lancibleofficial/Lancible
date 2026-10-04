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
  ['доска', 'board'],
  ['календарь', 'calendar'],
  ['статистика', 'stats'],
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

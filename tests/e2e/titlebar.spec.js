// Шапка: поиск стоит на месте, что бы ни было справа. Запуск: npm run test:e2e
//
// Откуда взялось. 10 октября 2026: запускаешь таймер — «Старт» справа
// превращается в капсулу с названием задачи, временем и «Стоп», и поле поиска
// слева ужимается. Шапка была одним flex-рядом, где поиск и распорка делили
// остаток поровну, а остаток зависел от ширины таймера. Теперь колонки
// шапки заданы сеткой, и ширина правого блока на поиск не влияет. Мерялось
// глазом; здесь — getBoundingClientRect до и после запуска таймера.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

// 1280 — обычное окно, 900 — узкое окно десктопа, 760 — минимальное окно
// приложения (minWidth в src/main.js), 375 — телефон в вебе, где шапка другая.
const WIDTHS = [1280, 900, 760, 375];

/** Окно приложения на Windows: справа поверх шапки стоят кнопки окна. Их
 *  отступ браузер не знает (env(titlebar-area-width) есть только в Electron),
 *  поэтому ставим его руками — тот же, что остаётся от 138 px кнопок. */
const WINDOW_BUTTONS = '#titlebar { padding-right: 138px; }';

async function open(page, width, { buttons = false } = {}) {
  await page.setViewportSize({ width, height: 800 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  if (buttons) await page.addStyleTag({ content: WINDOW_BUTTONS });
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.evaluate(() => {
    const now = new Date().toISOString();
    state.projects.push({ id: 'p1', name: 'П', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
    state.tasks.push({
      id: 't1', projectId: 'p1', done: false, notes: '', statusId: null, totalMs: 0, sessions: [],
      title: 'Очень длинное название задачи, чтобы капсула таймера заняла в шапке как можно больше места',
      createdAt: now, updatedAt: now, tagIds: [], dueAt: null,
    });
    migrate();
    render();
  });
}

/** Где стоит поле поиска и не уезжает ли страница вбок. */
const searchBox = (page) => page.evaluate(() => {
  const r = document.querySelector('.tb-search').getBoundingClientRect();
  const doc = document.documentElement;
  return { x: r.x, width: r.width, scrollable: doc.scrollWidth > doc.clientWidth };
});

for (const width of WIDTHS) {
  for (const buttons of [false, true]) {
    // Кнопки окна — десктопная шапка; на телефоне их не бывает.
    if (buttons && width < 560) continue;
    const where = `${width} px${buttons ? ', справа кнопки окна' : ''}`;

    test(`поиск не двигается и не меняет ширину, когда запускаешь таймер (${where})`, async ({ page }) => {
      await open(page, width, { buttons });
      await expect(page.locator('#tb-start')).toBeVisible();
      const idle = await searchBox(page);
      expect(idle.width, 'поиск виден').toBeGreaterThan(60);

      await page.locator('#tb-start').click();
      await expect(page.locator('#tb-timer')).toBeVisible();
      await expect(page.locator('#tb-start')).toBeHidden();
      const running = await searchBox(page);

      expect(Math.abs(running.x - idle.x), `левый край: ${idle.x} → ${running.x}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(running.width - idle.width), `ширина: ${idle.width} → ${running.width}`).toBeLessThanOrEqual(0.5);
      expect(idle.scrollable, 'без таймера страницу можно утащить вбок').toBe(false);
      expect(running.scrollable, 'с таймером страницу можно утащить вбок').toBe(false);

      await page.locator('#tb-timer-stop').click();
      await expect(page.locator('#tb-start')).toBeVisible();
      const stopped = await searchBox(page);
      expect(Math.abs(stopped.x - idle.x) + Math.abs(stopped.width - idle.width), 'после стопа всё как было').toBeLessThanOrEqual(0.5);
    });
  }
}

test('капсула таймера не вылезает за шапку и не наезжает на колокольчик, даже в узком окне', async ({ page }) => {
  await open(page, 760, { buttons: true });
  await page.locator('#tb-start').click();
  await expect(page.locator('#tb-timer')).toBeVisible();
  const g = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const timer = r('#tb-timer');
    const stop = r('#tb-timer-stop');
    const bell = r('#notif-btn');
    const bar = r('#titlebar');
    const pad = parseFloat(getComputedStyle(document.getElementById('titlebar')).paddingRight);
    return { timerLeft: timer.left, timerRight: timer.right, stopRight: stop.right, bellRight: bell.right, barRight: bar.right, pad };
  });
  expect(g.timerLeft, 'капсула правее колокольчика').toBeGreaterThanOrEqual(g.bellRight);
  expect(g.timerRight, 'капсула левее кнопок окна').toBeLessThanOrEqual(g.barRight - g.pad);
  expect(g.stopRight, '«Стоп» внутри капсулы').toBeLessThanOrEqual(g.timerRight);
});

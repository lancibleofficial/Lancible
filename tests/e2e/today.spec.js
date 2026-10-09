// «Сегодня» — день, числа, недавние проекты, сроки, идущая задача, недавние
// задачи. Запуск: npm run test:e2e
//
// С редизигна островами (7 октября 2026) обзор стал страницей дня: лента
// записей по часам, время и деньги за сегодня, неделю и месяц, три недавних
// проекта, сроки; справа — идущая задача (или последняя, чтобы продолжить)
// и недавние задачи с плеем. Проекты целиком переехали на свою страницу.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function seed(page, opts = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ HOUR, pin }) => {
    const now = new Date();
    state.settings.hourlyRate = 1000;
    state.settings.currency = 'RUB';
    const mk = (id, name, color, pinnedAt = null) => {
      state.projects.push({ id, name, color, description: '', pinnedAt, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
      seedProjectStatuses(id);
    };
    mk('p1', 'Сайт', '#87ff65');
    mk('p2', 'Приложение', '#5ec8f2');
    mk('p3', 'Кофейня', '#f5c451', pin ? new Date(now.getTime() - HOUR).toISOString() : null);
    mk('p4', 'Четвёртый', '#c084fc');
    const at = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d; };
    const ses = (start, end) => ({ start: start.toISOString(), end: end.toISOString(), ms: end - start });
    const add = (id, pid, title, sessions, extra = {}) => state.tasks.push({
      id, projectId: pid, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
    });
    add('t1', 'p1', 'Вёрстка', [ses(at(9), at(10))]);
    add('t2', 'p2', 'Экран входа', [ses(at(14), at(14, 45))], { dueAt: at(18).toISOString() });
    add('t3', 'p3', 'Логотип', [ses(at(11), at(12))]);
    add('t4', 'p1', 'Форма', [], { dueAt: new Date(now.getTime() - 2 * HOUR).toISOString() });
    state.ui.view = 'home';
    render();
  }, { HOUR, pin: !!opts.pin });
}

test('день: заголовок с датой, лента записей по часам и линия «сейчас»', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#day-title')).toHaveText('Среда, 10 июня');
  await expect(page.locator('#day-sub')).toContainText('2ч 45м');
  const blocks = page.locator('.day-blk');
  await expect(blocks).toHaveCount(3);
  // Запись в час на ленте с 8 до 20 — двенадцатая часть ширины.
  const m = await page.evaluate(() => {
    const track = document.getElementById('day-track').getBoundingClientRect();
    const b = document.querySelector('.day-blk').getBoundingClientRect();
    return { left: (b.left - track.left) / track.width, width: b.width / track.width, hours: [...document.querySelectorAll('.day-hours span')].map((s) => s.textContent) };
  });
  expect(m.hours[0]).toBe('08');
  expect(m.hours[m.hours.length - 1]).toBe('19');
  expect(m.left).toBeGreaterThan(1 / 12 - 0.01);
  expect(m.left).toBeLessThan(1 / 12 + 0.01);
  expect(m.width).toBeGreaterThan(1 / 12 - 0.01);
  expect(m.width).toBeLessThan(1 / 12 + 0.01);
  await expect(page.locator('.day-now'), 'сейчас — внутри дня').toHaveCount(1);
});

test('числа: сегодня, неделя и месяц — время и деньги в основной валюте', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#st-today')).toHaveText('2ч 45м');
  await expect(page.locator('#st-today-money')).toHaveText(/2\s750\s₽/);
  await expect(page.locator('#st-week')).toHaveText('2ч 45м');
  await expect(page.locator('#kpi-month-label')).toHaveText(/Июнь/);
  await expect(page.locator('#st-time')).toHaveText('2ч 45м');
  await expect(page.locator('#st-done')).toHaveText('· 0 из 4 задач');
});

test('недавние проекты — три, по последней записи; щелчок открывает проект', async ({ page }) => {
  await seed(page);
  const cards = page.locator('#home-proj-grid .hp-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.hp-name')).toHaveText(['Приложение', 'Кофейня', 'Сайт']);
  await cards.first().click();
  await expect(page.locator('#project-view')).toBeVisible();
  await expect(page.locator('#ph-name')).toHaveText('Приложение');
});

test('сроки: просроченное красным, ближайшее обычным текстом', async ({ page }) => {
  await seed(page);
  const rows = page.locator('#home-due-list li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.rl-name')).toHaveText('Форма');
  await expect(rows.first().locator('.rl-when')).toHaveClass(/overdue/);
  await expect(rows.nth(1).locator('.rl-when')).not.toHaveClass(/overdue/);
  await expect(page.locator('#home-due-note')).toHaveText('просрочено: 1');
  const color = await page.evaluate(() => ({
    red: getComputedStyle(document.querySelector('.rl-when.overdue')).color,
    danger: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
  }));
  expect(color.red).not.toBe('');
});

test('«Сейчас идёт»: без таймера — последняя задача с плеем, плей запускает, стоп останавливает', async ({ page }) => {
  await seed(page);
  const island = page.locator('#now-island');
  await expect(island).toBeVisible();
  await expect(island).toHaveClass(/idle/);
  await expect(page.locator('#now-title')).toHaveText('Экран входа');
  await expect(page.locator('#now-since'), 'без таймера подписи «Продолжить» нет').toHaveText('');
  await expect(page.locator('#now-btn')).toHaveAttribute('aria-label', 'Старт');
  await page.locator('#now-btn').click();
  expect(await page.evaluate(() => state.activeTimer && state.activeTimer.taskId)).toBe('t2');
  await expect(island).not.toHaveClass(/idle/);
  await expect(page.locator('#now-label')).toHaveText('Сейчас идёт');
  await expect(page.locator('#now-since'), 'идёт — время начала').toHaveText(/^\d\d:\d\d$/);
  await expect(page.locator('#now-btn')).toHaveClass(/run/);
  await expect(page.locator('#tb-timer'), 'капсула в шапке').toBeVisible();
  await page.locator('#now-btn').click();
  expect(await page.evaluate(() => state.activeTimer)).toBeNull();
  expect(await page.evaluate(() => state.ui.view), 'остались на «Сегодня»').toBe('home');
  await expect(island).toHaveClass(/idle/);
});

test('недавние задачи: плей запускает без перехода, строка открывает задачу', async ({ page }) => {
  await seed(page);
  const rows = page.locator('#recent-list li');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('.rl-name')).toHaveText(['Экран входа', 'Логотип', 'Вёрстка']);
  await rows.nth(1).locator('.rl-play').click();
  expect(await page.evaluate(() => state.activeTimer.taskId)).toBe('t3');
  expect(await page.evaluate(() => state.ui.view)).toBe('home');
  await expect(rows.nth(1).locator('.rl-play')).toHaveAttribute('aria-label', 'Стоп');
  await rows.nth(2).locator('.rl-name').click();
  expect(await page.evaluate(() => [state.ui.view, selectedId])).toEqual(['task', 't1']);
});

test('«Открыть день» ведёт в календарь на сегодняшний день', async ({ page }) => {
  await seed(page);
  await page.locator('#day-open').click();
  expect(await page.evaluate(() => [state.ui.view, state.ui.timeMode, agenda.mode])).toEqual(['time', 'day', 'day']);
});

// Дедлайн: дата и время одним окном. Запуск: npm run test:e2e
//
// С 7 октября 2026 у срока одна кнопка и один попап: календарь, а под ним
// часы и минуты двумя полями. В поле можно вписать руками, по стрелке —
// выбрать из списка (минуты — через пять). Выбор дня окно не закрывает:
// дата и время задаются вместе, закрывает «Готово» или щелчок мимо.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

async function openTask(page, dueAt) {
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((dueAt) => {
    const now = new Date();
    const p = { id: uid(), name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] };
    state.projects.push(p);
    seedProjectStatuses(p.id);
    state.tasks.push({
      id: 't-1', projectId: p.id, title: 'Главная', done: false, notes: null, totalMs: 0, sessions: [],
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(p.id)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.ui.projectId = p.id;
    state.ui.view = 'project';
    render();
    selectTask('t-1');
  }, dueAt);
}

const due = (page) => page.evaluate(() => {
  const d = new Date(getTask('t-1').dueAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});

test('у срока одна кнопка — с датой и временем', async ({ page }) => {
  await openTask(page, new Date(2026, 5, 12, 18, 0).toISOString());
  await expect(page.locator('#due-date-btn')).toHaveText(/12 июн\. 2026, 18:00/);
  await expect(page.locator('#due-time-btn')).toHaveCount(0);
});

test('окно срока не выходит за край экрана', async ({ page }) => {
  // Кнопка срока стоит в правой колонке страницы задачи: окно шириной с
  // календарь не помещается справа от неё и должно сдвинуться влево.
  await page.setViewportSize({ width: 1280, height: 720 });
  await openTask(page, new Date(2026, 5, 12, 18, 0).toISOString());
  await page.locator('#due-date-btn').click();
  const m = await page.evaluate(() => {
    const r = document.getElementById('dp-pop').getBoundingClientRect();
    return { right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
  });
  expect(m.right, 'правый край').toBeLessThanOrEqual(m.w);
  expect(m.bottom, 'нижний край').toBeLessThanOrEqual(m.h);
});

test('в окне срока под календарём — часы и минуты; день его не закрывает', async ({ page }) => {
  await openTask(page, new Date(2026, 5, 12, 18, 0).toISOString());
  await page.locator('#due-date-btn').click();
  const pop = page.locator('#dp-pop');
  await expect(pop).toBeVisible();
  await expect(page.locator('#dp-time')).toBeVisible();
  await expect(page.locator('#dp-hours')).toHaveValue('18');
  await expect(page.locator('#dp-minutes')).toHaveValue('00');

  await pop.locator('.dp-day', { hasText: /^20$/ }).click();
  await expect(pop, 'окно открыто, пока не нажали «Готово»').toBeVisible();
  expect(await due(page)).toBe('2026-06-20 18:00');
  await page.locator('#dp-done').click();
  await expect(pop).toBeHidden();
});

test('время вписывается руками в любое значение', async ({ page }) => {
  await openTask(page, new Date(2026, 5, 12, 18, 0).toISOString());
  await page.locator('#due-date-btn').click();
  await page.locator('#dp-hours').fill('9');
  await page.locator('#dp-minutes').fill('47');
  await page.locator('#dp-minutes').press('Enter');
  expect(await due(page)).toBe('2026-06-12 09:47');
  await expect(page.locator('#dp-pop')).toBeHidden();
  await expect(page.locator('#due-date-btn')).toHaveText(/09:47/);
});

test('по стрелке время выбирается из списка — минуты через пять', async ({ page }) => {
  await openTask(page, new Date(2026, 5, 12, 18, 0).toISOString());
  await page.locator('#due-date-btn').click();
  await page.locator('#dp-hours-pick').click();
  const items = page.locator('#ctx-menu .ctx-item');
  await expect(items).toHaveCount(24);
  await items.filter({ hasText: /^14$/ }).click();
  await expect(page.locator('#dp-pop'), 'список — часть окна, а не щелчок мимо него').toBeVisible();
  await page.locator('#dp-minutes-pick').click();
  await expect(page.locator('#ctx-menu .ctx-item')).toHaveCount(12);
  await page.locator('#ctx-menu .ctx-item', { hasText: /^30$/ }).click();
  expect(await due(page)).toBe('2026-06-12 14:30');
});

test('негодное время не записывается', async ({ page }) => {
  await openTask(page, new Date(2026, 5, 12, 18, 0).toISOString());
  await page.locator('#due-date-btn').click();
  await page.locator('#dp-hours').fill('27');
  await page.locator('#dp-hours').press('Enter');
  expect(await due(page)).toBe('2026-06-12 18:00');
});

test('у задачи без срока окно открывается на сегодня с 18:00', async ({ page }) => {
  await openTask(page, null);
  await page.locator('#due-date-btn').click();
  await expect(page.locator('#dp-hours')).toHaveValue('18');
  await page.locator('#dp-pop .dp-day.today').click();
  expect(await due(page)).toBe('2026-06-10 18:00');
});

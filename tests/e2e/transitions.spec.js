// Анимация экранов: переход — да, перерисовка на месте — нет. Запуск:
// npm run test:e2e
//
// До 9 октября 2026 render() перезапускал въезд экрана (viewIn: прозрачность
// с нуля) на каждый вызов — старт таймера, галочку, синхронизацию, — и
// содержимое мигало. Теперь въезжает только другой экран, другой проект или
// другая задача; строки и карточки идут лесенкой только вместе с ним.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

async function seed(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const now = new Date().toISOString();
    for (const id of ['p1', 'p2']) {
      state.projects.push({ id, name: id, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
      seedProjectStatuses(id);
      state.tasks.push({ id: `t-${id}`, projectId: id, title: `Задача ${id}`, done: false, totalMs: 0, sessions: [], tagIds: [], statusId: orderedStatuses(id)[0].id, createdAt: now, updatedAt: now });
    }
  });
}

/** Идёт ли сейчас въезд у экрана или у карточек и строк на нём. */
const animating = (page, sel) => page.evaluate((s) => {
  const view = document.querySelector(s);
  return view.getAnimations({ subtree: true }).filter((a) => /viewIn|tileIn/.test(a.animationName)).length;
}, sel);

test('переход на другой экран въезжает, перерисовка на месте — нет', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openView('projects'));
  expect(await animating(page, '#projects-view'), 'новый экран въезжает').toBeGreaterThan(0);
  await expect(page.locator('#projects-view')).toHaveClass(/\bsettled\b/);

  // Таймер, галочка, синхронизация — всё это render() на том же экране.
  await page.evaluate(() => { startTimer('t-p1'); render(); });
  expect(await animating(page, '#projects-view'), 'перерисовка на месте не мигает').toBe(0);
  await expect(page.locator('#projects-view')).toHaveCSS('opacity', '1');

  await page.evaluate(() => openView('home'));
  expect(await animating(page, '#home-view'), 'и обратно — снова переход').toBeGreaterThan(0);
});

test('другой проект и другая задача — тоже переход', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openProject('p1'));
  await expect(page.locator('#project-view')).toHaveClass(/\bsettled\b/);
  await page.evaluate(() => render());
  expect(await animating(page, '#project-view')).toBe(0);
  await page.evaluate(() => openProject('p2'));
  expect(await animating(page, '#project-view'), 'другой проект въезжает').toBeGreaterThan(0);

  await page.evaluate(() => selectTask('t-p1'));
  await expect(page.locator('#task-view')).toHaveClass(/\bsettled\b/);
  await page.evaluate(() => selectTask('t-p2'));
  expect(await animating(page, '#task-view'), 'другая задача въезжает').toBeGreaterThan(0);
});

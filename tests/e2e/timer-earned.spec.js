// Заработанное рядом с таймером задачи. Запуск: npm run test:e2e
//
// С 6 октября 2026 сумма стоит справа от времени, по нижнему краю цифр, без
// подписи. Правило показа — в ядре (Core.earnedShown, закрыто юнитами в
// money.test.js); здесь — что экран его зовёт, ставит сумму туда, куда
// обещано, и пересчитывает вместе с идущим таймером.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

/** Проект с одной задачей: час записанного времени, ставка — параметром. */
async function openTask(page, { defaultRate, taskRate }) {
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(([HOUR, defaultRate, taskRate]) => {
    const now = new Date();
    state.settings.hourlyRate = defaultRate;
    state.settings.currency = 'RUB';
    const p = { id: uid(), name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] };
    state.projects.push(p);
    seedProjectStatuses(p.id);
    const start = new Date(now.getTime() - 3 * HOUR);
    const t = {
      id: 't-1', projectId: p.id, title: 'Главная', done: false, notes: null,
      totalMs: HOUR, sessions: [{ start: start.toISOString(), end: new Date(start.getTime() + HOUR).toISOString(), ms: HOUR }],
      rate: taskRate, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(p.id)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    };
    state.tasks.push(t);
    state.ui.projectId = p.id;
    state.ui.view = 'project';
    render();
    selectTask('t-1');
  }, [HOUR, defaultRate, taskRate]);
}

test('со ставкой сумма стоит под временем, по его левому краю и мельче', async ({ page }) => {
  await openTask(page, { defaultRate: 2000, taskRate: null });
  const earned = page.locator('#timer-earned');
  await expect(earned).toBeVisible();
  const want = await page.evaluate(() => fmtMoney(2000));
  await expect(earned).toHaveText(want);

  const g = await page.evaluate(() => {
    const d = document.getElementById('timer-display').getBoundingClientRect();
    const e = document.getElementById('timer-earned').getBoundingClientRect();
    const size = (id) => parseFloat(getComputedStyle(document.getElementById(id)).fontSize);
    return { dLeft: d.left, dBottom: d.bottom, eLeft: e.left, eTop: e.top, dSize: size('timer-display'), eSize: size('timer-earned') };
  });
  expect(g.eTop, 'под временем').toBeGreaterThanOrEqual(g.dBottom);
  expect(Math.abs(g.eLeft - g.dLeft), 'по левому краю цифр').toBeLessThan(2);
  expect(g.eSize, 'мельче времени').toBeLessThan(g.dSize);
});

test('своя ставка задачи сильнее общей', async ({ page }) => {
  await openTask(page, { defaultRate: 2000, taskRate: 3000 });
  const want = await page.evaluate(() => fmtMoney(3000));
  await expect(page.locator('#timer-earned')).toHaveText(want);
});

test('ни ставки, ни заработанного — суммы нет', async ({ page }) => {
  await openTask(page, { defaultRate: 0, taskRate: null });
  await expect(page.locator('#timer-earned')).toBeHidden();
});

test('идущий таймер прибавляется к сумме', async ({ page }) => {
  await openTask(page, { defaultRate: 2000, taskRate: null });
  // Таймер запущен час назад: к записанному часу добавляется ещё один.
  await page.evaluate((HOUR) => {
    state.activeTimer = { taskId: 't-1', startedAt: new Date(Date.now() - HOUR).toISOString() };
    selectTask('t-1');
  }, HOUR);
  const want = await page.evaluate(() => fmtMoney(4000));
  await expect(page.locator('#timer-earned')).toHaveText(want);
});

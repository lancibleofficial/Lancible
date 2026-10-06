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

test('со ставкой сумма стоит справа от времени, по нижнему краю цифр', async ({ page }) => {
  await openTask(page, { defaultRate: 2000, taskRate: null });
  const earned = page.locator('#timer-earned');
  await expect(earned).toBeVisible();
  const want = await page.evaluate(() => fmtMoney(2000));
  await expect(earned).toHaveText(want);

  const g = await page.evaluate(() => {
    const d = document.getElementById('timer-display').getBoundingClientRect();
    const e = document.getElementById('timer-earned').getBoundingClientRect();
    const line = getComputedStyle(document.querySelector('.timer-line'));
    const color = getComputedStyle(document.getElementById('timer-earned')).color;
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-ink)';
    document.body.append(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    return { dRight: d.right, eLeft: e.left, dTop: d.top, dBottom: d.bottom, eTop: e.top, eBottom: e.bottom, align: line.alignItems, color, ink };
  });
  expect(g.eLeft, 'справа от времени').toBeGreaterThan(g.dRight);
  expect(g.align, 'выровнены по базовой линии цифр').toBe('baseline');
  // Сумма мельче времени и стоит внутри его высоты, ближе к низу.
  expect(g.eBottom).toBeLessThanOrEqual(g.dBottom + 1);
  expect(g.eTop).toBeGreaterThan(g.dTop);
  expect(g.color, 'зелёный — текстовым токеном').toBe(g.ink);
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

// История записей времени — одним островом. Запуск: npm run test:e2e
//
// С 7 октября 2026 записи не лежат карточками по одной, а собраны в один
// блок с разделителями между строками — как строки настроек. Остров — общая
// деталь (.island в слое «Компоненты»), и у истории, и у настроек она одна.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

test('записи — один остров с разделителями, без своих рамок', async ({ page }) => {
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((HOUR) => {
    const now = new Date();
    const p = { id: uid(), name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] };
    state.projects.push(p);
    seedProjectStatuses(p.id);
    const ses = (d, h) => { const s = new Date(now); s.setDate(s.getDate() - d); s.setHours(h, 0, 0, 0); return { start: s.toISOString(), end: new Date(s.getTime() + HOUR).toISOString(), ms: HOUR }; };
    state.tasks.push({
      id: 't-1', projectId: p.id, title: 'Главная', done: false, notes: null, totalMs: 3 * HOUR,
      sessions: [ses(2, 10), ses(1, 11), ses(0, 9)], rate: null, pinnedAt: null,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), statusId: orderedStatuses(p.id)[0].id,
      tagIds: [], versionId: null, repeat: null, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.ui.projectId = p.id;
    state.ui.view = 'project';
    render();
    selectTask('t-1');
    setTaskTab('history');
  }, HOUR);

  const m = await page.evaluate(() => {
    const list = getComputedStyle(document.getElementById('session-list'));
    const card = getComputedStyle(document.querySelector('.settings-card') || document.createElement('div'));
    const items = [...document.querySelectorAll('.session-item')].map((n) => {
      const s = getComputedStyle(n);
      return { bottom: s.borderBottomWidth, top: s.borderTopWidth, left: s.borderLeftWidth, radius: s.borderRadius, margin: s.marginBottom };
    });
    return { listBorder: list.borderTopWidth, listRadius: list.borderRadius, items };
  });
  expect(m.items).toHaveLength(3);
  expect(m.listBorder, 'у острова нет обводки — дизайн плоский').toBe('0px');
  for (const it of m.items) {
    expect(it.left, 'у записи своей рамки нет').toBe('0px');
    expect(it.radius).toBe('0px');
    expect(it.margin).toBe('0px');
  }
  expect(m.items.slice(0, -1).every((it) => it.bottom === '1px'), 'между записями — разделитель').toBe(true);
  expect(m.items.at(-1).bottom, 'после последней — нет').toBe('0px');
});

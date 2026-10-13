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

test('«+ Запись» и «Excel» — одна кнопка одного размера и вида', async ({ page }) => {
  // Excel был серой .ghost без иконки и другой высоты, «+ Запись» — .btn-soft:
  // в одной строке заголовка они читались как две случайные кнопки.
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
    const s = new Date(now); s.setHours(9, 0, 0, 0);
    state.tasks.push({
      id: 't-1', projectId: p.id, title: 'Главная', done: false, notes: null, totalMs: HOUR,
      sessions: [{ start: s.toISOString(), end: new Date(s.getTime() + HOUR).toISOString(), ms: HOUR }],
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(p.id)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.ui.projectId = p.id;
    state.ui.view = 'project';
    render();
    selectTask('t-1');
    setTaskTab('history');
  }, HOUR);

  const m = await page.evaluate(() => {
    const read = (id) => {
      const n = document.getElementById(id);
      const r = n.getBoundingClientRect();
      const s = getComputedStyle(n);
      return {
        cls: n.className, height: r.height, top: r.top, bg: s.backgroundColor, color: s.color,
        font: s.fontSize, radius: s.borderRadius, hasIcon: !!n.querySelector('svg.icon'),
      };
    };
    return { add: read('add-session-btn'), excel: read('export-task-btn') };
  });
  expect(m.excel.cls, 'один класс кнопки').toBe(m.add.cls);
  expect(m.excel.cls).toBe('btn-soft');
  expect(m.excel.height, 'одной высоты').toBeCloseTo(m.add.height, 0);
  expect(m.excel.top, 'в одной строке').toBeCloseTo(m.add.top, 0);
  for (const k of ['bg', 'color', 'font', 'radius']) expect(m.excel[k], `одинаковый ${k}`).toBe(m.add[k]);
  expect(m.add.hasIcon && m.excel.hasIcon, 'у обеих кнопок есть значок').toBe(true);
  await expect(page.locator('#export-task-btn')).toHaveText('Excel');
});

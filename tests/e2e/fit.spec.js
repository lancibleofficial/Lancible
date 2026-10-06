// Ничего не вылезает и не ломается на узких окнах. Запуск: npm run test:e2e
//
// 7 октября 2026 на узком окне подписи карточек статистики вылезали за
// карточку, суммы в клетках календаря ломались на две строки, а подписи
// фильтра переносились. Каждое из этого — замер, а не взгляд: прямоугольник
// подписи внутри прямоугольника карточки, высота текста — в одну строку.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function open(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((HOUR) => {
    state.settings.hourlyRate = 2500;
    const p = { id: uid(), name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] };
    state.projects.push(p);
    seedProjectStatuses(p.id);
    const now = new Date();
    const ses = (d, h, ms) => { const s = new Date(now); s.setDate(s.getDate() + d); s.setHours(h, 0, 0, 0); return { start: s.toISOString(), end: new Date(s.getTime() + ms).toISOString(), ms }; };
    state.tasks.push({
      id: uid(), projectId: p.id, title: 'Главная', done: false, notes: null, totalMs: 5 * HOUR,
      sessions: [ses(-1, 10, 2 * HOUR), ses(0, 9, 3 * HOUR)], rate: null, pinnedAt: null,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), statusId: orderedStatuses(p.id)[0].id,
      tagIds: [], versionId: null, repeat: null, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.ui.projectId = p.id;
  }, HOUR);
}

/** Подписи и числа карточек — внутри своих карточек, в одну-две строки. */
const cardsFit = (page) => page.evaluate(() => {
  const bad = [];
  for (const card of document.querySelectorAll('.stat-card')) {
    if (!card.offsetParent) continue;
    const c = card.getBoundingClientRect();
    for (const n of card.querySelectorAll('b, span')) {
      const r = n.getBoundingClientRect();
      if (r.right > c.right + 0.5 || r.left < c.left - 0.5 || r.bottom > c.bottom + 0.5) bad.push(`${n.textContent} вылезает`);
      if (n.scrollWidth > n.clientWidth + 1) bad.push(`${n.textContent} обрезан`);
      const lh = parseFloat(getComputedStyle(n).lineHeight);
      if (r.height > lh * 2 + 2) bad.push(`${n.textContent} в три строки`);
    }
  }
  return bad;
});

for (const width of [1280, 1024, 900, 760]) {
  test(`карточки статистики целы на ${width} px — и на «Обзоре», и в статистике`, async ({ page }) => {
    await open(page, width);
    await page.evaluate(() => { state.ui.view = 'home'; render(); });
    expect(await cardsFit(page), 'обзор').toEqual([]);
    await page.evaluate(() => { state.ui.view = 'stats'; render(); });
    expect(await cardsFit(page), 'статистика').toEqual([]);
  });
}

test('суммы в клетках календаря статистики — одной строкой', async ({ page }) => {
  await open(page, 900);
  await page.evaluate(() => { state.ui.view = 'stats'; render(); });
  const bad = await page.evaluate(() => [...document.querySelectorAll('.cc-money, .cc-time')]
    .filter((n) => n.getBoundingClientRect().height > parseFloat(getComputedStyle(n).lineHeight) + 2)
    .map((n) => n.textContent));
  expect(bad).toEqual([]);
});

test('подписи фильтра задач не переносятся в узком списке', async ({ page }) => {
  await open(page, 1280);
  await page.evaluate(() => { openProject(state.projects[0].id); });
  const m = await page.evaluate(() => [...document.querySelectorAll('.tf-status button')].map((b) => ({
    text: b.textContent, lines: (() => {
      // line-height у кнопки «normal» — считаем от кегля: одна строка текста
      // вместе с отступами никак не выше двух кеглей.
      const cs = getComputedStyle(b);
      const inner = b.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return inner < parseFloat(cs.fontSize) * 1.9 ? 1 : 2;
    })(),
  })));
  expect(m.map((x) => x.text)).toEqual(['Все', 'Не выполнено', 'Выполнено']);
  expect(m.every((x) => x.lines === 1), `перенос: ${JSON.stringify(m)}`).toBe(true);
});

// Шапка периода у календаря и статистики — одна. Запуск: npm run test:e2e
//
// До 6 октября 2026 они листали время по-разному: в календаре «Сегодня» и
// стрелки слева, режимы справа, а в статистике наоборот — режимы слева,
// «Сегодня» справа, стрелки посередине. Теперь у обеих одна шапка
// (.period-head): слева «Сегодня», стрелки и название периода, в статистике
// следом переключатель «Выбрать период»; режимы — у правого края, от
// меньшего к большему. Проверяем замером, а не на глаз.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

async function open(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
}

/** Рамки элементов шапки и подписи режимов на открытом экране. */
const measure = (page, view, ids) => page.evaluate(([v, sel]) => {
  state.ui.view = v;
  render();
  const box = (s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const out = {};
  for (const [k, s] of Object.entries(sel)) out[k] = box(s);
  out.modeLabels = [...document.querySelectorAll(`${sel.modes} button`)].map((b) => b.textContent.trim());
  const ts = getComputedStyle(document.querySelector(sel.title));
  out.titleFont = `${ts.fontFamily}|${ts.fontSize}|${ts.fontWeight}`;
  return out;
}, [view, ids]);

const CALENDAR = {
  head: '#calendar-view .period-head', today: '#ag-today', prev: '#ag-prev', next: '#ag-next',
  title: '#ag-title', modes: '#ag-modes',
};
const STATS = {
  head: '#stats-view .period-head', today: '#cal-today', prev: '#cal-prev', next: '#cal-next',
  title: '#cal-title', toggle: '#cal-period-toggle', modes: '.cal-modes',
};

test('календарь и статистика листают время одной шапкой', async ({ page }) => {
  await open(page);
  for (const [view, ids] of [['calendar', CALENDAR], ['stats', STATS]]) {
    const m = await measure(page, view, ids);
    // Слева направо: «Сегодня», назад, вперёд, название периода.
    expect(m.today.left - m.head.left, `${view}: «Сегодня» — первым слева`).toBeLessThan(2);
    expect(m.prev.left, `${view}: стрелки после «Сегодня»`).toBeGreaterThan(m.today.right);
    expect(m.next.left).toBeGreaterThan(m.prev.right);
    expect(m.title.left, `${view}: название периода после стрелок`).toBeGreaterThan(m.next.right);
    // Режимы — у правого края шапки.
    expect(Math.abs(m.head.right - m.modes.right), `${view}: режимы у правого края`).toBeLessThan(2);
    expect(m.modes.left).toBeGreaterThan(m.title.right);
  }
});

test('в статистике «Выбрать период» стоит слева — сразу за названием периода', async ({ page }) => {
  await open(page);
  const m = await measure(page, 'stats', STATS);
  expect(m.toggle.left).toBeGreaterThan(m.title.right);
  expect(m.toggle.right, 'и до режимов').toBeLessThan(m.modes.left);
  // Одна строка: шапка не разъехалась на две.
  expect(Math.abs(m.toggle.top - m.today.top)).toBeLessThan(8);
});

test('режимы идут от меньшего к большему на обоих экранах', async ({ page }) => {
  await open(page);
  const cal = await measure(page, 'calendar', CALENDAR);
  const stats = await measure(page, 'stats', STATS);
  expect(cal.modeLabels).toEqual(['День', '4 дня', 'Неделя', 'Месяц', 'Расписание']);
  expect(stats.modeLabels).toEqual(['День', 'Неделя', 'Месяц']);
});

test('название периода набрано одинаково на обоих экранах', async ({ page }) => {
  await open(page);
  const cal = await measure(page, 'calendar', CALENDAR);
  const stats = await measure(page, 'stats', STATS);
  expect(stats.titleFont).toBe(cal.titleFont);
  expect(cal.titleFont).toMatch(/^"?Basique Pro/);
});

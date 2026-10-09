// Шапка раздела «Время». Запуск: npm run test:e2e
//
// До 7 октября 2026 календарь и статистика были двумя экранами с двумя
// шапками, и те листали время по-разному. Теперь раздел один и шапка одна:
// слева «Свернуть» (прячет числа и панель дня), режимы от меньшего к
// большему, «Сегодня», стрелки и название периода; справа фильтр проекта,
// «Экспорт» и «+ Запись» — последней, главной кнопкой экрана. На 1280 она
// помещается в одну строку в любом режиме — вторая строка отжимала бы сетку
// вниз. Проверяем замером, а не на глаз.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

async function open(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
}

const SEL = {
  head: '#time-view .time-head', modes: '#time-modes', today: '#time-today',
  prev: '#time-prev', next: '#time-next', title: '#time-title',
  filter: '#sf-project', create: '#ag-create', excel: '#export-period-btn',
  collapse: '#time-stats-toggle',
};

/** Рамки элементов шапки в указанном режиме. */
const measure = (page, mode) => page.evaluate(([m, sel]) => {
  state.ui.view = 'time';
  state.ui.timeMode = m;
  render();
  const box = (s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 };
  };
  const out = {};
  for (const [k, s] of Object.entries(sel)) out[k] = box(s);
  out.modeLabels = [...document.querySelectorAll(`${sel.modes} button`)].map((b) => b.textContent.trim());
  const ts = getComputedStyle(document.querySelector(sel.title));
  out.titleFont = `${ts.fontFamily}|${ts.fontSize}|${ts.fontWeight}`;
  return out;
}, [mode, SEL]);

const MODES = ['day', 'week', 'month', 'agenda'];

test('«Свернуть» и режимы слева, «Сегодня» и стрелки перед названием периода, действия справа', async ({ page }) => {
  await open(page);
  const m = await measure(page, 'week');
  expect(m.collapse.left - m.head.left, '«Свернуть» — первой слева').toBeLessThan(16);
  expect(m.modes.left, 'режимы — сразу за ней').toBeGreaterThan(m.collapse.right);
  expect(m.today.left).toBeGreaterThan(m.modes.right);
  expect(m.prev.left, 'стрелки после «Сегодня»').toBeGreaterThan(m.today.right);
  expect(m.next.left).toBeGreaterThan(m.prev.right);
  expect(m.title.left, 'название периода после стрелок').toBeGreaterThan(m.next.right);
  expect(m.filter.left, 'фильтр — в правой части').toBeGreaterThan(m.title.right);
  expect(m.excel.left, '«Экспорт» — после фильтра').toBeGreaterThan(m.filter.right);
  expect(m.create.left, '«+ Запись» — после «Экспорта»').toBeGreaterThan(m.excel.right);
  expect(m.head.right - m.create.right, '«+ Запись» — у правого края').toBeLessThan(16);
});

test('«+ Запись» — акцентная, «Экспорт» — такая же, но вторичная, с подписью и значком', async ({ page }) => {
  await open(page);
  await measure(page, 'week');
  const b = await page.evaluate(() => {
    const look = (s) => {
      const n = document.querySelector(s);
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return { bg: cs.backgroundColor, h: Math.round(r.height), radius: cs.borderRadius, text: n.textContent.trim(), icon: !!n.querySelector('svg.icon') };
    };
    const probe = document.createElement('i');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { create: look('#ag-create'), excel: look('#export-period-btn'), accent };
  });
  expect(b.create.bg, '«+ Запись» залита акцентом').toBe(b.accent);
  expect(b.excel.bg, '«Экспорт» — не акцентом').not.toBe(b.accent);
  expect(b.excel.text).toBe('Экспорт');
  expect(b.excel.icon, 'у «Экспорта» значок').toBe(true);
  expect(b.excel.h, 'одна высота').toBe(b.create.h);
  expect(b.excel.radius, 'одна форма').toBe(b.create.radius);
});

test('на панели чисел своей выгрузки нет — она одна, в шапке', async ({ page }) => {
  await open(page);
  await measure(page, 'week');
  await expect(page.locator('#time-kpis button')).toHaveCount(0);
  await expect(page.locator('#time-view', { hasText: 'Скачать всё в Excel' })).toHaveCount(0);
});

for (const mode of MODES) {
  test(`на 1280 шапка в одну строку — режим ${mode}`, async ({ page }) => {
    await open(page);
    const m = await measure(page, mode);
    const mids = [m.collapse, m.modes, m.today, m.title, m.filter, m.excel, m.create].map((b) => b.mid);
    expect(Math.max(...mids) - Math.min(...mids), 'элементы на одной строке').toBeLessThan(6);
    expect(m.head.bottom - m.head.top, 'шапка не выросла на вторую строку').toBeLessThan(60);
  });
}

test('режимы идут от меньшего к большему', async ({ page }) => {
  await open(page);
  const m = await measure(page, 'week');
  expect(m.modeLabels).toEqual(['День', 'Неделя', 'Месяц', 'Расписание']);
});

test('название периода набрано Basique Pro', async ({ page }) => {
  await open(page);
  const m = await measure(page, 'week');
  expect(m.titleFont).toMatch(/^"?Basique Pro/);
});

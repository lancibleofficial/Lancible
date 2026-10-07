// Крайние случаи экрана проекта: что важно видеть, видно и тогда, когда
// данные длинные. Запуск: npm run test:e2e
//
// 7 октября 2026 название проекта в 60 знаков резалось до «Сай…», потому
// что строку с ним делили теги, вкладки, итоги и кнопки. Теперь название —
// в своей строке и видно целиком на окне от 1024 px; теги — первые три и
// «+N»; длинные названия задач и статусов режутся сами, не ломая строки.
// Снимки этих же состояний — в tests/visual/web.spec.js, для глаз.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');
const { seedEdge } = require('./edge-seed');

async function open(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(`(${seedEdge.toString()})()`);
  await page.evaluate(() => { openProject(state.projects[0].id); });
}

const NAME = 'Очень длинное название проекта для проверки ширины шапки';

for (const width of [1440, 1024]) {
  test(`название проекта в 60 знаков видно целиком на ${width} px`, async ({ page }) => {
    await open(page, width);
    const m = await page.evaluate(() => {
      const n = document.getElementById('ph-name');
      return { text: n.textContent, cut: n.scrollWidth > n.clientWidth + 1, lines: Math.round(n.getBoundingClientRect().height / 22) };
    });
    expect(m.text).toBe(NAME);
    expect(m.cut, 'название обрезано многоточием').toBe(false);
    expect(m.lines).toBe(1);
  });
}

test('теги в шапке — первые три и «+N», остальные подсказкой', async ({ page }) => {
  await open(page, 1440);
  const chips = page.locator('#ph-tags .tag-chip');
  await expect(chips).toHaveCount(4);
  await expect(chips.nth(3)).toHaveText('+4');
  const title = await chips.nth(3).getAttribute('title');
  expect(title.split(', ')).toHaveLength(4);
});

for (const width of [1440, 1024, 860]) {
  test(`ничего не вылезает за окно и шапка остаётся двумя строками на ${width} px`, async ({ page }) => {
    await open(page, width);
    const m = await page.evaluate(() => ({
      pageWide: document.documentElement.scrollWidth > innerWidth,
      head: document.getElementById('project-header').getBoundingClientRect().height,
      addRight: innerWidth - document.getElementById('new-task-btn').getBoundingClientRect().right,
      sidebarWide: document.getElementById('sidebar').scrollWidth > document.getElementById('sidebar').clientWidth + 1,
    }));
    expect(m.pageWide, 'горизонтальная прокрутка').toBe(false);
    expect(m.head, 'шапка-остров: две строки с полями').toBeLessThanOrEqual(100);
    // Поле страницы и поле острова: 12 + 16.
    expect(m.addRight, '«+ Задача» у правого края').toBeLessThanOrEqual(30);
    expect(m.sidebarWide, 'список шире себя').toBe(false);
  });
}

test('длинные названия задач и статусов режутся, не ломая строки', async ({ page }) => {
  await open(page, 1024);
  const m = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#task-list .task-item')].find((n) => n.textContent.includes('Переверстать'));
    const name = row.querySelector('.task-name');
    const group = [...document.querySelectorAll('#task-list .task-group')].find((n) => n.textContent.includes('Ожидает'));
    const gname = group.querySelector('.tg-name');
    const gtime = group.querySelector('.tg-time');
    const list = document.getElementById('task-list').getBoundingClientRect();
    return {
      nameLines: Math.round(name.getBoundingClientRect().height / 20),
      nameCut: name.scrollWidth > name.clientWidth,
      rowHeight: row.getBoundingClientRect().height,
      groupHeight: group.getBoundingClientRect().height,
      gnameLines: Math.round(gname.getBoundingClientRect().height / 17),
      timeInside: gtime.getBoundingClientRect().right <= list.right,
    };
  });
  expect(m.nameLines).toBe(1);
  expect(m.nameCut, 'длинное название задачи обрезано многоточием, а не переносится').toBe(true);
  expect(m.rowHeight).toBeLessThanOrEqual(52);
  expect(m.gnameLines).toBe(1);
  expect(m.groupHeight).toBeLessThanOrEqual(34);
  expect(m.timeInside, 'время группы не выдавлено за список').toBe(true);
});

test('на доске длинные статусы не ломают заголовки столбцов', async ({ page }) => {
  await open(page, 1024);
  await page.locator('#proj-tabs button', { hasText: 'Доска' }).click();
  const bad = await page.evaluate(() => [...document.querySelectorAll('.board-col-head')].filter((h) => {
    const r = h.getBoundingClientRect();
    return r.height > 40 || [...h.children].some((c) => c.getBoundingClientRect().right > r.right + 1);
  }).map((h) => h.textContent.trim()));
  expect(bad).toEqual([]);
});

test('теги в шапке уступают названию: ни один чип не режется посередине', async ({ page }) => {
  // На 1024 px рядом с названием в 60 знаков помещается один-два чипа.
  // Лишние уходят в «+N», а не обрезаются по краю.
  await open(page, 1024);
  const m = await page.evaluate(() => {
    const box = document.getElementById('ph-tags').getBoundingClientRect();
    const chips = [...document.querySelectorAll('#ph-tags .tag-chip')].map((c) => ({ text: c.textContent, right: c.getBoundingClientRect().right }));
    return { boxRight: box.right, chips };
  });
  expect(m.chips.length).toBeGreaterThanOrEqual(1);
  expect(m.chips.every((c) => c.right <= m.boxRight + 1), `чип вылез: ${JSON.stringify(m)}`).toBe(true);
  expect(m.chips.at(-1).text, 'последний — счётчик остальных').toMatch(/^\+\d+$/);
});

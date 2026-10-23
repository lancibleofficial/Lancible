// Вёрстка админки: нет прокрутки вбок на 1280 и 1024 ни в одном разделе;
// окно подтверждения стоит по центру; на телефонной ширине страница не
// ломается (не цель, но и не развал).
const { test, expect } = require('./mock');

const PAGES = ['#/overview', '#/screens', '#/users', '#/users/u-1', '#/feedback', '#/agent', '#/blog', '#/blog/p-1', '#/blog/new', '#/releases', '#/logs', '#/architecture', '#/graph'];

/** Ширина документа против ширины окна и самый правый край видимых узлов. */
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    let worst = null;
    for (const el of document.querySelectorAll('#app *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('.table-wrap, .segmented')) continue;
      if (r.right > doc.clientWidth + 0.5 && (!worst || r.right > worst.right)) worst = { right: Math.round(r.right), el: `${el.tagName.toLowerCase()}.${el.className}` };
    }
    return { scroll: doc.scrollWidth, client: doc.clientWidth, worst };
  });
}

for (const width of [1280, 1024]) {
  test(`нет прокрутки вбок на ${width}`, async ({ page, open }) => {
    await open({ signedIn: 'aal2' });
    await page.setViewportSize({ width, height: 800 });
    for (const hash of PAGES) {
      await page.goto(`/${hash}`);
      await expect(page.locator('.page-body > *').first()).toBeVisible();
      await expect(page.locator('.note[aria-busy]')).toHaveCount(0);
      const o = await overflow(page);
      expect(o.scroll, `${hash}: документ шире окна`).toBeLessThanOrEqual(o.client);
      expect(o.worst, `${hash}: узел за правым краем`).toBeNull();
    }
  });
}

test('у таблицы пользователей своя прокрутка, у страницы — нет', async ({ page, open }) => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `u-${i}`, email: `very.long.address.number.${i}@a-really-long-domain.example.test`, createdAt: '2026-09-02T10:00:00Z', lastSignInAt: '2026-10-22T08:00:00Z', provider: 'email', aiAccess: i % 2 === 0, projects: 123456, tasks: 9876543, lastActiveDay: '2026-10-22', feedback: 12, aiCalls7: 4321 }));
  await open({ signedIn: 'aal2', handlers: { users: () => ({ total: 30, rows: many }) } });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/#/users');
  await expect(page.locator('#users-table tbody tr')).toHaveCount(30);
  const o = await overflow(page);
  expect(o.scroll).toBeLessThanOrEqual(o.client);
});

test('окно подтверждения — по центру', async ({ page, open }) => {
  await open({ signedIn: 'aal2' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/blog/p-1');
  await page.locator('#post-delete').click();
  // Окно въезжает (popIn) — мерить, когда встало.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const box = await page.locator('#confirm-backdrop .modal').boundingBox();
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-backdrop')).toHaveCount(0);
});

test('меню не уезжает за край окна', async ({ page, open }) => {
  await open({ signedIn: 'aal2' });
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/#/feedback');
  const btn = page.locator('.fb-card[data-id="f-2"] [data-action="status"]');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  const menu = await page.locator('#ctx-menu').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(1024);
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(700);
});

test('телефонная ширина: разделы видны, вбок не едет', async ({ page, open }) => {
  await open({ signedIn: 'aal2' });
  await page.setViewportSize({ width: 390, height: 800 });
  for (const hash of ['#/overview', '#/feedback', '#/releases', '#/users', '#/users/u-2']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('.page-body > *').first()).toBeVisible();
    await expect(page.locator('.rail-item[aria-current="page"]')).toBeVisible();
    const o = await overflow(page);
    expect(o.scroll, hash).toBeLessThanOrEqual(o.client);
  }
});

// Пользователи: фильтр доступа к агенту стоит в шапке раздела, кнопка доступа
// — внутри своей ячейки строки и внутри окна, в карточке — рядом с меткой.
for (const width of [1280, 1024]) {
  test(`пользователи на ${width}: фильтр в шапке, кнопка доступа целиком в ячейке`, async ({ page, open }) => {
    await open({ signedIn: 'aal2' });
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/#/users');
    await expect(page.locator('#users-table tbody tr')).toHaveCount(2);
    const geo = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height }; };
      const seg = r(document.querySelector('#users-filter'));
      const search = r(document.querySelector('#users-search'));
      const row = document.querySelector('#users-table tbody tr[data-id="u-2"]');
      const cell = row.querySelector('td:last-child');
      const btn = row.querySelector('[data-action="access"]');
      const chip = row.querySelector('.chip');
      return { vw: document.documentElement.clientWidth, seg, search, cell: r(cell), btn: r(btn), chip: r(chip), row: r(row), btnHeight: getComputedStyle(btn).height };
    });
    expect(geo.seg.right, 'фильтр в окне').toBeLessThanOrEqual(geo.vw);
    expect(geo.search.right, 'поиск в окне').toBeLessThanOrEqual(geo.vw);
    expect(geo.seg.right, 'фильтр и поиск не наезжают').toBeLessThanOrEqual(geo.search.left + 0.5);
    expect(geo.btn.left).toBeGreaterThanOrEqual(geo.cell.left);
    expect(geo.btn.right, 'кнопка внутри ячейки').toBeLessThanOrEqual(geo.cell.right + 0.5);
    expect(geo.chip.right, 'метка левее кнопки').toBeLessThanOrEqual(geo.btn.left + 0.5);
    expect(geo.btnHeight, '.btn-sm — 28 px').toBe('28px');
    // Метка и кнопка — на одной середине.
    expect(Math.abs((geo.chip.top + geo.chip.bottom) / 2 - (geo.btn.top + geo.btn.bottom) / 2)).toBeLessThanOrEqual(1);
    expect(geo.btn.top).toBeGreaterThanOrEqual(geo.row.top);
    expect(geo.btn.bottom).toBeLessThanOrEqual(geo.row.bottom);
  });
}

test('карточка пользователя: метка доступа и кнопка — в одной строке и в окне', async ({ page, open }) => {
  await open({ signedIn: 'aal2' });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/#/users/u-2');
  const geo = await page.evaluate(() => {
    const cell = document.querySelector('.dl [data-role="access"]');
    const chip = cell.querySelector('.chip').getBoundingClientRect();
    const btn = cell.querySelector('[data-action="access"]').getBoundingClientRect();
    return { vw: document.documentElement.clientWidth, chip: { top: chip.top, bottom: chip.bottom, right: chip.right }, btn: { left: btn.left, right: btn.right, top: btn.top, bottom: btn.bottom } };
  });
  expect(geo.btn.right).toBeLessThanOrEqual(geo.vw);
  expect(geo.chip.right).toBeLessThanOrEqual(geo.btn.left + 0.5);
  expect(Math.abs((geo.chip.top + geo.chip.bottom) / 2 - (geo.btn.top + geo.btn.bottom) / 2)).toBeLessThanOrEqual(1);
});

// Раздел «Документы». Запуск: npm run test:e2e
//
// Документ — текст отдельно от задачи: общий или проекта, с тем же
// редактором, что заметки. Проверяем то, без чего раздел бесполезен:
// создать, назвать, написать, найти, привязать к проекту, удалить — и что
// всё это лежит в данных и уходит в синхронизацию.
const { test, expect } = require('@playwright/test');

async function start(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  return page.evaluate(() => {
    const now = new Date().toISOString();
    const pid = uid();
    state.projects.push({ id: pid, name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
    seedProjectStatuses(pid);
    render();
    return pid;
  });
}

const docs = (page) => page.evaluate(() => { flushEditor(); return state.documents; });

test('документ создаётся, называется и пишется', async ({ page }) => {
  await start(page);
  await page.locator('#navrail .nav-item[data-view="docs"]').click();
  await expect(page.locator('#doc-empty')).toBeVisible();
  await page.locator('#doc-empty-new').click();
  await page.keyboard.type('Бриф');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Цель сайта — заявки.');
  const list = await docs(page);
  expect(list).toHaveLength(1);
  expect(list[0].title).toBe('Бриф');
  expect(list[0].body.doc.content[0].content[0].text).toBe('Цель сайта — заявки.');
  await expect(page.locator('#doc-list .doc-item')).toHaveCount(1);
  await expect(page.locator('#doc-list .doc-item-title')).toHaveText('Бриф');
});

test('поиск находит документ по тексту, а не только по названию', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const a = Core.newDocument({ id: uid(), title: 'Договор' });
    const b = Core.newDocument({ id: uid(), title: 'Черновик' });
    b.body = Core.readNotes({ ops: [{ insert: 'про аренду офиса\n' }] });
    state.documents.push(a, b);
    openDocs();
  });
  await page.locator('#doc-search').fill('аренд');
  await expect(page.locator('#doc-list .doc-item')).toHaveCount(1);
  await expect(page.locator('#doc-list .doc-item-title')).toHaveText('Черновик');
});

test('документ привязывается к проекту и остаётся, когда проект удалили', async ({ page }) => {
  const pid = await start(page);
  await page.evaluate(() => openDocs());
  await page.locator('#doc-empty-new').click();
  await page.locator('#doc-project').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Сайт' }).click();
  expect((await docs(page))[0].projectId).toBe(pid);
  await page.evaluate((id) => {
    state.tasks = state.tasks.filter((t) => t.projectId !== id);
    state.projects = state.projects.filter((p) => p.id !== id);
    for (const d of state.documents) if (d.projectId === id) d.projectId = null;
  }, pid);
  expect((await docs(page))[0].projectId).toBe(null);
});

test('документы уходят в синхронизацию и не теряются от набора без поля documents', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { state.documents.push(Core.newDocument({ id: 'd1', title: 'Мой' })); });
  expect(await page.evaluate(() => syncPayload().documents.map((d) => d.id))).toEqual(['d1']);
  // Набор со старой версии телефона: проектов и задач полно, документов нет.
  await page.evaluate(() => applyRemoteData({ projects: state.projects, tasks: state.tasks }));
  expect(await page.evaluate(() => state.documents.map((d) => d.id))).toEqual(['d1']);
});

test('удаление спрашивает подтверждение', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { state.documents.push(Core.newDocument({ id: 'd1', title: 'Лишний' })); openDocs('d1'); });
  await page.locator('#doc-more').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Удалить' }).click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await page.locator('#confirm-ok').click();
  expect(await docs(page)).toEqual([]);
});

// --- круг 5: документы внутри проекта --------------------------------------------

test('вкладка «Документы» проекта: свои документы, новый — сразу в проект', async ({ page }) => {
  const pid = await start(page);
  await page.evaluate((p) => {
    state.documents.push(Core.newDocument({ id: uid(), projectId: p }), Core.newDocument({ id: uid(), projectId: null }));
    state.documents[0].title = 'Бриф проекта';
    state.documents[1].title = 'Общая заметка';
    openProject(p);
  }, pid);
  const tab = page.locator('#proj-tabs button[data-ptab="docs"]');
  await expect(tab.locator('#ptab-doc-count')).toHaveText('1');
  await tab.click();
  await expect(page.locator('#proj-docs')).toBeVisible();
  await expect(page.locator('#pdoc-list .doc-item')).toHaveCount(1);
  await expect(page.locator('#pdoc-list .doc-item')).toContainText('Бриф проекта');
  // Новый документ из вкладки — в этом проекте.
  await page.locator('#pdoc-new').click();
  await expect(page.locator('#docs-view')).toBeVisible();
  const list = await docs(page);
  expect(list.filter((d) => d.projectId === pid)).toHaveLength(2);
  // Раздел открылся с фильтром по проекту: общего документа в списке нет.
  await expect(page.locator('#doc-list .doc-item')).toHaveCount(2);
  await expect(page.locator('#doc-list')).not.toContainText('Общая заметка');
});

test('левое меню: под открытым проектом — его документы, по ним открывается документ', async ({ page }) => {
  const pid = await start(page);
  const did = await page.evaluate((p) => {
    const d = Core.newDocument({ id: uid(), projectId: p });
    d.title = 'План запуска';
    state.documents.push(d);
    openView('home');
    return d.id;
  }, pid);
  await expect(page.locator('#navrail .nav-doc'), 'закрытый проект документов не раскрывает').toHaveCount(0);
  await page.evaluate((p) => openProject(p), pid);
  const item = page.locator('#navrail .nav-doc', { hasText: 'План запуска' });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator('#docs-view')).toBeVisible();
  expect(await page.evaluate(() => state.ui.docId)).toBe(did);
  await expect(page.locator('#navrail .nav-doc.active')).toHaveText('План запуска');
});

test('фильтр документов — выпадашка на всю ширину списка со стрелкой; меню той же ширины', async ({ page }) => {
  // Кнопка была маленькая и не похожая на выпадашку, а меню шире неё тянули
  // длинные названия проектов.
  const LONG = 'Очень длинное название проекта, которое никак не поместится в узкий список документов слева';
  await start(page);
  await page.evaluate((LONG) => {
    const now = new Date().toISOString();
    const long = uid();
    state.projects.push({ id: long, name: LONG, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
    seedProjectStatuses(long);
    const d = Core.newDocument({ id: uid(), projectId: long });
    d.title = 'Бриф';
    state.documents.push(d);
    state.ui.projectId = null;
    openDocs(d.id);
  }, LONG);
  const btn = page.locator('#doc-filter');
  const menu = page.locator('#ctx-menu');
  await expect(btn).toBeVisible();

  const box = (loc) => loc.evaluate((n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; });
  const settle = () => page.evaluate(() => new Promise((r) => setTimeout(r, 30)));

  // Кнопка на всю ширину блока списка, со стрелкой вниз справа.
  const side = await box(page.locator('#doc-search'));
  const b = await box(btn);
  expect(Math.abs(b.width - side.width), 'ширина кнопки = ширине блока списка').toBeLessThanOrEqual(1);
  expect(Math.abs(b.left - side.left)).toBeLessThanOrEqual(1);
  const chev = btn.locator('svg[data-icon="chevron-down"]');
  await expect(chev, 'стрелка вниз есть').toHaveCount(1);
  const c = await box(chev);
  expect(b.right - c.right, 'стрелка у правого края кнопки').toBeLessThanOrEqual(16);
  expect(b.right - c.right, 'и внутри неё').toBeGreaterThanOrEqual(4);
  expect(c.left, 'стрелка правее названия').toBeGreaterThan(b.left + 40);

  // Меню: той же ширины, того же левого края; длинное название — одной строкой
  // с многоточием, точка проекта и она не вылезают из меню.
  await btn.click();
  await expect(menu).toBeVisible();
  await settle();
  // Меню въезжает 120 мс (popIn, с масштабом): рамка до конца анимации неточна.
  await page.waitForTimeout(250);
  const m = await box(menu);
  expect(Math.abs(m.width - b.width), 'ширина меню = ширине кнопки').toBeLessThanOrEqual(1);
  expect(Math.abs(m.left - b.left), 'меню под кнопкой, с её левого края').toBeLessThanOrEqual(1);
  const item = menu.locator('.ctx-item', { hasText: 'Очень длинное' });
  const got = await item.evaluate((n) => {
    const label = n.querySelector('.ctx-label');
    const dot = n.querySelector('.ctx-dot');
    const menuBox = n.closest('#ctx-menu').getBoundingClientRect();
    const l = label.getBoundingClientRect();
    const d = dot.getBoundingClientRect();
    return {
      cut: label.scrollWidth > label.clientWidth, overflow: getComputedStyle(label).textOverflow,
      nowrap: getComputedStyle(label).whiteSpace, labelRight: l.right, menuRight: menuBox.right,
      dotLeft: d.left, dotRight: d.right, labelLeft: l.left, dotW: d.width,
      height: n.getBoundingClientRect().height,
    };
  });
  expect(got.cut, 'название обрезано').toBe(true);
  expect(got.overflow).toBe('ellipsis');
  expect(got.nowrap, 'в одну строку').toBe('nowrap');
  expect(got.labelRight, 'название не вылезает из меню').toBeLessThanOrEqual(got.menuRight);
  expect(got.dotW, 'точка проекта на месте').toBeGreaterThan(5);
  expect(got.dotRight, 'точка левее названия').toBeLessThanOrEqual(got.labelLeft);
  expect(got.height, 'пункт в одну строку').toBeLessThan(40);

  // Повторный щелчок по кнопке закрывает меню.
  await btn.click();
  await expect(menu).toBeHidden();

  // Выбор длинного проекта: название в кнопке — с многоточием, кнопка не выросла.
  await btn.click();
  await expect(menu).toBeVisible();
  await settle();
  await menu.locator('.ctx-item', { hasText: 'Очень длинное' }).click();
  const name = btn.locator('.dp-select-name');
  await expect(name).toHaveText(LONG);
  const after = await name.evaluate((n) => ({ cut: n.scrollWidth > n.clientWidth, overflow: getComputedStyle(n).textOverflow }));
  expect(after.cut, 'название в кнопке обрезано').toBe(true);
  expect(after.overflow).toBe('ellipsis');
  const b2 = await box(btn);
  expect(Math.abs(b2.width - b.width), 'кнопка не растянулась').toBeLessThanOrEqual(1);
  expect(Math.abs(b2.height - b.height), 'и не выросла вверх').toBeLessThanOrEqual(1);
  await expect(page.locator('#doc-list .doc-item')).toHaveCount(1);
});

test('поиск по документам: лупа внутри поля слева, текст отступает под неё', async ({ page }) => {
  // Лупа — та же иконка, что в поиске шапки (core/icons.js, search).
  await start(page);
  await page.locator('#navrail .nav-item[data-view="docs"]').click();
  const field = page.locator('#doc-search');
  await expect(field).toBeVisible();
  const icon = page.locator('.docs-search-box svg[data-icon="search"]');
  await expect(icon, 'лупа есть, одна').toHaveCount(1);

  const m = await page.evaluate(() => {
    const f = document.getElementById('doc-search').getBoundingClientRect();
    const i = document.querySelector('.docs-search-box svg[data-icon="search"]').getBoundingClientRect();
    return {
      iconLeft: i.left - f.left, iconRight: i.right - f.left, iconW: i.width,
      iconMid: (i.top + i.bottom) / 2 - (f.top + f.bottom) / 2,
      padLeft: parseFloat(getComputedStyle(document.getElementById('doc-search')).paddingLeft),
      pointer: getComputedStyle(document.querySelector('.docs-search-box svg')).pointerEvents,
      same: document.querySelector('.docs-search-box svg').innerHTML === document.querySelector('.tb-search svg').innerHTML,
    };
  });
  expect(m.iconLeft, 'лупа внутри поля, слева').toBeGreaterThanOrEqual(4);
  expect(m.iconRight, 'лупа не выходит за поле').toBeLessThan(40);
  expect(Math.abs(m.iconMid), 'лупа по центру поля по высоте').toBeLessThanOrEqual(1);
  expect(m.padLeft, 'текст начинается правее лупы').toBeGreaterThanOrEqual(m.iconRight + 4);
  expect(m.pointer, 'лупа не перехватывает щелчки').toBe('none');
  expect(m.same, 'рисунок тот же, что у поиска в шапке').toBe(true);

  // Щелчок по месту лупы попадает в поле, а печатать можно как раньше.
  const box = await field.boundingBox();
  await page.mouse.click(box.x + 12, box.y + box.height / 2);
  await expect(field).toBeFocused();
});

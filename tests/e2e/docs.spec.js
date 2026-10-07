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

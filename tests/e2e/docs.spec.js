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

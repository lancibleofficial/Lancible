// Редактор заметок и инструменты таблиц. Запуск: npm run test:e2e
//
// Откуда взялось. До сих пор на редактор не было ни одного теста: ни на
// панель инструментов, ни на таблицы, ни на то, что набранное доезжает до
// задачи. Тест написан перед тем, как setupEditor был разрезан на шаги, и
// прогнан на старом коде — так он закрепляет поведение, которое правка
// обязана сохранить, а не то, что получилось после неё.
const { test, expect } = require('@playwright/test');

async function openTask(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  return page.evaluate(() => {
    const now = new Date().toISOString();
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Сайт', color: '#87ff65', description: '',
      pinnedAt: null, createdAt: now, tagIds: [],
    });
    seedProjectStatuses(pid);
    const id = uid();
    state.tasks.push({
      id, projectId: pid, title: 'Заметки', done: false, notes: null,
      totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
      statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    openProject(pid);
    selectTask(id);
    return id;
  });
}

/** Таблица в редакторе: строки и ячейки первой строки. */
const tableShape = (page) => page.evaluate(() => {
  const table = document.querySelector('#editor table');
  if (!table) return null;
  const rows = table.querySelectorAll('tr');
  return { rows: rows.length, cols: rows[0] ? rows[0].querySelectorAll('td').length : 0 };
});

test('панель инструментов собрана целиком, включая вставку таблицы', async ({ page }) => {
  await openTask(page);
  for (const sel of ['.ql-header', '.ql-bold', '.ql-italic', '.ql-underline', '.ql-strike',
    '.ql-color', '.ql-background', '.ql-list', '.ql-indent', '.ql-blockquote',
    '.ql-code-block', '.ql-link', '.ql-clean', '.ql-table-insert']) {
    await expect(page.locator(`.ql-toolbar ${sel}`).first(), `нет кнопки ${sel}`).toBeAttached();
  }
  const insert = page.locator('.ql-toolbar .ql-table-insert');
  await expect(insert).toHaveText('▦');
  expect(await insert.getAttribute('title')).toBeTruthy();
});

test('без выбранной задачи редактор закрыт, с задачей — открыт', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  expect(await page.evaluate(() => quill.isEnabled())).toBe(false);
  await openTask(page);
  expect(await page.evaluate(() => quill.isEnabled())).toBe(true);
});

test('набранный текст доезжает до задачи', async ({ page }) => {
  const id = await openTask(page);
  await page.locator('#editor .ql-editor').click();
  await page.keyboard.type('План на день');
  const text = await page.evaluate((taskId) => {
    const task = state.tasks.find((t) => t.id === taskId);
    return task.notes && task.notes.ops ? task.notes.ops.map((o) => o.insert).join('') : '';
  }, id);
  expect(text).toContain('План на день');
});

test('вставка таблицы: три на три, и она сохраняется в задаче', async ({ page }) => {
  const id = await openTask(page);
  await page.locator('#editor .ql-editor').click();
  await page.locator('.ql-toolbar .ql-table-insert').click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 3 });
  await expect(page.locator('#table-tools'), 'курсор в таблице — инструменты видны').toBeVisible();
  const saved = await page.evaluate((taskId) => {
    const task = state.tasks.find((t) => t.id === taskId);
    return !!(task.notes && task.notes.ops && task.notes.ops.some((o) => o.attributes && o.attributes.table));
  }, id);
  expect(saved, 'таблица записана в заметки задачи').toBe(true);
});

test('инструменты таблицы: строки и столбцы добавляются и удаляются', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor .ql-editor').click();
  await page.locator('.ql-toolbar .ql-table-insert').click();

  await page.locator('#table-tools [data-tt="rowBelow"]').click();
  expect(await tableShape(page)).toEqual({ rows: 4, cols: 3 });
  await page.locator('#table-tools [data-tt="colRight"]').click();
  expect(await tableShape(page)).toEqual({ rows: 4, cols: 4 });
  await page.locator('#table-tools [data-tt="rowDel"]').click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 4 });
  await page.locator('#table-tools [data-tt="colDel"]').click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 3 });
  await page.locator('#table-tools [data-tt="tableDel"]').click();
  expect(await tableShape(page), 'таблица удалена целиком').toBe(null);
});

test('выбор, что заливать: ячейку, строку или столбец', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor .ql-editor').click();
  await page.locator('.ql-toolbar .ql-table-insert').click();
  const on = () => page.evaluate(() => [...document.querySelectorAll('#table-tools [data-scope].on')].map((b) => b.dataset.scope));
  expect(await on()).toEqual(['cell']);
  await page.locator('#table-tools [data-scope="row"]').click();
  expect(await on()).toEqual(['row']);
  await page.locator('#table-tools [data-scope="col"]').click();
  expect(await on()).toEqual(['col']);
});

test('образцы заливки собраны по палитре', async ({ page }) => {
  await openTask(page);
  const count = await page.evaluate(() => document.querySelectorAll('#tt-swatches button').length);
  expect(count).toBe(await page.evaluate(() => FILL_COLORS.length));
  expect(count).toBeGreaterThan(1);
});

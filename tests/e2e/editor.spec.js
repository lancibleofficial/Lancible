// Редактор заметок и документов (src/editor/, ProseMirror). Запуск: npm run test:e2e
//
// Откуда взялось. До 7 октября 2026 здесь проверялся Quill: панель, таблицы,
// заливка. Редактор заменён своим, и тест переписан под его поведение —
// то, что обязано работать у того, кто пишет: набранное доезжает до задачи,
// старые заметки Quill читаются, markdown-сокращения, таблицы, графики,
// комментарии, поиск, рисунок пером и пометки поверх текста.
const { test, expect } = require('@playwright/test');

async function openTask(page, notes) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  return page.evaluate((n) => {
    const now = new Date().toISOString();
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Сайт', color: '#87ff65', description: '',
      pinnedAt: null, createdAt: now, tagIds: [],
    });
    seedProjectStatuses(pid);
    const id = uid();
    state.tasks.push({
      id, projectId: pid, title: 'Заметки', done: false, notes: n,
      totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
      statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    openProject(pid);
    selectTask(id);
    return id;
  }, notes || null);
}

const pm = (page) => page.locator('#editor-wrap .led-pm');

/** Заметки задачи — как их видит хранилище: контейнер и Delta для старых версий. */
const savedNotes = (page, id) => page.evaluate(async (taskId) => {
  editor.flush();
  return state.tasks.find((t) => t.id === taskId).notes;
}, id);

test('панель инструментов собрана: оформление, списки, вставка, рисование', async ({ page }) => {
  await openTask(page);
  const bar = page.locator('#editor-wrap .led-toolbar');
  for (const title of ['Полужирный', 'Курсив', 'Маркированный список', 'Чек-лист', 'Таблица', 'Картинка', 'График', 'Рисунок', 'Комментарий', 'Пометки от руки поверх текста']) {
    await expect(bar.locator(`button[title^="${title}"]`).first(), `нет кнопки «${title}»`).toBeVisible();
  }
});

test('без выбранной задачи редактор закрыт, с задачей — открыт', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  expect(await page.evaluate(() => editor.view.editable)).toBe(false);
  await openTask(page);
  expect(await page.evaluate(() => editor.view.editable)).toBe(true);
});

test('набранный текст доезжает до задачи — и новым форматом, и Delta для старых версий', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('План на день');
  const notes = await savedNotes(page, id);
  expect(notes.lancible.doc.content[0].content[0].text).toBe('План на день');
  expect(notes.ops.map((o) => o.insert).join('')).toContain('План на день');
});

test('старые заметки Quill открываются как документ', async ({ page }) => {
  await openTask(page, { ops: [
    { insert: 'Шаги' }, { insert: '\n', attributes: { header: 2 } },
    { insert: 'купить домен' }, { insert: '\n', attributes: { list: 'checked' } },
    { insert: 'жирно', attributes: { bold: true } }, { insert: '\n' },
  ] });
  await expect(pm(page).locator('h2')).toHaveText('Шаги');
  await expect(pm(page).locator('li.led-task[data-checked="true"]')).toContainText('купить домен');
  await expect(pm(page).locator('strong')).toHaveText('жирно');
});

test('markdown-сокращения: заголовок, список, чек-лист, полужирный, типографика', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  const k = page.keyboard;
  await k.type('# Заголовок'); await k.press('Enter');
  await k.type('- пункт'); await k.press('Enter'); await k.press('Enter');
  await k.type('[] дело'); await k.press('Enter'); await k.press('Enter');
  await k.type('это **важно** -- "да"');
  await expect(pm(page).locator('h1')).toHaveText('Заголовок');
  await expect(pm(page).locator('ul:not(.led-tasks) li')).toHaveText('пункт');
  await expect(pm(page).locator('li.led-task')).toHaveText('дело');
  await expect(pm(page).locator('strong')).toHaveText('важно');
  await expect(pm(page).locator('p').last()).toHaveText('это важно — «да»');
});

test('меню «/»: таблица вставляется с клавиатуры, панель таблицы видна', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('/табл');
  await expect(page.locator('.led-slash')).toBeVisible();
  await page.keyboard.press('Enter');
  const shape = () => page.evaluate(() => {
    const rows = document.querySelectorAll('#editor-wrap .led-pm table tr');
    return { rows: rows.length, cols: rows[0] ? rows[0].children.length : 0 };
  });
  expect(await shape()).toEqual({ rows: 3, cols: 3 });
  await expect(page.locator('#editor-wrap .led-tablebar')).toBeVisible();
  await page.locator('#editor-wrap .led-tablebar [data-tt="rowBelow"]').click();
  expect(await shape()).toEqual({ rows: 4, cols: 3 });
  await page.locator('#editor-wrap .led-tablebar [data-tt="colRight"]').click();
  expect(await shape()).toEqual({ rows: 4, cols: 4 });
  await page.locator('#editor-wrap .led-tablebar [data-tt="tableDel"]').click();
  expect(await shape()).toEqual({ rows: 0, cols: 0 });
  const notes = await savedNotes(page, id);
  expect(notes.lancible.doc.content.some((n) => n.type === 'table')).toBe(false);
});

test('график из таблицы: числа переезжают в график, график — в документ', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.evaluate(() => editor.exec('table', { rows: 3, cols: 2, header: true }));
  const k = page.keyboard;
  for (const cell of ['Месяц', 'Часы', 'Янв', '10', 'Фев', '14,5']) { await k.type(cell); await k.press('Tab'); }
  await page.locator('#editor-wrap .led-tablebar button', { hasText: 'График из таблицы' }).click();
  await expect(page.locator('#ledmodal-backdrop')).toBeVisible();
  await page.locator('#ledmodal-backdrop .modal-buttons .primary').click();
  await expect(pm(page).locator('.led-chart svg rect.led-series-0')).toHaveCount(2);
  const notes = await savedNotes(page, id);
  const chart = notes.lancible.doc.content.find((n) => n.type === 'chart');
  expect(chart.attrs.chart.labels).toEqual(['Янв', 'Фев']);
  expect(chart.attrs.chart.series[0].values).toEqual([10, 14.5]);
});

test('комментарий: к выделенному тексту, с автором, решается и сохраняется', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Проверить цену');
  await page.keyboard.press('Shift+Home');
  await expect(page.locator('.led-bubble')).toBeVisible();
  await page.locator('.led-bubble button[title^="Комментарий"]').click();
  await page.keyboard.type('Уточнить у клиента');
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor-wrap .led-cm-card .led-cm-text')).toHaveText('Уточнить у клиента');
  await expect(pm(page).locator('.led-comment')).toHaveCount(1);
  let notes = await savedNotes(page, id);
  expect(notes.lancible.comments).toHaveLength(1);
  expect(notes.lancible.comments[0].text).toBe('Уточнить у клиента');
  await page.locator('#editor-wrap .led-cm-card button[title="Решено"]').click();
  notes = await savedNotes(page, id);
  expect(notes.lancible.comments[0].resolved).toBe(true);
});

test('поиск и замена', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('кот и кот и котёнок');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('кот');
  await expect(page.locator('#editor-wrap .led-find-count')).toHaveText('1 / 3');
  await page.locator('#editor-wrap .led-find button[title="Слово целиком"]').click();
  await expect(page.locator('#editor-wrap .led-find-count')).toHaveText('1 / 2');
  await page.locator('#editor-wrap .led-find button[title="Замена"]').click();
  await page.locator('#editor-wrap .led-find-in').nth(1).fill('пёс');
  await page.locator('#editor-wrap .led-find button', { hasText: 'Заменить все' }).click();
  const notes = await savedNotes(page, id);
  expect(notes.lancible.doc.content[0].content[0].text).toBe('пёс и пёс и котёнок');
});

test('рисунок: штрих мышью ложится в документ, ластик его стирает', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.locator('#editor-wrap .led-toolbar button[title="Рисунок"]').click();
  const area = page.locator('#editor-wrap .led-draw-area');
  await expect(area).toBeVisible();
  const box = await area.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 30 + i * 10, box.y + 40 + (i % 4) * 5);
  await page.mouse.up();
  const strokes = async () => {
    const notes = await savedNotes(page, id);
    await page.waitForTimeout(350);
    return page.evaluate(() => editor.getContent().doc.content.find((n) => n.type === 'drawing').attrs.strokes.length);
  };
  expect(await strokes()).toBe(1);
  await page.keyboard.press('e'); // ластик
  await page.mouse.move(box.x + 80, box.y + 40);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 60 + i * 8, box.y + 38 + (i % 3) * 6);
  await page.mouse.up();
  expect(await strokes()).toBe(0);
});

test('пометки поверх текста держатся за свой абзац', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Первый абзац');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Второй абзац');
  await page.locator('#editor-wrap .led-toolbar button[title="Пометки от руки поверх текста"]').click();
  const second = await pm(page).locator('p').nth(1).boundingBox();
  await page.mouse.move(second.x + 10, second.y + second.height - 2);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(second.x + 10 + i * 8, second.y + second.height - 2);
  await page.mouse.up();
  await page.locator('#editor-wrap .led-overlay-done').click();
  const notes = await savedNotes(page, id);
  const bids = notes.lancible.doc.content.map((n) => n.attrs && n.attrs.bid);
  expect(notes.lancible.ink).toHaveLength(1);
  expect(notes.lancible.ink[0].anchor, 'штрих привязан ко второму абзацу').toBe(bids[1]);
});

test('вид редактора — настройка устройства, не данные задачи', async ({ page }) => {
  const id = await openTask(page);
  await page.locator('#editor-wrap .led-toolbar button[title="Вид"]').click();
  await page.locator('.led-pop .ctx-item', { hasText: 'С засечками' }).click();
  expect(await page.evaluate(() => state.settings.editor.font)).toBe('serif');
  await expect(page.locator('#editor-wrap .led')).toHaveClass(/led-f-serif/);
  const notes = await savedNotes(page, id);
  expect(JSON.stringify(notes || {})).not.toContain('serif');
});

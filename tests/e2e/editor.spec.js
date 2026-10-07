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

/** Таблица в редакторе: строки и ячейки первой строки. */
const tableShape = (page) => page.evaluate(() => {
  const rows = document.querySelectorAll('#editor-wrap .led-pm table tr');
  return { rows: rows.length, cols: rows[0] ? rows[0].children.length : 0 };
});

/** Картинка 40×30 — вставляется через настоящий выбор файла. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsMlGGMKQgAw4mvRvqudExGKxWCwWi8VisVj8N14iEuPIyklx+wAAAABJRU5ErkJggg==', 'base64');
async function pickImage(page, click) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click()]);
  await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
}

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

test('меню «/»: таблица вставляется с клавиатуры, остров таблицы — под ней', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('/табл');
  await expect(page.locator('.led-slash')).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 3 });
  // Остров, а не полоса во всю ширину: скруглён, уже редактора, стоит под таблицей.
  const bar = page.locator('#editor-wrap .led-tablebar');
  await expect(bar).toBeVisible();
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const b = document.querySelector('#editor-wrap .led-tablebar');
    return { bar: r('#editor-wrap .led-tablebar'), table: r('#editor-wrap .led-pm table'), ed: r('#editor-wrap .led'), radius: parseFloat(getComputedStyle(b).borderTopLeftRadius) };
  });
  expect(m.radius).toBeGreaterThan(6);
  expect(m.bar.width).toBeLessThan(m.ed.width - 40);
  expect(m.bar.top).toBeGreaterThanOrEqual(m.table.bottom);
  // Строк и столбцов в острове на десктопе нет — они на разделителях.
  await expect(bar.locator('[data-tt="rowBelow"], [data-tt="colRight"]')).toHaveCount(0);
  await bar.locator('[data-tt="tableDel"]').click();
  expect(await tableShape(page)).toEqual({ rows: 0, cols: 0 });
  const notes = await savedNotes(page, id);
  expect(notes.lancible.doc.content.some((n) => n.type === 'table')).toBe(false);
});

/** Навести на линию таблицы и открыть меню шестерёнки. kind — 'col' или 'row'. */
async function lineMenu(page, kind, row, col) {
  const cell = page.locator('#editor-wrap .led-pm table tr').nth(row).locator('td, th').nth(col);
  const box = await cell.boundingBox();
  if (kind === 'col') await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  else await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
  const line = page.locator('#editor-wrap .led-tline');
  await expect(line).toBeVisible();
  // Линия горит акцентом — тем же цветом, что ручка ширины столбца.
  const accent = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--accent)';
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  await expect(line).toHaveCSS('background-color', accent);
  const gear = page.locator('#editor-wrap .led-tgear');
  await expect(gear).toBeVisible();
  await gear.click();
  return page.locator('.led-pop .ctx-item');
}

test('разделители таблицы: шестерёнка вставляет и удаляет столбцы и строки', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.evaluate(() => editor.exec('table', { rows: 3, cols: 3, header: true }));
  // Вертикальная линия между 1-м и 2-м столбцом: шестерёнка над таблицей.
  let items = await lineMenu(page, 'col', 1, 0);
  const gearBox = await page.locator('#editor-wrap .led-tgear').boundingBox();
  const tableBox = await page.locator('#editor-wrap .led-pm table').boundingBox();
  expect(gearBox.y + gearBox.height, 'шестерёнка столбца — над таблицей').toBeLessThanOrEqual(tableBox.y + 1);
  await items.filter({ hasText: 'Вставить столбец здесь' }).click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 4 });
  items = await lineMenu(page, 'col', 1, 0);
  await items.filter({ hasText: 'Удалить столбец справа' }).click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 3 });
  // Горизонтальная линия под первой строкой данных: шестерёнка слева.
  items = await lineMenu(page, 'row', 1, 1);
  const g2 = await page.locator('#editor-wrap .led-tgear').boundingBox();
  expect(g2.x + g2.width, 'шестерёнка строки — слева от таблицы').toBeLessThanOrEqual(tableBox.x + 1);
  await items.filter({ hasText: 'Вставить строку здесь' }).click();
  expect(await tableShape(page)).toEqual({ rows: 4, cols: 3 });
  items = await lineMenu(page, 'row', 1, 1);
  await items.filter({ hasText: 'Удалить строку выше' }).click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 3 });
});

test('график из таблицы: числа переезжают в график, график — в документ', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.evaluate(() => editor.exec('table', { rows: 3, cols: 2, header: true }));
  const k = page.keyboard;
  const cells = ['Месяц', 'Часы', 'Янв', '10', 'Фев', '14,5'];
  // Tab — между ячейками: в последней он добавил бы новую строку.
  for (const [i, cell] of cells.entries()) { await k.type(cell); if (i < cells.length - 1) await k.press('Tab'); }
  await page.locator('#editor-wrap .led-tablebar [data-tt="toChart"]').click();
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

test('картинки в ряд: вторая встаёт рядом, ряд разбирается обратно', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await pickImage(page, () => page.locator('#editor-wrap .led-toolbar button[title="Картинка"]').click());
  const fig = pm(page).locator('.led-figure').first();
  await expect(fig.locator('img')).toHaveAttribute('src', /^blob:/);
  await fig.click();
  await pickImage(page, () => fig.locator('button[title="Добавить картинку рядом"]').click());
  const row = pm(page).locator('.led-gallery');
  await expect(row.locator('.led-figure')).toHaveCount(2);
  const [a, b] = await row.locator('.led-figure').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  expect(Math.abs(a.top - b.top), 'одна строка').toBeLessThan(2);
  expect(b.left, 'вторая правее первой').toBeGreaterThan(a.right - 1);
  let notes = await savedNotes(page, id);
  expect(notes.lancible.doc.content.find((n) => n.type === 'gallery').content).toHaveLength(2);
  // Вынести вторую из ряда — ряд из одной разбирается в обычную картинку.
  await row.locator('.led-figure').nth(1).click();
  await row.locator('.led-figure').nth(1).locator('button[title="Вынести из ряда"]').click();
  await expect(pm(page).locator('.led-gallery')).toHaveCount(0);
  await expect(pm(page).locator('.led-figure')).toHaveCount(2);
  notes = await savedNotes(page, id);
  expect(notes.lancible.doc.content.filter((n) => n.type === 'image')).toHaveLength(2);
});

test('обтекание: текст идёт рядом с картинкой', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await pickImage(page, () => page.locator('#editor-wrap .led-toolbar button[title="Картинка"]').click());
  const fig = pm(page).locator('.led-figure').first();
  // Картинка вставляется, когда файл прочитан, — печатаем после неё.
  await expect(fig.locator('img')).toHaveAttribute('src', /^blob:/);
  await page.keyboard.type('Текст рядом с картинкой, который должен идти справа от неё, пока хватает её высоты.');
  await fig.click();
  await fig.locator('button[title="Обтекание: картинка слева"]').click();
  const m = await page.evaluate(() => {
    const f = document.querySelector('#editor-wrap .led-figure').getBoundingClientRect();
    const range = document.createRange();
    const p = [...document.querySelectorAll('#editor-wrap .led-pm p')].find((x) => x.textContent.startsWith('Текст рядом'));
    range.selectNodeContents(p);
    const line = range.getClientRects()[0];
    return { fig: f.toJSON(), line: line.toJSON() };
  });
  expect(m.line.left, 'первая строка текста — справа от картинки').toBeGreaterThanOrEqual(m.fig.right);
  expect(m.line.top, 'и на её высоте').toBeLessThan(m.fig.bottom);
  const notes = await savedNotes(page, id);
  const img = notes.lancible.doc.content.find((n) => n.type === 'image');
  expect(img.attrs.align).toBe('wrap-left');
  expect(img.attrs.width).toBe(40);
});

test('по умолчанию текст — во всю ширину окна редактора', async ({ page }) => {
  await openTask(page);
  const m = await page.evaluate(() => ({
    pm: document.querySelector('#editor-wrap .led-pm').getBoundingClientRect().width,
    scroll: document.querySelector('#editor-wrap .led-scroll').clientWidth,
  }));
  // Поля по краям остаются (ручка блока слева), но полоса не ограничена 760 px.
  expect(m.scroll - m.pm).toBeLessThanOrEqual(120);
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

test('Tab в последней ячейке добавляет строку, а не уводит фокус из таблицы', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.evaluate(() => editor.exec('table', { rows: 2, cols: 2, header: true }));
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 2 });
  await page.keyboard.type('новая');
  await expect(pm(page).locator('table tr').nth(2).locator('td').first()).toHaveText('новая');
});

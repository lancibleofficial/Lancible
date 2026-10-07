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
/** Где указатель стоял на линии в последний раз — шестерёнка должна быть рядом. */
let lastPointer = null;
async function lineMenu(page, kind, row, col) {
  const cell = page.locator('#editor-wrap .led-pm table tr').nth(row).locator('td, th').nth(col);
  const box = await cell.boundingBox();
  lastPointer = kind === 'col' ? { x: box.x + box.width - 2, y: box.y + box.height / 2 } : { x: box.x + box.width / 2, y: box.y + box.height - 2 };
  await page.mouse.move(lastPointer.x, lastPointer.y);
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
  // Шестерёнка — рядом с указателем (круг 4): до неё не надо тянуться к
  // краю таблицы. Не на самой линии — там тянут ширину столбца.
  const near = async (what) => {
    const g = await page.locator('#editor-wrap .led-tgear').boundingBox();
    const cx = g.x + g.width / 2; const cy = g.y + g.height / 2;
    expect(Math.hypot(cx - lastPointer.x, cy - lastPointer.y), `${what}: шестерёнка рядом с указателем`).toBeLessThan(30);
    return g;
  };
  // Вертикальная линия между 1-м и 2-м столбцом.
  let items = await lineMenu(page, 'col', 1, 0);
  const g1 = await near('столбец');
  expect(g1.x, 'шестерёнка правее линии, а не на ней').toBeGreaterThan(lastPointer.x + 2);
  await items.filter({ hasText: 'Вставить столбец здесь' }).click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 4 });
  items = await lineMenu(page, 'col', 1, 0);
  await items.filter({ hasText: 'Удалить столбец справа' }).click();
  expect(await tableShape(page)).toEqual({ rows: 3, cols: 3 });
  // Горизонтальная линия под первой строкой данных.
  items = await lineMenu(page, 'row', 1, 1);
  const g2 = await near('строка');
  expect(g2.y, 'шестерёнка ниже линии, а не на ней').toBeGreaterThan(lastPointer.y + 2);
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
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
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

/** Провести штрих мышью по слою пометок над абзацем. */
async function scribble(page, box, dy) {
  await page.mouse.move(box.x + 12, box.y + (dy || 8));
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(box.x + 12 + i * 9, box.y + (dy || 8) + (i % 3) * 4);
  await page.mouse.up();
}

test('пометки на десктопе: скрыть, стереть все с вопросом, вернуть отменой', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Абзац с пометкой');
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
  const bar = page.locator('#editor-wrap .led-overlay-bar');
  await scribble(page, await pm(page).locator('p').first().boundingBox());
  expect(await page.evaluate(() => editor.ink.length)).toBe(1);

  await bar.locator('button[title="Стереть все пометки"]').click();
  await page.locator('#ledmodal-backdrop button', { hasText: 'Стереть' }).click();
  expect(await page.evaluate(() => editor.ink.length)).toBe(0);
  await bar.locator('button[title^="Отменить"]').click();
  expect(await page.evaluate(() => editor.ink.length), 'стёртое возвращается отменой').toBe(1);

  await bar.locator('button[title="Скрыть пометки"]').click();
  expect(await page.evaluate(() => editor.annotating), 'скрыть — значит и выйти из пометок').toBe(false);
  expect(await page.evaluate(() => state.settings.editor.inkHidden)).toBe(true);
  const notes = await savedNotes(page, id);
  expect(notes.lancible.ink, 'скрытые пометки остаются в заметке').toHaveLength(1);
  await page.locator('#editor-wrap .led-toolbar button[title="Вид"]').click();
  await page.locator('.led-pop .ctx-item', { hasText: 'Показывать пометки от руки' }).click();
  expect(await page.evaluate(() => state.settings.editor.inkHidden)).toBe(false);
});

test('прозрачность пера: ползунок рядом с толщиной, штрих её запоминает', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Абзац');
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
  await page.locator('#editor-wrap .led-overlay-bar .led-ink-size').click();
  const range = page.locator('.led-pop .led-setting', { hasText: 'Непрозрачность' }).locator('input[type=range]');
  await range.fill('0.5');
  await page.keyboard.press('Escape');
  await scribble(page, await pm(page).locator('p').first().boundingBox());
  const st = await page.evaluate(() => editor.ink[0]);
  expect(st.opacity).toBe(0.5);
});

test.describe('телефон', () => {
  // 360 — самый узкий из ходовых Android.
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

  test('панель пера — сверху, на месте панели редактора, вся в экране', async ({ page }) => {
    await openTask(page);
    expect(await page.evaluate(() => editor.isMobile)).toBe(true);
    await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
    const bar = page.locator('#editor-wrap .led-overlay-bar');
    await expect(bar).toBeVisible();
    await expect(page.locator('#editor-wrap .led-toolbar'), 'панель редактора уступает место').toBeHidden();
    const geo = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const b = document.querySelector('#editor-wrap .led-overlay-bar');
      const tabbar = document.getElementById('mobile-tabbar');
      const btns = [...b.querySelectorAll('button')].map((x) => ({ t: x.title || x.textContent, ...JSON.parse(JSON.stringify(r(x))) }));
      return { bar: JSON.parse(JSON.stringify(r(b))), scroller: r(document.querySelector('#editor-wrap .led-scroll')).top, tab: tabbar && tabbar.offsetParent ? r(tabbar).top : Infinity, btns, vw: innerWidth };
    });
    expect(geo.bar.bottom, 'панель над текстом, а не под ним').toBeLessThanOrEqual(geo.scroller + 1);
    expect(geo.bar.bottom, 'и не под нижним меню').toBeLessThan(geo.tab);
    for (const b of geo.btns) {
      expect(b.left, `кнопка «${b.t}» не уехала влево`).toBeGreaterThanOrEqual(geo.bar.left - 1);
      expect(b.right, `кнопка «${b.t}» не уехала за край`).toBeLessThanOrEqual(Math.min(geo.bar.right, geo.vw) + 1);
    }
    for (const title of ['Ручка', 'Ластик', 'Лассо: выделить и передвинуть', 'Цвет', 'Готово']) {
      await expect(bar.locator(`button[title="${title}"]`), `нет «${title}»`).toBeVisible();
    }
    await expect(bar.locator('.led-ink-size')).toBeVisible();
    await bar.locator('button[title="Готово"]').click();
    await expect(page.locator('#editor-wrap .led-toolbar')).toBeVisible();
  });

  test('палец рисует или листает — переключатель в панели', async ({ page }) => {
    await openTask(page);
    await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
    const finger = page.locator('#editor-wrap .led-overlay-bar .led-ink-finger');
    await expect(finger).toHaveAttribute('aria-pressed', 'true');
    await finger.click();
    expect(await page.evaluate(() => state.settings.editor.ink.stylus)).toBe('only');
    await expect(finger).toHaveAttribute('aria-pressed', 'false');
    await finger.click();
    expect(await page.evaluate(() => state.settings.editor.ink.stylus)).toBe('any');
  });

  test('«ещё»: стереть все, скрыть, настройки — и цвет меняется', async ({ page }) => {
    await openTask(page);
    await pm(page).click();
    await page.keyboard.type('Абзац');
    await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
    const bar = page.locator('#editor-wrap .led-overlay-bar');
    await bar.locator('button[title="Цвет"]').click();
    await page.locator('.led-pop .ink-red').click();
    await scribble(page, await pm(page).locator('p').first().boundingBox());
    expect(await page.evaluate(() => editor.ink[0].color)).toBe('red');

    await bar.locator('button[title="Ещё"]').click();
    for (const item of ['Скрыть пометки', 'Стереть все пометки', 'Настройки рисования']) {
      await expect(page.locator('.ctx-menu .ctx-item', { hasText: item })).toBeVisible();
    }
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Стереть все пометки' }).click();
    await page.locator('#ledmodal-backdrop button', { hasText: 'Стереть' }).click();
    expect(await page.evaluate(() => editor.ink.length)).toBe(0);
  });
});

test.describe('телефон: рисунок', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

  test('панель рисунка в два ряда, все кнопки в экране, фон и размер — в «ещё»', async ({ page }) => {
    await openTask(page);
    await pm(page).click();
    await page.evaluate(() => editor.exec('drawing'));
    const area = page.locator('#editor-wrap .led-draw-area');
    await area.click();
    const bar = page.locator('#editor-wrap .led-draw-bar');
    await expect(bar).toBeVisible();
    const rows = await bar.locator('.led-ink-row').evaluateAll((els) => els.map((x) => [x.clientWidth, x.scrollWidth]));
    expect(rows).toHaveLength(2);
    for (const [client, scroll] of rows) expect(scroll, 'ряд не прокручивается вбок — всё видно').toBeLessThanOrEqual(client);
    await bar.locator('button[title="Ещё"]').click();
    for (const item of ['Чистый', 'Во весь экран', 'Настройки рисования', 'Очистить холст']) {
      await expect(page.locator('.ctx-menu .ctx-item', { hasText: item }), `нет «${item}»`).toBeVisible();
    }
  });
});

test.describe('телефон: всплывашки пера', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

  test('толщина и прозрачность помещаются в экран целиком', async ({ page }) => {
    await openTask(page);
    await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
    await page.locator('#editor-wrap .led-overlay-bar .led-ink-size').click();
    const geo = await page.locator('.led-pop').evaluate((p) => {
      p.getAnimations().forEach((a) => a.finish()); // появление с масштабом искажает размеры
      const r = p.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: innerWidth, overflow: [...p.querySelectorAll('*')].filter((k) => k.scrollWidth > k.clientWidth + 1 && getComputedStyle(k).overflowX === 'visible').map((k) => k.className) };
    });
    expect(geo.left).toBeGreaterThanOrEqual(0);
    expect(geo.right).toBeLessThanOrEqual(geo.vw);
    expect(geo.overflow, 'ничего не вылезает из своей строки').toEqual([]);
  });
});

// --- круг 4 (7 октября 2026) ---------------------------------------------------

test('палитра пера: квадраты своих цветов, а не все чёрные', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
  await page.locator('#editor-wrap .led-overlay-bar button[title="Цвет"]').click();
  const colors = await page.locator('.led-pop .led-ink-colors .led-swatch').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(colors.length).toBe(10);
  expect(new Set(colors).size, 'десять цветов — десять разных квадратов').toBe(10);
});

test('панель пера на десктопе: ни «null», ни других пустых значений', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
  const text = await page.locator('#editor-wrap .led-overlay-bar').innerText();
  expect(text).not.toMatch(/null|undefined/);
});

test('пометки отменяются общей отменой: Ctrl+Z в тексте и кнопкой, ластик — одним шагом', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Абзац');
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
  const p = await pm(page).locator('p').first().boundingBox();
  await scribble(page, p, 4);
  await scribble(page, p, 14);
  expect(await page.evaluate(() => editor.ink.length)).toBe(2);
  // Ластик проходит по обоим штрихам за одно движение — это один шаг отмены.
  await page.evaluate(() => editor.setInkSettings({ tool: 'eraser' }));
  await page.mouse.move(p.x + 40, p.y - 4);
  await page.mouse.down();
  for (let i = 0; i <= 12; i++) await page.mouse.move(p.x + 40 + (i % 2) * 6, p.y - 4 + i * 3);
  await page.mouse.up();
  expect(await page.evaluate(() => editor.ink.length)).toBe(0);
  await page.locator('#editor-wrap .led-overlay-bar button[title^="Отменить"]').click();
  expect(await page.evaluate(() => editor.ink.length), 'одна отмена вернула оба штриха').toBe(2);
  await page.evaluate(() => editor.setInkSettings({ tool: 'pen' }));
  // Из режима пометок — в текст, там Ctrl+Z снимает последний штрих.
  await page.keyboard.press('Control+Shift+D');
  expect(await page.evaluate(() => editor.annotating)).toBe(false);
  await pm(page).click();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => editor.ink.length)).toBe(1);
  // А штрихи в заметке по-прежнему отдельным полем, документ — без них.
  const content = await page.evaluate(() => editor.getContent());
  expect(content.ink).toHaveLength(1);
  expect(content.doc.attrs).toBeUndefined();
});

test('Ctrl+Shift+D переключает рисование и ввод текста', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.press('Control+Shift+D');
  expect(await page.evaluate(() => editor.annotating)).toBe(true);
  await page.keyboard.press('Control+Shift+D');
  expect(await page.evaluate(() => editor.annotating)).toBe(false);
  await page.keyboard.type('снова текст');
  await expect(pm(page)).toContainText('снова текст');
});

test('последние цвета: вместо быстрых перьев — три предыдущих цвета', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
  const bar = page.locator('#editor-wrap .led-overlay-bar');
  await bar.locator('button[title="Цвет"]').click();
  await page.locator('.led-pop .ink-purple').click();
  await expect(bar.locator('.led-ink-recent-btn')).toHaveCount(3);
  await expect(bar.locator('.led-ink-recent-btn').first(), 'предыдущий цвет — первым').toHaveAttribute('data-color', 'ink');
  await bar.locator('.led-ink-recent-btn').first().click();
  expect(await page.evaluate(() => state.settings.editor.ink.color)).toBe('ink');
  await expect(bar.locator('.led-ink-recent-btn').first()).toHaveAttribute('data-color', 'purple');
});

test('настройки рисования: подписи слева, переключатели справа', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
  await page.locator('#editor-wrap .led-overlay-bar button[title="Настройки рисования"]').click();
  const rows = page.locator('.led-pop .led-set-row.switch');
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const geo = await rows.nth(i).evaluate((r) => {
      const text = r.querySelector('.led-setting-text').getBoundingClientRect();
      const track = r.querySelector('.switch-track').getBoundingClientRect();
      return { textLeft: text.left, rowLeft: r.getBoundingClientRect().left, trackLeft: track.left, align: getComputedStyle(r).textAlign };
    });
    expect(geo.textLeft - geo.rowLeft, 'подпись у левого края').toBeLessThan(2);
    expect(geo.trackLeft, 'переключатель справа от подписи').toBeGreaterThan(geo.textLeft);
    expect(geo.align).toBe('left');
  }
});

test('«во весь экран» — у правого края панели редактора', async ({ page }) => {
  await openTask(page);
  const btn = page.locator('#editor-wrap .led-toolbar-end button');
  await expect(btn).toBeVisible();
  const geo = await page.evaluate(() => {
    const bar = document.querySelector('#editor-wrap .led-toolbar').getBoundingClientRect();
    const b = document.querySelector('#editor-wrap .led-toolbar-end button').getBoundingClientRect();
    return { gap: bar.right - b.right };
  });
  expect(geo.gap).toBeLessThan(14);
  await btn.click();
  await expect(page.locator('#editor-wrap .led')).toHaveClass(/led-fullscreen/);
  await expect(btn).toHaveAttribute('title', /Выйти/);
  await btn.click();
  await expect(page.locator('#editor-wrap .led')).not.toHaveClass(/led-fullscreen/);
});

test('размер и шрифт выделенного текста — из панели и над выделением', async ({ page }) => {
  const id = await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Большой заголовок');
  await page.keyboard.press('Shift+Home');
  await page.locator('#editor-wrap .led-toolbar button[title="Размер текста"]').click();
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Крупный' }).first().click();
  await expect(pm(page).locator('span.led-fs-l')).toHaveText('Большой заголовок');
  await page.keyboard.press('Shift+Home');
  await expect(page.locator('#editor-wrap .led-bubble button[title="Шрифт"]')).toBeVisible();
  await page.locator('#editor-wrap .led-bubble button[title="Шрифт"]').click();
  await page.locator('.ctx-menu .ctx-item', { hasText: 'С засечками' }).click();
  const fam = await pm(page).locator('span.led-ff-serif').evaluate((e) => getComputedStyle(e).fontFamily);
  expect(fam).toMatch(/serif/i);
  const big = await pm(page).locator('span.led-fs-l').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const base = await pm(page).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(big / base).toBeCloseTo(1.25, 2);
  const notes = await savedNotes(page, id);
  const marks = notes.lancible.doc.content[0].content[0].marks.map((m) => m.type).sort();
  expect(marks).toEqual(['fontFamily', 'fontSize']);
});

test('рисунок удаляется сразу после рисования — без ошибок', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openTask(page);
  await pm(page).click();
  await page.evaluate(() => editor.exec('drawing'));
  const box = await page.locator('#editor-wrap .led-draw-area').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 30 + i * 10, box.y + 40);
  await page.mouse.up();
  await page.locator('#editor-wrap .led-draw-bar button[title="Ещё"]').click();
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Очистить холст' }).click();
  await page.locator('#editor-wrap .led-draw-bar button[title="Ещё"]').click();
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Удалить' }).click();
  await expect(page.locator('#editor-wrap .led-drawing')).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => editor.getContent().doc.content.some((n) => n.type === 'drawing'))).toBe(false);
  expect(errors).toEqual([]);
});

test.describe('телефон: настройки рисования', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

  test('открываются нижним листом и закрываются', async ({ page }) => {
    await openTask(page);
    await page.locator('#editor-wrap .led-toolbar button[title^="Пометки от руки поверх текста"]').click();
    await page.locator('#editor-wrap .led-overlay-bar button[title="Ещё"]').click();
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Настройки рисования' }).click();
    const sheet = page.locator('.led-sheet');
    await expect(sheet).toBeVisible();
    await sheet.evaluate((s) => s.getAnimations().forEach((a) => a.finish()));
    const geo = await sheet.evaluate((s) => { const r = s.getBoundingClientRect(); return { bottom: r.bottom, left: r.left, width: r.width, vh: innerHeight, vw: innerWidth }; });
    expect(Math.abs(geo.bottom - geo.vh), 'лист прижат к низу экрана').toBeLessThan(2);
    expect(geo.width).toBeCloseTo(geo.vw, 0);
    await expect(sheet.locator('.led-set-sec')).toHaveCount(3);
    await sheet.locator('.led-sheet-close').click();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => editor.annotating), 'закрытие листа не выключает пометки').toBe(true);
  });

  test('«во весь экран» видна и на телефоне, без прокрутки панели', async ({ page }) => {
    await openTask(page);
    const btn = page.locator('#editor-wrap .led-toolbar-end button');
    await expect(btn).toBeVisible();
    const inView = await btn.evaluate((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
    expect(inView).toBe(true);
  });
});

// Редактор заметок и документов (src/editor/, ProseMirror). Запуск: npm run test:e2e
//
// Откуда взялось. До 7 октября 2026 здесь проверялся Quill: панель, таблицы,
// заливка. Редактор заменён своим, и тест переписан под его поведение —
// то, что обязано работать у того, кто пишет: набранное доезжает до задачи,
// старые заметки Quill читаются, markdown-сокращения, таблицы, графики,
// комментарии, поиск, рисунок пером и пометки поверх текста.
const { test, expect } = require('@playwright/test');
const { reachable, tool } = require('./led-toolbar');

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
  // С 11 октября панель — одна строка: что не влезло, лежит в меню групп
  // (подробно — editor-toolbar.spec.js). Собрана — значит, всё достижимо.
  const found = await reachable(page);
  for (const cmd of ['bold', 'italic', 'bullet', 'tasks', 'table', 'image', 'chart', 'drawing', 'comment', 'annotate']) {
    expect(found.has(cmd), `нет команды «${cmd}»`).toBe(true);
  }
  for (const title of ['Полужирный', 'Курсив']) {
    await expect(page.locator(`#editor-wrap .led-toolbar button[title^="${title}"]`).first(), `нет кнопки «${title}» в строке`).toBeVisible();
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
  // Строк и столбцов в острове на десктопе нет — они на ручках слева и
  // сверху таблицы (tests/e2e/editor-table-handles.spec.js).
  await expect(bar.locator('[data-tt="rowBelow"], [data-tt="colRight"]')).toHaveCount(0);
  await bar.locator('[data-tt="tableDel"]').click();
  expect(await tableShape(page)).toEqual({ rows: 0, cols: 0 });
  const notes = await savedNotes(page, id);
  expect(notes.lancible.doc.content.some((n) => n.type === 'table')).toBe(false);
});

// Ручки строк и столбцов (до 17 октября — шестерёнка на разделителях) —
// tests/e2e/editor-table-handles.spec.js.

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

// Откуда взялось (20 октября 2026): у острова графика было то же, что у
// картинки до 7337a40 (tests/e2e/editor-image.spec.js, «выравнивания подряд
// под замедлением»). Щелчок по кнопке острова внутри выделенного графика для
// браузера — щелчок внутри выделения не по тексту: сразу после click он
// снимал выделение целиком (rangeCount 0), а фокус оставался в тексте.
// «Изменить график» открывает окно и забирает фокус только следующей
// задачей (setTimeout в modal) — и если в этот промежуток успевало движение
// мыши или клавиша, курсор вставал в начало заметки, ProseMirror читал его
// как новое выделение, а после «Отмены» график был уже не выделен и остров
// пропадал. Промежуток меряется здесь прямо: задача, поставленная из click
// раньше фокуса окна, видит выделение браузера. Дальше — как у картинки:
// мышь уходит, Shift, и только потом проверка. Процессор замедлен, как на
// загруженной машине CI.
test('остров графика под замедлением: «изменить» и «отмена» подряд — выделение и остров на месте, мышь и клавиша их не сбивают', async ({ page }) => {
  await openTask(page);
  await page.evaluate(() => {
    const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const chart = { type: 'bar', title: '', labels: ['Янв', 'Фев'], series: [{ name: 'Часы', values: [10, 14] }], legend: true, values: false, stacked: false };
    editor.setContent({ v: 1, doc: { type: 'doc', content: [p('до'), { type: 'chart', attrs: { chart } }, p('после')] }, comments: [], ink: [] });
  });
  const chart = pm(page).locator('.led-chart');
  await chart.evaluate((c) => {
    // Захват на документе срабатывает раньше обработчика кнопки, и его
    // задача встаёт в очередь раньше фокуса окна.
    document.addEventListener('click', () => setTimeout(() => {
      const dom = getSelection();
      window.__afterClick = { around: dom.rangeCount === 1 && dom.containsNode(c), range: dom.rangeCount };
    }, 0), true);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const modal = page.locator('#ledmodal-backdrop');
  for (let i = 1; i <= 4; i++) {
    // После «Отмены» фокус у страницы, а не у редактора, и график выделяется
    // заново. Сначала — щелчок в текст: щелчок по уже выделенному графику
    // выделение не меняет, ProseMirror его не пересылает (updateSelection),
    // и выделение браузера вокруг графика не встаёт.
    await pm(page).locator('p', { hasText: 'после' }).click();
    await chart.locator('.led-chart-body').click();
    await expect(chart).toHaveClass(/\bsel\b/);
    const before = await chart.evaluate((c) => { const d = getSelection(); return d.rangeCount === 1 && d.containsNode(c); });
    expect(before, `круг ${i}: до щелчка по острову выделение браузера не вокруг графика`).toBe(true);
    await chart.locator('.led-node-bar button[title="Изменить график"]').click();
    await page.mouse.move(60, 400);
    await page.keyboard.press('Shift');
    await expect(modal).toBeVisible();
    const after = await page.evaluate(() => window.__afterClick);
    expect(after.around, `круг ${i}: сразу после щелчка выделение браузера ушло с графика (rangeCount ${after.range})`).toBe(true);
    await modal.locator('.modal-buttons button', { hasText: 'Отмена' }).click();
    await expect(modal).toHaveCount(0);
    await page.mouse.move(60, 400);
    await page.keyboard.press('Shift');
    // Событие selectionchange — задачей после ввода: даём ему пройти.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
    const node = await page.evaluate(() => {
      const s = editor.view.state.selection;
      return s.node ? s.node.type.name : `${s.toJSON().type} ${s.from}`;
    });
    expect(node, `круг ${i}: после «Отмены» выделен не график`).toBe('chart');
    await expect(chart).toHaveClass(/\bsel\b/);
    await expect(chart.locator('.led-node-bar')).toBeVisible();
  }
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
  await tool(page, 'drawing');
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
  await tool(page, 'annotate');
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
  await pickImage(page, () => tool(page, 'image'));
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
  await pickImage(page, () => tool(page, 'image'));
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
  await tool(page, 'view');
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
  await tool(page, 'annotate');
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
  await tool(page, 'view');
  await page.locator('.led-pop .ctx-item', { hasText: 'Показывать пометки от руки' }).click();
  expect(await page.evaluate(() => state.settings.editor.inkHidden)).toBe(false);
});

test('прозрачность пера: ползунок рядом с толщиной, штрих её запоминает', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Абзац');
  await tool(page, 'annotate');
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
    await tool(page, 'annotate');
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
    await tool(page, 'annotate');
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
    await tool(page, 'annotate');
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
    await tool(page, 'annotate');
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
  await tool(page, 'annotate');
  await page.locator('#editor-wrap .led-overlay-bar button[title="Цвет"]').click();
  const colors = await page.locator('.led-pop .led-ink-colors .led-swatch').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(colors.length).toBe(10);
  expect(new Set(colors).size, 'десять цветов — десять разных квадратов').toBe(10);
});

test('панель пера на десктопе: ни «null», ни других пустых значений', async ({ page }) => {
  await openTask(page);
  await tool(page, 'annotate');
  const text = await page.locator('#editor-wrap .led-overlay-bar').innerText();
  expect(text).not.toMatch(/null|undefined/);
});

test('пометки отменяются общей отменой: Ctrl+Z в тексте и кнопкой, ластик — одним шагом', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Абзац');
  await tool(page, 'annotate');
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
  await tool(page, 'annotate');
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
  await tool(page, 'annotate');
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
  await tool(page, 'fontSize');
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
    await tool(page, 'annotate');
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

// --- круг 5: задача открывается, даже если заметка не открылась -----------------

test('заметка не открылась — задача и проект всё равно открываются, заметка цела', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const ids = await page.evaluate(() => {
    const now = new Date().toISOString();
    const pid = uid();
    state.projects.push({ id: pid, name: 'Старый проект', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
    seedProjectStatuses(pid);
    const id = uid();
    const notes = { ops: [{ insert: 'старая заметка\n' }], boom: true };
    state.tasks.push({
      id, projectId: pid, title: 'Старая задача', done: false, notes, totalMs: 0, sessions: [], rate: null, pinnedAt: null,
      createdAt: now, updatedAt: now, statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    // Заметка, на которой редактор падает, — как та, что не открывалась у пользователя.
    const read = Core.readNotes;
    Core.readNotes = (n) => { if (n && n.boom) throw new Error('битая заметка'); return read(n); };
    openView('home');
    return { pid, id, before: JSON.stringify(notes) };
  });
  await page.evaluate((pid) => openProject(pid), ids.pid);
  await expect(page.locator('#project-view')).toBeVisible();
  await page.evaluate((id) => selectTask(id), ids.id);
  await expect(page.locator('#task-view')).toBeVisible();
  await expect(page.locator('#task-title')).toHaveValue('Старая задача');
  await expect(page.locator('#toast')).toContainText('битая заметка');
  expect(await page.evaluate(() => editor.view.editable), 'не открывшуюся заметку не правят').toBe(false);
  await page.waitForTimeout(300);
  const after = await page.evaluate((id) => JSON.stringify(state.tasks.find((x) => x.id === id).notes), ids.id);
  expect(after, 'заметка осталась как была').toBe(ids.before);
});

// --- 12 октября: галочки, масштаб текста, нативная панель телефона ------------
//
// Телефон кладёт редактор в WebView и строит панель сам (React Native), а
// редактор создаёт с nativeToolbar: true — протокол в DESIGN.md, «Редактор на
// телефоне: протокол». Здесь тот же бандл поднят рядом с приложением в окне
// шириной с телефон; сообщения хозяину копятся в window.__msgs.

/** Редактор как на телефоне: своя коробка 375×640 поверх приложения. */
async function phoneEditor(page, opts) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((o) => {
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:640px;z-index:500;display:flex;flex-direction:column;background:var(--bg)';
    document.body.append(box);
    window.__msgs = [];
    window.__ped = LancibleEditor.create(box, Object.assign({
      mobile: true, inApp: true, nativeToolbar: true, content: null,
      post: (m) => window.__msgs.push(JSON.parse(JSON.stringify(m))),
    }, o || {}));
  }, opts || {});
  await page.locator('#phone-ed .led-pm').click();
}

const msgs = (page, type) => page.evaluate((t) => window.__msgs.filter((m) => m.type === t), type);
const lastMsg = async (page, type) => (await msgs(page, type)).pop();

// 13 октября 2026 квадрат — 24 (был 28): на телефоне 28 казался крупным.
// Зона нажатия на телефоне — 44 (под палец). На десктопе и в вебе под мышью
// и 24 крупно: там квадрат 22 в кнопке 36 (правило вне раздела «Редактор» в
// styles.css — в сборку телефона оно не попадает); телефон — ниже, 24/44.
test('галочка чек-листа на десктопе: квадрат 22, зона нажатия 36, строка не растёт', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('[] дело');
  const geo = await page.evaluate(() => {
    const box = document.querySelector('#editor-wrap .led-task-box');
    const li = box.closest('li');
    const r = box.getBoundingClientRect();
    const sq = getComputedStyle(box, '::before');
    const p = li.querySelector('p').getBoundingClientRect();
    return { w: r.width, h: r.height, sqW: sq.width, sqH: sq.height, sqTop: r.top + parseFloat(sq.top), sqH2: parseFloat(sq.height), row: li.getBoundingClientRect().height, lineMid: p.top + Math.min(p.height, parseFloat(getComputedStyle(li).lineHeight)) / 2, textLeft: p.left, boxRight: r.right };
  });
  expect(geo.w, 'зона нажатия — 36').toBeCloseTo(36, 0);
  expect(geo.h).toBeCloseTo(36, 0);
  expect(geo.sqW).toBe('22px');
  expect(geo.sqH).toBe('22px');
  expect(Math.abs(geo.sqTop + geo.sqH2 / 2 - geo.lineMid), 'квадрат — по центру первой строки').toBeLessThan(2);
  expect(geo.row, 'строка не выросла до зоны нажатия').toBeLessThan(34);
  expect(geo.boxRight, 'зона нажатия не заходит на текст').toBeLessThanOrEqual(geo.textLeft);
});

test('галочка: отметили — налив и штрих, текст бледнее и зачёркнут', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('[] дело');
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('#editor-wrap .led-task-box'), '::before').backgroundSize);
  expect(before).toBe('0% 0%');
  await page.locator('#editor-wrap .led-task-box').click();
  const li = pm(page).locator('li.led-task');
  await expect(li).toHaveAttribute('data-checked', 'true');
  await expect(li, 'анимация — у только что отмеченного').toHaveClass(/led-just-checked/);
  const st = await page.evaluate(() => {
    const box = document.querySelector('#editor-wrap .led-task-box');
    const p = box.closest('li').querySelector('p');
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-faint)';
    document.querySelector('#editor-wrap .led').append(probe);
    const faint = getComputedStyle(probe).color;
    probe.remove();
    return { anim: getComputedStyle(box, '::after').animationName, deco: getComputedStyle(p).textDecorationLine, faint };
  });
  expect(st.anim).toBe('ledTaskTick');
  expect(st.deco).toContain('line-through');
  // Налив — переходом: дожидаемся конца.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('#editor-wrap .led-task-box'), '::before').backgroundSize)).toBe('300% 300%');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('#editor-wrap .led-pm li.led-task p')).color)).toBe(st.faint);
  await expect(li).not.toHaveClass(/led-just-checked/, { timeout: 2000 });
  // Открыли заметку заново — отмеченные не анимируются.
  await page.evaluate(() => editor.setContent(editor.getContent()));
  await expect(pm(page).locator('li.led-task')).toHaveAttribute('data-checked', 'true');
  await expect(pm(page).locator('li.led-task')).not.toHaveClass(/led-just-checked/);
});

test('нативная панель: веб-панели и строки пера нет, команды — через exec', async ({ page }) => {
  await phoneEditor(page);
  await expect(page.locator('#phone-ed .led')).toHaveClass(/led-native/);
  await expect(page.locator('#phone-ed .led-toolbar')).toHaveCount(0);
  await expect(page.locator('#phone-ed .led-inkbar')).toHaveCount(0);
  await page.keyboard.type('привет');
  await page.evaluate(() => __ped.exec('block', 'h2'));
  await expect(page.locator('#phone-ed .led-pm h2')).toHaveText('привет');
  await page.evaluate(() => __ped.exec('annotate'));
  expect(await lastMsg(page, 'ink')).toMatchObject({ type: 'ink', on: true, tool: 'pen' });
  await expect(page.locator('#phone-ed .led-inkbar'), 'перо — тоже в нативной строке').toHaveCount(0);
  await page.evaluate(() => __ped.exec('inkTool', 'marker'));
  expect(await lastMsg(page, 'ink')).toMatchObject({ on: true, tool: 'marker' });
  await page.evaluate(() => __ped.exec('inkDone'));
  expect(await lastMsg(page, 'ink')).toMatchObject({ on: false });
});

test('нативная панель: format и caret приходят на каждую правку и курсор', async ({ page }) => {
  await phoneEditor(page);
  await page.keyboard.type('слово');
  await expect.poll(async () => (await lastMsg(page, 'format') || {}).state).toMatchObject({ focused: true, strong: false, block: 'paragraph', canUndo: true });
  const expected = await page.evaluate(() => { const c = __ped.view.coordsAtPos(__ped.view.state.selection.head); return Math.round(c.top + scrollY); });
  await expect.poll(async () => (await lastMsg(page, 'caret') || {}).top, 'курсор в координатах страницы').toBe(expected);
  const caret = await lastMsg(page, 'caret');
  expect(caret.bottom).toBeGreaterThan(caret.top);
  await page.keyboard.press('Shift+Home');
  await page.evaluate(() => __ped.exec('bold'));
  await expect.poll(async () => (await lastMsg(page, 'format')).state.strong).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await lastMsg(page, 'caret')).top, 'курсор ушёл вниз — caret следом').toBeGreaterThan(caret.top);
  // Хозяин просит состояние заново — приходит, даже если не менялось.
  const n = (await msgs(page, 'format')).length;
  await page.evaluate(() => __ped.receive({ type: 'getState' }));
  expect((await msgs(page, 'format')).length).toBe(n + 1);
});

test('нативная панель: ссылку и фото спрашивает хозяин, ответ вставляется', async ({ page }) => {
  await phoneEditor(page);
  await page.evaluate(() => __ped.exec('link'));
  expect(await lastMsg(page, 'link')).toEqual({ type: 'link', href: '', needText: true });
  await expect(page.locator('#phone-ed .led-link-pop, .led-link-pop'), 'поля ссылки в WebView нет').toHaveCount(0);
  await page.evaluate(() => __ped.receive({ type: 'setLink', href: 'example.com', text: 'сайт' }));
  await expect(page.locator('#phone-ed .led-pm a')).toHaveText('сайт');
  await expect(page.locator('#phone-ed .led-pm a')).toHaveAttribute('href', 'https://example.com');
  await page.keyboard.press('Enter');
  await page.evaluate(() => __ped.exec('image'));
  expect(await lastMsg(page, 'image-pick')).toEqual({ type: 'image-pick', purpose: 'insert' });
  await page.evaluate((b64) => __ped.receive({ type: 'insertImage', dataUrl: `data:image/png;base64,${b64}`, name: 'photo.png' }), PNG.toString('base64'));
  await expect(page.locator('#phone-ed .led-pm img')).toHaveCount(1);
  expect(await page.evaluate(() => __ped.getContent().doc.content.find((n) => n.type === 'image').attrs.src)).toMatch(/^asset:/);
  await page.evaluate(() => __ped.exec('exportMd'));
  expect(await lastMsg(page, 'export')).toMatchObject({ kind: 'md', mime: 'text/markdown', text: expect.stringContaining('[сайт](https://example.com)') });
});

// График на телефоне (протокол 2, 17 октября 2026): окно правки — нижний
// лист хозяина. Команда «график», касание графика и «график из таблицы»
// шлют chart, ответ receive({ type: 'chart' }) вставляет или заменяет узел.
test('нативная панель: график правит хозяин — сообщение chart, ответ вставляет и заменяет', async ({ page }) => {
  await phoneEditor(page);
  await page.evaluate(() => __ped.exec('chart'));
  await expect(page.locator('#ledmodal-backdrop'), 'окна правки в WebView нет').toHaveCount(0);
  const ask = await lastMsg(page, 'chart');
  expect(ask.id, 'новый график — без id').toBeNull();
  // spec — вид, название и строки первого ряда образца (defaultChart).
  expect(ask.spec).toEqual({ kind: 'bar', title: '', rows: [
    { label: 'Янв', value: 4 }, { label: 'Фев', value: 7 }, { label: 'Мар', value: 5 }, { label: 'Апр', value: 9 },
  ] });
  const chartAttrs = () => page.evaluate(() => __ped.getContent().doc.content.filter((n) => n.type === 'chart').map((n) => ({ bid: n.attrs.bid, chart: n.attrs.chart })));
  await page.evaluate(() => __ped.receive({ type: 'chart', id: null, spec: { kind: 'line', title: 'Часы', rows: [{ label: 'Янв', value: 10 }, { label: 'Фев', value: '14,5' }] } }));
  await expect(page.locator('#phone-ed .led-pm .led-chart svg.type-line')).toHaveCount(1);
  let charts = await chartAttrs();
  expect(charts).toHaveLength(1);
  expect(charts[0].chart).toMatchObject({ type: 'line', title: 'Часы', labels: ['Янв', 'Фев'], legend: true, values: false, stacked: false });
  expect(charts[0].chart.series).toEqual([{ name: 'Ряд 1', values: [10, 14.5] }]);
  const { bid } = charts[0];
  expect(bid, 'у графика есть bid — по нему хозяин его заменит').toBeTruthy();
  // Касание графика — снова лист, теперь с id и нынешними данными.
  await page.locator('#phone-ed .led-pm .led-chart .led-chart-body').click();
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  await expect.poll(async () => (await msgs(page, 'chart')).length).toBe(2);
  expect(await lastMsg(page, 'chart')).toEqual({ type: 'chart', id: bid, spec: { kind: 'line', title: 'Часы', rows: [{ label: 'Янв', value: 10 }, { label: 'Фев', value: 14.5 }] } });
  // Повторный receive с id — заменяет тот же узел, а не вставляет второй.
  await page.evaluate((id) => __ped.receive({ type: 'chart', id, spec: { kind: 'pie', title: 'Доли', rows: [{ label: 'А', value: 1 }, { label: 'Б', value: 3 }, { label: 'В', value: 2 }] } }), bid);
  await expect(page.locator('#phone-ed .led-pm .led-chart svg.type-pie')).toHaveCount(1);
  charts = await chartAttrs();
  expect(charts).toHaveLength(1);
  expect(charts[0].bid).toBe(bid);
  expect(charts[0].chart).toMatchObject({ type: 'pie', title: 'Доли', labels: ['А', 'Б', 'В'] });
  expect(charts[0].chart.series[0].values).toEqual([1, 3, 2]);
  // Узла нет (документ сменился) — ошибка хозяину, документ цел.
  await page.evaluate(() => __ped.receive({ type: 'chart', id: 'нет-такого', spec: { kind: 'bar', title: '', rows: [] } }));
  expect(await lastMsg(page, 'error')).toMatchObject({ message: expect.stringContaining('нет-такого') });
  expect(await chartAttrs()).toHaveLength(1);
});

test('нативная панель: график из таблицы — числа таблицы хозяину, новый график под таблицей', async ({ page }) => {
  await phoneEditor(page);
  await page.evaluate(() => __ped.exec('table', { rows: 3, cols: 2, header: true }));
  const k = page.keyboard;
  for (const [i, cell] of ['Месяц', 'Часы', 'Янв', '10', 'Фев', '14,5'].entries()) { await k.type(cell); if (i < 5) await k.press('Tab'); }
  await page.evaluate(() => __ped.exec('toChart'));
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  const ask = await lastMsg(page, 'chart');
  expect(ask).toEqual({ type: 'chart', id: null, spec: { kind: 'bar', title: '', rows: [{ label: 'Янв', value: 10 }, { label: 'Фев', value: 14.5 }] } });
  await page.evaluate((spec) => __ped.receive({ type: 'chart', id: null, spec }), ask.spec);
  const types = await page.evaluate(() => __ped.getContent().doc.content.map((n) => n.type));
  expect(types.indexOf('chart'), 'график — сразу под таблицей').toBe(types.indexOf('table') + 1);
});

// Телефон масштаба не шлёт с 13 октября 2026; setZoom остался у редактора.
test('масштаб текста: растёт шрифт страницы, галочка остаётся 24', async ({ page }) => {
  await phoneEditor(page);
  await page.keyboard.type('[] дело');
  const size = () => page.evaluate(() => ({
    font: getComputedStyle(document.querySelector('#phone-ed .led-pm')).fontSize,
    box: getComputedStyle(document.querySelector('#phone-ed .led-task-box'), '::before').width,
  }));
  expect(await size()).toEqual({ font: '16px', box: '24px' });
  expect(await page.evaluate(() => __ped.setZoom(1.5))).toBe(1.5);
  expect(await size()).toEqual({ font: '24px', box: '24px' });
  expect(await page.evaluate(() => __ped.setZoom(9)), 'больше 2 — 2').toBe(2);
  expect((await size()).font).toBe('32px');
  await page.evaluate(() => __ped.receive({ type: 'setZoom', zoom: 0.1 }));
  expect((await size()).font, 'меньше 0.8 — 0.8').toBe('12.8px');
  await expect.poll(async () => (await lastMsg(page, 'format')).state.zoom).toBe(0.8);
});

// Веб на телефоне (mobile без nativeToolbar): панель над выделением —
// четыре кнопки под палец. В приложении (nativeToolbar) её с 18 октября
// 2026 нет — Ж, К, ссылка и цвет в панели над клавиатурой
// (tests/e2e/editor-context.spec.js).
test('панель над выделением на телефоне (веб): четыре кнопки над началом выделения', async ({ page }) => {
  await phoneEditor(page, { nativeToolbar: false });
  for (let i = 0; i < 5; i++) await page.keyboard.press('Enter');
  await page.keyboard.type('выделим слово');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  const bubble = page.locator('#phone-ed .led-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveClass(/led-bubble-touch/);
  await expect(bubble.locator('button')).toHaveCount(4);
  const geo = await page.evaluate(() => {
    // Место и размер — без масштаба появления (popIn): то, что поставил
    // placePopup, и offset-размеры, а не getBoundingClientRect.
    const el = document.querySelector('#phone-ed .led-bubble');
    const a = __ped.view.coordsAtPos(__ped.view.state.selection.from);
    const btn = document.querySelector('#phone-ed .led-bubble .led-btn').offsetHeight;
    const top = parseFloat(el.style.top);
    return { bottom: top + el.offsetHeight, left: parseFloat(el.style.left), selTop: a.top, selLeft: a.left, btn };
  });
  expect(geo.bottom, 'не закрывает выделение').toBeLessThanOrEqual(geo.selTop);
  expect(Math.abs(geo.left - (geo.selLeft - 8)), 'над началом выделения').toBeLessThan(2);
  expect(geo.btn, 'кнопки под палец').toBe(44);
  await bubble.locator('button').first().click();
  expect(await page.evaluate(() => __ped.getToolbarState().strong)).toBe(true);
  await page.keyboard.press('End');
  await expect(bubble).toBeHidden();
});

// 13 октября 2026: поле заметок на странице задачи телефона тянется до низа
// экрана, а текст в нём короче. Касание пустого места под текстом — писать
// дальше: фокус и курсор в конец (src/editor/index.js: onBlankDown).
test('касание пустого места под текстом — фокус и курсор в конец', async ({ page }) => {
  await phoneEditor(page, { autoHeight: true });
  await page.keyboard.type('первая');
  await page.keyboard.press('Enter');
  await page.keyboard.type('вторая');
  await page.keyboard.press('Control+Home');
  await page.evaluate(() => document.activeElement.blur());
  expect(await page.evaluate(() => __ped.view.hasFocus())).toBe(false);
  // Коробка — 640 в высоту, редактор по тексту ниже: под ним пусто.
  const y = await page.evaluate(() => document.querySelector('#phone-ed .led').getBoundingClientRect().bottom + 60);
  expect(y).toBeLessThan(620);
  await page.mouse.click(180, y);
  const st = await page.evaluate(() => {
    const s = __ped.view.state;
    return { focus: __ped.view.hasFocus(), head: s.selection.head, empty: s.selection.empty, end: s.doc.content.size - 1 };
  });
  expect(st).toEqual({ focus: true, head: st.end, empty: true, end: st.end });
  await page.keyboard.type('!');
  await expect(page.locator('#phone-ed .led-pm p').last()).toHaveText('вторая!');
  // Касание по самому тексту — как раньше: курсор туда, куда коснулись.
  await page.locator('#phone-ed .led-pm p').first().click({ position: { x: 2, y: 5 } });
  // Курсор от щелчка по тексту ProseMirror читает из selectionchange —
  // событием позже щелчка, поэтому с ожиданием, а не сразу.
  await expect.poll(() => page.evaluate(() => __ped.view.state.selection.head)).toBeLessThan(5);
});

test('под таблицей касание пустого места — новый абзац, а не последняя ячейка', async ({ page }) => {
  await phoneEditor(page, { autoHeight: true });
  await page.keyboard.type('до таблицы');
  await page.evaluate(() => __ped.exec('table'));
  // Таблица — последним блоком: пустой абзац после неё, если он есть, убираем.
  await page.evaluate(() => {
    const c = __ped.getContent();
    const last = c.doc.content[c.doc.content.length - 1];
    if (last.type === 'paragraph' && !last.content) c.doc.content.pop();
    __ped.setContent(c);
    document.activeElement.blur();
  });
  expect(await page.evaluate(() => __ped.view.state.doc.lastChild.type.name)).toBe('table');
  const y = await page.evaluate(() => document.querySelector('#phone-ed .led').getBoundingClientRect().bottom + 40);
  await page.mouse.click(180, y);
  const st = await page.evaluate(() => {
    const s = __ped.view.state;
    return { focus: __ped.view.hasFocus(), last: s.doc.lastChild.type.name, inLast: s.selection.$head.parent === s.doc.lastChild };
  });
  expect(st).toEqual({ focus: true, last: 'paragraph', inLast: true });
});

test('высота по тексту: сообщение height растёт вместе с текстом', async ({ page }) => {
  await phoneEditor(page, { autoHeight: true });
  const first = await lastMsg(page, 'height');
  const root = await page.evaluate(() => Math.ceil(document.querySelector('#phone-ed .led').getBoundingClientRect().height));
  expect(first.px).toBe(root);
  expect(first.px, 'пустая заметка — не во весь экран').toBeLessThan(300);
  for (let i = 0; i < 12; i++) { await page.keyboard.type(`строка ${i}`); await page.keyboard.press('Enter'); }
  await expect.poll(async () => (await lastMsg(page, 'height')).px).toBeGreaterThan(first.px + 200);
});

// 19 октября 2026, эмулятор: после вставки картинки в заметки последняя
// строка под ней наполовину уходила под парящую панель. Картинка догружается и
// растит документ, курсор под ней уезжает вниз, а хозяин держал прокрутку по
// прежнему caret. Теперь поменялась высота — курсор приходит заново
// (HostBridge.height, после ResizeObserver, то есть после раскладки): с
// фокусом в тексте и только если сдвинулся. Рост документа выше курсора здесь
// делаем стилем — так же, как его делает догрузка картинки, графика или
// рисунка: выделение то же, транзакции нет, ProseMirror ничего не знает.
test.describe('высота поменялась — курсор заново', () => {
  /** Запас под первым и под последним абзацем — двумя переменными на корне. */
  async function rig(page) {
    await page.addStyleTag({ content: `
      #phone-ed .led-pm > p:first-child { padding-bottom: var(--grow-top, 0px); }
      #phone-ed .led-pm > p:last-child { padding-bottom: var(--grow-bottom, 0px); }` });
    return (top, bottom) => page.evaluate(([t, b]) => {
      const el = document.getElementById('phone-ed');
      el.style.setProperty('--grow-top', t + 'px');
      el.style.setProperty('--grow-bottom', b + 'px');
    }, [top, bottom]);
  }

  /** Курсор в конце второго абзаца, фокус в тексте, первый caret пришёл. */
  async function twoParagraphs(page) {
    await phoneEditor(page, { autoHeight: true });
    await page.keyboard.type('первая');
    await page.keyboard.press('Enter');
    await page.keyboard.type('вторая');
    await expect.poll(async () => (await lastMsg(page, 'caret') || {}).top).toBeGreaterThan(0);
    // Все отложенные сообщения отправлены — дальше считаем только новые.
    await page.waitForTimeout(150);
    return lastMsg(page, 'caret');
  }

  test('документ вырос выше курсора — новый caret с bottom ниже прежнего', async ({ page }) => {
    const before = await twoParagraphs(page);
    const grow = await rig(page);
    const n = (await msgs(page, 'caret')).length;
    const h0 = (await lastMsg(page, 'height')).px;
    await grow(120, 0);
    await expect.poll(async () => (await lastMsg(page, 'height')).px, 'документ вырос — height').toBe(h0 + 120);
    await expect.poll(async () => (await lastMsg(page, 'caret')).bottom, 'и курсор прислан заново').toBe(before.bottom + 120);
    const after = await lastMsg(page, 'caret');
    expect(after.top).toBe(before.top + 120);
    expect((await msgs(page, 'caret')).length, 'одним сообщением, а не россыпью').toBe(n + 1);
    // Прислано то, что на самом деле: координаты страницы, как у обычного caret.
    const real = await page.evaluate(() => { const c = __ped.view.coordsAtPos(__ped.view.state.selection.head); return { top: Math.round(c.top + scrollY), bottom: Math.round(c.bottom + scrollY) }; });
    expect({ top: after.top, bottom: after.bottom }).toEqual(real);
    // Документ просел обратно — курсор тоже возвращается.
    await grow(0, 0);
    await expect.poll(async () => (await lastMsg(page, 'caret')).bottom).toBe(before.bottom);
  });

  test('без фокуса в тексте курсор не шлётся, тот же — не повторяется', async ({ page }) => {
    const before = await twoParagraphs(page);
    const grow = await rig(page);
    const heights = async () => (await msgs(page, 'height')).length;
    // Запас под последним абзацем: документ вырос, курсор там же — повтора нет.
    const h0 = await heights();
    await grow(0, 90);
    await expect.poll(heights, 'документ вырос — height пришёл').toBeGreaterThan(h0);
    await page.waitForTimeout(150);
    expect((await lastMsg(page, 'caret')).bottom, 'курсор не сдвинулся — прежний').toBe(before.bottom);
    const n = (await msgs(page, 'caret')).length;
    await grow(0, 140);
    await expect.poll(heights).toBeGreaterThan(h0 + 1);
    await page.waitForTimeout(150);
    expect((await msgs(page, 'caret')).length, 'то же положение — тот же caret не повторяется').toBe(n);
    // Фокус ушёл: документ меняет высоту — caret не шлётся ни при росте, ни при убыли.
    await page.evaluate(() => document.activeElement.blur());
    expect(await page.evaluate(() => __ped.view.hasFocus())).toBe(false);
    await page.waitForTimeout(150);
    const blurred = (await msgs(page, 'caret')).length;
    const h1 = await heights();
    await grow(300, 140);
    await expect.poll(heights).toBeGreaterThan(h1);
    await grow(0, 0);
    await expect.poll(heights).toBeGreaterThan(h1 + 1);
    await page.waitForTimeout(150);
    expect((await msgs(page, 'caret')).length, 'без фокуса caret не шлётся').toBe(blurred);
  });

  test('картинка на пустой строке: после загрузки в caret курсор под ней', async ({ page }) => {
    await phoneEditor(page, { autoHeight: true });
    await page.keyboard.type('первая');
    await page.keyboard.press('Enter');
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 400;
      const x = c.getContext('2d'); x.fillStyle = '#4a90d9'; x.fillRect(0, 0, 600, 400);
      return c.toDataURL('image/png');
    });
    await page.evaluate((u) => __ped.receive({ type: 'insertImage', dataUrl: u, name: 'photo.png' }), dataUrl);
    await expect(page.locator('#phone-ed .led-pm figure img')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => { const i = document.querySelector('#phone-ed .led-pm figure img'); return i.complete && i.naturalWidth > 0; })).toBe(true);
    const real = async () => page.evaluate(() => { const c = __ped.view.coordsAtPos(__ped.view.state.selection.head); return { top: Math.round(c.top + scrollY), bottom: Math.round(c.bottom + scrollY) }; });
    const fig = await page.evaluate(() => document.querySelector('#phone-ed .led-pm figure').getBoundingClientRect().bottom + scrollY);
    // Курсор — в пустой строке под картинкой, и хозяин знает это место точно.
    await expect.poll(async () => { const m = await lastMsg(page, 'caret'); return { top: m.top, bottom: m.bottom }; }).toEqual(await real());
    expect((await lastMsg(page, 'caret')).top, 'курсор ниже картинки').toBeGreaterThan(fig - 1);
  });
});

// Меню «/» пальцем (17 октября 2026, жалоба с эмулятора телефона): касание
// пункта подсвечивало его, но команда не уходила. Наведение перерисовывало
// меню целиком (paint → replaceChildren), и кнопка, которой коснулись,
// исчезала из документа между mouseenter и click, которые касание шлёт
// следом, — click не приходил. Теперь наведение только переставляет
// подсветку, а касание выбирает пункт по pointerup, не уводя фокус из текста.
test.describe('меню «/» пальцем', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 740 } });

  /** Набрать «/» и коснуться пункта меню с этой подписью. */
  async function tapSlash(page, label) {
    await page.keyboard.type('/');
    const menu = page.locator('.led-slash');
    await expect(menu).toBeVisible();
    const item = menu.locator('.ctx-item', { hasText: label }).first();
    await item.scrollIntoViewIfNeeded();
    const b = await item.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect(menu).toBeHidden();
  }

  test('касание пункта «Заголовок 1» делает заголовок, фокус остаётся в тексте', async ({ page }) => {
    await phoneEditor(page);
    await page.keyboard.type('план');
    await page.keyboard.press('Enter');
    await tapSlash(page, 'Заголовок 1');
    await expect(page.locator('#phone-ed .led-pm h1')).toHaveCount(1);
    await expect(page.locator('#phone-ed .led-pm'), '«/» ушёл вместе с меню').not.toContainText('/');
    expect(await page.evaluate(() => __ped.view.hasFocus()), 'клавиатура не закрылась').toBe(true);
    await page.keyboard.type('Итоги');
    await expect(page.locator('#phone-ed .led-pm h1')).toHaveText('Итоги');
  });

  test('касание «Таблицы» и «Графика» — каждый пункт, а не только первый', async ({ page }) => {
    await phoneEditor(page);
    await tapSlash(page, 'Таблица');
    await expect(page.locator('#phone-ed .led-pm table')).toHaveCount(1);
    await page.evaluate(() => __ped.focusEnd());
    await tapSlash(page, 'График');
    expect(await lastMsg(page, 'chart'), 'график на телефоне — лист хозяина').toMatchObject({ type: 'chart', id: null });
  });
});

// После вставки графика страница телефона ловила window.onerror «ResizeObserver
// loop completed with undelivered notifications» (17 октября 2026): высота
// графика идёт от ширины, и перерисовка прямо в колбэке ResizeObserver меняла
// размер того же узла. Теперь перерисовка — в следующем кадре (chart.js,
// drawing.js). Ошибку браузер шлёт событием error окна, не исключением.
test('вставка графика и рисунка — без ошибки ResizeObserver', async ({ page }) => {
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
  });
  await page.setViewportSize({ width: 375, height: 740 });
  await phoneEditor(page, { autoHeight: true });
  await page.evaluate(() => __ped.receive({ type: 'chart', id: null, spec: { kind: 'bar', title: 'Часы', rows: [{ label: 'Пн', value: 3 }, { label: 'Вт', value: 5 }] } }));
  await expect(page.locator('#phone-ed .led-pm .led-chart svg rect.led-series-0')).toHaveCount(2);
  await page.evaluate(() => __ped.exec('drawing'));
  await expect(page.locator('#phone-ed .led-pm .led-drawing')).toHaveCount(1);
  // Несколько кадров: ошибка цикла приходит после отрисовки.
  await page.evaluate(() => new Promise((r) => { let n = 0; const tick = () => (++n < 10 ? requestAnimationFrame(tick) : r()); requestAnimationFrame(tick); }));
  // И смена ширины — график перерисовывается под неё, тоже без ошибки.
  const w0 = await page.evaluate(() => document.querySelector('#phone-ed .led-chart svg').getAttribute('viewBox'));
  await page.evaluate(() => { document.getElementById('phone-ed').style.width = '320px'; });
  await expect.poll(() => page.evaluate(() => document.querySelector('#phone-ed .led-chart svg').getAttribute('viewBox'))).not.toBe(w0);
  await page.evaluate(() => new Promise((r) => { let n = 0; const tick = () => (++n < 10 ? requestAnimationFrame(tick) : r()); requestAnimationFrame(tick); }));
  expect(await page.evaluate(() => window.__errs.filter((m) => /ResizeObserver/.test(m)))).toEqual([]);
});

// Телефон: контекстная панель вместо островов (протокол 4). Запуск: npm run test:e2e
//
// Откуда взялось (18 октября 2026, жалоба пользователя): на телефоне
// картинку неудобно масштабировать, а плавающие панели быстрых инструментов
// мешают. Решение: с nativeToolbar островов нет вовсе — ни у картинки, ни у
// таблицы, графика, рисунка, страницы PDF и её слоя, ни панели над
// выделением; их действия хозяин показывает в панели над клавиатурой.
// Редактор говорит, что выделено (сообщение context), кнопки зовут exec по
// именам протокола (src/editor/host.js, DESIGN.md «Редактор на телефоне:
// протокол»). У выделенной картинки — значок масштаба в правом нижнем углу:
// тянется пальцем сразу, шлёт gesture on/off. Палец — настоящими касаниями
// через CDP, как у экрана телефона. Чистая логика команд — юнитом в
// tests/unit/editor-host.test.js; здесь — то, чему нужен браузер: виды
// блоков, касания, сообщения хозяину.
const { test, expect } = require('@playwright/test');

test.use({ hasTouch: true, viewport: { width: 375, height: 740 } });

/** Редактор телефона (nativeToolbar) поверх приложения; сообщения хозяину —
 *  в window.__msgs. */
async function phoneEditor(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:640px;z-index:500;display:flex;flex-direction:column;background:var(--bg)';
    document.body.append(box);
    window.__msgs = [];
    window.__ped = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, content: null, post: (m) => window.__msgs.push(JSON.parse(JSON.stringify(m))) });
  });
}

/** PNG w×h одним цветом — собирается в самой странице. */
const PNG = (w, h, color) => `(() => new Promise((r) => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const x = c.getContext('2d'); x.fillStyle = '${color}'; x.fillRect(0, 0, ${w}, ${h}); c.toBlob(r, 'image/png'); }))()`;

const msgs = (page, type) => page.evaluate((t) => window.__msgs.filter((m) => m.type === t), type);
const lastMsg = async (page, type) => (await msgs(page, type)).pop();
const clearMsgs = (page) => page.evaluate(() => { window.__msgs = []; });
const exec = (page, name, arg) => page.evaluate(([n, a]) => __ped.exec(n, a), [name, arg]);
/** Последний context — то, что сейчас показывает панель хозяина. */
const context = async (page) => { const m = await lastMsg(page, 'context'); return m ? { kind: m.kind, state: m.state } : null; };

async function center(loc) {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Касание настоящим экраном (CDP): от from повести на dx, dy без удержания. */
async function touchDrag(page, from, dx, dy) {
  const cdp = await page.context().newCDPSession(page);
  const at = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.x + (dx * i) / 8, from.y + (dy * i) / 8) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(50);
  await cdp.detach();
}

/** Документ: абзац «один», картинка w×h (описание «фото»), абзацы — с
 *  хвостом, чтобы страница прокручивалась. */
async function withImage(page, w, h) {
  await phoneEditor(page);
  await page.evaluate(async (code) => {
    const src = await __ped.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
    const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    __ped.setContent({ v: 1, doc: { type: 'doc', content: [p('один'), { type: 'image', attrs: { src, alt: 'фото' } }, p('два'), ...Array.from({ length: 30 }, (_, i) => p(`строка ${i}`))] }, comments: [], ink: [] });
  }, PNG(w, h, '#cc5533'));
  const fig = page.locator('#phone-ed .led-figure');
  await expect.poll(() => fig.locator('img').evaluate((i) => i.complete && i.naturalWidth)).toBe(w);
  return fig;
}

const imageAttrs = (page) => page.evaluate(() => { let a = null; __ped.view.state.doc.forEach((n) => { if (n.type.name === 'image') a = n.attrs; }); return a; });
const order = (page) => page.evaluate(() => { const out = []; __ped.view.state.doc.forEach((n, _, i) => { if (i < 3) out.push(n.type.name === 'image' ? 'IMG' : n.textContent); }); return out; });

test('картинка: островов нет; значок масштаба 28 px в правом нижнем углу; тяга пальцем — ширина в % полосы, gesture on/off, одна отмена', async ({ page }) => {
  const fig = await withImage(page, 300, 150);
  await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
  await expect(fig).toHaveClass(/\bsel\b/);
  await expect(page.locator('#phone-ed .led-node-bar'), 'острова картинки нет').toHaveCount(0);
  await expect(page.locator('#phone-ed .led-img-handle'), 'ручки сбоку нет — её заменил значок').toHaveCount(0);
  const icon = fig.locator('.led-img-resize');
  await expect(icon).toBeVisible();
  const ib = await icon.boundingBox();
  const fb = await fig.locator('.led-img-frame').boundingBox();
  expect([ib.width, ib.height]).toEqual([28, 28]);
  expect(Math.abs(fb.x + fb.width - (ib.x + ib.width) - 6), 'у правого края').toBeLessThanOrEqual(1);
  expect(Math.abs(fb.y + fb.height - (ib.y + ib.height) - 6), 'у нижнего края').toBeLessThanOrEqual(1);
  const col = await fig.evaluate((f) => f.clientWidth);
  await expect.poll(() => context(page)).toEqual({ kind: 'image', state: { align: 'center', widthPct: Math.round((300 / col) * 100), hasCaption: false, caption: '', alt: 'фото' } });

  // Тянем значок влево и вверх: по центру ширина уходит с обеих сторон —
  // 300 − 2 × 60. Страница при этом не прокручивается.
  const scroller = page.locator('#phone-ed .led-scroll');
  const top0 = await scroller.evaluate((el) => el.scrollTop);
  await clearMsgs(page);
  await touchDrag(page, await center(icon), -60, -80);
  const want = Math.round((180 / col) * 100);
  await expect.poll(async () => (await imageAttrs(page)).width).toBe(want);
  expect((await msgs(page, 'gesture')).map((m) => m.on), 'хозяин выключил прокрутку на время жеста').toEqual([true, false]);
  expect(await scroller.evaluate((el) => el.scrollTop), 'страница не прокрутилась').toBe(top0);
  const g = await fig.evaluate((f) => ({ img: f.querySelector('img').getBoundingClientRect().toJSON(), frame: f.querySelector('.led-img-frame').getBoundingClientRect().toJSON() }));
  expect(Math.abs(g.img.width - g.frame.width), 'картинка и рамка одной ширины').toBeLessThanOrEqual(1);
  expect(Math.abs(g.img.width - (col * want) / 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.img.height - g.img.width / 2), 'пропорции те же').toBeLessThanOrEqual(1.5);
  await expect.poll(async () => (await context(page)).state.widthPct).toBe(want);

  // Один жест — один шаг отмены.
  await exec(page, 'undo');
  expect((await imageAttrs(page)).width).toBeNull();

  // Шире исходного размера — до ширины полосы.
  await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
  await touchDrag(page, await center(icon), 120, 0);
  await expect.poll(async () => (await imageAttrs(page)).width).toBe(100);
  const wide = await fig.evaluate((f) => [f.querySelector('img').getBoundingClientRect().width, f.querySelector('.led-img-frame').getBoundingClientRect().width, f.clientWidth]);
  expect(Math.abs(wide[0] - wide[2]), `картинка ${wide[0]} во всю полосу ${wide[2]}`).toBeLessThanOrEqual(1);
  expect(Math.abs(wide[0] - wide[1])).toBeLessThanOrEqual(1);
});

test('картинка: exec панели — выравнивание, ширина, подпись, описание, замена, скачивание, выше/ниже; «назад» — без клавиатуры', async ({ page }) => {
  const fig = await withImage(page, 300, 150);
  await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
  await expect(fig).toHaveClass(/\bsel\b/);
  expect(await exec(page, 'imageAlign', 'left')).toBe(true);
  await expect(fig).toHaveClass(/align-left/);
  await exec(page, 'imageWidth', 40);
  await exec(page, 'imageCaption', 'Подпись');
  await exec(page, 'imageAlt', 'новое описание');
  expect(await imageAttrs(page)).toMatchObject({ align: 'left', width: 40, caption: 'Подпись', alt: 'новое описание' });
  await expect(fig, 'после кнопок картинка выделена').toHaveClass(/\bsel\b/);
  await expect.poll(() => context(page)).toEqual({ kind: 'image', state: { align: 'left', widthPct: 40, hasCaption: true, caption: 'Подпись', alt: 'новое описание' } });
  // Подпись без arg — поле под картинкой.
  await exec(page, 'imageCaption');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.className)).toBe('led-caption');

  // Замена — фото выбирает хозяин.
  await clearMsgs(page);
  await exec(page, 'imageReplace');
  expect(await lastMsg(page, 'image-pick')).toEqual({ type: 'image-pick', purpose: 'replace' });
  const before = (await imageAttrs(page)).src;
  await page.evaluate(async (code) => {
    const blob = await eval(code);
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    __ped.receive({ type: 'insertImage', dataUrl: url, name: 'new.png' });
  }, PNG(200, 100, '#3377aa'));
  await expect.poll(async () => (await imageAttrs(page)).src).not.toBe(before);
  expect((await imageAttrs(page)).width, 'остальное у картинки — как было').toBe(40);

  // Скачивание — байты хозяину: export kind image.
  await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
  await exec(page, 'imageDownload');
  await expect.poll(async () => (await msgs(page, 'export')).length).toBe(1);
  const ex = await lastMsg(page, 'export');
  expect({ kind: ex.kind, mime: ex.mime, name: ex.name }).toEqual({ kind: 'image', mime: 'image/png', name: 'новое описание.png' });
  expect([...Buffer.from(ex.base64, 'base64').subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  // Выше и ниже — картинка остаётся выделенной.
  expect(await order(page)).toEqual(['один', 'IMG', 'два']);
  await exec(page, 'blockUp');
  expect(await order(page)).toEqual(['IMG', 'один', 'два']);
  await exec(page, 'blockDown');
  await exec(page, 'blockDown');
  expect(await order(page)).toEqual(['один', 'два', 'IMG']);
  await expect(fig).toHaveClass(/\bsel\b/);

  // «Назад»: выделение снято, курсор — за картинкой, клавиатура не открылась.
  await page.evaluate(() => __ped.blur());
  expect(await exec(page, 'deselect')).toBe(true);
  await expect(fig).not.toHaveClass(/\bsel\b/);
  const st = await page.evaluate(() => {
    const s = __ped.view.state.selection;
    return { focus: __ped.view.hasFocus(), node: !!s.node, text: s.$head.parent.textContent, active: document.activeElement && document.activeElement.closest('.led-pm') !== null };
  });
  expect(st).toEqual({ focus: false, node: false, text: 'строка 0', active: false });
  await expect.poll(() => context(page)).toEqual({ kind: null, state: null });

  // Удалить блок.
  await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
  await expect.poll(async () => (await context(page) || {}).kind).toBe('image');
  await exec(page, 'deleteBlock');
  await expect(page.locator('#phone-ed .led-figure')).toHaveCount(0);
  await expect.poll(() => context(page)).toEqual({ kind: null, state: null });
});

test('таблица: острова нет — context и exec; «назад» уводит из таблицы, deleteBlock удаляет её', async ({ page }) => {
  await phoneEditor(page);
  await page.locator('#phone-ed .led-pm').click();
  await exec(page, 'table', { rows: 2, cols: 2, header: true });
  await expect(page.locator('#phone-ed table')).toHaveCount(1);
  await expect(page.locator('#phone-ed .led-tablebar'), 'острова таблицы нет').toHaveCount(0);
  await expect(page.locator('#phone-ed .led-thandle-row'), 'строки и столбцы — по-прежнему ручками').toBeVisible();
  await expect.poll(() => context(page)).toEqual({ kind: 'table', state: { canMerge: false, canSplit: false, headerRow: true } });
  const shape = () => page.evaluate(() => { const rows = document.querySelectorAll('#phone-ed .led-pm table tr'); return [rows.length, rows[0].children.length]; });
  await exec(page, 'tableRowAdd');
  await exec(page, 'tableColAdd');
  expect(await shape()).toEqual([3, 3]);
  await exec(page, 'tableColDelete');
  expect(await shape()).toEqual([3, 2]);
  await exec(page, 'tableHeaderRow');
  await expect.poll(async () => (await context(page)).state.headerRow).toBe(false);
  // Числа в таблицу — «график из таблицы» уходит хозяину листом.
  await page.locator('#phone-ed .led-pm td').nth(0).click();
  for (const [i, cell] of ['Янв', '10', 'Фев', '14'].entries()) { await page.keyboard.type(cell); if (i < 3) await page.keyboard.press('Tab'); }
  await clearMsgs(page);
  await exec(page, 'tableChart');
  expect((await lastMsg(page, 'chart')).spec.rows).toEqual(expect.arrayContaining([{ label: 'Фев', value: 14 }]));
  // «Назад» — курсор за таблицей, context ушёл.
  await exec(page, 'deselect');
  await expect.poll(() => context(page)).toEqual({ kind: null, state: null });
  expect(await page.evaluate(() => __ped.getToolbarState().inTable)).toBe(false);
  await page.locator('#phone-ed .led-pm td').first().click();
  await expect.poll(async () => (await context(page) || {}).kind).toBe('table');
  await exec(page, 'deleteBlock');
  await expect(page.locator('#phone-ed table')).toHaveCount(0);
});

test('график и рисунок: островов нет; chartEdit — лист хозяина, drawingEdit — правка; «назад» закрывает рисунок', async ({ page }) => {
  await phoneEditor(page);
  await page.evaluate(() => __ped.receive({ type: 'chart', id: null, spec: { kind: 'bar', title: 'Часы', rows: [{ label: 'А', value: 1 }, { label: 'Б', value: 2 }] } }));
  await expect(page.locator('#phone-ed .led-chart')).toHaveCount(1);
  await expect(page.locator('#phone-ed .led-chart .led-node-bar'), 'острова графика нет').toHaveCount(0);
  const selectBlock = (type) => page.evaluate((t) => {
    let at = -1;
    __ped.view.state.doc.forEach((n, pos) => { if (n.type.name === t) at = pos; });
    __ped.view.dispatch(__ped.view.state.tr.setSelection(LancibleEditor.NodeSelection.create(__ped.view.state.doc, at)));
  }, type);
  await selectBlock('chart');
  await expect.poll(() => context(page)).toEqual({ kind: 'chart', state: {} });
  await clearMsgs(page);
  expect(await exec(page, 'chartEdit')).toBe(true);
  const ask = await lastMsg(page, 'chart');
  expect(ask.id, 'правка — по bid графика').toBeTruthy();
  expect(ask.spec).toMatchObject({ kind: 'bar', title: 'Часы' });

  // Рисунок: вставка открывает его на правку — context drawing.
  await exec(page, 'deselect');
  await exec(page, 'drawing');
  await expect(page.locator('#phone-ed .led-drawing.active')).toHaveCount(1);
  await expect.poll(async () => (await context(page) || {}).kind).toBe('drawing');
  await exec(page, 'deselect');
  await expect(page.locator('#phone-ed .led-drawing.active'), '«назад» закрыл рисунок').toHaveCount(0);
  await expect.poll(() => context(page)).toEqual({ kind: null, state: null });
  await selectBlock('drawing');
  await expect.poll(() => context(page)).toEqual({ kind: 'drawing', state: {} });
  await exec(page, 'drawingEdit');
  await expect(page.locator('#phone-ed .led-drawing.active')).toHaveCount(1);
  await exec(page, 'deleteBlock');
  await expect(page.locator('#phone-ed .led-drawing')).toHaveCount(0);
  await expect.poll(() => context(page)).toEqual({ kind: null, state: null });
});

// 19 октября 2026: bid вложенного графика повторялся после «Дублировать», и
// ответ хозяина по bid правил первый график, а не тот, которого коснулись.
test('дубль списка с графиком: у графиков разные bid, правка второго меняет второй', async ({ page }) => {
  await phoneEditor(page);
  await page.evaluate(() => {
    const chart = { type: 'bar', title: 'Первый', labels: ['А'], series: [{ name: '', values: [1] }] };
    __ped.setContent({ v: 1, doc: { type: 'doc', content: [
      { type: 'bullet_list', content: [{ type: 'list_item', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'пункт' }] },
        { type: 'chart', attrs: { bid: 'C1', chart } },
      ] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'хвост' }] },
    ] }, comments: [], ink: [] });
  });
  await page.locator('#phone-ed .led-pm li p', { hasText: 'пункт' }).click();
  await page.keyboard.press('Control+d');
  const charts = () => page.evaluate(() => { const out = []; __ped.view.state.doc.descendants((n, pos) => { if (n.type.name === 'chart') out.push({ pos, bid: n.attrs.bid, title: n.attrs.chart && n.attrs.chart.title }); }); return out; });
  await expect.poll(async () => (await charts()).length).toBe(2);
  const [first, second] = await charts();
  expect(first.bid, 'у первого — прежний номер').toBe('C1');
  expect(second.bid, 'у копии — свой').toBeTruthy();
  expect(second.bid).not.toBe('C1');
  // Касание второго — лист хозяину с его bid; ответ меняет второй.
  await page.evaluate((pos) => __ped.view.dispatch(__ped.view.state.tr.setSelection(LancibleEditor.NodeSelection.create(__ped.view.state.doc, pos))), second.pos);
  await clearMsgs(page);
  expect(await exec(page, 'chartEdit')).toBe(true);
  const ask = await lastMsg(page, 'chart');
  expect(ask.id).toBe(second.bid);
  await page.evaluate((id) => __ped.receive({ type: 'chart', id, spec: { kind: 'bar', title: 'Второй', rows: [{ label: 'Б', value: 2 }] } }), ask.id);
  const after = await charts();
  expect(after.map((c) => c.title)).toEqual(['Первый', 'Второй']);
});

test('страница PDF: острова нет; pdfTool добавляет слои, pdfLayer* правят выделенный; «назад» — со слоя на страницу, со страницы — прочь', async ({ page }) => {
  await phoneEditor(page);
  await page.evaluate(async (code) => {
    const preview = await __ped.assets.put(new File([await eval(code)], 'p.png', { type: 'image/png' }));
    const lines = [{ x: 60, y: 80, w: 200, h: 16, size: 12, text: 'Строка договора' }];
    __ped.setContent({ v: 1, doc: { type: 'doc', content: [{ type: 'pdfpage', attrs: { src: '', page: 1, w: 595, h: 842, preview, overlays: [], lines } }, { type: 'paragraph' }] }, comments: [], ink: [] });
  }, PNG(595, 842, '#fafafa'));
  const sheet = page.locator('#phone-ed .led-pdf-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#phone-ed .led-pdfbar'), 'острова страницы нет').toHaveCount(0);
  await page.touchscreen.tap(...Object.values(await center(sheet)));
  await expect.poll(() => context(page)).toEqual({ kind: 'pdfpage', state: { tool: null, hasLines: true } });
  const layers = () => page.evaluate(() => __ped.view.state.doc.firstChild.attrs.overlays);

  expect(await exec(page, 'pdfTool', 'rect')).toBe(true);
  let list = await layers();
  expect(list.map((o) => o.type)).toEqual(['rect']);
  await expect.poll(async () => (await context(page)).kind).toBe('pdflayer');
  expect((await context(page)).state).toMatchObject({ type: 'rect', color: list[0].stroke.color, size: list[0].stroke.width, bold: false, sizes: [1, 2, 4, 8] });
  await exec(page, 'pdfLayerColor', 'blue');
  await exec(page, 'pdfLayerSize', 4);
  list = await layers();
  expect(list[0].stroke).toEqual({ color: 'blue', width: 4 });
  await expect.poll(async () => (await context(page)).state).toMatchObject({ color: 'blue', size: 4 });
  expect(await exec(page, 'pdfLayerBold'), 'жирность — только у текста').toBe(false);

  // Текстовый слой: набрать, жирный, кегль.
  await exec(page, 'pdfTool', 'text');
  await page.keyboard.type('Привет');
  await exec(page, 'pdfLayerBold');
  await exec(page, 'pdfLayerSize', 18);
  await expect.poll(async () => (await context(page)).state).toMatchObject({ type: 'text', bold: true, size: 18 });
  // «Назад» со слоя — на страницу: текст сохранён, слой больше не выделен.
  await exec(page, 'deselect');
  await expect.poll(() => context(page)).toEqual({ kind: 'pdfpage', state: { tool: null, hasLines: true } });
  list = await layers();
  expect(list.map((o) => o.type)).toEqual(['rect', 'text']);
  expect(list[1]).toMatchObject({ text: 'Привет', font: { size: 18, weight: 'bold' } });

  // Порядок наложения и удаление — у выделенного слоя.
  await page.touchscreen.tap(...Object.values(await center(page.locator('#phone-ed .led-pdf-rect'))));
  await expect.poll(async () => (await context(page)).state.type).toBe('rect');
  await exec(page, 'pdfLayerFront');
  expect((await layers()).map((o) => o.type)).toEqual(['text', 'rect']);
  await exec(page, 'pdfLayerBack');
  expect((await layers()).map((o) => o.type)).toEqual(['rect', 'text']);
  await exec(page, 'pdfLayerDelete');
  expect((await layers()).map((o) => o.type)).toEqual(['text']);
  await expect.poll(async () => (await context(page)).kind).toBe('pdfpage');
  expect(await page.evaluate(() => __ped.view.hasFocus()), 'после удаления слоя клавиатура не открылась').toBe(false);

  // «Заменить текст» — режим; null — выйти.
  await exec(page, 'pdfTool', 'replace');
  await expect.poll(async () => (await context(page)).state.tool).toBe('replace');
  await expect(page.locator('#phone-ed .led-pdf-line')).toHaveCount(1);
  await exec(page, 'pdfTool', null);
  await expect.poll(async () => (await context(page)).state.tool).toBeNull();
  // Со страницы «назад» — выделение снято совсем.
  await exec(page, 'deselect');
  await expect.poll(() => context(page)).toEqual({ kind: null, state: null });
  await expect(page.locator('#phone-ed .led-pdfpage.sel')).toHaveCount(0);
});

test('панель над выделением с нативной панелью не появляется', async ({ page }) => {
  await phoneEditor(page);
  await page.locator('#phone-ed .led-pm').click();
  await page.keyboard.type('выделим слово');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  expect(await page.evaluate(() => __ped.view.state.selection.empty)).toBe(false);
  await page.waitForTimeout(100);
  await expect(page.locator('.led-bubble:visible')).toHaveCount(0);
});

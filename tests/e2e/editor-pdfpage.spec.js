// Страница PDF со слоями и «Сохранить как PDF»; картинки на телефоне —
// «Выше», «Ниже» (с 18 октября 2026 — exec blockUp и blockDown контекстной
// панели: островов с нативной панелью нет) и перенос за ручку. Запуск: npm run test:e2e
//
// Откуда взялось (17 октября 2026). Решение пользователя по PDF в редакторе:
// «слои + „заменить текст“, две волны»; волна 1 — слои поверх страницы
// (узел pdfpage, src/editor/pdfpage.js) и выгрузка в PDF (pdf-lib,
// src/editor/pdfwrite.js). Заодно жалоба: «двигать картинки в редакторе на
// телефоне очень неудобно» — у картинки на телефоне кнопки «Выше» и «Ниже» и
// ручка с долгим нажатием (src/editor/blockdrag.js). Чистая геометрия и сам
// файл — юнитом tests/unit/editor-pdfpage.test.js; здесь — настоящий браузер:
// мышь, клавиатура, палец (касания через CDP, как у настоящего экрана:
// короткое касание с движением прокручивает, долгое — двигает) и скачанный
// файл, который читают pdf-lib и pdf.js.
const path = require('node:path');
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { tool } = require('./led-toolbar');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'sample-2p.pdf');

async function openTask(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  return page.evaluate(() => {
    const now = new Date().toISOString();
    const pid = uid();
    state.projects.push({ id: pid, name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
    seedProjectStatuses(pid);
    const id = uid();
    state.tasks.push({
      id, projectId: pid, title: 'Договор', done: false, notes: null,
      totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
      statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    openProject(pid);
    selectTask(id);
    return id;
  });
}

const pm = (page) => page.locator('#editor-wrap .led-pm');
const pdfInput = (page) => page.locator('#editor-wrap input.led-pdf-input');
const sheet = (page, i = 0) => pm(page).locator('.led-pdf-sheet').nth(i);
const bar = (page, i = 0) => pm(page).locator('.led-pdfpage').nth(i).locator('.led-pdfbar');

/** Слои первой страницы — из документа редактора. */
const layers = (page, ed = 'editor', i = 0) => page.evaluate(([name, n]) => {
  const out = [];
  // editor — переменная app.js (let), а не свойство окна.
  // eslint-disable-next-line no-undef
  const target = name === 'editor' ? editor : window[name];
  target.view.state.doc.forEach((node) => { if (node.type.name === 'pdfpage') out.push(node.attrs.overlays); });
  return out[n] || [];
}, [ed, i]);

/** px на pt у листа страницы. */
const scaleOf = (page, i = 0) => sheet(page, i).evaluate((el) => el.getBoundingClientRect().width / 595);

async function importPages(page) {
  const id = await openTask(page);
  await pdfInput(page).setInputFiles(FIXTURE);
  await page.locator('#ledmodal-backdrop .led-pdf-modal').getByRole('button', { name: 'Страницы', exact: true }).click();
  await expect(pm(page).locator('.led-pdfpage')).toHaveCount(2);
  await expect.poll(() => pm(page).locator('img.led-pdf-preview').evaluateAll((els) => els.every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
  return id;
}

/** PNG одним цветом: слой-картинка и картинка в тексте. */
const PNG = (w, h, color) => `(() => new Promise((r) => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const x = c.getContext('2d'); x.fillStyle = '${color}'; x.fillRect(0, 0, ${w}, ${h}); c.toBlob(r, 'image/png'); }))()`;

/** Центр элемента на экране. */
async function center(loc) {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('импорт: каждая страница — узел pdfpage с размером в pt, исходный PDF — в хранилище картинок', async ({ page }) => {
  const id = await importPages(page);
  const doc = await page.evaluate((taskId) => { editor.flush(); return state.tasks.find((t) => t.id === taskId).notes.lancible.doc; }, id);
  const nodes = doc.content.filter((n) => n.type === 'pdfpage');
  expect(nodes.map((n) => [n.attrs.page, n.attrs.w, n.attrs.h, n.attrs.overlays.length])).toEqual([[1, 595, 842, 0], [2, 595, 842, 0]]);
  // Строки страницы — для «Заменить текст» (волна 2).
  expect(nodes.map((n) => n.attrs.lines.map((l) => l.text)[0])).toEqual(['Lancible PDF test', 'Page two heading']);
  expect(doc.content.filter((n) => n.type === 'image'), 'страницы — не картинки').toHaveLength(0);
  // Исходник — один на обе страницы, лежит на устройстве как application/pdf.
  expect(nodes[0].attrs.src).toBe(nodes[1].attrs.src);
  expect(await page.evaluate(async (src) => { const b = await editor.assets.blob(src); return [b.type, b.size]; }, nodes[0].attrs.src))
    .toEqual(['application/pdf', fs.statSync(FIXTURE).size]);
  // Лист — пропорцией страницы во всю ширину полосы.
  const box = await sheet(page).evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, pm: el.closest('.led-pm').clientWidth }; });
  expect(Math.abs(box.h - (box.w * 842) / 595)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.w - box.pm)).toBeLessThanOrEqual(1);
  // Остров — только у выделенной страницы.
  await expect(bar(page)).toBeHidden();
  await sheet(page).click({ position: { x: 20, y: 20 } });
  await expect(bar(page)).toBeVisible();
  await expect(bar(page, 1)).toBeHidden();
});

test('текстовый слой мышью: набрать, сдвинуть, растянуть, удалить; отмена возвращает', async ({ page }) => {
  await importPages(page);
  await sheet(page).click({ position: { x: 20, y: 20 } });
  await bar(page).locator('[data-pdf="text"]').click();
  const el = pm(page).locator('.led-pdf-text').first();
  await expect(el).toHaveAttribute('contenteditable', /plaintext-only|true/);
  await page.keyboard.type('Подпись: Иванов');
  await page.keyboard.press('Escape');
  await expect(el).not.toHaveAttribute('contenteditable', /.+/);
  let [o] = await layers(page);
  expect(o).toMatchObject({ type: 'text', text: 'Подпись: Иванов', font: { size: 14, weight: 'normal', color: 'ink' } });

  // Двигать мышью: позиция в attrs сдвигается на столько же pt.
  const s = await scaleOf(page);
  const c = await center(el);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 60, c.y + 30, { steps: 6 });
  await page.mouse.up();
  const [moved] = await layers(page);
  expect(Math.abs(moved.x - (o.x + 60 / s))).toBeLessThanOrEqual(0.6);
  expect(Math.abs(moved.y - (o.y + 30 / s))).toBeLessThanOrEqual(0.6);
  o = moved;

  // Растянуть за правую ручку — шире на столько же pt; у текста только боковые ручки.
  await expect(pm(page).locator('.led-pdfpage').first().locator('.led-pdf-h-e')).toBeVisible();
  await expect(pm(page).locator('.led-pdfpage').first().locator('.led-pdf-h-s')).toBeHidden();
  const hc = await center(pm(page).locator('.led-pdfpage').first().locator('.led-pdf-h-e'));
  await page.mouse.move(hc.x, hc.y);
  await page.mouse.down();
  await page.mouse.move(hc.x + 40, hc.y, { steps: 4 });
  await page.mouse.up();
  const [wide] = await layers(page);
  expect(Math.abs(wide.w - (o.w + 40 / s))).toBeLessThanOrEqual(0.6);
  expect(wide.x).toBe(o.x);

  // Стрелки клавиатуры: 1 pt, с Shift — 10.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const [nudged] = await layers(page);
  expect([nudged.x, nudged.y]).toEqual([Math.round((wide.x + 1) * 10) / 10, Math.round((wide.y + 10) * 10) / 10]);

  // Delete — удалить слой; Ctrl+Z — вернуть.
  await page.keyboard.press('Delete');
  expect(await layers(page)).toEqual([]);
  await expect(pm(page).locator('.led-pdf-text')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect((await layers(page)).map((l) => l.text)).toEqual(['Подпись: Иванов']);
  // Esc снимает выделение слоя, страница остаётся выделенной.
  await pm(page).locator('.led-pdf-text').click();
  await expect(pm(page).locator('.led-pdfpage').first().locator('.led-pdf-sel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pm(page).locator('.led-pdfpage').first().locator('.led-pdf-sel')).toBeHidden();
  await expect(bar(page)).toBeVisible();
});

test('картинка, прямоугольник, стрелка, маркер и замазка; цвет, толщина и порядок наложения', async ({ page }) => {
  await importPages(page);
  await sheet(page).click({ position: { x: 20, y: 20 } });
  // Картинка — тем же выбором файла, что картинка в тексте.
  const png = await page.evaluate(async (code) => { const b = await eval(code); return [...new Uint8Array(await b.arrayBuffer())]; }, PNG(40, 20, '#3366cc'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), bar(page).locator('[data-pdf="image"]').click()]);
  await chooser.setFiles({ name: 'stamp.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(pm(page).locator('.led-pdf-image img')).toHaveCount(1);
  await expect.poll(() => pm(page).locator('.led-pdf-image img').evaluate((i) => i.complete && i.naturalWidth)).toBe(40);
  let list = await layers(page);
  expect(list[0]).toMatchObject({ type: 'image' });
  expect(list[0].src).toMatch(/^asset:/);
  expect(Math.abs(list[0].h - list[0].w / 2), 'по пропорции картинки').toBeLessThanOrEqual(0.2);

  for (const t of ['rect', 'arrow', 'highlight', 'whiteout']) await bar(page).locator(`[data-pdf="${t}"]`).click();
  list = await layers(page);
  expect(list.map((l) => l.type)).toEqual(['image', 'rect', 'arrow', 'highlight', 'whiteout']);
  // Замазка — цвет бумаги (белая и в тёмной теме), маркер — цветом маркера
  // в тексте (--led-hl-yellow) наложением «умножение».
  const look = await pm(page).evaluate((root) => {
    const probe = document.createElement('mark');
    probe.className = 'led-hl-yellow';
    document.body.append(probe);
    const marker = getComputedStyle(root.querySelector('.led-pdf-highlight'));
    const out = {
      whiteout: getComputedStyle(root.querySelector('.led-pdf-whiteout')).backgroundColor,
      paper: getComputedStyle(root).getPropertyValue('--led-paper').trim(),
      marker: marker.backgroundColor === getComputedStyle(probe).backgroundColor,
      blend: marker.mixBlendMode,
    };
    probe.remove();
    return out;
  });
  expect(look).toEqual({ whiteout: 'rgb(255, 255, 255)', paper: '#ffffff', marker: true, blend: 'multiply' });

  // Выделенный слой — замазка: на передний план и назад.
  await page.keyboard.press('Escape');
  await pm(page).locator('.led-pdf-whiteout').click();
  await bar(page).locator('[data-pdf="back"]').click();
  expect((await layers(page)).map((l) => l.type)).toEqual(['whiteout', 'image', 'rect', 'arrow', 'highlight']);
  await bar(page).locator('[data-pdf="front"]').click();
  expect((await layers(page)).map((l) => l.type)).toEqual(['image', 'rect', 'arrow', 'highlight', 'whiteout']);
  await expect(bar(page).locator('[data-pdf="color"]'), 'у замазки цвета нет').toBeHidden();

  // Прямоугольник: цвет из палитры и толщина.
  await pm(page).locator('.led-pdf-rect').click({ position: { x: 2, y: 2 } });
  await expect(bar(page).locator('[data-pdf="width"]')).toBeVisible();
  await bar(page).locator('[data-pdf="color"]').click();
  await page.locator('.led-pop .led-swatch[data-color="green"]').click();
  await bar(page).locator('[data-pdf="width"]').click();
  await page.locator('.led-pop .ctx-item', { hasText: '8 pt' }).click();
  const rect = (await layers(page)).find((l) => l.type === 'rect');
  expect(rect.stroke).toEqual({ color: 'green', width: 8 });
  // Стрелка — две ручки на концах вместо восьми; конец тянется за свою.
  await sheet(page, 1).click({ position: { x: 20, y: 20 } });
  await bar(page, 1).locator('[data-pdf="arrow"]').click();
  const sel = pm(page).locator('.led-pdfpage').nth(1).locator('.led-pdf-sel');
  await expect(sel.locator('.led-pdf-h-a')).toBeVisible();
  await expect(sel.locator('.led-pdf-h-b')).toBeVisible();
  await expect(sel.locator('.led-pdf-h-se')).toBeHidden();
  const [arrow0] = await layers(page, 'editor', 1);
  const s = await scaleOf(page, 1);
  const b = await center(sel.locator('.led-pdf-h-b'));
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y + 50, { steps: 5 });
  await page.mouse.up();
  const [arrow1] = await layers(page, 'editor', 1);
  expect([arrow1.x, arrow1.y, arrow1.w]).toEqual([arrow0.x, arrow0.y, arrow0.w]);
  expect(Math.abs(arrow1.h - 50 / s)).toBeLessThanOrEqual(0.6);
});

test('«Сохранить как PDF»: файл скачан, две страницы, текст слоя в содержимом; печать не сломана', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await importPages(page);
  await sheet(page).click({ position: { x: 20, y: 20 } });
  await bar(page).locator('[data-pdf="text"]').click();
  await page.keyboard.type('Согласовано 17.10');
  await page.keyboard.press('Escape');
  await bar(page).locator('[data-pdf="whiteout"]').click();

  const [download] = await Promise.all([page.waitForEvent('download'), tool(page, 'exportPdf')]);
  expect(download.suggestedFilename()).toBe('Договор.pdf');
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount(), 'две страницы PDF; пустой абзац под ними — без листа').toBe(2);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWasm: false, verbosity: 0 });
  const read = await task.promise;
  const text = async (n) => (await (await read.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');
  expect(await text(1)).toContain('Согласовано 17.10');
  expect(await text(1), 'страница — копия исходника, со своим текстом').toContain('Lancible PDF test');
  expect(await text(2)).toContain('Page two heading');
  await task.destroy();

  // Печать: страницы — картинками со слоями, по одной на лист A4.
  const html = await page.evaluate(() => editor.exportHtml());
  expect((html.match(/<figure class="led-pdfpage"><img src="data:image\/png/g) || []).length).toBe(2);
  const sheetPage = await page.context().newPage();
  await sheetPage.setContent(html);
  await sheetPage.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const printed = await sheetPage.pdf({ format: 'A4', margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  await sheetPage.close();
  expect((await PDFDocument.load(printed)).getPageCount(), 'по странице PDF на лист').toBe(2);
  expect(errors).toEqual([]);
});

test('исходного PDF на устройстве нет — выгрузка из превью и предупреждение', async ({ page }) => {
  await importPages(page);
  // Как на другом устройстве: в хранилище нет исходника, а облако PDF не дало.
  await page.evaluate(() => {
    const blob = editor.assets.blob.bind(editor.assets);
    editor.assets.blob = async (src) => { const b = await blob(src); return b && b.type === 'application/pdf' ? null : b; };
  });
  const [download] = await Promise.all([page.waitForEvent('download'), tool(page, 'exportPdf')]);
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(await download.path()));
  expect(doc.getPageCount()).toBe(2);
  await expect(page.locator('#toast')).toContainText('страниц картинками: 2');
});

// 19 октября 2026: импорт привязан к документу. Пришла правка этой заметки
// с другого устройства (setContent) или редактор закрыт посреди импорта —
// оставшиеся страницы никуда не встают, окна закрываются, а то, что легло в
// хранилище и в документ не встало, выбрасывается.
test('импорт PDF прерван сменой документа: страницы не уходят в новый документ, сирот в хранилище нет', async ({ page }) => {
  await openTask(page);
  // Документ сменится, пока превью страницы n ложится в хранилище.
  const arm = (n, how) => page.evaluate(([at, kind]) => {
    window.__puts = [];
    const store = editor.assets;
    if (!store.__realPut) store.__realPut = store.put;
    store.put = async (f) => {
      const src = await store.__realPut.call(store, f);
      window.__puts.push({ name: f.name, type: f.type, src });
      if (f.name.endsWith(`-${at}.png`)) {
        if (kind === 'content') editor.setContent({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'с другого устройства' }] }] }, comments: [], ink: [] });
      }
      return src;
    };
  }, [n, how]);
  const pdfpages = () => page.evaluate(() => { let n = 0; editor.view.state.doc.descendants((x) => { if (x.type.name === 'pdfpage') n += 1; }); return n; });
  const stored = () => page.evaluate(async () => Promise.all(window.__puts.map(async (p) => ({ name: p.name, kept: !!(await editor.assets.blob(p.src)) }))));
  const modalOpen = () => page.locator('#ledmodal-backdrop .led-pdf-modal').count();

  // Сменился на второй странице: первая осталась в прежнем документе (он уже
  // ушёл — в новом её нет), второй нет нигде; исходник нужен первой — остаётся.
  await arm(2, 'content');
  await pdfInput(page).setInputFiles(FIXTURE);
  await page.locator('#ledmodal-backdrop .led-pdf-modal').getByRole('button', { name: 'Страницы', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Документ сменился');
  await expect.poll(modalOpen).toBe(0);
  await page.waitForTimeout(300);
  expect(await pdfpages(), 'в новый документ страницы не встали').toBe(0);
  expect(await page.evaluate(() => editor.view.state.doc.textContent)).toBe('с другого устройства');
  await expect.poll(stored).toEqual([
    { name: 'sample-2p.pdf', kept: true },
    { name: 'sample-2p-1.png', kept: true },
    { name: 'sample-2p-2.png', kept: false },
  ]);

  // Сменился на первой: не встало ничего — ни исходника, ни превью в хранилище.
  await arm(1, 'content');
  await pdfInput(page).setInputFiles(FIXTURE);
  await page.locator('#ledmodal-backdrop .led-pdf-modal').getByRole('button', { name: 'Страницы', exact: true }).click();
  await expect.poll(modalOpen).toBe(0);
  await page.waitForTimeout(300);
  expect(await pdfpages()).toBe(0);
  await expect.poll(stored).toEqual([
    { name: 'sample-2p.pdf', kept: false },
    { name: 'sample-2p-1.png', kept: false },
  ]);

  // Сменился, пока открыто окно выбора: окно закрылось, вставлять нечего.
  await arm(99, 'none');
  await pdfInput(page).setInputFiles(FIXTURE);
  await expect(page.locator('#ledmodal-backdrop .led-pdf-modal')).toContainText('sample-2p.pdf');
  await page.evaluate(() => editor.setContent(null));
  await expect.poll(modalOpen).toBe(0);
  expect(await pdfpages()).toBe(0);
  expect(await page.evaluate(() => window.__puts.length), 'в хранилище ничего не легло').toBe(0);
});

// 19 октября 2026: слой-картинка по чужому адресу без CORS «пачкала» холст —
// toBlob бросал SecurityError, и печать с «Скачать HTML» молча не работали.
// Чужой адрес — свой маленький сервер на 127.0.0.1 (страница — на localhost):
// route.fulfill Playwright сам дописывает CORS и случай не воспроизводит. У
// сервера адрес http, а CSP веба пускает картинки только с https, — поэтому
// здесь CSP обходится (у адресов https всё то же самое).
test.describe('слой-картинка по чужому адресу', () => {
  test.use({ bypassCSP: true });

  test('печать и «Скачать HTML»: с CORS — слой нарисован, без CORS — пропущен с тостом, без ошибки', async ({ page }) => {
    const png = await (async () => {
      const p = await page.context().newPage();
      const b64 = await p.evaluate(async (code) => { const blob = await eval(code); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s); }, PNG(40, 40, '#ff0000'));
      await p.close();
      return Buffer.from(b64, 'base64');
    })();
    const http = require('node:http');
    const srv = http.createServer((req, res) => {
      res.writeHead(200, Object.assign({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }, req.url.includes('cors') ? { 'Access-Control-Allow-Origin': '*' } : {}));
      res.end(png);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      await openTask(page);
      await page.evaluate(async ([code, at]) => {
        const preview = await editor.assets.put(new File([await eval(code)], 'p.png', { type: 'image/png' }));
        const ov = (id, src, x) => ({ id, type: 'image', x, y: 100, w: 100, h: 100, src });
        editor.setContent({ v: 1, doc: { type: 'doc', content: [
          { type: 'pdfpage', attrs: { src: '', page: 1, w: 595, h: 842, preview, overlays: [ov('a', `${at}/cors.png`, 50), ov('b', `${at}/plain.png`, 300)] } },
        ] }, comments: [], ink: [] });
      }, [PNG(595, 842, '#fafafa'), base]);
      await expect(pm(page).locator('.led-pdfpage')).toHaveCount(1);
      await expect.poll(() => pm(page).locator('.led-pdf-image img').evaluateAll((els) => els.every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const html = await page.evaluate(() => editor.exportHtml());
      await expect(page.locator('#toast')).toContainText('не нарисовано: 1');
      const m = /<figure class="led-pdfpage"><img src="(data:image\/png[^"]+)"/.exec(html);
      expect(m, 'страница — картинкой').toBeTruthy();
      // Пиксель в середине каждого слоя (pt → px картинки страницы).
      const px = await page.evaluate(async (src) => {
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = src; });
        const k = img.naturalWidth / 595;
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const at = (pt) => Array.from(x.getImageData(Math.round(pt * k), Math.round(150 * k), 1, 1).data.slice(0, 3));
        return { cors: at(100), plain: at(350) };
      }, m[1]);
      expect(px.cors, 'с CORS — красный слой').toEqual([255, 0, 0]);
      expect(px.plain, 'без CORS — страница под ним').toEqual([250, 250, 250]);
      // «Скачать HTML» и печать не падают.
      const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => editor.exportAs('html'))]);
      expect(download.suggestedFilename()).toMatch(/\.html$/);
      expect(await page.evaluate(() => editor.print())).not.toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});

test('«Скачать HTML» не собрался — тост, а не молчание', async ({ page }) => {
  await openTask(page);
  await page.evaluate(() => { editor.exportHtml = async () => { throw new Error('сбой'); }; });
  expect(await page.evaluate(() => editor.exportAs('html'))).toBe(false);
  await expect(page.locator('#toast')).toContainText('Не удалось собрать HTML');
  expect(await page.evaluate(() => editor.print())).toBe(false);
});

test('скачать картинку: адрес blob: освобождается после скачивания', async ({ page }) => {
  await openTask(page);
  await page.evaluate(async (code) => {
    window.__made = [];
    window.__revoked = [];
    const make = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = make(b); window.__made.push(u); return u; };
    URL.revokeObjectURL = (u) => { window.__revoked.push(u); revoke(u); };
    const src = await editor.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
    editor.setContent({ v: 1, doc: { type: 'doc', content: [{ type: 'image', attrs: { src, alt: 'фото' } }, { type: 'paragraph' }] }, comments: [], ink: [] });
  }, PNG(60, 40, '#33aa77'));
  const fig = pm(page).locator('.led-figure');
  await expect.poll(() => fig.locator('img').evaluate((i) => i.complete && i.naturalWidth)).toBe(60);
  // Выделить картинку (у маленькой щелчок по ней попадает в её остров).
  await page.evaluate(() => editor.view.dispatch(editor.view.state.tr.setSelection(LancibleEditor.NodeSelection.create(editor.view.state.doc, 0))));
  await expect(fig).toHaveClass(/\bsel\b/);
  await page.evaluate(() => { window.__made = []; });
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => editor.exec('imageDownload'))]);
  expect(download.suggestedFilename()).toMatch(/^фото/);
  const made = await page.evaluate(() => window.__made.slice());
  expect(made.length, 'свой адрес для скачивания').toBe(1);
  await expect.poll(() => page.evaluate((u) => window.__revoked.includes(u), made[0]), { timeout: 5000 }).toBe(true);
});

test('десктоп: картинку по-прежнему тащат мышью (перенос ProseMirror), правая кнопка — меню редактора', async ({ page }) => {
  await openTask(page);
  await page.evaluate(async (code) => {
    const src = await editor.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
    const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    editor.setContent({ v: 1, doc: { type: 'doc', content: [p('один'), { type: 'image', attrs: { src } }, p('два'), p('три')] }, comments: [], ink: [] });
  }, PNG(200, 100, '#5533aa'));
  const fig = pm(page).locator('.led-figure');
  await expect.poll(() => fig.locator('img').evaluate((i) => i.complete && i.naturalWidth)).toBe(200);
  expect(await fig.evaluate((f) => f.draggable), 'на десктопе блок тащится мышью').toBe(true);
  expect(await fig.evaluate((f) => getComputedStyle(f).webkitUserDrag)).not.toBe('none');
  const order = () => page.evaluate(() => { const out = []; editor.view.state.doc.forEach((n) => out.push(n.type.name === 'image' ? 'IMG' : n.textContent)); return out; });
  await fig.locator('img').dragTo(pm(page).locator('p', { hasText: 'три' }), { targetPosition: { x: 30, y: 12 } });
  await expect.poll(order).not.toEqual(['один', 'IMG', 'два', 'три']);
  expect((await order()).indexOf('IMG'), 'картинка уехала ниже').toBeGreaterThan(1);
  // Правая кнопка по тексту — меню редактора, системное не нужно.
  await pm(page).locator('p', { hasText: 'один' }).click({ button: 'right' });
  await expect(page.locator('.led-pop.led-ctx')).toBeVisible();
});

// --- «Заменить текст» (волна 2) --------------------------------------------------------

test('«Заменить текст»: строки при импорте, подсветка под мышью, замазка и текст на той же базе — и в выгрузке', async ({ page }) => {
  await importPages(page);
  // Строки страницы — в узле, в pt видимой страницы.
  const lines = await page.evaluate(() => { const out = []; editor.view.state.doc.forEach((n) => { if (n.type.name === 'pdfpage') out.push(n.attrs.lines); }); return out; });
  expect(lines[0].map((l) => l.text)).toEqual(expect.arrayContaining(['Lancible PDF test', 'Second paragraph after a gap.']));
  const target = lines[0].find((l) => l.text === 'Second paragraph after a gap.');
  expect(target.size).toBe(12);

  await sheet(page).click({ position: { x: 20, y: 20 } });
  await bar(page).locator('[data-pdf="replace"]').click();
  await expect(pm(page).locator('.led-pdfpage').first().locator('.led-pdf-line')).toHaveCount(lines[0].length);
  // Наведение подсвечивает строку под мышью.
  const s = await scaleOf(page);
  const r = await sheet(page).boundingBox();
  const at = { x: r.x + (target.x + 10) * s, y: r.y + (target.y + target.h / 2) * s };
  await page.mouse.move(at.x, at.y);
  await expect(pm(page).locator('.led-pdf-line.on')).toHaveCount(1);
  await page.mouse.click(at.x, at.y);
  const list = await layers(page);
  expect(list.map((l) => l.type)).toEqual(['whiteout', 'text']);
  const [white, text] = list;
  expect([white.x, white.y, white.w, white.h]).toEqual([target.x - 1, target.y - 1, target.w + 2, Math.round((target.h + 2) * 10) / 10]);
  expect(text).toMatchObject({ text: 'Second paragraph after a gap.', font: { size: 12, weight: 'normal', color: 'ink' } });
  // Сразу правка: набранное заменяет текст строки.
  const el = pm(page).locator('.led-pdf-text').first();
  await expect(el).toHaveAttribute('contenteditable', /plaintext-only|true/);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Новый абзац после правки');
  await page.keyboard.press('Escape');
  expect((await layers(page))[1].text).toBe('Новый абзац после правки');

  const [download] = await Promise.all([page.waitForEvent('download'), tool(page, 'exportPdf')]);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(await download.path())), useWasm: false, verbosity: 0 });
  const doc = await task.promise;
  const words = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
  await task.destroy();
  expect(words, 'новый текст — в файле').toContain('Новый абзац после правки');
});

test('страница без строк (вставлена до волны 2): кнопка распознаёт их из исходника; исходника нет — подсказка', async ({ page }) => {
  await importPages(page);
  const forget = () => page.evaluate(() => {
    let pos = null;
    editor.view.state.doc.forEach((n, p) => { if (pos == null && n.type.name === 'pdfpage') pos = p; });
    editor.view.dispatch(editor.view.state.tr.setNodeAttribute(pos, 'lines', null));
  });
  await forget();
  await sheet(page).click({ position: { x: 20, y: 20 } });
  await expect(bar(page).locator('[data-pdf="replace"]')).toHaveAttribute('title', 'Распознать строки и заменить текст');
  await bar(page).locator('[data-pdf="replace"]').click();
  await expect(pm(page).locator('.led-pdfpage').first().locator('.led-pdf-line').first()).toBeVisible();
  expect(await page.evaluate(() => editor.view.state.doc.firstChild.attrs.lines.length)).toBeGreaterThan(3);
  await page.keyboard.press('Escape');
  await expect(pm(page).locator('.led-pdf-line')).toHaveCount(0);

  // Исходника на устройстве нет — строки не распознать, режим не включается.
  await forget();
  await page.evaluate(() => {
    const blob = editor.assets.blob.bind(editor.assets);
    editor.assets.blob = async (src) => { const b = await blob(src); return b && b.type === 'application/pdf' ? null : b; };
  });
  await sheet(page).click({ position: { x: 20, y: 20 } });
  await bar(page).locator('[data-pdf="replace"]').click();
  await expect(page.locator('#toast')).toContainText('строки не распознать');
  await expect(pm(page).locator('.led-pdf-line')).toHaveCount(0);
});

// --- перо в выгрузке -----------------------------------------------------------------------

test('перо поверх документа — в «Сохранить как PDF»: на странице PDF и на листе A4 своего абзаца', async ({ page }) => {
  await openTask(page);
  await pm(page).click();
  await page.keyboard.type('Вступление перед договором');
  await page.keyboard.press('Enter');
  await pdfInput(page).setInputFiles(FIXTURE);
  await page.locator('#ledmodal-backdrop .led-pdf-modal').getByRole('button', { name: 'Страницы', exact: true }).click();
  await expect(pm(page).locator('.led-pdfpage')).toHaveCount(2);
  await expect.poll(() => pm(page).locator('img.led-pdf-preview').evaluateAll((els) => els.every((i) => i.complete && i.naturalWidth > 0))).toBe(true);

  // Наверх: после вставки текст прокручен к курсору под страницами.
  await page.evaluate(() => { document.querySelector('#editor-wrap .led-scroll').scrollTop = 0; });
  await page.evaluate(() => editor.exec('annotate', true));
  const draw = async (x, y) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 12, y + (i % 2) * 4);
    await page.mouse.up();
  };
  const para = await pm(page).locator('p', { hasText: 'Вступление' }).boundingBox();
  await draw(para.x + 10, para.y + para.height - 2);
  const sh = await sheet(page).boundingBox();
  await draw(sh.x + 60, sh.y + 40);
  await page.evaluate(() => editor.exec('annotate', false));
  expect(await page.evaluate(() => editor.getContent().ink.length)).toBe(2);

  const [download] = await Promise.all([page.waitForEvent('download'), tool(page, 'exportPdf')]);
  const bytes = fs.readFileSync(await download.path());
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const count = async (data, n) => {
    const task = pdfjs.getDocument({ data: new Uint8Array(data), useWasm: false, verbosity: 0 });
    const doc = await task.promise;
    const ops = (await (await doc.getPage(n)).getOperatorList()).fnArray;
    const pages = doc.numPages;
    await task.destroy();
    return { paths: ops.filter((f) => f === pdfjs.OPS.constructPath).length, pages };
  };
  const a4 = await count(bytes, 1);
  expect(a4.pages, 'лист A4 с абзацем и две страницы PDF').toBe(3);
  expect(a4.paths, 'штрих над абзацем — на его листе A4').toBeGreaterThan(0);
  const orig = await count(fs.readFileSync(FIXTURE), 1);
  expect((await count(bytes, 2)).paths, 'штрих на странице PDF — поверх неё').toBe(orig.paths + 1);
});

// --- палец ------------------------------------------------------------------------------

/** Редактор телефона (nativeToolbar) с документом content. */
async function phoneEditor(page, content) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate((c) => {
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:640px;z-index:500;display:flex;flex-direction:column;background:var(--bg)';
    document.body.append(box);
    window.__msgs = [];
    window.__ped = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, content: c, post: (m) => window.__msgs.push(JSON.parse(JSON.stringify(m))) });
  }, content || null);
}

/** Касание настоящим экраном (CDP): удержать hold мс, повести на dx, dy. */
async function touchDrag(page, from, dx, dy, hold) {
  const cdp = await page.context().newCDPSession(page);
  const at = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) });
  if (hold) await page.waitForTimeout(hold);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.x + (dx * i) / steps, from.y + (dy * i) / steps) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(50);
  await cdp.detach();
}

test.describe('телефон: палец', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 740 } });

  test('слой страницы: короткое касание с движением — прокрутка, долгое (350 мс) — двигает; ручки 28 px', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      const preview = await __ped.assets.put(new File([await eval(code)], 'p.png', { type: 'image/png' }));
      const rect = { id: 'r1', type: 'rect', x: 100, y: 100, w: 200, h: 120, stroke: { color: 'red', width: 2 } };
      const page = (n, overlays) => ({ type: 'pdfpage', attrs: { src: '', page: n, w: 595, h: 842, preview, overlays } });
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [page(1, [rect]), page(2, []), { type: 'paragraph' }] }, comments: [], ink: [] });
    }, PNG(595, 842, '#fafafa'));
    const sh = page.locator('#phone-ed .led-pdf-sheet').first();
    await expect(sh).toBeVisible();
    const scroller = page.locator('#phone-ed .led-scroll');
    const ov = page.locator('#phone-ed .led-pdf-rect');
    const start = (await layers(page, '__ped'))[0];

    // Короткое касание и сразу вести — это прокрутка: слой стоит.
    const top0 = await scroller.evaluate((el) => el.scrollTop);
    await touchDrag(page, await center(ov), 0, -120, 0);
    expect((await layers(page, '__ped'))[0], 'слой не сдвинулся').toEqual(start);
    expect(await scroller.evaluate((el) => el.scrollTop), 'страница прокрутилась').toBeGreaterThan(top0);

    // Касание — выделить: рамка и ручки под палец.
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.touchscreen.tap(...Object.values(await center(ov)));
    await expect(page.locator('#phone-ed .led-pdf-sel').first()).toBeVisible();
    const hs = await page.locator('#phone-ed .led-pdf-h-se').first().evaluate((el) => el.getBoundingClientRect().width);
    expect(hs).toBe(28);

    // Долгое нажатие и вести — слой едет за пальцем.
    const scale = await page.locator('#phone-ed .led-pdf-sheet').first().evaluate((el) => el.getBoundingClientRect().width / 595);
    const top1 = await scroller.evaluate((el) => el.scrollTop);
    await touchDrag(page, await center(ov), 50, 40, 450);
    const moved = (await layers(page, '__ped'))[0];
    expect(Math.abs(moved.x - (start.x + 50 / scale)), `x: ${moved.x}`).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - (start.y + 40 / scale)), `y: ${moved.y}`).toBeLessThanOrEqual(1);
    expect(await scroller.evaluate((el) => el.scrollTop), 'пока двигали — не прокручивали').toBe(top1);
  });

  test('картинка: «Выше» и «Ниже» из панели (blockUp, blockDown), перенос за ручку долгим нажатием — одной отменой назад', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      const src = await __ped.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
      const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [p('один'), { type: 'image', attrs: { src, alt: 'фото' } }, p('два'), p('три')] }, comments: [], ink: [] });
    }, PNG(300, 150, '#cc5533'));
    const order = () => page.evaluate(() => { const out = []; __ped.view.state.doc.forEach((n) => out.push(n.type.name === 'image' ? 'IMG' : n.textContent)); return out; });
    const fig = page.locator('#phone-ed .led-figure');
    await expect.poll(() => fig.locator('.led-img-frame img').evaluate((i) => i.complete && i.naturalWidth)).toBe(300);
    await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
    await expect(fig).toHaveClass(/\bsel\b/);
    // С нативной панелью острова нет: «Выше» и «Ниже» — кнопки панели хозяина.
    await expect(fig.locator('.led-node-bar')).toHaveCount(0);

    await page.evaluate(() => __ped.exec('blockUp'));
    expect(await order()).toEqual(['IMG', 'один', 'два', 'три']);
    await expect(fig, 'после переноса картинка выделена — панель на месте').toHaveClass(/\bsel\b/);
    await page.evaluate(() => { __ped.exec('blockDown'); __ped.exec('blockDown'); });
    expect(await order()).toEqual(['один', 'два', 'IMG', 'три']);

    // Ручка: короткое касание с движением — не переносит.
    const grip = fig.locator('.led-img-grip');
    await expect(grip).toBeVisible();
    await touchDrag(page, await center(grip), 0, -200, 0);
    expect(await order()).toEqual(['один', 'два', 'IMG', 'три']);

    // Долгое нажатие и вести вниз, под «три» — картинка встаёт в конец.
    await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
    const three = await page.locator('#phone-ed .led-pm > p', { hasText: 'три' }).boundingBox();
    const g = await center(grip);
    await touchDrag(page, g, 0, three.y + three.height + 12 - g.y, 450);
    expect(await order()).toEqual(['один', 'два', 'три', 'IMG']);
    await expect(page.locator('.led-drag-ghost')).toHaveCount(0);
    await expect(page.locator('#phone-ed .led-dropline')).toHaveCount(0);
    // Одна отмена — картинка там, где была до переноса.
    await page.evaluate(() => __ped.exec('undo'));
    expect(await order()).toEqual(['один', 'два', 'IMG', 'три']);
  });

  test('жест хозяину: долгое нажатие на ручке — gesture on, отпустили или отмена — off; короткое касание — ничего', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      const src = await __ped.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
      const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [p('один'), { type: 'image', attrs: { src } }, p('два')] }, comments: [], ink: [] });
    }, PNG(300, 150, '#33aa77'));
    const fig = page.locator('#phone-ed .led-figure');
    await expect.poll(() => fig.locator('.led-img-frame img').evaluate((i) => i.complete && i.naturalWidth)).toBe(300);
    await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
    const grip = fig.locator('.led-img-grip');
    await expect(grip).toBeVisible();
    const gestures = () => page.evaluate(() => window.__msgs.filter((m) => m.type === 'gesture').map((m) => m.on));
    const clear = () => page.evaluate(() => { window.__msgs = []; });
    const cdp = await page.context().newCDPSession(page);
    const g = await center(grip);
    const pt = [{ x: Math.round(g.x), y: Math.round(g.y), id: 1 }];
    await clear();

    // Долгое нажатие: on — ещё до первого движения (его ждёт хозяин), отпустили — off.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await page.waitForTimeout(450);
    expect(await gestures(), 'долгое нажатие включило перетаскивание').toEqual([true]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(gestures).toEqual([true, false]);

    // Отмена (pointercancel: прокрутку забрал хозяин) — тоже off, и ровно один.
    await clear();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await page.waitForTimeout(450);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(gestures).toEqual([true, false]);

    // Короткое касание — ничего.
    await clear();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(450);
    expect(await gestures()).toEqual([]);

    // Смена документа посреди жеста — off приходит сам.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await page.waitForTimeout(450);
    await page.evaluate(() => __ped.setContent(null));
    expect(await gestures()).toEqual([true, false]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(50);
    expect(await gestures(), 'второго off нет').toEqual([true, false]);
    await cdp.detach();
  });

  // 19 октября 2026: pointercancel посреди переноса (палец увёл системный
  // жест или внешний ScrollView) — отмена, а не бросок: координаты у такого
  // события нулевые, и картинка падала в начало документа.
  test('перенос картинки прерван (touchcancel): блок на месте, без правки и без призрака; gesture off', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      const src = await __ped.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
      const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [p('один'), p('два'), { type: 'image', attrs: { src } }, p('три')] }, comments: [], ink: [] });
    }, PNG(300, 150, '#5533aa'));
    const order = () => page.evaluate(() => { const out = []; __ped.view.state.doc.forEach((n) => out.push(n.type.name === 'image' ? 'IMG' : n.textContent)); return out; });
    const docJson = () => page.evaluate(() => JSON.stringify(__ped.view.state.doc.toJSON()));
    const fig = page.locator('#phone-ed .led-figure');
    await expect.poll(() => fig.locator('.led-img-frame img').evaluate((i) => i.complete && i.naturalWidth)).toBe(300);
    await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
    const grip = fig.locator('.led-img-grip');
    await expect(grip).toBeVisible();
    const before = await docJson();
    await page.evaluate(() => { window.__msgs = []; });
    const g = await center(grip);
    const one = await page.locator('#phone-ed .led-pm > p', { hasText: 'один' }).boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const at = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(g.x, g.y) });
    await page.waitForTimeout(450);
    // Повели вверх, к «один»: перенос идёт, черта места видна.
    const dy = one.y + 4 - g.y;
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(g.x, g.y + (dy * i) / 8) });
      await page.waitForTimeout(16);
    }
    await expect(page.locator('.led-drag-ghost')).toHaveCount(1);
    await expect(page.locator('#phone-ed .led-dropline:not([hidden])')).toHaveCount(1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(50);
    await cdp.detach();
    expect(await order(), 'картинка на своём месте').toEqual(['один', 'два', 'IMG', 'три']);
    expect(await docJson(), 'документ не менялся').toBe(before);
    await expect(page.locator('.led-drag-ghost')).toHaveCount(0);
    await expect(page.locator('#phone-ed .led-dropline')).toHaveCount(0);
    expect(await page.evaluate(() => window.__msgs.filter((m) => m.type === 'gesture').map((m) => m.on))).toEqual([true, false]);
    // Отмены нечего отменять: правки не было.
    await page.evaluate(() => __ped.exec('undo'));
    expect(await order()).toEqual(['один', 'два', 'IMG', 'три']);
  });

  test('фон страницы PDF: долгое касание и повели — прокрутка, а не жест; удержал и отпустил — касание', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      const preview = await __ped.assets.put(new File([await eval(code)], 'p.png', { type: 'image/png' }));
      const rect = { id: 'r1', type: 'rect', x: 400, y: 700, w: 120, h: 80, stroke: { color: 'red', width: 2 } };
      const pg = (n, overlays) => ({ type: 'pdfpage', attrs: { src: '', page: n, w: 595, h: 842, preview, overlays } });
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [pg(1, [rect]), pg(2, []), { type: 'paragraph' }] }, comments: [], ink: [] });
    }, PNG(595, 842, '#fafafa'));
    const sh = page.locator('#phone-ed .led-pdf-sheet').first();
    await expect(sh).toBeVisible();
    const scroller = page.locator('#phone-ed .led-scroll');
    const box = await sh.boundingBox();
    // Фон листа — левый верхний угол, мимо слоя.
    const bg = { x: box.x + 40, y: box.y + 60 };
    await page.evaluate(() => { window.__msgs = []; });
    const top0 = await scroller.evaluate((el) => el.scrollTop);
    await touchDrag(page, bg, 0, -120, 450);
    expect(await scroller.evaluate((el) => el.scrollTop), 'после удержания палец прокручивает страницу').toBeGreaterThan(top0);
    expect(await page.evaluate(() => window.__msgs.filter((m) => m.type === 'gesture')), 'хозяину — ни одного gesture').toEqual([]);

    // Выделили слой; удержали фон без движения и отпустили — касание: слой снят.
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.touchscreen.tap(...Object.values(await center(page.locator('#phone-ed .led-pdf-rect'))));
    await expect(page.locator('#phone-ed .led-pdf-sel').first()).toBeVisible();
    const b2 = await sh.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const pt = [{ x: Math.round(b2.x + 40), y: Math.round(b2.y + 60), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await page.waitForTimeout(450);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(page.locator('#phone-ed .led-pdf-sel').first(), 'onTap по отпусканию снял слой').toBeHidden();
  });

  test('перенос слоя прерван (уход фокуса, смена документа): слой на экране — там, где в документе', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      const preview = await __ped.assets.put(new File([await eval(code)], 'p.png', { type: 'image/png' }));
      const rect = { id: 'r1', type: 'rect', x: 100, y: 100, w: 200, h: 120, stroke: { color: 'red', width: 2 } };
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [{ type: 'pdfpage', attrs: { src: '', page: 1, w: 595, h: 842, preview, overlays: [rect] } }, { type: 'paragraph' }] }, comments: [], ink: [] });
    }, PNG(595, 842, '#fafafa'));
    const ov = page.locator('#phone-ed .led-pdf-rect');
    await expect(ov).toBeVisible();
    const start = (await layers(page, '__ped'))[0];
    const shown = () => ov.evaluate((el) => [el.style.left, el.style.top]);
    const frame = () => page.locator('#phone-ed .led-pdf-frame').evaluate((el) => [el.style.left, el.style.top]);
    const atDoc = await shown();
    const c = await center(ov);
    const cdp = await page.context().newCDPSession(page);
    const at = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(c.x, c.y) });
    await page.waitForTimeout(450);
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(c.x + 8 * i, c.y + 6 * i) });
      await page.waitForTimeout(16);
    }
    expect(await shown(), 'на ходу слой едет').not.toEqual(atDoc);
    // Жест прерывает редактор (как уход фокуса окна или setContent).
    await page.evaluate(() => __ped.endGestures());
    expect(await shown(), 'слой вернулся к положению из документа').toEqual(atDoc);
    expect(await frame(), 'и рамка выделения — тоже').toEqual(atDoc);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    expect((await layers(page, '__ped'))[0], 'в документе — прежнее').toEqual(start);
    expect(await shown()).toEqual(atDoc);
  });

  test('удержание 700 мс: системный перенос и меню долгого касания отменены, pointercancel нет, перенос доходит до конца', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      const src = await __ped.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
      const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [p('один'), { type: 'image', attrs: { src } }, p('два'), p('три')] }, comments: [], ink: [] });
      // Что видит страница после всех обработчиков (всплытие до окна).
      window.__ev = { dragstart: [], contextmenu: [], pointercancel: 0 };
      for (const t of ['dragstart', 'contextmenu']) window.addEventListener(t, (e) => window.__ev[t].push(e.defaultPrevented));
      window.addEventListener('pointercancel', () => { window.__ev.pointercancel += 1; }, true);
    }, PNG(300, 150, '#aa5533'));
    const order = () => page.evaluate(() => { const out = []; __ped.view.state.doc.forEach((n) => out.push(n.type.name === 'image' ? 'IMG' : n.textContent)); return out; });
    const fig = page.locator('#phone-ed .led-figure');
    await expect.poll(() => fig.locator('.led-img-frame img').evaluate((i) => i.complete && i.naturalWidth)).toBe(300);
    await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
    const grip = fig.locator('.led-img-grip');
    await expect(grip).toBeVisible();
    // Ни ручка, ни картинка, ни сам блок на телефоне не тащатся системой.
    // (-webkit-touch-callout desktop Chrome не вычисляет — он в том же правиле.)
    expect(await fig.evaluate((f) => [f.draggable, f.querySelector('img').draggable, f.querySelector('.led-img-grip').draggable, getComputedStyle(f).webkitUserDrag, getComputedStyle(f.querySelector('.led-img-grip')).webkitUserDrag]))
      .toEqual([false, false, false, 'none', 'none']);
    const g = await center(grip);
    const three = await page.locator('#phone-ed .led-pm > p', { hasText: 'три' }).boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const at = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(g.x, g.y) });
    await page.waitForTimeout(700);
    // Как Android WebView около 500 мс: системный перенос и меню долгого
    // касания (эмулятор Chrome сам их не шлёт — шлём их так же, на ручку).
    const sys = await grip.evaluate((el) => [
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    ]);
    expect(sys, 'dispatchEvent → false: отменены').toEqual([false, false]);
    const dy = three.y + three.height + 12 - g.y;
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(g.x, g.y + (dy * i) / 8) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    const ev = await page.evaluate(() => window.__ev);
    expect(ev.dragstart.every(Boolean) && ev.dragstart.length > 0, 'dragstart отменён').toBe(true);
    expect(ev.contextmenu.every(Boolean) && ev.contextmenu.length > 0, 'contextmenu отменён').toBe(true);
    expect(ev.pointercancel, 'pointercancel не пришёл').toBe(0);
    expect(await order(), 'перенос завершился').toEqual(['один', 'два', 'три', 'IMG']);
    expect(await page.evaluate(() => window.__msgs.filter((m) => m.type === 'gesture').map((m) => m.on))).toEqual([true, false]);
    // Жест кончился — слушатели сняты: меню и перенос снова не наши.
    expect(await grip.evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
  });

  test('высота по тексту: у края видимой части перенос просит хозяина прокрутить (autoscroll)', async ({ page }) => {
    await phoneEditor(page);
    await page.evaluate(async (code) => {
      // Как на странице задачи: высота по тексту, хозяин прокручивает сам.
      __ped.destroy();
      document.getElementById('phone-ed').remove();
      const box = document.createElement('div');
      box.id = 'phone-ed';
      box.style.cssText = 'position:absolute;left:0;top:0;width:375px;background:var(--bg)';
      document.body.append(box);
      window.__msgs = [];
      window.__ped = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, autoHeight: true, content: null, post: (m) => window.__msgs.push(JSON.parse(JSON.stringify(m))) });
      const src = await __ped.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
      const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      __ped.setContent({ v: 1, doc: { type: 'doc', content: [p('один'), { type: 'image', attrs: { src } }, ...Array.from({ length: 30 }, (_, i) => p(`строка ${i}`))] }, comments: [], ink: [] });
      // Видна верхняя часть WebView высотой 400 px.
      __ped.receive({ type: 'viewport', top: 0, height: 400 });
    }, PNG(300, 150, '#3377aa'));
    const fig = page.locator('#phone-ed .led-figure');
    await expect.poll(() => fig.locator('.led-img-frame img').evaluate((i) => i.complete && i.naturalWidth)).toBe(300);
    await page.touchscreen.tap(...Object.values(await center(fig.locator('.led-img-frame'))));
    const grip = fig.locator('.led-img-grip');
    await expect(grip).toBeVisible();
    const g = await center(grip);
    // Долгое нажатие и к нижнему краю видимой части — палец там держат.
    const cdp = await page.context().newCDPSession(page);
    const at = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(g.x, g.y) });
    await page.waitForTimeout(450);
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(g.x, g.y + ((395 - g.y) * i) / 6) });
    await page.waitForTimeout(300);
    const asked = await page.evaluate(() => window.__msgs.filter((m) => m.type === 'autoscroll'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    expect(asked.length, 'на каждом кадре у края — сообщение').toBeGreaterThan(3);
    expect(asked.every((m) => m.dy > 0 && m.dy <= 18), 'вниз, не больше 18 px за кадр').toBe(true);
  });
});

// --- телефон: PDF через хозяина (протокол 3) -------------------------------------------------

test('телефон: «PDF» — pdf-pick хозяину, байты — pdf-file, модуль — pdf-module по запросу; «Сохранить как PDF» — export kind pdf', async ({ page }) => {
  await phoneEditor(page);
  expect(await page.evaluate(() => LancibleEditor.PROTOCOL)).toBe(5);
  const msgs = (type) => page.evaluate((t) => window.__msgs.filter((m) => m.type === t), type);
  expect(await page.evaluate(() => __ped.exec('pdf'))).toBe(true);
  expect(await msgs('pdf-pick')).toEqual([{ type: 'pdf-pick' }]);
  // Хозяин прислал файл — модуля в странице нет, редактор его просит.
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate((base64) => __ped.receive({ type: 'pdf-file', name: 'договор.pdf', base64 }), b64);
  await expect.poll(() => msgs('pdf-module')).toEqual([{ type: 'pdf-module' }]);
  // Хозяин впрыскивает ассет (как injectJavaScript) и отвечает.
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'assets', 'editor-pdf.txt'), 'utf8');
  await page.evaluate((js) => { (0, eval)(js); __ped.receive({ type: 'pdf-module-ready' }); }, code);
  const dialog = page.locator('#phone-ed #ledmodal-backdrop .led-pdf-modal');
  await expect(dialog).toContainText('договор.pdf');
  await dialog.getByRole('button', { name: 'Страницы', exact: true }).click();
  await expect(page.locator('#phone-ed .led-pdfpage')).toHaveCount(2);
  // «Сохранить как PDF»: файл — хозяину, base64; модуль второй раз не просят.
  await page.evaluate(() => __ped.exec('exportPdf'));
  await expect.poll(async () => (await msgs('export')).length).toBe(1);
  const [ex] = await msgs('export');
  expect({ kind: ex.kind, mime: ex.mime, name: ex.name }).toEqual({ kind: 'pdf', mime: 'application/pdf', name: 'document.pdf' });
  const { PDFDocument } = require('pdf-lib');
  expect((await PDFDocument.load(Buffer.from(ex.base64, 'base64'))).getPageCount()).toBe(2);
  expect(await msgs('pdf-module')).toHaveLength(1);
  // Передумали — ничего не вставляется.
  await page.evaluate(() => { __ped.exec('pdf'); __ped.receive({ type: 'pdf-file', cancel: true }); });
  await expect(page.locator('#phone-ed .led-pdfpage')).toHaveCount(2);
});

test('телефон: assets-adopt — картинка, вставленная без аккаунта, уходит в папку аккаунта только после переноса', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  const uploads = await page.evaluate(async () => {
    // Облако — подменённый fetch: куда что ушло.
    window.__uploads = [];
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (init && init.method === 'POST' && /doc-assets\//.test(String(url))) { window.__uploads.push(String(url).split('/doc-assets/')[1]); return new Response('{}', { status: 200 }); }
      return realFetch(url, init);
    };
    window.__remote = null;
    const assets = LancibleEditor.createAssetStore({ remote: () => window.__remote });
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:640px;z-index:500;display:flex;flex-direction:column';
    document.body.append(box);
    window.__ped = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, content: null, assets, post: () => {} });
    // Без аккаунта: картинка — гостевая.
    window.__src = await assets.put(new File(['байты'], 'guest.txt', { type: 'text/plain' }));
    // Вошёл U1: сама не уходит — первый вошедший не обязательно автор.
    window.__remote = { url: 'https://example.supabase.co', anonKey: 'k', accessToken: 't', userId: 'U1' };
    await assets.flush();
    return window.__uploads.slice();
  });
  expect(uploads, 'гостевая картинка первому вошедшему не уходит').toEqual([]);
  expect(await page.evaluate(() => __ped.receive({ type: 'assets-adopt', userId: 'U1' }))).toBe(true);
  const id = await page.evaluate(() => window.__src.slice(6));
  await expect.poll(() => page.evaluate(() => window.__uploads)).toEqual([`U1/${id}`]);
});

// 19 октября 2026: картинки, вставленные в документ аккаунта, пока его облако
// было закрыто (синхронизация выключена, сеанс не пришёл), ложились
// гостевыми навсегда. Хозяин отдаёт аккаунту те, на которые ссылается его
// документ, — остальные гостевые не трогаются.
test('телефон: assets-adopt referenced — аккаунту только картинки открытого документа', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(async () => {
    window.__uploads = [];
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (init && init.method === 'POST' && /doc-assets\//.test(String(url))) { window.__uploads.push(String(url).split('/doc-assets/')[1]); return new Response('{}', { status: 200 }); }
      return realFetch(url, init);
    };
    window.__remote = null;
    const assets = LancibleEditor.createAssetStore({ remote: () => window.__remote });
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:640px;z-index:500;display:flex;flex-direction:column';
    document.body.append(box);
    window.__ped = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, content: null, assets, post: () => {} });
    window.__inDoc = await assets.put(new File(['в документе'], 'a.txt', { type: 'text/plain' }));
    window.__layer = await assets.put(new File(['слой'], 'b.txt', { type: 'text/plain' }));
    window.__other = await assets.put(new File(['чужое'], 'c.txt', { type: 'text/plain' }));
    const preview = window.__inDoc;
    __ped.setContent({ v: 1, doc: { type: 'doc', content: [
      { type: 'image', attrs: { src: window.__inDoc } },
      { type: 'pdfpage', attrs: { src: '', page: 1, w: 595, h: 842, preview, overlays: [{ id: 'o1', type: 'image', x: 10, y: 10, w: 50, h: 50, src: window.__layer }] } },
    ] }, comments: [], ink: [] });
    window.__remote = { url: 'https://example.supabase.co', anonKey: 'k', accessToken: 't', userId: 'U1' };
  });
  expect(await page.evaluate(() => __ped.receive({ type: 'assets-adopt', userId: 'U1', referenced: true }))).toBe(true);
  const ids = await page.evaluate(() => [window.__inDoc, window.__layer].map((s) => `U1/${s.slice(6)}`).sort());
  await expect.poll(() => page.evaluate(() => window.__uploads.slice().sort())).toEqual(ids);
  // Третья — не из документа: осталась гостевой и не ушла.
  await page.evaluate(() => __ped.assets.flush());
  expect((await page.evaluate(() => window.__uploads.slice().sort()))).toEqual(ids);
  // ids — по списку.
  expect(await page.evaluate(() => __ped.receive({ type: 'assets-adopt', userId: 'U1', ids: [window.__other] }))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__uploads.length)).toBe(3);
});

test('телефон: assets-forget — стереть картинки убранного аккаунта; ответ assets-forgotten с числом', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(async () => {
    window.__msgs = [];
    window.__owner = 'U1';
    const assets = LancibleEditor.createAssetStore({ remote: () => null, owner: () => window.__owner });
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:640px;z-index:500;display:flex;flex-direction:column';
    document.body.append(box);
    window.__ped = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, content: null, assets, post: (m) => window.__msgs.push(JSON.parse(JSON.stringify(m))) });
    window.__u1 = [await assets.put(new File(['1'], 'a.txt', { type: 'text/plain' })), await assets.put(new File(['2'], 'b.txt', { type: 'text/plain' }))];
    window.__owner = 'U2';
    window.__u2 = await assets.put(new File(['3'], 'c.txt', { type: 'text/plain' }));
    window.__owner = null;
    window.__guest = await assets.put(new File(['4'], 'd.txt', { type: 'text/plain' }));
  });
  expect(await page.evaluate(() => __ped.receive({ type: 'assets-forget', userId: 'U1' }))).toBe(true);
  const answer = () => page.evaluate(() => window.__msgs.filter((m) => m.type === 'assets-forgotten'));
  await expect.poll(answer).toEqual([{ type: 'assets-forgotten', userId: 'U1', n: 2 }]);
  // В IndexedDB их нет — новое хранилище (как после перезапуска) их не видит.
  const left = await page.evaluate(async () => {
    const fresh = LancibleEditor.createAssetStore({});
    const has = async (s) => !!(await fresh.blob(s));
    return { u1: await Promise.all(window.__u1.map(has)), u2: await has(window.__u2), guest: await has(window.__guest) };
  });
  expect(left).toEqual({ u1: [false, false], u2: true, guest: true });
  // Пустой userId — ничего не стёрто, ответ всё равно один.
  await page.evaluate(() => { window.__msgs = []; __ped.receive({ type: 'assets-forget' }); });
  await expect.poll(answer).toEqual([{ type: 'assets-forgotten', userId: null, n: 0 }]);
});

test('телефон: меню «/» без сочетаний клавиш; острова таблицы нет — её кнопки в контекстной панели', async ({ page }) => {
  await phoneEditor(page);
  await page.locator('#phone-ed .led-pm').click();
  await page.keyboard.type('/');
  const slash = page.locator('#phone-ed .led-slash');
  await expect(slash).toBeVisible();
  await expect(slash.locator('.ctx-item', { hasText: 'Заголовок 1' })).toBeVisible();
  await expect(slash.locator('.ctx-item', { hasText: 'PDF' }), 'PDF на телефоне — через хозяина').toHaveCount(1);
  await expect(slash.locator('.led-kbd')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => __ped.exec('table'));
  // С 18 октября 2026 (протокол 4) острова таблицы на телефоне нет:
  // объединить, разделить, строка заголовков, график — в панели хозяина.
  await expect(page.locator('#phone-ed .led-tablebar')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window.__msgs.filter((m) => m.type === 'context').pop() || {}).kind)).toBe('table');
  await expect(page.locator('#phone-ed .led-thandle-row'), 'строки и столбцы — ручками').toBeVisible();
});

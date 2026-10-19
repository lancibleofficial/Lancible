// PDF в редакторе: страницы или текст. Запуск: npm run test:e2e
//
// Откуда взялось (17 октября 2026). Пункт пользователя: «добавить редактору
// возможность загрузить PDF и редактировать его»; решено — и страницы-
// картинки, поверх которых рисуют, и текст, выбор при загрузке
// (src/editor/pdf.js, DESIGN.md «PDF в редакторе»). С 17 октября 2026
// страницы встают узлом pdfpage со слоями — его слои, выгрузка и палец —
// tests/e2e/editor-pdfpage.spec.js. Здесь — настоящий pdf.js
// в браузере на маленьком файле tests/fixtures/sample-2p.pdf (1,3 КБ, написан
// руками, шрифт Helvetica не вшит):
//   стр. 1 — «Lancible PDF test» 24 pt; абзац из двух строк 12 pt; пустой
//            промежуток; второй абзац; оранжевый прямоугольник; номер «1»;
//   стр. 2 — «Page two heading» 20 pt; строка 12 pt; синий прямоугольник; «2».
// Как текст собирается в абзацы — юнитом tests/unit/editor-pdf.test.js.
const path = require('node:path');
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
      id, projectId: pid, title: 'PDF', done: false, notes: null,
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
const dialog = (page) => page.locator('#ledmodal-backdrop .led-pdf-modal');
const pdfInput = (page) => page.locator('#editor-wrap input.led-pdf-input');

/** Минимальный PDF из n пустых страниц — для предела по страницам. */
function blankPdf(n) {
  const objs = ['', '<< /Type /Catalog /Pages 2 0 R >>'];
  objs.push(`<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>');
  let out = '%PDF-1.4\n';
  const at = [];
  for (let i = 1; i < objs.length; i++) { at[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${at.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Ошибки страницы и нарушения CSP (script-src 'self'): pdf.js не должен
 *  ни вычислять строки, ни грузить воркер или wasm с blob: и чужих адресов. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  return errors;
}

/** Анимации окна закончились — теперь его место можно мерить. */
const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

test('PDF — в меню «Вставить» рядом с картинкой и в «/»; выбор файла — только PDF', async ({ page }) => {
  await openTask(page);
  await page.locator('#editor-wrap .led-toolbar [data-group="insert"]:visible').first().click();
  const items = await page.locator('.led-pop [data-cmd]').evaluateAll((els) => els.map((e) => e.dataset.cmd));
  const at = items.indexOf('pdf');
  expect(at, 'в меню «Вставить» есть PDF').toBeGreaterThan(0);
  // Сразу за «Картинкой по ссылке» (она в меню всегда, а «Картинка» — когда
  // её кнопки нет в строке).
  expect(items[at - 1], 'PDF — за картинкой').toBe('imageUrl');
  await page.keyboard.press('Escape');

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tool(page, 'pdf')]);
  expect(await chooser.element().getAttribute('accept')).toContain('application/pdf');
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles([]);

  await pm(page).click();
  await page.keyboard.type('/pdf');
  const slash = page.locator('.led-slash');
  await expect(slash).toBeVisible();
  await expect(slash.locator('.ctx-item').first()).toContainText('PDF');
});

test('окно выбора способа стоит по центру и закрывается Esc, ничего не вставив', async ({ page }) => {
  await openTask(page);
  await pdfInput(page).setInputFiles(FIXTURE);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('sample-2p.pdf');
  await expect(dialog(page)).toContainText('страниц: 2');
  await expect(dialog(page).getByRole('button', { name: 'Страницы', exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Текст', exact: true })).toBeVisible();
  await settled(page);
  const off = await dialog(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { dx: r.left + r.width / 2 - innerWidth / 2, dy: r.top + r.height / 2 - innerHeight / 2 };
  });
  expect(Math.abs(off.dx), 'по горизонтали').toBeLessThanOrEqual(1);
  expect(Math.abs(off.dy), 'по вертикали').toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  await expect(pm(page).locator('img')).toHaveCount(0);
});

test('«Страницы»: две страницы PDF «стр. 1», «стр. 2» с превью в масштабе 2 — и печать по одной на лист', async ({ page }) => {
  const errors = watchErrors(page);
  const id = await openTask(page);
  await pdfInput(page).setInputFiles(FIXTURE);
  await dialog(page).getByRole('button', { name: 'Страницы', exact: true }).click();
  const imgs = pm(page).locator('.led-pdfpage img.led-pdf-preview');
  await expect(imgs).toHaveCount(2);
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  await expect.poll(() => imgs.evaluateAll((els) => els.every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
  const shot = await imgs.evaluateAll((els) => els.map((i) => ({
    alt: i.alt, w: i.naturalWidth, h: i.naturalHeight, boxH: i.getBoundingClientRect().height,
  })));
  expect(shot.map((s) => s.alt)).toEqual(['стр. 1', 'стр. 2']);
  for (const s of shot) {
    // A4 — 595 × 842 pt, масштаб 2.
    expect(s.w).toBe(1190);
    expect(s.h).toBe(1684);
    expect(s.boxH, 'картинка видна').toBeGreaterThan(0);
  }
  // В документе — ссылки на хранилище картинок, а не байты: превью каждой
  // страницы и один исходный PDF на обе.
  const doc = await page.evaluate((taskId) => { editor.flush(); return state.tasks.find((t) => t.id === taskId).notes.lancible.doc; }, id);
  const nodes = doc.content.filter((n) => n.type === 'pdfpage');
  expect(nodes).toHaveLength(2);
  for (const n of nodes) { expect(n.attrs.preview).toMatch(/^asset:/); expect(n.attrs.src).toMatch(/^asset:/); }
  expect(nodes[0].attrs.src).toBe(nodes[1].attrs.src);
  expect(errors, 'ни ошибок, ни нарушений CSP').toEqual([]);

  // Между страницами пишут: выделить страницу, стрелка вниз — курсор в
  // промежутке под ней (gapcursor), и набранное встаёт абзацем.
  await pm(page).locator('.led-pdf-sheet').first().click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('Заметка между страницами');
  const order = await pm(page).evaluate((el) => [...el.children].map((c) => (c.querySelector('img') ? c.querySelector('img').alt : c.textContent)).filter(Boolean));
  expect(order).toEqual(['стр. 1', 'Заметка между страницами', 'стр. 2']);

  // Печать (export kind print): та же разметка, что уходит во фрейм печати.
  // Каждая страница — на своём листе с полями, как в окне печати, и на A4, и
  // на Letter: страница A4 на Letter выше листа и без правила печати
  // резалась бы на пять листов.
  const html = await page.evaluate(() => editor.exportHtml());
  const rule = /@media print\{[^}]*\}[^}]*\}\}/;
  expect(html).toMatch(rule);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const sheets = async (markup, format) => {
    const sheet = await page.context().newPage();
    await sheet.setContent(markup);
    await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const bytes = await sheet.pdf({ format, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
    await sheet.close();
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWasm: false, verbosity: 0 });
    const n = (await task.promise).numPages;
    await task.destroy();
    return n;
  };
  expect(await sheets(html, 'A4'), 'A4: по странице PDF на лист').toBe(2);
  expect(await sheets(html, 'Letter'), 'Letter: по странице PDF на лист').toBe(2);
  expect(await sheets(html.replace(rule, ''), 'Letter'), 'без правила печати страница режется').toBeGreaterThan(2);
});

test('«Текст»: заголовки и абзацы с текстом страниц, без номеров страниц', async ({ page }) => {
  const errors = watchErrors(page);
  await openTask(page);
  await pdfInput(page).setInputFiles(FIXTURE);
  await dialog(page).getByRole('button', { name: 'Текст', exact: true }).click();
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  await expect(pm(page).locator('h1')).toHaveText('Lancible PDF test');
  const blocks = await pm(page).evaluate((el) => [...el.children].map((c) => `${c.tagName.toLowerCase()}: ${c.textContent}`).filter((s) => !/: $/.test(s)));
  expect(blocks).toEqual([
    'h1: Lancible PDF test',
    'p: First paragraph, line one continues on line two.',
    'p: Second paragraph after a gap.',
    'h2: Page two heading',
    'p: Text on the second page.',
  ]);
  // Вставленное — обычный текст: правится, как набранное.
  await pm(page).locator('h2').click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(pm(page).locator('h2')).toHaveText('Page two heading!');
  expect(errors, 'ни ошибок, ни нарушений CSP').toEqual([]);
});

test('ход «Страница N из M» и отмена: Esc останавливает, ничего не вставив', async ({ page }) => {
  await openTask(page);
  // Отрисовка страницы ждёт, пока тест не отпустит: иначе на двух страницах
  // окно хода мелькнуло бы раньше, чем его увидели.
  await page.evaluate(() => {
    window.pdfGate = new Promise((r) => { window.pdfRelease = r; });
    const proto = HTMLCanvasElement.prototype;
    const gated = new Proxy(proto.toBlob, { apply: (fn, canvas, args) => { window.pdfGate.then(() => Reflect.apply(fn, canvas, args)); } });
    Object.defineProperty(proto, 'toBlob', { configurable: true, writable: true, value: gated });
  });
  await pdfInput(page).setInputFiles(FIXTURE);
  await dialog(page).getByRole('button', { name: 'Страницы', exact: true }).click();
  await expect(dialog(page).locator('.led-pdf-step')).toHaveText('Страница 1 из 2');
  await expect(dialog(page).locator('.led-pdf-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.pdfRelease());
  await expect(page.locator('#toast')).toContainText('вставлено страниц — 0 из 2');
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  await expect(pm(page).locator('img')).toHaveCount(0);
});

test('файл больше 20 МБ и больше 50 страниц — понятное сообщение, окна нет', async ({ page }) => {
  await openTask(page);
  await pdfInput(page).setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 32) });
  await expect(page.locator('#toast')).toHaveText('PDF больше 20 МБ — выберите файл поменьше');
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);

  await pdfInput(page).setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: blankPdf(51) });
  await expect(page.locator('#toast')).toHaveText('Страниц в PDF: 51, а вставить можно не больше 50 — разделите файл');
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);

  await pdfInput(page).setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pdf') });
  await expect(page.locator('#toast')).toHaveText('Это не PDF — выберите файл .pdf');
});

// С 17 октября 2026 (протокол 3) PDF на телефоне есть: файл выбирает
// хозяин (pdf-pick → pdf-file), модуль он впрыскивает по запросу
// (pdf-module) — подробно в tests/e2e/editor-pdfpage.spec.js.
test('телефон (nativeToolbar): PDF в «/» и в exec — выбор файла у хозяина (pdf-pick), своего поля нет', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#shell')).toBeVisible();
  const r = await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'phone-ed';
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:640px;z-index:500;display:flex;flex-direction:column';
    document.body.append(box);
    const sent = [];
    window.__ped = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, content: null, post: (m) => sent.push(m.type) });
    return { exec: window.__ped.exec('pdf'), inputs: box.querySelectorAll('input.led-pdf-input').length, stray: /null/.test(box.textContent), pick: sent.includes('pdf-pick') };
  });
  expect(r).toEqual({ exec: true, inputs: 0, stray: false, pick: true });
  await page.locator('#phone-ed .led-pm').click();
  await page.keyboard.type('/');
  const slash = page.locator('#phone-ed .led-slash');
  await expect(slash).toBeVisible();
  await expect(slash.locator('.ctx-item')).not.toHaveCount(0);
  await expect(slash.locator('.ctx-item', { hasText: 'PDF' })).toHaveCount(1);
});

test('pdf.js — отдельный файл рядом с editor.js: грузится один раз, а не загрузился — окно с причиной', async ({ page }) => {
  await openTask(page);
  // До первого PDF pdf.js на странице нет — editor.js его не несёт.
  expect(await page.evaluate(() => [!!window.LancibleEditorPdf, document.querySelectorAll('script[data-led-pdf]').length])).toEqual([false, 0]);

  // Файла нет (сеть, неполная сборка) — окно с причиной, а не «плохой PDF».
  await page.route('**/editor-pdf.js', (route) => route.fulfill({ status: 404, body: '' }));
  await pdfInput(page).setInputFiles(FIXTURE);
  await expect(dialog(page)).toContainText('Не удалось загрузить модуль чтения PDF');
  await page.keyboard.press('Escape');
  await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  await page.unroute('**/editor-pdf.js');

  // Сеть вернулась — следующая попытка грузит файл; рядом с editor.js и через
  // CSP script-src 'self' (ошибок и нарушений нет).
  const errors = watchErrors(page);
  const loaded = [];
  page.on('request', (r) => { if (r.url().endsWith('/editor-pdf.js')) loaded.push(r.url()); });
  for (let i = 0; i < 2; i++) {
    await pdfInput(page).setInputFiles(FIXTURE);
    await expect(dialog(page)).toContainText('страниц: 2');
    await page.keyboard.press('Escape');
    await expect(page.locator('#ledmodal-backdrop')).toHaveCount(0);
  }
  const editorJs = await page.evaluate(() => document.querySelector('script[src$="editor.js"]').src);
  expect(loaded, 'второй PDF файл заново не грузит').toEqual([editorJs.replace(/editor\.js$/, 'editor-pdf.js')]);
  expect(await page.evaluate(() => document.querySelectorAll('script[data-led-pdf]').length)).toBe(1);
  expect(errors.filter((e) => !/editor-pdf\.js|404/.test(e)), 'ни ошибок, ни нарушений CSP').toEqual([]);
});

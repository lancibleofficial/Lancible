// Меню по правой кнопке, вставка адреса на выделение и слой пера на телефоне
// во всё окно. Запуск: npm run test:e2e
//
// Откуда взялось (17 октября 2026, круг шлифовки веба).
//  - Правая кнопка в тексте на десктопе не делала ничего (у Electron нет
//    меню по умолчанию), в вебе — системное меню браузера. Теперь — своё,
//    того же вида, что остальные меню редактора (src/editor/contextmenu.js):
//    вырезать, копировать, вставить, без форматирования, выделить всё; на
//    ссылке — изменить, открыть, убрать; на картинке — её действия; в
//    таблице — подменю острова таблицы.
//  - Ctrl+V адреса на выделенный текст заменял текст адресом. Теперь на
//    выделение ложится ссылка (plugins.js: linkOnPaste; чистая проверка —
//    tests/unit/editor-paste.test.js).
//  - «Я рисую, а рисуется только в ограниченной области»: на странице
//    задачи телефона WebView выше текста, а слой пера был высотой с текст.
//    Теперь он до низа окна, а штрих ниже текста растит WebView
//    (overlay.js: layerHeight, index.js: contentHeight).
const { test, expect } = require('@playwright/test');

async function openTask(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const pid = uid();
    state.projects.push({ id: pid, name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
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
  });
  await pm(page).click();
}

const pm = (page) => page.locator('#editor-wrap .led-pm');
const ctx = (page) => page.locator('.led-pop.led-ctx');
const item = (page, cmd) => ctx(page).locator(`.ctx-item[data-cmd="${cmd}"]`);
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const setClip = (page, text) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
const sel = (page) => page.evaluate(() => { const s = editor.view.state.selection; return [s.from, s.to]; });

/** Точка внутри текста: середина знака на позиции pos документа. */
const at = (page, pos) => page.evaluate((p) => {
  const a = editor.view.coordsAtPos(p);
  const b = editor.view.coordsAtPos(p + 1);
  return { x: (a.left + b.left) / 2, y: (a.top + a.bottom) / 2 };
}, pos);

async function rightClick(page, pos) {
  const p = await at(page, pos);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(ctx(page)).toBeVisible();
}

/** Выделить from..to (TextSelection — класс нынешнего выделения после набора). */
const select = (page, from, to) => page.evaluate(([a, b]) => {
  const { state } = editor.view;
  editor.view.dispatch(state.tr.setSelection(state.selection.constructor.create(state.doc, a, b)));
  editor.view.focus();
}, [from, to]);

/** «Привет мир», выделено «мир» (позиции 8–11). */
async function typeAndSelectWord(page) {
  await page.keyboard.type('Привет мир');
  await select(page, 8, 11);
  expect(await sel(page)).toEqual([8, 11]);
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('правая кнопка в тексте — меню редактора, а не системное; Esc закрывает', async ({ page }) => {
  await openTask(page);
  await typeAndSelectWord(page);
  await page.evaluate(() => {
    window.__ctxPrevented = null;
    document.addEventListener('contextmenu', (e) => { window.__ctxPrevented = e.defaultPrevented; });
  });
  await rightClick(page, 9);
  expect(await page.evaluate(() => window.__ctxPrevented), 'системное меню не показано').toBe(true);
  await expect(ctx(page)).toHaveClass(/ctx-menu/);
  const cmds = await ctx(page).locator('.ctx-item').evaluateAll((els) => els.map((e) => e.dataset.cmd));
  expect(cmds).toEqual(['cut', 'copy', 'paste', 'pastePlain', 'selectAll']);
  await expect(item(page, 'paste')).toContainText('Вставить');
  await expect(item(page, 'copy').locator('.led-kbd')).toHaveText(/^(Ctrl\+C|⌘C)$/);
  const box = await ctx(page).evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
  expect(box.l).toBeGreaterThanOrEqual(0);
  expect(box.t).toBeGreaterThanOrEqual(0);
  expect(box.r).toBeLessThanOrEqual(box.w);
  expect(box.b).toBeLessThanOrEqual(box.h);
  expect(await sel(page), 'щелчок по выделению его не сбросил').toEqual([8, 11]);
  await page.keyboard.press('Escape');
  await expect(ctx(page)).toHaveCount(0);
  expect(await sel(page)).toEqual([8, 11]);
});

test('щелчок мимо выделения ставит курсор туда; без выделения вырезать и копировать погашены', async ({ page }) => {
  await openTask(page);
  await typeAndSelectWord(page);
  await rightClick(page, 2);
  const [from, to] = await sel(page);
  expect(from).toBe(to);
  expect(from).toBeLessThan(5);
  await expect(item(page, 'cut')).toBeDisabled();
  await expect(item(page, 'copy')).toBeDisabled();
  await expect(item(page, 'paste')).toBeEnabled();
});

test('копировать и вырезать кладут в буфер то же, что Ctrl+C и Ctrl+X', async ({ page }) => {
  await openTask(page);
  await typeAndSelectWord(page);
  await rightClick(page, 9);
  await item(page, 'copy').click();
  await expect(ctx(page)).toHaveCount(0);
  expect(await clip(page)).toBe('мир');
  await rightClick(page, 9);
  await item(page, 'cut').click();
  await expect(pm(page)).toHaveText('Привет ');
  expect(await clip(page)).toBe('мир');
  expect(await page.evaluate(() => editor.view.hasFocus()), 'фокус в тексте').toBe(true);
});

test('выделить всё', async ({ page }) => {
  await openTask(page);
  await page.keyboard.type('Первый');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Второй');
  await rightClick(page, 3);
  await item(page, 'selectAll').click();
  const [from, to] = await sel(page);
  const size = await page.evaluate(() => editor.view.state.doc.content.size);
  expect(from).toBe(0);
  expect(to).toBe(size);
});

test('вставить — теми же правилами, что Ctrl+V: Markdown становится разметкой', async ({ page }) => {
  await openTask(page);
  await page.keyboard.type('x');
  await setClip(page, '# Заголовок\n\n- первый\n- второй');
  await rightClick(page, 1);
  await item(page, 'paste').click();
  await expect(pm(page).locator('h1')).toHaveText('Заголовок');
  await expect(pm(page).locator('ul li')).toHaveCount(2);
  expect(await page.evaluate(() => editor.view.hasFocus())).toBe(true);
});

test('вставить с оформлением и без форматирования', async ({ page }) => {
  await openTask(page);
  await page.keyboard.type('x');
  const write = () => page.evaluate(() => navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob(['<p><strong>жирный</strong> текст</p>'], { type: 'text/html' }),
    'text/plain': new Blob(['жирный текст'], { type: 'text/plain' }),
  })]));
  await write();
  await rightClick(page, 1);
  await item(page, 'pastePlain').click();
  await expect(pm(page)).toContainText('жирный текст');
  await expect(pm(page).locator('strong'), 'без форматирования — без полужирного').toHaveCount(0);
  await write();
  await rightClick(page, 1);
  await item(page, 'paste').click();
  await expect(pm(page).locator('strong')).toHaveText('жирный');
});

test('браузер не дал прочитать буфер — подсказка «Нажмите Ctrl+V»', async ({ page }) => {
  await openTask(page);
  await page.keyboard.type('Текст');
  await page.evaluate(() => {
    const deny = () => Promise.reject(new DOMException('запрещено', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: deny, readText: deny } });
  });
  await rightClick(page, 2);
  await item(page, 'paste').click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toHaveText(/Нажмите (Ctrl\+V|⌘V), чтобы вставить/);
  await expect(pm(page)).toHaveText('Текст');
});

test('на ссылке — изменить, открыть, убрать', async ({ page }) => {
  await openTask(page);
  await page.keyboard.type('до Сайт после');
  await page.evaluate(() => {
    const { state } = editor.view;
    // «Сайт» — с 4 по 8.
    editor.view.dispatch(state.tr.addMark(4, 8, state.schema.marks.link.create({ href: 'https://example.com' })));
  });
  await page.keyboard.press('End');
  await rightClick(page, 5);
  expect(await sel(page), 'правая кнопка по ссылке выделяет её всю').toEqual([4, 8]);
  for (const c of ['editLink', 'openLink', 'unlink']) await expect(item(page, c)).toBeVisible();
  await item(page, 'editLink').click();
  await expect(page.locator('.led-pop .led-link-pop input').first()).toHaveValue('https://example.com');
  await page.keyboard.press('Escape');
  await rightClick(page, 5);
  await item(page, 'unlink').click();
  await expect(pm(page).locator('a')).toHaveCount(0);
  await expect(pm(page)).toHaveText('до Сайт после');
});

test('Ctrl+V адреса на выделенный текст — ссылка, текст на месте; без выделения — как раньше', async ({ page }) => {
  await openTask(page);
  await typeAndSelectWord(page);
  await setClip(page, 'https://example.com/mir');
  await page.keyboard.press('Control+V');
  await expect(pm(page)).toHaveText('Привет мир');
  await expect(pm(page).locator('a[href="https://example.com/mir"]')).toHaveText('мир');
  // Без выделения — адрес вставляется текстом.
  await page.keyboard.press('End');
  // ProseMirror узнаёт о сдвиге курсора по selectionchange — дождаться его.
  await expect.poll(() => sel(page)).toEqual([11, 11]);
  await page.keyboard.press('Control+V');
  await expect(pm(page)).toHaveText('Привет мирhttps://example.com/mir');
  // Не один адрес — выделенное заменяется, как всегда.
  await page.keyboard.press('Control+A');
  await setClip(page, 'https://a.example\nhttps://b.example');
  await page.keyboard.press('Control+V');
  await expect(pm(page)).toContainText('https://b.example');
  await expect(pm(page)).not.toContainText('Привет');
});

test('«Вставить» из меню адреса на выделенный текст — тоже ссылка', async ({ page }) => {
  await openTask(page);
  await typeAndSelectWord(page);
  await setClip(page, '  mailto:hi@example.com\n');
  await rightClick(page, 9);
  await item(page, 'paste').click();
  await expect(pm(page).locator('a[href="mailto:hi@example.com"]')).toHaveText('мир');
  await expect(pm(page)).toHaveText('Привет мир');
});

test('в таблице — подменю острова таблицы', async ({ page }) => {
  await openTask(page);
  await page.evaluate(() => editor.exec('table', { rows: 2, cols: 2, header: false }));
  const cell = await page.evaluate(() => {
    const r = document.querySelector('#editor-wrap .led-pm td').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(cell.x, cell.y, { button: 'right' });
  await expect(item(page, 'table')).toBeVisible();
  await item(page, 'table').click();
  await expect(item(page, 'rowBelow')).toBeVisible();
  await expect(item(page, 'merge'), 'без выделенных ячеек объединять нечего').toBeDisabled();
  await item(page, 'rowBelow').click();
  await expect(pm(page).locator('table tr')).toHaveCount(3);
});

test('на картинке — её действия, «Удалить» убирает её', async ({ page }) => {
  await openTask(page);
  await page.keyboard.type('над картинкой');
  await page.evaluate(() => editor.exec('imageUrl', 'https://example.invalid/photo.png'));
  const fig = page.locator('#editor-wrap .led-pm .led-figure');
  await expect(fig).toHaveCount(1);
  const box = await fig.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(40, box.height / 2), { button: 'right' });
  await expect(ctx(page)).toBeVisible();
  expect(await page.evaluate(() => editor.view.state.selection.node && editor.view.state.selection.node.type.name)).toBe('image');
  for (const c of ['imageReplace', 'imageAlt', 'imageDownload', 'deleteBlock']) await expect(item(page, c)).toBeVisible();
  await item(page, 'deleteBlock').click();
  await expect(fig).toHaveCount(0);
  await expect(pm(page)).toContainText('над картинкой');
});

test('в полном экране первый Esc закрывает меню, второй — полный экран', async ({ page }) => {
  await openTask(page);
  await page.keyboard.type('Текст');
  const led = page.locator('#editor-wrap .led');
  await page.locator('#editor-wrap .led-toolbar-end button').click();
  await expect(led).toHaveClass(/led-fullscreen/);
  await rightClick(page, 2);
  await page.keyboard.press('Escape');
  await expect(ctx(page)).toHaveCount(0);
  await expect(led, 'полный экран остался').toHaveClass(/led-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(led).not.toHaveClass(/led-fullscreen/);
});

test('на телефоне правая кнопка (долгое касание) остаётся системной', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#shell')).toBeVisible();
  const prevented = await page.evaluate(() => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:400px;z-index:500;display:flex;flex-direction:column';
    document.body.append(box);
    const ed = LancibleEditor.create(box, { mobile: true, inApp: true, nativeToolbar: true, content: null, post: () => {} });
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 });
    ed.view.dom.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.locator('.led-ctx')).toHaveCount(0);
});

// --- слой пера на телефоне -------------------------------------------------------
//
// Страница как у WebView телефона (mobile/src/components/DocEditor.js: buildHtml
// и LIVE_CSS): живой редактор с высотой по тексту, #host не ниже окна, сама
// страница не прокручивается — WebView растёт по сообщению height.

const LIVE_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="styles.css">
<style>html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:var(--font-ui);}
html,body,#host{height:100%;}
#host{display:flex;flex-direction:column;}
.live html,.live body,.live #host{height:auto;overflow:hidden;}
.live #host{min-height:100vh;}
.live #host .led .led-page-wrap{padding:8px 4px 16px;}</style>
</head><body><div id="host"></div><script src="editor.js"></script></body></html>`;

async function phonePage(page, live) {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.route('**/phone-editor.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LIVE_PAGE }));
  await page.goto('/phone-editor.html');
  await page.evaluate((isLive) => {
    if (isLive) document.documentElement.classList.add('live');
    window.__msgs = [];
    window.__ped = LancibleEditor.create(document.getElementById('host'), {
      mobile: true, inApp: true, nativeToolbar: true, autoHeight: isLive, content: null,
      post: (m) => window.__msgs.push(JSON.parse(JSON.stringify(m))),
    });
  }, live);
  await page.locator('#host .led-pm').click();
  await page.keyboard.type('Короткая заметка');
  await page.evaluate(() => __ped.exec('annotate', true));
  await expect(page.locator('#host .led-overlay')).toHaveClass(/\bon\b/);
}

const overlayBox = (page) => page.evaluate(() => {
  const r = document.querySelector('#host .led-overlay').getBoundingClientRect();
  const c = document.querySelector('#host .led-overlay-canvas').getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, canvasBottom: c.bottom, led: document.querySelector('#host .led').getBoundingClientRect().bottom };
});

test('телефон, заметка на странице задачи: слой пера — во всё окно, штрих у низа сохраняется', async ({ page }) => {
  await phonePage(page, true);
  const before = await overlayBox(page);
  expect(before.led, 'текст короткий — редактор ниже окна').toBeLessThan(300);
  expect(before.top).toBeLessThanOrEqual(1);
  expect(before.bottom, 'слой до низа окна').toBeGreaterThanOrEqual(800);
  expect(before.canvasBottom, 'и холст тоже').toBeGreaterThanOrEqual(800);
  expect(before.left).toBe(0);
  expect(before.width, 'во всю ширину').toBe(375);

  // Штрих у самого низа окна — далеко под текстом.
  await page.mouse.move(40, 770);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(40 + i * 12, 770 + i);
  await page.mouse.up();
  const ink = await page.evaluate(() => ({ n: __ped.ink.length, bottom: __ped.overlay.inkBottom() + document.querySelector('#host .led-scroll').getBoundingClientRect().top }));
  expect(ink.n, 'штрих лёг в документ').toBe(1);
  expect(ink.bottom, 'там, где его нарисовали').toBeGreaterThan(785);

  // Хозяину — высота до штриха с запасом: WebView растёт, штрих не обрезан.
  await expect.poll(async () => (await page.evaluate(() => __msgs.filter((m) => m.type === 'height').pop().px))).toBeGreaterThan(ink.bottom + 20);
  const px = await page.evaluate(() => __msgs.filter((m) => m.type === 'height').pop().px);
  await page.setViewportSize({ width: 375, height: px });
  await expect.poll(async () => (await overlayBox(page)).bottom, 'выросло окно — вырос и слой').toBeGreaterThanOrEqual(px);

  await page.evaluate(() => __ped.exec('annotate', false));
  const saved = await page.evaluate(() => __ped.getContent().ink);
  expect(saved).toHaveLength(1);
});

test('телефон, документ во весь экран: слой пера — во всё окно', async ({ page }) => {
  await phonePage(page, false);
  const box = await overlayBox(page);
  expect(box.top).toBeLessThanOrEqual(1);
  expect(box.bottom).toBeGreaterThanOrEqual(799);
  expect(box.width).toBe(375);
  await page.mouse.move(40, 780);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(40 + i * 15, 780 + (i % 3));
  await page.mouse.up();
  expect(await page.evaluate(() => __ped.ink.length)).toBe(1);
});

// Картинка в редакторе: ширина рамки и картинки одна. Запуск: npm run test:e2e
//
// Откуда взялось (18 октября 2026, жалоба пользователя со скриншотами): на
// вебе при растягивании рамка росла, а картинка упиралась в свою ширину —
// маленький PNG стоял своим размером в широкой рамке, крупная картинка была
// короче рамки. Причина — ширину получала рамка (.led-img-frame), а у самой
// картинки было только max-width: 100%: шире исходного размера она не
// становилась. Теперь ширину держит коробка .led-img-box, картинка — всегда
// во всю коробку, высота — по пропорции (src/editor/image.js, раздел
// «Картинка» в styles.css). Меряем getBoundingClientRect: картинка и рамка
// одной ширины, пропорции те же, подпись — по ширине картинки.
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
      id, projectId: pid, title: 'Картинки', done: false, notes: null,
      totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
      statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    openProject(pid);
    selectTask(id);
  });
}

const pm = (page) => page.locator('#editor-wrap .led-pm');

/** PNG w×h одним цветом — собирается в самой странице. */
const PNG = (w, h, color) => `(() => new Promise((r) => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const x = c.getContext('2d'); x.fillStyle = '${color}'; x.fillRect(0, 0, ${w}, ${h}); c.toBlob(r, 'image/png'); }))()`;

/** Заметка: абзац, картинка w×h, абзац; картинка выделена щелчком. */
async function withImage(page, w, h) {
  await openTask(page);
  await page.evaluate(async (code) => {
    // editor — переменная app.js (let), а не свойство окна.
    // eslint-disable-next-line no-undef
    const ed = editor;
    const src = await ed.assets.put(new File([await eval(code)], 'pic.png', { type: 'image/png' }));
    const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    ed.setContent({ v: 1, doc: { type: 'doc', content: [p('до'), { type: 'image', attrs: { src } }, p('после')] }, comments: [], ink: [] });
  }, PNG(w, h, '#cc5533'));
  const fig = pm(page).locator('.led-figure');
  await expect.poll(() => fig.locator('img').evaluate((i) => i.complete && i.naturalWidth)).toBe(w);
  await fig.locator('img').click();
  await expect(fig).toHaveClass(/\bsel\b/);
  return fig;
}

/** Картинка, рамка, подпись и ширина полосы — как на экране. */
const geo = (fig) => fig.evaluate((f) => {
  const r = (el) => el.getBoundingClientRect().toJSON();
  return { img: r(f.querySelector('img')), frame: r(f.querySelector('.led-img-frame')), caption: r(f.querySelector('.led-caption')), col: f.clientWidth };
});

/** Ширина картинки в документе (attrs.width, % полосы). */
// eslint-disable-next-line no-undef
const widthAttr = (page) => page.evaluate(() => editor.view.state.doc.child(1).attrs.width);

/** Тянуть ручку сбоку мышью на dx. */
async function dragHandle(page, fig, dx) {
  const hb = await fig.locator('.led-img-handle').boundingBox();
  const x = hb.x + hb.width / 2;
  const y = hb.y + hb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  await page.mouse.up();
}

/** Картинка и рамка одной ширины, высота — по пропорции исходника, подпись
 *  — по ширине картинки. */
function expectSameWidth(g, ratio) {
  expect(Math.abs(g.img.width - g.frame.width), `картинка ${g.img.width}, рамка ${g.frame.width}`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.img.height - g.img.width * ratio), `высота ${g.img.height} при ширине ${g.img.width}`).toBeLessThanOrEqual(1.5);
  expect(Math.abs(g.caption.width - g.img.width), `подпись ${g.caption.width}`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.caption.left - g.img.left), 'подпись — под картинкой').toBeLessThanOrEqual(1);
}

test('маленькая картинка 100×60 растягивается за ручку до 600 px — картинка с рамкой, пропорции те же', async ({ page }) => {
  const fig = await withImage(page, 100, 60);
  const g0 = await geo(fig);
  expect(g0.img.width, 'сначала — своим размером').toBeCloseTo(100, 0);
  expectSameWidth(g0, 0.6);
  // Острова на вебе остаются (на телефоне с нативной панелью их нет).
  await expect(fig.locator('.led-node-bar')).toBeVisible();
  const target = Math.min(600, Math.round(g0.col * 0.9));
  // По центру растут обе стороны: ручка едет на половину прироста.
  await dragHandle(page, fig, (target - g0.img.width) / 2);
  const g = await geo(fig);
  expect(Math.abs(g.img.width - target), `ширина ${g.img.width} вместо ${target}`).toBeLessThanOrEqual(g.col / 100 + 2);
  expect(g.img.width, 'шире исходного размера').toBeGreaterThan(500);
  expectSameWidth(g, 0.6);
  expect(Math.abs((await widthAttr(page)) - Math.round((target / g.col) * 100))).toBeLessThanOrEqual(1);
});

test('крупная картинка: уже полосы и обратно до полосы — картинка не короче рамки', async ({ page }) => {
  const fig = await withImage(page, 1600, 800);
  const g0 = await geo(fig);
  expect(Math.abs(g0.img.width - g0.col), 'шире полосы не бывает').toBeLessThanOrEqual(1);
  expectSameWidth(g0, 0.5);
  await dragHandle(page, fig, -g0.col * 0.2);
  const half = await geo(fig);
  expect(Math.abs(half.img.width - g0.col * 0.6), `ширина ${half.img.width}`).toBeLessThanOrEqual(g0.col / 100 + 2);
  expectSameWidth(half, 0.5);
  // Дальше полосы ручка не тянет: 100 %.
  await dragHandle(page, fig, g0.col * 0.4);
  const full = await geo(fig);
  expect(Math.abs(full.img.width - g0.col)).toBeLessThanOrEqual(1);
  expectSameWidth(full, 0.5);
  expect(await widthAttr(page)).toBe(100);
});

test('картинка 480×240 растягивается шире своего размера — та же ширина у рамки', async ({ page }) => {
  const fig = await withImage(page, 480, 240);
  const g0 = await geo(fig);
  test.skip(g0.col < 560, `полоса ${g0.col} px — уже, чем нужно для проверки`);
  const target = Math.round(g0.col * 0.95);
  await dragHandle(page, fig, (target - g0.img.width) / 2);
  const g = await geo(fig);
  expect(g.img.width, 'не упёрлась в 480').toBeGreaterThan(500);
  expect(Math.abs(g.img.width - target)).toBeLessThanOrEqual(g.col / 100 + 2);
  expectSameWidth(g, 0.5);
});

test('«во всю ширину» — картинка во всю полосу, даже маленькая', async ({ page }) => {
  const fig = await withImage(page, 100, 60);
  await fig.locator('.led-node-bar [data-align="full"]').click();
  await expect(fig).toHaveClass(/align-full/);
  const g = await geo(fig);
  expect(Math.abs(g.img.width - g.col), `картинка ${g.img.width}, полоса ${g.col}`).toBeLessThanOrEqual(1);
  expectSameWidth(g, 0.6);
  // Назад «по центру» — снова своим размером.
  await fig.locator('.led-node-bar [data-align="center"]').click();
  expect((await geo(fig)).img.width).toBeCloseTo(100, 0);
});

// Откуда взялось (20 октября 2026, CI на Linux, тест выше): после «во всю
// ширину» щелчок «по центру» попадал в картинку — остров уже спрятан, курсор
// в начале заметки. Щелчок по кнопке острова для браузера был щелчком внутри
// выделения не по тексту: на отпускании он снимал выделение целиком, фокус
// оставался в тексте, и следующее событие ввода — движение мыши (даже над
// боковой панелью), клавиша — ставило курсор в начало заметки; ProseMirror
// читал его как новое выделение. Гонка: успевало ли это до нажатия
// следующего щелчка. Здесь не гонка: после каждой кнопки мышь уходит и
// нажимается Shift, и только потом проверка. Процессор замедлен, как на
// загруженной машине CI.
test('выравнивания подряд под замедлением: выделение и остров на месте, мышь и клавиша их не сбивают', async ({ page }) => {
  const fig = await withImage(page, 100, 60);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const align of ['full', 'center', 'left', 'right', 'wrap-left', 'wrap-right', 'full', 'center']) {
    const btn = fig.locator(`.led-node-bar [data-align="${align}"]`);
    // Кнопку не закрывает картинка: в её середине — она сама.
    const onTop = await btn.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop, `кнопка «${align}» под картинкой`).toBe(true);
    await btn.click();
    await expect(fig).toHaveClass(new RegExp(`(^|\\s)align-${align}(\\s|$)`));
    await page.mouse.move(60, 400);
    await page.keyboard.press('Shift');
    // Событие selectionchange — задачей после ввода: даём ему пройти.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
    const sel = await fig.evaluate((f) => {
      // eslint-disable-next-line no-undef
      const s = editor.view.state.selection;
      const dom = getSelection();
      return { node: s.node ? s.node.type.name : `${s.toJSON().type} ${s.from}`, around: dom.rangeCount === 1 && dom.containsNode(f) };
    });
    expect(sel.node, `после «${align}» выделена не картинка`).toBe('image');
    expect(sel.around, `после «${align}» выделение браузера ушло с картинки`).toBe(true);
    await expect(fig).toHaveClass(/\bsel\b/);
    await expect(fig.locator('.led-node-bar')).toBeVisible();
  }
});

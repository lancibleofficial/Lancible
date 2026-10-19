// Галочка «выполнено» на вебе: налив, брызги, строка держит место и уезжает
// к выполненным; крестик отменённой. Запуск: npm run test:e2e -- check-motion
//
// 18 октября 2026 пользователь попросил: убрать исчезновение строки при
// отметке и сделать как на телефоне — галочка разбрасывает капли, задача с
// небольшой задержкой опускается вниз списка, и видно, что она ушла вниз.
// Места с галочкой .task-done на вебе: карточки «Проектов» и список задач на
// странице проекта (на «Сегодня» и на доске галочки нет).
//
// Мерим кодом: классы и анимации галочки (getAnimations), капли в слое
// .task-drops, положение строк по кадрам (getBoundingClientRect, вычисленный
// transform) — строка стоит ~600 мс, потом едет (flipMove) и встаёт на новое
// место. И везде — prefers-reduced-motion: ни налива, ни капель, ни задержки.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;
const DECK = '.ptile[data-id="p1"] .ptile-task';
const LIST = '#task-list > li';

/** «Сайт»: открытые a (свежая), b, c; d — отменённая; e — выполненная (если done). */
async function seed(page, { reduce = false, done = false, view = 'projects' } = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ HOUR, done, view }) => {
    const now = new Date();
    state.projects.push({ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
    seedProjectStatuses('p1');
    const st = (kind) => orderedStatuses('p1').find((s) => s.kind === kind).id;
    const add = (id, title, ago, extra = {}) => state.tasks.push({
      id, projectId: 'p1', title, done: false, notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null,
      createdAt: now.toISOString(), updatedAt: new Date(now.getTime() - ago * HOUR).toISOString(),
      statusId: orderedStatuses('p1')[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
    });
    add('a', 'Альфа', 1);
    add('b', 'Бета', 2);
    add('c', 'Гамма', 3);
    add('d', 'Дельта', 4, { cancelled: true, statusId: st('cancelled') });
    if (done) add('e', 'Эпсилон', 5, { done: true, doneAt: now.toISOString(), statusId: st('done') });
    if (view === 'project') openProject('p1'); else openView(view);
  }, { HOUR, done, view });
  // Экран въезжает 0,6 с: мерить строки раньше — мерить въезд.
  await page.waitForFunction(() => document.querySelector('.view:not([hidden])').classList.contains('settled'));
}

/** Строки сверху вниз: id, положение, transform, классы строки и галочки. */
const rowsOf = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((n) => ({
  id: n.dataset.flipId, top: n.getBoundingClientRect().top, transform: getComputedStyle(n).transform,
})), sel);
const idsOf = async (page, sel) => (await rowsOf(page, sel)).map((r) => r.id);

/** Нажать из кода (Playwright прокрутил бы страницу к галочке) и записать по
 *  кадрам строки, переезды и капли. */
function clickAndWatch(page, target, sel, ms = 1300) {
  return page.evaluate(async ({ target, sel, ms }) => {
    const read = () => [...document.querySelectorAll(sel)].map((n) => ({
      id: n.dataset.flipId, top: n.getBoundingClientRect().top, transform: getComputedStyle(n).transform,
      move: n.classList.contains('flip-move'),
    }));
    const t0 = performance.now();
    document.querySelector(target).click();
    const box = document.querySelector(target.replace(/ \.(task-done|task-x)$/, '')).querySelector('.task-done, .task-x');
    const first = {
      rows: read(),
      box: box ? box.className : null,
      anims: box ? box.getAnimations({ subtree: true }).map((a) => a.animationName) : [],
      drops: document.querySelectorAll('.task-drops i').length,
    };
    const frames = [];
    while (performance.now() - t0 < ms) {
      await new Promise((r) => requestAnimationFrame(r));
      frames.push({ t: performance.now() - t0, rows: read(), drops: document.querySelectorAll('.task-drops i').length });
    }
    return { first, frames };
  }, { target, sel, ms });
}

const byId = (rows, id) => rows.find((r) => r.id === id);

test('Проекты: галочка наливается и брызгает, строка стоит ~600 мс и плавно уезжает к выполненным', async ({ page }) => {
  await seed(page);
  expect(await idsOf(page, DECK)).toEqual(['a', 'b', 'c', 'd']);
  const top0 = Object.fromEntries((await rowsOf(page, DECK)).map((r) => [r.id, r.top]));

  const run = await clickAndWatch(page, `${DECK}[data-flip-id="b"] .task-done`, DECK);

  // В миг нажатия: задача уже выполнена, галочка наливается, капли летят,
  // строка — на своём месте и уже тихая (зачёркнута).
  expect(run.first.box).toContain('liq-check');
  expect(run.first.anims).toEqual(expect.arrayContaining(['liqRise', 'checkMark', 'checkPop']));
  expect(run.first.drops, 'капли акцента').toBe(7);
  expect(run.first.rows.map((r) => r.id), 'строка не исчезла и не уехала сразу').toEqual(['a', 'b', 'c', 'd']);
  expect(await page.evaluate(() => getTask('b').done)).toBe(true);
  await expect(page.locator('.ptile[data-id="p1"] .ptile-count'), 'счётчик не ждёт переезда').toHaveText('1/4');
  await expect(page.locator(`${DECK}[data-flip-id="b"]`)).toHaveClass(/\bdone\b/);

  // Пока держится (до ~550 мс), строка стоит; потом едет.
  const held = run.frames.filter((f) => f.t < 550);
  expect(held.length).toBeGreaterThan(5);
  for (const f of held) {
    expect(byId(f.rows, 'b').top, `${Math.round(f.t)} мс: Бета на месте`).toBeCloseTo(top0.b, 0);
    expect(byId(f.rows, 'b').move).toBe(false);
  }
  const moving = run.frames.filter((f) => byId(f.rows, 'b').move);
  expect(moving.length, 'переезд был').toBeGreaterThan(0);
  expect(moving[0].t, 'переезд — после задержки').toBeGreaterThan(550);
  const mid = moving.find((f) => byId(f.rows, 'b').top > top0.b + 5 && byId(f.rows, 'b').top < top0.c - 5);
  expect(mid, 'в середине пути есть кадр между старым и новым местом').toBeTruthy();
  expect(byId(mid.rows, 'b').transform).not.toBe('none');
  // Едет только вниз, соседка Гамма — только вверх.
  const path = moving.map((f) => byId(f.rows, 'b').top);
  for (let i = 1; i < path.length; i += 1) expect(path[i]).toBeGreaterThanOrEqual(path[i - 1] - 0.5);

  // В конце: первой среди выполненных, под открытыми; капли растаяли.
  const last = run.frames.at(-1);
  expect(last.rows.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  expect(byId(last.rows, 'b').top).toBeCloseTo(top0.c, 0);
  for (const r of last.rows) expect(r.transform, r.id).toBe('none');
  expect(last.drops).toBe(0);
  await expect(page.locator('.task-drops')).toHaveCount(0);
  await expect(page.locator(`${DECK}[data-flip-id="b"] .task-done`)).toBeChecked();
});

test('список проекта: строка держит группу, потом уезжает в «Готово»; заголовки едут вместе с ней', async ({ page }) => {
  await seed(page, { view: 'project' });
  const done = await page.evaluate(() => orderedStatuses('p1').find((s) => s.kind === 'done').id);
  const cancelled = await page.evaluate(() => orderedStatuses('p1').find((s) => s.kind === 'cancelled').id);
  const ids0 = await idsOf(page, LIST);
  expect(ids0.filter((id) => !id.startsWith('group:'))).toEqual(['a', 'b', 'c', 'd']);
  // Отменённая — с серым крестиком, а не с пустой галочкой.
  await expect(page.locator('.task-item[data-id="d"] .task-x')).toHaveCount(1);
  await expect(page.locator('.task-item[data-id="d"] .task-done')).toHaveCount(0);
  const top0 = Object.fromEntries((await rowsOf(page, LIST)).map((r) => [r.id, r.top]));

  const run = await clickAndWatch(page, '.task-item[data-id="b"] .task-done', LIST);
  expect(run.first.box).toContain('liq-check');
  expect(run.first.drops).toBe(7);
  expect(run.first.rows.map((r) => r.id), 'пока держится — в своей группе').toEqual(ids0);

  const moving = run.frames.filter((f) => byId(f.rows, 'b') && byId(f.rows, 'b').move);
  expect(moving.length).toBeGreaterThan(0);
  expect(moving[0].t).toBeGreaterThan(550);
  // Едет именно переездом (transform), а не въездом строки заново.
  const endTop = byId(run.frames.at(-1).rows, 'b').top;
  const mid = moving.find((f) => byId(f.rows, 'b').top > top0.b + 5 && byId(f.rows, 'b').top < endTop - 5);
  expect(mid, 'в середине пути есть кадр между старым и новым местом').toBeTruthy();
  expect(byId(mid.rows, 'b').transform).not.toBe('none');
  // Группа «Отменено» уступает место «Готово» — заголовок едет, а не прыгает.
  expect(run.frames.some((f) => byId(f.rows, `group:${cancelled}`).move), 'заголовок соседней группы едет').toBe(true);

  const last = run.frames.at(-1).rows.map((r) => r.id);
  const at = last.indexOf(`group:${done}`);
  expect(at, 'появилась группа «Готово»').toBeGreaterThan(-1);
  expect(last[at + 1], 'Бета — в ней').toBe('b');
  expect(last.filter((id) => !id.startsWith('group:'))).toEqual(['a', 'c', 'b', 'd']);
  expect(byId(run.frames.at(-1).rows, 'b').top).toBeGreaterThan(top0.c);
  await expect(page.locator('.task-item[data-id="b"]')).toHaveClass(/\bdone\b/);
  await expect(page.locator('.flip-move')).toHaveCount(0);
});

test('двойной щелчок в пределах задержки не снимает отметку и не путает порядок', async ({ page }) => {
  await seed(page);
  const cb = `${DECK}[data-flip-id="b"] .task-done`;
  await page.evaluate(async (s) => {
    document.querySelector(s).click();
    await new Promise((r) => setTimeout(r, 120));
    // Строку уже перерисовали — щёлкаем ту галочку, что видна сейчас.
    document.querySelector(s).click();
  }, cb);
  // Второй щелчок по строке, которую держат, ничего не меняет.
  expect(await page.evaluate(() => getTask('b').done)).toBe(true);
  await expect(page.locator(cb)).toBeChecked();
  await expect.poll(() => page.evaluate(() => rowHolds.size), { timeout: 2000 }).toBe(0);
  await expect(page.locator('.flip-move')).toHaveCount(0);
  expect(await idsOf(page, DECK)).toEqual(['a', 'c', 'b', 'd']);
  await expect(page.locator(`${DECK}[data-flip-id="b"]`)).toHaveCount(1);
  await expect(page.locator(cb)).toBeChecked();
  // После переезда галочка снова слушается: снять можно.
  await page.locator(cb).uncheck();
  expect(await page.evaluate(() => getTask('b').done)).toBe(false);
});

test('снятая галочка — акцент стекает, без брызг; строка уезжает обратно наверх', async ({ page }) => {
  await seed(page, { done: true });
  expect(await idsOf(page, DECK)).toEqual(['a', 'b', 'c', 'e', 'd']);
  const top0 = Object.fromEntries((await rowsOf(page, DECK)).map((r) => [r.id, r.top]));

  const run = await clickAndWatch(page, `${DECK}[data-flip-id="e"] .task-done`, DECK, 1000);
  expect(run.first.box).toContain('liq-uncheck');
  expect(run.first.anims).toContain('liqFall');
  expect(run.first.drops, 'без брызг').toBe(0);
  expect(await page.evaluate(() => getTask('e').done)).toBe(false);
  expect(run.first.rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'e', 'd']);

  const moving = run.frames.filter((f) => byId(f.rows, 'e').move);
  expect(moving.length).toBeGreaterThan(0);
  expect(moving[0].t, 'стоит, пока стекает').toBeGreaterThan(280);
  const path = moving.map((f) => byId(f.rows, 'e').top);
  for (let i = 1; i < path.length; i += 1) expect(path[i], 'только вверх').toBeLessThanOrEqual(path[i - 1] + 0.5);
  const last = run.frames.at(-1).rows;
  // Снятая — свежая, поэтому первая среди открытых.
  expect(last.map((r) => r.id)).toEqual(['e', 'a', 'b', 'c', 'd']);
  expect(byId(last, 'e').top).toBeCloseTo(top0.a, 0);
  expect(run.frames.every((f) => f.drops === 0)).toBe(true);
});

test('отменённая — серый крестик «Вернуть в работу»; щелчок возвращает задачу, строка едет наверх', async ({ page }) => {
  await seed(page);
  const x = page.locator(`${DECK}[data-flip-id="d"] .task-x`);
  await expect(x).toHaveAttribute('aria-label', 'Вернуть в работу');
  await expect(page.locator(`${DECK}[data-flip-id="d"] .task-done`)).toHaveCount(0);
  // Крестик — тот же квадрат, что галочка: сторона и скругление, подложка --raise.
  const look = await page.evaluate(() => {
    const n = document.querySelector('.ptile-task[data-id="d"] .task-x');
    const cb = document.querySelector('.ptile-task[data-id="a"] .task-done');
    const probe = document.createElement('i');
    probe.style.background = 'var(--raise)';
    document.body.append(probe);
    const raise = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const r = n.getBoundingClientRect();
    const c = cb.getBoundingClientRect();
    return { w: r.width, h: r.height, cw: c.width, radius: getComputedStyle(n).borderTopLeftRadius, cradius: getComputedStyle(cb).borderTopLeftRadius, bg: getComputedStyle(n).backgroundColor, raise };
  });
  expect([look.w, look.h]).toEqual([look.cw, look.cw]);
  expect(look.radius).toBe(look.cradius);
  expect(look.bg).toBe(look.raise);

  const run = await clickAndWatch(page, `${DECK}[data-flip-id="d"] .task-x`, DECK, 1000);
  expect(run.first.drops).toBe(0);
  expect(await page.evaluate(() => isCancelledTask(getTask('d')))).toBe(false);
  // На месте крестика — пустая галочка, она выпрыгивает.
  expect(run.first.box).toContain('task-done');
  expect(run.first.box).toContain('liq-uncross');
  expect(run.frames.some((f) => byId(f.rows, 'd').move), 'переезд был').toBe(true);
  expect(run.frames.at(-1).rows.map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']);
  // Щелчок по крестику задачу не открывает.
  expect(await page.evaluate(() => state.ui.view)).toBe('projects');
});

test('закрыли не галочкой (агент, синхронизация) — крестик прорисовывается, строка едет вниз', async ({ page }) => {
  await seed(page);
  const run = await page.evaluate(async () => {
    const cancelled = orderedStatuses('p1').find((s) => s.kind === 'cancelled').id;
    setTaskStatus(getTask('a'), cancelled);
    flipSoon();
    render();
    const box = document.querySelector('.ptile-task[data-id="a"] .task-x');
    const out = { box: box && box.className, anims: box ? box.getAnimations({ subtree: true }).map((x) => x.animationName) : [], moving: !!document.querySelector('.ptile-task[data-id="a"].flip-move') };
    await new Promise((r) => setTimeout(r, 700));
    out.ids = [...document.querySelectorAll('.ptile[data-id="p1"] .ptile-task')].map((n) => n.dataset.id);
    return out;
  });
  expect(run.box).toContain('liq-cross');
  expect(run.anims).toEqual(expect.arrayContaining(['crossIn', 'crossDraw']));
  expect(run.moving, 'строка едет').toBe(true);
  // Отменённые — внизу, свежая выше.
  expect(run.ids).toEqual(['b', 'c', 'a', 'd']);
  await expect(page.locator('.task-drops')).toHaveCount(0);
});

test('без движения: ни налива, ни капель, ни задержки — строка сразу на новом месте', async ({ page }) => {
  await seed(page, { reduce: true });
  const run = await clickAndWatch(page, `${DECK}[data-flip-id="b"] .task-done`, DECK, 300);
  expect(run.first.rows.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  expect(run.first.box).not.toMatch(/liq-/);
  expect(run.first.anims).toEqual([]);
  expect(run.first.drops).toBe(0);
  for (const f of run.frames) {
    expect(f.rows.every((r) => !r.move && r.transform === 'none')).toBe(true);
    expect(f.drops).toBe(0);
  }
  expect(await page.evaluate(() => rowHolds.size)).toBe(0);

  // Список проекта — так же.
  await page.evaluate(() => openProject('p1'));
  await page.locator('.task-item[data-id="a"] .task-done').check();
  const ids = await idsOf(page, LIST);
  expect(ids.filter((id) => !id.startsWith('group:'))).toEqual(['c', 'a', 'b', 'd']);
  await expect(page.locator('.flip-move')).toHaveCount(0);
});

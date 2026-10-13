// Порядок строк: запуск задачи не переставляет списки, остановка — плавный
// переезд наверх. Запуск: npm run test:e2e
//
// 11 октября 2026 пользователь написал: «На вебе в любом из списков задач
// (карточки проекта, недавние и т. д.) когда включаешь задачу, она резко
// прыгает вверх списка. Пусть она не прыгнет вверх, пока мы не уйдём со
// страницы и не вернёмся, или пока не остановим задачу. Но даже когда
// остановим, должна быть красивая анимация перехода задачи в самый верх».
//
// Откуда прыжок: «недавние» ставят задачу по последней записи, а у идущей
// она — «сейчас», то есть первая. Теперь запуск порядок не трогает
// (Core.holdOrder, app.js — «Порядок строк»), остановка снимает заморозку, и
// строки переезжают на новые места (FLIP: .flip-move).
//
// Мерим не глазом: положение строк getBoundingClientRect, вычисленный
// transform по кадрам и getAnimations(). Часы страницы прибиты, поэтому
// между запуском и остановкой их сдвигаем: запись короче секунды не
// сохраняется, и «свежей» у остановленной задачи не было бы.
const { test, expect } = require('@playwright/test');
const { ANCHOR, pinClock } = require('./clock');

const HOUR = 3_600_000;

/** Задачи: у каждой запись и отметка изменения, чем раньше — тем старее.
 *  Недавние: a b c d e (по последней записи), карточка «Сайта»: a b c f. */
async function seed(page, { view = 'projects', reduce = false } = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ HOUR, view }) => {
    const now = new Date();
    const mk = (id, name, color) => {
      state.projects.push({ id, name, color, description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
      seedProjectStatuses(id);
    };
    mk('p1', 'Сайт', '#87ff65');
    mk('p2', 'Приложение', '#5ec8f2');
    const at = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d; };
    const ses = (start, end) => ({ start: start.toISOString(), end: end.toISOString(), ms: end - start });
    const add = (id, pid, title, sessions, ago) => state.tasks.push({
      id, projectId: pid, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: new Date(now.getTime() - ago * HOUR).toISOString(),
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    add('a', 'p1', 'Альфа', [ses(at(11, 0), at(11, 30))], 1);
    add('b', 'p1', 'Бета', [ses(at(10, 0), at(10, 30))], 2);
    add('c', 'p1', 'Гамма', [ses(at(9, 0), at(9, 30))], 3);
    add('d', 'p2', 'Дельта', [ses(at(8, 0), at(8, 30))], 4);
    add('e', 'p2', 'Эпсилон', [ses(at(7, 0), at(7, 30))], 5);
    add('f', 'p1', 'Ноль', [], 6);
    openView(view);
  }, { HOUR, view });
  // Экран въезжает 0,6 с, и карточки с ним: мерить положение строк раньше
  // значит мерить въезд, а не порядок.
  await settled(page);
}

/** Экран въехал и осел (.settled): строки стоят на своих местах. */
const settled = (page) => page.waitForFunction(() => document.querySelector('.view:not([hidden])').classList.contains('settled'));

/** Часы страницы вперёд на пять секунд: запись дольше секунды сохраняется. */
const tick = (page) => page.clock.setFixedTime(new Date(new Date(ANCHOR).getTime() + 5000));

// Списки: чем меряем строки. id строки — dataset.flipId, все помечены flipTag.
const DECK = '.ptile[data-id="p1"] .ptile-task';
const RECENT = '#recent-track .recent-row';
const TODAY = '#recent-list > li';
const CARDS = '#home-proj-grid .hp-card';

/** Строки списка сверху вниз: id, положение и вычисленный transform. */
const rowsOf = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((n) => {
  const r = n.getBoundingClientRect();
  return { id: n.dataset.flipId, top: r.top, left: r.left, transform: getComputedStyle(n).transform };
}), sel);
const idsOf = async (page, sel) => (await rowsOf(page, sel)).map((r) => r.id);
const topsOf = async (page, sel) => Object.fromEntries((await rowsOf(page, sel)).map((r) => [r.id, r.top]));

/** Кнопка запуска строки: ходим по id задачи, а не по положению. */
const play = (sel, id) => `${sel}[data-flip-id="${id}"] .rl-play`;

/** Нажать кнопку из кода: настоящий щелчок Playwright сперва прокручивает страницу к кнопке, и
 *  положение строк уезжает не от порядка, а от прокрутки. */
const press = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

/** Сколько переездов (flipMove) идёт сейчас на странице. */
const flips = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'flipMove').length);

/** Нажать кнопку и записать по кадрам строки списков: [{sel: rows}, …]. */
function pressAndWatch(page, button, sels, ms = 700) {
  return page.evaluate(async ({ button, sels, ms }) => {
    const read = () => Object.fromEntries(sels.map((s) => [s, [...document.querySelectorAll(s)].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.dataset.flipId, top: r.top, left: r.left, transform: getComputedStyle(n).transform };
    })]));
    const count = () => document.getAnimations().filter((a) => a.animationName === 'flipMove').length;
    document.querySelector(button).click();
    const first = read();
    const firstFlips = count();
    const frames = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => requestAnimationFrame(r));
      frames.push({ rows: read(), flips: count() });
    }
    return { first, firstFlips, frames };
  }, { button, sels, ms });
}

const byId = (rows, id) => rows.find((r) => r.id === id);

// --- «Проекты»: карточка и недавние ------------------------------------------

test('Проекты: запуск не переставляет ни карточку, ни недавние, строка меняется на месте', async ({ page }) => {
  await seed(page);
  expect(await idsOf(page, DECK)).toEqual(['a', 'b', 'c', 'f']);
  expect(await idsOf(page, RECENT)).toEqual(['a', 'b', 'c', 'd', 'e']);
  const deck0 = await topsOf(page, DECK);
  const recent0 = await topsOf(page, RECENT);

  // «Гамма» — третья и в карточке, и в недавних; без заморозки она встала бы первой.
  await press(page, play(RECENT, 'c'));
  await expect(page.locator('#tb-timer')).toBeVisible();
  expect(await idsOf(page, DECK), 'порядок карточки').toEqual(['a', 'b', 'c', 'f']);
  expect(await idsOf(page, RECENT), 'порядок недавних').toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(await topsOf(page, DECK), 'положение строк карточки').toEqual(deck0);
  expect(await topsOf(page, RECENT), 'положение недавних').toEqual(recent0);
  expect(await flips(page), 'на запуске никто не переезжает').toBe(0);
  // Сама строка при этом сменилась: «идёт» и стоп вместо плея.
  await expect(page.locator(`${RECENT}[data-flip-id="c"] .recent-when`)).toHaveClass(/run/);
  await expect(page.locator(`${DECK}[data-flip-id="c"]`)).toHaveClass(/run/);

  // Перерисовка, пока идёт таймер (синхронизация, галочка), заморозку не снимает.
  await page.evaluate(() => render());
  expect(await idsOf(page, RECENT)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(await idsOf(page, DECK)).toEqual(['a', 'b', 'c', 'f']);
});

test('Проекты: остановленная задача плавно уезжает на первое место, остальные сдвигаются', async ({ page }) => {
  await seed(page);
  const deck0 = await topsOf(page, DECK);
  const recent0 = await topsOf(page, RECENT);
  await press(page, play(RECENT, 'c'));
  await tick(page);

  const run = await pressAndWatch(page, `${RECENT}[data-flip-id="c"] .rl-play`, [RECENT, DECK]);

  // Порядок после остановки — сразу обычный: Гамма первая и там и там.
  expect(run.first[RECENT].map((r) => r.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
  expect(run.first[DECK].map((r) => r.id)).toEqual(['c', 'a', 'b', 'f']);
  expect(run.firstFlips, 'переезд начался с остановкой').toBeGreaterThan(0);

  // В первом кадре строка ещё там, где стояла: ни скачка, ни рывка.
  expect(byId(run.first[RECENT], 'c').top, 'недавние: Гамма стартует со своего места').toBeCloseTo(recent0.c, 0);
  expect(byId(run.first[DECK], 'c').top, 'карточка: Гамма стартует со своего места').toBeCloseTo(deck0.c, 0);
  expect(byId(run.first[RECENT], 'c').transform).not.toBe('none');
  expect(byId(run.first[RECENT], 'a').transform, 'а соседи тоже сдвигаются').not.toBe('none');

  // По кадрам: Гамма идёт только вверх, а в середине пути transform не none.
  const path = run.frames.map((f) => byId(f.rows[RECENT], 'c').top);
  for (let i = 1; i < path.length; i += 1) expect(path[i], `кадр ${i}: не возвращается назад`).toBeLessThanOrEqual(path[i - 1] + 0.5);
  const mid = run.frames.find((f) => f.flips > 0 && byId(f.rows[RECENT], 'c').top < recent0.c - 5 && byId(f.rows[RECENT], 'c').top > recent0.a + 5);
  expect(mid, 'в середине пути есть кадр между старым и новым местом').toBeTruthy();
  expect(byId(mid.rows[RECENT], 'c').transform).not.toBe('none');
  // Соседи едут вниз и не расходятся с итогом.
  const aPath = run.frames.map((f) => byId(f.rows[RECENT], 'a').top);
  for (let i = 1; i < aPath.length; i += 1) expect(aPath[i], `кадр ${i}: Альфа идёт только вниз`).toBeGreaterThanOrEqual(aPath[i - 1] - 0.5);

  // В конце — на месте и без трансформа.
  const last = run.frames.at(-1);
  expect(last.flips, 'переезд закончился').toBe(0);
  for (const sel of [RECENT, DECK]) for (const r of last.rows[sel]) expect(r.transform, `${sel} ${r.id}`).toBe('none');
  expect(byId(last.rows[RECENT], 'c').top).toBeCloseTo(recent0.a, 0);
  expect(byId(last.rows[RECENT], 'a').top).toBeCloseTo(recent0.b, 0);
  expect(byId(last.rows[RECENT], 'b').top).toBeCloseTo(recent0.c, 0);
  expect(byId(last.rows[DECK], 'c').top).toBeCloseTo(deck0.a, 0);
  await expect(page.locator('.flip-move')).toHaveCount(0);
  await expect(page.locator('.flip-lead')).toHaveCount(0);
});

test('Проекты: ушли на другой экран и вернулись — идущая первая, без движения', async ({ page }) => {
  await seed(page);
  await press(page, play(RECENT, 'c'));
  expect(await idsOf(page, RECENT)).toEqual(['a', 'b', 'c', 'd', 'e']);

  await page.locator('.nav-item:not(.mtab)[data-view="time"]').click();
  await expect(page.locator('#time-view')).toBeVisible();
  await page.locator('.nav-item:not(.mtab)[data-view="projects"]').click();
  await expect(page.locator('#projects-view')).toBeVisible();
  await settled(page);

  // Порядок посчитан заново: идущая — первая и в недавних, и в карточке.
  expect(await idsOf(page, RECENT)).toEqual(['c', 'a', 'b', 'd', 'e']);
  expect(await idsOf(page, DECK)).toEqual(['c', 'a', 'b', 'f']);
  expect(await flips(page), 'переезда нет').toBe(0);
  await expect(page.locator('.flip-move')).toHaveCount(0);
  for (const r of await rowsOf(page, RECENT)) expect(r.transform, `недавние ${r.id}`).toBe('none');

  // И заморозка началась заново: запуск другой задачи тут тоже ничего не двигает
  // (идущая «Гамма» при этом останавливается, но она и так первая).
  await tick(page);
  const recent0 = await topsOf(page, RECENT);
  await press(page, play(RECENT, 'e'));
  expect(await topsOf(page, RECENT)).toEqual(recent0);
});

test('Проекты: задача без записей встаёт в недавних первой, карточка стоит как стояла', async ({ page }) => {
  await seed(page);
  // «Ноль» последняя в карточке и в недавних её нет; запуск — карточка не
  // меняется, а в недавних новая строка встаёт по обычному правилу, первой.
  await press(page, `.ptile[data-id="p1"] .ptile-task[data-id="f"] .rl-play`);
  expect(await idsOf(page, DECK)).toEqual(['a', 'b', 'c', 'f']);
  expect(await idsOf(page, RECENT)).toEqual(['f', 'a', 'b', 'c', 'd', 'e']);
  await tick(page);
  await press(page, `.ptile[data-id="p1"] .ptile-task[data-id="f"] .rl-play`);
  // Остановили: теперь по записи она и правда свежая — первая и в карточке.
  expect(await idsOf(page, DECK)).toEqual(['f', 'a', 'b', 'c']);
  expect(await idsOf(page, RECENT)).toEqual(['f', 'a', 'b', 'c', 'd', 'e']);
});

test('Проекты: переключение на другую задачу — прежняя уезжает наверх, новая стоит на месте', async ({ page }) => {
  await seed(page);
  await press(page, play(RECENT, 'c'));
  await tick(page);
  const before = await topsOf(page, RECENT);
  // «Дельта» (четвёртая): «Гамма» остановилась и встала первой, «Дельта» — где была.
  await press(page, play(RECENT, 'd'));
  expect(await idsOf(page, RECENT)).toEqual(['c', 'a', 'b', 'd', 'e']);
  await expect(page.locator(`${RECENT}[data-flip-id="d"] .recent-when`)).toHaveClass(/run/);
  // Дельта осталась в четвёртой строке: её место не сдвинулось.
  await expect.poll(async () => (await topsOf(page, RECENT)).d, { timeout: 2000 }).toBeCloseTo(before.d, 0);
  await expect.poll(() => flips(page), { timeout: 2000 }).toBe(0);
  const after = await topsOf(page, RECENT);
  expect(after.c).toBeCloseTo(before.a, 0);
});

// --- «Сегодня» ---------------------------------------------------------------

test('Сегодня: запуск не двигает ни недавние, ни проекты; остановка — переезд обоих', async ({ page }) => {
  await seed(page, { view: 'home' });
  expect(await idsOf(page, TODAY)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(await idsOf(page, CARDS)).toEqual(['p1', 'p2']);
  const today0 = await topsOf(page, TODAY);
  const cards0 = await rowsOf(page, CARDS);

  // «Дельта» из проекта «Приложение»: по последней записи проекты — Сайт, Приложение.
  await press(page, `#recent-list > li[data-flip-id="d"] .rl-play`);
  await expect(page.locator('#tb-timer')).toBeVisible();
  expect(await idsOf(page, TODAY)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(await topsOf(page, TODAY)).toEqual(today0);
  expect(await idsOf(page, CARDS)).toEqual(['p1', 'p2']);
  expect(await flips(page)).toBe(0);

  await tick(page);
  const run = await pressAndWatch(page, `#recent-list > li[data-flip-id="d"] .rl-play`, [TODAY, CARDS]);
  expect(run.first[TODAY].map((r) => r.id)).toEqual(['d', 'a', 'b', 'c', 'e']);
  expect(run.first[CARDS].map((r) => r.id), 'у «Приложения» теперь свежая запись — оно первое').toEqual(['p2', 'p1']);
  expect(run.firstFlips).toBeGreaterThan(0);
  expect(byId(run.first[TODAY], 'd').top).toBeCloseTo(today0.d, 0);
  expect(byId(run.first[CARDS], 'p2').left, 'карточка проекта стартует со своего места').toBeCloseTo(cards0[1].left, 0);
  expect(byId(run.first[CARDS], 'p2').transform).not.toBe('none');

  const last = run.frames.at(-1);
  expect(last.flips).toBe(0);
  expect(byId(last.rows[TODAY], 'd').top).toBeCloseTo(today0.a, 0);
  expect(byId(last.rows[CARDS], 'p2').left).toBeCloseTo(cards0[0].left, 0);
  expect(byId(last.rows[CARDS], 'p1').left).toBeCloseTo(cards0[1].left, 0);
  for (const sel of [TODAY, CARDS]) for (const r of last.rows[sel]) expect(r.transform, `${sel} ${r.id}`).toBe('none');
});

test('Сегодня: ушли и вернулись — идущая первая в недавних, без движения', async ({ page }) => {
  await seed(page, { view: 'home' });
  await press(page, `#recent-list > li[data-flip-id="c"] .rl-play`);
  expect(await idsOf(page, TODAY)).toEqual(['a', 'b', 'c', 'd', 'e']);
  await page.locator('.nav-item:not(.mtab)[data-view="projects"]').click();
  await expect(page.locator('#projects-view')).toBeVisible();
  await page.locator('.nav-item:not(.mtab)[data-view="home"]').click();
  await expect(page.locator('#home-view')).toBeVisible();
  await settled(page);
  expect(await idsOf(page, TODAY)).toEqual(['c', 'a', 'b', 'd', 'e']);
  expect(await flips(page)).toBe(0);
});

// --- Страница проекта ---------------------------------------------------------

test('Страница проекта: порядок задач от таймера не зависит — ни на запуске, ни на остановке', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openProject('p1'));
  await expect(page.locator('#project-view')).toBeVisible();
  await settled(page);
  const LIST = '#task-list .task-item';
  const ids = () => page.evaluate((s) => [...document.querySelectorAll(s)].map((n) => n.dataset.id), LIST);
  const topOf = (id) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, `${LIST}[data-id="${id}"]`);
  expect(await ids()).toEqual(['a', 'b', 'c', 'f']);
  // Идущая получает в строке пометку и вырастает: ниже неё строки сдвигаются
  // на эту высоту, а до неё и она сама стоят на месте.
  const before = { a: await topOf('a'), b: await topOf('b'), c: await topOf('c') };

  await page.evaluate(() => startTimer('c'));
  expect(await ids(), 'запуск: порядок').toEqual(['a', 'b', 'c', 'f']);
  expect({ a: await topOf('a'), b: await topOf('b'), c: await topOf('c') }, 'запуск: строки до идущей и она сама на месте').toEqual(before);
  await tick(page);
  await page.evaluate(() => stopTimer());
  expect(await ids(), 'остановка: порядок').toEqual(['a', 'b', 'c', 'f']);
  expect({ a: await topOf('a'), b: await topOf('b'), c: await topOf('c') }, 'остановка: строки на месте').toEqual(before);
  expect(await flips(page), 'в списке проекта нечему переезжать').toBe(0);
});

// --- Перерисовка посреди переезда ---------------------------------------------

test('перерисовка посреди переезда его не сбрасывает: строка не возвращается назад', async ({ page }) => {
  await seed(page);
  const recent0 = await topsOf(page, RECENT);
  await press(page, play(RECENT, 'c'));
  await tick(page);

  // Останавливаем и сразу перерисовываем страницу каждые 50 мс, как это
  // делают синхронизация и переключение таймера.
  const out = await page.evaluate(async ({ RECENT }) => {
    const top = () => document.querySelector(`${RECENT}[data-flip-id="c"]`).getBoundingClientRect().top;
    const names = () => document.getAnimations().filter((a) => a.animationName === 'flipMove').length;
    stopTimer();
    const frames = [{ top: top(), flips: names() }];
    const t0 = performance.now();
    let last = 0;
    while (performance.now() - t0 < 700) {
      await new Promise((r) => requestAnimationFrame(r));
      if (performance.now() - last > 50) { render(); last = performance.now(); }
      frames.push({ top: top(), flips: names() });
    }
    return frames;
  }, { RECENT });

  for (let i = 1; i < out.length; i += 1) expect(out[i].top, `кадр ${i}: не возвращается назад`).toBeLessThanOrEqual(out[i - 1].top + 0.5);
  expect(out[0].top).toBeCloseTo(recent0.c, 0);
  expect(out.slice(0, 5).every((f) => f.flips > 0), 'переезд идёт, пока его перерисовывают').toBe(true);
  expect(out.at(-1).top).toBeCloseTo(recent0.a, 0);
  expect(out.at(-1).flips).toBe(0);
});

// --- Без движения ---------------------------------------------------------------

test('prefers-reduced-motion: строки встают на место сразу, переезда нет', async ({ page }) => {
  await seed(page, { reduce: true });
  const recent0 = await topsOf(page, RECENT);
  await press(page, play(RECENT, 'c'));
  expect(await idsOf(page, RECENT)).toEqual(['a', 'b', 'c', 'd', 'e']);
  await tick(page);
  const run = await pressAndWatch(page, `${RECENT}[data-flip-id="c"] .rl-play`, [RECENT, DECK], 400);
  expect(run.first[RECENT].map((r) => r.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
  expect(run.firstFlips).toBe(0);
  expect(byId(run.first[RECENT], 'c').top, 'сразу на новом месте').toBeCloseTo(recent0.a, 0);
  for (const f of run.frames) {
    expect(f.flips).toBe(0);
    for (const r of f.rows[RECENT]) expect(r.transform).toBe('none');
  }
  await expect(page.locator('.flip-move')).toHaveCount(0);
});

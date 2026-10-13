// Движение: жидкий старт таймера, подложка вкладок, колокольчик и форма
// кнопки запуска. Запуск: npm run test:e2e
//
// 11 октября 2026 пользователь попросил: «Старт» в шапке перетекает в капсулу
// таймера, как капля, и стекает обратно; кнопки запуска в строках задач
// «наливаются»; подложка сегментных вкладок переезжает под нажатую, а не
// перескакивает; колокольчик с непрочитанным позванивает. Тут же — кнопки
// запуска и галочки задач стали скруглёнными квадратами одного токена.
//
// Анимацию мерим не глазом, а тем, что видит браузер: getAnimations(),
// вычисленными стилями по кадрам (requestAnimationFrame) и положением
// элементов в начале, в середине и в конце. И везде — prefers-reduced-motion:
// с ним никакого движения, конечное состояние сразу.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function seed(page, { unread = false, reduce = false, width = 1280 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ HOUR, unread }) => {
    const now = new Date();
    const mk = (id, name, color) => {
      state.projects.push({ id, name, color, description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] });
      seedProjectStatuses(id);
    };
    mk('p1', 'Сайт', '#87ff65');
    mk('p2', 'Приложение', '#5ec8f2');
    const at = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d; };
    const ses = (s, e) => ({ start: s.toISOString(), end: e.toISOString(), ms: e - s });
    const add = (id, pid, title, sessions, extra = {}) => state.tasks.push({
      id, projectId: pid, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
    });
    add('t1', 'p1', 'Вёрстка', [ses(at(9), at(10))]);
    add('t2', 'p2', 'Экран входа', [ses(at(10, 30), at(11))]);
    // Просроченный срок — непрочитанное уведомление.
    if (unread) add('t3', 'p1', 'Форма', [], { dueAt: new Date(now.getTime() - 2 * HOUR).toISOString() });
    state.ui.notifSeenAt = null;
    state.ui.view = 'home';
    render();
  }, { HOUR, unread });
}

/** Имена CSS-анимаций узла и его потомков (с ::before/::after). */
const animNames = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  return n ? n.getAnimations({ subtree: true }).map((a) => a.animationName).filter(Boolean) : [];
}, sel);

/** Дождаться, пока у узла кончатся CSS-анимации. */
async function settle(page, sel) {
  await expect.poll(() => animNames(page, sel), { timeout: 3000 }).toEqual([]);
}

// --- 1. Шапка: «Старт» перетекает в капсулу и обратно -------------------------------

test('шапка: «Старт» перетекает в капсулу и стекает обратно, поиск не двигается', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#tb-start')).toBeVisible();
  const search0 = await page.evaluate(() => { const r = document.querySelector('.tb-search').getBoundingClientRect(); return [r.x, r.width]; });

  /** Нажать и записать по кадрам: обрез капсулы, видимость, место поиска. */
  const pour = (sel) => page.evaluate(async (s) => {
    const timer = document.getElementById('tb-timer');
    document.querySelector(s).click();
    const names = timer.getAnimations({ subtree: true }).map((a) => a.animationName);
    const frames = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 900) {
      await new Promise((r) => requestAnimationFrame(r));
      const r = document.querySelector('.tb-search').getBoundingClientRect();
      frames.push({ clip: getComputedStyle(timer).clipPath, shown: !timer.hidden, search: [r.x, r.width] });
    }
    return { names, frames };
  }, sel);

  const grow = await pour('#tb-start');
  expect(grow.names, 'запуск: капсула проявляется, капля и бусина движутся').toEqual(expect.arrayContaining(['liqReveal', 'liqStretch', 'liqDropIn', 'liqBeadOut']));
  const clips = new Set(grow.frames.map((f) => f.clip).filter((c) => c !== 'none'));
  expect(clips.size, 'обрез капсулы меняется во времени').toBeGreaterThan(3);
  for (const f of grow.frames) {
    expect(Math.abs(f.search[0] - search0[0]) + Math.abs(f.search[1] - search0[1]), 'поиск стоит на месте весь перелив').toBeLessThanOrEqual(0.5);
  }
  await settle(page, '#tb-timer');
  await expect(page.locator('#tb-timer')).toBeVisible();
  await expect(page.locator('#tb-timer')).not.toHaveClass(/liq-/);
  await expect(page.locator('#tb-start')).toBeHidden();
  await expect(page.locator('#tb-timer')).toHaveCSS('clip-path', 'none');

  const shrink = await pour('#tb-timer-stop');
  expect(shrink.names, 'стоп: капсула стекает, бусина возвращается').toEqual(expect.arrayContaining(['liqDrain', 'liqDropOut', 'liqBeadIn']));
  expect(shrink.frames[0].shown, 'стекающая капсула видна, пока не стечёт').toBe(true);
  expect(shrink.frames.at(-1).shown, 'и прячется, когда стекла').toBe(false);
  for (const f of shrink.frames) {
    expect(Math.abs(f.search[0] - search0[0]) + Math.abs(f.search[1] - search0[1]), 'поиск стоит на месте и при стопе').toBeLessThanOrEqual(0.5);
  }
  await expect(page.locator('#tb-start')).toBeVisible();
  await expect(page.locator('#tb-start')).not.toHaveClass(/liq-/);
  await expect(page.locator('#tb-timer')).toBeHidden();
});

test('шапка: запуск из строки задачи тоже переливает шапку, повторный стоп посреди анимации не ломает её', async ({ page }) => {
  await seed(page);
  await page.locator('#recent-list .rl-play').first().click();
  expect(await animNames(page, '#tb-timer')).toContain('liqReveal');
  // Стоп, не дожидаясь конца налива: капсула стекает, в конце — «Старт».
  await page.evaluate(() => stopTimer());
  expect(await animNames(page, '#tb-timer')).toContain('liqDrain');
  await settle(page, '#tb-timer');
  await expect(page.locator('#tb-timer')).toBeHidden();
  await expect(page.locator('#tb-start')).toBeVisible();
});

test('шапка без движения (reduced motion): капсула и «Старт» меняются сразу', async ({ page }) => {
  await seed(page, { reduce: true });
  const r = await page.evaluate(() => {
    document.getElementById('tb-start').click();
    const timer = document.getElementById('tb-timer');
    const a = { shown: !timer.hidden, start: !document.getElementById('tb-start').hidden, anims: timer.getAnimations({ subtree: true }).length, cls: timer.className };
    document.getElementById('tb-timer-stop').click();
    return { ...a, after: !timer.hidden, anims2: timer.getAnimations({ subtree: true }).length };
  });
  expect(r).toEqual({ shown: true, start: false, anims: 0, cls: 'tb-timer', after: false, anims2: 0 });
});

// --- 2. Кнопки запуска в строках наливаются и стекают ----------------------------------

/** Места, где стоит кнопка запуска: как туда попасть и где её искать. */
const PLACES = [
  { name: '«Сегодня»: недавние задачи', open: () => openView('home'), box: '#recent-list', btn: '#recent-list .rl-play' },
  { name: '«Сегодня»: сейчас идёт', open: () => openView('home'), box: '.now-island', btn: '#now-btn' },
  { name: '«Проекты»: карточка проекта', open: () => openView('projects'), box: '#projects-track', btn: '.ptile-task .rl-play' },
  { name: '«Проекты»: недавние задачи', open: () => openView('projects'), box: '#recent-track', btn: '.recent-row .rl-play' },
  { name: 'страница задачи', open: () => { openProject('p1'); selectTask('t1'); }, box: '.task-timer-island', btn: '#timer-btn' },
];

for (const place of PLACES) {
  test(`кнопка запуска наливается и стекает: ${place.name}`, async ({ page }) => {
    await seed(page);
    await page.evaluate(place.open);
    const btn = page.locator(place.btn).first();
    await expect(btn).toBeVisible();
    await btn.click();
    const fill = page.locator(`${place.box} .liq-fill`);
    await expect(fill, 'запустили — кнопка наливается').toHaveCount(1);
    const names = await page.evaluate((s) => document.querySelector(s).getAnimations({ subtree: true }).map((a) => a.animationName), `${place.box} .liq-fill`);
    expect(names).toEqual(expect.arrayContaining(['liqJelly', 'liqRise', 'liqPop']));
    await expect(fill, 'налив кончился — класс снят').toHaveCount(0, { timeout: 3000 });
    await page.mouse.move(1, 899); // под указателем акцент темнее (:hover)
    const colors = () => page.evaluate((s) => {
      const btn = document.querySelector(`${s} .run:is(.rl-play, .sq-btn)`);
      const probe = document.createElement('i');
      probe.style.background = 'var(--accent)';
      document.body.append(probe);
      const accent = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return getComputedStyle(btn).backgroundColor === accent;
    }, place.box);
    await expect.poll(colors, { message: 'идёт — заливка акцентом' }).toBe(true);

    // Стоп — той же кнопкой.
    await page.locator(`${place.box} .run:is(.rl-play, .sq-btn)`).first().click();
    const drain = page.locator(`${place.box} .liq-drain`);
    await expect(drain, 'остановили — стекает').toHaveCount(1);
    expect(await page.evaluate((s) => document.querySelector(s).getAnimations({ subtree: true }).map((a) => a.animationName), `${place.box} .liq-drain`))
      .toEqual(expect.arrayContaining(['liqSag', 'liqFall']));
    await expect(drain).toHaveCount(0, { timeout: 3000 });
    expect(await page.evaluate(() => state.activeTimer)).toBeNull();
  });
}

test('кнопка запуска без движения (reduced motion): ни налива, ни слива', async ({ page }) => {
  await seed(page, { reduce: true });
  for (const place of PLACES) {
    await page.evaluate(place.open);
    await page.locator(place.btn).first().click();
    const r = await page.evaluate((box) => ({
      liq: document.querySelectorAll(`${box} .liq-fill, ${box} .liq-drain`).length,
      anims: document.querySelector(box).getAnimations({ subtree: true }).filter((a) => /^liq/.test(a.animationName || '')).length,
    }), place.box);
    expect(r, place.name).toEqual({ liq: 0, anims: 0 });
    await page.evaluate(() => stopTimer());
  }
});

test('перерисовка посреди налива не начинает его заново, а «Сейчас идёт» не наливается по кругу', async ({ page }) => {
  await seed(page);
  await page.locator('#now-btn').click();
  await expect(page.locator('#now-btn')).toHaveClass(/liq-fill/);
  // Остров перерисовывается каждые 250 мс; ждём дольше налива — класса нет и не будет.
  await page.waitForTimeout(1300);
  await expect(page.locator('#now-btn')).not.toHaveClass(/liq-/);
  expect(await animNames(page, '#now-btn')).toEqual([]);
  // Строку перерисовали через 150 мс — новая кнопка продолжает с того же места.
  await page.evaluate(() => stopTimer());
  await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  const t = await page.evaluate(() => {
    renderRecentList();
    const b = document.querySelector('#recent-list .liq-drain');
    // Отрицательная задержка: время анимации идёт с нуля, а прогресс — с того места.
    return b ? b.getAnimations({ subtree: true }).find((a) => a.animationName === 'liqSag').effect.getComputedTiming().progress : null;
  });
  expect(t, 'новая кнопка подхватила анимацию').not.toBeNull();
  expect(t, 'и не с нуля').toBeGreaterThan(0.15);
});

// --- 3. Подложка сегментных вкладок переезжает ---------------------------------------

/** Подложка и выбранная кнопка — относительно переключателя. */
const segState = (page, seg) => page.evaluate((s) => {
  const box = document.querySelector(s);
  const pill = box.querySelector(':scope > .seg-pill');
  const on = box.querySelector(':scope > button.on');
  const b = box.getBoundingClientRect();
  const rel = (n) => { const r = n.getBoundingClientRect(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }; };
  return { pill: rel(pill), on: on && rel(on), moving: pill.getAnimations().length, glide: box.classList.contains('seg-glide') };
}, seg);

/** Нажать кнопку (мышью или с клавиатуры) и записать подложку в каждом кадре. */
async function glide(page, seg, btn, { key = false } = {}) {
  const record = page.evaluate(async (s) => {
    const box = document.querySelector(s);
    const pill = box.querySelector(':scope > .seg-pill');
    const frames = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 800) {
      await new Promise((r) => requestAnimationFrame(r));
      const b = box.getBoundingClientRect();
      const r = pill.getBoundingClientRect();
      frames.push({ x: r.left - b.left, w: r.width, moving: pill.getAnimations().length });
    }
    return frames;
  }, seg);
  if (key) {
    await page.locator(`${seg} ${btn}`).focus();
    await page.keyboard.press('Enter');
  } else {
    await page.locator(`${seg} ${btn}`).click();
  }
  return record;
}

/** Переключатели приложения: где открыть, с какой кнопки на какую. */
const SWITCHES = [
  { name: 'режимы «Статистики»', open: () => { openView('time'); applyTimeMode('day'); render(); }, seg: '#time-modes', to: 'button[data-mode="month"]' },
  { name: 'вкладки проекта', open: () => openProject('p1'), seg: '#proj-tabs', to: 'button[data-ptab="versions"]' },
  { name: 'фильтр статусов', open: () => { openProject('p1'); }, seg: '.tf-status', to: 'button[data-status="done"]' },
  { name: 'вкладки задачи', open: () => { openProject('p1'); selectTask('t1'); }, seg: '#task-tabs', to: 'button[data-tab="history"]' },
  { name: 'тема в настройках', open: () => openView('settings'), seg: '.theme-tabs', to: 'button[data-theme="light"]' },
  { name: 'повторение задачи', open: () => { openProject('p1'); selectTask('t1'); openRepeatDialog(getTask('t1')); }, seg: '#rp-freq-seg', to: 'button[data-freq="month"]' },
];

for (const sw of SWITCHES) {
  test(`подложка переезжает под нажатую: ${sw.name}`, async ({ page }) => {
    await seed(page);
    await page.evaluate(sw.open);
    await expect(page.locator(sw.seg)).toBeVisible();
    await page.waitForTimeout(450); // экран и окно доехали
    const first = await segState(page, sw.seg);
    expect(first.glide, 'переключатель подхвачен').toBe(true);
    expect(first.moving, 'первая отрисовка — без перехода').toBe(0);
    for (const k of ['x', 'y', 'w', 'h']) expect(Math.abs(first.pill[k] - first.on[k]), `на месте: ${k}`).toBeLessThanOrEqual(1);

    const frames = await glide(page, sw.seg, sw.to);
    const end = await segState(page, sw.seg);
    const from = first.pill;
    const to = end.on;
    expect(Math.abs(to.x - from.x), 'кнопки разные').toBeGreaterThan(8);
    const lo = Math.min(from.x, to.x) + 2;
    const hi = Math.max(from.x, to.x) - 2;
    const mid = frames.filter((f) => f.moving && f.x > lo && f.x < hi);
    expect(mid.length, 'в середине перехода подложка между старой и новой кнопкой').toBeGreaterThan(1);
    if (Math.abs(to.w - from.w) > 4) {
      const wl = Math.min(from.w, to.w) + 1;
      const wh = Math.max(from.w, to.w) - 1;
      expect(frames.some((f) => f.moving && f.w > wl && f.w < wh), 'и ширина — между старой и новой').toBe(true);
    }
    expect(end.moving, 'доехала').toBe(0);
    for (const k of ['x', 'y', 'w', 'h']) expect(Math.abs(end.pill[k] - end.on[k]), `в конце под выбранной: ${k}`).toBeLessThanOrEqual(1);
  });
}

test('подложка: с клавиатуры едет так же, смена языка и ширины — на место без анимации', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openProject('p1'));
  await page.waitForTimeout(400);
  const frames = await glide(page, '#proj-tabs', 'button[data-ptab="board"]', { key: true });
  expect(frames.some((f) => f.moving), 'Enter на вкладке — подложка едет').toBe(true);
  let s = await segState(page, '#proj-tabs');
  for (const k of ['x', 'w']) expect(Math.abs(s.pill[k] - s.on[k])).toBeLessThanOrEqual(1);

  await page.evaluate(() => setLang('en'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  s = await segState(page, '#proj-tabs');
  expect(s.moving, 'смена языка — без перехода').toBe(0);
  for (const k of ['x', 'w']) expect(Math.abs(s.pill[k] - s.on[k]), `язык: ${k}`).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  s = await segState(page, '#proj-tabs');
  expect(s.moving, 'смена ширины — без перехода').toBe(0);
  for (const k of ['x', 'w']) expect(Math.abs(s.pill[k] - s.on[k]), `ширина: ${k}`).toBeLessThanOrEqual(1);
});

test('подложка без движения (reduced motion): сразу на месте', async ({ page }) => {
  await seed(page, { reduce: true });
  await page.evaluate(() => { openView('time'); applyTimeMode('day'); render(); });
  await page.waitForTimeout(300);
  const frames = await glide(page, '#time-modes', 'button[data-mode="week"]');
  expect(frames.every((f) => !f.moving), 'перехода нет').toBe(true);
  const s = await segState(page, '#time-modes');
  for (const k of ['x', 'w']) expect(Math.abs(s.pill[k] - s.on[k])).toBeLessThanOrEqual(1);
});

// --- 4. Колокольчик -------------------------------------------------------------------

test('колокольчик звенит, только когда есть непрочитанное', async ({ page }) => {
  await seed(page, { unread: true });
  await expect(page.locator('#notif-badge')).toBeVisible();
  const ring = await animNames(page, '#notif-btn');
  expect(ring, 'качается колокол, язычок, кружок с числом').toEqual(expect.arrayContaining(['bellRing', 'bellClapper', 'badgeBump']));
  const iter = await page.evaluate(() => document.querySelector('#notif-btn .icon').getAnimations()[0].effect.getComputedTiming());
  expect(iter.iterations, 'звенит несколько раз, а не вечно').toBe(3);
  expect(iter.duration, 'длинная пауза между звонами').toBeGreaterThanOrEqual(6000);

  // Прочитали — замолчал.
  await page.locator('#notif-btn').click();
  await page.locator('#notif-btn').click();
  expect(await animNames(page, '#notif-btn')).toEqual([]);
});

test('колокольчик молчит без непрочитанного и без движения', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#notif-badge')).toBeHidden();
  expect(await animNames(page, '#notif-btn')).toEqual([]);

  const p2 = await page.context().newPage();
  await seed(p2, { unread: true, reduce: true });
  await expect(p2.locator('#notif-badge')).toBeVisible();
  expect(await animNames(p2, '#notif-btn'), 'reduced motion').toEqual([]);
});

// --- 5. Форма: скруглённый квадрат у кнопки запуска и галочки -------------------------

test('кнопка запуска и галочка задачи — скруглённый квадрат одного токена во всех местах, обе темы', async ({ page }) => {
  // Маленькая кнопка в строках и галочка — --radius-xs; большой квадрат
  // таймера (#now-btn, #timer-btn) с 13 октября 2026 — --radius, как остров
  // вокруг него и кнопки записи рядом.
  const tokenOf = (sel) => (sel === '#now-btn' || sel === '#timer-btn' ? '--radius' : '--radius-xs');
  await seed(page);
  const places = [
    { open: () => openView('home'), sels: ['#now-btn', '#recent-list .rl-play'] },
    { open: () => openView('projects'), sels: ['.ptile-task .rl-play', '.recent-row .rl-play', '.ptile-task .task-done'] },
    { open: () => openProject('p1'), sels: ['.task-item .task-done'] },
    { open: () => { openProject('p1'); selectTask('t1'); }, sels: ['#timer-btn'] },
  ];
  for (const theme of ['dark', 'light']) {
    await page.evaluate((th) => { state.settings.theme = th; applyTheme(); }, theme);
    for (const p of places) {
      await page.evaluate(p.open);
      for (const sel of p.sels) {
        const m = await page.evaluate(({ s, tok }) => {
          const n = document.querySelector(s);
          const cs = getComputedStyle(n);
          const r = n.getBoundingClientRect();
          return {
            token: getComputedStyle(document.documentElement).getPropertyValue(tok).trim(),
            radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius],
            side: Math.min(r.width, r.height),
          };
        }, { s: sel, tok: tokenOf(sel) });
        expect(m.token, 'токен объявлен').toMatch(/^\d+px$/);
        expect(new Set(m.radius), `${theme}, ${sel}: скругление = ${tokenOf(sel)}`).toEqual(new Set([m.token]));
        expect(parseFloat(m.token), `${theme}, ${sel}: не круг`).toBeLessThan(m.side / 2);
      }
    }
  }
});

test('галочка задачи: выполнено — заливка акцентом и галочка, переход без рывка', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openProject('p1'));
  const cb = page.locator('.task-item[data-id="t1"] .task-done');
  const before = await cb.evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, mark: getComputedStyle(n, '::before').transform }));
  expect(before.bg).toBe('rgba(0, 0, 0, 0)');
  await cb.check();
  const moving = await cb.evaluate((n) => n.getAnimations({ subtree: true }).map((a) => a.transitionProperty));
  expect(moving, 'заливка и галочка переходят, а не перескакивают').toEqual(expect.arrayContaining(['background-color', 'transform']));
  await expect.poll(() => cb.evaluate((n) => n.getAnimations({ subtree: true }).length)).toBe(0);
  const after = await cb.evaluate((n) => {
    const probe = document.createElement('i');
    probe.style.background = 'var(--accent)';
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { bg: getComputedStyle(n).backgroundColor, accent, mark: getComputedStyle(n, '::before').transform };
  });
  expect(after.bg).toBe(after.accent);
  expect(after.mark, 'галочка видна целиком').toBe('none');
});

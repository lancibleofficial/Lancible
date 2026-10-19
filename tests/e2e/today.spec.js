// «Сегодня» — день, числа, недавние проекты, сроки, идущая задача, недавние
// задачи. Запуск: npm run test:e2e
//
// С редизигна островами (7 октября 2026) обзор стал страницей дня: лента
// записей по часам, время и деньги за сегодня, неделю и месяц, три недавних
// проекта, сроки; справа — идущая задача (или последняя, чтобы продолжить)
// и недавние задачи с плеем. Проекты целиком переехали на свою страницу.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function seed(page, opts = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ HOUR, pin }) => {
    const now = new Date();
    state.settings.hourlyRate = 1000;
    state.settings.currency = 'RUB';
    const mk = (id, name, color, pinnedAt = null) => {
      state.projects.push({ id, name, color, description: '', pinnedAt, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
      seedProjectStatuses(id);
    };
    mk('p1', 'Сайт', '#87ff65');
    mk('p2', 'Приложение', '#5ec8f2');
    mk('p3', 'Кофейня', '#f5c451', pin ? new Date(now.getTime() - HOUR).toISOString() : null);
    mk('p4', 'Четвёртый', '#c084fc');
    const at = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d; };
    const ses = (start, end) => ({ start: start.toISOString(), end: end.toISOString(), ms: end - start });
    const add = (id, pid, title, sessions, extra = {}) => state.tasks.push({
      id, projectId: pid, title, done: false, notes: null, totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, ...extra,
    });
    add('t1', 'p1', 'Вёрстка', [ses(at(9), at(10))]);
    add('t2', 'p2', 'Экран входа', [ses(at(14), at(14, 45))], { dueAt: at(18).toISOString() });
    add('t3', 'p3', 'Логотип', [ses(at(11), at(12))]);
    add('t4', 'p1', 'Форма', [], { dueAt: new Date(now.getTime() - 2 * HOUR).toISOString() });
    state.ui.view = 'home';
    render();
  }, { HOUR, pin: !!opts.pin });
}

test('день: заголовок с датой, лента записей по часам и линия «сейчас»', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#day-title')).toHaveText('Среда, 10 июня');
  await expect(page.locator('#day-sub')).toContainText('2ч 45м');
  const blocks = page.locator('.day-blk');
  await expect(blocks).toHaveCount(3);
  // Запись в час на ленте с 8 до 20 — двенадцатая часть ширины.
  const m = await page.evaluate(() => {
    const track = document.getElementById('day-track').getBoundingClientRect();
    const b = document.querySelector('.day-blk').getBoundingClientRect();
    return { left: (b.left - track.left) / track.width, width: b.width / track.width, hours: [...document.querySelectorAll('.day-hours span')].map((s) => s.textContent) };
  });
  expect(m.hours[0]).toBe('08');
  expect(m.hours[m.hours.length - 1]).toBe('19');
  expect(m.left).toBeGreaterThan(1 / 12 - 0.01);
  expect(m.left).toBeLessThan(1 / 12 + 0.01);
  expect(m.width).toBeGreaterThan(1 / 12 - 0.01);
  expect(m.width).toBeLessThan(1 / 12 + 0.01);
  await expect(page.locator('.day-now'), 'сейчас — внутри дня').toHaveCount(1);
});

test('числа: сегодня, неделя и месяц — время и деньги в основной валюте', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#st-today')).toHaveText('2ч 45м');
  await expect(page.locator('#st-today-money')).toHaveText(/2\s750\s₽/);
  await expect(page.locator('#st-week')).toHaveText('2ч 45м');
  await expect(page.locator('#kpi-month-label')).toHaveText(/Июнь/);
  await expect(page.locator('#st-time')).toHaveText('2ч 45м');
  await expect(page.locator('#st-done')).toHaveText('· 0 из 4 задач');
});

test('недавние проекты — три, по свежести; щелчок открывает проект', async ({ page }) => {
  await seed(page);
  // С 19 октября 2026 — общее правило списков проектов (Core.projectsByActivity):
  // последнее изменение в проекте, его задачах или записях. «Приложение» —
  // запись до 14:45; «Кофейня» — правка задачи в 12:30; «Сайт» — в 12:00.
  await page.evaluate(() => { getTask('t3').updatedAt = new Date(Date.now() + 30 * 60000).toISOString(); render(); });
  const cards = page.locator('#home-proj-grid .hp-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.hp-name')).toHaveText(['Приложение', 'Кофейня', 'Сайт']);
  await cards.first().click();
  await expect(page.locator('#project-view')).toBeVisible();
  await expect(page.locator('#ph-name')).toHaveText('Приложение');
});

test('сроки: просроченное красным, ближайшее обычным текстом', async ({ page }) => {
  await seed(page);
  const rows = page.locator('#home-due-list li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.rl-name')).toHaveText('Форма');
  await expect(rows.first().locator('.rl-when')).toHaveClass(/overdue/);
  await expect(rows.nth(1).locator('.rl-when')).not.toHaveClass(/overdue/);
  await expect(page.locator('#home-due-note')).toHaveText('просрочено: 1');
  const color = await page.evaluate(() => ({
    red: getComputedStyle(document.querySelector('.rl-when.overdue')).color,
    danger: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
  }));
  expect(color.red).not.toBe('');
});

test('«Сейчас идёт»: без таймера — последняя задача с плеем, плей запускает, стоп останавливает', async ({ page }) => {
  await seed(page);
  const island = page.locator('#now-island');
  await expect(island).toBeVisible();
  await expect(island).toHaveClass(/idle/);
  await expect(page.locator('#now-title')).toHaveText('Экран входа');
  await expect(page.locator('#now-since'), 'без таймера подписи «Продолжить» нет').toHaveText('');
  await expect(page.locator('#now-btn')).toHaveAttribute('aria-label', 'Старт');
  const row = await page.evaluate(() => ['now-btn', 'now-open'].map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return Math.round(r.top + r.height / 2);
  }));
  expect(Math.abs(row[0] - row[1]), 'плей и «Открыть» — одной строкой').toBeLessThanOrEqual(2);
  await page.locator('#now-btn').click();
  expect(await page.evaluate(() => state.activeTimer && state.activeTimer.taskId)).toBe('t2');
  await expect(island).not.toHaveClass(/idle/);
  await expect(page.locator('#now-label')).toHaveText('Сейчас идёт');
  await expect(page.locator('#now-since'), 'идёт — время начала').toHaveText(/^\d\d:\d\d$/);
  await expect(page.locator('#now-btn')).toHaveClass(/run/);
  await expect(page.locator('#tb-timer'), 'капсула в шапке').toBeVisible();
  await page.locator('#now-btn').click();
  expect(await page.evaluate(() => state.activeTimer)).toBeNull();
  expect(await page.evaluate(() => state.ui.view), 'остались на «Сегодня»').toBe('home');
  await expect(island).toHaveClass(/idle/);
});

test('недавние задачи: плей запускает без перехода, строка открывает задачу', async ({ page }) => {
  await seed(page);
  const rows = page.locator('#recent-list li');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('.rl-name')).toHaveText(['Экран входа', 'Логотип', 'Вёрстка']);
  await rows.nth(1).locator('.rl-play').click();
  expect(await page.evaluate(() => state.activeTimer.taskId)).toBe('t3');
  expect(await page.evaluate(() => state.ui.view)).toBe('home');
  await expect(rows.nth(1).locator('.rl-play')).toHaveAttribute('aria-label', 'Стоп');
  await rows.nth(2).locator('.rl-name').click();
  expect(await page.evaluate(() => [state.ui.view, selectedId])).toEqual(['task', 't1']);
});

test('«Открыть день» ведёт в календарь на сегодняшний день', async ({ page }) => {
  await seed(page);
  await page.locator('#day-open').click();
  expect(await page.evaluate(() => [state.ui.view, state.ui.timeMode, agenda.mode])).toEqual(['time', 'day', 'day']);
});

// --- полоса дня: цвета проектов -------------------------------------------------
//
// С 11 октября 2026 запись на ленте — цветом проекта своей задачи, а не
// серой. Как событие в панели «Время» (.ag-ev): полоса слева — чистый цвет
// проекта (--pc), заливка и подпись смешаны из него и из земли (--tag-ink
// подобран под обе темы). Идущая запись остаётся акцентом: она одна на ленте.

/** Контраст по WCAG. Браузер отдаёт цвет то как "rgb(r, g, b)", то — для
 *  color-mix — как "color(srgb r g b)" с долями от 0 до 1. */
const ratio = (fg, bg) => {
  const lum = (c) => {
    const scale = c.startsWith('color(') ? 255 : 1;
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
      const x = (Number(v) * scale) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

/** Токен темы → вычисленный цвет: ровно то, что видит человек. */
const token = (page, name) => page.evaluate((n) => {
  const probe = document.createElement('div');
  probe.style.color = `var(${n})`;
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, name);

const COLORS = { 'Вёрстка': '#87ff65', 'Экран входа': '#5ec8f2', 'Логотип': '#f5c451' };

for (const theme of ['dark', 'light']) {
  test(`полоса дня (${theme}): запись — цветом проекта своей задачи, разные проекты — разные цвета`, async ({ page }) => {
    await seed(page);
    await page.evaluate((th) => { state.settings.theme = th; applyTheme(); }, theme);
    const raise = await token(page, '--raise');
    const blocks = await page.evaluate(() => [...document.querySelectorAll('.day-blk')].map((b) => {
      const s = getComputedStyle(b);
      return { name: b.title.split(' · ')[0], edge: s.borderLeftColor, edgeWidth: s.borderLeftWidth, bg: s.backgroundColor, color: s.color, pc: b.style.getPropertyValue('--pc') };
    }));
    expect(blocks.map((b) => b.name).sort()).toEqual(Object.keys(COLORS).sort());
    for (const b of blocks) {
      expect(b.pc, `${b.name}: цвет проекта пришёл в --pc`).toBe(COLORS[b.name]);
      expect(b.edge, `${b.name}: полоса слева — цвет проекта`).toBe(rgb(COLORS[b.name]));
      expect(b.edgeWidth).toBe('3px');
      expect(b.bg, `${b.name}: заливка уже не серая подложка`).not.toBe(raise);
      expect(ratio(b.color, b.bg), `${b.name}: подпись читается на заливке (AA, 4.5)`).toBeGreaterThanOrEqual(4.5);
    }
    expect(new Set(blocks.map((b) => b.edge)).size, 'три проекта — три цвета полосы').toBe(3);
    expect(new Set(blocks.map((b) => b.bg)).size, 'и три заливки').toBe(3);
  });
}

test('полоса дня: цвет проекта сменили — запись перекрасилась; идущая — по-прежнему акцентом', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    state.projects.find((p) => p.id === 'p1').color = '#ff5a5a';
    const d = new Date();
    d.setHours(11, 30, 0, 0);
    state.activeTimer = { taskId: 't2', startedAt: d.toISOString(), heartbeatAt: d.toISOString() };
    renderDayIsland();
  });
  const edge = (title) => page.evaluate((t) => getComputedStyle([...document.querySelectorAll('.day-blk')].find((b) => b.title.startsWith(t))).borderLeftColor, title);
  expect(await edge('Вёрстка')).toBe(rgb('#ff5a5a'));
  const run = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.day-blk.run'));
    return { bg: s.backgroundColor, color: s.color, edge: s.borderLeftWidth };
  });
  expect(run.bg, 'идущая — фон акцента').toBe(await token(page, '--accent'));
  expect(run.color).toBe(await token(page, '--accent-text'));
  expect(run.edge, 'у идущей полосы цвета проекта нет').toBe('0px');
  await expect(page.locator('.day-now'), 'красная линия «сейчас» на месте').toHaveCount(1);
});

// --- тик «Сегодня» и наблюдатели за <body> ---------------------------------------
//
// Замечание ревью 11 октября 2026. Пока на «Сегодня» идёт таймер, тик каждые
// 250 мс звал renderDayIsland, и та стирала и заводила заново ленту дня, часы
// над ней и строку «записано» — десяток узлов четыре раза в секунду; на каждый
// из них наблюдатели за <body> гоняли поиск накладных полос и сегментных
// переключателей по ~30 селекторам. Теперь рисуемое сначала описывается и в
// DOM уходит, только если описание изменилось; а наблюдатели не ищут в узлах,
// где искать нечего.

/** Идёт задача t2 с 11:30; время страницы прибито к полудню (clock.js). */
async function runTimer(page) {
  await page.evaluate(() => {
    const d = new Date();
    d.setHours(11, 30, 0, 0);
    state.activeTimer = { taskId: 't2', startedAt: d.toISOString(), heartbeatAt: d.toISOString() };
    render();
  });
  await page.waitForTimeout(500);
}

test('идущий таймер: лента дня, часы и строка «записано» не пересобираются на каждом тике', async ({ page }) => {
  await seed(page);
  await runTimer(page);
  await page.evaluate(() => {
    window.__rebuilt = [];
    for (const id of ['day-track', 'day-hours', 'day-sub', 'now-proj']) {
      new MutationObserver(() => window.__rebuilt.push(id)).observe(document.getElementById(id), { childList: true });
    }
  });
  await page.waitForTimeout(1300); // пять тиков
  expect(await page.evaluate(() => window.__rebuilt), 'рисовать нечего нового — DOM не трогают').toEqual([]);

  // А время идёт: ушло на полчаса вперёд — красная линия поехала, у идущей записи выросла подпись.
  const left = () => page.evaluate(() => document.querySelector('.day-now').style.left);
  const before = await left();
  await page.clock.setFixedTime(new Date('2026-06-10T12:30:00'));
  await expect.poll(left, { message: 'линия «сейчас» поехала' }).not.toBe(before);
  await expect.poll(() => page.evaluate(() => document.querySelector('.day-blk.run').textContent), { message: 'идущая запись выросла: на ней подпись с временем' }).toContain('1ч');
  expect(await page.evaluate(() => window.__rebuilt.length), 'перестройка была, когда изменилось рисуемое').toBeGreaterThan(0);
});

test('наблюдатели за <body>: узлы без вложенных элементов и собственные дорожки поиск областей не гоняют, новые области и переключатели находятся', async ({ page }) => {
  await seed(page);
  const r = await page.evaluate(async () => {
    const hits = { areas: 0, seg: 0 };
    const qsa = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function patched(sel) {
      if (typeof sel === 'string' && sel.includes('.nav-projects')) hits.areas += 1;
      return qsa.call(this, sel);
    };
    const gebc = Element.prototype.getElementsByClassName;
    Element.prototype.getElementsByClassName = function patched(name) {
      if (name === 'segmented') hits.seg += 1;
      return gebc.call(this, name);
    };
    const wait = () => new Promise((res) => setTimeout(res, 60));
    const out = {};
    const run = async (name, fn) => {
      hits.areas = 0;
      hits.seg = 0;
      fn();
      await wait();
      out[name] = { areas: hits.areas, seg: hits.seg };
    };
    const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; };

    await run('leaf', () => document.body.appendChild(document.createElement('i')));
    await run('text', () => document.body.appendChild(document.createTextNode('текст')));
    await run('subtree', () => document.body.appendChild(el('<div><i></i></div>')));

    // Область со списком, у которой тут же заводится дорожка: она ложится в <body>
    // с бегунком внутри, но областью быть не может.
    const box = el('<div class="doc-list" style="height:50px;overflow:auto"><div style="height:500px"></div></div>');
    await run('area', () => document.body.appendChild(box));
    out.areaAttached = box.hasAttribute('data-ovs');
    await run('track', () => ovsBar(ovsAreas.get(box)));
    out.trackAdded = !!document.querySelector('.ovs-track');

    // Область и переключатель в обёртке: находятся, хотя сами узлом не добавлялись.
    const wrap = el('<div><div class="task-side"><i></i></div><div class="segmented"><button class="on">А</button><button>Б</button></div></div>');
    await run('nested', () => document.body.appendChild(wrap));
    out.nestedArea = wrap.querySelector('.task-side').hasAttribute('data-ovs');
    out.nestedSeg = wrap.querySelector('.segmented').classList.contains('seg-glide');

    // Внутрь переключателя вставили узел с детьми: переключатели в нём не ищут.
    const seg = wrap.querySelector('.segmented');
    await run('inSeg', () => seg.appendChild(el('<span><b></b></span>')));
    return out;
  });

  expect(r.leaf, 'элемент без детей: поиска в поддереве нет').toEqual({ areas: 0, seg: 0 });
  expect(r.text, 'текстовый узел не разбирается').toEqual({ areas: 0, seg: 0 });
  expect(r.subtree.areas, 'элемент с детьми: поддерево просмотрено (счётчик живой)').toBeGreaterThan(0);
  expect(r.subtree.seg).toBeGreaterThan(0);
  expect(r.areaAttached, 'область подключилась').toBe(true);
  expect(r.trackAdded, 'дорожка появилась').toBe(true);
  expect(r.track, 'собственная дорожка в <body> областью не считается и не ищется').toEqual({ areas: 0, seg: 0 });
  expect(r.nestedArea, 'область внутри обёртки найдена').toBe(true);
  expect(r.nestedSeg, 'переключатель внутри обёртки найден').toBe(true);
  expect(r.inSeg.seg, 'внутри переключателя других переключателей не ищут').toBe(0);
});

test('кнопки записи скруглены крупнее — --radius: квадрат таймера, «Запись», «Открыть день», «Открыть»', async ({ page }) => {
  // 13 октября 2026: кнопки строки записи были со скруглением --radius-sm
  // (квадрат таймера — даже --radius-xs) и смотрелись острыми рядом с
  // островом. Теперь у них скругление острова — --radius. Общие поля и
  // текстовые кнопки остались --radius-sm.
  await seed(page);
  const radius = (token) => page.evaluate((token) => {
    const probe = document.createElement('i');
    probe.style.borderRadius = `var(${token})`;
    document.body.appendChild(probe);
    const r = getComputedStyle(probe).borderTopLeftRadius;
    probe.remove();
    return r;
  }, token);
  const big = await radius('--radius');
  const small = await radius('--radius-sm');
  expect(big).toBe('14px');
  const of = (sel) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).borderTopLeftRadius);
  for (const sel of ['#now-btn', '#day-add-entry', '#day-open', '#now-open']) expect(await of(sel), sel).toBe(big);
  await page.evaluate(() => selectTask('t1'));
  for (const sel of ['#timer-btn']) expect(await of(sel), sel).toBe(big);
  await page.locator('#task-tabs button[data-tab="history"]').click();
  for (const sel of ['#add-session-btn', '#export-task-btn']) expect(await of(sel), sel).toBe(big);
  // Общий вид прочих мест не тронут: «Создать» в карточке и поле — --radius-sm.
  await page.evaluate(() => openView('projects'));
  expect(await of('.ptile-qa .btn-soft')).toBe(small);
  expect(await of('.ptile-qa .field')).toBe(small);
});

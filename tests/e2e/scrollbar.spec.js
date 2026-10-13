// Полоса прокрутки: накладная — поверх содержимого, места не занимает.
// Запуск: npm run test:e2e
//
// Замечание 11 октября 2026: полоса двигала содержимое — список, выросший за
// край окна, сужался на её ширину, — а место под неё, занятое всегда
// (scrollbar-gutter: stable), выглядело как «скролл, который ничего не делает»:
// пустая полоса вдоль всей страницы «Проекты». Теперь нативная полоса у
// прокручиваемых областей скрыта (атрибут data-ovs), а своя рисуется поверх
// содержимого и только тогда, когда прокручивать есть что: attachOverlayScroll
// в app.js, вид — «Скроллбар» в styles.css. Раскладка о ней не знает: ни
// отступов под полосу, ни scrollbar-gutter.
//
// Второе замечание того же дня: горизонтальной полосы не должно быть вовсе. Её
// нет ни накладной (дорожки только вертикальные), ни нативной; вместо неё
// край ленты, за которым есть что листать, растворяется, а у края стоит
// кнопка-стрелка на подложке: attachScrollEdges в app.js, вид — «Край ленты»
// в styles.css. Тесты — в конце файла.
//
// Playwright запускает Chromium с --hide-scrollbars, и нативных полос в таком
// браузере нет вовсе — проверять «нативная полоса скрыта» было бы нечем. Флаг
// снимается ниже: тест видит ту полосу, что видит пользователь.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const LONG_WORD = 'Километровое_название_без_единого_пробела_'.repeat(12);
const LONG_TEXT = 'Очень длинное название, в котором много слов и которое никак не помещается в строку '.repeat(8);

/** Проект с n задачами в одном столбце доски (у каждой запись сегодня), n
 *  документами и n записями времени у первой задачи — списков, которые
 *  растут за край окна. Окно низкое: на нём 60 строк не помещаются нигде. */
async function seed(page, n, theme = 'dark', size = { width: 1280, height: 600 }) {
  await page.setViewportSize(size);
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ n, theme }) => {
    const now = new Date();
    const pid = uid();
    state.projects.push({ id: pid, name: 'Сайт клиента', color: '#87ff65', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] });
    seedProjectStatuses(pid);
    const cols = orderedStatuses(pid);
    const span = (day, hour) => {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 6 + (hour % 15), 0, 0);
      return { start: s.toISOString(), end: new Date(s.getTime() + 600_000).toISOString(), ms: 600_000 };
    };
    for (let i = 0; i < n; i++) {
      state.tasks.push({
        id: `t-${i}`, projectId: pid, title: `Задача ${i}`, done: false, notes: null, totalMs: 600_000,
        // У первой — n записей в разные дни: история растёт. У остальных — одна сегодня.
        sessions: i === 0 ? Array.from({ length: n }, (_, k) => span(k, k)) : [span(0, i)],
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    }
    state.documents = Array.from({ length: n }, (_, i) => ({
      id: `d-${i}`, title: `Документ ${i}`, body: null, projectId: pid,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), pinnedAt: null,
    }));
    state.settings.theme = theme;
    applyTheme();
    state.ui.projectId = pid;
    state.ui.boardProjectId = pid;
    render();
  }, { n, theme });
}

/** Экраны со списками, которые растут: что открыть, прокручиваемая область и
 *  первая строка в ней. */
const AREAS = [
  {
    name: 'список задач', scroller: '#task-list', item: '#task-list .task-item',
    go: () => { state.ui.view = 'project'; state.ui.projectTab = 'list'; render(); },
  },
  {
    name: 'столбец доски', scroller: '.board-col-body', item: '.board-card',
    go: () => { state.ui.view = 'project'; state.ui.projectTab = 'board'; render(); },
  },
  {
    name: 'история задачи', scroller: '#tab-history', item: '#session-list .session-item',
    go: () => { state.ui.view = 'project'; state.ui.projectTab = 'list'; render(); selectTask('t-0'); setTaskTab('history'); },
  },
  {
    name: 'правая панель «Время»', scroller: '#cal-day-panel', item: '#cal-day-list .cdl-group',
    go: () => { state.ui.view = 'time'; state.ui.timeMode = 'month'; render(); },
  },
  {
    name: 'список документов', scroller: '#doc-list', item: '#doc-list .doc-item',
    go: () => { openDocs('d-0'); },
  },
];

/** Рамка первой строки и ширина нативной полосы у прокручиваемой области. */
const measure = (page, { scroller, item }) => page.evaluate(({ scroller, item }) => {
  const row = document.querySelector(item);
  // Область, в которой лежит строка: столбцов доски, например, шесть.
  const box = row.closest(scroller);
  const r = row.getBoundingClientRect();
  const s = getComputedStyle(box);
  const border = parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
  return {
    left: r.left, right: r.right, width: r.width,
    overflows: box.scrollHeight > box.clientHeight + 1,
    bar: box.offsetWidth - box.clientWidth - border,
    gutter: s.scrollbarGutter,
    attached: box.hasAttribute('data-ovs'),
  };
}, { scroller, item });

for (const area of AREAS) {
  test(`${area.name}: нативной полосы нет, и строки не сдвигаются и не сужаются, когда список вырос`, async ({ page }) => {
    // Сначала шестьдесят строк — прокручиваются, потом одна — нет, на том же экране.
    // (Две страницы подряд не годятся: вкладка дописывает свои данные в общее
    // хранилище уже после его очистки, и «одна» сложилась бы с «шестьюдесятью».)
    await seed(page, 60);
    await page.evaluate(area.go);
    await expect(page.locator(area.item).first()).toBeVisible();
    await page.waitForTimeout(450);
    const many = await measure(page, area);

    await page.evaluate(() => {
      state.tasks.splice(1);
      state.tasks[0].sessions.splice(1);
      state.documents.splice(1);
      render();
    });
    await page.waitForTimeout(450);
    const few = await measure(page, area);

    expect(many.overflows, 'длинный список прокручивается').toBe(true);
    expect(few.overflows, 'короткий помещается').toBe(false);
    expect(many.attached, 'область подключена к накладной полосе').toBe(true);
    expect(many.bar, 'нативная полоса скрыта: места не занимает').toBe(0);
    expect(few.bar).toBe(0);
    expect(many.gutter, 'места под полосу никто не резервирует').toBe('auto');
    // Главное: строка там же и той же ширины.
    expect(many.width, 'ширина строки').toBeCloseTo(few.width, 0);
    expect(many.left, 'левый край строки').toBeCloseTo(few.left, 0);
    expect(many.right, 'правый край строки').toBeCloseTo(few.right, 0);
  });
}

/** Накладная полоса области: дорожка, бегунок и метрики самой области. */
const bar = (page, sel) => page.evaluate(({ sel }) => {
  const box = document.querySelector(sel);
  const r = box.getBoundingClientRect();
  const innerLeft = r.left + box.clientLeft;
  const innerTop = r.top + box.clientTop;
  const found = [...document.querySelectorAll('.ovs-track')].find((t) => {
    const tr = t.getBoundingClientRect();
    return Math.abs(tr.right - (innerLeft + box.clientWidth)) <= 1 && Math.abs(tr.top - innerTop) <= 1;
  });
  const m = { top: box.scrollTop, left: box.scrollLeft, sh: box.scrollHeight, ch: box.clientHeight, sw: box.scrollWidth, cw: box.clientWidth, box: { right: innerLeft + box.clientWidth, top: innerTop } };
  if (!found) return { found: false, ...m };
  const cs = getComputedStyle(found);
  const thumb = found.firstElementChild;
  const ts = getComputedStyle(thumb);
  return {
    found: true, ...m,
    shown: found.classList.contains('on') && cs.visibility === 'visible' && Number(cs.opacity) > 0.99,
    on: found.classList.contains('on'),
    track: found.getBoundingClientRect().toJSON(), thumb: thumb.getBoundingClientRect().toJSON(),
    thumbBg: ts.backgroundColor, drag: found.classList.contains('drag'),
  };
}, { sel });

const LIST = '#task-list';
const toProjectList = async (page, n = 60) => {
  await seed(page, n);
  await page.evaluate(() => { state.ui.view = 'project'; state.ui.projectTab = 'list'; render(); });
  await expect(page.locator('#task-list .task-item').first()).toBeVisible();
  await page.waitForTimeout(450);
};
/** Мышь в середину области (и чуть сдвинуть: наведение — это движение). */
const hover = async (page, sel) => {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2 - 20, b.y + 60);
  await page.mouse.move(b.x + b.width / 2, b.y + 66);
};
const away = async (page) => {
  const rail = await page.locator('#navrail .nav-items').boundingBox();
  await page.mouse.move(rail.x + 10, rail.y + 10);
};

test('полоса появляется при наведении, лежит у края области поверх содержимого и гаснет через секунду', async ({ page }) => {
  await toProjectList(page);
  await away(page);
  expect((await bar(page, LIST)).shown ?? false, 'в покое полосы нет').toBe(false);

  const before = await measure(page, { scroller: LIST, item: '#task-list .task-item' });
  await hover(page, LIST);
  await expect.poll(async () => (await bar(page, LIST)).shown, { message: 'мышь над областью — полоса видна' }).toBe(true);
  const shown = await bar(page, LIST);
  // У правого края области, на всю её высоту, а не рядом с ней.
  expect(shown.track.right, 'дорожка у правого края области').toBeCloseTo(shown.box.right, 0);
  expect(shown.track.top).toBeCloseTo(shown.box.top, 0);
  expect(shown.track.height, 'дорожка во всю высоту области').toBeCloseTo(shown.ch, 0);
  // Поверх: строки остались на месте и той же ширины.
  const during = await measure(page, { scroller: LIST, item: '#task-list .task-item' });
  expect(during.width).toBeCloseTo(before.width, 0);
  expect(during.right).toBeCloseTo(before.right, 0);
  expect(during.bar, 'нативной полосы по-прежнему нет').toBe(0);
  // Список под дорожкой продолжается: она не «выталкивает» его, а лежит над ним.
  const over = await page.evaluate(() => {
    const t = document.querySelector('.ovs-track.on');
    const r = t.getBoundingClientRect();
    return document.getElementById('task-list').contains(document.elementFromPoint(r.left - 3, r.top + r.height / 2));
  });
  expect(over, 'рядом с дорожкой — сам список').toBe(true);

  // Мышь ушла: ещё видна (гаснет не мгновенно), потом пропадает.
  await away(page);
  await page.waitForTimeout(250);
  expect((await bar(page, LIST)).on, 'сразу не гаснет').toBe(true);
  await expect.poll(async () => (await bar(page, LIST)).on, { message: 'через секунду тишины гаснет', timeout: 3500 }).toBe(false);
  expect((await bar(page, LIST)).shown, 'и не видна').toBe(false);
});

test('полоса появляется, когда область крутят, даже если мышь стоит в стороне', async ({ page }) => {
  await toProjectList(page);
  await away(page);
  await page.evaluate(() => { document.getElementById('task-list').scrollTop = 120; });
  await expect.poll(async () => (await bar(page, LIST)).shown, { message: 'крутят — полоса видна' }).toBe(true);
  await expect.poll(async () => (await bar(page, LIST)).on, { message: 'и гаснет', timeout: 3500 }).toBe(false);
});

test('размер бегунка и его место считаются от scrollHeight, clientHeight и scrollTop', async ({ page }) => {
  await toProjectList(page);
  await hover(page, LIST);
  await expect.poll(async () => (await bar(page, LIST)).shown).toBe(true);
  for (const frac of [0, 0.5, 1]) {
    await page.evaluate((f) => { const n = document.getElementById('task-list'); n.scrollTop = (n.scrollHeight - n.clientHeight) * f; }, frac);
    await page.mouse.move(0, 0);
    await hover(page, LIST);
    await page.waitForTimeout(120);
    const b = await bar(page, LIST);
    const len = b.ch;
    const thumbLen = Math.min(len, Math.max(28, Math.round(len * b.ch / b.sh)));
    const off = (b.top / (b.sh - b.ch)) * (len - thumbLen);
    expect(b.thumb.height, `бегунок при прокрутке ${frac}: длина`).toBeCloseTo(thumbLen, 0);
    expect(b.thumb.top - b.track.top, `бегунок при прокрутке ${frac}: место`).toBeCloseTo(off, 0);
    expect(b.thumb.top, 'бегунок внутри дорожки').toBeGreaterThanOrEqual(b.track.top - 0.5);
    expect(b.thumb.bottom, 'бегунок внутри дорожки').toBeLessThanOrEqual(b.track.bottom + 0.5);
  }
});

test('бегунок тянется мышью, в том числе когда мышь ушла с дорожки', async ({ page }) => {
  await toProjectList(page);
  await hover(page, LIST);
  await expect.poll(async () => (await bar(page, LIST)).shown).toBe(true);

  const b = await bar(page, LIST);
  const cx = b.thumb.x + b.thumb.width / 2;
  const cy = b.thumb.y + b.thumb.height / 2;
  const k = (b.sh - b.ch) / (b.ch - b.thumb.height);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 40, { steps: 6 });
  const dragged = await bar(page, LIST);
  expect(dragged.drag, 'пока тянут — дорожка в режиме перетаскивания').toBe(true);
  expect(dragged.top, 'область прокрутилась за бегунком').toBeCloseTo(40 * k, -1);
  // Бегунок перерисовывается в ближайшем кадре — подождём его.
  await expect.poll(async () => (await bar(page, LIST)).thumb.top - b.thumb.top, { message: 'бегунок ушёл за мышью' }).toBeCloseTo(40, 0);
  // Мышь ушла в сторону от дорожки, а бегунок держат — он всё равно тянется.
  await page.mouse.move(cx - 300, cy + 80, { steps: 4 });
  expect((await bar(page, LIST)).top, 'тянется и вне дорожки').toBeGreaterThan(dragged.top);
  await page.mouse.up();
  await expect.poll(async () => (await bar(page, LIST)).drag).toBe(false);
});

// Замечание 11 октября 2026 (ревью): видимая дорожка в 10 px у правого края
// перехватывала любые щелчки, пока мышь над областью, — щелчок в правых 10 px
// строки списка или пункта длинного меню не делал ничего. Теперь дорожка мышь
// не ловит (pointer-events: none), ловит только бегунок; листания страницами
// щелчком по дорожке нет вовсе.
test('дорожка мышь не ловит: щелчок по строке у правого края доходит, а по бегунку — не доходит до неё', async ({ page }) => {
  await toProjectList(page);
  await hover(page, LIST);
  await expect.poll(async () => (await bar(page, LIST)).shown).toBe(true);
  const b = await bar(page, LIST);

  const css = await page.evaluate(() => {
    const track = document.querySelector('.ovs-track.on');
    return { track: getComputedStyle(track).pointerEvents, thumb: getComputedStyle(track.firstElementChild).pointerEvents };
  });
  expect(css.track, 'дорожка мышь не ловит').toBe('none');
  expect(css.thumb, 'бегунок ловит').toBe('auto');

  // Строка ниже бегунка (он в самом верху): её правый край лежит под дорожкой.
  const row = await page.evaluate((below) => {
    const tr = document.querySelector('.ovs-track.on').getBoundingClientRect();
    const list = document.getElementById('task-list').getBoundingClientRect();
    for (const li of document.querySelectorAll('#task-list .task-item')) {
      const r = li.getBoundingClientRect();
      if (r.top > below && r.bottom < list.bottom - 4) return { id: li.dataset.id, top: r.top, bottom: r.bottom, right: r.right, trackLeft: tr.left, trackRight: tr.right };
    }
    return null;
  }, b.thumb.bottom + 10);
  expect(row, 'под бегунком есть целая строка').not.toBeNull();
  expect(row.right, 'строка тянется под дорожку, а не кончается раньше').toBeGreaterThan(row.trackLeft + 4);

  // Три точки по ширине дорожки: у левого её края, посередине (там, где в
  // другом месте стоит бегунок) и в двух пикселях от края окна.
  const mid = (row.top + row.bottom) / 2;
  for (const dx of [2, b.track.width / 2, b.track.width - 2]) {
    const x = b.track.x + dx;
    expect(await page.evaluate(([px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return !!hit && !hit.closest('.ovs-track') && !!hit.closest('.task-item');
    }, [x, mid]), `в точке ${dx.toFixed(0)} px от левого края дорожки — строка, а не дорожка`).toBe(true);
  }

  // Рядом с бегунком по вертикали — тоже список: дорожка не стена вдоль всего края.
  const beside = await bar(page, LIST);
  const y = beside.thumb.y + beside.thumb.height / 2;
  expect(await page.evaluate(([px, py]) => {
    const hit = document.elementFromPoint(px, py);
    return !!hit && !hit.closest('.ovs-track') && document.getElementById('task-list').contains(hit);
  }, [beside.track.right - 1.5, y]), 'у самого края окна напротив бегунка — список, а не дорожка').toBe(true);

  // А сам бегунок схватывается: он ловит мышь, и щелчок по нему строку не открывает.
  await page.evaluate(() => { selectedId = null; });
  const t0 = await bar(page, LIST);
  await page.mouse.move(t0.thumb.x + t0.thumb.width / 2, t0.thumb.y + t0.thumb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => selectedId), 'щелчок по бегунку строку не открывает').toBeNull();

  // Настоящий щелчок: строка открывается, а не гасится дорожкой.
  await page.mouse.click(b.track.x + b.track.width - 2, mid);
  await expect.poll(() => page.evaluate(() => selectedId), { message: 'щелчок в правых 10 px строки открыл её' }).toBe(row.id);
});

test('щелчок по пункту длинного меню у правого края срабатывает: дорожка меню его не гасит', async ({ page }) => {
  await seed(page, 3);
  await page.evaluate(() => {
    window.__picked = [];
    openMenu(document.getElementById('create-project-btn') || document.body,
      Array.from({ length: 40 }, (_, i) => ({ label: `Пункт ${i}`, onClick() { window.__picked.push(i); } })));
  });
  await expect(page.locator('#ctx-menu')).toBeVisible();
  await page.waitForTimeout(150);
  await hover(page, '#ctx-menu');
  await expect.poll(async () => (await bar(page, '#ctx-menu')).shown, { message: 'у меню своя полоса' }).toBe(true);
  const b = await bar(page, '#ctx-menu');

  // Пункт ниже бегунка, целиком в окне меню; щелчок — у самого правого края пункта.
  const item = await page.evaluate((below) => {
    const m = document.getElementById('ctx-menu').getBoundingClientRect();
    for (const [i, el] of [...document.querySelectorAll('#ctx-menu .ctx-item')].entries()) {
      const r = el.getBoundingClientRect();
      if (r.top > below && r.bottom < m.bottom - 4) return { i, top: r.top, bottom: r.bottom, right: r.right };
    }
    return null;
  }, b.thumb.bottom + 10);
  expect(item, 'под бегунком есть целый пункт').not.toBeNull();
  const x = Math.min(item.right, b.track.right) - 2;
  expect(x, 'точка щелчка — в зоне дорожки').toBeGreaterThan(b.track.x);
  expect(await page.evaluate(([px, py]) => {
    const hit = document.elementFromPoint(px, py);
    return !!hit && !hit.closest('.ovs-track') && !!hit.closest('.ctx-item');
  }, [x, (item.top + item.bottom) / 2]), 'в точке щелчка — пункт, а не дорожка').toBe(true);
  await page.mouse.click(x, (item.top + item.bottom) / 2);
  await expect.poll(() => page.evaluate(() => window.__picked), { message: 'пункт сработал' }).toEqual([item.i]);
  await expect(page.locator('#ctx-menu'), 'и меню закрылось, как после обычного щелчка').toBeHidden();
});

test('под курсором бегунок толще и ярче; цвета — токены обеих тем', async ({ page }) => {
  await toProjectList(page);
  const luminance = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      const x = (c.startsWith('color(') ? v * 255 : v) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const theme of ['dark', 'light']) {
    await page.evaluate((th) => { state.settings.theme = th; applyTheme(); }, theme);
    await page.waitForTimeout(250);
    await away(page);
    await hover(page, LIST);
    await expect.poll(async () => (await bar(page, LIST)).shown).toBe(true);
    // Цвет токена в том виде, в каком его отдаёт браузер: через пробную подложку.
    const tokens = await page.evaluate(() => {
      const paint = (token) => {
        const probe = document.createElement('i');
        probe.style.backgroundColor = `var(${token})`;
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
      };
      return {
        sb: getComputedStyle(document.documentElement).getPropertyValue('--sb').trim(),
        scrollbar: paint('--scrollbar'), hover: paint('--scrollbar-hover'),
        strong: paint('--border-strong'), icon: paint('--icon'), panel: paint('--panel'),
      };
    });
    // Цвет меняется переходом 0,12 с — дождёмся конца.
    await expect.poll(async () => (await bar(page, LIST)).thumbBg, { message: `${theme}: бегунок — токен --scrollbar` }).toBe(tokens.scrollbar);
    const rest = await bar(page, LIST);
    expect(rest.thumb.width, `${theme}: в покое бегунок тонкий`).toBeCloseTo(4, 0);
    expect(rest.track.width, `${theme}: зона дорожки — токен --sb`).toBeCloseTo(parseFloat(tokens.sb), 0);

    // Мышь на самом бегунке: толще и ярче. (Дорожка вокруг мышь не ловит, так что
    // «под курсором» — это под курсором бегунок, а не зона у края.)
    await page.mouse.move(rest.thumb.x + rest.thumb.width / 2, rest.thumb.y + rest.thumb.height / 2);
    await expect.poll(async () => (await bar(page, LIST)).thumb.width, { message: `${theme}: под курсором толще` }).toBeCloseTo(8, 0);
    await expect.poll(async () => (await bar(page, LIST)).thumbBg, { message: `${theme}: под курсором — токен --scrollbar-hover` }).toBe(tokens.hover);

    expect(tokens.scrollbar, `${theme}: не прежний --border-strong`).not.toBe(tokens.strong);
    expect(tokens.hover, `${theme}: под курсором не прежний --icon`).not.toBe(tokens.icon);
    // Приглушённая: слабее прежней. А под курсором — заметнее обычной.
    expect(contrast(tokens.scrollbar, tokens.panel), `${theme}: тише прежней`).toBeLessThan(contrast(tokens.strong, tokens.panel));
    expect(contrast(tokens.hover, tokens.panel), `${theme}: при наведении ярче покоящейся`).toBeGreaterThan(contrast(tokens.scrollbar, tokens.panel));
    expect(contrast(tokens.hover, tokens.panel), `${theme}: но тише прежней при наведении`).toBeLessThan(contrast(tokens.icon, tokens.panel));
  }
});

test('prefers-reduced-motion: полоса появляется без анимации', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toProjectList(page);
  await hover(page, LIST);
  await expect.poll(async () => (await bar(page, LIST)).on).toBe(true);
  const d = await page.evaluate(() => {
    const t = document.querySelector('.ovs-track.on');
    return [getComputedStyle(t).transitionDuration, getComputedStyle(t.firstElementChild).transitionDuration, getComputedStyle(t).transitionProperty];
  });
  // Общее правило для reduced-motion сводит длительность к 0,01 мс, а у полосы
  // перехода нет вовсе (transition-property: none): ничего не плывёт.
  expect(d[2], 'у дорожки нет перехода').toBe('none');
  expect(parseFloat(d[0]), 'длительность — ноль').toBeLessThan(0.001);
  expect(parseFloat(d[1]), 'и у бегунка').toBeLessThan(0.001);
});

test('нечего прокручивать — нет и полосы: «Проекты» с одним проектом без задач', async ({ page }) => {
  // Задач нет — таблицы недавних под рядом карточек нет, и страница короче окна.
  await seed(page, 0, 'dark', { width: 1280, height: 900 });
  await page.evaluate(() => { openView('projects'); });
  await expect(page.locator('.ptile').first()).toBeVisible();
  await page.waitForTimeout(450);
  const m = await page.evaluate(() => {
    const n = document.getElementById('projects-view');
    return {
      v: n.scrollHeight - n.clientHeight, h: n.scrollWidth - n.clientWidth,
      bar: n.offsetWidth - n.clientWidth, barH: n.offsetHeight - n.clientHeight,
      gutter: getComputedStyle(n).scrollbarGutter,
    };
  });
  expect(m.v, 'страница не длиннее окна').toBeLessThanOrEqual(0);
  expect(m.h, 'и не шире').toBeLessThanOrEqual(0);
  expect(m.bar, 'жёлоба под полосу нет').toBe(0);
  expect(m.barH).toBe(0);
  expect(m.gutter).toBe('auto');
  // Мышь над страницей и над карточкой, колесо крутят — полосы всё равно нет.
  for (const sel of ['#projects-view', '.ptile']) {
    await hover(page, sel);
    await page.mouse.wheel(0, 200);
  }
  await page.waitForTimeout(300);
  const visible = await page.evaluate(() => [...document.querySelectorAll('.ovs-track.on')].map((t) => t.dataset.axis));
  expect(visible, 'прокручивать нечего — ни одной дорожки').toEqual([]);
});

// Страница «Проекты»: колонка не прокручивается вбок никогда, что бы в ней ни
// лежало, — вбок листается только лента карточек (у неё по краям стрелки). Длинное
// название проекта и задачи в карточках и в таблице недавних режется многоточием.
for (const width of [1280, 375]) {
  test(`«Проекты» на ${width}: длинные названия не расширяют колонку, вбок едет только лента карточек`, async ({ page }) => {
    await seed(page, 3, 'dark', { width, height: 800 });
    await page.evaluate(({ LONG_WORD, LONG_TEXT }) => {
      const now = new Date();
      for (let i = 0; i < 4; i++) {
        const id = `lp${i}`;
        state.projects.push({ id, name: i % 2 ? LONG_WORD : LONG_TEXT, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null });
        seedProjectStatuses(id);
        for (let k = 0; k < 4; k++) {
          const start = new Date(now.getTime() - (i * 4 + k + 2) * 3_600_000).toISOString();
          const end = new Date(now.getTime() - (i * 4 + k + 1) * 3_600_000).toISOString();
          state.tasks.push({
            id: `lt${i}-${k}`, projectId: id, title: k % 2 ? LONG_WORD : LONG_TEXT, done: false, notes: null, totalMs: 3_600_000,
            sessions: [{ start, end, ms: 3_600_000 }], rate: null, pinnedAt: null, createdAt: start, updatedAt: end,
            statusId: orderedStatuses(id)[0].id, tagIds: [], versionId: null, repeat: null,
            dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
          });
        }
      }
      openView('projects');
    }, { LONG_WORD, LONG_TEXT });
    await expect(page.locator('.ptile').first()).toBeVisible();
    await page.waitForTimeout(450);
    const m = await page.evaluate(() => {
      const view = document.getElementById('projects-view');
      const deck = document.getElementById('projects-track');
      return {
        viewW: [view.scrollWidth, view.clientWidth], viewH: view.offsetHeight - view.clientHeight,
        viewScrolls: view.scrollHeight > view.clientHeight,
        deckW: [deck.scrollWidth, deck.clientWidth], deckOx: getComputedStyle(deck).overflowX,
        doc: [document.documentElement.scrollWidth, innerWidth],
        main: (() => { const n = document.getElementById('main'); return [n.scrollWidth, n.clientWidth]; })(),
        // Ничто в таблице недавних не шире своей колонки.
        recent: [...document.querySelectorAll('.recent-row')].map((r) => r.scrollWidth - r.clientWidth),
      };
    });
    expect(m.viewW[0], `колонка страницы: scrollWidth ${m.viewW[0]} против clientWidth ${m.viewW[1]}`).toBeLessThanOrEqual(m.viewW[1]);
    expect(m.viewH, 'у колонки нет и нативной полосы снизу').toBe(0);
    expect(m.main[0]).toBeLessThanOrEqual(m.main[1]);
    expect(m.doc[0], 'страница вбок не едет').toBeLessThanOrEqual(m.doc[1]);
    expect(m.deckOx, 'лента карточек листается вбок').toBe('auto');
    expect(m.deckW[0], 'карточек больше, чем помещается, — лента шире своего окна').toBeGreaterThan(m.deckW[1]);
    expect(Math.max(...m.recent), 'строки таблицы не шире колонки').toBeLessThanOrEqual(0);
    expect(m.viewScrolls, 'вниз страница длиннее окна — это нормально, листается вертикально').toBe(true);

    // Колонка и в самом деле не листается вбок: попытка сдвинуть её не удаётся.
    const moved = await page.evaluate(() => { const v = document.getElementById('projects-view'); v.scrollLeft = 200; return v.scrollLeft; });
    expect(moved, 'колонку вбок не сдвинуть').toBe(0);
    // А лента — удаётся.
    const deckMoved = await page.evaluate(() => { const d = document.getElementById('projects-track'); d.style.scrollSnapType = 'none'; d.scrollLeft = 200; return d.scrollLeft; });
    expect(deckMoved, 'ленту вбок сдвинуть можно').toBeGreaterThan(0);
  });
}

// Обход экранов: у каждой прокручиваемой области нативная полоса скрыта и она
// подключена к накладной; вбок едут только те, кому это положено.
const SCREENS = {
  'проект: список': () => { state.ui.view = 'project'; state.ui.projectTab = 'list'; render(); },
  'проект: доска': () => { state.ui.projectTab = 'board'; render(); },
  'проект: версии': () => { state.ui.projectTab = 'versions'; render(); },
  'проект: документы': () => { state.ui.projectTab = 'docs'; render(); },
  задача: () => { selectTask('t-1'); },
  'история задачи': () => { setTaskTab('history'); },
  'время: месяц': () => { state.ui.view = 'time'; state.ui.timeMode = 'month'; render(); },
  'время: неделя': () => { state.ui.timeMode = 'week'; render(); },
  сегодня: () => { state.ui.view = 'home'; render(); },
  проекты: () => { state.ui.view = 'projects'; render(); },
  настройки: () => { state.ui.view = 'settings'; render(); },
  документы: () => { openDocs('d-0'); },
  'окно проекта': () => { openProjectDialog(null); },
  меню: () => { openMenu(document.getElementById('create-project-btn') || document.body, Array.from({ length: 40 }, (_, i) => ({ label: `Пункт ${i}`, onClick() {} }))); },
};

/** Прокручиваемые области, которым вбок ехать положено. */
const SIDEWAYS = ['projects-track', 'time-modes'];

for (const width of [1280, 375]) {
  test(`все прокручиваемые области на ${width}: нативной полосы нет, вбок не едут`, async ({ page }) => {
    await seed(page, 3, 'dark', { width, height: width > 560 ? 700 : 800 });
    const found = [];
    for (const [name, go] of Object.entries(SCREENS)) {
      await page.evaluate(go);
      await page.waitForTimeout(350);
      const bad = await page.evaluate(({ SIDEWAYS, phone }) => {
        const out = [];
        for (const n of document.querySelectorAll('body *')) {
          // Внутренности текста редактора — не наши; его страница (.led-scroll) — наша.
          if (/\bled-/.test(n.className?.toString() || '') && !n.classList.contains('led-scroll')) continue;
          if (n.closest('.led-pm, .led-pop, .led-slash, .led-overlay')) continue;
          const s = getComputedStyle(n);
          if (!/auto|scroll/.test(s.overflowX + s.overflowY)) continue;
          if (n.getBoundingClientRect().width === 0 || n.classList.contains('ovs-track')) continue;
          const id = n.id ? `#${n.id}` : `.${String(n.className).split(' ')[0] || n.tagName}`;
          const bx = n.offsetWidth - n.clientWidth - 2 * n.clientLeft;
          const by = n.offsetHeight - n.clientHeight - 2 * n.clientTop;
          if (bx !== 0 || by !== 0) out.push(`${id}: нативная полоса ${bx}×${by}`);
          // На телефонной ширине полосы прячет responsive.css, а накладная не нужна.
          // Лента, что листается вбок, подключена не к ней, а к «краю ленты».
          if (!phone && !n.hasAttribute('data-ovs') && !n.classList.contains('edge-scroll')) out.push(`${id}: не подключена к накладной полосе`);
          if (/auto|scroll/.test(s.overflowX) && s.scrollbarWidth !== 'none') out.push(`${id}: нативная полоса не скрыта (scrollbar-width: ${s.scrollbarWidth})`);
          const sideways = SIDEWAYS.some((c) => n.id === c || n.classList.contains(c)) || n.classList.contains('board-cols');
          if (!sideways && n.scrollWidth > n.clientWidth + 1) out.push(`${id}: едет вбок (${n.scrollWidth} > ${n.clientWidth})`);
        }
        return out;
      }, { SIDEWAYS, phone: width <= 560 });
      for (const b of bad) found.push(`${name}: ${b}`);
    }
    expect(found, `прокручиваемые области с замечаниями:\n  ${found.join('\n  ')}`).toEqual([]);
  });
}

test('полоса меню не закрывает меню: щелчок по бегунку — не щелчок «снаружи»', async ({ page }) => {
  await seed(page, 3);
  await page.evaluate(SCREENS.меню);
  const menu = page.locator('#ctx-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(150);
  await hover(page, '#ctx-menu');
  await expect.poll(async () => (await bar(page, '#ctx-menu')).shown, { message: 'у меню своя полоса' }).toBe(true);
  const b = await bar(page, '#ctx-menu');
  // Схватить бегунок и потянуть, потом щёлкнуть по самому бегунку.
  await page.mouse.move(b.thumb.x + b.thumb.width / 2, b.thumb.y + b.thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.thumb.x + b.thumb.width / 2, b.thumb.y + b.thumb.height / 2 + 50, { steps: 4 });
  await page.mouse.up();
  expect((await bar(page, '#ctx-menu')).top, 'меню прокрутилось бегунком').toBeGreaterThan(0);
  await expect(menu, 'меню не закрылось').toBeVisible();
  const t = await bar(page, '#ctx-menu');
  await page.mouse.click(t.thumb.x + t.thumb.width / 2, t.thumb.y + t.thumb.height / 2);
  await expect(menu, 'и после щелчка по бегунку').toBeVisible();
  // А щелчок вне меню его закрывает, как и раньше.
  await page.mouse.click(5, 300);
  await expect(menu).toBeHidden();
});

// ---------- Горизонтальной полосы нет нигде: край ленты вместо неё ----------

/** Ряд карточек «Проектов», которым тесно: к проекту из seed — ещё пять. */
async function toDeck(page, size = { width: 1280, height: 800 }, theme = 'dark') {
  await seed(page, 3, theme, size);
  await page.evaluate(() => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const id = `ex${i}`;
      state.projects.push({ id, name: `Проект ${i}`, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] });
      seedProjectStatuses(id);
    }
    openView('projects');
  });
  await expect(page.locator('.ptile').first()).toBeVisible();
  await page.waitForTimeout(450);
}

/** Доска проекта из seed: шесть столбцов шире окна. */
async function toBoard(page, size = { width: 1280, height: 700 }, theme = 'dark') {
  await seed(page, 3, theme, size);
  await page.evaluate(() => { state.ui.view = 'project'; state.ui.projectTab = 'board'; render(); });
  await expect(page.locator('.board-col').first()).toBeVisible();
  await page.waitForTimeout(450);
}

/** Края ленты глазами браузера: атрибут, на сколько пикселей растворён каждый
 *  край (из вычисленной маски, а не из наших переменных) и какие стрелки видны. */
const edges = (page, sel) => page.evaluate((sel) => {
  const box = document.querySelector(sel);
  const host = box.parentElement;
  const mask = getComputedStyle(box).maskImage;
  const left = /rgb\(0, 0, 0\) ([\d.]+)px,/.exec(mask);
  const right = /calc\(100% - ([\d.]+)px\)/.exec(mask);
  const shown = (side) => {
    const b = host.querySelector(`.edge-btn[data-side="${side}"]`);
    if (!b) return false;
    const s = getComputedStyle(b);
    return s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0.99;
  };
  return {
    attr: box.dataset.edge ?? null, mask,
    l: left ? parseFloat(left[1]) : 0, r: right ? parseFloat(right[1]) : 0,
    arrowL: shown('l'), arrowR: shown('r'),
    x: box.scrollLeft, max: box.scrollWidth - box.clientWidth,
  };
}, sel);
/** То же одной строкой — для expect.poll: «растворение слева, справа, стрелки слева, справа». */
const sides = async (page, sel) => {
  const e = await edges(page, sel);
  return [e.l, e.r, e.arrowL, e.arrowR].join();
};

const DECK = '#projects-track';
const DECK_L = '.projects-deck-host .edge-btn[data-side="l"]';
const DECK_R = '.projects-deck-host .edge-btn[data-side="r"]';
const FADE = 56;

test('горизонтальной полосы нет нигде: ни накладной дорожки, ни нативной', async ({ page }) => {
  await toDeck(page);
  const native = (sel) => page.evaluate((sel) => {
    const n = document.querySelector(sel);
    const cs = getComputedStyle(n);
    return {
      scrolls: n.scrollWidth > n.clientWidth, overflowX: cs.overflowX, width: cs.scrollbarWidth,
      barH: n.offsetHeight - n.clientHeight - 2 * n.clientTop, barW: n.offsetWidth - n.clientWidth - 2 * n.clientLeft,
    };
  }, sel);
  // Ряд карточек: вбок листается, а полосы под ним нет — ни места под неё, ни скрытой «по цвету».
  const deck = await native(DECK);
  expect(deck.scrolls, 'карточки не помещаются').toBe(true);
  expect(deck.overflowX).toBe('auto');
  expect(deck.width, 'нативная полоса погашена').toBe('none');
  expect(deck.barH, 'и места под неё нет').toBe(0);

  // Мышь над рядом и под ним, колесо крутит вбок — дорожки (накладной) не появляется.
  const b = await page.locator(DECK).boundingBox();
  await page.mouse.move(b.x + b.width / 2 - 20, b.y + b.height - 6);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 4);
  await page.mouse.wheel(300, 0);
  await page.waitForTimeout(500);
  const tracks = () => page.evaluate(() => [...document.querySelectorAll('.ovs-track')].filter((t) => t.classList.contains('on')).map((t) => {
    const r = t.getBoundingClientRect();
    return { w: r.width, h: r.height, axis: t.dataset.axis ?? null };
  }));
  expect(await page.evaluate(() => document.getElementById('projects-track').scrollLeft), 'колесо листает ленту').toBeGreaterThan(100);
  for (const t of await tracks()) {
    expect(t.h, 'показанная дорожка — вертикальная').toBeGreaterThan(t.w);
    expect(t.axis, 'у дорожки нет оси: она одна').toBeNull();
  }
  expect(await page.evaluate(() => document.querySelectorAll('.ovs-track[data-axis="x"]').length), 'горизонтальных дорожек нет').toBe(0);

  // Доска: шесть столбцов шире окна, полосы под ними нет.
  await page.evaluate(() => { state.ui.view = 'project'; state.ui.projectId = 'ex0'; state.ui.boardProjectId = 'ex0'; state.ui.projectTab = 'board'; render(); });
  await expect(page.locator('.board-col').first()).toBeVisible();
  await page.waitForTimeout(450);
  const board = await native('#board-cols');
  expect(board.scrolls, 'столбцы шире окна').toBe(true);
  expect(board.width).toBe('none');
  expect(board.barH).toBe(0);
  const bb = await page.locator('#board-cols').boundingBox();
  await page.mouse.move(bb.x + bb.width / 2 - 20, bb.y + bb.height - 6);
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height - 4);
  await page.mouse.wheel(300, 0);
  await page.waitForTimeout(500);
  for (const t of await tracks()) expect(t.h, 'показанная дорожка — вертикальная').toBeGreaterThan(t.w);
});

test('у ряда карточек: в начале растворение и стрелка только справа, посередине с обеих сторон, в конце только слева', async ({ page }) => {
  await toDeck(page);
  const prev = page.locator(DECK_L);
  const next = page.locator(DECK_R);
  const step = await page.evaluate(() => {
    const cards = document.querySelectorAll('.ptile');
    return cards[1].offsetLeft - cards[0].offsetLeft;
  });
  expect(step, 'шаг — карточка и зазор между карточками').toBe(332);

  await expect.poll(() => sides(page, DECK), { message: 'начало: справа есть что листать' }).toBe(`0,${FADE},false,true`);
  expect((await edges(page, DECK)).attr).toBe('r');
  await expect(prev).toBeHidden();

  // Нажатие — на одну карточку.
  await next.click();
  await expect.poll(() => edges(page, DECK).then((e) => e.x), { message: 'сдвиг на карточку' }).toBeCloseTo(step, -1);
  await expect.poll(() => sides(page, DECK), { message: 'середина: с обеих сторон' }).toBe(`${FADE},${FADE},true,true`);
  expect((await edges(page, DECK)).attr).toBe('l r');
  await next.click();
  await expect.poll(() => edges(page, DECK).then((e) => e.x), { message: 'ещё карточка' }).toBeCloseTo(2 * step, -1);

  // До конца: стрелка справа гаснет, а растворение справа уходит.
  for (let i = 0; i < 8 && (await edges(page, DECK)).arrowR; i++) {
    await next.click();
    await page.waitForTimeout(450);
  }
  await expect.poll(() => sides(page, DECK), { message: 'конец: листать можно только назад' }).toBe(`${FADE},0,true,false`);
  expect((await edges(page, DECK)).attr).toBe('l');
  await expect(next).toBeHidden();
  const end = (await edges(page, DECK)).x;
  expect(end, 'доехали до края ленты').toBeCloseTo((await edges(page, DECK)).max, 0);

  // Назад — тоже по карточке: к левому краю ближайшей карточки левее (конец ряда на краю карточки не лежит).
  await prev.click();
  await expect.poll(() => edges(page, DECK).then((e) => e.x), { message: 'назад — к краю карточки' }).toBeCloseTo(Math.floor((end - 5) / step) * step, -1);
  await expect(next, 'отъехали от конца — справа снова есть что листать').toBeVisible();
  for (let i = 0; i < 8 && (await edges(page, DECK)).arrowL; i++) {
    await prev.click();
    await page.waitForTimeout(450);
  }
  await expect.poll(() => sides(page, DECK), { message: 'вернулись в начало' }).toBe(`0,${FADE},false,true`);
});

test('колесо, тачпад и перетаскивание листают ленту, как листали; стрелки следят за сдвигом', async ({ page }) => {
  await toDeck(page);
  const x = () => edges(page, DECK).then((e) => e.x);
  const b = await page.locator(DECK).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 8);
  // Тачпад: горизонтальная дельта.
  await page.mouse.wheel(250, 0);
  await expect.poll(x, { message: 'горизонтальная дельта' }).toBeGreaterThan(100);
  await expect.poll(() => sides(page, DECK)).toBe(`${FADE},${FADE},true,true`);
  // Shift + колесо: вертикальная дельта едет вбок.
  const before = await x();
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 250);
  await page.keyboard.up('Shift');
  await expect.poll(x, { message: 'Shift + колесо' }).toBeGreaterThan(before + 100);
  await page.waitForTimeout(700); // колесо листает плавно: дождёмся, пока доедет, иначе оно перебьёт следующий шаг
  // Программная прокрутка (так двигает и перетаскивание полосой, и фокус): края пересчитываются сами.
  await page.evaluate(() => { const d = document.getElementById('projects-track'); d.style.scrollSnapType = 'none'; d.scrollLeft = 0; });
  await expect.poll(() => sides(page, DECK)).toBe(`0,${FADE},false,true`);
  await page.evaluate(() => { const d = document.getElementById('projects-track'); d.scrollLeft = d.scrollWidth; });
  await expect.poll(() => sides(page, DECK)).toBe(`${FADE},0,true,false`);
});

test('у «Проектов» в шапке стрелок больше нет: только заголовок и «Создать проект»', async ({ page }) => {
  await toDeck(page);
  await expect(page.locator('#deck-prev, #deck-next')).toHaveCount(0);
  const heads = await page.evaluate(() => [...document.querySelectorAll('#projects-view .page-head button')].map((n) => n.id));
  expect(heads, 'в шапке одна кнопка').toEqual(['create-project-btn']);
  // А стрелки — внутри обёртки ленты, по одной на край.
  expect(await page.evaluate(() => [...document.querySelectorAll('.projects-deck-host > .edge-btn')].map((n) => n.dataset.side))).toEqual(['l', 'r']);
});

test('стрелки края — кнопки с клавиатуры, подпись на четырёх языках', async ({ page }) => {
  await toDeck(page);
  const SIGNS = {
    ru: ['Прокрутить влево', 'Прокрутить вправо'],
    en: ['Scroll left', 'Scroll right'],
    uk: ['Прокрутити ліворуч', 'Прокрутити праворуч'],
    kk: ['Солға айналдыру', 'Оңға айналдыру'],
  };
  for (const [lang, [l, r]] of Object.entries(SIGNS)) {
    await page.evaluate((lang) => { state.settings.lang = lang; applyStaticTranslations(); }, lang);
    await expect(page.locator(DECK_L), lang).toHaveAttribute('aria-label', l);
    await expect(page.locator(DECK_R), lang).toHaveAttribute('aria-label', r);
  }
  await page.evaluate(() => { state.settings.lang = 'ru'; applyStaticTranslations(); });
  expect(await page.evaluate(() => document.querySelector('.projects-deck-host .edge-btn').tagName)).toBe('BUTTON');

  // Табом — до стрелки (карточки, поля и кнопки в них — раньше), Enter листает.
  await page.locator(DECK_R).focus();
  await expect(page.locator(DECK_R)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => edges(page, DECK).then((e) => e.x)).toBeCloseTo(332, -1);
  await expect(page.locator(DECK_R), 'фокус остался на нажатой стрелке').toBeFocused();
  await expect(page.locator(DECK_R)).toHaveCSS('outline-style', 'solid');
  // Пробел — тоже.
  await page.keyboard.press('Space');
  await expect.poll(() => edges(page, DECK).then((e) => e.x)).toBeCloseTo(664, -1);
  // Долистали до конца с клавиатуры: стрелка справа гаснет, фокус не пропадает, а переходит к левой.
  for (let i = 0; i < 8 && (await edges(page, DECK)).arrowR; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
  }
  await expect(page.locator(DECK_R)).toBeHidden();
  await expect(page.locator(DECK_L), 'фокус перешёл к стрелке назад').toBeFocused();
});

for (const theme of ['dark', 'light']) {
  test(`стрелка на подложке читается в теме «${theme}»: цвет — токены, обводки нет, отбивка тенью`, async ({ page }) => {
    await toDeck(page, { width: 1280, height: 800 }, theme);
    await page.locator(DECK_R).click();
    await expect.poll(() => sides(page, DECK)).toBe(`${FADE},${FADE},true,true`);
    const got = await page.evaluate(() => {
      const paint = (token) => {
        const probe = document.createElement('i');
        probe.style.backgroundColor = `var(${token})`;
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
      };
      const b = document.querySelector('.projects-deck-host .edge-btn[data-side="l"]');
      const s = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      const deck = document.getElementById('projects-track').getBoundingClientRect();
      return {
        icon: s.color, dim: paint('--text-dim'), raise: paint('--raise'), bg: s.backgroundColor, shadow: s.boxShadow, pop: paint('--shadow-pop'),
        blur: s.backdropFilter, radius: s.borderRadius, w: r.width, h: r.height,
        border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        inset: r.left - deck.left, mid: (r.top + r.bottom) / 2 - (deck.top + deck.bottom) / 2,
      };
    });
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    expect(got.icon, 'значок — цвет --text-dim').toBe(got.dim);
    expect(contrast(got.icon, got.raise), 'значок читается на подложке').toBeGreaterThanOrEqual(4.5);
    expect(got.bg, 'подложка — --raise, чуть прозрачная (88%)').toMatch(/\/ 0\.88\)$/);
    // С 13 октября 2026 обводки нет: от ленты кнопку отбивает тень --shadow-pop.
    expect(got.border, 'без обводки').toEqual(['0px', '0px', '0px', '0px']);
    expect(got.shadow, 'у подложки есть тень').not.toBe('none');
    expect(got.shadow, 'тень — токен --shadow-pop').toMatch(theme === 'dark' ? /0px 10px 28px/ : /0px 8px 24px/);
    expect(got.blur, 'и размытие под ней').toContain('blur');
    expect(got.radius).toBe('50%');
    expect(got.w).toBe(36);
    expect(got.h).toBe(36);
    expect(got.inset, 'стрелка — у левого края ленты').toBeCloseTo(12, 0);
    expect(Math.abs(got.mid), 'и посередине по высоте').toBeLessThanOrEqual(1);
  });
}

test('prefers-reduced-motion: стрелка листает без плавности, растворение и кнопки появляются без перехода', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toDeck(page);
  const d = await page.evaluate(() => {
    const box = document.getElementById('projects-track');
    const btn = document.querySelector('.projects-deck-host .edge-btn[data-side="r"]');
    return [getComputedStyle(btn).transitionProperty, getComputedStyle(box).transitionProperty];
  });
  expect(d[0], 'у кнопки перехода нет').toBe('none');
  expect(d[1], 'у ленты тоже: маска меняется сразу').toBe('none');
  await page.locator(DECK_R).click();
  // Не плавно: два кадра спустя лента уже на месте (плавная к этому времени проехала бы малую часть).
  const x = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('projects-track').scrollLeft)))));
  expect(x, 'сразу на карточку').toBeGreaterThanOrEqual(324);
  await expect.poll(() => sides(page, DECK)).toBe(`${FADE},${FADE},true,true`);
});

test('у доски те же края: стрелка листает на столбец, растворение — только с той стороны, где есть столбцы', async ({ page }) => {
  await toBoard(page);
  const BOARD = '#board-cols';
  const prev = page.locator('.board-host .edge-btn[data-side="l"]');
  const next = page.locator('.board-host .edge-btn[data-side="r"]');
  const step = await page.evaluate(() => {
    const cols = document.querySelectorAll('.board-col');
    return cols[1].offsetLeft - cols[0].offsetLeft;
  });
  expect(step, 'шаг — столбец и зазор').toBe(280);
  await expect.poll(() => sides(page, BOARD), { message: 'начало' }).toBe(`0,${FADE},false,true`);
  await expect(prev).toBeHidden();
  await next.click();
  await expect.poll(() => edges(page, BOARD).then((e) => e.x), { message: 'на столбец' }).toBeCloseTo(step, -1);
  await expect.poll(() => sides(page, BOARD), { message: 'середина' }).toBe(`${FADE},${FADE},true,true`);
  for (let i = 0; i < 8 && (await edges(page, BOARD)).arrowR; i++) {
    await next.click();
    await page.waitForTimeout(450);
  }
  await expect.poll(() => sides(page, BOARD), { message: 'конец' }).toBe(`${FADE},0,true,false`);
  const end = (await edges(page, BOARD)).max;
  await prev.click();
  await expect.poll(() => edges(page, BOARD).then((e) => e.x), { message: 'назад — к левому краю столбца' }).toBeCloseTo(Math.floor((end - 5) / step) * step, -1);
  // Страница при этом вбок не едет, а обёртка не изменила размеров доски: она по-прежнему во весь экран проекта.
  const fit = await page.evaluate(() => {
    const host = document.querySelector('.board-host').getBoundingClientRect();
    const box = document.getElementById('board-cols').getBoundingClientRect();
    const island = document.getElementById('proj-board').getBoundingClientRect();
    return { same: Math.abs(host.width - box.width) < 1 && Math.abs(host.height - box.height) < 1, fills: island.height - box.height, doc: document.documentElement.scrollWidth <= innerWidth };
  });
  expect(fit.same, 'обёртка доски не меняет её размеров').toBe(true);
  expect(fit.fills, 'доска занимает остров, кроме его полей (12 + 12)').toBeCloseTo(24, 0);
  expect(fit.doc).toBe(true);
});

for (const width of [1280, 375]) {
  test(`края лент на ${width}: страница вбок не едет${width < 560 ? ', стрелок нет, а растворение уже' : ''}`, async ({ page }) => {
    await toDeck(page, { width, height: 800 });
    const deck = await edges(page, DECK);
    expect(deck.attr, 'карточки не помещаются: справа есть что листать').toBe('r');
    expect(deck.l).toBe(0);
    expect(deck.r, width < 560 ? 'растворение уже, чтобы не съесть край следующей карточки' : 'растворение 56 px').toBe(width < 560 ? 28 : FADE);
    expect(deck.arrowR, width < 560 ? 'стрелок на телефонной ширине нет' : 'стрелка справа видна').toBe(width >= 560);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'страница вбок не едет').toBe(true);
    await page.evaluate(() => { state.ui.view = 'project'; state.ui.projectId = 'ex0'; state.ui.boardProjectId = 'ex0'; state.ui.projectTab = 'board'; render(); });
    await expect(page.locator('.board-col').first()).toBeVisible();
    await page.waitForTimeout(450);
    const board = await edges(page, '#board-cols');
    expect(board.attr, 'столбцы шире окна').toBe('r');
    expect(board.arrowR, 'стрелка доски').toBe(width >= 560);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'и доска вбок страницу не двигает').toBe(true);
  });
}

test('переключатель режимов «Времени» на узкой ширине: растворение края вместо полосы, без стрелок', async ({ page }) => {
  // Четыре режима не встают в 320 px (самый узкий телефон); в 375 уже влезают, и растворения там нет.
  await seed(page, 3, 'dark', { width: 320, height: 800 });
  await page.evaluate(() => { state.ui.view = 'time'; state.ui.timeMode = 'month'; render(); });
  await page.waitForTimeout(450);
  const seg = await page.evaluate(() => {
    const n = document.getElementById('time-modes');
    const cs = getComputedStyle(n);
    return { scrolls: n.scrollWidth > n.clientWidth + 1, ox: cs.overflowX, width: cs.scrollbarWidth, barH: n.offsetHeight - n.clientHeight, arrows: n.parentElement.querySelectorAll('.edge-btn').length };
  });
  expect(seg.scrolls, 'четыре режима в 320 px не встают').toBe(true);
  expect(seg.ox).toBe('auto');
  expect(seg.width, 'нативной полосы нет').toBe('none');
  expect(seg.barH).toBe(0);
  expect(seg.arrows, 'стрелок у переключателя нет — только растворение').toBe(0);
  const e = await edges(page, '#time-modes');
  expect(e.attr).toBe('r');
  expect(e.r, 'растворение справа уже — переключатель мал').toBe(24);
  expect(e.l).toBe(0);
  // Листаем пальцем — края пересчитываются.
  await page.evaluate(() => { document.getElementById('time-modes').scrollLeft = 9999; });
  await expect.poll(() => sides(page, '#time-modes').then((s) => s.split(',').slice(0, 2).join())).toBe('24,0');
  // На широком окне полоса не нужна: нечего листать — нет и растворения.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => edges(page, '#time-modes').then((x) => x.attr)).toBeNull();
});

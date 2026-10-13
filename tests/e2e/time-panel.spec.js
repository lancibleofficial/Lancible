// Правая панель раздела «Время»: день → проект → запись. Запуск: npm run test:e2e
//
// Жалоба 10 октября 2026: «проекты еле видно и непонятно, что где». Имя
// проекта стояло тем же размером, что записи под ним, группы ничем не были
// связаны, а в записи интервал стоял над названием задачи. Теперь иерархия
// читается с первого взгляда: заголовок дня с итогом справа; проект — цветная
// метка, имя основным цветом полужирным и итог; слева группу связывает полоса
// цвета проекта, записи лежат под заголовком с отступом; в записи сверху
// задача и длительность, под ними интервал и деньги приглушённо.
//
// Всё проверяется замером: рамки, вычисленные цвета и контраст по WCAG — на
// глаз «заметный» и «приглушённый» не отличить от «такой же».
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const BLUE = '#5ec8f2';
const YELLOW = '#f5c451';
const GREEN = '#87ff65';
const LONG_NAME = 'Очень-очень длинное название проекта, которое не помещается в узкую правую колонку';
// Слово без пробелов: переносить его нечем, кроме как посреди слова.
const LONG_TASK = 'Сверхдлинноеназваниезадачибезпробеловкотороенельзяперенести'.repeat(2);

/** Две обычные группы (синяя и жёлтая) и, если просят, третья — с длинными
 *  именем проекта и названием задачи. Всё сегодня, на закреплённых часах:
 *  панель показывает выбранный день, а выбран по умолчанию сегодняшний. */
async function open(page, { width = 1280, theme = 'dark', long = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ theme, long, BLUE, YELLOW, GREEN, LONG_NAME, LONG_TASK }) => {
    // Рамка элемента — для замеров в тестах ниже.
    window.__box = (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    const now = new Date();
    const mkProject = (name, color) => {
      const id = uid();
      state.projects.push({ id, name, color, description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [] });
      seedProjectStatuses(id);
      return id;
    };
    const span = (h, m, min) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
      const ms = min * 60_000;
      return { start: start.toISOString(), end: new Date(start.getTime() + ms).toISOString(), ms };
    };
    const addTask = (pid, title, sessions) => {
      const cols = orderedStatuses(pid);
      state.tasks.push({
        id: uid(), projectId: pid, title, done: false, notes: null,
        totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions, rate: null, pinnedAt: null,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    };
    const p1 = mkProject('Сайт клиента', BLUE);
    const p2 = mkProject('Тест', YELLOW);
    state.settings.hourlyRate = 4925;
    state.settings.currency = 'KZT';
    addTask(p1, 'Анализ референсов и игры', [span(0, 50, 1)]);
    addTask(p1, 'Прототип игры', [span(0, 51, 23)]);
    addTask(p2, 'Тест', [span(8, 18, 0)]);
    if (long) {
      const p3 = mkProject(LONG_NAME, GREEN);
      addTask(p3, LONG_TASK, [span(9, 0, 95)]);
      addTask(p3, 'Короткая', [span(10, 30, 15)]);
    }
    state.ui.projectId = p1;
    state.ui.view = 'time';
    state.ui.timeMode = 'month';
    state.settings.theme = theme;
    applyTheme();
    render();
  }, { theme, long, BLUE, YELLOW, GREEN, LONG_NAME, LONG_TASK });
  await expect(page.locator('#cal-day-list .cdl-group').first()).toBeVisible();
  // Строки въезжают 180 мс (tileIn): замер до конца анимации сдвинут.
  await page.waitForTimeout(450);
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const theme of ['dark', 'light']) {
  test(`${theme}: имя проекта — основным цветом, полужирным, и читается на фоне панели`, async ({ page }) => {
    await open(page, { theme });
    const m = await page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        panel: cs('#cal-day-panel').backgroundColor,
        name: cs('.cdl-group-name').color,
        nameWeight: Number(cs('.cdl-group-name').fontWeight),
        nameSize: parseFloat(cs('.cdl-group-name').fontSize),
        task: cs('.cdl-task').color,
        taskSize: parseFloat(cs('.cdl-task').fontSize),
        tot: cs('.cdl-group-tot').color,
        totWeight: Number(cs('.cdl-group-tot').fontWeight),
      };
    });
    expect(contrast(parse(m.name), parse(m.panel)), 'имя проекта на фоне панели').toBeGreaterThanOrEqual(4.5);
    expect(m.name, 'имя проекта — основным цветом текста, как задача').toBe(m.task);
    expect(m.name, 'имя проекта не приглушено, как итог рядом').not.toBe(m.tot);
    expect(m.nameWeight, 'имя проекта полужирное').toBeGreaterThanOrEqual(600);
    expect(m.totWeight, 'итог рядом легче имени').toBeLessThan(m.nameWeight);
    expect(m.nameSize, 'имя проекта крупнее записей под ним').toBeGreaterThan(m.taskSize);
  });
}

test('метка и полоса группы — цвет проекта, полоса идёт вдоль всей группы', async ({ page }) => {
  await open(page);
  const groups = await page.evaluate(() => [...document.querySelectorAll('#cal-day-list .cdl-group')].map((g) => {
    const head = g.querySelector('.cdl-group-head').getBoundingClientRect();
    const box = g.getBoundingClientRect();
    const bar = getComputedStyle(g, '::before');
    return {
      name: g.querySelector('.cdl-group-name').textContent,
      dot: getComputedStyle(g.querySelector('.cdl-group-dot')).backgroundColor,
      bar: bar.backgroundColor,
      barWidth: parseFloat(bar.width),
      barHeight: parseFloat(bar.height),
      barLeft: box.left + parseFloat(bar.left),
      groupHeight: box.height,
      headLeft: head.left,
    };
  }));
  expect(groups.map((g) => g.name)).toEqual(['Сайт клиента', 'Тест']);
  const want = [BLUE, YELLOW].map((h) => `rgb(${rgb(h).join(', ')})`);
  groups.forEach((g, i) => {
    expect(g.dot, `${g.name}: метка`).toBe(want[i]);
    expect(g.bar, `${g.name}: полоса`).toBe(want[i]);
    expect(g.barWidth, `${g.name}: полоса видна`).toBeGreaterThanOrEqual(2);
    expect(g.barHeight, `${g.name}: полоса идёт вдоль группы, а не точкой`).toBeGreaterThanOrEqual(g.groupHeight - 8);
    expect(g.barLeft, `${g.name}: полоса левее заголовка`).toBeLessThan(g.headLeft);
  });
});

test('записи лежат под заголовком проекта с отступом', async ({ page }) => {
  await open(page);
  const m = await page.evaluate(() => {
    const b = window.__box;
    return [...document.querySelectorAll('#cal-day-list .cdl-group')].map((g) => ({
      name: g.querySelector('.cdl-group-name').textContent,
      head: b(g.querySelector('.cdl-group-head')),
      rows: [...g.querySelectorAll('.cdl-rows > li')].map((li) => ({
        row: b(li), task: b(li.querySelector('.cdl-task')), time: b(li.querySelector('.cdl-time')),
      })),
    }));
  });
  for (const g of m) {
    expect(g.rows.length, `${g.name}: записи есть`).toBeGreaterThan(0);
    for (const r of g.rows) {
      expect(r.task.left - g.head.left, `${g.name}: задача правее начала заголовка`).toBeGreaterThanOrEqual(12);
      expect(r.time.left - g.head.left, `${g.name}: интервал правее начала заголовка`).toBeGreaterThanOrEqual(12);
      expect(r.row.top, `${g.name}: запись ниже заголовка`).toBeGreaterThanOrEqual(g.head.bottom);
      expect(r.row.right, `${g.name}: запись не выходит за правый край`).toBeLessThanOrEqual(g.head.right + 0.5);
    }
  }
});

test('в записи: сверху задача и длительность, под ними интервал и деньги приглушённо', async ({ page }) => {
  await open(page);
  const rows = await page.evaluate(() => {
    const b = window.__box;
    const cs = (n) => getComputedStyle(n);
    return [...document.querySelectorAll('#cal-day-list .cdl-rows > li')].map((li) => {
      const q = (s) => li.querySelector(s);
      return {
        title: q('.cdl-task').textContent,
        task: b(q('.cdl-task')), dur: b(q('.cdl-dur')), time: b(q('.cdl-time')), money: b(q('.cdl-money')),
        taskColor: cs(q('.cdl-task')).color, timeColor: cs(q('.cdl-time')).color, moneyColor: cs(q('.cdl-money')).color,
        taskSize: parseFloat(cs(q('.cdl-task')).fontSize), timeSize: parseFloat(cs(q('.cdl-time')).fontSize),
        timeText: q('.cdl-time').textContent, durText: q('.cdl-dur').textContent,
        timeNums: cs(q('.cdl-time')).fontVariantNumeric,
      };
    });
  });
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(r.task.bottom, `${r.title}: задача выше интервала`).toBeLessThanOrEqual(r.time.top + 1);
    expect(Math.abs(r.dur.top - r.task.top), `${r.title}: длительность на строке задачи`).toBeLessThanOrEqual(3);
    expect(Math.abs(r.money.top - r.time.top), `${r.title}: деньги на строке интервала`).toBeLessThanOrEqual(3);
    expect(r.dur.left, `${r.title}: длительность правее задачи`).toBeGreaterThanOrEqual(r.task.right);
    expect(Math.abs(r.money.right - r.dur.right), `${r.title}: деньги и длительность у одного края`).toBeLessThanOrEqual(1);
    expect(r.time.left, `${r.title}: интервал под задачей, с её левого края`).toBeCloseTo(r.task.left, 0);
    expect(r.timeColor, `${r.title}: интервал приглушён`).not.toBe(r.taskColor);
    expect(r.moneyColor, `${r.title}: деньги приглушены`).toBe(r.timeColor);
    expect(r.timeSize, `${r.title}: интервал мельче задачи`).toBeLessThan(r.taskSize);
    expect(r.timeSize, `${r.title}: но не мельче 12 px`).toBeGreaterThanOrEqual(12);
    expect(r.timeNums, `${r.title}: цифры интервала одной ширины`).toContain('tabular-nums');
    expect(r.timeText).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
  }
  expect(rows.map((r) => r.title)).toEqual(['Анализ референсов и игры', 'Прототип игры', 'Тест']);
});

test('заголовок дня: итог справа в одной строке, от проектов отделён воздухом', async ({ page }) => {
  await open(page);
  const m = await page.evaluate(() => {
    const b = window.__box;
    return {
      panel: b(document.querySelector('#cal-day-panel')),
      top: b(document.querySelector('.cal-day-top')),
      head: b(document.querySelector('#cal-day-head')),
      tot: b(document.querySelector('#cal-day-tot')),
      group: b(document.querySelector('#cal-day-list .cdl-group')),
      totText: document.getElementById('cal-day-tot').textContent,
    };
  });
  expect(m.totText, 'итог дня на месте').toMatch(/24м/);
  expect(m.tot.left, 'итог правее заголовка').toBeGreaterThanOrEqual(m.head.right);
  expect(Math.abs((m.head.top + m.head.bottom) - (m.tot.top + m.tot.bottom)) / 2, 'одна строка').toBeLessThan(6);
  expect(m.panel.right - m.tot.right, 'итог у правого края панели').toBeLessThanOrEqual(20);
  expect(m.group.top - m.top.bottom, 'воздух между заголовком дня и проектом').toBeGreaterThanOrEqual(12);
});

test('длинное имя проекта — одной строкой с многоточием, итог не уезжает', async ({ page }) => {
  for (const width of [1280, 375]) {
    await open(page, { width, long: true });
    const m = await page.evaluate(({ LONG_NAME }) => {
      const b = window.__box;
      const g = [...document.querySelectorAll('#cal-day-list .cdl-group')]
        .find((x) => x.querySelector('.cdl-group-name').textContent === LONG_NAME);
      const name = g.querySelector('.cdl-group-name');
      const cs = getComputedStyle(name);
      return {
        found: !!g,
        head: b(g.querySelector('.cdl-group-head')), name: b(name), tot: b(g.querySelector('.cdl-group-tot')),
        panel: b(document.querySelector('#cal-day-panel')),
        cut: name.scrollWidth > name.clientWidth,
        overflow: cs.textOverflow, wrap: cs.whiteSpace, lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4,
        title: name.textContent,
      };
    }, { LONG_NAME });
    const at = `${width}px`;
    expect(m.found, `${at}: группа длинного проекта есть`).toBe(true);
    expect(m.title, `${at}: имя не потеряно — полное в тексте`).toBe(LONG_NAME);
    expect(m.cut, `${at}: имя не влезает и обрезано`).toBe(true);
    expect(m.overflow).toBe('ellipsis');
    expect(m.wrap).toBe('nowrap');
    expect(m.name.height, `${at}: имя в одну строку`).toBeLessThanOrEqual(m.lineHeight * 1.5);
    expect(m.tot.left, `${at}: итог правее имени`).toBeGreaterThanOrEqual(m.name.right);
    expect(m.tot.right, `${at}: итог не уехал за заголовок`).toBeLessThanOrEqual(m.head.right + 0.5);
    expect(m.tot.right, `${at}: итог не уехал за панель`).toBeLessThanOrEqual(m.panel.right);
    expect(m.tot.height, `${at}: итог не перенесён`).toBeLessThanOrEqual(m.lineHeight * 1.5);
  }
});

test('ничего не вылезает: ни из панели, ни из окна, прокрутки вбок нет — на 1280 и 375', async ({ page }) => {
  for (const width of [1280, 375]) {
    await open(page, { width, long: true });
    const m = await page.evaluate(() => {
      const panel = document.querySelector('#cal-day-panel');
      const p = panel.getBoundingClientRect();
      const out = [];
      for (const n of panel.querySelectorAll('*')) {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.right > p.right + 0.5 || r.left < p.left - 0.5) out.push(`${n.className || n.tagName}: ${Math.round(r.left)}–${Math.round(r.right)} при панели ${Math.round(p.left)}–${Math.round(p.right)}`);
      }
      const view = document.getElementById('time-view');
      return {
        stray: out,
        docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        viewScroll: view.scrollWidth - view.clientWidth,
        panelScroll: panel.scrollWidth - panel.clientWidth,
        listScroll: document.getElementById('cal-day-list').scrollWidth - document.getElementById('cal-day-list').clientWidth,
        panelRight: p.right, win: window.innerWidth,
      };
    });
    const at = `${width}px`;
    expect(m.stray, `${at}: элементы вне панели`).toEqual([]);
    expect(m.docScroll, `${at}: страница не прокручивается вбок`).toBeLessThanOrEqual(0);
    expect(m.viewScroll, `${at}: раздел не прокручивается вбок`).toBeLessThanOrEqual(0);
    expect(m.panelScroll, `${at}: панель не прокручивается вбок`).toBeLessThanOrEqual(0);
    expect(m.listScroll, `${at}: список не прокручивается вбок`).toBeLessThanOrEqual(0);
    expect(m.panelRight, `${at}: панель в пределах окна`).toBeLessThanOrEqual(m.win);
  }
});

test('длинная задача без пробелов переносится внутри записи, а не выпирает', async ({ page }) => {
  await open(page, { width: 375, long: true });
  const m = await page.evaluate(({ LONG_TASK }) => {
    const b = window.__box;
    const li = [...document.querySelectorAll('#cal-day-list .cdl-rows > li')]
      .find((x) => x.querySelector('.cdl-task').textContent === LONG_TASK);
    return { found: !!li, row: b(li), task: b(li.querySelector('.cdl-task')), dur: b(li.querySelector('.cdl-dur')) };
  }, { LONG_TASK });
  expect(m.found).toBe(true);
  expect(m.task.right, 'задача в пределах строки').toBeLessThanOrEqual(m.row.right);
  expect(m.dur.left, 'длительность не наезжает на задачу').toBeGreaterThanOrEqual(m.task.right);
  expect(m.dur.right, 'длительность в пределах строки').toBeLessThanOrEqual(m.row.right);
});

test('проект сворачивается и разворачивается: итог виден, полоса остаётся у заголовка', async ({ page }) => {
  await open(page);
  const group = () => page.locator('#cal-day-list .cdl-group').first();
  await expect(group().locator('.cdl-rows')).toBeVisible();
  const open0 = await group().boundingBox();

  await group().locator('.cdl-group-head').click();
  await expect(group()).toHaveClass(/closed/);
  await expect(group().locator('.cdl-group-head')).toHaveAttribute('aria-expanded', 'false');
  await expect(group().locator('.cdl-rows')).toBeHidden();
  await expect(group().locator('.cdl-group-tot')).toBeVisible();
  const shut = await group().boundingBox();
  expect(shut.height, 'свёрнутая группа ниже развёрнутой').toBeLessThan(open0.height);
  const bar = await group().evaluate((g) => parseFloat(getComputedStyle(g, '::before').height));
  expect(bar, 'полоса у свёрнутой группы есть и идёт вдоль заголовка').toBeGreaterThanOrEqual(shut.height - 8);

  await group().locator('.cdl-group-head').click();
  await expect(group()).not.toHaveClass(/closed/);
  await expect(group().locator('.cdl-group-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(group().locator('.cdl-rows')).toBeVisible();
});

// --- Анимация складывания (10 октября 2026: «добавь анимацию раскрытия») ---
// Движение проверяется не глазом и не таймером, а через Web Animations: щелчок
// порождает CSSTransition, его можно остановить на середине и замерить.

/** Секунды из значения transition-duration/-delay («0.2s, 0s» → наибольшее). */
const secs = (v) => Math.max(...v.split(',').map((x) => parseFloat(x)));

/** Ждёт конца всех идущих переходов страницы. */
const settle = (page) => page.evaluate(
  () => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {}))),
);

/** Невидимая кнопка внутри первой записи группы: пробует, достижима ли запись
 *  с клавиатуры. Она вынута из потока, так что высоты группы не меняет; видимость
 *  наследует от списка записей, как и любой фокусируемый элемент внутри. */
const focusProbe = (group) => group.evaluate((g) => {
  let b = g.querySelector('#cdl-probe');
  if (!b) {
    b = document.createElement('button');
    b.id = 'cdl-probe';
    b.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;padding:0;border:0';
    g.querySelector('.cdl-rows > li').appendChild(b);
  }
  b.focus();
  const reached = document.activeElement === b;
  b.blur();
  return reached;
});

test('складывание идёт переходом по высоте: записи гаснут, полоса и стрелка едут вместе', async ({ page }) => {
  await open(page);
  const group = page.locator('#cal-day-list .cdl-group').first();
  await focusProbe(group);
  const sizes = () => group.evaluate((g) => ({
    group: g.getBoundingClientRect().height,
    rows: g.querySelector('.cdl-rows').getBoundingClientRect().height,
    head: g.querySelector('.cdl-group-head').getBoundingClientRect().height,
    bar: parseFloat(getComputedStyle(g, '::before').height),
    visibility: getComputedStyle(g.querySelector('.cdl-rows')).visibility,
  }));

  const css = await group.evaluate((g) => {
    const cs = (n) => getComputedStyle(n);
    const rows = cs(g.querySelector('.cdl-rows'));
    return {
      rows: { props: rows.transitionProperty, dur: rows.transitionDuration },
      chev: { props: cs(g.querySelector('.cdl-chev')).transitionProperty, dur: cs(g.querySelector('.cdl-chev')).transitionDuration },
    };
  });
  expect(css.rows.props, 'записи складываются по высоте').toContain('height');
  expect(secs(css.rows.dur), 'складывание ~200 мс').toBeGreaterThanOrEqual(0.15);
  expect(secs(css.rows.dur)).toBeLessThanOrEqual(0.3);
  expect(css.rows.props, 'и проявляются/гаснут').toContain('opacity');
  expect(css.chev.props, 'стрелка поворачивается').toContain('transform');
  expect(secs(css.chev.dur), 'с той же длительностью').toBe(secs(css.rows.dur));

  const full = await sizes();
  expect(full.rows, 'развёрнутая группа показывает записи целиком').toBeGreaterThan(40);
  expect(full.visibility).toBe('visible');
  expect(await focusProbe(group), 'в развёрнутой группе запись достижима').toBe(true);

  // Сворачиваем и останавливаем переход ровно посередине.
  await group.locator('.cdl-group-head').click();
  const mid = await group.evaluate((g) => {
    const anims = g.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition);
    const props = anims.map((a) => a.transitionProperty);
    anims.forEach((a) => { a.pause(); a.currentTime = 100; });
    const rows = g.querySelector('.cdl-rows');
    return {
      props,
      group: g.getBoundingClientRect().height,
      head: g.querySelector('.cdl-group-head').getBoundingClientRect().height,
      rows: rows.getBoundingClientRect().height,
      opacity: Number(getComputedStyle(rows).opacity),
      visibility: getComputedStyle(rows).visibility,
      bar: parseFloat(getComputedStyle(g, '::before').height),
      turn: new DOMMatrix(getComputedStyle(g.querySelector('.cdl-chev')).transform).a,
    };
  });
  expect(mid.props, 'щелчок запустил переходы высоты, прозрачности и поворота').toEqual(
    expect.arrayContaining(['height', 'opacity', 'transform']),
  );
  expect(mid.group, 'на середине группа ниже полной').toBeLessThan(full.group - 4);
  expect(mid.group, 'и выше свёрнутой').toBeGreaterThan(full.head + 4);
  expect(mid.rows, 'записи ужались наполовину, не скачком').toBeGreaterThan(2);
  expect(mid.rows).toBeLessThan(full.rows - 2);
  // Именно это ломал приём 1fr → 0fr: группа шла по прямой, записи — по квадрату,
  // и под обрезанными записями оставалась пустота, по которой тянулась полоса.
  expect(Math.abs(mid.group - (full.head + mid.rows)), 'группа ровно заголовок плюс видимые записи').toBeLessThanOrEqual(1);
  expect(mid.head, 'заголовок посреди перехода не растягивается').toBeCloseTo(full.head, 0);
  expect(mid.opacity, 'записи гаснут постепенно').toBeGreaterThan(0.02);
  expect(mid.opacity).toBeLessThan(0.98);
  expect(mid.visibility, 'пока складывается, записи ещё видны').toBe('visible');
  expect(Math.abs(mid.bar - (mid.group - 4)), 'полоса держится за низ группы и едет вместе с ней').toBeLessThanOrEqual(1);
  expect(mid.turn, 'стрелка в пути: cos угла между 1 и 0').toBeGreaterThan(0.02);
  expect(mid.turn).toBeLessThan(0.98);
  await group.evaluate((g) => g.getAnimations({ subtree: true }).forEach((a) => a.finish()));
  await settle(page);

  const shut = await sizes();
  expect(shut.rows, 'свёрнутые записи занимают 0').toBeLessThanOrEqual(0.5);
  expect(shut.group, 'группа — один заголовок').toBeLessThanOrEqual(full.head + 1);
  expect(shut.visibility, 'свёрнутые записи скрыты от фокуса и скринридера').toBe('hidden');
  expect(await focusProbe(group), 'в свёрнутой группе запись недостижима').toBe(false);
  await expect(group.locator('.cdl-group-head')).toHaveAttribute('aria-expanded', 'false');
  expect(Math.abs(shut.bar - (shut.group - 4)), 'полоса — вдоль одного заголовка').toBeLessThanOrEqual(1);

  // Обратно: возвращается ровно прежняя высота, записи снова достижимы.
  await group.locator('.cdl-group-head').click();
  const back = await group.evaluate((g) => {
    const anims = g.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition);
    anims.forEach((a) => { a.pause(); a.currentTime = 100; });
    return { group: g.getBoundingClientRect().height, visibility: getComputedStyle(g.querySelector('.cdl-rows')).visibility };
  });
  expect(back.group, 'на пути обратно группа между свёрнутой и полной').toBeGreaterThan(shut.group + 4);
  expect(back.group).toBeLessThan(full.group - 4);
  expect(back.visibility, 'разворачиваясь, записи видны сразу — иначе проявляться было бы нечему').toBe('visible');
  await group.evaluate((g) => g.getAnimations({ subtree: true }).forEach((a) => a.finish()));
  await settle(page);
  const again = await sizes();
  expect(Math.abs(again.group - full.group), 'высота вернулась').toBeLessThanOrEqual(1);
  expect(Math.abs(again.rows - full.rows)).toBeLessThanOrEqual(1);
  expect(await focusProbe(group)).toBe(true);
});

test('prefers-reduced-motion: группа складывается сразу, без движения', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const group = page.locator('#cal-day-list .cdl-group').first();
  const css = await group.evaluate((g) => {
    const cs = (n) => getComputedStyle(n);
    const rows = g.querySelector('.cdl-rows');
    return {
      rows: cs(rows).transitionDuration,
      chev: cs(g.querySelector('.cdl-chev')).transitionDuration,
      rowsDelay: cs(rows).transitionDelay,
    };
  });
  expect(secs(css.rows), 'высота и прозрачность без длительности').toBeLessThan(0.001);
  expect(secs(css.chev), 'стрелка без длительности').toBeLessThan(0.001);
  expect(secs(css.rowsDelay), 'и скрытие записей без задержки').toBe(0);

  await group.locator('.cdl-group-head').click();
  // Переход, если и заведён, длится доли миллисекунды: за кадр группа уже сложена.
  await expect(group.locator('.cdl-rows')).toBeHidden({ timeout: 300 });
  const m = await group.evaluate((g) => ({
    group: g.getBoundingClientRect().height,
    head: g.querySelector('.cdl-group-head').getBoundingClientRect().height,
    long: g.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition && a.effect.getComputedTiming().endTime > 1).length,
  }));
  expect(m.long, 'ни одного заметного перехода').toBe(0);
  expect(m.group).toBeLessThanOrEqual(m.head + 1);
});

test('перерисовка и смена периода не играют складывание: только щелчок по стрелке', async ({ page }) => {
  await open(page);
  // Перерисовка с уже свёрнутым проектом: сразу итоговый вид, перехода нет.
  const fresh = await page.evaluate(() => {
    // Переходы складывания внутри списка записей; фоновые (наведение) не в счёт.
    window.foldTransitions = () => document.getElementById('cal-day-list').getAnimations({ subtree: true })
      .filter((a) => a instanceof CSSTransition && ['height', 'opacity', 'visibility', 'transform'].includes(a.transitionProperty)).length;
    calGroupsClosed.add(state.projects.find((p) => p.name === 'Сайт клиента').id);
    renderCalDayPanel();
    const g = document.querySelector('#cal-day-list .cdl-group');
    const rows = g.querySelector('.cdl-rows');
    return {
      closed: g.classList.contains('closed'),
      transitions: foldTransitions(),
      rows: rows.getBoundingClientRect().height,
      visibility: getComputedStyle(rows).visibility,
      expanded: g.querySelector('.cdl-group-head').getAttribute('aria-expanded'),
    };
  });
  expect(fresh.closed, 'свёрнутый проект рисуется свёрнутым').toBe(true);
  expect(fresh.expanded).toBe('false');
  expect(fresh.transitions, 'перерисовка не запускает ни одного перехода').toBe(0);
  expect(fresh.rows, 'в первом же кадре записи уже сложены').toBeLessThanOrEqual(0.5);
  expect(fresh.visibility).toBe('hidden');

  // Смена вида на период: та же группа, то же состояние, и тоже без движения.
  await page.locator('#cal-period-toggle').click();
  const today = () => page.locator('#cal-days .cal-cell.today');
  await today().click();
  await today().click();
  await expect(page.locator('#cal-day-list.period-list')).toBeVisible();
  const group = page.locator('#cal-day-list .cdl-group').first();
  await expect(group).toHaveClass(/closed/);
  const period = await group.evaluate((g) => ({
    transitions: foldTransitions(),
    rows: g.querySelector('.cdl-rows').getBoundingClientRect().height,
    props: getComputedStyle(g.querySelector('.cdl-rows')).transitionProperty,
  }));
  expect(period.transitions, 'смена периода переходов не запускает').toBe(0);
  expect(period.rows).toBeLessThanOrEqual(0.5);
  expect(period.props, 'но в сводке периода группа складывается тем же переходом').toContain('height');

  // Щелчок — единственное, что запускает движение.
  await group.locator('.cdl-group-head').click();
  const clicked = await group.evaluate((g) => g.getAnimations({ subtree: true })
    .filter((a) => a instanceof CSSTransition).map((a) => a.transitionProperty));
  expect(clicked, 'щелчок в сводке периода запускает складывание').toContain('height');
  await settle(page);
  await expect(group.locator('.cdl-rows')).toBeVisible();
});

test('нажатие на запись по-прежнему открывает задачу', async ({ page }) => {
  await open(page);
  await page.locator('#cal-day-list .cdl-rows > li', { hasText: 'Прототип игры' }).click();
  await expect(page.locator('#task-view')).toBeVisible();
});

test('сводка за период: те же группы с полосой, длительность над деньгами, деньги не акцентом', async ({ page }) => {
  await open(page);
  await page.locator('#cal-period-toggle').click();
  const today = () => page.locator('#cal-days .cal-cell.today');
  await today().click();
  await today().click();
  await expect(page.locator('#cal-day-list.period-list')).toBeVisible();
  const groups = page.locator('#cal-day-list .cdl-group');
  await expect(groups).toHaveCount(2);
  await page.waitForTimeout(450);

  const m = await page.evaluate(() => {
    const b = window.__box;
    const cs = (n) => getComputedStyle(n);
    const g = document.querySelector('#cal-day-list .cdl-group');
    const li = g.querySelector('.cdl-rows > li');
    return {
      bar: getComputedStyle(g, '::before').backgroundColor, dot: cs(g.querySelector('.cdl-group-dot')).backgroundColor,
      time: b(li.querySelector('.pl-time')), money: b(li.querySelector('.pl-money')), name: b(li.querySelector('.pl-name')),
      moneyColor: cs(li.querySelector('.pl-money')).color, totColor: cs(g.querySelector('.cdl-group-tot')).color,
      head: b(g.querySelector('.cdl-group-head')),
    };
  });
  expect(m.bar).toBe(`rgb(${rgb(BLUE).join(', ')})`);
  expect(m.dot).toBe(m.bar);
  expect(m.time.bottom, 'длительность над деньгами').toBeLessThanOrEqual(m.money.top + 1);
  expect(m.moneyColor, 'деньги — приглушённым текстом, как итог рядом').toBe(m.totColor);
  expect(m.name.left - m.head.left, 'задача правее начала заголовка проекта').toBeGreaterThan(0);
});

test('длинное название задачи в записи — не больше трёх строк, дальше многоточие', async ({ page }) => {
  // Название из слов (с пробелами), а не одно длинное слово: переносится
  // оно как обычный текст, и без ограничения заняло бы пол-панели.
  const SENTENCE = 'Подготовить подробное техническое задание для подрядчика по разработке мобильного приложения, согласовать его с заказчиком и юристами, разослать на ознакомление всей команде и собрать замечания';
  for (const width of [1280, 375]) {
    await open(page, { width });
    await page.evaluate((SENTENCE) => {
      const now = new Date();
      const pid = state.projects[0].id;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
      state.tasks.push({
        id: uid(), projectId: pid, title: SENTENCE, done: false, notes: null,
        totalMs: 3_600_000, sessions: [{ start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), ms: 3_600_000 }],
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: orderedStatuses(pid)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
      render();
    }, SENTENCE);
    await page.waitForTimeout(450);

    const m = await page.evaluate((SENTENCE) => {
      const tasks = [...document.querySelectorAll('#cal-day-list .cdl-task')];
      const long = tasks.find((n) => n.textContent === SENTENCE);
      const one = tasks.find((n) => n.textContent === 'Тест');
      const s = getComputedStyle(long);
      return {
        found: !!long,
        longH: long.getBoundingClientRect().height,
        oneH: one.getBoundingClientRect().height,
        clamp: s.webkitLineClamp, overflow: s.overflow,
        cut: long.scrollHeight > long.clientHeight + 1,
        pageW: document.documentElement.scrollWidth, winW: document.documentElement.clientWidth,
      };
    }, SENTENCE);
    expect(m.found, `${width}: запись найдена`).toBe(true);
    expect(m.clamp, `${width}: -webkit-line-clamp`).toBe('3');
    expect(m.overflow, `${width}: лишнее скрыто`).toBe('hidden');
    expect(m.longH, `${width}: не больше трёх строк`).toBeLessThanOrEqual((3 * m.oneH) + 1);
    expect(m.longH, `${width}: и ровно три — название длинное`).toBeGreaterThanOrEqual((3 * m.oneH) - 1);
    expect(m.cut, `${width}: хвост обрезан (многоточие)`).toBe(true);
    expect(m.pageW, `${width}: страницу вбок не утащить`).toBeLessThanOrEqual(m.winW);
  }
});

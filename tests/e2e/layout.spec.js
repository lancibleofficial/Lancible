// Вёрстка веб-версии в числах. Запуск: npm run test:e2e
//
// Зачем. До сих пор это мерялось руками: открыть, прогнать
// getBoundingClientRect в консоли, посмотреть. Проверка жила ровно один раз —
// в тот день, когда её делали, и следующая правка разметки её не касалась.
// Здесь она становится кодом: три вещи, которые ломаются молча и видны
// только замером.
//
// 1. Горизонтальная прокрутка. Один элемент шире окна — и страницу можно
//    утащить вбок. На широком экране этого не видно совсем.
// 2. Положение модалок. Центровку задаёт одно общее правило (это проверяет
//    tests/unit/ui-rules.test.js), но сработало ли оно — видно только после
//    отрисовки.
// 3. Всплывающее меню у правого края. .ctx-menu позиционируется кодом, и
//    если расчёт не учтёт ширину окна, меню уедет за край.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const VIEWS = ['home', 'projects', 'board', 'time', 'project', 'task', 'settings'];
const WIDTHS = [1280, 375];

async function open(page) {
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  // Один проект с одной задачей: пустые виды ничего не ломают, а заполненные
  // как раз и выезжают за край.
  await page.evaluate(() => {
    const p = {
      id: uid(), name: 'Очень длинное название проекта для проверки ширины',
      color: '#87ff65', description: '', pinnedAt: null,
      createdAt: new Date().toISOString(), tagIds: [],
    };
    state.projects.push(p);
    state.tasks.push({
      id: uid(), projectId: p.id, title: 'Задача с не менее длинным названием, чем у проекта',
      notes: '', statusId: null, done: false, totalMs: 3_600_000, sessions: [],
      createdAt: new Date().toISOString(), tagIds: [], dueAt: null,
    });
    state.ui.projectId = p.id;
  });
}

/** Можно ли утащить страницу вбок — и кто в этом виноват.
 *
 *  Утверждение всегда одно: scrollWidth не больше clientWidth. Список
 *  виновников нужен только для сообщения об ошибке: по «страница шире окна»
 *  непонятно, что чинить.
 *
 *  Кого в этот список не берём. Элемент, который шире окна, но обрезан
 *  предком с overflow, прокрутку не создаёт — так устроен, например, скелет
 *  загрузки: полоска шириной 180 px выходит за край .skel-main, а тот её
 *  обрезает. Фиксированные элементы и их содержимое тоже не растягивают
 *  документ. */
const overflowers = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const limit = doc.clientWidth;
  const clipped = (el) => {
    for (let n = el.parentElement; n && n !== doc; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed') return true;
      if (cs.overflowX !== 'visible') return true;
    }
    return false;
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= limit + 1) continue;
    if (getComputedStyle(el).position === 'fixed') continue;
    if (clipped(el)) continue;
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    out.push(`${el.tagName.toLowerCase()}${id}${cls} → ${Math.round(r.right)} при ${limit}`);
  }
  return {
    scrollsSideways: doc.scrollWidth > doc.clientWidth,
    culprits: [...new Set(out)].slice(0, 10),
  };
});

for (const width of WIDTHS) {
  test(`страницу нельзя утащить вбок при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    for (const view of VIEWS) {
      // Страница задачи открывается только через выбор задачи.
      await page.evaluate((v) => {
        if (v === 'task') selectTask(state.tasks[0].id);
        else { state.ui.view = v; render(); }
      }, view);
      const got = await overflowers(page);
      expect(got.scrollsSideways,
        `вид ${view}: страницу можно утащить вбок; за край вылезли:\n  ${got.culprits.join('\n  ')}`)
        .toBe(false);
    }
  });

  test(`модалки стоят по центру и помещаются в окно при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const ids = await page.evaluate(() => [...document.querySelectorAll('[id$="-backdrop"]')].map((n) => n.id));
    expect(ids.length, 'подложек не нашлось').toBeGreaterThan(7);

    for (const id of ids) {
      const box = await page.evaluate((backdropId) => {
        const back = document.getElementById(backdropId);
        back.hidden = false;
        const modal = back.querySelector('.modal, .modal-lg, .modal-wide') || back.firstElementChild;
        const r = modal.getBoundingClientRect();
        back.hidden = true;
        return {
          left: r.left, right: r.right, width: r.width,
          win: document.documentElement.clientWidth,
        };
      }, id);
      // Центр окна и центр окна модалки совпадают с точностью до пикселя
      // округления. Полоса прокрутки сюда не вмешивается: меряем по
      // clientWidth, а не по innerWidth.
      const offset = Math.abs((box.left + box.right) / 2 - box.win / 2);
      expect(offset, `${id}: смещение от центра`).toBeLessThanOrEqual(1);
      expect(box.left, `${id}: левый край за окном`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${id}: правый край за окном`).toBeLessThanOrEqual(box.win);
    }
  });
}

// «Время работы»: отрезки в свойствах задачи и окно отрезка. Повтор у задачи
// один, и подпись в окне отрезка длинная («Повторяется каждые 2 нед., по Пн, Чт
// вместе с задачей»): в узком окне она переносится и не растягивает страницу;
// оба окна — отрезка и повторения задачи поверх него — стоят по центру,
// помещаются и страницу вбок не тянут.
for (const width of WIDTHS) {
  test(`время работы: строка и оба окна помещаются и стоят по центру при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.evaluate(() => {
      const task = state.tasks[0];
      const day = (h, m) => new Date(2026, 5, 10, h, m, 0).toISOString();
      task.repeat = Core.normalizeRepeat({ freq: 'week', every: 2, weekdays: [1, 4] });
      task.slots = [
        { id: 'a', start: day(10, 0), end: day(12, 0) },
        { id: 'b', start: day(14, 0), end: day(15, 30) },
      ];
      selectTask(task.id);
    });
    // С 13 октября 2026 отрезки — строкой «Время работы» в свойствах.
    await expect(page.locator('#slots-value')).toHaveText('Ср, 10 июн. 10:00–12:00 +1');
    const chips = await overflowers(page);
    expect(chips.scrollsSideways, `строка отрезков тянет страницу вбок:\n  ${chips.culprits.join('\n  ')}`).toBe(false);

    const centred = async (id) => {
      // Окно выезжает анимацией (popIn, а на узком экране — снизу): мерить
      // его на лету нельзя, оно ещё не встало.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      const box = await page.evaluate((backdropId) => {
        const back = document.getElementById(backdropId);
        const r = back.querySelector('.modal').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, win: document.documentElement.clientWidth, height: window.innerHeight };
      }, id);
      expect(Math.abs((box.left + box.right) / 2 - box.win / 2), `${id}: смещение от центра`).toBeLessThanOrEqual(1);
      expect(box.left, `${id}: левый край за окном`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${id}: правый край за окном`).toBeLessThanOrEqual(box.win);
      expect(box.bottom, `${id}: нижний край за окном`).toBeLessThanOrEqual(box.height);
    };

    await page.evaluate(() => openSlotDialog(state.tasks[0], Core.slotsOf(state.tasks[0])[1]));
    await expect(page.locator('#sldlg-backdrop')).toBeVisible();
    await expect(page.locator('#sldlg-repeat-note')).toContainText('Повторяется каждые 2 нед., по Пн, Чт вместе с задачей');
    await centred('sldlg-backdrop');
    const withDialog = await overflowers(page);
    expect(withDialog.scrollsSideways, `окно отрезка тянет страницу вбок:\n  ${withDialog.culprits.join('\n  ')}`).toBe(false);

    // Окно повторения задачи — из окна отрезка, строкой «Повторение задачи», и ложится поверх него.
    await page.locator('#sldlg-repeat-row').click();
    await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
    await centred('rpdlg-backdrop');
    const withRepeat = await overflowers(page);
    expect(withRepeat.scrollsSideways, `окно повторения задачи тянет страницу вбок:\n  ${withRepeat.culprits.join('\n  ')}`).toBe(false);
  });
}

// «Напоминания»: чипы с длинными подписями («Каждый месяц 31-го в 09:00», «За
// 86400 мин до дедлайна») не тянут страницу вбок, а окно напоминания во всех
// трёх видах стоит по центру и помещается в окно.
for (const width of WIDTHS) {
  test(`напоминания: строки и окно помещаются и стоят по центру при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.evaluate(() => {
      const task = state.tasks[0];
      const day = (h, m) => new Date(2026, 5, 10, h, m, 0).toISOString();
      task.dueAt = day(18, 0);
      task.slots = [{ id: 'a', start: day(10, 0), end: day(12, 0) }];
      Object.assign(task, Core.withReminders(task, [
        { kind: 'before', anchor: 'start', offsetMin: 86400 },
        { kind: 'before', anchor: 'due', offsetMin: 60 },
        { kind: 'at', at: day(9, 30) },
        { kind: 'repeat', rule: Core.normalizeRepeat({ freq: 'week', every: 1, weekdays: [1, 2, 3, 4, 5, 6, 0] }), time: '09:00', start: day(8, 0) },
        { kind: 'repeat', rule: Core.normalizeRepeat({ freq: 'month', every: 1 }), time: '09:00', start: new Date(2026, 6, 31).toISOString() },
      ]));
      selectTask(task.id);
    });
    await expect(page.locator('#remind-row .remind-item')).toHaveCount(5);
    const chips = await overflowers(page);
    expect(chips.scrollsSideways, `строки напоминаний тянут страницу вбок: ${chips.culprits.join('; ')}`).toBe(false);

    for (const kind of ['before', 'at', 'repeat']) {
      await page.evaluate((k) => {
        openReminderDialog(state.tasks[0], null);
        rmdlg.kind = k;
        rmdlg.freq = 'week';
        rmdlg.weekdays = [1, 2, 3, 4, 5, 6, 0];
        renderReminderDialog();
      }, kind);
      await expect(page.locator('#rmdlg-backdrop')).toBeVisible();
      // Окно выезжает анимацией (popIn, а на узком экране — снизу): мерить его
      // на лету нельзя, оно ещё не встало. Ждём только его анимации: колокольчик
      // с непрочитанным звонит долго, и к окну он не относится.
      await page.evaluate(() => Promise.all(document.getElementById('rmdlg-backdrop').getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))));
      const box = await page.evaluate(() => {
        const r = document.querySelector('#rmdlg-backdrop .modal').getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom, win: document.documentElement.clientWidth, height: window.innerHeight };
      });
      expect(Math.abs((box.left + box.right) / 2 - box.win / 2), `${kind}: смещение от центра`).toBeLessThanOrEqual(1);
      expect(box.left, `${kind}: левый край за окном`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${kind}: правый край за окном`).toBeLessThanOrEqual(box.win);
      expect(box.bottom, `${kind}: нижний край за окном`).toBeLessThanOrEqual(box.height);
      const wide = await overflowers(page);
      expect(wide.scrollsSideways, `окно напоминания (${kind}) тянет страницу вбок: ${wide.culprits.join('; ')}`).toBe(false);
      await page.locator('#rmdlg-cancel').click();
      await expect(page.locator('#rmdlg-backdrop')).toBeHidden();
    }
  });
}

test('всплывающее меню не уезжает за край окна', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  // Вызов из точки у самого правого края — худший случай: меню раскрывается
  // влево, если расчёт верный, и наружу, если нет.
  const box = await page.evaluate(() => {
    const anchor = document.createElement('div');
    anchor.style.cssText = 'position:fixed; top:40px; right:2px; width:10px; height:10px;';
    document.body.appendChild(anchor);
    openMenu(anchor, [
      { label: 'Пункт с довольно длинным названием', onClick: () => {} },
      { label: 'Ещё один такой же длинный пункт', onClick: () => {} },
    ]);
    const r = document.getElementById('ctx-menu').getBoundingClientRect();
    anchor.remove();
    return { left: r.left, right: r.right, win: document.documentElement.clientWidth };
  });
  expect(box.right, 'меню вылезло за правый край').toBeLessThanOrEqual(box.win);
  expect(box.left, 'меню вылезло за левый край').toBeGreaterThanOrEqual(0);
});

/** Значки, которые стоят вплотную к своей подписи. Подпись — следующий за
 *  значком текст в той же строке; бейдж поверх (position: absolute, цифра
 *  на колокольчике) — не подпись. */
const tightIcons = (page, min) => page.evaluate((MIN) => {
  const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const textBox = (n) => {
    const rg = document.createRange();
    rg.selectNodeContents(n);
    return [...rg.getClientRects()].find((r) => r.width > 0);
  };
  const out = [];
  for (const ic of document.querySelectorAll('svg.icon')) {
    if (!shown(ic)) continue;
    const ir = ic.getBoundingClientRect();
    let label = null;
    for (let n = ic.nextSibling; n && !label; n = n.nextSibling) {
      if (n.nodeType === 3 && n.textContent.trim()) label = textBox(n);
      else if (n.nodeType === 1 && shown(n) && n.textContent.trim() && getComputedStyle(n).position !== 'absolute') label = textBox(n);
    }
    if (!label || label.top > ir.bottom || label.bottom < ir.top) continue;
    const gap = label.left - ir.right;
    if (gap < MIN) {
      const p = ic.parentElement;
      out.push(`${p.tagName.toLowerCase()}${p.id ? `#${p.id}` : ''}.${String(p.className).trim().split(/\s+/).join('.')} «${p.textContent.trim().slice(0, 24)}»: ${gap.toFixed(1)} px`);
    }
  }
  return out;
}, min);

// «Список», «Доска» и «Версии» стояли вплотную к своим значкам — у кнопок
// сегмента не было отступа. Мерим все виды разом: новая кнопка со значком
// без воздуха попадёт сюда, где бы ни появилась.
test('между значком и подписью есть воздух на каждом экране', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const found = [];
  const screens = [...VIEWS.map((v) => [v]), ...['day', 'week', 'month', 'agenda'].map((m) => ['time', m])];
  for (const [view, mode] of screens) {
    await page.evaluate(([v, m]) => {
      if (v === 'task') { selectTask(state.tasks[0].id); return; }
      state.ui.view = v;
      if (m) state.ui.timeMode = m;
      render();
    }, [view, mode]);
    for (const f of await tightIcons(page, 4)) found.push(`${view}${mode ? `:${mode}` : ''} — ${f}`);
  }
  expect(found, `значок вплотную к подписи:\n  ${found.join('\n  ')}`).toEqual([]);
});

// Полоса прокрутки накладная: видна, только пока над областью мышь или её
// крутят, и гаснет через секунду. Подробно — scrollbar.spec.js; здесь — тот
// же ход на странице «Проектов», с которой всё началось.
test('полоса прокрутки прячется, пока область не трогают', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await open(page);
  await page.evaluate(() => {
    // Карточки проектов стоят в ряд и вниз страницу не тянут — её длинной
    // делает таблица недавних задач под ними.
    const now = Date.now();
    for (let i = 0; i < 24; i++) {
      state.projects.push({ id: `px${i}`, name: `Проект ${i}`, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
      const start = new Date(now - (i + 2) * 3_600_000).toISOString();
      const end = new Date(now - (i + 1) * 3_600_000).toISOString();
      state.tasks.push({ id: `tx${i}`, projectId: `px${i}`, title: `Задача ${i}`, done: false, totalMs: 3_600_000, sessions: [{ start, end, ms: 3_600_000 }], tagIds: [], createdAt: start, updatedAt: end });
    }
    state.ui.view = 'projects';
    render();
  });
  // Видимая дорожка — та, что с классом on и не прозрачная.
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.ovs-track')]
    .filter((t) => t.classList.contains('on') && getComputedStyle(t).visibility === 'visible').length);
  const scrolls = await page.evaluate(() => { const n = document.getElementById('projects-view'); return n.scrollHeight > n.clientHeight; });
  expect(scrolls, 'страница проектов должна прокручиваться').toBe(true);

  const rail = await page.locator('#navrail .nav-items').boundingBox();
  await page.mouse.move(rail.x + 10, rail.y + 10);
  // Полосы мелькают и от прокрутки при отрисовке (список проектов в рейле) —
  // дожидаемся тишины: секунда без движения, и их нет.
  await expect.poll(shown, { message: 'в покое полосы нет', timeout: 3000 }).toBe(0);

  const area = await page.locator('#projects-view').boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + 60);
  await expect.poll(shown, { message: 'мышь над областью — полоса видна' }).toBeGreaterThan(0);

  await page.evaluate(() => { document.getElementById('projects-view').scrollTop = 40; });
  await expect.poll(shown, { message: 'крутят — полоса видна' }).toBeGreaterThan(0);
  await page.mouse.move(rail.x + 10, rail.y + 10);
  await expect.poll(shown, { message: 'через секунду тишины гаснет', timeout: 3000 }).toBe(0);
});

// Строка заголовка страницы («Проекты · 2 + Создать проект», «Настройки»,
// название проекта…) стоит на месте, пока прокручивается всё под ней. До 11
// октября на «Проектах» и в «Настройках» страница прокручивалась целиком, и
// строка уезжала вместе с содержимым, а с ней — кнопка «Создать проект».
// Меряется положение строки до и после прокрутки всех прокручиваемых
// областей экрана; утверждение «прокрутили хоть что-то» стоит отдельно — без
// него тест был бы вечнозелёным на экране, где прокручивать нечего.
test('строка заголовка не уезжает, когда содержимое под ней прокручивают', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await open(page);
  await page.evaluate(() => {
    const now = Date.now();
    for (let i = 0; i < 24; i++) {
      const pid = `px${i}`;
      state.projects.push({ id: pid, name: `Проект ${i}`, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
      const start = new Date(now - (i + 2) * 3_600_000).toISOString();
      const end = new Date(now - (i + 1) * 3_600_000).toISOString();
      state.tasks.push({ id: `tx${i}`, projectId: pid, title: `Задача ${i}`, done: false, totalMs: 3_600_000, sessions: [{ start, end, ms: 3_600_000 }], tagIds: [], createdAt: start, updatedAt: end });
    }
    // Длинный список задач в открытом проекте и в списке документов.
    for (let i = 0; i < 40; i++) {
      state.tasks.push({ id: `ty${i}`, projectId: state.ui.projectId, title: `Ещё задача ${i}`, notes: '', statusId: null, done: false, totalMs: 0, sessions: [], createdAt: new Date().toISOString(), tagIds: [], dueAt: null });
      const d = Core.newDocument({ id: uid(), projectId: null });
      d.title = `Документ ${i}`;
      state.documents.push(d);
    }
  });

  const screens = [
    { name: 'Проекты', view: 'projects', head: '#projects-view .page-head', btn: '#create-project-btn' },
    { name: 'Настройки', view: 'settings', head: '#settings-view .page-head', btn: '#settings-view .page-title' },
    { name: 'Документы', view: 'docs', head: '#docs-view .docs-side-head', btn: '#doc-new' },
    { name: 'Статистика', view: 'time', head: '#time-view .time-head', btn: '#ag-create' },
    { name: 'Проект', view: 'project', head: '#project-header', btn: '#new-task-btn' },
  ];
  for (const s of screens) {
    await page.evaluate((v) => { state.ui.view = v; render(); }, s.view);
    // Экран въезжает 0,22 с (viewIn): до конца въезда рамка ещё плывёт.
    await expect(page.locator('#main > .view:not([hidden])')).toHaveClass(/settled/);
    const measure = () => page.evaluate(({ head, btn }) => {
      const h = document.querySelector(head).getBoundingClientRect();
      const b = document.querySelector(btn).getBoundingClientRect();
      return { top: h.top, bottom: h.bottom, btnTop: b.top, btnBottom: b.bottom, btnW: b.width };
    }, s);
    const before = await measure();
    // Всё, что на экране прокручивается, — в самый низ.
    const scrolled = await page.evaluate(() => {
      const view = document.querySelector('#main > .view:not([hidden])');
      let total = 0;
      for (const n of [view, ...view.querySelectorAll('*')]) {
        if (!/(auto|scroll)/.test(getComputedStyle(n).overflowY) || n.scrollHeight <= n.clientHeight + 2) continue;
        n.scrollTop = n.scrollHeight;
        total += n.scrollTop;
      }
      return total;
    });
    expect(scrolled, `${s.name}: прокручивать было нечего — тест ничего не проверяет`).toBeGreaterThan(0);
    const after = await measure();
    expect(Math.abs(after.top - before.top), `${s.name}: строка заголовка сдвинулась (${before.top} → ${after.top})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.btnTop - before.btnTop), `${s.name}: кнопка в заголовке сдвинулась`).toBeLessThanOrEqual(0.5);
    expect(after.btnW, `${s.name}: кнопка видна`).toBeGreaterThan(0);
    expect(after.top, `${s.name}: строка заголовка в окне`).toBeGreaterThanOrEqual(0);
    expect(after.btnBottom, `${s.name}: кнопка в окне`).toBeLessThanOrEqual(600);
  }
});

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

// Полоса прокрутки видна, только пока над областью мышь или её крутят, и
// гаснет через секунду. Цвет — у вычисленного стиля бегунка: на снимке
// полосы нет вовсе, Playwright запускает браузер с --hide-scrollbars.
test('полоса прокрутки прячется, пока область не трогают', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await open(page);
  await page.evaluate(() => {
    for (let i = 0; i < 24; i++) {
      state.projects.push({ id: `px${i}`, name: `Проект ${i}`, color: '#5ec8f2', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
    }
    state.ui.view = 'projects';
    render();
  });
  const thumb = () => page.evaluate(() => getComputedStyle(document.getElementById('projects-view'), '::-webkit-scrollbar-thumb').backgroundColor);
  const scrolls = await page.evaluate(() => { const n = document.getElementById('projects-view'); return n.scrollHeight > n.clientHeight; });
  expect(scrolls, 'страница проектов должна прокручиваться').toBe(true);
  const hidden = 'rgba(0, 0, 0, 0)';

  const rail = await page.locator('#navrail .nav-items').boundingBox();
  await page.mouse.move(rail.x + 10, rail.y + 10);
  expect(await thumb(), 'в покое полосы нет').toBe(hidden);

  const area = await page.locator('#projects-view').boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + 60);
  expect(await thumb(), 'мышь над областью — полоса видна').not.toBe(hidden);

  await page.mouse.move(rail.x + 10, rail.y + 10);
  expect(await thumb(), 'мышь ушла — полосы снова нет').toBe(hidden);

  await page.evaluate(() => { document.getElementById('projects-view').scrollTop = 40; });
  await expect.poll(thumb, { message: 'крутят — полоса видна' }).not.toBe(hidden);
  await expect.poll(thumb, { message: 'через секунду тишины гаснет', timeout: 3000 }).toBe(hidden);
});

// Страница «Календарь»: часовая сетка, перетаскивание записей, проекты как
// календари. Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');

const HOUR = 3_600_000;

/** Три проекта с записями на этой неделе: пересекающиеся, ночная через
 *  полночь и пара дедлайнов. Готовим в состоянии приложения — через
 *  интерфейс такие времена не набрать. */
async function seed(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();

  return page.evaluate((HOUR) => {
    const now = new Date();
    const mkProject = (name, color) => {
      const id = uid();
      state.projects.push({
        id, name, color, description: '',
        pinnedAt: null, createdAt: now.toISOString(), tagIds: [],
      });
      seedProjectStatuses(id);
      return id;
    };
    const p1 = mkProject('Сайт клиента', '#87ff65');
    const p2 = mkProject('Лендинг', '#5ec8f2');
    state.settings.hourlyRate = 2000;
    state.settings.currency = 'RUB';

    const dueAt = (days, hh) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hh, 0, 0).toISOString();
    const addTask = (pid, title, spans, due) => {
      const cols = orderedStatuses(pid);
      const sessions = spans.map(([daysAgo, hh, mm, hours]) => {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hh, mm, 0);
        const ms = hours * HOUR;
        return { start: start.toISOString(), end: new Date(start.getTime() + ms).toISOString(), ms };
      });
      state.tasks.push({
        id: uid(), projectId: pid, title, done: false, notes: null,
        totalMs: sessions.reduce((a, s) => a + s.ms, 0), sessions,
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: due || null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    };
    // Сегодня: три записи внахлёст.
    addTask(p1, 'Вёрстка карточек', [[0, 10, 0, 2]], dueAt(1, 18));
    addTask(p1, 'API отчётов', [[0, 10, 30, 1]]);
    addTask(p1, 'Разбор задач', [[0, 11, 0, 0.5]]);
    addTask(p2, 'Первый экран', [[0, 16, 0, 1.25]], dueAt(0, 20));
    // Вчера с 23:00 на 2.5 часа — переходит за полночь.
    addTask(p2, 'Ночная выкатка', [[1, 23, 0, 2.5]]);

    state.ui.view = 'calendar';
    render();
    return { p1, p2 };
  }, HOUR);
}

/** Тянет указателем: настоящий drag Playwright сюда не подходит — сетка
 *  слушает pointer-события и работает с захватом указателя.
 *
 *  Начало — либо точка сетки {day, h, m}, либо блок по названию задачи: у
 *  блока важна точка внутри него, от неё считается место захвата. */
async function drag(page, from, to, startTitle) {
  await page.evaluate(({ from, to, startTitle }) => {
    const cols = document.getElementById('ag-cols');
    const r = cols.getBoundingClientRect();
    const days = Number(cols.style.getPropertyValue('--ag-days')) || 7;
    const at = (p) => ({
      x: r.left + (r.width * ((p.day + 0.5) / days)),
      y: r.top + (r.height * (((p.h * 60) + (p.m || 0)) / 1440)),
    });

    let target = cols;
    let a;
    if (startTitle) {
      target = [...document.querySelectorAll('.ag-ev')]
        .find((e) => e.querySelector('.ag-ev-name').textContent === startTitle);
      if (!target) throw new Error(`блок «${startTitle}» не найден`);
      const br = target.getBoundingClientRect();
      a = { x: br.left + (br.width / 2), y: br.top + 8 };
    } else {
      a = at(from);
    }
    const b = at(to);
    const ev = (type, x, y, node) => (node || cols).dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
    );
    ev('pointerdown', a.x, a.y, target);
    ev('pointermove', (a.x + b.x) / 2, (a.y + b.y) / 2);
    ev('pointermove', b.x, b.y);
    ev('pointerup', b.x, b.y);
  }, { from, to, startTitle });
}

const sessionOf = (page, title) => page.evaluate((title) => {
  const task = state.tasks.find((t) => t.title === title);
  const s = task.sessions[0];
  const d = new Date(s.start);
  return {
    weekday: d.getDay(),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    hours: s.ms / 3600000,
    manual: !!s.manual,
    totalHours: task.totalMs / 3600000,
    count: task.sessions.length,
  };
}, title);

test('календарь — отдельная страница, старый в статистике остался', async ({ page }) => {
  await seed(page);
  const views = await page.locator('.nav-item[data-view]').evaluateAll((els) => els.map((e) => e.dataset.view));
  expect(views).toContain('calendar');
  await expect(page.locator('#calendar-view .ag-layout')).toBeVisible();
  // Календарь «Статистики» никуда не делся: он про деньги и итоги.
  await expect(page.locator('#stats-view .cal-grid')).toHaveCount(1);
});

test('неделя: семь столбцов, сутки часами, записи блоками', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#ag-modes button.on')).toHaveText('Неделя');
  await expect(page.locator('.ag-dayname')).toHaveCount(7);
  await expect(page.locator('.ag-col')).toHaveCount(7);
  await expect(page.locator('.ag-hour')).toHaveCount(24);
  // Пять записей, но ночная разрезана полуночью на два куска.
  await expect(page.locator('.ag-ev')).toHaveCount(6);
  await expect(page.locator('.ag-dl')).toHaveCount(2);
});

test('пересекающиеся записи встают рядом и делят ширину столбца', async ({ page }) => {
  await seed(page);
  const m = await page.evaluate(() => {
    const col = [...document.querySelectorAll('.ag-col')].find((c) => c.querySelector('.ag-now'));
    const evs = [...col.querySelectorAll('.ag-ev')].map((e) => {
      const r = e.getBoundingClientRect();
      return { time: e.querySelector('.ag-ev-time').textContent, left: Math.round(r.left), width: Math.round(r.width) };
    });
    return { colWidth: Math.round(col.getBoundingClientRect().width), evs };
  });
  const overlapping = m.evs.filter((e) => /^1[01]:/.test(e.time));
  expect(overlapping.length, 'три записи внахлёст').toBe(3);
  expect(new Set(overlapping.map((e) => e.left)).size, 'каждая в своей колонке').toBe(3);
  for (const e of overlapping) {
    expect(e.width, 'внахлёст — треть ширины').toBeLessThan(m.colWidth / 2);
  }
  const alone = m.evs.find((e) => e.time.startsWith('16:'));
  expect(alone.width, 'одиночная занимает столбец целиком').toBeGreaterThan(m.colWidth * 0.8);
});

test('запись через полночь показана в обоих днях', async ({ page }) => {
  await seed(page);
  const pieces = await page.locator('.ag-ev.cross').evaluateAll((els) => els.map((e) => e.querySelector('.ag-ev-time').textContent));
  expect(pieces.length, 'два куска').toBe(2);
  expect(pieces.some((p) => p.startsWith('23:00')), `куски: ${pieces}`).toBe(true);
  expect(pieces.some((p) => p.startsWith('00:00')), `куски: ${pieces}`).toBe(true);
});

test('черта «сейчас» стоит в сегодняшнем столбце и на своём месте', async ({ page }) => {
  await seed(page);
  const m = await page.evaluate(() => {
    const line = document.querySelector('.ag-now');
    const col = line.parentElement;
    const cr = col.getBoundingClientRect();
    const lr = line.getBoundingClientRect();
    const now = new Date();
    return {
      inToday: col.classList.contains('today'),
      fraction: (lr.top - cr.top) / cr.height,
      expected: ((now.getHours() * 60) + now.getMinutes()) / 1440,
      count: document.querySelectorAll('.ag-now').length,
    };
  });
  expect(m.count, 'черта одна').toBe(1);
  expect(m.inToday).toBe(true);
  expect(Math.abs(m.fraction - m.expected) * 1440, 'расхождение больше минуты').toBeLessThan(1.5);
});

test('протягивание по пустому месту заводит запись для выбранной задачи', async ({ page }) => {
  await seed(page);
  const before = await page.evaluate(() => state.tasks.reduce((a, t) => a + t.sessions.length, 0));

  await drag(page, { day: 1, h: 9 }, { day: 1, h: 11, m: 30 });
  await expect(page.locator('.ag-pick')).toBeVisible();
  await page.locator('.ag-pick .tag-pop-item', { hasText: 'API отчётов' }).click();

  const after = await page.evaluate(() => state.tasks.reduce((a, t) => a + t.sessions.length, 0));
  expect(after).toBe(before + 1);

  const made = await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'API отчётов');
    const s = task.sessions.find((x) => x.manual);
    const d = new Date(s.start);
    return {
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      hours: s.ms / 3600000,
      rate: s.rate,
      totalHours: task.totalMs / 3600000,
    };
  });
  expect(made.time).toBe('09:00');
  expect(made.hours).toBe(2.5);
  // Ставка запоминается такой, какая сейчас — ровно как в окне правки записи.
  expect(made.rate).toBe(2000);
  expect(made.totalHours).toBe(1 + 2.5);
});

test('перенос блока меняет день и время, но не длительность и не происхождение', async ({ page }) => {
  await seed(page);
  const before = await sessionOf(page, 'Первый экран');
  expect(before.time).toBe('16:00');
  expect(before.manual, 'запись сделана таймером, а не руками').toBe(false);

  // Тянем в последний столбец недели — он всегда воскресенье, какой бы день
  // ни был сегодня. Жёсткий индекс дня в тесте зависел бы от дня прогона.
  await drag(page, null, { day: 6, h: 9 }, 'Первый экран');

  const after = await sessionOf(page, 'Первый экран');
  expect(after.weekday, 'должен переехать в воскресенье — последний столбец').toBe(0);
  expect(after.hours, 'длительность сохраняется').toBe(before.hours);
  expect(after.totalHours, 'сумма по задаче не меняется').toBe(before.totalHours);
  expect(after.manual, 'происхождение записи не меняется от того, что её подвинули').toBe(false);
});

test('растягивание за нижний край меняет длительность и сумму по задаче', async ({ page }) => {
  await seed(page);
  const before = await sessionOf(page, 'Первый экран');

  await page.evaluate(() => {
    const ev = [...document.querySelectorAll('.ag-ev')].find((e) => e.querySelector('.ag-ev-name').textContent === 'Первый экран');
    const grip = ev.querySelector('.ag-ev-grip');
    const gr = grip.getBoundingClientRect();
    const cols = document.getElementById('ag-cols');
    const cr = cols.getBoundingClientRect();
    const y = cr.top + cr.height * (19 / 24);
    const fire = (type, x, yy, node) => (node || cols).dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: yy, button: 0, pointerId: 1 }),
    );
    fire('pointerdown', gr.left + (gr.width / 2), gr.top + 3, grip);
    fire('pointermove', gr.left + (gr.width / 2), y);
    fire('pointerup', gr.left + (gr.width / 2), y);
  });

  const after = await sessionOf(page, 'Первый экран');
  expect(after.time, 'начало на месте').toBe(before.time);
  expect(after.hours, 'стала длиннее').toBeGreaterThan(before.hours);
  expect(after.totalHours, 'сумма по задаче догоняет').toBe(after.hours);
});

test('клик по блоку без протягивания открывает окно правки записи', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const ev = [...document.querySelectorAll('.ag-ev')].find((e) => e.querySelector('.ag-ev-name').textContent === 'Первый экран');
    const r = ev.getBoundingClientRect();
    const x = r.left + (r.width / 2);
    const y = r.top + 10;
    const fire = (type, node) => (node || document.getElementById('ag-cols')).dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
    );
    fire('pointerdown', ev);
    fire('pointerup');
  });
  await expect(page.locator('#sdlg-backdrop')).toBeVisible();
});

test('проекты слева работают как календари: галочка прячет их записи', async ({ page }) => {
  await seed(page);
  await expect(page.locator('.ag-proj')).toHaveCount(2);
  const before = await page.locator('.ag-ev').count();

  await page.locator('.ag-proj', { hasText: 'Лендинг' }).click();
  await expect(page.locator('.ag-proj.off')).toHaveCount(1);
  const after = await page.locator('.ag-ev').count();
  expect(after, 'записи «Лендинга» должны пропасть').toBeLessThan(before);

  await page.locator('.ag-proj', { hasText: 'Лендинг' }).click();
  await expect(page.locator('.ag-ev')).toHaveCount(before);
});

test('режимы переключаются и показывают разное', async ({ page }) => {
  await seed(page);
  const mode = (m) => page.locator(`#ag-modes button[data-mode="${m}"]`).click();

  await mode('day');
  await expect(page.locator('.ag-col')).toHaveCount(1);
  await mode('days4');
  await expect(page.locator('.ag-col')).toHaveCount(4);

  await mode('month');
  await expect(page.locator('#ag-time')).toBeHidden();
  await expect(page.locator('#ag-month')).toBeVisible();
  const cells = await page.locator('.ag-month-cell').count();
  expect(cells % 7, 'месяц — целое число недель').toBe(0);

  await mode('agenda');
  await expect(page.locator('#ag-list')).toBeVisible();
  await expect(page.locator('.ag-list-row').first()).toBeVisible();

  await mode('week');
  await expect(page.locator('.ag-col')).toHaveCount(7);
});

test('горячие клавиши переключают режимы и возвращают к сегодня', async ({ page }) => {
  await seed(page);
  await page.locator('#ag-title').click();

  await page.keyboard.press('d');
  await expect(page.locator('#ag-modes button.on')).toHaveText('День');
  await page.keyboard.press('m');
  await expect(page.locator('#ag-modes button.on')).toHaveText('Месяц');
  await page.keyboard.press('w');
  await expect(page.locator('#ag-modes button.on')).toHaveText('Неделя');

  const title = await page.locator('#ag-title').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ag-title')).not.toHaveText(title);
  await page.keyboard.press('t');
  await expect(page.locator('#ag-title')).toHaveText(title);
});

test('мини-календарь перелистывается и уводит сетку на выбранный день', async ({ page }) => {
  await seed(page);
  await expect(page.locator('.ag-mini-day')).toHaveCount(42);
  // Подсвечен весь показанный отрезок, а не один день.
  expect(await page.locator('.ag-mini-day.sel').count()).toBe(7);

  const title = await page.locator('#ag-mini-title').textContent();
  await page.locator('#ag-mini-next').click();
  await expect(page.locator('#ag-mini-title')).not.toHaveText(title);
  await page.locator('#ag-mini-prev').click();
  await expect(page.locator('#ag-mini-title')).toHaveText(title);
});

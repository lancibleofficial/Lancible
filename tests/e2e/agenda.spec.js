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

test('клик по блоку без протягивания открывает задачу, а не двигает её', async ({ page }) => {
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
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
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

test('выделенная зона открывает окно создания со всеми настройками', async ({ page }) => {
  // Черновик заводится сразу, чтобы окно могло показать настоящие настройки
  // задачи. Пока окно открыто, задача уже есть — и её блок виден на сетке.
  await seed(page);
  const before = await page.evaluate(() => state.tasks.length);
  await drag(page, { day: 2, h: 9 }, { day: 2, h: 10, m: 30 });

  const dlg = page.locator('#tmdlg-backdrop');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#tmdlg-kicker')).toHaveText('Создать задачу');
  await expect(page.locator('#tmdlg-title')).toBeFocused();
  await expect(page.locator('#tmdlg-title')).toHaveAttribute('placeholder', 'Название задачи');
  await expect(page.locator('#tmdlg-start')).toHaveText('09:00');
  await expect(page.locator('#tmdlg-end')).toHaveText('10:30');
  await expect(page.locator('#tmdlg-open')).toHaveText('Отмена');
  await expect(page.locator('#tmdlg-done')).toHaveText('Создать');
  // Настройки — те же, что во вкладке задачи: узел переехал сюда целиком.
  await expect(page.locator('#tmdlg-params #task-status')).toBeVisible();
  await expect(page.locator('#tmdlg-params #task-tags-add')).toBeVisible();
  await expect(page.locator('#tmdlg-params #task-rate')).toBeVisible();
  await expect(page.locator('#tmdlg-params #due-date-btn')).toBeVisible();
  expect(await page.evaluate(() => state.tasks.length), 'черновик уже в списке').toBe(before + 1);

  await page.locator('#tmdlg-title').fill('Созвон с командой');
  // Статус ставится прямо здесь, до создания.
  await page.locator('#tmdlg-params #task-status').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'In progress' }).click();
  await page.locator('#tmdlg-done').click();
  await expect(dlg).toBeHidden();

  const made = await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Созвон с командой');
    const s = task.sessions[0];
    const d = new Date(s.start);
    return {
      status: state.statuses.find((x) => x.id === task.statusId).name,
      hours: s.ms / 3600000,
      manual: !!s.manual,
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      onGrid: [...document.querySelectorAll('.ag-ev-name')].map((n) => n.textContent),
    };
  });
  expect(made.time).toBe('09:00');
  expect(made.hours).toBe(1.5);
  expect(made.manual, 'запись заведена руками, а не таймером').toBe(true);
  expect(made.status, 'статус из окна сохранился').toBe('In progress');
  expect(made.onGrid, 'запись сразу видна на сетке').toContain('Созвон с командой');
});

test('«Отмена» убирает черновик, будто его и не было', async ({ page }) => {
  await seed(page);
  const before = await page.evaluate(() => state.tasks.length);
  await drag(page, { day: 2, h: 9 }, { day: 2, h: 10, m: 30 });
  await page.locator('#tmdlg-title').fill('Передумал');
  await page.locator('#tmdlg-open').click();

  await expect(page.locator('#tmdlg-backdrop')).toBeHidden();
  expect(await page.evaluate(() => state.tasks.length)).toBe(before);
  await expect(page.locator('.ag-ev-name', { hasText: 'Передумал' })).toHaveCount(0);
  // И узел настроек всё равно вернулся во вкладку задачи.
  await expect(page.locator('#tab-settings .task-params')).toBeAttached();
});

test('проект выбирается в самом окне и запоминается до следующего раза', async ({ page }) => {
  await seed(page);
  await drag(page, { day: 2, h: 9 }, { day: 2, h: 10 });

  await page.locator('#tmdlg-proj').click();
  // Список проектов — общий #ctx-menu, он живёт вне окна и рисуется поверх.
  await expect(page.locator('#ctx-menu')).toBeVisible();
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Лендинг' }).click();
  await expect(page.locator('#tmdlg-proj')).toHaveText('Лендинг');

  await page.locator('#tmdlg-title').fill('Правки текста');
  await page.locator('#tmdlg-title').press('Enter');
  expect(await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Правки текста');
    return {
      project: state.projects.find((p) => p.id === task.projectId).name,
      status: state.statuses.find((x) => x.id === task.statusId).projectId === task.projectId,
    };
  })).toEqual({ project: 'Лендинг', status: true });

  // Второе окно открывается уже с этим проектом.
  await drag(page, { day: 3, h: 9 }, { day: 3, h: 10 });
  await expect(page.locator('#tmdlg-proj')).toHaveText('Лендинг');
});

test('набранное имя показывает подходящие задачи, и время уходит к выбранной', async ({ page }) => {
  await seed(page);
  const before = await page.evaluate(() => ({
    tasks: state.tasks.length,
    hours: state.tasks.find((t) => t.title === 'API отчётов').totalMs / 3600000,
  }));

  await drag(page, { day: 2, h: 9 }, { day: 2, h: 10 });
  await page.locator('#tmdlg-title').fill('API');
  await expect(page.locator('#tmdlg-found')).toBeVisible();
  await page.locator('#tmdlg-found-list .tag-pop-item', { hasText: 'API отчётов' }).click();

  await expect(page.locator('#tmdlg-backdrop')).toBeHidden();
  const after = await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'API отчётов');
    const manual = task.sessions.find((x) => x.manual);
    const d = new Date(manual.start);
    return {
      tasks: state.tasks.length,
      hours: task.totalMs / 3600000,
      entries: task.sessions.length,
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      rate: manual.rate,
    };
  });
  expect(after.tasks, 'новой задачи не завелось, черновик убран').toBe(before.tasks);
  expect(after.hours - before.hours, 'час ушёл к существующей задаче').toBe(1);
  expect(after.entries).toBe(2);
  expect(after.time, 'время взято из выделенной зоны').toBe('09:00');
  // Ставка запоминается такой, какая сейчас — ровно как в окне правки записи.
  expect(after.rate).toBe(2000);
});

test('запись в спрятанном проекте снова показывает его на сетке', async ({ page }) => {
  // Иначе создание выглядит как «ничего не произошло»: задача есть, а блока нет.
  const ids = await seed(page);
  await page.evaluate((pid) => { agenda.hidden.add(pid); render(); }, ids.p2);
  await expect(page.locator('.ag-proj.off')).toHaveCount(1);

  await drag(page, { day: 2, h: 13 }, { day: 2, h: 14 });
  await page.locator('#tmdlg-proj').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Лендинг' }).click();
  await page.locator('#tmdlg-title').fill('Смета');
  await page.locator('#tmdlg-done').click();

  await expect(page.locator('.ag-proj.off')).toHaveCount(0);
  await expect(page.locator('.ag-ev-name', { hasText: 'Смета' })).toBeVisible();
});

test('сетка нарисована: часовые линии и получасовые потише', async ({ page }) => {
  // Линии рисуются цветом --border-soft. Пока такого токена не было в палитре,
  // border-style падал в none и сетки не было видно совсем — ни в одной теме.
  await seed(page);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((th) => { state.settings.theme = th; applyTheme(); render(); }, theme);
    const m = await page.evaluate(() => {
      const one = (sel) => {
        const s = getComputedStyle(document.querySelector(sel));
        return { style: s.borderTopStyle, width: s.borderTopWidth, color: s.borderTopColor };
      };
      const col = getComputedStyle(document.querySelector('.ag-col'));
      return {
        hour: one('.ag-line:not(.half)'),
        half: one('.ag-line.half'),
        colBorder: { style: col.borderLeftStyle, width: col.borderLeftWidth },
        perColumn: document.querySelectorAll('.ag-col:first-child .ag-line').length,
      };
    });
    expect(m.hour, `часовая линия, тема ${theme}`).toMatchObject({ style: 'solid', width: '1px' });
    expect(m.half.style, `получасовая линия, тема ${theme}`).toBe('solid');
    expect(m.half.color, 'получасовая должна быть полупрозрачной').not.toBe(m.hour.color);
    expect(m.colBorder, `граница столбца, тема ${theme}`).toMatchObject({ style: 'solid', width: '1px' });
    expect(m.perColumn, 'линия каждые полчаса, кроме самой полуночи').toBe(47);
  }
});

test('шапка дней и строка «весь день» кончаются там же, где сетка', async ({ page }) => {
  // Сетка лежит в прокручиваемой области и теряет ширину её полосы, а шапка
  // и строка «весь день» — нет. Расхождение копилось по столбцам: к
  // воскресенью набегало девять пикселей, и границы уезжали от линий.
  await seed(page);
  const m = await page.evaluate(() => {
    // Без округления: столбцы встают на дробные пиксели, и округление каждого
    // края по отдельности само по себе даёт разницу в пиксель-другой.
    const left = (sel) => [...document.querySelectorAll(sel)].map((n) => n.getBoundingClientRect().left);
    const right = (sel) => document.querySelector(sel).getBoundingClientRect().right;
    const cols = left('.ag-col');
    return {
      allday: left('.ag-allday-cell').map((v, i) => v - cols[i]),
      names: left('.ag-dayname').map((v, i) => v - cols[i]),
      rightEdge: right('.ag-allday') - right('#ag-cols'),
      bar: document.getElementById('ag-scroll').offsetWidth - document.getElementById('ag-scroll').clientWidth,
      reserved: getComputedStyle(document.getElementById('ag-time')).getPropertyValue('--ag-sb').trim(),
    };
  });
  // В headless полосы прокрутки нет вовсе (она накладная), поэтому сперва
  // проверяем сам запас: сколько намерили — столько и отложили.
  expect(m.reserved).toBe(`${m.bar}px`);
  // Полоса прокрутки давала расхождение 0, 1, 3, 4, 6, 7, 9 — полпикселя
  // допуска отличает это от дробной раскладки.
  const off = Math.max(...m.allday.map(Math.abs), ...m.names.map(Math.abs), Math.abs(m.rightEdge));
  expect(off, `расхождение: весь день ${m.allday}, шапка ${m.names}, край ${m.rightEdge}`).toBeLessThan(0.5);

  // А теперь подставим полосу руками: обе верхние строки обязаны сузиться
  // ровно на неё. Без этого проверка выше ничего не стоит на машине, где
  // полоса накладная и всегда нулевая.
  const forced = await page.evaluate(() => {
    const time = document.getElementById('ag-time');
    time.style.setProperty('--ag-sb', '12px');
    // У строки «весь день» запас свой: когда у неё есть собственная полоса,
    // её содержимое и так уже сетки, и вычитать полосу дважды нельзя.
    time.style.setProperty('--ag-sb-row', '12px');
    const right = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().right);
    return { names: right('.ag-daynames'), allday: right('.ag-allday'), cols: right('#ag-cols') };
  });
  expect(forced.cols - forced.names, 'шапка дней учитывает запас').toBe(12);
  expect(forced.cols - forced.allday, 'строка «весь день» тоже').toBe(12);
});

test('пустая строка «весь день» не обзаводится полосой прокрутки', async ({ page }) => {
  // Подпись «Весь день» в две строки выше пустого ряда ячеек. Пока она была
  // position: absolute, ряд под неё не растягивался, подпись вылезала за край
  // — и строка получала собственную полосу прокрутки на пустом месте. Та
  // съедала ещё десять пикселей, и колонки уезжали от линий сетки.
  await seed(page);
  const m = await page.evaluate(() => {
    // Дедлайнов быть не должно: проверяем именно пустую строку.
    for (const task of state.tasks) task.dueAt = null;
    render();
    const row = document.getElementById('ag-allday-row');
    const label = document.querySelector('.ag-allday-label').getBoundingClientRect();
    return {
      overflow: row.scrollHeight - row.clientHeight,
      chips: document.querySelectorAll('.ag-dl').length,
      labelFits: label.bottom <= row.getBoundingClientRect().bottom + 0.5,
    };
  });
  expect(m.chips, 'дедлайнов в строке нет').toBe(0);
  expect(m.overflow, 'прокручивать нечего').toBeLessThanOrEqual(0);
  expect(m.labelFits, 'подпись помещается в строку').toBe(true);
});

// «Время работы»: отрезки задачи в свойствах, окно отрезка, плановый слой на
// календаре, напоминания и повтор без дедлайна. Запуск: npm run test:e2e
//
// Повтор у задачи один (task.repeat), у отрезка своего нет: отрезок — это дата и
// часы, а если задача повторяется, каждый её отрезок повторяется с ней.
//
// Правила (вхождения, повтор, напоминания) покрыты юнитами в
// tests/unit/slots.test.js; здесь — что их видно и ими можно управлять.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Проект с двумя задачами. Часы прибиты на среду 10 июня 2026, 12:00. */
async function seed(page) {
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();

  return page.evaluate(() => {
    const now = new Date();
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Сайт клиента', color: '#87ff65', description: '',
      pinnedAt: null, createdAt: now.toISOString(), tagIds: [],
    });
    seedProjectStatuses(pid);
    const cols = orderedStatuses(pid);
    const add = (title) => {
      const id = uid();
      state.tasks.push({
        id, projectId: pid, title, done: false, notes: null, totalMs: 0, sessions: [],
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
      return id;
    };
    const task = add('Вёрстка карточек');
    const other = add('Без отрезков');
    state.ui.projectId = pid;
    selectTask(task);
    return { pid, task, other };
  });
}

/** Отрезок прямо в состоянии: через интерфейс нужное время не набрать. */
const putSlot = (page, id, hh, mm, durMin, extra) => page.evaluate(({ id, hh, mm, durMin, extra }) => {
  const task = getTask(id);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  task.slots = [...(task.slots || []), {
    id: uid(), start: start.toISOString(), end: new Date(start.getTime() + durMin * 60000).toISOString(),
    ...(extra || {}),
  }];
  render();
}, { id, hh, mm, durMin, extra });

const showTime = (page, mode) => page.evaluate((mode) => {
  state.ui.view = 'time';
  state.ui.timeMode = mode;
  render();
}, mode);

// С 13 октября 2026 «Время работы» в свойствах — строка группы «Когда»
// (.srow): значение словами, щелчок без отрезков открывает окно нового, с
// отрезками — их список и «Добавить время». Окно отрезка — строки «Дата»,
// «Начало», «Конец» и «Повторение задачи», как лист отрезка на телефоне.
const slotsValue = (page) => page.locator('#slots-value');

test('строка «Время работы» есть у задачи; пока отрезков нет — «не задано»', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#slots-row')).toBeVisible();
  await expect(page.locator('#slots-row .srow-label')).toHaveText('Время работы');
  await expect(slotsValue(page)).toHaveText('не задано');
});

test('отрезок добавляется из окна: начало, конец; напоминания в нём нет', async ({ page }) => {
  await seed(page);
  await page.locator('#slots-row').click();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  // Новый отрезок — ближайший ровный час, на час: часы прибиты на 12:00.
  await expect(page.locator('#sldlg-start')).toHaveText('13:00');
  await expect(page.locator('#sldlg-end')).toHaveText('14:00');
  await expect(page.locator('#sldlg-delete')).toBeHidden();

  // Конец — общим выбором времени.
  await page.locator('#sldlg-end-btn').click();
  await page.locator('#tp-input').fill('15:30');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tp-pop')).toBeHidden();
  await expect(page.locator('#sldlg-end')).toHaveText('15:30');
  await expect(page.locator('#sldlg-dur')).toContainText('Длительность');

  // Напоминания о начале — общий список задачи («Напоминания»), в окне отрезка
  // выбора напоминания нет.
  await expect(page.locator('#sldlg-remind-btn')).toHaveCount(0);

  await page.locator('#sldlg-save').click();
  await expect(page.locator('#sldlg-backdrop')).toBeHidden();
  await expect(slotsValue(page)).toHaveText('Ср, 10 июн. 13:00–15:30');

  const slot = await page.evaluate(() => getTask(selectedId).slots[0]);
  expect(slot.id).toBeTruthy();
  expect(slot.remindOffsetMin, 'смещения у отрезка больше нет').toBeUndefined();
  expect(slot, 'повтора у отрезка нет — он общий у задачи').not.toHaveProperty('repeat');
  expect(new Date(slot.end) - new Date(slot.start)).toBe(150 * 60000);
});

test('конец раньше начала не сохраняется: окно подсказывает почему', async ({ page }) => {
  await seed(page);
  await page.locator('#slots-row').click();
  await page.locator('#sldlg-end-btn').click();
  await page.locator('#tp-input').fill('9:00');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sldlg-dur')).toHaveText('Конец должен быть позже начала');
  await expect(page.locator('#sldlg-dur')).toHaveClass(/bad/);
  await expect(page.locator('#tp-pop')).toBeHidden();
  await page.locator('#sldlg-save').click();
  await expect(page.locator('#sldlg-backdrop'), 'окно не закрылось').toBeVisible();
  expect(await page.evaluate(() => getTask(selectedId).slots || [])).toEqual([]);
});

test('отрезок правится и удаляется в своём окне — из списка отрезков у строки', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 90);
  await expect(slotsValue(page)).toHaveText('Ср, 10 июн. 10:00–11:30');

  await page.locator('#slots-row').click();
  expect(await page.locator('#ctx-menu .ctx-item').allTextContents()).toEqual(['Ср, 10 июн. · 10:00–11:30', 'Добавить время']);
  await page.locator('#ctx-menu .ctx-item', { hasText: '10:00' }).click();
  await expect(page.locator('#sldlg-start')).toHaveText('10:00');
  await expect(page.locator('#sldlg-delete')).toBeVisible();
  // Сдвиг начала тянет конец за собой: длительность остаётся.
  await page.locator('#sldlg-start-btn').click();
  await page.locator('#tp-input').fill('14:00');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sldlg-start')).toHaveText('14:00');
  await expect(page.locator('#sldlg-end')).toHaveText('15:30');
  await page.locator('#sldlg-save').click();
  await expect(slotsValue(page)).toHaveText('Ср, 10 июн. 14:00–15:30');

  await page.locator('#slots-row').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: '14:00' }).click();
  await page.locator('#sldlg-delete').click();
  await expect(slotsValue(page)).toHaveText('не задано');
  expect(await page.evaluate(() => getTask(selectedId).slots)).toEqual([]);
});

test('окно отрезка и окно повторения задачи, открытое из него, — без системных <select>', async ({ page }) => {
  await seed(page);
  await page.locator('#slots-row').click();
  await expect(page.locator('select')).toHaveCount(0);
  await page.locator('#sldlg-repeat-row').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await expect(page.locator('select')).toHaveCount(0);
});

test('в окне отрезка нет выбора повтора: строка «Повторение задачи · Не повторяется»', async ({ page }) => {
  await seed(page);
  await page.locator('#slots-row').click();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  // Ни кнопки, ни списка повтора у отрезка нет.
  await expect(page.locator('#sldlg-repeat-btn')).toHaveCount(0);
  await expect(page.locator('#sldlg-backdrop .dp-select')).toHaveCount(0);
  // Задача не повторяется — отрезок разовый.
  await expect(page.locator('#sldlg-repeat-row .srow-label')).toHaveText('Повторение задачи');
  await expect(page.locator('#sldlg-repeat-note')).toHaveText('Не повторяется');

  // Порядок сверху вниз: часы с длительностью, строка повторения, кнопки
  // окна — и всё внутри окна, а не поверх него.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const box = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const modal = r(document.querySelector('#sldlg-backdrop .modal'));
    const row = r(document.getElementById('sldlg-repeat-row'));
    return {
      dur: r(document.getElementById('sldlg-dur')).bottom,
      row,
      buttons: r(document.querySelector('#sldlg-backdrop .modal-buttons')).top,
      inside: row.left >= modal.left && row.right <= modal.right,
    };
  });
  expect(box.row.top, 'строка повторения под часами').toBeGreaterThanOrEqual(box.dur);
  expect(box.buttons, 'кнопки окна под строкой повторения').toBeGreaterThan(box.row.bottom);
  expect(box.inside, 'строка внутри окна').toBe(true);
});

test('у задачи есть повтор: окно отрезка говорит «повторяется вместе с задачей»', async ({ page }) => {
  await seed(page);
  // Строка «Повторение» открывает окно повторения задачи; по умолчанию — неделя.
  await page.locator('#task-repeat').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await page.locator('#rpdlg-save').click();
  await page.locator('#slots-row').click();
  await expect(page.locator('#sldlg-repeat-note')).toHaveText('Повторяется каждую неделю вместе с задачей');
  // Строка с правилом задачи: окно повторения открывается с ним же.
  await page.locator('#sldlg-repeat-row').click();
  await expect(page.locator('#rpdlg-title')).toHaveText('Повторение задачи');
  await expect(page.locator('#rp-freq-seg button.on')).toHaveAttribute('data-freq', 'week');
});

test('строка «Повторение задачи» открывает окно повторения поверх окна отрезка; Esc возвращает к отрезку', async ({ page }) => {
  await seed(page);
  await page.locator('#slots-row').click();
  await page.locator('#sldlg-repeat-row').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await expect(page.locator('#sldlg-backdrop'), 'окно отрезка осталось под ним').toBeVisible();
  const z = await page.evaluate(() => ({
    sl: Number(getComputedStyle(document.getElementById('sldlg-backdrop')).zIndex),
    rp: Number(getComputedStyle(document.getElementById('rpdlg-backdrop')).zIndex),
  }));
  expect(z.rp).toBeGreaterThan(z.sl);

  await page.keyboard.press('Escape');
  await expect(page.locator('#rpdlg-backdrop')).toBeHidden();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  // Черновик отрезка не потерян.
  await expect(page.locator('#sldlg-start')).toHaveText('13:00');
});

test('повтор задачи по понедельникам и средам применяется к отрезку: правило — у задачи, не у отрезка', async ({ page }) => {
  await seed(page);
  await page.locator('#slots-row').click();
  await page.locator('#sldlg-repeat-row').click();

  // Окно повторения — задачи, а не отрезка: заголовок «Повторение задачи» и
  // «Оставлять выполненные копии» на месте. «Отсчёт» спрятан: у задачи пока
  // нет ни дедлайна, ни сохранённого отрезка, считать не от чего.
  await expect(page.locator('#rpdlg-title')).toHaveText('Повторение задачи');
  await expect(page.locator('#rp-from-field')).toBeHidden();
  await expect(page.locator('#rp-history')).toBeVisible();
  await page.locator('.rp-day', { hasText: 'Пн' }).click();
  await page.locator('.rp-day', { hasText: 'Ср' }).click();
  await page.locator('#rpdlg-save').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeHidden();
  await expect(page.locator('#sldlg-backdrop'), 'окно отрезка осталось').toBeVisible();
  // Подпись окна отрезка подхватила новое правило задачи.
  await expect(page.locator('#sldlg-repeat-note')).toHaveText('Повторяется по Пн, Ср вместе с задачей');
  await page.locator('#sldlg-save').click();

  // Строка «Время работы» — дни недели и часы; правило — строкой «Повторение».
  await expect(slotsValue(page)).toHaveText('Пн, Ср 13:00–14:00');
  await expect(page.locator('#repeat-value')).toHaveText('По Пн, Ср');
  const got = await page.evaluate(() => {
    const task = getTask(selectedId);
    return { rule: task.repeat, slot: task.slots[0] };
  });
  expect(got.rule.freq).toBe('week');
  expect(got.rule.weekdays).toEqual([1, 3]);
  expect(got.slot, 'отрезок своего правила не хранит').not.toHaveProperty('repeat');

  // Неделя 8–14 июня: сегодня среда, 10-е, — первое вхождение; понедельник
  // 8-го до начала отрезка. Следующая неделя: пн 15-го и ср 17-го.
  await showTime(page, 'week');
  await expect(page.locator('.ag-plan')).toHaveCount(1);
  await expect(page.locator('.ag-col[data-day-index="2"] .ag-plan')).toHaveCount(1);
  await page.locator('#time-next').click();
  await expect(page.locator('.ag-plan')).toHaveCount(2);
  await expect(page.locator('.ag-col[data-day-index="0"] .ag-plan')).toHaveCount(1);
  await expect(page.locator('.ag-col[data-day-index="2"] .ag-plan')).toHaveCount(1);
});

test('без повтора у задачи отрезок разовый: одна полоса на календаре, в строке — дата', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 120);
  await expect(slotsValue(page)).toHaveText('Ср, 10 июн. 10:00–12:00');
  await showTime(page, 'week');
  await expect(page.locator('.ag-plan')).toHaveCount(1);
  await page.locator('#time-next').click();
  await expect(page.locator('.ag-plan')).toHaveCount(0);
});

test('дата отрезка остаётся той, что выбрана в окне, — под правило задачи её никто не двигает', async ({ page }) => {
  // Сегодня среда, повтор задачи — по пятницам. Раньше окно двигало дату
  // отрезка к ближайшей пятнице; правило теперь не его, и отрезок хранит то
  // начало, что задал человек.
  await seed(page);
  await page.locator('#slots-row').click();
  await page.locator('#sldlg-repeat-row').click();
  await page.locator('.rp-day', { hasText: 'Пт' }).click();
  await page.locator('#rpdlg-save').click();
  await page.locator('#sldlg-save').click();

  const slot = await page.evaluate(() => getTask(selectedId).slots[0]);
  expect(new Date(slot.start).getDay(), 'среда').toBe(3);
  expect(new Date(slot.start).getDate()).toBe(10);
  expect(new Date(slot.start).getHours()).toBe(13);
});

test('плановый блок на сетке стоит там, где время, и лежит под записями', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 150);
  await page.evaluate((id) => {
    // Запись времени внахлёст с отрезком: она ложится поверх.
    const task = getTask(id);
    const start = new Date(2026, 5, 10, 11, 0, 0);
    task.sessions = [{ start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(), ms: 3600000 }];
    task.totalMs = 3600000;
  }, ids.task);
  await showTime(page, 'week');

  const plan = page.locator('.ag-plan');
  await expect(plan).toHaveCount(1);
  const got = await page.evaluate(() => {
    const node = document.querySelector('.ag-plan');
    const col = node.parentElement;
    const r = node.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const ev = document.querySelector('.ag-ev');
    const stack = (n) => Number(getComputedStyle(n).zIndex) || 0;
    return {
      top: (r.top - c.top) / c.height,
      height: r.height / c.height,
      width: r.width / c.width,
      day: Number(col.dataset.dayIndex),
      planBeforeEv: !!(node.compareDocumentPosition(ev) & Node.DOCUMENT_POSITION_FOLLOWING),
      sameLayer: stack(node) === stack(ev),
      pc: node.style.getPropertyValue('--pc'),
      dashed: getComputedStyle(node).borderTopStyle,
      label: node.textContent,
    };
  });
  // 10:00 — это 10/24 суток, длина 2,5 часа — 2,5/24.
  expect(got.top).toBeCloseTo(10 / 24, 2);
  expect(got.height).toBeCloseTo(2.5 / 24, 2);
  expect(got.width, 'полоса — во всю ширину столбца, без полей записи слева и справа').toBeGreaterThan(0.9);
  expect(got.day, 'среда — третий столбец').toBe(2);
  expect(got.planBeforeEv, 'под записью времени').toBe(true);
  expect(got.sameLayer).toBe(true);
  expect(got.pc.toLowerCase(), 'цвет проекта').toBe('#87ff65');
  expect(got.dashed, 'контур, как у призрака повторения').toBe('dashed');
  expect(got.label).toContain('10:00–12:30');
  expect(got.label).toContain('Вёрстка карточек');
});

test('щелчок по плановому блоку открывает его задачу, а не заводит запись', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 120);
  await showTime(page, 'week');
  await page.locator('.ag-plan').click();
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  await expect(page.locator('#tmdlg-title')).toHaveValue('Вёрстка карточек');
  // Запись не заведена: щелчок по полосе — это «открыть», а не «создать».
  expect(await page.evaluate(() => state.tasks.length)).toBe(2);
});

test('протяжка по плановому блоку заводит запись, как по пустому месту', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 120);
  await showTime(page, 'week');
  const box = await page.locator('.ag-plan').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  // Черновик новой задачи с записью, а не окно задачи отрезка.
  expect(await page.evaluate(() => state.tasks.length)).toBe(3);
  await expect(page.locator('#tmdlg-title')).toHaveValue('');
});

test('закрытая задача плановых блоков не оставляет — ни прошлых, ни будущих', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 120);
  await showTime(page, 'week');
  await expect(page.locator('.ag-plan')).toHaveCount(1);
  await page.evaluate((id) => { setTaskDone(getTask(id), true); render(); }, ids.task);
  await expect(page.locator('.ag-plan')).toHaveCount(0);
});

test('в списке «Повестка» плановые отрезки — строками «Запланировано»', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 120);
  await showTime(page, 'agenda');
  const row = page.locator('.ag-list-row.plan');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('10:00–12:00');
  await expect(row).toContainText('Вёрстка карточек');
  await expect(row.locator('.ag-list-tag')).toHaveText('Запланировано');
});

test('напоминание «до начала» попадает в колокольчик и срабатывает один раз на вхождение', async ({ page }) => {
  const ids = await seed(page);
  // Начало в 12:10, напомнить за 15 минут: с 11:55, а сейчас 12:00. Напоминание —
  // общий список задачи («Напоминания»), а не поле отрезка.
  await putSlot(page, ids.task, 12, 10, 50);
  await page.evaluate((id) => {
    const task = getTask(id);
    Object.assign(task, Core.withReminders(task, [{ kind: 'before', anchor: 'start', offsetMin: 15 }]));
    render();
  }, ids.task);
  await expect(page.locator('#notif-badge')).toHaveText('1');

  await page.locator('#notif-btn').click();
  const item = page.locator('#notif-list li');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.notif-name')).toHaveText('Вёрстка карточек');
  await expect(item.locator('.notif-sub')).toContainText('Время работы');
  await expect(item.locator('.notif-when')).toHaveText('12:10–13:00');

  // Проход по таймеру помечает вхождение: второй раз то же не всплывёт.
  const mark = async () => page.evaluate((id) => {
    checkReminders();
    return Core.remindersOf(getTask(id))[0].notifiedUpTo;
  }, ids.task);
  const first = await mark();
  expect(new Date(first).getTime(), 'отметка — начало вхождения').toBe(new Date(2026, 5, 10, 12, 10, 0).getTime());
  expect(await mark()).toBe(first);
});

test('закрытие повторяющейся задачи с разовым отрезком двигает отрезок, а не дедлайн', async ({ page }) => {
  const ids = await seed(page);
  await putSlot(page, ids.task, 10, 0, 120);
  const got = await page.evaluate((id) => {
    const task = getTask(id);
    task.repeat = Core.normalizeRepeat({ freq: 'week', every: 1 });
    const before = task.slots[0].start;
    setTaskDone(task, true);
    return { before, after: task.slots[0].start, done: task.done, dueAt: task.dueAt, reopenAt: task.reopenAt, repeatDone: task.repeat.done };
  }, ids.task);
  expect(got.done, 'отрезок есть — задача открывается сразу').toBe(false);
  expect(got.dueAt, 'дедлайн не появляется').toBe(null);
  expect(got.reopenAt).toBe(null);
  expect(got.repeatDone).toBe(1);
  expect(new Date(got.after) - new Date(got.before), 'отрезок уезжает на неделю').toBe(7 * 86400000);
});

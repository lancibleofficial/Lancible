// Время задачи без ограничений, пересечения — 18 октября 2026. Запуск:
// npm run test:e2e
//
// Пользователь: задачи должны ставиться в любой час любого дня, и задачи в один
// час могут стоять на календаре рядом; если в этом промежутке уже что-то есть —
// спросить «создать в то же время?». Выбранная протяжкой зона — во всю ширину
// колонки дня.
//
// Здесь — что вопрос задаётся и слушается («Отмена» ничего не меняет,
// «Создать» создаёт), что два плана в один час стоят рядом колонками, что ночь
// субботы — такое же время, как любое, и что черновик протяжки — во всю
// ширину колонки на 1280 и 375, в дне и в неделе. Сами пересечения считает
// ядро (Core.slotOverlaps) — юниты в tests/unit/slots.test.js.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Проект и две задачи; у «Созвона» план в среду 10:00–11:00. Часы прибиты на
 *  среду 10 июня 2026, 12:00 (tests/e2e/clock.js). */
async function seed(page, size = { width: 1280, height: 860 }) {
  await pinClock(page);
  await page.setViewportSize(size);
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
    const add = (title, slots) => {
      const id = uid();
      state.tasks.push({
        id, projectId: pid, title, done: false, notes: null, totalMs: 0, sessions: [],
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, slots: slots || [],
      });
      return id;
    };
    const at = (d, h, m = 0) => new Date(2026, 5, d, h, m, 0).toISOString();
    const call = add('Созвон с клиентом', [{ id: 'call', start: at(10, 10), end: at(10, 11) }]);
    const task = add('Вёрстка карточек');
    state.ui.projectId = pid;
    selectTask(task);
    return { pid, task, call };
  });
}

const showTime = (page, mode) => page.evaluate((mode) => {
  state.ui.view = 'time';
  state.ui.timeMode = mode;
  render();
}, mode);

const slotsOf = (page, id) => page.evaluate((id) => (getTask(id).slots || []).map((s) => {
  const a = new Date(s.start);
  const b = new Date(s.end);
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${a.getDay()} ${hm(a)}–${hm(b)}`;
}), id);

/** Время в выборе времени: поле и Enter. */
async function pickTime(page, button, value) {
  await page.locator(button).click();
  await page.locator('#tp-input').fill(value);
  await page.keyboard.press('Enter');
  await expect(page.locator('#tp-pop')).toBeHidden();
}

/** Плановые блоки колонки: где стоят относительно неё (доли ширины). */
const plansIn = (page, dayIndex) => page.evaluate((dayIndex) => {
  const col = document.querySelector(`.ag-col[data-day-index="${dayIndex}"]`);
  const c = col.getBoundingClientRect();
  return [...col.querySelectorAll('.ag-plan')].map((n) => {
    const r = n.getBoundingClientRect();
    return { name: n.querySelector('.ag-plan-name').textContent, left: (r.left - c.left) / c.width, right: (r.right - c.left) / c.width, width: r.width / c.width };
  }).sort((a, b) => a.left - b.left);
}, dayIndex);

test('отрезок поверх чужого плана: вопрос, «Отмена» ничего не меняет, «Создать» ставит рядом колонками', async ({ page }) => {
  const ids = await seed(page);
  await page.locator('#slots-row').click();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  await pickTime(page, '#sldlg-start-btn', '10:30');
  await expect(page.locator('#sldlg-end')).toHaveText('11:30');

  await page.locator('#sldlg-save').click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await expect(page.locator('#confirm-title')).toHaveText('Время уже занято');
  await expect(page.locator('#confirm-text')).toHaveText('В этом промежутке уже есть задача «Созвон с клиентом» (10:00–11:00). Создать в то же время?');
  await expect(page.locator('#confirm-ok')).toHaveText('Создать');
  await expect(page.locator('#confirm-ok'), 'это не удаление — кнопка не красная').not.toHaveClass(/confirm-danger/);
  await expect(page.locator('#confirm-cancel')).toHaveText('Отмена');

  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#confirm-backdrop')).toBeHidden();
  await expect(page.locator('#sldlg-backdrop'), '«Отмена» оставляет окно отрезка как было').toBeVisible();
  await expect(page.locator('#sldlg-start')).toHaveText('10:30');
  expect(await slotsOf(page, ids.task), 'ничего не записано').toEqual([]);

  // Esc на вопросе — та же «Отмена»: окно отрезка под ним остаётся.
  await page.locator('#sldlg-save').click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-backdrop')).toBeHidden();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  expect(await slotsOf(page, ids.task)).toEqual([]);

  await page.locator('#sldlg-save').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#sldlg-backdrop')).toBeHidden();
  expect(await slotsOf(page, ids.task)).toEqual(['3 10:30–11:30']);
  expect(await slotsOf(page, ids.call), 'чужой план не тронут').toEqual(['3 10:00–11:00']);

  // Неделя: среда — третий столбец; оба плана рядом, каждый в свою половину.
  for (const [mode, dayIndex] of [['week', 2], ['day', 0]]) {
    await showTime(page, mode);
    const plans = await plansIn(page, dayIndex);
    expect(plans.map((p) => p.name), mode).toEqual(['Созвон с клиентом', 'Вёрстка карточек']);
    for (const p of plans) expect(p.width, `${mode}: половина колонки`).toBeCloseTo(0.5, 1);
    expect(plans[0].right, `${mode}: не наезжают друг на друга`).toBeLessThanOrEqual(plans[1].left + 0.001);
  }
});

test('правка отрезка, сдвинутая на чужой план, спрашивает «Сохранить в то же время?»; без сдвига — нет', async ({ page }) => {
  const ids = await seed(page);
  await page.evaluate((id) => {
    getTask(id).slots = [{ id: 'own', start: new Date(2026, 5, 10, 14, 0).toISOString(), end: new Date(2026, 5, 10, 15, 0).toISOString() }];
    render();
  }, ids.task);
  await page.locator('#slots-row').click();
  await page.locator('#ctx-menu .ctx-item').first().click();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  // Время не трогали — вопроса нет.
  await page.locator('#sldlg-save').click();
  await expect(page.locator('#sldlg-backdrop')).toBeHidden();
  await expect(page.locator('#confirm-backdrop')).toBeHidden();

  await page.locator('#slots-row').click();
  await page.locator('#ctx-menu .ctx-item').first().click();
  await pickTime(page, '#sldlg-start-btn', '10:15');
  await page.locator('#sldlg-save').click();
  await expect(page.locator('#confirm-text')).toHaveText('В этом промежутке уже есть задача «Созвон с клиентом» (10:00–11:00). Сохранить в то же время?');
  await expect(page.locator('#confirm-ok')).toHaveText('Сохранить');
  await page.locator('#confirm-ok').click();
  expect(await slotsOf(page, ids.task)).toEqual(['3 10:15–11:15']);
});

test('несколько пересечений: до трёх по имени и «и ещё N»', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const pid = state.ui.projectId;
    const base = state.tasks.find((x) => x.title === 'Созвон с клиентом');
    for (const [title, h] of [['Бриф', 9], ['Макет', 10], ['Ревью', 11], ['Счёт', 10]]) {
      state.tasks.push({ ...base, id: uid(), title, projectId: pid, slots: [{ id: uid(), start: new Date(2026, 5, 10, h, 30).toISOString(), end: new Date(2026, 5, 10, h + 1, 0).toISOString() }] });
    }
    render();
  });
  await page.locator('#slots-row').click();
  await pickTime(page, '#sldlg-start-btn', '9:00');
  await pickTime(page, '#sldlg-end-btn', '12:00');
  await page.locator('#sldlg-save').click();
  await expect(page.locator('#confirm-text')).toHaveText(
    'В этом промежутке уже есть задачи: «Бриф» (09:30–10:00), «Созвон с клиентом» (10:00–11:00), «Макет» (10:30–11:00) и ещё 2. Создать в то же время?',
  );
});

test('ночь субботы — такое же время: отрезок в 23:00 создаётся без вопросов и стоит на сетке', async ({ page }) => {
  const ids = await seed(page);
  await page.locator('#slots-row').click();
  await page.locator('#sldlg-date-btn').click();
  await page.locator('#dp-days .dp-day', { hasText: /^13$/ }).click();
  await expect(page.locator('#sldlg-date')).toHaveText('13 июн. 2026');
  await pickTime(page, '#sldlg-start-btn', '23:00');
  await pickTime(page, '#sldlg-end-btn', '23:45');
  await page.locator('#sldlg-save').click();
  await expect(page.locator('#sldlg-backdrop')).toBeHidden();
  await expect(page.locator('#confirm-backdrop'), 'вопроса нет: в этот час ничего не стоит').toBeHidden();
  expect(await slotsOf(page, ids.task), 'суббота, 23:00 — ни часы, ни дни не мешают').toEqual(['6 23:00–23:45']);

  await showTime(page, 'week');
  const plans = await plansIn(page, 5);
  expect(plans.map((p) => p.name)).toEqual(['Вёрстка карточек']);
  expect(plans[0].width, 'один в своём часу — во всю ширину').toBeGreaterThan(0.9);
});

test('протяжка по сетке поверх чужого плана: сначала вопрос; «Отмена» — как не тянули, «Создать» — черновик', async ({ page }) => {
  await seed(page);
  await showTime(page, 'week');
  const tasksBefore = await page.evaluate(() => state.tasks.length);
  const dragOver = () => page.evaluate(() => {
    const cols = document.getElementById('ag-cols');
    const r = cols.getBoundingClientRect();
    const x = r.left + r.width * (2.5 / 7);
    const y = (h) => r.top + r.height * (h / 24);
    const ev = (type, yy) => cols.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: yy, button: 0, pointerId: 1 }));
    ev('pointerdown', y(10.5));
    ev('pointermove', y(11));
    ev('pointermove', y(11.5));
    ev('pointerup', y(11.5));
  });
  await dragOver();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await expect(page.locator('#confirm-text')).toHaveText('В этом промежутке уже есть задача «Созвон с клиентом» (10:00–11:00). Создать в то же время?');
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#tmdlg-backdrop')).toBeHidden();
  expect(await page.evaluate(() => state.tasks.length), 'черновик не заведён').toBe(tasksBefore);
  await expect(page.locator('.ag-ghost'), 'и черновой карточки на сетке не осталось').toHaveCount(0);

  await dragOver();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  expect(await page.evaluate(() => state.tasks.length)).toBe(tasksBefore + 1);
});

for (const size of [{ width: 1280, height: 860 }, { width: 375, height: 812 }]) {
  for (const mode of ['day', 'week']) {
    test(`черновик протяжки — во всю ширину колонки дня (${mode}, ${size.width})`, async ({ page }) => {
      await seed(page, size);
      await showTime(page, mode);
      // Запись в той же колонке — чтобы черновик было с кем «делить» ширину.
      await page.evaluate(() => {
        const task = state.tasks.find((x) => x.title === 'Вёрстка карточек');
        const start = new Date(2026, 5, 10, 14, 0);
        task.sessions = [{ start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(), ms: 3600000 }];
        render();
      });
      const got = await page.evaluate((mode) => {
        const cols = document.getElementById('ag-cols');
        const col = document.querySelector(`.ag-col[data-day-index="${mode === 'week' ? 2 : 0}"]`);
        col.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const c = col.getBoundingClientRect();
        const r = cols.getBoundingClientRect();
        const x = c.left + c.width / 2;
        const y = (h) => r.top + r.height * (h / 24);
        const ev = (type, yy) => cols.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: yy, button: 0, pointerId: 1 }));
        ev('pointerdown', y(13.5));
        ev('pointermove', y(14.5));
        ev('pointermove', y(15.5));
        const ghost = col.querySelector('.ag-ghost');
        const g = ghost ? ghost.getBoundingClientRect() : null;
        const out = g && { ghost: g.width, col: c.width, left: g.left - c.left, right: c.right - g.right };
        ev('pointercancel', y(15.5));
        return out;
      }, mode);
      expect(got, 'черновик появился в своей колонке').toBeTruthy();
      expect(Math.abs(got.ghost - got.col), `ширина черновика ${got.ghost} = колонке ${got.col} ±1`).toBeLessThanOrEqual(1);
      expect(Math.abs(got.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.right)).toBeLessThanOrEqual(1);
      await expect(page.locator('.ag-ghost'), 'отпустили — черновой карточки нет').toHaveCount(0);
    });
  }
}

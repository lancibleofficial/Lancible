// Выбор времени — поле и подсказки, один на все места (13 октября 2026).
// Запуск: npm run test:e2e
//
// Двух колёс «часы | минуты» больше нет. Время вписывается руками в любом
// привычном виде («9:30», «0930», «9», «21.15»), под полем — подсказки через
// 15 минут на два часа в обе стороны от значения (своей прокруткой). ↑/↓ —
// шаг 15 минут по подсказкам (вниз — позже), Enter или щелчок — выбрать,
// Esc — закрыть, не выбирая. Открывают его запись времени, окно задачи с
// календаря, отрезок, напоминание и строка «Время» в окне даты (дедлайн).
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

async function seed(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const iso = new Date().toISOString();
    state.projects.push({ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: iso, tagIds: [] });
    seedProjectStatuses('p1');
    state.tasks.push({
      id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, notes: null, totalMs: 0, sessions: [],
      rate: null, pinnedAt: null, createdAt: iso, updatedAt: iso,
      statusId: orderedStatuses('p1')[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.ui.projectId = 'p1';
    selectTask('t1');
  });
}

/** Окно нового отрезка: начало 13:00 (часы прибиты на 12:00). */
async function openSlotStart(page) {
  if (await page.locator('#sldlg-backdrop').isHidden()) await page.locator('#slots-row').click();
  await page.locator('#sldlg-start-btn').click();
  await expect(page.locator('#tp-pop')).toBeVisible();
}

const options = (page) => page.locator('#tp-list .tp-opt').allTextContents();

test('поле с текущим временем и подсказки через 15 минут на два часа в обе стороны', async ({ page }) => {
  await seed(page);
  await openSlotStart(page);
  await expect(page.locator('#tp-input')).toHaveValue('13:00');
  await expect(page.locator('#tp-input')).toBeFocused();
  const list = await options(page);
  expect(list[0]).toBe('11:00');
  expect(list[list.length - 1]).toBe('15:00');
  expect(list).toHaveLength(17);
  await expect(page.locator('#tp-list .tp-opt.sel')).toHaveText('13:00');
  // Подсказок больше, чем видно: список листается сам, выбранная — посередине.
  const m = await page.evaluate(() => {
    const box = document.getElementById('tp-list');
    const sel = box.querySelector('.tp-opt.sel').getBoundingClientRect();
    const r = box.getBoundingClientRect();
    return { scrolls: box.scrollHeight > box.clientHeight, inView: sel.top >= r.top - 0.5 && sel.bottom <= r.bottom + 0.5, mid: Math.abs((sel.top + sel.bottom) / 2 - (r.top + r.bottom) / 2) };
  });
  expect(m.scrolls).toBe(true);
  expect(m.inView).toBe(true);
  expect(m.mid).toBeLessThan(20);
  // Колёс нет.
  await expect(page.locator('#tp-hours, #tp-minutes, .tp-col')).toHaveCount(0);
});

test('понимает «9:30», «0930», «9», «21.15», «930», «21», «7 05»', async ({ page }) => {
  await seed(page);
  const cases = [['9:30', '09:30'], ['0930', '09:30'], ['9', '09:00'], ['21.15', '21:15'], ['930', '09:30'], ['21', '21:00'], ['7 05', '07:05'], ['23:59', '23:59']];
  for (const [typed, want] of cases) {
    await openSlotStart(page);
    await page.locator('#tp-input').fill(typed);
    await page.keyboard.press('Enter');
    await expect(page.locator('#tp-pop'), typed).toBeHidden();
    await expect(page.locator('#sldlg-start'), typed).toHaveText(want);
  }
});

test('неразборчивое не принимается: поле краснеет, окно остаётся', async ({ page }) => {
  await seed(page);
  for (const typed of ['25:00', '9:75', 'abc', '12345']) {
    await openSlotStart(page);
    await page.locator('#tp-input').fill(typed);
    await page.keyboard.press('Enter');
    await expect(page.locator('#tp-pop'), typed).toBeVisible();
    await expect(page.locator('#tp-input'), typed).toHaveClass(/\bbad\b/);
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('#sldlg-start')).toHaveText('13:00');
});

test('подсказки идут за набранным; ↑/↓ — шаг 15 минут, с неровного — до ближайшей четверти', async ({ page }) => {
  await seed(page);
  await openSlotStart(page);
  await page.locator('#tp-input').fill('18:00');
  let list = await options(page);
  expect([list[0], list[list.length - 1]]).toEqual(['16:00', '20:00']);
  await expect(page.locator('#tp-list .tp-opt.cur')).toHaveText('18:00');

  await page.locator('#tp-input').fill('13:00');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#tp-input')).toHaveValue('13:15');
  await expect(page.locator('#tp-list .tp-opt.cur')).toHaveText('13:15');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#tp-input')).toHaveValue('12:45');
  await page.locator('#tp-input').fill('9:07');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#tp-input')).toHaveValue('09:15');
  await page.locator('#tp-input').fill('9:07');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#tp-input')).toHaveValue('09:00');
  // У краёв суток список не уходит за полночь.
  await page.locator('#tp-input').fill('0:10');
  list = await options(page);
  expect(list[0]).toBe('00:00');
  await page.locator('#tp-input').fill('23:50');
  list = await options(page);
  expect(list[list.length - 1]).toBe('23:45');
  await page.locator('#tp-input').fill('9:07');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sldlg-start')).toHaveText('09:15');
});

test('щелчок по подсказке выбирает; Esc закрывает только выбор времени', async ({ page }) => {
  await seed(page);
  await openSlotStart(page);
  await page.locator('#tp-list .tp-opt', { hasText: '14:30' }).click();
  await expect(page.locator('#tp-pop')).toBeHidden();
  await expect(page.locator('#sldlg-start')).toHaveText('14:30');
  await expect(page.locator('#sldlg-end')).toHaveText('15:30');

  await page.locator('#sldlg-end-btn').click();
  await page.locator('#tp-input').fill('20:00');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tp-pop')).toBeHidden();
  await expect(page.locator('#sldlg-backdrop'), 'окно отрезка осталось').toBeVisible();
  await expect(page.locator('#sldlg-end'), 'без выбора ничего не меняется').toHaveText('15:30');
});

test('дедлайн: кнопка времени в окне даты открывает выбор времени поверх, окно даты остаётся', async ({ page }) => {
  await seed(page);
  await page.locator('#due-date-btn').click();
  await expect(page.locator('#dp-time-btn')).toHaveText('18:00');
  await page.locator('#dp-time-btn').click();
  await expect(page.locator('#tp-pop')).toBeVisible();
  await expect(page.locator('#dp-pop')).toBeVisible();
  const z = await page.evaluate(() => {
    const r = document.getElementById('tp-pop').getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return document.getElementById('tp-pop').contains(top);
  });
  expect(z, 'выбор времени лежит поверх окна даты').toBe(true);
  await page.locator('#tp-input').fill('21.15');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tp-pop')).toBeHidden();
  await expect(page.locator('#dp-pop')).toBeVisible();
  await expect(page.locator('#dp-time-btn')).toHaveText('21:15');
  await expect(page.locator('#due-value')).toContainText('21:15');
  // Esc: сначала выбор времени, потом окно даты.
  await page.locator('#dp-time-btn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tp-pop')).toBeHidden();
  await expect(page.locator('#dp-pop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dp-pop')).toBeHidden();
});

test('один выбор времени во всех местах: запись, окно с календаря, напоминание', async ({ page }) => {
  await seed(page);
  // Запись времени.
  await page.evaluate(() => openSessionDialog(getTask('t1'), null));
  await page.locator('#sdlg-start-btn').click();
  await expect(page.locator('#tp-pop')).toBeVisible();
  await page.locator('#tp-input').fill('0930');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sdlg-start-btn')).toHaveText('09:30');
  await page.locator('#sdlg-cancel').click();
  // Напоминание «повторять» — время тем же выбором.
  await page.locator('#remind-add').click();
  await page.locator('#rm-kind-seg button[data-kind="repeat"]').click();
  await page.locator('#rm-time-btn').click();
  await expect(page.locator('#tp-pop')).toBeVisible();
  await page.locator('#tp-input').fill('8');
  await page.keyboard.press('Enter');
  await expect(page.locator('#rm-time-btn')).toHaveText('08:00');
  await page.locator('#rmdlg-cancel').click();
  // Поле — общее компактное: то же скругление, что у полей ввода.
  await page.locator('#slots-row').click();
  await page.locator('#sldlg-start-btn').click();
  const r = await page.evaluate(() => {
    const probe = document.createElement('input');
    probe.className = 'field-sm';
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).borderTopLeftRadius;
    probe.remove();
    return [getComputedStyle(document.getElementById('tp-input')).borderTopLeftRadius, want];
  });
  expect(r[0]).toBe(r[1]);
});

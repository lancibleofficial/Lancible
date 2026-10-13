// «Напоминания»: список у задачи, окно из трёх видов, срабатывание и колокольчик.
// Запуск: npm run test:e2e
//
// Правила списка (вхождения, отметки, зеркало старых полей, совместимость с
// прежними версиями) покрыты юнитами в tests/unit/reminders.test.js; здесь — что
// их видно и ими можно управлять.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Проект с задачей без срока и отрезков. Часы прибиты на среду 10 июня 2026,
 *  12:00. Системные уведомления подменены записью: что показали, лежит в
 *  window.__notes. */
async function seed(page) {
  await pinClock(page);
  await page.addInitScript(() => {
    window.__notes = [];
    window.Notification = class {
      constructor(title, opts) { window.__notes.push({ title, body: (opts && opts.body) || '' }); }
      static get permission() { return 'granted'; }
      static requestPermission() { return Promise.resolve('granted'); }
    };
  });
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
    state.ui.projectId = pid;
    selectTask(task);
    return { pid, task };
  });
}

/** Срок прямо в состоянии: пятница 12 июня, 18:00. */
const setDue = (page, id) => page.evaluate((id) => {
  getTask(id).dueAt = new Date(2026, 5, 12, 18, 0, 0).toISOString();
  render();
}, id);

/** Отрезок на сегодня: часы начала и длительность в минутах. */
const putSlot = (page, id, hh, mm, durMin) => page.evaluate(({ id, hh, mm, durMin }) => {
  const task = getTask(id);
  const start = new Date(2026, 5, 10, hh, mm, 0);
  task.slots = [...(task.slots || []), {
    id: uid(), start: start.toISOString(), end: new Date(start.getTime() + durMin * 60000).toISOString(),
  }];
  render();
}, { id, hh, mm, durMin });

/** Напоминание прямо в состоянии — через тот же путь, что у интерфейса. */
const putReminder = (page, id, rem) => page.evaluate(({ id, rem }) => {
  const task = getTask(id);
  Object.assign(task, Core.withReminders(task, [...Core.remindersOf(task), rem]));
  render();
}, { id, rem });

const reminders = (page, id) => page.evaluate((id) => Core.remindersOf(getTask(id)), id);
// С 13 октября 2026 напоминание в свойствах — строка группы «Напоминания»
// (.srow), её щелчок сразу открывает окно; «Удалить» — в окне.
const chips = (page) => page.locator('#remind-row .remind-item');
const open = async (page) => {
  await page.locator('#remind-add').click();
  await expect(page.locator('#rmdlg-backdrop')).toBeVisible();
};
const kind = (page, k) => page.locator(`#rm-kind-seg [data-kind="${k}"]`);
/** Быстрое смещение по точной подписи: «5 мин» — не «15 мин». */
const preset = (page, label) => page.locator('#rm-presets button', { hasText: new RegExp(`^${label}$`) });

test('группа «Напоминания» есть у задачи; пока напоминаний нет — только «Добавить напоминание»', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#remind-row')).toBeVisible();
  await expect(page.locator('#task-props .sgroup-label', { hasText: 'Напоминания' })).toBeVisible();
  await expect(page.locator('#remind-add')).toHaveText('Добавить напоминание');
  await expect(chips(page)).toHaveCount(0);
  // Старого интерфейса нет: меню у дедлайна, «Своё время», выбор в окне отрезка.
  await expect(page.locator('#due-remind')).toHaveCount(0);
  await expect(page.locator('#due-custom-row')).toHaveCount(0);
  await page.locator('#slots-row').click();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  await expect(page.locator('#sldlg-remind-btn')).toHaveCount(0);
});

test('без времени работы и дедлайна «До…» недоступно: подсказка, открыт «Один раз»', async ({ page }) => {
  await seed(page);
  await open(page);
  await expect(kind(page, 'before')).toBeDisabled();
  await expect(page.locator('#rm-need-anchor')).toBeVisible();
  await expect(page.locator('#rm-need-anchor')).toHaveText('Добавьте время работы или дедлайн');
  await expect(kind(page, 'at')).toHaveClass(/on/);
  await expect(page.locator('#rm-at')).toBeVisible();
  await expect(page.locator('#rm-before')).toBeHidden();
  // Щелчок по погасшему виду ничего не меняет.
  await kind(page, 'before').click({ force: true });
  await expect(page.locator('#rm-before')).toBeHidden();
});

test('«До начала» только при времени работы, «до дедлайна» — только при дедлайне', async ({ page }) => {
  const ids = await seed(page);
  const anchors = async () => {
    await open(page);
    await expect(page.locator('#rm-need-anchor')).toBeHidden();
    await kind(page, 'before').click();
    const got = {
      start: await page.locator('#rm-anchor-seg [data-anchor="start"]').isVisible(),
      due: await page.locator('#rm-anchor-seg [data-anchor="due"]').isVisible(),
      on: await page.locator('#rm-anchor-seg .on').getAttribute('data-anchor'),
    };
    await page.locator('#rmdlg-cancel').click();
    await expect(page.locator('#rmdlg-backdrop')).toBeHidden();
    return got;
  };

  await setDue(page, ids.task);
  expect(await anchors()).toEqual({ start: false, due: true, on: 'due' });

  await page.evaluate((id) => { getTask(id).dueAt = null; render(); }, ids.task);
  await putSlot(page, ids.task, 14, 0, 60);
  expect(await anchors()).toEqual({ start: true, due: false, on: 'start' });

  await setDue(page, ids.task);
  expect(await anchors()).toEqual({ start: true, due: true, on: 'start' });
});

test('«До дедлайна»: быстрое смещение превращается в строку и записывается списком с зеркалом', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  await open(page);
  await kind(page, 'before').click();
  expect(await page.locator('#rm-presets button').allTextContents())
    .toEqual(['В момент дедлайна', '5 мин', '15 мин', '1 ч', '1 день']);
  await preset(page, '15 мин').click();
  await expect(page.locator('#rm-presets button.on')).toHaveText('15 мин');
  await expect(page.locator('#rm-n')).toHaveValue('15');
  await expect(page.locator('#rm-unit-seg .on')).toHaveText('мин');
  await page.locator('#rmdlg-save').click();
  await expect(page.locator('#rmdlg-backdrop')).toBeHidden();

  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page)).toHaveText('За 15 мин до дедлайна');
  const task = await page.evaluate((id) => getTask(id), ids.task);
  expect(task.reminders).toHaveLength(1);
  expect(task.reminders[0]).toMatchObject({ kind: 'before', anchor: 'due', offsetMin: 15, unit: 'min', notifiedUpTo: null });
  expect(task.reminders[0].id).toBeTruthy();
  // Зеркало для приложений прежних версий.
  expect(task.remindOffsetMin).toBe(15);
  expect(task.remindAt).toBe(null);
});

test('«В момент дедлайна» и «В момент начала» — смещение 0', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  await putSlot(page, ids.task, 14, 0, 60);
  await open(page);
  await kind(page, 'before').click();
  await page.locator('#rm-anchor-seg [data-anchor="start"]').click();
  await expect(page.locator('#rm-presets button').first()).toHaveText('В момент начала');
  await page.locator('#rm-presets button').first().click();
  await page.locator('#rmdlg-save').click();
  await expect(chips(page)).toHaveText(['В момент начала']);
  expect((await reminders(page, ids.task))[0]).toMatchObject({ anchor: 'start', offsetMin: 0 });
});

test('своё значение: 40 мин сохраняется и возвращается в окне без искажений', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  await open(page);
  await kind(page, 'before').click();
  await page.locator('#rm-n').fill('40');
  await expect(page.locator('#rm-presets button.on')).toHaveCount(0);
  // Enter в поле числа — «Сохранить».
  await page.locator('#rm-n').press('Enter');
  await expect(page.locator('#rmdlg-backdrop')).toBeHidden();
  await expect(chips(page)).toHaveText(['За 40 мин до дедлайна']);
  expect((await reminders(page, ids.task))[0]).toMatchObject({ offsetMin: 40, unit: 'min' });

  // Назад в окно: поле и единица те же.
  await chips(page).click();
  await expect(page.locator('#rm-n')).toHaveValue('40');
  await expect(page.locator('#rm-unit-seg .on')).toHaveText('мин');
  // Единица меняется переключателем: 2 ч — это 120 минут, подпись «2 ч».
  await page.locator('#rm-n').fill('2');
  await page.locator('#rm-unit-seg [data-unit="hour"]').click();
  await page.locator('#rmdlg-save').click();
  await expect(chips(page)).toHaveText(['За 2 ч до дедлайна']);
  expect((await reminders(page, ids.task))[0]).toMatchObject({ offsetMin: 120, unit: 'hour' });

  // Дни — словом по числу: 3 дня = 4320 минут; 1 день, 5 дней.
  await chips(page).click();
  await page.locator('#rm-n').fill('3');
  await page.locator('#rm-unit-seg [data-unit="day"]').click();
  await page.locator('#rmdlg-save').click();
  await expect(chips(page)).toHaveText(['За 3 дня до дедлайна']);
  expect((await reminders(page, ids.task))[0]).toMatchObject({ offsetMin: 4320, unit: 'day' });
  for (const [n, text] of [['1', 'За 1 день до дедлайна'], ['5', 'За 5 дней до дедлайна']]) {
    await chips(page).click();
    await page.locator('#rm-n').fill(n);
    await page.locator('#rmdlg-save').click();
    await expect(chips(page)).toHaveText([text]);
  }
});

test('значение больше 60 суток прижимается к пределу с пояснением, пустое — не сохраняется', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  await open(page);
  await kind(page, 'before').click();
  await page.locator('#rm-unit-seg [data-unit="day"]').click();
  await page.locator('#rm-n').fill('99');
  await expect(page.locator('#rm-n')).toHaveValue('60');
  await expect(page.locator('#rm-error')).toHaveText('Не больше 60 дней');
  await expect(page.locator('#rmdlg-save')).toBeEnabled();
  // Следующая правка снимает пояснение.
  await page.locator('#rm-n').fill('7');
  await expect(page.locator('#rm-error')).toBeHidden();

  // Пустое поле и не число: подсказка, «Сохранить» погашена.
  await page.locator('#rm-n').fill('');
  await expect(page.locator('#rm-error')).toHaveText('Введите число');
  await expect(page.locator('#rmdlg-save')).toBeDisabled();
  await page.locator('#rm-n').fill('abc');
  await expect(page.locator('#rm-n')).toHaveValue('');
  await expect(page.locator('#rmdlg-save')).toBeDisabled();
  await page.locator('#rm-n').fill('7');
  await page.locator('#rmdlg-save').click();
  await expect(chips(page)).toHaveText(['За 7 дней до дедлайна']);
  expect((await reminders(page, ids.task))[0].offsetMin).toBe(7 * 1440);

  // Предел в минутах: 60 суток ровно.
  await page.evaluate((id) => {
    const task = getTask(id);
    Object.assign(task, Core.withReminders(task, []));
    render();
  }, ids.task);
  await open(page);
  await kind(page, 'before').click();
  await page.locator('#rm-n').fill('999999');
  await expect(page.locator('#rm-n')).toHaveValue('86400');
  await page.locator('#rmdlg-save').click();
  // Единица осталась той, что выбрана, — минуты.
  await expect(chips(page)).toHaveText(['За 86400 мин до дедлайна']);
  expect((await reminders(page, ids.task))[0].offsetMin).toBe(86400);
});

test('«Один раз»: дата и время из выбора, строка «10 июн., 14:30»', async ({ page }) => {
  const ids = await seed(page);
  await open(page);
  // Новое «один раз» — ближайший ровный час: часы прибиты на 12:00.
  await expect(page.locator('#rm-at-btn')).toContainText('13:00');
  await page.locator('#rm-at-btn').click();
  await expect(page.locator('#dp-pop')).toBeVisible();
  // Время — общим выбором времени поверх окна даты.
  await page.locator('#dp-time-btn').click();
  await page.locator('#tp-input').fill('14:30');
  await page.keyboard.press('Enter');
  await page.locator('#dp-done').click();
  await expect(page.locator('#rm-at-btn')).toContainText('14:30');
  await page.locator('#rmdlg-save').click();
  await expect(page.locator('#rmdlg-backdrop')).toBeHidden();

  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page)).toContainText('10 июн');
  await expect(chips(page)).toContainText('14:30');
  const [rem] = await reminders(page, ids.task);
  expect(rem.kind).toBe('at');
  expect(new Date(rem.at).getTime()).toBe(new Date(2026, 5, 10, 14, 30).getTime());
  const task = await page.evaluate((id) => getTask(id), ids.task);
  expect(task.remindAt, 'зеркало: «в своё время» — в remindAt').toBe(rem.at);
  expect(task.remindOffsetMin).toBe(null);
});

test('«Повторять»: каждый день, по дням недели, каждый месяц — строки и данные', async ({ page }) => {
  const ids = await seed(page);

  // Каждый день в 07:30.
  await open(page);
  await kind(page, 'repeat').click();
  await expect(page.locator('#rm-days')).toBeHidden();
  await page.locator('#rm-time-btn').click();
  await page.locator('#tp-input').fill('7:30');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tp-pop')).toBeHidden();
  await expect(page.locator('#rm-time-btn')).toHaveText('07:30');
  await page.locator('#rmdlg-save').click();
  await expect(chips(page)).toHaveText(['Каждый день в 07:30']);

  // По Пн, Ср в 09:00: сегодня среда, она выбрана сама.
  await open(page);
  await kind(page, 'repeat').click();
  await page.locator('#rm-freq-seg [data-freq="week"]').click();
  await expect(page.locator('#rm-days .rp-day.on')).toHaveText(['Ср']);
  await page.locator('#rm-days .rp-day', { hasText: 'Пн' }).click();
  await expect(page.locator('#rm-days .rp-day.on')).toHaveText(['Пн', 'Ср']);
  // Последний день не снимается: неделя без дней — это ничего.
  await page.locator('#rm-days .rp-day', { hasText: 'Пн' }).click();
  await page.locator('#rm-days .rp-day', { hasText: 'Ср' }).click();
  await expect(page.locator('#rm-days .rp-day.on')).toHaveText(['Ср']);
  await page.locator('#rm-days .rp-day', { hasText: 'Пн' }).click();
  await page.locator('#rmdlg-save').click();
  await expect(chips(page).nth(1)).toHaveText('По Пн, Ср в 09:00');

  // Каждый месяц 5-го в 09:00.
  await open(page);
  await kind(page, 'repeat').click();
  await page.locator('#rm-freq-seg [data-freq="month"]').click();
  await expect(page.locator('#rm-month-line')).toBeVisible();
  await expect(page.locator('#rm-monthday')).toHaveValue('10');
  await page.locator('#rm-monthday').fill('5');
  await page.locator('#rmdlg-save').click();
  await expect(chips(page).nth(2)).toHaveText('Каждый месяц 5-го в 09:00');

  const list = await reminders(page, ids.task);
  expect(list.map((r) => [r.kind, r.rule.freq, r.time])).toEqual([
    ['repeat', 'day', '07:30'], ['repeat', 'week', '09:00'], ['repeat', 'month', '09:00'],
  ]);
  expect(list[1].rule.weekdays).toEqual([1, 3]);
  // Месяц: правило считается от ближайшего 5-го — июльского, а сегодня 10 июня.
  expect(new Date(list[2].start).getDate()).toBe(5);
  expect(new Date(list[2].start).getMonth()).toBe(6);
  // День и неделя — с этой минуты: сегодняшнее утро уже прошло и молчит.
  expect(new Date(list[0].start).getTime()).toBe(new Date(2026, 5, 10, 12, 0).getTime());
});

test('месяц с числом 31 — от ближайшего месяца, где такой день есть', async ({ page }) => {
  const ids = await seed(page);
  await open(page);
  await kind(page, 'repeat').click();
  await page.locator('#rm-freq-seg [data-freq="month"]').click();
  await page.locator('#rm-monthday').fill('31');
  await page.locator('#rmdlg-save').click();
  await expect(chips(page)).toHaveText(['Каждый месяц 31-го в 09:00']);
  const [rem] = await reminders(page, ids.task);
  // В июне 30 дней — ближайшее 31-е в июле.
  expect(new Date(rem.start).getMonth()).toBe(6);
  expect(new Date(rem.start).getDate()).toBe(31);
  // Число месяца: 0 и пусто не сохраняются.
  await chips(page).click();
  await page.locator('#rm-monthday').fill('0');
  await expect(page.locator('#rmdlg-save')).toBeDisabled();
  await page.locator('#rm-monthday').fill('99');
  await expect(page.locator('#rm-monthday')).toHaveValue('31');
});

test('правка — щелчком по строке, удаление — в окне; «Отмена» и Esc ничего не меняют', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  await putReminder(page, ids.task, { kind: 'before', anchor: 'due', offsetMin: 15 });
  await expect(chips(page)).toHaveText(['За 15 мин до дедлайна']);

  await chips(page).click();
  await expect(page.locator('#ctx-menu')).toBeHidden();
  await expect(page.locator('#rmdlg-backdrop')).toBeVisible();
  await expect(page.locator('#rmdlg-delete')).toBeVisible();
  await expect(page.locator('#rm-presets button.on')).toHaveText('15 мин');
  // Отмена и Esc — прежнее.
  await preset(page, '5 мин').click();
  await page.locator('#rmdlg-cancel').click();
  await expect(chips(page)).toHaveText(['За 15 мин до дедлайна']);
  await chips(page).click();
  await preset(page, '5 мин').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#rmdlg-backdrop')).toBeHidden();
  await expect(chips(page)).toHaveText(['За 15 мин до дедлайна']);

  // Правка: час. Идентификатор остаётся, время — новое.
  const before = (await reminders(page, ids.task))[0].id;
  await chips(page).click();
  await preset(page, '1 ч').click();
  await page.locator('#rmdlg-save').click();
  await expect(chips(page)).toHaveText(['За 1 ч до дедлайна']);
  const [edited] = await reminders(page, ids.task);
  expect(edited.id).toBe(before);
  expect(edited).toMatchObject({ offsetMin: 60, unit: 'hour' });
  expect(await page.evaluate((id) => getTask(id).remindOffsetMin, ids.task)).toBe(60);

  // Удаление — кнопкой «Удалить» в окне.
  await chips(page).click();
  await page.locator('#rmdlg-delete').click();
  await expect(chips(page)).toHaveCount(0);
  const task = await page.evaluate((id) => getTask(id), ids.task);
  expect(task.reminders).toEqual([]);
  expect(task.remindOffsetMin, 'зеркало очищено').toBe(null);
  expect(task.remindAt).toBe(null);

  // И кнопкой «Удалить» в самом окне.
  await putReminder(page, ids.task, { kind: 'before', anchor: 'due', offsetMin: 5 });
  await chips(page).click();
  await page.locator('#rmdlg-delete').click();
  await expect(page.locator('#rmdlg-backdrop')).toBeHidden();
  await expect(chips(page)).toHaveCount(0);
});

test('у задачи можно несколько напоминаний; новое — без «Удалить» в окне', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  for (const label of ['5 мин', '1 ч']) {
    await open(page);
    await expect(page.locator('#rmdlg-delete')).toBeHidden();
    await kind(page, 'before').click();
    await preset(page, label).click();
    await page.locator('#rmdlg-save').click();
  }
  await expect(chips(page)).toHaveText(['За 5 мин до дедлайна', 'За 1 ч до дедлайна']);
  const list = await reminders(page, ids.task);
  expect(new Set(list.map((r) => r.id)).size, 'у каждого свой id').toBe(2);
  // Зеркалом становится первое «до дедлайна».
  expect(await page.evaluate((id) => getTask(id).remindOffsetMin, ids.task)).toBe(5);
});

test('в окне напоминания нет системных <select>', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  await open(page);
  await expect(page.locator('select')).toHaveCount(0);
  for (const k of ['before', 'at', 'repeat']) {
    await kind(page, k).click();
    await expect(page.locator('select')).toHaveCount(0);
  }
});

test('окно напоминания лежит поверх окна задачи, а пикеры — поверх него', async ({ page }) => {
  await seed(page);
  const z = await page.evaluate(() => ({
    task: Number(getComputedStyle(document.getElementById('tmdlg-backdrop')).zIndex),
    rm: Number(getComputedStyle(document.getElementById('rmdlg-backdrop')).zIndex),
    dp: Number(getComputedStyle(document.getElementById('dp-pop')).zIndex),
    tp: Number(getComputedStyle(document.getElementById('tp-pop')).zIndex),
  }));
  expect(z.rm).toBeGreaterThan(z.task);
  expect(z.dp).toBeGreaterThan(z.rm);
  expect(z.tp).toBeGreaterThan(z.rm);
});

test('прежние данные: смещение remindOffsetMin показывается чипом «За 1 ч до дедлайна»', async ({ page }) => {
  const ids = await seed(page);
  await page.evaluate((id) => {
    const task = getTask(id);
    task.dueAt = new Date(2026, 5, 12, 18, 0, 0).toISOString();
    task.remindOffsetMin = 60;
    delete task.reminders;
    render();
  }, ids.task);
  await expect(chips(page)).toHaveText(['За 1 ч до дедлайна']);
  // Это и есть миграция: после неё список записан, а старые поля на месте.
  const task = await page.evaluate((id) => { migrate(); return JSON.parse(JSON.stringify(getTask(id))); }, ids.task);
  expect(task.reminders).toHaveLength(1);
  expect(task.reminders[0]).toMatchObject({ kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' });
  expect(task.remindOffsetMin).toBe(60);

  // Своё время старой версии — чип с датой.
  await page.evaluate((id) => {
    const task = getTask(id);
    task.remindOffsetMin = null;
    task.remindAt = new Date(2026, 5, 11, 9, 0, 0).toISOString();
    render();
  }, ids.task);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page)).toContainText('11 июн');
  await expect(chips(page)).toContainText('09:00');
});

test('приём облака: список достраивается из старых полей', async ({ page }) => {
  const ids = await seed(page);
  const got = await page.evaluate((id) => {
    const task = JSON.parse(JSON.stringify(getTask(id)));
    // Задача с устройства, которое списка не знает: только старые поля.
    task.dueAt = new Date(2026, 5, 12, 18, 0, 0).toISOString();
    task.remindOffsetMin = 15;
    delete task.reminders;
    applyRemoteData({ projects: state.projects, tasks: [task], statuses: state.statuses, tags: state.tags, versions: state.versions });
    return getTask(id).reminders;
  }, ids.task);
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ kind: 'before', anchor: 'due', offsetMin: 15 });
  await expect(chips(page)).toHaveText(['За 15 мин до дедлайна']);
});

test('убрали дедлайн: напоминание «до дедлайна» остаётся тихой строкой и оживает с новым сроком', async ({ page }) => {
  const ids = await seed(page);
  await setDue(page, ids.task);
  await putReminder(page, ids.task, { kind: 'before', anchor: 'due', offsetMin: 60 });
  // «Убрать дедлайн» — в окне даты рядом с «Готово».
  await page.locator('#due-date-btn').click();
  await page.locator('#dp-clear').click();
  await expect(chips(page)).toHaveText(['За 1 ч до дедлайна']);
  await expect(chips(page)).toHaveClass(/\bdim\b/);
  await expect(chips(page)).toHaveAttribute('title', 'Добавьте время работы или дедлайн');
  const task = await page.evaluate((id) => getTask(id), ids.task);
  expect(task.reminders).toHaveLength(1);
  expect(task.remindOffsetMin, 'зеркало на месте').toBe(60);
  // Тихое напоминание — и в окне правки: якорь «до дедлайна» остаётся.
  await chips(page).click();
  await expect(page.locator('#rm-anchor-seg [data-anchor="due"]')).toBeVisible();
  await page.locator('#rmdlg-cancel').click();
  await setDue(page, ids.task);
  await expect(chips(page)).not.toHaveClass(/\bdim\b/);
});

test('«Один раз» срабатывает, когда часы дошли: уведомление, колокольчик, второй раз молчит', async ({ page }) => {
  const ids = await seed(page);
  await open(page);
  await page.locator('#rmdlg-save').click(); // 13:00 сегодня
  await expect(chips(page)).toContainText('13:00');

  // Пока рано — лента пуста.
  await page.evaluate(() => { checkReminders(); });
  await expect(page.locator('#notif-badge')).toBeHidden();
  expect(await page.evaluate(() => window.__notes)).toEqual([]);

  await page.clock.setFixedTime(new Date(2026, 5, 10, 13, 5, 0));
  await page.evaluate(() => { checkReminders(); });
  await expect(page.locator('#notif-badge')).toHaveText('1');
  expect(await page.evaluate(() => window.__notes)).toEqual([{ title: 'Напоминание: Вёрстка карточек', body: '' }]);
  await page.locator('#notif-btn').click();
  const item = page.locator('#notif-list li');
  await expect(item).toHaveCount(1);
  expect(await item.getAttribute('data-key')).toMatch(/^rem-/);
  await expect(item.locator('.notif-name')).toHaveText('Вёрстка карточек');
  await expect(item.locator('.notif-sub')).toContainText('Напоминание');
  await expect(item.locator('.notif-when')).toHaveText('13:00');

  // Отметка в самом напоминании и в зеркале; повторный проход молчит.
  const task = await page.evaluate((id) => getTask(id), ids.task);
  expect(task.reminders[0].notifiedAt).toBeTruthy();
  expect(task.notifiedAt).toBeTruthy();
  await page.evaluate(() => { checkReminders(); });
  expect(await page.evaluate(() => window.__notes.length)).toBe(1);
});

test('«До дедлайна» и «до начала»: слова уведомления и запись в ленте', async ({ page }) => {
  const ids = await seed(page);
  // Дедлайн в 12:30, напомнить за час: с 11:30, а сейчас 12:00.
  await page.evaluate((id) => { getTask(id).dueAt = new Date(2026, 5, 10, 12, 30, 0).toISOString(); }, ids.task);
  await putReminder(page, ids.task, { kind: 'before', anchor: 'due', offsetMin: 60 });
  // Отрезок 12:10–13:00, напомнить за 15 минут: с 11:55.
  await putSlot(page, ids.task, 12, 10, 50);
  await putReminder(page, ids.task, { kind: 'before', anchor: 'start', offsetMin: 15 });

  await page.evaluate(() => { checkReminders(); });
  const notes = await page.evaluate(() => window.__notes);
  expect(notes.map((n) => n.title).sort()).toEqual([
    'Дедлайн через 1 ч: Вёрстка карточек',
    'Через 15 мин начало: Вёрстка карточек',
  ]);
  expect(notes.find((n) => n.title.startsWith('Через')).body, 'часы вхождения').toBe('12:10–13:00');

  // Колокольчик: запись «Время работы» с часами вхождения.
  await expect(page.locator('#notif-badge')).toBeVisible();
  await page.locator('#notif-btn').click();
  const slotItem = page.locator('#notif-list li', { hasText: 'Время работы' });
  await expect(slotItem).toHaveCount(1);
  await expect(slotItem.locator('.notif-when')).toHaveText('12:10–13:00');
  expect(await slotItem.getAttribute('data-key')).toMatch(/^rem-.+-\d+$/);

  // Каждое вхождение — один раз.
  await page.evaluate(() => { checkReminders(); });
  expect(await page.evaluate(() => window.__notes.length)).toBe(2);
  const list = await reminders(page, ids.task);
  expect(list.find((r) => r.anchor === 'start').notifiedUpTo).toBe(new Date(2026, 5, 10, 12, 10, 0).toISOString());
  expect(list.find((r) => r.anchor === 'due').notifiedUpTo).toBe(new Date(2026, 5, 10, 12, 30, 0).toISOString());
});

test('«В момент начала» и «В момент дедлайна»: слова уведомления без смещения', async ({ page }) => {
  const ids = await seed(page);
  await page.evaluate((id) => { getTask(id).dueAt = new Date(2026, 5, 10, 11, 59, 0).toISOString(); }, ids.task);
  await putReminder(page, ids.task, { kind: 'before', anchor: 'due', offsetMin: 0 });
  await page.evaluate(() => { checkReminders(); });
  expect(await page.evaluate(() => window.__notes.map((n) => n.title))).toEqual(['Дедлайн: Вёрстка карточек']);
});

test('«Повторять» в ленте: последнее вхождение за сутки, время срабатывания справа', async ({ page }) => {
  const ids = await seed(page);
  await page.evaluate((id) => {
    const task = getTask(id);
    // Каждый день в 09:00, заведено вчера в полдень: сегодняшнее утро — в ленте.
    const start = new Date(2026, 5, 9, 12, 0, 0).toISOString();
    Object.assign(task, Core.withReminders(task, [{
      kind: 'repeat', rule: Core.normalizeRepeat({ freq: 'day', every: 1 }), time: '09:00', start,
    }]));
    render();
  }, ids.task);
  await expect(page.locator('#notif-badge')).toHaveText('1');
  await page.locator('#notif-btn').click();
  const item = page.locator('#notif-list li');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.notif-sub')).toContainText('Напоминание');
  await expect(item.locator('.notif-when')).toHaveText('09:00');
  expect(await item.getAttribute('data-key')).toMatch(/^rem-/);
});

test('выполненная задача не напоминает', async ({ page }) => {
  const ids = await seed(page);
  await putReminder(page, ids.task, { kind: 'at', at: new Date(2026, 5, 10, 11, 0).toISOString() });
  await expect(page.locator('#notif-badge')).toHaveText('1');
  await page.evaluate((id) => { setTaskDone(getTask(id), true); render(); checkReminders(); }, ids.task);
  await expect(page.locator('#notif-badge')).toBeHidden();
  expect(await page.evaluate(() => window.__notes)).toEqual([]);
});

test('окно напоминания открывается и из окна задачи на календаре', async ({ page }) => {
  const ids = await seed(page);
  await putReminder(page, ids.task, { kind: 'at', at: new Date(2026, 5, 11, 9, 0).toISOString() });
  await page.evaluate((id) => {
    state.ui.view = 'time';
    render();
    openTaskModal(getTask(id), null);
  }, ids.task);
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  await expect(page.locator('#tmdlg-params .remind-item')).toHaveCount(1);
  await page.locator('#tmdlg-params #remind-add').click();
  await expect(page.locator('#rmdlg-backdrop')).toBeVisible();
  // Esc закрывает самое верхнее окно — напоминание; окно задачи остаётся.
  await page.keyboard.press('Escape');
  await expect(page.locator('#rmdlg-backdrop')).toBeHidden();
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
});

// Повторение задач: строка в настройках, окно тонкой настройки, поведение
// при закрытии и призраки на календаре. Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Проект с двумя задачами: со сроком на сегодня 18:00 и без срока. */
async function seed(page) {
  // Часы прибиты до перехода: см. tests/e2e/clock.js — иначе неделя
  // календаря съезжает и в воскресенье срок «на завтра» в неё не попадает.
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
    state.settings.hourlyRate = 2000;
    state.settings.currency = 'RUB';
    const cols = orderedStatuses(pid);

    const add = (title, dueAt, totalMs) => {
      const id = uid();
      state.tasks.push({
        id, projectId: pid, title, done: false, notes: null,
        totalMs: totalMs || 0,
        sessions: totalMs ? [{ start: new Date(now.getTime() - totalMs).toISOString(), end: now.toISOString(), ms: totalMs }] : [],
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
      return id;
    };
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0).toISOString();
    const withDue = add('Отчёт клиенту', due, 3_600_000);
    const noDue = add('Без срока', null, 0);

    state.ui.projectId = pid;
    selectTask(withDue);
    return { pid, withDue, noDue };
  });
}

const openTask = (page, id) => page.evaluate((id) => { selectTask(id); }, id);

const taskState = (page, title) => page.evaluate((title) => {
  const list = state.tasks.filter((t) => t.title === title);
  const open = list.find((t) => !t.done) || list[0];
  return {
    copies: list.length,
    done: open.done,
    dueAt: open.dueAt,
    dueDay: open.dueAt ? new Date(open.dueAt).getDate() : null,
    totalHours: open.totalMs / 3600000,
    repeatDone: open.repeat ? open.repeat.done : null,
    finishedCopies: list.filter((t) => t.done).length,
  };
}, title);

test('строка повторения есть и у задачи без дедлайна', async ({ page }) => {
  // С 11 октября дедлайн повторению не нужен: без него оно считается от
  // разового отрезка «времени работы», а без отрезка — от закрытия.
  const ids = await seed(page);
  await expect(page.locator('#task-repeat')).toBeVisible();
  await expect(page.locator('#repeat-value')).toHaveText('Не повторяется');

  await openTask(page, ids.noDue);
  await expect(page.locator('#task-repeat')).toBeVisible();
  await page.locator('#task-repeat').click();
  // Окно повторения открылось, а не тост «сначала поставьте дедлайн».
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await expect(page.locator('#toast')).toBeHidden();
});

test('повторяющаяся задача без дат остаётся выполненной и возвращается в свой день', async ({ page }) => {
  const ids = await seed(page);
  await openTask(page, ids.noDue);
  await page.locator('#task-repeat').click();
  await page.locator('#rpdlg-save').click();
  await expect(page.locator('#repeat-value')).toHaveText('Каждую неделю');
  // Без дат считать «следующий раз» не от чего.
  await expect(page.locator('#repeat-next')).toBeHidden();

  await page.evaluate((id) => { setTaskDone(getTask(id), true); render(); }, ids.noDue);
  const closed = await page.evaluate((id) => {
    const task = getTask(id);
    return { done: task.done, reopenAt: task.reopenAt, repeatDone: task.repeat.done, dueAt: task.dueAt };
  }, ids.noDue);
  expect(closed.done, 'задача остаётся выполненной до своего дня').toBe(true);
  expect(closed.dueAt, 'дедлайн не появляется').toBe(null);
  expect(closed.repeatDone).toBe(1);
  // Часы прибиты на среду 10 июня 12:00: через неделю — 17 июня, с полуночи.
  expect(new Date(closed.reopenAt).getTime(), 'вернётся с полуночи через неделю')
    .toBe(new Date(2026, 5, 17, 0, 0, 0, 0).getTime());
  await expect(page.locator('#repeat-next')).toHaveText(/^Вернётся 17 июн/);
  await expect(page.locator('#toast')).toContainText('Вернётся');

  // До своего дня проход ничего не трогает.
  await page.clock.setFixedTime(new Date(2026, 5, 16, 23, 0, 0));
  await page.evaluate(() => checkReminders());
  expect(await page.evaluate((id) => getTask(id).done, ids.noDue)).toBe(true);

  // Пришёл день — задача открывается сама, статус по умолчанию.
  await page.clock.setFixedTime(new Date(2026, 5, 17, 9, 0, 0));
  await page.evaluate(() => checkReminders());
  const back = await page.evaluate((id) => {
    const task = getTask(id);
    return { done: task.done, reopenAt: task.reopenAt, doneAt: task.doneAt, repeatDone: task.repeat.done, status: getStatus(task.statusId).kind };
  }, ids.noDue);
  expect(back.done, 'в свой день задача открылась').toBe(false);
  expect(back.reopenAt).toBe(null);
  expect(back.doneAt).toBe(null);
  expect(back.repeatDone, 'счёт серии сохранился').toBe(1);
  expect(back.status).not.toBe('done');
  await expect(page.locator('#repeat-next')).toBeHidden();
});

test('открыть вручную задачу, что ждёт своего дня, — значит снять ожидание', async ({ page }) => {
  const ids = await seed(page);
  const got = await page.evaluate((id) => {
    const task = getTask(id);
    task.repeat = Core.normalizeRepeat({ freq: 'day', every: 3 });
    setTaskDone(task, true);
    const waiting = task.reopenAt;
    const counted = task.repeat.done;
    setTaskDone(task, false);
    const unticked = task.repeat.done;
    // То же через статус (меню статуса, перенос на доске).
    setTaskDone(task, true);
    setTaskStatus(task, orderedStatuses(task.projectId).find((s) => s.kind !== 'done' && s.kind !== 'cancelled').id);
    return { waiting, after: task.reopenAt, done: task.done, counted, unticked, byStatus: task.repeat.done };
  }, ids.noDue);
  expect(got.waiting).not.toBe(null);
  expect(got.done).toBe(false);
  expect(got.after, 'вернули руками — ждать нечего').toBe(null);
  expect(got.counted).toBe(1);
  expect(got.unticked, 'закрытие отменено — и его раз серии тоже').toBe(0);
  expect(got.byStatus).toBe(0);
});

test('своё время напоминания уезжает на день возврата, а не срабатывает снова', async ({ page }) => {
  const ids = await seed(page);
  const got = await page.evaluate((id) => {
    const task = getTask(id);
    task.repeat = Core.normalizeRepeat({ freq: 'week', every: 1 });
    // Часы прибиты на среду 10 июня 12:00: напоминание утром уже было.
    task.remindAt = new Date(2026, 5, 10, 9, 0).toISOString();
    setTaskDone(task, true);
    const at = Core.remindersOf(task).find((r) => r.kind === 'at');
    return { remindAt: task.remindAt, reopenAt: task.reopenAt, listed: at && at.at };
  }, ids.noDue);
  expect(new Date(got.reopenAt).getTime()).toBe(new Date(2026, 5, 17).getTime());
  expect(new Date(got.remindAt).getTime(), 'в день возврата, в своё время').toBe(new Date(2026, 5, 17, 9, 0).getTime());
  // И в списке напоминаний — то же самое, не только в зеркале старых полей.
  expect(got.listed).toBe(got.remindAt);
});

test('возврат задачи при приёме облака уходит обратно в облако', async ({ page }) => {
  // Отпечаток «что уже в облаке» снимался после возврата: возврат считался
  // отправленным, и второе устройство продолжало видеть задачу закрытой. С
  // журналом правок (17 октября 2026) то же правило: возврат — своя правка
  // этого устройства, и после приёма она ложится в очередь отправки.
  const ids = await seed(page);
  const got = await page.evaluate((id) => {
    const task = getTask(id);
    task.repeat = Core.normalizeRepeat({ freq: 'day', every: 1 });
    setTaskDone(task, true);
    // Область связана с журналом: пачка знает задачу закрытой.
    syncBundle = Core.bootstrapFromSnapshot({ seq: 0, data: JSON.parse(JSON.stringify(syncPayload())) }, [], { deviceId });
    // С другого устройства пришла правка: день возврата уже наступил.
    const at = new Date(Date.now() - 60000).toISOString();
    syncBundle = Core.mergeIncoming(syncBundle, [{
      op_id: '00000000-0000-4000-8000-0000000000aa', device_id: 'win-other', entity: 'task', entity_id: id,
      field: 'reopenAt', value: at, at, base_seq: 0, seq: 1,
    }], { deviceId });
    applyRemoteData(listsCopy(syncBundle.state));
    const synced = syncBundle.state.tasks.find((x) => x.id === id);
    const ops = commitLive();
    return { open: !getTask(id).done, syncedDone: synced.done, pending: ops.some((o) => o.entityId === id && o.field === 'done' && o.value === false) };
  }, ids.noDue);
  expect(got.open, 'задача вернулась').toBe(true);
  expect(got.syncedDone, 'в пачке — то, что пришло').toBe(true);
  expect(got.pending, 'возврат ждёт отправки').toBe(true);
});

test('строка «Повторение» открывает окно повторения задачи; правило подписывается словами', async ({ page }) => {
  // С 13 октября 2026 меню готовых правил нет: строка, как и остальные
  // строки свойств, открывает окно своей настройки. Неделя — по умолчанию.
  await seed(page);
  await page.locator('#task-repeat').click();
  await expect(page.locator('#ctx-menu')).toBeHidden();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await expect(page.locator('#rp-freq-seg button.on')).toHaveAttribute('data-freq', 'week');

  await page.locator('#rpdlg-save').click();
  await expect(page.locator('#repeat-value')).toHaveText('Каждую неделю');
  await expect(page.locator('#repeat-next')).toBeVisible();
  // Значок в списке: повторяющуюся задачу видно, не открывая её. В проект —
  // крошкой: задача открыта с «Сегодня», и стрелка «назад» вела бы туда.
  await page.locator('#crumb-project').click();
  await expect(page.locator('#task-list .task-repeat-mark')).toHaveCount(1);
});

test('закрытие переносит срок вперёд, а задача снова открывается', async ({ page }) => {
  await seed(page);
  await page.locator('#task-repeat').click();
  await page.locator('#rpdlg-save').click();

  const before = await taskState(page, 'Отчёт клиенту');
  await page.evaluate(() => { setTaskDone(state.tasks.find((t) => t.title === 'Отчёт клиенту'), true); render(); });
  const after = await taskState(page, 'Отчёт клиенту');

  expect(after.done, 'задача должна снова открыться').toBe(false);
  expect(new Date(after.dueAt) - new Date(before.dueAt), 'срок уезжает ровно на неделю').toBe(7 * 86400000);
  expect(after.repeatDone).toBe(1);
  expect(after.copies, 'без истории копии не заводятся').toBe(1);
  expect(after.totalHours, 'накопленное время остаётся в той же задаче').toBe(before.totalHours);
});

test('с «оставлять копии» в списке остаётся выполненная задача со своим временем', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Отчёт клиенту');
    task.repeat = Core.normalizeRepeat({ freq: 'week', every: 1, keepHistory: true });
    setTaskDone(task, true);
    render();
  });

  const after = await taskState(page, 'Отчёт клиенту');
  expect(after.copies, 'копия и сама задача').toBe(2);
  expect(after.finishedCopies).toBe(1);
  expect(after.done, 'сама задача открыта').toBe(false);
  expect(after.totalHours, 'у задачи чистый лист').toBe(0);

  const copy = await page.evaluate(() => {
    const done = state.tasks.filter((t) => t.title === 'Отчёт клиенту' && t.done)[0];
    return { hours: done.totalMs / 3600000, repeat: done.repeat, sessions: done.sessions.length };
  });
  expect(copy.hours, 'время ушло в копию').toBe(1);
  expect(copy.sessions).toBe(1);
  expect(copy.repeat, 'копия — это история, она больше не повторяется').toBe(null);
});

test('серия с концом обрывается, и задача остаётся закрытой', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Отчёт клиенту');
    // Три раза всего, два уже сделаны: это последний.
    task.repeat = Core.normalizeRepeat({ freq: 'day', every: 1, ends: { kind: 'after', count: 3 }, done: 2 });
    setTaskDone(task, true);
    render();
  });
  const after = await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Отчёт клиенту');
    return { done: task.done, repeatDone: task.repeat.done, finished: Core.repeatFinished(task.repeat) };
  });
  expect(after.done, 'серия кончилась — задача закрыта').toBe(true);
  expect(after.repeatDone).toBe(3);
  expect(after.finished).toBe(true);
});

test('повторение срабатывает и при переносе на доске, а не только с галочки', async ({ page }) => {
  // Закрыть задачу можно тремя путями, и правило не должно зависеть от того,
  // каким именно её закрыли.
  await seed(page);
  const moved = await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Отчёт клиенту');
    task.repeat = Core.normalizeRepeat({ freq: 'day', every: 1 });
    const before = task.dueAt;
    const doneStatus = orderedStatuses(task.projectId).find((s) => s.kind === 'done');
    setTaskStatus(task, doneStatus.id);
    render();
    return { before, after: task.dueAt, done: task.done, repeatDone: task.repeat.done };
  });
  expect(new Date(moved.after) - new Date(moved.before)).toBe(86400000);
  expect(moved.done).toBe(false);
  expect(moved.repeatDone).toBe(1);
});

test('окно тонкой настройки собирает правило и показывает ближайшие сроки', async ({ page }) => {
  await seed(page);
  await page.locator('#task-repeat').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();

  // Неделя начинается с понедельника — как во всём приложении.
  await expect(page.locator('.rp-day')).toHaveText(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);

  await page.locator('#rp-every').fill('2');
  await page.locator('.rp-day', { hasText: 'Пн' }).click();
  await page.locator('.rp-day', { hasText: 'Чт' }).click();
  await expect(page.locator('.rp-day.on')).toHaveCount(2);

  await page.locator('#rp-ends-seg button[data-ends="after"]').click();
  await expect(page.locator('#rp-count')).toBeVisible();
  await page.locator('#rp-count').fill('4');

  await page.locator('#rp-history').click();
  await expect(page.locator('#rp-history')).toHaveAttribute('aria-pressed', 'true');
  // Сводка: без неё «каждый второй вторник» проверить нечем.
  await expect(page.locator('#rp-preview')).toContainText('Каждые 2 нед.');
  await expect(page.locator('.rp-summary-dates')).toBeVisible();

  await page.locator('#rpdlg-save').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeHidden();

  const rule = await page.evaluate(() => state.tasks.find((t) => t.title === 'Отчёт клиенту').repeat);
  expect(rule.every).toBe(2);
  expect(rule.weekdays).toEqual([1, 4]);
  expect(rule.ends).toMatchObject({ kind: 'after', count: 4 });
  expect(rule.keepHistory).toBe(true);
  await expect(page.locator('#repeat-value')).toHaveText('Каждые 2 нед., по Пн, Чт');
});

// --- Окно по образцу листа телефона (17 октября 2026) -----------------------

test('окно повторения устроено как лист телефона: подписи над выбором, общие детали, порядок', async ({ page }) => {
  await seed(page);
  await page.locator('#task-repeat').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  // Неделя по умолчанию: видны частота, «каждые N», дни, отсчёт (у задачи
  // есть дедлайн), окончание, копии и сводка — в порядке RepeatSheet.
  const blocks = await page.evaluate(() => [...document.querySelectorAll('#rpdlg-backdrop .rpdlg > :not(.modal-title):not(.modal-buttons)')]
    .filter((n) => !n.hidden)
    .map((n) => (n.querySelector('.sgroup-label') || {}).textContent || n.id || n.className));
  expect(blocks).toEqual(['Как часто', 'Повторять каждые', 'В дни', 'Отсчёт', 'Окончание', 'rp-block', 'rp-preview']);
  // Только общие детали: сегменты, поле, остров со строкой-переключателем.
  for (const id of ['rp-freq-seg', 'rp-from-seg', 'rp-ends-seg', 'rp-month-seg']) {
    await expect(page.locator(`#${id}`)).toHaveClass(/\bsegmented\b/);
  }
  await expect(page.locator('#rp-history')).toHaveClass(/\bsrow\b.*\bswitch\b|\bswitch\b.*\bsrow\b/);
  await expect(page.locator('#rp-history')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('#rp-history').evaluate((n) => n.parentElement.classList.contains('sgroup'))).toBe(true);
  await expect(page.locator('#rp-history-hint')).toHaveText('Каждый раз в списке останется завершённая задача со своим временем');
  // Подпись над выбором — та же деталь, что подпись группы в свойствах задачи.
  const label = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#rpdlg-backdrop .sgroup-label'));
    return { size: cs.fontSize, color: cs.color, transform: cs.textTransform };
  });
  const faint = await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--text-faint)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(label).toEqual({ size: '12px', color: faint, transform: 'none' });
  // Дни недели — квадраты на --panel-2, как WeekdayChips телефона.
  const day = await page.locator('.rp-day').first().evaluate((n) => {
    const r = n.getBoundingClientRect();
    const probe = document.createElement('i');
    probe.style.background = 'var(--panel-2)';
    document.body.appendChild(probe);
    const panel2 = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { square: Math.abs(r.width - r.height) < 1, bg: getComputedStyle(n).backgroundColor, panel2 };
  });
  expect(day.square).toBe(true);
  expect(day.bg).toBe(day.panel2);
  // Месяц: дни уходят, появляется режим месяца; «До даты» — кнопка даты.
  await page.locator('#rp-freq-seg button[data-freq="month"]').click();
  await expect(page.locator('#rp-days-block')).toBeHidden();
  await expect(page.locator('#rp-month-seg')).toBeVisible();
  await page.locator('#rp-ends-seg button[data-ends="on"]').click();
  await expect(page.locator('#rp-until')).toHaveClass(/\bdp-btn\b/);
  await expect(page.locator('#rp-until')).toBeVisible();
  // Системных выпадашек в окне нет.
  await expect(page.locator('#rpdlg-backdrop select')).toHaveCount(0);
});

test('неделя, Пн/Ср/Пт, после 5 раз: правило нормализовано ядром, подсказка — словами describeRepeat', async ({ page }) => {
  await seed(page);
  // Окно задачи без правила: начинается с недели без дней.
  await page.locator('#task-repeat').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await page.locator('#rp-freq-seg button[data-freq="day"]').click();
  await page.locator('#rp-freq-seg button[data-freq="week"]').click();
  await expect(page.locator('#rp-freq-seg button.on')).toHaveAttribute('data-freq', 'week');
  for (const d of ['Пн', 'Ср', 'Пт']) await page.locator('.rp-day', { hasText: d }).click();
  await expect(page.locator('.rp-day.on')).toHaveText(['Пн', 'Ср', 'Пт']);
  await expect(page.locator('.rp-day.on').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#rp-ends-seg button[data-ends="after"]').click();
  await page.locator('#rp-count').fill('5');

  // Подсказка внизу — правило словами ядра, тем же, что уйдёт по «Готово».
  const expected = await page.evaluate(() => {
    const d = Core.describeRepeat(rpdlg.rule);
    const words = t(d.key, { ...d.vars, days: d.vars.days.map(weekdayName).join(', ') });
    return words.charAt(0).toUpperCase() + words.slice(1);
  });
  expect(expected).toBe('По Пн, Ср, Пт');
  await expect(page.locator('#rp-preview .rp-summary-text')).toHaveText(expected);
  await expect(page.locator('#rp-preview .rp-summary-dates')).toBeVisible();

  await page.locator('#rpdlg-save').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeHidden();
  const { rule, normalized } = await page.evaluate(() => {
    const task = state.tasks.find((x) => x.title === 'Отчёт клиенту');
    return { rule: task.repeat, normalized: Core.normalizeRepeat(task.repeat) };
  });
  expect(rule, 'в задаче — правило ровно в том виде, что отдаёт normalizeRepeat').toEqual(normalized);
  expect(rule).toMatchObject({ freq: 'week', every: 1, weekdays: [1, 3, 5], monthMode: 'day', from: 'schedule', keepHistory: false, done: 0 });
  expect(rule.ends).toMatchObject({ kind: 'after', count: 5 });
  await expect(page.locator('#repeat-value')).toHaveText(expected);
});

test('окно повторения стоит по центру общим механизмом и помещается в окно', async ({ page }) => {
  await seed(page);
  for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 700 }]) {
    await page.setViewportSize(size);
    await page.locator('#task-repeat').click();
    await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const box = await page.evaluate(() => {
      const back = document.getElementById('rpdlg-backdrop');
      const r = back.querySelector('.modal').getBoundingClientRect();
      const cs = getComputedStyle(back);
      return {
        left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        win: document.documentElement.clientWidth, h: window.innerHeight,
        display: cs.display, justify: cs.justifyContent,
      };
    });
    // Подложка — общее правило всех модалок (ui-rules.test.js): flex по центру.
    expect(box.display).toBe('flex');
    expect(box.justify).toBe('center');
    expect(Math.abs((box.left + box.right) / 2 - box.win / 2), `${size.width}: смещение от центра`).toBeLessThanOrEqual(1);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.win);
    expect(box.bottom, `${size.width}: низ окна за экраном`).toBeLessThanOrEqual(box.h);
    await page.locator('#rpdlg-cancel').click();
    await expect(page.locator('#rpdlg-backdrop')).toBeHidden();
  }
});

test('«Не повторяется» из окна снимает правило', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Отчёт клиенту');
    task.repeat = Core.normalizeRepeat({ freq: 'day', every: 1 });
    render();
  });
  await page.locator('#task-repeat').click();
  await page.locator('#rpdlg-off').click();
  await expect(page.locator('#repeat-value')).toHaveText('Не повторяется');
  expect(await page.evaluate(() => state.tasks.find((t) => t.title === 'Отчёт клиенту').repeat)).toBe(null);
});

test('будущие повторения видны на календаре призраками', async ({ page }) => {
  await seed(page);
  const counts = await page.evaluate(() => {
    const task = state.tasks.find((t) => t.title === 'Отчёт клиенту');
    task.repeat = Core.normalizeRepeat({ freq: 'day', every: 1 });
    state.ui.view = 'time';
    state.ui.timeMode = 'week';
    render();
    const { from, days } = Core.agendaRange(agenda.mode, agenda.anchor);
    const expected = Core.upcomingDue(task.repeat, new Date(task.dueAt).getTime(), from + (days * Core.DAY), 40).length;
    return {
      expected,
      ghosts: document.querySelectorAll('.ag-dl.ghost').length,
      real: document.querySelectorAll('.ag-dl:not(.ghost)').length,
      label: (document.querySelector('.ag-dl.ghost') || {}).textContent,
    };
  });
  expect(counts.ghosts, 'призраков столько же, сколько сроков впереди').toBe(counts.expected);
  expect(counts.ghosts).toBeGreaterThan(0);
  expect(counts.real, 'настоящий дедлайн остаётся один').toBe(1);
  expect(counts.label.startsWith('↻'), `подпись призрака: ${counts.label}`).toBe(true);

  // Без правила призраков быть не должно.
  const none = await page.evaluate(() => {
    state.tasks.find((t) => t.title === 'Отчёт клиенту').repeat = null;
    render();
    return document.querySelectorAll('.ag-dl.ghost').length;
  });
  expect(none).toBe(0);
});

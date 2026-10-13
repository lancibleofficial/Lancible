// Правая панель задачи — как на телефоне (круг правок 13 октября 2026).
// Запуск: npm run test:e2e
//
// Статус и версия — чипами, теги — бейджами и «+ теги», остальное — группами
// строк «название · значение ›»: «Когда» (дедлайн, время работы, повторение),
// «Напоминания» (строка на каждое и «Добавить»), «Ещё» (ставка). Значение —
// словами, щелчок открывает окно своей настройки. Таймер, вкладки и низ
// («Выполнено», «Удалить») — прежние. Здесь же окно «Время работы» — строки,
// как лист отрезка на телефоне.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Проект «Сайт» (ставка 5000) и задача в нём. Часы прибиты на среду 10 июня
 *  2026, 12:00. */
async function seed(page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const iso = new Date().toISOString();
    state.projects.push({ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: iso, tagIds: [], rate: 5000, currency: null });
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

const value = (page, id) => page.locator(`#${id} .srow-value`);

test('панель — группы с подписями, строки со значениями словами; низ — «Выполнено» и «Удалить»', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#task-props .sgroup-label:visible')).toHaveText(['Статус', 'Теги', 'Когда', 'Напоминания', 'Ещё']);
  // Статус — чипами: весь список статусов проекта, выбранный отмечен.
  const chips = page.locator('#task-statuses .dp-btn');
  await expect(chips).toHaveText(['Backlog', 'To do', 'In progress', 'Checking', 'Done', 'Cancelled']);
  await expect(page.locator('#task-statuses .dp-btn.on')).toHaveText('To do');
  await expect(page.locator('#task-statuses .dp-btn.on')).toHaveAttribute('aria-pressed', 'true');
  // Версий в проекте нет — группы версии нет.
  await expect(page.locator('#task-version-row')).toBeHidden();
  // «+ теги» — чип, слово строчными (как на телефоне).
  expect(await page.locator('#task-tags-add').evaluate((n) => n.innerText.trim())).toBe('теги');

  await expect(page.locator('#task-when .srow .srow-label')).toHaveText(['Дедлайн', 'Время работы', 'Повторение']);
  await expect(value(page, 'due-date-btn')).toHaveText('не задан');
  await expect(value(page, 'slots-row')).toHaveText('не задано');
  await expect(value(page, 'task-repeat')).toHaveText('Не повторяется');
  await expect(page.locator('#remind-row .srow')).toHaveText(['Добавить напоминание']);
  await expect(value(page, 'rate-row')).toHaveText('как у проекта — 5 000 ₽/ч');
  // Каждая строка-настройка — с шевроном, «Добавить» — без.
  for (const id of ['due-date-btn', 'slots-row', 'task-repeat', 'rate-row']) {
    await expect(page.locator(`#${id} .srow-chev`)).toHaveCount(1);
  }
  await expect(page.locator('#remind-add .srow-chev')).toHaveCount(0);

  await expect(page.locator('.task-actions button')).toHaveText(['Выполнено', 'Удалить задачу']);
  await expect(page.locator('#duplicate-task-btn')).toHaveCount(0);
  // Таймер и вкладки на месте.
  await expect(page.locator('#timer-btn')).toBeVisible();
  await expect(page.locator('#task-tabs button')).toHaveText(['Свойства', 'История']);
});

test('строки и острова — общие детали: остров --panel-2 со скруглением --radius, строки через линию', async ({ page }) => {
  await seed(page);
  const m = await page.evaluate(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const probe = document.createElement('div');
    probe.style.background = 'var(--panel-2)';
    probe.style.borderRadius = 'var(--radius)';
    document.body.appendChild(probe);
    const want = { bg: getComputedStyle(probe).backgroundColor, radius: getComputedStyle(probe).borderTopLeftRadius };
    probe.remove();
    const rows = [...document.querySelectorAll('#task-when .srow')].map((n) => getComputedStyle(n).borderTopWidth);
    return { bg: cs('#task-when').backgroundColor, radius: cs('#task-when').borderTopLeftRadius, want, rows };
  });
  expect(m.bg).toBe(m.want.bg);
  expect(m.radius).toBe(m.want.radius);
  expect(m.rows, 'у первой строки линии нет, у остальных — есть').toEqual(['0px', '1px', '1px']);
});

test('значения строк: дедлайн, время работы, повторение, напоминания, своя ставка', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const task = getTask('t1');
    const at = (d, h, m) => new Date(2026, 5, d, h, m).toISOString();
    task.dueAt = at(12, 18, 0);
    task.repeat = { freq: 'week', every: 1, weekdays: [1, 3], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
    task.slots = [{ id: 's1', start: at(15, 10, 0), end: at(15, 12, 0) }, { id: 's2', start: at(17, 14, 0), end: at(17, 15, 0) }];
    Object.assign(task, Core.withReminders(task, [{ id: 'r1', kind: 'before', anchor: 'start', offsetMin: 15 }]));
    task.rate = 1500;
    render();
  });
  await expect(value(page, 'due-date-btn')).toHaveText('12 июн. 2026, 18:00');
  await expect(value(page, 'due-date-btn')).toHaveClass(/\bset\b/);
  // Повторяется по дням недели — в строке времени работы дни, а не дата.
  await expect(value(page, 'slots-row')).toHaveText('Пн, Ср 10:00–12:00 +1');
  await expect(value(page, 'task-repeat')).toHaveText('По Пн, Ср');
  await expect(page.locator('#repeat-next')).toBeVisible();
  await expect(page.locator('#remind-row .srow')).toHaveText(['За 15 мин до начала', 'Добавить напоминание']);
  await expect(value(page, 'rate-row')).toHaveText('1 500 ₽/ч');

  // Без своей ставки и ставки проекта — общая из настроек.
  await page.evaluate(() => { getTask('t1').rate = null; state.projects[0].rate = null; state.settings.hourlyRate = 4000; render(); });
  await expect(value(page, 'rate-row')).toHaveText('общая — 4 000 ₽/ч');
  await page.evaluate(() => { state.settings.hourlyRate = 0; render(); });
  await expect(value(page, 'rate-row')).toHaveText('не задана');

  // Просроченный дедлайн — цветом опасности.
  await page.evaluate(() => { getTask('t1').dueAt = new Date(2026, 5, 9, 18, 0).toISOString(); render(); });
  await expect(value(page, 'due-date-btn')).toHaveClass(/\boverdue\b/);
});

test('статус и версия — щелчком по чипу', async ({ page }) => {
  await seed(page);
  await page.locator('#task-statuses .dp-btn', { hasText: 'In progress' }).click();
  await expect(page.locator('#task-statuses .dp-btn.on')).toHaveText('In progress');
  expect(await page.evaluate(() => getStatus(getTask('t1').statusId).name)).toBe('In progress');

  await page.evaluate(() => {
    state.versions.push({ id: 'v1', projectId: 'p1', name: 'v1.0', order: 0, releasedAt: null });
    state.versions.push({ id: 'v2', projectId: 'p1', name: 'v1.1', order: 1, releasedAt: null });
    render();
  });
  await expect(page.locator('#task-version-row')).toBeVisible();
  await expect(page.locator('#task-version-row .dp-btn')).toHaveText(['Без версии', 'v1.0', 'v1.1']);
  await expect(page.locator('#task-version-row .dp-btn.on')).toHaveText('Без версии');
  await page.locator('#task-version-row .dp-btn', { hasText: 'v1.1' }).click();
  await expect(page.locator('#task-version-row .dp-btn.on')).toHaveText('v1.1');
  expect(await page.evaluate(() => getTask('t1').versionId)).toBe('v2');
});

test('каждая строка открывает своё окно', async ({ page }) => {
  await seed(page);
  // Дедлайн — окно даты со временем; «Убрать» — только когда срок есть.
  await page.locator('#due-date-btn').click();
  await expect(page.locator('#dp-pop')).toBeVisible();
  await expect(page.locator('#dp-time')).toBeVisible();
  await expect(page.locator('#dp-clear')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dp-pop')).toBeHidden();

  // Время работы без отрезков — сразу окно нового.
  await page.locator('#slots-row').click();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  await expect(page.locator('#sldlg-delete')).toBeHidden();
  await page.locator('#sldlg-save').click();
  await expect(value(page, 'slots-row')).toHaveText('Ср, 10 июн. 13:00–14:00');
  // С отрезками — их список и «Добавить время»; отрезок открывает своё окно.
  await page.locator('#slots-row').click();
  await expect(page.locator('#ctx-menu .ctx-label')).toHaveText(['Ср, 10 июн. · 13:00–14:00', 'Добавить время']);
  await page.locator('#ctx-menu .ctx-item', { hasText: '13:00' }).click();
  await expect(page.locator('#sldlg-backdrop')).toBeVisible();
  await expect(page.locator('#sldlg-delete')).toBeVisible();
  await page.locator('#sldlg-cancel').click();

  // Повторение — окно повторения задачи.
  await page.locator('#task-repeat').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await page.locator('#rpdlg-save').click();
  await expect(value(page, 'task-repeat')).toHaveText('Каждую неделю');

  // Напоминание — «Добавить» и строка самого напоминания открывают его окно.
  await page.locator('#remind-add').click();
  await expect(page.locator('#rmdlg-backdrop')).toBeVisible();
  await expect(page.locator('#rmdlg-delete')).toBeHidden();
  await page.locator('#rmdlg-save').click();
  const row = page.locator('#remind-row .remind-item');
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.locator('#rmdlg-backdrop')).toBeVisible();
  await expect(page.locator('#rmdlg-delete')).toBeVisible();
  await page.locator('#rmdlg-delete').click();
  await expect(row).toHaveCount(0);

  // Ставка — маленьким окном: пусто — как у проекта, это и написано в поле.
  await page.locator('#rate-row').click();
  await expect(page.locator('#modal-backdrop')).toBeVisible();
  await expect(page.locator('#modal-label')).toHaveText('Ставка задачи, ₽/ч');
  await expect(page.locator('#modal-input')).toHaveAttribute('placeholder', /^как у проекта — 5\s000 ₽\/ч$/);
  await page.locator('#modal-input').fill('abc');
  await page.keyboard.press('Enter');
  await expect(page.locator('#modal-error')).toHaveText('Введите число');
  await page.locator('#modal-input').fill('1 500');
  await page.keyboard.press('Enter');
  await expect(page.locator('#modal-backdrop')).toBeHidden();
  await expect(value(page, 'rate-row')).toHaveText('1 500 ₽/ч');
  await page.locator('#rate-row').click();
  await expect(page.locator('#modal-input')).toHaveValue('1500');
  await page.locator('#modal-input').fill('');
  await page.keyboard.press('Enter');
  await expect(value(page, 'rate-row')).toHaveText('как у проекта — 5 000 ₽/ч');
});

test('дедлайн: «Убрать дедлайн» — в окне даты рядом с «Готово»', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { getTask('t1').dueAt = new Date(2026, 5, 12, 18, 0).toISOString(); render(); });
  await page.locator('#due-date-btn').click();
  await expect(page.locator('#dp-clear')).toBeVisible();
  await expect(page.locator('#dp-clear')).toHaveText('Убрать дедлайн');
  await page.locator('#dp-clear').click();
  await expect(page.locator('#dp-pop')).toBeHidden();
  await expect(value(page, 'due-date-btn')).toHaveText('не задан');
  expect(await page.evaluate(() => getTask('t1').dueAt)).toBeNull();
});

test('панель короткая: на 1920×960 без прокрутки, даже с версиями и напоминаниями', async ({ page }) => {
  await seed(page, { width: 1920, height: 960 });
  await page.evaluate(() => {
    const task = getTask('t1');
    for (const [i, name] of ['v1.0', 'v1.1', 'v2.0'].entries()) state.versions.push({ id: `v${i}`, projectId: 'p1', name, order: i, releasedAt: null });
    state.tags.push({ id: 'g1', name: 'Срочное', color: '#ff5a5a', projectId: null }, { id: 'g2', name: 'Дизайн', color: '#c084fc', projectId: null });
    task.tagIds = ['g1', 'g2'];
    task.dueAt = new Date(2026, 5, 12, 18, 0).toISOString();
    task.slots = [{ id: 's1', start: new Date(2026, 5, 15, 10).toISOString(), end: new Date(2026, 5, 15, 12).toISOString() }];
    Object.assign(task, Core.withReminders(task, [
      { id: 'r1', kind: 'before', anchor: 'start', offsetMin: 15 },
      { id: 'r2', kind: 'before', anchor: 'due', offsetMin: 60 },
    ]));
    render();
  });
  const m = await page.evaluate(() => {
    const side = document.querySelector('.task-side');
    const props = document.querySelector('.task-props-island').getBoundingClientRect();
    const actions = document.querySelector('.task-actions').getBoundingClientRect();
    return { scroll: side.scrollHeight - side.clientHeight, inside: actions.bottom <= props.bottom + 0.5 };
  });
  expect(m.scroll, 'правая колонка не прокручивается').toBeLessThanOrEqual(1);
  expect(m.inside, '«Выполнено» и «Удалить» внутри острова').toBe(true);
});

test('тот же узел свойств — в окне задачи с календаря: строки и чипы работают и там', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openTaskModal(getTask('t1'), null));
  await expect(page.locator('#tmdlg-params #task-when .srow')).toHaveCount(3);
  await expect(page.locator('#task-props .task-params')).toHaveCount(0);
  await page.locator('#tmdlg-params #task-statuses .dp-btn', { hasText: 'Done' }).click();
  await expect(page.locator('#tmdlg-params #task-statuses .dp-btn.on')).toHaveText('Done');
  // Окно ставки встаёт поверх окна задачи.
  await page.locator('#tmdlg-params #rate-row').click();
  const z = await page.evaluate(() => [
    Number(getComputedStyle(document.getElementById('modal-backdrop')).zIndex),
    Number(getComputedStyle(document.getElementById('tmdlg-backdrop')).zIndex),
  ]);
  expect(z[0]).toBeGreaterThan(z[1]);
  await page.keyboard.press('Escape');
  await page.locator('#tmdlg-done').click();
  await expect(page.locator('#task-props .task-params')).toHaveCount(1);
});

// --- Окно «Время работы» ---------------------------------------------------------

test('окно «Время работы» — строки «Дата», «Начало», «Конец» и «Повторение задачи»', async ({ page }) => {
  await seed(page);
  await page.locator('#slots-row').click();
  const dlg = page.locator('#sldlg-backdrop');
  await expect(dlg.locator('.srow .srow-label')).toHaveText(['Дата', 'Начало', 'Конец', 'Повторение задачи']);
  // Новый отрезок — ближайший ровный час, на час: часы прибиты на 12:00.
  await expect(page.locator('#sldlg-date')).toHaveText('10 июн. 2026');
  await expect(page.locator('#sldlg-start')).toHaveText('13:00');
  await expect(page.locator('#sldlg-end')).toHaveText('14:00');
  // Длительность — тихой подстрокой под «Концом».
  await expect(page.locator('#sldlg-end-btn #sldlg-dur')).toHaveText('Длительность: 01:00:00');
  await expect(page.locator('#sldlg-repeat-note')).toHaveText('Не повторяется');

  // Дата двигает весь отрезок: часы и длительность остаются.
  await page.locator('#sldlg-date-btn').click();
  await expect(page.locator('#dp-time')).toBeHidden();
  await page.locator('#dp-days .dp-day', { hasText: /^12$/ }).click();
  await expect(page.locator('#sldlg-date')).toHaveText('12 июн. 2026');
  await expect(page.locator('#sldlg-start')).toHaveText('13:00');

  // Начало — общим выбором времени; конец едет следом.
  await page.locator('#sldlg-start-btn').click();
  await expect(page.locator('#tp-pop')).toBeVisible();
  await page.locator('#tp-input').fill('9:30');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sldlg-start')).toHaveText('09:30');
  await expect(page.locator('#sldlg-end')).toHaveText('10:30');
  // Конец раньше начала — подстрока красным, «Сохранить» окно не закрывает.
  await page.locator('#sldlg-end-btn').click();
  await page.locator('#tp-input').fill('9');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sldlg-dur')).toHaveText('Конец должен быть позже начала');
  await expect(page.locator('#sldlg-dur')).toHaveClass(/\bbad\b/);
  await page.locator('#sldlg-save').click();
  await expect(dlg).toBeVisible();
  await page.locator('#sldlg-end-btn').click();
  await page.locator('#tp-input').fill('1130');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sldlg-dur')).toHaveText('Длительность: 02:00:00');

  // «Повторение задачи» — окно повторения поверх; подпись подхватывает правило.
  await page.locator('#sldlg-repeat-row').click();
  await expect(page.locator('#rpdlg-backdrop')).toBeVisible();
  await page.locator('#rpdlg-save').click();
  await expect(page.locator('#sldlg-repeat-note')).toHaveText('Повторяется каждую неделю вместе с задачей');
  await expect(dlg).toBeVisible();
  await page.locator('#sldlg-save').click();
  await expect(dlg).toBeHidden();
  const slot = await page.evaluate(() => {
    const s = getTask('t1').slots[0];
    const f = (iso) => { const d = new Date(iso); return `${d.getDate()} ${d.getHours()}:${d.getMinutes()}`; };
    return [f(s.start), f(s.end), 'repeat' in s];
  });
  expect(slot).toEqual(['12 9:30', '12 11:30', false]);
});

test('окно «Время работы»: «Удалить» — слева, подальше от «Сохранить»', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    getTask('t1').slots = [{ id: 's1', start: new Date(2026, 5, 15, 10).toISOString(), end: new Date(2026, 5, 15, 12).toISOString() }];
    render();
  });
  await page.locator('#slots-row').click();
  await page.locator('#ctx-menu .ctx-item').first().click();
  const x = await page.evaluate(() => ['sldlg-delete', 'sldlg-cancel', 'sldlg-save'].map((id) => document.getElementById(id).getBoundingClientRect().left));
  expect(x[0]).toBeLessThan(x[1]);
  expect(x[1]).toBeLessThan(x[2]);
  const gap = await page.evaluate(() => document.getElementById('sldlg-cancel').getBoundingClientRect().left - document.getElementById('sldlg-delete').getBoundingClientRect().right);
  expect(gap, '«Удалить» прижата влево').toBeGreaterThan(40);
  await page.locator('#sldlg-delete').click();
  await expect(value(page, 'slots-row')).toHaveText('не задано');
});

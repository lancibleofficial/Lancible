// Задача, открытая с календаря. Запуск: npm run test:e2e
//
// Параметры в модалке не переписаны заново: туда на время переезжает тот же
// узел .task-params, что живёт во вкладке задачи. Поэтому главное, что здесь
// проверяется, — что узел действительно ездит туда и обратно и что правки
// доходят до данных. Разойтись вкладка с окном не может по построению, а вот
// потеряться узел — вполне.
const { test, expect } = require('@playwright/test');

async function seed(page) {
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
    const at = (h) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0);

    const add = (title, hour, hours, dueHour) => {
      const id = uid();
      const start = at(hour);
      state.tasks.push({
        id, projectId: pid, title, done: false, notes: null,
        totalMs: hours * 3_600_000,
        sessions: hours ? [{ start: start.toISOString(), end: new Date(start.getTime() + (hours * 3_600_000)).toISOString(), ms: hours * 3_600_000 }] : [],
        rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: dueHour ? at(dueHour).toISOString() : null,
        remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
      return id;
    };
    const withEntry = add('Главная страница', 10, 2, null);
    const withDue = add('Сдать макет', 0, 0, 18);

    state.ui.view = 'calendar';
    render();
    return { pid, withEntry, withDue };
  });
}

/** Клик по блоку без протягивания: сетка слушает pointer-события, и обычный
 *  click Playwright до неё не доходит. */
const clickBlock = (page, title) => page.evaluate((title) => {
  const ev = [...document.querySelectorAll('.ag-ev')]
    .find((n) => n.querySelector('.ag-ev-name').textContent === title);
  if (!ev) throw new Error(`блок «${title}» не найден`);
  const r = ev.getBoundingClientRect();
  const x = r.left + (r.width / 2);
  const y = r.top + 8;
  ev.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
  document.getElementById('ag-cols').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
}, title);

const taskOf = (page, title) => page.evaluate((title) => {
  const task = state.tasks.find((t) => t.title === title);
  const s = task.sessions[0];
  return {
    title: task.title,
    done: task.done,
    status: state.statuses.find((x) => x.id === task.statusId).kind,
    hours: task.totalMs / 3600000,
    entries: task.sessions.length,
    start: s ? new Date(s.start).getHours() : null,
    entryHours: s ? s.ms / 3600000 : null,
  };
}, title);

test('клик по записи открывает задачу модалкой, а не окно правки времени', async ({ page }) => {
  await seed(page);
  await clickBlock(page, 'Главная страница');

  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  await expect(page.locator('#sdlg-backdrop')).toBeHidden();
  await expect(page.locator('#tmdlg-title')).toHaveValue('Главная страница');
  await expect(page.locator('#tmdlg-proj')).toHaveText('Сайт клиента');
  await expect(page.locator('#tmdlg-tot')).toContainText('4 000');
  await expect(page.locator('#tmdlg-start')).toHaveText('10:00');
  await expect(page.locator('#tmdlg-end')).toHaveText('12:00');
  await expect(page.locator('#tmdlg-dur')).toHaveText('2ч');
});

test('параметры переезжают в модалку и возвращаются во вкладку', async ({ page }) => {
  // Не вернуть узел — и страница задачи останется без параметров до
  // перезагрузки. Проверяем оба конца пути.
  const ids = await seed(page);
  await clickBlock(page, 'Главная страница');
  await expect(page.locator('#tmdlg-params .task-params')).toBeAttached();
  expect(await page.locator('#tab-settings .task-params').count()).toBe(0);

  await page.locator('#tmdlg-done').click();
  await expect(page.locator('#tmdlg-backdrop')).toBeHidden();
  await expect(page.locator('#tab-settings .task-params')).toBeAttached();
  expect(await page.locator('#tmdlg-params .task-params').count()).toBe(0);

  // И страница задачи после этого работает как прежде.
  await page.evaluate((id) => { openProject(state.projects[0].id); selectTask(id); setTaskTab('settings'); }, ids.withEntry);
  await expect(page.locator('#tab-settings #task-status')).toBeVisible();
});

test('статус, поменянный в модалке, доходит до задачи', async ({ page }) => {
  await seed(page);
  await clickBlock(page, 'Главная страница');

  await page.locator('#tmdlg-params #task-status').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Done' }).click();

  await expect(page.locator('#tmdlg-params #task-status')).toHaveText('Done');
  const task = await taskOf(page, 'Главная страница');
  expect(task.status).toBe('done');
  expect(task.done).toBe(true);
});

test('время записи правится прямо в модалке', async ({ page }) => {
  await seed(page);
  await clickBlock(page, 'Главная страница');

  await page.locator('#tmdlg-end').click();
  await expect(page.locator('#tp-pop')).toBeVisible();
  await page.locator('#tp-pop .tp-col').first().locator('button', { hasText: /^14$/ }).click();
  await page.locator('#tp-pop .tp-col').nth(1).locator('button', { hasText: /^00$/ }).click();

  await expect(page.locator('#tmdlg-dur')).toHaveText('4ч');
  const task = await taskOf(page, 'Главная страница');
  expect(task.entryHours, 'запись стала длиннее').toBe(4);
  expect(task.hours, 'итог по задаче пересчитан').toBe(4);
  expect(task.entries).toBe(1);
  // Блок на сетке вырос вместе с записью.
  await page.locator('#tmdlg-done').click();
  await expect(page.locator('.ag-ev-time').first()).toHaveText('10:00–14:00');
});

test('удаление записи из модалки не трогает саму задачу', async ({ page }) => {
  await seed(page);
  await clickBlock(page, 'Главная страница');
  await page.locator('#tmdlg-del').click();

  await expect(page.locator('#tmdlg-entry')).toBeHidden();
  await expect(page.locator('#tmdlg-backdrop'), 'окно остаётся открытым').toBeVisible();
  const task = await taskOf(page, 'Главная страница');
  expect(task.entries).toBe(0);
  expect(task.hours).toBe(0);
  expect(task.title, 'задача на месте').toBe('Главная страница');
});

test('дедлайн на календаре открывает ту же модалку, а не уводит со страницы', async ({ page }) => {
  await seed(page);
  await page.locator('.ag-dl', { hasText: 'Сдать макет' }).click();

  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  await expect(page.locator('#tmdlg-title')).toHaveValue('Сдать макет');
  // Записи у задачи нет — и строки записи тоже.
  await expect(page.locator('#tmdlg-entry')).toBeHidden();
  expect(await page.evaluate(() => state.ui.view), 'мы всё ещё на календаре').toBe('calendar');
});

test('«Открыть задачу» уводит на страницу проекта', async ({ page }) => {
  await seed(page);
  await clickBlock(page, 'Главная страница');
  await page.locator('#tmdlg-open').click();

  await expect(page.locator('#tmdlg-backdrop')).toBeHidden();
  expect(await page.evaluate(() => state.ui.view)).toBe('project');
  await expect(page.locator('#task-title')).toHaveValue('Главная страница');
});

test('горячие клавиши календаря не срабатывают из-под открытой модалки', async ({ page }) => {
  // «d» переключала сетку на день за спиной окна: обработчик смотрел только
  // на то, что мы на календаре, и не спрашивал, не открыто ли что-то поверх.
  await seed(page);
  const before = await page.evaluate(() => agenda.mode);
  await clickBlock(page, 'Главная страница');
  await page.keyboard.press('d');
  expect(await page.evaluate(() => agenda.mode)).toBe(before);

  await page.keyboard.press('Escape');
  await expect(page.locator('#tmdlg-backdrop')).toBeHidden();
  await page.keyboard.press('d');
  expect(await page.evaluate(() => agenda.mode), 'а без окна — работают').toBe('day');
});

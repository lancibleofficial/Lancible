// «Назад» — ровно на предыдущий экран. Запуск: npm run test:e2e
//
// Откуда взялось (17 октября 2026): «страницы телепортируют не пойми куда,
// стрелки назад возвращают не на предыдущую страницу». Причин было три:
//   · задачу с «Сегодня», из поиска, уведомлений, календаря, капсулы таймера и
//     окна задачи открывали двумя вызовами — openProject, потом selectTask, —
//     и каждый рисовал экран: в истории вставали две записи, проект и задача.
//     «Назад» с задачи вело в её проект, где человек не был;
//   · стрелка в шапке задачи открывала проект новой записью (а стрелка
//     проекта — «Проекты»), то есть шла вперёд, а не назад, и «назад»
//     браузера после неё возвращал на ту же задачу;
//   · удаление проекта из меню карточки уводило на «Сегодня», если этот
//     проект когда-то открывали, а удалённая страница оставалась в истории.
//
// Правило: открыть задачу откуда угодно — один новый шаг истории; тот же
// экран повторно — не новый шаг; стрелка «назад» — тот же шаг, что «назад»
// браузера; пришли по ссылке и назад некуда — стрелка ведёт по смыслу (из
// задачи в её проект).
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const hashOf = (page) => page.evaluate(() => location.hash);
const historyLength = (page) => page.evaluate(() => history.length);
const shown = (page) => page.evaluate(() => {
  const views = { home: 'home-view', projects: 'projects-view', project: 'project-view', task: 'task-view', docs: 'docs-view', time: 'time-view', settings: 'settings-view' };
  return Object.keys(views).filter((v) => !document.getElementById(views[v]).hidden);
});
const nav = (page, view) => page.locator(`#navrail .nav-item[data-view="${view}"]`).click();

async function ready(page) {
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
}

/** Проект с двумя задачами и записями времени на сегодня: обе стоят в
 *  «Недавних» на «Сегодня» и на календаре. У «Вёрстки» дедлайн через час —
 *  она же в уведомлениях. Сохраняется сразу: тест с перезагрузкой должен
 *  увидеть те же данные. */
async function start(page, hash) {
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
  await page.evaluate(() => {
    const now = Date.now();
    const pid = 'p1';
    state.projects.push({ id: pid, name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: new Date(now).toISOString(), tagIds: [] });
    seedProjectStatuses(pid);
    const task = (id, title, ago, dueIn) => ({
      id, projectId: pid, title, done: false, notes: null, totalMs: 1800e3,
      sessions: [{ start: new Date(now - ago).toISOString(), end: new Date(now - ago + 1800e3).toISOString() }],
      rate: null, pinnedAt: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
      statusId: defaultStatusId(pid, false), tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: dueIn ? new Date(now + dueIn).toISOString() : null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.tasks.push(task('t1', 'Вёрстка', 3 * 3600e3, 3600e3), task('t2', 'Тесты', 2 * 3600e3, null));
    render();
    scheduleSave();
    return saveNow();
  });
  if (!hash) return page;
  // Как ссылка в новой вкладке: первая запись истории — сама ссылка. Новая
  // вкладка, а не goto в этой: переход по хэшу в том же документе — просто
  // ещё одна запись вслед за «Сегодня».
  const tab = await page.context().newPage();
  await pinClock(tab);
  await tab.goto(`/index.html${hash}`);
  await ready(tab);
  // Перед ссылкой в истории вкладки — чужая страница (about:blank), а у
  // приложения это первая запись.
  expect(await tab.evaluate(() => history.state && history.state.lcbIdx), 'первая запись приложения').toBe(0);
  return tab;
}

test('проект → задача → назад = проект; стрелка в шапке — тот же шаг, что «назад» браузера', async ({ page }) => {
  await start(page);
  await nav(page, 'projects');
  await page.evaluate(() => openProject('p1'));
  const atProject = await historyLength(page);
  await page.locator('#task-list .task-item', { hasText: 'Тесты' }).click();
  expect(await shown(page)).toEqual(['task']);
  expect(await historyLength(page), 'задача — один новый шаг').toBe(atProject + 1);

  await page.goBack();
  expect(await shown(page)).toEqual(['project']);
  expect(await hashOf(page)).toBe('#/project/p1');

  // Та же дорога стрелкой: назад, а не новая запись «проект».
  await page.goForward();
  expect(await shown(page)).toEqual(['task']);
  await page.locator('#task-back').click();
  await expect(page.locator('#project-view')).toBeVisible();
  expect(await hashOf(page)).toBe('#/project/p1');
  expect(await historyLength(page), 'стрелка не дописала историю').toBe(atProject + 1);
  // Стрелка проекта — тоже назад: на «Проекты», откуда пришли.
  await page.locator('#proj-back').click();
  await expect(page.locator('#projects-view')).toBeVisible();
  expect(await hashOf(page)).toBe('#/projects');
});

test('«Сегодня» → задача → назад = «Сегодня», и стрелкой тоже; в истории один шаг, а не два', async ({ page }) => {
  await start(page);
  expect(await shown(page)).toEqual(['home']);
  const before = await historyLength(page);
  await page.locator('#recent-list li', { hasText: 'Вёрстка' }).click();
  expect(await shown(page)).toEqual(['task']);
  expect(await hashOf(page)).toBe('#/task/t1');
  expect(await historyLength(page), 'открытие задачи — один шаг истории (было два: проект и задача)').toBe(before + 1);

  await page.goBack();
  expect(await shown(page), 'назад — туда, откуда пришли, а не в проект задачи').toEqual(['home']);
  expect(await hashOf(page)).toBe('#/today');

  await page.goForward();
  await page.locator('#task-back').click();
  await expect(page.locator('#home-view')).toBeVisible();
  expect(await hashOf(page)).toBe('#/today');
});

test('поиск → задача → назад = экран, с которого искали', async ({ page }) => {
  await start(page);
  await nav(page, 'settings');
  const before = await historyLength(page);
  await page.locator('#search-input').fill('Тесты');
  await page.locator('#search-results .sr-item', { hasText: 'Тесты' }).click();
  expect(await shown(page)).toEqual(['task']);
  await expect(page.locator('#search-panel')).toBeHidden();
  expect(await historyLength(page)).toBe(before + 1);

  // Повторно та же задача из поиска — не новый шаг.
  await page.locator('#search-input').fill('Тесты');
  await page.locator('#search-results .sr-item', { hasText: 'Тесты' }).click();
  expect(await historyLength(page), 'тот же экран повторно — без нового шага').toBe(before + 1);

  await page.goBack();
  expect(await shown(page)).toEqual(['settings']);
  expect(await hashOf(page)).toBe('#/settings');
});

test('уведомление → задача → назад = экран, где открыли уведомления', async ({ page }) => {
  await start(page);
  await nav(page, 'docs');
  await page.locator('#notif-btn').click();
  await page.locator('#notif-list li', { hasText: 'Вёрстка' }).first().click();
  expect(await shown(page)).toEqual(['task']);
  await page.goBack();
  expect(await shown(page)).toEqual(['docs']);
});

test('календарь → задача → назад = календарь с тем же режимом и периодом', async ({ page }) => {
  await start(page);
  await nav(page, 'time');
  await page.locator('#time-modes button[data-mode="week"]').click();
  await page.locator('#time-prev').click();
  await page.locator('#time-prev').click();
  const period = await page.locator('#time-view .period-title').textContent();
  const hash = await hashOf(page);
  expect(hash).toBe('#/stats/week');

  // Задача с календаря — через окно задачи и «Открыть задачу».
  await page.evaluate(() => openTaskModal(getTask('t2'), 0));
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  const before = await historyLength(page);
  await page.locator('#tmdlg-open').click();
  expect(await shown(page)).toEqual(['task']);
  expect(await historyLength(page)).toBe(before + 1);

  await page.goBack();
  expect(await shown(page)).toEqual(['time']);
  expect(await hashOf(page)).toBe(hash);
  await expect(page.locator('#time-view .period-title'), 'тот же период, а не текущая неделя').toHaveText(period);
  await expect(page.locator('#time-modes button.on')).toHaveAttribute('data-mode', 'week');
});

test('две «назад» подряд не телепортируют на «Сегодня», если там не были', async ({ page }) => {
  // Вкладку открыли ссылкой на «Проекты»: «Сегодня» в этой вкладке не было.
  page = await start(page, '#/projects');
  expect(await shown(page)).toEqual(['projects']);
  await page.evaluate(() => openProject('p1'));
  await page.locator('#task-list .task-item', { hasText: 'Вёрстка' }).click();
  expect(await shown(page)).toEqual(['task']);

  await page.goBack();
  expect(await shown(page)).toEqual(['project']);
  await page.goBack();
  expect(await shown(page), 'второе «назад» — на «Проекты», с которых начали').toEqual(['projects']);
  expect(await hashOf(page)).toBe('#/projects');
});

test('задача по ссылке: стрелке назад некуда — она ведёт в проект задачи, и «назад» оттуда возвращает на задачу', async ({ page }) => {
  page = await start(page, '#/task/t2');
  expect(await shown(page)).toEqual(['task']);
  await page.locator('#task-back').click();
  await expect(page.locator('#project-view')).toBeVisible();
  expect(await hashOf(page)).toBe('#/project/p1');
  await page.goBack();
  expect(await shown(page)).toEqual(['task']);
  expect(await hashOf(page)).toBe('#/task/t2');
});

test('после перезагрузки стрелка помнит, откуда пришли', async ({ page }) => {
  await start(page);
  await nav(page, 'settings');
  await page.locator('#search-input').fill('Вёрстка');
  await page.locator('#search-results .sr-item', { hasText: 'Вёрстка' }).click();
  expect(await shown(page)).toEqual(['task']);
  await page.reload();
  await ready(page);
  expect(await shown(page)).toEqual(['task']);
  await page.locator('#task-back').click();
  await expect(page.locator('#settings-view')).toBeVisible();
  expect(await hashOf(page)).toBe('#/settings');
});

test('удалили открытую задачу — её место в истории занимает проект, «назад» не ведёт на удалённую', async ({ page }) => {
  await start(page);
  await nav(page, 'projects');
  await page.evaluate(() => openProject('p1'));
  await page.locator('#task-list .task-item', { hasText: 'Тесты' }).click();
  const atTask = await historyLength(page);
  await page.evaluate(() => { deleteTask('t2'); });
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#project-view')).toBeVisible();
  expect(await historyLength(page), 'удаление не дописало историю').toBe(atTask);
  await page.goBack();
  // Запись удалённой задачи заменена проектом, поэтому «назад» с него —
  // на тот же проект второй записью и сразу дальше, на «Проекты».
  await expect(page.locator('#projects-view')).toBeVisible();
  expect(await hashOf(page)).toBe('#/projects');
});

test('удаление проекта из меню карточки на «Проектах» не уводит на «Сегодня»', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    state.projects.push({ id: 'p2', name: 'Лишний', color: '#65b8ff', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
    seedProjectStatuses('p2');
    openProject('p2'); // когда-то открывали: он остался «текущим проектом»
    openView('projects');
  });
  await page.evaluate(() => { deleteProject('p2'); });
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#projects-view')).toBeVisible();
  expect(await shown(page)).toEqual(['projects']);
  expect(await hashOf(page)).toBe('#/projects');
});

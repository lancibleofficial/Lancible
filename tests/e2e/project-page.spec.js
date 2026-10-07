// Экран проекта после редизайна 6 октября 2026. Запуск: npm run test:e2e
//
// Шапка одной строкой: название, вкладки «Список / Доска / Версии», итоги и
// действия. «Список» — узкий список задач, сгруппированный по статусам, и
// задача рядом; список можно спрятать. Проекты — в левом меню, отдельного
// пункта «Доска» нет. Что куда попадает в группах и версиях, решает ядро
// (tests/unit/project-views.test.js); здесь — что экран это показывает.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const HOUR = 3_600_000;

async function seed(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  return page.evaluate((HOUR) => {
    state.settings.hourlyRate = 2000;
    state.settings.currency = 'RUB';
    const mk = (name, color, pinnedAt) => {
      const id = uid();
      state.projects.push({ id, name, color, description: 'Описание проекта', pinnedAt, createdAt: new Date().toISOString(), tagIds: [] });
      seedProjectStatuses(id);
      return id;
    };
    const p1 = mk('Сайт клиента', '#87ff65', null);
    const p2 = mk('Брендинг', '#5ec8f2', new Date().toISOString());
    const v1 = { id: uid(), projectId: p1, name: '1.0', releasedAt: null, order: 0 };
    state.versions.push(v1);
    const cols = orderedStatuses(p1);
    const add = (title, col, hours, versionId) => {
      const ms = hours * HOUR;
      state.tasks.push({
        id: uid(), projectId: p1, title, done: cols[col].kind === 'done', notes: null,
        totalMs: ms, sessions: ms ? [{ start: new Date(Date.now() - ms).toISOString(), end: new Date().toISOString(), ms }] : [],
        rate: null, pinnedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        statusId: cols[col].id, tagIds: [], versionId, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    };
    add('Главная', 0, 2, v1.id);
    add('Форма', 0, 0, null);
    add('Кабинет', 1, 1, v1.id);
    const doneCol = cols.findIndex((c) => c.kind === 'done');
    add('Логотип', doneCol, 1, v1.id);
    openProject(p1);
    return { p1, p2, statuses: cols.map((c) => c.name), doneName: cols[doneCol].name };
  }, HOUR);
}

test('проекты — в левом меню: закреплённые сверху, открытый подсвечен, «Обзор» не горит', async ({ page }) => {
  await seed(page);
  const items = page.locator('#nav-projects .nav-project');
  await expect(items).toHaveText([/Брендинг/, /Сайт клиента/]);
  await expect(page.locator('#nav-projects .nav-project.active')).toHaveText(/Сайт клиента/);
  await expect(page.locator('#navrail .nav-item[data-view="home"]')).not.toHaveClass(/active/);
  // Рядом с проектом — сколько задач ещё не готово.
  await expect(page.locator('#nav-projects .nav-project.active .nav-pcount')).toHaveText('3');

  await items.filter({ hasText: 'Брендинг' }).click();
  await expect(page.locator('#ph-name')).toHaveText('Брендинг');
  await expect(page.locator('#nav-projects .nav-project.active')).toHaveText(/Брендинг/);
});

test('итоги проекта — в шапке: время, деньги, готовые из всех; описание — подсказкой', async ({ page }) => {
  await seed(page);
  const kpis = page.locator('#project-earned');
  await expect(kpis).toContainText('4ч');
  await expect(kpis).toContainText('8 000 ₽');
  await expect(kpis).toContainText('1 из 4 готово');
  await expect(page.locator('#ph-name')).toHaveAttribute('title', 'Описание проекта');
  // Шапка — две строки: сверху название и «+ Задача», ниже вкладки и итоги.
  const m = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { head: r('#project-header'), name: r('#ph-name'), tabs: r('#proj-tabs'), add: r('#new-task-btn') };
  });
  expect(m.head.height).toBeLessThanOrEqual(100);
  expect(m.tabs.top, 'вкладки под названием').toBeGreaterThanOrEqual(m.name.bottom);
  expect(m.head.right - m.add.right, '«+ Задача» у правого края').toBeLessThanOrEqual(16);
});

test('вкладки «Список / Доска / Версии» переключают экран и запоминаются', async ({ page }) => {
  await seed(page);
  const tab = (name) => page.locator('#proj-tabs button', { hasText: name });
  await expect(page.locator('#proj-list')).toBeVisible();

  await tab('Доска').click();
  await expect(page.locator('#proj-board .board-col').first()).toBeVisible();
  await expect(page.locator('#proj-list')).toBeHidden();

  await tab('Версии').click();
  await expect(page.locator('#proj-versions')).toBeVisible();
  expect(await page.evaluate(() => state.ui.projectTab)).toBe('versions');

  await tab('Список').click();
  await expect(page.locator('#proj-list')).toBeVisible();
});

test('список сгруппирован по статусам в порядке доски, группа сворачивается и это помнит', async ({ page }) => {
  const s = await seed(page);
  const heads = page.locator('#task-list .task-group .tg-name');
  // Пустые статусы групп не дают; порядок — как у столбцов доски.
  const expected = s.statuses.filter((n, i) => i === 0 || i === 1 || n === s.doneName);
  await expect(heads).toHaveText(expected);
  await expect(page.locator('#task-list .task-group').first().locator('.tg-count')).toHaveText('2');

  const done = page.locator('#task-list .task-group', { hasText: s.doneName });
  await done.click();
  await expect(page.locator('#task-list .task-item', { hasText: 'Логотип' })).toHaveCount(0);
  await expect(done).toHaveClass(/collapsed/);
  // Свёрнутая группа переживает переход в другой проект и обратно.
  await page.evaluate(({ p1, p2 }) => { openProject(p2); openProject(p1); }, s);
  await expect(page.locator('#task-list .task-item', { hasText: 'Логотип' })).toHaveCount(0);
  await page.locator('#task-list .task-group', { hasText: s.doneName }).click();
  await expect(page.locator('#task-list .task-item', { hasText: 'Логотип' })).toHaveCount(1);
});

test('строка задачи: название целиком сверху, мета тихой строкой снизу', async ({ page }) => {
  await seed(page);
  const row = page.locator('#task-list .task-item', { hasText: 'Главная' });
  // Статус не повторяется — он сказан заголовком группы.
  await expect(row.locator('.task-status')).toHaveCount(0);
  await expect(row.locator('.ti-meta .task-version')).toHaveText('1.0');
  const m = await row.evaluate((n) => {
    const name = n.querySelector('.task-name').getBoundingClientRect();
    const meta = n.querySelector('.ti-meta').getBoundingClientRect();
    return { nameBottom: name.bottom, metaTop: meta.top, height: n.getBoundingClientRect().height };
  });
  expect(m.metaTop, 'мета под названием').toBeGreaterThanOrEqual(m.nameBottom);
  expect(m.height).toBeLessThanOrEqual(52);
});

test('вкладка «Версии»: готовые из всех и деньги; щелчок открывает список по версии', async ({ page }) => {
  await seed(page);
  await page.locator('#proj-tabs button', { hasText: 'Версии' }).click();
  const rows = page.locator('#pver-list .pver-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.pver-name')).toHaveText('1.0');
  await expect(rows.nth(0)).toContainText('1 из 3 готово');
  await expect(rows.nth(0)).toContainText('8 000 ₽');
  await expect(rows.nth(1).locator('.pver-name')).toHaveText('Без версии');

  await rows.nth(0).click();
  await expect(page.locator('#proj-list')).toBeVisible();
  await expect(page.locator('#task-list .task-item')).toHaveCount(3);
  await expect(page.locator('#task-list .task-item', { hasText: 'Форма' })).toHaveCount(0);
});

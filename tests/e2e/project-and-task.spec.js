// Создание проекта и задачи — те самые пять случаев из тест-матрицы,
// переведённые в автоматический прогон. Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');

/** Приложение хранит данные в localStorage вкладки. Каждый тест должен
 *  начинаться с чистого листа, иначе они начнут видеть проекты друг друга и
 *  падать по очереди в зависимости от порядка запуска. */
test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
});

async function createProject(page, name) {
  await page.locator('#create-project-btn').click();
  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
  await page.locator('#pdlg-name').fill(name);
  await page.locator('#pdlg-save').click();
}

test('обычный путь: проект создаётся, открывается и получает статусы', async ({ page }) => {
  await createProject(page, 'Сайт клиента');

  await expect(page.locator('#pdlg-backdrop')).toBeHidden();
  await expect(page.locator('#project-view')).toBeVisible();
  await expect(page.locator('#project-view')).toContainText('Сайт клиента');

  // Шесть статусов по умолчанию — без них у проекта не будет ни одного
  // столбца на доске.
  const statuses = await page.evaluate(() => state.statuses.map((s) => s.kind));
  expect(statuses).toEqual(['backlog', 'todo', 'progress', 'progress', 'done', 'cancelled']);
});

test('обычный путь: задача создаётся со статусом и ждёт названия', async ({ page }) => {
  await createProject(page, 'Сайт клиента');
  await page.locator('#new-task-btn').click();

  await expect(page.locator('#task-list li')).toHaveCount(1);
  await expect(page.locator('#task-title')).toBeFocused();

  const task = await page.evaluate(() => {
    const t = state.tasks[0];
    const s = state.statuses.find((x) => x.id === t.statusId);
    return { hasStatus: !!s, kind: s && s.kind, projectId: t.projectId, done: t.done };
  });
  expect(task.hasStatus).toBe(true);
  expect(task.kind).toBe('todo');
  expect(task.done).toBe(false);

  await page.locator('#task-title').fill('Свёрстать главную');
  await expect(page.locator('#task-list')).toContainText('Свёрстать главную');
});

test('пустое название: проект не создаётся', async ({ page }) => {
  await page.locator('#create-project-btn').click();
  await page.locator('#pdlg-name').fill('');
  await page.locator('#pdlg-save').click();

  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
  expect(await page.evaluate(() => state.projects.length)).toBe(0);
});

test('пустое название: отказ виден пользователю', async ({ page }) => {
  // Отказ сам по себе правильный, но снаружи он выглядит как «кнопка не
  // работает»: окно не закрывается и ничего не сообщает. Ожидание описывает
  // то, как должно быть, а не то, как есть.
  test.fail(true, 'известная недоработка: пустое название отклоняется молча');

  await page.locator('#create-project-btn').click();
  await page.locator('#pdlg-name').fill('');
  await page.locator('#pdlg-save').click();

  const input = page.locator('#pdlg-name');
  const explained = await input.evaluate((el) => (
    el.getAttribute('aria-invalid') === 'true'
    || !!el.closest('.modal').querySelector('.field-error, [role="alert"]')
  ));
  expect(explained, 'у поля нет ни признака ошибки, ни текста с объяснением').toBe(true);
});

test('название из одних пробелов ведёт себя как пустое', async ({ page }) => {
  await page.locator('#create-project-btn').click();
  await page.locator('#pdlg-name').fill('   ');
  await page.locator('#pdlg-save').click();

  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
  expect(await page.evaluate(() => state.projects.length)).toBe(0);
});

test('дубль: два проекта с одинаковым именем допустимы и различимы', async ({ page }) => {
  // Имена проектов не уникальны намеренно — у разных заказчиков бывает
  // одинаковая работа. Но различать их пользователь должен хотя бы цветом.
  await createProject(page, 'Сайт клиента');
  await page.locator('#nav-home, [data-view="home"]').first().click().catch(() => {});
  await page.goto('/index.html');
  await createProject(page, 'Сайт клиента');

  const projects = await page.evaluate(() => state.projects.map((p) => ({ name: p.name, color: p.color })));
  expect(projects).toHaveLength(2);
  expect(projects[0].name).toBe(projects[1].name);
  expect(projects[0].color).not.toBe(projects[1].color);
});

test('перезагрузка: проект и задача остаются на месте', async ({ page }) => {
  await createProject(page, 'Сайт клиента');
  await page.locator('#new-task-btn').click();
  await page.locator('#task-title').fill('Свёрстать главную');
  // Сохранение отложенное — даём ему случиться до перезагрузки.
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();

  const after = await page.evaluate(() => ({
    projects: state.projects.map((p) => p.name),
    tasks: state.tasks.map((t) => t.title),
    statusOk: state.tasks.every((t) => state.statuses.some((s) => s.id === t.statusId)),
  }));
  expect(after.projects).toEqual(['Сайт клиента']);
  expect(after.tasks).toEqual(['Свёрстать главную']);
  expect(after.statusOk, 'после перезагрузки статус задачи должен существовать').toBe(true);
});

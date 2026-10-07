// Настройки проекта: ставка и валюта проекта, свои теги. Запуск: npm run test:e2e
//
// С 7 октября 2026 у проекта есть своя ставка (между ставкой задачи и
// общей), своя валюта и свои теги. Правила — в ядре (money.test.js,
// tags.test.js, migrate.test.js); здесь — что экран их зовёт: окно с
// разделами, подписи с валютой проекта, общие итоги только в основной.
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
    const now = new Date();
    state.settings.hourlyRate = 1000;
    state.settings.currency = 'RUB';
    const mk = (id, name, color, extra) => {
      state.projects.push({ id, name, color, description: '', pinnedAt: null, createdAt: now.toISOString(), tagIds: [], rate: null, currency: null, ...extra });
      seedProjectStatuses(id);
    };
    mk('p-rub', 'Сайт', '#87ff65', {});
    mk('p-usd', 'Заказ из США', '#5ec8f2', { rate: 50, currency: 'USD' });
    state.tags.push(
      { id: 'tg-g', name: 'Срочное', color: '#ef7a72', projectId: null },
      { id: 'tg-rub', name: 'Макет', color: '#c084fc', projectId: 'p-rub' },
      { id: 'tg-usd', name: 'Invoice', color: '#f5c451', projectId: 'p-usd' },
    );
    const add = (id, pid, title) => state.tasks.push({
      id, projectId: pid, title, done: false, notes: null, totalMs: HOUR,
      sessions: [{ start: new Date(now.getTime() - HOUR).toISOString(), end: now.toISOString(), ms: HOUR }],
      rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      statusId: orderedStatuses(pid)[0].id, tagIds: [], versionId: null, repeat: null,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    add('t-rub', 'p-rub', 'Вёрстка');
    add('t-usd', 'p-usd', 'Landing');
    render();
  }, HOUR);
}

test('общий итог — только в основной валюте, проект в своей', async ({ page }) => {
  await seed(page);
  // Обзор: час по 1000 ₽ — в итоге; час по 50 $ — нет.
  await expect(page.locator('#st-money')).toHaveText(/1\s000\s₽/);
  await expect(page.locator('#st-time'), 'время считается по всем').toHaveText(/2ч/);
  // Карточка долларового проекта на странице «Проекты» — в долларах.
  await page.evaluate(() => openView('projects'));
  await expect(page.locator('.ptile', { hasText: 'Заказ из США' })).toContainText(/50\s\$/);

  await page.evaluate(() => openProject('p-usd'));
  await expect(page.locator('#project-earned')).toContainText('50 $');
  await page.evaluate(() => selectTask('t-usd'));
  await expect(page.locator('#timer-earned')).toHaveText(/50 \$/);
  await expect(page.locator('#rate-unit')).toHaveText('$/ч');
});

test('статистика: все проекты — в основной валюте, выбранный — в своей', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { state.ui.view = 'stats'; render(); });
  await expect(page.locator('#sp-money')).toHaveText(/1\s000\s₽/);
  await page.evaluate(() => { statsFilter.projectId = 'p-usd'; render(); });
  await expect(page.locator('#sp-money')).toHaveText(/50 \$/);
});

test('окно проекта: разделы, ставка и валюта сохраняются кнопкой', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { openProject('p-rub'); openProjectDialog(getProject('p-rub'), 'money'); });
  await expect(page.locator('#pdlg-tabs button.on')).toHaveText('Ставка и валюта');
  await expect(page.locator('#pdlg-rate')).toHaveValue('');
  await expect(page.locator('#pdlg-rate')).toHaveAttribute('placeholder', '1000');
  await expect(page.locator('#pdlg-currency')).toHaveText(/Как в настройках \(RUB ₽\)/);

  await page.locator('#pdlg-rate').fill('2500');
  await page.locator('#pdlg-currency').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'EUR' }).click();
  await expect(page.locator('#pdlg-rate-unit')).toHaveText('€/ч');
  // Пока не сохранили — проект прежний.
  expect(await page.evaluate(() => [getProject('p-rub').rate, getProject('p-rub').currency])).toEqual([null, null]);
  await page.locator('#pdlg-save').click();
  expect(await page.evaluate(() => [getProject('p-rub').rate, getProject('p-rub').currency])).toEqual([2500, 'EUR']);
  await expect(page.locator('#project-earned')).toContainText(/2\s500\s€/);
  // В рублёвый итог обзора проект больше не входит.
  await page.evaluate(() => { state.ui.view = 'home'; render(); });
  await expect(page.locator('#st-money')).toHaveText(/0\s₽/);
});

test('ставка задачи сильнее ставки проекта', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { getTask('t-usd').rate = 80; openProject('p-usd'); selectTask('t-usd'); });
  await expect(page.locator('#timer-earned')).toHaveText(/80 \$/);
});

test('в задаче видны общие теги и теги её проекта, чужие — нет', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { openProject('p-rub'); selectTask('t-rub'); });
  await page.locator('#task-tags-add').click();
  const names = page.locator('.tag-pop-item .tag-pop-name');
  await expect(names).toHaveText(['Срочное', 'Макет']);
  await expect(page.locator('.tag-pop-item', { hasText: 'Срочное' }).locator('.tag-pop-scope')).toHaveText('общий');
  // Тег, заведённый из задачи, — проектный.
  await page.locator('.tag-pop-search').fill('Правки');
  await page.locator('.tag-pop-create').click();
  await expect(page.locator('#tagdlg-backdrop .modal-title')).toHaveText('Новый тег · Сайт');
  await page.locator('#tagdlg-save').click();
  expect(await page.evaluate(() => state.tags.find((tg) => tg.name === 'Правки').projectId)).toBe('p-rub');
});

test('в настройках приложения — только общие теги, в окне проекта — его', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { state.ui.view = 'settings'; render(); });
  await expect(page.locator('#tags-list .settings-row-label')).toHaveText(['Срочное']);

  await page.evaluate(() => openProjectDialog(getProject('p-usd'), 'tags'));
  await expect(page.locator('#pdlg-tag-list .settings-row-label')).toHaveText(['Invoice']);
  await page.locator('#pdlg-tag-add').click();
  await page.locator('#tagdlg-name').fill('Макет');
  await page.locator('#tagdlg-save').click();
  // «Макет» есть в другом проекте — здесь имя свободно.
  await expect(page.locator('#tagdlg-backdrop')).toBeHidden();
  await expect(page.locator('#pdlg-tag-list .settings-row-label')).toHaveText(['Invoice', 'Макет']);
});

test('у нового проекта только «Основное» и «Ставка и валюта»', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => openProjectDialog(null));
  const visible = await page.locator('#pdlg-tabs button:visible').allTextContents();
  expect(visible).toEqual(['Основное', 'Ставка и валюта']);
  await expect(page.locator('#pdlg-later')).toBeVisible();
  // Поля во всю ширину окна — как в прежнем окне проекта.
  const w = await page.evaluate(() => ({ name: document.getElementById('pdlg-name').getBoundingClientRect().width, modal: document.querySelector('#pdlg-backdrop .modal').clientWidth }));
  expect(w.name).toBeGreaterThan(w.modal * 0.8);
});

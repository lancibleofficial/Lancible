// Теги: создание, назначение, показ и удаление. Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
});

/** Проект с тремя задачами. Через интерфейс это десяток кликов, а нам нужен
 *  не он, а то, что происходит с тегами дальше. */
async function seedProject(page) {
  return page.evaluate(() => {
    const pid = uid();
    state.projects.push({
      id: pid, name: 'Сайт клиента', color: '#87ff65', description: 'Лендинг',
      pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [],
    });
    seedProjectStatuses(pid);
    const cols = orderedStatuses(pid);
    for (const [i, title] of ['Свёрстать главную', 'Подключить оплату', 'Проверить'].entries()) {
      state.tasks.push({
        id: uid(), projectId: pid, title, done: false, notes: null, totalMs: 0, sessions: [],
        rate: null, pinnedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        statusId: cols[i + 1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    }
    state.ui.projectId = pid;
    state.ui.boardProjectId = pid;
    render();
    return pid;
  });
}

async function openSettings(page) {
  await page.evaluate(() => { state.ui.view = 'settings'; render(); });
  await expect(page.locator('#tags-list')).toBeVisible();
}

async function createTag(page, name) {
  await openSettings(page);
  await page.locator('#tags-add').click();
  await expect(page.locator('#tagdlg-backdrop')).toBeVisible();
  await page.locator('#tagdlg-name').fill(name);
  await page.locator('#tagdlg-save').click();
  await expect(page.locator('#tagdlg-backdrop')).toBeHidden();
}

test('пустой список объясняет, что такое теги, а не молчит', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#tags-list .tags-empty')).toContainText('общие для всего приложения');
});

test('тег создаётся и появляется в списке с пометкой, что он не используется', async ({ page }) => {
  await createTag(page, 'Срочное');
  const row = page.locator('#tags-list .settings-row-btn');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Срочное');
  await expect(row).toContainText('не используется');
});

test('тег с занятым именем не создаётся, и причина названа', async ({ page }) => {
  await createTag(page, 'Срочное');
  await page.locator('#tags-add').click();
  // Регистр и краевые пробелы не должны обманывать проверку.
  await page.locator('#tagdlg-name').fill('  срочное  ');
  await page.locator('#tagdlg-save').click();

  await expect(page.locator('#tagdlg-backdrop')).toBeVisible();
  await expect(page.locator('#tagdlg-error')).toBeVisible();
  await expect(page.locator('#tagdlg-error')).toContainText('уже есть');
  expect(await page.evaluate(() => state.tags.length)).toBe(1);
});

test('тег вешается на задачу через пикер и снимается крестиком', async ({ page }) => {
  await seedProject(page);
  await createTag(page, 'Срочное');
  await createTag(page, 'Дизайн');

  await page.evaluate(() => {
    const task = state.tasks[0];
    state.ui.view = 'project';
    selectedId = task.id;
    loadEditor(task);
    render();
    setTaskTab('settings');
  });
  await expect(page.locator('#tab-settings')).toBeVisible();

  await page.locator('#task-tags-add').click();
  await expect(page.locator('.tag-pop')).toBeVisible();
  await page.locator('.tag-pop-item').nth(0).click();
  await page.locator('.tag-pop-item').nth(1).click();
  // Выбранное помечено, а не залито: заливка спорила бы с наведением.
  await expect(page.locator('.tag-pop-item.sel')).toHaveCount(2);

  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(page.locator('#task-tags .tag-chip')).toHaveCount(2);

  await page.locator('#task-tags .tag-chip').first().locator('.tag-chip-x').click();
  await expect(page.locator('#task-tags .tag-chip')).toHaveCount(1);
  expect(await page.evaluate(() => state.tasks[0].tagIds.length)).toBe(1);
});

test('в пикере ищут по имени и оттуда же заводят новый тег', async ({ page }) => {
  await seedProject(page);
  await createTag(page, 'Срочное');
  await page.evaluate(() => {
    state.ui.view = 'project';
    selectedId = state.tasks[0].id;
    loadEditor(state.tasks[0]);
    render();
    setTaskTab('settings');
  });

  await page.locator('#task-tags-add').click();
  await page.locator('.tag-pop-search').fill('сроч');
  await expect(page.locator('.tag-pop-item')).toHaveCount(1);

  // «Бэклог» не совпадает ни с чем — значит, его предлагают создать.
  await page.locator('.tag-pop-search').fill('Бэклог');
  await expect(page.locator('.tag-pop-create')).toContainText('Бэклог');
  await page.locator('.tag-pop-create').click();

  // Окно создания открывается с уже подставленным именем.
  await expect(page.locator('#tagdlg-backdrop')).toBeVisible();
  await expect(page.locator('#tagdlg-name')).toHaveValue('Бэклог');
  await page.locator('#tagdlg-save').click();

  await expect(page.locator('#task-tags .tag-chip')).toContainText('Бэклог');
  expect(await page.evaluate(() => state.tags.length)).toBe(2);
});

test('теги проекта сохраняются только по кнопке сохранения', async ({ page }) => {
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');

  await page.evaluate((id) => openProjectDialog(getProject(id)), pid);
  await page.locator('#pdlg-tags-add').click();
  await page.locator('.tag-pop-item').first().click();
  // Гасим пикер нажатием на заголовок окна: клик в угол экрана попал бы по
  // подложке, а она закрывает и само окно проекта.
  await page.locator('#pdlg-title').click();
  await expect(page.locator('#pdlg-tags .tag-chip')).toHaveCount(1);

  await page.locator('#pdlg-cancel').click();
  expect(await page.evaluate((id) => getProject(id).tagIds.length, pid), 'отмена не должна сохранять').toBe(0);

  await page.evaluate((id) => openProjectDialog(getProject(id)), pid);
  await page.locator('#pdlg-tags-add').click();
  await page.locator('.tag-pop-item').first().click();
  await page.locator('#pdlg-title').click();
  await page.locator('#pdlg-save').click();
  expect(await page.evaluate((id) => getProject(id).tagIds.length, pid)).toBe(1);
});

test('чипы показываются там, где договорились, и нигде больше', async ({ page }) => {
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');
  await page.evaluate((id) => {
    const tag = state.tags[0];
    getProject(id).tagIds = [tag.id];
    state.tasks[0].tagIds = [tag.id];
    render();
  }, pid);

  // Шапка проекта — да, список задач в боковой панели — нет.
  await page.evaluate(() => { state.ui.view = 'project'; render(); });
  await expect(page.locator('#ph-tags .tag-chip')).toHaveCount(1);
  await expect(page.locator('#task-list .tag-chip')).toHaveCount(0);

  // Карточка доски — да.
  await page.evaluate(() => { state.ui.view = 'board'; renderBoardPage(); render(); });
  await expect(page.locator('.board-card .tag-chip')).toHaveCount(1);

  // Плитка проекта на главной — нет.
  await page.evaluate(() => { state.ui.view = 'home'; render(); });
  await expect(page.locator('.ptile .tag-chip')).toHaveCount(0);
});

test('удаление тега предупреждает, скольких оно коснётся, и отвязывает его', async ({ page }) => {
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');
  await page.evaluate((id) => {
    const tag = state.tags[0];
    getProject(id).tagIds = [tag.id];
    state.tasks[0].tagIds = [tag.id];
    state.tasks[1].tagIds = [tag.id];
    render();
  }, pid);

  await openSettings(page);
  await expect(page.locator('#tags-list .settings-row-btn')).toContainText('проектов: 1');
  await expect(page.locator('#tags-list .settings-row-btn')).toContainText('задач: 2');

  await page.locator('#tags-list .settings-row-btn').click();
  await page.locator('#tagdlg-delete').click();
  await expect(page.locator('#confirm-text')).toContainText('проектов: 1 · задач: 2');

  // Отмена ничего не удаляет.
  await page.locator('#confirm-cancel').click();
  expect(await page.evaluate(() => state.tags.length)).toBe(1);

  await page.locator('#tagdlg-delete').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#tagdlg-backdrop')).toBeHidden();

  const after = await page.evaluate((id) => ({
    tags: state.tags.length,
    project: getProject(id).tagIds.length,
    tasks: state.tasks.reduce((a, t) => a + t.tagIds.length, 0),
  }), pid);
  expect(after).toEqual({ tags: 0, project: 0, tasks: 0 });
});

test('бейдж красится цветом тега и читается в обеих темах', async ({ page }) => {
  // Тонированный бейдж — первое, что ломается при смене темы: яркий цвет,
  // годный на тёмном фоне, на белом превращается в невидимку. Проверяем не
  // «красиво», а измеримое — контраст надписи к подложке карточки.
  const pid = await seedProject(page);
  await createTag(page, 'Срочное');
  await createTag(page, 'Бэкенд');
  await page.evaluate((id) => {
    state.tags[0].color = '#f0736b';
    state.tags[1].color = '#f5c451';
    state.tasks[0].tagIds = state.tags.map((t) => t.id);
    state.ui.view = 'board';
    state.ui.boardProjectId = id;
    renderBoardPage();
    render();
  }, pid);

  const chips = page.locator('.board-card .tag-chip');
  await expect(chips).toHaveCount(2);
  // Цвет несёт подложка, отдельной точке внутри бейджа делать нечего.
  await expect(page.locator('.board-card .tag-chip .tag-dot')).toHaveCount(0);

  const measure = (theme) => page.evaluate((th) => {
    state.settings.theme = th;
    applyTheme();
    const parse = (s) => {
      const m = s.match(/[\d.]+/g).map(Number);
      return s.startsWith('color(') ? m.slice(0, 3) : m.slice(0, 3).map((v) => v / 255);
    };
    const lum = (rgb) => {
      const f = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const card = parse(getComputedStyle(document.querySelector('.board-card')).backgroundColor.replace('rgba', 'rgb'));
    return [...document.querySelectorAll('.board-card .tag-chip')].map((c) => {
      const ink = parse(getComputedStyle(c).color);
      const [a, b] = [lum(ink), lum(card)];
      return { color: getComputedStyle(c).color, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  }, theme);

  for (const theme of ['dark', 'light']) {
    const got = await measure(theme);
    expect(new Set(got.map((c) => c.color)).size, `в теме ${theme} бейджи одного цвета`).toBe(2);
    for (const c of got) {
      expect(c.contrast, `в теме ${theme} контраст надписи всего ${c.contrast.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('у неиспользуемого тега удаление не пугает лишними подробностями', async ({ page }) => {
  await createTag(page, 'Черновик');
  await page.locator('#tags-list .settings-row-btn').click();
  await page.locator('#tagdlg-delete').click();
  await expect(page.locator('#confirm-text')).toHaveText('Удалить тег «Черновик»?');
});

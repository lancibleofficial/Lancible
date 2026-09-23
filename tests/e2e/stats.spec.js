// Объединённая «Статистика»: четыре карточки, календарь внутри неё, фильтр
// «проект → версия» и правая панель, разложенная по проектам.
// Запуск: npm run test:e2e
const { test, expect } = require('@playwright/test');

const HOUR = 3_600_000;

/** Два проекта с версиями и записями за текущий месяц: без записей календарю
 *  и правой панели нечего показывать. */
async function seed(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();

  return page.evaluate((HOUR) => {
    const now = new Date();
    const mkProject = (name, color) => {
      const id = uid();
      state.projects.push({
        id, name, color, description: '',
        pinnedAt: null, createdAt: now.toISOString(), tagIds: [],
      });
      seedProjectStatuses(id);
      return id;
    };
    const p1 = mkProject('Сайт клиента', '#87ff65');
    const p2 = mkProject('Лендинг', '#5ec8f2');
    state.settings.hourlyRate = 2000;
    state.settings.currency = 'RUB';

    const mkVer = (pid, name, releasedAt, order) => {
      const v = { id: uid(), projectId: pid, name, releasedAt, order };
      state.versions.push(v);
      return v;
    };
    const v13 = mkVer(p1, 'v1.3', null, 0);
    const v14 = mkVer(p1, 'v1.4', null, 1);
    const w1 = mkVer(p2, 'Запуск', null, 0);

    const addTask = (pid, title, versionId, spans) => {
      const cols = orderedStatuses(pid);
      const sessions = spans.map(([daysAgo, hours, hh]) => {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hh, 0, 0);
        const ms = hours * HOUR;
        return { start: start.toISOString(), end: new Date(start.getTime() + ms).toISOString(), ms };
      });
      const totalMs = sessions.reduce((a, s) => a + s.ms, 0);
      state.tasks.push({
        id: uid(), projectId: pid, title, done: false, notes: null,
        totalMs, sessions, rate: null, pinnedAt: null,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
        statusId: cols[1].id, tagIds: [], versionId, repeat: null, cancelled: false,
        dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
      });
    };
    // Сегодня: 2ч + 0.75ч по «Сайту клиента», 1.25ч по «Лендингу».
    addTask(p1, 'Вёрстка карточек', v13.id, [[0, 2, 10]]);
    addTask(p1, 'API отчётов', v13.id, [[0, 0.75, 13]]);
    addTask(p1, 'Поиск', v14.id, [[2, 1, 11]]);
    addTask(p2, 'Первый экран', w1.id, [[0, 1.25, 16]]);

    state.ui.projectId = p1;
    state.ui.view = 'stats';
    render();
    return { p1, p2 };
  }, HOUR);
}

const cards = (page) => page.evaluate(() => ({
  time: document.getElementById('sp-time').textContent.trim(),
  money: document.getElementById('sp-money').textContent.trim(),
  month: document.getElementById('sp-month').textContent.trim(),
  done: document.getElementById('sp-done').textContent.trim(),
}));

test('календарь живёт внутри «Статистики», отдельного пункта меню нет', async ({ page }) => {
  await seed(page);
  const views = await page.locator('.nav-item[data-view]').evaluateAll((els) => els.map((e) => e.dataset.view));
  expect(views, 'пункт «Календарь» должен исчезнуть').not.toContain('calendar');
  expect(views).toContain('stats');
  await expect(page.locator('#calendar-view')).toHaveCount(0);
  await expect(page.locator('#stats-view .cal-grid')).toHaveCount(1);
  await expect(page.locator('#stats-view #cal-days')).toBeVisible();
});

test('правая панель — колонка во всю высоту, карточки рядом с ней', async ({ page }) => {
  // Календарь переезжал целиком, и на переезде легко потерять закрывающий
  // тег: панель тогда оказывается внутри сетки и уезжает вниз. А шапка
  // статистики должна жить в левой колонке — над всей сеткой она отжимала
  // панель вниз, и та начиналась где-то посередине экрана.
  await seed(page);
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return {
        left: Math.round(b.left), right: Math.round(b.right),
        top: Math.round(b.top), bottom: Math.round(b.bottom),
      };
    };
    return {
      view: r('#stats-view'),
      main: r('#stats-view .cal-main'),
      aside: r('#stats-view .cal-day'),
      cards: r('#stats-view .stat-cards'),
      days: r('#stats-view #cal-days'),
    };
  });

  expect(m.aside.left, 'панель должна начинаться правее сетки').toBeGreaterThanOrEqual(m.main.right - 2);
  expect(m.aside.top, 'панель должна начинаться у шапки').toBe(m.view.top);
  expect(m.aside.bottom, 'панель должна доходить до низа окна').toBe(m.view.bottom);
  expect(m.cards.right, 'карточки не должны залезать на панель').toBeLessThanOrEqual(m.aside.left);
  // Карточки и календарь — одна колонка, поэтому края у них общие.
  expect(m.cards.left).toBe(m.days.left);
  expect(Math.abs(m.cards.right - m.days.right)).toBeLessThanOrEqual(2);
});

test('четыре карточки считают то же, что и данные', async ({ page }) => {
  await seed(page);
  const c = await cards(page);
  expect(c.time).toMatch(/5ч/);          // 2 + 0.75 + 1 + 1.25 = 5ч
  expect(c.money).toMatch(/10\s?000/);   // 5ч × 2000
  expect(c.month).toMatch(/10\s?000/);   // все записи в текущем месяце
  expect(c.done).toBe('0 / 4');
});

test('фильтр «проект → версия» сужает и цифры, и календарь, и панель', async ({ page }) => {
  await seed(page);

  await expect(page.locator('#sf-project')).toHaveText('Все проекты');
  await expect(page.locator('#sf-version')).toBeHidden();
  await expect(page.locator('#sf-reset')).toBeHidden();
  await expect(page.locator('#cal-day-list .cdl-group')).toHaveCount(2);

  await page.locator('#sf-project').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Сайт клиента' }).click();

  await expect(page.locator('#sf-version')).toBeVisible();
  await expect(page.locator('#sf-version')).toHaveText('Все версии');
  await expect(page.locator('#sf-reset')).toBeVisible();
  expect((await cards(page)).time).toMatch(/3ч 45м/);   // 2 + 0.75 + 1
  await expect(page.locator('#cal-day-list .cdl-group')).toHaveCount(1);

  await page.locator('#sf-version').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'v1.3' }).click();
  expect((await cards(page)).time).toMatch(/2ч 45м/);   // 2 + 0.75
  expect((await cards(page)).done).toBe('0 / 2');

  await page.locator('#sf-reset').click();
  await expect(page.locator('#sf-project')).toHaveText('Все проекты');
  await expect(page.locator('#sf-version')).toBeHidden();
  expect((await cards(page)).time).toMatch(/5ч/);
});

test('смена проекта сбрасывает версию — она принадлежала прежнему', async ({ page }) => {
  await seed(page);
  await page.locator('#sf-project').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Сайт клиента' }).click();
  await page.locator('#sf-version').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'v1.3' }).click();
  await expect(page.locator('#sf-version')).toHaveText('v1.3');

  await page.locator('#sf-project').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Лендинг' }).click();
  await expect(page.locator('#sf-version')).toHaveText('Все версии');
  // Иначе экран был бы пуст: версии «Сайта клиента» в «Лендинге» нет.
  await expect(page.locator('#cal-day-list .cdl-group')).toHaveCount(1);
});

test('записи в правой панели разложены по проектам и сворачиваются', async ({ page }) => {
  await seed(page);
  const groups = page.locator('#cal-day-list .cdl-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator('.cdl-group-name')).toHaveText('Сайт клиента');
  await expect(groups.nth(0).locator('.cdl-group-tot')).toHaveText(/2ч 45м/);
  await expect(groups.nth(0).locator('.cdl-rows > li')).toHaveCount(2);
  await expect(groups.nth(1).locator('.cdl-group-name')).toHaveText('Лендинг');

  await groups.nth(0).locator('.cdl-group-head').click();
  await expect(groups.nth(0)).toHaveClass(/closed/);
  await expect(groups.nth(0).locator('.cdl-rows')).toBeHidden();
  // Итог по проекту виден и свёрнутым — иначе сворачивать было бы незачем.
  await expect(groups.nth(0).locator('.cdl-group-tot')).toBeVisible();
  await expect(groups.nth(0).locator('.cdl-group-head')).toHaveAttribute('aria-expanded', 'false');

  await groups.nth(0).locator('.cdl-group-head').click();
  await expect(groups.nth(0).locator('.cdl-rows')).toBeVisible();
});

test('фильтр версии в списке задач отбирает и сам список', async ({ page }) => {
  await seed(page);
  const ids = await page.evaluate(() => {
    openProject(state.projects[0].id);
    return null;
  });
  expect(ids).toBe(null);

  await expect(page.locator('#tf-version')).toBeVisible();
  await expect(page.locator('#tf-version')).toHaveText('Все версии');
  await expect(page.locator('#task-list .task-item')).toHaveCount(3);

  await page.locator('#tf-version').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'v1.3' }).click();
  await expect(page.locator('#tf-version')).toHaveText('v1.3');
  await expect(page.locator('#task-list .task-item')).toHaveCount(2);

  await page.locator('#tf-version').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Все версии' }).click();
  await expect(page.locator('#task-list .task-item')).toHaveCount(3);
});

test('имя выгрузки называет фильтр, а сама выгрузка урезана', async ({ page }) => {
  // Иначе полную выгрузку не отличить от урезанной ни по имени, ни по виду.
  await seed(page);
  const got = await page.evaluate(() => {
    const calls = [];
    const real = window.api.exportXlsx;
    window.api.exportXlsx = async ({ defaultName, sheets }) => {
      calls.push({ defaultName, rows: sheets[0].rows.length });
      return { ok: true };
    };
    const p1 = state.projects[0];
    const v13 = state.versions.find((v) => v.name === 'v1.3');

    openProject(p1.id);
    taskFilter.versionId = 'all';
    exportProject();
    const all = calls.pop();
    taskFilter.versionId = v13.id;
    exportProject();
    const filtered = calls.pop();

    statsFilter.projectId = p1.id;
    statsFilter.versionId = v13.id;
    exportCalendar();
    const period = calls.pop();

    taskFilter.versionId = 'all';
    statsFilter.projectId = 'all';
    statsFilter.versionId = 'all';
    window.api.exportXlsx = real;
    return { all, filtered, period };
  });

  expect(got.all.defaultName).not.toMatch(/v1\.3/);
  expect(got.filtered.defaultName).toMatch(/v1\.3/);
  expect(got.filtered.rows, 'урезанная выгрузка должна быть короче').toBeLessThan(got.all.rows);
  expect(got.period.defaultName).toMatch(/Сайт клиента · v1\.3/);
});

// Пустые экраны с иллюстрацией. Запуск: npm run test:e2e
//
// Решение 10 октября 2026: у каждого пустого экрана — сценка, заголовок,
// строка пояснения и, если действие очевидно, кнопка. Сценки — инлайн-SVG из
// core/illustrations.js, формы красятся токенами --art-* и --accent. Здесь
// три образца первого шага: «Проекты», «Документы», «Время» (расписание за
// период без записей), — и ниже все остальные места из описи (шаг 2, 11
// октября): панели, острова, выпадашки и списки в окне.
//
// Всё — замером: что сценка нарисована и красится темой, что текст читается
// (контраст по WCAG в обеих темах), что кнопка ведёт к созданию, что
// ничего не уезжает вбок на 1280 и 375.
const { test, expect } = require('@playwright/test');
const { pinClock } = require('./clock');

/** Чистая вкладка. withProject — один проект без задач и записей; withTask —
 *  в нём одна задача без записей; withDoc — и один документ без проекта. */
async function open(page, { theme = 'dark', width = 1280, withProject = false, withTask = false, withDoc = false } = {}) {
  await page.setViewportSize({ width, height: 860 });
  await pinClock(page);
  await page.goto('/index.html');
  // Отложенное сохранение тоже снимаем: иначе при перезагрузке оно вернуло бы
  // в чистое хранилище данные прошлого места (тесты ниже обходят их подряд
  // на одной странице).
  await page.evaluate(() => { clearTimeout(saveTimer); savePending = false; localStorage.clear(); });
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(({ theme, withProject, withTask, withDoc }) => {
    if (withProject || withTask || withDoc) {
      const id = uid();
      state.projects.push({ id, name: 'Сайт', color: '#5ec8f2', description: '', pinnedAt: null, createdAt: new Date().toISOString(), tagIds: [] });
      seedProjectStatuses(id);
      if (withTask) newTaskOnAgenda(id, 'Вёрстка');
    }
    if (withDoc) {
      newDocument(null);
      state.documents[0].title = 'Бриф';
      state.ui.view = 'home';
    }
    state.settings.theme = theme;
    applyTheme();
    render();
  }, { theme, withProject, withTask, withDoc });
}

/** Три образца: как открыть экран и где лежит его пустой экран. */
const SAMPLES = {
  projects: {
    withProject: false,
    go: () => openView('projects'),
    box: '#home-empty',
    view: '#projects-view',
    title: 'У вас пока нет проектов',
    button: 'Новый проект',
  },
  docs: {
    withProject: true,
    go: () => openDocs(),
    box: '#doc-empty',
    view: '#docs-view',
    title: 'Документов пока нет',
    button: 'Новый документ',
  },
  time: {
    withProject: true,
    go: () => { state.ui.view = 'time'; state.ui.timeMode = 'agenda'; render(); },
    box: '#ag-list .empty-state',
    view: '#time-view',
    title: 'За этот период записей нет',
    button: 'Новая запись',
  },
};

async function show(page, name, opts = {}) {
  const s = SAMPLES[name];
  await open(page, { withProject: s.withProject, ...opts });
  await page.evaluate(s.go);
  const box = page.locator(s.box);
  await expect(box).toBeVisible();
  return box;
}

const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Вычисленные цвета пустого экрана: текст, то, на чём он лежит, формы
 *  сценки и значения токенов, из которых они должны браться. */
function measure(sel) {
  const box = document.querySelector(sel);
  const cs = (n) => getComputedStyle(n);
  // Подложка — первый предок с непрозрачным фоном: остров или земля.
  let bgNode = box;
  while (bgNode && /rgba\(0, 0, 0, 0\)|transparent/.test(cs(bgNode).backgroundColor)) bgNode = bgNode.parentElement;
  const token = (name) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${name})`;
    box.appendChild(probe);
    const v = cs(probe).color;
    probe.remove();
    return v;
  };
  const svg = box.querySelector('svg.es-art');
  const fill = (cls) => cs(svg.querySelector(cls)).fill;
  return {
    bg: cs(bgNode || document.body).backgroundColor,
    title: cs(box.querySelector('.empty-state-title')).color,
    text: cs(box.querySelector('.empty-state-text')).color,
    titleText: box.querySelector('.empty-state-title').textContent.trim(),
    textText: box.querySelector('.empty-state-text').textContent.trim(),
    viewBox: svg.getAttribute('viewBox'),
    ariaHidden: svg.getAttribute('aria-hidden'),
    shapes: svg.querySelectorAll('*').length,
    // Размер по стилю, а не по рамке: сценка появляется с лёгким масштабом.
    artW: parseFloat(cs(svg).width),
    plate: fill('.es-plate'),
    sheet: fill('.es-sheet'),
    mark: fill('.es-mark'),
    tokPlate: token('--art-plate'),
    tokSheet: token('--art-sheet'),
    tokAccent: token('--accent'),
  };
}

for (const theme of ['dark', 'light']) {
  for (const name of Object.keys(SAMPLES)) {
    test(`${theme}: «${name}» — сценка из токенов темы, заголовок и пояснение читаются`, async ({ page }) => {
      await show(page, name, { theme });
      const m = await page.evaluate(measure, SAMPLES[name].box);
      expect(m.titleText).toBe(SAMPLES[name].title);
      expect(m.textText.length, 'пояснение не пустое').toBeGreaterThan(10);
      expect(m.viewBox, 'рамка сценки одна на все').toBe('0 0 120 88');
      expect(m.ariaHidden, 'картинка декоративная — скринридеру её не читать').toBe('true');
      expect(m.shapes, 'сценка нарисована, а не пустой svg').toBeGreaterThan(4);
      expect(m.artW, 'большой вариант — 120 px').toBe(120);
      expect(m.plate, 'подложка — токен --art-plate').toBe(m.tokPlate);
      expect(m.sheet, 'лист — токен --art-sheet').toBe(m.tokSheet);
      expect(m.mark, 'пятно акцента — токен --accent').toBe(m.tokAccent);
      expect(contrast(parse(m.plate), parse(m.bg)), 'подложка сценки отличается от того, на чём лежит').toBeGreaterThan(1.05);
      expect(contrast(parse(m.title), parse(m.bg)), 'заголовок').toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(m.text), parse(m.bg)), 'пояснение').toBeGreaterThanOrEqual(4.5);
    });
  }
}

test('«Проекты»: «Новый проект» — единственная акцентная кнопка, открывает окно проекта', async ({ page }) => {
  const box = await show(page, 'projects');
  await expect(page.locator('#projects-view .btn-accent:visible')).toHaveCount(1);
  const btn = box.locator('button');
  await expect(btn).toHaveText(SAMPLES.projects.button);
  await btn.click();
  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
});

test('«Документы»: «Новый документ» — единственная акцентная кнопка, создаёт документ', async ({ page }) => {
  const box = await show(page, 'docs');
  await expect(page.locator('#docs-view .btn-accent:visible')).toHaveCount(1);
  await expect(page.locator('#doc-list-empty'), 'список не повторяет пустой экран').toBeHidden();
  const btn = box.locator('button');
  await expect(btn).toHaveText(SAMPLES.docs.button);
  await btn.click();
  await expect(page.locator('#doc-main')).toBeVisible();
  await expect(box).toBeHidden();
  await expect(page.locator('#doc-new'), 'документ есть — «Новый» вернулся в список').toBeVisible();
  expect(await page.evaluate(() => state.documents.length)).toBe(1);
});

test('«Время»: «Новая запись» — та же, что «+ Запись» в шапке: заводит запись и открывает её окно', async ({ page }) => {
  const box = await show(page, 'time');
  const btn = box.locator('button');
  await expect(btn).toHaveText(SAMPLES.time.button);
  await expect(btn, 'акцентная у экрана уже есть — в шапке; эта тихая').toHaveClass(/\bbtn-soft\b/);
  await btn.click();
  await expect(page.locator('#tmdlg-backdrop')).toBeVisible();
  const sessions = await page.evaluate(() => state.tasks.reduce((a, t) => a + (t.sessions || []).length, 0));
  expect(sessions, 'запись заведена').toBe(1);
});

test('«Время» без проектов: записи завести некуда — кнопка заводит проект', async ({ page }) => {
  await open(page);
  await page.evaluate(SAMPLES.time.go);
  const box = page.locator(SAMPLES.time.box);
  await expect(box).toBeVisible();
  await expect(box.locator('.empty-state-text')).toHaveText('Сначала нужен проект');
  await box.locator('button', { hasText: 'Новый проект' }).click();
  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
});

for (const width of [1280, 375]) {
  test(`${width}: пустые экраны не уезжают вбок`, async ({ page }) => {
    for (const name of Object.keys(SAMPLES)) {
      await show(page, name, { width });
      const m = await page.evaluate(({ box, view }) => {
        const b = document.querySelector(box).getBoundingClientRect();
        const v = document.querySelector(view);
        return {
          docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          viewScroll: v.scrollWidth - v.clientWidth,
          left: b.left,
          right: b.right,
          vw: window.innerWidth,
        };
      }, { box: SAMPLES[name].box, view: SAMPLES[name].view });
      expect(m.docScroll, `${name}: прокрутки страницы вбок нет`).toBeLessThanOrEqual(0);
      expect(m.viewScroll, `${name}: прокрутки вида вбок нет`).toBeLessThanOrEqual(0);
      expect(m.left, `${name}: левый край в окне`).toBeGreaterThanOrEqual(0);
      expect(m.right, `${name}: правый край в окне`).toBeLessThanOrEqual(m.vw);
    }
  });
}

// --- шаг 2: остальные пустые состояния из описи ------------------------------
//
// Каждое место: как его открыть, где лежит пустой экран, заголовок, сценка,
// вариант (lg — экран или большой остров, sm — компактный для панелей и
// выпадашек, row — компактный в строку: сценка слева) и кнопка, если
// действие очевидно. Где кнопки нет (поиск, уведомления, история, строка
// создания рядом), тест требует, чтобы её и не было.

const PLACES = {
  'время-день': {
    seed: { withProject: true },
    go: () => { state.ui.view = 'time'; state.ui.timeMode = 'month'; render(); },
    box: '#cal-day-empty', title: 'В этот день записей не было', size: 'sm', art: 'time',
  },
  'время-период': {
    seed: { withProject: true },
    go: () => { state.ui.view = 'time'; state.ui.timeMode = 'month'; render(); togglePeriod(); },
    box: '#cal-day-empty', title: 'За этот период записей нет', size: 'sm', art: 'time',
  },
  'проект-задачи': {
    seed: { withProject: true },
    go: () => { openProject(state.projects[0].id); render(); },
    box: '#sidebar-empty', title: 'Задач пока нет', size: 'lg', art: 'tasks', button: 'Новая задача',
  },
  'проект-фильтр': {
    seed: { withTask: true },
    go: () => { openProject(state.projects[0].id); render(); document.querySelector('.tf-status [data-status="done"]').click(); },
    box: '#sidebar-empty', title: 'Под фильтр ничего не подходит', size: 'sm', art: 'filter', button: 'Показать все',
  },
  'проект-записи': {
    seed: { withProject: true },
    go: () => { openProject(state.projects[0].id); render(); },
    box: '#ps-empty', title: 'Записей пока нет', size: 'sm', art: 'timer',
  },
  'проект-документы': {
    seed: { withProject: true },
    go: () => { openProject(state.projects[0].id); state.ui.projectTab = 'docs'; render(); },
    box: '#pdoc-empty', title: 'В проекте пока нет документов', size: 'lg', art: 'docs', button: 'Новый документ',
  },
  'проект-версии': {
    seed: { withProject: true },
    go: () => { openProject(state.projects[0].id); state.ui.projectTab = 'versions'; render(); },
    box: '#pver-empty', title: 'Версий пока нет', size: 'lg', art: 'versions', button: 'Новая версия',
  },
  'задача-история': {
    seed: { withTask: true },
    go: () => { selectTask(state.tasks[0].id); render(); document.querySelector('[data-tab="history"]').click(); },
    box: '#session-empty', title: 'Записей пока нет', size: 'sm', art: 'timer',
  },
  'сегодня-дедлайны': {
    seed: { withProject: true },
    go: () => { state.ui.view = 'home'; render(); },
    box: '#home-due-empty', title: 'Дедлайнов и напоминаний пока нет', size: 'sm', art: 'bell',
  },
  'сегодня-недавние': {
    seed: { withProject: true },
    go: () => { state.ui.view = 'home'; render(); },
    box: '#recent-empty', title: 'Недавних задач нет', size: 'sm', art: 'timer',
  },
  'сегодня-без-проектов': {
    seed: {},
    go: () => { state.ui.view = 'home'; render(); },
    box: '#recent-empty', title: 'Начните с проекта', size: 'sm', art: 'projects', button: 'Новый проект', accent: true,
  },
  'карточка-проекта': {
    seed: { withProject: true },
    go: () => { state.ui.view = 'projects'; render(); },
    box: '.ptile-empty .empty-state', title: 'Задач пока нет', size: 'sm', art: 'tasks',
  },
  'уведомления': {
    seed: {},
    act: (page) => page.locator('#notif-btn').click(),
    box: '#notif-empty', title: 'Дедлайнов и напоминаний пока нет', size: 'sm', art: 'bell',
  },
  'поиск-до-ввода': {
    seed: {},
    act: (page) => page.locator('#search-input').click(),
    box: '#search-results .empty-state', title: 'Найдите задачу или проект', size: 'sm', art: 'search',
  },
  'поиск-мимо': {
    seed: { withTask: true },
    act: async (page) => { await page.locator('#search-input').click(); await page.locator('#search-input').fill('щщщ'); },
    box: '#search-results .empty-state', title: 'Ничего не найдено', size: 'sm', art: 'search',
  },
  'документы-поиск': {
    seed: { withDoc: true },
    act: async (page) => { await page.evaluate(() => openDocs()); await page.locator('#doc-search').fill('щщщ'); },
    box: '#doc-list-empty', title: 'Ничего не нашлось', size: 'sm', art: 'search',
  },
  'настройки-теги': {
    seed: {},
    go: () => { state.ui.view = 'settings'; render(); },
    box: '#tags-list .empty-state', title: 'Общих тегов пока нет', size: 'sm', art: 'tags',
  },
  'окно-проекта-теги': {
    seed: { withProject: true },
    go: () => openProjectDialog(getProject(state.projects[0].id), 'tags'),
    box: '#pdlg-tag-list .empty-state', title: 'У проекта пока нет своих тегов', size: 'row', art: 'tags',
  },
  'окно-проекта-версии': {
    seed: { withProject: true },
    go: () => openProjectDialog(getProject(state.projects[0].id), 'versions'),
    box: '#ver-list .empty-state', title: 'Версий пока нет', size: 'row', art: 'versions',
  },
  'выбор-тегов': {
    seed: { withTask: true },
    act: async (page) => { await page.evaluate(() => { selectTask(state.tasks[0].id); render(); }); await page.locator('#task-tags-add').click(); },
    box: '.tag-pop .empty-state', title: 'Тегов пока нет', size: 'row', art: 'tags',
  },
};

async function place(page, name, opts = {}) {
  const p = PLACES[name];
  await open(page, { ...p.seed, ...opts });
  if (p.go) await page.evaluate(p.go);
  if (p.act) await p.act(page);
  const box = page.locator(p.box);
  await expect(box).toBeVisible();
  return box;
}

const ART_W = { lg: 120, sm: 56, row: 56 };

for (const theme of ['dark', 'light']) {
  for (const name of Object.keys(PLACES)) {
    test(`${theme}: «${name}» — сценка из токенов, заголовок и пояснение читаются`, async ({ page }) => {
      const p = PLACES[name];
      const box = await place(page, name, { theme });
      const m = await page.evaluate(measure, p.box);
      expect(m.titleText).toBe(p.title);
      expect(m.textText.length, 'пояснение не пустое').toBeGreaterThan(10);
      expect(await box.locator('svg.es-art').getAttribute('data-art'), 'сценка своя у места').toBe(p.art);
      expect(m.viewBox, 'рамка сценки одна на все').toBe('0 0 120 88');
      expect(m.ariaHidden, 'картинка декоративная').toBe('true');
      expect(m.shapes, 'сценка нарисована, а не пустой svg').toBeGreaterThan(4);
      expect(m.artW, `вариант ${p.size}`).toBe(ART_W[p.size]);
      expect(m.plate, 'подложка — токен --art-plate').toBe(m.tokPlate);
      expect(m.sheet, 'лист — токен --art-sheet').toBe(m.tokSheet);
      expect(m.mark, 'пятно акцента — токен --accent').toBe(m.tokAccent);
      expect(contrast(parse(m.plate), parse(m.bg)), 'подложка сценки отличается от того, на чём лежит').toBeGreaterThan(1.05);
      expect(contrast(parse(m.title), parse(m.bg)), 'заголовок').toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(m.text), parse(m.bg)), 'пояснение').toBeGreaterThanOrEqual(4.5);
      // Вариант — классом общей детали, а не своими правилами места.
      await expect(box).toHaveClass(/(^|\s)empty-state(\s|$)/);
      if (p.size === 'lg') await expect(box).not.toHaveClass(/empty-state-sm/);
      else await expect(box).toHaveClass(/empty-state-sm/);
      if (p.size === 'row') {
        await expect(box).toHaveClass(/empty-state-row/);
        const r = await box.evaluate((n) => ({
          art: n.querySelector('.es-art').getBoundingClientRect().right,
          title: n.querySelector('.empty-state-title').getBoundingClientRect().left,
        }));
        expect(r.art, 'в строку: сценка слева от слов').toBeLessThanOrEqual(r.title);
      }
      // Кнопка — только где действие очевидно; акцентная — где другой нет.
      await expect(box.locator('button')).toHaveCount(p.button ? 1 : 0);
      if (p.button) {
        await expect(box.locator('button')).toHaveText(p.button);
        await expect(box.locator('button'), p.accent ? 'другой акцентной на экране нет' : 'акцентная у экрана уже есть — эта тихая')
          .toHaveClass(p.accent ? /\bbtn-accent\b/ : /\bbtn-soft\b/);
      }
    });
  }
}

test('«Задач пока нет»: «Новая задача» — та же, что «+ Задача»: заводит задачу и открывает её', async ({ page }) => {
  const box = await place(page, 'проект-задачи');
  await expect(page.locator('#sidebar .tl-head'), 'заголовки колонок без строк не нужны').toBeHidden();
  await box.locator('button').click();
  await expect.poll(() => page.evaluate(() => [state.tasks.length, state.ui.view])).toEqual([1, 'task']);
});

test('«Под фильтр ничего не подходит»: «Показать все» снимает отбор, задача видна', async ({ page }) => {
  const box = await place(page, 'проект-фильтр');
  await box.locator('button').click();
  await expect(box).toBeHidden();
  await expect(page.locator('#task-list .task-item')).toHaveCount(1);
  expect(await page.evaluate(() => taskFilter)).toEqual({ status: 'all', versionId: 'all' });
});

test('документы проекта: «Новый документ» по центру, в шапке вкладки он на это время спрятан', async ({ page }) => {
  const box = await place(page, 'проект-документы');
  await expect(page.locator('#pdoc-new')).toBeHidden();
  await box.locator('button').click();
  await expect.poll(() => page.evaluate(() => (state.documents || []).map((d) => d.projectId === state.projects[0].id))).toEqual([true]);
});

test('версии проекта: «Новая версия» открывает окно проекта на версиях', async ({ page }) => {
  const box = await place(page, 'проект-версии');
  await expect(page.locator('#pver-list .pver-row'), 'одна строка «Без версии» пустоту не объясняла бы').toHaveCount(0);
  await box.locator('button').click();
  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
  await expect(page.locator('#pdlg-sec-versions')).toBeVisible();
});

test('«Сегодня» без проектов: «Новый проект» — единственная акцентная кнопка, открывает окно проекта', async ({ page }) => {
  const box = await place(page, 'сегодня-без-проектов');
  await expect(page.locator('#home-view .btn-accent:visible')).toHaveCount(1);
  await box.locator('button').click();
  await expect(page.locator('#pdlg-backdrop')).toBeVisible();
});

test('перерисовка на месте не переигрывает сценку: тот же узел, пока слова те же', async ({ page }) => {
  // Поиск: каждый следующий символ мимо — тот же пустой экран.
  await place(page, 'поиск-мимо');
  await page.evaluate(() => { document.querySelector('#search-results .es-art').dataset.probe = '1'; });
  await page.locator('#search-input').pressSequentially('щ');
  await expect(page.locator('#search-results .empty-state-title')).toHaveText('Ничего не найдено');
  await expect(page.locator('#search-results .es-art[data-probe="1"]')).toHaveCount(1);
  // Список проекта: render() по любому поводу — тот же пустой экран.
  await place(page, 'проект-задачи');
  await page.evaluate(() => { document.querySelector('#sidebar-empty .es-art').dataset.probe = '1'; render(); render(); });
  await expect(page.locator('#sidebar-empty .es-art[data-probe="1"]')).toHaveCount(1);
});

test('язык сменился — слова пустого экрана тоже: и собранного кодом, и из разметки', async ({ page }) => {
  await place(page, 'проект-задачи');
  await page.evaluate(() => setLang('en'));
  await expect(page.locator('#sidebar-empty .empty-state-title')).toHaveText('No tasks yet');
  await expect(page.locator('#ps-empty .empty-state-title')).toHaveText('No entries yet');
});

for (const width of [1280, 375]) {
  test(`${width}: пустые экраны шага 2 не уезжают вбок`, async ({ page }) => {
    for (const name of Object.keys(PLACES)) {
      await place(page, name, { width });
      const m = await page.evaluate((sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return {
          docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          left: b.left,
          right: b.right,
          vw: window.innerWidth,
        };
      }, PLACES[name].box);
      expect(m.docScroll, `${name}: прокрутки страницы вбок нет`).toBeLessThanOrEqual(0);
      expect(m.left, `${name}: левый край в окне`).toBeGreaterThanOrEqual(0);
      expect(m.right, `${name}: правый край в окне`).toBeLessThanOrEqual(m.vw);
    }
  });
}

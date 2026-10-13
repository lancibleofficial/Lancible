// Адреса экранов. Запуск: npm run test:e2e
//
// Откуда взялось. «Обновить страницу» отправляло на «Сегодня» с любого экрана,
// а у проектов и задач не было своих ссылок. Теперь экран и открытая сущность
// лежат в хэше (core/route.js: #/project/<id>, #/task/<id>, #/stats/month …).
//
// Что обещано, и каждое обещание — отдельный тест ниже:
//   · перезагрузка оставляет на том же экране, для каждого вида экрана;
//   · «назад» и «вперёд» ходят по экранам, а вкладка проекта и режим
//     «Статистики» историю не засоряют;
//   · кривая ссылка и сущность, которой нет, — «Сегодня», адрес заменён, а не
//     дописан;
//   · «Скопировать ссылку» кладёт ссылку, и она открывает то же самое в
//     другой вкладке;
//   · на новом устройстве ссылка на свой проект дожидается первой
//     синхронизации, а не улетает на «Сегодня» раньше, чем проект приедет.
const { test, expect } = require('@playwright/test');

const hashOf = (page) => page.evaluate(() => location.hash);
const historyLength = (page) => page.evaluate(() => history.length);

/** init() отработал: заставки уже нет. Раньше экран читать нельзя — на
 *  нём ещё «Сегодня» из разметки, а адрес разбирается в конце init(). */
async function ready(page) {
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
}

/** Чистая вкладка и данные: проект с неудобным id (слэш, пробел, решётка и
 *  «?» — всё, что ломает адрес, если его не кодировать), две задачи, два
 *  документа. Сохраняется сразу: перезагрузка должна увидеть эти данные. */
async function start(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
  return page.evaluate(() => {
    const now = new Date().toISOString();
    const pid = 'про/ект 1#?';
    state.projects.push({ id: pid, name: 'Сайт', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
    seedProjectStatuses(pid);
    const task = (id, title) => ({
      id, projectId: pid, title, done: false, notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null,
      createdAt: now, updatedAt: now, statusId: defaultStatusId(pid, false), tagIds: [], versionId: null, repeat: null,
      cancelled: false, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    });
    state.tasks.push(task('t-1', 'Верстка'), task('t-2', 'Тесты'));
    state.documents.push(Core.newDocument({ id: 'd-1', title: 'Бриф' }), Core.newDocument({ id: 'd-2', title: 'План' }));
    render();
    scheduleSave();
    return saveNow().then(() => ({ pid }));
  });
}

/** Экран, который сейчас виден: имя вида приложения. */
const shown = (page) => page.evaluate(() => {
  const views = { home: 'home-view', projects: 'projects-view', project: 'project-view', task: 'task-view', docs: 'docs-view', time: 'time-view', settings: 'settings-view' };
  return Object.keys(views).filter((v) => !document.getElementById(views[v]).hidden);
});

const nav = (page, view) => page.locator(`#navrail .nav-item[data-view="${view}"]`).click();

test('по умолчанию — «Сегодня», и адрес его называет', async ({ page }) => {
  await start(page);
  expect(await shown(page)).toEqual(['home']);
  expect(await hashOf(page)).toBe('#/today');
});

test('перезагрузка оставляет на том же экране: проекты, проект, его вкладки, задача, документы, статистика, настройки', async ({ page }) => {
  const { pid } = await start(page);
  const enc = encodeURIComponent(pid);
  const at = async (view, hash) => {
    expect(await hashOf(page), `адрес экрана «${view}»`).toBe(hash);
    await page.reload();
    await ready(page);
    expect(await hashOf(page), `после перезагрузки: ${view}`).toBe(hash);
    expect(await shown(page), `после перезагрузки: ${view}`).toEqual([view]);
  };

  await nav(page, 'projects');
  await at('projects', '#/projects');

  await page.evaluate((id) => openProject(id), pid);
  await at('project', `#/project/${enc}`);
  await expect(page.locator('#ph-name')).toHaveText('Сайт');

  await page.locator('#proj-tabs button[data-ptab="board"]').click();
  await at('project', `#/project/${enc}/board`);
  await expect(page.locator('#proj-board')).toBeVisible();
  await page.locator('#proj-tabs button[data-ptab="versions"]').click();
  await at('project', `#/project/${enc}/versions`);
  await expect(page.locator('#proj-versions')).toBeVisible();
  await page.locator('#proj-tabs button[data-ptab="docs"]').click();
  await at('project', `#/project/${enc}/docs`);
  await expect(page.locator('#proj-docs')).toBeVisible();

  await page.evaluate(() => selectTask('t-2'));
  await at('task', '#/task/t-2');
  await expect(page.locator('#task-title')).toHaveValue('Тесты');

  await nav(page, 'docs');
  await expect(page.locator('#doc-list .doc-item.active')).toBeVisible();
  const docHash = await hashOf(page);
  expect(docHash).toMatch(/^#\/doc\/d-[12]$/);
  await page.locator('#doc-list .doc-item', { hasText: 'План' }).click();
  await at('docs', '#/doc/d-2');
  await expect(page.locator('#doc-list .doc-item.active .doc-item-title')).toHaveText('План');
  expect(await page.evaluate(() => state.ui.docId)).toBe('d-2');

  await nav(page, 'time');
  await at('time', '#/stats/week');
  await page.locator('#time-modes button[data-mode="month"]').click();
  await at('time', '#/stats/month');
  await expect(page.locator('#time-modes button[data-mode="month"]')).toHaveClass(/on/);
  await page.locator('#time-modes button[data-mode="agenda"]').click();
  await at('time', '#/stats/agenda');
  await expect(page.locator('#time-modes button[data-mode="agenda"]')).toHaveClass(/on/);

  await nav(page, 'settings');
  await at('settings', '#/settings');

  await nav(page, 'home');
  await at('home', '#/today');
});

test('ссылка открывается в чистой вкладке: каждый вид, с вкладкой проекта и режимом', async ({ page }) => {
  const { pid } = await start(page);
  const enc = encodeURIComponent(pid);
  const open = async (hash) => {
    await page.goto('about:blank'); // хэш-переход на той же странице — не загрузка
    await page.goto(`/index.html${hash}`);
    await ready(page);
  };
  await open(`#/project/${enc}/board`);
  expect(await shown(page)).toEqual(['project']);
  await expect(page.locator('#proj-board')).toBeVisible();
  expect(await hashOf(page)).toBe(`#/project/${enc}/board`);

  await open(`#/project/${enc}`);
  await expect(page.locator('#proj-list')).toBeVisible();

  await open('#/task/t-1');
  expect(await shown(page)).toEqual(['task']);
  await expect(page.locator('#task-title')).toHaveValue('Верстка');

  await open('#/doc/d-2');
  expect(await shown(page)).toEqual(['docs']);
  await expect(page.locator('#doc-list .doc-item.active .doc-item-title')).toHaveText('План');

  await open('#/stats/day');
  expect(await shown(page)).toEqual(['time']);
  await expect(page.locator('#time-modes button[data-mode="day"]')).toHaveClass(/on/);

  await open('#/projects');
  expect(await shown(page)).toEqual(['projects']);
  await open('#/settings');
  expect(await shown(page)).toEqual(['settings']);
});

test('«назад» и «вперёд» ходят по экранам, а вкладка проекта и режим статистики историю не засоряют', async ({ page }) => {
  const { pid } = await start(page);
  const enc = encodeURIComponent(pid);

  await nav(page, 'projects');
  await page.evaluate((id) => openProject(id), pid);
  const before = await historyLength(page);
  // Вкладки проекта — замена записи, а не новая запись.
  await page.locator('#proj-tabs button[data-ptab="board"]').click();
  await page.locator('#proj-tabs button[data-ptab="versions"]').click();
  expect(await historyLength(page), 'вкладки проекта засорили историю').toBe(before);
  expect(await hashOf(page)).toBe(`#/project/${enc}/versions`);

  await page.evaluate(() => selectTask('t-1'));
  expect(await shown(page)).toEqual(['task']);

  await page.goBack();
  expect(await shown(page)).toEqual(['project']);
  expect(await hashOf(page), 'вернулись к проекту на его последней вкладке').toBe(`#/project/${enc}/versions`);
  await expect(page.locator('#proj-versions')).toBeVisible();

  await page.goBack();
  expect(await shown(page)).toEqual(['projects']);
  expect(await hashOf(page)).toBe('#/projects');

  await page.goBack();
  expect(await shown(page)).toEqual(['home']);
  expect(await hashOf(page)).toBe('#/today');

  await page.goForward();
  expect(await shown(page)).toEqual(['projects']);
  await page.goForward();
  expect(await shown(page)).toEqual(['project']);
  await page.goForward();
  expect(await shown(page)).toEqual(['task']);
  expect(await hashOf(page)).toBe('#/task/t-1');
  await expect(page.locator('#task-title')).toHaveValue('Верстка');

  // Режим статистики — тоже замена.
  await nav(page, 'time');
  const atStats = await historyLength(page);
  for (const mode of ['month', 'agenda', 'day']) await page.locator(`#time-modes button[data-mode="${mode}"]`).click();
  expect(await historyLength(page), 'режимы статистики засорили историю').toBe(atStats);
  expect(await hashOf(page)).toBe('#/stats/day');
  await page.goBack();
  expect(await shown(page), 'назад — на прошлый экран, а не на прошлый режим').toEqual(['task']);
});

test('правка адреса руками переводит на экран, и это одна запись истории', async ({ page }) => {
  const { pid } = await start(page);
  const before = await historyLength(page);
  await page.evaluate((h) => { location.hash = h; }, `#/project/${encodeURIComponent(pid)}/board`);
  await expect(page.locator('#proj-board')).toBeVisible();
  expect(await historyLength(page)).toBe(before + 1);
  await page.evaluate(() => { location.hash = '#/task/t-2'; });
  await expect(page.locator('#task-view')).toBeVisible();
  expect(await historyLength(page)).toBe(before + 2);
});

test('нет такой сущности или ссылка кривая — «Сегодня», и адрес заменён, а не дописан', async ({ page }) => {
  await start(page);
  const bad = [
    '#/project/нет-такого', '#/task/нет-такой', '#/doc/нет-такого', '#/project', '#/task',
    '#/unknown', '#/%E0%A4%A', '#абракадабра', '#/project/%',
  ];
  for (const hash of bad) {
    await page.evaluate(() => { location.hash = '#/settings'; }); // с чего-то не-«Сегодня»
    await expect(page.locator('#settings-view')).toBeVisible();
    const before = await historyLength(page);
    await page.evaluate((h) => { location.hash = h; }, hash);
    await expect(page.locator('#home-view'), `«${hash}» должен вести на «Сегодня»`).toBeVisible();
    expect(await hashOf(page), `адрес после «${hash}»`).toBe('#/today');
    expect(await historyLength(page), `«${hash}»: запись заменена, а не дописана вслед`).toBe(before + 1);
  }
});

test('кривая ссылка при загрузке: «Сегодня» и замена адреса — без ошибок и пустого экрана', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  for (const hash of ['#/project/нет-такого', '#/task/нет-такой', '#/doc/нет-такого', '#/всякое', '#/project/%E0%A4%A']) {
    await page.goto('about:blank');
    await page.goto(`/index.html${hash}`);
    await expect(page.locator('#home-view'), hash).toBeVisible();
    // Не ждёт потолка в 8 секунд: входа нет, синхронизацию ждать нечего.
    await expect.poll(() => hashOf(page), { message: hash, timeout: 3000 }).toBe('#/today');
    expect(await shown(page)).toEqual(['home']);
  }
  expect(errors).toEqual([]);
});

test('старое имя #/time — тот же экран, что #/stats, а адрес заменяется на новый', async ({ page, browser }) => {
  await start(page);
  await page.goto('about:blank');
  await page.goto('/index.html#/time/month');
  await expect(page.locator('#time-view')).toBeVisible();
  await expect(page.locator('#time-modes button[data-mode="month"]')).toHaveClass(/on/);
  expect(await hashOf(page)).toBe('#/stats/month');

  // Без режима в адресе остаётся прежний, и в адрес он дописывается.
  await page.evaluate(() => { location.hash = '#/time'; });
  await expect.poll(() => hashOf(page)).toBe('#/stats/month');
  await expect(page.locator('#time-view')).toBeVisible();
  await expect(page.locator('#time-modes button[data-mode="month"]')).toHaveClass(/on/);

  // Холодная загрузка по старой ссылке без режима: режим по умолчанию.
  const clean = await browser.newContext(); // своё хранилище: прежнего режима там нет
  const fresh = await clean.newPage();
  await fresh.goto(`${new URL(page.url()).origin}/index.html#/time`);
  await ready(fresh);
  expect(await hashOf(fresh)).toBe('#/stats/week');
  expect(await shown(fresh)).toEqual(['time']);
  await clean.close();
});

test('заголовок вкладки называет экран и сущность', async ({ page }) => {
  const { pid } = await start(page);
  await expect(page).toHaveTitle('Сегодня — Lancible');
  await nav(page, 'projects');
  await expect(page).toHaveTitle('Проекты — Lancible');
  await page.evaluate((id) => openProject(id), pid);
  await expect(page).toHaveTitle('Сайт — Lancible');
  await page.evaluate(() => selectTask('t-1'));
  await expect(page).toHaveTitle('Верстка — Lancible');
  await nav(page, 'docs');
  await page.locator('#doc-list .doc-item', { hasText: 'План' }).click();
  await expect(page).toHaveTitle('План — Lancible');
  await nav(page, 'settings');
  await expect(page).toHaveTitle('Настройки — Lancible');
  await nav(page, 'time');
  await expect(page).toHaveTitle('Статистика — Lancible');
});

test('экран «Статистика»: пункт меню и заголовок вкладки — на четырёх языках', async ({ page }) => {
  // До 11 октября экран назывался «Время» (uk — «Час», kk — «Уақыт»). Теперь
  // это статистика: адрес #/stats уже был, имя в меню приводится к нему.
  // «Время» в смысле длительности («Записи времени», колонка «Время») не
  // трогали — меряется только пункт рейла, мобильный таб и заголовок вкладки.
  await start(page);
  const names = { ru: 'Статистика', en: 'Stats', uk: 'Статистика', kk: 'Статистика' };
  for (const [lang, name] of Object.entries(names)) {
    await page.evaluate((l) => setLang(l), lang);
    await nav(page, 'time');
    await expect(page.locator('#navrail .nav-item[data-view="time"] .nav-label'), lang).toHaveText(name);
    await expect(page.locator('#mobile-tabbar .nav-item[data-view="time"]'), `${lang}: таб`).toContainText(name);
    await expect(page, `${lang}: заголовок вкладки`).toHaveTitle(`${name} — Lancible`);
  }
});

test('токены входа в хэше не затираются адресом экрана', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    history.replaceState(null, '', '#access_token=abc&refresh_token=def&type=recovery');
    openView('settings'); // render() → syncRoute()
  });
  expect(await hashOf(page)).toBe('#access_token=abc&refresh_token=def&type=recovery');
  expect(await shown(page)).toEqual(['settings']);
});

// --- «Скопировать ссылку» -----------------------------------------------------

/** Буфер подменён: что скопировали, лежит в window.__copied. */
const spyClipboard = (page) => page.evaluate(() => {
  window.__copied = [];
  window.api.copy = async (text) => { window.__copied.push(text); };
});
const copied = (page) => page.evaluate(() => window.__copied);

test('«Скопировать ссылку» в меню проекта кладёт ссылку, а она открывает проект в другой вкладке', async ({ page, context }) => {
  const { pid } = await start(page);
  await spyClipboard(page);
  await page.evaluate((id) => openProject(id), pid);
  await page.locator('#project-menu-btn').click();
  const item = page.locator('#ctx-menu .ctx-item', { hasText: 'Скопировать ссылку' });
  await expect(item.locator('svg.ctx-icon'), 'у пункта значок «link»').toHaveCount(1);
  await item.click();
  await expect(page.locator('#toast')).toHaveText('Ссылка скопирована');

  const origin = new URL(page.url()).origin;
  const [link] = await copied(page);
  expect(link).toBe(`${origin}/#/project/${encodeURIComponent(pid)}`);

  const other = await context.newPage();
  await other.goto(link);
  await ready(other);
  expect(await shown(other)).toEqual(['project']);
  await expect(other.locator('#ph-name')).toHaveText('Сайт');
});

test('«Скопировать ссылку» в меню задачи (правый щелчок) кладёт ссылку, она открывает задачу', async ({ page, context }) => {
  const { pid } = await start(page);
  await spyClipboard(page);
  await page.evaluate((id) => openProject(id), pid);
  await page.locator('.task-item[data-id="t-2"]').click({ button: 'right' });
  const item = page.locator('#ctx-menu .ctx-item', { hasText: 'Скопировать ссылку' });
  await expect(item.locator('svg.ctx-icon')).toHaveCount(1);
  await item.click();
  await expect(page.locator('#toast')).toHaveText('Ссылка скопирована');

  const origin = new URL(page.url()).origin;
  expect(await copied(page)).toEqual([`${origin}/#/task/t-2`]);

  const other = await context.newPage();
  await other.goto((await copied(page))[0]);
  expect(await shown(other)).toEqual(['task']);
  await expect(other.locator('#task-title')).toHaveValue('Тесты');
});

test('сломанный буфер — тост об ошибке, а не тишина и не исключение', async ({ page }) => {
  const { pid } = await start(page);
  await page.evaluate(() => { window.api.copy = async () => { throw new Error('denied'); }; });
  await page.evaluate((id) => openProject(id), pid);
  await page.locator('#project-menu-btn').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Скопировать ссылку' }).click();
  await expect(page.locator('#toast')).toHaveText('Не удалось скопировать');
});

test('ссылка на веб считается от страницы, на которой сидит человек: хэш чужой ссылки не тащится', async ({ page }) => {
  await start(page);
  const link = await page.evaluate(() => routeUrl({ view: 'project', id: 'p1' }));
  const url = new URL(page.url());
  expect(link).toBe(`${url.origin}/#/project/p1`);
  expect(link.match(/#/g)).toHaveLength(1);
});

// --- первая синхронизация -----------------------------------------------------

/** Вошедший пользователь и облако, которое отвечает не сразу. Подменяется
 *  клиент базы — ровно те методы, что зовёт приложение при запуске (так же,
 *  как в auth.spec.js): сессия, пользователь, профиль и чтение sync_state.
 *  delay — через сколько отвечает облако; null — не отвечает никогда. */
const signedInWithCloud = (page, { cloud, delay }) => page.addInitScript(({ cloud, delay }) => {
  let real;
  const patch = (client) => {
    const user = { id: 'u1', email: 'turan@example.com' };
    client.auth.getSession = async () => ({ data: { session: { user } } });
    client.auth.getUser = async () => ({ data: { user } });
    client.channel = () => ({ on() { return this; }, subscribe() { return this; } });
    client.removeChannel = () => {};
    client.from = (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'profiles') return { data: { name: 'Turan', terms_version: '2099-01-01', age_confirmed: true }, error: null };
            if (delay === null) return new Promise(() => {});
            await new Promise((resolve) => setTimeout(resolve, delay));
            return { data: { data: cloud, updated_at: new Date().toISOString() }, error: null };
          },
        }),
      }),
      upsert: async () => ({ error: null }),
    });
    return client;
  };
  // window.supabase собирает UMD-файл; createClient оборачивается, когда его
  // зовёт app.js.
  Object.defineProperty(window, 'supabase', {
    configurable: true,
    set(v) { real = v; },
    get() {
      return real && new Proxy(real, {
        get: (target, key) => (key === 'createClient' ? (...args) => patch(target.createClient(...args)) : target[key]),
      });
    },
  });
}, { cloud, delay });

const CLOUD = () => {
  const now = new Date().toISOString();
  return {
    projects: [{ id: 'cloud-p', name: 'Облачный проект', color: '#87ff65', description: '', pinnedAt: null, createdAt: now, tagIds: [] }],
    tasks: [{
      id: 'cloud-t', projectId: 'cloud-p', title: 'Облачная задача', done: false, notes: null, totalMs: 0, sessions: [],
      rate: null, pinnedAt: null, createdAt: now, updatedAt: now, statusId: null, tagIds: [], versionId: null, repeat: null,
      cancelled: false, dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
    }],
    statuses: [], tags: [], versions: [], documents: [],
  };
};

/** Новое устройство: вошли, локальных данных нет, облако отвечает через delay. */
async function newDevice(page, { delay, hash }) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await signedInWithCloud(page, { cloud: CLOUD(), delay });
  await page.goto('about:blank');
  await page.goto(`/index.html${hash}`);
}

test('новое устройство: ссылка на свой проект ждёт облако, а не улетает на «Сегодня» раньше', async ({ page }) => {
  await newDevice(page, { delay: 1500, hash: '#/project/cloud-p' });
  // Пока облако думает, адрес не тронут, и это заставка, а не «Сегодня».
  await page.waitForTimeout(500);
  expect(await hashOf(page), 'адрес стёрт раньше, чем пришло облако').toBe('#/project/cloud-p');
  await expect(page.locator('#app-skeleton')).toBeVisible();

  await expect(page.locator('#project-view')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#ph-name')).toHaveText('Облачный проект');
  expect(await hashOf(page)).toBe('#/project/cloud-p');
});

test('новое устройство: так же с задачей', async ({ page }) => {
  await newDevice(page, { delay: 1000, hash: '#/task/cloud-t' });
  await expect(page.locator('#task-view')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#task-title')).toHaveValue('Облачная задача');
  expect(await hashOf(page)).toBe('#/task/cloud-t');
});

test('вошёл, но в облаке этой сущности нет: «Сегодня» сразу после ответа облака, а не по потолку', async ({ page }) => {
  await newDevice(page, { delay: 800, hash: '#/project/чужой-id' });
  // «Сегодня» и без того стоит в разметке, поэтому ждём не его, а адрес.
  await expect.poll(() => hashOf(page), { timeout: 5000 }).toBe('#/today');
  await ready(page);
  expect(await shown(page)).toEqual(['home']);
});

test('облако молчит: через 8 секунд сдаёмся и открываем «Сегодня»', async ({ page }) => {
  await page.clock.install();
  await newDevice(page, { delay: null, hash: '#/project/cloud-p' });
  await page.clock.runFor(7000);
  expect(await hashOf(page), 'потолок ещё не вышел').toBe('#/project/cloud-p');
  await expect(page.locator('#app-skeleton')).toBeVisible();
  await page.clock.runFor(1500);
  await expect(page.locator('#home-view')).toBeVisible();
  expect(await hashOf(page)).toBe('#/today');
});

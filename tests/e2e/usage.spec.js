// Счётчик экранов на вебе (и десктопе — тот же app.js). Запуск: npm run test:e2e
//
// Откуда тест (23 октября 2026, админ-панель): «самые активные и неактивные
// страницы». Клиент при открытии экрана зовёт rpc track_screen(p_screen,
// p_platform) — только имя экрана и платформу (supabase/admin.sql). Шлёт
// только вошедший, принявший нынешнюю редакцию документов, с включённым
// выключателем «Статистика экранов» (Данные); гость — ничего (§2 Политики).
// Тот же экран — не чаще раза в 2 с, перерисовка на месте — не открытие.
// Отставшая вкладка и чужой сеанс в хранилище не шлют, ошибки — молча.
//
// Каждый «не шлёт» здесь кончается тем, что шлёт: иначе тест прошёл бы и на
// коде, где счётчика нет вовсе.
//
// Настоящий Supabase не трогаем: методы клиента подменяются в странице (как в
// accounts.spec.js), сеть к базе обрывается целиком. Время прибито
// (pinClock): «2 секунды» двигаются руками.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { ANCHOR, pinClock } = require('./clock');

const A = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'anna@example.com', name: 'Анна' };
const B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'boris@example.com', name: 'Борис' };
/** Имя экрана — как его пропускает check в supabase/admin.sql. */
const SCREEN_RE = /^[a-z][a-z0-9_.-]{0,39}$/;

/** Облако в странице: сеанс, профили (terms — принятая редакция), журнал
 *  rpc. Подмена живёт до перезагрузки. */
const fakeCloud = (page, terms) => page.evaluate(({ users, terms: tv }) => {
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const c = window.__cloud = { session: null, n: 0, rpc: [], profiles: {} };
  for (const u of users) c.profiles[u.id] = { name: u.name, terms_version: tv || Core.TERMS_VERSION, age_confirmed: true };
  c.issue = (u) => {
    c.n += 1;
    return { access_token: `at-${u.id}-${c.n}`, refresh_token: `rt-${u.id}-${c.n}`, user: { id: u.id, email: u.email } };
  };
  c.signAs = (id) => { c.session = c.issue(byId[id]); };
  sb.auth.getSession = async () => ({ data: { session: c.session }, error: null });
  sb.auth.getUser = async () => ({ data: { user: c.session ? c.session.user : null } });
  sb.auth.setSession = async () => ({ data: { session: c.session, user: c.session && c.session.user }, error: null });
  sb.auth.refreshSession = async () => ({ data: { session: c.session, user: c.session && c.session.user }, error: null });
  sb.rpc = async (name, args) => { c.rpc.push([name, args]); return { data: null, error: null }; };
  // Запрос — цепочка, как у supabase-js; ответ отдаёт await (then). Профиль
  // читается maybeSingle, согласие пишется update().eq().
  sb.from = (table) => {
    const q = {
      select() { return q; },
      update(row) { q.patch = row; return q; },
      eq(_k, v) { q.v = v; return q; },
      gt() { return q; },
      order() { return q; },
      limit() { return q; },
      async maybeSingle() {
        if (table === 'profiles') return { data: c.profiles[q.v] ? { ...c.profiles[q.v] } : null, error: null };
        return { data: null, error: null };
      },
      upsert(row) { q.rows = Array.isArray(row) ? row : null; return q; },
      insert() { return q; },
      then(resolve, reject) {
        if (table === 'profiles' && q.patch && c.profiles[q.v]) Object.assign(c.profiles[q.v], q.patch);
        const data = table === 'changes' && q.rows ? q.rows.map((r, i) => ({ ...r, seq: i + 1, created_at: new Date().toISOString() })) : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  sb.channel = () => ({ on() { return this; }, subscribe() { return this; } });
  sb.removeChannel = () => {};
}, { users: [A, B], terms });

/** Что ушло счётчиком: [[экран, платформа]]. */
const tracked = (page) => page.evaluate(() => window.__cloud.rpc
  .filter(([name]) => name === 'track_screen')
  .map(([, a]) => [a.p_screen, a.p_platform]));
const screens = async (page) => (await tracked(page)).map(([s]) => s);

async function start(page, terms) {
  await page.route('**/yiglgfkjjvwijukdzutw.supabase.co/**', (route) => route.abort());
  await pinClock(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#app-skeleton')).toHaveCount(0);
  await fakeCloud(page, terms);
}

/** Вход A тем же путём, что пароль и Google: afterSignedIn. */
async function signIn(page) {
  await page.evaluate((id) => { window.__cloud.signAs(id); afterSignedIn({ silent: true }); }, A.id);
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
}

/** Проект, задача и документ в открытой области. */
const seed = (page) => page.evaluate(() => {
  state.projects.push({ id: 'p1', name: 'Сайт' });
  state.tasks.push({ id: 't1', projectId: 'p1', title: 'Вёрстка' });
  state.documents.push(Core.newDocument({ id: 'd1', title: 'Бриф' }));
  migrate();
  render();
});

/** Сдвинуть прибитые часы на ms от ANCHOR. */
const clockAt = (page, ms) => page.clock.setFixedTime(new Date(new Date(ANCHOR).getTime() + ms));

test('переходы: каждый экран — своим именем и с платформой web', async ({ page }) => {
  await start(page);
  await signIn(page);
  await seed(page);
  await expect.poll(() => tracked(page)).toEqual([['today', 'web']]);

  await page.locator('#navrail .nav-item[data-view="projects"]').click();
  await page.evaluate(() => openProject('p1'));
  await page.evaluate(() => openRoute({ view: 'project', id: 'p1', tab: 'board' }, true));
  await page.evaluate(() => selectTask('t1'));
  await page.evaluate(() => openDocs('d1'));
  await page.locator('#navrail .nav-item[data-view="time"]').click();
  await page.evaluate(() => setTimeMode('month'));
  await page.locator('#navrail .nav-item[data-view="settings"]').click();
  await page.locator('#settings-sec-data').click();
  // Панели поверх экрана — свои имена.
  await page.locator('#search-input').focus();
  await page.locator('#search-input').fill('сай'); // набор в открытом поиске — не новое открытие
  await page.keyboard.press('Escape');
  await page.evaluate(() => { closeSearch(); toggleNotifPanel(); });
  await page.evaluate(() => { closeNotifPanel(); openAiPanel(); });

  const want = ['today', 'projects', 'project', 'project.board', 'task', 'doc', 'stats.week', 'stats.month',
    'settings', 'settings.data', 'search', 'notifications', 'agent'];
  await expect.poll(() => screens(page)).toEqual(want);
  expect(new Set((await tracked(page)).map(([, p]) => p))).toEqual(new Set(['web']));
  // Закрытая панель не открывает заново экран под ней.
  await page.evaluate(() => closeAiPanel());
  await page.waitForTimeout(300);
  expect(await screens(page)).toEqual(want);
});

test('перерисовка на месте не шлёт, тот же экран — не чаще раза в 2 с', async ({ page }) => {
  await start(page);
  await signIn(page);
  await seed(page);
  await page.evaluate(() => openView('projects'));
  await expect.poll(() => screens(page)).toEqual(['today', 'projects']);

  // Таймер, синхронизация, правка — перерисовки того же экрана.
  await page.evaluate(() => { for (let i = 0; i < 5; i += 1) render(); renderSettings(); syncRoute(); });
  await page.evaluate(() => { startTimer('t1'); });
  await page.waitForTimeout(1200);
  expect(await screens(page)).toEqual(['today', 'projects']);

  // Туда и обратно в пределах 2 с — ни «Сегодня», ни «Проекты» второй раз.
  await page.evaluate(() => { openView('home'); openView('projects'); });
  await page.evaluate(() => { openSearch(); closeSearch(); openSearch(); closeSearch(); });
  await page.waitForTimeout(300);
  expect(await screens(page)).toEqual(['today', 'projects', 'search']);

  // Через 2 с тот же экран — снова открытие.
  await clockAt(page, 2500);
  await page.evaluate(() => { openView('home'); openSearch(); });
  await expect.poll(() => screens(page)).toEqual(['today', 'projects', 'search', 'today', 'search']);
});

test('гость не шлёт ничего, выключателя у него нет; вошёл — шлёт', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    openView('projects');
    openSettings('data');
    openSearch();
    closeSearch();
    toggleNotifPanel();
    closeNotifPanel();
  });
  await expect(page.locator('#settings-page-data')).toBeVisible();
  await expect(page.locator('#settings-usage')).toBeHidden();
  await expect(page.locator('#settings-usage-hint')).toBeHidden();
  await page.waitForTimeout(300);
  expect(await screens(page)).toEqual([]);

  // Тот же человек вошёл — первым уходит экран, на котором он вошёл.
  await signIn(page);
  await expect.poll(() => screens(page)).toEqual(['settings.data']);
  await expect(page.locator('#settings-usage')).toBeVisible();
});

test('без согласия с нынешней редакцией не шлёт; принял — шлёт', async ({ page }) => {
  await start(page, '2026-01-01');
  await page.evaluate((id) => { window.__cloud.signAs(id); afterSignedIn({ silent: true }); }, A.id);
  await expect(page.locator('#auth-step-onboarding')).toBeVisible();
  await expect(page.locator('#auth-consent-sub')).toBeVisible();
  await page.evaluate(() => { openView('projects'); openSearch(); closeSearch(); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => currentUser)).toBeNull();
  expect(await screens(page)).toEqual([]);

  await page.locator('#auth-consent-check').click();
  await page.locator('#auth-onboarding-save').click();
  await expect.poll(() => page.evaluate(() => currentUser && currentUser.id)).toBe(A.id);
  expect(await page.evaluate((id) => window.__cloud.profiles[id].terms_version, A.id)).toBe(await page.evaluate(() => Core.TERMS_VERSION));
  await expect.poll(() => screens(page)).toEqual(['projects']);
});

test('выключатель «Статистика экранов»: четыре языка, снятый не шлёт и сохраняется', async ({ page }) => {
  await start(page);
  await signIn(page);
  await page.evaluate(() => openSettings('data'));
  const row = page.locator('#settings-usage-toggle');
  const hint = page.locator('#settings-usage-hint');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-pressed', 'true'); // по умолчанию включён
  const TEXT = {
    ru: ['Статистика экранов', 'Отправлять, какие экраны вы открываете, — без содержимого заметок и задач. Так мы видим, чем пользуются.'],
    en: ['Screen statistics', 'Send which screens you open — without the contents of notes or tasks. It shows us what people use.'],
    uk: ['Статистика екранів', 'Надсилати, які екрани ви відкриваєте, — без вмісту нотаток і завдань. Так ми бачимо, чим користуються.'],
    kk: ['Экрандар статистикасы', 'Қай экрандарды ашатыныңызды жіберу — жазбалар мен тапсырмалардың мазмұнынсыз. Осылайша немен пайдаланатынын көреміз.'],
  };
  for (const lang of ['ru', 'en', 'uk', 'kk']) {
    await page.evaluate((l) => setLang(l), lang);
    await expect(row.locator('.srow-label')).toHaveText(TEXT[lang][0]);
    await expect(hint).toHaveText(TEXT[lang][1]);
  }
  await page.evaluate(() => setLang('ru'));
  await expect.poll(() => screens(page)).toEqual(['today', 'settings.data']);

  // Сняли — экраны и панели не уходят; настройка легла в данные аккаунта.
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { openView('projects'); openSearch(); closeSearch(); openAiPanel(); closeAiPanel(); openView('time'); });
  await expect.poll(() => page.evaluate((id) => {
    const d = JSON.parse(localStorage.getItem(`lancible:data:${id}`) || 'null');
    return d && d.settings && d.settings.usageStats;
  }, A.id)).toBe(false);
  expect(await screens(page)).toEqual(['today', 'settings.data']);

  // Загрузили сохранённое заново — выключатель снят и после этого.
  await page.evaluate(async () => {
    state = await window.api.load();
    migrate();
    openSettings('data');
  });
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  expect(await screens(page)).toEqual(['today', 'settings.data']);

  // Включили — снова шлёт.
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => openView('projects'));
  await expect.poll(() => screens(page)).toEqual(['today', 'settings.data', 'projects']);
});

test('отставшая вкладка и чужой сеанс не шлют, ошибки базы — молча', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await start(page);
  await signIn(page);
  await expect.poll(() => screens(page)).toEqual(['today']);

  // Другая вкладка открыла другой аккаунт (onAccountsElsewhere): эта молчит.
  await page.evaluate(() => { scopeStale = true; openView('projects'); });
  await page.waitForTimeout(300);
  expect(await screens(page)).toEqual(['today']);
  await page.evaluate(() => { scopeStale = false; openView('docs'); });
  await expect.poll(() => screens(page)).toEqual(['today', 'docs']);

  // Сеанс в хранилище — уже чужой (вход в другой вкладке без события о
  // списке): просмотр не уходит, и тоста «Обновить» счётчик не поднимает.
  await page.evaluate((id) => { window.__cloud.signAs(id); openSettings(null); }, B.id);
  await page.waitForTimeout(300);
  expect(await screens(page)).toEqual(['today', 'docs']);
  await expect(page.locator('#toast')).toBeHidden();
  await page.evaluate((id) => { window.__cloud.signAs(id); openSettings('main'); }, A.id);
  await expect.poll(() => screens(page)).toEqual(['today', 'docs', 'settings.main']);

  // База отказала или сети нет — ни ошибки, ни тоста; следующий экран уходит.
  await page.evaluate(() => {
    window.__rpcOk = sb.rpc;
    sb.rpc = async (name, args) => { window.__cloud.rpc.push(['failed', args]); throw new TypeError('Failed to fetch'); };
    openView('time');
  });
  await page.evaluate(() => {
    sb.rpc = async (name, args) => { window.__cloud.rpc.push(['failed', args]); return { data: null, error: { code: 'PGRST202', message: 'no function' } }; };
    openSettings('about');
  });
  await expect.poll(() => page.evaluate(() => window.__cloud.rpc.filter(([n]) => n === 'failed').length)).toBe(2);
  await page.evaluate(() => { sb.rpc = window.__rpcOk; openSettings('work'); });
  await expect.poll(() => screens(page)).toEqual(['today', 'docs', 'settings.main', 'settings.work']);
  await expect(page.locator('#toast')).toBeHidden();
  expect(errors).toEqual([]);
});

test('список экранов в DESIGN.md — тот же, что в коде, и каждый пройдёт check базы', async ({ page }) => {
  await start(page);
  const code = await page.evaluate(() => USAGE_SCREENS);
  const design = fs.readFileSync(path.join(__dirname, '..', '..', 'DESIGN.md'), 'utf8');
  // Пункт «Экраны веба и десктопа (`USAGE_SCREENS`): …» — до следующего
  // пункта или пустой строки.
  const item = design.match(/Экраны веба и десктопа \(`USAGE_SCREENS`\):([\s\S]*?)(?:\r?\n- |\r?\n\r?\n)/);
  expect(item, 'в DESIGN.md нет пункта со списком экранов').toBeTruthy();
  const listed = [...item[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  expect(listed).toEqual(code);
  expect(new Set(code).size, 'имена не повторяются').toBe(code.length);
  for (const s of code) expect(s, s).toMatch(SCREEN_RE);
});

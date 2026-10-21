// ИИ-агент по приглашению на вебе и десктопе (21 октября 2026). Запуск:
// npm run test:e2e -- ai-access
//
// Откуда тест: «ограничить доступ к ИИ-агенту, только аккаунтам, которым я
// дам такой доступ». Доступ — строка с почтой в public.ai_access; клиент
// узнаёт его RPC ai_has_access() при открытии агента (и после входа), а
// функция ai-chat без доступа отвечает 403 no access. Без доступа вместо
// главного экрана, чата и чатов — «закрытый тест»: сценка, слова, строка о
// почте и «Запросить доступ» — строка feedback с почтой аккаунта тем же
// путём, что обычная обратная связь. Пока ответа о доступе нет — скелет, а не
// поле, которое мигнуло бы и пропало. Чаты на устройстве не стираются;
// поиск их не находит, пока доступа нет.
//
// RPC, функция и таблица feedback подменяются сетью (tests/e2e/ai-helpers.js):
// что ушло — то и проверяется.
const { test, expect } = require('@playwright/test');
const { stream, fn, access, open, signIn, panel, input, openChat, savedChat, send } = require('./ai-helpers');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_TEXT = 'Запрос доступа к ИИ-агенту: test@example.com';
const RU = {
  title: 'ИИ-агент в закрытом тесте',
  text: 'Доступ открываем по приглашению. Оставьте запрос — напишем, когда откроем.',
  note: 'Вместе с запросом уйдёт почта вашего аккаунта — по ней мы выдадим доступ.',
  request: 'Запросить доступ',
  sent: 'Запрос отправлен',
};

const locked = (page) => page.locator('#ai-locked');
const requestBtn = (page) => page.locator('#ai-request');

/** Два сохранённых чата аккаунта u1 — как в ai-chats.spec.js. */
const seedChats = (page) => page.evaluate(() => {
  const at = (iso) => new Date(iso).toISOString();
  localStorage.setItem('lancible:ai:u1:chats', JSON.stringify([
    { id: 'c1', title: 'План недели', createdAt: at('2026-06-10T09:30:00'), updatedAt: at('2026-06-10T09:30:00'), preview: 'Разложил по окнам', count: 2 },
    { id: 'c2', title: 'Отчёт по сайту', createdAt: at('2026-06-09T18:00:00'), updatedAt: at('2026-06-09T18:00:00'), preview: 'На сайт — 12 ч', count: 2 },
  ]));
  localStorage.setItem('lancible:ai:u1:chat:c1', JSON.stringify({ title: 'План недели', messages: [], items: [{ kind: 'msg', role: 'user', text: 'Распланируй неделю' }, { kind: 'msg', role: 'assistant', text: 'Разложил по окнам' }] }));
  localStorage.setItem('lancible:ai:u1:chat:c2', JSON.stringify({ title: 'Отчёт по сайту', messages: [], items: [{ kind: 'msg', role: 'user', text: 'Сколько ушло на сайт?' }, { kind: 'msg', role: 'assistant', text: 'На сайт — 12 ч' }] }));
});

/** Таблица feedback: answer — 'ok' | 'offline' | 'fail' | 'rate' (отказ базы
 *  по частоте, как его отдаёт PostgREST), меняется на ходу. */
async function feedbackTable(page) {
  const net = { answer: 'ok', rows: [] };
  await page.route('**/rest/v1/feedback**', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fulfill({ status: 405, body: '' });
    const raw = req.postDataJSON();
    net.rows.push(Array.isArray(raw) ? raw[0] : raw);
    if (net.answer === 'offline') return route.abort('internetdisconnected');
    if (net.answer === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
    if (net.answer === 'rate') {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'feedback rate', details: null, hint: null }) });
    }
    return route.fulfill({ status: 201, body: '' });
  });
  return net;
}

/** Открыть агента кнопкой (на узком вебе — в нижней плашке). */
const openPanel = (page) => page.locator(page.viewportSize().width <= 560 ? '#mobile-ai-btn' : '#ai-btn').click();

test('нет доступа — «закрытый тест» вместо главного экрана: сценка, слова, строка о почте; поля и чатов нет, ai-chat не зовётся; гость — как раньше', async ({ page }) => {
  await open(page);
  await seedChats(page);
  const calls = await fn(page, [stream({ text: ['Привет!'] })]);
  // Гость: вход, как раньше, и про доступ никто не спрашивает.
  const guest = await access(page, true);
  await openPanel(page);
  await expect(page.locator('#ai-signin')).toBeVisible();
  await expect(locked(page)).toBeHidden();
  await expect(page.locator('#ai-wait')).toBeHidden();
  expect(guest, 'гостя про доступ не спрашивают').toHaveLength(0);
  await page.locator('#ai-close').click();

  const asked = await signIn(page, { access: false });
  expect(asked.length, 'вход с чатами на устройстве — доступ спрошен сразу').toBeGreaterThanOrEqual(1);
  expect(asked[0].authorization, 'спрашивает сеанс вошедшего').toBe('Bearer test-token');
  await openPanel(page);
  await expect(locked(page)).toBeVisible();
  await expect(page.locator('#ai-signin')).toBeHidden();
  await expect(locked(page).locator('.empty-state-title')).toHaveText(RU.title);
  await expect(locked(page).locator('.empty-state-text')).toHaveText(RU.text);
  await expect(locked(page).locator('.ai-locked-note')).toHaveText(RU.note);
  await expect(requestBtn(page)).toHaveText(RU.request);
  await expect(requestBtn(page)).toBeEnabled();
  // Сценка «chat» из ядра — та же, что у главного экрана и входа.
  expect(await page.locator('#ai-locked svg[data-art="chat"] > *').count()).toBeGreaterThan(5);
  // Порядок: сценка, заголовок, текст, строка о почте, кнопка.
  expect(await locked(page).evaluate((n) => [...n.children].filter((c) => !c.hidden).map((c) => c.id || c.getAttribute('class')))).toEqual([
    'es-art', 'empty-state-title', 'empty-state-text', 'ai-locked-note', 'ai-request',
  ]);
  // Готовые детали: общий пустой экран и акцентная кнопка.
  expect(await page.evaluate(() => [document.getElementById('ai-locked').className, document.getElementById('ai-request').className]))
    .toEqual(['ai-locked empty-state empty-state-sm', 'btn-accent']);

  // Поля, фразы, списка чатов и счётчика нет; голова — главного экрана.
  await expect(page.locator('#ai-body')).toBeHidden();
  await expect(input(page)).toBeHidden();
  await expect(page.locator('#ai-hello')).toBeHidden();
  await expect(page.locator('#ai-list')).toBeHidden();
  await expect(page.locator('.ai-row:visible')).toHaveCount(0);
  await expect(page.locator('#ai-quota')).toBeHidden();
  await expect(page.locator('#ai-back')).toBeHidden();
  await expect(page.locator('#ai-more')).toBeHidden();
  await expect(page.locator('#ai-title')).toHaveText('Агент');

  // Экран — по центру панели.
  const g = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { panel: r('ai-panel'), box: r('ai-locked'), head: document.querySelector('.ai-head').getBoundingClientRect() };
  });
  expect(Math.abs((g.box.left + g.box.right) / 2 - (g.panel.left + g.panel.right) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs((g.box.top + g.box.bottom) / 2 - (g.head.bottom + g.panel.bottom) / 2)).toBeLessThanOrEqual(1);

  // Отправка в обход поля — тоже нет: ai-chat не зовётся, чат не заводится.
  await page.evaluate(() => { aiSend('Привет'); aiOpenChat('c1'); });
  await page.waitForTimeout(200);
  expect(calls, 'вызовов ai-chat нет').toHaveLength(0);
  await expect(locked(page), 'чат без доступа не открывается').toBeVisible();
  await expect(page.locator('#ai-log')).toBeHidden();
  // Чаты на устройстве не стёрты.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lancible:ai:u1:chats')).map((c) => c.id))).toEqual(['c1', 'c2']);
});

test('доступ спрашивается при каждом открытии: выдали — агент как раньше и чаты на месте; забрали — «закрытый тест»', async ({ page }) => {
  await open(page);
  await seedChats(page);
  await signIn(page, { access: false });
  await openPanel(page);
  await expect(locked(page)).toBeVisible();
  await page.locator('#ai-close').click();

  // Владелец выдал доступ: следующее открытие — главный экран с чатами.
  const yes = await access(page, true);
  await openPanel(page);
  await expect(page.locator('#ai-hello')).toBeVisible();
  await expect(input(page)).toBeVisible();
  await expect(locked(page)).toBeHidden();
  await expect(page.locator('.ai-row-title')).toHaveText(['План недели', 'Отчёт по сайту']);
  expect(yes).toHaveLength(1);

  // Открыт чат — и доступ забрали: на месте чата «закрытый тест».
  await page.locator('.ai-row-open').first().click();
  await expect(page.locator('#ai-log')).toBeVisible();
  await access(page, false);
  await page.evaluate(() => aiCheckAccess());
  await expect(locked(page)).toBeVisible();
  await expect(page.locator('#ai-log')).toBeHidden();
  await expect(input(page)).toBeHidden();
  await expect(page.locator('#ai-back')).toBeHidden();
  await expect(page.locator('#ai-title')).toHaveText('Агент');
  // Тот же чат из поиска (или по старой ссылке) — тот же экран.
  await page.evaluate(() => aiShowChat('c1'));
  await expect(locked(page)).toBeVisible();
  await expect(page.locator('#ai-log')).toBeHidden();
});

test('ответа о доступе ещё нет — скелет, а не поле; прежний ответ этого аккаунта — сразу, без скелета', async ({ page }) => {
  await open(page);
  let release;
  const held = new Promise((r) => { release = r; });
  const asked = await signIn(page, { access: () => held, wait: false });
  await openPanel(page);
  await expect(page.locator('#ai-wait')).toBeVisible();
  expect(await page.locator('#ai-wait .skel').count(), 'сценка, фраза и поле — плашками скелета').toBe(3);
  await expect(input(page), 'поля, которое могло бы мигнуть, нет').toBeHidden();
  await expect(locked(page)).toBeHidden();
  await expect(page.locator('#ai-signin')).toBeHidden();
  expect(asked).toHaveLength(1);
  release(true);
  await expect(input(page)).toBeVisible();
  await expect(page.locator('#ai-wait')).toBeHidden();
  await expect(input(page), 'ответ пришёл — фокус в поле').toBeFocused();
  await page.locator('#ai-close').click();

  // Второе открытие: вопрос снова уходит и снова держится, а экран — уже
  // прежнего ответа, без скелета.
  let release2;
  const held2 = new Promise((r) => { release2 = r; });
  const again = await access(page, () => held2);
  await openPanel(page);
  const first = await page.evaluate(() => ({ wait: !document.getElementById('ai-wait').hidden, input: !document.getElementById('ai-body').hidden }));
  expect(first, 'сразу — прежнее состояние').toEqual({ wait: false, input: true });
  await expect.poll(() => again.length).toBe(1);
  // Ответ другой (доступ забрали) — экран меняется.
  release2(false);
  await expect(locked(page)).toBeVisible();
  await expect(input(page)).toBeHidden();
});

test('«Запросить доступ» — одна строка feedback с почтой аккаунта; «Запрос отправлен» и после перезагрузки; у другого аккаунта — своё', async ({ page }) => {
  const net = await feedbackTable(page);
  await open(page, { signedIn: true, access: false });
  await openPanel(page);
  await requestBtn(page).click();
  await expect(requestBtn(page)).toHaveText(RU.sent);
  await expect(requestBtn(page)).toBeDisabled();
  await expect(page.locator('#ai-request-error')).toBeHidden();
  expect(net.rows).toHaveLength(1);
  const row = net.rows[0];
  expect(Object.keys(row).sort()).toEqual(['app_version', 'device', 'id', 'kind', 'lang', 'platform', 'screenshot_path', 'text', 'user_id']);
  expect(row).toMatchObject({ kind: 'other', text: REQUEST_TEXT, user_id: 'u1', platform: 'web', lang: 'ru', screenshot_path: null });
  expect(row.id).toMatch(UUID);
  // Неактивная кнопка второй строки не шлёт.
  await page.evaluate(() => aiRequestAccess());
  await page.waitForTimeout(200);
  expect(net.rows).toHaveLength(1);
  // Форма обратной связи не тронута: её вид и запись — свои.
  expect(await page.evaluate(() => ({ kind: fb.kind, id: fb.id }))).toEqual({ kind: 'bug', id: null });

  // После перезагрузки (запуск заново, доступ спрашивается снова) — то же.
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await signIn(page, { access: false });
  await openPanel(page);
  await expect(locked(page)).toBeVisible();
  await expect(requestBtn(page)).toHaveText(RU.sent);
  await expect(requestBtn(page)).toBeDisabled();
  expect(net.rows).toHaveLength(1);

  // Другой аккаунт на этом устройстве — его запрос ещё не уходил.
  await page.evaluate(() => { currentUser = { id: 'u2', email: 'other@example.com', name: null }; renderAccountBtn(); });
  await expect(locked(page)).toBeVisible();
  await expect(requestBtn(page)).toHaveText(RU.request);
  await expect(requestBtn(page)).toBeEnabled();
  await requestBtn(page).click();
  await expect(requestBtn(page)).toHaveText(RU.sent);
  expect(net.rows).toHaveLength(2);
  expect(net.rows[1]).toMatchObject({ kind: 'other', text: 'Запрос доступа к ИИ-агенту: other@example.com', user_id: 'u2' });
});

test('отказ по частоте — feedback.rate с «Повторить»; нет сети — общая строка; повтор — та же запись', async ({ page }) => {
  const net = await feedbackTable(page);
  await open(page, { signedIn: true, access: false });
  await openPanel(page);
  net.answer = 'rate';
  await requestBtn(page).click();
  const err = page.locator('#ai-request-error');
  await expect(err).toBeVisible();
  await expect(page.locator('#ai-request-error-text')).toHaveText('Слишком много сообщений подряд. Попробуйте через несколько минут.');
  await expect(err.locator('#ai-request-retry')).toHaveText('Повторить');
  await expect(requestBtn(page), 'не отправлено — кнопка снова доступна').toBeEnabled();
  await expect(requestBtn(page)).toHaveText(RU.request);
  expect(await page.evaluate(() => localStorage.getItem('lancible:ai:u1:access-requested'))).toBeNull();
  // Цвет ошибки — токен темы, как у строки ошибки в ленте.
  expect(await err.evaluate((n) => getComputedStyle(n).color)).toBe(await page.evaluate(() => {
    const p = document.createElement('p');
    p.style.color = 'var(--danger)';
    document.body.append(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }));

  net.answer = 'offline';
  await page.locator('#ai-request-retry').click();
  await expect(page.locator('#ai-request-error-text')).toHaveText('Запрос не отправился — проверьте интернет и попробуйте ещё раз.');

  net.answer = 'ok';
  await page.locator('#ai-request-retry').click();
  await expect(requestBtn(page)).toHaveText(RU.sent);
  await expect(err).toBeHidden();
  expect(net.rows).toHaveLength(3);
  expect(new Set(net.rows.map((r) => r.id)).size, 'повтор — та же запись, а не новая').toBe(1);
});

test('403 no access посреди чата — «закрытый тест»; сообщение и чат остаются на устройстве', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [stream({ text: ['Привет!'] }), { status: 403, json: { error: 'no access' } }]);
  await openChat(page);
  await send(page, 'Привет');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Привет!');
  await send(page, 'Распланируй неделю');
  await expect(locked(page)).toBeVisible();
  await expect(input(page)).toBeHidden();
  await expect(page.locator('#ai-log')).toBeHidden();
  await expect(page.locator('.ai-error:visible'), 'не ошибка сети, а закрытый тест').toHaveCount(0);
  expect(calls).toHaveLength(2);
  const saved = await savedChat(page);
  expect(saved.items.filter((it) => it.kind === 'msg').map((it) => it.text)).toEqual(['Привет', 'Привет!', 'Распланируй неделю']);
  // Повтор в обход экрана тоже не зовёт функцию.
  await page.evaluate(() => { aiRetry(); aiSend('Ещё'); });
  await page.waitForTimeout(200);
  expect(calls).toHaveLength(2);
  // Поиск этот чат больше не находит.
  await page.locator('#search-input').fill('неделю');
  await expect(page.locator('#search-results')).toBeVisible();
  await expect(page.locator('#search-results .sr-group', { hasText: 'Чаты' })).toHaveCount(0);
});

test('поиск не находит чаты, пока доступа нет; ответ о доступе ещё в пути — найдёт, когда придёт', async ({ page }) => {
  await open(page);
  await seedChats(page);
  await signIn(page, { access: false });
  const search = page.locator('#search-input');
  await search.fill('окнам');
  await expect(page.locator('#search-results')).toBeVisible();
  await expect(page.locator('#search-results .sr-group', { hasText: 'Чаты' })).toHaveCount(0);
  await search.fill('отчёт');
  await expect(page.locator('#search-results [data-chat-id]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Запуск заново, доступ есть, но ответ задерживается: поиск сначала
  // пустой, а с ответом — с чатами (перерисовывается сам).
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  let release;
  const held = new Promise((r) => { release = r; });
  await signIn(page, { access: () => held, wait: false });
  await search.fill('окнам');
  await expect(page.locator('#search-results')).toBeVisible();
  await expect(page.locator('#search-results .sr-group', { hasText: 'Чаты' })).toHaveCount(0);
  release(true);
  await expect(page.locator('#search-results .sr-group', { hasText: 'Чаты' })).toHaveText('Чаты · 1');
  await page.locator('#search-results .sr-item[data-chat-id="c1"]').click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#ai-title')).toHaveText('План недели');
});

test('узкий веб (375): тот же «закрытый тест» во всю ширину чата, без прокрутки вбок', async ({ page }) => {
  await open(page, { width: 375, height: 760, signedIn: true, access: false });
  await openPanel(page);
  await expect(locked(page)).toBeVisible();
  await expect(input(page)).toBeHidden();
  const g = await page.evaluate(() => {
    const r = (n) => n.getBoundingClientRect();
    const doc = document.documentElement;
    return {
      panel: r(document.getElementById('ai-panel')),
      box: r(document.getElementById('ai-locked')),
      btn: r(document.getElementById('ai-request')),
      vw: doc.clientWidth,
      scroll: doc.scrollWidth > doc.clientWidth,
    };
  });
  expect(g.scroll).toBe(false);
  expect(g.panel.left).toBe(0);
  expect(Math.abs(g.panel.width - g.vw), 'чат — во всю ширину').toBeLessThanOrEqual(1);
  expect(g.box.left).toBeGreaterThanOrEqual(16);
  expect(g.box.right).toBeLessThanOrEqual(g.vw - 16);
  expect(g.btn.right).toBeLessThanOrEqual(g.vw);
  expect(Math.abs((g.box.left + g.box.right) / 2 - g.vw / 2)).toBeLessThanOrEqual(1);
});

test('строки «закрытого теста» — на четырёх языках', async ({ page }) => {
  const net = await feedbackTable(page);
  await open(page, { signedIn: true, access: false });
  await openPanel(page);
  await expect(locked(page)).toBeVisible();
  const read = () => page.evaluate(() => ({
    title: document.querySelector('#ai-locked .empty-state-title').textContent,
    text: document.querySelector('#ai-locked .empty-state-text').textContent,
    note: document.querySelector('#ai-locked .ai-locked-note').textContent,
    request: document.getElementById('ai-request').textContent,
  }));
  expect(await read()).toEqual({ title: RU.title, text: RU.text, note: RU.note, request: RU.request });
  const want = {
    en: { title: 'The AI agent is in closed testing', request: 'Request access', sent: 'Request sent' },
    uk: { title: 'ШІ-агент у закритому тесті', request: 'Запросити доступ', sent: 'Запит надіслано' },
    kk: { title: 'ЖИ-агент жабық тестте', request: 'Қолжетімділік сұрау', sent: 'Сұрау жіберілді' },
  };
  for (const l of ['en', 'uk', 'kk']) {
    await page.evaluate((code) => setLang(code), l);
    const got = await read();
    expect(got.title, l).toBe(want[l].title);
    expect(got.request, l).toBe(want[l].request);
    // Ни одной русской строки посреди чужого языка, и все — из словаря.
    const dict = await page.evaluate(() => ['ai.locked_title', 'ai.locked_text', 'ai.locked_note', 'ai.request_access'].map((k) => t(k)));
    expect([got.title, got.text, got.note, got.request], l).toEqual(dict);
    for (const s of [got.text, got.note]) expect(Object.values(RU), `${l}: «${s}»`).not.toContain(s);
  }
  // «Запрос отправлен» — на языке интерфейса (казахский — последний).
  await requestBtn(page).click();
  await expect(requestBtn(page)).toHaveText(want.kk.sent);
  for (const l of ['ru', 'en', 'uk']) {
    await page.evaluate((code) => setLang(code), l);
    await expect(requestBtn(page)).toHaveText(l === 'ru' ? RU.sent : want[l].sent);
  }
  // Текст запроса владельцу — всегда один, с почтой, на каком бы языке ни был интерфейс.
  expect(net.rows.map((r) => r.text)).toEqual([REQUEST_TEXT]);
});

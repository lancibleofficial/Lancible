// Чат агента на вебе. Круг 20 (18 октября 2026): список чатов, хранение по
// чатам и перенос прежней одиночной истории, удаление чата, пересечения в
// карточке. Круг 21 (19 октября 2026): чат — в острове рейла (кнопка первой
// в рейле, остров раскрывается вправо), главный экран — сценка и фраза
// (Core.aiGreeting), поле посередине, чаты под ним; с поля — в новый чат без
// въезда, поле съезжает вниз; из списка — прежний въезд.
// Запуск: npm run test:e2e -- ai-chats
//
// Подмена функции ai-chat, вход и открытие чата — tests/e2e/ai-helpers.js.
const { test, expect } = require('@playwright/test');
const { stream, fn, open, signIn, panel, input, openChat, send } = require('./ai-helpers');

const INDEX = 'lancible:ai:u1:chats';
const chatKey = (id) => `lancible:ai:u1:chat:${id}`;
const index = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), INDEX);
const rows = (page) => page.locator('#ai-chats .ai-row');

/** Два сохранённых чата текущего аккаунта (u1). */
const seedChats = (page) => page.evaluate((k) => {
  const at = (iso) => new Date(iso).toISOString();
  localStorage.setItem(k, JSON.stringify([
    { id: 'c1', title: 'План недели', createdAt: at('2026-06-10T09:30:00'), updatedAt: at('2026-06-10T09:30:00'), preview: 'Разложил по окнам', count: 2 },
    { id: 'c2', title: 'Отчёт по сайту', createdAt: at('2026-06-09T18:00:00'), updatedAt: at('2026-06-09T18:00:00'), preview: 'На сайт — 12 ч', count: 2 },
  ]));
  localStorage.setItem('lancible:ai:u1:chat:c1', JSON.stringify({ title: 'План недели', messages: [], items: [{ kind: 'msg', role: 'user', text: 'Распланируй неделю' }, { kind: 'msg', role: 'assistant', text: 'Разложил по окнам' }] }));
  localStorage.setItem('lancible:ai:u1:chat:c2', JSON.stringify({ title: 'Отчёт по сайту', messages: [], items: [{ kind: 'msg', role: 'user', text: 'Сколько ушло на сайт?' }, { kind: 'msg', role: 'assistant', text: 'На сайт — 12 ч' }] }));
}, INDEX);

/** Остров рейла, панель внутри него и основная область. */
const geometry = (page) => page.evaluate(() => {
  const box = (n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const rail = document.getElementById('navrail');
  const doc = document.documentElement;
  return {
    rail: getComputedStyle(rail).display === 'none' ? null : box(rail),
    panel: box(document.getElementById('ai-panel')),
    main: box(document.getElementById('main')),
    item: box(document.querySelector('#navrail .nav-item[data-view="home"]')),
    label: getComputedStyle(document.querySelector('#navrail .nav-item[data-view="home"] .nav-label')).opacity,
    bar: document.getElementById('titlebar').getBoundingClientRect().bottom,
    vw: doc.clientWidth, vh: window.innerHeight, scroll: doc.scrollWidth > doc.clientWidth,
    z: getComputedStyle(rail).zIndex,
    shadow: getComputedStyle(rail).boxShadow,
  };
});

test('остров рейла раскрывается под чат: значки слева, чат правее; страница не сдвигается; свёрнутый рейл — так же', async ({ page }) => {
  await open(page, { width: 1280, signedIn: true });
  const before = await geometry(page);
  const btnBefore = await page.locator('#ai-btn').boundingBox();
  expect(before.rail.width, 'рейл развёрнут').toBe(184);
  await page.locator('#ai-btn').click();
  await expect(panel(page)).toBeVisible();
  let g = await geometry(page);
  expect(g.rail.width, 'рейл — колонка значков (52) и чат (380)').toBe(52 + 380);
  expect(Math.abs(g.panel.left - g.rail.left - 52), 'чат правее колонки значков').toBeLessThanOrEqual(1);
  expect(Math.abs(g.panel.right - g.rail.right), 'и до правого края острова').toBeLessThanOrEqual(1);
  expect(Math.abs(g.panel.top - g.rail.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.panel.bottom - g.rail.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.rail.top - g.bar), 'остров — под шапкой').toBeLessThanOrEqual(1);
  expect(g.main, 'основная область не сдвинулась').toEqual(before.main);
  expect(g.label, 'подписи рейла гаснут, как у свёрнутого').toBe('0');
  expect(g.item.width, 'пункт — шириной колонки значков, не уходит под чат').toBeLessThanOrEqual(36);
  expect(Number(g.z), 'остров поверх страницы').toBeGreaterThan(0);
  expect(g.shadow, 'с тенью, пока раскрыт').not.toBe('none');
  expect(g.scroll).toBe(false);
  const btnAfter = await page.locator('#ai-btn').boundingBox();
  expect([btnAfter.x, btnAfter.y, btnAfter.height], 'кнопка агента на месте').toEqual([btnBefore.x, btnBefore.y, btnBefore.height]);

  await page.locator('#ai-btn').click();
  await expect(panel(page)).toBeHidden();
  g = await geometry(page);
  expect(g.rail.width, 'закрыли — рейл как был').toBe(184);
  expect(g.label).toBe('1');
  expect(g.shadow).toBe('none');

  // Свёрнутый рейл (стили без переходов — open() их выключает).
  await page.evaluate(() => toggleNav());
  await expect(page.locator('body')).toHaveClass(/nav-collapsed/);
  await page.locator('#ai-btn').click();
  g = await geometry(page);
  expect(g.rail.width).toBe(52 + 380);
  expect(g.main.left, 'основная область — как у свёрнутого').toBe(52 + 24);
  await page.locator('#ai-close').click();
  await expect(panel(page)).toBeHidden();
  g = await geometry(page);
  expect(g.rail.width).toBe(52);
});

test('ширина 760: рейл значками — чат правее колонки, та же ширина', async ({ page }) => {
  await open(page, { width: 760, height: 812, signedIn: true });
  await page.locator('#ai-btn').click();
  const g = await geometry(page);
  expect(g.scroll, 'страницу не утащить вбок').toBe(false);
  expect(g.rail.width).toBe(52 + 380);
  expect(Math.abs(g.panel.left - g.rail.left - 52)).toBeLessThanOrEqual(1);
  expect(g.panel.width).toBe(380);
});

test('узкий веб (375): кнопка — в нижней плашке, чат поверх во всю ширину; вкладка экрана его закрывает', async ({ page }) => {
  await open(page, { width: 375, height: 812, signedIn: true });
  const tab = page.locator('#mobile-ai-btn');
  await expect(tab).toBeVisible();
  await expect(tab).toHaveText('Агент');
  await expect(page.locator('#ai-btn'), 'рейла на узком нет').toBeHidden();
  await tab.click();
  await expect(panel(page)).toBeVisible();
  await expect(tab).toHaveAttribute('aria-expanded', 'true');
  const g = await page.evaluate(() => {
    const p = document.getElementById('ai-panel').getBoundingClientRect();
    const tabs = document.getElementById('mobile-tabbar').getBoundingClientRect();
    const doc = document.documentElement;
    const active = document.querySelector('#mobile-tabbar .nav-item.active');
    return {
      left: p.left, right: p.right, top: p.top, bottom: p.bottom, tabTop: tabs.top,
      bar: document.getElementById('titlebar').getBoundingClientRect().bottom, vw: doc.clientWidth,
      scroll: doc.scrollWidth > doc.clientWidth,
      on: getComputedStyle(document.getElementById('mobile-ai-btn')).color,
      ink: getComputedStyle(document.body).getPropertyValue('--accent-ink').trim(),
      activeBefore: active ? getComputedStyle(active, '::before').display : null,
    };
  });
  expect(g.scroll).toBe(false);
  expect(g.left).toBe(0);
  expect(Math.abs(g.right - g.vw)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.top - g.bar), 'под шапкой').toBeLessThanOrEqual(1);
  expect(Math.abs(g.bottom - g.tabTop), 'до нижней плашки — она видна').toBeLessThanOrEqual(1);
  expect(g.activeBefore, 'горит вкладка агента, а не экрана под ним').toBe('none');
  await page.locator('#mobile-tabbar .nav-item[data-view="time"]').click();
  await expect(panel(page), 'вкладка экрана закрывает чат').toBeHidden();
  await expect(page.locator('#time-view')).toBeVisible();
  await expect(tab).toHaveAttribute('aria-expanded', 'false');
});

test('открытие — шторка ширины рейла, своего въезда у панели нет; закрытие ждёт рейл; без движения — сразу', async ({ page }) => {
  await open(page, { signedIn: true, motion: true });
  await page.locator('#ai-btn').click();
  const opening = await page.evaluate(() => ({
    rail: document.getElementById('navrail').getAnimations().map((a) => a.transitionProperty).filter(Boolean),
    panel: document.getElementById('ai-panel').getAnimations({ subtree: false }).length,
  }));
  expect(opening.rail, 'рейл едет по ширине').toContain('width');
  expect(opening.panel, 'у панели своего появления нет').toBe(0);
  // Закрытие: панель видна, пока рейл едет назад, но уже недоступна.
  const closing = await page.evaluate(async () => {
    document.getElementById('ai-btn').click();
    const p = document.getElementById('ai-panel');
    const during = { hidden: p.hidden, inert: p.inert };
    await new Promise((r) => setTimeout(r, 400));
    return { during, after: { hidden: p.hidden, inert: p.inert } };
  });
  expect(closing.during).toEqual({ hidden: false, inert: true });
  expect(closing.after).toEqual({ hidden: true, inert: false });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#ai-btn').click();
  const still = await page.evaluate(() => {
    document.getElementById('ai-btn').click();
    return document.getElementById('ai-panel').hidden;
  });
  expect(still, 'без движения — прячется сразу').toBe(true);
});

test('главный экран: сценка и фраза над полем, поле посередине, чаты под полем', async ({ page }) => {
  await open(page);
  await seedChats(page);
  await signIn(page);
  await page.locator('#ai-btn').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
  await expect(page.locator('#ai-log'), 'ленты на главном нет').toBeHidden();
  await expect(page.locator('#ai-back')).toBeHidden();
  await expect(page.locator('#ai-title')).toHaveText('Агент');
  await expect(input(page)).toBeFocused();
  // Сценка «chat» из ядра — формы вписаны, цвета из темы.
  expect(await page.locator('#ai-hello svg[data-art="chat"] > *').count()).toBeGreaterThan(5);
  // Фраза — по ключу ядра (aiGreeting), словами языка интерфейса.
  const phrase = await page.evaluate(() => ({ key: ai.greet && ai.greet.key, text: document.getElementById('ai-phrase').textContent, want: ai.greet ? t(ai.greet.key, ai.greet.vars) : '' }));
  expect(phrase.key).toMatch(/^ai\.(greet_(morning|day|evening|night)(_anon)?|nudge_\d+)$/);
  expect(phrase.text).toBe(phrase.want);
  expect(phrase.text.length).toBeGreaterThan(3);
  await expect(page.locator('#ai-list-label')).toHaveText('Чаты');
  await expect(page.locator('.ai-row-title')).toHaveText(['План недели', 'Отчёт по сайту']);

  const g = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { body: r('ai-body'), hello: r('ai-hello'), form: r('ai-compose'), list: r('ai-list'), row: document.querySelector('.ai-row').getBoundingClientRect() };
  });
  const mid = (b) => (b.top + b.bottom) / 2;
  expect(Math.abs(mid(g.form) - mid(g.body)), 'поле — посередине панели').toBeLessThanOrEqual(2);
  expect(g.hello.bottom, 'сценка и фраза — над полем').toBeLessThanOrEqual(g.form.top + 0.5);
  expect(g.list.top, 'чаты — под полем').toBeGreaterThanOrEqual(g.form.bottom - 0.5);
  expect(g.row.top).toBeGreaterThan(g.form.bottom);
});

test('фраза — каждый вход другая: приветствие (с именем из профиля) чередуется с подталкиваниями', async ({ page }) => {
  await open(page, { signedIn: true });
  await page.evaluate(() => { currentUser.name = 'Туран Алиев'; });
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    await page.locator('#ai-btn').click();
    seen.push(await page.locator('#ai-phrase').textContent());
    await page.locator('#ai-btn').click();
    await expect(panel(page)).toBeHidden();
  }
  for (let i = 1; i < seen.length; i += 1) expect(seen[i], `вход ${i + 1}: фраза не та же`).not.toBe(seen[i - 1]);
  // Часы — полдень: приветствие дневное, по первому слову имени.
  expect(seen.filter((x) => x === 'Добрый день, Туран!'), 'приветствие — через раз').toHaveLength(2);
  // Назад из чата — тоже вход.
  await page.evaluate(() => { ai.greetSeed = 0; });
  await seedChats(page);
  await page.evaluate(() => { aiLoad('u1'); });
  await page.locator('#ai-btn').click();
  const first = await page.locator('#ai-phrase').textContent();
  await page.locator('.ai-row-open').first().click();
  await page.locator('#ai-back').click();
  await expect(page.locator('#ai-phrase')).not.toHaveText(first);
});

test('сценка «дышит» при входе; без движения — стоит', async ({ page }) => {
  await open(page, { signedIn: true, motion: true });
  await page.locator('#ai-btn').click();
  const on = await page.evaluate(() => ({
    cls: document.getElementById('ai-hello').className,
    anim: getComputedStyle(document.querySelector('#ai-hello .es-art')).animationName,
  }));
  expect(on.cls).toContain('ai-breathe');
  expect(on.anim).toBe('aiBreathe');
  await page.locator('#ai-btn').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#ai-btn').click();
  expect(await page.evaluate(() => document.getElementById('ai-hello').className)).not.toContain('ai-breathe');
});

test('с поля главного — в новый чат без въезда: лента проявляется, поле съезжает к низу со своего места', async ({ page }) => {
  await open(page, { signedIn: true, motion: true });
  await fn(page, [stream({ text: ['Готово.'] })]);
  await openChat(page);
  await input(page).fill('Разложи неделю');
  const m = await page.evaluate(async () => {
    const form = document.getElementById('ai-compose');
    const top0 = form.getBoundingClientRect().top;
    form.requestSubmit();
    const first = {
      top: form.getBoundingClientRect().top,
      body: document.getElementById('ai-body').className,
      log: document.getElementById('ai-log').className,
      form: form.className,
      dy: form.style.getPropertyValue('--ai-dy'),
      hello: document.getElementById('ai-hello').hidden,
    };
    await new Promise((r) => setTimeout(r, 500));
    const body = document.getElementById('ai-body').getBoundingClientRect();
    return { top0, first, end: { bottom: form.getBoundingClientRect().bottom, bodyBottom: body.bottom, transform: getComputedStyle(form).transform } };
  });
  expect(m.first.hello, 'сразу — страница чата').toBe(true);
  expect(m.first.body, 'страница не въезжает').not.toMatch(/ai-page-(fwd|back)/);
  expect(m.first.log).toContain('ai-log-in');
  expect(m.first.form).toContain('ai-compose-down');
  expect(parseFloat(m.first.dy), 'поле стартует выше своего нового места').toBeLessThan(-50);
  expect(Math.abs(m.first.top - m.top0), 'без прыжка: поле начинает с того же места').toBeLessThanOrEqual(1);
  expect(Math.abs(m.end.bottom - m.end.bodyBottom), 'доехало до низа').toBeLessThanOrEqual(1);
  expect(m.end.transform).toBe('none');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Готово.');
  await expect(page.locator('#ai-title')).toHaveText('Разложи неделю');

  // Без движения — сразу на месте, без классов перехода.
  await page.locator('#ai-back').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fn(page, [stream({ text: ['Ещё.'] })]);
  await input(page).fill('Второй');
  const still = await page.evaluate(() => {
    document.getElementById('ai-compose').requestSubmit();
    return document.getElementById('ai-compose').className + document.getElementById('ai-log').className;
  });
  expect(still).not.toMatch(/ai-compose-down|ai-log-in/);
});

test('поле одно, набранное — у своей страницы: главный и чат помнят каждый своё', async ({ page }) => {
  await open(page);
  await seedChats(page);
  await signIn(page);
  await page.locator('#ai-btn').click();
  await input(page).fill('черновик нового чата');
  await page.locator('.ai-row-open', { hasText: 'План недели' }).click();
  await expect(page.locator('.ai-msg')).toHaveText(['Распланируй неделю', 'Разложил по окнам']);
  await expect(input(page), 'в чате — своё поле').toHaveValue('');
  await input(page).fill('ответ в чате');
  await page.locator('#ai-back').click();
  await expect(input(page), 'на главном — его черновик').toHaveValue('черновик нового чата');
  await page.locator('.ai-row-open', { hasText: 'План недели' }).click();
  await expect(input(page), 'вернулись в чат — набранное на месте').toHaveValue('ответ в чате');
  // Закрыли панель из чата — откроется на главном с его черновиком.
  await page.locator('#ai-close').click();
  await page.locator('#ai-btn').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
  await expect(input(page)).toHaveValue('черновик нового чата');
});

test('главный → чат → назад: шапка со стрелкой и названием, строка списка, счётчик в обеих шапках', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [stream({ text: ['Неделя разложена:\n\n- понедельник — макет'] })]);
  await page.locator('#ai-btn').click();
  await expect(input(page), 'поле — не длиннее 50 000 знаков').toHaveAttribute('maxlength', '50000');
  await send(page, 'Разложи задачи недели');
  await expect(page.locator('#ai-back')).toBeVisible();
  await expect(page.locator('.ai-msg:not(.me)')).toContainText('Неделя разложена:');
  await expect(page.locator('#ai-title'), 'название — из первого сообщения').toHaveText('Разложи задачи недели');
  await expect(page.locator('#ai-quota')).toHaveText('47 из 50 сегодня');
  expect(calls).toHaveLength(1);

  await page.locator('#ai-back').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
  await expect(page.locator('#ai-log')).toBeHidden();
  await expect(page.locator('#ai-quota'), 'счётчик и на главном').toHaveText('47 из 50 сегодня');
  await expect(rows(page)).toHaveCount(1);
  const row = rows(page).first();
  await expect(row.locator('.ai-row-title')).toHaveText('Разложи задачи недели');
  await expect(row.locator('.ai-row-preview'), 'превью последнего ответа — строкой, без разметки').toHaveText('Неделя разложена: понедельник — макет');
  await expect(row.locator('.ai-row-when')).toHaveText('сегодня 12:00');
  await expect(row.locator('.ai-row-count')).toHaveText('2 сообщения');
  await expect(row.locator('.ai-row-open'), 'вернулись — фокус на строке того чата').toBeFocused();

  await row.locator('.ai-row-open').click();
  await expect(page.locator('#ai-log')).toBeVisible();
  await expect(page.locator('.ai-msg.me')).toHaveText('Разложи задачи недели');
  await expect(page.locator('.ai-msg:not(.me)')).toContainText('понедельник — макет');

  // Esc — чат закрывается, фокус — на кнопку рейла; открытый снова — на главном.
  await input(page).focus();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#ai-btn')).toBeFocused();
  await page.locator('#ai-btn').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
});

test('время в строке: «сегодня 09:30», «вчера», дата; прошлый год — с годом', async ({ page }) => {
  await open(page);
  await page.evaluate((k) => {
    const at = (iso) => new Date(iso).toISOString();
    localStorage.setItem(k, JSON.stringify([
      { id: 'c1', title: 'Утро', createdAt: at('2026-06-10T09:30:00'), updatedAt: at('2026-06-10T09:30:00'), preview: 'Привет', count: 1 },
      { id: 'c2', title: 'Вчера', createdAt: at('2026-06-09T18:00:00'), updatedAt: at('2026-06-09T18:00:00'), preview: '', count: 3 },
      { id: 'c3', title: 'Май', createdAt: at('2026-05-12T10:00:00'), updatedAt: at('2026-05-12T10:00:00'), preview: '', count: 5 },
      { id: 'c4', title: 'Прошлый год', createdAt: at('2025-10-12T10:00:00'), updatedAt: at('2025-10-12T10:00:00'), preview: '', count: 21 },
    ]));
  }, INDEX);
  await signIn(page);
  await page.locator('#ai-btn').click();
  const expected = await page.evaluate(() => [
    'сегодня 09:30', 'вчера',
    new Date('2026-05-12T10:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    new Date('2025-10-12T10:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
  ]);
  await expect(page.locator('.ai-row-when')).toHaveText(expected);
  await expect(page.locator('.ai-row-count')).toHaveText(['1 сообщение', '3 сообщения', '5 сообщений', '21 сообщение']);
  await expect(page.locator('.ai-row-title')).toHaveText(['Утро', 'Вчера', 'Май', 'Прошлый год']);
});

test('два чата — у каждого своя история; свежий — сверху', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [stream({ text: ['Ответ А.'] }), stream({ text: ['Ответ Б.'] }), stream({ text: ['Снова А.'] })]);
  await openChat(page);
  await send(page, 'Первый чат');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Ответ А.');
  await page.locator('#ai-back').click();
  await page.clock.setFixedTime(new Date('2026-06-10T12:05:00'));
  await send(page, 'Второй чат');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Ответ Б.');
  expect(calls[1].body.messages, 'второй чат начинается с чистой истории').toEqual([{ role: 'user', content: [{ type: 'text', text: 'Второй чат' }] }]);

  await page.locator('#ai-back').click();
  await expect(page.locator('.ai-row-title')).toHaveText(['Второй чат', 'Первый чат']);
  await page.locator('.ai-row-open', { hasText: 'Первый чат' }).click();
  await expect(page.locator('.ai-msg')).toHaveText(['Первый чат', 'Ответ А.']);
  await page.clock.setFixedTime(new Date('2026-06-10T12:10:00'));
  await send(page, 'Ещё в первый');
  await expect(page.locator('.ai-msg:not(.me)').last()).toHaveText('Снова А.');
  expect(calls[2].body.messages.map((m) => m.role), 'история первого чата — своя').toEqual(['user', 'assistant', 'user']);
  expect(JSON.stringify(calls[2].body.messages)).not.toContain('Второй чат');

  // Хранение: список и сообщения — по чатам; в state переписки нет.
  const idx = await index(page);
  expect(idx.map((c) => c.title)).toEqual(['Первый чат', 'Второй чат']);
  const stored = await page.evaluate((keys) => keys.map((k) => JSON.parse(localStorage.getItem(k)).items.filter((it) => it.kind === 'msg').map((it) => it.text)), idx.map((c) => chatKey(c.id)));
  expect(stored).toEqual([['Первый чат', 'Ответ А.', 'Ещё в первый', 'Снова А.'], ['Второй чат', 'Ответ Б.']]);
  expect(await page.evaluate(() => JSON.stringify(state).includes('Первый чат'))).toBe(false);
});

test('ответ дописывается в свой чат, даже если человек ушёл на главный экран', async ({ page }) => {
  await open(page, { signedIn: true });
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/functions/v1/ai-chat', async (route) => {
    await gate;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: stream({ text: ['Догнал.'] }) });
  });
  await openChat(page);
  await send(page, 'Долгий вопрос');
  await expect(page.locator('.ai-typing')).toBeVisible();
  await page.locator('#ai-back').click();
  await expect(page.locator('#ai-log'), 'на главном ленты — и точек — нет').toBeHidden();
  await expect(input(page), 'пока идёт ответ, поле недоступно и здесь').toBeDisabled();
  release();
  await expect(page.locator('.ai-row-preview')).toHaveText('Догнал.');
  await page.locator('.ai-row-open').click();
  await expect(page.locator('.ai-msg')).toHaveText(['Долгий вопрос', 'Догнал.']);
});

test('прежняя одиночная история переносится первым чатом и уходит', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    localStorage.setItem('lancible:ai:u1', JSON.stringify({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Старый вопрос про проекты' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Старый ответ.' }] },
      ],
      items: [{ kind: 'msg', role: 'user', text: 'Старый вопрос про проекты' }, { kind: 'msg', role: 'assistant', text: 'Старый ответ.' }, { kind: 'error', key: 'ai.error_network' }],
      updatedAt: new Date('2026-06-09T15:00:00').toISOString(),
    }));
  });
  const calls = await fn(page, [stream({ text: ['Новый ответ.'] })]);
  await signIn(page);
  expect(await page.evaluate(() => localStorage.getItem('lancible:ai:u1')), 'старая история ушла').toBeNull();
  const idx = await index(page);
  expect(idx).toHaveLength(1);
  expect(idx[0]).toMatchObject({ title: 'Старый вопрос про проекты', preview: 'Старый ответ.', count: 2 });
  expect(Date.parse(idx[0].updatedAt)).toBe(Date.parse('2026-06-09T15:00:00'));

  await page.locator('#ai-btn').click();
  await expect(page.locator('.ai-row-when')).toHaveText('вчера');
  await page.locator('.ai-row-open').click();
  await expect(page.locator('.ai-msg')).toHaveText(['Старый вопрос про проекты', 'Старый ответ.']);
  await expect(page.locator('.ai-error'), 'ошибки из старой ленты не переезжают').toHaveCount(0);
  await send(page, 'Продолжим');
  await expect(page.locator('.ai-msg:not(.me)').last()).toHaveText('Новый ответ.');
  expect(calls[0].body.messages.map((m) => m.role), 'разговор продолжается со старой историей').toEqual(['user', 'assistant', 'user']);
});

test('удалить чат: «⋯» строки и подтверждение; «Отмена» оставляет; из чата — «⋯» в шапке', async ({ page }) => {
  await open(page, { signedIn: true });
  await fn(page, [stream({ text: ['Раз.'] }), stream({ text: ['Два.'] })]);
  await openChat(page);
  await send(page, 'Чат один');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Раз.');
  await page.locator('#ai-back').click();
  await page.clock.setFixedTime(new Date('2026-06-10T12:05:00'));
  await send(page, 'Чат два');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Два.');
  await page.locator('#ai-back').click();
  await expect(rows(page)).toHaveCount(2);
  const ids = (await index(page)).map((c) => c.id);

  const second = rows(page).nth(1);
  await second.locator('.ai-row-more').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Удалить чат' }).click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await expect(page.locator('#confirm-title')).toHaveText('Удалить чат?');
  await expect(page.locator('#confirm-text')).toContainText('«Чат один»');
  // Esc в окне подтверждения закрывает окно, а не панель.
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-backdrop')).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  await second.locator('.ai-row-more').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Удалить чат' }).click();
  await page.locator('#confirm-ok').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('.ai-row-title')).toHaveText('Чат два');
  expect(await page.evaluate((k) => localStorage.getItem(k), chatKey(ids[1])), 'сообщения удалённого чата ушли').toBeNull();
  expect((await index(page)).map((c) => c.id)).toEqual([ids[0]]);

  // Из самого чата: «⋯» в шапке → удалить → на главный, где чатов нет.
  await page.locator('.ai-row-open').click();
  await page.locator('#ai-more').click();
  await page.locator('#ctx-menu .ctx-item', { hasText: 'Удалить чат' }).click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#ai-list-label'), 'чатов нет — подписи нет').toBeHidden();
  await expect(page.locator('#ai-chats .ai-examples'), 'под полем — примеры').toBeVisible();
  expect(await index(page)).toEqual([]);
  expect(await page.evaluate((k) => localStorage.getItem(k), chatKey(ids[0]))).toBeNull();
});

test('переходы: из списка в чат — въезд справа, на главный — слева; без движения — сразу', async ({ page }) => {
  await open(page, { motion: true });
  await seedChats(page);
  await signIn(page);
  await page.locator('#ai-btn').click();
  await page.locator('.ai-row-open').first().click();
  const into = await page.evaluate(() => {
    const n = document.getElementById('ai-body');
    const a = n.getAnimations().find((x) => x.animationName === 'aiPageFwd');
    return { cls: n.className, from: a ? a.effect.getKeyframes()[0].transform : null };
  });
  expect(into.cls).toContain('ai-page-fwd');
  expect(into.from, 'чат въезжает справа').toMatch(/translateX\(\d+px\)/);
  await page.locator('#ai-back').click();
  const back = await page.evaluate(() => {
    const n = document.getElementById('ai-body');
    const a = n.getAnimations().find((x) => x.animationName === 'aiPageBack');
    return { cls: n.className, from: a ? a.effect.getKeyframes()[0].transform : null };
  });
  expect(back.cls).toContain('ai-page-back');
  expect(back.from, 'главный въезжает слева').toMatch(/translateX\(-\d+px\)/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.ai-row-open').first().click();
  const still = await page.evaluate(() => ({
    cls: document.getElementById('ai-body').className,
    anim: getComputedStyle(document.getElementById('ai-body')).animationName,
  }));
  expect(still.cls).not.toContain('ai-page-fwd');
  expect(still.anim).toBe('none');
});

// --- Пересечения в карточке (дополнение 18 октября 2026) ------------------------------

/** Проект «Работа» и задача с отрезком — заведены как приложение заводит. */
const seedProject = (page, slots) => page.evaluate((s) => {
  const now = new Date().toISOString();
  const id = 'p-work';
  state.projects.push({ id, name: 'Работа', color: '#5ec8f2', description: '', pinnedAt: null, createdAt: now, tagIds: [] });
  seedProjectStatuses(id);
  if (s) {
    state.tasks.push({
      id: 'busy1', projectId: id, title: 'Созвон', done: false, notes: null, totalMs: 0, sessions: [], rate: null, pinnedAt: null,
      createdAt: now, updatedAt: now, statusId: orderedStatuses(id)[1].id, tagIds: [], versionId: null, repeat: null, cancelled: false,
      dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null, slots: s,
    });
  }
  render();
}, slots || null);

const OVERLAP = {
  id: 'toolu_overlap',
  name: 'propose_changes',
  input: {
    summary: 'Задача на пятницу утром',
    ops: [{ op: 'create_task', ref: 't1', project: 'p-work', title: 'Собрать макет', slots: [{ start: '2026-06-12T07:00:00.000Z', end: '2026-06-12T09:00:00.000Z' }] }],
  },
};

test('пересечение: строка предупреждения; «Применить» спрашивает «Поставить в то же время?»', async ({ page }) => {
  await open(page, { signedIn: true });
  await seedProject(page, [{ start: '2026-06-12T08:00:00.000Z', end: '2026-06-12T09:30:00.000Z' }]);
  await fn(page, [stream({ text: ['Поставил на утро.'], tool: OVERLAP })]);
  await openChat(page);
  await send(page, 'Поставь макет на пятницу утром');
  const card = page.locator('.ai-card');
  const warn = card.locator('.ai-op-warn');
  await expect(warn).toHaveCount(1);
  const time = await page.evaluate(() => `${hhmm(Date.parse('2026-06-12T08:00:00.000Z'))}–${hhmm(Date.parse('2026-06-12T09:30:00.000Z'))}`);
  await expect(warn).toHaveText(`пересекается с «Созвон» ${time}`);
  await expect(warn.locator('svg[data-icon="danger"]')).toHaveCount(1);

  const before = await page.evaluate(() => state.tasks.length);
  await card.locator('[data-act="apply"]').click();
  await expect(page.locator('#confirm-backdrop')).toBeVisible();
  await expect(page.locator('#confirm-title')).toHaveText('Время уже занято');
  await expect(page.locator('#confirm-text')).toHaveText(`В это время уже есть задачи: «Созвон» ${time}. Поставить в то же время?`);
  await expect(page.locator('#confirm-ok')).toHaveText('Поставить');
  await expect(page.locator('#confirm-cancel')).toHaveText('Отмена');
  await page.locator('#confirm-cancel').click();
  expect(await page.evaluate(() => state.tasks.length), '«Отмена» — ничего не создано').toBe(before);
  await expect(card.locator('[data-act="apply"]')).toBeVisible();

  await card.locator('[data-act="apply"]').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#toast')).toHaveText('Применено изменений: 1');
  const made = await page.evaluate(() => state.tasks.find((x) => x.title === 'Собрать макет'));
  expect(made.slots).toHaveLength(1);
  await expect(card.locator('.ai-op-warn'), 'применённая карточка — без предупреждений').toHaveCount(0);
});

test('без пересечений — «Применить» сразу, без вопроса', async ({ page }) => {
  await open(page, { signedIn: true });
  await seedProject(page, [{ start: '2026-06-12T10:00:00.000Z', end: '2026-06-12T11:00:00.000Z' }]);
  await fn(page, [stream({ text: ['Готово.'], tool: OVERLAP })]);
  await openChat(page);
  await send(page, 'Поставь');
  await expect(page.locator('.ai-card .ai-op-warn')).toHaveCount(0);
  await page.locator('.ai-card [data-act="apply"]').click();
  await expect(page.locator('#toast')).toHaveText('Применено изменений: 1');
  await expect(page.locator('#confirm-backdrop')).toBeHidden();
});

// --- Поиск в шапке находит чаты (19 октября 2026) ------------------------------------

test('поиск в шапке находит чаты по названию и тексту; щелчок открывает чат в рейле; чужие чаты не находит', async ({ page }) => {
  await open(page);
  await seedChats(page);
  await signIn(page);
  const search = page.locator('#search-input');
  await search.fill('окнам');
  const group = page.locator('#search-results .sr-group', { hasText: 'Чаты' });
  await expect(group).toHaveText('Чаты · 1');
  const hit = page.locator('#search-results .sr-item[data-chat-id="c1"]');
  await expect(hit.locator('.sr-title')).toHaveText('План недели');
  await expect(hit.locator('.sr-sub'), 'отрывок вокруг найденного').toContainText('по окнам');
  await expect(hit.locator('svg[data-icon="comments"]'), 'у чата — значок, а не точка проекта').toHaveCount(1);
  await search.fill('отчёт');
  await expect(page.locator('#search-results .sr-item[data-chat-id="c2"] .sr-title'), 'по названию').toHaveText('Отчёт по сайту');
  await expect(page.locator('#search-results .sr-item[data-chat-id="c2"] .sr-sub'), 'нашлось в названии — без отрывка').toHaveCount(0);

  // Щелчок — чат открыт в острове рейла, поиск закрыт.
  await page.locator('#search-results .sr-item[data-chat-id="c2"]').click();
  await expect(page.locator('#search-panel')).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/\bai-open\b/);
  await expect(page.locator('#ai-title')).toHaveText('Отчёт по сайту');
  await expect(page.locator('.ai-msg')).toHaveText(['Сколько ушло на сайт?', 'На сайт — 12 ч']);
  // Из открытого чата — в другой, тоже поиском.
  await search.fill('окнам');
  await page.locator('#search-results .sr-item[data-chat-id="c1"]').click();
  await expect(page.locator('#ai-title')).toHaveText('План недели');

  // Другой аккаунт — своих чатов нет, чужие не находятся; гость — тоже.
  await page.evaluate(() => { currentUser = { id: 'u2', email: 'other@example.com', name: null }; renderAccountBtn(); });
  await search.fill('окнам');
  await expect(page.locator('#search-results .sr-group', { hasText: 'Чаты' })).toHaveCount(0);
  await page.evaluate(() => { currentUser = null; renderAccountBtn(); });
  await search.fill('план');
  await expect(page.locator('#search-results .sr-group', { hasText: 'Чаты' })).toHaveCount(0);
});

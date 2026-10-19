// Чат агента на вебе: кнопка в рейле, состояние входа, лента, карточка
// предложения, круг инструментов, ошибки, узкая ширина. Главный экран, чаты,
// остров рейла и вложения — ai-chats.spec.js и ai-attach.spec.js.
// Запуск: npm run test:e2e -- ai-panel
//
// Подмена функции ai-chat, вход и открытие чата — tests/e2e/ai-helpers.js.
const { test, expect } = require('@playwright/test');
const { FN, stream, fn, open, signIn, panel, input, openChat, openEmptyChat, savedChat, send } = require('./ai-helpers');

// Часы прибиты к среде 10 июня 2026, полдень (tests/e2e/clock.js): пятница —
// 12 июня. Предложение — новый проект и задача в нём по ref.
const PROPOSAL = {
  id: 'toolu_propose',
  name: 'propose_changes',
  input: {
    summary: 'Проект «Сайт» и задача на пятницу',
    ops: [
      { op: 'create_project', ref: 'p1', name: 'Сайт' },
      {
        op: 'create_task', ref: 't1', project: 'p1', title: 'Собрать макет',
        dueAt: '2026-06-12T15:00:00.000Z',
        slots: [{ start: '2026-06-12T07:00:00.000Z', end: '2026-06-12T09:00:00.000Z' }],
      },
    ],
  },
};
const PROPOSAL_TEXT = ['Завёл проект «Сайт» ', 'и задачу на пятницу:\n\n', '- макет к вечеру\n', '- два часа утром'];

/** Данные, которые трогает предложение. */
const data = (page) => page.evaluate(() => JSON.parse(JSON.stringify({
  projects: state.projects, tasks: state.tasks, statuses: state.statuses, versions: state.versions, tags: state.tags,
})));

test('кнопка агента — первым пунктом рейла, в шапке её нет; открывает и закрывает чат в острове рейла', async ({ page }) => {
  await open(page);
  const btn = page.locator('#navrail .nav-items > .nav-item').first();
  await expect(btn, 'первый пункт рейла — агент').toHaveId('ai-btn');
  await expect(btn).toHaveAttribute('title', 'ИИ-агент');
  await expect(btn.locator('.nav-label')).toHaveText('Агент');
  await expect(btn.locator('svg[data-icon="comments"]')).toHaveCount(1);
  await expect(page.locator('#titlebar [data-icon="comments"]'), 'в шапке кнопки агента нет').toHaveCount(0);
  await expect(page.locator('#navrail #ai-panel'), 'чат — внутри острова рейла').toHaveCount(1);
  await expect(panel(page)).toBeHidden();

  await btn.click();
  await expect(panel(page)).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(btn).toHaveClass(/\bon\b/);
  await expect(page.locator('body')).toHaveClass(/\bai-open\b/);
  await btn.click();
  await expect(panel(page), 'повторный щелчок закрывает').toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('body')).not.toHaveClass(/\bai-open\b/);

  // Колокольчик по-прежнему вплотную к поиску.
  const g = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { search: r('.tb-search'), bell: r('#notif-btn') };
  });
  expect(g.bell.left - g.search.right).toBeLessThan(16);
});

test('без входа — состояние входа: лента и поле скрыты, кнопка открывает окно входа', async ({ page }) => {
  await open(page);
  await page.locator('#ai-btn').click();
  await expect(page.locator('#ai-signin')).toBeVisible();
  await expect(page.locator('#ai-body'), 'главного экрана и чатов без входа нет').toBeHidden();
  await expect(page.locator('#ai-signin .empty-state-title')).toHaveText('Агент работает после входа');
  await expect(page.locator('#ai-log')).toBeHidden();
  await expect(page.locator('#ai-compose')).toBeHidden();
  await page.locator('#ai-signin-btn').click();
  await expect(page.locator('#auth-backdrop')).toBeVisible();
  await expect(page.locator('#auth-title')).toHaveText('Вход');
});

test('вход, отправка, ответ потоком и карточка; «Применить» создаёт проект и задачу, «Отменить» возвращает', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [stream({ text: PROPOSAL_TEXT, tool: PROPOSAL })]);
  await openChat(page);
  await expect(page.locator('#ai-signin')).toBeHidden();
  await expect(input(page)).toBeFocused();
  // Чатов нет — под полем подсказка и три примера.
  await expect(page.locator('#ai-list .ai-examples button')).toHaveCount(3);

  const before = await data(page);
  await send(page, 'Заведи проект «Сайт» и задачу на пятницу');

  await expect(page.locator('.ai-msg.me')).toHaveText('Заведи проект «Сайт» и задачу на пятницу');
  const answer = page.locator('.ai-msg:not(.me)');
  await expect(answer).toContainText('Завёл проект «Сайт» и задачу на пятницу:');
  // Строки «- …» — списком, а не текстом с дефисами.
  await expect(answer.locator('ul > li')).toHaveText(['макет к вечеру', 'два часа утром']);
  const card = page.locator('.ai-card');
  await expect(card.locator('.ai-card-title')).toHaveText('Проект «Сайт» и задача на пятницу');
  await expect(card.locator('.ai-op')).toHaveCount(2);
  await expect(card.locator('.ai-op').nth(0)).toContainText('Новый проект');
  await expect(card.locator('.ai-op').nth(1)).toContainText('Собрать макет');
  await expect(card.locator('.ai-op').nth(1).locator('.ai-op-sub')).toContainText('Сайт');
  await expect(page.locator('#ai-quota')).toHaveText('47 из 50 сегодня');
  await expect(input(page), 'ответ кончился — поле снова доступно').toBeEnabled();

  // Что ушло в функцию.
  expect(calls).toHaveLength(1);
  const { body, headers } = calls[0];
  expect(headers.authorization).toBe('Bearer test-token');
  expect(headers.apikey, 'anon-ключ приложения').toMatch(/^eyJ/);
  expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Заведи проект «Сайт» и задачу на пятницу' }] }]);
  expect(body.lang).toBe('ru');
  expect(typeof body.tz).toBe('string');
  expect(Date.parse(body.now)).toBe(Date.parse('2026-06-10T12:00:00'));
  expect(Array.isArray(body.context.projects)).toBe(true);
  expect(body.context.focus.view).toBe('home');
  expect(await data(page), 'до решения человека данные не тронуты').toEqual(before);

  // Применить.
  await card.locator('[data-act="apply"]').click();
  await expect(page.locator('#toast')).toHaveText('Применено изменений: 2');
  const after = await page.evaluate(() => {
    const p = state.projects.find((x) => x.name === 'Сайт');
    const task = state.tasks.find((x) => x.title === 'Собрать макет');
    return {
      p, task,
      statuses: state.statuses.filter((s) => p && s.projectId === p.id),
      defaults: Core.DEFAULT_STATUSES.length,
      statusOk: !!(task && state.statuses.some((s) => s.id === task.statusId && s.projectId === task.projectId)),
    };
  });
  expect(after.p, 'проект создан').toBeTruthy();
  expect(after.statuses, 'у проекта свои статусы').toHaveLength(after.defaults);
  expect(after.task.projectId, 'задача — в новом проекте по ref').toBe(after.p.id);
  expect(after.statusOk, 'статус задачи — из её проекта').toBe(true);
  expect(after.task).toMatchObject({ done: false, cancelled: false, totalMs: 0, sessions: [], tagIds: [], versionId: null });
  expect(Date.parse(after.task.dueAt)).toBe(Date.parse('2026-06-12T15:00:00.000Z'));
  expect(after.task.slots).toHaveLength(1);
  expect(Date.parse(after.task.slots[0].start)).toBe(Date.parse('2026-06-12T07:00:00.000Z'));
  await expect(card.locator('.ai-card-state')).toContainText('Применено изменений: 2');
  await expect(card.locator('[data-act="apply"]')).toHaveCount(0);
  await expect(card.locator('.ai-op-link'), 'созданное — ссылками').toHaveCount(2);

  // История — в localStorage по аккаунту и чату, не в state.
  const saved = await savedChat(page);
  expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  expect(saved.items.find((it) => it.kind === 'card').state).toBe('applied');
  expect(await page.evaluate(() => JSON.stringify(state).includes('Заведи проект'))).toBe(false);

  // Отменить — всё как было.
  await card.locator('[data-act="undo"]').click();
  await expect(page.locator('#toast')).toHaveText('Изменения отменены');
  expect(await data(page)).toEqual(before);
  await expect(card.locator('.ai-card-state')).toContainText('Изменения отменены');
  await expect(card.locator('[data-act="undo"]')).toHaveCount(0);
});

test('400 too long — «Чат стал слишком длинным», без «Повторить»: повтор упал бы так же', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [{ status: 400, json: { error: 'too long' } }]);
  await openChat(page);
  await send(page, 'Ещё один вопрос');
  const err = page.locator('.ai-error');
  await expect(err).toHaveText('Чат стал слишком длинным — начните новый');
  await expect(err.locator('button'), '«Повторить» нет').toHaveCount(0);
  expect(calls).toHaveLength(1);
  await expect(input(page), 'поле снова доступно').toBeEnabled();
  const words = await page.evaluate(() => ['en', 'uk', 'kk'].map((l) => { setLang(l); return t('ai.too_long'); }));
  expect(words).toEqual([
    'This chat has grown too long — start a new one',
    'Чат став задовгим — почніть новий',
    'Чат тым ұзын болып кетті — жаңасын бастаңыз',
  ]);
});

test('«Отменить», когда задачу уже меняли после применения: тост «Часть изменений осталась», без kept — обычный', async ({ page }) => {
  // Ядро (Core.aiUndo) не отменяет поля, которые после применения уже
  // правили, и задачи с записанным временем, и называет их в kept. Здесь —
  // что веб это показывает; что именно ядро оставляет — tests/unit/ai*.test.js.
  await open(page, { signedIn: true });
  await fn(page, [stream({ text: ['Готово.'], tool: PROPOSAL }), stream({ text: ['Ещё раз.'], tool: { ...PROPOSAL, id: 'toolu_second' } })]);
  await page.evaluate(() => {
    const undo = Core.aiUndo;
    window.__keep = true;
    Core.aiUndo = (st, u) => {
      const res = undo(st, u) || {};
      return window.__keep ? { ...res, kept: [{ id: 'тот', reason: 'changed' }] } : { ...res, kept: [] };
    };
  });
  await openChat(page);
  await send(page, 'Предложи');
  const first = page.locator('.ai-card').nth(0);
  await first.locator('[data-act="apply"]').click();
  await expect(page.locator('#toast')).toHaveText('Применено изменений: 2');
  await first.locator('[data-act="undo"]').click();
  await expect(page.locator('#toast')).toHaveText('Часть изменений осталась: задачу уже меняли после применения');
  await expect(first.locator('[data-act="undo"]')).toHaveCount(0);

  // Пустой kept — как раньше.
  await page.evaluate(() => { window.__keep = false; });
  await send(page, 'Ещё');
  const second = page.locator('.ai-card').nth(1);
  await second.locator('[data-act="apply"]').click();
  await second.locator('[data-act="undo"]').click();
  await expect(page.locator('#toast')).toHaveText('Изменения отменены');

  // Строка — на четырёх языках.
  const words = await page.evaluate(() => ['en', 'uk', 'kk'].map((l) => { setLang(l); return t('ai.undo_kept'); }));
  expect(words).toEqual([
    'Some changes were kept: the task was edited after they were applied',
    'Частина змін залишилася: завдання вже змінювали після застосування',
    'Өзгерістердің бір бөлігі қалды: тапсырма қолданылғаннан кейін өзгертілген',
  ]);
});

test('ссылка применённой задачи открывает задачу; «Отклонить» убирает кнопки', async ({ page }) => {
  await open(page, { signedIn: true });
  await fn(page, [stream({ text: ['Готово.'], tool: PROPOSAL }), stream({ text: ['Ещё раз.'], tool: { ...PROPOSAL, id: 'toolu_second' } })]);
  await openChat(page);
  await send(page, 'Предложи');
  const first = page.locator('.ai-card').nth(0);
  await first.locator('[data-act="decline"]').click();
  await expect(first.locator('.ai-card-state')).toHaveText('Отклонено');
  await expect(first.locator('button')).toHaveCount(0);

  await send(page, 'Ещё раз');
  const second = page.locator('.ai-card').nth(1);
  await second.locator('[data-act="apply"]').click();
  await second.locator('.ai-op-link', { hasText: 'Собрать макет' }).click();
  const view = await page.evaluate(() => ({ view: state.ui.view, title: (getTask(selectedId) || {}).title }));
  expect(view).toEqual({ view: 'task', title: 'Собрать макет' });
  await expect(panel(page), 'на широком окне панель остаётся').toBeVisible();
});

test('решение по карточке уходит tool_result со следующим сообщением; без решения — pending', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [
    stream({ text: ['Вот.'], tool: PROPOSAL }),
    stream({ text: ['Понял.'] }),
    stream({ text: ['Ещё вот.'], tool: { ...PROPOSAL, id: 'toolu_next' } }),
    stream({ text: ['Хорошо.'] }),
  ]);
  await openChat(page);
  await send(page, 'Раз');
  await page.locator('.ai-card [data-act="decline"]').click();
  await send(page, 'Два');
  await expect(page.locator('.ai-msg:not(.me)').nth(1)).toHaveText('Понял.');
  expect(calls[1].body.messages.at(-1).content).toEqual([
    { type: 'tool_result', tool_use_id: 'toolu_propose', content: 'declined' },
    { type: 'text', text: 'Два' },
  ]);

  await send(page, 'Три');
  await expect(page.locator('.ai-card')).toHaveCount(2);
  await send(page, 'Четыре');
  await expect(page.locator('.ai-msg:not(.me)').nth(3)).toHaveText('Хорошо.');
  expect(calls[3].body.messages.at(-1).content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_next', content: 'pending' });
  // Карточка без решения остаётся с кнопками.
  await expect(page.locator('.ai-card').nth(1).locator('[data-act="apply"]')).toBeVisible();
  await expect(page.locator('.ai-card').nth(1).locator('.ai-card-note')).toHaveText('Ждёт решения');
});

test('круг инструментов: свободные окна считает клиент и сам шлёт tool_result следующим вызовом', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [
    stream({ text: ['Посмотрю, где свободно.'], tool: { id: 'toolu_windows', name: 'free_windows', input: { from: '2026-06-10', to: '2026-06-12', minMinutes: 60 } } }),
    stream({ text: ['Свободно в четверг с 9 до 18.'] }),
  ]);
  await openChat(page);
  await send(page, 'Когда я свободен до пятницы?');
  await expect(page.locator('.ai-msg:not(.me)').last()).toHaveText('Свободно в четверг с 9 до 18.');
  await expect(page.locator('.ai-step')).toContainText('Свободные окна:');
  await expect(page.locator('.ai-card')).toHaveCount(0);

  expect(calls).toHaveLength(2);
  const msgs = calls[1].body.messages;
  expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(msgs[1].content.find((b) => b.type === 'tool_use')).toMatchObject({ id: 'toolu_windows', name: 'free_windows' });
  const results = msgs[2].content;
  expect(results, 'круг инструментов — без текста человека').toHaveLength(1);
  expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_windows' });
  // Круг инструментов уходит с той же картиной, что первый вызов.
  expect(calls[1].body.context, 'тот же снимок').toEqual(calls[0].body.context);
  expect(calls[1].body.now, 'то же «сейчас»').toBe(calls[0].body.now);
  const out = JSON.parse(results[0].content);
  expect(out.windows.length, 'в среду после полудня и в четверг окна есть').toBeGreaterThan(0);
  expect(out.windows.every((w) => w.minutes >= 60)).toBe(true);
  expect(out.workHours).toMatchObject({ start: '09:00', end: '18:00' });
  // В истории — оба круга.
  const saved = (await savedChat(page)).messages.map((m) => m.role);
  expect(saved).toEqual(['user', 'assistant', 'user', 'assistant']);
});

test('free_windows: часы — из настроек (aiWorkHours) или из hours, которые назвал человек', async ({ page }) => {
  await open(page, { signedIn: true });
  await page.evaluate(() => { state.settings.workHours = { start: '10:00', end: '16:00', days: [1, 2, 3, 4, 5] }; });
  const calls = await fn(page, [
    stream({ tool: { id: 'toolu_w1', name: 'free_windows', input: { from: '2026-06-10', to: '2026-06-12', minMinutes: 30 } } }),
    stream({ text: ['Готово.'] }),
    stream({ tool: { id: 'toolu_w2', name: 'free_windows', input: { from: '2026-06-13', to: '2026-06-14', minMinutes: 30, hours: { start: '18:00', end: '22:00', days: [0, 6] } } } }),
    stream({ text: ['Вечером свободно.'] }),
  ]);
  await openChat(page);
  await send(page, 'Когда свободно?');
  await expect(page.locator('.ai-msg:not(.me)').last()).toHaveText('Готово.');
  const first = JSON.parse(calls[1].body.messages.at(-1).content[0].content);
  const base = await page.evaluate(() => Core.aiWorkHours(state.settings));
  expect(first.workHours, 'без hours — рабочие часы из настроек').toMatchObject({ start: base.start, end: base.end });
  expect(first.windows.every((w) => w.minutes >= 30)).toBe(true);

  await send(page, 'А вечером в выходные?');
  await expect(page.locator('.ai-msg:not(.me)').last()).toHaveText('Вечером свободно.');
  const second = JSON.parse(calls[3].body.messages.at(-1).content[0].content);
  expect(second.workHours, 'hours из входа модели').toMatchObject({ start: '18:00', end: '22:00', days: [0, 6] });
  expect(second.windows.length, 'в субботу и воскресенье вечером окна есть').toBeGreaterThan(0);
});

test('блоки thinking с подписью возвращаются модели неизменными', async ({ page }) => {
  await open(page, { signedIn: true });
  const thinking = { text: 'Подумаю, что спросили.', signature: 'EqQBCkgIBxABGAIiQSignatureForTest==' };
  const calls = await fn(page, [stream({ thinking, text: ['Думаю, вот так.'] }), stream({ text: ['Ещё.'] })]);
  await openChat(page);
  await send(page, 'Подумай');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Думаю, вот так.');
  await send(page, 'Дальше');
  await expect(page.locator('.ai-msg:not(.me)').nth(1)).toHaveText('Ещё.');
  expect(calls[1].body.messages[1]).toEqual({
    role: 'assistant',
    content: [{ type: 'thinking', thinking: thinking.text, signature: thinking.signature }, { type: 'text', text: 'Думаю, вот так.' }],
  });
});

test('отказ модели — строка об этом; вопрос не уходит повторно со следующим сообщением', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [stream({ stop: 'refusal' }), stream({ text: ['Слушаю.'] })]);
  await openChat(page);
  await send(page, 'Что-то не то');
  await expect(page.locator('.ai-step')).toHaveText('Агент не стал отвечать на этот запрос. Попробуйте сформулировать иначе.');
  await expect(input(page)).toBeEnabled();
  await send(page, 'Другой вопрос');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Слушаю.');
  expect(calls[1].body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Другой вопрос' }] }]);
  // Строка об отказе остаётся в ленте и после перезагрузки истории.
  const items = (await savedChat(page)).items.map((it) => it.kind);
  expect(items).toEqual(['msg', 'notice', 'msg', 'msg']);
});

test('тег с занятым именем не заводится заново — строка без «нового»', async ({ page }) => {
  await open(page, { signedIn: true });
  await page.evaluate(() => { state.tags.push({ id: 'tg1', name: 'срочно', color: '#ef7a72', projectId: null }); });
  await fn(page, [stream({ tool: { id: 'toolu_tag', name: 'propose_changes', input: { summary: 'Тег', ops: [{ op: 'create_tag', ref: 'g1', name: 'срочно' }] } } })]);
  await openChat(page);
  await send(page, 'Тег');
  const op = page.locator('.ai-card .ai-op');
  await expect(op.locator('.ai-op-kind')).toHaveText('Тег');
  await expect(op.locator('svg[data-icon="check"]')).toHaveCount(1);
});

test('круг инструментов не длиннее четырёх вызовов подряд', async ({ page }) => {
  await open(page, { signedIn: true });
  const loop = stream({ tool: { id: 'toolu_loop', name: 'time_spent', input: { from: '2026-06-08', to: '2026-06-10' } } });
  const calls = await fn(page, [loop]);
  await openChat(page);
  await send(page, 'Сколько я наработал?');
  await expect(input(page)).toBeEnabled();
  expect(calls, 'сообщение и четыре круга').toHaveLength(5);
  await expect(page.locator('.ai-step').first()).toContainText('Записанное время:');
});

test('429 — строка о лимите, без «Повторить»', async ({ page }) => {
  await open(page, { signedIn: true });
  await fn(page, [{ status: 429, json: { error: 'limit', remaining: 0, resetAt: '2026-06-11T00:00:00.000Z' } }]);
  await openChat(page);
  await send(page, 'Привет');
  await expect(page.locator('.ai-error')).toHaveText('На сегодня сообщения агенту закончились. Лимит обновится завтра.');
  await expect(page.locator('.ai-error button')).toHaveCount(0);
  await expect(input(page)).toBeEnabled();
});

test('429 budget — «лимит агента исчерпан», без «Повторить»; счётчик сообщений не трогается', async ({ page }) => {
  // Бюджет по цене (19 октября 2026): функция сверяет сумму цен вызовов за
  // сутки UTC с AI_DAILY_UNITS и до полуночи отвечает 429 budget.
  await open(page, { signedIn: true });
  const calls = await fn(page, [{ status: 429, json: { error: 'budget', retryAfter: 3600 } }]);
  await openChat(page);
  await send(page, 'Ещё вопрос');
  const err = page.locator('.ai-error');
  await expect(err).toHaveText('На сегодня лимит агента исчерпан — он снова заработает завтра.');
  await expect(err.locator('button'), '«Повторить» нет').toHaveCount(0);
  expect(calls).toHaveLength(1);
  await expect(input(page), 'поле снова доступно').toBeEnabled();
  await expect(page.locator('#ai-quota'), 'суточный счётчик сообщений бюджет не трогает').toBeHidden();
  expect(await page.evaluate(() => [ai.remaining, ai.limitUntil]), 'остаток сообщений и срок лимита — как были').toEqual([null, 0]);
  const words = await page.evaluate(() => ['en', 'uk', 'kk'].map((l) => { setLang(l); return t('ai.budget'); }));
  expect(words).toEqual([
    'The agent has reached today’s limit — it will work again tomorrow.',
    'На сьогодні ліміт агента вичерпано — він знову запрацює завтра.',
    'Агенттің бүгінгі лимиті таусылды — ол ертең қайта жұмыс істейді.',
  ]);
});

test('429 rate — «Подождите N с»; «Повторить» откроется, когда время выйдет', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, [{ status: 429, json: { error: 'rate', retryAfter: 1, limit: 6 } }, stream({ text: ['Теперь можно.'] })]);
  await openChat(page);
  await send(page, 'Быстро');
  const err = page.locator('.ai-error');
  await expect(err.locator('span')).toHaveText('Слишком много сообщений подряд. Подождите 1 с.');
  const retry = err.locator('button', { hasText: 'Повторить' });
  await expect(retry, 'пока время не вышло — повторить нельзя').toBeDisabled();
  await expect(page.locator('#ai-quota'), 'суточный счётчик частота не трогает').toBeHidden();
  await expect(retry).toBeEnabled({ timeout: 3000 });
  await retry.click();
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Теперь можно.');
  expect(calls[1].body.messages, 'повтор — то же сообщение').toEqual(calls[0].body.messages);
});

test('сеть упала — «Повторить» спрашивает заново; 404 — агент недоступен; 401 — вход', async ({ page }) => {
  await open(page, { signedIn: true });
  const calls = await fn(page, ['network', stream({ text: ['На месте.'] })]);
  await openChat(page);
  await send(page, 'Ты тут?');
  await expect(page.locator('.ai-error')).toContainText('Не удалось связаться с агентом');
  await page.locator('.ai-error button', { hasText: 'Повторить' }).click();
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('На месте.');
  await expect(page.locator('.ai-error')).toHaveCount(0);
  expect(calls[1].body.messages, 'повтор — то же сообщение, не второе').toEqual(calls[0].body.messages);

  await page.unroute(FN);
  await fn(page, [{ status: 404, json: {} }]);
  await send(page, 'А теперь?');
  await expect(page.locator('.ai-error')).toHaveText('Агент сейчас недоступен.');

  await page.unroute(FN);
  await fn(page, [{ status: 401, json: { error: 'not signed in' } }]);
  await send(page, 'Ещё раз');
  await expect(page.locator('#ai-signin')).toBeVisible();
  await expect(page.locator('#ai-compose')).toBeHidden();
});

test('новый чат — с поля главного экрана; прежний — строкой под полем; пример подставляется в поле', async ({ page }) => {
  await open(page, { signedIn: true });
  await fn(page, [stream({ text: ['Привет!'] })]);
  await openChat(page);
  // Чатов нет: под полем примеры, щелчок — пример в поле, фокус в нём.
  const example = page.locator('#ai-list .ai-examples button').first();
  const text = await example.textContent();
  await example.click();
  await expect(input(page)).toHaveValue(text);
  await expect(input(page)).toBeFocused();
  await expect(page.locator('#ai-hello'), 'пример — ещё не отправка').toBeVisible();

  await input(page).fill('Привет');
  await input(page).press('Enter');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Привет!');
  await expect(page.locator('#ai-hello'), 'отправили — открыт чат').toBeHidden();
  await page.locator('#ai-more').click();
  await expect(page.locator('#ctx-menu .ctx-item'), 'в меню чата «Нового разговора» нет').toHaveText(['Удалить чат']);
  await page.keyboard.press('Escape');
  await page.locator('#ai-back').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
  await expect(page.locator('#ai-title')).toHaveText('Агент');
  await expect(page.locator('#ai-more'), 'на главном удалять нечего').toBeHidden();
  await expect(input(page), 'на главном — поле нового чата, пустое').toHaveValue('');
  await expect(page.locator('#ai-chats .ai-row')).toHaveCount(1);
  await expect(page.locator('#ai-list .ai-examples'), 'чаты есть — примеров нет').toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lancible:ai:u1:chats')).length), 'прежний чат на месте').toBe(1);
});

test('выход — состояние входа, история остаётся; вход тем же аккаунтом — она снова на месте', async ({ page }) => {
  await open(page, { signedIn: true });
  await fn(page, [stream({ text: ['Запомнил.'] })]);
  await openChat(page);
  await send(page, 'Запомни');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Запомнил.');
  await page.evaluate(() => { currentUser = null; renderAccountBtn(); });
  await expect(page.locator('#ai-signin')).toBeVisible();
  await expect(page.locator('#ai-body')).toBeHidden();
  expect(await savedChat(page), 'чат на устройстве остался').toBeTruthy();
  await signIn(page);
  await expect(page.locator('.ai-row'), 'вошёл тем же аккаунтом — его чаты в списке').toHaveCount(1);
  await page.locator('.ai-row-open').click();
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Запомнил.');
});

test('Esc внутри панели закрывает её; открытое меню закрывается первым', async ({ page }) => {
  await open(page, { signedIn: true });
  await fn(page, [stream({ text: ['Здесь.'] })]);
  await openChat(page);
  await send(page, 'Ты здесь?');
  await expect(page.locator('.ai-msg:not(.me)')).toHaveText('Здесь.');
  await page.locator('#ai-more').click();
  await expect(page.locator('#ctx-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ctx-menu')).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await input(page).focus();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#ai-btn'), 'фокус — на кнопку').toBeFocused();
});

for (const width of [1280, 375]) {
  test(`ширина ${width}: чат в острове рейла (узкий — поверх во всю ширину), длинное переносится, без прокрутки вбок`, async ({ page }) => {
    await open(page, { width, height: 812, signedIn: true });
    await fn(page, [stream({ text: ['Очень длинное слово без пробелов: '.repeat(3) + 'ааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааа'], tool: PROPOSAL })]);
    if (width <= 560) {
      await page.locator('#mobile-ai-btn').click();
      await expect(input(page)).toBeVisible();
    } else await openChat(page);
    await send(page, 'Длинный запрос, чтобы проверить перенос строк в узкой панели');
    await expect(page.locator('.ai-card')).toBeVisible();
    const g = await page.evaluate(() => {
      const p = document.getElementById('ai-panel').getBoundingClientRect();
      const bar = document.getElementById('titlebar').getBoundingClientRect();
      const rail = document.getElementById('navrail').getBoundingClientRect();
      const tabbar = document.getElementById('mobile-tabbar').getBoundingClientRect();
      const doc = document.documentElement;
      const inner = [...document.querySelectorAll('#ai-panel *')].filter((n) => n.getBoundingClientRect().right > p.right + 0.5).map((n) => n.className);
      return {
        p: { left: p.left, right: p.right, top: p.top, bottom: p.bottom, width: p.width },
        rail: { left: rail.left, right: rail.right, top: rail.top, bottom: rail.bottom },
        barBottom: bar.bottom, tabTop: tabbar.top, vw: doc.clientWidth, vh: window.innerHeight, scroll: doc.scrollWidth > doc.clientWidth, inner,
      };
    });
    expect(g.scroll, 'страницу не утащить вбок').toBe(false);
    expect(g.inner, 'ничего не вылезает за правый край панели').toEqual([]);
    expect(Math.abs(g.p.top - g.barBottom), 'под шапкой').toBeLessThanOrEqual(1);
    if (width <= 560) {
      expect(g.p.left, 'на телефоне — во всю ширину').toBe(0);
      expect(Math.abs(g.p.right - g.vw)).toBeLessThanOrEqual(1);
      expect(Math.abs(g.p.bottom - g.tabTop), 'до нижней плашки').toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(g.p.right - g.rail.right), 'правый край — край острова рейла').toBeLessThanOrEqual(1);
      expect(Math.abs(g.p.bottom - g.rail.bottom), 'до низа острова').toBeLessThanOrEqual(1);
      expect(Math.abs(g.p.left - g.rail.left - 52), 'левее — колонка значков рейла').toBeLessThanOrEqual(1);
      expect(g.p.width).toBe(380);
    }
  });
}

test('цвета панели — токены темы, в обеих темах; системных <select> нет', async ({ page }) => {
  await open(page, { signedIn: true });
  await fn(page, [stream({ text: ['Вот.'], tool: PROPOSAL })]);
  await openChat(page);
  await send(page, 'Покажи');
  await expect(page.locator('.ai-card')).toBeVisible();
  for (const theme of ['dark', 'light']) {
    const c = await page.evaluate((th) => {
      document.documentElement.dataset.theme = th;
      const probe = (token) => {
        const d = document.createElement('div');
        d.style.background = `var(${token})`;
        document.body.append(d);
        const v = getComputedStyle(d).backgroundColor;
        d.remove();
        return v;
      };
      const bg = (s) => getComputedStyle(document.querySelector(s)).backgroundColor;
      return {
        panel: [bg('#ai-panel'), probe('--rail')],
        me: [bg('.ai-msg.me'), probe('--panel-2')],
        card: [bg('.ai-card'), probe('--panel-2')],
        selects: document.querySelectorAll('#ai-panel select').length,
      };
    }, theme);
    expect(c.panel[0], `${theme}: чат — остров рейла, --rail`).toBe(c.panel[1]);
    expect(c.me[0], `${theme}: сообщение человека — --panel-2`).toBe(c.me[1]);
    expect(c.card[0], `${theme}: карточка — --panel-2`).toBe(c.card[1]);
    expect(c.selects).toBe(0);
  }
});

// --- Появление сообщений (18 октября 2026) ----------------------------------------
//
// Пользователь попросил красивое появление сообщений чата: человек въезжает
// справа снизу, ответ модели — слева, карточка предложения поднимается,
// «думает» — три точки волной; поток ответа — без дёрганья. История при
// открытии панели стоит сразу: появляется только новое.

/** Записывать, какие строки ленты появились и с каким классом и анимацией. */
const watchLog = (page) => page.evaluate(() => {
  window.__aiAdded = [];
  new MutationObserver((list) => {
    for (const m of list) {
      // Лента за один ход перерисовывается не раз: стиль есть только у той
      // строки, что ещё на странице.
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) window.__aiAdded.push({ cls: n.className, anim: n.isConnected ? getComputedStyle(n).animationName : null });
      }
    }
  }).observe(document.getElementById('ai-log'), { childList: true });
});
const added = (page) => page.evaluate(() => window.__aiAdded.splice(0));
const kindOf = (cls) => (/\bai-msg\b/.test(cls) ? (/\bme\b/.test(cls) ? 'me' : 'bot') : /\bai-card\b/.test(cls) ? 'card' : /\bai-typing\b/.test(cls) ? 'typing' : 'other');

test('появление: человек — справа, модель — слева, карточка поднимается; история при открытии — сразу', async ({ page }) => {
  await open(page, { signedIn: true, motion: true });
  await fn(page, [stream({ text: PROPOSAL_TEXT, tool: PROPOSAL })]);
  await openChat(page);
  await watchLog(page);
  await send(page, 'Заведи проект «Сайт» и задачу на пятницу');
  await expect(page.locator('.ai-card')).toBeVisible();
  const fresh = await added(page);
  // Первое появление каждой строки — с классом и своей анимацией.
  const firstOf = (kind) => fresh.find((x) => kindOf(x.cls) === kind && x.anim !== null);
  expect(firstOf('me').cls).toContain('ai-in');
  expect(firstOf('me').anim).toBe('aiInMe');
  expect(firstOf('bot').cls).toContain('ai-in');
  expect(firstOf('bot').anim).toBe('aiInBot');
  expect(firstOf('card').cls).toContain('ai-in');
  expect(firstOf('card').anim).toBe('aiInCard');
  expect(firstOf('typing'), 'пока ждали ответа — три точки').toBeTruthy();
  // Когда всё встало, на строках нет класса появления: перерисовка не переигрывает.
  await page.waitForTimeout(400);
  await page.evaluate(() => aiRenderLog());
  const again = await added(page);
  expect(again.length).toBeGreaterThan(2);
  expect(again.filter((x) => /\bai-in\b/.test(x.cls)), 'перерисовка ленты без появления').toEqual([]);

  // Закрыли и открыли (на главном экране), вошли в чат — история встаёт сразу.
  await page.locator('#ai-close').click();
  await page.locator('#ai-btn').click();
  await page.locator('.ai-row-open').click();
  await expect(page.locator('.ai-card')).toBeVisible();
  const reopened = await added(page);
  expect(reopened.length).toBeGreaterThan(2);
  expect(reopened.filter((x) => /\bai-in\b/.test(x.cls)), 'история без анимации').toEqual([]);
});

test('три точки — волна: у каждой точки своя задержка, перерисовка волну не сбрасывает', async ({ page }) => {
  await open(page, { signedIn: true, motion: true });
  await openEmptyChat(page);
  const m = await page.evaluate(async () => {
    ai.busy = true;
    ai.busyChat = ai.chat;
    ai.waiting = true;
    aiRenderLog();
    const read = () => [...document.querySelectorAll('.ai-typing i')].map((n) => {
      const a = n.getAnimations()[0];
      return { name: a && a.animationName, delay: parseFloat(getComputedStyle(n).animationDelay) };
    });
    const first = read();
    await new Promise((r) => setTimeout(r, 300));
    aiRenderLog();
    const later = read();
    ai.busy = false;
    ai.busyChat = null;
    ai.waiting = false;
    aiRenderLog();
    return { first, later };
  });
  expect(m.first.map((d) => d.name)).toEqual(['aiDot', 'aiDot', 'aiDot']);
  expect(new Set(m.first.map((x) => x.delay)).size, 'задержки разные — волна').toBe(3);
  expect(m.first[1].delay - m.first[0].delay).toBeCloseTo(0.15, 2);
  // Новые точки после перерисовки идут не с нуля, а с того же места волны:
  // задержка сдвинута назад на то время, что точки уже идут (~0,3 с).
  expect(m.later[0].delay, 'волна продолжается').toBeLessThan(m.first[0].delay - 0.2);
  expect(m.later[1].delay - m.later[0].delay).toBeCloseTo(0.15, 2);
});

test('поток растёт плавно; лента едет вниз, только если человек и так внизу', async ({ page }) => {
  await open(page, { signedIn: true, motion: true, height: 600 });
  await openEmptyChat(page);
  // Длинная история — лента прокручивается.
  await page.evaluate(() => {
    for (let i = 0; i < 24; i += 1) ai.chat.items.push({ kind: 'msg', role: i % 2 ? 'assistant' : 'user', text: `Сообщение ${i}` });
    aiHush();
    aiRender(true);
  });
  const atEnd = () => page.evaluate(() => { const l = document.getElementById('ai-log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 2; });
  expect(await atEnd()).toBe(true);

  const grow = await page.evaluate(async () => {
    ai.busy = true;
    aiLiveText({ text: 'Первая строка ответа.' });
    const node = ai.liveNode;
    const h0 = node.getBoundingClientRect().height;
    aiLiveText({ text: 'Первая строка ответа.\n\nВторая — новым абзацем.\n\nИ третья.' });
    const h1 = node.getBoundingClientRect().height;
    const frames = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 350) {
      await new Promise((r) => requestAnimationFrame(r));
      frames.push(node.getBoundingClientRect().height);
    }
    const natural = (() => { const c = node.cloneNode(true); c.style.height = ''; c.classList.remove('ai-grow'); node.after(c); const h = c.getBoundingClientRect().height; c.remove(); return h; })();
    return { h0, h1, frames, natural, styleH: node.style.height };
  });
  expect(grow.h1, 'в миг новой строки высота прежняя').toBeCloseTo(grow.h0, 0);
  expect(grow.frames.some((h) => h > grow.h0 + 2 && h < grow.natural - 2), 'высота едет, а не прыгает').toBe(true);
  expect(grow.frames.at(-1)).toBeCloseTo(grow.natural, 0);
  expect(grow.styleH, 'доросла — высота снова своя').toBe('');
  expect(await atEnd(), 'человек был внизу — лента за ответом').toBe(true);

  // Прокрутил вверх — новые строки ленту не тянут.
  const kept = await page.evaluate(async () => {
    const log = document.getElementById('ai-log');
    log.scrollTop = 0;
    aiLiveText({ text: 'Первая строка ответа.\n\nВторая — новым абзацем.\n\nИ третья.\n\nЧетвёртая.' });
    await new Promise((r) => setTimeout(r, 350));
    const top = log.scrollTop;
    ai.busy = false;
    ai.live = null;
    return top;
  });
  expect(kept).toBe(0);
});

test('без движения — новое в ленте без появления, ответ сразу во всю высоту', async ({ page }) => {
  await open(page, { signedIn: true, motion: true, reduce: true });
  await fn(page, [stream({ text: ['Готово.'], tool: PROPOSAL })]);
  await openChat(page);
  await watchLog(page);
  await send(page, 'Покажи');
  await expect(page.locator('.ai-card')).toBeVisible();
  const fresh = await added(page);
  expect(fresh.length).toBeGreaterThan(2);
  expect(fresh.filter((x) => /\bai-in\b/.test(x.cls))).toEqual([]);
  const live = await page.evaluate(() => {
    ai.busy = true;
    aiLiveText({ text: 'Раз.' });
    aiLiveText({ text: 'Раз.\n\nДва.' });
    const n = ai.liveNode;
    const out = { h: n.style.height, grow: n.classList.contains('ai-grow') };
    ai.busy = false;
    ai.live = null;
    return out;
  });
  expect(live).toEqual({ h: '', grow: false });
});

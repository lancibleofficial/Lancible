// Разделы админки рисуют то, что прислала функция admin, и шлют ей ровно то,
// что нужно. Сеть подменена (mock.js), вход — готовым сеансом aal2.
const { test, expect } = require('./mock');

/** Текст без различий в пробелах: ru-RU делит разряды неразрывным пробелом. */
const flat = (s) => s.replace(/\s+/g, ' ').trim();

test.describe('Обзор', () => {
  test('карточки и графики из ответа, период 7/30/90', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/overview');
    const stat = (id) => page.locator(`.stat[data-stat="${id}"] .stat-value`);
    await expect(stat('users')).toHaveText(/^1\s287$/);
    await expect(stat('logins')).toHaveText('77');
    await expect(stat('active')).toHaveText('64');
    await expect(stat('projects')).toHaveText(/^5\s320$/);
    await expect(stat('tasks')).toHaveText(/^48\s211$/);
    await expect(stat('feedback')).toHaveText('7');
    await expect(stat('ai')).toHaveText('512');
    expect(flat(await page.locator('.stat[data-stat="active"] .stat-sub').innerText())).toBe('за неделю 300 · за месяц 911');
    for (const id of ['users', 'logins', 'active', 'projects', 'tasks']) {
      await expect(page.locator(`[data-chart="${id}"] .ch-bar`)).toHaveCount(30);
    }
    // Подписи осей — текстом в SVG, классом с токеном.
    await expect(page.locator('[data-chart="users"] .ch-label').first()).toBeVisible();
    expect(flat(await page.locator('[data-chart="platforms"]').innerText())).toContain('Android 420');
    expect(backend.callsOf('overview').map((c) => c.days)).toEqual([30]);

    await page.locator('#overview-range button', { hasText: '7 дней' }).click();
    await expect(page.locator('[data-chart="users"] .ch-bar')).toHaveCount(7);
    await page.locator('#overview-range button', { hasText: '90 дней' }).click();
    await expect(page.locator('[data-chart="tasks"] .ch-bar')).toHaveCount(90);
    expect(backend.callsOf('overview').map((c) => c.days)).toEqual([30, 7, 90]);
  });
});

test.describe('Экраны', () => {
  test('частые, редкие и ни разу — по платформам', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/screens');
    const top = page.locator('[data-list="top"]');
    await expect(top).toContainText('Сегодня');
    await expect(top.locator('.bar-row').first()).toContainText('today');
    const rare = page.locator('[data-list="rare"]');
    await expect(rare).toContainText('Настройки: о приложении');
    // Экран, которого нет в admin/screens.js, — с пометкой.
    await expect(rare.locator('.bar-row', { hasText: 'mystery' })).toContainText('нет в списке');
    await expect(page.locator('[data-list="never"]')).toContainText('Задача: окно');
    await expect(page.locator('[data-list="never"]')).not.toContainText('Сегодня');

    await page.locator('#screens-platform button', { hasText: 'Android' }).click();
    await expect(top).toContainText('Задачи');
    await expect(page.locator('[data-list="never"]')).toContainText('Меню');
    await expect(page.locator('[data-list="never"]')).not.toContainText('Задачи');
    // Платформа переключается без нового запроса — данные уже есть.
    expect(backend.callsOf('screens')).toHaveLength(1);
  });

  test('пусто — понятное пустое состояние', async ({ page, open }) => {
    await open({ signedIn: 'aal2', handlers: { screens: () => ({ rows: [] }) } });
    await page.goto('/#/screens');
    await expect(page.locator('[data-list="top"] .empty-state')).toContainText('За этот период экраны не открывали');
  });
});

test.describe('Пользователи', () => {
  test('таблица, поиск, карточка', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/users');
    const rows = page.locator('#users-table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('anna@example.test');
    await expect(rows.first()).toContainText('Google');
    await expect(page.locator('#users-count')).toHaveText('всего 2');

    await page.locator('#users-search').fill('boris');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('boris@example.test');
    expect(backend.callsOf('users').at(-1)).toMatchObject({ q: 'boris', page: 1, per: 50 });

    await page.locator('#users-search').fill('nobody');
    await expect(page.locator('.empty-state')).toContainText('Никого не нашлось');

    await page.locator('#users-search').fill('');
    await expect(rows).toHaveCount(2);
    await rows.first().click();
    await expect(page.locator('.page-title')).toHaveText('anna@example.test');
    expect(backend.callsOf('user').at(-1)).toMatchObject({ id: 'u-1' });
    await expect(page.locator('[data-list="user-feedback"]')).toContainText('Таймер сбивается после сна');
    await expect(page.locator('[data-list="user-ai"]')).toContainText('claude-sonnet-5-5');
    await expect(page.locator('[data-list="user-screens"]')).toContainText('Сегодня');
    await expect(page.locator('[data-list="user-screens"]')).toContainText('Задачи');
    await expect(page.locator('.dl')).toContainText('Google, почта');
    await page.getByRole('link', { name: '← Все пользователи' }).click();
    await expect(page.locator('#users-table')).toBeVisible();
  });

  // Доступ к агенту выдаётся и забирается прямо из списка: почта — аккаунта
  // этой строки, не ввод руками.
  test('доступ к агенту из строки: выдать (кнопка неактивна, пока идёт запрос), забрать с подтверждением', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/users');
    const row = (id) => page.locator(`#users-table tbody tr[data-id="${id}"]`);
    const btn = (id) => row(id).locator('[data-action="access"]');
    await expect(row('u-2').locator('.chip')).toHaveText('нет');
    await expect(btn('u-2')).toHaveText('Дать доступ к агенту');
    await expect(row('u-1').locator('.chip')).toHaveText('есть');
    await expect(btn('u-1')).toHaveText('Забрать доступ');

    // Ответ придёт, когда тест разрешит: между этим кнопка занята.
    const real = backend.handlers['access.add'];
    let release;
    const gate = new Promise((r) => { release = r; });
    backend.handlers['access.add'] = async (p, b) => { await gate; return real(p, b); };
    await btn('u-2').click();
    await expect(btn('u-2')).toBeDisabled();
    release();
    await expect(row('u-2').locator('.chip')).toHaveText('есть');
    await expect(btn('u-2')).toHaveText('Забрать доступ');
    await expect(btn('u-2')).toBeEnabled();
    await expect(page.locator('#toast')).toHaveText('Доступ выдан');
    expect(backend.callsOf('access.add')).toEqual([{ action: 'access.add', email: 'boris@example.test', note: 'из списка пользователей' }]);
    // Кнопка — не переход: остались в списке, список заново не грузили.
    await expect(page).toHaveURL(/#\/users$/);
    expect(backend.callsOf('users')).toHaveLength(1);

    // Выданное видно в «Агент и API» — с пометкой и признаком «аккаунт есть».
    await page.goto('/#/agent');
    const given = page.locator('#access-list .access-row[data-email="boris@example.test"]');
    await expect(given).toContainText('из списка пользователей');
    await expect(given.locator('.chip')).toHaveText('аккаунт есть');
    await page.goto('/#/users');

    // Забрать: сначала подтверждение; отмена — ничего не уходит.
    await btn('u-2').click();
    await expect(page.locator('#confirm-backdrop')).toBeVisible();
    await expect(page.locator('#confirm-backdrop')).toContainText('boris@example.test');
    await page.locator('[data-confirm="cancel"]').click();
    await expect(page.locator('#confirm-backdrop')).toHaveCount(0);
    expect(backend.callsOf('access.remove')).toEqual([]);
    await expect(row('u-2').locator('.chip')).toHaveText('есть');

    await btn('u-2').click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(row('u-2').locator('.chip')).toHaveText('нет');
    await expect(btn('u-2')).toHaveText('Дать доступ к агенту');
    await expect(page.locator('#toast')).toHaveText('Доступ закрыт');
    expect(backend.callsOf('access.remove')).toEqual([{ action: 'access.remove', email: 'boris@example.test' }]);
    // Чужая строка не тронута.
    await expect(row('u-1').locator('.chip')).toHaveText('есть');
  });

  test('доступ к агенту из карточки: выдать и забрать с подтверждением', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/users/u-2');
    await expect(page.locator('.page-title')).toHaveText('boris@example.test');
    const cell = page.locator('.dl [data-role="access"]');
    const btn = cell.locator('[data-action="access"]');
    await expect(cell.locator('.chip')).toHaveText('нет');
    await expect(btn).toHaveText('Дать доступ к агенту');

    await btn.click();
    await expect(cell.locator('.chip')).toHaveText('есть');
    await expect(btn).toHaveText('Забрать доступ');
    expect(backend.callsOf('access.add')).toEqual([{ action: 'access.add', email: 'boris@example.test', note: 'из списка пользователей' }]);
    // Карточку заново не грузили — обновились метка и кнопка.
    expect(backend.callsOf('user')).toHaveLength(1);

    await btn.click();
    await expect(page.locator('#confirm-backdrop')).toBeVisible();
    await page.locator('[data-confirm="cancel"]').click();
    expect(backend.callsOf('access.remove')).toEqual([]);
    await expect(cell.locator('.chip')).toHaveText('есть');
    await btn.click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(cell.locator('.chip')).toHaveText('нет');
    await expect(btn).toHaveText('Дать доступ к агенту');
    expect(backend.callsOf('access.remove')).toEqual([{ action: 'access.remove', email: 'boris@example.test' }]);

    // Вернулись к списку — в строке то же, что в карточке (список читается заново).
    await page.getByRole('link', { name: '← Все пользователи' }).click();
    await expect(page.locator('#users-table tbody tr[data-id="u-2"] .chip')).toHaveText('нет');
  });

  test('доступ к агенту: ошибка функции — строка ошибки, метка и кнопка прежние', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    backend.handlers['access.add'] = () => ({ __status: 500, body: { error: 'db', code: '57014' } });
    backend.handlers['access.remove'] = () => ({ __status: 500, body: { error: 'db', code: '57014' } });
    await page.goto('/#/users');
    const row = (id) => page.locator(`#users-table tbody tr[data-id="${id}"]`);
    await row('u-2').locator('[data-action="access"]').click();
    await expect(page.locator('#toast')).toHaveText('База ответила ошибкой. Попробуйте ещё раз.');
    await expect(row('u-2').locator('.chip')).toHaveText('нет');
    await expect(row('u-2').locator('[data-action="access"]')).toHaveText('Дать доступ к агенту');
    await expect(row('u-2').locator('[data-action="access"]')).toBeEnabled();

    // То же — из карточки, на «забрать».
    await page.goto('/#/users/u-1');
    const cell = page.locator('.dl [data-role="access"]');
    await cell.locator('[data-action="access"]').click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('База ответила ошибкой. Попробуйте ещё раз.');
    await expect(cell.locator('.chip')).toHaveText('есть');
    await expect(cell.locator('[data-action="access"]')).toHaveText('Забрать доступ');
    await expect(cell.locator('[data-action="access"]')).toBeEnabled();
  });

  test('аккаунт без почты — только метка, кнопки доступа нет', async ({ page, open }) => {
    await open({ signedIn: 'aal2', handlers: { users: () => ({ total: 1, page: 1, per: 50, rows: [{ id: 'u-9', email: null, createdAt: '2026-10-01T10:00:00Z', provider: 'phone', aiAccess: false, projects: 0, tasks: 0, feedback: 0, aiCalls7: 0 }] }) } });
    await page.goto('/#/users');
    const row = page.locator('#users-table tbody tr[data-id="u-9"]');
    await expect(row.locator('.chip')).toHaveText('нет');
    await expect(row.locator('[data-action="access"]')).toHaveCount(0);
  });

  test('фильтр: все, с доступом к агенту, без доступа — на сервере, с поиском и с первой страницы', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/users');
    const rows = page.locator('#users-table tbody tr');
    const filter = page.locator('#users-filter');
    await expect(filter.locator('button')).toHaveText(['Все', 'С доступом к агенту', 'Без доступа']);
    await expect(filter.locator('button.on')).toHaveText('Все');
    await expect(rows).toHaveCount(2);
    expect(backend.callsOf('users').at(-1)).not.toHaveProperty('access');

    await filter.getByRole('button', { name: 'С доступом к агенту' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('anna@example.test');
    await expect(page.locator('#users-count')).toHaveText('всего 1');
    expect(backend.callsOf('users').at(-1)).toMatchObject({ access: 'yes', page: 1, per: 50 });

    await filter.getByRole('button', { name: 'Без доступа' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('boris@example.test');
    expect(backend.callsOf('users').at(-1)).toMatchObject({ access: 'no', page: 1 });
    await expect(filter.locator('button.on')).toHaveText('Без доступа');

    // Фильтр и поиск работают вместе.
    await page.locator('#users-search').fill('anna');
    await expect(page.locator('.empty-state')).toContainText('Никого не нашлось');
    expect(backend.callsOf('users').at(-1)).toMatchObject({ q: 'anna', access: 'no' });
    await page.locator('#users-search').fill('');
    await expect(rows).toHaveCount(1);

    // Выдали доступ — «С доступом» теперь двое.
    await rows.first().locator('[data-action="access"]').click();
    await expect(rows.first().locator('.chip')).toHaveText('есть');
    await filter.getByRole('button', { name: 'С доступом к агенту' }).click();
    await expect(rows).toHaveCount(2);

    await filter.getByRole('button', { name: 'Все' }).click();
    await expect(rows).toHaveCount(2);
    expect(backend.callsOf('users').at(-1)).not.toHaveProperty('access');
  });
});

test.describe('Обратная связь', () => {
  test('ответ уходит с телом и обновляет статус', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/feedback');
    const card = page.locator('.fb-card[data-id="f-1"]');
    await expect(card).toContainText('Таймер сбивается после сна');
    expect(backend.callsOf('feedback.list').at(-1)).toMatchObject({ status: 'new', page: 1 });
    await expect(card).toContainText('anna@example.test');
    await expect(card.locator('[data-role="status"]')).toHaveText('Новый');
    const shot = card.locator('.shot-link');
    await expect(shot).toHaveAttribute('target', '_blank');
    await expect(shot).toHaveAttribute('rel', /noopener/);
    await expect(shot).toHaveAttribute('href', /\/storage\/v1\/object\/sign\//);

    const send = card.locator('[data-action="reply"]');
    await expect(send).toBeDisabled();
    await card.locator('.reply-field').fill('Спасибо! Починили в 0.5.2.');
    await send.click();
    await expect(card.locator('.reply-result')).toHaveText('Письмо отправлено.');
    await expect(card.locator('[data-role="status"]')).toHaveText('Отвечен');
    await expect(card.locator('.reply')).toContainText('Спасибо! Починили в 0.5.2.');
    await expect(card.locator('.reply')).toContainText('письмо ушло');
    expect(backend.callsOf('feedback.reply')).toEqual([{ action: 'feedback.reply', id: 'f-1', body: 'Спасибо! Починили в 0.5.2.' }]);
  });

  test('почта не настроена — ответ сохранён, статус прежний, сказано почему', async ({ page, open }) => {
    await open({ signedIn: 'aal2', handlers: { 'feedback.reply': ({ body }) => ({ emailStatus: 'not_configured', reply: { body, emailStatus: 'not_configured' } }) } });
    await page.goto('/#/feedback');
    const card = page.locator('.fb-card[data-id="f-1"]');
    await card.locator('.reply-field').fill('Ответ');
    await card.locator('[data-action="reply"]').click();
    await expect(card.locator('.reply-result')).toContainText('RESEND_API_KEY');
    await expect(card.locator('[data-role="status"]')).toHaveText('Новый');
  });

  test('гостю ответить нельзя, статус сменить можно', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/feedback');
    const card = page.locator('.fb-card[data-id="f-2"]');
    await expect(card).toContainText('Гость — без почты');
    await expect(card.locator('.reply-field')).toBeDisabled();
    await expect(card.locator('[data-action="reply"]')).toBeDisabled();
    await expect(card.locator('[data-role="guest-note"]')).toContainText('ответить письмом нельзя');

    await card.locator('[data-action="status"]').click();
    await page.locator('#ctx-menu .ctx-item', { hasText: 'Закрыт' }).click();
    await expect(card.locator('[data-role="status"]')).toHaveText('Закрыт');
    expect(backend.callsOf('feedback.status')).toEqual([{ action: 'feedback.status', id: 'f-2', status: 'closed' }]);
    expect(backend.callsOf('feedback.reply')).toEqual([]);
  });

  test('фильтр по статусу и пустое состояние', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2', handlers: { 'feedback.list': ({ status }) => (status === 'closed' ? { total: 0, rows: [] } : { total: 0, rows: [] }) } });
    await page.goto('/#/feedback');
    await expect(page.locator('.empty-state')).toContainText('Новых отзывов нет');
    await page.locator('#feedback-filter button', { hasText: 'Все' }).click();
    await expect(page.locator('.empty-state')).toContainText('Здесь пусто');
    expect(backend.callsOf('feedback.list').at(-1)).not.toHaveProperty('status');
  });
});

test.describe('Агент и API', () => {
  test('сохранение настроек отправляет только разрешённые поля', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/agent');
    const save = page.locator('#ai-save');
    await expect(save).toBeDisabled();
    // Откуда значение сейчас — из ответа функции (source).
    await expect(page.locator('[data-source="dailyLimit"]')).toHaveText('из секрета функции');
    await expect(page.locator('[data-source="model"]')).toHaveText('по умолчанию');
    await page.locator('#ai-model').click();
    await page.locator('#ctx-menu .ctx-item', { hasText: 'claude-opus-5-5' }).click();
    await page.locator('#ai-effort button', { hasText: 'Высокое' }).click();
    await page.locator('#ai-limit').fill('abc');
    await save.click();
    await expect(page.locator('#ai-settings .form-error')).toContainText('целое число от 1 до 1');
    expect(backend.callsOf('settings.set')).toEqual([]);

    await page.locator('#ai-limit').fill('80');
    await save.click();
    await expect(page.locator('#toast')).toHaveText('Настройки агента сохранены');
    await expect(page.locator('[data-source="dailyLimit"]')).toHaveText('из админки');
    const sent = backend.callsOf('settings.set');
    expect(sent).toEqual([{ action: 'settings.set', ai: { model: 'claude-opus-5-5', effort: 'high', dailyLimit: 80, dailyUnits: 4000000 } }]);
    expect(Object.keys(sent[0].ai).sort()).toEqual(['dailyLimit', 'dailyUnits', 'effort', 'model']);
    await expect(save).toBeDisabled();
  });

  test('ключи — только «задан / не задан»', async ({ page, open }) => {
    await open({ signedIn: 'aal2', handlers: {
      // Функция по ошибке прислала значение — админка его не показывает.
      'settings.get': () => ({ ai: { model: 'claude-sonnet-5-5', effort: 'medium', dailyLimit: 50, dailyUnits: 4000000 }, secrets: { ANTHROPIC_API_KEY: 'sk-ant-SECRET-VALUE', RESEND_API_KEY: false } }),
    } });
    await page.goto('/#/agent');
    await expect(page.locator('[data-secret="ANTHROPIC_API_KEY"] .chip')).toHaveText('задан');
    await expect(page.locator('[data-secret="RESEND_API_KEY"] .chip')).toHaveText('не задан');
    expect(await page.locator('body').innerText()).not.toContain('SECRET-VALUE');
  });

  test('добавление и удаление доступа к агенту', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/agent');
    const list = page.locator('#access-list');
    await expect(list.locator('.access-row')).toHaveCount(1);
    await expect(list).toContainText('anna@example.test');

    // Почта с аккаунтом — без вопросов; регистр и пробелы приводятся.
    await page.locator('#access-email').fill(' Boris@Example.test ');
    await page.locator('#access-note').fill('тестировщик');
    await page.locator('#access-add').click();
    await expect(list.locator('.access-row')).toHaveCount(2);
    await expect(list).toContainText('boris@example.test');
    await expect(page.locator('#confirm-backdrop')).toHaveCount(0);
    await expect(list.locator('.access-row[data-email="boris@example.test"] .chip')).toHaveText('аккаунт есть');
    await expect(list.locator('.access-row[data-email="anna@example.test"] .chip')).toHaveText('аккаунт есть');
    expect(backend.callsOf('access.add')).toEqual([{ action: 'access.add', email: 'boris@example.test', note: 'тестировщик', requireAccount: true }]);

    const anna = list.locator('.access-row[data-email="anna@example.test"]');
    await anna.locator('[data-action="remove"]').click();
    await expect(page.locator('#confirm-backdrop')).toBeVisible();
    await page.locator('[data-confirm="cancel"]').click();
    await expect(page.locator('#confirm-backdrop')).toHaveCount(0);
    expect(backend.callsOf('access.remove')).toEqual([]);

    await anna.locator('[data-action="remove"]').click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(list.locator('.access-row')).toHaveCount(1);
    await expect(list).not.toContainText('anna@example.test');
    expect(backend.callsOf('access.remove')).toEqual([{ action: 'access.remove', email: 'anna@example.test' }]);
  });

  // Подтверждение почты в проекте выключено (аудит): доступ, выданный почте без
  // аккаунта, получит тот, кто первым на неё зарегистрируется. Поэтому — вопрос.
  test('почта без аккаунта: предупреждение и подтверждение; отмена ничего не выдаёт', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/agent');
    const list = page.locator('#access-list');
    await page.locator('#access-email').fill(' New@Example.test ');
    await page.locator('#access-note').fill('друг');
    await page.locator('#access-add').click();
    const dialog = page.locator('#confirm-backdrop');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Аккаунта с этой почтой нет: доступ получит тот, кто первым на неё зарегистрируется.');

    // Отмена: ничего не выдано, поля остались — можно поправить почту.
    await page.locator('[data-confirm="cancel"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(list.locator('.access-row')).toHaveCount(1);
    await expect(page.locator('#access-email')).not.toHaveValue('');
    await expect(page.locator('#access-note')).toHaveValue('друг');
    await expect(page.locator('#access-add')).toBeEnabled();
    expect(backend.callsOf('access.add')).toEqual([{ action: 'access.add', email: 'new@example.test', note: 'друг', requireAccount: true }]);

    // Подтверждение: второй запрос — без флага, и строка помечена «аккаунта нет».
    await page.locator('#access-add').click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(list.locator('.access-row')).toHaveCount(2);
    await expect(list.locator('.access-row[data-email="new@example.test"] .chip')).toHaveText('аккаунта нет');
    await expect(page.locator('#access-email')).toHaveValue('');
    expect(backend.callsOf('access.add')).toEqual([
      { action: 'access.add', email: 'new@example.test', note: 'друг', requireAccount: true },
      { action: 'access.add', email: 'new@example.test', note: 'друг', requireAccount: true },
      { action: 'access.add', email: 'new@example.test', note: 'друг' },
    ]);
  });

  test('доступ к агенту: сбой функции при добавлении — строка ошибки, вопроса нет, запись не появилась', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    backend.handlers['access.add'] = () => ({ __status: 500, body: { error: 'db', code: '57014' } });
    await page.goto('/#/agent');
    await page.locator('#access-email').fill('boris@example.test');
    await page.locator('#access-add').click();
    await expect(page.locator('#ai-access .form-error')).toHaveText('База ответила ошибкой. Попробуйте ещё раз.');
    await expect(page.locator('#confirm-backdrop')).toHaveCount(0);
    await expect(page.locator('#access-list .access-row')).toHaveCount(1);
    expect(backend.callsOf('access.add')).toHaveLength(1);
  });
});

test.describe('Блог', () => {
  test('список постов и редактор существующего', async ({ page, open }) => {
    await open({ signedIn: 'aal2' });
    await page.goto('/#/blog');
    const row = page.locator('#posts-table tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('ИИ-агент — в закрытом тесте');
    await expect(row).toContainText('Опубликован');
    await row.click();
    await expect(page.locator('#post-title-ru')).toHaveValue('ИИ-агент — в закрытом тесте');
    await expect(page.locator('#post-body-ru')).toHaveValue('Первый абзац.\n\nВторой абзац.');
    await expect(page.locator('#post-preview .post-p')).toHaveCount(2);
    await expect(page.locator('#post-publish')).toHaveText('Снять с публикации');
  });

  test('редактор поста сохраняет обе локали', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/blog/new');
    await page.locator('#post-date').fill('2026-10-23');
    await page.locator('#post-tag button', { hasText: 'Новое' }).click();
    await page.locator('#post-version').fill('0.5.2');
    await page.locator('#post-title-ru').fill('Админка');
    await page.locator('#post-body-ru').fill('Первый абзац.\n\nВторой абзац.');
    await expect(page.locator('#post-preview .post-title')).toHaveText('Админка');

    // Без английской версии опубликовать нельзя.
    await page.locator('#post-publish').click();
    await expect(page.locator('#post-form .form-error')).toContainText('английской');
    expect(backend.callsOf('posts.save')).toEqual([]);

    await page.locator('#post-lang button', { hasText: 'English' }).click();
    await expect(page.locator('#post-title-ru')).toBeHidden();
    await page.locator('#post-title-en').fill('Admin panel');
    await page.locator('#post-body-en').fill('One paragraph.');
    await expect(page.locator('#post-preview .post-title')).toHaveText('Admin panel');

    await page.locator('#post-save').click();
    await expect(page.locator('#toast')).toHaveText('Пост сохранён');
    const [first] = backend.callsOf('posts.save');
    expect(first.post).toEqual({
      date: '2026-10-23', tag: 'feature', version: '0.5.2',
      title: { ru: 'Админка', en: 'Admin panel' },
      body: { ru: ['Первый абзац.', 'Второй абзац.'], en: ['One paragraph.'] },
      published: false,
    });
    await expect(page).toHaveURL(/#\/blog\/p-new$/);
    await expect(page.locator('#post-status')).toHaveText('Черновик');

    await page.locator('#post-publish').click();
    await expect(page.locator('#post-status')).toHaveText('Опубликован');
    const second = backend.callsOf('posts.save')[1].post;
    expect(second).toMatchObject({ id: 'p-new', published: true, title: { ru: 'Админка', en: 'Admin panel' } });
  });

  test('удаление поста — с подтверждением', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/blog/p-1');
    await page.locator('#post-delete').click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(page).toHaveURL(/#\/blog$/);
    expect(backend.callsOf('posts.delete')).toEqual([{ action: 'posts.delete', id: 'p-1' }]);
  });

  test('постов нет — пустое состояние с кнопкой, кнопка шапки спрятана', async ({ page, open }) => {
    await open({ signedIn: 'aal2', handlers: { 'posts.list': () => ({ rows: [] }) } });
    await page.goto('/#/blog');
    await expect(page.locator('.empty-state')).toContainText('Постов пока нет');
    await expect(page.locator('#post-new')).toBeHidden();
    await expect(page.locator('.empty-state a', { hasText: 'Новый пост' })).toBeVisible();
  });
});

test.describe('Выпуски', () => {
  test('что выпущено и лента работ последних запусков', async ({ page, open }) => {
    await open({ signedIn: 'aal2' });
    await page.goto('/#/releases');
    const now = page.locator('#release-now');
    await expect(now).toContainText('0.5.1');
    await expect(now).toContainText('1.3.1');
    // latest.json отстал от main — помечен.
    await expect(now.locator('.chip.warn', { hasText: '1.3.0' })).toBeVisible();

    const runs = page.locator('#release-runs .run');
    await expect(runs).toHaveCount(2);
    const failed = runs.first();
    await expect(failed.locator('[data-role="run-state"]')).toHaveText('упал');
    await expect(failed.locator('.step')).toHaveCount(10);
    await expect(failed.locator('.step.st-ok')).toHaveCount(5);
    const phone = failed.locator('.step[data-job="Сборка телефона"]');
    await expect(phone).toHaveClass(/st-danger/);
    await expect(phone.locator('.step-fail')).toHaveText('шаг «Сборка APK (EAS)»');
    // Упал после «Версий и тегов» — подсказка перезапустить упавшие работы.
    const hint = failed.locator('[data-hint="rerun"]');
    await expect(hint).toContainText('тег уже есть');
    await expect(hint.getByRole('link', { name: /Перезапустить упавшие работы на GitHub/ })).toHaveAttribute('href', 'https://github.com/lancibleofficial/Lancible/actions/runs/102');
    await expect(failed.getByRole('link', { name: /Запуск на GitHub/ })).toHaveAttribute('href', /runs\/102$/);
    await expect(runs.nth(1).locator('[data-role="run-state"]')).toHaveText('успешно');
    await expect(runs.nth(1).locator('[data-hint]')).toHaveCount(0);
  });

  test('упал до тегов — выпускать заново можно', async ({ page, open }) => {
    const { JOBS } = require('./mock');
    await open({ signedIn: 'aal2', handlers: { 'releases.status': () => ({
      main: { desktop: '0.5.1', mobile: '1.3.1' }, releases: [], manifests: {}, landing: {},
      runs: [{ id: 7, title: 'Выпуск 0.5.2', status: 'completed', conclusion: 'failure', url: 'https://github.com/lancibleofficial/Lancible/actions/runs/7',
        jobs: JOBS.map((name, i) => (i === 1 ? { name, status: 'completed', conclusion: 'failure', failedStep: 'Снимки' } : i === 0 ? { name, conclusion: 'success' } : { name, conclusion: 'skipped' })) }],
    }) } });
    await page.goto('/#/releases');
    const run = page.locator('#release-runs .run').first();
    await expect(run.locator('[data-hint="retry"]')).toContainText('ничего не опубликовано');
    await expect(run.locator('[data-hint="rerun"]')).toHaveCount(0);
  });

  test('кнопка выпуска требует подтверждения и шлёт версии', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/releases');
    await expect(page.locator('#release-form')).toContainText('Сначала идут все тесты');
    await expect(page.locator('#rel-desktop')).toHaveAttribute('placeholder', 'например, 0.5.2');

    await page.locator('#rel-desktop').fill('0.5');
    await page.locator('#release-start').click();
    await expect(page.locator('#release-form .form-error')).toContainText('три числа');
    await expect(page.locator('#confirm-backdrop')).toHaveCount(0);

    await page.locator('#rel-desktop').fill('0.5.2');
    await page.locator('#rel-mobile').fill('1.3.2');
    await page.locator('#release-start').click();
    const dialog = page.locator('#confirm-backdrop .modal');
    await expect(dialog).toContainText('десктоп 0.5.2');
    await expect(dialog).toContainText('телефон 1.3.2');
    await expect(dialog).toContainText('ничего не опубликуется');
    await page.locator('[data-confirm="cancel"]').click();
    expect(backend.callsOf('releases.start')).toEqual([]);

    await page.locator('#release-start').click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(page.locator('#release-result')).toContainText('Запуск начат');
    await expect(page.locator('#release-result a')).toHaveAttribute('href', 'https://github.com/lancibleofficial/Lancible/actions/runs/103');
    expect(backend.callsOf('releases.start')).toEqual([{ action: 'releases.start', desktop: '0.5.2', mobile: '1.3.2' }]);
  });

  test('нет токена GitHub и не прочитанное — сказано прямо, кнопка недоступна', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    const base = backend.handlers['releases.status'];
    backend.handlers['releases.status'] = () => {
      const r = base();
      r.token = false;
      r.errors = { runs: 'http 403' };
      r.runs = [{ ...r.runs[0], jobs: undefined, jobsError: 'http 403' }];
      return r;
    };
    await page.goto('/#/releases');
    await expect(page.locator('#release-start')).toBeDisabled();
    await expect(page.locator('#release-no-token')).toContainText('GITHUB_RELEASE_TOKEN');
    await expect(page.locator('#release-errors')).toContainText('runs (http 403)');
    await expect(page.locator('#release-runs .run').first()).toContainText('Работы запуска не прочитаны');
  });

  test('только телефон — уходит одна версия', async ({ page, open }) => {
    const backend = await open({ signedIn: 'aal2' });
    await page.goto('/#/releases');
    await page.locator('#rel-mobile').fill('1.3.2');
    await page.locator('#release-start').click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(page.locator('#release-result')).toBeVisible();
    expect(backend.callsOf('releases.start')).toEqual([{ action: 'releases.start', mobile: '1.3.2' }]);
  });
});

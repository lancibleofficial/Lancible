// Общее для тестов чата агента (ai-panel, ai-chats, ai-attach, ai-access):
// поток функции ai-chat из записанных кадров, подмена функции и RPC доступа
// ai_has_access, вход, открытие чата.
//
// Модель и функцию ai-chat из теста не трогаем. Функция подменяется
// page.route: ответ — text/event-stream из заранее записанных кадров (кадр
// lancible функции, дальше поток Anthropic как есть). Вход — как в
// delete-account.spec.js: currentUser прямо в странице, а токен сессии
// отдаёт подменённая sb.auth.getSession. Синхронизация выключена — в облако
// тест ничего не шлёт.
const { expect } = require('@playwright/test');
const { pinClock } = require('./clock');

const FN = '**/functions/v1/ai-chat';

/** Кадры SSE: [[event, data], …] → тело ответа. */
const sse = (frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

/** Ответ модели: текст (кусками) и, если нужно, один вызов инструмента. */
function stream({ text = [], tool = null, thinking = null, stop = tool ? 'tool_use' : 'end_turn', remaining = 47, limit = 50 } = {}) {
  const f = [
    ['lancible', { remaining, limit, model: 'claude-sonnet-5-5' }],
    ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
  ];
  let i = 0;
  if (thinking) {
    f.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '', signature: '' } }]);
    f.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: thinking.text } }]);
    f.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: thinking.signature } }]);
    f.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
    i += 1;
  }
  if (text.length) {
    f.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }]);
    for (const piece of text) f.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: piece } }]);
    f.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
    i += 1;
  }
  f.push(['ping', { type: 'ping' }]);
  if (tool) {
    const json = JSON.stringify(tool.input);
    const cut = Math.floor(json.length / 2);
    f.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } }]);
    f.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(0, cut) } }]);
    f.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(cut) } }]);
    f.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
  }
  f.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 140 } }]);
  f.push(['message_stop', { type: 'message_stop' }]);
  return sse(f);
}

/** Отвечает по очереди готовыми ответами и запоминает тела запросов. */
async function fn(page, answers) {
  const calls = [];
  await page.route(FN, async (route) => {
    const req = route.request();
    calls.push({ body: JSON.parse(req.postData() || '{}'), headers: req.headers() });
    const a = answers[Math.min(calls.length, answers.length) - 1];
    if (a === 'network') return route.abort('failed');
    if (typeof a === 'object' && a.status) {
      return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.json || {}) });
    }
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: a });
  });
  return calls;
}

async function open(page, { width = 1280, height = 800, signedIn = false, motion = false, reduce = false, access: answer = true } = {}) {
  await page.setViewportSize({ width, height });
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  await pinClock(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#shell')).toBeVisible();
  // Замеры положения — без анимации появления (кроме тестов самого движения).
  if (!motion) await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  if (signedIn) await signIn(page, { access: answer });
}

/** Агент по приглашению (21 октября 2026): доступ отвечает RPC
 *  ai_has_access — подменяется сетью, как функция. answer: true | false |
 *  'network' | { status, json } | (n) => одно из них (может ждать — так
 *  тест держит ответ). Возвращает заголовки вызовов. */
const ACCESS = '**/rest/v1/rpc/ai_has_access';
async function access(page, answer = true) {
  const calls = [];
  await page.unroute(ACCESS);
  await page.route(ACCESS, async (route) => {
    calls.push(route.request().headers());
    const a = typeof answer === 'function' ? await answer(calls.length) : answer;
    if (a === 'network') return route.abort('failed');
    if (a && typeof a === 'object') return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.json || {}) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) });
  });
  return calls;
}

/** Вход: currentUser в странице, токен отдаёт подменённая getSession, доступ к
 *  агенту — подменённая ai_has_access (по умолчанию есть). wait — дождаться
 *  ответа о доступе, как будто его уже спрашивали в этот запуск. */
async function signIn(page, { access: answer = true, wait = true } = {}) {
  const calls = await access(page, answer);
  await page.evaluate(async (w) => {
    state.settings.syncEnabled = false;
    sb.auth.getSession = async () => ({ data: { session: { access_token: 'test-token' } }, error: null });
    currentUser = { id: 'u1', email: 'test@example.com', name: null };
    renderAccountBtn();
    if (w && typeof aiCheckAccess === 'function') await aiCheckAccess();
  }, wait);
  return calls;
}

const panel = (page) => page.locator('#ai-panel');
const input = (page) => page.locator('#ai-input');

/** Чат открывается на главном экране (19 октября 2026): фраза, поле
 *  посередине, чаты под ним. Первое сообщение с этого поля заводит новый чат. */
async function openChat(page) {
  // Узкий веб (≤ 560 px): рейла нет, кнопка агента — в нижней плашке.
  await page.locator(page.viewportSize().width <= 560 ? '#mobile-ai-btn' : '#ai-btn').click();
  await expect(page.locator('#ai-hello')).toBeVisible();
  await expect(page.locator('#ai-input')).toBeVisible();
}

/** Пустой открытый чат — для тестов ленты (точки, рост ответа): с главного
 *  экрана чат заводит только отправка, а этим тестам сообщение не нужно. */
async function openEmptyChat(page) {
  await openChat(page);
  await page.evaluate(() => {
    ai.chat = { id: 'c-test', title: 'Тест', createdAt: new Date().toISOString(), messages: [], items: [], draft: null };
    ai.page = 'chat';
    aiRender(true);
  });
  await expect(page.locator('#ai-log')).toBeVisible();
}

/** Сохранённый чат: первый в списке (lancible:ai:<uid>:chats) и его сообщения. */
const savedChat = (page) => page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('lancible:ai:u1:chats') || '[]');
  return index.length ? JSON.parse(localStorage.getItem(`lancible:ai:u1:chat:${index[0].id}`)) : null;
});

async function send(page, text) {
  await input(page).fill(text);
  await input(page).press('Enter');
}

module.exports = { FN, ACCESS, sse, stream, fn, access, open, signIn, panel, input, openChat, openEmptyChat, savedChat, send };

// ИИ-агент по приглашению на телефоне (21 октября 2026): lib/aiAccess.js,
// components/chat/ChatLocked.js, вкладка «Чат-бот» и открытый чат.
// Запуск: npm run test:mobile
//
// Доступ выдаёт владелец строкой в таблице ai_access; клиент спрашивает его
// RPC ai_has_access() при открытии вкладки и после входа, а ответ функции 403
// { error: 'no access' } закрывает агента и посреди разговора. Без доступа —
// экран «закрытый тест» вместо поля и чатов, «Запросить доступ» — строка
// обратной связи с почтой аккаунта. Базы и функции в Node нет: RPC подменён
// (tests/support/aiAccess.js), функция — fetch из 'expo/fetch', таблица
// feedback — sb.from.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, act, waitFor, within } from '@testing-library/react-native';
import { fetch as mockFetch } from 'expo/fetch';
import ChatListScreen from '../src/screens/ChatListScreen';
import ChatThreadScreen from '../src/screens/ChatThreadScreen';
import { CHAT_ART } from '../src/components/chat/ChatGreeting';
import { useAiChat, aiStop, aiAccount, aiNewChat, aiSend, aiChatsKey, aiChatKey } from '../src/lib/aiChat';
import { useAiAccess, aiCheckAccess } from '../src/lib/aiAccess';
import { aiRequestKey } from '../src/lib/aiKeys';
import { feedbackPlatform, appVersion } from '../src/lib/feedback';
import { sb } from '../src/lib/supabaseClient';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';
import { grantAi, accessCalls } from './support/aiAccess';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

// Сценка скрыта от скринридера — и от запросов по умолчанию тоже.
const HIDDEN = { includeHiddenElements: true };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Так PostgREST отдаёт отказ триггера feedback_rate (supabase/feedback.sql).
const RATE = { code: 'P0001', message: 'feedback rate', details: null, hint: null };
const failed = (status, json = {}) => ({ ok: false, status, body: null, json: async () => json });
const reply = (res) => mockFetch.mockImplementationOnce(() => Promise.resolve(res));
const read = async (key) => JSON.parse((await AsyncStorage.getItem(key)) || 'null');
const signIn = (id = 'u1') => useAuthStore.setState({ status: 'signedIn', user: { id, email: `${id}@example.com` } });
const chatRow = (id, title) => ({ id, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), preview: `Ответ в «${title}»`, count: 2 });
/** Навигация: опции шапки копятся в options, слушатели — по имени. */
const nav = () => {
  const n = { options: {}, listeners: {}, navigate: jest.fn(), push: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
  n.setOptions = jest.fn((o) => { n.options = { ...n.options, ...o }; });
  n.addListener = jest.fn((name, cb) => { n.listeners[name] = cb; return () => { delete n.listeners[name]; }; });
  return n;
};
const isDisabled = (el) => !!(el.props.accessibilityState && el.props.accessibilityState.disabled);

/** Таблица feedback: insert отвечает по очереди тем, что дал тест. */
function feedbackTable(...answers) {
  const insert = jest.fn(async () => (answers.length > 1 ? answers.shift() : answers[0] || { error: null }));
  const real = sb.from.bind(sb);
  const from = jest.spyOn(sb, 'from').mockImplementation((name) => (name === 'feedback' ? { insert } : real(name)));
  return { insert, from };
}

let rpc;
let session;
beforeEach(async () => {
  mockFetch.mockReset();
  await AsyncStorage.clear();
  aiStop();
  useAiChat.setState({
    uid: null, loaded: false, chats: [], chatId: null, opened: false, messages: [], items: [], pending: [], attaching: false, attachError: null,
    busy: false, waiting: false, liveId: null, needAuth: false, remaining: null, limit: null, limitUntil: 0,
  });
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z', pinnedAt: null, tagIds: [] }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'К выполнению', color: '#5ec8f2', kind: 'todo', order: 0 }],
    versions: [], tags: [], documents: [], tasks: [], activeTimer: null,
  });
  signIn();
  session = jest.spyOn(sb.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok-1' } }, error: null });
});
afterEach(async () => {
  await act(async () => { useAuthStore.setState({ status: 'signedOut', user: null }); });
  session.mockRestore();
  if (rpc) rpc.mockRestore();
  rpc = null;
  jest.restoreAllMocks();
});

async function openList(navigation = nav()) {
  const s = await render(<ChatListScreen navigation={navigation} />);
  await waitFor(() => expect(useAiChat.getState().loaded).toBe(true));
  return s;
}
async function seedChat(id = 'c-1', title = 'Секретный план') {
  await AsyncStorage.setItem(aiChatsKey('u1'), JSON.stringify([chatRow(id, title)]));
  await AsyncStorage.setItem(aiChatKey('u1', id), JSON.stringify({
    messages: [{ role: 'user', content: [{ type: 'text', text: title }] }, { role: 'assistant', content: [{ type: 'text', text: 'Хорошо.' }] }],
    items: [{ id: 'i1', kind: 'msg', role: 'user', text: title }, { id: 'i2', kind: 'msg', role: 'assistant', text: 'Хорошо.' }],
  }));
}

describe('главный экран без доступа', () => {
  test('«закрытый тест» на месте поля, фразы и чатов: сценка chat, заголовок, текст, строка про почту, «Запросить доступ»; ai-chat не зовётся, чаты на устройстве целы', async () => {
    rpc = grantAi(false);
    await seedChat();
    const navigation = nav();
    const s = await openList(navigation);
    const box = within(await waitFor(() => s.getByTestId('chat-locked')));
    expect(rpc).toHaveBeenCalledWith('ai_has_access');
    box.getByTestId(`art-${CHAT_ART}`, HIDDEN);
    const title = box.getByText(t('ru', 'ai.locked_title'));
    const text = box.getByText(t('ru', 'ai.locked_text'));
    const note = box.getByText(t('ru', 'ai.locked_note'));
    const button = box.getByTestId('chat-request');
    within(button).getByText(t('ru', 'ai.request_access'));
    expect(isDisabled(button)).toBe(false);
    // Сверху вниз: заголовок, текст, строка про почту, кнопка.
    const order = JSON.stringify(s.toJSON());
    const at = (str) => order.indexOf(str);
    expect(at(title.props.children)).toBeLessThan(at(text.props.children));
    expect(at(text.props.children)).toBeLessThan(at(note.props.children));
    expect(at(note.props.children)).toBeLessThan(at('"chat-request"'));
    // Поля, фразы, чатов и примеров нет.
    for (const id of ['chat-input', 'chat-phrase', 'chat-hero', 'chat-rows', 'chat-item-c-1', 'chat-examples', 'chat-access-wait']) {
      expect(s.queryByTestId(id)).toBeNull();
    }
    expect(s.queryByText('Секретный план')).toBeNull();
    // Шапка та же: поиск и колокольчик на месте.
    await fireEvent.press(s.getByTestId('chat-search'));
    expect(navigation.navigate).toHaveBeenCalledWith('Search');
    s.getByTestId('notif-bell');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await read(aiChatsKey('u1'))).toHaveLength(1);
    expect(await read(aiChatKey('u1', 'c-1'))).not.toBeNull();
  });

  test('пока ответа нет — скелет, поля нет; вход на вкладку снова спрашивает заново, а прежнее известное стоит сразу — без скелета', async () => {
    const gates = [];
    rpc = grantAi(() => new Promise((resolve) => { gates.push(resolve); }));
    const navigation = nav();
    const s = await openList(navigation);
    s.getByTestId('chat-access-wait');
    expect(s.queryByTestId('chat-input')).toBeNull();
    expect(s.queryByTestId('chat-locked')).toBeNull();
    expect(gates).toHaveLength(1); // вход и экран спросили один раз
    await act(async () => { gates[0](true); });
    await waitFor(() => s.getByTestId('chat-input'));

    // Снова на вкладку: вопрос уходит заново, поле стоит, пока ответа нет.
    await act(async () => { navigation.listeners.blur(); navigation.listeners.focus(); });
    expect(accessCalls(rpc)).toBe(2);
    s.getByTestId('chat-input');
    expect(s.queryByTestId('chat-access-wait')).toBeNull();
    // Доступ закрыли — ответ закрывает и экран.
    await act(async () => { gates[1](false); });
    await waitFor(() => s.getByTestId('chat-locked'));

    // Другой аккаунт — о нём ничего не известно: скелет.
    await act(async () => { signIn('u2'); });
    s.getByTestId('chat-access-wait');
    expect(s.queryByTestId('chat-locked')).toBeNull();
    await act(async () => { gates[gates.length - 1](true); });
    await waitFor(() => s.getByTestId('chat-input'));
    // Вернулся первый — его «закрытый тест» сразу, без скелета и без поля.
    await act(async () => { signIn('u1'); });
    s.getByTestId('chat-locked');
    expect(s.queryByTestId('chat-access-wait')).toBeNull();
    expect(s.queryByTestId('chat-input')).toBeNull();
    await act(async () => { gates.forEach((g) => g(false)); });
  });

  test('гость — «Войти», о доступе не спрашивают; вошёл — спрашивают, и без доступа — «закрытый тест»', async () => {
    rpc = grantAi(false);
    useAuthStore.setState({ status: 'signedOut', user: null });
    const s = await render(<ChatListScreen navigation={nav()} />);
    s.getByTestId('chat-signin');
    expect(s.queryByTestId('chat-locked')).toBeNull();
    expect(accessCalls(rpc)).toBe(0);
    await act(async () => { signIn('u1'); });
    await waitFor(() => s.getByTestId('chat-locked'));
    expect(accessCalls(rpc)).toBeGreaterThan(0);
    expect(s.queryByTestId('chat-signin')).toBeNull();
  });

  test('доступ есть — чат как раньше: поле посередине, ни «закрытого теста», ни скелета', async () => {
    rpc = grantAi(true);
    const s = await openList();
    await waitFor(() => s.getByTestId('chat-input'));
    expect(rpc).toHaveBeenCalledWith('ai_has_access');
    s.getByTestId('chat-phrase');
    expect(s.queryByTestId('chat-locked')).toBeNull();
    expect(s.queryByTestId('chat-access-wait')).toBeNull();
  });
});

describe('«Запросить доступ»', () => {
  const REQUEST = 'Запрос доступа к ИИ-агенту: u1@example.com';
  async function openLocked() {
    const s = await openList();
    await waitFor(() => s.getByTestId('chat-locked'));
    return s;
  }

  test('одна строка feedback с почтой аккаунта; затем «Запрос отправлен», кнопка неактивна — и так же после перезапуска; у другого аккаунта — снова «Запросить доступ»', async () => {
    rpc = grantAi(false);
    const { insert, from } = feedbackTable({ error: null });
    const s = await openLocked();
    await fireEvent.press(s.getByTestId('chat-request'));
    await waitFor(() => within(s.getByTestId('chat-request')).getByText(t('ru', 'ai.request_sent')));
    expect(from).toHaveBeenCalledWith('feedback');
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      kind: 'other', text: REQUEST, user_id: 'u1', lang: 'ru', screenshot_path: null,
      platform: feedbackPlatform(), app_version: appVersion(),
    });
    expect(row.id).toMatch(UUID);
    expect(isDisabled(s.getByTestId('chat-request'))).toBe(true);
    await fireEvent.press(s.getByTestId('chat-request'));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(s.queryByTestId('chat-request-error')).toBeNull();
    // Помнится на устройстве по аккаунту.
    expect(await read(aiRequestKey('u1'))).toEqual({ at: expect.any(String) });

    // «Перезапуск»: память приложения пуста, отметка — на устройстве.
    await s.unmount();
    useAiAccess.setState({ by: {}, sent: {} });
    const again = await openLocked();
    await waitFor(() => within(again.getByTestId('chat-request')).getByText(t('ru', 'ai.request_sent')));
    expect(isDisabled(again.getByTestId('chat-request'))).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);

    // Другой аккаунт — его запрос ещё не уходил.
    await act(async () => { signIn('u2'); });
    await waitFor(() => again.getByTestId('chat-locked'));
    await waitFor(() => within(again.getByTestId('chat-request')).getByText(t('ru', 'ai.request_access')));
    expect(isDisabled(again.getByTestId('chat-request'))).toBe(false);
  });

  test('отказ базы по частоте — строка feedback.rate и «Повторить»; повтор — та же строка (тот же id), затем «Запрос отправлен»', async () => {
    rpc = grantAi(false);
    const { insert } = feedbackTable({ error: RATE }, { error: null });
    const s = await openLocked();
    await fireEvent.press(s.getByTestId('chat-request'));
    const error = await waitFor(() => s.getByTestId('chat-request-error'));
    expect(error.props.children).toBe(t('ru', 'feedback.rate'));
    within(s.getByTestId('chat-request')).getByText(t('ru', 'feedback.retry'));
    expect(isDisabled(s.getByTestId('chat-request'))).toBe(false);
    expect(await AsyncStorage.getItem(aiRequestKey('u1'))).toBeNull();
    await fireEvent.press(s.getByTestId('chat-request'));
    await waitFor(() => within(s.getByTestId('chat-request')).getByText(t('ru', 'ai.request_sent')));
    expect(s.queryByTestId('chat-request-error')).toBeNull();
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0].id).toBe(insert.mock.calls[0][0].id);
    expect(insert.mock.calls[1][0].text).toBe(REQUEST);
  });

  test('другая ошибка — своя строка ai.request_failed и «Повторить»; повтор уходит', async () => {
    rpc = grantAi(false);
    const { insert } = feedbackTable({ error: { code: '08006', message: 'Network request failed' } }, { error: null });
    const s = await openLocked();
    await fireEvent.press(s.getByTestId('chat-request'));
    const error = await waitFor(() => s.getByTestId('chat-request-error'));
    expect(error.props.children).toBe(t('ru', 'ai.request_failed'));
    within(s.getByTestId('chat-request')).getByText(t('ru', 'feedback.retry'));
    await fireEvent.press(s.getByTestId('chat-request'));
    await waitFor(() => within(s.getByTestId('chat-request')).getByText(t('ru', 'ai.request_sent')));
    expect(insert).toHaveBeenCalledTimes(2);
  });
});

describe('открытый чат', () => {
  const say = async (s, text) => {
    await fireEvent.changeText(s.getByTestId('chat-input'), text);
    await fireEvent.press(s.getByTestId('chat-send'));
  };

  test('открыт без доступа (уведомление, поиск, восстановление места) — тот же «закрытый тест»: ни ленты, ни поля, ни названия; первое сообщение с поля не уходит', async () => {
    rpc = grantAi(false);
    await seedChat('c-1', 'Секретный план');
    const navigation = nav();
    const s = await render(<ChatThreadScreen navigation={navigation} route={{ params: { chatId: 'c-1', send: 'Привет', quiet: true } }} />);
    const box = within(await waitFor(() => s.getByTestId('chat-locked')));
    box.getByText(t('ru', 'ai.locked_title'));
    box.getByTestId('chat-request');
    for (const id of ['chat-input', 'chat-log', 'chat-field', 'chat-access-wait']) expect(s.queryByTestId(id)).toBeNull();
    expect(s.queryByText('Секретный план')).toBeNull();
    expect(navigation.options.title).toBe('');
    expect(navigation.options.headerRight).toBeUndefined();
    await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await read(aiChatKey('u1', 'c-1'))).not.toBeNull();
  });

  test('база о доступе не ответила — поле (решает функция); 403 no access посреди чата — «закрытый тест» вместо ленты и поля, вопрос остаётся на устройстве, следующий не уходит; дали доступ — чат и «Повторить»', async () => {
    rpc = grantAi({ error: { code: 'PGRST202', message: 'Could not find the function public.ai_has_access' } });
    await act(async () => { await aiAccount('u1'); });
    const chatId = aiNewChat();
    const s = await render(<ChatThreadScreen navigation={nav()} route={{ params: { chatId } }} />);
    await waitFor(() => s.getByTestId('chat-input'));
    reply(failed(403, { error: 'no access' }));
    await say(s, 'Привет');
    await waitFor(() => s.getByTestId('chat-locked'));
    await waitFor(() => expect(useAiChat.getState().busy).toBe(false));
    expect(s.queryByTestId('chat-input')).toBeNull();
    expect(s.queryByTestId('chat-log')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Вопрос — в чате на устройстве (ошибки туда не идут).
    expect((await read(aiChatKey('u1', chatId))).items.map((it) => it.text)).toEqual(['Привет']);
    // Следующее сообщение не уходит.
    let sent;
    await act(async () => { sent = aiSend('Ещё раз'); });
    expect(sent).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Доступ выдали — вход на экран снова чат, вопрос можно повторить.
    rpc.mockRestore();
    rpc = grantAi(true);
    await act(async () => { await aiCheckAccess('u1'); });
    await waitFor(() => s.getByTestId('chat-input'));
    s.getByText('Привет');
    s.getByText(t('ru', 'ai.interrupted'));
    s.getByTestId('chat-retry');
  });
});

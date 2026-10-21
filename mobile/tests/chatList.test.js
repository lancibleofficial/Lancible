// Список чатов агента на телефоне — корень вкладки «Чат-бот»
// (screens/ChatListScreen.js, lib/aiChat.js; круг 20, 18 октября 2026).
// Запуск: npm run test:mobile
//
// Чатов много, и все — только на устройстве: индекс `lancible-ai:<uid>:chats`
// (название, превью последнего ответа, время, число сообщений; порядок и
// очистку держит ядро — Core.aiChatsNormalize) и сообщения каждого под
// `lancible-ai:<uid>:chat:<id>`. Прежняя одиночная история `lancible-ai:<uid>`
// становится первым чатом. Здесь — что телефон так и делает: пустой список,
// порядок, удаление с подтверждением, «Новый чат», перенос и раздельные
// истории двух чатов. Сеть подменена (fetch из 'expo/fetch').
import { DeviceEventEmitter, Keyboard, Platform, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, act, waitFor, within } from '@testing-library/react-native';
import { fetch as mockFetch } from 'expo/fetch';
import ChatListScreen, { chatWhen, chatCount, greetingText } from '../src/screens/ChatListScreen';
import BottomSheet from '../src/components/BottomSheet';
import { CHAT_ART } from '../src/components/chat/ChatGreeting';
import { CLIP_W } from '../src/components/chat/ChatCompose';
import { spacing, buttonHeight } from '../src/theme';
import {
  useAiChat, aiStop, aiAccount, aiNewChat, aiOpenChat, aiSend, aiKey, aiChatsKey, aiChatKey,
} from '../src/lib/aiChat';
import { sb } from '../src/lib/supabaseClient';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t, T } from '../src/lib/i18n';
import { grantAi } from './support/aiAccess';

// Агент открыт аккаунту (RPC ai_has_access подменён — tests/support/aiAccess.js).
let aiRpc;
beforeEach(() => { aiRpc = grantAi(); });
afterEach(() => { aiRpc.mockRestore(); });

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

/** testID дерева сверху вниз — порядок на экране. */
function testIdsInOrder(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => testIdsInOrder(n, out)); return out; }
  if (node.props && node.props.testID) out.push(node.props.testID);
  if (node.children) testIdsInOrder(node.children, out);
  return out;
}

const enc = new TextEncoder();
const ev = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const textReply = (text) => ev('lancible', { remaining: 47, limit: 50 })
  + ev('message_start', { type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 5, output_tokens: 1 } } })
  + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
  + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } })
  + ev('message_stop', { type: 'message_stop' });
function streamed(body) {
  const bytes = enc.encode(body);
  let done = false;
  return {
    ok: true, status: 200, json: async () => ({}),
    body: { getReader: () => ({ read: async () => { if (done) return { value: undefined, done: true }; done = true; return { value: bytes, done: false }; }, cancel: async () => {} }) },
  };
}
const reply = (text) => mockFetch.mockImplementationOnce(() => Promise.resolve(streamed(textReply(text))));
const idle = () => waitFor(() => expect(useAiChat.getState().busy).toBe(false));
const read = async (key) => JSON.parse((await AsyncStorage.getItem(key)) || 'null');
const nav = () => ({ navigate: jest.fn(), push: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}) });
const signIn = (id = 'u1') => useAuthStore.setState({ status: 'signedIn', user: { id, email: `${id}@example.com` } });
const chatRow = (id, title, updatedAt, extra) => ({ id, title, createdAt: updatedAt, updatedAt, preview: `Ответ в «${title}»`, count: 2, ...extra });

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
afterEach(() => {
  session.mockRestore();
  useAuthStore.setState({ status: 'signedOut', user: null });
});

async function openList(navigation = nav()) {
  // Лист — в том же дереве: события ловит только последнее отрисованное.
  const s = await render(<><ChatListScreen navigation={navigation} /><BottomSheet /></>);
  await waitFor(() => expect(useAiChat.getState().loaded).toBe(true));
  return s;
}

// Главный экран (круг 21, 19 октября 2026): сверху сценка и фраза, под ними
// поле посередине, под полем — прежние чаты; в шапке — поиск и колокольчик.
describe('главный экран', () => {
  const NUDGES = Object.keys(T.ru).filter((k) => k.startsWith('ai.nudge_')).map((k) => T.ru[k]);
  const phrase = (s) => s.getByTestId('chat-phrase').props.children;

  test('сверху сценка chat и фраза, под ними поле, под полем — прежние чаты', async () => {
    await AsyncStorage.setItem(aiChatsKey('u1'), JSON.stringify([chatRow('c-1', 'Планы', new Date().toISOString())]));
    const s = await openList();
    const top = within(s.getByTestId('chat-hero'));
    top.getByTestId(`art-${CHAT_ART}`, { includeHiddenElements: true });
    top.getByTestId('chat-phrase');
    top.getByTestId('chat-input');
    // Строки — под полем, не в нём.
    expect(top.queryByTestId('chat-rows')).toBeNull();
    within(s.getByTestId('chat-rows')).getByTestId('chat-item-c-1');
    within(s.getByTestId('chat-rows')).getByText(t('ru', 'ai.chats_title'));
    // Порядок сверху вниз: сценка, фраза, поле, чаты.
    const ids = testIdsInOrder(s.toJSON());
    const at = (id) => ids.indexOf(id);
    expect(at('chat-art')).toBeGreaterThan(-1);
    expect(at('chat-art')).toBeLessThan(at('chat-phrase'));
    expect(at('chat-phrase')).toBeLessThan(at('chat-field'));
    expect(at('chat-field')).toBeLessThan(at('chat-input'));
    expect(at('chat-input')).toBeLessThan(at('chat-rows'));
    expect(at('chat-rows')).toBeLessThan(at('chat-item-c-1'));
  });

  test('скрепка — значок внутри поля, как в чате: без подложки, зона не меньше 40 × 40, текст правее; нажатие отдаёт выбор', async () => {
    const s = await openList();
    const box = within(s.getByTestId('chat-field')).getByTestId('chat-input-box');
    const clip = within(box).getByTestId('chat-attach');
    const zone = StyleSheet.flatten(clip.props.style);
    expect(zone).toMatchObject({ position: 'absolute', left: 0, bottom: 0 });
    expect(zone.backgroundColor).toBeUndefined();
    expect(zone.width).toBeGreaterThanOrEqual(40);
    expect(zone.height).toBeGreaterThanOrEqual(40);
    expect(StyleSheet.flatten(within(box).getByTestId('chat-input').props.style).paddingLeft).toBeGreaterThanOrEqual(CLIP_W);
    expect(clip.props.accessibilityLabel).toBe(t('ru', 'ai.attach'));
    // Нажатие открывает тот же лист «Фото» / «Файл».
    await fireEvent.press(clip);
    const sheet = within(s.getByTestId('sheet'));
    sheet.getByText(t('ru', 'ai.attach_photo'));
    sheet.getByText(t('ru', 'ai.attach_file'));
  });

  test('поле — серединой посередине видимой части: над ним место под сценку и фразу', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    const s = await openList();
    await fireEvent(s.getByTestId('chat-list-empty'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } });
    // Android: под страницей обычный отступ (spacing.lg); поле 48 + поля 8 и 8.
    const hero = StyleSheet.flatten(s.getByTestId('chat-hero').props.style);
    expect(hero.minHeight).toBe((700 - spacing.lg) / 2 + (buttonHeight + spacing.sm * 2) / 2);
    expect(hero.justifyContent).toBe('flex-end');
    // Клавиатура открылась — панели вкладок нет, страница выше; поле не едет к клавиатуре.
    await act(async () => { DeviceEventEmitter.emit('keyboardDidShow', { endCoordinates: { screenY: 500, height: 344, width: 390, screenX: 0 } }); });
    await fireEvent(s.getByTestId('chat-list-empty'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 780 } } });
    expect(StyleSheet.flatten(s.getByTestId('chat-hero').props.style).minHeight).toBe(hero.minHeight);
    await act(async () => { DeviceEventEmitter.emit('keyboardDidHide', { endCoordinates: { screenY: 844, height: 0, width: 390, screenX: 0 } }); });
    await fireEvent(s.getByTestId('chat-list-empty'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 640 } } });
    expect(StyleSheet.flatten(s.getByTestId('chat-hero').props.style).minHeight).toBe((640 - spacing.lg) / 2 + (buttonHeight + spacing.sm * 2) / 2);
    os.restore();
  });

  test('фраза — Core.aiGreeting: с именем (первое слово), каждый вход на экран — следующая, приветствие и подталкивание чередуются', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'u1@example.com', name: 'Туран Иванов' } });
    const navigation = nav();
    const s = await openList(navigation);
    const on = (name) => navigation.addListener.mock.calls.filter(([n]) => n === name).pop()[1];
    const enter = () => act(async () => { on('blur')(); on('focus')(); });
    const first = phrase(s);
    // Фокус без ухода (экран строится уже в фокусе) — это тот же вход: фраза та же, не мигает.
    await act(async () => { on('focus')(); });
    expect(phrase(s)).toBe(first);
    await enter();
    const second = phrase(s);
    expect(second).not.toBe(first);
    expect(NUDGES.includes(second)).toBe(!NUDGES.includes(first));
    await enter();
    const third = phrase(s);
    expect(NUDGES.includes(third)).toBe(NUDGES.includes(first));
    const greet = [first, second, third].find((p) => !NUDGES.includes(p));
    expect(greet).toMatch(/Туран/);
    expect(greet).not.toMatch(/Иванов/);
    // Слова — из словаря по ключу ядра.
    expect(greetingText('ru', { now: Date.parse('2026-10-19T09:00:00'), name: 'Туран', seed: 2 })).toBe('Доброе утро, Туран!');
    expect(greetingText('ru', { now: Date.parse('2026-10-19T09:00:00'), name: '', seed: 2 })).toBe('Доброе утро!');
    expect(NUDGES).toContain(greetingText('ru', { now: Date.now(), name: 'Туран', seed: 3 }));
  });

  test('шапка: поиск и колокольчик вместо «+»', async () => {
    const navigation = nav();
    const s = await openList(navigation);
    expect(s.queryByTestId('chat-new')).toBeNull();
    expect(s.getByTestId('chat-search').props.accessibilityLabel).toBe(t('ru', 'search.placeholder'));
    await fireEvent.press(s.getByTestId('chat-search'));
    expect(navigation.navigate).toHaveBeenCalledWith('Search');
    await fireEvent.press(s.getByTestId('notif-bell'));
    expect(navigation.navigate).toHaveBeenCalledWith('Notifications');
  });

  test('отправка с поля — новый чат без хода стека: первое сообщение, место поля и quiet уходят экрану чата; поле пустеет, клавиатура уходит', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    // Верх поля — 412 (замер на потоке интерфейса, в координатах корня — как у экрана чата).
    const measure = jest.spyOn(Reanimated, 'measure').mockReturnValue({ x: 0, y: 0, width: 390, height: 64, pageX: 0, pageY: 412 });
    const navigation = nav();
    const s = await openList(navigation);
    await fireEvent.changeText(s.getByTestId('chat-input'), '  Распланируй мне неделю ');
    await fireEvent.press(s.getByTestId('chat-send'));
    const { chatId, opened, items } = useAiChat.getState();
    expect(opened).toBe(true);
    expect(items).toEqual([]);
    expect(navigation.push).toHaveBeenCalledWith('ChatThread', { chatId, send: 'Распланируй мне неделю', quiet: true, from: 412 });
    expect(dismiss).toHaveBeenCalled();
    expect(s.getByTestId('chat-input').props.value).toBe('');
    // В список новый чат попадёт с первым сообщением (его отправит экран чата).
    expect(await read(aiChatsKey('u1'))).toBeNull();
    measure.mockRestore();
    dismiss.mockRestore();
  });

  test('пока где-то идёт ответ — печатать можно, отправить нельзя', async () => {
    const s = await openList();
    await act(async () => { useAiChat.setState({ busy: true }); });
    expect(s.getByTestId('chat-input').props.editable).toBe(true);
    await fireEvent.changeText(s.getByTestId('chat-input'), 'Ещё вопрос');
    expect(s.getByTestId('chat-send').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => { useAiChat.setState({ busy: false }); });
    expect(s.getByTestId('chat-send').props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('список', () => {
  test('чатов нет — под полем что умеет агент и три примера; пример встаёт в поле, чат не открывается', async () => {
    const navigation = nav();
    const s = await openList(navigation);
    const below = within(s.getByTestId('chat-examples'));
    below.getByText(t('ru', 'ai.empty_hint'));
    await fireEvent.press(s.getByTestId('chat-example-ai.example_2'));
    expect(s.getByTestId('chat-input').props.value).toBe(t('ru', 'ai.example_2'));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(await read(aiChatsKey('u1'))).toBeNull();
  });

  test('строки — свежие сверху: название, превью последнего ответа, число сообщений и время', async () => {
    const now = Date.now();
    const iso = (min) => new Date(now - min * 60_000).toISOString();
    await AsyncStorage.setItem(aiChatsKey('u1'), JSON.stringify([
      chatRow('c-old', 'Старый', iso(3 * 24 * 60)),
      chatRow('c-new', 'Свежий', iso(5), { count: 6 }),
      chatRow('c-mid', 'Вчерашний', iso(26 * 60)),
    ]));
    const s = await openList();
    const list = s.getByTestId('chat-list');
    const ids = within(list).getAllByTestId(/^chat-item-/).map((el) => el.props.testID);
    expect(ids).toEqual(['chat-item-c-new', 'chat-item-c-mid', 'chat-item-c-old']);
    const row = within(s.getByTestId('chat-item-c-new'));
    row.getByText('Свежий');
    row.getByText('Ответ в «Свежий»');
    row.getByText(chatCount(6, 'ru'));
    expect(chatCount(6, 'ru')).toBe('6 сообщений');
    row.getByText(chatWhen(iso(5), 'ru'));
    expect(chatWhen(iso(5), 'ru')).toMatch(/^сегодня \d\d:\d\d$/);
    expect(chatWhen(new Date(now - 86_400_000).toISOString(), 'ru', now)).toBe('вчера');
  });

  test('касание строки — экран этого чата', async () => {
    await AsyncStorage.setItem(aiChatsKey('u1'), JSON.stringify([chatRow('c-1', 'Планы', new Date().toISOString())]));
    const navigation = nav();
    const s = await openList(navigation);
    await fireEvent.press(s.getByTestId('chat-item-c-1'));
    expect(navigation.push).toHaveBeenCalledWith('ChatThread', { chatId: 'c-1' });
  });

  test('долгое нажатие — «Удалить чат?»: «Отмена» оставляет, «Удалить чат» убирает строку и переписку с устройства', async () => {
    const at = new Date().toISOString();
    await AsyncStorage.setItem(aiChatsKey('u1'), JSON.stringify([chatRow('c-1', 'Первый', at), chatRow('c-2', 'Второй', at)]));
    await AsyncStorage.setItem(aiChatKey('u1', 'c-1'), JSON.stringify({ messages: [], items: [{ id: 'm1', kind: 'msg', role: 'user', text: 'x' }] }));
    const s = await openList();
    await fireEvent(s.getByTestId('chat-item-c-1'), 'longPress');
    const sheet = () => within(s.getByTestId('sheet'));
    sheet().getByText(t('ru', 'ai.delete_chat_q'));
    sheet().getByText(t('ru', 'ai.delete_chat_text', { name: 'Первый' }));
    await fireEvent.press(sheet().getByText(t('ru', 'common.cancel')));
    expect(useSheetStore.getState().content).toBeNull();
    s.getByTestId('chat-item-c-1');
    expect(await read(aiChatKey('u1', 'c-1'))).not.toBeNull();

    await fireEvent(s.getByTestId('chat-item-c-1'), 'longPress');
    expect(useSheetStore.getState().content).not.toBeNull();
    await fireEvent.press(sheet().getByText(t('ru', 'ai.delete_chat')));
    await waitFor(() => expect(s.queryByTestId('chat-item-c-1')).toBeNull());
    s.getByTestId('chat-item-c-2');
    expect(await read(aiChatKey('u1', 'c-1'))).toBeNull();
    expect((await read(aiChatsKey('u1'))).map((c) => c.id)).toEqual(['c-2']);
  });

  test('новый чат с поля: первое сообщение даёт название, ответ — превью', async () => {
    const navigation = nav();
    const s = await openList(navigation);
    await fireEvent.changeText(s.getByTestId('chat-input'), 'Распланируй мне неделю');
    await fireEvent.press(s.getByTestId('chat-send'));
    const { chatId } = useAiChat.getState();
    expect(navigation.push).toHaveBeenCalledWith('ChatThread', expect.objectContaining({ chatId, send: 'Распланируй мне неделю' }));
    // Отправляет экран чата (chatThread.test.js) — здесь за него.
    reply('Начнём с **понедельника**.');
    await act(async () => { aiSend('Распланируй мне неделю'); });
    await idle();
    const index = await read(aiChatsKey('u1'));
    expect(index).toEqual([expect.objectContaining({ id: chatId, title: 'Распланируй мне неделю', preview: 'Начнём с понедельника.', count: 2 })]);
    // Строка в списке — тут же, без перечитывания.
    within(s.getByTestId(`chat-item-${chatId}`)).getByText('Распланируй мне неделю');
    // Счётчик на сегодня — рядом с названием вкладки.
    s.getByText(t('ru', 'ai.quota', { remaining: 47, limit: 50 }));
  });

  test('без входа — «Войти», ни поля, ни списка; поиск и колокольчик в шапке на месте', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null });
    const s = await render(<ChatListScreen navigation={nav()} />);
    s.getByTestId('chat-signin');
    expect(s.queryByTestId('chat-input')).toBeNull();
    expect(s.queryByTestId('chat-list')).toBeNull();
    s.getByTestId('chat-search');
    s.getByTestId('notif-bell');
  });
});

describe('хранение', () => {
  test('прежняя одиночная история становится первым чатом, старый ключ удаляется', async () => {
    const old = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Что у меня на неделе?' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Две задачи.' }] },
      ],
      items: [
        { id: 'i1', kind: 'msg', role: 'user', text: 'Что у меня на неделе?' },
        { id: 'i2', kind: 'msg', role: 'assistant', text: 'Две задачи.' },
      ],
      updatedAt: '2026-10-17T12:00:00.000Z',
    };
    await AsyncStorage.setItem(aiKey('u1'), JSON.stringify(old));
    const s = await openList();
    expect(await AsyncStorage.getItem(aiKey('u1'))).toBeNull();
    const index = await read(aiChatsKey('u1'));
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ title: 'Что у меня на неделе?', preview: 'Две задачи.', count: 2, updatedAt: '2026-10-17T12:00:00.000Z' });
    const chat = await read(aiChatKey('u1', index[0].id));
    expect(chat.messages).toEqual(old.messages);
    expect(chat.items.map((it) => it.text)).toEqual(['Что у меня на неделе?', 'Две задачи.']);
    s.getByTestId(`chat-item-${index[0].id}`);
    // Второй раз переносить нечего: индекс уже есть.
    await act(async () => { await aiAccount(null); await aiAccount('u1'); });
    expect(await read(aiChatsKey('u1'))).toEqual(index);
  });

  test('у двух чатов — свои истории; открыть — своя лента, список — свежий сверху', async () => {
    await act(async () => { await aiAccount('u1'); });
    const a = aiNewChat();
    reply('Ответ А.');
    await act(async () => { aiSend('Вопрос А'); });
    await idle();
    // Чат Б — позже А (время записи — до миллисекунды).
    await new Promise((r) => { setTimeout(r, 5); });
    const b = aiNewChat();
    reply('Ответ Б.');
    await act(async () => { aiSend('Вопрос Б'); });
    await idle();
    expect((await read(aiChatKey('u1', a))).items.map((it) => it.text)).toEqual(['Вопрос А', 'Ответ А.']);
    expect((await read(aiChatKey('u1', b))).items.map((it) => it.text)).toEqual(['Вопрос Б', 'Ответ Б.']);
    // Второй вызов функции увёз только свою историю.
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Вопрос Б' }] }]);
    expect(useAiChat.getState().chats.map((c) => c.id)).toEqual([b, a]);
    await act(async () => { await aiOpenChat(a); });
    expect(useAiChat.getState().items.map((it) => it.text)).toEqual(['Вопрос А', 'Ответ А.']);
    expect(useAiChat.getState().messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  test('другой аккаунт — свой список', async () => {
    await AsyncStorage.setItem(aiChatsKey('u1'), JSON.stringify([chatRow('c-1', 'Мой', new Date().toISOString())]));
    const s = await openList();
    s.getByTestId('chat-item-c-1');
    await act(async () => { signIn('u2'); });
    await waitFor(() => s.getByTestId('chat-list-empty'));
    expect(s.queryByTestId('chat-item-c-1')).toBeNull();
  });
});

// Поиск (screens/SearchScreen.js), шапка на JS — Android и iOS ниже 26.
// Запуск: npm run test:mobile
//
// Клавиатура открывается сразу: autoFocus на поле и ещё раз фокус, когда
// экран доехал, — на Android autoFocus во время въезда срабатывает не всегда.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, waitFor, within, act } from '@testing-library/react-native';
import SearchScreen from '../src/screens/SearchScreen';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useAiChat, aiStop, aiChatsKey, aiChatKey } from '../src/lib/aiChat';
import { t } from '../src/lib/i18n';
import { grantAi } from './support/aiAccess';
import { useAiAccess, aiCheckAccess } from '../src/lib/aiAccess';

// Агент открыт аккаунту (RPC ai_has_access подменён — tests/support/aiAccess.js).
let aiRpc;
beforeEach(() => { aiRpc = grantAi(); });
afterEach(() => { aiRpc.mockRestore(); });

const mockFocus = jest.fn();
jest.mock('../src/components/AppTextInput', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: mockFocus }));
    return React.createElement(TextInput, props);
  });
});

const nav = () => {
  const listeners = {};
  return {
    listeners,
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn((name, cb) => { listeners[name] = cb; return () => { delete listeners[name]; }; }),
  };
};
const task = (id, title) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(),
});

beforeEach(() => {
  mockFocus.mockClear();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [task('t1', 'Главная страница'), task('t2', 'Логи')],
    activeTimer: null,
  });
});

test('поле с автофокусом, и фокус ещё раз, когда экран доехал', async () => {
  const navigation = nav();
  const { getByPlaceholderText } = await render(<SearchScreen navigation={navigation} />);
  expect(getByPlaceholderText('Поиск задач, проектов и чатов').props.autoFocus).toBe(true);
  expect(navigation.addListener).toHaveBeenCalledWith('transitionEnd', expect.any(Function));

  navigation.listeners.transitionEnd({ data: { closing: false } });
  expect(mockFocus).toHaveBeenCalledTimes(1);
  // Уходя с экрана, клавиатуру не зовём.
  navigation.listeners.transitionEnd({ data: { closing: true } });
  expect(mockFocus).toHaveBeenCalledTimes(1);
});

test('шапка своя, системную строку поиска не просим', async () => {
  const navigation = nav();
  const { getByPlaceholderText, getByText, queryByText } = await render(<SearchScreen navigation={navigation} />);
  expect(navigation.setOptions).not.toHaveBeenCalled();
  await fireEvent.changeText(getByPlaceholderText('Поиск задач, проектов и чатов'), 'глав');
  getByText('Главная страница');
  expect(queryByText('Логи')).toBeNull();
});

// Круг 21 (19 октября 2026): поиск находит и чаты с агентом — по названию и
// тексту сообщений, только вошедшего и только с этого устройства.
describe('чаты', () => {
  const at = new Date().toISOString();
  const row = (id, title, preview) => ({ id, title, createdAt: at, updatedAt: at, preview, count: 2 });
  const msgs = (...texts) => ({ messages: [], items: texts.map((text, i) => ({ id: `m${i}`, kind: 'msg', role: i % 2 ? 'assistant' : 'user', text })) });
  const field = (s) => s.getByPlaceholderText(t('ru', 'search.placeholder'));

  beforeEach(async () => {
    await AsyncStorage.clear();
    aiStop();
    useAiChat.setState({ uid: null, loaded: false, chats: [], chatId: null, opened: false, messages: [], items: [], pending: [], needAuth: false });
    await AsyncStorage.setItem(aiChatsKey('u1'), JSON.stringify([row('c-1', 'План недели', 'Начнём с понедельника.'), row('c-2', 'Отпуск в мае', 'Хорошо.')]));
    await AsyncStorage.setItem(aiChatKey('u1', 'c-1'), JSON.stringify(msgs('План недели', 'Начнём с **понедельника**: созвон с бухгалтером в 10:00.')));
    await AsyncStorage.setItem(aiChatKey('u1', 'c-2'), JSON.stringify(msgs('Отпуск в мае', 'Хорошо.')));
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'u1@example.com' } });
  });
  afterEach(async () => {
    await act(async () => { useAuthStore.setState({ status: 'signedOut', user: null }); });
  });

  test('по тексту сообщения — группа «Чаты» с куском сообщения; касание — чат поверх поиска', async () => {
    const navigation = { ...nav(), push: jest.fn() };
    const s = await render(<SearchScreen navigation={navigation} />);
    await waitFor(() => expect(useAiChat.getState().loaded).toBe(true));
    await fireEvent.changeText(field(s), 'бухгалтер');
    const hit = await s.findByTestId('search-chat-c-1');
    s.getByText(t('ru', 'search.chats_group'));
    within(hit).getByText('План недели');
    within(hit).getByText(/созвон с бухгалтером в 10:00/);
    expect(s.queryByTestId('search-chat-c-2')).toBeNull();
    await fireEvent.press(hit);
    expect(navigation.push).toHaveBeenCalledWith('ChatThread', { chatId: 'c-1' });
  });

  test('по названию — без сообщения с совпадением строка с превью; регистр не важен', async () => {
    const s = await render(<SearchScreen navigation={nav()} />);
    await waitFor(() => expect(useAiChat.getState().loaded).toBe(true));
    await fireEvent.changeText(field(s), 'ОТПУСК');
    const hit = await s.findByTestId('search-chat-c-2');
    within(hit).getByText('Отпуск в мае');
    within(hit).getByText('Хорошо.');
    expect(s.queryByTestId('search-chat-c-1')).toBeNull();
  });

  test('агент закрыт аккаунту (закрытый тест, 21 октября 2026) — чаты не ищутся ни по названию, ни по тексту, тексты с устройства не читаются; дали доступ — находятся', async () => {
    aiRpc.mockRestore();
    aiRpc = grantAi(false);
    // Подмена хранилища (jest.setup.js) сама считает чтения: сообщения чатов —
    // ключи lancible-ai:<uid>:chat:<id>; индекс читает вход.
    const chatReads = () => AsyncStorage.multiGet.mock.calls.flatMap(([keys]) => keys).filter((k) => k.includes(':chat:'));
    const before = chatReads().length;
    const s = await render(<SearchScreen navigation={nav()} />);
    await waitFor(() => expect(useAiChat.getState().loaded).toBe(true));
    await waitFor(() => expect(useAiAccess.getState().by.u1).toBe(false));
    await fireEvent.changeText(field(s), 'бухгалтер');
    expect(s.queryByTestId('search-chat-c-1')).toBeNull();
    await fireEvent.changeText(field(s), 'отпуск');
    expect(s.queryByTestId('search-chat-c-2')).toBeNull();
    expect(s.queryByText(t('ru', 'search.chats_group'))).toBeNull();
    s.getByText(t('ru', 'search.nothing_found'));
    expect(chatReads().slice(before)).toEqual([]);
    // Доступ выдали — следующая проверка открывает и поиск по чатам.
    aiRpc.mockRestore();
    aiRpc = grantAi(true);
    await act(async () => { await aiCheckAccess('u1'); });
    await s.findByTestId('search-chat-c-2');
  });

  test('чужой аккаунт — его чаты не ищутся; без входа группы нет', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u2', email: 'u2@example.com' } });
    const s = await render(<SearchScreen navigation={nav()} />);
    await waitFor(() => expect(useAiChat.getState().uid).toBe('u2'));
    await waitFor(() => expect(useAiChat.getState().loaded).toBe(true));
    await fireEvent.changeText(field(s), 'план');
    expect(s.queryByText(t('ru', 'search.chats_group'))).toBeNull();
    await act(async () => { useAuthStore.setState({ status: 'signedOut', user: null }); });
    expect(s.queryByTestId('search-chat-c-1')).toBeNull();
  });
});

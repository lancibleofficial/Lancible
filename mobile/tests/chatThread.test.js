// Чат с агентом на телефоне — экран чата вкладки «Чат-бот»
// (screens/ChatThreadScreen.js, lib/aiChat.js). Запуск: npm run test:mobile
// Список чатов — chatList.test.js, вложения — chatAttach.test.js.
//
// Агент тот же, что на вебе (tests/e2e/ai-panel.spec.js): тот же протокол
// функции ai-chat и то же ядро (core/ai.js — правила закрыты
// tests/unit/ai.test.js). Здесь — что телефон его применяет: поток кусками
// (настоящий разбор ядра поверх подменённого fetch из 'expo/fetch'), карточка
// со строками ядра, «Применить» — данные одной правкой стора, «Отменить» —
// как было, решения карточек и круг инструментов уходят tool_result, ошибки
// функции, история чата по аккаунту на устройстве, появление строк и поле над
// клавиатурой. Сеть подменена: настоящего сервера в Node нет.
import { ScrollView, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, act, waitFor, within } from '@testing-library/react-native';
import * as keyboardController from 'react-native-keyboard-controller';
import { fetch as mockFetch } from 'expo/fetch';
import ChatThreadScreen, { chatThreadOptions } from '../src/screens/ChatThreadScreen';
import { screenTitleStyle } from '../src/components/AppHeader';
import BottomSheet from '../src/components/BottomSheet';
import { useAiChat, aiStop, aiAccount, aiNewChat, aiOpenChat, aiChatKey, openProjectId, AI_URL, AI_MAX_ROUNDS } from '../src/lib/aiChat';
import Ai from '../src/core/ai.js';
import { sb, SUPABASE_ANON_KEY } from '../src/lib/supabaseClient';
import { registerEditorFlush } from '../src/lib/sync';
import DocCore from '../src/core/doc.js';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { mineIn, replyIn, cardIn, fieldShift, FIELD_MOVE } from '../src/components/chat/chatMotion';
import { useBottomClearance } from '../src/components/TimerMiniPlayer';
import { spacing, typography } from '../src/theme';
import { fmtShort } from '../src/lib/format';
import { t } from '../src/lib/i18n';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));

const enc = new TextEncoder();
const ev = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const head = (remaining = 47, limit = 50) => ev('lancible', { remaining, limit, model: 'claude-x' })
  + ev('message_start', { type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 5, output_tokens: 1 } } });
const textStart = (i) => ev('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
const delta = (i, text) => ev('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } });
const stop = (i) => ev('content_block_stop', { type: 'content_block_stop', index: i });
const tool = (i, id, name, input) => ev('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id, name, input: {} } })
  + ev('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
  + stop(i);
const end = (reason = 'end_turn') => ev('message_delta', { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 3 } })
  + ev('message_stop', { type: 'message_stop' });
const textReply = (text, remaining) => head(remaining) + textStart(0) + delta(0, text) + stop(0) + end();

/** Ответ функции потоком: тело режется на куски по split байт — в том числе
 *  посреди буквы, как бывает в сети. */
function streamed(body, split = 7) {
  const bytes = enc.encode(body);
  const pieces = [];
  for (let at = 0; at < bytes.length; at += split) pieces.push(bytes.slice(at, at + split));
  let i = 0;
  return {
    ok: true, status: 200, json: async () => ({}),
    body: { getReader: () => ({ read: async () => (i < pieces.length ? { value: pieces[i++], done: false } : { value: undefined, done: true }), cancel: async () => {} }) },
  };
}
/** Поток, который тест кормит сам: push(текст), end(). */
function live() {
  const queue = [];
  let wake = null;
  let ended = false;
  const kick = () => { if (wake) { const w = wake; wake = null; w(); } };
  const reader = {
    read: () => new Promise((resolve) => {
      const next = () => {
        if (queue.length) resolve({ value: enc.encode(queue.shift()), done: false });
        else if (ended) resolve({ value: undefined, done: true });
        else wake = next;
      };
      next();
    }),
    cancel: async () => {},
  };
  return {
    res: { ok: true, status: 200, json: async () => ({}), body: { getReader: () => reader } },
    push: (s) => { queue.push(s); kick(); },
    end: () => { ended = true; kick(); },
  };
}
const failed = (status, json = {}) => ({ ok: false, status, body: null, json: async () => json });
const reply = (res) => mockFetch.mockImplementationOnce(() => Promise.resolve(res));
/** Тело запроса n-го вызова функции. */
const bodyOf = (n) => JSON.parse(mockFetch.mock.calls[n][1].body);

const STATUSES = [
  { id: 's1', projectId: 'p1', name: 'К выполнению', color: '#5ec8f2', kind: 'todo', order: 0 },
  { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
];
const task = (id, title, extra) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, cancelled: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null,
  dueAt: null, repeat: null, notes: null, versionId: null, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...extra,
});
/** Навигация экрана: опции шапки копятся в options (название, счётчик справа). */
const nav = () => {
  const n = { options: {}, navigate: jest.fn(), push: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }), addListener: jest.fn(() => () => {}) };
  n.setOptions = jest.fn((o) => { n.options = { ...n.options, ...o }; });
  return n;
};
/** Счётчик «47 из 50 сегодня» справа в шапке чата. Рисуется отдельно —
 *  после него события ловит только эта отрисовка: звать в конце теста. */
async function quotaIn(navigation) {
  const right = navigation.options.headerRight;
  if (!right) return null;
  const r = await render(right());
  const q = r.queryByTestId('chat-quota');
  return q ? q.props.children : null;
}
/** Кнопка шапки по testID — из того, что экран отдал в headerRight. */
function headerButton(navigation, testID) {
  const right = navigation.options.headerRight && navigation.options.headerRight();
  const kids = right ? [].concat(right.props.children) : [];
  return kids.find((el) => el && el.props && el.props.testID === testID) || null;
}

function seed(tasks = [task('t1', 'Вёрстка')]) {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z', pinnedAt: null, tagIds: [] }],
    statuses: STATUSES, versions: [], tags: [], documents: [], tasks, activeTimer: null,
    ui: { ...useAppStore.getState().ui, view: 'home', projectId: null },
  });
}
const signIn = (id = 'u1') => useAuthStore.setState({ status: 'signedIn', user: { id, email: `${id}@example.com` } });

let session;
beforeEach(async () => {
  mockReduced = false;
  mockFetch.mockReset();
  await AsyncStorage.clear();
  aiStop();
  useAiChat.setState({
    uid: null, loaded: false, chats: [], chatId: null, opened: false, messages: [], items: [], pending: [], attaching: false, attachError: null,
    busy: false, waiting: false, liveId: null, needAuth: false, remaining: null, limit: null, limitUntil: 0,
  });
  useSheetStore.setState({ content: null, header: null, footer: null });
  seed();
  signIn();
  session = jest.spyOn(sb.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok-1' } }, error: null });
});
afterEach(() => {
  session.mockRestore();
  useAuthStore.setState({ status: 'signedOut', user: null });
});

let navigation;
let chatId;
/** Новый чат, как его открывает «+» списка: аккаунт прочитан, id заведён. */
async function open(id) {
  await act(async () => { await aiAccount(useAuthStore.getState().user.id); });
  chatId = id || aiNewChat();
  navigation = nav();
  // Лист — в том же дереве: события ловит только последнее отрисованное.
  const s = await render(<><ChatThreadScreen navigation={navigation} route={{ params: { chatId } }} /><BottomSheet /></>);
  await waitFor(() => expect(useAiChat.getState().opened).toBe(true));
  return s;
}
async function say(s, text) {
  await fireEvent.changeText(s.getByTestId('chat-input'), text);
  await fireEvent.press(s.getByTestId('chat-send'));
}
const idle = () => waitFor(() => expect(useAiChat.getState().busy).toBe(false));
const saved = async (id = 'u1', chat = chatId) => JSON.parse((await AsyncStorage.getItem(aiChatKey(id, chat))) || 'null');

// --- поток ---------------------------------------------------------------------------

describe('поток ответа', () => {
  test('запрос — та же функция и тот же протокол, что у веба: токен сеанса, история, снимок ядра', async () => {
    reply(streamed(textReply('Привет!')));
    const s = await open();
    await say(s, 'Что у меня сегодня?');
    await idle();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(AI_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-1', apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' });
    const body = bodyOf(0);
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Что у меня сегодня?' }] }]);
    expect(body.lang).toBe('ru');
    expect(typeof body.tz).toBe('string');
    expect(Number.isFinite(Date.parse(body.now))).toBe(true);
    // Снимок — от ядра: проекты со статусами, задачи, без лишнего.
    expect(body.context.projects[0]).toMatchObject({ id: 'p1', name: 'Сайт' });
    expect(body.context.tasks.map((x) => x.id)).toEqual(['t1']);
    expect(body.context.tasks[0]).not.toHaveProperty('sessions');
    // Навигации нет — и открытого проекта нет.
    expect(body.context.focus).toEqual({ view: null, projectId: null, taskId: null });
  });

  test('фокус — страница проекта сверху стека вкладки, где человек был последним', () => {
    const root = {
      routes: [
        { key: 'P', name: 'Projects', state: { index: 1, routes: [{ name: 'ProjectsMain' }, { name: 'Project', params: { projectId: 'p1' } }] } },
        { key: 'T', name: 'Tasks', state: { index: 0, routes: [{ name: 'TasksMain' }] } },
        { key: 'C', name: 'Chat' },
      ],
      history: [{ type: 'route', key: 'P' }, { type: 'route', key: 'T' }, { type: 'route', key: 'C' }],
    };
    expect(openProjectId(root)).toBe('p1');
    // Со страницы проекта ушли «назад» — фокуса нет.
    root.routes[0].state = { index: 0, routes: [{ name: 'ProjectsMain' }] };
    expect(openProjectId(root)).toBeNull();
    expect(openProjectId(null)).toBeNull();
  });

  test('текст приходит кусками и встаёт на место по мере прихода; три точки — до первого слова', async () => {
    const r = live();
    reply(r.res);
    const s = await open();
    await say(s, 'Привет');
    // Ждём слов — три точки.
    await waitFor(() => s.getByTestId('chat-typing'));
    await act(async () => { r.push(head(41) + textStart(0) + delta(0, 'Сегодня две ')); });
    await waitFor(() => s.getByText('Сегодня две'));
    expect(s.queryByTestId('chat-typing')).toBeNull();
    // Счётчик — из первого кадра функции, справа в шапке.
    expect(await quotaIn(navigation)).toBe(t('ru', 'ai.quota', { remaining: 41, limit: 50 }));
    await act(async () => { r.push(delta(0, 'задачи:\n- Вёрстка\n- **Правки**\n\nДальше — свободно.')); });
    await act(async () => { r.push(stop(0) + end()); r.end(); });
    await idle();
    // Абзацы и список — текстом, звёздочки сняты; разметки из ответа нет.
    s.getByText('Сегодня две задачи:');
    s.getByText('Вёрстка');
    s.getByText('Правки');
    s.getByText('Дальше — свободно.');
    expect(s.queryByText(/\*\*/)).toBeNull();
    // В историю — ответ ядра (aiAssistantMessage).
    const h = await saved();
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(h.messages[1].content).toEqual([{ type: 'text', text: 'Сегодня две задачи:\n- Вёрстка\n- **Правки**\n\nДальше — свободно.' }]);
  });

  test('лента докручивается вниз, только если человек внизу', async () => {
    const r = live();
    reply(r.res);
    const s = await open();
    const toEnd = ScrollView.prototype.scrollToEnd;
    await say(s, 'Привет');
    await act(async () => { r.push(head() + textStart(0) + delta(0, 'Первая строка')); });
    await waitFor(() => s.getByText('Первая строка'));
    const log = s.getByTestId('chat-log');
    toEnd.mockClear();
    await fireEvent(log, 'contentSizeChange', 390, 900);
    expect(toEnd).toHaveBeenCalledWith({ animated: false });
    // Человек ушёл листать вверх — поток его не уводит.
    await fireEvent.scroll(log, { nativeEvent: { contentOffset: { y: 100 }, contentSize: { height: 900, width: 390 }, layoutMeasurement: { height: 400, width: 390 } } });
    toEnd.mockClear();
    await act(async () => { r.push(delta(0, ' и ещё')); });
    await fireEvent(log, 'contentSizeChange', 390, 950);
    expect(toEnd).not.toHaveBeenCalled();
    // Вернулся вниз — снова держит.
    await fireEvent.scroll(log, { nativeEvent: { contentOffset: { y: 530 }, contentSize: { height: 950, width: 390 }, layoutMeasurement: { height: 400, width: 390 } } });
    await fireEvent(log, 'contentSizeChange', 390, 990);
    expect(toEnd).toHaveBeenCalledWith({ animated: false });
    await act(async () => { r.push(stop(0) + end()); r.end(); });
    await idle();
  });
});

// --- карточка предложения ------------------------------------------------------------

const PROPOSAL = {
  summary: 'План на неделю',
  ops: [
    { op: 'create_task', ref: 'n1', project: 'p1', title: 'Созвон с клиентом', dueAt: '2026-10-20' },
    { op: 'update_task', id: 't1', patch: { title: 'Вёрстка шапки', done: true } },
  ],
};
const proposalReply = (input = PROPOSAL, id = 'toolu_card') => head() + textStart(0) + delta(0, 'Предлагаю так.') + stop(0)
  + tool(1, id, 'propose_changes', input) + end('tool_use');

describe('карточка предложения', () => {
  test('строки — из ядра: значок, что и название, подстрока; кнопки «Применить» и «Отклонить»', async () => {
    reply(streamed(proposalReply()));
    const s = await open();
    await say(s, 'Распланируй');
    await idle();
    const card = within(s.getByTestId('chat-card-toolu_card'));
    card.getByText('План на неделю');
    expect(card.getAllByTestId('chat-op')).toHaveLength(2);
    card.getByText(t('ru', 'ai.op_create_task'));
    card.getByText('Созвон с клиентом');
    card.getByText(t('ru', 'ai.op_update_task'));
    card.getByText('Вёрстка шапки');
    // Подстрока: проект · дедлайн (срок без времени — к концу дня, 18:00).
    card.getByText(new RegExp(`^Сайт · ${t('ru', 'ai.sub_due', { date: '' })}.*18:00$`));
    card.getByText(`Сайт · ${t('ru', 'ai.sub_done')}`);
    expect(card.getByTestId('chat-card-apply')).toBeTruthy();
    expect(card.getByTestId('chat-card-decline')).toBeTruthy();
  });

  test('«Применить» — данные одной правкой стора; «Отменить» — всё как было', async () => {
    reply(streamed(proposalReply()));
    const s = await open();
    await say(s, 'Распланируй');
    await idle();
    const before = JSON.parse(JSON.stringify({ tasks: useAppStore.getState().tasks, projects: useAppStore.getState().projects, statuses: useAppStore.getState().statuses }));
    const changes = [];
    const unsub = useAppStore.subscribe((st, prev) => { if (st.tasks !== prev.tasks) changes.push(st.tasks); });
    await fireEvent.press(s.getByTestId('chat-card-apply'));
    unsub();
    // Одна правка списка задач — не по задаче на операцию.
    expect(changes).toHaveLength(1);
    const tasks = useAppStore.getState().tasks;
    const made = tasks.find((x) => x.title === 'Созвон с клиентом');
    expect(made).toMatchObject({ projectId: 'p1', statusId: 's1', done: false });
    // Поля, которые ядро не заводит, достроила миграция, как при загрузке.
    expect(Array.isArray(made.tagIds)).toBe(true);
    expect(tasks.find((x) => x.id === 't1')).toMatchObject({ title: 'Вёрстка шапки', done: true, statusId: 's2' });
    // Тост и решённая карточка: «Применено изменений: 2 · Отменить».
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'ai.applied', { n: 2 }));
    const card = within(s.getByTestId('chat-card-toolu_card'));
    card.getByText(t('ru', 'ai.applied', { n: 2 }));
    expect(card.queryByTestId('chat-card-apply')).toBeNull();
    // Созданное — ссылкой.
    expect(card.getAllByTestId('chat-op-link')).toHaveLength(2);

    await fireEvent.press(card.getByTestId('chat-card-undo'));
    const after = useAppStore.getState();
    expect(after.tasks.map((x) => x.id)).toEqual(before.tasks.map((x) => x.id));
    expect(after.tasks.find((x) => x.id === 't1')).toMatchObject({ title: 'Вёрстка', done: false, statusId: 's1' });
    card.getByText(t('ru', 'ai.undone'));
    expect(card.queryByTestId('chat-card-undo')).toBeNull();
    // Решение — в истории устройства.
    const h = await saved();
    expect(h.items.find((it) => it.id === 'toolu_card')).toMatchObject({ kind: 'card', state: 'undone' });
  });

  // 18 октября 2026: открытый в другой вкладке редактор заметок держит набранное
  // у себя до своего таймера (hooks/useEditorSession: save) и кладёт в стор позже.
  // Предложение, правящее те же заметки, ложилось на устаревший текст, а позднее
  // сохранение редактора затирало правку агента. Теперь «Применить» и «Отменить»
  // сначала зовут тот же сброс, что синхронизация перед приёмом (registerEditorFlush).
  describe('открытый редактор заметок', () => {
    const NOTES = { summary: 'Заметка', ops: [{ op: 'update_task', id: 't1', patch: { notes: 'Из чата' } }] };
    const container = (text) => ({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, comments: [], ink: [] });
    const lines = (notes) => DocCore.readNotes(notes).doc.content.map((b) => (b.content || []).map((n) => n.text).join(''));
    let off = null;
    let unsub = null;
    afterEach(() => { if (off) off(); if (unsub) unsub(); off = null; unsub = null; });

    /** Редактор вкладки задачи: держит текст, на сброс кладёт его в задачу, как save(). */
    function editorHolding(text, events) {
      let pending = container(text);
      off = registerEditorFlush(() => {
        if (!pending) return;
        events.push('flush');
        useAppStore.getState().updateTask('t1', { notes: DocCore.writeNotes(pending) });
        pending = null;
      });
      return { type: (next) => { pending = container(next); } };
    }
    /** Заметки t1 после каждой правки списка задач, по порядку. */
    function watchNotes(seen) {
      unsub = useAppStore.subscribe((st, prev) => {
        if (st.tasks !== prev.tasks) seen.push(lines(st.tasks.find((x) => x.id === 't1').notes));
      });
    }

    test('«Применить» сначала сбрасывает набранное в стор, потом применяет: заметки — и набранное, и от агента', async () => {
      const events = [];
      const seen = [];
      editorHolding('Набрано в редакторе', events);
      watchNotes(seen);
      reply(streamed(proposalReply(NOTES)));
      const s = await open();
      await say(s, 'Допиши заметку');
      await idle();
      await fireEvent.press(s.getByTestId('chat-card-apply'));
      expect(events).toEqual(['flush']);
      // Две правки подряд: сброс редактора, затем предложение — поверх него.
      expect(seen).toEqual([['Набрано в редакторе'], ['Набрано в редакторе', 'Из чата']]);
      expect(lines(useAppStore.getState().tasks[0].notes)).toEqual(['Набрано в редакторе', 'Из чата']);
      within(s.getByTestId('chat-card-toolu_card')).getByText(t('ru', 'ai.applied', { n: 1 }));
    });

    test('«Отменить» тоже сначала сбрасывает набранное: позднее сохранение редактора не ложится поверх отмены', async () => {
      const events = [];
      const typing = editorHolding('Набрано в редакторе', events);
      reply(streamed(proposalReply(NOTES)));
      const s = await open();
      await say(s, 'Допиши заметку');
      await idle();
      await fireEvent.press(s.getByTestId('chat-card-apply'));
      expect(lines(useAppStore.getState().tasks[0].notes)).toEqual(['Набрано в редакторе', 'Из чата']);
      // После применения редактор снова что-то держит; отмена сперва забирает это.
      typing.type('Ещё набрано');
      const seen = [];
      watchNotes(seen);
      await fireEvent.press(within(s.getByTestId('chat-card-toolu_card')).getByTestId('chat-card-undo'));
      expect(events).toEqual(['flush', 'flush']);
      expect(seen[0]).toEqual(['Ещё набрано']);
      expect(seen).toHaveLength(2);
      // Отмена — по полям (Core.aiUndo, 19 октября 2026): заметки поменяли
      // после применения — они остаются как есть, набранное не теряется, а тост
      // говорит, что отменилось не всё.
      expect(lines(useAppStore.getState().tasks[0].notes)).toEqual(['Ещё набрано']);
      expect(useAppStore.getState().toastMessage).toBe(t('ru', 'ai.undo_kept'));
    });
  });

  test('закрытая предложением повторяющаяся задача идёт путём галочки: повтор перекатывается так же', async () => {
    const rule = { freq: 'day', every: 1 };
    const daily = () => [task('t1', 'Зарядка', { repeat: rule, dueAt: '2026-10-18T06:00:00.000Z' })];
    // Галочка.
    seed(daily());
    useAppStore.getState().setTaskDone('t1', true);
    const byTick = useAppStore.getState().tasks.find((x) => x.id === 't1');
    // Агент.
    seed(daily());
    reply(streamed(proposalReply({ summary: 'Готово', ops: [{ op: 'update_task', id: 't1', patch: { done: true } }] })));
    const s = await open();
    await say(s, 'Отметь зарядку');
    await idle();
    await fireEvent.press(s.getByTestId('chat-card-apply'));
    const byAgent = useAppStore.getState().tasks.find((x) => x.id === 't1');
    expect(byAgent.done).toBe(byTick.done);
    expect(byAgent.dueAt).toBe(byTick.dueAt);
    expect(byAgent.repeat).toEqual(byTick.repeat);
  });

  test('решение уходит следующим сообщением tool_result: applied, declined, без решения — pending', async () => {
    reply(streamed(proposalReply()));
    const s = await open();
    await say(s, 'Распланируй');
    await idle();
    // Без решения — «pending», карточка остаётся с кнопками и «Ждёт решения».
    reply(streamed(textReply('Хорошо, жду.')));
    await say(s, 'Подумаю');
    await idle();
    expect(bodyOf(1).messages.at(-1).content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_card', content: 'pending' },
      { type: 'text', text: 'Подумаю' },
    ]);
    within(s.getByTestId('chat-card-toolu_card')).getByTestId('chat-card-pending');
    // Второе предложение — отклонено.
    reply(streamed(proposalReply(PROPOSAL, 'toolu_card2')));
    await say(s, 'Ещё вариант');
    await idle();
    await fireEvent.press(within(s.getByTestId('chat-card-toolu_card2')).getByTestId('chat-card-decline'));
    within(s.getByTestId('chat-card-toolu_card2')).getByText(t('ru', 'ai.declined'));
    reply(streamed(textReply('Понял.')));
    await say(s, 'Нет');
    await idle();
    expect(bodyOf(3).messages.at(-1).content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_card2', content: 'declined' });
    // Третье — применено.
    reply(streamed(proposalReply(PROPOSAL, 'toolu_card3')));
    await say(s, 'Давай заново');
    await idle();
    await fireEvent.press(within(s.getByTestId('chat-card-toolu_card3')).getByTestId('chat-card-apply'));
    reply(streamed(textReply('Готово.')));
    await say(s, 'Спасибо');
    await idle();
    expect(bodyOf(5).messages.at(-1).content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_card3', content: 'applied' });
  });

  test('ошибки проверки ядра — под строками, «Применить» недоступна', async () => {
    reply(streamed(proposalReply({ summary: 'Кривое', ops: [{ op: 'update_task', id: 'нет-такой', patch: { title: 'X' } }] })));
    const s = await open();
    await say(s, 'Поменяй');
    await idle();
    const card = within(s.getByTestId('chat-card-toolu_card'));
    within(card.getByTestId('chat-card-error')).getByText(new RegExp(t('ru', 'ai.err_unknown_id')));
    await fireEvent.press(card.getByTestId('chat-card-apply'));
    expect(useAppStore.getState().tasks.map((x) => x.title)).toEqual(['Вёрстка']);
  });
});

// --- круг инструментов -----------------------------------------------------------------

describe('круг инструментов', () => {
  test('free_windows считает ядро из стора: ответ уходит tool_result тем же снимком и «сейчас», шаг подписан', async () => {
    reply(streamed(head() + tool(0, 'toolu_fw', 'free_windows', { from: '2026-10-19', to: '2026-10-23', minMinutes: 60 }) + end('tool_use')));
    reply(streamed(textReply('Свободно во вторник.')));
    const s = await open();
    await say(s, 'Когда я свободен?');
    await idle();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [first, second] = [bodyOf(0), bodyOf(1)];
    expect(second.now).toBe(first.now);
    expect(second.context).toEqual(first.context);
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[1].content).toEqual([{ type: 'tool_use', id: 'toolu_fw', name: 'free_windows', input: { from: '2026-10-19', to: '2026-10-23', minMinutes: 60 } }]);
    const result = second.messages[2].content[0];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_fw' });
    const out = JSON.parse(result.content);
    expect(Array.isArray(out.windows)).toBe(true);
    expect(out.workHours).toEqual({ start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] });
    s.getByText(/^Свободные окна: /);
    s.getByText('Свободно во вторник.');
  });

  test('time_spent — записанное время задачи из стора', async () => {
    seed([task('t1', 'Вёрстка', { sessions: [{ start: new Date(Date.now() - 2 * 3_600_000).toISOString(), end: new Date(Date.now() - 3_600_000).toISOString(), ms: 3_600_000 }], totalMs: 3_600_000 })]);
    // Период — явно вокруг записи: без него ядро берёт текущую неделю с
    // понедельника, и в понедельник после полуночи запись «два часа назад»
    // оказывалась в прошлой неделе — тест краснел по времени суток.
    const span = { from: new Date(Date.now() - 3 * 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() };
    reply(streamed(head() + tool(0, 'toolu_ts', 'time_spent', span) + end('tool_use')));
    reply(streamed(textReply('Час.')));
    const s = await open();
    await say(s, 'Сколько я работал?');
    await idle();
    const out = JSON.parse(bodyOf(1).messages[2].content[0].content);
    expect(out.totalMin).toBe(60);
    expect(out.byTask[0]).toMatchObject({ id: 't1', minutes: 60 });
    s.getByText(t('ru', 'ai.step_spent_done', { time: fmtShort(3_600_000) }));
  });

  test('не больше четырёх кругов подряд', async () => {
    for (let i = 0; i < 8; i += 1) reply(streamed(head() + tool(0, `toolu_${i}`, 'time_spent', {}) + end('tool_use')));
    const s = await open();
    await say(s, 'Считай');
    await idle();
    expect(mockFetch).toHaveBeenCalledTimes(AI_MAX_ROUNDS + 1);
  });
});

// --- ошибки --------------------------------------------------------------------------------

describe('ошибки функции', () => {
  test('429 — «лимит на сегодня», счётчик 0; до сброса следующее сообщение в сеть не идёт', async () => {
    reply(failed(429, { error: 'limit', remaining: 0, limit: 50, resetAt: new Date(Date.now() + 3_600_000).toISOString() }));
    const s = await open();
    await say(s, 'Привет');
    await idle();
    s.getByText(t('ru', 'ai.limit_reached'));
    expect(await quotaIn(navigation)).toBe(t('ru', 'ai.quota', { remaining: 0, limit: 50 }));
    await say(s, 'Ещё раз');
    await idle();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    s.getByText(t('ru', 'ai.limit_reached'));
  });

  test('401 — экран входа; вошёл заново — лента на месте', async () => {
    reply(failed(401, { error: 'not signed in' }));
    const s = await open();
    await say(s, 'Привет');
    await idle();
    s.getByTestId('chat-signin');
    s.getByText(t('ru', 'ai.signin_title'));
    expect(s.queryByTestId('chat-input')).toBeNull();
    // Вход тем же аккаунтом (новый объект user) — снова лента и поле.
    await act(async () => { signIn('u1'); });
    await waitFor(() => s.getByTestId('chat-input'));
    s.getByText('Привет');
  });

  test('429 rate — «Подождите N с», «Повторить» — когда время выйдет; суточный лимит не тронут', async () => {
    reply(failed(429, { error: 'rate', retryAfter: 1, limit: 6 }));
    reply(streamed(textReply('Теперь дошло.')));
    const s = await open();
    await say(s, 'Привет');
    await idle();
    s.getByText(t('ru', 'ai.rate_wait', { n: 1 }));
    expect(s.queryByTestId('chat-retry')).toBeNull();
    expect(useAiChat.getState()).toMatchObject({ remaining: null, limitUntil: 0 });
    await waitFor(() => s.getByTestId('chat-retry'), { timeout: 2500 });
    await fireEvent.press(s.getByTestId('chat-retry'));
    await idle();
    s.getByText('Теперь дошло.');
    expect(bodyOf(1).messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Привет' }] }]);
  });

  test('404 — «агент недоступен», без «Повторить»', async () => {
    reply(failed(404));
    const s = await open();
    await say(s, 'Привет');
    await idle();
    s.getByText(t('ru', 'ai.unavailable'));
    expect(s.queryByTestId('chat-retry')).toBeNull();
  });

  test('сеть — «не удалось связаться» и «Повторить»: тот же вопрос ещё раз', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')));
    reply(streamed(textReply('Теперь дошло.')));
    const s = await open();
    await say(s, 'Привет');
    await idle();
    s.getByText(t('ru', 'ai.error_network'));
    await fireEvent.press(s.getByTestId('chat-retry'));
    await idle();
    s.getByText('Теперь дошло.');
    expect(bodyOf(1).messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Привет' }] }]);
    expect(s.queryByText(t('ru', 'ai.error_network'))).toBeNull();
  });

  test('отказ модели без слов — подпись, а вопрос уходит из истории', async () => {
    reply(streamed(head() + end('refusal')));
    const s = await open();
    await say(s, 'Что-то не то');
    await idle();
    s.getByText(t('ru', 'ai.refused'));
    expect(useAiChat.getState().messages).toEqual([]);
  });
});

// --- история ---------------------------------------------------------------------------------

describe('история — на устройстве, своя у аккаунта', () => {
  test('сохраняется под lancible-ai:<uid>:chat:<id>; другой аккаунт — пусто; вернулся — своя на месте и без появления', async () => {
    reply(streamed(textReply('Ответ первому.')));
    const s = await open();
    await say(s, 'Я первый');
    await idle();
    expect((await saved('u1')).items.map((it) => it.text)).toEqual(['Я первый', 'Ответ первому.']);
    expect(await saved('u2')).toBeNull();

    await act(async () => { signIn('u2'); });
    await waitFor(() => expect(useAiChat.getState().uid).toBe('u2'));
    await waitFor(() => s.getByTestId('chat-empty'));
    expect(s.queryByText('Я первый')).toBeNull();

    await act(async () => { signIn('u1'); });
    await waitFor(() => s.getByText('Я первый'));
    // Из истории — без появления.
    const rows = useAiChat.getState().items.map((it) => s.getByTestId(`chat-row-${it.id}`));
    for (const row of rows) expect(row.props.entering).toBeUndefined();
  });

  test('не длиннее 40 сообщений, ошибки в историю не идут', async () => {
    const many = [];
    for (let i = 0; i < 30; i += 1) {
      many.push({ role: 'user', content: [{ type: 'text', text: `вопрос ${i}` }] }, { role: 'assistant', content: [{ type: 'text', text: `ответ ${i}` }] });
    }
    await AsyncStorage.setItem(aiChatKey('u1', 'c-long'), JSON.stringify({ messages: many, items: [] }));
    reply(failed(404));
    const s = await open('c-long');
    await say(s, 'Ещё');
    await idle();
    const h = await saved();
    expect(h.messages.length).toBeLessThanOrEqual(40);
    expect(h.messages[0].role).toBe('user');
    expect(h.items.some((it) => it.kind === 'error')).toBe(false);
  });

});

// --- появление и поле --------------------------------------------------------------------------

describe('появление строк и поле над клавиатурой', () => {
  test('своё — справа снизу, ответ — слева, карточка — подъёмом', async () => {
    // Своё id у карточки: строка, уже показанная в другом тесте, второй раз не появляется.
    reply(streamed(proposalReply(PROPOSAL, 'toolu_anim')));
    const s = await open();
    await say(s, 'Распланируй');
    await idle();
    const [mine, answer, card] = useAiChat.getState().items;
    expect(s.getByTestId(`chat-row-${mine.id}`).props.entering).toBe(mineIn);
    expect(s.getByTestId(`chat-row-${answer.id}`).props.entering).toBe(replyIn);
    expect(s.getByTestId(`chat-row-${card.id}`).props.entering).toBe(cardIn);
  });

  test('«уменьшение движения» — ничего не въезжает, точки стоят', async () => {
    mockReduced = true;
    const r = live();
    reply(r.res);
    const s = await open();
    await say(s, 'Привет');
    await waitFor(() => s.getByTestId('chat-typing'));
    expect(s.getByTestId('chat-typing').props.entering).toBeUndefined();
    await act(async () => { r.push(textReply('Ответ.')); r.end(); });
    await idle();
    for (const it of useAiChat.getState().items) expect(s.getByTestId(`chat-row-${it.id}`).props.entering).toBeUndefined();
  });

  test('отступ под полем — безопасное поле снизу (таббара на экране чата нет); клавиатура открыта — малый, поле у её края', async () => {
    const insets = jest.spyOn(require('react-native-safe-area-context'), 'useSafeAreaInsets').mockReturnValue({ top: 0, right: 0, bottom: 34, left: 0 });
    const s = await open();
    const pad = () => StyleSheet.flatten(s.getByTestId('chat-compose').props.style).paddingBottom;
    expect(pad()).toBe(34 + spacing.sm);
    // Не запас вкладки: под полем нет ни панели вкладок, ни плашки таймера.
    const clearance = (await render(<Probe />)).getByTestId('probe').props.children;
    expect(pad()).not.toBe(clearance + 34);
    const progress = keyboardController.useReanimatedKeyboardAnimation().progress;
    progress.value = 1;
    await s.rerender(<><ChatThreadScreen navigation={navigation} route={{ params: { chatId } }} /><BottomSheet /></>);
    expect(pad()).toBe(spacing.sm);
    progress.value = 0;
    insets.mockRestore();
  });

  test('поле — не длиннее 50 000 знаков (столько пропускает функция)', async () => {
    const s = await open();
    expect(s.getByTestId('chat-input').props.maxLength).toBe(50000);
  });

  test('«⋯» в шапке — «Удалить чат»: подтверждение, чат уходит с устройства, экран — назад к списку', async () => {
    reply(streamed(textReply('Ответ.')));
    const s = await open();
    // Пустой новый чат удалять нечего — меню нет.
    expect(headerButton(navigation, 'chat-menu')).toBeNull();
    await say(s, 'Вопрос');
    await idle();
    expect(await saved()).not.toBeNull();
    const menu = headerButton(navigation, 'chat-menu');
    expect(menu.props.label).toBe(t('ru', 'ai.menu'));
    await act(async () => { menu.props.onPress(); });
    await fireEvent.press(s.getByTestId('menu-delete-chat'));
    const sheet = within(s.getByTestId('sheet'));
    sheet.getByText(t('ru', 'ai.delete_chat_text', { name: 'Вопрос' }));
    await fireEvent.press(sheet.getByText(t('ru', 'ai.delete_chat')));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(await saved()).toBeNull();
    expect(useAiChat.getState().chats).toEqual([]);
  });

  test('отправка — только кнопкой: пусто или идёт ответ — кнопка недоступна', async () => {
    const r = live();
    reply(r.res);
    const s = await open();
    expect(s.getByTestId('chat-send').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(s.getByTestId('chat-input'), 'Строка\nвторая');
    expect(s.getByTestId('chat-input').props.multiline).toBe(true);
    expect(s.getByTestId('chat-send').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(s.getByTestId('chat-send'));
    expect(bodyOf(0).messages[0].content[0].text).toBe('Строка\nвторая');
    expect(s.getByTestId('chat-input').props.value).toBe('');
    // Пока идёт ответ, поле недоступно, и кнопка тоже.
    expect(s.getByTestId('chat-input').props.editable).toBe(false);
    expect(s.getByTestId('chat-send').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => { r.push(textReply('Ок.')); r.end(); });
    await idle();
    expect(s.getByTestId('chat-input').props.editable).toBe(true);
    await fireEvent.changeText(s.getByTestId('chat-input'), 'Дальше');
    expect(s.getByTestId('chat-send').props.accessibilityState).toMatchObject({ disabled: false });
  });
});

// --- пересечения и часы (дополнение 18 октября 2026) ---------------------------------
// Задачи можно ставить на любое время и друг на друга: карточка предупреждает о
// пересечении (Core.aiSlotConflicts), а «Применить» сначала спрашивает.

describe('пересечения отрезков', () => {
  // Завтра 10:00–11:00 по местному времени — «Вёрстка» уже стоит.
  const day = new Date(Date.now() + 86_400_000);
  const at = (h, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString();
  const busy = () => [task('t1', 'Вёрстка', { slots: [{ id: 'sl1', start: at(10), end: at(11) }] })];
  const OVERLAP = { summary: 'Созвон', ops: [{ op: 'create_task', ref: 'n1', project: 'p1', title: 'Созвон', slots: [{ start: at(10, 30), end: at(11, 30) }] }] };

  test('строка предупреждения под операцией: с чем и когда пересекается', async () => {
    seed(busy());
    reply(streamed(proposalReply(OVERLAP, 'toolu_ov1')));
    const s = await open();
    await say(s, 'Поставь созвон на завтра в 10:30');
    await idle();
    const card = within(s.getByTestId('chat-card-toolu_ov1'));
    const lines = card.getAllByTestId('chat-op-overlap');
    expect(lines).toHaveLength(1);
    within(lines[0]).getByText(new RegExp(`«Вёрстка»`));
  });

  test('«Применить» при пересечении — сначала вопрос; «Поставить» ставит в то же время, «Отмена» — ничего', async () => {
    seed(busy());
    reply(streamed(proposalReply(OVERLAP, 'toolu_ov2')));
    const s = await open();
    await say(s, 'Поставь созвон на завтра в 10:30');
    await idle();
    await fireEvent.press(s.getByTestId('chat-card-apply'));
    // Вопрос — общим листом подтверждения; в данных пока ничего.
    const sheet = () => within(s.getByTestId('sheet'));
    sheet().getByText(new RegExp('«Вёрстка»'));
    expect(useAppStore.getState().tasks.map((x) => x.title)).toEqual(['Вёрстка']);
    await fireEvent.press(sheet().getByText(t('ru', 'common.cancel')));
    expect(useSheetStore.getState().content).toBeNull();
    expect(useAppStore.getState().tasks.map((x) => x.title)).toEqual(['Вёрстка']);
    within(s.getByTestId('chat-card-toolu_ov2')).getByTestId('chat-card-apply');

    await fireEvent.press(s.getByTestId('chat-card-apply'));
    expect(useSheetStore.getState().content).not.toBeNull();
    await fireEvent.press(sheet().getByText(t('ru', 'ai.conflict_ok')));
    const made = useAppStore.getState().tasks.find((x) => x.title === 'Созвон');
    expect(made).toBeTruthy();
    expect(made.slots.map((x) => [x.start, x.end])).toEqual([[at(10, 30), at(11, 30)]]);
    within(s.getByTestId('chat-card-toolu_ov2')).getByText(t('ru', 'ai.applied', { n: 1 }));
  });

  test('без пересечений — «Применить» сразу, без вопроса', async () => {
    seed(busy());
    const free = { summary: 'Созвон', ops: [{ op: 'create_task', ref: 'n1', project: 'p1', title: 'Созвон', slots: [{ start: at(14), end: at(15) }] }] };
    reply(streamed(proposalReply(free, 'toolu_ov3')));
    const s = await open();
    await say(s, 'Поставь созвон на завтра в 14');
    await idle();
    expect(within(s.getByTestId('chat-card-toolu_ov3')).queryAllByTestId('chat-op-overlap')).toHaveLength(0);
    await fireEvent.press(s.getByTestId('chat-card-apply'));
    expect(useSheetStore.getState().content).toBeNull();
    expect(useAppStore.getState().tasks.some((x) => x.title === 'Созвон')).toBe(true);
  });
});

describe('free_windows — в часах человека или в тех, что назвала модель', () => {
  test('рабочие часы — из настроек (Core.aiWorkHours); hours модели — поверх них', async () => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, workHours: { start: '10:00', end: '16:00', days: [1, 2, 3] } } });
    reply(streamed(head() + tool(0, 'toolu_h1', 'free_windows', { from: '2026-10-19', to: '2026-10-23' }) + end('tool_use')));
    reply(streamed(textReply('Есть окна.')));
    reply(streamed(head() + tool(0, 'toolu_h2', 'free_windows', { from: '2026-10-19', to: '2026-10-25', hours: { start: '19:00', end: '22:00' } }) + end('tool_use')));
    reply(streamed(textReply('Вечером свободно.')));
    const s = await open();
    await say(s, 'Когда я свободен?');
    await idle();
    expect(JSON.parse(bodyOf(1).messages.at(-1).content[0].content).workHours).toEqual({ start: '10:00', end: '16:00', days: [1, 2, 3] });
    await say(s, 'А вечером?');
    await idle();
    expect(JSON.parse(bodyOf(3).messages.at(-1).content[0].content).workHours).toEqual({ start: '19:00', end: '22:00', days: [1, 2, 3] });
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, workHours: undefined } });
  });
});

/** Значение useBottomClearance в том же сторе. */
function Probe() {
  const Text = require('react-native').Text;
  return <Text testID="probe">{useBottomClearance()}</Text>;
}

// Круг 21 (19 октября 2026): поле главного экрана «Чат-бота» → чат почти
// незаметно; название в шапке — мельче; поле над клавиатурой.
describe('переход с поля главного экрана, шапка и клавиатура', () => {
  /** Чат, как его открывает отправка с поля главного экрана. */
  async function openFromMain(params) {
    await act(async () => { await aiAccount(useAuthStore.getState().user.id); });
    chatId = aiNewChat();
    navigation = nav();
    navigation.setParams = jest.fn();
    const s = await render(<><ChatThreadScreen navigation={navigation} route={{ params: { chatId, ...params } }} /><BottomSheet /></>);
    return s;
  }

  test('первое сообщение отправляет экран чата, когда встал, — и оно появляется, как обычно', async () => {
    reply(streamed(textReply('Начнём с понедельника.')));
    const s = await openFromMain({ send: 'Распланируй неделю', quiet: true, from: 400 });
    await idle();
    expect(bodyOf(0).messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Распланируй неделю' }] }]);
    const [mine, answer] = useAiChat.getState().items;
    expect(mine).toMatchObject({ kind: 'msg', role: 'user', text: 'Распланируй неделю' });
    // Появление — своё, справа снизу, как у сообщения, отправленного здесь.
    expect(s.getByTestId(`chat-row-${mine.id}`).props.entering).toBe(mineIn);
    expect(s.getByTestId(`chat-row-${answer.id}`).props.entering).toBe(replyIn);
    // Второй раз не уйдёт; поле пустое; пустой ленты («что умеет агент») не было.
    expect(navigation.setParams).toHaveBeenCalledWith({ send: undefined });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(s.getByTestId('chat-input').props.value).toBe('');
    expect(s.queryByTestId('chat-empty')).toBeNull();
  });

  test('поле едет от места поля главного экрана к своему: сначала стоит там, по ходу — на месте', async () => {
    reply(streamed(textReply('Ок.')));
    const s = await openFromMain({ send: 'Привет', quiet: true, from: 400 });
    const move = () => StyleSheet.flatten(s.getByTestId('chat-field-move').props.style);
    // До хода: сдвиг — от своего места (в Node measure отдаёт 0) до верха поля главного.
    expect(move().transform).toEqual([{ translateY: fieldShift(400, 0, 0) }]);
    expect(fieldShift(400, 0, 0)).toBe(400);
    expect(fieldShift(400, 700, 0.5)).toBe(-150);
    expect(fieldShift(400, 700, 1)).toBe(0);
    // Встало на место — ход пошёл: доля хода к 1 за FIELD_MOVE (ease out), один раз.
    const timing = jest.spyOn(Reanimated, 'withTiming');
    await fireEvent(s.getByTestId('chat-field'), 'layout', { nativeEvent: { layout: { x: 0, y: 600, width: 390, height: 64 } } });
    await fireEvent(s.getByTestId('chat-field'), 'layout', { nativeEvent: { layout: { x: 0, y: 590, width: 390, height: 64 } } });
    expect(timing.mock.calls.filter(([to, cfg]) => to === 1 && cfg === FIELD_MOVE)).toHaveLength(1);
    expect(FIELD_MOVE.duration).toBeGreaterThanOrEqual(250);
    timing.mockRestore();
    await idle();
  });

  test('«уменьшение движения» и чат из списка — поле сразу на месте', async () => {
    mockReduced = true;
    reply(streamed(textReply('Ок.')));
    const s = await openFromMain({ send: 'Привет', quiet: true, from: 400 });
    expect(StyleSheet.flatten(s.getByTestId('chat-field-move').props.style).transform).toEqual([{ translateY: 0 }]);
    await idle();
    mockReduced = false;
    const list = await open();
    expect(StyleSheet.flatten(list.getByTestId('chat-field-move').props.style).transform).toEqual([{ translateY: 0 }]);
  });

  test('с поля — без хода стека (проявление 120–160 мс); из списка — прежний ход; после перехода «назад» — обычный', async () => {
    const quiet = chatThreadOptions({ route: { params: { chatId: 'c-1', quiet: true } } });
    expect(quiet.animation).toBe('fade');
    expect(quiet.animationDuration).toBeGreaterThanOrEqual(120);
    expect(quiet.animationDuration).toBeLessThanOrEqual(160);
    // Из списка своего хода у экрана нет — ход стека (ios_from_right, ChatStack).
    expect(chatThreadOptions({ route: { params: { chatId: 'c-1' } } })).not.toHaveProperty('animation');
    reply(streamed(textReply('Ок.')));
    await openFromMain({ send: 'Привет', quiet: true });
    const end = navigation.addListener.mock.calls.filter(([name]) => name === 'transitionEnd').pop()[1];
    await act(async () => { end({ data: { closing: false } }); });
    expect(navigation.setParams).toHaveBeenCalledWith({ quiet: undefined });
    await idle();
  });

  test('название чата в шапке — на ступень мельче названия страницы (typography.title)', async () => {
    reply(streamed(textReply('Ок.')));
    const s = await open();
    await say(s, 'Распланируй мне неделю');
    await idle();
    expect(navigation.options.title).toBe('Распланируй мне неделю');
    const head = await render(navigation.options.headerTitle());
    const style = StyleSheet.flatten(head.getByTestId('chat-title').props.style);
    expect(head.getByTestId('chat-title').props.children).toBe('Распланируй мне неделю');
    expect(style.fontSize).toBe(typography.title.fontSize);
    expect(style.fontSize).toBeLessThan(screenTitleStyle({ text: '#000' }).fontSize);
    expect(style.fontFamily).toBe(typography.title.fontFamily);
  });

  test('поле над клавиатурой: библиотеке уходит поправка на место вида — его верх под шапкой (системный путь — chatKeyboard.test.js)', async () => {
    // Вид стоит под шапкой в 72 dp: замер на потоке интерфейса, в координатах корня.
    const measure = jest.spyOn(Reanimated, 'measure').mockReturnValue({ x: 0, y: 0, width: 390, height: 772, pageX: 0, pageY: 72 });
    const s = await open();
    expect(s.getByTestId('chat-avoid').props.behavior).toBe('padding');
    expect(s.getByTestId('chat-avoid').props.keyboardVerticalOffset).toBe(0);
    s.getByTestId('keyboard-avoid-probe', { includeHiddenElements: true });
    await act(async () => { await fireEvent(s.getByTestId('chat-avoid'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 772 } } }); });
    expect(s.getByTestId('chat-avoid').props.keyboardVerticalOffset).toBe(72);
    // Свой automaticOffset библиотеки в новой архитектуре не работает — ей он не уходит.
    expect(s.getByTestId('chat-avoid').props.automaticOffset).toBeUndefined();
    measure.mockRestore();
  });
});

// --- волна исправлений 19 октября 2026: экран чата в фоне (ревью телефона,
// находка 6) и отмена по полям (тост ai.undo_kept) ------------------------------

describe('экран чата в фоне и чужой ответ', () => {
  /** Слушатель фокуса, который экран повесил на свою навигацию. */
  const focusOf = (n) => {
    const call = n.addListener.mock.calls.filter(([e]) => e === 'focus').pop();
    return call && call[1];
  };

  test('экран, вернувшийся в фокус, снова открывает свой чат: пока он ждал, поверх открыли другой', async () => {
    reply(streamed(textReply('Ответ в X.')));
    const s = await open();
    const x = chatId;
    await say(s, 'Вопрос в X');
    await idle();
    s.getByText('Ответ в X.');
    // Поиск в «Проектах» открыл чат Y — лента одна на все экраны чата.
    await act(async () => { await aiOpenChat('chat-y'); });
    expect(s.queryByText('Ответ в X.')).toBeNull();
    expect(s.getByTestId('chat-input').props.editable).toBe(false);
    // Вернулись во вкладку «Чат-бот».
    await act(async () => { focusOf(navigation)(); });
    await waitFor(() => s.getByText('Ответ в X.'));
    expect(useAiChat.getState()).toMatchObject({ chatId: x, opened: true });
    expect(s.getByTestId('chat-input').props.editable).toBe(true);
  });

  test('другой чат открыли посреди ответа — ответ не пропадает молча: в своём чате «Ответ прервался» и «Повторить»', async () => {
    const stream = live();
    reply(stream.res);
    const s = await open();
    await say(s, 'Длинный вопрос');
    await act(async () => { stream.push(head() + textStart(0) + delta(0, 'Начало отв')); });
    await waitFor(() => s.getByText('Начало отв'));
    await act(async () => { await aiOpenChat('chat-y'); });
    expect(useAiChat.getState().busy).toBe(false);
    reply(streamed(textReply('Полный ответ.')));
    await act(async () => { focusOf(navigation)(); });
    await waitFor(() => s.getByText(t('ru', 'ai.interrupted')));
    expect(s.queryByText('Начало отв')).toBeNull();
    await fireEvent.press(s.getByTestId('chat-retry'));
    await idle();
    s.getByText('Полный ответ.');
    expect(bodyOf(1).messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Длинный вопрос' }] }]);
    expect(s.queryByText(t('ru', 'ai.interrupted'))).toBeNull();
    // Строка ошибки в историю не идёт.
    expect((await saved()).items.some((it) => it.kind === 'error')).toBe(false);
  });

  test('уход с экрана X не стирает вложения, прикреплённые тем временем в чате Y', async () => {
    const s = await open();
    await act(async () => { await aiOpenChat('chat-y'); });
    const file = { id: 'f1', kind: 'text', name: 'plan.txt', mediaType: 'text/plain', size: 10 };
    await act(async () => { useAiChat.setState({ pending: [file] }); });
    await s.unmount();
    expect(useAiChat.getState().pending).toEqual([file]);
  });
});

describe('«Отменить» по полям', () => {
  test('ядро оставило часть изменений (kept: задачу меняли после применения) — тост ai.undo_kept, а не «отменены»', async () => {
    reply(streamed(proposalReply()));
    const s = await open();
    await say(s, 'Распланируй');
    await idle();
    await fireEvent.press(s.getByTestId('chat-card-apply'));
    // Ядро с полем kept делает A2; здесь — что телефон его читает.
    const real = Ai.aiUndo;
    const spy = jest.spyOn(Ai, 'aiUndo').mockImplementation((state, undo) => ({ ...real(state, undo), kept: [{ id: 't1', reason: 'changed' }] }));
    try {
      await fireEvent.press(within(s.getByTestId('chat-card-toolu_card')).getByTestId('chat-card-undo'));
    } finally {
      spy.mockRestore();
    }
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'ai.undo_kept'));
    // Без kept (или ядро без этого поля) — прежнее «Изменения отменены»: это
    // закрывает тест «Применить» — «Отменить» выше.
  });
});

describe('дополнения ядра A2 (19 октября 2026)', () => {
  test('«Отменить»: по созданной агентом задаче идёт таймер — ядро её видит, задача и таймер остаются, тост ai.undo_kept', async () => {
    reply(streamed(proposalReply()));
    const s = await open();
    await say(s, 'Распланируй');
    await idle();
    await fireEvent.press(s.getByTestId('chat-card-apply'));
    const made = useAppStore.getState().tasks.find((x) => x.title === 'Созвон с клиентом');
    await act(async () => { useAppStore.getState().startTimer(made.id); });
    await fireEvent.press(within(s.getByTestId('chat-card-toolu_card')).getByTestId('chat-card-undo'));
    const after = useAppStore.getState();
    expect(after.tasks.some((x) => x.id === made.id)).toBe(true);
    expect(after.activeTimer && after.activeTimer.taskId).toBe(made.id);
    expect(after.toastMessage).toBe(t('ru', 'ai.undo_kept'));
  });

  test('400 too long — «Чат стал слишком длинным», без «Повторить»', async () => {
    reply(failed(400, { error: 'too long', detail: 'text over limit' }));
    const s = await open();
    await say(s, 'Ещё вопрос');
    await idle();
    s.getByText(t('ru', 'ai.too_long'));
    expect(s.queryByTestId('chat-retry')).toBeNull();
    expect(s.queryByText(t('ru', 'ai.error_network'))).toBeNull();
  });

  test('429 budget — «лимит агента исчерпан», без «Повторить»; счётчик сообщений не трогается', async () => {
    // Бюджет по цене: функция до полуночи UTC отвечает 429 budget (supabase/functions/ai-chat).
    reply(failed(429, { error: 'budget', retryAfter: 3600 }));
    const s = await open();
    const before = useAiChat.getState();
    await say(s, 'Ещё вопрос');
    await idle();
    s.getByText(t('ru', 'ai.budget'));
    expect(t('ru', 'ai.budget')).toBe('На сегодня лимит агента исчерпан — он снова заработает завтра.');
    expect(s.queryByTestId('chat-retry')).toBeNull();
    expect(s.queryByText(t('ru', 'ai.limit_reached'))).toBeNull();
    expect(s.queryByText(t('ru', 'ai.error_network'))).toBeNull();
    const after = useAiChat.getState();
    expect([after.remaining, after.limitUntil]).toEqual([before.remaining, before.limitUntil]);
  });
});

// Пустые места телефона — опись. Запуск: npm run test:mobile
//
// Каждое пустое место показывает EmptyState своего вида: нужную сценку,
// заголовок, и кнопку там, где действие очевидно, — и кнопка ведёт к
// созданию (тот же лист или тот же вызов, что «+» экрана). Где действие не
// здесь (поиск, уведомления, история, цифры), кнопки нет.
//
// «Проекты» без проектов — свой экран (ProjectsEmpty): колода-сценка с
// анимацией появления, три пункта «что даёт проект» и «Создать проект».
// При «уменьшении движения» сценка рисуется целиком и стоит.
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent, within, waitFor, act } from '@testing-library/react-native';
import ProjectsScreen from '../src/screens/ProjectsScreen';
import TasksScreen from '../src/screens/TasksScreen';
import ChatListScreen from '../src/screens/ChatListScreen';
import ChatThreadScreen from '../src/screens/ChatThreadScreen';
import { CHAT_ART } from '../src/components/chat/ChatGreeting';
import { useAiChat, aiStop, aiAccount, aiNewChat } from '../src/lib/aiChat';
import StatsScreen from '../src/screens/StatsScreen';
import DocumentsScreen from '../src/screens/DocumentsScreen';
import ProjectScreen from '../src/screens/ProjectScreen';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import NotificationsScreen from '../src/screens/NotificationsScreen';
import SearchScreen from '../src/screens/SearchScreen';
import TagsScreen from '../src/screens/TagsScreen';
import BottomSheet from '../src/components/BottomSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import AuthSheet from '../src/components/AuthSheet';
import TagEditSheet from '../src/components/TagEditSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import VersionsEditor from '../src/components/VersionsEditor';
import { deckLayers } from '../src/components/ProjectsEmpty';
import { artElements } from '../src/lib/art';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';
import { grantAi } from './support/aiAccess';

// Агент открыт аккаунту (RPC ai_has_access подменён — tests/support/aiAccess.js).
let aiRpc;
beforeEach(() => { aiRpc = grantAi(); });
afterEach(() => { aiRpc.mockRestore(); });

// Редактор заметок задачи — WebView с нативной частью; здесь он не нужен.
jest.mock('../src/components/DocEditor', () => () => null);
// «Уведомления» читают фокус вкладки из навигации; здесь вкладка открыта.
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true }));
// Поле ввода — с фокусом, который видно: кнопка «Новая задача» ставит курсор в поле.
const mockFocus = jest.fn();
// Общее поле листов (Field) — то же поле с видимым фокусом; выпадашка и вид
// поля — настоящие.
jest.mock('../src/components/AppTextInput', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  const actual = jest.requireActual('../src/components/AppTextInput');
  const Input = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: mockFocus, blur: () => {} }));
    return React.createElement(TextInput, props);
  });
  return { __esModule: true, default: Input, Field: Input, SelectField: actual.SelectField, fieldStyle: actual.fieldStyle };
});

const HIDDEN = { includeHiddenElements: true };
const nav = () => ({
  navigate: jest.fn(), push: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}),
  getState: () => ({ routes: [], index: 0 }),
});
const project = { id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' };
const statuses = [
  { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
  { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
];
const task = (id, title, extra) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  notes: '', repeat: null, rate: null, updatedAt: '2026-10-01T10:00:00.000Z', ...extra,
});

/** Состояние стора на тест: по умолчанию — проект без задач, документов и тегов. */
function seed(over = {}) {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 0, currency: 'RUB' },
    projects: [project], statuses, versions: [], tags: [], tasks: [], documents: [], activeTimer: null,
    ui: { ...useAppStore.getState().ui, boardVersion: {}, listCollapsed: {}, notifSeenAt: null, quickAddProjectId: null },
    ...over,
  });
}

/** Пустой экран, в котором лежит сценка name: сам EmptyState вокруг неё. */
function emptyWith(screen, name) {
  const art = screen.getByTestId(`art-${name}`, HIDDEN);
  let node = art.parent;
  while (node && node.props.testID !== 'empty-state') node = node.parent;
  expect(node).toBeTruthy();
  return within(node);
}

const sheetType = () => (useSheetStore.getState().content || {}).type;

// Системное «уменьшение движения»: хук спрашивает систему один раз при
// загрузке модуля и дальше слушает одно событие — его и шлём, как система.
const systemReduceMotion = (on) => act(async () => {
  const [, handler] = AccessibilityInfo.addEventListener.mock.calls.find(([name]) => name === 'reduceMotionChanged');
  handler(on);
});

beforeEach(async () => {
  mockFocus.mockClear();
  useSheetStore.setState({ content: null, header: null, footer: null });
  await systemReduceMotion(false);
  seed();
});

// Кадр выезда листа не должен выпасть после разбора окружения.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

describe('«Проекты» без проектов', () => {
  beforeEach(() => seed({ projects: [], statuses: [] }));

  test('заголовок, три пункта со значками и «Создать проект» — лист нового проекта', async () => {
    const s = await render(<ProjectsScreen navigation={nav()} />);
    s.getByText(t('ru', 'empty.projects_title'));
    s.getByText(t('ru', 'empty.projects_text'));
    for (const key of ['tasks', 'timer', 'money']) {
      s.getByText(t('ru', `empty.projects_${key}`));
      s.getByText(t('ru', `empty.projects_${key}_text`));
    }
    // Пустой гигантской карточки и точек пагинации нет.
    expect(s.queryByText(t('ru', 'deck.open'))).toBeNull();
    await fireEvent.press(s.getByText(t('ru', 'empty.create_project')));
    expect(sheetType()).toBe(NewProjectSheet);
  });

  test('сценка — колода из ядра, разложенная на слои: подложка, две задние, передняя, искра', () => {
    const shapes = artElements('projects');
    const layers = deckLayers(shapes);
    expect(layers.plate).toHaveLength(1);
    expect(layers.backs).toHaveLength(2);
    expect(layers.spark).toHaveLength(1);
    expect(layers.spark[0].parts).toEqual(['es-mark']);
    expect(layers.front.length).toBeGreaterThanOrEqual(5);
    // Ни одна форма не потерялась и не задвоилась.
    expect(layers.plate.length + layers.backs.length + layers.front.length + layers.spark.length).toBe(shapes.length);
  });

  test('с движением: сценка слоями и в первом кадре ещё собрана — карточки потом раскрываются', async () => {
    const s = await render(<ProjectsScreen navigation={nav()} />);
    const motion = s.getByTestId('projects-art-motion', HIDDEN);
    expect(s.queryByTestId('projects-art-still', HIDDEN)).toBeNull();
    // Пять слоёв — пять своих <Svg>.
    const count = (node) => (!node || typeof node !== 'object' ? 0
      : (node.type === 'RNSVGSvgView' ? 1 : 0) + (node.children || []).reduce((a, c) => a + count(c), 0));
    expect(count(motion)).toBe(5);
    const front = s.getByTestId('projects-art-front', HIDDEN);
    expect([].concat(front.props.style).reduce((a, x) => ({ ...a, ...x }), {}).opacity).toBe(0);
  });

  test('«уменьшение движения» включено — сценка целиком и стоит', async () => {
    await systemReduceMotion(true);
    const s = await render(<ProjectsScreen navigation={nav()} />);
    await waitFor(() => s.getByTestId('projects-art-still', HIDDEN));
    expect(s.queryByTestId('projects-art-motion', HIDDEN)).toBeNull();
    s.getByTestId('art-projects', HIDDEN);
  });
});

test('«Проекты»: карточка без задач — крупный пустой экран без кнопки (поле новой задачи над ним)', async () => {
  const s = await render(<ProjectsScreen navigation={nav()} />);
  const empty = emptyWith(s, 'tasks');
  empty.getByText(t('ru', 'deck.no_tasks'));
  empty.getByText(t('ru', 'empty.tasks_text'));
  expect(empty.queryByTestId('primary-button')).toBeNull();
});

describe('«Задачи»', () => {
  test('нет ни одного проекта — «Сначала нужен проект» и лист нового проекта', async () => {
    seed({ projects: [], statuses: [] });
    const s = await render(<TasksScreen navigation={nav()} />);
    const empty = emptyWith(s, 'projects');
    empty.getByText(t('ru', 'empty.need_project'));
    await fireEvent.press(empty.getByText(t('ru', 'deck.new_project')));
    expect(sheetType()).toBe(NewProjectSheet);
  });

  test('задач нет — «Новая задача» ставит курсор в поле над лентой', async () => {
    const s = await render(<TasksScreen navigation={nav()} />);
    const empty = emptyWith(s, 'tasks');
    empty.getByText(t('ru', 'deck.no_tasks'));
    await fireEvent.press(empty.getByText(t('ru', 'empty.new_task')));
    expect(mockFocus).toHaveBeenCalled();
  });

  test('всё выполнено — выполненные в ленте под подписью, пустого экрана нет', async () => {
    seed({ tasks: [task('t1', 'Макет', { done: true, statusId: 's2' })] });
    const s = await render(<TasksScreen navigation={nav()} />);
    s.getByText('Макет');
    s.getByTestId('tasks-group-done');
    expect(s.queryByTestId('empty-state')).toBeNull();
  });

  test('отбор ничего не оставил — «Сбросить» снимает его и возвращает ленту', async () => {
    seed({ tasks: [task('t1', 'Макет', { done: true, statusId: 's2' })] });
    const s = await render(<TasksScreen navigation={nav()} />);
    // «Просрочено»: у единственной (выполненной) задачи срока нет.
    await fireEvent.press(s.getByTestId('tasks-filter-due'));
    // Лист открывается через стор; выбор в нём — onChange (сам лист — TasksFilters.test.js).
    await act(async () => { useSheetStore.getState().content.props.onChange('overdue'); });
    const empty = emptyWith(s, 'filter');
    empty.getByText(t('ru', 'empty.filter_title'));
    await fireEvent.press(empty.getByText(t('ru', 'tasks.filter_reset')));
    s.getByText('Макет');
    expect(s.queryByTestId('empty-state')).toBeNull();
  });
});

describe('«Чат-бот»', () => {
  // Выход — пока экран ещё на месте (общая уборка дерева идёт после).
  afterEach(() => act(async () => { useAuthStore.setState({ status: 'signedOut', user: null }); }));

  test('без входа — «Войти», тот же лист входа, что в «Меню»', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null });
    const s = await render(<ChatListScreen navigation={nav()} />);
    const empty = emptyWith(s, 'tasks');
    empty.getByText(t('ru', 'ai.signin_title'));
    await fireEvent.press(empty.getByText(t('ru', 'ai.signin_btn')));
    expect(sheetType()).toBe(AuthSheet);
  });

  // Круг 21 (19 октября 2026): пустоты у главного экрана нет — там поле со
  // сценкой chat и фразой; без чатов под полем — что умеет агент и примеры.
  test('чатов нет — сценка chat и фраза над полем, под ним что умеет агент и три примера; пример встаёт в поле, кнопки нет', async () => {
    aiStop();
    useAiChat.setState({ uid: null, loaded: false, chats: [], chatId: null, opened: false });
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u-list', email: 'a@b.c' } });
    const navigation = nav();
    const s = await render(<ChatListScreen navigation={navigation} />);
    const hero = within(await waitFor(() => s.getByTestId('chat-hero')));
    hero.getByTestId(`art-${CHAT_ART}`, HIDDEN);
    expect(artElements(CHAT_ART).length).toBeGreaterThan(0);
    hero.getByTestId('chat-phrase');
    const below = within(s.getByTestId('chat-examples'));
    below.getByText(t('ru', 'ai.empty_hint'));
    expect(s.queryByTestId('empty-state')).toBeNull();
    expect(s.queryByTestId('primary-button')).toBeNull();
    await fireEvent.press(below.getByText(t('ru', 'ai.example_1')));
    expect(hero.getByTestId('chat-input').props.value).toBe(t('ru', 'ai.example_1'));
    expect(mockFocus).toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  test('новый чат пуст — что умеет агент и три примера, без кнопки; пример встаёт в поле', async () => {
    aiStop();
    useAiChat.setState({ uid: null, loaded: false, chats: [], chatId: null, opened: false });
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u-empty', email: 'a@b.c' } });
    await act(async () => { await aiAccount('u-empty'); });
    const chatId = aiNewChat();
    const s = await render(<ChatThreadScreen navigation={nav()} route={{ params: { chatId } }} />);
    const empty = await waitFor(() => emptyWith(s, 'tasks'));
    empty.getByText(t('ru', 'ai.empty_hint'));
    expect(empty.queryByTestId('primary-button')).toBeNull();
    await fireEvent.press(s.getByText(t('ru', 'ai.example_2')));
    expect(s.getByTestId('chat-input').props.value).toBe(t('ru', 'ai.example_2'));
    expect(mockFocus).toHaveBeenCalled();
  });
});

test('«Цифры» без записей — сценка времени, без кнопки', async () => {
  const s = await render(<StatsScreen navigation={nav()} />);
  const empty = emptyWith(s, 'time');
  empty.getByText(t('ru', 'stats.period_empty'));
  expect(empty.queryByTestId('primary-button')).toBeNull();
});

describe('«Документы»', () => {
  test('документов нет — «Новый документ» по центру заводит документ и открывает редактор; поиска и кнопки внизу нет', async () => {
    const navigation = nav();
    const s = await render(<DocumentsScreen navigation={navigation} route={{}} />);
    const empty = emptyWith(s, 'docs');
    empty.getByText(t('ru', 'docs.empty_list'));
    expect(s.queryByPlaceholderText(t('ru', 'docs.search_ph'))).toBeNull();
    expect(s.getAllByTestId('primary-button')).toHaveLength(1);
    await fireEvent.press(empty.getByText(t('ru', 'docs.new')));
    const [doc] = useAppStore.getState().documents;
    expect(navigation.navigate).toHaveBeenCalledWith('Editor', { id: doc.id });
  });

  test('документы проекта: своих нет, хотя чужие есть, — пустой экран проекта, а не «ничего не нашлось»', async () => {
    seed({ documents: [{ id: 'd1', projectId: null, title: 'Чужой', body: null, updatedAt: '2026-10-01T10:00:00.000Z' }] });
    const s = await render(<DocumentsScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />);
    emptyWith(s, 'docs').getByText(t('ru', 'empty.project_docs'));
  });

  test('поиск ничего не нашёл — сценка поиска, без кнопки в ней', async () => {
    seed({ documents: [{ id: 'd1', projectId: null, title: 'Бриф', body: null, updatedAt: '2026-10-01T10:00:00.000Z' }] });
    const s = await render(<DocumentsScreen navigation={nav()} route={{}} />);
    await fireEvent.changeText(s.getByPlaceholderText(t('ru', 'docs.search_ph')), 'договор');
    const empty = emptyWith(s, 'search');
    empty.getByText(t('ru', 'docs.nothing_found'));
    expect(empty.queryByTestId('primary-button')).toBeNull();
  });
});

describe('страница проекта', () => {
  const open = (navigation = nav()) => render(<ProjectScreen navigation={navigation} route={{ params: { projectId: 'p1' } }} />);

  test('задач нет — «Новая задача» ставит курсор в строку над списком; «Последних записей» на странице нет', async () => {
    const s = await open();
    const empty = emptyWith(s, 'tasks');
    empty.getByText(t('ru', 'deck.no_tasks'));
    expect(s.queryByTestId('art-timer', HIDDEN)).toBeNull();
    await fireEvent.press(empty.getByText(t('ru', 'empty.new_task')));
    expect(mockFocus).toHaveBeenCalled();
    expect(sheetType()).toBeUndefined();
  });

  test('отбор ничего не оставил — «Показать все» снимает его', async () => {
    seed({ tasks: [task('t1', 'Вёрстка')] });
    const s = await open();
    await fireEvent.press(s.getByText(t('ru', 'filter.done')));
    const empty = emptyWith(s, 'filter');
    empty.getByText(t('ru', 'empty.filter_title'));
    await fireEvent.press(empty.getByText(t('ru', 'empty.show_all')));
    s.getByText('Вёрстка');
  });

  // Два разных пустых экрана (11 октября 2026): «задач нет» и «все выполнены»
  // раньше были неразличимы. Все выполнены — это пусто на «Активных»: на «Все»
  // выполненные на виду.
  const active = (s) => fireEvent.press(within(s.getByTestId('project-filter-seg')).getByText(t('ru', 'filter.active')));
  const done2 = [task('t1', 'Макет', { done: true, statusId: 's2' }), task('t2', 'Релиз', { done: true, statusId: 's2' })];

  test('все задачи выполнены — своя сценка и слова; «Показать выполненные» открывает их', async () => {
    seed({ tasks: done2 });
    const s = await open();
    // «Все»: выполненные на виду, пустого экрана нет.
    expect(s.queryByTestId('project-list-empty')).toBeNull();
    s.getByText('Макет');
    await active(s);
    const empty = emptyWith(s, 'tasks');
    empty.getByText(t('ru', 'empty.project_done_title'));
    empty.getByText(t('ru', 'empty.project_done_text'));
    expect(t('ru', 'empty.project_done_title')).toBe('Все задачи выполнены');
    expect(t('ru', 'empty.project_done_text')).toBe('Отличная работа — добавьте новую или посмотрите выполненные.');
    // Ни слов «задач нет», ни пустого фильтра: это третье, отдельное состояние.
    expect(s.queryByText(t('ru', 'deck.no_tasks'))).toBeNull();
    expect(s.queryByText(t('ru', 'empty.filter_title'))).toBeNull();
    expect(s.queryByText(t('ru', 'empty.new_task'))).toBeNull();
    await fireEvent.press(empty.getByText(t('ru', 'empty.show_done')));
    expect(t('ru', 'empty.show_done')).toBe('Показать выполненные');
    s.getByText('Макет');
    s.getByText('Релиз');
    expect(s.queryByTestId('project-list-empty')).toBeNull();
  });

  test('«задач нет» и «все выполнены» — два разных экрана: слова и кнопка разные', async () => {
    const s = await open();
    const none = emptyWith(s, 'tasks');
    none.getByText(t('ru', 'deck.no_tasks'));
    none.getByText(t('ru', 'empty.new_task'));
    expect(s.queryByText(t('ru', 'empty.project_done_title'))).toBeNull();
    expect(s.queryByText(t('ru', 'empty.show_done'))).toBeNull();
    await s.unmount();

    seed({ tasks: done2 });
    const all = await open();
    await active(all);
    expect(all.queryByText(t('ru', 'deck.no_tasks'))).toBeNull();
    expect(all.queryByText(t('ru', 'empty.new_task'))).toBeNull();
    all.getByText(t('ru', 'empty.project_done_title'));
  });

  test('«все выполнены» — слова и кнопка на четырёх языках', async () => {
    const names = {
      ru: ['Все задачи выполнены', 'Показать выполненные'],
      en: ['All tasks are done', 'Show completed'],
      uk: ['Усі завдання виконано', 'Показати виконані'],
      kk: ['Барлық тапсырма орындалды', 'Орындалғандарды көрсету'],
    };
    for (const lang of Object.keys(names)) {
      seed({ tasks: done2, settings: { ...useAppStore.getState().settings, lang } });
      const s = await open();
      await fireEvent.press(within(s.getByTestId('project-filter-seg')).getAllByRole('button')[1]);
      const empty = emptyWith(s, 'tasks');
      empty.getByText(names[lang][0]);
      empty.getByText(names[lang][1]);
      expect(t(lang, 'empty.project_done_text').length).toBeGreaterThan(20);
      await s.unmount();
    }
  });

  test('не все выполнены — на «Активных» список; выполненных нет вовсе — прежний пустой фильтр', async () => {
    seed({ tasks: [...done2, task('t3', 'Вёрстка')] });
    const s = await open();
    await active(s);
    expect(s.queryByTestId('project-list-empty')).toBeNull();
    s.getByText('Вёрстка');
    expect(s.queryByText(t('ru', 'empty.project_done_title'))).toBeNull();
    await s.unmount();

    // Выполненных нет, а смотрим «Готово»: пусто из-за отбора, не из-за похвалы.
    seed({ tasks: [task('t3', 'Вёрстка')] });
    const f = await open();
    await fireEvent.press(f.getByText(t('ru', 'filter.done')));
    const empty = emptyWith(f, 'filter');
    empty.getByText(t('ru', 'empty.filter_title'));
    expect(f.queryByText(t('ru', 'empty.project_done_title'))).toBeNull();
  });

  test('отбор по версии: выполнено всё в выбранной версии — «все выполнены», а в проекте есть и невыполненное', async () => {
    seed({
      versions: [{ id: 'v1', projectId: 'p1', name: 'v1.0', order: 0 }],
      tasks: [task('t1', 'Макет', { done: true, statusId: 's2', versionId: 'v1' }), task('t2', 'Вёрстка')],
      ui: { ...useAppStore.getState().ui, boardVersion: { p1: 'v1' } },
    });
    const s = await open();
    await active(s);
    s.getByText(t('ru', 'empty.project_done_title'));
    expect(s.queryByText('Вёрстка')).toBeNull();
  });

  test('вкладка «Версии» без версий — «Новая версия» открывает окно проекта на версиях', async () => {
    const s = await open();
    await fireEvent.press(s.getByText(t('ru', 'version.section')));
    const empty = emptyWith(s, 'versions');
    empty.getByText(t('ru', 'empty.versions_title'));
    expect(s.queryByText(t('ru', 'version.manage'))).toBeNull();
    await fireEvent.press(empty.getByText(t('ru', 'empty.new_version')));
    const content = useSheetStore.getState().content;
    expect(content.type).toBe(NewProjectSheet);
    expect(content.props.section).toBe('versions');
  });

  test('«Документы» — не вкладка, а кнопка шапки: открывает документы проекта (их пустой экран — выше)', async () => {
    const navigation = nav();
    const s = await open(navigation);
    expect(s.queryByText(t('ru', 'nav.docs'))).toBeNull();
    const options = Object.assign({}, ...navigation.setOptions.mock.calls.map((c) => c[0]));
    const header = await render(options.headerRight());
    await fireEvent.press(header.getByRole('button', { name: t('ru', 'nav.docs') }));
    expect(navigation.navigate).toHaveBeenCalledWith('Documents', { projectId: 'p1' });
  });
});

test('история задачи без записей — сценка секундомера, без кнопки (строка «Запись вручную» под ней)', async () => {
  seed({ tasks: [task('t1', 'Вёрстка')] });
  const s = await render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);
  await fireEvent.press(s.getByText(t('ru', 'task.history_n', { n: 0 })));
  const empty = emptyWith(s, 'timer');
  empty.getByText(t('ru', 'project.ps_empty'));
  expect(empty.queryByTestId('primary-button')).toBeNull();
  s.getByText(t('ru', 'task.add_manual'));
});

test('«Уведомления» пусты — колокольчик, без кнопки', async () => {
  const s = await render(<NotificationsScreen navigation={nav()} />);
  const empty = emptyWith(s, 'bell');
  empty.getByText(t('ru', 'notif.empty'));
  empty.getByText(t('ru', 'empty.notif_text'));
  expect(empty.queryByTestId('primary-button')).toBeNull();
});

describe('поиск', () => {
  test('запроса нет и недавних нет — «Найдите задачу или проект»', async () => {
    const s = await render(<SearchScreen navigation={nav()} />);
    emptyWith(s, 'search').getByText(t('ru', 'empty.search_start'));
  });

  test('ничего не найдено — сценка поиска без кнопки', async () => {
    // С записью — задача в «недавних», и до запроса экран не пустой.
    const at = new Date(Date.now() - 3_600_000).toISOString();
    seed({ tasks: [task('t1', 'Вёрстка', { sessions: [{ start: at, end: new Date().toISOString(), ms: 3_600_000 }] })] });
    const s = await render(<SearchScreen navigation={nav()} />);
    expect(s.queryByTestId('empty-state')).toBeNull();
    await fireEvent.changeText(s.getByLabelText(t('ru', 'search.placeholder')), 'договор');
    const empty = emptyWith(s, 'search');
    empty.getByText(t('ru', 'search.nothing_found'));
    expect(empty.queryByTestId('primary-button')).toBeNull();
  });
});

test('«Теги» без общих тегов — «Новый тег» открывает лист тега, строки-дубля нет', async () => {
  const s = await render(<TagsScreen />);
  const empty = emptyWith(s, 'tags');
  empty.getByText(t('ru', 'tag.none_yet'));
  expect(s.getAllByText(t('ru', 'tag.add'))).toHaveLength(1);
  await fireEvent.press(empty.getByText(t('ru', 'tag.add')));
  expect(sheetType()).toBe(TagEditSheet);
});

describe('листы: пустая строка со сценкой', () => {
  test('версии проекта — сценка версий, поле новой версии под ней', async () => {
    const s = await render(<VersionsEditor projectId="p1" lang="ru" />);
    emptyWith(s, 'versions').getByText(t('ru', 'empty.versions_title'));
  });

  test('выбор тегов без единого тега — сценка тегов', async () => {
    openSheet(<TagPickerSheet value={[]} onChange={() => {}} onDone={() => {}} />);
    const s = await render(<BottomSheet />);
    emptyWith(s, 'tags').getByText(t('ru', 'tag.none'));
  });

  test('окно проекта: своих тегов нет — сценка тегов', async () => {
    openSheet(<NewProjectSheet project={project} section="tags" onCreated={() => {}} onCancel={() => {}} onOpenStatuses={() => {}} />);
    const s = await render(<BottomSheet />);
    emptyWith(s, 'tags').getByText(t('ru', 'tag.project_empty'));
  });
});

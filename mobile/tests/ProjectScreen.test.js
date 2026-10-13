// Страница проекта (screens/ProjectScreen.js). Запуск: npm run test:mobile
//
// Раскладка с 11 октября 2026, сверху вниз: шапка стека без заголовка — «назад»
// слева, «Документы» и «⋮» справа (три точки — крайние); название без
// подложки — та же деталь, что название задачи; описание (две строки и
// «Раскрыть»); теги; одна карточка с цифрами; вкладки Список · Доска · Версии;
// под ними содержимое вкладки. Прокрутка одна на всю страницу, блок вкладки
// тянется до низа экрана.
//
// Группы списка считает ядро (projectListGroups, закрыто юнитами); здесь
// проверяется, что телефон их рисует: заголовок на каждый статус со
// счётчиком, фильтр «Выполнено» прячет невыполненные.
import { StyleSheet, AccessibilityInfo } from 'react-native';
import { render, fireEvent, within, act } from '@testing-library/react-native';
import ProjectScreen from '../src/screens/ProjectScreen';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import AppHeader from '../src/components/AppHeader';
import MenuSheet from '../src/components/MenuSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import PickerSheet from '../src/components/PickerSheet';
import { MOVE, ARM_MS } from '../src/hooks/useOrderHold';
import { ICONS } from '../src/core/icons';
import { detailScreens } from '../src/navigation/detailScreens';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { colors } from '../src/theme';
import { t, T } from '../src/lib/i18n';

// Заметки задачи — WebView с нативной частью; для сравнения названий не нужны.
jest.mock('../src/components/DocEditor', () => () => null);
// Жест свайпа в jest не сыграть; строка остаётся настоящей, а её onAction —
// действие после порога — запоминается по задаче: его и зовёт тест закрепления.
const mockSwipeActions = {};
jest.mock('../src/components/SwipeRow', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('../src/components/SwipeRow');
  const Real = actual.default;
  return {
    ...actual,
    __esModule: true,
    default: (props) => {
      const row = React.Children.only(props.children);
      const item = React.Children.only(row.props.children);
      mockSwipeActions[item.props.task.id] = props.onAction;
      return React.createElement(Real, props);
    },
  };
});

const LANGS = ['ru', 'en', 'uk', 'kk'];
const HIDDEN = { includeHiddenElements: true };
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });
const task = (id, title, statusId, done, extra) => ({
  id, projectId: 'p1', title, statusId, done, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, notes: '', ...extra,
});
/** Запись времени на ms миллисекунд, 1 октября с 10:00. */
const sess = (ms) => [{ start: '2026-10-01T10:00:00.000Z', end: new Date(Date.parse('2026-10-01T10:00:00.000Z') + ms).toISOString(), ms }];
const open = (navigation = nav()) => render(<ProjectScreen navigation={navigation} route={{ params: { projectId: 'p1' } }} />);

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 1000, currency: 'RUB' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description: 'Лендинг и веб', tagIds: ['g1'] }],
    tags: [{ id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    documents: [],
    tasks: [
      task('t1', 'Вёрстка', 's1', false, { totalMs: 3_600_000, sessions: sess(3_600_000) }),
      task('t2', 'Правки', 's1', false),
      task('t3', 'Макет', 's2', true, { totalMs: 1_800_000, sessions: sess(1_800_000) }),
    ],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, boardVersion: {}, listCollapsed: {}, boardCollapsed: {} },
  });
  useSheetStore.setState({ content: null });
});

/** Все testID дерева в порядке обхода — то есть сверху вниз по странице. */
function testIdsInOrder(screen) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.props && node.props.testID) out.push(node.props.testID);
    walk(node.children);
  };
  walk(screen.toJSON());
  return out;
}

/** Ближайший предок-хост (View, Text…), минуя компоненты-обёртки. */
function hostParent(node) {
  let p = node.parent;
  while (p && typeof p.type !== 'string') p = p.parent;
  return p;
}

/** Опции шапки, отданные экраном через setOptions, — последние поверх ранних. */
const screenOptions = (navigation) => Object.assign({}, ...navigation.setOptions.mock.calls.map((c) => c[0]));
const stackOptions = (lang) => detailScreens({ Screen: 'Screen' }, lang).find((el) => el.props.name === 'Project').props.options;

describe('шапка экрана', () => {
  test('заголовка у шапки нет — на четырёх языках; шапка та же AppHeader, что у «Уведомлений» и «Тегов»', () => {
    for (const lang of LANGS) {
      const options = stackOptions(lang);
      expect(options.title).toBe('');
      expect(options.headerTitle).toBe('');
      // Слева ничего своего (на iOS 26+ туда ставился заголовок элементом).
      expect(options).not.toHaveProperty('unstable_headerLeftItems');
      // Ни своей шапки, ни спрятанной.
      expect(options).not.toHaveProperty('header');
      expect(options).not.toHaveProperty('headerShown');
    }
    // Ключ заголовка ушёл из словаря: на экране его больше негде показать.
    for (const lang of LANGS) expect('project.screen_title' in T[lang]).toBe(false);
  });

  test('в шапке только «назад» и иконки справа — ни слова; крайние — три точки; «Документы» открывают документы проекта', async () => {
    const navigation = nav();
    await open(navigation);
    const options = Object.assign({}, stackOptions('ru'), screenOptions(navigation));
    const header = await render(<AppHeader navigation={navigation} route={{ name: 'Project' }} options={options} back={{ title: '' }} />);

    const row = header.getByTestId('app-header-row');
    // Заголовка нет: ни «Проект», ни имени экрана — строка шапки без текста.
    expect(header.queryByText('Проект')).toBeNull();
    expect(header.queryByText('Project')).toBeNull();
    expect(within(row).queryAllByText(/./)).toHaveLength(0);
    const back = header.getByRole('button', { name: t('ru', 'common.back') });

    const actions = header.getByTestId('project-header-actions');
    const buttons = within(actions).getAllByRole('button');
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([t('ru', 'nav.docs'), t('ru', 'project.opts')]);

    // Порядок в строке шапки: «назад», пустое место, кнопки — и после трёх
    // точек ничего нет: они у самого правого края.
    const kids = row.children;
    expect(kids[kids.length - 1]).toBe(actions);
    const all = within(row).getAllByRole('button');
    expect(all[0]).toBe(back);
    expect(all[all.length - 1]).toBe(header.getByTestId('project-menu'));
    expect(within(actions).getByTestId('project-docs')).toBeTruthy();

    await fireEvent.press(header.getByTestId('project-docs'));
    expect(navigation.navigate).toHaveBeenCalledWith('Documents', { projectId: 'p1' });
    await fireEvent.press(header.getByTestId('project-menu'));
    expect(useSheetStore.getState().content.type).toBe(MenuSheet);
  });
});

// 12 октября 2026: статусы — строкой «Статусы» в настройках проекта (группа
// «Устройство проекта»), отдельного пункта в меню «⋮» нет.
describe('меню «⋮»: статусы — внутри настроек проекта', () => {
  async function menuItems(navigation) {
    await open(navigation);
    const options = Object.assign({}, stackOptions('ru'), screenOptions(navigation));
    const header = await render(<AppHeader navigation={navigation} route={{ name: 'Project' }} options={options} back={{ title: '' }} />);
    await fireEvent.press(header.getByTestId('project-menu'));
    return useSheetStore.getState().content.props.items;
  }

  test('пункта «Статусы проекта» в меню нет; «Настройки проекта» открывают их список строк', async () => {
    const navigation = nav();
    const items = await menuItems(navigation);
    expect(items.map((i) => i.key)).toEqual(['task', 'edit', 'pin', 'export', 'delete']);
    expect(items.map((i) => i.label)).not.toContain(t('ru', 'board.project_statuses'));
    await act(async () => items.find((i) => i.key === 'edit').onPress());
    const sheet = useSheetStore.getState().content;
    expect(sheet.props.project.id).toBe('p1');
    expect(sheet.props.section).toBe('main');
    // Строка «Статусы» настроек ведёт на экран статусов проекта, закрыв лист.
    await act(async () => sheet.props.onOpenStatuses());
    expect(useSheetStore.getState().content).toBeNull();
    expect(navigation.navigate).toHaveBeenCalledWith('ProjectStatuses', { projectId: 'p1' });
  });
});

describe('название и теги', () => {
  test('название без подложки и тем же стилем, что название задачи', async () => {
    const s = await open();
    const name = s.getByTestId('project-name');
    expect(name.props.value).toBe('Сайт');
    const { flex, ...own } = flat(name);
    expect(flex).toBe(1);
    expect(own.backgroundColor).toBe('transparent');
    expect(own.borderWidth).toBe(0);
    // Контейнер названия — не карточка: ни заливки, ни скругления.
    const head = flat(s.getByTestId('project-head'));
    expect(head.backgroundColor).toBeUndefined();
    expect(head.borderRadius).toBeUndefined();

    const td = await render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);
    const taskTitle = td.getByPlaceholderText(t('ru', 'task.title_ph'));
    expect(own).toEqual(flat(taskTitle));
  });

  test('цветной квадрат проекта стоит рядом с названием', async () => {
    const s = await open();
    const mark = s.getByTestId('project-mark');
    expect(flat(mark)).toMatchObject({ backgroundColor: '#87ff65', width: 10, height: 10 });
    expect(hostParent(mark)).toBe(hostParent(s.getByTestId('project-name')));
  });

  test('название правится на месте: пауза — сохранено, пустое не сохраняется', async () => {
    jest.useFakeTimers();
    try {
      const s = await open();
      const input = s.getByTestId('project-name');
      await fireEvent.changeText(input, 'Сайт 2.0');
      expect(useAppStore.getState().projects[0].name).toBe('Сайт');
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(useAppStore.getState().projects[0].name).toBe('Сайт 2.0');

      // Стёрли всё и ушли из поля — имя прежнее, и в поле, и в сторе.
      await fireEvent.changeText(input, '   ');
      await fireEvent(input, 'endEditing');
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(useAppStore.getState().projects[0].name).toBe('Сайт 2.0');
      expect(s.getByTestId('project-name').props.value).toBe('Сайт 2.0');
    } finally {
      jest.useRealTimers();
    }
  });

  test('теги проекта — плашками под названием; «+» открывает выбор тегов проекта', async () => {
    const s = await open();
    const tags = s.getByTestId('project-tags');
    within(tags).getByText('клиент');
    await fireEvent.press(within(tags).getByLabelText(t('ru', 'tag.pick')));
    const content = useSheetStore.getState().content;
    expect(content.type).toBe(TagPickerSheet);
    expect(content.props.projectId).toBe('p1');
    await act(async () => { content.props.onChange(['g1', 'g2']); });
    expect(useAppStore.getState().projects[0].tagIds).toEqual(['g1', 'g2']);
  });
});

describe('карточка цифр и порядок блоков', () => {
  test('одна карточка: готово из всех, время, заработок и полоса готовности', async () => {
    const s = await open();
    const kpi = within(s.getByTestId('project-kpi'));
    kpi.getByText('1 / 3');
    kpi.getByText(t('ru', 'stats.tasks_done_short'));
    kpi.getByText(t('ru', 'project.kpi_time'));
    kpi.getByText(t('ru', 'project.kpi_money'));
    // 1,5 часа по ставке 1000 — полторы тысячи.
    kpi.getByText(/1\s?500/);
    // Полоса — общий ProgressBar (натекание и ширина заливки — progressBar.test.js).
    const bar = s.getByTestId('project-progress');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 33 });
  });

  test('сверху вниз: название → теги → карточка цифр → вкладки → содержимое; «Последних записей» нет', async () => {
    const s = await open();
    const ids = testIdsInOrder(s);
    const at = (id) => ids.indexOf(id);
    for (const id of ['project-name', 'project-tags', 'project-kpi', 'project-tabs', 'project-tab-body']) expect(at(id)).toBeGreaterThanOrEqual(0);
    expect(at('project-name')).toBeLessThan(at('project-tags'));
    expect(at('project-tags')).toBeLessThan(at('project-kpi'));
    expect(at('project-kpi')).toBeLessThan(at('project-tabs'));
    expect(at('project-tabs')).toBeLessThan(at('project-tab-body'));
    expect(s.queryByText('Последние записи')).toBeNull();
    expect(s.queryByTestId('art-timer', HIDDEN)).toBeNull();
  });
});

describe('вкладки', () => {
  test('ровно три — Список · Доска · Версии, на четырёх языках; «Документов» среди них нет', async () => {
    for (const lang of LANGS) {
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang } });
      const s = await open();
      const tabs = within(s.getByTestId('project-tabs')).getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      const labels = ['project.tab_list', 'nav.board', 'version.section'].map((k) => t(lang, k));
      tabs.forEach((tab, i) => within(tab).getByText(labels[i]));
      expect(within(s.getByTestId('project-tabs')).queryByText(t(lang, 'nav.docs'))).toBeNull();
      await s.unmount();
    }
  });

  test('переключение: список, доска, версии', async () => {
    useAppStore.setState({ versions: [{ id: 'v1', projectId: 'p1', name: 'v1.0', order: 0 }] });
    const s = await open();
    const tab = (key) => within(s.getByTestId('project-tabs')).getByText(t('ru', key));
    // Список: строка новой задачи и группы по статусам.
    s.getByLabelText(t('ru', 'tasks.new_ph'));
    s.getByText('В работе');

    await fireEvent.press(tab('nav.board'));
    expect(s.queryByLabelText(t('ru', 'tasks.new_ph'))).toBeNull();
    expect(s.getAllByText(t('ru', 'board.add_task')).length).toBeGreaterThan(0);
    s.getByText('Вёрстка');

    await fireEvent.press(tab('version.section'));
    expect(s.queryByText(t('ru', 'board.add_task'))).toBeNull();
    within(s.getByTestId('project-tab-body')).getByText('v1.0');

    await fireEvent.press(tab('project.tab_list'));
    s.getByLabelText(t('ru', 'tasks.new_ph'));
  });
});

describe('прокрутка', () => {
  /** Нативные прокрутки дерева (RCTScrollView): horizontal — по столбцам доски. */
  const scrolls = (s, horizontal) => {
    const out = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'RCTScrollView' && !!node.props.horizontal === horizontal) out.push(node);
      walk(node.children);
    };
    walk(s.toJSON());
    return out;
  };
  const verticalScrolls = (s) => scrolls(s, false);

  test('одна вертикальная прокрутка на страницу — на всех трёх вкладках', async () => {
    const s = await open();
    expect(verticalScrolls(s)).toHaveLength(1);
    await fireEvent.press(within(s.getByTestId('project-tabs')).getByText(t('ru', 'nav.board')));
    // У доски своя только горизонтальная — по столбцам; вертикально едет страница.
    expect(verticalScrolls(s)).toHaveLength(1);
    expect(scrolls(s, true)).toHaveLength(1);
    await fireEvent.press(within(s.getByTestId('project-tabs')).getByText(t('ru', 'version.section')));
    expect(verticalScrolls(s)).toHaveLength(1);
    // Название, карточка и вкладки — внутри неё, а не над ней.
    const scroll = s.getByTestId('project-scroll');
    for (const id of ['project-name', 'project-kpi', 'project-tabs', 'project-tab-body']) {
      expect(within(scroll).getByTestId(id)).toBeTruthy();
    }
  });

  test('блок вкладки тянется до низа экрана: flexGrow у содержимого прокрутки и у блока', async () => {
    useAppStore.setState({ tasks: [task('t1', 'Вёрстка', 's1', false)] });
    const s = await open();
    const scroll = s.getByTestId('project-scroll');
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).flexGrow).toBe(1);
    const block = s.getByTestId('project-tab-body');
    expect(flat(block).flexGrow).toBe(1);
    // Блок — прямой ребёнок содержимого прокрутки: растягивать его некому мешать.
    expect(hostParent(hostParent(block))).toBe(scroll);
  });

  test('пустой список — пустой экран посередине растянутого блока', async () => {
    useAppStore.setState({ tasks: [] });
    const s = await open();
    const wrap = s.getByTestId('project-list-empty');
    expect(flat(wrap)).toMatchObject({ flexGrow: 1, justifyContent: 'center' });
    expect(hostParent(wrap)).toBe(s.getByTestId('project-tab-body'));
    within(wrap).getByText(t('ru', 'deck.no_tasks'));
  });
});

describe('список', () => {
  test('по статусам: заголовок группы и счётчик на каждый статус', async () => {
    const { getByText, getAllByText, getByDisplayValue } = await open();
    getByDisplayValue('Сайт');
    getByText('Лендинг и веб');
    getByText('В работе');
    // «Готово» — и статус-группа, и вкладка отбора «Все · Активные · Готово».
    expect(getAllByText('Готово')).toHaveLength(2);
    getByText('Вёрстка');
    getByText('Макет');
  });

  test('фильтр «Готово» оставляет только выполненные', async () => {
    const { getByTestId, queryByText, getByText } = await open();
    await fireEvent.press(within(getByTestId('project-filter-seg')).getByText(t('ru', 'filter.done')));
    expect(queryByText('Вёрстка')).toBeNull();
    expect(queryByText('Правки')).toBeNull();
    getByText('Макет');
  });

  test('свёрнутая группа прячет свои задачи, заголовок остаётся', async () => {
    const { getByText, queryByText } = await open();
    await fireEvent.press(getByText('В работе'));
    expect(useAppStore.getState().ui.listCollapsed.p1).toEqual(['s1']);
    expect(queryByText('Вёрстка')).toBeNull();
    getByText('В работе');
    getByText('Макет');
  });

  test('строка быстрого добавления: Enter и «Создать» заводят задачу и открывают её', async () => {
    const navigation = nav();
    const { getByLabelText } = await open(navigation);
    const input = getByLabelText(t('ru', 'tasks.new_ph'));
    await fireEvent.changeText(input, 'Тесты');
    await fireEvent(input, 'submitEditing');
    const added = useAppStore.getState().tasks.find((x) => x.title === 'Тесты');
    expect(added).toBeTruthy();
    expect(added.projectId).toBe('p1');
    expect(added.statusId).toBe('s1');
    expect(navigation.navigate).toHaveBeenLastCalledWith('TaskDetail', { taskId: added.id });

    await fireEvent.changeText(input, 'Деплой');
    await fireEvent.press(getByLabelText(t('ru', 'agenda.create_btn')));
    const second = useAppStore.getState().tasks.find((x) => x.title === 'Деплой');
    expect(navigation.navigate).toHaveBeenLastCalledWith('TaskDetail', { taskId: second.id });
    // Создание не запускает таймер — это отдельное действие.
    expect(useAppStore.getState().activeTimer).toBeNull();
  });
});

// Отбор над списком (11 октября 2026): вкладки «Все · Активные · Готово» и
// справа квадратная кнопка с иконкой фильтров вместо выпадашки «Все версии».
describe('отбор списка', () => {
  const V1 = { id: 'v1', projectId: 'p1', name: 'v1.0', order: 0 };
  const withVersions = () => useAppStore.setState({
    versions: [V1],
    tasks: useAppStore.getState().tasks.map((x) => (x.id === 't1' ? { ...x, versionId: 'v1' } : x)),
  });
  const seg = (s) => s.getByTestId('project-filter-seg');

  test('вкладки — Все · Активные · Готово, на четырёх языках', async () => {
    const names = { ru: ['Все', 'Активные', 'Готово'], en: ['All', 'Active', 'Done'], uk: ['Усі', 'Активні', 'Готово'], kk: ['Барлығы', 'Белсенді', 'Дайын'] };
    for (const lang of LANGS) {
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang } });
      const s = await open();
      const buttons = within(seg(s)).getAllByRole('button');
      expect(buttons).toHaveLength(3);
      buttons.forEach((b, i) => within(b).getByText(names[lang][i]));
      await s.unmount();
    }
  });

  test('«Активные» оставляет невыполненные, «Все» возвращает всё', async () => {
    const s = await open();
    await fireEvent.press(within(seg(s)).getByText(t('ru', 'filter.active')));
    s.getByText('Вёрстка');
    s.getByText('Правки');
    expect(s.queryByText('Макет')).toBeNull();
    await fireEvent.press(within(seg(s)).getByText(t('ru', 'filter.all')));
    s.getByText('Макет');
  });

  test('версий нет — кнопки отбора нет', async () => {
    const s = await open();
    expect(s.queryByTestId('project-version-filter')).toBeNull();
  });

  test('версии есть — рядом с вкладками квадратная кнопка с иконкой фильтров, без подписи', async () => {
    withVersions();
    const s = await open();
    const btn = s.getByTestId('project-version-filter');
    const box = flat(btn);
    // Квадрат высотой с вкладки, а не пилюля с текстом и стрелкой.
    expect(box.width).toBe(box.height);
    expect(box.height).toBe(flat(seg(s)).height);
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe(t('ru', 'project.filter_version'));
    // Справа от вкладок, в одной строке с ними.
    const row = s.getByTestId('project-filter-row');
    expect(hostParent(btn)).toBe(row);
    expect(hostParent(seg(s))).toBe(row);
    expect(testIdsInOrder(s).filter((id) => id === 'project-filter-seg' || id === 'project-version-filter'))
      .toEqual(['project-filter-seg', 'project-version-filter']);
    // Внутри только иконка: текста нет.
    expect(within(btn).queryAllByText(/./)).toHaveLength(0);
  });

  test('«Все версии» на экране не показывается — ни на списке, ни на доске, ни на четырёх языках', async () => {
    withVersions();
    for (const lang of LANGS) {
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang } });
      const s = await open();
      expect(s.queryByText(t(lang, 'board.all_versions'))).toBeNull();
      await fireEvent.press(within(s.getByTestId('project-tabs')).getByText(t(lang, 'nav.board')));
      expect(s.queryByText(t(lang, 'board.all_versions'))).toBeNull();
      await s.unmount();
    }
  });

  test('отбор не включён — кнопка без отметки; выбрана версия — акцентная точка', async () => {
    withVersions();
    const s = await open();
    expect(s.queryByTestId('project-version-filter-dot')).toBeNull();
    expect(s.getByTestId('project-version-filter').props.accessibilityState).toMatchObject({ selected: false });
    await act(async () => { useAppStore.getState().setBoardVersion('p1', 'v1'); });
    const dot = s.getByTestId('project-version-filter-dot');
    expect(flat(dot).backgroundColor).toBe(colors.accent);
    expect(s.getByTestId('project-version-filter').props.accessibilityState).toMatchObject({ selected: true });
    // Какая версия — не текстом на экране, а значением для чтения с экрана.
    expect(s.getByTestId('project-version-filter').props.accessibilityValue).toEqual({ text: 'v1.0' });
    // «Без версии» — тоже отбор.
    await act(async () => { useAppStore.getState().setBoardVersion('p1', 'none'); });
    s.getByTestId('project-version-filter-dot');
    // Снят — отметка ушла.
    await act(async () => { useAppStore.getState().setBoardVersion('p1', 'all'); });
    expect(s.queryByTestId('project-version-filter-dot')).toBeNull();
  });

  test('кнопка открывает тот же выбор версии: все · версии проекта · без версии; выбор применяется', async () => {
    withVersions();
    const s = await open();
    await fireEvent.press(s.getByTestId('project-version-filter'));
    const content = useSheetStore.getState().content;
    expect(content.type).toBe(PickerSheet);
    expect(content.props.title).toBe(t('ru', 'version.label'));
    expect(content.props.value).toBe('all');
    expect(content.props.options.map((o) => o.value)).toEqual(['all', 'v1', 'none']);
    // «Все версии» — только пункт самого выбора, чтобы отбор можно было снять.
    expect(content.props.options[0].label).toBe(t('ru', 'board.all_versions'));
    await act(async () => { content.props.onSelect('v1'); });
    expect(useAppStore.getState().ui.boardVersion.p1).toBe('v1');
    s.getByText('Вёрстка');
    expect(s.queryByText('Правки')).toBeNull();
  });
});

// Описание проекта (11 октября 2026): под названием две строки с многоточием,
// на третьей — «Раскрыть» зелёным accentInk с шевроном вниз; раскрытое — всё
// описание и «Скрыть» с шевроном вверх. Короткое, что умещается в две строки,
// — без кнопки. Сколько строк в полном тексте, знает платформа (onTextLayout
// невидимой копии), в Node его нет — тест присылает событие, как платформа.
describe('описание проекта', () => {
  const LONG = 'Лендинг и веб-версия: вёрстка, адаптив под телефон, формы заявок, подключение платежей и аналитики, перенос старых страниц.';
  const lay = (n) => ({ nativeEvent: { lines: Array.from({ length: n }, () => ({ height: 20 })) } });
  const withDesc = (description) => useAppStore.setState({
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description, tagIds: ['g1'] }],
  });
  /** Платформа померила полный текст: n строк. */
  const measured = (s, n) => act(async () => { fireEvent(s.getByTestId('project-desc-measure', HIDDEN), 'textLayout', lay(n)); });
  const textOf = (s) => s.getByTestId('project-desc-text');
  const toggleOf = (s) => s.getByTestId('project-desc-toggle');
  /** Какой шеврон нарисован: путь иконки из общего словаря. */
  const chevron = (s) => {
    const paths = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'RNSVGPath') paths.push(node.props.d);
      walk(node.children);
    };
    walk(toggleOf(s));
    return ['chevron-down', 'chevron-up'].find((name) => ICONS[name].p[0][0] === paths[0]);
  };
  const systemReduceMotion = (on) => act(async () => {
    const [, handler] = AccessibilityInfo.addEventListener.mock.calls.find(([name]) => name === 'reduceMotionChanged');
    handler(on);
  });

  beforeEach(() => withDesc(LONG));
  afterEach(async () => { await systemReduceMotion(false); });

  test('длинное: две строки с многоточием, на следующей — «Раскрыть» accentInk с шевроном вниз', async () => {
    const s = await open();
    await measured(s, 5);
    const text = textOf(s);
    expect(text.props.numberOfLines).toBe(2);
    expect(text.props.children).toBe(LONG);
    const toggle = toggleOf(s);
    const label = within(toggle).getByText(t('ru', 'project.desc_more'));
    expect(t('ru', 'project.desc_more')).toBe('Раскрыть');
    expect(flat(label).color).toBe(colors.accentInk);
    expect(chevron(s)).toBe('chevron-down');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    // Кнопка — под текстом (третья строка), а не рядом и не над ним.
    const ids = testIdsInOrder(s);
    expect(ids.indexOf('project-desc-text')).toBeLessThan(ids.indexOf('project-desc-toggle'));
    // Описание стоит после названия и до тегов.
    expect(ids.indexOf('project-name')).toBeLessThan(ids.indexOf('project-desc'));
    expect(ids.indexOf('project-desc')).toBeLessThan(ids.indexOf('project-tags'));
  });

  test('«Раскрыть» показывает всё описание и «Скрыть» с шевроном вверх; ещё раз — снова две строки', async () => {
    jest.useFakeTimers();
    try {
      const s = await open();
      await measured(s, 5);
      await fireEvent.press(toggleOf(s));
      // Раскрыто: ограничения строк нет, весь текст на месте.
      expect(textOf(s).props.numberOfLines).toBeUndefined();
      expect(textOf(s).props.children).toBe(LONG);
      within(toggleOf(s)).getByText(t('ru', 'project.desc_less'));
      expect(t('ru', 'project.desc_less')).toBe('Скрыть');
      expect(chevron(s)).toBe('chevron-up');
      expect(toggleOf(s).props.accessibilityState).toMatchObject({ expanded: true });
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(textOf(s).props.numberOfLines).toBeUndefined();

      // «Скрыть»: текст целый, пока обёртка едет вниз, потом снова две строки.
      await fireEvent.press(toggleOf(s));
      expect(textOf(s).props.numberOfLines).toBeUndefined();
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(textOf(s).props.numberOfLines).toBe(2);
      within(toggleOf(s)).getByText(t('ru', 'project.desc_more'));
      expect(chevron(s)).toBe('chevron-down');
    } finally {
      jest.useRealTimers();
    }
  });

  test('раскрытие плавное: обёртка едет по высоте между двумя строками и полной', async () => {
    jest.useFakeTimers();
    try {
      const s = await open();
      await measured(s, 5);
      const clip = hostParent(textOf(s));
      const spy = jest.spyOn(require('react-native-reanimated'), 'withTiming');
      // Покой — высоты нет: обёртка по содержимому.
      expect(flat(clip).height).toBeUndefined();
      expect(flat(clip).overflow).toBe('hidden');
      await fireEvent.press(toggleOf(s));
      // Едет к полной высоте — пять строк по 20 — за 240 мс; на время хода у
      // обёртки задана высота (общее значение в подмене Reanimated не живёт
      // между кадрами, поэтому цифра — в вызове withTiming).
      expect(spy).toHaveBeenLastCalledWith(100, expect.objectContaining({ duration: 240 }));
      expect(flat(clip).height).toBeDefined();
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(flat(clip).height).toBeUndefined();
      // Обратно — к двум строкам: две по 20.
      await fireEvent.press(toggleOf(s));
      expect(spy).toHaveBeenLastCalledWith(40, expect.objectContaining({ duration: 240 }));
      expect(flat(clip).height).toBeDefined();
      spy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  test('«уменьшение движения»: без анимации — высоты нет, строки возвращаются сразу', async () => {
    await systemReduceMotion(true);
    const s = await open();
    await measured(s, 5);
    const clip = hostParent(textOf(s));
    const spy = jest.spyOn(require('react-native-reanimated'), 'withTiming');
    await fireEvent.press(toggleOf(s));
    expect(textOf(s).props.numberOfLines).toBeUndefined();
    expect(flat(clip).height).toBeUndefined();
    await fireEvent.press(toggleOf(s));
    expect(textOf(s).props.numberOfLines).toBe(2);
    expect(flat(clip).height).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('умещается в две строки (или ещё не мерили) — кнопки нет', async () => {
    const s = await open();
    // Замера ещё нет — кнопки нет, чтобы она не мигала у короткого описания.
    expect(s.queryByTestId('project-desc-toggle')).toBeNull();
    await measured(s, 2);
    expect(s.queryByTestId('project-desc-toggle')).toBeNull();
    expect(s.queryByText(t('ru', 'project.desc_more'))).toBeNull();
    s.getByText(LONG);
    await measured(s, 1);
    expect(s.queryByTestId('project-desc-toggle')).toBeNull();
  });

  test('описание сократили, пока оно было раскрыто, — кнопка уходит, текст свёрнут', async () => {
    jest.useFakeTimers();
    try {
      const s = await open();
      await measured(s, 5);
      await fireEvent.press(toggleOf(s));
      await act(async () => { jest.advanceTimersByTime(400); });
      await measured(s, 1);
      expect(s.queryByTestId('project-desc-toggle')).toBeNull();
      expect(textOf(s).props.numberOfLines).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('подписи кнопки — на четырёх языках', () => {
    const names = { ru: ['Раскрыть', 'Скрыть'], en: ['Show more', 'Show less'], uk: ['Розгорнути', 'Згорнути'], kk: ['Толығырақ', 'Жасыру'] };
    for (const lang of LANGS) expect([t(lang, 'project.desc_more'), t(lang, 'project.desc_less')]).toEqual(names[lang]);
  });

  test('описания нет — нет ни текста, ни кнопки', async () => {
    withDesc('');
    const s = await open();
    expect(s.queryByTestId('project-desc')).toBeNull();
    expect(s.queryByTestId('project-desc-toggle')).toBeNull();
  });
});

describe('доска и закрепление', () => {
  const V1 = { id: 'v1', projectId: 'p1', name: 'v1.0', order: 0 };
  const withVersions = () => useAppStore.setState({
    versions: [V1],
    tasks: useAppStore.getState().tasks.map((x) => (x.id === 't1' ? { ...x, versionId: 'v1' } : x)),
  });

  test('на доске кнопки отбора по версии нет — ни в каком виде; на списке она остаётся', async () => {
    withVersions();
    const s = await open();
    s.getByTestId('project-version-filter');
    await fireEvent.press(within(s.getByTestId('project-tabs')).getByText(t('ru', 'nav.board')));
    expect(s.queryByTestId('project-version-filter')).toBeNull();
    expect(s.queryByTestId('project-version-filter-dot')).toBeNull();
    expect(s.queryByLabelText(t('ru', 'project.filter_version'))).toBeNull();
    const body = s.getByTestId('project-tab-body');
    expect(within(body).queryAllByRole('button', { name: t('ru', 'project.filter_version') })).toHaveLength(0);
    await fireEvent.press(within(s.getByTestId('project-tabs')).getByText(t('ru', 'project.tab_list')));
    s.getByTestId('project-version-filter');
  });

  test('отбор по версии, выбранный на списке, доска держит', async () => {
    withVersions();
    const s = await open();
    await act(async () => { useAppStore.getState().setBoardVersion('p1', 'v1'); });
    await fireEvent.press(within(s.getByTestId('project-tabs')).getByText(t('ru', 'nav.board')));
    s.getByText('Вёрстка');
    expect(s.queryByText('Правки')).toBeNull();
  });

  test('закрепить задачу можно свайпом по строке списка (со страницы задачи переключатель ушёл)', async () => {
    const s = await open();
    // У каждой из трёх строк под ней лежит полоса «Закрепить» (подпись
    // стоит дважды: обычная и поверх неё — «сработает»).
    expect(s.getAllByText(t('ru', 'pin.pin'))).toHaveLength(3 * 2);
    // Закреплённая — «Открепить».
    await act(async () => { useAppStore.getState().togglePinTask('t1'); });
    expect(s.getAllByText(t('ru', 'pin.pin'))).toHaveLength(2 * 2);
    expect(s.getAllByText(t('ru', 'pin.unpin'))).toHaveLength(1 * 2);
  });

  test('закрепление свайпом: строка с layout переезда, правка — через moveSoon, строка уезжает в «Закреплённые»', async () => {
    jest.useFakeTimers();
    try {
      const s = await open();
      const pinnedGroup = () => s.queryByText(t('ru', 'home.pinned'));
      expect(pinnedGroup()).toBeNull();
      const row = () => s.getByTestId('project-row-t2');
      // Без таймера и до свайпа переезд не задан.
      expect(row().props.layout).toBeUndefined();

      // Свайп сработал: layout уже стоит, самой правки ещё нет.
      await act(async () => { mockSwipeActions.t2(); });
      expect(row().props.layout).toBe(MOVE);
      expect(StyleSheet.flatten(row().props.style).zIndex).toBe(2);
      expect(useAppStore.getState().tasks.find((x) => x.id === 't2').pinnedAt).toBeNull();

      // Через ARM_MS — правка: задача закреплена, у списка появилась группа.
      await act(async () => { jest.advanceTimersByTime(ARM_MS); });
      expect(useAppStore.getState().tasks.find((x) => x.id === 't2').pinnedAt).toBeTruthy();
      expect(pinnedGroup()).not.toBeNull();
      expect(row().props.layout).toBe(MOVE);

      // Переезд кончился — layout снят.
      await act(async () => { jest.advanceTimersByTime(2000); });
      expect(row().props.layout).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

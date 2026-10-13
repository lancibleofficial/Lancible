// «Задачи»: чипы-фильтры и переезд отмеченной задачи (screens/TasksScreen.js,
// components/FilterSheet.js, lib/inbox.js). Запуск: npm run test:mobile
//
// Три чипа-выпадашки — «Проект» (несколько), «Дедлайн» (один), «Статус»
// (несколько, по виду статуса). Проверяется применение: текст чипа, отбор
// строк на экране, «и» между фильтрами, акцентная рамка включённого чипа,
// «Сбросить» в листе, проект быстрого добавления. Сами правила отбора —
// inbox.test.js. Выполненные в ленте всегда, последним разделом: отметка
// налив → переезд (moveSoon), снятая едет обратно.
//
// Время прибито: 11 октября 2026, 12:00 (jest.useFakeTimers) — сроки задач
// считаются от него, а не от запуска.
import { StyleSheet, View } from 'react-native';
import { render, renderHook, fireEvent, within, act } from '@testing-library/react-native';
import * as ReduceMotion from '../src/hooks/useReduceMotion';
import TasksScreen from '../src/screens/TasksScreen';
import { MOVE, MOVE_MS, ARM_MS } from '../src/hooks/useOrderHold';
import { LIQUID, resetKicks } from '../src/lib/liquid';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { useColors, colors } from '../src/theme';
import { t } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn() });
const NOW = new Date(2026, 9, 11, 12, 0, 0).getTime();
const day = (n, h = 18) => new Date(2026, 9, 11 + n, h, 0, 0).toISOString();
const flat = (node) => StyleSheet.flatten(node.props.style) || {};

const task = (id, title, over, i = 0) => ({
  id, projectId: 'p1', title, statusId: 'sp', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  notes: '', repeat: null, rate: null, updatedAt: new Date(NOW - i * 60_000).toISOString(), ...over,
});
const TITLES = ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Эпсилон', 'Эта', 'Зета', 'Тета'];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetKicks();
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [
      { id: 'p1', name: 'Сайт', color: '#87ff65' },
      { id: 'p2', name: 'Бот', color: '#5ec8f2' },
      { id: 'p3', name: 'Блог', color: '#ff7a7a' },
    ],
    // Названия статусов — как у новых проектов (английские по умолчанию), виды — все пять.
    statuses: [
      { id: 'sb', projectId: 'p1', name: 'Backlog', color: '#6b7cad', kind: 'backlog', order: 0 },
      { id: 'st', projectId: 'p1', name: 'To do', color: '#8a93a5', kind: 'todo', order: 1 },
      { id: 'sp', projectId: 'p1', name: 'In progress', color: '#f5c451', kind: 'progress', order: 2 },
      { id: 'sd', projectId: 'p1', name: 'Done', color: '#69d345', kind: 'done', order: 3 },
      { id: 'sc', projectId: 'p1', name: 'Cancelled', color: '#8a93a5', kind: 'cancelled', order: 4 },
      { id: 'q2', projectId: 'p2', name: 'In progress', color: '#f5c451', kind: 'progress', order: 0 },
      { id: 'q2b', projectId: 'p2', name: 'Backlog', color: '#6b7cad', kind: 'backlog', order: 1 },
      { id: 'q2d', projectId: 'p2', name: 'Done', color: '#69d345', kind: 'done', order: 2 },
      { id: 'q3', projectId: 'p3', name: 'To do', color: '#8a93a5', kind: 'todo', order: 0 },
    ],
    tags: [],
    versions: [],
    tasks: [
      task('a', 'Альфа', { dueAt: day(-2) }, 0), // просрочена, в работе
      task('b', 'Бета', { statusId: 'st', dueAt: day(0) }, 1), // сегодня, к выполнению
      task('c', 'Гамма', { projectId: 'p2', statusId: 'q2', dueAt: day(3) }, 2), // через три дня
      task('d', 'Дельта', { projectId: 'p2', statusId: 'q2b' }, 3), // склад идей, без срока
      task('e', 'Эпсилон', { projectId: 'p3', statusId: 'q3', dueAt: day(30) }, 4), // нескоро
      task('f', 'Эта', { statusId: 'sc' }, 5), // отменена: закрыта, но не выполнена
      task('g', 'Зета', { statusId: 'sd', done: true, dueAt: day(-1) }, 6), // выполнена
      // Выполнена, а статус — «в работе»: по правилу ленты она всё равно «выполнена».
      task('h', 'Тета', { done: true }, 7),
    ],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, quickAddProjectId: null },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Лист живёт в сторе, и рисует его BottomSheet; здесь — тот же вид без
 *  анимации: содержимое и подвал в одном дереве с экраном. Второе дерево рядом
 *  не годится — события экрана после него перестают доходить. */
function SheetHost() {
  const content = useSheetStore((s) => s.content);
  const footer = useSheetStore((s) => s.footer);
  return <View testID="sheet-host">{content}{footer}</View>;
}
const renderScreen = () => render(<><TasksScreen navigation={nav()} /><SheetHost /></>);
const sheetOf = (s) => within(s.getByTestId('sheet-host'));

const chip = (s, key) => s.getByTestId(`tasks-filter-${key}`);
const inChip = (s, key) => within(chip(s, key));
/** Открыть лист чипа; вернуть запросы по его содержимому. */
async function openFilter(s, key) {
  await fireEvent.press(chip(s, key));
  return sheetOf(s);
}
const wait = (ms) => act(async () => { jest.advanceTimersByTime(ms); });

/** Названия задач на экране, в порядке показа. */
const shown = (s) => s.queryAllByText(new RegExp(`^(${TITLES.join('|')})$`)).map((n) => n.props.children);

/** Названия задач и подписи «Выполнено» и «Отменённые» — в порядке показа. */
function sequence(s) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.props && n.props.testID === 'tasks-group-done') out.push('Выполнено');
    if (n.props && n.props.testID === 'tasks-group-cancelled') out.push('Отменённые');
    if (n.type === 'Text' && n.children && n.children.length === 1 && TITLES.includes(n.children[0])) out.push(n.children[0]);
    walk(n.children);
  }(s.toJSON()));
  return out;
}

/** itemLayoutAnimation списка: MOVE — переезд задан, undefined — нет. */
function listLayout(s) {
  let found;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.props && 'itemLayoutAnimation' in n.props) found = n.props.itemLayoutAnimation;
    walk(n.children);
  }(s.toJSON()));
  return found;
}

// --- чипы --------------------------------------------------------------------

describe('чипы', () => {
  test('три чипа: «Проект», «Дедлайн», «Статус» — в покое подписи фильтров', async () => {
    const s = await renderScreen();
    inChip(s, 'project').getByText('Проект');
    inChip(s, 'due').getByText('Дедлайн');
    inChip(s, 'status').getByText('Статус');
    expect(t('ru', 'filter.project')).toBe('Проект');
    expect(t('ru', 'due.label')).toBe('Дедлайн');
    expect(t('ru', 'task.status_label')).toBe('Статус');
    // Прежних чипов («Все», проекты по одному, «показывать выполненные») нет.
    expect(s.queryByRole('switch')).toBeNull();
    expect(s.queryByText(t('ru', 'filter.all'))).toBeNull();
  });

  test('«Проект»: ничего — «Проект», один — его имя, несколько — первое и «+ ещё»', async () => {
    const s = await renderScreen();
    inChip(s, 'project').getByText('Проект');
    const sheet = await openFilter(s, 'project');
    await fireEvent.press(sheet.getByText('Сайт'));
    inChip(s, 'project').getByText('Сайт');
    await fireEvent.press(sheet.getByText('Бот'));
    await fireEvent.press(sheet.getByText('Блог'));
    inChip(s, 'project').getByText('Сайт +2');
    // Первый — по порядку проектов, а не по очерёдности нажатий.
    await fireEvent.press(sheet.getByText('Сайт'));
    inChip(s, 'project').getByText('Бот +1');
    await fireEvent.press(sheet.getByText('Блог'));
    inChip(s, 'project').getByText('Бот');
    await fireEvent.press(sheet.getByText('Бот'));
    inChip(s, 'project').getByText('Проект');
  });

  test('включённый чип — акцентная рамка и selected; выключенный — рамка в цвет подложки', async () => {
    const { result } = await renderHook(() => useColors());
    const c = result.current;
    const s = await renderScreen();
    for (const key of ['project', 'due', 'status']) {
      expect(chip(s, key).props.accessibilityState.selected).toBe(false);
      expect(flat(chip(s, key))).toMatchObject({ borderColor: c.panel, backgroundColor: c.panel });
    }
    const sheet = await openFilter(s, 'project');
    await fireEvent.press(sheet.getByText('Сайт'));
    expect(chip(s, 'project').props.accessibilityState.selected).toBe(true);
    expect(flat(chip(s, 'project')).borderColor).toBe(c.accent);
    // Остальные чипы не тронуты; размер у включённого тот же (рамка есть всегда).
    expect(chip(s, 'due').props.accessibilityState.selected).toBe(false);
    expect(flat(chip(s, 'project')).borderWidth).toBe(flat(chip(s, 'due')).borderWidth);
    expect(flat(chip(s, 'project')).height).toBe(flat(chip(s, 'due')).height);
  });

  // 12 октября 2026: пока хоть один отбор включён, в конце ряда — чип
  // «Сбросить» (крестик и слово): снимает всё одним касанием, не открывая
  // три листа. Отбора нет — чипа нет.
  test('«Сбросить» в конце ряда: появляется с первым отбором, снимает все три и пропадает', async () => {
    const { result } = await renderHook(() => useColors());
    const s = await renderScreen();
    expect(s.queryByTestId('tasks-filter-reset')).toBeNull();
    // Включили проект — чип последним в ряду.
    let sheet = await openFilter(s, 'project');
    await fireEvent.press(sheet.getByText('Сайт'));
    await act(async () => { useSheetStore.setState({ content: null, footer: null }); });
    const reset = s.getByTestId('tasks-filter-reset');
    const row = s.getByTestId('tasks-filters');
    expect(row.children.at(-1)).toBe(reset);
    within(reset).getByText(t('ru', 'tasks.filter_reset'));
    expect(reset.props.accessibilityRole).toBe('button');
    expect(reset.props.accessibilityLabel).toBe(t('ru', 'tasks.filter_reset'));
    // Тот же чип, что и фильтры: подложка panel, без акцентной рамки, слово не ужимается.
    expect(flat(reset).backgroundColor).toBe(result.current.panel);
    expect(flat(reset).borderColor).toBe(result.current.panel);
    expect(flat(reset).flexShrink).toBe(0);
    // Ещё срок и статус — чип один.
    sheet = await openFilter(s, 'due');
    await fireEvent.press(sheet.getByText(t('ru', 'tasks.due_today')));
    sheet = await openFilter(s, 'status');
    await fireEvent.press(sheet.getByText(t('ru', 'status.kind_progress')));
    await act(async () => { useSheetStore.setState({ content: null, footer: null }); });
    expect(s.getAllByTestId('tasks-filter-reset')).toHaveLength(1);
    expect(shown(s)).not.toContain('Гамма');
    // Касание снимает все три: подписи чипов прежние, лента целиком, чипа нет.
    await fireEvent.press(s.getByTestId('tasks-filter-reset'));
    inChip(s, 'project').getByText('Проект');
    inChip(s, 'due').getByText(t('ru', 'due.label'));
    inChip(s, 'status').getByText(t('ru', 'task.status_label'));
    for (const key of ['project', 'due', 'status']) expect(chip(s, key).props.accessibilityState.selected).toBe(false);
    expect(shown(s)).toContain('Гамма');
    expect(s.queryByTestId('tasks-filter-reset')).toBeNull();
  });

  test('лист: заголовок — подпись чипа, отметки сразу применяются, «Сбросить» — пока что-то отмечено', async () => {
    const s = await renderScreen();
    expect(shown(s)).toContain('Гамма');
    const sheet = await openFilter(s, 'project');
    expect(useSheetStore.getState().header.title).toBe('Проект');
    expect(useSheetStore.getState().footer).toBeNull();
    // Строки — флажки с состоянием, снимается тем же нажатием.
    const rows = sheet.getAllByRole('checkbox');
    expect(rows).toHaveLength(3);
    await fireEvent.press(sheet.getByText('Сайт'));
    expect(sheet.getAllByRole('checkbox').map((r) => r.props.accessibilityState.checked)).toEqual([true, false, false]);
    // Применено сразу: задач других проектов на экране нет. Отменённая «Эта» — внизу, после выполненных.
    expect(shown(s)).toEqual(['Альфа', 'Бета', 'Зета', 'Тета', 'Эта']);
    expect(useSheetStore.getState().footer).toBeTruthy();
    expect(t('ru', 'tasks.filter_reset')).toBe('Сбросить');
    await fireEvent.press(sheet.getByText('Сбросить'));
    inChip(s, 'project').getByText('Проект');
    expect(shown(s)).toContain('Гамма');
    expect(sheet.getAllByRole('checkbox').map((r) => r.props.accessibilityState.checked)).toEqual([false, false, false]);
    expect(useSheetStore.getState().footer).toBeNull();
  });
});

// --- дедлайн -----------------------------------------------------------------

describe('«Дедлайн»', () => {
  const pick = async (s, label) => {
    const sheet = await openFilter(s, 'due');
    await fireEvent.press(sheet.getByText(label));
    return sheet;
  };

  test('пункты: Любой, Просрочено, Сегодня, На этой неделе, Без дедлайна; один выбор закрывает лист', async () => {
    const s = await renderScreen();
    const sheet = await openFilter(s, 'due');
    expect(useSheetStore.getState().header.title).toBe('Дедлайн');
    expect(sheet.getAllByRole('radio').map((r) => within(r).getAllByText(/./)[0].props.children))
      .toEqual(['Любой', 'Просрочено', 'Сегодня', 'На этой неделе', 'Без дедлайна']);
    await fireEvent.press(sheet.getByText('Просрочено'));
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('«Просрочено» — только невыполненные с прошедшим сроком; чип показывает выбранное', async () => {
    const s = await renderScreen();
    await pick(s, 'Просрочено');
    expect(shown(s)).toEqual(['Альфа']); // у выполненной «Зеты» срок вчера, но она не просрочена
    inChip(s, 'due').getByText('Просрочено');
    expect(chip(s, 'due').props.accessibilityState.selected).toBe(true);
    expect(s.queryByTestId('tasks-group-done')).toBeNull();
  });

  test('«Сегодня» — срок в сегодняшний день; «На этой неделе» — семь дней, считая сегодня', async () => {
    const s = await renderScreen();
    await pick(s, 'Сегодня');
    expect(shown(s)).toEqual(['Бета']);
    await pick(s, 'На этой неделе');
    expect(shown(s)).toEqual(['Бета', 'Гамма']); // через 30 дней — не неделя, просроченные — тоже
    inChip(s, 'due').getByText('На этой неделе');
  });

  test('«Без дедлайна» — только задачи без срока, выполненные тоже', async () => {
    const s = await renderScreen();
    await pick(s, 'Без дедлайна');
    expect(shown(s)).toEqual(['Дельта', 'Тета', 'Эта']);
    inChip(s, 'due').getByText('Без дедлайна');
  });

  test('«Любой» и «Сбросить» возвращают всё; у чипа снова «Дедлайн»', async () => {
    const s = await renderScreen();
    await pick(s, 'Сегодня');
    const sheet = await openFilter(s, 'due');
    // Открыт при выбранном «Сегодня»: он отмечен, а «Сбросить» уже в подвале.
    expect(sheet.getAllByRole('radio').map((r) => r.props.accessibilityState.selected)).toEqual([false, false, true, false, false]);
    await fireEvent.press(sheet.getByText('Сбросить'));
    inChip(s, 'due').getByText('Дедлайн');
    expect(shown(s)).toHaveLength(8);
    await pick(s, 'Просрочено');
    await pick(s, 'Любой');
    inChip(s, 'due').getByText('Дедлайн');
    expect(shown(s)).toHaveLength(8);
  });
});

// --- статус ------------------------------------------------------------------

describe('«Статус»: по виду статуса', () => {
  const toggle = async (sheet, label) => fireEvent.press(sheet.getByText(label));

  test('пункты — названия видов статусов, все пять видов', async () => {
    const s = await renderScreen();
    const sheet = await openFilter(s, 'status');
    expect(useSheetStore.getState().header.title).toBe('Статус');
    expect(sheet.getAllByRole('checkbox').map((r) => within(r).getAllByText(/./)[0].props.children))
      .toEqual(['Склад идей', 'Запланировано', 'В работе', 'Сделано', 'Отменено']);
    expect(['backlog', 'todo', 'progress', 'done', 'cancelled'].map((k) => t('ru', `status.kind_${k}`)))
      .toEqual(['Склад идей', 'Запланировано', 'В работе', 'Сделано', 'Отменено']);
  });

  test('вид, а не статус: «Запланировано» берёт задачи всех проектов с таким видом', async () => {
    const s = await renderScreen();
    const sheet = await openFilter(s, 'status');
    await toggle(sheet, 'Запланировано');
    expect(shown(s)).toEqual(['Бета', 'Эпсилон']); // «Бета» из «Сайта», «Эпсилон» из «Блога»
    inChip(s, 'status').getByText('Запланировано');
    expect(s.queryByTestId('tasks-group-done')).toBeNull(); // статус отбирает и выполненные
    await toggle(sheet, 'Склад идей');
    expect(shown(s)).toEqual(['Бета', 'Эпсилон', 'Дельта']);
    inChip(s, 'status').getByText('Склад идей +1');
  });

  test('«Сделано» — и по статусу, и по галочке: выполненная считается выполненной, какой бы ни был статус', async () => {
    const s = await renderScreen();
    const sheet = await openFilter(s, 'status');
    await toggle(sheet, 'Сделано');
    expect(shown(s)).toEqual(['Зета', 'Тета']);
    expect(s.getByTestId('tasks-group-done')).toBeTruthy();
    // «В работе» выполненную «Тету» не берёт, хотя статус у неё «в работе».
    await toggle(sheet, 'Сделано');
    await toggle(sheet, 'В работе');
    expect(shown(s)).toEqual(['Альфа', 'Гамма']);
    inChip(s, 'status').getByText('В работе');
  });

  test('«Отменено» — закрытая, но не выполненная; без «Сделано» выполненных в ленте нет', async () => {
    const s = await renderScreen();
    const sheet = await openFilter(s, 'status');
    await toggle(sheet, 'Отменено');
    expect(shown(s)).toEqual(['Эта']);
    await toggle(sheet, 'Сделано');
    // Выполненные — раздел выше отменённых: «Эта» теперь последняя.
    expect(shown(s)).toEqual(['Зета', 'Тета', 'Эта']);
    inChip(s, 'status').getByText('Сделано +1'); // порядок видов — как в списке, не по нажатиям
  });
});

// --- вместе и мимо -----------------------------------------------------------

describe('фильтры вместе', () => {
  test('проект, срок и статус сходятся по «и»', async () => {
    const s = await renderScreen();
    const projects = await openFilter(s, 'project');
    await fireEvent.press(projects.getByText('Бот'));
    expect(shown(s)).toEqual(['Гамма', 'Дельта']);
    await fireEvent.press((await openFilter(s, 'due')).getByText('На этой неделе'));
    expect(shown(s)).toEqual(['Гамма']);
    const status = await openFilter(s, 'status');
    await fireEvent.press(status.getByText('Склад идей'));
    expect(shown(s)).toEqual([]); // «Гамма» в работе, «Дельта» без срока
    // Нет ни одной подходящей — пустой экран «ничего не подходит», а не «задач нет».
    expect(s.getByText(t('ru', 'empty.filter_title'))).toBeTruthy();
  });

  test('показывает ли строка проект: без отбора по одному проекту — плашка проекта есть, с ним — нет', async () => {
    const s = await renderScreen();
    within(s.getByTestId('task-meta-a')).getByText('Сайт');
    const sheet = await openFilter(s, 'project');
    await fireEvent.press(sheet.getByText('Сайт'));
    expect(within(s.getByTestId('task-meta-a')).queryByText('Сайт')).toBeNull();
    await fireEvent.press(sheet.getByText('Бот'));
    within(s.getByTestId('task-meta-a')).getByText('Сайт');
  });
});

// --- быстрое добавление --------------------------------------------------------

describe('быстрое добавление и отобранный проект', () => {
  const add = async (s, title) => {
    const input = s.getByLabelText(t('ru', 'tasks.new_ph'));
    await fireEvent.changeText(input, title);
    await fireEvent(input, 'submitEditing');
    return useAppStore.getState().tasks.find((x) => x.title === title);
  };

  test('отобран ровно один проект — задача идёт в него, а не в прошлый', async () => {
    useAppStore.setState({ ui: { ...useAppStore.getState().ui, quickAddProjectId: 'p1' } });
    const s = await renderScreen();
    const sheet = await openFilter(s, 'project');
    await fireEvent.press(sheet.getByText('Блог'));
    const added = await add(s, 'Новая в блоге');
    expect(added.projectId).toBe('p3');
  });

  test('отобраны два проекта (или ни одного) — прежнее правило: прошлый, иначе первый', async () => {
    useAppStore.setState({ ui: { ...useAppStore.getState().ui, quickAddProjectId: 'p2' } });
    const s = await renderScreen();
    const sheet = await openFilter(s, 'project');
    await fireEvent.press(sheet.getByText('Сайт'));
    await fireEvent.press(sheet.getByText('Блог'));
    expect((await add(s, 'Первая')).projectId).toBe('p2');
    await fireEvent.press(sheet.getByText('Сайт'));
    await fireEvent.press(sheet.getByText('Блог'));
    expect((await add(s, 'Вторая')).projectId).toBe('p2');
  });
});

// --- выполненные внизу и переезд -----------------------------------------------

describe('выполненные: внизу под подписью, отметка — плавный переезд', () => {
  test('выполненные после всех активных групп, под подписью «Выполнено»', async () => {
    useAppStore.setState({ tasks: useAppStore.getState().tasks.map((x) => (x.id === 'b' ? { ...x, pinnedAt: day(-1) } : x)) });
    const s = await renderScreen();
    // «Бета» закреплена → своя группа; затем незакреплённые; и только потом выполненные.
    // Незакреплённые — по сроку, без срока в конце. Самый низ — «Отменённые»
    // (решение пользователя): серый крестик вместо галочки, под выполненными.
    expect(sequence(s)).toEqual(['Бета', 'Альфа', 'Гамма', 'Эпсилон', 'Дельта', 'Выполнено', 'Зета', 'Тета', 'Отменённые', 'Эта']);
    expect(within(s.getByTestId('tasks-group-done')).getByText('Выполнено')).toBeTruthy();
    expect(within(s.getByTestId('tasks-group-cancelled')).getByText(t('ru', 'tasks.cancelled_group'))).toBeTruthy();
    expect(t('ru', 'tasks.cancelled_group')).toBe('Отменённые');
    // Отменённой не нужна галочка: на её месте крестик, и это кнопка, а не флажок.
    expect(s.getAllByRole('checkbox')).toHaveLength(7);
    expect(s.getAllByLabelText(t('ru', 'task.reopen'))).toHaveLength(1);
    expect(s.getAllByTestId('cross-layer')).toHaveLength(1);
  });

  test('отметка: задача отмечается сразу, строка стоит, пока налив играет, потом едет в «Выполнено»; снятая — обратно', async () => {
    useAppStore.setState({ tasks: useAppStore.getState().tasks.filter((x) => ['a', 'b', 'g'].includes(x.id)) });
    const s = await renderScreen();
    expect(sequence(s)).toEqual(['Альфа', 'Бета', 'Выполнено', 'Зета']);
    expect(listLayout(s)).toBeUndefined();
    const checkOf = (title) => s.getAllByRole('checkbox')[sequence(s).filter((x) => x !== 'Выполнено').indexOf(title)];
    const doneOf = (id) => useAppStore.getState().tasks.find((x) => x.id === id).done;
    // Счётчик открытых в шапке — число рядом с названием вкладки.
    const count = () => s.getAllByText(/^[0-9]+$/)[0].props.children;
    expect(count()).toBe(2);

    await fireEvent.press(checkOf('Альфа'));
    // В тот же миг: галочка налита, задача отмечена в сторе, счётчик уже 1 —
    // но строка стоит в своей группе, и переезд к концу налива уже задан.
    expect(checkOf('Альфа').props.accessibilityState.checked).toBe(true);
    expect(doneOf('a')).toBe(true);
    expect(count()).toBe(1);
    expect(sequence(s)).toEqual(['Альфа', 'Бета', 'Выполнено', 'Зета']);
    expect(listLayout(s)).toBe(MOVE);
    await wait(LIQUID.check.duration - 20);
    expect(sequence(s)).toEqual(['Альфа', 'Бета', 'Выполнено', 'Зета']);

    // Налив кончился — строка уезжает: свежеотмеченная наверху «Выполнено», выше старой.
    await wait(20 + 10);
    expect(sequence(s)).toEqual(['Бета', 'Выполнено', 'Альфа', 'Зета']);
    expect(listLayout(s)).toBe(MOVE);
    await wait(MOVE_MS + 1000); // с запасом на медленную отрисовку (useOrderHold, SLOW_MS)
    expect(listLayout(s)).toBeUndefined();

    // Снять отметку: без налива и ожидания; строка возвращается в свою группу (moveSoon).
    await fireEvent.press(checkOf('Альфа'));
    await wait(ARM_MS + 20);
    expect(doneOf('a')).toBe(false);
    expect(sequence(s)).toEqual(['Альфа', 'Бета', 'Выполнено', 'Зета']);
    expect(listLayout(s)).toBe(MOVE);
  });

  test('второе нажатие, пока налив играет, ничего не меняет: задача отмечается один раз', async () => {
    useAppStore.setState({ tasks: useAppStore.getState().tasks.filter((x) => ['a', 'b', 'g'].includes(x.id)) });
    const s = await renderScreen();
    const check = () => s.getAllByRole('checkbox')[0];
    await fireEvent.press(check());
    await fireEvent.press(check());
    expect(useAppStore.getState().tasks.find((x) => x.id === 'a').done).toBe(true);
    await wait(LIQUID.check.duration + 100);
    expect(sequence(s)).toEqual(['Бета', 'Выполнено', 'Альфа', 'Зета']);
  });

  test('крестик отменённой: нажатие возвращает её в работу — в статус по умолчанию, строка едет наверх', async () => {
    useAppStore.setState({ tasks: useAppStore.getState().tasks.filter((x) => ['a', 'f'].includes(x.id)) });
    const s = await renderScreen();
    expect(sequence(s)).toEqual(['Альфа', 'Отменённые', 'Эта']);
    // Серая мета и серое название без зачёркивания (в отличие от выполненной).
    expect(flat(s.getByText('Эта')).textDecorationLine).not.toBe('line-through');
    expect(flat(s.getByText('Эта')).color).toBe(colors.textFaint);
    await fireEvent.press(s.getByLabelText(t('ru', 'task.reopen')));
    await wait(ARM_MS + 20);
    // Первый «к выполнению» проекта — «To do» (st).
    expect(useAppStore.getState().tasks.find((x) => x.id === 'f')).toMatchObject({ statusId: 'st', done: false, cancelled: false });
    expect(sequence(s)).toEqual(['Альфа', 'Эта']);
    expect(s.queryByTestId('tasks-group-cancelled')).toBeNull();
    // Крестик стирается и уходит из дерева, под ним — пустая галочка.
    expect(flat(s.getByTestId('cross-stroke-a')).transform).toContainEqual({ scaleX: 0 });
    await wait(LIQUID.uncross.duration + 60);
    expect(s.queryAllByTestId('cross-layer')).toHaveLength(0);
    expect(s.getAllByRole('checkbox')).toHaveLength(2);
  });

  test('«уменьшение движения»: ждать нечего — отметка сразу, переезда нет', async () => {
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    useAppStore.setState({ tasks: useAppStore.getState().tasks.filter((x) => ['a', 'b', 'g'].includes(x.id)) });
    const s = await renderScreen();
    await fireEvent.press(s.getAllByRole('checkbox')[0]);
    expect(useAppStore.getState().tasks.find((x) => x.id === 'a').done).toBe(true);
    expect(sequence(s)).toEqual(['Бета', 'Выполнено', 'Альфа', 'Зета']);
    expect(listLayout(s)).toBeUndefined();
  });
});

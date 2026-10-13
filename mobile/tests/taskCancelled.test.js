// Отменённые задачи: серый крестик вместо галочки и группа «Отменённые» в
// самом низу (решение пользователя, 12 октября). Запуск: npm run test:mobile
//
// Задача отменена, когда вид её статуса — «отменено» (core status.js,
// STATUS_KINDS; у задачи при этом done = false, cancelled = true).
//
// Строка (TaskRow, TaskListItem): вместо галочки серый крестик того же
// квадрата (taskCheckRadius, та же сторона), и это кнопка «вернуть в работу», а
// не флажок. Название серое, но не зачёркнутое; мета — серое «Отменено»; срока
// нет. Стала отменённой, пока строка на виду, — штрихи крестика прорисовываются
// и квадрат делает небольшой «поп», без брызг; вернули в работу — штрихи
// стираются. Первая отрисовка и «уменьшение движения» — сразу, без движения.
//
// Страница проекта: группа «Отменённые» — самый низ списка, под всеми статусами
// и закреплёнными; на вкладках «Все · Активные · Готово» отменённая видна только
// под «Все». Отметка галочкой меняет задачу сразу (шкала и «готово из всех» не
// ждут), строка стоит в своей группе, пока налив играет, и потом едет в группу
// готовых.
import { StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import TaskRow from '../src/components/TaskRow';
import TaskListItem from '../src/components/TaskListItem';
import ProjectScreen from '../src/screens/ProjectScreen';
import { useAppStore } from '../src/store/useAppStore';
import { LIQUID, CHECK_DROPS, CROSS_POP_KICK, CROSS_POP_DELAY, crossDraw, resetKicks } from '../src/lib/liquid';
import { isCancelled, rowStatus } from '../src/lib/statuses';
import { colors, taskCheckRadius } from '../src/theme';
import { t } from '../src/lib/i18n';

jest.mock('../src/components/DocEditor', () => () => null);
jest.mock('react-native-reanimated', () => {
  const m = jest.requireActual('react-native-reanimated/mock');
  const { useRef } = jest.requireActual('react');
  return {
    ...m,
    useSharedValue: (init) => {
      const ref = useRef(null);
      if (!ref.current) ref.current = m.useSharedValue(init);
      return ref.current;
    },
    withSpring: jest.fn((to, cfg, cb) => m.withSpring(to, cfg, cb)),
    withTiming: jest.fn((to, cfg, cb) => m.withTiming(to, cfg, cb)),
    withDelay: jest.fn((ms, next) => next),
  };
});
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));

const { withSpring, withTiming, withDelay } = Reanimated;
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const draws = () => withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.cross);
const erases = () => withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.uncross);
const pours = () => withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.check);
const crossPops = () => withSpring.mock.calls.filter(([, cfg]) => cfg && cfg.velocity === CROSS_POP_KICK);

const STATUSES = [
  { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
  { id: 's2', projectId: 'p1', name: 'Готово', color: '#69d345', kind: 'done', order: 1 },
  { id: 's3', projectId: 'p1', name: 'Не будем', color: '#8a93a5', kind: 'cancelled', order: 2 },
];
const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, cancelled: false, totalMs: 0, tagIds: [],
  sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null, notes: '', updatedAt: '2026-10-11T08:00:00.000Z', ...over,
});
const cancelledTask = (over) => task({ statusId: 's3', cancelled: true, ...over });

beforeEach(() => {
  mockReduced = false;
  resetKicks();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', tagIds: [], createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: STATUSES,
    versions: [],
    tags: [],
    documents: [],
    tasks: [task()],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, boardVersion: {}, listCollapsed: {}, boardCollapsed: {} },
  });
  withSpring.mockClear();
  withTiming.mockClear();
  withDelay.mockClear();
});

describe('правило: что считается отменённой', () => {
  test('по виду статуса, если он известен, иначе по флагу; выполненная отменённой не бывает', () => {
    expect(isCancelled(task({ statusId: 's3' }), STATUSES)).toBe(true);
    expect(isCancelled(task({ statusId: 's1', cancelled: true }), STATUSES)).toBe(false); // вид статуса главнее флага
    expect(isCancelled(task({ statusId: 'gone', cancelled: true }), STATUSES)).toBe(true);
    expect(isCancelled(task({ statusId: 's3', done: true }), STATUSES)).toBe(false);
    expect(isCancelled(task(), STATUSES)).toBe(false);
    expect(isCancelled(null, STATUSES)).toBe(false);
  });

  test('мета: серое «Отменено» из словаря — не имя статуса проекта, без цвета', () => {
    expect(rowStatus(STATUSES, task({ statusId: 's3' }), false, 'ru')).toEqual({
      name: t('ru', 'status.kind_cancelled'), color: null, done: true, cancelled: true,
    });
    expect(t('ru', 'status.kind_cancelled')).toBe('Отменено');
    // Открытая — по-прежнему её статус и цвет.
    expect(rowStatus(STATUSES, task(), false, 'ru')).toEqual({ name: 'В работе', color: '#5ec8f2', done: false });
  });

  test('подпись раздела — во всех четырёх языках', () => {
    expect(t('ru', 'tasks.cancelled_group')).toBe('Отменённые');
    for (const lang of ['en', 'uk', 'kk']) {
      expect(t(lang, 'tasks.cancelled_group')).toBeTruthy();
      expect(t(lang, 'tasks.cancelled_group')).not.toBe('tasks.cancelled_group');
    }
  });
});

describe('крестик: ход рисования', () => {
  test('пусто → нарисован: подложка и штрихи доходят до 1, первый штрих идёт впереди второго', () => {
    expect(crossDraw(0)).toEqual({ fill: 0, a: 0, b: 0 });
    expect(crossDraw(1)).toEqual({ fill: 1, a: 1, b: 1 });
    for (const p of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const d = crossDraw(p);
      expect(d.a).toBeGreaterThanOrEqual(d.b);
      expect(d.fill).toBeGreaterThanOrEqual(0);
      expect(d.fill).toBeLessThanOrEqual(1);
    }
    // Второй штрих стартует, когда первый уже идёт, а подложка успела проступить.
    expect(crossDraw(0.3).b).toBe(0);
    expect(crossDraw(0.3).a).toBeGreaterThan(0.3);
    expect(crossDraw(0.45).fill).toBe(1);
  });

  test('токены движения: рисуется тише налива, стирается быстро, «поп» — меньше галочкиного', () => {
    expect(LIQUID.cross.duration).toBeGreaterThanOrEqual(240);
    expect(LIQUID.cross.duration).toBeLessThanOrEqual(340);
    expect(LIQUID.uncross.duration).toBeLessThan(LIQUID.cross.duration);
    expect(CROSS_POP_DELAY).toBeLessThan(LIQUID.cross.duration);
    expect(CROSS_POP_KICK).toBeLessThan(require('../src/lib/liquid').CHECK_POP_KICK);
  });
});

describe('строка задачи (TaskRow): отменённая', () => {
  const row = (over, props) => <TaskRow task={task(over)} onPress={() => {}} {...props} />;

  test('первая отрисовка: крестик стоит сразу, без движения и брызг; галочки нет', async () => {
    useAppStore.setState({ tasks: [cancelledTask()] });
    const s = await render(row({ statusId: 's3', cancelled: true }));
    expect(draws()).toHaveLength(0);
    expect(erases()).toHaveLength(0);
    expect(s.queryAllByRole('checkbox')).toHaveLength(0);
    expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
    // Крестик нарисован до конца.
    expect(s.getByTestId('cross-layer')).toBeTruthy();
    expect(flat(s.getByTestId('cross-fill')).opacity).toBe(1);
    expect(flat(s.getByTestId('cross-stroke-a')).transform).toContainEqual({ scaleX: 1 });
    expect(flat(s.getByTestId('cross-stroke-b')).transform).toContainEqual({ scaleX: 1 });
    // Серые токены: подложка raise, штрихи textFaint; галочкиной налитости нет.
    expect(flat(s.getByTestId('cross-fill')).backgroundColor).toBe(colors.raise);
    expect(flat(s.getByTestId('cross-stroke-a')).backgroundColor).toBe(colors.textFaint);
    expect(flat(s.getByTestId('check-icon')).opacity).toBe(0);
    expect(flat(s.getByTestId('check-base')).borderColor).toBe(colors.raise);
  });

  test('у обычной строки крестика в дереве нет вовсе', async () => {
    const s = await render(row());
    expect(s.queryAllByTestId('cross-layer')).toHaveLength(0);
    expect(s.getAllByRole('checkbox')).toHaveLength(1);
    expect(draws()).toHaveLength(0);
  });

  test('кнопка «вернуть в работу»: тот же квадрат, что у галочки, а не флажок', async () => {
    useAppStore.setState({ tasks: [cancelledTask()] });
    const s = await render(row({ statusId: 's3', cancelled: true }));
    const cross = s.getByLabelText(t('ru', 'task.reopen'));
    expect(cross.props.accessibilityRole).toBe('button');
    expect(cross.props.accessibilityState.checked).toBeUndefined();
    expect(flat(cross)).toMatchObject({ width: 24, height: 24, borderRadius: taskCheckRadius });
    expect(s.queryByLabelText(t('ru', 'task.mark_done'))).toBeNull();
  });

  test('название серое и не зачёркнутое, мета — серое «Отменено» с серой точкой, срока нет', async () => {
    const overdue = '2026-01-01T10:00:00.000Z';
    useAppStore.setState({ tasks: [cancelledTask({ dueAt: overdue })] });
    const s = await render(row({ statusId: 's3', cancelled: true, dueAt: overdue }));
    const title = flat(s.getByText('Вёрстка шапки'));
    expect(title.color).toBe(colors.textFaint);
    expect(title.textDecorationLine).not.toBe('line-through');
    const label = s.getByText('Отменено');
    expect(flat(label).color).toBe(colors.textFaint);
    expect(flat(s.getByTestId('task-dot-t1')).backgroundColor).toBe(colors.textFaint);
    // Имя статуса проекта («Не будем») и срок не показываются.
    expect(s.queryByText('Не будем')).toBeNull();
    expect(s.queryByText(t('ru', 'due.overdue'), { exact: false })).toBeNull();
  });

  test('стала отменённой, пока строка на виду: штрихи прорисовываются, «поп», без брызг и налива', async () => {
    const s = await render(row());
    expect(draws()).toHaveLength(0);
    useAppStore.setState({ tasks: [cancelledTask()] });
    await s.rerender(row({ statusId: 's3', cancelled: true }));
    await s.rerender(row({ statusId: 's3', cancelled: true })); // стили — по значениям, записанным в эффекте

    expect(draws()).toHaveLength(1);
    expect(draws()[0][0]).toBe(1);
    expect(erases()).toHaveLength(0);
    // «Поп» — одна пружина-толчок, с задержкой, меньше галочкиного.
    expect(crossPops()).toHaveLength(1);
    expect(withDelay.mock.calls.map(([ms]) => ms)).toContain(CROSS_POP_DELAY);
    // Тихо: ни налива, ни капель.
    expect(pours()).toHaveLength(0);
    expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
    expect(CHECK_DROPS).toBeGreaterThan(0);
    // Конечный вид — крестик нарисован, и это кнопка.
    expect(flat(s.getByTestId('cross-stroke-b')).transform).toContainEqual({ scaleX: 1 });
    expect(s.queryAllByRole('checkbox')).toHaveLength(0);
    s.getByLabelText(t('ru', 'task.reopen'));
  });

  test('вернули в работу: штрихи стираются, потом крестик уходит из дерева, под ним пустая галочка', async () => {
    jest.useFakeTimers();
    try {
      useAppStore.setState({ tasks: [cancelledTask()] });
      const s = await render(row({ statusId: 's3', cancelled: true }));
      useAppStore.setState({ tasks: [task()] });
      await s.rerender(row());
      await s.rerender(row());
      expect(erases()).toHaveLength(1);
      expect(erases()[0][0]).toBe(0);
      expect(draws()).toHaveLength(0);
      expect(flat(s.getByTestId('cross-stroke-a')).transform).toContainEqual({ scaleX: 0 });
      // Пока стирается — ещё в дереве; потом уходит.
      expect(s.queryAllByTestId('cross-layer')).toHaveLength(1);
      await act(async () => { jest.advanceTimersByTime(LIQUID.uncross.duration + 60); });
      expect(s.queryAllByTestId('cross-layer')).toHaveLength(0);
      const box = s.getByRole('checkbox');
      expect(box.props.accessibilityState).toMatchObject({ checked: false });
    } finally {
      jest.useRealTimers();
    }
  });

  test('«уменьшение движения»: крестик встаёт сразу, без рисования и «попа»', async () => {
    mockReduced = true;
    const s = await render(row());
    useAppStore.setState({ tasks: [cancelledTask()] });
    await s.rerender(row({ statusId: 's3', cancelled: true }));
    await s.rerender(row({ statusId: 's3', cancelled: true }));
    expect(draws()).toHaveLength(0);
    expect(crossPops()).toHaveLength(0);
    expect(flat(s.getByTestId('cross-stroke-a')).transform).toContainEqual({ scaleX: 1 });
    expect(flat(s.getByTestId('cross-fill')).opacity).toBe(1);
  });

  test('нажатие на крестик возвращает задачу в работу: первый «к выполнению» проекта, не «готово»', async () => {
    useAppStore.setState({ tasks: [cancelledTask()] });
    const s = await render(row({ statusId: 's3', cancelled: true }));
    await fireEvent.press(s.getByLabelText(t('ru', 'task.reopen')));
    expect(useAppStore.getState().tasks[0]).toMatchObject({ statusId: 's1', done: false, cancelled: false });
  });

  test('экран решает, когда правка: onToggleDone получает (задача, правка, закрыта ли)', async () => {
    useAppStore.setState({ tasks: [cancelledTask()] });
    const seen = jest.fn();
    const s = await render(row({ statusId: 's3', cancelled: true }, { onToggleDone: seen }));
    await fireEvent.press(s.getByLabelText(t('ru', 'task.reopen')));
    expect(seen).toHaveBeenCalledTimes(1);
    const [got, change, closed] = seen.mock.calls[0];
    expect(got.id).toBe('t1');
    expect(closed).toBe(true);
    // Сама правка ещё не сделана — её делает экран.
    expect(useAppStore.getState().tasks[0].statusId).toBe('s3');
    change();
    expect(useAppStore.getState().tasks[0].statusId).toBe('s1');
  });
});

describe('строка списка проекта (TaskListItem): отменённая', () => {
  const item = (over, props) => <TaskListItem task={task(over)} onPress={() => {}} {...props} />;

  test('крестик вместо галочки, серое название без зачёркивания, мета «Отменено», срока нет', async () => {
    const overdue = '2026-01-01T10:00:00.000Z';
    useAppStore.setState({ tasks: [cancelledTask({ dueAt: overdue })] });
    const s = await render(item({ statusId: 's3', cancelled: true, dueAt: overdue }));
    expect(s.queryAllByRole('checkbox')).toHaveLength(0);
    const cross = s.getByLabelText(t('ru', 'task.reopen'));
    expect(flat(cross)).toMatchObject({ width: 22, height: 22, borderRadius: taskCheckRadius });
    expect(s.getAllByTestId('cross-layer')).toHaveLength(1);
    const title = flat(s.getByText('Вёрстка шапки'));
    expect(title.color).toBe(colors.textFaint);
    expect(title.textDecorationLine).not.toBe('line-through');
    expect(flat(s.getByText('Отменено')).color).toBe(colors.textFaint);
    expect(s.queryByText(t('ru', 'due.overdue'), { exact: false })).toBeNull();
  });

  test('стала отменённой на виду — штрихи прорисовываются; нажатие на крестик — в работу', async () => {
    const s = await render(item());
    useAppStore.setState({ tasks: [cancelledTask()] });
    await s.rerender(item({ statusId: 's3', cancelled: true }));
    await s.rerender(item({ statusId: 's3', cancelled: true }));
    expect(draws()).toHaveLength(1);
    expect(s.queryAllByTestId('check-drop')).toHaveLength(0);
    await fireEvent.press(s.getByLabelText(t('ru', 'task.reopen')));
    expect(useAppStore.getState().tasks[0]).toMatchObject({ statusId: 's1', cancelled: false });
  });
});

// --- страница проекта ------------------------------------------------------------

describe('страница проекта: группа «Отменённые» и отметка без задержки', () => {
  const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }), addListener: jest.fn(() => () => {}) });
  const screen = () => <ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />;
  // Статус «Не будем» стоит в проекте раньше завершающего («Сдано»): порядок
  // статусов группу «Отменённые» не двигает — она всё равно последняя. Имя
  // завершающего — не «Готово»: так зовётся вкладка отбора, и тест их спутал бы.
  const CANCELLED_FIRST = [
    { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
    { id: 's3', projectId: 'p1', name: 'Не будем', color: '#8a93a5', kind: 'cancelled', order: 1 },
    { id: 's2', projectId: 'p1', name: 'Сдано', color: '#69d345', kind: 'done', order: 2 },
  ];
  const seed = () => useAppStore.setState({
    statuses: CANCELLED_FIRST,
    tasks: [
      task({ id: 'a', title: 'Альфа', updatedAt: '2026-10-03T00:00:00.000Z' }),
      task({ id: 'b', title: 'Бета', updatedAt: '2026-10-02T00:00:00.000Z' }),
      task({ id: 'd', title: 'Дельта', statusId: 's2', done: true, updatedAt: '2026-10-01T00:00:00.000Z' }),
      cancelledTask({ id: 'c', title: 'Гамма', updatedAt: '2026-10-04T00:00:00.000Z' }),
      cancelledTask({ id: 'e', title: 'Эпсилон', pinnedAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' }),
    ],
  });
  const TITLES = ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Эпсилон'];
  const NAMES = ['В работе', 'Сдано', 'Не будем', t('ru', 'tasks.cancelled_group'), t('ru', 'home.pinned')];
  /** Подписи групп и названия задач — в порядке показа. */
  function sequence(s) {
    const out = [];
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === 'Text' && n.children && n.children.length === 1) {
        const text = n.children[0];
        if (TITLES.includes(text) || NAMES.includes(text)) out.push(text);
      }
      walk(n.children);
    }(s.toJSON()));
    return out;
  }
  const wait = (ms) => act(async () => { jest.advanceTimersByTime(ms); });

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('«Все»: «Отменённые» — самая последняя группа, под всеми статусами; закреплённая отменённая — тоже там', async () => {
    seed();
    const s = await render(screen());
    expect(sequence(s)).toEqual([
      'В работе', 'Альфа', 'Бета',
      'Сдано', 'Дельта',
      'Отменённые', 'Эпсилон', 'Гамма', // свежие выше; закреплённость их из группы не вытаскивает
    ]);
    // Группы «Закреплённые» нет, статус «Не будем» отдельной группой не стоит.
    expect(s.queryByText(t('ru', 'home.pinned'))).toBeNull();
    expect(s.queryByText('Не будем')).toBeNull();
    // У отменённых — крестики, а у остальных (три открытых и готовая) — галочки.
    expect(s.getAllByRole('checkbox')).toHaveLength(3);
    expect(s.getAllByLabelText(t('ru', 'task.reopen'))).toHaveLength(2);
  });

  test('«Активные» — без отменённых; «Готово» — только готовые, отменённых там тоже нет', async () => {
    seed();
    const s = await render(screen());
    await fireEvent.press(s.getByText(t('ru', 'filter.active')));
    expect(sequence(s)).toEqual(['В работе', 'Альфа', 'Бета']);
    await fireEvent.press(s.getByText(t('ru', 'filter.done')));
    expect(sequence(s)).toEqual(['Сдано', 'Дельта']);
    await fireEvent.press(s.getByText(t('ru', 'filter.all')));
    expect(sequence(s)).toContain('Отменённые');
  });

  test('группа сворачивается, как остальные', async () => {
    seed();
    const s = await render(screen());
    await fireEvent.press(s.getByText(t('ru', 'tasks.cancelled_group')));
    expect(sequence(s)).toEqual(['В работе', 'Альфа', 'Бета', 'Сдано', 'Дельта', 'Отменённые']);
  });

  test('отметка: «готово из всех» и шкала — сразу, строка стоит в своей группе, пока налив играет, потом едет в «Готово»', async () => {
    seed();
    const s = await render(screen());
    s.getByLabelText(`${t('ru', 'project.progress')} 20%`);
    await fireEvent.press(s.getAllByRole('checkbox')[0]);
    // В тот же миг: задача отмечена, шкала с новой целью; строка пока в «В работе», галочка налита.
    expect(useAppStore.getState().tasks.find((x) => x.id === 'a')).toMatchObject({ done: true, statusId: 's2' });
    s.getByLabelText(`${t('ru', 'project.progress')} 40%`);
    expect(s.getAllByRole('checkbox')[0].props.accessibilityState.checked).toBe(true);
    expect(sequence(s)).toEqual(['В работе', 'Альфа', 'Бета', 'Сдано', 'Дельта', 'Отменённые', 'Эпсилон', 'Гамма']);
    await wait(LIQUID.check.duration - 20);
    expect(sequence(s)).toEqual(['В работе', 'Альфа', 'Бета', 'Сдано', 'Дельта', 'Отменённые', 'Эпсилон', 'Гамма']);
    // Налив кончился — строка уехала в «Готово».
    await wait(40);
    expect(sequence(s)).toEqual(['В работе', 'Бета', 'Сдано', 'Альфа', 'Дельта', 'Отменённые', 'Эпсилон', 'Гамма']);
  });

  test('«уменьшение движения»: отметка сразу — и в сторе, и в списке', async () => {
    mockReduced = true;
    seed();
    const s = await render(screen());
    await fireEvent.press(s.getAllByRole('checkbox')[0]);
    expect(useAppStore.getState().tasks.find((x) => x.id === 'a').done).toBe(true);
    expect(sequence(s)).toEqual(['В работе', 'Бета', 'Сдано', 'Альфа', 'Дельта', 'Отменённые', 'Эпсилон', 'Гамма']);
  });

  test('крестик нажали: задача возвращается в работу, и строка уезжает из «Отменённых» к открытым', async () => {
    seed();
    const s = await render(screen());
    await fireEvent.press(s.getAllByLabelText(t('ru', 'task.reopen'))[1]); // «Гамма»
    expect(useAppStore.getState().tasks.find((x) => x.id === 'c')).toMatchObject({ statusId: 's1', cancelled: false });
    expect(sequence(s)).toEqual(['В работе', 'Альфа', 'Бета', 'Гамма', 'Сдано', 'Дельта', 'Отменённые', 'Эпсилон']);
  });

  test('все остальные выполнены, а отменённые остались: на «Активных» — похвала, а не пустой отбор', async () => {
    useAppStore.setState({
      statuses: CANCELLED_FIRST,
      tasks: [task({ id: 'd', title: 'Дельта', statusId: 's2', done: true }), cancelledTask({ id: 'c', title: 'Гамма' })],
    });
    const s = await render(screen());
    await fireEvent.press(s.getByText(t('ru', 'filter.active')));
    s.getByText(t('ru', 'empty.project_done_title'));
  });
});

// Кнопка старта таймера и галочка «выполнено» у задачи — скруглённые квадраты.
// Запуск: npm run test:mobile
//
// 12 октября 2026 они перестали быть кружками (999), а у списка проекта и
// страницы задачи были ещё и своими числами (6 и 18). Теперь у кнопок старта
// одно скругление — токен taskControlRadius (12) из theme.js, у галочек —
// свой taskCheckRadius (8: та же доля стороны, с 12 галочка 24 стала бы
// кругом), и оба меньше половины стороны: кружок не вернётся. Тест не мерит на
// глаз, а обходит места, где такая кнопка рисуется: строку задачи (TaskRow) во
// всех состояниях, строку списка проекта (TaskListItem), «последнюю задачу» на
// «Сегодня», таймер на странице задачи, плашку идущей задачи, скелет строки —
// и исходники: новая кнопка старта или галочка со своим скруглением покажет
// себя здесь, а не на глаз у людей.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import TaskRow from '../src/components/TaskRow';
import TaskListItem from '../src/components/TaskListItem';
import TimerMiniPlayer from '../src/components/TimerMiniPlayer';
import HomeScreen from '../src/screens/HomeScreen';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import { useAppStore } from '../src/store/useAppStore';
// colors — тёмная палитра: тема в тестах тёмная.
import { colors, radius, buttonRadius, taskControlRadius, taskCheckRadius } from '../src/theme';
import { t } from '../src/lib/i18n';

// Редактор — WebView, у него нативная часть; на странице задачи он нужен
// только как предпросмотр заметок.
jest.mock('../src/components/DocEditor', () => () => null);

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const H = 3_600_000;
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, totalMs: H, tagIds: [],
  sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null, repeat: null, rate: null, pinnedAt: null, notes: '',
  updatedAt: at(10), ...over,
});
const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [task()],
    activeTimer: null,
  });
});

/** Галочки и кнопки старта/стопа в отрисованном дереве. */
function controlsOf(screen) {
  return [
    ...screen.queryAllByRole('checkbox'),
    ...screen.queryAllByLabelText(t('ru', 'timer.start')),
    ...screen.queryAllByLabelText(t('ru', 'timer.stop')),
  ];
}

/** Каждый — скруглённый квадрат: токен (галочка — свой), и не круг. */
function expectSquares(nodes) {
  expect(nodes.length).toBeGreaterThan(0);
  for (const n of nodes) {
    const s = flat(n);
    const check = n.props.accessibilityRole === 'checkbox';
    expect(s.borderRadius).toBe(check ? taskCheckRadius : taskControlRadius);
    expect(s.width).toBeGreaterThan(0);
    expect(s.height).toBeGreaterThan(0);
    // Круг — это скругление в половину стороны и больше.
    expect(s.borderRadius).toBeLessThan(Math.min(s.width, s.height) / 2);
  }
}

test('токены: кнопка старта — 12, мягче поля и не круглее главной кнопки; галочка — 8 (sm)', () => {
  expect(taskControlRadius).toBe(12);
  expect(taskControlRadius).toBeGreaterThan(radius.md);
  expect(taskControlRadius).toBeLessThan(buttonRadius);
  expect(taskCheckRadius).toBe(radius.sm);
  // Согласованы: доля скругления от стороны у галочки 24 и кнопки 38 — около трети.
  expect(Math.abs(taskCheckRadius / 24 - taskControlRadius / 38)).toBeLessThan(0.03);
});

describe('строка задачи (TaskRow): галочка и кнопка старта/стопа', () => {
  const cases = [
    ['не выполнена, стоит', {}, {}],
    ['выполнена', { task: { done: true } }, {}],
    ['в колоде: сжатая, галочка показана до отметки', { props: { compact: true, checked: true } }, {}],
    ['идёт таймер: «стоп»', {}, { activeTimer: { taskId: 't1', startedAt: at(11), heartbeatAt: at(11) } }],
    ['в ленте: с плашкой проекта', { props: { showProject: true } }, {}],
  ];
  test.each(cases)('%s', async (_name, { task: over, props }, store) => {
    useAppStore.setState({ tasks: [task(over)], ...store });
    const screen = await render(<TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} {...props} />);
    const controls = controlsOf(screen);
    // Ровно две: галочка и кнопка таймера.
    expect(controls).toHaveLength(2);
    expectSquares(controls);
  });

  test('размеры прежние: галочка 24, кнопка 38 — только форма другая', async () => {
    const screen = await render(<TaskRow task={task()} onPress={() => {}} />);
    const [check, play] = controlsOf(screen);
    expect(flat(check)).toMatchObject({ width: 24, height: 24 });
    expect(flat(play)).toMatchObject({ width: 38, height: 38 });
  });

  test('выполненная: налита акцентом (и рамка под ним — акцент), галочка видна', async () => {
    const screen = await render(<TaskRow task={task({ done: true })} onPress={() => {}} />);
    const [check] = screen.queryAllByRole('checkbox');
    expect(check.props.accessibilityState).toMatchObject({ checked: true });
    // Квадрат налит до конца — сплошной акцент, рамка того же цвета.
    expect(flat(screen.getByTestId('check-shape')).backgroundColor).toBe(colors.accent);
    expect(flat(screen.getByTestId('check-base')).borderColor).toBe(colors.accent);
    expect(flat(screen.getByTestId('check-icon')).opacity).toBe(1);
  });
});

describe('строка списка проекта (TaskListItem): галочка', () => {
  test.each([['не выполнена', {}], ['выполнена', { done: true }]])('%s', async (_name, over) => {
    const screen = await render(<TaskListItem task={task(over)} onPress={() => {}} />);
    const boxes = screen.queryAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expectSquares(boxes);
    expect(flat(boxes[0])).toMatchObject({ width: 22, height: 22 });
  });
});

test('«Сегодня»: кнопка старта у последней задачи', async () => {
  const screen = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  const starts = screen.queryAllByLabelText(t('ru', 'timer.start'));
  expectSquares(starts);
  expect(flat(starts[0])).toMatchObject({ width: 46, height: 46 });
});

describe('страница задачи: кнопка таймера', () => {
  const open = () => render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);

  test('стоит — «старт»', async () => {
    const screen = await open();
    const [start] = screen.queryAllByLabelText(t('ru', 'timer.start'));
    expectSquares([start]);
    expect(flat(start)).toMatchObject({ width: 58, height: 58 });
  });

  test('идёт — «стоп» того же вида', async () => {
    useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: at(11), heartbeatAt: at(11) } });
    const screen = await open();
    expectSquares(screen.queryAllByLabelText(t('ru', 'timer.stop')));
  });
});

test('плашка идущей задачи: кнопка «стоп»', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: at(11), heartbeatAt: at(11) } });
  const screen = await render(<TimerMiniPlayer onOpen={() => {}} />);
  expectSquares(screen.queryAllByLabelText(t('ru', 'timer.stop')));
});

// Исходники: рендер видит то, что умеет открыть; этот обход — все файлы, в том
// числе экраны за навигацией. Любая нажимаемая галочка или кнопка старта/стопа
// называет скругление только токеном.
describe('исходники: галочки и кнопки старта не называют своего скругления', () => {
  const root = join(__dirname, '..', 'src');
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'core' && name !== 'editor') walk(full); } else if (name.endsWith('.js')) files.push(full);
    }
  })(root);

  /** Теги <Tap …>, <Pressable …>, <AnimatedPressable …>, <LiquidButton …> и
   *  <LiquidCheck …> (кнопка старта и галочка с наливом — сами Tap внутри)
   *  целиком: скобки {} считаем, чтобы `=>` в обработчиках не принять за
   *  конец тега. */
  function tagsOf(src) {
    const out = [];
    const open = /<(?:Tap|Pressable|AnimatedPressable|LiquidButton|LiquidCheck)\s/g;
    for (let m = open.exec(src); m; m = open.exec(src)) {
      let depth = 0;
      let i = m.index;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '>' && depth === 0 && src[i - 1] !== '=') break;
      }
      out.push(src.slice(m.index, i + 1));
    }
    return out;
  }
  const isControl = (tag) => /accessibilityRole="checkbox"/.test(tag) || /'timer\.(start|stop)'/.test(tag);

  const found = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const tag of tagsOf(src).filter(isControl)) {
      const names = [...tag.matchAll(/styles\.(\w+)/g)].map((m) => m[1]);
      const check = /accessibilityRole="checkbox"/.test(tag);
      found.push({ file: file.slice(root.length + 1).replace(/\\/g, '/'), tag: tag.replace(/\s+/g, ' ').slice(0, 70), names, src, check });
    }
  }

  test('обход нашёл все места, где они рисуются', () => {
    const where = new Set(found.map((f) => f.file));
    for (const f of ['components/TaskRow.js', 'components/TaskListItem.js', 'components/TimerMiniPlayer.js', 'screens/HomeScreen.js', 'screens/TaskDetailScreen.js']) {
      expect([...where]).toContain(f);
    }
  });

  test('скругление в стилях — только токен: taskControlRadius у кнопок, taskCheckRadius у галочек', () => {
    for (const { file, tag, names, src, check } of found) {
      const radii = names.flatMap((name) => {
        const def = src.match(new RegExp(`\\b${name}: \\{([^}]*)\\}`));
        return def ? [...def[1].matchAll(/borderRadius:\s*([^,}\s]+)/g)].map((m) => m[1]) : [];
      });
      const token = check ? 'taskCheckRadius' : 'taskControlRadius';
      expect({ file, tag, radii }).toEqual({ file, tag, radii: radii.map(() => token) });
      // Без скругления остаётся только прозрачная зона нажатия (accStop на iOS 26).
      if (!names.includes('accStop')) expect({ file, tag, has: radii.length > 0 }).toEqual({ file, tag, has: true });
    }
  });

  test('скелет строки задачи рисует те же квадраты, а не кружки', () => {
    const src = readFileSync(join(root, 'components', 'Skeleton.js'), 'utf8');
    const row = src.slice(src.indexOf('function SkTaskRow'), src.indexOf('function SkListIsland'));
    expect(row.match(/radius=\{taskCheckRadius\}/g)).toHaveLength(1);
    expect(row.match(/radius=\{taskControlRadius\}/g)).toHaveLength(1);
    expect(row).not.toMatch(/radius=\{(?:13|19|999)\}/);
  });
});

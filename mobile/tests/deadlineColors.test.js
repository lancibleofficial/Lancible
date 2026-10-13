// Цвета сроков и токены палитры. Запуск: npm run test:mobile
//
// На карточке колоды «Проекты» срок «скоро» рисовался ЧЁРНЫМ на тёмной теме.
// Причина — не тёмный токен, а несуществующий: код брал colors.warn,
// которого в палитре нет, и color: undefined в массиве стилей перебивал цвет
// строки (StyleSheet.flatten копирует и undefined) — RN рисует такой текст
// системным чёрным. То же стояло на странице задачи (срок в «Свойствах»).
// Теперь «скоро» — accentInk, как в строках задач, а этот файл ловит класс
// ошибок целиком: любой colors.<имя> в исходниках телефона обязан быть в обеих
// палитрах, и срок на карточке, в строке и на странице задачи ни в одной теме
// не уходит в тёмные чернила accentText.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, renderHook, within } from '@testing-library/react-native';
import ProjectsScreen from '../src/screens/ProjectsScreen';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import TaskRow from '../src/components/TaskRow';
import { useAppStore } from '../src/store/useAppStore';
import { colors as dark, useColors } from '../src/theme';

// Редактор — WebView; на странице задачи он нужен только как предпросмотр заметок.
jest.mock('../src/components/DocEditor', () => () => null);

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const H = 3_600_000;
const inHours = (h) => new Date(Date.now() + h * H).toISOString();
const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });
const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [],
  pinnedAt: null, dueAt: null, repeat: null, rate: null, notes: '', updatedAt: '2026-10-01T10:00:00.000Z', ...over,
});

const setTheme = (theme) => useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme } });
/** Палитра темы, как её отдаёт useColors (светлая нигде больше не экспортируется). */
const paletteOf = async (theme) => { setTheme(theme); const { result } = await renderHook(() => useColors()); return result.current; };

beforeEach(() => {
  setTheme('dark');
  useAppStore.setState({
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [], tags: [], tasks: [task()], activeTimer: null,
  });
});

// Контраст надписи с подложкой острова (panel) по WCAG.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('палитра: каждый colors.<имя> в исходниках существует', () => {
  const root = join(__dirname, '..', 'src');
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js') && name !== 'editorBundle.js') files.push(full);
    }
  })(root);

  test('обе палитры — один набор токенов', async () => {
    expect(Object.keys(await paletteOf('light')).sort()).toEqual(Object.keys(dark).sort());
  });

  test('ни одного токена, которого нет в палитре (colors.warn и подобных)', () => {
    const known = new Set(Object.keys(dark));
    const unknown = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?<![\w.])colors\.(\w+)/g)) {
        if (!known.has(m[1])) unknown.push(`${file.slice(root.length + 1).replace(/\\/g, '/')}: colors.${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});

describe.each(['dark', 'light'])('срок на карточке колоды, тема %s', (theme) => {
  // «скоро» и «просрочен» — акцент и danger, дальше — textDim; никогда не accentText
  // (тёмные чернила для текста поверх акцентной заливки) и не «не задан».
  const cases = [['просрочен', -3, 'danger'], ['в пределах суток', 5, 'accentInk'], ['дальше', 24 * 5, 'textDim']];

  test.each(cases)('%s', async (_name, hours, token) => {
    const colors = await paletteOf(theme);
    useAppStore.setState({ tasks: [task({ dueAt: inHours(hours) })] });
    const s = await render(<ProjectsScreen navigation={nav()} />);
    const node = s.getAllByText(/^· /)[0];
    const color = flat(node).color;
    expect(typeof color).toBe('string');
    expect(color).toBe(colors[token]);
    expect(color).not.toBe(colors.accentText);
    // Читается на острове: не тёмные чернила на тёмном.
    expect(contrast(color, colors.panel)).toBeGreaterThanOrEqual(theme === 'dark' ? 4.5 : 3);
  });
});

describe.each(['dark', 'light'])('срок в строке задачи (колода, лента), тема %s', (theme) => {
  test.each([[-3, 'danger'], [5, 'accentInk'], [24 * 5, 'textFaint']])('через %i ч — %s', async (hours, token) => {
    const colors = await paletteOf(theme);
    const t1 = task({ dueAt: inHours(hours) });
    useAppStore.setState({ tasks: [t1] });
    const s = await render(<TaskRow task={t1} onPress={() => {}} />);
    const meta = s.getByTestId('task-meta-t1');
    const due = within(meta).queryAllByText(/./).filter((n) => n.props.children !== '·' && n.props.children !== 'В работе').at(-1);
    expect(flat(due).color).toBe(colors[token]);
    expect(flat(due).color).not.toBe(colors.accentText);
  });
});

describe.each(['dark', 'light'])('срок на странице задачи, тема %s', (theme) => {
  test.each([[-3, 'danger'], [5, 'accentInk'], [24 * 5, 'textDim']])('через %i ч — %s', async (hours, token) => {
    const colors = await paletteOf(theme);
    useAppStore.setState({ tasks: [task({ dueAt: inHours(hours) })] });
    const s = await render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);
    const color = flat(s.getByTestId('task-due-value')).color;
    expect(typeof color).toBe('string');
    expect(color).toBe(colors[token]);
    expect(color).not.toBe(colors.accentText);
  });
});

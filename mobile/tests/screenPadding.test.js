// Боковое поле страницы — один токен на все экраны и шапки (theme.js: screenPadding).
// Запуск: npm run test:mobile
//
// 11 октября 2026 поле стало уже и одним числом. Раньше у вкладок (острова)
// оно было 12, а у шапок, страницы проекта, уведомлений, документов и листов —
// 16: заголовок стоял на 4 dp правее краёв островов под ним. Теперь поле —
// screenPadding (10), и экраны его не повторяют числом.
//
// Две проверки. Отрисовка: шапки (вкладки, стека, задачи) и лист берут токен.
// Исходники: край каждой страницы объявлен через токен, а в экранах и шапках
// не осталось бокового spacing.lg — прежнего поля шапок. Колода «Проектов»,
// страница задачи (тело, шит), плашка идущей задачи и скелет колоды тоже
// на токене. Список «ждёт» — места, которые ещё на старом поле (сейчас пуст);
// он работает храповиком: перевели место на токен, а из списка не вычеркнули —
// тест красный.
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import AppHeader from '../src/components/AppHeader';
import TabHeader from '../src/components/TabHeader';
import DetailHeader from '../src/components/DetailHeader';
import BottomSheet from '../src/components/BottomSheet';
import RateSheet from '../src/components/RateSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { screenPadding, spacing, gap } from '../src/theme';

jest.mock('../src/components/DocEditor', () => () => null);

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const noop = () => {};

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 } });
});
// Кадр выезда листа не должен выпасть после разбора окружения.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

describe('значение токена', () => {
  test('поле уже обоих прежних: 12 у вкладок и 16 у шапок и листов', () => {
    expect(screenPadding).toBe(10);
    expect(screenPadding).toBeLessThan(spacing.md);
    expect(screenPadding).toBeLessThan(spacing.lg);
  });

  test('это отдельный токен, а не пересчёт зазора между островами или шага отступов', () => {
    expect(screenPadding).not.toBe(gap);
    expect(Object.values(spacing)).not.toContain(screenPadding);
  });
});

describe('отрисовка: шапки и лист берут токен', () => {
  test('шапка вкладки, шапка стека и шапка задачи — одно поле', async () => {
    const tab = await render(<TabHeader title="Проекты" />);
    const tabPad = flat(tab.toJSON()).paddingHorizontal;
    const stack = await render(<AppHeader navigation={{ goBack: noop }} route={{ name: 'Tags' }} options={{ title: 'Теги' }} back={{ title: '' }} />);
    const stackPad = flat(stack.getByTestId('app-header-row')).paddingHorizontal;
    const detail = await render(<DetailHeader onBack={noop} backLabel="Назад" title="Сайт" sub="Вёрстка" />);
    const detailPad = flat(detail.toJSON()).paddingHorizontal;

    expect(tabPad).toBe(screenPadding);
    expect(stackPad).toBe(screenPadding);
    expect(detailPad).toBe(screenPadding);
  });

  test('нижний лист: строка шапки, содержимое и подвал — то же поле', async () => {
    openSheet(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    const screen = await render(<BottomSheet />);
    expect(flat(screen.getByTestId('sheet-head-row'))).toMatchObject({ paddingHorizontal: screenPadding });
    expect(StyleSheet.flatten(screen.getByTestId('sheet-scroll').props.contentContainerStyle)).toMatchObject({ paddingHorizontal: screenPadding });
    expect(useSheetStore.getState().footer).not.toBeNull();
    expect(flat(screen.getByTestId('sheet-footer-content'))).toMatchObject({ paddingHorizontal: screenPadding });
  });
});

describe('исходники: край страницы объявлен токеном', () => {
  const SRC = path.join(__dirname, '..', 'src');
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

  /** Текст объекта стиля под ключом (`key: { … }`, скобки сбалансированы). */
  function block(text, key) {
    const m = new RegExp(`^[ \\t]*${key}: \\{`, 'm').exec(text);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < text.length && depth) {
      const ch = text[i++];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    return text.slice(m.index, i);
  }

  // Края страниц: файл → [ключ стиля, свойство], что задают боковое поле.
  const H = 'paddingHorizontal';
  const M = 'marginHorizontal';
  const L = 'paddingLeft';
  const EDGES = {
    'components/AppHeader.js': [['row', H]],
    'components/ProjectsEmpty.js': [['wrap', H]],
    'components/TimerMiniPlayer.js': [['wrap', H]],
    'components/TabHeader.js': [['wrap', H]],
    'components/DetailHeader.js': [['head', H]],
    'components/BottomSheet.js': [['headRow', H], ['content', H], ['footer', H]],
    // Шапки в заглушках нет: там настоящая (TabHeader.js, ключ `wrap`).
    'components/Skeleton.js': [['gutter', H], ['listRow', H], ['deck', L]],
    'screens/HomeScreen.js': [['content', H]],
    'screens/NotificationsScreen.js': [['content', H]],
    'screens/ProjectsScreen.js': [['strip', L]],
    'screens/ProjectScreen.js': [['content', H], ['boardBody', M]],
    'screens/SettingsScreen.js': [['content', H]],
    'screens/StatsScreen.js': [['segWrap', H], ['content', H]],
    'screens/TasksScreen.js': [['chips', H], ['qa', M], ['content', H]],
    'screens/TagsScreen.js': [['content', H]],
    'screens/TaskDetailScreen.js': [['body', H], ['sheetHead', H], ['segWrap', M], ['sheetBody', H], ['sheetFoot', H]],
    'screens/DocumentsScreen.js': [['searchRow', M], ['listContent', H], ['footer', H]],
    'screens/ProjectStatusesScreen.js': [['content', H]],
    'screens/EditorScreen.js': [['docHead', H]],
    'screens/SearchScreen.js': [['head', H], ['content', H]],
  };

  test.each(Object.entries(EDGES).flatMap(([file, keys]) => keys.map(([key, prop]) => [file, key, prop])))('%s → %s: %s = screenPadding', (file, key, prop) => {
    const text = read(file);
    expect(text).toMatch(/import \{[^}]*\bscreenPadding\b[^}]*\} from '\.\.\/theme'/);
    const b = block(text, key);
    expect(b).not.toBeNull();
    expect(b).toMatch(new RegExp(`\\b${prop}\\s*:\\s*-?screenPadding\\b`));
  });

  test('доска и вкладка «Сегодня» (сетка) — тоже на токене: отступ доски и обёртка недели', () => {
    expect(read('components/BoardView.js')).toMatch(/const GUTTER = screenPadding;/);
    expect(read('screens/HomeScreen.js')).toMatch(/<View style=\{\{ paddingHorizontal: screenPadding \}\}>\{weekIsland\}<\/View>/);
  });

  test('колода «Проектов»: ширина карточки, «+» слева и плашка с фразой справа — от токена, а не от 16', () => {
    const text = read('screens/ProjectsScreen.js');
    expect(text).toMatch(/const cardW = width - screenPadding - PEEK;/);
    expect(text).toMatch(/plusLeft: \{ left: screenPadding - GAP - PLUS_W - PLUS_TAIL/);
    expect(text).toMatch(/\{ left: screenPadding \+ count \* step \}/);
    expect(text).not.toMatch(/spacing\.lg - GAP|spacing\.lg \+ count|width - spacing\.lg/);
  });

  test('страница задачи: бегущая строка истории растягивается ровно на поле шита', () => {
    expect(block(read('screens/TaskDetailScreen.js'), 'hrowRun')).toMatch(/marginHorizontal:\s*-screenPadding\b.*paddingHorizontal:\s*screenPadding\b/);
  });

  // Боковое spacing.lg в экранах и шапках — прежнее поле шапок. Не осталось нигде.
  const SCAN = [
    'components/AppHeader.js', 'components/TabHeader.js', 'components/DetailHeader.js', 'components/BackButton.js',
    'components/BottomSheet.js', 'components/BoardView.js', 'components/Skeleton.js',
    ...fs.readdirSync(path.join(SRC, 'screens'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `screens/${f.replace(/\\/g, '/')}`),
  ];
  const WAITING = [];

  /** Все объекты стиля с боковым spacing.lg: «файл::ключ». */
  function leftovers() {
    const found = [];
    for (const file of SCAN) {
      const text = read(file);
      for (const m of text.matchAll(/^[ \t]*(\w+): \{/gm)) {
        const b = block(text, m[1]);
        if (b && /(?:padding|margin)(?:Horizontal|Left|Right)\s*:\s*-?spacing\.lg\b/.test(b)) found.push(`${file}::${m[1]}`);
      }
    }
    return [...new Set(found)].sort();
  }

  test('в экранах и шапках нет бокового spacing.lg, кроме списка «ждёт»', () => {
    const left = leftovers();
    expect(left.filter((k) => !WAITING.includes(k))).toEqual([]);
  });

  test('список «ждёт» не врёт: каждое место в нём ещё на старом поле', () => {
    const left = leftovers();
    expect(WAITING.filter((k) => !left.includes(k))).toEqual([]);
  });
});

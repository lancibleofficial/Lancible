// Пустой экран и сценки телефона. Запуск: npm run test:mobile
//
// Сценки — те же формы, что на десктопе и в вебе: core/illustrations.js
// (побайтная копия), своих форм у телефона нет. Здесь проверяется
// то же, что tests/unit/illustrations.test.js проверяет у общих: первой лежит
// подложка, форм не меньше пяти, есть пятно акцента, в разметке нет цвета и
// чужих классов, — и то, что добавляет телефон: у каждой роли есть краска,
// краска — из токенов своей темы, отрисованная сценка красится только ими,
// а сам EmptyState рисует сценку, заголовок, пояснение и кнопку по желанию.
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import Svg, { Rect } from 'react-native-svg';
import EmptyState from '../src/components/EmptyState';
import ArtScene from '../src/components/ArtScene';
import { ART_SCENES, ART_PARTS, ART_PAINT, artElements, artMarkup, artPaint, parseArt, pathBox } from '../src/lib/art';
import Core from '../src/core/illustrations.js';
import { useColors } from '../src/theme';
import { useAppStore } from '../src/store/useAppStore';

// Сценка скрыта от скринридера — и от запросов по умолчанию тоже.
const HIDDEN = { includeHiddenElements: true };
const setTheme = (theme) => useAppStore.setState((s) => ({ settings: { ...s.settings, theme } }));
afterEach(() => setTheme('dark'));

/** Палитра текущей темы — тем же хуком, которым её берут экраны. */
async function palette() {
  let colors;
  const Probe = () => { colors = useColors(); return null; };
  await render(<Probe />);
  return colors;
}

/** Все формы-хосты react-native-svg в отрисованном дереве. */
function svgShapes(json) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (/^RNSVG(Rect|Circle|Path)$/.test(node.type)) out.push(node);
    (node.children || []).forEach(walk);
  };
  walk(json);
  return out;
}

describe('сценки', () => {
  test('у телефона ровно сценки ядра — и среди них те, что зовут его экраны', () => {
    expect(ART_SCENES).toEqual(Core.ART_SCENES);
    for (const name of ['projects', 'docs', 'time', 'bell', 'tasks', 'filter', 'timer', 'search', 'tags', 'versions']) expect(ART_SCENES).toContain(name);
    expect(new Set(ART_SCENES).size).toBe(ART_SCENES.length);
  });

  test.each(ART_SCENES)('%s: подложка первой, несколько форм, пятно акцента', (name) => {
    const shapes = artElements(name);
    expect(shapes[0].parts).toEqual(['es-plate']);
    expect(shapes.length).toBeGreaterThanOrEqual(5);
    expect(shapes.some((s) => s.parts.includes('es-mark'))).toBe(true);
  });

  test.each(ART_SCENES)('%s: в разметке нет цвета, классы — только части сценки', (name) => {
    const markup = artMarkup(name);
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(markup).not.toMatch(/\s(fill|stroke|style|color|opacity)=/);
    const used = [...new Set(artElements(name).flatMap((s) => s.parts))];
    expect(used.filter((c) => !ART_PARTS.includes(c))).toEqual([]);
  });

  test('своих форм у телефона нет: разметка сценки — ровно та, что в ядре', () => {
    // С 11 октября 2026 шесть сценок, нарисованных сначала на телефоне
    // (lib/artScenes.js), переехали в ядро слово в слово, а файл ушёл.
    for (const name of ART_SCENES) expect(artMarkup(name)).toBe(Core.artShapes(name));
    expect(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'artScenes.js'))).toBe(false);
  });

  test('разбор: числа — числами, у скругления ry = rx, преобразование — строкой', () => {
    const [r] = parseArt('<rect class="es-sheet es-back" x="40" y="22" width="40" height="50" rx="8" transform="rotate(-12 60 47)"/>');
    expect(r).toEqual({
      tag: 'rect', parts: ['es-sheet', 'es-back'],
      attrs: { x: 40, y: 22, width: 40, height: 50, rx: 8, ry: 8, transform: 'rotate(-12 60 47)' },
    });
    expect(parseArt('')).toEqual([]);
    expect(artElements('нет-такой')).toEqual([]);
  });

  test('рамка искры — по её точкам', () => {
    const spark = artElements('projects').at(-1);
    expect(pathBox(spark.attrs.d)).toEqual({ x: 90, y: 11, width: 12, height: 12 });
  });

  test('у каждой части сценки есть краска', () => {
    for (const part of ART_PARTS) expect(ART_PAINT).toHaveProperty(part);
  });

  test.each(['dark', 'light'])('краска — токены темы (%s): подложка, лист, линии, акцент', async (theme) => {
    setTheme(theme);
    const c = await palette();
    expect(artPaint(['es-plate'], c)).toEqual({ fill: c.artPlate });
    expect(artPaint(['es-sheet', 'es-back'], c)).toEqual({ fill: c.artSheet, opacity: 0.6 });
    expect(artPaint(['es-ink-soft'], c)).toEqual({ fill: c.artInk, opacity: 0.55 });
    expect(artPaint(['es-dash'], c)).toEqual({ fill: 'none', stroke: c.artInk, strokeWidth: 1.5, strokeDasharray: '3 3' });
    expect(artPaint(['es-mark'], c)).toEqual({ fill: c.accent });
    expect(artPaint(['es-on-mark'], c)).toEqual({ fill: c.accentText });
  });

  test.each(['dark', 'light'])('отрисованная сценка красится только токенами темы (%s)', async (theme) => {
    setTheme(theme);
    const c = await palette();
    // Как токен выглядит после react-native-svg — рисуем по прямоугольнику на каждый.
    const tokens = ['artPlate', 'artSheet', 'artInk', 'accent', 'accentText'];
    const ref = await render(<Svg>{tokens.map((k) => <Rect key={k} fill={c[k]} />)}</Svg>);
    const allowed = svgShapes(ref.toJSON()).map((n) => JSON.stringify(n.props.fill));
    for (const name of ART_SCENES) {
      const { toJSON } = await render(<ArtScene name={name} />);
      const shapes = svgShapes(toJSON());
      expect(shapes).toHaveLength(artElements(name).length);
      for (const s of shapes) {
        if (s.props.stroke) expect(allowed).toContain(JSON.stringify(s.props.stroke));
        else expect(allowed).toContain(JSON.stringify(s.props.fill));
      }
    }
    // Темы разные — и сценка в них разная.
    setTheme(theme === 'dark' ? 'light' : 'dark');
    const other = await palette();
    expect(other.artSheet).not.toBe(c.artSheet);
  });

  test('ни в сценках, ни в пустом экране нет цвета строкой — только токены theme.js', () => {
    const files = ['components/ArtScene.js', 'components/EmptyState.js', 'components/ProjectsEmpty.js', 'lib/art.js'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
      expect(src.match(/['"]#[0-9a-fA-F]{3,8}['"]|rgba?\(/g)).toBeNull();
    }
  });
});

describe('EmptyState', () => {
  test('сценка, заголовок, пояснение и кнопка; кнопка зовёт действие', async () => {
    const onAction = jest.fn();
    const screen = await render(<EmptyState art="docs" title="Документов пока нет" text="Бриф, договор" actionLabel="Новый документ" onAction={onAction} primary />);
    screen.getByTestId('art-docs', HIDDEN);
    screen.getByText('Документов пока нет');
    screen.getByText('Бриф, договор');
    await fireEvent.press(screen.getByText('Новый документ'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test('без действия — без кнопки', async () => {
    const screen = await render(<EmptyState art="bell" title="Дедлайнов пока нет" text="Срок ставится в задаче." />);
    screen.getByTestId('art-bell', HIDDEN);
    expect(screen.queryByTestId('primary-button')).toBeNull();
  });

  test('акцентная кнопка — заливка акцентом, тихая — ступенью острова', async () => {
    const c = await palette();
    const fill = async (primary) => {
      const s = await render(<EmptyState art="tasks" title="Задач пока нет" actionLabel="Новая задача" onAction={() => {}} primary={primary} />);
      return StyleSheet.flatten(s.getByTestId('primary-button').props.style).backgroundColor;
    };
    expect(await fill(true)).toBe(c.accent);
    expect(await fill(false)).toBe(c.panel2);
  });

  test('размеры сценки: большой 120 × 88, компактный и строка 56 × 40', async () => {
    const size = async (props) => {
      const s = await render(<EmptyState art="tasks" title="Задач пока нет" {...props} />);
      const { width, height } = StyleSheet.flatten(s.getByTestId('art-tasks', HIDDEN).props.style);
      return [width, height];
    };
    expect(await size({})).toEqual([120, 88]);
    expect(await size({ size: 'sm' })).toEqual([56, 40]);
    expect(await size({ size: 'row' })).toEqual([56, 40]);
  });

  test('сценка скрыта от скринридера, заголовок большого — заголовок', async () => {
    const s = await render(<EmptyState art="tasks" title="Задач пока нет" />);
    expect(s.queryByTestId('art-tasks')).toBeNull();
    expect(s.getByTestId('art-tasks', HIDDEN).props.accessibilityElementsHidden).toBe(true);
    expect(s.getByText('Задач пока нет').props.accessibilityRole).toBe('header');
  });
});

// Панель выделенного (протокол 4, 18 октября 2026). Запуск: npm run test:mobile (из корня)
//
// Пользователь: плавающие панели картинки, таблицы и PDF мешают — вместо них
// пусть меняется содержимое панели над клавиатурой, слева «назад» (снимает
// выделение). Редактор шлёт context { kind, state } (lib/editorBridge.js),
// панель (components/EditorToolbar.js) строит по нему свою строку, команды
// уходят exec по именам протокола. Пока выделение есть, панель видна и без
// клавиатуры — на странице задачи над свёрнутым шитом с таймером.
//
// Сборки редактора с протоколом 4 здесь нет и не нужно: сообщения страницы
// подменены, проверяется сторона телефона.
import { StyleSheet, DeviceEventEmitter } from 'react-native';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import * as KeyboardLib from 'react-native-keyboard-controller';
import EditorToolbar, {
  CONTEXT_ROWS, IMAGE_WIDTHS, PDF_FONT_SIZES, PDF_STROKES, HUES, INK_COLORS, TOOLBAR_GAP, TOOLBAR_SPACE, contextKeys,
} from '../src/components/EditorToolbar';
import { radius } from '../src/theme';
import { EMPTY_FORMAT, normalizeFormat, parseMessage, normalizeContext, sameContext, CONTEXT_KINDS, IMAGE_ALIGNS, PDF_PAGE_TOOLS } from '../src/lib/editorBridge';
import TaskDetailScreen, { notesFloor, notesMinHeight } from '../src/screens/TaskDetailScreen';
import EditorScreen from '../src/screens/EditorScreen';
import BottomSheet from '../src/components/BottomSheet';
import { EDITOR_BASE_URL } from '../src/components/DocEditor';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { shareBase64File } from '../src/lib/exportRunner';
import DocCore from '../src/core/doc.js';
import { ICONS } from '../src/core/icons';
import { T, t } from '../src/lib/i18n';

jest.mock('react-native-webview', () => {
  const React = require('react');
  return {
    WebView: React.forwardRef((props, ref) => {
      global.__web = props;
      React.useImperativeHandle(ref, () => ({ postMessage: (m) => global.__posted.push(JSON.parse(m)) }));
      return null;
    }),
  };
});
jest.mock('../src/lib/exportRunner', () => ({ runExport: jest.fn(), shareTextFile: jest.fn(async () => {}), shareBase64File: jest.fn(async () => {}) }));

// --- панель сама по себе ----------------------------------------------------------

const actions = () => ({
  exec: jest.fn(), link: jest.fn(), image: jest.fn(), exportDoc: jest.fn(),
  ink: jest.fn(), inkTool: jest.fn(), inkColor: jest.fn(), inkSize: jest.fn(),
  deselect: jest.fn(), imageAlt: jest.fn(), imageCaption: jest.fn(),
});
const fmt = (over) => normalizeFormat({ ...EMPTY_FORMAT, focused: true, ...over });
const cx = (kind, state) => ({ kind, state: normalizeContext(kind, state) });
const bar = (props = {}) => render(<EditorToolbar lang="ru" format={fmt()} actions={actions()} docked={false} {...props} />);
const buttons = (q, group) => within(q.getByTestId(`tb-row-${group}`)).getAllByRole('button').map((n) => n.props.testID);
const selected = (q, id) => !!(q.getByTestId(id).props.accessibilityState || {}).selected;
const disabled = (q, id) => !!(q.getByTestId(id).props.accessibilityState || {}).disabled;
const iconOf = (q, id) => {
  const ds = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.props && typeof n.props.d === 'string') ds.push(n.props.d);
    (n.children || []).forEach(walk);
  }(q.getByTestId(id)));
  const key = ds.join('|');
  return Object.keys(ICONS).find((k) => ICONS[k].p.map(([d]) => d).join('|') === key) || null;
};
const ids = (keys) => keys.map((k) => `tb-${k}`);

beforeEach(() => {
  global.__posted = [];
  useSheetStore.setState({ content: null, header: null, footer: null });
});

describe('мост: сообщение context', () => {
  test('виды и состояние — только известное, в одном виде', () => {
    expect(CONTEXT_KINDS).toEqual(['image', 'table', 'chart', 'drawing', 'pdfpage', 'pdflayer']);
    const p = (m) => parseMessage(JSON.stringify({ type: 'context', ...m }));
    expect(p({ kind: 'image', state: { align: 'right', widthPct: 48.6, hasCaption: 1, alt: 'Кот', extra: 1 } }))
      .toEqual({ type: 'context', kind: 'image', state: { align: 'right', widthPct: 48.6, hasCaption: true, caption: '', alt: 'Кот' } });
    // Незнакомое выравнивание — по центру; ширина — в пределах 0–100.
    expect(p({ kind: 'image', state: { align: 'diagonal', widthPct: 140 } }).state).toEqual({ align: 'center', widthPct: 100, hasCaption: false, caption: '', alt: '' });
    // Обтекание с десктопа приходит как есть.
    expect(p({ kind: 'image', state: { align: 'wrap-right' } }).state.align).toBe('wrap-right');
    expect(p({ kind: 'image', state: {} }).state.widthPct).toBeNull();
    expect(p({ kind: 'table', state: { canMerge: true, headerRow: 0 } }).state).toEqual({ canMerge: true, canSplit: false, headerRow: false });
    expect(p({ kind: 'chart', state: { x: 1 } }).state).toEqual({});
    expect(p({ kind: 'drawing' }).state).toEqual({});
    expect(p({ kind: 'pdfpage', state: { tool: 'replace', hasLines: true } }).state).toEqual({ tool: 'replace', hasLines: true });
    expect(p({ kind: 'pdfpage', state: { tool: 'lasso' } }).state).toEqual({ tool: null, hasLines: false });
    expect(p({ kind: 'pdflayer', state: { type: 'text', color: 'red', size: '14', bold: 1 } }).state).toEqual({ type: 'text', color: 'red', size: 14, bold: true, sizes: null });
    expect(p({ kind: 'pdflayer', state: { type: 'rect', sizes: [1, '2', 'x', -1, 4] } }).state.sizes).toEqual([1, 2, 4]);
    expect(p({ kind: 'pdflayer', state: { type: 'image', color: null, size: null, sizes: [] } }).state).toEqual({ type: 'image', color: null, size: null, bold: false, sizes: [] });
    // Выделение ушло — и незнакомый вид тоже не выделение.
    expect(p({ kind: null })).toEqual({ type: 'context', kind: null, state: null });
    expect(p({ kind: 'video', state: { a: 1 } })).toEqual({ type: 'context', kind: null, state: null });
    expect(IMAGE_ALIGNS).toEqual(['left', 'center', 'right', 'full']);
    expect(PDF_PAGE_TOOLS).toEqual(['text', 'image', 'rect', 'arrow', 'highlight', 'whiteout', 'replace']);
  });

  test('одно и то же выделение не перерисовывает панель', () => {
    const a = cx('image', { align: 'left', widthPct: 50 });
    expect(sameContext(a, cx('image', { align: 'left', widthPct: 50 }))).toBe(true);
    expect(sameContext(a, cx('image', { align: 'right', widthPct: 50 }))).toBe(false);
    expect(sameContext(a, cx('table', {}))).toBe(false);
    expect(sameContext(null, null)).toBe(true);
    expect(sameContext(a, null)).toBe(false);
  });
});

describe('панель выделенного: строка по виду', () => {
  test('картинка: «назад», выравнивание, ширина, выше, ниже, подпись, описание, заменить, скачать, удалить; пера нет', async () => {
    const q = await bar({ context: cx('image', { align: 'center', widthPct: 50 }) });
    expect(CONTEXT_ROWS.image).toEqual(['imageAlign', 'imageWidth', 'blockUp', 'blockDown', 'imageCaption', 'imageAlt', 'imageReplace', 'imageDownload', 'deleteBlock']);
    expect(buttons(q, 'cx-image')).toEqual(['tb-deselect', ...ids(CONTEXT_ROWS.image)]);
    expect(q.queryByTestId('tb-pen-mode')).toBeNull();
    expect(q.queryByTestId('tb-row-main')).toBeNull();
    // Выравнивание и ширина видны прямо на кнопках.
    within(q.getByTestId('tb-imageAlign')).getByText(t('ru', 'editor.cx_align_center'));
    within(q.getByTestId('tb-imageWidth')).getByText('50 %');
  });

  test('«назад» — значок chevron-left, подпись «Назад»; снимает выделение через actions.deselect', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('table', {}) });
    expect(iconOf(q, 'tb-deselect')).toBe('chevron-left');
    expect(q.getByTestId('tb-deselect').props.accessibilityLabel).toBe(t('ru', 'common.back'));
    expect(t('ru', 'common.back')).toBe('Назад');
    await fireEvent.press(q.getByTestId('tb-deselect'));
    expect(a.deselect).toHaveBeenCalledTimes(1);
    expect(a.exec).not.toHaveBeenCalled();
  });

  test('выравнивание: подстрока из четырёх, выбранное подсвечено по state.align, выбор — imageAlign и назад', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('image', { align: 'left' }) });
    await fireEvent.press(q.getByTestId('tb-imageAlign'));
    expect(buttons(q, 'imageAlign')).toEqual(['tb-back', ...IMAGE_ALIGNS.map((x) => `tb-imageAlign-${x}`)]);
    expect(IMAGE_ALIGNS.map((x) => selected(q, `tb-imageAlign-${x}`))).toEqual([true, false, false, false]);
    await fireEvent.press(q.getByTestId('tb-imageAlign-full'));
    expect(a.exec).toHaveBeenLastCalledWith('imageAlign', 'full');
    q.getByTestId('tb-row-cx-image');
    // «назад» подстроки — к строке картинки, выделение не снимает.
    await fireEvent.press(q.getByTestId('tb-imageAlign'));
    await fireEvent.press(q.getByTestId('tb-back'));
    q.getByTestId('tb-row-cx-image');
    expect(a.deselect).not.toHaveBeenCalled();
  });

  test('обтекание с десктопа — на кнопке ближайшая сторона, в подстроке ничего не подсвечено', async () => {
    const q = await bar({ context: cx('image', { align: 'wrap-left' }) });
    within(q.getByTestId('tb-imageAlign')).getByText(t('ru', 'editor.cx_align_left'));
    await fireEvent.press(q.getByTestId('tb-imageAlign'));
    expect(IMAGE_ALIGNS.some((x) => selected(q, `tb-imageAlign-${x}`))).toBe(false);
  });

  test('ширина — 25 / 50 / 75 / 100 % одним касанием; ближайшая к state.widthPct подсвечена', async () => {
    expect(IMAGE_WIDTHS).toEqual([25, 50, 75, 100]);
    const a = actions();
    const q = await bar({ actions: a, context: cx('image', { align: 'center', widthPct: 74.6 }) });
    await fireEvent.press(q.getByTestId('tb-imageWidth'));
    expect(buttons(q, 'imageWidth')).toEqual(['tb-back', ...IMAGE_WIDTHS.map((n) => `tb-imageWidth-${n}`)]);
    expect(IMAGE_WIDTHS.map((n) => selected(q, `tb-imageWidth-${n}`))).toEqual([false, false, true, false]);
    await fireEvent.press(q.getByTestId('tb-imageWidth-25'));
    expect(a.exec).toHaveBeenLastCalledWith('imageWidth', 25);
    q.getByTestId('tb-row-cx-image');
    // Во всю ширину без своей ширины — это 100 %.
    const full = await bar({ context: cx('image', { align: 'full' }) });
    await fireEvent.press(full.getByTestId('tb-imageWidth'));
    expect(selected(full, 'tb-imageWidth-100')).toBe(true);
  });

  test('выше, ниже, заменить, скачать, удалить — свои команды; подпись и описание — листом, подсвечены, если есть', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('image', { hasCaption: true, alt: 'Кот' }) });
    expect(selected(q, 'tb-imageCaption')).toBe(true);
    expect(selected(q, 'tb-imageAlt')).toBe(true);
    await fireEvent.press(q.getByTestId('tb-blockUp'));
    await fireEvent.press(q.getByTestId('tb-blockDown'));
    await fireEvent.press(q.getByTestId('tb-imageReplace'));
    await fireEvent.press(q.getByTestId('tb-imageDownload'));
    await fireEvent.press(q.getByTestId('tb-deleteBlock'));
    expect(a.exec.mock.calls).toEqual([['blockUp', undefined], ['blockDown', undefined], ['imageReplace', undefined], ['imageDownload', undefined], ['deleteBlock', undefined]]);
    within(q.getByTestId('tb-blockUp')).getByText(t('ru', 'editor.cx_up'));
    expect(q.getByTestId('tb-blockDown').props.accessibilityLabel).toBe(t('ru', 'editor.cx_move_down'));
    // Подпись и описание спрашивает лист хозяина (useEditorSession: ImageTextSheet),
    // с нынешним текстом; текста подписи протокол не шлёт — только «есть».
    await fireEvent.press(q.getByTestId('tb-imageCaption'));
    expect(a.imageCaption).toHaveBeenCalledWith('', true);
    await fireEvent.press(q.getByTestId('tb-imageAlt'));
    expect(a.imageAlt).toHaveBeenCalledWith('Кот');
    const bare = await bar({ context: cx('image', {}) });
    expect(selected(bare, 'tb-imageCaption')).toBe(false);
    expect(selected(bare, 'tb-imageAlt')).toBe(false);
    expect(iconOf(q, 'tb-imageDownload')).toBe('download');
    expect(iconOf(q, 'tb-deleteBlock')).toBe('trash');
    expect(q.getByTestId('tb-deleteBlock').props.accessibilityLabel).toBe(t('ru', 'editor.cx_image_delete'));
  });

  test('таблица: строка, столбец, удалить их, объединить или разделить, заголовки, график, удалить таблицу', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('table', { canMerge: true, headerRow: true }) });
    expect(buttons(q, 'cx-table')).toEqual(['tb-deselect', ...ids(CONTEXT_ROWS.table)]);
    expect(selected(q, 'tb-tableHeaderRow')).toBe(true);
    expect(disabled(q, 'tb-tableMerge')).toBe(false);
    for (const k of CONTEXT_ROWS.table) await fireEvent.press(q.getByTestId(`tb-${k}`));
    expect(a.exec.mock.calls.map(([n]) => n)).toEqual(CONTEXT_ROWS.table);
    expect(iconOf(q, 'tb-tableChart')).toBe('chart-bars');
    expect(q.getByTestId('tb-deleteBlock').props.accessibilityLabel).toBe(t('ru', 'editor.tb_table_delete'));
    // Подписи — знак и слово: «+ Строка», «− Столбец».
    expect(iconOf(q, 'tb-tableRowAdd')).toBe('plus');
    within(q.getByTestId('tb-tableRowAdd')).getByText(t('ru', 'editor.cx_row'));
    expect(iconOf(q, 'tb-tableColDelete')).toBe('minus');
    within(q.getByTestId('tb-tableColDelete')).getByText(t('ru', 'editor.cx_col'));
    expect(q.getByTestId('tb-tableColDelete').props.accessibilityLabel).toBe(t('ru', 'editor.tb_col_delete'));
  });

  test('таблица: объединять нечего — «Объединить» гаснет; есть что разделить — на её месте «Разделить»', async () => {
    const a = actions();
    const none = await bar({ actions: a, context: cx('table', {}) });
    expect(disabled(none, 'tb-tableMerge')).toBe(true);
    expect(none.queryByTestId('tb-tableSplit')).toBeNull();
    expect(selected(none, 'tb-tableHeaderRow')).toBe(false);
    await fireEvent.press(none.getByTestId('tb-tableMerge'));
    expect(a.exec).not.toHaveBeenCalled();
    const split = await bar({ actions: a, context: cx('table', { canSplit: true }) });
    expect(split.queryByTestId('tb-tableMerge')).toBeNull();
    await fireEvent.press(split.getByTestId('tb-tableSplit'));
    expect(a.exec).toHaveBeenLastCalledWith('tableSplit', undefined);
    expect(contextKeys(cx('table', { canSplit: true }))).toContain('tableSplit');
  });

  test('график и рисунок: изменить и удалить', async () => {
    const a = actions();
    const c = await bar({ actions: a, context: cx('chart', {}) });
    expect(buttons(c, 'cx-chart')).toEqual(['tb-deselect', 'tb-chartEdit', 'tb-deleteBlock']);
    await fireEvent.press(c.getByTestId('tb-chartEdit'));
    expect(a.exec).toHaveBeenLastCalledWith('chartEdit', undefined);
    expect(c.getByTestId('tb-deleteBlock').props.accessibilityLabel).toBe(t('ru', 'editor.cx_chart_delete'));
    const d = await bar({ actions: a, context: cx('drawing', {}) });
    expect(buttons(d, 'cx-drawing')).toEqual(['tb-deselect', 'tb-drawingEdit', 'tb-deleteBlock']);
    await fireEvent.press(d.getByTestId('tb-drawingEdit'));
    expect(a.exec).toHaveBeenLastCalledWith('drawingEdit', undefined);
    await fireEvent.press(d.getByTestId('tb-deleteBlock'));
    expect(a.exec).toHaveBeenLastCalledWith('deleteBlock', undefined);
  });

  test('страница PDF: семь инструментов; слои добавляются касанием, «Заменить текст» — режим: подсвечен, касание выходит', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('pdfpage', { tool: 'replace', hasLines: true }) });
    expect(buttons(q, 'cx-pdfpage')).toEqual(['tb-deselect', ...PDF_PAGE_TOOLS.map((x) => `tb-pdfTool-${x}`)]);
    expect(PDF_PAGE_TOOLS.filter((x) => selected(q, `tb-pdfTool-${x}`))).toEqual(['replace']);
    // Слой — разовое добавление: два касания — два слоя.
    await fireEvent.press(q.getByTestId('tb-pdfTool-arrow'));
    await fireEvent.press(q.getByTestId('tb-pdfTool-arrow'));
    expect(a.exec.mock.calls).toEqual([['pdfTool', 'arrow'], ['pdfTool', 'arrow']]);
    await fireEvent.press(q.getByTestId('tb-pdfTool-replace'));
    expect(a.exec).toHaveBeenLastCalledWith('pdfTool', null);
    const off = await bar({ actions: a, context: cx('pdfpage', { tool: null, hasLines: true }) });
    await fireEvent.press(off.getByTestId('tb-pdfTool-replace'));
    expect(a.exec).toHaveBeenLastCalledWith('pdfTool', 'replace');
    expect(iconOf(q, 'tb-pdfTool-image')).toBe('image');
    expect(iconOf(q, 'tb-pdfTool-arrow')).toBe('arrow-up-right');
    expect(iconOf(q, 'tb-pdfTool-highlight')).toBe('pen-line');
    expect(iconOf(q, 'tb-pdfTool-whiteout')).toBe('eraser');
  });

  test('страница PDF без строк текста — «Заменить текст» недоступно', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('pdfpage', { tool: null, hasLines: false }) });
    expect(disabled(q, 'tb-pdfTool-replace')).toBe(true);
    expect(PDF_PAGE_TOOLS.some((x) => selected(q, `tb-pdfTool-${x}`))).toBe(false);
    await fireEvent.press(q.getByTestId('tb-pdfTool-replace'));
    expect(a.exec).not.toHaveBeenCalled();
  });

  test('слой PDF, текст: цвет, размер, жирный, вперёд, назад, удалить', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('pdflayer', { type: 'text', color: 'red', size: 14, bold: true }) });
    expect(buttons(q, 'cx-pdflayer')).toEqual(['tb-deselect', ...ids(CONTEXT_ROWS.pdflayer)]);
    expect(selected(q, 'tb-pdfLayerBold')).toBe(true);
    within(q.getByTestId('tb-pdfLayerSize')).getByText('14 pt');
    for (const k of ['pdfLayerBold', 'pdfLayerFront', 'pdfLayerBack', 'pdfLayerDelete']) await fireEvent.press(q.getByTestId(`tb-${k}`));
    expect(a.exec.mock.calls.map(([n]) => n)).toEqual(['pdfLayerBold', 'pdfLayerFront', 'pdfLayerBack', 'pdfLayerDelete']);
    expect(['tb-pdfLayerBold', 'tb-pdfLayerFront', 'tb-pdfLayerBack', 'tb-pdfLayerDelete'].map((id) => iconOf(q, id)))
      .toEqual(['text-bold', 'arrow-up', 'arrow-down', 'trash']);
    // Цвет — тот же выбор, что у пера: «как текст» и девять оттенков.
    await fireEvent.press(q.getByTestId('tb-pdfLayerColor'));
    expect(buttons(q, 'pdfColor')).toEqual(['tb-back', ...INK_COLORS.map((c) => `tb-pdfColor-${c}`)]);
    expect(selected(q, 'tb-pdfColor-red')).toBe(true);
    await fireEvent.press(q.getByTestId('tb-pdfColor-blue'));
    expect(a.exec).toHaveBeenLastCalledWith('pdfLayerColor', 'blue');
    q.getByTestId('tb-row-cx-pdflayer');
    // Размер шрифта — ступени острова веба, pt.
    await fireEvent.press(q.getByTestId('tb-pdfLayerSize'));
    expect(buttons(q, 'pdfSize')).toEqual(['tb-back', ...PDF_FONT_SIZES.map((z) => `tb-pdfSize-${z}`)]);
    expect(selected(q, 'tb-pdfSize-14')).toBe(true);
    await fireEvent.press(q.getByTestId('tb-pdfSize-24'));
    expect(a.exec).toHaveBeenLastCalledWith('pdfLayerSize', 24);
    q.getByTestId('tb-row-cx-pdflayer');
  });

  test('слой PDF: у картинки и замазки нет цвета и размера, у маркера — заливки, у рамки — толщина линии', async () => {
    for (const type of ['image', 'whiteout']) {
      const q = await bar({ context: cx('pdflayer', { type, color: null, size: null, sizes: [] }) });
      expect(buttons(q, 'cx-pdflayer')).toEqual(['tb-deselect', 'tb-pdfLayerFront', 'tb-pdfLayerBack', 'tb-pdfLayerDelete']);
      await q.unmount();
    }
    const hl = await bar({ context: cx('pdflayer', { type: 'highlight', color: 'yellow', size: null, sizes: [] }) });
    expect(buttons(hl, 'cx-pdflayer')).toEqual(['tb-deselect', 'tb-pdfLayerColor', 'tb-pdfLayerFront', 'tb-pdfLayerBack', 'tb-pdfLayerDelete']);
    await fireEvent.press(hl.getByTestId('tb-pdfLayerColor'));
    expect(buttons(hl, 'pdfColor')).toEqual(['tb-back', ...HUES.map((c) => `tb-pdfColor-${c}`)]);
    const a = actions();
    const rect = await bar({ actions: a, context: cx('pdflayer', { type: 'rect', color: 'ink', size: 2 }) });
    expect(buttons(rect, 'cx-pdflayer')).toEqual(['tb-deselect', 'tb-pdfLayerColor', 'tb-pdfLayerSize', 'tb-pdfLayerFront', 'tb-pdfLayerBack', 'tb-pdfLayerDelete']);
    await fireEvent.press(rect.getByTestId('tb-pdfLayerSize'));
    expect(buttons(rect, 'pdfSize')).toEqual(['tb-back', ...PDF_STROKES.map((z) => `tb-pdfSize-${z}`)]);
    expect(selected(rect, 'tb-pdfSize-2')).toBe(true);
    await fireEvent.press(rect.getByTestId('tb-pdfSize-8'));
    expect(a.exec).toHaveBeenLastCalledWith('pdfLayerSize', 8);
    // Ступени прислал редактор (state.sizes) — берутся его.
    const own = await bar({ context: cx('pdflayer', { type: 'text', size: 11, sizes: [9, 11, 13] }) });
    await fireEvent.press(own.getByTestId('tb-pdfLayerSize'));
    expect(buttons(own, 'pdfSize')).toEqual(['tb-back', 'tb-pdfSize-9', 'tb-pdfSize-11', 'tb-pdfSize-13']);
    expect(selected(own, 'tb-pdfSize-11')).toBe(true);
  });

  test('выделение сменилось при открытой подстроке — сразу строка нового, без кадра старой', async () => {
    const a = actions();
    const q = await bar({ actions: a, context: cx('image', {}) });
    await fireEvent.press(q.getByTestId('tb-imageAlign'));
    q.getByTestId('tb-row-imageAlign');
    await q.rerender(<EditorToolbar lang="ru" format={fmt()} actions={a} docked={false} context={cx('table', {})} />);
    q.getByTestId('tb-row-cx-table');
    expect(q.queryByTestId('tb-row-imageAlign')).toBeNull();
    // Выделение ушло — обычная строка и «Перо».
    await q.rerender(<EditorToolbar lang="ru" format={fmt()} actions={a} docked={false} context={null} />);
    q.getByTestId('tb-row-main');
    q.getByTestId('tb-pen-mode');
  });

  test('кнопки строк выделенного — 44 под палец и не забирают фокус; значки — из словаря', async () => {
    const kinds = [
      cx('image', {}), cx('table', { canMerge: true }), cx('chart', {}), cx('drawing', {}),
      cx('pdfpage', { hasLines: true }), cx('pdflayer', { type: 'text' }),
    ];
    for (const c of kinds) {
      const q = await bar({ context: c });
      for (const n of q.getAllByRole('button')) {
        expect(n.props.focusable).toBe(false);
        expect(StyleSheet.flatten(n.props.style)).toMatchObject({ minWidth: 44, height: 44 });
      }
      await q.unmount();
    }
  });

  test('строка выделенного — в том же острове, что и обычная: тот же вид, листается внутри него', async () => {
    // 19 октября 2026: панель — парящий остров; картинка, таблица, график,
    // рисунок и PDF своих панелей не заводят — меняется только строка.
    const look = (q) => ({ island: StyleSheet.flatten(q.getByTestId('editor-toolbar').props.style), clip: StyleSheet.flatten(q.getByTestId('editor-toolbar-clip').props.style) });
    const plain = await bar();
    const base = look(plain);
    expect(base.island.borderRadius).toBe(radius.lg);
    expect(base.clip.overflow).toBe('hidden');
    await plain.unmount();
    for (const kind of Object.keys(CONTEXT_ROWS)) {
      const q = await bar({ context: cx(kind, kind === 'pdflayer' ? { type: 'text' } : {}) });
      expect(look(q)).toEqual(base);
      within(q.getByTestId('editor-toolbar-clip')).getByTestId(`tb-row-cx-${kind}`);
      await q.unmount();
    }
  });

  test('подписи панели выделенного — на четырёх языках', () => {
    const keys = Object.keys(T.ru).filter((k) => k.startsWith('editor.cx_'));
    expect(keys.length).toBeGreaterThan(30);
    for (const lang of ['en', 'uk', 'kk']) {
      expect(Object.keys(T[lang]).filter((k) => k.startsWith('editor.cx_')).sort()).toEqual([...keys].sort());
    }
    for (const lang of ['ru', 'en', 'uk', 'kk']) for (const k of keys) expect(t(lang, k).trim()).not.toBe('');
    expect(t('en', 'editor.cx_align_full')).toBe('Full width');
  });
});

// --- на экране ---------------------------------------------------------------------

const NOTES = DocCore.writeNotes({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Текст' }] }] }, comments: [], ink: [] });
const container = (text) => ({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, comments: [], ink: [] });
const say = (m) => act(async () => { global.__web.onMessage({ nativeEvent: { url: EDITOR_BASE_URL, data: JSON.stringify(m) } }); });
const posted = (type) => global.__posted.filter((m) => m.type === type);
const lastPosted = (type) => posted(type).pop();
const nav = () => ({
  navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), getState: () => ({ routes: [], index: 0 }),
  addListener: jest.fn(() => () => {}),
});
const keyboard = (shown) => act(async () => {
  DeviceEventEmitter.emit(shown ? 'keyboardWillShow' : 'keyboardWillHide', { endCoordinates: { height: shown ? 300 : 0, screenY: shown ? 544 : 844, width: 390, screenX: 0 } });
});
const translateY = (node) => (StyleSheet.flatten(node.props.style).transform || []).find((x) => 'translateY' in x).translateY;
const task = () => render(<><TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
const docScreen = () => render(<><EditorScreen navigation={nav()} route={{ params: { id: 'd1' } }} /><BottomSheet /></>);
const IMAGE = { type: 'context', kind: 'image', state: { align: 'center', widthPct: 60, hasCaption: false, alt: 'Кот' } };

describe('на странице задачи', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 1000, currency: 'RUB', editor: {} },
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
      statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
      versions: [],
      tags: [],
      documents: [{ id: 'd1', projectId: null, title: 'Бриф', pinnedAt: null, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z', body: container('Бриф') }],
      tasks: [{
        id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], notes: NOTES,
        sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null,
      }],
      activeTimer: null,
    });
  });
  afterEach(async () => { await keyboard(false); });

  test('выделили картинку без клавиатуры — панель картинки над свёрнутым шитом, шит на месте', async () => {
    const q = await task();
    const sheetY = translateY(q.getByTestId('task-sheet'));
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
    await say(IMAGE);
    q.getByTestId('tb-row-cx-image');
    // Свёрнутый шит в тестах — 130 (без системной панели): остров над ним,
    // с воздухом — тем же, что над клавиатурой.
    expect(translateY(q.getByTestId('editor-toolbar-dock'))).toBe(-(130 + TOOLBAR_GAP));
    expect(translateY(q.getByTestId('task-sheet'))).toBe(sheetY);
    // Шит отрисован после панели — над ней по порядку, а она выше его верха.
    const root = q.toJSON();
    const flat = JSON.stringify(root);
    expect(flat.indexOf('"editor-toolbar-dock"')).toBeLessThan(flat.indexOf('"task-sheet"'));
  });

  test('поле заметок и низ страницы — до панели над шитом, пока выделение есть', async () => {
    const q = await task();
    const height = () => StyleSheet.flatten(q.getByTestId('doc-editor').props.style).height;
    await act(async () => { q.getByTestId('task-scroll').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } }); });
    await act(async () => { q.getByTestId('task-notes').props.onLayout({ nativeEvent: { layout: { x: 10, y: 120, width: 370, height: 96 } } }); });
    expect(height()).toBe(700 - 120 - 130);
    await say(IMAGE);
    // Поле — до верха острова: остров и воздух под ним (TOOLBAR_SPACE).
    expect(height()).toBe(700 - 120 - 130 - TOOLBAR_SPACE);
    expect(StyleSheet.flatten(q.getByTestId('task-scroll').props.contentContainerStyle).paddingBottom).toBe(130 + TOOLBAR_SPACE);
    await say({ type: 'context', kind: null });
    expect(height()).toBe(700 - 120 - 130);
    expect(notesFloor({ contextOn: true, sheetH: 130 })).toBe(130 + TOOLBAR_SPACE);
    // Клавиатура и перо — главнее: панель над клавиатурой или над системной панелью.
    expect(notesFloor({ contextOn: true, kbHeight: 300, sheetH: 130 })).toBe(300 + TOOLBAR_SPACE);
    expect(notesFloor({ contextOn: true, inkOn: true, sheetH: 130, insetBottom: 20 })).toBe(20 + TOOLBAR_SPACE);
    expect(notesMinHeight({ viewH: 700, top: 120, contextOn: true, sheetH: 130 })).toBe(700 - 120 - 130 - TOOLBAR_SPACE);
  });

  test('«назад» шлёт exec deselect, и панель уходит сразу — обычная строка над шитом не мелькает', async () => {
    const q = await task();
    await say(IMAGE);
    await fireEvent.press(q.getByTestId('tb-deselect'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'deselect' });
    // Без таймеров: задержка 300 мс была бы здесь видна.
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
    // Подтверждение редактора ничего не возвращает.
    await say({ type: 'context', kind: null });
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
  });

  test('выделение сняли в тексте (context null) — панель уходит; новое — приходит снова', async () => {
    const q = await task();
    await say(IMAGE);
    await say({ type: 'context', kind: null });
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
    await say({ type: 'context', kind: 'chart', state: {} });
    q.getByTestId('tb-row-cx-chart');
    await fireEvent.press(q.getByTestId('tb-chartEdit'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'chartEdit' });
  });

  test('пишут в ячейке таблицы — над клавиатурой её строка; ушли из таблицы — обычная строка', async () => {
    const q = await task();
    await say({ type: 'format', state: { focused: true, canUndo: true, inTable: true } });
    await keyboard(true);
    await say({ type: 'context', kind: 'table', state: { canMerge: false, canSplit: true, headerRow: true } });
    q.getByTestId('tb-row-cx-table');
    await fireEvent.press(q.getByTestId('tb-tableRowAdd'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'tableRowAdd' });
    await say({ type: 'context', kind: null });
    q.getByTestId('tb-row-main');
    q.getByTestId('tb-pen-mode');
  });

  test('удалить — блок уходит, и панель вместе с ним, не дожидаясь ответа', async () => {
    const q = await task();
    await say(IMAGE);
    await fireEvent.press(q.getByTestId('tb-deleteBlock'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'deleteBlock' });
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
  });

  test('«Описание» — лист с нынешним описанием; сохранить — exec imageAlt с текстом', async () => {
    const q = await task();
    await say(IMAGE);
    await fireEvent.press(q.getByTestId('tb-imageAlt'));
    const input = q.getByTestId('image-text-input');
    expect(input.props.value).toBe('Кот');
    await fireEvent.changeText(input, '  Рыжий кот на окне ');
    await fireEvent.press(q.getByTestId('image-text-save'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'imageAlt', arg: 'Рыжий кот на окне' });
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('«Подпись» — лист; подписи не было — пустое поле, сохранить — exec imageCaption с текстом', async () => {
    const q = await task();
    await say(IMAGE);
    await fireEvent.press(q.getByTestId('tb-imageCaption'));
    expect(q.getByTestId('image-text-input').props.value).toBe('');
    await fireEvent.changeText(q.getByTestId('image-text-input'), 'Схема');
    await fireEvent.press(q.getByTestId('image-text-save'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'imageCaption', arg: 'Схема' });
  });

  test('подпись есть, но текста её редактор не прислал — пустое «Сохранить» её не стирает', async () => {
    const q = await task();
    await say({ ...IMAGE, state: { ...IMAGE.state, hasCaption: true } });
    global.__posted = [];
    await fireEvent.press(q.getByTestId('tb-imageCaption'));
    await fireEvent.press(q.getByTestId('image-text-save'));
    expect(posted('exec')).toEqual([]);
    expect(useSheetStore.getState().content).toBeNull();
    // Прислал — лист открывается с ней.
    await say({ ...IMAGE, state: { ...IMAGE.state, hasCaption: true, caption: 'Старая' } });
    await fireEvent.press(q.getByTestId('tb-imageCaption'));
    expect(q.getByTestId('image-text-input').props.value).toBe('Старая');
  });

  test('выделили блок — фокус из текста уходит (blur), клавиатура не мешает; таблица — нет, в ней пишут', async () => {
    await task();
    await say(IMAGE);
    expect(posted('blur')).toEqual([{ type: 'blur' }]);
    // Та же картинка, другое состояние (ширина) — второго blur нет.
    await say({ ...IMAGE, state: { ...IMAGE.state, widthPct: 40 } });
    expect(posted('blur')).toHaveLength(1);
    await say({ type: 'context', kind: 'table', state: {} });
    expect(posted('blur')).toHaveLength(1);
    for (const kind of ['chart', 'drawing', 'pdfpage', 'pdflayer']) await say({ type: 'context', kind, state: {} });
    expect(posted('blur')).toHaveLength(5);
  });

  test('тянут значок масштаба (gesture) — страница не прокручивается, отпустили — снова', async () => {
    const q = await task();
    await say(IMAGE);
    expect(q.getByTestId('task-scroll').props.scrollEnabled).toBe(true);
    await say({ type: 'gesture', on: true });
    expect(q.getByTestId('task-scroll').props.scrollEnabled).toBe(false);
    q.getByTestId('tb-row-cx-image');
    await say({ type: 'gesture', on: false });
    expect(q.getByTestId('task-scroll').props.scrollEnabled).toBe(true);
  });

  test('страница редактора перезагрузилась — выделения нет и панели тоже', async () => {
    const q = await task();
    await say(IMAGE);
    await say({ type: 'ready' });
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
  });

  test('клавиатура без высоты (плавающая, строка над физической): шит ушёл — панель у низа экрана, не в воздухе', async () => {
    // Эмулятор, 18 октября 2026: со строкой над физической клавиатурой шит
    // уходил вниз, а панель таблицы стояла на высоте шита над пустым местом.
    const q = await task();
    await say({ type: 'format', state: { focused: true } });
    await say({ type: 'context', kind: 'table', state: {} });
    expect(translateY(q.getByTestId('editor-toolbar-dock'))).toBe(-(130 + TOOLBAR_GAP));
    // Библиотека клавиатуры: открыта, высота 0, ход окончен — шит внизу.
    KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 1;
    await act(async () => {
      KeyboardLib.KeyboardEvents.addListener.mock.calls
        .filter(([event]) => event === 'keyboardDidShow')
        .forEach(([, fn]) => fn({ height: 0 }));
    });
    q.getByTestId('tb-row-cx-table');
    expect(translateY(q.getByTestId('editor-toolbar-dock'))).toBe(-TOOLBAR_GAP);
    KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 0;
    await act(async () => {
      KeyboardLib.KeyboardEvents.addListener.mock.calls
        .filter(([event]) => event === 'keyboardDidHide')
        .forEach(([, fn]) => fn({ height: 0 }));
    });
    // Клавиатура ушла, шит вернулся — панель снова на нём.
    expect(translateY(q.getByTestId('editor-toolbar-dock'))).toBe(-(130 + TOOLBAR_GAP));
  });

  test('слой PDF: «назад» не гасит панель — следом приходит строка страницы', async () => {
    const q = await task();
    await say({ type: 'context', kind: 'pdflayer', state: { type: 'text', color: 'ink', size: 12, bold: false } });
    await fireEvent.press(q.getByTestId('tb-deselect'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'deselect' });
    q.getByTestId('tb-row-cx-pdflayer');
    await say({ type: 'context', kind: 'pdfpage', state: { tool: null, hasLines: true } });
    q.getByTestId('tb-row-cx-pdfpage');
  });
});

describe('жест: прокрутка гаснет сразу', () => {
  // Эмулятор, 18 октября 2026: через состояние экрана прокрутка гасла на
  // 85–190 мс позже касания, и тяга значка масштаба с вертикальной частью
  // обрывалась (ScrollView перехватывал палец, WebView — touchcancel).
  // Экран получает жест сразу (opts.onGesture) и гасит прокрутку свойством.
  test('onGesture — по разу на включение и выключение, autoscroll его не повторяет', async () => {
    const { renderHook } = require('@testing-library/react-native');
    const { useEditorSession } = require('../src/hooks/useEditorSession');
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', editor: {} }, tasks: [], documents: [] });
    const onGesture = jest.fn();
    const { result } = await renderHook(() => useEditorSession('task', 'none', { onGesture }));
    await act(async () => { result.current.editorProps.onGesture({ on: true }); });
    await act(async () => { result.current.editorProps.onAutoscroll({ dy: 10 }); });
    await act(async () => { result.current.editorProps.onGesture({ on: true }); });
    expect(onGesture.mock.calls).toEqual([[true]]);
    expect(result.current.gesture).toBe(true);
    await act(async () => { result.current.editorProps.onGesture({ on: false }); });
    expect(onGesture.mock.calls).toEqual([[true], [false]]);
    expect(result.current.gesture).toBe(false);
  });
});

describe('в редакторе документа', () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', editor: {} },
      projects: [],
      documents: [{ id: 'd1', projectId: null, title: 'Бриф', pinnedAt: null, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z', body: container('Бриф') }],
    });
  });

  test('выделенное держит панель и без клавиатуры — внизу экрана, шита там нет', async () => {
    const q = await docScreen();
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
    await say({ type: 'context', kind: 'drawing', state: {} });
    q.getByTestId('tb-row-cx-drawing');
    expect(translateY(q.getByTestId('editor-toolbar-dock'))).toBe(-TOOLBAR_GAP);
    await fireEvent.press(q.getByTestId('tb-drawingEdit'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'drawingEdit' });
  });

  test('«Скачать» картинку: файл от редактора байтами — лист «Поделиться» с его именем', async () => {
    await docScreen();
    await say({ type: 'export', kind: 'image', name: 'кот.png', mime: 'image/png', base64: 'data:image/png;base64,QUJD' });
    expect(shareBase64File).toHaveBeenLastCalledWith('кот.png', 'image/png', 'QUJD', 'ru', expect.any(Function));
  });
});

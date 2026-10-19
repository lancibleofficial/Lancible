// Нативная панель редактора текста (12 октября 2026): одна строка над
// клавиатурой и едет вместе с ней. Высота 48, кнопки 44×44 — под палец, как
// у Apple Notes и Bear. С 19 октября 2026 — парящий остров: от краёв экрана
// боковое поле страницы (screenPadding), скругление острова (radius.lg),
// своя поверхность и тень плавающего (floating, floatingShadow — как у
// плашки идущей задачи), от опоры — клавиатуры, свёрнутого шита, системной
// панели — воздух TOOLBAR_GAP. Строка листается внутри острова и режется
// его скруглением. Частое — в один тап, группы раскрываются на месте
// строки, а не меню: «Aa» → начертания, «H» → вид абзаца, «⋯» → редкое.
// Списки — тремя кнопками прямо в строке: маркированный, «1.» (нумерованный,
// буквами, как «Aa» и «H») и чек-лист. Пока курсор в списке, следом за
// чек-листом встают два слова — «Вложить» и «Вынести» (вложенность на экранной
// клавиатуре иначе не сделать: в ней нет Tab); вне списка их нет. Справа
// отдельно и всегда видна кнопка «Перо»: она меняет строку на инструменты
// пера. См. DESIGN.md, «Редактор на телефоне».
//
// Выделенное (протокол 4, 18 октября 2026): картинка, таблица, график,
// рисунок, страница или слой PDF — плавающих островов в странице нет, их
// действия встают сюда же. Редактор шлёт context { kind, state }; пока он
// есть, строка — инструменты этого вида, слева «назад» (снять выделение:
// exec deselect), «Перо» не рисуется. Панель тогда видна и без клавиатуры:
// внизу, над свёрнутым шитом с таймером (floor — его высота). Подстроки
// (выравнивание и ширина картинки, цвет и размер слоя) раскрываются на
// месте, как «Aa» и «H». Ширина картинки — 25 / 50 / 75 / 100 %: одно
// касание до нужной, а не до девяти шагов по 10; точно — тягой значка в
// углу картинки.
//
// Панель ничего не знает про WebView: нажатия уходят в actions (экран берёт
// их из hooks/useEditorSession.js, а тот — в мост lib/editorBridge.js), а
// подсветка включённого — из format, который присылает редактор.
//
// Фокус остаётся в тексте: кнопки не фокусируемые (focusable={false}), строка
// пропускает касания к ним, не трогая клавиатуру (keyboardShouldPersistTaps).
import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Tap from './Tap';
import Icon from './Icon';
import Text from './AppText';
import { KEYBOARD_NATIVE, useReanimatedKeyboardAnimation } from '../lib/keyboard';
import { useKeyboardState } from '../hooks/useKeyboardState';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { EMPTY_FORMAT, IMAGE_ALIGNS, PDF_PAGE_TOOLS } from '../lib/editorBridge';
import { useColors, useThemeMode, editorSwatches, floatingShadow, radius, spacing, screenPadding, fontSize, displayFamily, fontFamily } from '../theme';
import { t } from '../lib/i18n';

export const TOOLBAR_HEIGHT = 48;
export const TOOLBAR_BUTTON = 44;
/** Воздух между островом панели и тем, на чём он стоит: верхом клавиатуры,
 *  свёрнутого шита с таймером или системной панели внизу (19 октября 2026). */
export const TOOLBAR_GAP = spacing.sm;
/** Сколько места панель занимает над своей опорой: остров и воздух под ним.
 *  Столько же держат под собой поле заметок (TaskDetailScreen: notesFloor),
 *  курсор над клавиатурой (caretShift) и документ на весь экран
 *  (useEditorInset): последняя строка текста не уходит под остров. */
export const TOOLBAR_SPACE = TOOLBAR_HEIGHT + TOOLBAR_GAP;

/** Главная строка (13 октября 2026): все три списка — своими кнопками подряд,
 *  нумерованный — «1.» буквами; групп списков нет. */
export const MAIN_ROW = ['undo', 'format', 'block', 'bullet', 'ordered', 'checklist', 'link', 'photo', 'table', 'more'];
/** Вложенность списка (13 октября 2026, третий круг): словами, без значков.
 *  Встают в главную строку сразу после чек-листа, только пока курсор в списке
 *  (format.list). Редактор о глубине пункта не сообщает, поэтому «Вынести»
 *  не гаснет на первом уровне — команда уходит как есть. */
export const LIST_TOOLS = ['nest', 'unnest'];
/** Группы, раскрывающиеся на месте строки; «назад» встаёт первым. «PDF»
 *  (17 октября 2026) — в «⋯» рядом с графиком: вставка редкая, как на вебе
 *  (там — меню «Вставить»); файл выбирает телефон (протокол 3, pdf-pick).
 *  «Экспорт» открывает лист выбора: Markdown или PDF. */
export const GROUP_ROWS = {
  format: ['bold', 'italic', 'underline', 'strike', 'highlight', 'color'],
  block: ['paragraph', 'h1', 'h2', 'h3', 'quote', 'codeblock'],
  more: ['redo', 'chart', 'pdf', 'comment', 'find', 'export'],
};
/** Строка пера. */
export const INK_ROW = ['pen', 'marker', 'eraser', 'inkColor', 'inkSize', 'inkUndo', 'inkDone'];
/** Инструменты таблицы — в «⋯», пока курсор в таблице. */
export const TABLE_OPS = ['rowBelow', 'colRight', 'rowDel', 'colDel', 'tableDel'];
export const HUES = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
export const INK_COLORS = ['ink', ...HUES];
export const INK_SIZES = [1, 2, 3, 5, 8, 12, 20];
/** Строки выделенного (context, протокол 4): ключи кнопок по виду. Имена —
 *  команды exec протокола; слияние ячеек — одна кнопка: «Объединить», а
 *  когда объединять нечего, но есть что разделить, — «Разделить». */
export const CONTEXT_ROWS = {
  image: ['imageAlign', 'imageWidth', 'blockUp', 'blockDown', 'imageCaption', 'imageAlt', 'imageReplace', 'imageDownload', 'deleteBlock'],
  table: ['tableRowAdd', 'tableColAdd', 'tableRowDelete', 'tableColDelete', 'tableMerge', 'tableHeaderRow', 'tableChart', 'deleteBlock'],
  chart: ['chartEdit', 'deleteBlock'],
  drawing: ['drawingEdit', 'deleteBlock'],
  pdfpage: PDF_PAGE_TOOLS.map((tool) => `pdfTool-${tool}`),
  pdflayer: ['pdfLayerColor', 'pdfLayerSize', 'pdfLayerBold', 'pdfLayerFront', 'pdfLayerBack', 'pdfLayerDelete'],
};
/** Ширина картинки, % колонки. */
export const IMAGE_WIDTHS = [25, 50, 75, 100];
/** Размер шрифта текстового слоя PDF, pt (как в меню острова на вебе). */
export const PDF_FONT_SIZES = [8, 10, 12, 14, 18, 24, 32, 48];
/** Толщина линии прямоугольника и стрелки, pt. */
export const PDF_STROKES = [1, 2, 4, 8];

/** Кнопки строки выделенного по его состоянию: у слоя PDF цвет, размер и
 *  жирный — только там, где они что-то меняют (как на острове веба). */
export function contextKeys(context) {
  if (!context || !CONTEXT_ROWS[context.kind]) return [];
  const s = context.state || {};
  if (context.kind === 'table') return CONTEXT_ROWS.table.map((k) => (k === 'tableMerge' && !s.canMerge && s.canSplit ? 'tableSplit' : k));
  if (context.kind === 'pdflayer') {
    return CONTEXT_ROWS.pdflayer.filter((k) => (
      (k !== 'pdfLayerColor' || !['image', 'whiteout'].includes(s.type))
      && (k !== 'pdfLayerSize' || (s.sizes ? s.sizes.length > 0 : ['text', 'rect', 'arrow'].includes(s.type)))
      && (k !== 'pdfLayerBold' || s.type === 'text')
    ));
  }
  return CONTEXT_ROWS[context.kind];
}

const PARENT = {
  format: 'main', block: 'main', more: 'main', color: 'format', highlight: 'format', inkColor: 'ink', inkSize: 'ink',
  imageAlign: 'cx-image', imageWidth: 'cx-image', pdfColor: 'cx-pdflayer', pdfSize: 'cx-pdflayer',
};
/** Корень группы: главная, перо или строка выделенного. */
const rootOf = (g) => {
  let r = g;
  while (PARENT[r]) r = PARENT[r];
  return r;
};

/** Сколько панель ждёт, прежде чем уйти: клавиатура, сменившая раскладку
 *  или ушедшая в эмодзи, на миг закрывается и открывается снова — панель
 *  при этом не мигает (Android). */
export const TOOLBAR_HIDE_DELAY = 300;

/** Видна ли панель: сразу, как стала нужна, и с задержкой, когда перестала.
 *  instant — уйти без задержки: панель держало одно выделение, клавиатуры
 *  не было, мигать ей незачем (hooks/useEditorSession.js). */
export function useToolbarVisible(want, instant = false) {
  const [visible, setVisible] = useState(want);
  useEffect(() => {
    if (want) { setVisible(true); return undefined; }
    if (instant) { setVisible(false); return undefined; }
    const id = setTimeout(() => setVisible(false), TOOLBAR_HIDE_DELAY);
    return () => clearTimeout(id);
  }, [want, instant]);
  return visible;
}

/** Высота клавиатуры для стилей в потоке интерфейса: кадры — из
 *  react-native-keyboard-controller (lib/keyboard.js); без нативной части —
 *  по событиям клавиатуры, своим ходом. Читать в worklet: liftOf(k). */
function useKeyboardLift() {
  const kb = useKeyboardState();
  const frames = useReanimatedKeyboardAnimation();
  const reduced = useReduceMotion();
  const fallback = useSharedValue(kb.shown ? kb.height : 0);
  // Свой ход (без кадров клавиатуры) при «Уменьшении движения» — сразу на
  // место; с кадрами панель едет так же, как сама клавиатура.
  useEffect(() => {
    if (KEYBOARD_NATIVE) return;
    const to = kb.shown ? kb.height : 0;
    fallback.value = reduced ? to : withTiming(to, { duration: 220 });
  }, [kb.shown, kb.height, reduced]);
  return { frames, fallback };
}
function liftOf(k) {
  'worklet';
  return KEYBOARD_NATIVE ? -k.frames.height.value : k.fallback.value;
}

/** Положение панели: над клавиатурой, а без неё (перо) — над системной
 *  панелью внизу экрана; между островом и опорой — воздух TOOLBAR_GAP.
 *  Клавиатура закрывается — панель едет вниз вместе с ней и на странице
 *  задачи уходит под шит с таймером целиком (TOOLBAR_SPACE ниже верха
 *  свёрнутого шита): шит выше её по
 *  порядку отрисовки (TaskDetailScreen), панель его не закрывает ни на кадр.
 *  floor — ниже чего панель не опускается (от низа окна), число или общее
 *  значение Reanimated: пока выделена картинка или таблица, страница задачи
 *  отдаёт сюда верх своего свёрнутого шита кадр за кадром — панель едет с
 *  клавиатурой вниз, а возвращающийся шит поднимает её на себе. Шит ушёл
 *  (клавиатура без высоты — плавающая или строка над физической) — верх
 *  нулевой, и панель у низа экрана, а не в воздухе над пустым местом. */
function useDockStyle(floor) {
  const insets = useSafeAreaInsets();
  const k = useKeyboardLift();
  const zone = insets.bottom;
  const shared = floor && typeof floor === 'object' ? floor : null;
  const fixed = shared ? 0 : floor || 0;
  return useAnimatedStyle(
    () => ({ transform: [{ translateY: -(Math.max(liftOf(k), zone, fixed, shared ? shared.value : 0) + TOOLBAR_GAP) }] }),
    [zone, fixed, shared],
  );
}

/** Отступ снизу для области редактора на весь экран: текст не уходит ни под
 *  клавиатуру, ни под панель над ней (остров и воздух под ним,
 *  TOOLBAR_SPACE) — WebView ужимается, и курсор страница держит в поле
 *  зрения сама. */
export function useEditorInset(barVisible) {
  const insets = useSafeAreaInsets();
  const k = useKeyboardLift();
  const zone = insets.bottom;
  return useAnimatedStyle(() => {
    const lift = liftOf(k);
    return { paddingBottom: barVisible ? Math.max(lift, zone) + TOOLBAR_SPACE : lift };
  }, [barVisible, zone]);
}

/**
 * @param {object} props
 *  lang; format — состояние под курсором (lib/editorBridge.js: normalizeFormat);
 *  inkOn — режим пера; ink — { tool, color, size } пера;
 *  context — выделенное { kind, state } (lib/editorBridge.js:
 *    normalizeContext) или null;
 *  actions — { exec(name, arg), link(), image(), exportDoc(), ink(on),
 *    inkTool(tool), inkColor(color), inkSize(size), deselect(), imageAlt(alt),
 *    imageCaption(caption, has) };
 *  visible — панель на экране; docked (по умолчанию) — над клавиатурой;
 *  floor — ниже скольких точек от низа окна панель не встаёт (число или
 *    общее значение Reanimated).
 */
export default function EditorToolbar({
  lang, format = EMPTY_FORMAT, inkOn = false, ink, context = null, actions, visible = true, docked = true, floor = 0,
}) {
  const colors = useColors();
  const mode = useThemeMode();
  const swatches = editorSwatches(mode);
  const styles = makeStyles(colors);
  const dockStyle = useDockStyle(floor);
  const cx = context && CONTEXT_ROWS[context.kind] ? context : null;
  const root = inkOn ? 'ink' : cx ? `cx-${cx.kind}` : 'main';
  const [picked, setGroup] = useState(root);
  // Группа другого корня (выделение сменилось, перо включили) — уже не
  // показывается, даже на тот кадр, пока эффект ниже не вернул строку.
  const group = rootOf(picked) === root ? picked : root;
  const scrollRef = useRef(null);
  const pen = { tool: 'pen', color: 'ink', size: 3, ...(ink || {}) };
  const cs = (cx && cx.state) || {};
  // Обтекание с десктопа — ближайшей стороной.
  const align = { 'wrap-left': 'left', 'wrap-right': 'right' }[cs.align] || cs.align || 'center';

  // Перо включили или выключили — строка с начала своего ряда.
  useEffect(() => { setGroup(root); }, [root]);
  // Панель вернулась — с главной строки, а не с группы, открытой в прошлый раз.
  useEffect(() => { if (visible) setGroup(root); }, [visible]);
  useEffect(() => { if (scrollRef.current && scrollRef.current.scrollTo) scrollRef.current.scrollTo({ x: 0, animated: false }); }, [group]);

  if (!visible) return null;

  const L = (key) => t(lang, key);
  const exec = (name, arg) => actions && actions.exec && actions.exec(name, arg);
  const back = () => setGroup(PARENT[group] || root);
  const open = (g) => () => setGroup(g);
  const then = (fn, to) => () => { fn(); if (to) setGroup(to); };
  const f = format || EMPTY_FORMAT;
  const blockLabel = /^h[1-6]$/.test(f.block) ? f.block.toUpperCase() : 'H';
  const hl = f.highlight ? swatches.highlights[f.highlight] : swatches.highlights.yellow;
  const tc = f.textColor ? swatches.hues[f.textColor] : colors.text;

  /** Кнопки: key — для теста, a11y — подпись для чтения с экрана, и одно из
   *  icon / label / view — что нарисовано. */
  const B = {
    back: { a11y: L('common.back'), icon: 'chevron-left', run: back },
    undo: { a11y: L('editor.tb_undo'), icon: 'undo', disabled: !f.canUndo, run: () => exec('undo') },
    redo: { a11y: L('editor.tb_redo'), icon: 'redo', disabled: !f.canRedo, run: then(() => exec('redo'), 'main') },
    format: { a11y: L('editor.tb_format'), label: 'Aa', on: f.strong || f.em || f.underline || f.strike || !!f.highlight || !!f.textColor, run: open('format') },
    block: { a11y: L('editor.tb_block'), label: blockLabel, on: f.block !== 'paragraph' || f.quote, run: open('block') },
    bullet: { a11y: L('editor.tb_bullet'), icon: 'list-bullet', on: f.list === 'bullet_list', run: () => exec('bullet') },
    // «1.» — буквами, как «Aa» и «H»: значок нумерованного списка не читался.
    ordered: { a11y: L('editor.tb_ordered'), label: '1.', on: f.list === 'ordered_list', run: () => exec('ordered') },
    checklist: { a11y: L('editor.tb_checklist'), icon: 'checklist', on: f.list === 'task_list', run: () => exec('tasks') },
    // Вложенность — словами, в стиле «Aa», «H» и «1.»; вне списка строкой не рисуется.
    nest: { a11y: L('editor.tb_nest'), label: L('editor.tb_nest'), run: () => exec('indent') },
    unnest: { a11y: L('editor.tb_unnest'), label: L('editor.tb_unnest'), run: () => exec('outdent') },
    link: { a11y: L('editor.tb_link'), icon: 'link', on: !!f.link, run: () => actions && actions.link && actions.link() },
    photo: { a11y: L('editor.tb_photo'), icon: 'image', run: () => actions && actions.image && actions.image() },
    table: { a11y: L('editor.tb_table'), icon: 'table', on: f.inTable, run: () => exec('table') },
    more: { a11y: L('editor.tb_more'), icon: 'kebab', run: open('more') },
    // «Aa»
    bold: { a11y: L('editor.tb_bold'), icon: 'text-bold', on: f.strong, run: () => exec('bold') },
    italic: { a11y: L('editor.tb_italic'), icon: 'text-italic', on: f.em, run: () => exec('italic') },
    underline: { a11y: L('editor.tb_underline'), icon: 'text-underline', on: f.underline, run: () => exec('underline') },
    strike: { a11y: L('editor.tb_strike'), icon: 'text-strike', on: f.strike, run: () => exec('strike') },
    // Маркер — значок маркера на заливке выбранного цвета.
    highlight: {
      a11y: L('editor.tb_highlight'), on: !!f.highlight, run: open('highlight'),
      view: (tint) => <View style={[styles.hlBox, { backgroundColor: hl }]}><Icon name="pen-line" size={16} color={tint} /></View>,
    },
    color: {
      a11y: L('editor.tb_color'), on: !!f.textColor, run: open('color'),
      view: () => <View style={styles.colorBox}><Text style={[styles.letter, { color: tc }]}>A</Text><View style={[styles.colorBar, { backgroundColor: tc }]} /></View>,
    },
    // «H»
    paragraph: { a11y: L('editor.tb_text'), label: L('editor.tb_text'), small: true, on: f.block === 'paragraph' && !f.quote, run: then(() => exec('paragraph'), 'main') },
    h1: { a11y: L('editor.tb_h1'), label: 'H1', on: f.block === 'h1', run: then(() => exec('heading', 1), 'main') },
    h2: { a11y: L('editor.tb_h2'), label: 'H2', on: f.block === 'h2', run: then(() => exec('heading', 2), 'main') },
    h3: { a11y: L('editor.tb_h3'), label: 'H3', on: f.block === 'h3', run: then(() => exec('heading', 3), 'main') },
    quote: { a11y: L('editor.tb_quote'), icon: 'quote', on: f.quote, run: then(() => exec('quote'), 'main') },
    codeblock: { a11y: L('editor.tb_code'), icon: 'code-block', on: f.block === 'code_block', run: then(() => exec('codeblock'), 'main') },
    // «⋯»
    chart: { a11y: L('editor.tb_chart'), icon: 'chart-bars', run: then(() => exec('chart'), 'main') },
    pdf: { a11y: L('editor.tb_pdf'), icon: 'doc', run: then(() => exec('pdf'), 'main') },
    comment: { a11y: L('editor.tb_comment'), icon: 'comment', run: then(() => exec('comment'), 'main') },
    find: { a11y: L('editor.tb_find'), icon: 'search', run: then(() => exec('find'), 'main') },
    export: { a11y: L('editor.tb_export'), icon: 'download', run: then(() => actions && actions.exportDoc && actions.exportDoc(), 'main') },
    rowBelow: { a11y: L('editor.tb_row_below'), label: L('editor.tb_row_below'), small: true, run: () => exec('rowBelow') },
    colRight: { a11y: L('editor.tb_col_right'), label: L('editor.tb_col_right'), small: true, run: () => exec('colRight') },
    rowDel: { a11y: L('editor.tb_row_delete'), label: L('editor.tb_row_delete'), small: true, run: () => exec('rowDel') },
    colDel: { a11y: L('editor.tb_col_delete'), label: L('editor.tb_col_delete'), small: true, run: () => exec('colDel') },
    tableDel: { a11y: L('editor.tb_table_delete'), label: L('editor.tb_table_delete'), small: true, danger: true, run: then(() => exec('tableDel'), 'main') },
    // перо
    pen: { a11y: L('editor.ink_pen'), icon: 'pen', on: pen.tool === 'pen', run: () => actions && actions.inkTool && actions.inkTool('pen') },
    marker: { a11y: L('editor.ink_marker'), icon: 'pen-line', on: pen.tool === 'marker', run: () => actions && actions.inkTool && actions.inkTool('marker') },
    eraser: { a11y: L('editor.ink_eraser'), icon: 'eraser', on: pen.tool === 'eraser', run: () => actions && actions.inkTool && actions.inkTool('eraser') },
    inkColor: {
      a11y: L('editor.ink_color'), run: open('inkColor'),
      view: () => <View style={[styles.swatch, { backgroundColor: swatches.hues[pen.color] || pen.color }]} />,
    },
    inkSize: {
      a11y: L('editor.ink_size'), run: open('inkSize'),
      view: (tint) => <View style={[styles.sizeDot, sizeDot(pen.size), { backgroundColor: tint }]} />,
    },
    inkUndo: { a11y: L('editor.tb_undo'), icon: 'undo', run: () => exec('inkUndo') },
    inkDone: { a11y: L('common.done'), icon: 'check', run: () => actions && actions.ink && actions.ink(false) },
    // выделенное: «назад» снимает выделение
    deselect: { a11y: L('common.back'), icon: 'chevron-left', run: () => actions && actions.deselect && actions.deselect() },
    deleteBlock: { a11y: L(DELETE_LABEL[cx ? cx.kind : ''] || 'common.delete'), icon: 'trash', danger: true, run: () => exec('deleteBlock') },
    // картинка
    imageAlign: {
      a11y: `${L('editor.cx_align')}: ${L(`editor.cx_align_${align}`)}`,
      label: L(`editor.cx_align_${align}`), small: true, run: open('imageAlign'),
    },
    imageWidth: {
      a11y: L('editor.cx_width'), small: true, run: open('imageWidth'),
      label: cs.widthPct != null ? `${Math.round(cs.widthPct)} %` : L('editor.cx_width'),
    },
    // Выше и ниже — блок с картинкой на место соседа (острова больше нет).
    blockUp: { a11y: L('editor.cx_move_up'), label: L('editor.cx_up'), small: true, run: () => exec('blockUp') },
    blockDown: { a11y: L('editor.cx_move_down'), label: L('editor.cx_down'), small: true, run: () => exec('blockDown') },
    imageCaption: {
      a11y: L('editor.cx_caption'), label: L('editor.cx_caption'), small: true, on: !!cs.hasCaption,
      run: () => actions && actions.imageCaption && actions.imageCaption(cs.caption || '', !!cs.hasCaption),
    },
    imageAlt: { a11y: L('editor.cx_alt_title'), label: L('editor.cx_alt'), small: true, on: !!cs.alt, run: () => actions && actions.imageAlt && actions.imageAlt(cs.alt || '') },
    imageReplace: { a11y: L('editor.cx_replace'), label: L('editor.cx_replace'), small: true, run: () => exec('imageReplace') },
    imageDownload: { a11y: L('editor.cx_download'), icon: 'download', run: () => exec('imageDownload') },
    // таблица: «+ строка», «+ столбец», «− строка», «− столбец» — знак и слово
    tableRowAdd: { a11y: L('editor.cx_row_add'), wide: true, run: () => exec('tableRowAdd'), view: (tint) => signed('plus', L('editor.cx_row'), tint) },
    tableColAdd: { a11y: L('editor.cx_col_add'), wide: true, run: () => exec('tableColAdd'), view: (tint) => signed('plus', L('editor.cx_col'), tint) },
    tableRowDelete: { a11y: L('editor.tb_row_delete'), wide: true, run: () => exec('tableRowDelete'), view: (tint) => signed('minus', L('editor.cx_row'), tint) },
    tableColDelete: { a11y: L('editor.tb_col_delete'), wide: true, run: () => exec('tableColDelete'), view: (tint) => signed('minus', L('editor.cx_col'), tint) },
    tableMerge: { a11y: L('editor.cx_merge'), label: L('editor.cx_merge'), small: true, disabled: !cs.canMerge, run: () => exec('tableMerge') },
    tableSplit: { a11y: L('editor.cx_split'), label: L('editor.cx_split'), small: true, run: () => exec('tableSplit') },
    tableHeaderRow: { a11y: L('editor.cx_header_row'), label: L('editor.cx_header'), small: true, on: !!cs.headerRow, run: () => exec('tableHeaderRow') },
    tableChart: { a11y: L('editor.cx_table_chart'), icon: 'chart-bars', run: () => exec('tableChart') },
    // график и рисунок
    chartEdit: { a11y: L('editor.cx_chart_edit'), label: L('editor.cx_edit'), small: true, run: () => exec('chartEdit') },
    drawingEdit: { a11y: L('editor.cx_drawing_edit'), label: L('editor.cx_edit'), small: true, run: () => exec('drawingEdit') },
    // слой PDF
    pdfLayerColor: {
      a11y: L('editor.ink_color'), run: open('pdfColor'),
      view: () => <View style={[styles.swatch, { backgroundColor: layerFill(cs.color) }]} />,
    },
    pdfLayerSize: cs.type === 'text'
      ? { a11y: L('editor.cx_size'), label: `${cs.size || 12} pt`, small: true, run: open('pdfSize') }
      : { a11y: L('editor.cx_size'), run: open('pdfSize'), view: (tint) => <View style={[styles.sizeDot, sizeDot(2 * (cs.size || 2)), { backgroundColor: tint }]} /> },
    pdfLayerBold: { a11y: L('editor.tb_bold'), icon: 'text-bold', on: !!cs.bold, run: () => exec('pdfLayerBold') },
    pdfLayerFront: { a11y: L('editor.cx_front'), icon: 'arrow-up', run: () => exec('pdfLayerFront') },
    pdfLayerBack: { a11y: L('editor.cx_to_back'), icon: 'arrow-down', run: () => exec('pdfLayerBack') },
    pdfLayerDelete: { a11y: L('editor.cx_layer_delete'), icon: 'trash', danger: true, run: () => exec('pdfLayerDelete') },
  };
  // Страница PDF: выбранный инструмент подсвечен, его касание снимает выбор;
  // «Заменить текст» — только если на странице есть строки.
  const tool = (key, extra) => ({ on: cs.tool === key, run: () => exec('pdfTool', cs.tool === key ? null : key), ...extra });
  Object.assign(B, {
    'pdfTool-text': tool('text', { a11y: L('editor.cx_pdf_text'), label: L('editor.cx_pdf_text'), small: true }),
    'pdfTool-image': tool('image', { a11y: L('editor.cx_pdf_image'), icon: 'image' }),
    'pdfTool-rect': tool('rect', { a11y: L('editor.cx_pdf_rect'), label: L('editor.cx_pdf_rect'), small: true }),
    'pdfTool-arrow': tool('arrow', { a11y: L('editor.cx_pdf_arrow'), icon: 'arrow-up-right' }),
    'pdfTool-highlight': tool('highlight', { a11y: L('editor.cx_pdf_highlight'), icon: 'pen-line' }),
    'pdfTool-whiteout': tool('whiteout', { a11y: L('editor.cx_pdf_whiteout'), icon: 'eraser' }),
    'pdfTool-replace': tool('replace', { a11y: L('editor.cx_pdf_replace'), label: L('editor.cx_pdf_replace'), small: true, disabled: !cs.hasLines }),
  });

  /** Знак и слово в одной кнопке: «+ Строка», «− Столбец». */
  function signed(icon, word, tint) {
    return (
      <View style={styles.signed}>
        {icon === 'plus' ? <Icon name="plus" size={14} color={tint} /> : <Icon name="minus" size={14} color={tint} />}
        <Text style={[styles.labelSmall, { color: tint }]} numberOfLines={1}>{word}</Text>
      </View>
    );
  }
  /** Заливка кружка цвета слоя: маркер — светлыми заливками, остальное —
   *  цветами текста; ink — цвет текста. */
  function layerFill(c) {
    if (cs.type === 'highlight') return swatches.highlights[c] || swatches.highlights.yellow;
    return swatches.hues[c] || swatches.hues.ink;
  }

  // Цвет текста и маркер: «без цвета» и девять оттенков; выбор — назад в «Aa».
  const colorRow = (kind) => {
    const cur = kind === 'color' ? f.textColor : f.highlight;
    const fill = kind === 'color' ? swatches.hues : swatches.highlights;
    const pick = (c) => then(() => exec(kind, c), 'format');
    return [
      { key: `${kind}-none`, a11y: L('editor.color_none'), on: !cur, run: pick(null), view: () => <View style={[styles.swatch, styles.swatchNone]}><Icon name="x" size={10} color={colors.textDim} /></View> },
      ...HUES.map((c) => ({ key: `${kind}-${c}`, a11y: L(`editor.color_${c}`), on: cur === c, run: pick(c), view: () => <View style={[styles.swatch, { backgroundColor: fill[c] }]} /> })),
    ];
  };

  let items;
  if (group === 'main') {
    // В списке «Вложить · Вынести» встают сразу за «1.», до чеклиста: на узком
    // экране они иначе уезжали за правый край и резались до «Вло».
    const keys = f.list ? MAIN_ROW.flatMap((k) => (k === 'ordered' ? [k, ...LIST_TOOLS] : [k])) : MAIN_ROW;
    items = keys.map((k) => ({ key: k, ...B[k] }));
  }
  else if (group === 'ink') items = INK_ROW.map((k) => ({ key: k, ...B[k] }));
  else if (group === 'color' || group === 'highlight') items = [{ key: 'back', ...B.back }, ...colorRow(group)];
  else if (group === 'inkColor') {
    items = [{ key: 'back', ...B.back }, ...INK_COLORS.map((c) => ({
      key: `inkColor-${c}`, a11y: L(`editor.color_${c}`), on: pen.color === c, run: then(() => actions && actions.inkColor && actions.inkColor(c), 'ink'),
      view: () => <View style={[styles.swatch, { backgroundColor: swatches.hues[c] }]} />,
    }))];
  } else if (group === 'inkSize') {
    items = [{ key: 'back', ...B.back }, ...INK_SIZES.map((z) => ({
      key: `inkSize-${z}`, a11y: `${L('editor.ink_size')} ${z}`, on: pen.size === z, run: then(() => actions && actions.inkSize && actions.inkSize(z), 'ink'),
      view: (tint) => <View style={[styles.sizeDot, sizeDot(z), { backgroundColor: tint }]} />,
    }))];
  } else if (group.startsWith('cx-')) {
    items = [{ key: 'deselect', ...B.deselect }, ...contextKeys(cx).map((k) => ({ key: k, ...B[k] }))];
  } else if (group === 'imageAlign') {
    items = [{ key: 'back', ...B.back }, ...IMAGE_ALIGNS.map((a) => ({
      key: `imageAlign-${a}`, a11y: L(`editor.cx_align_${a}`), label: L(`editor.cx_align_${a}`), small: true,
      on: (cs.align || 'center') === a, run: then(() => exec('imageAlign', a), 'cx-image'),
    }))];
  } else if (group === 'imageWidth') {
    const w = cs.widthPct != null ? Math.round(cs.widthPct) : (cs.align === 'full' ? 100 : null);
    items = [{ key: 'back', ...B.back }, ...IMAGE_WIDTHS.map((n) => ({
      key: `imageWidth-${n}`, a11y: `${L('editor.cx_width')} ${n} %`, label: `${n} %`, small: true,
      on: w === n, run: then(() => exec('imageWidth', n), 'cx-image'),
    }))];
  } else if (group === 'pdfColor') {
    const hues = cs.type === 'highlight' ? HUES : INK_COLORS;
    items = [{ key: 'back', ...B.back }, ...hues.map((c) => ({
      key: `pdfColor-${c}`, a11y: L(`editor.color_${c}`), on: cs.color === c, run: then(() => exec('pdfLayerColor', c), 'cx-pdflayer'),
      view: () => <View style={[styles.swatch, { backgroundColor: layerFill(c) }]} />,
    }))];
  } else if (group === 'pdfSize') {
    const text = cs.type === 'text';
    // Ступени — те, что прислал редактор (sizes), иначе свои такие же.
    const steps = cs.sizes && cs.sizes.length ? cs.sizes : (text ? PDF_FONT_SIZES : PDF_STROKES);
    items = [{ key: 'back', ...B.back }, ...steps.map((z) => ({
      key: `pdfSize-${z}`, a11y: `${L('editor.cx_size')} ${z} pt`, on: cs.size === z, run: then(() => exec('pdfLayerSize', z), 'cx-pdflayer'),
      ...(text ? { label: `${z}`, small: true } : { view: (tint) => <View style={[styles.sizeDot, sizeDot(2 * z), { backgroundColor: tint }]} /> }),
    }))];
  } else {
    const keys = group === 'more' && f.inTable ? ['redo', ...TABLE_OPS, ...GROUP_ROWS.more.slice(1)] : GROUP_ROWS[group];
    items = [{ key: 'back', ...B.back }, ...keys.map((k) => ({ key: k, ...B[k] }))];
  }

  const button = (it) => {
    const tint = it.on ? colors.accentInk : it.danger ? colors.danger : colors.text;
    return (
      <Tap
        key={it.key}
        scale={0.9}
        focusable={false}
        disabled={!!it.disabled}
        onPress={it.run}
        accessibilityRole="button"
        accessibilityLabel={it.a11y}
        accessibilityState={{ selected: !!it.on, disabled: !!it.disabled }}
        testID={`tb-${it.key}`}
        style={[styles.btn, (it.wide || (it.label && it.label.length > 2)) && styles.btnWide, it.on && styles.btnOn, it.disabled && styles.btnOff]}
      >
        {it.view ? it.view(tint)
          : it.icon ? <Icon name={it.icon} size={20} color={tint} />
            : <Text style={[it.small ? styles.labelSmall : styles.label, { color: tint }]} numberOfLines={1}>{it.label}</Text>}
      </Tap>
    );
  };

  // Остров — два слоя: внешний несёт поверхность и тень, внутренний режет
  // строку по скруглению (на одном слое overflow: hidden срезал бы и тень).
  // Главная строка, группы, перо и выделенное — в одном и том же острове.
  const bar = (
    <View style={styles.bar} testID="editor-toolbar" accessibilityRole="toolbar" accessibilityLabel={L('editor.toolbar')}>
      <View style={styles.clip} testID="editor-toolbar-clip">
        <ScrollView
          ref={scrollRef}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          style={styles.scroll}
          testID={`tb-row-${group}`}
        >
          {items.map(button)}
        </ScrollView>
        {/* Перо — всегда на месте, даже когда раскрыта группа; у выделенного
            строка целиком его инструменты — пера нет. */}
        {rootOf(group).startsWith('cx-') ? null : (
          <>
            <View style={styles.sep} />
            <Tap
              scale={0.94}
              focusable={false}
              onPress={() => actions && actions.ink && actions.ink(!inkOn)}
              accessibilityRole="button"
              accessibilityLabel={L('editor.pen')}
              accessibilityState={{ selected: inkOn }}
              testID="tb-pen-mode"
              style={[styles.penBtn, inkOn && styles.btnOn]}
            >
              <Icon name="pen-round" size={18} color={inkOn ? colors.accentInk : colors.text} />
              <Text style={[styles.penLabel, { color: inkOn ? colors.accentInk : colors.text }]}>{L('editor.pen')}</Text>
            </Tap>
          </>
        )}
      </View>
    </View>
  );

  if (!docked) return bar;
  return <Reanimated.View style={[styles.dock, dockStyle]} pointerEvents="box-none" testID="editor-toolbar-dock">{bar}</Reanimated.View>;
}

/** Подпись «удалить» у строки выделенного — по виду блока. */
const DELETE_LABEL = {
  image: 'editor.cx_image_delete', table: 'editor.tb_table_delete', chart: 'editor.cx_chart_delete', drawing: 'editor.cx_drawing_delete',
};

/** Точка толщины: растёт с толщиной, но не шире кнопки. */
const sizeDot = (z) => {
  const d = Math.min(22, 3 + z);
  return { width: d, height: d, borderRadius: d / 2 };
};

const makeStyles = (colors) => StyleSheet.create({
  // Остров: от краёв экрана — боковое поле страницы; высоту над опорой
  // задаёт useDockStyle.
  dock: { position: 'absolute', left: screenPadding, right: screenPadding, bottom: 0 },
  // Плавающее поверх страницы: поверхность и тень — те же, что у плашки
  // идущей задачи (TimerMiniPlayer), скругление — острова; линий нет.
  bar: {
    height: TOOLBAR_HEIGHT, borderRadius: radius.lg,
    backgroundColor: colors.floating, boxShadow: floatingShadow(colors),
  },
  clip: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, overflow: 'hidden' },
  scroll: { flex: 1 },
  row: { alignItems: 'center', paddingHorizontal: spacing.xs, gap: 2 },
  btn: { minWidth: TOOLBAR_BUTTON, height: TOOLBAR_BUTTON, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnWide: { paddingHorizontal: spacing.sm },
  btnOn: { backgroundColor: colors.accentMuted },
  btnOff: { opacity: 0.35 },
  label: { fontFamily: displayFamily.bold, fontSize: 17 },
  labelSmall: { fontFamily: fontFamily.bold, fontSize: fontSize.sm },
  letter: { fontFamily: displayFamily.bold, fontSize: 16, lineHeight: 19 },
  hlBox: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  colorBox: { alignItems: 'center' },
  colorBar: { width: 16, height: 3, borderRadius: 2, marginTop: 1 },
  swatch: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swatchNone: { borderWidth: 1.5, borderColor: colors.borderStrong },
  sizeDot: {},
  signed: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sep: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border },
  penBtn: {
    height: TOOLBAR_BUTTON, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, marginHorizontal: spacing.xs, borderRadius: radius.md,
  },
  penLabel: { fontFamily: fontFamily.bold, fontSize: fontSize.sm },
});

/** Точка «сохранено» (8 px): textFaint — пишется, заливка accent —
 *  сохранено. Тихая, без подписи: на странице задачи — в конце строки тегов,
 *  у документа — рядом с названием. Кнопки «Во весь экран» с 13 октября 2026
 *  нет: заметки задачи пишутся только на её странице. */
export function SavedDot({ lang, saved, style }) {
  const colors = useColors();
  return (
    <View
      style={[dotStyles.dot, { backgroundColor: saved ? colors.accent : colors.textFaint }, style]}
      accessibilityLabel={t(lang, saved ? 'editor.saved' : 'editor.saving')}
      testID={saved ? 'editor-saved' : 'editor-saving'}
    />
  );
}

const dotStyles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
});

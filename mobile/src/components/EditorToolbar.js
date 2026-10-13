// Нативная панель редактора текста (12 октября 2026): одна строка над
// клавиатурой и едет вместе с ней. Высота 48, кнопки 44×44 — под палец, как
// у Apple Notes и Bear. Частое — в один тап, группы раскрываются на месте
// строки, а не меню: «Aa» → начертания, «H» → вид абзаца, «⋯» → редкое.
// Списки — тремя кнопками прямо в строке: маркированный, «1.» (нумерованный,
// буквами, как «Aa» и «H») и чек-лист. Пока курсор в списке, следом за
// чек-листом встают два слова — «Вложить» и «Вынести» (вложенность на экранной
// клавиатуре иначе не сделать: в ней нет Tab); вне списка их нет. Справа
// отдельно и всегда видна кнопка «Перо»: она меняет строку на инструменты
// пера. См. DESIGN.md, «Редактор на телефоне».
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
import { EMPTY_FORMAT } from '../lib/editorBridge';
import { useColors, useThemeMode, editorSwatches, radius, spacing, fontSize, displayFamily, fontFamily } from '../theme';
import { t } from '../lib/i18n';

export const TOOLBAR_HEIGHT = 48;
export const TOOLBAR_BUTTON = 44;

/** Главная строка (13 октября 2026): все три списка — своими кнопками подряд,
 *  нумерованный — «1.» буквами; групп списков нет. */
export const MAIN_ROW = ['undo', 'format', 'block', 'bullet', 'ordered', 'checklist', 'link', 'photo', 'table', 'more'];
/** Вложенность списка (13 октября 2026, третий круг): словами, без значков.
 *  Встают в главную строку сразу после чек-листа, только пока курсор в списке
 *  (format.list). Редактор о глубине пункта не сообщает, поэтому «Вынести»
 *  не гаснет на первом уровне — команда уходит как есть. */
export const LIST_TOOLS = ['nest', 'unnest'];
/** Группы, раскрывающиеся на месте строки; «назад» встаёт первым. */
export const GROUP_ROWS = {
  format: ['bold', 'italic', 'underline', 'strike', 'highlight', 'color'],
  block: ['paragraph', 'h1', 'h2', 'h3', 'quote', 'codeblock'],
  more: ['redo', 'chart', 'comment', 'find', 'export'],
};
/** Строка пера. */
export const INK_ROW = ['pen', 'marker', 'eraser', 'inkColor', 'inkSize', 'inkUndo', 'inkDone'];
/** Инструменты таблицы — в «⋯», пока курсор в таблице. */
export const TABLE_OPS = ['rowBelow', 'colRight', 'rowDel', 'colDel', 'tableDel'];
export const HUES = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
export const INK_COLORS = ['ink', ...HUES];
export const INK_SIZES = [1, 2, 3, 5, 8, 12, 20];
const PARENT = { format: 'main', block: 'main', more: 'main', color: 'format', highlight: 'format', inkColor: 'ink', inkSize: 'ink' };

/** Сколько панель ждёт, прежде чем уйти: клавиатура, сменившая раскладку
 *  или ушедшая в эмодзи, на миг закрывается и открывается снова — панель
 *  при этом не мигает (Android). */
export const TOOLBAR_HIDE_DELAY = 300;

/** Видна ли панель: сразу, как стала нужна, и с задержкой, когда перестала. */
export function useToolbarVisible(want) {
  const [visible, setVisible] = useState(want);
  useEffect(() => {
    if (want) { setVisible(true); return undefined; }
    const id = setTimeout(() => setVisible(false), TOOLBAR_HIDE_DELAY);
    return () => clearTimeout(id);
  }, [want]);
  return visible;
}

/** Высота клавиатуры для стилей в потоке интерфейса: кадры — из
 *  react-native-keyboard-controller (lib/keyboard.js); без нативной части —
 *  по событиям клавиатуры, своим ходом. Читать в worklet: liftOf(k). */
function useKeyboardLift() {
  const kb = useKeyboardState();
  const frames = useReanimatedKeyboardAnimation();
  const fallback = useSharedValue(kb.shown ? kb.height : 0);
  useEffect(() => {
    if (!KEYBOARD_NATIVE) fallback.value = withTiming(kb.shown ? kb.height : 0, { duration: 220 });
  }, [kb.shown, kb.height]);
  return { frames, fallback };
}
function liftOf(k) {
  'worklet';
  return KEYBOARD_NATIVE ? -k.frames.height.value : k.fallback.value;
}

/** Положение панели: над клавиатурой, а без неё (перо) — над системной
 *  панелью внизу экрана. Клавиатура закрывается — панель едет вниз вместе с
 *  ней и на странице задачи уходит под шит с таймером: шит выше её по
 *  порядку отрисовки (TaskDetailScreen), панель его не закрывает ни на кадр. */
function useDockStyle() {
  const insets = useSafeAreaInsets();
  const k = useKeyboardLift();
  const zone = insets.bottom;
  return useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(liftOf(k), zone) }] }), [zone]);
}

/** Отступ снизу для области редактора на весь экран: текст не уходит ни под
 *  клавиатуру, ни под панель над ней — WebView ужимается, и курсор страница
 *  держит в поле зрения сама. */
export function useEditorInset(barVisible) {
  const insets = useSafeAreaInsets();
  const k = useKeyboardLift();
  const zone = insets.bottom;
  return useAnimatedStyle(() => {
    const lift = liftOf(k);
    return { paddingBottom: barVisible ? Math.max(lift, zone) + TOOLBAR_HEIGHT : lift };
  }, [barVisible, zone]);
}

/**
 * @param {object} props
 *  lang; format — состояние под курсором (lib/editorBridge.js: normalizeFormat);
 *  inkOn — режим пера; ink — { tool, color, size } пера;
 *  actions — { exec(name, arg), link(), image(), exportDoc(), ink(on),
 *    inkTool(tool), inkColor(color), inkSize(size) };
 *  visible — панель на экране; docked (по умолчанию) — над клавиатурой.
 */
export default function EditorToolbar({ lang, format = EMPTY_FORMAT, inkOn = false, ink, actions, visible = true, docked = true }) {
  const colors = useColors();
  const mode = useThemeMode();
  const swatches = editorSwatches(mode);
  const styles = makeStyles(colors);
  const dockStyle = useDockStyle();
  const root = inkOn ? 'ink' : 'main';
  const [group, setGroup] = useState(root);
  const scrollRef = useRef(null);
  const pen = { tool: 'pen', color: 'ink', size: 3, ...(ink || {}) };

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
  };

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
        style={[styles.btn, (it.label && it.label.length > 2) && styles.btnWide, it.on && styles.btnOn, it.disabled && styles.btnOff]}
      >
        {it.view ? it.view(tint)
          : it.icon ? <Icon name={it.icon} size={20} color={tint} />
            : <Text style={[it.small ? styles.labelSmall : styles.label, { color: tint }]} numberOfLines={1}>{it.label}</Text>}
      </Tap>
    );
  };

  const bar = (
    <View style={styles.bar} testID="editor-toolbar" accessibilityRole="toolbar" accessibilityLabel={L('editor.toolbar')}>
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
      <View style={styles.sep} />
      {/* Перо — всегда на месте, даже когда раскрыта группа. */}
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
    </View>
  );

  if (!docked) return bar;
  return <Reanimated.View style={[styles.dock, dockStyle]} pointerEvents="box-none">{bar}</Reanimated.View>;
}

/** Точка толщины: растёт с толщиной, но не шире кнопки. */
const sizeDot = (z) => {
  const d = Math.min(22, 3 + z);
  return { width: d, height: d, borderRadius: d / 2 };
};

const makeStyles = (colors) => StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: {
    height: TOOLBAR_HEIGHT, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
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

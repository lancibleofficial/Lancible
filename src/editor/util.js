// Мелочи, которыми пользуются все части редактора.
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine,
  Baseline, Circle, Columns3, GripVertical, Hand, Heading1, Heading2, Heading3, Heading4, Highlighter,
  IndentDecrease, IndentIncrease, Lasso, List, ListOrdered, ListTree, MoveHorizontal, PanelTop, Pencil, Pilcrow,
  Quote, Replace, Rows3, Shapes, Slash, Square, Table, TableCellsMerge, TableCellsSplit, Type,
  PanelLeft, PanelRight, SquareSplitHorizontal,
  BetweenVerticalStart, BetweenVerticalEnd, BetweenHorizontalStart, BetweenHorizontalEnd,
  Pointer, ALargeSmall, CaseSensitive, Subscript, Superscript,
} from 'lucide';
import Icons from '../renderer/core/icons.js';

export const uid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Короткий номер — для блоков и штрихов, где UUID на каждом шаге раздувал
 *  бы данные. Восемь знаков base36 — 2,8·10¹² вариантов на документ. */
export const shortId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

/** h('div', { class: 'x', onclick }, child, 'text') — DOM без шаблонов. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// Иконки — Solar Bold из общего словаря core/icons.js, как во всём
// приложении. У Solar нет типографских знаков: заголовков, нумерованных
// списков, выравнивания, цитаты, операций с таблицей, фигур рисования, — для
// них остаются линейные lucide (ISC); в сборку попадают только названные.
const SOLAR = {
  bold: 'text-bold', italic: 'text-italic', underline: 'text-underline', strike: 'text-strike', code: 'code',
  link: 'link', unlink: 'unlink', clear: 'eraser-square', undo: 'undo', redo: 'redo',
  tasks: 'checklist', codeblock: 'code-block', callout: 'callout', hr: 'minus',
  image: 'image', imagePlus: 'image-add', chart: 'chart-bars', chartLine: 'chart-line', chartPie: 'chart-pie', chartArea: 'chart-area',
  draw: 'pen-line', pen: 'pen', annotate: 'pen-round', edit: 'pen-square', eraser: 'eraser', arrow: 'arrow-up-right',
  comment: 'comment', comments: 'comments', check: 'check', x: 'x', trash: 'trash', search: 'search',
  more: 'kebab', plus: 'plus', copy: 'copy', download: 'download', printer: 'printer',
  maximize: 'maximize', minimize: 'minimize', focus: 'target', settings: 'tuning',
  up: 'arrow-up', down: 'arrow-down', chevronDown: 'chevron-down', chevronUp: 'chevron-up', reply: 'reply',
  resolve: 'check-circle', reopen: 'restart', fill: 'paint-roller', palette: 'palette',
  info: 'info', warn: 'danger', ok: 'check-circle', idea: 'lightbulb', select: 'cursor', fullscreen: 'fullscreen',
  zoomIn: 'zoom-in', zoomOut: 'zoom-out', arrowLeft: 'arrow-left', arrowRight: 'arrow-right', eye: 'eye', eyeOff: 'eye-closed',
};
const LUCIDE = {
  highlight: Highlighter, color: Baseline, sub: Subscript, sup: Superscript,
  h1: Heading1, h2: Heading2, h3: Heading3, h4: Heading4, text: Pilcrow,
  bullet: List, ordered: ListOrdered, indent: IndentIncrease, outdent: IndentDecrease, quote: Quote,
  alignLeft: AlignLeft, alignCenter: AlignCenter, alignRight: AlignRight, alignJustify: AlignJustify,
  table: Table, pencil: Pencil, marker: Highlighter, lasso: Lasso,
  shapes: Shapes, line: Slash, rect: Square, ellipse: Circle,
  replace: Replace, outline: ListTree, grip: GripVertical, hand: Hand,
  rowAbove: ArrowUpToLine, rowBelow: ArrowDownToLine, colLeft: ArrowLeftToLine, colRight: ArrowRightToLine,
  merge: TableCellsMerge, split: TableCellsSplit, header: PanelTop, rows: Rows3, columns: Columns3, type: Type,
  wide: MoveHorizontal, wrapLeft: PanelLeft, wrapRight: PanelRight,
  unrow: SquareSplitHorizontal, colBefore: BetweenVerticalStart, colAfter: BetweenVerticalEnd,
  rowBefore: BetweenHorizontalStart, rowAfter: BetweenHorizontalEnd,
  finger: Pointer, fontSize: ALargeSmall, fontFamily: CaseSensitive,
};

export function icon(name, size) {
  const s = size || 18;
  const solar = Icons.ICONS[SOLAR[name]];
  if (solar) {
    const el = svg('svg', { class: 'led-icon', width: s, height: s, viewBox: solar.vb, fill: 'currentColor', 'aria-hidden': 'true' });
    for (const [d, evenodd] of solar.p) el.append(svg('path', evenodd ? { d, 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' } : { d }));
    return el;
  }
  const node = LUCIDE[name];
  const el = svg('svg', {
    class: 'led-icon', width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  });
  if (node) for (const [tag, attrs] of node) el.append(svg(tag, attrs));
  return el;
}

/** Кнопка панели: иконка, подсказка с сочетанием клавиш. */
export function btn(name, title, onClick, extra) {
  const b = h('button', Object.assign({
    type: 'button', class: 'led-btn', title, 'aria-label': title,
    onmousedown: (e) => e.preventDefault(), // фокус и выделение остаются в тексте
    onclick: (e) => { e.preventDefault(); onClick(e); },
  }, extra || {}), icon(name));
  return b;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|od|ad)/.test(navigator.platform || navigator.userAgent || '');

/** «Mod-b» → «⌘B» / «Ctrl+B» для подсказок. */
export function keyLabel(k) {
  if (!k) return '';
  return k.split('-').map((p) => {
    if (p === 'Mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'Shift') return isMac ? '⇧' : 'Shift';
    if (p === 'Alt') return isMac ? '⌥' : 'Alt';
    return p.length === 1 ? p.toUpperCase() : p;
  }).join(isMac ? '' : '+');
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Поставить всплывающее меню у точки и не дать ему уехать за край окна. */
export function placePopup(el, x, y, opts) {
  const o = opts || {};
  el.style.left = '0px';
  el.style.top = '0px';
  // Размер — без трансформаций: всплывашка появляется с масштабом
  // (popIn), и getBoundingClientRect в этот миг меньше настоящего — у края
  // экрана она вылезала за него на ширину этой разницы.
  const r = { width: el.offsetWidth, height: el.offsetHeight };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = o.center ? x - r.width / 2 : x;
  let top = o.above ? y - r.height - 8 : y;
  if (o.above && top < 8) top = (o.below != null ? o.below : y) + 8;
  if (top + r.height > vh - 8) top = Math.max(8, (o.flipY != null ? o.flipY : y) - r.height - 8);
  left = clamp(left, 8, Math.max(8, vw - r.width - 8));
  top = clamp(top, 8, Math.max(8, vh - r.height - 8));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

/** Закрыть по клику мимо и по Esc. Возвращает функцию снятия. */
export function dismissOnOutside(el, close, except) {
  const onDown = (e) => {
    if (el.contains(e.target)) return;
    if (except && except.some((x) => x && x.contains(e.target))) return;
    close();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

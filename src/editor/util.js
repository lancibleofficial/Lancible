// Мелочи, которыми пользуются все части редактора.
import {
  X,
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  ArrowUp, ArrowUpToLine, Baseline, Bold, ChartArea, ChartColumn, ChartLine, ChartPie,
  Check, ChevronDown, ChevronUp, Circle, CircleCheck, Code, Columns3, Copy,
  Download, Ellipsis, Eraser, Expand, Focus, GripVertical, Hand, Heading1,
  Heading2, Heading3, Heading4, Highlighter, Image, IndentDecrease, IndentIncrease, Info,
  Italic, Lasso, Lightbulb, Link, List, ListChecks, ListOrdered, ListTree,
  Maximize2, MessageSquarePlus, MessageSquareWarning, MessagesSquare, Minimize2, Minus, MousePointer2, MoveHorizontal,
  MoveUpRight, PaintBucket, Palette, PanelTop, Pen, PenTool, Pencil, Pilcrow,
  Plus, Printer, Quote, Redo2, RemoveFormatting, Replace, Reply, RotateCcw,
  Rows3, Search, Settings2, Shapes, Signature, Slash, Square, SquareCode,
  SquarePen, Strikethrough, Subscript, Superscript, Table, TableCellsMerge, TableCellsSplit, Trash2,
  TriangleAlert, Type, Underline, Undo2, Unlink, ZoomIn, ZoomOut,
} from 'lucide';

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

// Иконки — lucide (ISC). В сборку попадают только названные здесь.
const ICONS = {
  bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, code: Code,
  sub: Subscript, sup: Superscript, link: Link, unlink: Unlink, highlight: Highlighter,
  color: Baseline, clear: RemoveFormatting, undo: Undo2, redo: Redo2,
  h1: Heading1, h2: Heading2, h3: Heading3, h4: Heading4, text: Pilcrow,
  bullet: List, ordered: ListOrdered, tasks: ListChecks, indent: IndentIncrease, outdent: IndentDecrease,
  quote: Quote, codeblock: SquareCode, callout: MessageSquareWarning, hr: Minus,
  alignLeft: AlignLeft, alignCenter: AlignCenter, alignRight: AlignRight, alignJustify: AlignJustify,
  table: Table, image: Image, chart: ChartColumn, chartLine: ChartLine, chartPie: ChartPie, chartArea: ChartArea,
  draw: PenTool, pen: Pen, pencil: Pencil, marker: Highlighter, eraser: Eraser, lasso: Lasso,
  shapes: Shapes, line: Slash, arrow: MoveUpRight, rect: Square, ellipse: Circle,
  comment: MessageSquarePlus, comments: MessagesSquare, check: Check, x: X, trash: Trash2,
  search: Search, replace: Replace, outline: ListTree, more: Ellipsis, plus: Plus,
  grip: GripVertical, copy: Copy, download: Download, printer: Printer, maximize: Maximize2,
  minimize: Minimize2, focus: Focus, settings: Settings2, annotate: Signature, hand: Hand,
  up: ArrowUp, down: ArrowDown, chevronDown: ChevronDown, chevronUp: ChevronUp, reply: Reply,
  resolve: CircleCheck, reopen: RotateCcw, rowAbove: ArrowUpToLine, rowBelow: ArrowDownToLine,
  colLeft: ArrowLeftToLine, colRight: ArrowRightToLine, merge: TableCellsMerge, split: TableCellsSplit,
  header: PanelTop, fill: PaintBucket, rows: Rows3, columns: Columns3, palette: Palette,
  info: Info, warn: TriangleAlert, ok: CircleCheck, idea: Lightbulb, type: Type,
  wide: MoveHorizontal, edit: SquarePen, select: MousePointer2, fullscreen: Expand, zoomIn: ZoomIn, zoomOut: ZoomOut,
};

export function icon(name, size) {
  const node = ICONS[name];
  const s = size || 18;
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
  const r = el.getBoundingClientRect();
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

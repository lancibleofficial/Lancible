// Рисование от руки: движок штрихов, ввод с пера, панель инструментов.
//
// Им пользуются двое: блок-холст в документе (drawing.js) и слой пометок
// поверх всего текста (overlay.js). Оба хранят штрихи одинаково:
//   { id, tool, color, size, opacity, shape?, pts }
// pts — упакованная строка точек (core/doc.js: packPoints), x/y — в своей
// системе координат поверхности, третье число — нажим 0…1.
//
// Решения, которые не очевидны:
//  - «только стилус»: пальцы и ладонь не рисуют, а прокручивают. «Авто» —
//    так становится само, как только в этом сеансе коснулись пером;
//  - кнопка на пере и обратный конец (ластик у Surface Pen, Wacom) —
//    ластик на время касания, без переключения инструмента;
//  - «задержать — выпрямить»: перо замерло в конце штриха на полсекунды —
//    штрих становится прямой, прямоугольником или эллипсом;
//  - цвет — имя из палитры («ink» — цвет текста), поэтому рисунок читается
//    и на светлой теме, и на тёмной.
import getStroke from 'perfect-freehand';
import Core from '../renderer/core/doc.js';
import { h, icon, shortId, clamp } from './util.js';
import { popup, segmented, toggleSwitch, slider } from './ui.js';

const { packPoints, unpackPoints } = Core;

export const INK_COLORS = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
export const TOOLS = ['pen', 'pencil', 'marker', 'eraser', 'lasso', 'shape'];
export const SHAPES = ['line', 'arrow', 'rect', 'ellipse'];
export const BACKGROUNDS = ['plain', 'grid', 'dots', 'lines'];

export function defaultInkSettings() {
  return {
    tool: 'pen',
    color: 'ink',
    size: 3,
    shape: 'line',
    stylus: 'auto', // auto | only | any
    pressure: true,
    smoothing: 0.5,
    penButtonEraser: true,
    eraser: 'stroke', // stroke | partial
    holdToShape: true,
    bg: 'plain',
    presets: [
      { tool: 'pen', color: 'ink', size: 3 },
      { tool: 'pen', color: 'blue', size: 3 },
      { tool: 'pen', color: 'red', size: 3 },
      { tool: 'marker', color: 'yellow', size: 16 },
    ],
  };
}

export function normalizeInkSettings(s) {
  const d = defaultInkSettings();
  const o = Object.assign(d, s || {});
  if (!TOOLS.includes(o.tool)) o.tool = 'pen';
  if (!SHAPES.includes(o.shape)) o.shape = 'line';
  if (!['auto', 'only', 'any'].includes(o.stylus)) o.stylus = 'auto';
  if (!Array.isArray(o.presets) || !o.presets.length) o.presets = d.presets;
  o.size = clamp(Number(o.size) || 3, 1, 60);
  o.smoothing = clamp(Number(o.smoothing), 0, 1);
  return o;
}

// --- цвет -------------------------------------------------------------------------

const colorCache = new Map();
let colorCacheTheme = '';

/** Имя палитры → настоящий цвет по токенам текущей темы. */
export function resolveInkColor(c, el) {
  if (!c) return '#888';
  if (!INK_COLORS.includes(c) && c !== 'paper') return c;
  const theme = document.documentElement.getAttribute('data-theme') || '';
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const stamp = `${theme}|${dark}`;
  if (stamp !== colorCacheTheme) { colorCache.clear(); colorCacheTheme = stamp; }
  if (colorCache.has(c)) return colorCache.get(c);
  // «ink» — цвет текста, «paper» — фон холста, остальное — оттенки палитры.
  const token = c === 'ink' ? '--text' : c === 'paper' ? '--panel' : `--led-c-${c}`;
  const v = getComputedStyle(el || document.documentElement).getPropertyValue(token).trim() || '#888';
  colorCache.set(c, v);
  return v;
}

export function clearInkColorCache() { colorCache.clear(); colorCacheTheme = ''; }

// --- геометрия штриха -------------------------------------------------------------

const TOOL_STYLE = {
  pen: { thinning: 0.55, opacity: 1, smoothing: 0.5, streamline: 0.45 },
  pencil: { thinning: 0.75, opacity: 0.82, smoothing: 0.35, streamline: 0.3 },
  marker: { thinning: 0, opacity: 0.38, smoothing: 0.6, streamline: 0.6, flat: true },
};

function outlinePath(points) {
  if (!points.length) return '';
  const d = [`M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    d.push(`Q${x0.toFixed(2)},${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)},${((y0 + y1) / 2).toFixed(2)}`);
  }
  d.push('Z');
  return d.join('');
}

/** Штрих → Path2D в координатах поверхности. Кэш по объекту штриха. */
const pathCache = new WeakMap();

export function strokePath(stroke, smoothingBase, live) {
  if (!live && pathCache.has(stroke)) return pathCache.get(stroke);
  const pts = stroke._pts || unpackPoints(stroke.pts);
  let path;
  if (stroke.tool === 'shape') {
    path = new Path2D(shapePathD(stroke.shape, pts));
  } else {
    const st = TOOL_STYLE[stroke.tool] || TOOL_STYLE.pen;
    const hasPressure = stroke.pr !== false && pts.some((p) => p[2] !== 0.5);
    const outline = getStroke(pts, {
      size: stroke.size * (stroke.tool === 'marker' ? 1 : 1.6),
      thinning: hasPressure || !st.flat ? st.thinning : 0,
      smoothing: smoothingBase == null ? st.smoothing : clamp(st.smoothing * (0.5 + smoothingBase), 0, 0.99),
      streamline: smoothingBase == null ? st.streamline : clamp(st.streamline * (0.4 + smoothingBase * 1.2), 0, 0.95),
      simulatePressure: !hasPressure && !st.flat,
      last: !live,
      start: { taper: st.flat ? 0 : 0, cap: true },
      end: { taper: st.flat ? 0 : 0, cap: true },
    });
    path = new Path2D(outlinePath(outline));
  }
  if (!live) pathCache.set(stroke, path);
  return path;
}

function shapePathD(shape, pts) {
  if (pts.length < 2) return '';
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const x0 = Math.min(a[0], b[0]); const y0 = Math.min(a[1], b[1]);
  const w = Math.abs(b[0] - a[0]); const hh = Math.abs(b[1] - a[1]);
  if (shape === 'rect') return `M${x0},${y0}h${w}v${hh}h${-w}Z`;
  if (shape === 'ellipse') {
    const rx = w / 2; const ry = hh / 2; const cx = x0 + rx; const cy = y0 + ry;
    return `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0`;
  }
  let d = `M${a[0]},${a[1]}L${b[0]},${b[1]}`;
  if (shape === 'arrow') {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const len = Math.min(22, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.35) + 6;
    for (const s of [-1, 1]) {
      const t = ang + Math.PI + s * 0.45;
      d += `M${b[0]},${b[1]}L${b[0] + len * Math.cos(t)},${b[1] + len * Math.sin(t)}`;
    }
  }
  return d;
}

/** Нарисовать штрихи. transform — [scale, dx, dy] из координат поверхности
 *  в пиксели холста (уже с учётом плотности экрана). */
export function drawStrokes(ctx, strokes, transform, opts) {
  const [s, dx, dy] = transform;
  const o = opts || {};
  for (const st of strokes) {
    ctx.save();
    ctx.setTransform(s, 0, 0, s, dx + (st._dx || 0) * s, dy + (st._dy || 0) * s);
    const color = resolveInkColor(st.color, o.el);
    const path = strokePath(st, o.smoothing, st._live);
    ctx.globalAlpha = st.opacity != null ? st.opacity : (TOOL_STYLE[st.tool] || TOOL_STYLE.pen).opacity;
    if (st.tool === 'shape') {
      ctx.strokeStyle = color;
      ctx.lineWidth = st.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    } else {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    if (o.selected && o.selected.has(st.id)) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = resolveInkColor('blue', o.el);
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([4 / s, 3 / s]);
      ctx.stroke(path);
    }
    ctx.restore();
  }
}

export function strokeBounds(st) {
  const pts = st._pts || unpackPoints(st.pts);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const pad = (st.size || 2) / 2 + 2;
  return { x0: x0 - pad + (st._dx || 0), y0: y0 - pad + (st._dy || 0), x1: x1 + pad + (st._dx || 0), y1: y1 + pad + (st._dy || 0) };
}

// --- ластик и лассо ------------------------------------------------------------------

function distToSeg(p, a, b) {
  const vx = b[0] - a[0]; const vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  let t = l2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

/** Задевает ли точка штрих (с радиусом ластика). */
export function hitsStroke(st, p, r) {
  const b = strokeBounds(st);
  if (p[0] < b.x0 - r || p[0] > b.x1 + r || p[1] < b.y0 - r || p[1] > b.y1 + r) return false;
  const pts = (st._pts || unpackPoints(st.pts)).map((q) => [q[0] + (st._dx || 0), q[1] + (st._dy || 0)]);
  const reach = r + (st.size || 2) / 2;
  if (st.tool === 'shape' && (st.shape === 'rect' || st.shape === 'ellipse')) {
    const outline = shapeOutlinePoints(st.shape, pts);
    for (let i = 1; i < outline.length; i++) if (distToSeg(p, outline[i - 1], outline[i]) <= reach) return true;
    return false;
  }
  if (st.tool === 'shape') return distToSeg(p, pts[0], pts[pts.length - 1]) <= reach;
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= reach;
  for (let i = 1; i < pts.length; i++) if (distToSeg(p, pts[i - 1], pts[i]) <= reach) return true;
  return false;
}

function shapeOutlinePoints(shape, pts) {
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const x0 = Math.min(a[0], b[0]); const y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0], b[0]); const y1 = Math.max(a[1], b[1]);
  if (shape === 'rect') return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const out = [];
  for (let i = 0; i <= 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    out.push([(x0 + x1) / 2 + ((x1 - x0) / 2) * Math.cos(t), (y0 + y1) / 2 + ((y1 - y0) / 2) * Math.sin(t)]);
  }
  return out;
}

/** Ластик «по кусочку»: из штриха вырезаются точки под ластиком, остаток —
 *  один или несколько новых штрихов. */
export function splitStroke(st, p, r) {
  if (st.tool === 'shape') return hitsStroke(st, p, r) ? [] : [st];
  const pts = st._pts || unpackPoints(st.pts);
  const reach = r + (st.size || 2) / 2;
  const parts = [];
  let cur = [];
  for (const q of pts) {
    const qq = [q[0] + (st._dx || 0), q[1] + (st._dy || 0)];
    if (Math.hypot(qq[0] - p[0], qq[1] - p[1]) <= reach) {
      if (cur.length > 1) parts.push(cur);
      cur = [];
    } else cur.push([qq[0], qq[1], q[2]]);
  }
  if (cur.length > 1) parts.push(cur);
  if (parts.length === 1 && parts[0].length === pts.length) return [st];
  return parts.map((part) => makeStroke(Object.assign({}, st, { id: shortId() }), part));
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Штрихи, которые лассо обвело больше чем наполовину. */
export function lassoSelect(strokes, poly) {
  const out = new Set();
  for (const st of strokes) {
    const pts = (st._pts || unpackPoints(st.pts)).map((q) => [q[0] + (st._dx || 0), q[1] + (st._dy || 0)]);
    const inside = pts.filter((q) => pointInPolygon(q, poly)).length;
    if (pts.length && inside / pts.length >= 0.5) out.add(st.id);
  }
  return out;
}

// --- распознавание фигур ---------------------------------------------------------------

/** Штрих, на котором задержали перо, → фигура или null. */
export function recognizeShape(pts) {
  if (pts.length < 4) return null;
  const a = pts[0]; const b = pts[pts.length - 1];
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    if (i) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
  }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 12) return null;
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Почти прямой — линия.
  if (chord / len > 0.9) return { shape: 'line', pts: [a, b] };
  // Замкнутый — прямоугольник или эллипс: что ближе к точкам.
  if (chord < diag * 0.3) {
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    const rx = Math.max(1, (x1 - x0) / 2); const ry = Math.max(1, (y1 - y0) / 2);
    let eErr = 0; let rErr = 0;
    for (const p of pts) {
      const nx = (p[0] - cx) / rx; const ny = (p[1] - cy) / ry;
      eErr += Math.abs(Math.hypot(nx, ny) - 1);
      rErr += Math.min(Math.abs(Math.abs(nx) - 1), Math.abs(Math.abs(ny) - 1));
    }
    return { shape: eErr < rErr ? 'ellipse' : 'rect', pts: [[x0, y0], [x1, y1]] };
  }
  return null;
}

export function makeStroke(base, pts) {
  const st = {
    id: base.id || shortId(),
    tool: base.tool,
    color: base.color,
    size: base.size,
    pts: packPoints(pts),
  };
  if (base.shape) st.shape = base.shape;
  if (base.opacity != null) st.opacity = base.opacity;
  if (base.pr === false) st.pr = false;
  return st;
}

/** Сдвинуть штрих на (dx, dy) — переупаковкой точек. */
export function moveStroke(st, dx, dy) {
  const pts = unpackPoints(st.pts).map((p) => [p[0] + dx, p[1] + dy, p[2]]);
  return Object.assign({}, st, { pts: packPoints(pts) });
}

// --- ввод с пера -------------------------------------------------------------------

/** Ввод на элементе. handlers: begin(p, info) → bool, move(points), end(),
 *  cancel(). Точка — [x, y, pressure] в пикселях элемента. */
export class InkInput {
  constructor(el, handlers, getSettings) {
    this.el = el;
    this.h = handlers;
    this.getSettings = getSettings;
    this.pointer = null;
    this.penSeen = false;
    this.lastPenAt = 0;
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onTouch = this.onTouch.bind(this);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('lostpointercapture', this.onUp);
    // Касание пером у Chrome на Android и у Safari прокручивает страницу,
    // если touchstart не отменить. Отменяем только для пера — пальцы
    // прокручивают как обычно.
    el.addEventListener('touchstart', this.onTouch, { passive: false });
    el.addEventListener('touchmove', this.onTouch, { passive: false });
  }

  /** Рисует ли этот указатель. Палец при «только стилус» — нет. */
  accepts(e) {
    const s = this.getSettings();
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'touch') {
      if (s.stylus === 'only') return false;
      if (s.stylus === 'auto' && (this.penSeen || Date.now() - this.lastPenAt < 1500)) return false;
    }
    return true;
  }

  point(e) {
    const r = this.el.getBoundingClientRect();
    const s = this.getSettings();
    let p = 0.5;
    if (e.pointerType === 'pen' && s.pressure && e.pressure > 0) p = e.pressure;
    return [e.clientX - r.left, e.clientY - r.top, p];
  }

  onTouch(e) {
    // Pointer-события приходят раньше touch: если штрих уже начался (перо
    // или палец, которому можно рисовать), прокрутку гасим.
    const stylus = [...e.touches].some((t) => t.touchType === 'stylus');
    if (stylus || this.pointer) e.preventDefault();
  }

  onDown(e) {
    if (this.pointer) {
      // Второй палец во время рисования — это жест (масштаб, прокрутка):
      // текущий штрих отменяется.
      if (e.pointerType === 'touch' && this.pointer.type === 'touch' && this.pointer.id !== e.pointerId) {
        this.h.cancel && this.h.cancel();
        this.pointer = null;
      }
      return;
    }
    if (e.pointerType === 'pen') { this.penSeen = true; this.lastPenAt = Date.now(); }
    if (!this.accepts(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 5) return;
    const s = this.getSettings();
    // Кнопка пера (button 5 / buttons 32) — ластик на время касания.
    const eraser = s.penButtonEraser && e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) === 32 || (e.button === 2));
    const ok = this.h.begin(this.point(e), { eraser, type: e.pointerType });
    if (!ok) return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* нет захвата — ничего */ }
    this.pointer = { id: e.pointerId, type: e.pointerType };
  }

  onMove(e) {
    if (!this.pointer || e.pointerId !== this.pointer.id) {
      if (e.pointerType === 'pen') this.h.hover && this.h.hover(this.point(e));
      return;
    }
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    this.h.move((evs.length ? evs : [e]).map((ev) => this.point(ev)));
  }

  onUp(e) {
    if (!this.pointer || (e.pointerId != null && e.pointerId !== this.pointer.id)) return;
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();
    this.pointer = null;
    this.h.end();
  }

  destroy() {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('lostpointercapture', this.onUp);
    el.removeEventListener('touchstart', this.onTouch);
    el.removeEventListener('touchmove', this.onTouch);
  }
}

// --- поверхность -------------------------------------------------------------------

/** Холст со штрихами и всей логикой инструментов. Как штрихи сохраняются и
 *  во что пересчитываются координаты — решают владельцы (блок, слой). */
export class InkSurface {
  /**
   * @param {object} o
   *  canvas — <canvas>; input — элемент, на котором ловим перо;
   *  settings() — текущие настройки; strokes() — массив штрихов;
   *  commit(strokes) — записать новый массив; toLocal([x,y,p]) → координаты
   *  поверхности; transform() → [scale, dx, dy] для отрисовки (без dpr);
   *  canDraw(info) — можно ли начинать штрих; onSelection(set).
   */
  constructor(o) {
    this.o = o;
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.live = null;
    this.eraseTrail = null;
    this.lasso = null;
    this.selected = new Set();
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.holdTimer = null;
    this.input = new InkInput(o.input || o.canvas, {
      begin: (p, info) => this.begin(p, info),
      move: (pts) => this.move(pts),
      end: () => this.end(),
      cancel: () => this.cancel(),
      hover: (p) => this.hover(p),
    }, o.settings);
  }

  settings() { return this.o.settings(); }

  tool(info) {
    if (info && info.eraser) return 'eraser';
    return this.settings().tool;
  }

  pushUndo() {
    this.undoStack.push(this.o.strokes());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.o.strokes());
    this.o.commit(this.undoStack.pop());
    this.selected.clear();
    this.render();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.o.strokes());
    this.o.commit(this.redoStack.pop());
    this.render();
    return true;
  }

  clear() {
    if (!this.o.strokes().length) return;
    this.pushUndo();
    this.o.commit([]);
    this.selected.clear();
    this.render();
  }

  begin(p, info) {
    if (this.o.canDraw && !this.o.canDraw(info)) return false;
    const tool = this.tool(info);
    const lp = this.o.toLocal(p);
    this.curTool = tool;
    const s = this.settings();
    if (tool === 'lasso') {
      // Внутри выделения — тащим его; снаружи — новое лассо.
      if (this.selected.size && this.inSelectionBox(lp)) {
        this.drag = { from: lp, dx: 0, dy: 0 };
        return true;
      }
      this.selected.clear();
      this.lasso = [lp];
      this.render();
      return true;
    }
    if (tool === 'eraser') {
      this.pushUndo();
      this.eraseTrail = [lp];
      this.eraseAt(lp);
      return true;
    }
    this.selected.clear();
    const base = tool === 'shape'
      ? { tool: 'shape', shape: s.shape, color: s.color, size: Math.max(1.5, s.size), _live: true }
      : { tool, color: s.color, size: tool === 'marker' ? Math.max(8, s.size * (s.size < 8 ? 4 : 1)) : s.size, _live: true, pr: info.type === 'pen' ? undefined : false };
    this.live = Object.assign({ id: shortId() }, base, { _pts: [lp] });
    this.lastMoveAt = Date.now();
    this.armHold();
    this.render();
    return true;
  }

  armHold() {
    clearTimeout(this.holdTimer);
    const s = this.settings();
    if (!s.holdToShape || !this.live || this.live.tool === 'shape' || this.live.tool === 'marker') return;
    this.holdTimer = setTimeout(() => {
      if (!this.live || this.live._pts.length < 6) return;
      const shape = recognizeShape(this.live._pts);
      if (!shape) return;
      this.live = Object.assign({}, this.live, { tool: 'shape', shape: shape.shape, size: Math.max(1.5, this.live.size), _pts: shape.pts, _snapped: true });
      this.render();
    }, 550);
  }

  move(pts) {
    const local = pts.map((p) => this.o.toLocal(p));
    if (this.drag) {
      const last = local[local.length - 1];
      this.drag.dx = last[0] - this.drag.from[0];
      this.drag.dy = last[1] - this.drag.from[1];
      for (const st of this.o.strokes()) if (this.selected.has(st.id)) { st._dx = this.drag.dx; st._dy = this.drag.dy; }
      this.render();
      return;
    }
    if (this.lasso) { this.lasso.push(...local); this.render(); return; }
    if (this.eraseTrail) {
      for (const p of local) this.eraseAt(p);
      return;
    }
    if (!this.live || this.live._snapped) return;
    if (this.live.tool === 'shape') {
      this.live._pts = [this.live._pts[0], local[local.length - 1]];
    } else {
      const last = this.live._pts[this.live._pts.length - 1];
      for (const p of local) {
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.4) this.live._pts.push(p);
      }
      const moved = local.some((p) => Math.hypot(p[0] - last[0], p[1] - last[1]) > 2.5);
      if (moved) this.armHold();
    }
    this.render();
  }

  end() {
    clearTimeout(this.holdTimer);
    if (this.drag) {
      const { dx, dy } = this.drag;
      this.drag = null;
      const strokes = this.o.strokes();
      for (const st of strokes) { delete st._dx; delete st._dy; }
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        this.pushUndo();
        this.o.commit(strokes.map((st) => (this.selected.has(st.id) ? moveStroke(st, dx, dy) : st)));
      }
      this.render();
      return;
    }
    if (this.lasso) {
      const poly = this.lasso;
      this.lasso = null;
      this.selected = poly.length > 3 ? lassoSelect(this.o.strokes(), poly) : new Set();
      this.render();
      if (this.o.onSelection) this.o.onSelection(this.selected);
      return;
    }
    if (this.eraseTrail) {
      this.eraseTrail = null;
      // Ластик ничего не задел — шаг отмены не нужен.
      const top = this.undoStack[this.undoStack.length - 1];
      if (top && top.length === this.o.strokes().length && top.every((s, i) => s === this.o.strokes()[i])) this.undoStack.pop();
      this.render();
      return;
    }
    if (!this.live) return;
    const st = this.live;
    this.live = null;
    const pts = st._pts;
    if (st.tool === 'shape' && pts.length < 2) { this.render(); return; }
    if (st.tool === 'shape' && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 2) { this.render(); return; }
    const final = makeStroke(st, pts.length === 1 ? [pts[0], [pts[0][0] + 0.1, pts[0][1] + 0.1, pts[0][2]]] : pts);
    this.pushUndo();
    this.o.commit(this.o.strokes().concat(final));
    this.render();
  }

  cancel() {
    clearTimeout(this.holdTimer);
    this.live = null;
    this.lasso = null;
    this.eraseTrail = null;
    this.render();
  }

  hover() { /* курсор ластика рисуется CSS-ом */ }

  eraseAt(p) {
    const r = Math.max(6, this.settings().size * 2) / (this.o.transform()[0] || 1);
    const strokes = this.o.strokes();
    const partial = this.settings().eraser === 'partial';
    let changed = false;
    const next = [];
    for (const st of strokes) {
      if (!hitsStroke(st, p, r)) { next.push(st); continue; }
      changed = true;
      if (partial) next.push(...splitStroke(st, p, r));
    }
    if (changed) { this.o.commit(next); this.render(); }
  }

  selectionBox() {
    const sel = this.o.strokes().filter((st) => this.selected.has(st.id));
    if (!sel.length) return null;
    const bs = sel.map(strokeBounds);
    return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
  }

  inSelectionBox(p) {
    const b = this.selectionBox();
    return !!b && p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
  }

  deleteSelected() {
    if (!this.selected.size) return;
    this.pushUndo();
    this.o.commit(this.o.strokes().filter((st) => !this.selected.has(st.id)));
    this.selected.clear();
    this.render();
  }

  duplicateSelected() {
    if (!this.selected.size) return;
    this.pushUndo();
    const copies = this.o.strokes().filter((st) => this.selected.has(st.id)).map((st) => Object.assign(moveStroke(st, 16, 16), { id: shortId() }));
    this.o.commit(this.o.strokes().concat(copies));
    this.selected = new Set(copies.map((c) => c.id));
    this.render();
  }

  recolorSelected(color) {
    if (!this.selected.size) return;
    this.pushUndo();
    this.o.commit(this.o.strokes().map((st) => (this.selected.has(st.id) ? Object.assign({}, st, { color }) : st)));
    this.render();
  }

  /** Перерисовать холст целиком. */
  render() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr);
    const hh = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const [s, dx, dy] = this.o.transform();
    const T = [s * dpr, dx * dpr, dy * dpr];
    const all = this.o.visibleStrokes ? this.o.visibleStrokes() : this.o.strokes();
    drawStrokes(ctx, this.live ? all.concat(this.live) : all, T, { selected: this.selected, smoothing: this.settings().smoothing, el: c });
    if (this.lasso && this.lasso.length > 1) {
      ctx.save();
      ctx.setTransform(T[0], 0, 0, T[0], T[1], T[2]);
      ctx.beginPath();
      this.lasso.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = resolveInkColor('blue', c);
      ctx.lineWidth = 1.5 / T[0];
      ctx.setLineDash([5 / T[0], 4 / T[0]]);
      ctx.stroke();
      ctx.restore();
    }
    const box = this.selected.size ? this.selectionBox() : null;
    if (box) {
      ctx.save();
      ctx.setTransform(T[0], 0, 0, T[0], T[1], T[2]);
      ctx.strokeStyle = resolveInkColor('blue', c);
      ctx.lineWidth = 1 / T[0];
      ctx.setLineDash([3 / T[0], 3 / T[0]]);
      ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.restore();
    }
    if (this.o.afterRender) this.o.afterRender(box);
  }

  destroy() {
    clearTimeout(this.holdTimer);
    this.input.destroy();
  }
}

// --- панель инструментов ---------------------------------------------------------------

/** Кружок цвета пера: имя палитры — классом, свой цвет — стилем. */
function inkDot(color, size, tool) {
  const named = INK_COLORS.includes(color);
  return h('span', {
    class: `led-ink-dot${named ? ` ink-${color}` : ''}${tool ? ` tool-${tool}` : ''}`,
    style: `--sz:${size}px${named ? '' : `;color:${color}`}`,
  });
}

const TOOL_ICON = { pen: 'pen', pencil: 'pencil', marker: 'marker', eraser: 'eraser', lasso: 'lasso', shape: 'shapes' };
const SHAPE_ICON = { line: 'line', arrow: 'arrow', rect: 'rect', ellipse: 'ellipse' };

/** Панель рисования. api: { surface(), settings(), setSettings(patch),
 *  extra: [элементы справа], onClose? } */
export class InkToolbar {
  constructor(ctx, api) {
    this.ctx = ctx;
    this.api = api;
    this.t = ctx.t;
    this.dom = h('div', { class: 'led-inkbar', role: 'toolbar', 'aria-label': this.t('ink.toolbar') });
    this.render();
  }

  set(patch) {
    this.api.setSettings(patch);
    this.render();
  }

  render() {
    const t = this.t;
    const s = this.api.settings();
    const tools = TOOLS.map((tool) => {
      const b = h('button', {
        type: 'button', class: `led-btn${s.tool === tool ? ' on' : ''}`, title: t(`ink.tool_${tool}`), 'aria-pressed': String(s.tool === tool),
        dataset: { tool },
        onclick: () => {
          if (tool === 'shape' && s.tool === 'shape') { this.shapeMenu(b); return; }
          this.set({ tool });
        },
      }, icon(tool === 'shape' ? SHAPE_ICON[s.shape] : TOOL_ICON[tool]));
      return b;
    });
    const presets = h('div', { class: 'led-ink-presets' }, s.presets.map((p, i) => h('button', {
      type: 'button',
      class: `led-ink-preset${p.tool === s.tool && p.color === s.color && p.size === s.size ? ' on' : ''}`,
      title: `${t(`ink.tool_${p.tool}`)} · ${t(`color.${p.color}`)}`,
      onclick: () => this.set({ tool: p.tool, color: p.color, size: p.size }),
      oncontextmenu: (e) => {
        // Правый щелчок (долгое касание) — запомнить текущее перо на это место.
        e.preventDefault();
        const presetsNext = s.presets.slice();
        presetsNext[i] = { tool: ['pen', 'pencil', 'marker'].includes(s.tool) ? s.tool : 'pen', color: s.color, size: s.size };
        this.set({ presets: presetsNext });
        this.ctx.toast(t('ink.preset_saved'));
      },
    }, inkDot(p.color, Math.min(16, 4 + p.size), p.tool))));
    const colorBtn = h('button', {
      type: 'button', class: 'led-btn led-ink-colorbtn', title: t('ink.color'),
      onclick: (e) => this.colorMenu(e.currentTarget),
    }, inkDot(s.color, 16));
    const sizeBtn = h('button', {
      type: 'button', class: 'led-btn led-ink-size', title: t('ink.size'),
      onclick: (e) => this.sizeMenu(e.currentTarget),
    }, h('span', { class: 'led-ink-size-dot', style: `--sz:${Math.min(18, 2 + s.size)}px` }));
    const surface = this.api.surface();
    const selActions = surface && surface.selected.size ? [
      h('span', { class: 'led-bar-sep' }),
      h('button', { type: 'button', class: 'led-btn', title: t('ink.sel_duplicate'), onclick: () => { surface.duplicateSelected(); this.render(); } }, icon('copy')),
      h('button', { type: 'button', class: 'led-btn', title: t('ink.sel_recolor'), onclick: (e) => this.colorMenu(e.currentTarget, true) }, icon('palette')),
      h('button', { type: 'button', class: 'led-btn', title: t('ink.sel_delete'), onclick: () => { surface.deleteSelected(); this.render(); } }, icon('trash')),
    ] : [];
    this.dom.replaceChildren(
      h('div', { class: 'led-ink-group' }, tools),
      h('span', { class: 'led-bar-sep' }),
      presets, colorBtn, sizeBtn,
      ...selActions,
      h('span', { class: 'led-bar-sep' }),
      h('button', { type: 'button', class: 'led-btn', title: `${t('undo')} (Ctrl+Z)`, onclick: () => surface && surface.undo() }, icon('undo')),
      h('button', { type: 'button', class: 'led-btn', title: t('redo'), onclick: () => surface && surface.redo() }, icon('redo')),
      ...(this.api.extra ? this.api.extra() : []),
      h('button', { type: 'button', class: 'led-btn', title: t('ink.settings'), onclick: (e) => this.settingsPanel(e.currentTarget) }, icon('settings')),
    );
  }

  shapeMenu(anchor) {
    const s = this.api.settings();
    const list = h('div', { class: 'led-ink-shapes' }, SHAPES.map((sh) => h('button', {
      type: 'button', class: `led-btn${s.shape === sh ? ' on' : ''}`, title: this.t(`ink.shape_${sh}`),
      onclick: () => { this.set({ tool: 'shape', shape: sh }); p.close(); },
    }, icon(SHAPE_ICON[sh]))));
    const p = popup(this.ctx.root, anchor, list, { above: this.api.above });
  }

  colorMenu(anchor, forSelection) {
    const s = this.api.settings();
    const grid = h('div', { class: 'led-colors led-ink-colors' }, INK_COLORS.map((c) => h('button', {
      type: 'button', class: `led-swatch ink-sw ink-${c}${s.color === c ? ' on' : ''}`, title: this.t(`color.${c}`),
      onclick: () => {
        if (forSelection) { const sf = this.api.surface(); if (sf) sf.recolorSelected(c); this.render(); } else this.set({ color: c });
        p.close();
      },
    })));
    const custom = h('input', {
      type: 'color', class: 'led-ink-custom', title: this.t('ink.custom_color'),
      onchange: (e) => {
        if (forSelection) { const sf = this.api.surface(); if (sf) sf.recolorSelected(e.target.value); } else this.set({ color: e.target.value });
        p.close();
      },
    });
    const p = popup(this.ctx.root, anchor, h('div', {}, grid, h('label', { class: 'led-ink-custom-row' }, custom, this.t('ink.custom_color'))), { above: this.api.above });
  }

  sizeMenu(anchor) {
    const s = this.api.settings();
    const sizes = [1, 2, 3, 5, 8, 12, 20];
    const row = h('div', { class: 'led-ink-sizes' }, sizes.map((z) => h('button', {
      type: 'button', class: `led-btn${s.size === z ? ' on' : ''}`, title: String(z),
      onclick: () => { this.set({ size: z }); p.close(); },
    }, h('span', { class: 'led-ink-size-dot', style: `--sz:${Math.min(22, 2 + z)}px` }))));
    const sl = slider(this.t('ink.size'), s.size, 1, 40, 1, (v) => this.api.setSettings({ size: v }));
    const p = popup(this.ctx.root, anchor, h('div', {}, row, sl), { above: this.api.above, onClose: () => this.render() });
  }

  settingsPanel(anchor) {
    const t = this.t;
    const s = this.api.settings();
    const set = (patch) => this.api.setSettings(patch);
    const body = h('div', { class: 'led-ink-settings' },
      h('div', { class: 'led-menu-head' }, t('ink.settings')),
      h('div', { class: 'led-setting-col' },
        h('span', { class: 'led-setting-text' }, h('span', {}, t('ink.stylus')), h('span', { class: 'led-setting-hint' }, t('ink.stylus_hint'))),
        segmented([
          { value: 'auto', label: t('ink.stylus_auto') },
          { value: 'only', label: t('ink.stylus_only') },
          { value: 'any', label: t('ink.stylus_any') },
        ], s.stylus, (v) => set({ stylus: v }), true)),
      toggleSwitch(t('ink.pressure'), s.pressure, (v) => set({ pressure: v }), t('ink.pressure_hint')),
      toggleSwitch(t('ink.pen_button'), s.penButtonEraser, (v) => set({ penButtonEraser: v }), t('ink.pen_button_hint')),
      toggleSwitch(t('ink.hold_shape'), s.holdToShape, (v) => set({ holdToShape: v }), t('ink.hold_shape_hint')),
      h('div', { class: 'led-setting-col' },
        h('span', { class: 'led-setting-text' }, h('span', {}, t('ink.eraser_mode'))),
        segmented([
          { value: 'stroke', label: t('ink.eraser_stroke') },
          { value: 'partial', label: t('ink.eraser_partial') },
        ], s.eraser, (v) => set({ eraser: v }), true)),
      slider(t('ink.smoothing'), s.smoothing, 0, 1, 0.05, (v) => set({ smoothing: v }), (v) => `${Math.round(v * 100)}%`),
      h('div', { class: 'led-hint' }, t('ink.presets_hint')));
    popup(this.ctx.root, anchor, body, { above: this.api.above, class: 'led-pop-wide' });
  }
}

/** Отрисовать штрихи в PNG — для «скачать рисунок». */
export async function strokesToPng(strokes, width, height, bgColor) {
  const c = document.createElement('canvas');
  const k = 2;
  c.width = Math.round(width * k);
  c.height = Math.round(height * k);
  const ctx = c.getContext('2d');
  if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, c.width, c.height); }
  drawStrokes(ctx, strokes, [k, 0, 0], {});
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

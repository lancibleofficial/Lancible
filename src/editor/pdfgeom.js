// Слои поверх страницы PDF (узел pdfpage) — чистые функции без DOM и без
// pdf.js: геометрия, порядок и данные слоёв. Ими пользуются и вид страницы
// в редакторе (pdfpage.js), и выгрузка в PDF (pdfwrite.js, в ленивой сборке
// editor-pdf.js), и юнит tests/unit/editor-pdfpage.test.js.
//
// Координаты слоя — в пунктах (pt) страницы, от её левого верхнего угла, как
// её показывает pdf.js (viewport в масштабе 1, с учётом поворота страницы).
// В редакторе страница шириной в блок: масштаб = ширина блока / w, и слой
// встаёт в px умножением на масштаб. В PDF ось y смотрит вверх — переводит
// pdfRect.
//
// Слой: { id, type, x, y, w, h, text?, font?, src?, stroke?, fill? }
//   text      — text, font { size (pt), weight 'normal'|'bold', color };
//               h — высота набранного текста (её меряет вид после правки);
//   image     — src (asset:… — хранилище картинок, assets.js);
//   rect      — stroke { color, width };
//   arrow     — stroke { color, width }; начало (x, y), конец (x + w, y + h):
//               у стрелки w и h со знаком — это направление;
//   highlight — fill { color, opacity } — маркер: заливка цветом маркера
//               (--led-hl-*), наложением «умножение» — текст под ним виден;
//   whiteout  — замазка: заливка цветом бумаги, без обводки.
// Цвет — имя: 'ink' (чёрный текст на бумаге) или оттенок палитры (как
// COLOR_KEYS в schema.js — здесь своей копией, чтобы выгрузка не тянула
// prosemirror в editor-pdf.js; совпадение сторожит юнит).

export const OVERLAY_TYPES = ['text', 'image', 'rect', 'arrow', 'highlight', 'whiteout'];
export const HUES = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
/** Цвета слоя: «как текст» (чёрный на бумаге) и оттенки палитры. */
export const OV_COLORS = ['ink', ...HUES];

/** Меньше этого (pt) слой не сжимается: за него надо ещё ухватиться. */
export const MIN_PT = 8;
/** Кегль текстового слоя (pt) и ступени в меню. */
export const FONT_MIN = 4;
export const FONT_MAX = 144;
export const FONT_STEPS = [8, 10, 12, 14, 18, 24, 32, 48];
/** Толщина линии прямоугольника и стрелки (pt) и ступени в меню. */
export const STROKE_STEPS = [1, 2, 4, 8];
export const STROKE_MAX = 24;
/** Межстрочный интервал текстового слоя — доля кегля (тот же в CSS). */
export const LINE_HEIGHT = 1.3;
/** Сдвиг стрелками клавиатуры: 1 pt, с Shift — 10. */
export const NUDGE = 1;
export const NUDGE_BIG = 10;
/** Текст слоя — не роман: столько знаков хватит на страницу. */
export const TEXT_MAX = 5000;

/** Лист A4 набора остального документа (pdfwrite.js), pt: размер, поля и
 *  ширина полосы — от неё же масштаб пера на A4 (pdfexport.js: inkPlan). */
export const A4 = { w: 595.28, h: 841.89 };
export const A4_MARGIN = 56;
export const A4_CONTENT_W = A4.w - A4_MARGIN * 2;

/** Ручки рамки выделенного слоя: углы и середины сторон. У стрелки — две
 *  ручки на концах (a — начало, b — конец). */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const ARROW_HANDLES = ['a', 'b'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
/** Десятая доля пункта: точнее не нужно, а данные не пухнут. */
export const round = (v) => Math.round(v * 10) / 10;

// --- масштаб ----------------------------------------------------------------------

/** px на один pt: страница шириной wPt в блоке шириной widthPx. */
export const scaleOf = (widthPx, wPt) => (widthPx > 0 && wPt > 0 ? widthPx / wPt : 1);
export const pxToPt = (px, scale) => px / (scale || 1);
export const ptToPx = (pt, scale) => pt * (scale || 1);

// --- рамка ---------------------------------------------------------------------------

/** Прямоугольник слоя без знака: у стрелки w и h бывают отрицательными. */
export function boundsOf(o) {
  const x = Math.min(o.x, o.x + o.w);
  const y = Math.min(o.y, o.y + o.h);
  return { x, y, w: Math.abs(o.w), h: Math.abs(o.h) };
}

/** Рамка в пределах страницы и не меньше min по каждой стороне. */
export function clampBox(b, page, min) {
  const m = min == null ? MIN_PT : min;
  const W = Math.max(m, page.w);
  const H = Math.max(m, page.h);
  const w = clamp(b.w, m, W);
  const h = clamp(b.h, m, H);
  return { x: clamp(b.x, 0, W - w), y: clamp(b.y, 0, H - h), w, h };
}

/** Сдвиг целиком — с упором в край страницы (слой не уезжает за неё). */
export function moveBox(o, dx, dy, page) {
  const b = boundsOf(o);
  const nx = clamp(b.x + dx, 0, Math.max(0, page.w - b.w));
  const ny = clamp(b.y + dy, 0, Math.max(0, page.h - b.h));
  return { x: o.x + (nx - b.x), y: o.y + (ny - b.y), w: o.w, h: o.h };
}

/** Изменение размера за ручку. Сторона, за которую не тянут, стоит на месте;
 *  тянут за край страницы — упор; меньше min — упор. ratio — держать
 *  пропорцию (картинка за угол): ширина ведёт, высота следует за ней. */
export function resizeBox(b, handle, dx, dy, page, opts) {
  const o = opts || {};
  const m = o.min == null ? MIN_PT : o.min;
  let x1 = b.x;
  let y1 = b.y;
  let x2 = b.x + b.w;
  let y2 = b.y + b.h;
  if (handle.includes('w')) x1 = clamp(x1 + dx, 0, x2 - m);
  if (handle.includes('e')) x2 = clamp(x2 + dx, x1 + m, page.w);
  if (handle.includes('n')) y1 = clamp(y1 + dy, 0, y2 - m);
  if (handle.includes('s')) y2 = clamp(y2 + dy, y1 + m, page.h);
  if (o.ratio && handle.length === 2 && b.w > 0 && b.h > 0) {
    const r = b.h / b.w;
    let w = x2 - x1;
    let hgt = w * r;
    // Высота упёрлась в край — ширина следует за ней.
    const room = handle.includes('n') ? b.y + b.h : page.h - b.y;
    if (hgt > room) { hgt = room; w = hgt / r; }
    if (w < m || hgt < m) { const k = Math.max(m / w, m / hgt); w *= k; hgt *= k; }
    if (handle.includes('w')) x1 = x2 - w; else x2 = x1 + w;
    if (handle.includes('n')) y1 = y2 - hgt; else y2 = y1 + hgt;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Конец стрелки за ручку: a — начало, b — конец; точка — в пределах страницы. */
export function moveArrowEnd(o, end, dx, dy, page) {
  let ax = o.x;
  let ay = o.y;
  let bx = o.x + o.w;
  let by = o.y + o.h;
  if (end === 'a') { ax = clamp(ax + dx, 0, page.w); ay = clamp(ay + dy, 0, page.h); } else { bx = clamp(bx + dx, 0, page.w); by = clamp(by + dy, 0, page.h); }
  return { x: ax, y: ay, w: bx - ax, h: by - ay };
}

/** Стрелки клавиатуры: на 1 pt, с Shift — на 10. */
export function nudge(o, key, big, page) {
  const d = big ? NUDGE_BIG : NUDGE;
  const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[key];
  return v ? moveBox(o, v[0], v[1], page) : null;
}

/** Рамка с геометрией, округлённой до 0,1 pt. */
export const roundBox = (b) => ({ x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) });

// --- данные слоя ----------------------------------------------------------------------

let counter = 0;
/** Номер слоя: короткий и свой в пределах страницы. */
export const overlayId = () => `ov${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const color = (c, d) => (OV_COLORS.includes(c) ? c : d);

/** Значения слоя по умолчанию для каждого вида. */
export function overlayDefaults(type) {
  switch (type) {
    case 'text': return { text: '', font: { size: 14, weight: 'normal', color: 'ink' } };
    case 'rect': return { stroke: { color: 'red', width: 2 } };
    case 'arrow': return { stroke: { color: 'red', width: 2 } };
    case 'highlight': return { fill: { color: 'yellow', opacity: 1 } };
    default: return {};
  }
}

/** Новый слой: у точки at (pt, центр слоя) или по центру страницы; size —
 *  ширина и высота (картинке — по её пропорции). */
export function newOverlay(type, page, opts) {
  const o = opts || {};
  const W = page.w;
  const H = page.h;
  const size = o.size || {
    text: { w: Math.min(220, W * 0.6), h: 14 * LINE_HEIGHT },
    image: { w: Math.min(180, W * 0.5), h: Math.min(135, H * 0.4) },
    rect: { w: Math.min(160, W * 0.5), h: Math.min(100, H * 0.3) },
    arrow: { w: Math.min(140, W * 0.4), h: 0 },
    highlight: { w: Math.min(180, W * 0.5), h: 18 },
    whiteout: { w: Math.min(160, W * 0.5), h: 24 },
  }[type];
  const at = o.at || { x: W / 2, y: H / 2 };
  let box;
  if (type === 'arrow') {
    const x = clamp(at.x - size.w / 2, 0, Math.max(0, W - size.w));
    const y = clamp(at.y, 0, H);
    box = { x, y, w: size.w, h: size.h };
  } else {
    box = clampBox({ x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h }, page);
  }
  return normalizeOverlay(Object.assign({ id: overlayId(), type }, overlayDefaults(type), roundBox(box), o.attrs || {}), page);
}

/** Слой в порядок: известный вид, числа — числа, рамка — на странице,
 *  цвета — из палитры, текст — строка. Мусор — null. Так данные, пришедшие
 *  с другого устройства или из старой версии, не ломают ни вид, ни выгрузку. */
export function normalizeOverlay(raw, page, fallbackId) {
  if (!raw || typeof raw !== 'object' || !OVERLAY_TYPES.includes(raw.type)) return null;
  const type = raw.type;
  const P = { w: Math.max(MIN_PT, num(page && page.w, 595)), h: Math.max(MIN_PT, num(page && page.h, 842)) };
  const out = { id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : (fallbackId || overlayId()), type };
  const x = num(raw.x, 0);
  const y = num(raw.y, 0);
  const w = num(raw.w, MIN_PT);
  const h = num(raw.h, MIN_PT);
  if (type === 'arrow') {
    const ax = clamp(x, 0, P.w);
    const ay = clamp(y, 0, P.h);
    const bx = clamp(x + w, 0, P.w);
    const by = clamp(y + h, 0, P.h);
    Object.assign(out, roundBox({ x: ax, y: ay, w: bx - ax, h: by - ay }));
  } else {
    Object.assign(out, roundBox(clampBox({ x, y, w, h }, P)));
  }
  const d = overlayDefaults(type);
  if (type === 'text') {
    out.text = typeof raw.text === 'string' ? raw.text.replace(/\r\n?/g, '\n').slice(0, TEXT_MAX) : '';
    const f = raw.font && typeof raw.font === 'object' ? raw.font : {};
    out.font = {
      size: round(clamp(num(f.size, d.font.size), FONT_MIN, FONT_MAX)),
      weight: f.weight === 'bold' ? 'bold' : 'normal',
      color: color(f.color, d.font.color),
    };
  } else if (type === 'image') {
    const src = typeof raw.src === 'string' ? raw.src : '';
    if (!/^(asset:|https?:|data:image\/)/.test(src)) return null;
    out.src = src;
  } else if (type === 'rect' || type === 'arrow') {
    const s = raw.stroke && typeof raw.stroke === 'object' ? raw.stroke : {};
    out.stroke = { color: color(s.color, d.stroke.color), width: round(clamp(num(s.width, d.stroke.width), 0.5, STROKE_MAX)) };
  } else if (type === 'highlight') {
    const f = raw.fill && typeof raw.fill === 'object' ? raw.fill : {};
    out.fill = { color: color(f.color === 'ink' ? '' : f.color, d.fill.color), opacity: Math.round(clamp(num(f.opacity, d.fill.opacity), 0.1, 1) * 100) / 100 };
  }
  return out;
}

/** Список слоёв в порядок: мусор выброшен, номера не повторяются. Порядок
 *  в списке — порядок наложения: последний лежит сверху. Номер без номера и
 *  повторный — по месту в списке, а не случайный: вид перечитывает слои на
 *  каждую отрисовку, и выделенный слой не должен терять свой номер. */
export function normalizeOverlays(list, page) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((raw, i) => {
    const o = normalizeOverlay(raw, page, `ov${i}`);
    if (!o) return;
    let k = 1;
    const base = o.id;
    while (seen.has(o.id)) o.id = `${base}-${i}${k++ > 1 ? `-${k}` : ''}`;
    seen.add(o.id);
    out.push(o);
  });
  return out;
}

export const findOverlay = (list, id) => (list || []).find((o) => o.id === id) || null;

/** Поменять слой: patch поверх, затем в порядок. */
export function updateOverlay(list, id, patch, page) {
  return (list || []).map((o) => (o.id === id ? normalizeOverlay(Object.assign({}, o, patch), page) || o : o));
}

export const removeOverlay = (list, id) => (list || []).filter((o) => o.id !== id);

/** На передний план — в конец списка (рисуется последним). */
export function toFront(list, id) {
  const o = findOverlay(list, id);
  return o ? [...removeOverlay(list, id), o] : (list || []).slice();
}

/** На задний план — в начало списка. */
export function toBack(list, id) {
  const o = findOverlay(list, id);
  return o ? [o, ...removeOverlay(list, id)] : (list || []).slice();
}

// --- текст ------------------------------------------------------------------------------

/** Текст по строкам шириной maxWidth: measure(s) — ширина строки в тех же
 *  единицах. Перевод строки — новая строка; слово длиннее строки режется по
 *  буквам. Тот же перенос у выгрузки (pdf-lib меряет шрифтом) и у печати
 *  (canvas). Пустая строка остаётся пустой — абзацы не слипаются. */
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const para of String(text == null ? '' : text).split('\n')) {
    let cur = '';
    // Пробелы в начале абзаца остаются (как white-space: pre-wrap), в начале
    // перенесённой строки — нет.
    let fresh = true;
    const flush = () => { lines.push(cur.trimEnd()); cur = ''; fresh = false; };
    for (const tok of para.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) { if (cur || fresh) cur += tok; continue; }
      if (measure((cur + tok).trimEnd()) <= maxWidth) { cur += tok; continue; }
      if (cur.trim()) flush(); else cur = '';
      if (measure(tok) <= maxWidth) { cur = tok; continue; }
      // Слово шире строки — по буквам.
      for (const ch of tok) {
        if (cur && measure(cur + ch) > maxWidth) flush();
        cur += ch;
      }
    }
    lines.push(cur.trimEnd());
  }
  return lines;
}

// --- выгрузка -----------------------------------------------------------------------------

/** Рамка слоя (pt от левого верхнего угла) → прямоугольник PDF (ось y вверх)
 *  на странице с видимой областью box { x, y, width, height }. */
export function pdfRect(o, box) {
  const b = boundsOf(o);
  return { x: box.x + b.x, y: box.y + box.height - b.y - b.h, width: b.w, height: b.h };
}

/** Точка страницы (pt от левого верхнего угла) → точка PDF. */
export const pdfPoint = (x, y, box) => ({ x: box.x + x, y: box.y + box.height - y });

/** Наконечник стрелки: два крыла у конца (x2, y2), длина — от толщины. */
export function arrowHead(x1, y1, x2, y2, width) {
  const len = Math.max(8, width * 4);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    { x: x2 - len * Math.cos(ang - spread), y: y2 - len * Math.sin(ang - spread) },
    { x: x2 - len * Math.cos(ang + spread), y: y2 - len * Math.sin(ang + spread) },
  ];
}

/** Поворот страницы PDF (/Rotate) → как положить её содержимое на новую
 *  страницу размером с видимую (w × h после поворота): точка и угол для
 *  drawPage. W0 × H0 — размер без поворота. */
export function rotatedPlacement(rotation, W0, H0) {
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  if (r === 90) return { x: 0, y: W0, rotate: -90 };
  if (r === 180) return { x: W0, y: H0, rotate: 180 };
  if (r === 270) return { x: H0, y: 0, rotate: 90 };
  return { x: 0, y: 0, rotate: 0 };
}

/** CSS-цвет (#rgb, #rrggbb, rgb(), rgba()) → { r, g, b, a } в долях 0…1.
 *  Чем выгрузка и печать красят слой: значения токенов темы из
 *  getComputedStyle, а не числа в коде. Непонятное — null. */
export function parseCssColor(s) {
  const v = String(s || '').trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    const a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: clamp(+m[1] / 255, 0, 1), g: clamp(+m[2] / 255, 0, 1), b: clamp(+m[3] / 255, 0, 1), a: clamp(a, 0, 1) };
  }
  return null;
}

// --- «Заменить текст» (волна 2) ------------------------------------------------------

/** База текстового слоя от его верха — доля кегля: в строке высотой
 *  LINE_HEIGHT шрифт Onest (подъём 0,97, спуск 0,305 — из его TTF, это
 *  сверяет юнит) стоит с полуинтерлиньяжем сверху. Так считает и CSS, и
 *  выгрузка (pdfwrite.js: baselineAt). */
export const ONEST_ASC = 0.97;
export const ONEST_DESC = -0.305;
export const TEXT_BASELINE = (LINE_HEIGHT - (ONEST_ASC - ONEST_DESC)) / 2 + ONEST_ASC;
/** Верх строки attrs.lines над её базой — доля кегля (pdftext.js: LINE_ASC). */
export const LINE_ASC = 0.9;
/** Запас замазки вокруг строки, pt. */
export const WHITEOUT_PAD = 1;

/** Строки страницы в порядок: числа — числа, текст — строка, в пределах
 *  страницы. Не массив — null (строки ещё не распознаны). */
export function normalizeLines(lines, page) {
  if (!Array.isArray(lines)) return null;
  const P = { w: num(page && page.w, 595), h: num(page && page.h, 842) };
  const out = [];
  for (const l of lines) {
    if (!l || typeof l.text !== 'string' || !l.text.trim()) continue;
    const size = clamp(num(l.size, 0), 1, FONT_MAX);
    const x = num(l.x, NaN);
    const y = num(l.y, NaN);
    const w = num(l.w, NaN);
    const h = num(l.h, NaN);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    if (x > P.w || y > P.h || x + w < 0 || y + h < 0) continue;
    out.push({ x: round(x), y: round(y), w: round(w), h: round(h), size: round(size), text: l.text.slice(0, TEXT_MAX) });
  }
  return out;
}

/** Строка под точкой (pt страницы): та, чей прямоугольник с запасом slop
 *  её содержит; из нескольких — чья середина ближе по высоте. null — мимо. */
export function lineAt(lines, x, y, slop) {
  const s = slop == null ? 2 : slop;
  let best = null;
  let bestD = Infinity;
  for (const l of lines || []) {
    if (x < l.x - s || x > l.x + l.w + s || y < l.y - s || y > l.y + l.h + s) continue;
    const d = Math.abs(y - (l.y + l.h / 2));
    if (d < bestD) { best = l; bestD = d; }
  }
  return best;
}

/** Замена строки — два слоя: замазка по её прямоугольнику с запасом
 *  WHITEOUT_PAD и текстовый слой с её текстом тем же кеглем, чья база
 *  совпадает с базой строки. Ширина текста — с запасом: Onest бывает шире
 *  исходного шрифта, а перенос строки здесь ни к чему. */
export function replaceOverlays(line, page) {
  const P = { w: page.w, h: page.h };
  const size = line.size;
  const base = line.y + LINE_ASC * size;
  const white = normalizeOverlay({
    id: overlayId(), type: 'whiteout',
    x: line.x - WHITEOUT_PAD, y: line.y - WHITEOUT_PAD, w: line.w + WHITEOUT_PAD * 2, h: line.h + WHITEOUT_PAD * 2,
  }, P);
  const text = normalizeOverlay({
    id: overlayId(), type: 'text', text: line.text,
    x: line.x, y: base - TEXT_BASELINE * size,
    w: Math.min(P.w - line.x, line.w * 1.15 + size * 2), h: size * LINE_HEIGHT,
    font: { size, weight: 'normal', color: 'ink' },
  }, P);
  return [white, text];
}

// --- контекстная панель телефона (host.js, протокол 4) ---------------------------------

/** Страница PDF для панели: tool — режим «Заменить текст» ('replace') или
 *  null (добавить слой — разовое действие, режима у него нет); hasLines —
 *  «Заменить текст» можно нажать: строки есть или ещё не распознаны (кнопка
 *  распознает их из исходника); false — на странице нет текста (скан). */
export function pageContext(attrs, replacing) {
  const a = attrs || {};
  const lines = normalizeLines(a.lines, { w: num(a.w, 595), h: num(a.h, 842) });
  return { tool: replacing ? 'replace' : null, hasLines: lines === null || lines.length > 0 };
}

/** Выделенный слой для панели: вид, цвет (имя: ink или оттенок; у
 *  картинки и замазки — null), размер в pt (кегль текста, толщина рамки и
 *  стрелки; у остальных — null), жирность текста и ступени размера для
 *  меню (FONT_STEPS или STROKE_STEPS; нечего менять — пусто). */
export function layerContext(o) {
  const text = o.type === 'text';
  const stroke = o.type === 'rect' || o.type === 'arrow';
  let color = null;
  if (text) color = o.font.color;
  else if (o.type === 'highlight') color = o.fill.color;
  else if (stroke) color = o.stroke.color;
  return {
    type: o.type,
    color,
    size: text ? o.font.size : (stroke ? o.stroke.width : null),
    bold: text && o.font.weight === 'bold',
    sizes: text ? FONT_STEPS.slice() : (stroke ? STROKE_STEPS.slice() : []),
  };
}

// Сценки пустых экранов на телефоне: разбор общей разметки и краски темы.
//
// Формы сценок — только в core/illustrations.js (побайтная копия файла
// десктопа, scripts/sync-mobile-core.js). Он отдаёт разметку SVG строкой:
// rect, circle и path с классом-ролью и без единого цвета. Здесь она
// разбирается в простые описания { tag, parts, attrs }, которые
// components/ArtScene.js рисует react-native-svg, а краска каждой роли
// берётся из theme.js — так же, как на десктопе её берёт styles.css из
// --art-*. Своих копий форм на телефоне нет.
//
// Чистый модуль без React: гоняется в Node.
import Core from '../core/illustrations.js';

export const ART_VIEWBOX = Core.ART_VIEWBOX;
/** Части сценки — общий список ядра: другой класс в разметке — ошибка. */
export const ART_PARTS = Core.ART_PARTS;
/** Все сценки — список ядра. */
export const ART_SCENES = Core.ART_SCENES;

/** Разметка сценки из ядра. Нет такой — ''. */
export function artMarkup(name) {
  return Core.artShapes(name);
}

const TAG = /<(rect|circle|path)\b([^>]*?)\/>/g;
const ATTR = /([\w-]+)="([^"]*)"/g;
const NUMERIC = new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r']);

/** Разметка → [{ tag, parts, attrs }]. Числа — числами; у скруглённого
 *  прямоугольника ry = rx, как в SVG (react-native-svg сам его не выводит). */
export function parseArt(markup) {
  const out = [];
  for (const m of String(markup || '').matchAll(TAG)) {
    const attrs = {};
    let parts = [];
    for (const [, key, value] of m[2].matchAll(ATTR)) {
      if (key === 'class') parts = value.split(/\s+/).filter(Boolean);
      else attrs[key] = NUMERIC.has(key) ? Number(value) : value;
    }
    if (m[1] === 'rect' && attrs.rx != null && attrs.ry == null) attrs.ry = attrs.rx;
    out.push({ tag: m[1], parts, attrs });
  }
  return out;
}

/** Описания форм сценки по имени. */
export function artElements(name) {
  return parseArt(artMarkup(name));
}

// Роль формы → чем красится. Ключи краски — имена токенов theme.js, а не
// цвета: сценка сама верна обеим темам. Как в styles.css: .es-back — тот же
// лист на 60 %, .es-ink-soft — линия на 55 %, .es-dash — пунктир без
// заливки. Курсор (.es-caret) на телефоне не мигает: пустой экран стоит.
export const ART_PAINT = {
  'es-plate': { fill: 'artPlate' },
  'es-sheet': { fill: 'artSheet' },
  'es-back': { opacity: 0.6 },
  'es-ink': { fill: 'artInk' },
  'es-ink-soft': { fill: 'artInk', opacity: 0.55 },
  'es-dash': { fill: null, stroke: 'artInk', strokeWidth: 1.5, strokeDasharray: '3 3' },
  'es-mark': { fill: 'accent' },
  'es-caret': {},
  'es-on-mark': { fill: 'accentText' },
};

/** Свойства краски формы для react-native-svg из токенов темы. */
export function artPaint(parts, colors) {
  const p = {};
  for (const part of parts) Object.assign(p, ART_PAINT[part]);
  const out = { fill: p.fill ? colors[p.fill] : 'none' };
  if (p.stroke) Object.assign(out, { stroke: colors[p.stroke], strokeWidth: p.strokeWidth, strokeDasharray: p.strokeDasharray });
  if (p.opacity != null) out.opacity = p.opacity;
  return out;
}

/** Рамка контура по его точкам. Годится для контуров из одних пар «x y»
 *  (M, L, Q) — такова искра, ради которой это и нужно: её крутят вокруг
 *  своего центра. H, V и дуги сбили бы пары. */
export function pathBox(d) {
  const nums = (String(d).match(/-?\d*\.?\d+/g) || []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// Теги на телефоне.
//
// Сама логика — в src/core/tags.js, побайтной копии десктопного ядра: восемь
// функций здесь были дословной копией тех же восьми, и держать их двумя
// файлами значило однажды разойтись молча. Теперь за совпадением следит
// tests/unit/mobile-core.test.js.
//
// Теги бывают общие (видны везде) и проектные (tag.projectId) — область
// видимости считает ядро, tagsForProject.
//
// Своё здесь только то, чего на десктопе нет и быть не может, — расчёт цветов
// бейджа: в React Native нет color-mix, и смешивать приходится руками.
import Core from '../core/tags.js';

export const {
  getTag, isGlobalTag, tagsForProject, tagsOf, tagUsage, toggleTag, searchTags, nameTaken, exactMatch, keepKnown,
} = Core;

/** Цвет надписи на бейдже: цвет тега смешивается с цветом текста темы.
 *  Без смешивания на светлой теме ярко-жёлтая надпись на белом давала
 *  контраст 2,8 при пороге 4,5.
 *  @param {string} tagColor — #rrggbb
 *  @param {string} textColor — цвет текста темы, #rrggbb
 *  @param {number} ink — доля цвета тега, 0..1 */
export function badgeInk(tagColor, textColor, ink) {
  const parse = (hex) => {
    const h = String(hex || '').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  };
  const a = parse(tagColor);
  const b = parse(textColor);
  const mix = a.map((v, i) => Math.round(v * ink + b[i] * (1 - ink)));
  return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Подложка бейджа: цвет тега с прозрачностью. */
export function badgeBg(tagColor, alpha) {
  const h = String(tagColor || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Доля цвета в надписи бейджа зависит от темы не для красоты: яркий цвет, годный
// на тёмном фоне, на белом даёт контраст около 2,8 при пороге 4,5, и надпись
// становится нечитаемой.
const INK_DARK = 0.62;
const INK_LIGHT = 0.34;
/** Прозрачность подложки бейджа. */
const BG_ALPHA = 0.16;

/** Подложка и надпись цветного бейджа в данной теме — одна на бейдж тега и
 *  плашку проекта: цвет берётся из данных пользователя, поэтому свой расчёт
 *  у каждого значил бы два разных вида у одного и того же цвета.
 *  @param {string} color — цвет тега или проекта, #rrggbb
 *  @param {string} textColor — colors.text своей темы
 *  @param {'light'|'dark'} mode — useThemeMode()
 *  @returns {{bg: string, ink: string}} */
export function badgeColors(color, textColor, mode) {
  return { bg: badgeBg(color, BG_ALPHA), ink: badgeInk(color, textColor, mode === 'light' ? INK_LIGHT : INK_DARK) };
}

/** Сколько бейджей тегов помещается в одну строку: остальные уходят в «+N».
 *  Чистая арифметика по измеренным ширинам — сами ширины меряет компонент
 *  (TagBadgeFit), потому что от шрифта и масштаба текста их не посчитать.
 *
 *  Влезли все — «+N» нет. Иначе каждый следующий бейдж берётся, только если
 *  после него ещё помещается «+N» на оставшиеся теги. Первый бейдж
 *  показывается всегда, даже если сам не влезает вместе с «+N»: он ужмётся
 *  с многоточием — теги внутри проекта не пропадают совсем.
 *  @param {number[]} widths — ширины бейджей в порядке показа
 *  @param {number} avail — ширина строки
 *  @param {number} gap — зазор между бейджами
 *  @param {function} moreWidth — (сколько осталось) => ширина бейджа «+N»
 *  @returns {number} сколько бейджей показать (0 — только если тегов нет) */
export function fitTagCount(widths, avail, gap, moreWidth) {
  const total = widths.length;
  if (!total) return 0;
  const all = widths.reduce((sum, w, i) => sum + (i ? gap : 0) + Math.min(w, avail), 0);
  if (all <= avail) return total;
  let used = 0;
  let shown = 0;
  for (let i = 0; i < total; i++) {
    const next = used + (i ? gap : 0) + Math.min(widths[i], avail);
    if (next + gap + moreWidth(total - i - 1) > avail) break;
    used = next;
    shown = i + 1;
  }
  return Math.max(1, shown);
}

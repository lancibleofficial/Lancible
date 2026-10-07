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

// Порт src/renderer/core/tags.js. Чистая логика, работает над обычными
// массивами — ни хранилища, ни компонентов.
//
// Теги общие на всё приложение, а не свои у каждого проекта: один и тот же
// тег живёт и на проекте, и на задаче в любом другом проекте.

export const getTag = (tags, id) => tags.find((tg) => tg.id === id) || null;

/** Теги сущности в порядке общего списка, а не в порядке проставления: иначе
 *  одни и те же два тега на разных задачах выглядели бы по-разному. Ссылки на
 *  исчезнувшие теги пропускаются. */
export const tagsOf = (tags, ids) => tags.filter((tg) => (ids || []).includes(tg.id));

/** Сколько сущностей ссылается на тег — и для подписи в настройках, и для
 *  честного предупреждения при удалении. */
export function tagUsage(projects, tasks, tagId) {
  return {
    projects: projects.filter((p) => (p.tagIds || []).includes(tagId)).length,
    tasks: tasks.filter((t) => (t.tagIds || []).includes(tagId)).length,
  };
}

/** Снять или поставить тег. Возвращает новый массив — состояние в zustand
 *  меняется заменой, а не правкой на месте. */
export function toggleTag(ids, id) {
  const cur = ids || [];
  return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
}

/** Отбор по набранному в поиске. Пустой запрос — весь список. */
export function searchTags(tags, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return tags.slice();
  return tags.filter((tg) => String(tg.name || '').toLowerCase().includes(q));
}

/** Есть ли уже тег с таким именем: без учёта регистра и краевых пробелов.
 *  «Срочное» и «срочное» на глаз не различить, и заводить оба бессмысленно. */
export function nameTaken(tags, name, exceptId) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  return tags.some((tg) => tg.id !== exceptId && String(tg.name || '').trim().toLowerCase() === n);
}

/** Точное совпадение имени — по нему решается, предлагать ли «Создать тег». */
export const exactMatch = (tags, name) => {
  const n = String(name || '').trim().toLowerCase();
  return n ? tags.find((tg) => String(tg.name || '').trim().toLowerCase() === n) || null : null;
};

/** Убирает ссылки на несуществующие теги. */
export const keepKnown = (tags, ids) => {
  const known = new Set(tags.map((tg) => tg.id));
  return (Array.isArray(ids) ? ids : []).filter((id) => known.has(id));
};

/** Цвет надписи на бейдже: цвет тега смешивается с цветом текста темы.
 *  В React Native нет color-mix, поэтому смешиваем руками — иначе на светлой
 *  теме ярко-жёлтая надпись на белом давала контраст 2,8 при пороге 4,5.
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

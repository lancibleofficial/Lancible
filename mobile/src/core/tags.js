/* Теги — чистая логика, без DOM и без state.
 *
 * Теги общие на всё приложение, а не свои у каждого проекта (в отличие от
 * статусов задач). Один и тот же тег живёт и на проекте, и на задаче в любом
 * другом проекте — поэтому функции ниже получают весь список тегов и все
 * сущности, которые могут на него ссылаться.
 */
(function (global) {
  const getTag = (tags, id) => tags.find((tg) => tg.id === id) || null;

  /** Теги сущности в том порядке, в каком они лежат в общем списке, а не в
   *  порядке проставления: иначе одни и те же два тега на разных задачах
   *  выглядели бы по-разному. Ссылки на исчезнувшие теги пропускаются. */
  const tagsOf = (tags, ids) => tags.filter((tg) => (ids || []).includes(tg.id));

  /** Сколько сущностей ссылается на тег. Нужно и для подписи в настройках, и
   *  для честного предупреждения при удалении. */
  function tagUsage(projects, tasks, tagId) {
    return {
      projects: projects.filter((p) => (p.tagIds || []).includes(tagId)).length,
      tasks: tasks.filter((t) => (t.tagIds || []).includes(tagId)).length,
    };
  }

  /** Снять или поставить тег. Возвращает новый массив — на месте список не
   *  меняем, чтобы вызывающий сам решил, когда записать. */
  function toggleTag(ids, id) {
    const cur = ids || [];
    return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  }

  /** Отбор по набранному в поиске. Пустой запрос — весь список. */
  function searchTags(tags, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return tags.slice();
    return tags.filter((tg) => String(tg.name || '').toLowerCase().includes(q));
  }

  /** Есть ли уже тег с таким именем. Сравнение без учёта регистра и краевых
   *  пробелов: два тега «Срочное» и «срочное» различить на глаз нельзя, и
   *  заводить оба бессмысленно. */
  function nameTaken(tags, name, exceptId) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return false;
    return tags.some((tg) => tg.id !== exceptId && String(tg.name || '').trim().toLowerCase() === n);
  }

  /** Точное совпадение имени — по нему решается, предлагать ли «Создать тег». */
  const exactMatch = (tags, name) => {
    const n = String(name || '').trim().toLowerCase();
    return n ? tags.find((tg) => String(tg.name || '').trim().toLowerCase() === n) || null : null;
  };

  /** Убирает ссылки на несуществующие теги. Та же чистка есть в migrate, но
   *  там она разовая, при загрузке; здесь — для проверки уже в работе. */
  const keepKnown = (tags, ids) => {
    const known = new Set(tags.map((tg) => tg.id));
    return (Array.isArray(ids) ? ids : []).filter((id) => known.has(id));
  };

  const api = { getTag, tagsOf, tagUsage, toggleTag, searchTags, nameTaken, exactMatch, keepKnown };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

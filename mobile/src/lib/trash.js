// Корзина словами списка (17 октября 2026). Саму корзину ведёт ядро
// (core/oplog.js: удалённое лежит рядом с состоянием 30 дней, trashSweep), а
// какие строки показать и что вернуть вместе — правило экрана, то же, что у
// веба (src/renderer/app.js, раздел «Корзина»): статусы, версии, теги, задачи
// и документы, ушедшие вместе со своим проектом (одним удалением — в пределах
// 10 секунд), отдельными строками не показываются и возвращаются с ним;
// задача удалённого проекта возвращает и проект.

const WITH_PROJECT = ['task', 'status', 'version', 'tag', 'document'];
const TOGETHER_MS = 10000;

/** Записи корзины, которые можно показать (с данными). */
export const trashList = (trash) => (Array.isArray(trash) ? trash : []).filter((x) => x && x.entity && x.data);

/** Проект, вместе с которым запись ушла одним удалением, или null. */
export function trashedWithProject(tr, all) {
  if (!WITH_PROJECT.includes(tr.entity) || !tr.data.projectId) return null;
  const p = all.find((x) => x.entity === 'project' && String(x.entityId) === String(tr.data.projectId));
  if (!p) return null;
  return Math.abs((Date.parse(p.deletedAt) || 0) - (Date.parse(tr.deletedAt) || 0)) <= TOGETHER_MS ? p : null;
}

/** Строки корзины: без ушедшего вместе с проектом, свежие сверху. */
export function trashRows(trash) {
  const all = trashList(trash);
  return all.filter((tr) => !trashedWithProject(tr, all))
    .sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0));
}

/** Что вернуть по строке: сама запись, у проекта — ушедшее с ним, у
 *  остального — его проект, если он тоже в корзине (первым). */
export function trashGroup(trash, entity, entityId) {
  const all = trashList(trash);
  const item = all.find((x) => x.entity === entity && String(x.entityId) === String(entityId));
  if (!item) return [];
  const group = [item];
  if (entity === 'project') group.push(...all.filter((x) => x !== item && trashedWithProject(x, all) === item));
  else if (item.data.projectId) {
    const p = all.find((x) => x.entity === 'project' && String(x.entityId) === String(item.data.projectId));
    if (p) group.unshift(p);
  }
  return group;
}

// Статусы задач на телефоне.
//
// Сама логика лежит в src/core/status.js — это побайтная копия файла
// десктопа, её сверяет tests/unit/mobile-core.test.js. Здесь только обёртки:
// подставляют язык, потому что на десктопе это делает app.js, а не ядро.
// id набора по умолчанию ядро даёт само, постоянные — `${projectId}:st:${key}`
// (17 октября 2026): два устройства, заведшие один проект, не задваивают
// статусы.
import Core from '../core/status.js';
import { t } from './i18n';

export const { STATUS_KINDS, CLOSING_KINDS, DEFAULT_STATUSES } = Core;

export const orderedStatuses = (statuses, projectId) => Core.orderedStatuses(statuses, projectId);
export const planStatusDelete = (statuses, tasks, id) => Core.planStatusDelete(statuses, tasks, id);
export const planTaskDone = (statuses, task, done) => Core.planTaskDone(statuses, task, done);
export const getStatus = (statuses, id) => Core.getStatus(statuses, id);
export const defaultStatusId = (statuses, projectId, done) => Core.defaultStatusId(statuses, projectId, done);
export const isDoneStatus = (statuses, id) => Core.isDoneStatus(statuses, id);
export const isClosedStatus = (statuses, id) => Core.isClosedStatus(statuses, id);

/** Отменена ли задача: закрыта, но не выполнена (вид статуса 'cancelled').
 *  Решает вид статуса, если он известен; иначе — флаг задачи, который ставит
 *  стор вместе со статусом (setTaskStatus). Выполненная отменённой не бывает. */
export function isCancelled(task, statuses = []) {
  if (!task || task.done) return false;
  const status = task.statusId ? Core.getStatus(statuses, task.statusId) : null;
  return status ? status.kind === 'cancelled' : !!task.cancelled;
}

/** Статус в мете строки задачи (TaskRow, TaskListItem) — одно правило на обе.
 *
 *  Пока задача открыта, это её статус с его цветом. Отмеченная — всегда
 *  «выполнено», а цвет не отдаётся (color: null): строка красит такой статус
 *  в серый токен, а не в зелёный цвет «готово» проекта. Название — того
 *  статуса «готово», в котором задача уже стоит, иначе первого «готово» её
 *  проекта (куда её и отправит галочка, planTaskDone), иначе общая подпись
 *  «Выполнено». Так мета меняется сразу по тапу, ещё до записи в стор:
 *  колода сначала наливает галочку (done передан снаружи), потом отмечает.
 *
 *  Отменённая читается так же тихо, серым «Отменено» (вид статуса, а не имя:
 *  оно у каждого проекта своё), и тоже без цвета; cancelled — признак для
 *  строки, которой нужно не зачёркивать название и не показывать срок.
 *  @returns {{name: string, color: string|null, done: boolean, cancelled?: boolean}|null} */
export function rowStatus(statuses, task, done, lang) {
  const current = task.statusId ? getStatus(statuses, task.statusId) : null;
  if (!done && isCancelled(task, statuses)) return { name: t(lang, 'status.kind_cancelled'), color: null, done: true, cancelled: true };
  if (!done) return current ? { name: current.name, color: current.color, done: false } : null;
  // Отмеченная задача читается одинаково во всех проектах: серое «Выполнено»,
  // а не имя завершающего статуса (по умолчанию оно английское — «Done»).
  return { name: t(lang, 'tasks.done_group'), color: null, done: true };
}

/** Набор по умолчанию для нового проекта. Названия переводятся один раз, при
 *  заведении: дальше это обычные пользовательские строки, которые можно
 *  переименовать, и подменять их на смене языка было бы неправильно. */
export function seedProjectStatuses(projectId, lang) {
  return Core.makeProjectStatuses(projectId, (key) => t(lang, `status.default_${key}`));
}

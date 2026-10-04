// Статусы задач на телефоне.
//
// Сама логика лежит в src/core/status.js — это побайтная копия файла
// десктопа, её сверяет tests/unit/mobile-core.test.js. Здесь только обёртки:
// подставляют язык и генератор идентификаторов, потому что на десктопе это
// делает app.js, а не ядро.
import Core from '../core/status.js';
import { uid } from './migrate';
import { t } from './i18n';

export const { STATUS_KINDS, CLOSING_KINDS, DEFAULT_STATUSES } = Core;

export const orderedStatuses = (statuses, projectId) => Core.orderedStatuses(statuses, projectId);
export const statusesOfKind = (statuses, projectId, kind) => Core.statusesOfKind(statuses, projectId, kind);
export const planStatusDelete = (statuses, tasks, id) => Core.planStatusDelete(statuses, tasks, id);
export const planTaskDone = (statuses, task, done) => Core.planTaskDone(statuses, task, done);
export const getStatus = (statuses, id) => Core.getStatus(statuses, id);
export const defaultStatusId = (statuses, projectId, done) => Core.defaultStatusId(statuses, projectId, done);
export const isDoneStatus = (statuses, id) => Core.isDoneStatus(statuses, id);
export const isClosedStatus = (statuses, id) => Core.isClosedStatus(statuses, id);

/** Набор по умолчанию для нового проекта. Названия переводятся один раз, при
 *  заведении: дальше это обычные пользовательские строки, которые можно
 *  переименовать, и подменять их на смене языка было бы неправильно. */
export function seedProjectStatuses(projectId, lang) {
  return Core.makeProjectStatuses(projectId, (key) => t(lang, `status.default_${key}`), uid);
}

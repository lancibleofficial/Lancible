// Дедлайны и напоминания. Ровно та же модель, что на десктопе/вебе
// (src/renderer/app.js) — поля едут в одном JSON-блоке синхронизации, так что
// расхождение в именах или в трактовке сразу ломало бы кросс-платформенность:
//
//   dueAt           ISO | null   — сам дедлайн
//   remindOffsetMin число | null — за сколько минут до дедлайна напомнить
//                                  (0 = ровно в срок); при переносе дедлайна
//                                  напоминание едет вместе с ним
//   remindAt        ISO | null   — своё время напоминания, когда смещение снято
//   notifiedAt      ISO | null   — уже уведомили, повторно не будем
import { t } from './i18n';
import { fmtDateShort } from './format';

/** Пресеты в том же порядке и с теми же значениями, что в десктопной версии. */
export const REMIND_PRESETS = [null, 0, 15, 60, 180, 1440, 'custom'];
export const REMIND_LABEL = {
  null: 'remind.none', 0: 'remind.at', 15: 'remind.15m',
  60: 'remind.1h', 180: 'remind.3h', 1440: 'remind.1d', custom: 'remind.custom',
};

/** Ключ текущего варианта: 'null' | 'custom' | число минут строкой. */
export function remindKey(task) {
  if ((task.remindOffsetMin === null || task.remindOffsetMin === undefined) && task.remindAt) return 'custom';
  return String(task.remindOffsetMin === undefined ? null : task.remindOffsetMin);
}

/** Момент напоминания: смещение от дедлайна либо своё время. */
export function reminderTime(task) {
  if (task.remindOffsetMin !== null && task.remindOffsetMin !== undefined && task.dueAt) {
    return new Date(new Date(task.dueAt).getTime() - task.remindOffsetMin * 60000);
  }
  return task.remindAt ? new Date(task.remindAt) : null;
}

/** 'overdue' | 'soon' (в пределах суток) | 'later' | null.
 *  У выполненной задачи дедлайна нет — он уже не горит. */
export function dueState(task) {
  if (!task.dueAt || task.done) return null;
  const diff = new Date(task.dueAt).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  return diff <= 86400000 ? 'soon' : 'later';
}

/** Короткая подпись для карточки задачи и ленты уведомлений. */
export function dueShort(task, langCode) {
  if (!task.dueAt) return '';
  const due = new Date(task.dueAt);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(new Date())) / 86400000);
  if (dueState(task) === 'overdue') return t(langCode, 'due.overdue');
  if (days === 0) return t(langCode, 'due.today');
  if (days === 1) return t(langCode, 'due.tomorrow');
  if (days > 1 && days < 7) return t(langCode, 'due.in_days', { n: days });
  return fmtDateShort(due, langCode);
}

/** Лента уведомлений: просроченные, дедлайн в пределах суток, и те, у кого
 *  напоминание уже сработало. Ничего не хранит — считается из задач. */
export function notificationFeed(tasks, seenAtIso) {
  const now = Date.now();
  const seen = seenAtIso ? new Date(seenAtIso).getTime() : 0;
  const out = [];
  for (const task of tasks) {
    if (task.done || !task.dueAt) continue;
    const due = new Date(task.dueAt).getTime();
    const rt = reminderTime(task);
    const fired = !!rt && rt.getTime() <= now;
    let kind = null;
    let at = due;
    if (due < now) kind = 'overdue';
    else if (due - now <= 86400000) { kind = 'soon'; at = due - 86400000; }
    else if (fired) { kind = 'reminder'; at = rt.getTime(); }
    if (!kind) continue;
    out.push({ task, kind, at, due, unread: at > seen });
  }
  return out.sort((a, b) => a.due - b.due);
}

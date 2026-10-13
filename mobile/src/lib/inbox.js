// Лента «Задачи» — задачи всех проектов двумя разделами по закреплению:
// Сейчас (идёт таймер) · Закреплённые · Незакреплённые. Срочность разделов не
// делит: дедлайн только упорядочивает задачи внутри раздела (просроченные и
// ближайшие сверху, без срока в конце), а просрочку видно в самой строке.
// Выполненные — следующий раздел, отменённые — самый последний, под ними
// (решение пользователя, 12 октября); экран «Задачи» просит закрытые всегда
// (showDone), лента без этой просьбы их прячет. Внутри раздела свежеотмеченные
// сверху: задача, которую только что отметили, уезжает недалеко.
//
// Фильтры ленты (проекты, срок, вид статуса) — filterInbox: тоже чистая
// функция, срок и «просрочено» решает ядро (core/due.js, core/agenda.js).
//
// Чистая функция без React и без стора: гоняется в Node.
import Due from '../core/due.js';
import Agenda from '../core/agenda.js';
import Status from '../core/status.js';
import { isCancelled } from './statuses';

export const INBOX_GROUPS = ['now', 'pinned', 'unpinned', 'done', 'cancelled'];

/** Срок в фильтре ленты, в порядке показа. 'any' — без отбора. */
export const DUE_FILTERS = ['any', 'overdue', 'today', 'week', 'none'];

/** Сколько календарных дней, считая сегодняшний, значит «на этой неделе». */
const WEEK_DAYS = 7;

const dueMsOf = (task) => {
  const ms = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Подходит ли задача под срок. Просрочку решает ядро (dueState: выполненная
 *  не просрочена), «сегодня» и «неделя» — календарные дни от местной
 *  полуночи (daysBetween), как «завтра» в подписи строки. Нечитаемый дедлайн
 *  — как отсутствующий. */
export function matchesDue(task, mode, now = Date.now()) {
  if (!mode || mode === 'any') return true;
  const ms = dueMsOf(task);
  if (mode === 'none') return ms == null;
  if (ms == null) return false;
  if (mode === 'overdue') return Due.dueState(task, now) === 'overdue';
  const days = Agenda.daysBetween(now, ms);
  return mode === 'today' ? days === 0 : days >= 0 && days < WEEK_DAYS;
}

/** Вид статуса задачи (STATUS_KINDS). Выполненная — всегда 'done'; без
 *  статуса — 'todo', как у defaultStatusId для незавершённой. */
export function statusKindOf(task, statuses) {
  if (task.done) return 'done';
  const status = task.statusId ? Status.getStatus(statuses, task.statusId) : null;
  return status ? status.kind : 'todo';
}

/** Отбор ленты: проекты, срок и виды статусов сходятся по «и»; пустой набор
 *  — без отбора по этому признаку.
 *  @param opts — { projectIds, due, kinds, statuses, now } */
export function filterInbox(tasks, { projectIds = [], due = 'any', kinds = [], statuses = [], now = Date.now() } = {}) {
  return tasks.filter((task) => (
    (!projectIds.length || projectIds.includes(task.projectId))
    && matchesDue(task, due, now)
    && (!kinds.length || kinds.includes(statusKindOf(task, statuses)))
  ));
}

/** Ключ группы одной задачи. Отменённая — в своей группе, закреплена она или
 *  нет; statuses нужны, чтобы узнать её по виду статуса (без них — по флагу). */
export function inboxGroupOf(task, { activeTimer, statuses }) {
  if (activeTimer && activeTimer.taskId === task.id) return 'now';
  if (task.done) return 'done';
  if (isCancelled(task, statuses)) return 'cancelled';
  return task.pinnedAt ? 'pinned' : 'unpinned';
}

/** Группы ленты. Внутри группы — по дедлайну, потом по свежести правки.
 *  @param tasks — уже отобранные фильтром (проект, версия)
 *  @param ctx — { activeTimer, showDone, statuses } */
export function inboxGroups(tasks, ctx) {
  const buckets = new Map(INBOX_GROUPS.map((k) => [k, []]));
  for (const task of tasks) {
    const key = inboxGroupOf(task, ctx);
    if ((key === 'done' || key === 'cancelled') && !ctx.showDone) continue;
    buckets.get(key).push(task);
  }
  // Нечитаемый дедлайн — как отсутствующий: в конец, а не NaN в сортировку.
  const dueMs = (task) => {
    const ms = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Infinity;
  };
  const updMs = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
  // Выполненные — по времени отметки, свежие сверху; дедлайн им уже не важен.
  const doneMs = (task) => {
    const ms = task.doneAt ? new Date(task.doneAt).getTime() : NaN;
    return Number.isFinite(ms) ? ms : updMs(task);
  };
  for (const [key, list] of buckets) {
    if (key === 'done') list.sort((a, b) => (doneMs(b) - doneMs(a)) || (updMs(b) - updMs(a)));
    // Отменённые — тоже свежие сверху: срок им уже не важен.
    else if (key === 'cancelled') list.sort((a, b) => updMs(b) - updMs(a));
    else list.sort((a, b) => (dueMs(a) - dueMs(b)) || (updMs(b) - updMs(a)));
  }
  return INBOX_GROUPS
    .map((key) => ({ key, tasks: buckets.get(key) }))
    .filter((g) => g.tasks.length);
}

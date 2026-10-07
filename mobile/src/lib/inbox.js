// Лента «Задачи» — задачи всех проектов по срочности: Сейчас (идёт
// таймер) · Сегодня (закреплённые и дедлайн сегодня) · Завтра · На неделе ·
// Позже · Без срока. Выполненные не показываются, пока не попросят.
//
// Чистая функция без React и без стора: гоняется в Node.
const DAY = 86400000;

const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export const INBOX_GROUPS = ['now', 'today', 'tomorrow', 'week', 'later', 'nodue', 'done'];

/** Ключ группы одной задачи. */
export function inboxGroupOf(task, { now, activeTimer }) {
  if (activeTimer && activeTimer.taskId === task.id) return 'now';
  if (task.done) return 'done';
  if (task.pinnedAt) return 'today';
  if (!task.dueAt) return 'nodue';
  const due = new Date(task.dueAt).getTime();
  if (!Number.isFinite(due)) return 'nodue';
  const today = startOfDay(now);
  const dueDay = startOfDay(due);
  if (dueDay <= today) return 'today';
  if (dueDay === today + DAY) return 'tomorrow';
  if (dueDay < today + 7 * DAY) return 'week';
  return 'later';
}

/** Группы ленты. Внутри группы — по дедлайну, потом по свежести правки.
 *  @param tasks — уже отобранные фильтром (проект, версия)
 *  @param ctx — { now, activeTimer, showDone } */
export function inboxGroups(tasks, ctx) {
  const buckets = new Map(INBOX_GROUPS.map((k) => [k, []]));
  for (const task of tasks) {
    const key = inboxGroupOf(task, ctx);
    if (key === 'done' && !ctx.showDone) continue;
    buckets.get(key).push(task);
  }
  const dueMs = (task) => (task.dueAt ? new Date(task.dueAt).getTime() : Infinity);
  const updMs = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
  for (const list of buckets.values()) {
    list.sort((a, b) => (dueMs(a) - dueMs(b)) || (updMs(b) - updMs(a)));
  }
  return INBOX_GROUPS
    .map((key) => ({ key, tasks: buckets.get(key) }))
    .filter((g) => g.tasks.length);
}

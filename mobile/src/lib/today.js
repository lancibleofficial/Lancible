// Чистая логика «Сегодня» — без React и без стора, чтобы гонять в Node.
// Порт recentProjects() и todaySessions()/renderDayIsland() из app.js.
import Agenda from '../core/agenda.js';

/** Проекты по последней записи времени, свежие первыми; без записей — в
 *  порядке создания (новые выше). Как recentProjects() на вебе. */
export function recentProjects(projects, tasks, limit) {
  const last = new Map();
  for (const task of tasks) {
    for (const sess of task.sessions || []) {
      const e = new Date(sess.end || sess.start).getTime();
      if (e > (last.get(task.projectId) || 0)) last.set(task.projectId, e);
    }
  }
  return projects
    .map((p) => ({ p, last: last.get(p.id) || 0, created: new Date(p.createdAt || 0).getTime() }))
    .sort((a, b) => (b.last - a.last) || (b.created - a.created))
    .slice(0, limit)
    .map((x) => x.p);
}

/** Записи сегодняшнего дня вместе с идущей — для полосы по часам. Запись
 *  через полночь режется ядром по дням, поэтому ночная работа видна и в
 *  том дне, где закончилась. */
export function todayStrip(tasks, activeTimer, now) {
  const dayStart = Agenda.startOfDayMs(now);
  const dayEnd = dayStart + Agenda.DAY;
  const items = Agenda.sessionSegments(tasks, dayStart, dayEnd)
    .map((seg) => ({ taskId: seg.taskId, start: seg.start, end: seg.end, running: false }));
  if (activeTimer) {
    const startedAt = new Date(activeTimer.startedAt).getTime();
    if (startedAt < dayEnd && now > dayStart) {
      items.push({ taskId: activeTimer.taskId, start: Math.max(startedAt, dayStart), end: now, running: true });
    }
  }
  items.sort((a, b) => a.start - b.start);
  let h0 = 8;
  let h1 = 20;
  for (const it of items) {
    h0 = Math.min(h0, new Date(it.start).getHours());
    h1 = Math.max(h1, Math.min(24, new Date(it.end).getHours() + 1));
  }
  const span = (h1 - h0) * 60;
  const minOf = (ms) => (ms - dayStart) / 60000 - h0 * 60;
  const pct = (m) => Math.max(0, Math.min(100, (m / span) * 100));
  const blocks = items.map((it) => {
    const left = pct(minOf(it.start));
    return { ...it, left, width: Math.max(0.6, pct(minOf(it.end)) - left) };
  });
  const nowMin = minOf(now);
  return { h0, h1, blocks, nowPct: nowMin >= 0 && nowMin <= span ? pct(nowMin) : null };
}


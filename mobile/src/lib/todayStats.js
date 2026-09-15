import { sessionMoney } from './format';

function isToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

// Общий расчёт "сегодня" для карточек на Home (см. HomeScreen.js) — раньше
// жил только в StatsScreen.js, вынесен сюда, чтобы Home тоже мог его
// использовать без дублирования логики.
export function computeTodayStats(tasks, activeTimer, hourlyRate) {
  let ms = 0;
  let money = 0;
  for (const task of tasks) {
    for (const s of task.sessions || []) {
      if (isToday(s.end || s.start)) { ms += s.ms; money += sessionMoney(s, task, hourlyRate); }
    }
  }
  if (activeTimer && isToday(activeTimer.startedAt)) {
    const runMs = Date.now() - new Date(activeTimer.startedAt).getTime();
    const runningTask = tasks.find((task) => task.id === activeTimer.taskId);
    ms += runMs;
    if (runningTask) money += (runMs / 3_600_000) * (runningTask.rate ?? hourlyRate ?? 0);
  }
  return { todayMs: ms, todayMoney: money };
}

// Порт математики календаря из src/renderer/app.js:698-701,751-777,1722-1727 —
// чистые функции над списком задач, без обращений к DOM/состоянию.
import { sessionMoney } from './format';

const pad2 = (n) => String(n).padStart(2, '0');

export function dayKey(d) {
  d = new Date(d);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function allSessionPairs(tasks) {
  const out = [];
  for (const task of tasks) for (const s of task.sessions || []) out.push({ task, s });
  return out;
}

/** Map дня ('YYYY-MM-DD') -> {ms, money, count} по началу сессии. */
export function aggregateDays(tasks, hourlyRate) {
  const map = new Map();
  for (const { task, s } of allSessionPairs(tasks)) {
    const k = dayKey(s.start);
    let e = map.get(k);
    if (!e) { e = { ms: 0, money: 0, count: 0 }; map.set(k, e); }
    e.ms += s.ms;
    e.money += sessionMoney(s, task, hourlyRate);
    e.count += 1;
  }
  return map;
}

/** Сумма за диапазон дат [from, to] включительно. */
export function rangeAgg(tasks, hourlyRate, from, to) {
  let ms = 0;
  let money = 0;
  for (const { task, s } of allSessionPairs(tasks)) {
    const d = new Date(s.start);
    if (d >= from && d <= to) { ms += s.ms; money += sessionMoney(s, task, hourlyRate); }
  }
  return { ms, money };
}

/** Сессии одного дня, по времени начала — для панели дня. */
export function sessionsOfDay(tasks, key) {
  return allSessionPairs(tasks)
    .filter(({ s }) => dayKey(s.start) === key)
    .sort((a, b) => new Date(a.s.start) - new Date(b.s.start));
}

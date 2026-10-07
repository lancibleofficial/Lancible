// Записи времени и правила повторения на телефоне — тонкий слой над ядром.
//
// Сами правила — в src/core/money.js (planSessionEdit) и src/core/repeat.js;
// здесь то, что на десктопе лежит в app.js и не зависит от DOM: разбор
// даты и двух времён в отрезок, пресеты повторения.
import Repeat from '../core/repeat.js';

export const pad2 = (n) => String(n).padStart(2, '0');

/** «ЧЧ:ММ» из даты или миллисекунд. */
export const hm = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
};

/** Дата и два времени — в отрезок. Конец не позже начала значит «через
 *  полночь»: ночная запись иначе схлопывалась бы в ноль. Тот же разбор,
 *  что spanFromParts на десктопе. */
export function spanFromParts(dateKey, startHm, endHm) {
  const dparts = (dateKey || '').split('-').map(Number);
  const sp = (startHm || '').split(':').map(Number);
  const ep = (endHm || '').split(':').map(Number);
  if (dparts.length !== 3 || sp.length < 2 || ep.length < 2 || dparts.some(Number.isNaN) || sp.some(Number.isNaN) || ep.some(Number.isNaN)) return null;
  const start = new Date(dparts[0], dparts[1] - 1, dparts[2], sp[0], sp[1]);
  let end = new Date(dparts[0], dparts[1] - 1, dparts[2], ep[0], ep[1]);
  if (end <= start) end = new Date(end.getTime() + 24 * 3_600_000);
  return { start, end, ms: end - start };
}

/** Короче минуты запись не записывается: её нечем ухватить и не о чем
 *  отчитываться. */
export const MIN_SESSION_MS = 60_000;

/** Готовое правило из пресета меню: «каждый день», «по будням»… — как
 *  presetRule на десктопе. */
export function presetRule(freq, weekdays) {
  return {
    freq,
    every: 1,
    weekdays: weekdays || [],
    monthMode: 'day',
    from: 'schedule',
    keepHistory: false,
    ends: { kind: 'never', count: 10, at: null },
    done: 0,
  };
}

/** Совпадает ли правило задачи с пресетом — чтобы пометить его в меню. */
export function isPresetRule(rule, freq, weekdays) {
  const cur = Repeat.normalizeRepeat(rule);
  return !!cur && cur.freq === freq && cur.every === 1
    && cur.ends.kind === 'never' && !cur.keepHistory && cur.from === 'schedule'
    && JSON.stringify(cur.weekdays) === JSON.stringify(weekdays || []);
}

export const REPEAT_PRESETS = [
  { key: 'daily', freq: 'day' },
  { key: 'weekly', freq: 'week' },
  { key: 'weekdays_preset', freq: 'week', weekdays: [1, 2, 3, 4, 5] },
  { key: 'monthly', freq: 'month' },
  { key: 'yearly', freq: 'year' },
];

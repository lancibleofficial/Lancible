// Начало отсчёта правила «повторять» (reminder.start). Движок
// (core/reminders.js) считает вхождения от start и не показывает те, что
// раньше него, поэтому start решает, о чём напомнят первым и не всплывёт ли
// вчерашнее сразу после сохранения.
//
//   • «каждый день» и «по дням недели» — start это сейчас: правило, заведённое
//     в 15:00 «каждый день в 09:00», сегодня молчит, а первым будет завтра;
//   • «каждый месяц» — число месяца берётся у самого start (describeReminder),
//     поэтому start обязан быть именно этим числом. Берётся день первого
//     вхождения, которое ещё впереди, с полуночи — само вхождение в свои часы
//     не отрезается. Если число в том месяце короче (31-е в ноябре — 30-е, без
//     сползания), start берётся в последнем из прошлых месяцев, где число есть,
//     в конце суток: вхождение того дня уже прошло и не всплывёт, а следующие
//     (30 ноября, 31 декабря) считаются от него.
const MIN_DAY = 1;
const MAX_DAY = 31;

/** ISO начала отсчёта.
 *  @param {'day'|'week'|'month'} freq
 *  @param {number} monthDay — число месяца 1…31 (только для month)
 *  @param {string} time — 'ЧЧ:ММ'
 *  @param {number} [now] */
export function repeatStart(freq, monthDay, time, now = Date.now()) {
  if (freq !== 'month') return new Date(now).toISOString();
  const day = Math.min(MAX_DAY, Math.max(MIN_DAY, Math.round(monthDay) || MIN_DAY));
  const [h, m] = time.split(':').map(Number);
  const base = new Date(now);
  for (let k = 0; k < 14; k += 1) {
    const y = base.getFullYear();
    const mo = base.getMonth() + k;
    const last = new Date(y, mo + 1, 0).getDate();
    const d = Math.min(day, last);
    if (new Date(y, mo, d, h, m).getTime() <= now) continue;
    if (d === day) return new Date(y, mo, day).toISOString();
    // Число короче месяца: ближайший прошлый месяц, где оно есть (не дальше
    // чем на 12 назад — в году всегда есть месяц на 31 день).
    for (let j = 1; j <= 12; j += 1) {
      if (new Date(y, mo - j, day).getDate() === day) return new Date(y, mo - j, day, 23, 59, 59).toISOString();
    }
  }
  return new Date(now).toISOString();
}

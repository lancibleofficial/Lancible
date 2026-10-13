// Слова напоминаний: подпись чипа на странице задачи и строки ленты, текст
// системного уведомления. Самих правил здесь нет — они в core/reminders.js
// (describeReminder отдаёт структуру, тексты собирает телефон).
import Reminders from '../core/reminders.js';
import { t, pluralForm } from './i18n';
import { fmtDateShort, fmtWhen } from './format';
import { hm } from './sessions';
import { ruleText, rangeText } from './slotText';

export const UNIT_KEY = { min: 'remind.unit_min', hour: 'remind.unit_hour', day: 'remind.unit_day' };
const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

/** Единица рядом с числом: «мин» и «ч» сокращены, дни — словом по числу
 *  («1 день», «2 дня», «5 дней»). Переключатель единиц в листе берёт
 *  сокращения из UNIT_KEY напрямую, без числа. */
const unitText = (lang, n, unit) => (unit === 'day' ? pluralForm(lang, n, 'plural.day') : t(lang, UNIT_KEY[unit]));

/** «15 мин», «2 ч», «1 день» — смещение в той единице, в которой его ввели. */
export const offsetText = (lang, n, unit) => `${n} ${unitText(lang, n, unit)}`;

/** Дни недели по порядку с понедельника: «Пн, Ср». */
const daysText = (days, lang) => [...days]
  .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  .map((d) => t(lang, WEEKDAY_KEY[d]))
  .join(', ');

/** Напоминание словами: «За 15 мин до начала», «В момент дедлайна»,
 *  «12 окт., 09:00», «По Пн, Ср в 09:00», «Каждый день в 09:00»,
 *  «Каждый месяц 5-го в 09:00». */
export function reminderLabel(rem, lang) {
  const d = Reminders.describeReminder(rem);
  if (!d) return '';
  if (d.kind === 'before') {
    if (d.offsetMin === 0) return t(lang, d.anchor === 'start' ? 'remind.at_start' : 'remind.at');
    return t(lang, d.anchor === 'start' ? 'remind.before_start_n' : 'remind.before_due_n', { n: d.n, unit: unitText(lang, d.n, d.unit) });
  }
  if (d.kind === 'at') return `${fmtDateShort(d.at, lang)}, ${hm(d.at)}`;
  // Правило, которого экран телефона не собирает (раз в две недели, год), —
  // словами правила и временем.
  if (d.every !== 1 || !['day', 'week', 'month'].includes(d.freq)) return `${ruleText(rem.rule, lang)}, ${d.time}`;
  if (d.freq === 'day') return t(lang, 'remind.daily_at', { time: d.time });
  if (d.freq === 'month') return t(lang, 'remind.monthly_at', { day: d.monthDay, time: d.time });
  // Недели без дней — день недели начала.
  const days = d.weekdays.length ? d.weekdays : [new Date(rem.start).getDay()];
  return t(lang, 'remind.weekly_at', { days: daysText(days, lang), time: d.time });
}

/** Заголовок и текст системного уведомления записи pendingReminders.
 *  «Через 15 мин: Вёрстка» и под ним часы вхождения или срок; в момент —
 *  просто название задачи. Разовое и повторяющееся — название и «Напоминание». */
export function notificationContent(entry, task, lang) {
  const name = task.title || t(lang, 'task.no_name');
  if (entry.kind !== 'before') return { title: name, body: t(lang, 'notif.reminder') };
  const rem = Reminders.remindersOf(task).find((r) => r.id === entry.reminderId);
  const d = rem ? Reminders.describeReminder(rem) : null;
  const title = d && d.n > 0 ? t(lang, 'notif.in_n', { n: d.n, unit: unitText(lang, d.n, d.unit), title: name }) : name;
  const body = entry.anchor === 'start'
    ? `${t(lang, 'notif.slot')} · ${rangeText(entry.start, entry.end)}`
    : `${t(lang, 'due.label')}: ${fmtWhen(new Date(entry.start).toISOString(), lang)}`;
  return { title, body };
}

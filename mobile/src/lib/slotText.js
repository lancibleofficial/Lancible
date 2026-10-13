// Подписи «времени работы» и повторов: общие для страницы задачи, листа
// отрезка и «Сегодня». Самих правил здесь нет — они в core/slots.js и
// core/repeat.js; здесь только слова и подгонка даты под выбранные дни.
import Repeat from '../core/repeat.js';
import { t, LOCALE_MAP } from './i18n';
import { capFirst } from './format';
import { dayKey, keyToDate, addDays } from './calendarMath';
import { hm } from './sessions';

const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

/** «ЧЧ:ММ–ЧЧ:ММ» из двух моментов (ISO или миллисекунды). */
export const rangeText = (start, end) => `${hm(start)}–${hm(end)}`;

/** Правило словами: «Каждую неделю по Пн, Ср». Пусто — правила нет. */
export function ruleText(rule, lang) {
  const desc = Repeat.describeRepeat(rule);
  if (!desc) return '';
  return capFirst(t(lang, desc.key, {
    ...desc.vars,
    days: (desc.vars.days || []).map((d) => t(lang, WEEKDAY_KEY[d])).join(', '),
  }));
}

/** Когда отрезок. Своего повтора у отрезка нет (12 октября 2026): правило
 *  одно — у задачи (core/slots.js, slotRule), и отрезки повторяются вместе с
 *  ней. Без правила — день («Сб, 18 окт»); каждую неделю по дням — просто
 *  дни («Пн, Ср»: «по» и «каждую неделю» в узкой строке лишние); иное
 *  правило — словами («Каждый день»).
 *  @param rule правило задачи — Slots.slotRule(task) */
export function slotWhen(slot, lang, rule = null) {
  const weekly = rule && rule.freq === 'week' && (rule.every || 1) === 1 && rule.weekdays && rule.weekdays.length;
  if (weekly) return [...rule.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => t(lang, WEEKDAY_KEY[d])).join(', ');
  if (rule) return ruleText(rule, lang);
  return capFirst(new Date(slot.start).toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }));
}

/** Время работы задачи одной строкой — значение строки «Время работы» в
 *  сведениях: первый отрезок и сколько ещё («Пн, Ср 10:00–12:00 +1»,
 *  «Сб, 17 окт. 10:00–12:00»). Повтор задачи виден своей строкой
 *  «Повторение», поэтому здесь из правила — только дни недели, иначе дата
 *  первого отрезка. Отрезков нет — пусто.
 *  @param rule правило задачи — Slots.slotRule(task) */
export function slotsSummary(slots, lang, rule = null) {
  if (!slots || !slots.length) return '';
  const first = slots[0];
  const weekly = rule && rule.freq === 'week' && (rule.every || 1) === 1 && rule.weekdays && rule.weekdays.length;
  const when = slotWhen(first, lang, weekly ? rule : null);
  const more = slots.length > 1 ? ` +${slots.length - 1}` : '';
  return `${when} ${rangeText(first.start, first.end)}${more}`;
}

/** Первое вхождение еженедельного правила с днями считается, только если его
 *  день в списке (core/slots.js). Лист не оставляет это на совести
 *  пользователя: дата двигается к ближайшему подходящему дню вперёд.
 *  @param {string} dateKey 'ГГГГ-ММ-ДД' → то же, возможно позже */
export function fitSlotDay(dateKey, rule) {
  const days = rule && rule.freq === 'week' ? rule.weekdays : [];
  if (!days || !days.length) return dateKey;
  let day = keyToDate(dateKey);
  for (let i = 0; i < 7 && !days.includes(day.getDay()); i += 1) day = addDays(day, 1);
  return dayKey(day);
}

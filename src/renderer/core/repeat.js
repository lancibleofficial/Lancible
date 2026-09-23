/* Повторение задач — чистая логика, без DOM и без state.
 *
 * Правило лежит в task.repeat и описывает, когда задача возвращается:
 *
 *   {
 *     freq: 'day' | 'week' | 'month' | 'year',
 *     every: 1,                      // каждые N дней/недель/месяцев/лет
 *     weekdays: [1, 3, 5],           // дни недели для 'week', 0 — воскресенье
 *     monthMode: 'day' | 'weekday',  // «15 числа» или «третий вторник»
 *     from: 'schedule' | 'done',     // отсчёт от срока или от дня закрытия
 *     keepHistory: false,            // оставлять ли выполненную копию
 *     ends: { kind: 'never' | 'after' | 'on', count: 10, at: '2026-12-31' },
 *     done: 0,                       // сколько раз уже выполнено
 *   }
 *
 * Время суток берётся у исходного срока: правило задаёт день, а не час.
 */
(function (global) {
  const DAY = 86400000;
  const FREQS = ['day', 'week', 'month', 'year'];
  const MAX_EVERY = 99;

  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  };

  /** Приводит правило к рабочему виду. Всё, что не разобрали, заменяется
   *  умолчанием: правило приходит из синхронизации и с другого устройства,
   *  где оно могло быть записано другой версией приложения. */
  function normalizeRepeat(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const freq = FREQS.includes(rule.freq) ? rule.freq : 'week';
    const every = clampInt(rule.every, 1, MAX_EVERY, 1);
    let weekdays = Array.isArray(rule.weekdays)
      ? [...new Set(rule.weekdays.map((d) => clampInt(d, 0, 6, 0)))].sort((a, b) => a - b)
      : [];
    if (freq !== 'week') weekdays = [];
    const monthMode = rule.monthMode === 'weekday' ? 'weekday' : 'day';
    const from = rule.from === 'done' ? 'done' : 'schedule';
    const ends = rule.ends && typeof rule.ends === 'object' ? rule.ends : {};
    const kind = ['never', 'after', 'on'].includes(ends.kind) ? ends.kind : 'never';
    return {
      freq,
      every,
      weekdays,
      monthMode: freq === 'month' ? monthMode : 'day',
      from,
      keepHistory: !!rule.keepHistory,
      ends: {
        kind,
        count: clampInt(ends.count, 1, 999, 10),
        at: typeof ends.at === 'string' ? ends.at : null,
      },
      done: clampInt(rule.done, 0, 100000, 0),
    };
  }

  const startOfDay = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const mondayOf = (ms) => {
    const d = new Date(startOfDay(ms));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const addDays = (ms, n) => {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };
  const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

  /** Переносит время суток со старого момента на новую дату. Правило задаёт
   *  день, а час остаётся тем, каким его поставил человек. */
  function withTimeOf(dateMs, timeMs) {
    const src = new Date(timeMs);
    const d = new Date(dateMs);
    d.setHours(src.getHours(), src.getMinutes(), src.getSeconds(), 0);
    return d.getTime();
  }

  /** Какой по счёту этот день недели внутри своего месяца: 1 — первый
   *  вторник, 3 — третий. Нужно для правила «третий вторник каждого месяца». */
  const weekdayOrdinal = (ms) => Math.floor((new Date(ms).getDate() - 1) / 7) + 1;

  /** Дата N-го такого-то дня недели в месяце. Если пятого нет — берётся
   *  последний: «пятая пятница» есть не в каждом месяце, и пропускать такой
   *  месяц значило бы молча терять повторение. */
  function nthWeekdayOfMonth(year, month, weekday, ordinal) {
    const firstDow = new Date(year, month, 1).getDay();
    const firstMatch = 1 + ((weekday - firstDow + 7) % 7);
    let day = firstMatch + ((ordinal - 1) * 7);
    const dim = daysInMonth(year, month);
    while (day > dim) day -= 7;
    return new Date(year, month, day).getTime();
  }

  /** Следующий срок после base по правилу. null — серия закончилась.
   *
   *  @param {number} base — от чего считать: сам срок или день закрытия,
   *    это решает поле from, а выбирает вызывающий. */
  function nextDue(rule, base) {
    const r = normalizeRepeat(rule);
    if (!r || !Number.isFinite(base)) return null;

    let next = null;
    if (r.freq === 'day') {
      next = addDays(base, r.every);
    } else if (r.freq === 'week') {
      if (!r.weekdays.length) {
        next = addDays(base, 7 * r.every);
      } else {
        // Сначала ищем подходящий день внутри той же недели.
        const weekEnd = mondayOf(base) + (7 * DAY);
        let found = null;
        for (let d = addDays(startOfDay(base), 1); d < weekEnd; d = addDays(d, 1)) {
          if (r.weekdays.includes(new Date(d).getDay())) { found = d; break; }
        }
        if (found == null) {
          // Не нашли — прыгаем через every недель и берём первый подходящий.
          const weekStart = addDays(mondayOf(base), 7 * r.every);
          for (let i = 0; i < 7; i += 1) {
            const d = addDays(weekStart, i);
            if (r.weekdays.includes(new Date(d).getDay())) { found = d; break; }
          }
        }
        next = found;
      }
    } else if (r.freq === 'month') {
      const src = new Date(base);
      if (r.monthMode === 'weekday') {
        const weekday = src.getDay();
        const ordinal = weekdayOrdinal(base);
        const target = new Date(src.getFullYear(), src.getMonth() + r.every, 1);
        next = nthWeekdayOfMonth(target.getFullYear(), target.getMonth(), weekday, ordinal);
      } else {
        const target = new Date(src.getFullYear(), src.getMonth() + r.every, 1);
        // 31 января + месяц — это 28 февраля, а не 3 марта: число прижимается
        // к длине месяца, иначе повторение уезжало бы вперёд само собой.
        const day = Math.min(src.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
        next = new Date(target.getFullYear(), target.getMonth(), day).getTime();
      }
    } else {
      const src = new Date(base);
      const year = src.getFullYear() + r.every;
      const day = Math.min(src.getDate(), daysInMonth(year, src.getMonth()));
      next = new Date(year, src.getMonth(), day).getTime();
    }

    if (next == null) return null;
    next = withTimeOf(next, base);

    if (r.ends.kind === 'after' && r.done + 1 >= r.ends.count) return null;
    if (r.ends.kind === 'on' && r.ends.at) {
      const until = new Date(`${r.ends.at}T23:59:59`).getTime();
      if (Number.isFinite(until) && next > until) return null;
    }
    return next;
  }

  /** Ближайшие сроки вперёд — для призраков на календаре.
   *  @param {number} until — докуда считать
   *  @param {number} max — предохранитель от бесконечного правила */
  function upcomingDue(rule, base, until, max) {
    const out = [];
    const limit = clampInt(max, 1, 200, 30);
    let cur = base;
    let guard = normalizeRepeat(rule);
    if (!guard) return out;
    for (let i = 0; i < limit; i += 1) {
      const next = nextDue({ ...guard, done: guard.done + i }, cur);
      if (next == null || next > until) break;
      out.push(next);
      cur = next;
    }
    return out;
  }

  /** Описание правила для подписи — ключ перевода и подстановки. Сам перевод
   *  здесь не делается: ядро не знает про язык. */
  function describeRepeat(rule) {
    const r = normalizeRepeat(rule);
    if (!r) return null;
    if (r.freq === 'week' && r.weekdays.length) {
      return { key: r.every === 1 ? 'repeat.desc_week_days' : 'repeat.desc_week_days_n', vars: { n: r.every, days: r.weekdays } };
    }
    const key = r.every === 1 ? `repeat.desc_${r.freq}` : `repeat.desc_${r.freq}_n`;
    return { key, vars: { n: r.every } };
  }

  /** Серия уже закончилась — задачу больше не возвращать. */
  function repeatFinished(rule) {
    const r = normalizeRepeat(rule);
    if (!r) return true;
    if (r.ends.kind === 'after') return r.done >= r.ends.count;
    return false;
  }

  const api = {
    normalizeRepeat,
    nextDue,
    upcomingDue,
    describeRepeat,
    repeatFinished,
    nthWeekdayOfMonth,
    weekdayOrdinal,
    REPEAT_FREQS: FREQS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

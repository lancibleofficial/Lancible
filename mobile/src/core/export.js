/* Выбор выгрузки в Excel — чистая логика, без DOM и без state.
 *
 * Окно «Экспорт в Excel» спрашивает две вещи: за какой период и по каким
 * проектам. Здесь — ответы на «что значит этот период», «какие задачи он
 * захватывает» и «что окажется в файле»; сам файл собирает core/reports.js, а
 * окно — app.js. С 11 октября 2026 файл побайтно копируется на телефон
 * (scripts/sync-mobile-core.js): лист «Экспорт в Excel» там устроен так же
 * (components/ExportPeriodSheet.js) и считает по этим же правилам.
 *
 * Правило принадлежности записи периоду то же, что в core/reports.js
 * (inRange): по началу записи, границы включительно. Запись, начатая в
 * 23:50 последнего дня и закончившаяся после полуночи, остаётся в этом дне;
 * начатая до начала периода и дошедшая до него — не попадает. Если правило
 * разойдётся с отчётом, сводка в окне пообещает одно, а в файле окажется
 * другое, — поэтому tests/unit/export.test.js сверяет их на одних данных.
 */
(function (global) {
  /** Периоды в том порядке, в каком идут пункты списка. */
  const EXPORT_PERIODS = ['all', 'day', 'week', 'month', 'half_year', 'year', 'custom'];

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Конец суток — последняя миллисекунда, а не 23:59:59: запись, начатая в
  // 23:59:59.500, иначе выпадала бы из своего же дня.
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const keyToDate = (key) => {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const dayKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /** Понедельник недели, в которую попала дата, — неделя в приложении с
   *  понедельника. Сдвиг считается по календарю, а не прибавлением суток: в
   *  день перевода часов в сутках не 24 часа. */
  const mondayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

  /** Границы периода: {from, to} (Date) или null — «всё время», без границ.
   *
   *  День и неделя — сегодняшние (неделя целиком, пн–вс); месяц — календарный,
   *  целиком; полгода и год — скользящие, с первого числа месяца, отстоящего
   *  на пять и одиннадцать месяцев назад, и до конца сегодняшнего дня, как
   *  на телефоне.
   *
   *  @param {string} period — один из EXPORT_PERIODS
   *  @param {Date} now
   *  @param {{from?: string, to?: string}} custom — границы «своего» периода,
   *    'YYYY-MM-DD'. Перепутанные местами меняются местами, а не отбрасываются;
   *    нет одной — берётся другая, нет обеих — сегодня. */
  function exportRange(period, now, custom) {
    const y = now.getFullYear();
    const m = now.getMonth();
    if (period === 'day') return { from: startOfDay(now), to: endOfDay(now) };
    if (period === 'week') {
      const monday = mondayOf(now);
      return { from: monday, to: endOfDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
    }
    if (period === 'month') return { from: new Date(y, m, 1), to: endOfDay(new Date(y, m + 1, 0)) };
    if (period === 'half_year') return { from: new Date(y, m - 5, 1), to: endOfDay(now) };
    if (period === 'year') return { from: new Date(y, m - 11, 1), to: endOfDay(now) };
    if (period === 'custom') {
      const c = custom || {};
      let a = keyToDate(c.from || c.to || dayKeyOf(now));
      let b = keyToDate(c.to || c.from || dayKeyOf(now));
      if (a > b) [a, b] = [b, a];
      return { from: a, to: endOfDay(b) };
    }
    return null;
  }

  /** Подпись под полем «Период»: «1 окт. – 31 окт. 2026».
   *
   *  Год пишется один раз — у конца, если обе границы в одном году, и у
   *  обеих, если в разных. Один день — одна дата. null (нет границ) — null:
   *  что написать вместо диапазона, решает вызывающий.
   *
   *  @param {{from: Date, to: Date}|null} range
   *  @param {(date: Date, withYear: boolean) => string} fmt — запись даты в
   *    языке и локали платформы */
  function exportRangeLabel(range, fmt) {
    if (!range) return null;
    const { from, to } = range;
    if (dayKeyOf(from) === dayKeyOf(to)) return fmt(from, true);
    if (from.getFullYear() === to.getFullYear()) return `${fmt(from, false)} – ${fmt(to, true)}`;
    return `${fmt(from, true)} – ${fmt(to, true)}`;
  }

  // --- проекты --------------------------------------------------------------

  /** Выбор проектов: null — все, иначе список id. «Все» и «перечислены все
   *  до одного» — одно и то же, поэтому второе приводится к первому; пустой
   *  список тоже значит «все»: выгрузка по нулю проектов бессмысленна. Id
   *  удалённых проектов отбрасываются. */
  function normalizeExportProjects(selected, allIds) {
    if (!selected) return null;
    const known = new Set(allIds);
    const ids = [...new Set(selected)].filter((id) => known.has(id));
    return ids.length === 0 || ids.length === known.size ? null : ids;
  }

  /** Отметка проекта в списке. Пока выбраны «все», нажатие на проект сужает
   *  выбор до него одного, а не снимает его из остальных: так в списке с
   *  «Все проекты» наверху устроен обычный выбор. Снятая последняя отметка
   *  возвращает «все». */
  function toggleExportProject(selected, id, allIds) {
    const next = selected ? selected.slice() : [];
    const at = next.indexOf(id);
    if (at >= 0) next.splice(at, 1);
    else next.push(id);
    return normalizeExportProjects(next, allIds);
  }

  /** Задачи выбранных проектов. */
  const exportTasks = (tasks, selected) => (selected ? tasks.filter((t) => selected.includes(t.projectId)) : tasks.slice());

  /** Подпись на кнопке выбора проектов: «Все проекты», название единственного
   *  выбранного или «3 проекта».
   *
   *  @param {{all: string, many: (n: number) => string}} words — слова
   *    платформы; склонение числа — её дело, а не ядра. */
  function exportProjectsLabel(selected, projects, words) {
    if (!selected) return words.all;
    const named = projects.filter((p) => selected.includes(p.id));
    if (!named.length) return words.all;
    return named.length === 1 ? (named[0].name || '') : words.many(named.length);
  }

  // --- что попадёт в файл ---------------------------------------------------

  /** Начата ли запись внутри периода — то же правило, что inRange в
   *  core/reports.js. */
  const startsIn = (iso, range) => !range || (new Date(iso) >= range.from && new Date(iso) <= range.to);

  /** Сколько записей и времени уйдёт в файл. «Всё время» считает время так
   *  же, как сводка по проектам в отчёте, — по totalMs задачи, а за период —
   *  по самим записям.
   *
   *  @returns {{count: number, ms: number, empty: boolean}} */
  function exportSummary(tasks, range) {
    let count = 0;
    let ms = 0;
    for (const task of tasks) {
      const sessions = task.sessions || [];
      if (!range) {
        count += sessions.length;
        ms += task.totalMs || 0;
        continue;
      }
      for (const s of sessions) {
        if (startsIn(s.start, range)) { count += 1; ms += s.ms; }
      }
    }
    return { count, ms, empty: count === 0 && ms === 0 };
  }

  /** От первой записи до последней — что на самом деле лежит за «всем
   *  временем». null, если записей нет. */
  function exportSpan(tasks) {
    let first = Infinity;
    let last = -Infinity;
    for (const task of tasks) {
      for (const s of task.sessions || []) {
        const at = new Date(s.start).getTime();
        if (at < first) first = at;
        if (at > last) last = at;
      }
    }
    return first === Infinity ? null : { from: startOfDay(new Date(first)), to: endOfDay(new Date(last)) };
  }

  const api = {
    EXPORT_PERIODS, exportRange, exportRangeLabel,
    normalizeExportProjects, toggleExportProject, exportTasks, exportProjectsLabel,
    exportSummary, exportSpan,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

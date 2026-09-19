/* Форматирование и разбор — чистые функции, без DOM и без state.
 *
 * Файл подключается и в браузере (десктоп и веб), и из Node в тестах,
 * поэтому наружу отдаётся одним объектом Core: в браузере он ложится в
 * глобальную область, в Node уходит через module.exports. Тот же приём, что
 * в src/xlsx.js.
 *
 * Всё, что раньше читало язык или таймер из state, теперь получает их
 * параметром. В app.js остались обёртки с прежними именами и сигнатурами,
 * так что места вызова не изменились ни одного.
 */
(function (global) {
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Накопленное время задачи. Идущий таймер добавляется на лету, поэтому
   *  нужны и он сам, и момент, относительно которого считаем. */
  function taskElapsedMs(task, activeTimer, now) {
    let ms = task.totalMs || 0;
    if (activeTimer && activeTimer.taskId === task.id) {
      ms += now - new Date(activeTimer.startedAt).getTime();
    }
    return ms;
  }

  /** ЧЧ:ММ:СС. Отрицательное время невозможно, поэтому обрезается по нулю. */
  function fmtClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
  }

  const DUR_UNITS = {
    ru: { h: 'ч', m: 'м' }, en: { h: 'h', m: 'm' }, uk: { h: 'г', m: 'хв' }, kk: { h: 'сағ', m: 'мин' },
  };

  /** Короткая длительность: «2ч 15м». Меньше минуты — прочерк. */
  function fmtShort(ms, lang) {
    const min = Math.round(ms / 60000);
    if (min < 1) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    const u = DUR_UNITS[lang] || DUR_UNITS.ru;
    if (h === 0) return `${m}${u.m}`;
    return m === 0 ? `${h}${u.h}` : `${h}${u.h} ${m}${u.m}`;
  }

  /** То же, но вместо прочерка — честный ноль: там, где длительность стоит
   *  в колонке с числами, прочерк читается как «нет данных». */
  const fmtDur = (ms, lang) =>
    (fmtShort(ms, lang) === '—' ? `0${(DUR_UNITS[lang] || DUR_UNITS.ru).m}` : fmtShort(ms, lang));

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };

  /** Ключ дня в местном времени — по нему сходятся календарь и статистика.
   *  Именно местное, а не UTC: смена суток должна совпадать с той, что видит
   *  человек за окном. */
  const dayKey = (d) => {
    d = new Date(d);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

  const hoursOf = (ms) => ms / 3_600_000;

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /** Число из пользовательского ввода: пробелы-разделители и запятая как
   *  десятичный знак. Всё, что не положительное число, — ноль. */
  function parseNum(s) {
    const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  const api = {
    pad2, taskElapsedMs, fmtClock, DUR_UNITS, fmtShort, fmtDur,
    fmtDate, fmtTime, dayKey, keyToDate, hoursOf, escapeHtml, capFirst, parseNum,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

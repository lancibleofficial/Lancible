/* Сроки и напоминания — чистая логика, без DOM и без state.
 *
 * Модель полей одна на все три поверхности, они едут в одном JSON-блоке
 * синхронизации:
 *
 *   dueAt           ISO | null   — сам срок
 *   remindOffsetMin число | null — за сколько минут до срока напомнить
 *                                  (0 = ровно в срок); при переносе срока
 *                                  напоминание едет вместе с ним
 *   remindAt        ISO | null   — своё время напоминания, когда смещение снято
 *   notifiedAt      ISO | null   — уже уведомили, повторно не будем
 *
 * Почему это отдельный файл, а не часть money.js, где reminderTime и dueState
 * жили раньше. Во-первых, к деньгам они отношения не имеют, и найти их там
 * нельзя. Во-вторых, именно из-за этого телефон их и не нашёл: в
 * mobile/src/lib/due.js лежали свои копии тех же трёх правил, хотя ядро
 * синхронизируется побайтно и копировать было незачем.
 *
 * «Сейчас» всюду приходит параметром. Иначе результат зависит от момента
 * запуска, и проверить его в заданную минуту нельзя.
 */
(function (global) {
  const DAY = 86400000;

  /** Пресеты напоминаний в порядке показа. 'custom' — своё время. */
  const REMIND_PRESETS = [null, 0, 15, 60, 180, 1440, 'custom'];
  const REMIND_LABEL = {
    null: 'remind.none', 0: 'remind.at', 15: 'remind.15m',
    60: 'remind.1h', 180: 'remind.3h', 1440: 'remind.1d', custom: 'remind.custom',
  };

  /** Ключ текущего варианта: 'null' | 'custom' | число минут строкой. */
  function remindKey(task) {
    if ((task.remindOffsetMin === null || task.remindOffsetMin === undefined) && task.remindAt) return 'custom';
    return String(task.remindOffsetMin === undefined ? null : task.remindOffsetMin);
  }

  /** Момент напоминания: либо смещение от срока, либо своё время. */
  function reminderTime(task) {
    if (task.remindOffsetMin !== null && task.remindOffsetMin !== undefined && task.dueAt) {
      return new Date(new Date(task.dueAt).getTime() - task.remindOffsetMin * 60000);
    }
    return task.remindAt ? new Date(task.remindAt) : null;
  }

  /** 'overdue' | 'soon' (в пределах суток) | 'later' | null. Выполненная
   *  задача срока не имеет — она уже не горит. */
  function dueState(task, now) {
    if (!task.dueAt || task.done) return null;
    const diff = new Date(task.dueAt).getTime() - now;
    if (diff < 0) return 'overdue';
    return diff <= DAY ? 'soon' : 'later';
  }

  /** Короткая подпись срока для списка: «просрочено» / «сегодня» / дата.
   *
   *  Перевод и формат даты приходят снаружи, как в fmtWhen: на десктопе это
   *  функции, уже знающие язык из state, на телефоне — обёртки вокруг
   *  langCode. Внутри ядра языка нет и быть не должно.
   *
   *  Разница в днях считается по местной полуночи, а не вычитанием
   *  миллисекунд: «завтра» — это следующая календарная дата, даже если до неё
   *  два часа. */
  function dueShort(task, now, t, fmtDateShort) {
    if (!task.dueAt) return '';
    const due = new Date(task.dueAt);
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(due) - startOf(new Date(now))) / DAY);
    if (dueState(task, now) === 'overdue') return t('due.overdue');
    if (days === 0) return t('due.today');
    if (days === 1) return t('due.tomorrow');
    if (days > 1 && days < 7) return t('due.in_days', { n: days });
    return fmtDateShort(due);
  }

  /** Лента уведомлений. Своего хранилища у неё нет — собирается из задач:
   *  просроченные, те, чей срок в пределах суток, и те, у кого напоминание
   *  уже сработало.
   *
   *  Непрочитанным считается то, чей момент наступил позже последнего
   *  открытия панели (seenAtIso). У «скоро» этот момент — не сам срок, а
   *  сутки до него: иначе задача со сроком через неделю считалась бы
   *  непрочитанной всю неделю. */
  function notificationFeed(tasks, seenAtIso, now) {
    const seen = seenAtIso ? new Date(seenAtIso).getTime() : 0;
    const out = [];
    for (const task of tasks) {
      if (task.done || !task.dueAt) continue;
      const due = new Date(task.dueAt).getTime();
      const rt = reminderTime(task);
      const fired = !!rt && rt.getTime() <= now;
      let kind = null;
      let at = due;
      if (due < now) kind = 'overdue';
      else if (due - now <= DAY) { kind = 'soon'; at = due - DAY; }
      else if (fired) { kind = 'reminder'; at = rt.getTime(); }
      if (!kind) continue;
      out.push({ task, kind, at, due, unread: at > seen });
    }
    return out.sort((a, b) => a.due - b.due);
  }

  const api = {
    REMIND_PRESETS, REMIND_LABEL,
    remindKey, reminderTime, dueState, dueShort, notificationFeed,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

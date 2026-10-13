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
 * С 11 октября 2026 напоминаний у задачи список — task.reminders
 * (core/reminders.js), а три старых поля — его зеркало для десктопа 0.4.3 и
 * телефона 1.2.2; как их читать, знает remindersOf.
 *
 * Почему это отдельный файл, а не часть money.js, где правила срока и dueState
 * жили раньше. Во-первых, к деньгам они отношения не имеют, и найти их там
 * нельзя. Во-вторых, именно из-за этого телефон их и не нашёл: в
 * mobile/src/lib/due.js лежали свои копии тех же трёх правил, хотя ядро
 * синхронизируется побайтно и копировать было незачем.
 *
 * «Сейчас» всюду приходит параметром. Иначе результат зависит от момента
 * запуска, и проверить его в заданную минуту нельзя.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const DAY = 86400000;

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
   *  непрочитанной всю неделю.
   *
   *  С 11 октября 2026 напоминания в ленту приходят из списка задачи
   *  (core/reminders.js, reminderFeed), у каждой записи — key, уникальный в
   *  ленте, им ленту и рисуют, и reminderId. Вида три:
   *  • 'slot' — «до начала» вхождения «времени работы»: at — время
   *    напоминания, due — начало вхождения, end — конец, slotId; висит, пока
   *    вхождение не кончилось;
   *  • 'reminder' от «до дедлайна» и «в своё время» — одна запись на задачу,
   *    due — дедлайн или null; пока сам дедлайн в ленте (просрочен или в
   *    пределах суток), её нет — как и раньше, дедлайн её заменяет;
   *  • 'reminder' от «повторять» — последнее вхождение за сутки, due: null.
   *  Выполненные и отменённые задачи не напоминают. Записи дедлайна
   *  (просрочен, скоро) — те же, что и были, поле в поле. */
  function notificationFeed(tasks, seenAtIso, now) {
    const seen = seenAtIso ? new Date(seenAtIso).getTime() : 0;
    const out = [];
    for (const task of tasks) {
      if (task.done || !task.dueAt) continue;
      const due = new Date(task.dueAt).getTime();
      let kind = null;
      let at = due;
      if (due < now) kind = 'overdue';
      else if (due - now <= DAY) { kind = 'soon'; at = due - DAY; }
      if (!kind) continue;
      out.push({ task, kind, at, due, unread: at > seen, key: `due-${task.id}` });
    }
    // Список напоминаний — в reminders.js, а в браузере он грузится позже
    // этого файла (due → slots → reminders). Поэтому берём его здесь, при
    // вызове, а не при загрузке: к этому моменту все модули уже на месте.
    const M = isNode ? require('./reminders.js') : global.Core;
    for (const task of tasks) {
      const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
      const deadlineShown = due < now || due - now <= DAY;
      for (const r of M.reminderFeed(task, now)) {
        const unread = r.at > seen;
        if (r.kind === 'before' && r.anchor === 'start') {
          out.push({ task, kind: 'slot', at: r.at, due: r.start, end: r.end, slotId: r.slotId, unread, key: r.key, reminderId: r.reminderId });
        } else if (r.kind === 'repeat') {
          out.push({ task, kind: 'reminder', at: r.at, due: null, unread, key: r.key, reminderId: r.reminderId });
        } else if (!deadlineShown) {
          out.push({ task, kind: 'reminder', at: r.at, due: Number.isFinite(due) ? due : null, unread, key: r.key, reminderId: r.reminderId });
        }
      }
    }
    const order = (n) => (n.due === null ? n.at : n.due);
    return out.sort((a, b) => order(a) - order(b));
  }

  const api = {
    dueState, dueShort, notificationFeed,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

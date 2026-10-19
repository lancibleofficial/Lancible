/* Данные для Excel-выгрузки — чистая логика, без DOM и без state.
 *
 * Здесь только форма отчёта: какие строки, какие колонки, где формулы и как
 * считаются итоги. Подписи и форматирование сюда не входят — они у десктопа
 * и у телефона свои (словари разные, строки на телефоне короче), и приходят
 * параметрами через makeReports(). Поэтому модуль и делится между
 * платформами, хотя i18n и format у них не общие.
 *
 * До этого четыре построителя жили в двух копиях — в app.js и в
 * mobile/src/lib/xlsxReports.js — и ни одна не была покрыта тестом:
 * scripts/xlsx-check.js проверяет генератор src/xlsx.js, а не отчёты.
 *
 * Сам файл .xlsx собирает src/xlsx.js из того, что вернут эти функции.
 *
 * Деньги. «Личное» (core/modes.js) выгружает листы без колонок «Ставка» и
 * «Сумма» и без строк «ставка» и «заработано» в шапке листа задачи. Это
 * параметр сборки — deps.money === false, — а не вырезание из готовых
 * листов: готовый лист не помнит, какая колонка денежная, осталась бы только
 * переводная подпись шапки (у веба и телефона она разная), а формулы
 * пришлось бы переписывать регуляркой. При сборке раскладка известна, и
 * строки денег просто не добавляются — номера строк в формулах выходят
 * правильными сами.
 */
(function (global) {
  const cellBold = (txt) => ({ t: txt, s: 1 });
  const cellHours = (n) => ({ n, s: 2 });
  const sortByStart = (a, b) => new Date(a.start || a.s.start) - new Date(b.start || b.s.start);
  const inRange = (iso, range) => !range || (new Date(iso) >= range.from && new Date(iso) <= range.to);

  /**
   * @param {object} deps — уже привязанные к языку и ставке функции платформы:
   *   t(key, params?)            — перевод;
   *   cur                        — символ валюты строкой;
   *   fmtClock(ms)               — «ЧЧ:ММ:СС»;
   *   fmtDate(ts) / fmtTime(ts)  — дата и время;
   *   hoursOf(ms)                — часы числом;
   *   effectiveRate(task)        — ставка задачи с учётом общей;
   *   sessionRate(s, task)       — ставка, записанная в самой сессии;
   *   sessionMoney(s, task)      — заработок за сессию;
   *   money                      — false: листы без денег (колонки ставки и
   *                                суммы, строки «ставка» и «заработано»).
   *                                Не задан или true — с деньгами.
   */
  function makeReports(deps) {
    const { t, cur, fmtClock, fmtDate, fmtTime, hoursOf, effectiveRate, sessionRate, sessionMoney } = deps;
    const withMoney = deps.money !== false;

    /** Строка листа (или ряд ширин колонок) без денежных колонок.
     *  moneyCols — их индексы (с нуля) в полной раскладке листа. С деньгами
     *  строка возвращается как есть.
     *
     *  Буквы в формулах от этого не сдвигаются: «Часы» стоят левее денежных
     *  колонок в каждом листе, а колонки справа от денег (пометка, число
     *  сессий) в формулах не участвуют. Если денежная колонка когда-нибудь
     *  встанет левее «Часов», букву в формуле придётся считать по новой
     *  раскладке — это держит reports.test.js: формула должна указывать на
     *  колонку с подписью «Часы». */
    const withoutMoney = (moneyCols) => (cells) => (withMoney ? cells : cells.filter((_, i) => !moneyCols.includes(i)));

    const stamp = () => `${fmtDate(Date.now())} ${fmtTime(Date.now())}`;
    const sessionsOf = (task, range) => (task.sessions || []).filter((s) => inRange(s.start, range));

    // Время задачи: за период считаем по отобранным сессиям, за всё время
    // берём totalMs. Поле totalMs — то, по чему живёт остальное приложение
    // (сводка проекта, статистика), и отчёт не должен считать иначе.
    const taskMs = (task, range) => (range
      ? sessionsOf(task, range).reduce((a, s) => a + s.ms, 0)
      : (task.totalMs || 0));
    const taskMoney = (task, range) => sessionsOf(task, range)
      .reduce((a, s) => a + sessionMoney(s, task), 0);

    const noteOf = (s) => (s.recovered ? t('xlsx.recovered') : s.manual ? t('xlsx.manual') : '');

    /** Один лист по одной задаче: шапка со сводкой и список сессий. */
    function buildTaskSheets(task, project) {
      const sessions = [...(task.sessions || [])].sort(sortByStart);
      const totalMs = task.totalMs || 0;
      const totalMoney = sessions.reduce((a, s) => a + sessionMoney(s, task), 0);
      // Колонки: № · дата · начало · конец · длительность · часы · ставка ·
      // сумма · пометка. Деньги — седьмая и восьмая (индексы 6 и 7).
      const cut = withoutMoney([6, 7]);
      const rows = [
        [cellBold(t('xlsx.task')), task.title || t('xlsx.no_title')],
        [cellBold(t('xlsx.project')), project ? project.name : t('xlsx.no_project')],
        [cellBold(t('xlsx.total_time')), fmtClock(totalMs), cellHours(hoursOf(totalMs))],
        [cellBold(t('xlsx.sessions')), sessions.length],
        ...(withMoney ? [
          [cellBold(t('xlsx.rate_now', { cur })), cellHours(effectiveRate(task))],
          [cellBold(t('xlsx.earned', { cur })), cellHours(totalMoney)],
        ] : []),
        [cellBold(t('xlsx.exported')), stamp()],
        [],
        cut([t('xlsx.num'), t('xlsx.date'), t('xlsx.start'), t('xlsx.end'), t('xlsx.duration'), t('xlsx.hours'),
          t('xlsx.rate', { cur }), t('xlsx.sum', { cur }), t('xlsx.note')].map(cellBold)),
      ];
      const firstRow = rows.length + 1;
      sessions.forEach((s, i) => {
        rows.push(cut([
          i + 1, fmtDate(s.start), fmtTime(s.start), s.end ? fmtTime(s.end) : '',
          fmtClock(s.ms), cellHours(hoursOf(s.ms)), cellHours(sessionRate(s, task)),
          cellHours(sessionMoney(s, task)), noteOf(s),
        ]));
      });
      const lastRow = firstRow + sessions.length - 1;
      rows.push(cut([
        cellBold(t('xlsx.total')), '', '', '', fmtClock(sessions.reduce((a, s) => a + s.ms, 0)),
        sessions.length ? { f: `SUM(F${firstRow}:F${lastRow})`, n: hoursOf(totalMs), s: 2 } : cellHours(0), '',
        sessions.length ? { f: `SUM(H${firstRow}:H${lastRow})`, n: totalMoney, s: 2 } : cellHours(0),
      ]));
      return [{
        name: task.title || t('xlsx.default_task_sheet'),
        cols: cut([6, 12, 10, 10, 14, 9, 12, 12, 14]).map((width) => ({ width })),
        rows,
      }];
    }

    /** Два листа по проекту: задачи и все их сессии.
     *
     *  @param tasks — уже отобранные: по версии на десктопе, целиком на
     *    телефоне. Отбор задач здесь не делается намеренно, иначе ядру
     *    пришлось бы знать и про версии, и про фильтры экрана.
     *  @param opts.range — {from, to}: Date. Отбирает СЕССИИ, а не задачи:
     *    в отчёт попадут все задачи, но со временем и деньгами за период.
     *  @param opts.meta — лишние строки шапки (десктоп кладёт сюда «Версия»),
     *    встают между описанием проекта и отметкой о выгрузке.
     */
    function buildProjectSheets(project, tasks, opts) {
      const { range, meta } = opts || {};
      // Лист задач: № · задача · статус · время · часы · сумма · ставка ·
      // сессии · первая · последняя. Деньги — индексы 5 и 6.
      const cutTasks = withoutMoney([5, 6]);
      const taskRows = [
        [cellBold(t('xlsx.project')), project.name],
        project.description ? [cellBold(t('xlsx.description')), project.description] : [],
        ...(meta || []),
        [cellBold(t('xlsx.exported')), stamp()],
        [],
        cutTasks([t('xlsx.num'), t('xlsx.task'), t('xlsx.status'), t('xlsx.total_time'), t('xlsx.hours'), t('xlsx.sum', { cur }),
          t('xlsx.rate', { cur }), t('xlsx.sessions'), t('xlsx.first_entry'), t('xlsx.last_entry')].map(cellBold)),
      ];
      const tFirst = taskRows.length + 1;
      tasks.forEach((task, i) => {
        const starts = sessionsOf(task, range).map((s) => new Date(s.start).getTime());
        const ms = taskMs(task, range);
        taskRows.push(cutTasks([
          i + 1, task.title || t('xlsx.no_title'), task.done ? t('xlsx.done') : t('xlsx.active'),
          fmtClock(ms), cellHours(hoursOf(ms)),
          cellHours(taskMoney(task, range)), cellHours(effectiveRate(task)),
          sessionsOf(task, range).length,
          starts.length ? fmtDate(Math.min(...starts)) : '', starts.length ? fmtDate(Math.max(...starts)) : '',
        ]));
      });
      const tLast = tFirst + tasks.length - 1;
      const totalMs = tasks.reduce((a, task) => a + taskMs(task, range), 0);
      const totalMoney = tasks.reduce((a, task) => a + taskMoney(task, range), 0);
      taskRows.push(cutTasks([
        cellBold(t('xlsx.total')), '', '', fmtClock(totalMs),
        tasks.length ? { f: `SUM(E${tFirst}:E${tLast})`, n: hoursOf(totalMs), s: 2 } : cellHours(0),
        tasks.length ? { f: `SUM(F${tFirst}:F${tLast})`, n: totalMoney, s: 2 } : cellHours(0), '',
        tasks.reduce((a, task) => a + sessionsOf(task, range).length, 0),
      ]));

      const all = [];
      for (const task of tasks) for (const s of sessionsOf(task, range)) all.push({ t: task, s });
      all.sort(sortByStart);
      // Лист сессий: № · задача · дата · начало · конец · длительность ·
      // часы · ставка · сумма · пометка. Деньги — индексы 7 и 8.
      const cutSessions = withoutMoney([7, 8]);
      const sesRows = [
        cutSessions([t('xlsx.num'), t('xlsx.task'), t('xlsx.date'), t('xlsx.start'), t('xlsx.end'), t('xlsx.duration'),
          t('xlsx.hours'), t('xlsx.rate', { cur }), t('xlsx.sum', { cur }), t('xlsx.note')].map(cellBold)),
      ];
      all.forEach(({ t: task, s }, i) => {
        sesRows.push(cutSessions([
          i + 1, task.title || t('xlsx.no_title'), fmtDate(s.start), fmtTime(s.start),
          s.end ? fmtTime(s.end) : '', fmtClock(s.ms), cellHours(hoursOf(s.ms)),
          cellHours(sessionRate(s, task)), cellHours(sessionMoney(s, task)), noteOf(s),
        ]));
      });
      const sesTotalMs = all.reduce((a, x) => a + x.s.ms, 0);
      const sesTotalMoney = all.reduce((a, x) => a + sessionMoney(x.s, x.t), 0);
      sesRows.push(cutSessions([
        cellBold(t('xlsx.total')), '', '', '', '', fmtClock(sesTotalMs),
        all.length ? { f: `SUM(G2:G${all.length + 1})`, n: hoursOf(sesTotalMs), s: 2 } : cellHours(0), '',
        all.length ? { f: `SUM(I2:I${all.length + 1})`, n: sesTotalMoney, s: 2 } : cellHours(0),
      ]));
      return [
        { name: t('xlsx.sheet_tasks'), cols: cutTasks([6, 34, 12, 14, 9, 12, 12, 8, 14, 16]).map((width) => ({ width })), rows: taskRows },
        { name: t('xlsx.sheet_sessions'), cols: cutSessions([6, 34, 12, 10, 10, 14, 9, 12, 12, 16]).map((width) => ({ width })), rows: sesRows },
      ];
    }

    /** Сводка по всем проектам: первый лист — итоги по каждому, дальше по
     *  листу на проект.
     *
     *  Имена листов Excel не длиннее 31 символа, не терпят []:*?/\ и не могут
     *  повторяться — отсюда uniqueName(). Обрезка до 28 оставляет место под
     *  « 2», которым разводятся одноимённые проекты. */
    function buildAllProjectsSheets(projects, tasksOfProject) {
      // Сводка: № · проект · время · часы · сумма · сессии. Деньги — индекс 4.
      const cut = withoutMoney([4]);
      const rows = [
        [cellBold(t('xlsx.exported')), stamp()],
        [],
        cut([t('xlsx.num'), t('xlsx.project'), t('xlsx.total_time'), t('xlsx.hours'), t('xlsx.sum', { cur }), t('xlsx.sessions')].map(cellBold)),
      ];
      const first = rows.length + 1;
      let grandMs = 0;
      let grandMoney = 0;
      let grandSessions = 0;
      projects.forEach((project, i) => {
        const tasks = tasksOfProject(project.id);
        const ms = tasks.reduce((a, task) => a + (task.totalMs || 0), 0);
        const money = tasks.reduce((a, task) => a + taskMoney(task), 0);
        const count = tasks.reduce((a, task) => a + (task.sessions ? task.sessions.length : 0), 0);
        grandMs += ms; grandMoney += money; grandSessions += count;
        rows.push(cut([i + 1, project.name, fmtClock(ms), cellHours(hoursOf(ms)), cellHours(money), count]));
      });
      const last = first + projects.length - 1;
      rows.push(cut([
        cellBold(t('xlsx.total')), '', fmtClock(grandMs),
        projects.length ? { f: `SUM(D${first}:D${last})`, n: hoursOf(grandMs), s: 2 } : cellHours(0),
        projects.length ? { f: `SUM(E${first}:E${last})`, n: grandMoney, s: 2 } : cellHours(0),
        grandSessions,
      ]));

      const used = new Set();
      const uniqueName = (raw) => {
        const base = (raw || '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || t('xlsx.default_task_sheet');
        let name = base;
        let n = 2;
        while (used.has(name)) name = `${base} ${n++}`;
        used.add(name);
        return name;
      };

      const sheets = [{
        name: uniqueName(t('xlsx.sheet_tasks')),
        cols: cut([6, 34, 14, 9, 12, 10]).map((width) => ({ width })),
        rows,
      }];
      for (const project of projects) {
        const [tasksSheet] = buildProjectSheets(project, tasksOfProject(project.id));
        sheets.push({ ...tasksSheet, name: uniqueName(project.name) });
      }
      return sheets;
    }

    /** Один лист «Сессии» за промежуток, сразу по всем проектам — для
     *  выгрузки из календаря. В отличие от отчёта по проекту здесь есть
     *  колонка с названием проекта: задачи приходят из разных. */
    function buildPeriodSheets(tasks, getProject, range) {
      const all = [];
      for (const task of tasks) {
        for (const s of sessionsOf(task, range)) all.push({ task, s });
      }
      all.sort(sortByStart);
      // Сессии периода: № · задача · проект · дата · начало · конец ·
      // длительность · часы · ставка · сумма · пометка. Деньги — индексы 8 и 9.
      const cut = withoutMoney([8, 9]);
      const rows = [
        cut([t('xlsx.num'), t('xlsx.task'), t('xlsx.project'), t('xlsx.date'), t('xlsx.start'), t('xlsx.end'),
          t('xlsx.duration'), t('xlsx.hours'), t('xlsx.rate', { cur }), t('xlsx.sum', { cur }), t('xlsx.note')].map(cellBold)),
      ];
      all.forEach(({ task, s }, i) => {
        const project = getProject(task.projectId);
        rows.push(cut([
          i + 1, task.title || t('xlsx.no_title'), project ? project.name : t('xlsx.no_project'),
          fmtDate(s.start), fmtTime(s.start), s.end ? fmtTime(s.end) : '',
          fmtClock(s.ms), cellHours(hoursOf(s.ms)), cellHours(sessionRate(s, task)),
          cellHours(sessionMoney(s, task)), noteOf(s),
        ]));
      });
      const totalMs = all.reduce((a, x) => a + x.s.ms, 0);
      const totalMoney = all.reduce((a, x) => a + sessionMoney(x.s, x.task), 0);
      rows.push(cut([
        cellBold(t('xlsx.total')), '', '', '', '', '', fmtClock(totalMs),
        all.length ? { f: `SUM(H2:H${all.length + 1})`, n: hoursOf(totalMs), s: 2 } : cellHours(0), '',
        all.length ? { f: `SUM(J2:J${all.length + 1})`, n: totalMoney, s: 2 } : cellHours(0),
      ]));
      return [{
        name: t('xlsx.sheet_sessions'),
        cols: cut([6, 30, 24, 12, 10, 10, 14, 9, 12, 12, 16]).map((width) => ({ width })),
        rows,
      }];
    }

    return { buildTaskSheets, buildProjectSheets, buildAllProjectsSheets, buildPeriodSheets };
  }

  const api = { makeReports };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

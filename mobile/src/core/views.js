/* Что показать — решения отрисовки без самой отрисовки.
 *
 * Отрисовка в app.js смешивала два разных дела: решить, что показать, и
 * собрать из этого DOM. Решения — какие значки повесить, какой текст
 * поставить, что подсветить — это правила, и их можно проверить тестом.
 * Сборка DOM — это механика, и у телефона она своя (React Native вместо
 * document.createElement).
 *
 * Строка задачи — первый и самый показательный случай. Она есть на обеих
 * платформах, и решения в ней разошлись молча: десктоп показывал статус,
 * версию, значок повторения, дедлайн, точку таймера и время, а телефон —
 * только статус, дедлайн, таймер и время. Ни один тест этого не замечал:
 * каждая сторона рисовала себя правильно, просто по-разному.
 *
 * Язык сюда не попадает — перевод, формат даты и подпись повторения
 * приходят параметром, как в fmtWhen и dueShort. «Сейчас» тоже параметр.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // Путь — строкой целиком, как в остальном ядре. Сборщик телефона (Metro)
  // понимает только require('./файл.js'); вычисляемый путь require(`./${x}`)
  // в Node работает, а сборку APK роняет — так и было, и тесты в Node этого
  // не видели.
  const S = isNode ? require('./status.js') : global.Core;
  const V = isNode ? require('./versions.js') : global.Core;
  const R = isNode ? require('./repeat.js') : global.Core;
  const F = isNode ? require('./format.js') : global.Core;
  const D = isNode ? require('./due.js') : global.Core;
  const A = isNode ? require('./agenda.js') : global.Core;
  const M = isNode ? require('./money.js') : global.Core;
  const T = isNode ? require('./tags.js') : global.Core;

  /**
   * Строка задачи в списке.
   *
   * @param {object} task
   * @param {object} ctx — {
   *   statuses, versions, tags,    данные (tags — не обязателен)
   *   selectedId, activeTimer, now, состояние
   *   lang, t, fmtDateShort,        язык и формат
   *   repeatLabel?                  подпись правила повторения; у телефона
   *                                 подсказок по наведению нет, и ему она
   *                                 не нужна
   * }
   */
  function taskRowView(task, ctx) {
    const { statuses, versions, tags, selectedId, activeTimer, now, lang, t, fmtDateShort, repeatLabel } = ctx;
    const status = S.getStatus(statuses, task.statusId);
    const version = task.versionId ? V.getVersion(versions, task.versionId) : null;
    const rule = R.normalizeRepeat(task.repeat);
    const due = D.dueState(task, now);

    return {
      selected: task.id === selectedId,
      done: !!task.done,
      pinned: !!task.pinnedAt,
      title: task.title || t('task.no_name'),
      pinTitle: t(task.pinnedAt ? 'task.unpin_short' : 'task.pin_short'),
      // Статус первым: по нему видно, на какой стадии задача, — остальное
      // только уточняет.
      status: status ? { name: status.name, color: status.color } : null,
      // Версия рядом со статусом: на доске её видно по дорожке, а в списке
      // без этого значка её не видно нигде, кроме как открыв задачу.
      version: version ? { name: version.name || t('task.no_name'), released: !!version.releasedAt } : null,
      repeat: rule ? { title: repeatLabel ? repeatLabel(rule) : null } : null,
      due: due ? { state: due, text: D.dueShort(task, now, t, fmtDateShort) } : null,
      // Теги — цветными точками после названия: цвет узнаётся быстрее
      // подписи, а подпись всплывает по наведению.
      tags: tags ? T.tagsOf(tags, task.tagIds).map((tg) => ({ name: tg.name, color: tg.color })) : [],
      running: !!(activeTimer && activeTimer.taskId === task.id),
      time: F.fmtShort(F.taskElapsedMs(task, activeTimer, now), lang),
    };
  }

  // --- календарь ------------------------------------------------------------
  //
  // Месяц и часовая сетка принимают об одних и тех же днях одни и те же
  // решения: какой из них сегодня, какие дедлайны и записи в него попали,
  // как подписать задачу. Это общее — agendaDays. Поверх него каждый вид
  // решает своё: месяц — сколько записей влезает в клетку, сетка — подписи
  // часов и раскладку пересекающихся записей по колонкам.
  //
  // Только для десктопа: у телефона месяц — другой экран, тепловая карта с
  // итогами по дням, а не чипы записей.

  const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  // Сколько записей помещается в клетку месяца; остальные уходят в «+N».
  const MONTH_CHIPS = 3;

  const pad2 = (n) => String(n).padStart(2, '0');

  /** Дни отрезка и что в каждом.
   *
   *  «Сегодня» сравнивается по ключу дня, а не по началу суток в
   *  миллисекундах: from + i·сутки на переходе на летнее время уезжает с
   *  полуночи на час, а ключ дня считается по местной дате и не уезжает. */
  function agendaDays(tasks, ctx) {
    const { from, days, now, t, projectColor } = ctx;
    const to = from + days * A.DAY;
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const titleOf = (id) => {
      const task = byId.get(id);
      return task ? (task.title || t('task.no_name')) : '';
    };
    const deadlines = A.deadlineItems(tasks, from, to).concat(A.repeatGhosts(tasks, from, to));
    const segments = A.sessionSegments(tasks, from, to);
    const todayKey = F.dayKey(new Date(now));

    return Array.from({ length: days }, (_, i) => {
      const start = from + i * A.DAY;
      const date = new Date(start);
      return {
        index: i,
        start,
        date: date.getDate(),
        month: date.getMonth(),
        today: F.dayKey(date) === todayKey,
        deadlines: deadlines
          .filter((dl) => dl.dayIndex === i)
          .map((dl) => ({
            taskId: dl.taskId,
            title: titleOf(dl.taskId),
            done: !!dl.done,
            ghost: !!dl.ghost,
            color: projectColor(dl.projectId),
            at: dl.at,
          })),
        segments: segments
          .filter((seg) => seg.dayIndex === i)
          .map((seg) => ({ ...seg, title: titleOf(seg.taskId), color: projectColor(seg.projectId) })),
      };
    });
  }

  /** Месяц: клетки с короткими чипами, как в Google.
   *  ctx — { from, days, anchor, now, t, fmtTime, projectColor } */
  function agendaMonthView(tasks, ctx) {
    const { days, anchor, t, fmtTime } = ctx;
    const month = new Date(anchor).getMonth();
    return {
      weekdays: WEEKDAYS.map((key) => t(`weekday.${key}`)),
      weeks: days / 7,
      cells: agendaDays(tasks, ctx).map((d) => ({
        start: d.start,
        date: d.date,
        out: d.month !== month,
        today: d.today,
        deadlines: d.deadlines,
        sessions: d.segments.slice(0, MONTH_CHIPS).map((seg) => ({
          taskId: seg.taskId,
          index: seg.index,
          time: fmtTime(seg.start).slice(0, 5),
          title: seg.title,
          color: seg.color,
        })),
        more: Math.max(0, d.segments.length - MONTH_CHIPS),
      })),
    };
  }

  /** Часовая сетка — день, четыре дня или неделя.
   *  ctx — { from, days, now, t, fmtTime, locale, projectColor } */
  function agendaTimeView(tasks, ctx) {
    const { t, fmtTime, locale } = ctx;
    return {
      days: agendaDays(tasks, ctx).map((d) => ({
        index: d.index,
        start: d.start,
        date: d.date,
        today: d.today,
        weekday: new Date(d.start).toLocaleDateString(locale, { weekday: 'short' }),
        // Призрак повторения помечен ↻ прямо в подписи: в узкой полосе над
        // сеткой пунктир разглядеть трудно.
        deadlines: d.deadlines.map((dl) => ({
          ...dl,
          label: (dl.ghost ? '↻ ' : '') + dl.title,
          tooltip: `${t('agenda.deadline')} · ${fmtTime(dl.at)}`,
        })),
        blocks: A.layoutOverlaps(d.segments),
      })),
      // Полночь не подписываем: её метка висела бы над первой линией и
      // читалась подписью ко всей сетке.
      hours: Array.from({ length: 24 }, (_, h) => (h ? `${pad2(h)}:00` : '')),
      // Линии каждые полчаса, а не каждый час: шаг перетаскивания —
      // 15 минут, и по одним часовым не видно, куда встанет запись.
      lines: Array.from({ length: 47 }, (_, i) => {
        const half = i + 1;
        return { top: (half / 48) * 100, half: half % 2 === 1 };
      }),
    };
  }

  // --- экран проекта --------------------------------------------------------

  /**
   * Группы списка задач проекта. Сверху закреплённые — как и раньше, они
   * важнее статуса. Дальше группы по статусам в порядке столбцов доски:
   * список и доска читаются одинаково. Пустых групп нет. Свёрнутая группа
   * всё равно отдаёт свои задачи: счётчик и время видны и в свёрнутой.
   *
   * Задача, чей статус не нашёлся (удалили, или он чужого проекта), стоит
   * там, куда её поставил бы defaultStatusId, — не теряется из списка.
   *
   * @param {object[]} tasks — задачи проекта, уже прошедшие фильтр
   * @param {object} ctx — { statuses (все), projectId, collapsed (ключи
   *   свёрнутых групп), activeTimer, now }
   */
  function projectListGroups(tasks, ctx) {
    const { statuses, projectId, collapsed = [], activeTimer, now } = ctx;
    const shut = new Set(collapsed);
    const msOf = (list) => list.reduce((a, t) => a + F.taskElapsedMs(t, activeTimer, now), 0);
    const group = (key, status, list) => ({ key, status, tasks: list, ms: msOf(list), collapsed: shut.has(key) });
    const groups = [];

    const pinned = tasks.filter((t) => t.pinnedAt)
      .sort((a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt));
    if (pinned.length) groups.push(group('pinned', null, pinned));

    const own = S.orderedStatuses(statuses, projectId);
    const known = new Set(own.map((st) => st.id));
    const slotOf = (t) => (known.has(t.statusId) ? t.statusId : S.defaultStatusId(statuses, projectId, !!t.done));
    const rest = tasks.filter((t) => !t.pinnedAt);
    for (const st of own) {
      const list = rest.filter((t) => slotOf(t) === st.id);
      if (list.length) groups.push(group(st.id, { name: st.name, color: st.color, kind: st.kind }, list));
    }
    // У проекта нет ни одного статуса — одна группа без заголовка.
    if (!own.length && rest.length) groups.push(group('all', null, rest));
    return groups;
  }

  /**
   * Строки вкладки «Версии»: у каждой версии — сколько задач и сколько из
   * них готово, время и заработанное. Порядок — как у дорожек доски: сначала
   * то, над чем работают, потом выпущенное. Задачи без версии — отдельной
   * строкой в конце, если такие есть.
   *
   * @param {object} ctx — { rates (см. money.js), activeTimer, now }
   */
  function versionRows(tasks, versions, projectId, ctx) {
    const { rates, activeTimer, now } = ctx;
    const own = tasks.filter((t) => t.projectId === projectId);
    const row = (id, name, releasedAt, list) => ({
      id,
      name,
      released: !!releasedAt,
      releasedAt: releasedAt || null,
      total: list.length,
      done: list.filter((t) => t.done).length,
      ms: list.reduce((a, t) => a + F.taskElapsedMs(t, activeTimer, now), 0),
      money: list.reduce((a, t) => a + M.earnedOf(t, rates, activeTimer, now), 0),
    });
    const rows = V.laneVersions(versions, projectId)
      .map((v) => row(v.id, v.name, v.releasedAt, own.filter((t) => t.versionId === v.id)));
    const ids = new Set(rows.map((r) => r.id));
    const none = own.filter((t) => !t.versionId || !ids.has(t.versionId));
    if (none.length) rows.push(row(null, null, null, none));
    return rows;
  }

  const api = { taskRowView, agendaDays, agendaMonthView, agendaTimeView, projectListGroups, versionRows };

  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

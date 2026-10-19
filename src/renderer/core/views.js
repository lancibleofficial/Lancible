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
  const SL = isNode ? require('./slots.js') : global.Core;

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
   *  Дни шагают по календарю (addDaysMs), а не прибавлением суток: на
   *  переходе часов from + i·сутки уезжает с полуночи на час, и на неделе с
   *  переводом назад один день повторялся бы, а соседний терялся. «Сегодня»
   *  сравнивается по ключу дня — он считается по местной дате.
   *
   *  planned — плановые блоки «времени работы» (slots.js, slotItems): куски
   *  вхождений отрезков открытых задач, уже нарезанные по полуночи. */
  function agendaDays(tasks, ctx) {
    const { from, days, now, t, projectColor } = ctx;
    const to = A.addDaysMs(from, days);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const titleOf = (id) => {
      const task = byId.get(id);
      return task ? (task.title || t('task.no_name')) : '';
    };
    const deadlines = A.deadlineItems(tasks, from, to).concat(A.repeatGhosts(tasks, from, to));
    const segments = A.sessionSegments(tasks, from, to);
    const planned = SL.slotItems(tasks, from, to);
    const todayKey = F.dayKey(new Date(now));

    return Array.from({ length: days }, (_, i) => {
      const start = A.addDaysMs(from, i);
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
        planned: planned
          .filter((p) => p.dayIndex === i)
          .map((p) => ({ ...p, title: titleOf(p.taskId), color: projectColor(p.projectId) })),
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
        // Плановые блоки — отдельно от записей: они лежат слоем под ними, и
        // записи их не теснят. Но друг друга теснят (с 18 октября 2026):
        // время задачи ничем не ограничено, и два плана в один час стоят
        // рядом колонками, как записи, а не один поверх другого.
        planned: A.layoutOverlaps(d.planned),
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

  // --- «Проекты»: карточки со списком задач ----------------------------------
  //
  // Одно правило на телефон (колода) и на десктоп с вебом (ряд карточек).

  /** Задачи в карточке проекта: выполненные не показываются; сверху идущая,
   *  если её закрепили первой на входе (pinTaskId), дальше — по последнему
   *  изменению, свежая сверху. Запуск таймера задачу не меняет, поэтому
   *  запущенная не прыгает; остановили — у неё свежая отметка, и она
   *  уезжает наверх. */
  function deckTasks(tasks, pinTaskId) {
    const updMs = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
    return tasks.filter((task) => !task.done)
      .sort((a, b) => (b.id === pinTaskId) - (a.id === pinTaskId) || updMs(b) - updMs(a));
  }

  /** Когда проект меняли в последний раз (мс): позднее из его updatedAt и
   *  createdAt, updatedAt его задач и конца последней записи времени (у
   *  записи без конца — её начала). Нет ни одной отметки — 0. */
  function projectActivityMs(project, tasks) {
    const ms = (v) => {
      const n = v ? new Date(v).getTime() : 0;
      return Number.isFinite(n) ? n : 0;
    };
    let at = Math.max(ms(project.updatedAt), ms(project.createdAt));
    for (const task of tasks || []) {
      if (task.projectId !== project.id) continue;
      at = Math.max(at, ms(task.updatedAt));
      for (const s of task.sessions || []) at = Math.max(at, ms(s.end || s.start));
    }
    return at;
  }

  /** Проекты по свежести — одно правило на «Проекты» и списки проектов веба
   *  и колоду телефона (19 октября 2026): первым — тот, что меняли последним
   *  (projectActivityMs: сам проект, его задачи, записи времени); новый
   *  проект — первым. Равны — первым новее созданный, дальше — как лежали.
   *  Закрепление порядок не меняет: закреплённые — своя группа в левой
   *  панели веба. Возвращает новый массив тех же объектов. */
  function projectsByActivity(projects, tasks) {
    const byProject = new Map();
    for (const task of tasks || []) {
      if (!byProject.has(task.projectId)) byProject.set(task.projectId, []);
      byProject.get(task.projectId).push(task);
    }
    const created = (p) => {
      const n = p.createdAt ? new Date(p.createdAt).getTime() : 0;
      return Number.isFinite(n) ? n : 0;
    };
    return (projects || [])
      .map((p, i) => ({ p, i, at: projectActivityMs(p, byProject.get(p.id)), made: created(p) }))
      .sort((a, b) => (b.at - a.at) || (b.made - a.made) || (a.i - b.i))
      .map((x) => x.p);
  }

  /** Какая задача стоит в карточках первой как идущая. Берётся на входе на
   *  экран и держится, пока её таймер идёт; остановили или запустили
   *  другую — первой не стоит никто (новая идущая не прыгает наверх до
   *  следующего входа). */
  function deckPinTop(pinTaskId, activeTimer) {
    if (!pinTaskId) return null;
    return activeTimer && activeTimer.taskId === pinTaskId ? pinTaskId : null;
  }

  /**
   * Порядок строк, пока он заморожен. У идущей задачи последняя запись —
   * «сейчас», и «недавние» ставят её первой: строка прыгала бы вверх сама,
   * в момент нажатия. Пока таймер идёт, список держит тот порядок, что был
   * на экране; остановили — заморозка снята, порядок обычный, и строки
   * переезжают на новые места (FLIP в app.js).
   *
   * Что показать, решает обычное правило (fresh); заморозка только
   * переставляет выбранное им. Набор строк всегда как у fresh: ушедшие
   * (выполнена, удалена, выпала за предел) пропадают, новые встают по
   * обычному правилу — после ближайшей предшественницы по fresh, а если её
   * нет, в начало.
   *
   * @param {string[]|null} held — id в том порядке, в каком список видели в
   *   момент заморозки; пусто или null — заморозки нет
   * @param {string[]} fresh — id в обычном порядке по свежим данным
   * @returns {string[]} те же id, что в fresh
   */
  function holdOrder(held, fresh) {
    if (!held || !held.length) return fresh.slice();
    const alive = new Set(fresh);
    const seen = new Set();
    const out = [];
    for (const id of held) {
      if (alive.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
    }
    fresh.forEach((id, i) => {
      if (seen.has(id)) return;
      // Все предшественницы по fresh уже на местах: свои или вставленные раньше.
      let at = 0;
      for (let j = i - 1; j >= 0; j -= 1) {
        const k = out.indexOf(fresh[j]);
        if (k >= 0) { at = k + 1; break; }
      }
      out.splice(at, 0, id);
      seen.add(id);
    });
    return out;
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

  const api = { taskRowView, agendaDays, agendaMonthView, agendaTimeView, deckTasks, deckPinTop, holdOrder, projectActivityMs, projectsByActivity, projectListGroups, versionRows };

  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

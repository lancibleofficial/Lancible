/* Календарь-расписание — чистая логика, без DOM и без state.
 *
 * Здесь всё, что нужно часовой сетке: какой отрезок дней она показывает, как
 * нарезать записи времени по дням, как разложить пересекающиеся записи по
 * колонкам и как прилипать к шагу сетки. Отрисовка и перетаскивание живут в
 * app.js, а сюда вынесено то, что можно проверить без браузера.
 */
(function (global) {
  // Призраки повторений строятся по правилу повторения — отсюда зависимость
  // от соседнего модуля ядра. Разрешается так же, как в money.js: через
  // require в Node и через общий global.Core в браузере.
  const R = (typeof module !== 'undefined' && module.exports) ? require('./repeat.js') : global.Core;

  const DAY = 86400000;
  const MIN = 60000;

  const startOfDayMs = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };

  /** Полночь дня через n календарных дней от d (n бывает отрицательным).
   *
   *  Не `d + n * DAY`: в стране с переводом часов сутки дважды в год длятся
   *  23 или 25 часов, и такой сдвиг съезжает с полуночи на час. Дальше это
   *  расползается по всему календарю: на неделе с переводом назад один день
   *  повторяется, а соседний теряется, повторение «по понедельникам» берёт
   *  понедельник следующей недели за свой, а нарезка записей по суткам в
   *  25-часовой день не доходит до полуночи и встаёт в вечный цикл. */
  function addDaysMs(d, n) {
    const x = new Date(d);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate() + n).getTime();
  }

  /** Сколько календарных дней от дня a до дня b — номер столбца сетки.
   *  Округлением, а не делением нацело: между полуночами по разные стороны
   *  перевода часов не ровно n суток, а на час больше или меньше. */
  function daysBetween(a, b) {
    return Math.round((startOfDayMs(b) - startOfDayMs(a)) / DAY);
  }

  /** Понедельник недели, в которую попала дата. Неделя начинается с
   *  понедельника — так же, как в остальном приложении. */
  function mondayOfMs(d) {
    const x = new Date(startOfDayMs(d));
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getTime();
  }

  /** Сколько дней показывает режим. У месяца дни считаются отдельно: их
   *  число зависит от того, на какие дни недели пришлись края. */
  const MODE_DAYS = { day: 1, week: 7 };

  /** Отрезок, который показывает сетка: [начало первого дня, конец последнего).
   *  Месяц округляется до целых недель, чтобы сетка была прямоугольной.
   *  Обе границы — местные полуночи, считанные по календарю (addDaysMs).
   *  @param {string} mode — day | week | month | agenda */
  function agendaRange(mode, anchor) {
    const a = startOfDayMs(anchor);
    if (mode === 'week') {
      const from = mondayOfMs(a);
      return { from, to: addDaysMs(from, 7), days: 7 };
    }
    if (mode === 'month') {
      const d = new Date(a);
      const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
      const from = mondayOfMs(first);
      const to = addDaysMs(mondayOfMs(last), 7);
      return { from, to, days: daysBetween(from, to) };
    }
    if (mode === 'agenda') return { from: a, to: addDaysMs(a, 30), days: 30 };
    const days = MODE_DAYS[mode] || 1;
    return { from: a, to: addDaysMs(a, days), days };
  }

  /** Сдвиг на шаг вперёд или назад по тому же режиму. */
  function shiftAnchor(mode, anchor, dir) {
    const a = startOfDayMs(anchor);
    if (mode === 'month') {
      const d = new Date(a);
      return new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime();
    }
    if (mode === 'week') return addDaysMs(mondayOfMs(a), dir * 7);
    if (mode === 'agenda') return addDaysMs(a, dir * 30);
    return addDaysMs(a, dir * (MODE_DAYS[mode] || 1));
  }

  /** Записи времени, нарезанные по дням отрезка.
   *
   *  Запись, перешедшая за полночь, показывается куском в каждом дне: иначе
   *  ночная работа целиком приписывалась бы дню, в котором началась, и
   *  пропадала бы из следующего.
   *
   *  Сутки режутся по календарю: конец дня — следующая местная полночь, а не
   *  начало плюс 24 часа. В 25-часовой день (перевод часов назад) «плюс 24
   *  часа» — это 23:00, и запись после 23:00 не продвигала цикл ни на шаг:
   *  экран, где окно накрывало такую запись, зависал намертво.
   *
   *  @returns [{taskId, index, dayIndex, start, end, ms, crossesDay}] */
  function sessionSegments(tasks, from, to) {
    const out = [];
    for (const task of tasks) {
      const sessions = task.sessions || [];
      for (let i = 0; i < sessions.length; i += 1) {
        const s = sessions[i];
        const a = new Date(s.start).getTime();
        const b = s.end ? new Date(s.end).getTime() : a + (s.ms || 0);
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
        if (b <= from || a >= to) continue;
        let cur = Math.max(a, from);
        while (cur < Math.min(b, to)) {
          const dayStart = startOfDayMs(cur);
          const dayEnd = addDaysMs(dayStart, 1);
          // Каждый шаг обязан продвигаться вперёд. По календарю следующая
          // полночь всегда позже, но если граница всё же не впереди (дата за
          // пределами Date, битая запись) — выходим, а не крутимся на месте.
          if (!(dayEnd > cur)) break;
          const segEnd = Math.min(b, dayEnd, to);
          out.push({
            taskId: task.id,
            index: i,
            projectId: task.projectId,
            dayIndex: daysBetween(from, dayStart),
            start: cur,
            end: segEnd,
            ms: segEnd - cur,
            crossesDay: a < dayStart || b > dayEnd,
          });
          cur = segEnd;
        }
      }
    }
    return out.sort((x, y) => x.start - y.start || x.end - y.end);
  }

  /** Дедлайны, попавшие в отрезок, — для полосы «весь день» над сеткой. */
  function deadlineItems(tasks, from, to) {
    return tasks
      .filter((t) => t.dueAt)
      .map((t) => ({ taskId: t.id, projectId: t.projectId, at: new Date(t.dueAt).getTime(), done: !!t.done }))
      .filter((d) => Number.isFinite(d.at) && d.at >= from && d.at < to)
      .map((d) => ({ ...d, dayIndex: daysBetween(from, d.at) }))
      .sort((a, b) => a.at - b.at);
  }

  /** Будущие сроки повторений — призраками на календаре.
   *
   *  Отличие от deadlineItems: там сроки, которые уже стоят в задачах, здесь
   *  те, которых ещё нет — они появятся, когда задачу закроют. Поэтому у
   *  призрака нет done, зато есть пометка ghost: отрисовка показывает его
   *  бледным, и кликать по нему нечего.
   *
   *  Предел в 40 повторений на задачу — защита от правила «каждый день» на
   *  годовом отрезке: рисовать 365 призраков незачем, да и видно на экране
   *  всё равно меньше. */
  function repeatGhosts(tasks, from, to) {
    const out = [];
    for (const task of tasks) {
      const rule = R.normalizeRepeat(task.repeat);
      if (!rule || !task.dueAt || R.repeatFinished(rule)) continue;
      for (const at of R.upcomingDue(rule, new Date(task.dueAt).getTime(), to, 40)) {
        if (at < from) continue;
        out.push({
          taskId: task.id,
          projectId: task.projectId,
          at,
          ghost: true,
          dayIndex: daysBetween(from, at),
        });
      }
    }
    return out.sort((x, y) => x.at - y.at);
  }

  /** Раскладка пересекающихся записей по колонкам — как в Google Calendar:
   *  наложившиеся друг на друга события делят ширину поровну.
   *
   *  Считается по группам: события связываются в одну группу, пока хоть одно
   *  из них продолжается. Ширина у группы общая, иначе соседние события
   *  прыгали бы по ширине внутри одного столбика.
   *
   *  @returns те же объекты с добавленными col и cols */
  function layoutOverlaps(events) {
    const sorted = events.slice().sort((a, b) => a.start - b.start || a.end - b.end);
    const out = sorted.map((e) => Object.assign({}, e, { col: 0, cols: 1 }));
    let group = [];
    let groupEnd = -Infinity;

    const flush = () => {
      if (!group.length) return;
      const colEnds = [];
      for (const e of group) {
        let placed = false;
        for (let i = 0; i < colEnds.length; i += 1) {
          if (colEnds[i] <= e.start) { e.col = i; colEnds[i] = e.end; placed = true; break; }
        }
        if (!placed) { e.col = colEnds.length; colEnds.push(e.end); }
      }
      for (const e of group) e.cols = colEnds.length;
      group = [];
      groupEnd = -Infinity;
    };

    for (const e of out) {
      if (group.length && e.start >= groupEnd) flush();
      group.push(e);
      groupEnd = Math.max(groupEnd, e.end);
    }
    flush();
    return out;
  }

  /** Прилипание ко времени сетки. Шаг в минутах; 0 и меньше — без прилипания. */
  function snapMinutes(ms, stepMin) {
    if (!stepMin || stepMin <= 0) return ms;
    const step = stepMin * MIN;
    const day = startOfDayMs(ms);
    return day + Math.round((ms - day) / step) * step;
  }

  /** Держит запись в пределах суток и не даёт ей стать короче минимума:
   *  запись нулевой длины не видно, и ухватить её обратно уже нечем.
   *
   *  Сутки передаются явно, а не выводятся из начала: при перетаскивании
   *  начало как раз и выезжает за край того дня, в котором тянут, — и по
   *  нему день определился бы неверно. */
  function clampSpan(dayStart, start, end, minMin) {
    const day = startOfDayMs(dayStart);
    const dayEnd = addDaysMs(day, 1);
    const min = Math.max(1, minMin || 5) * MIN;
    let a = Math.max(day, Math.min(start, dayEnd - min));
    let b = Math.min(dayEnd, Math.max(end, a + min));
    if (b - a < min) a = Math.max(day, b - min);
    return { start: a, end: b };
  }

  /** Доля суток, на которой стоит момент времени: 0 — полночь, 1 — конец дня.
   *  По ней часовая сетка расставляет блоки по высоте.
   *
   *  Считается по часам на циферблате, а не по прошедшим с полуночи
   *  миллисекундам: подписи сетки — 24 часа, и в 25-часовой день 23:30
   *  иначе уезжала бы под сетку, а в 23-часовой вставала бы на 22:30. */
  function dayFraction(ms) {
    const d = new Date(ms);
    return (((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds()) / DAY;
  }

  /** Обратное к dayFraction: момент на доле frac суток того дня, где лежит
   *  dayStart. 1 — следующая полночь. По нему сетка переводит высоту под
   *  пальцем или курсором во время. */
  function atDayFraction(dayStart, frac) {
    const d = new Date(dayStart);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, Math.round(frac * DAY)).getTime();
  }

  const api = {
    DAY,
    startOfDayMs,
    addDaysMs,
    daysBetween,
    mondayOfMs,
    agendaRange,
    shiftAnchor,
    sessionSegments,
    deadlineItems,
    repeatGhosts,
    layoutOverlaps,
    snapMinutes,
    clampSpan,
    dayFraction,
    atDayFraction,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

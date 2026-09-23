/* Календарь-расписание — чистая логика, без DOM и без state.
 *
 * Здесь всё, что нужно часовой сетке: какой отрезок дней она показывает, как
 * нарезать записи времени по дням, как разложить пересекающиеся записи по
 * колонкам и как прилипать к шагу сетки. Отрисовка и перетаскивание живут в
 * app.js, а сюда вынесено то, что можно проверить без браузера.
 */
(function (global) {
  const DAY = 86400000;
  const MIN = 60000;

  const startOfDayMs = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };

  /** Понедельник недели, в которую попала дата. Неделя начинается с
   *  понедельника — так же, как в остальном приложении. */
  function mondayOfMs(d) {
    const x = new Date(startOfDayMs(d));
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getTime();
  }

  /** Сколько дней показывает режим. У месяца дни считаются отдельно: их
   *  число зависит от того, на какие дни недели пришлись края. */
  const MODE_DAYS = { day: 1, days4: 4, week: 7 };

  /** Отрезок, который показывает сетка: [начало первого дня, конец последнего).
   *  Месяц округляется до целых недель, чтобы сетка была прямоугольной.
   *  @param {string} mode — day | days4 | week | month | agenda */
  function agendaRange(mode, anchor) {
    const a = startOfDayMs(anchor);
    if (mode === 'week') {
      const from = mondayOfMs(a);
      return { from, to: from + 7 * DAY, days: 7 };
    }
    if (mode === 'month') {
      const d = new Date(a);
      const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
      const from = mondayOfMs(first);
      const to = mondayOfMs(last) + 7 * DAY;
      return { from, to, days: Math.round((to - from) / DAY) };
    }
    if (mode === 'agenda') return { from: a, to: a + 30 * DAY, days: 30 };
    const days = MODE_DAYS[mode] || 1;
    return { from: a, to: a + days * DAY, days };
  }

  /** Сдвиг на шаг вперёд или назад по тому же режиму. */
  function shiftAnchor(mode, anchor, dir) {
    const a = startOfDayMs(anchor);
    if (mode === 'month') {
      const d = new Date(a);
      return new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime();
    }
    if (mode === 'week') return mondayOfMs(a) + dir * 7 * DAY;
    if (mode === 'agenda') return a + dir * 30 * DAY;
    return a + dir * (MODE_DAYS[mode] || 1) * DAY;
  }

  /** Записи времени, нарезанные по дням отрезка.
   *
   *  Запись, перешедшая за полночь, показывается куском в каждом дне: иначе
   *  ночная работа целиком приписывалась бы дню, в котором началась, и
   *  пропадала бы из следующего.
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
          const dayEnd = dayStart + DAY;
          const segEnd = Math.min(b, dayEnd, to);
          out.push({
            taskId: task.id,
            index: i,
            projectId: task.projectId,
            dayIndex: Math.round((dayStart - from) / DAY),
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
      .map((d) => ({ ...d, dayIndex: Math.round((startOfDayMs(d.at) - from) / DAY) }))
      .sort((a, b) => a.at - b.at);
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
    const min = Math.max(1, minMin || 5) * MIN;
    let a = Math.max(day, Math.min(start, day + DAY - min));
    let b = Math.min(day + DAY, Math.max(end, a + min));
    if (b - a < min) a = Math.max(day, b - min);
    return { start: a, end: b };
  }

  /** Доля суток, на которой стоит момент времени: 0 — полночь, 1 — конец дня.
   *  По ней часовая сетка расставляет блоки по высоте. */
  function dayFraction(ms) {
    const day = startOfDayMs(ms);
    return (ms - day) / DAY;
  }

  const api = {
    DAY,
    startOfDayMs,
    mondayOfMs,
    agendaRange,
    shiftAnchor,
    sessionSegments,
    deadlineItems,
    layoutOverlaps,
    snapMinutes,
    clampSpan,
    dayFraction,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

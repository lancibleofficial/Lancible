/* Деньги и агрегация времени — чистые функции, без DOM и без state.
 *
 * Здесь считается то, за что пользователю платят, поэтому каждая величина,
 * которая раньше бралась из state прямо внутри функции — ставка по умолчанию,
 * идущий таймер, текущий момент — теперь приходит параметром. Иначе это
 * нельзя проверить тестом: результат зависел бы от времени запуска.
 */
(function (global) {
  const F = (typeof module !== 'undefined' && module.exports) ? require('./format.js') : global.Core;
  const { hoursOf, dayKey, taskElapsedMs } = F;

  /** Ставка задачи: своя, если задана, иначе общая из настроек. */
  function effectiveRate(task, defaultRate) {
    const own = task.rate;
    if (own !== null && own !== undefined && own !== '' && Number.isFinite(Number(own))) return Number(own);
    return Number(defaultRate) || 0;
  }

  const hasOwnRate = (task) =>
    task.rate !== null && task.rate !== undefined && task.rate !== '' && Number.isFinite(Number(task.rate));

  /** Ставка записи времени. У записи может быть своя — ставку меняли уже
   *  после того, как время было записано, и прошлое пересчитывать нельзя. */
  function sessionRate(s, task, defaultRate) {
    const r = s && s.rate;
    return r !== null && r !== undefined && Number.isFinite(Number(r)) ? Number(r) : effectiveRate(task, defaultRate);
  }

  const sessionMoney = (s, task, defaultRate) => hoursOf(s.ms) * sessionRate(s, task, defaultRate);

  /** Заработано по задаче. Идущий таймер добавляется по текущей ставке. */
  function earnedOf(task, defaultRate, activeTimer, now) {
    let money = (task.sessions || []).reduce((a, s) => a + sessionMoney(s, task, defaultRate), 0);
    if (activeTimer && activeTimer.taskId === task.id) {
      const runMs = now - new Date(activeTimer.startedAt).getTime();
      money += hoursOf(runMs) * effectiveRate(task, defaultRate);
    }
    return money;
  }

  /** Показывать ли заработанное рядом с таймером. Да, если у задачи есть
   *  ставка (своя или общая) — сумма растёт, пока идёт таймер, и ноль тоже
   *  ответ; и да, если заработанное уже есть, даже когда ставку потом сняли:
   *  у прошлых записей своя ставка, и деньги за них никуда не делись. Нет —
   *  только когда и ставки нет, и заработанного нет: там «0 ₽» был бы шумом. */
  const earnedShown = (task, defaultRate, earned) => earned > 0 || effectiveRate(task, defaultRate) > 0;

  /** Все пары «задача + запись времени» одним списком — основа любой сводки. */
  function allSessionPairs(tasks) {
    const out = [];
    for (const t of tasks) for (const s of t.sessions || []) out.push({ t, s });
    return out;
  }

  /** Сводка по дням: ключ дня → время, деньги, число записей. */
  function aggregateDays(tasks, defaultRate) {
    const map = new Map();
    for (const { t, s } of allSessionPairs(tasks)) {
      const k = dayKey(s.start);
      let e = map.get(k);
      if (!e) { e = { ms: 0, money: 0, count: 0 }; map.set(k, e); }
      e.ms += s.ms;
      e.money += sessionMoney(s, t, defaultRate);
      e.count += 1;
    }
    return map;
  }

  /** Сумма за диапазон дат [from, to] включительно. */
  function rangeAgg(tasks, from, to, defaultRate) {
    let ms = 0;
    let money = 0;
    for (const { t, s } of allSessionPairs(tasks)) {
      const d = new Date(s.start);
      if (d >= from && d <= to) { ms += s.ms; money += sessionMoney(s, t, defaultRate); }
    }
    return { ms, money };
  }

  /** Задачи, отмеченные выполненными в конкретный день. У завершённых до
   *  появления поля doneAt его нет — такие не попадают ни в один день, и это
   *  ожидаемо, а не потеря. */
  const tasksDoneOnDay = (tasks, key) => tasks.filter((t) => t.doneAt && dayKey(t.doneAt) === key);

  const projectMoney = (tasks, defaultRate, activeTimer, now) =>
    tasks.reduce((a, t) => a + earnedOf(t, defaultRate, activeTimer, now), 0);
  const projectMs = (tasks, activeTimer, now) =>
    tasks.reduce((a, t) => a + taskElapsedMs(t, activeTimer, now), 0);

  /** Правка записи времени: что станет с задачей, если положить в неё
   *  отрезок span. index — номер правимой записи, null — новая.
   *
   *  Возвращает новые sessions и totalMs, а не мутирует задачу: решение и
   *  применение разделены так же, как в planTaskDone и planRepeatRoll.
   *  Здесь это особенно уместно — арифметика totalMs про деньги, и проверять
   *  её надо отдельно от того, кто её записывает.
   *
   *  Своя ставка записи переживает правку: её ставили осознанно, и
   *  пересчитывать её по текущей ставке задачи нельзя — это молча изменило бы
   *  уже заработанное. */
  function planSessionEdit(task, index, span, defaultRate, now) {
    const entry = {
      start: new Date(span.start).toISOString(),
      end: new Date(span.end).toISOString(),
      ms: span.ms,
      rate: effectiveRate(task, defaultRate),
      manual: true,
    };
    const sessions = (task.sessions || []).slice();
    const old = (index !== null && index !== undefined) ? sessions[index] : null;
    let totalMs;
    if (old) {
      if (Number.isFinite(Number(old.rate))) entry.rate = Number(old.rate);
      sessions[index] = entry;
      totalMs = Math.max(0, (task.totalMs || 0) - old.ms + span.ms);
    } else {
      sessions.push(entry);
      totalMs = (task.totalMs || 0) + span.ms;
    }
    return { sessions, totalMs, updatedAt: new Date(now).toISOString() };
  }

  const api = {
    effectiveRate, hasOwnRate, sessionRate, sessionMoney, earnedOf, earnedShown,
    allSessionPairs, aggregateDays, rangeAgg, tasksDoneOnDay,
    projectMoney, projectMs, planSessionEdit,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Статусы задач — чистая логика, без DOM и без state.
 *
 * Набор статусов свой у каждого проекта: у разных работ разный процесс.
 * Функции получают весь список статусов параметром и сами отбирают нужный
 * проект — так их можно проверить тестом на выдуманном наборе.
 */
(function (global) {
  // Вид статуса — то, что приложение о нём знает независимо от названия.
  // Пользователь волен переименовать «In progress» хоть в «Пишу код», но
  // считать такую задачу выполненной всё равно нельзя.
  //   backlog   — не запланировано.
  //   todo      — запланировано, ждёт начала.
  //   progress  — в работе. Сюда же «Checking»: задача ещё открыта, просто
  //               находится на проверке, а не пишется.
  //   done      — сделано. Единственный вид, который считается выполненным.
  //   cancelled — закрыто, но НЕ сделано. Отменённая задача уходит из работы,
  //               как и выполненная, но записывать её в достижения нельзя:
  //               иначе «сделано 8 из 10» станет враньём.
  const STATUS_KINDS = ['backlog', 'todo', 'progress', 'done', 'cancelled'];

  /** Виды, которые убирают задачу из активной работы. */
  const CLOSING_KINDS = ['done', 'cancelled'];

  // Набор по умолчанию. Встроенные статусы можно переименовать и перекрасить,
  // но не удалить: если убрать последний «готово», задачу станет нечем закрыть,
  // а весь учёт времени и статистика на этом и держатся.
  const DEFAULT_STATUSES = [
    { key: 'backlog', kind: 'backlog', color: '#6b7cad' },
    { key: 'todo', kind: 'todo', color: '#8a93a5' },
    { key: 'progress', kind: 'progress', color: '#f5c451' },
    { key: 'checking', kind: 'progress', color: '#5ec8f2' },
    { key: 'done', kind: 'done', color: '#87ff65' },
    { key: 'cancelled', kind: 'cancelled', color: '#8a93a5' },
  ];

  /** Статусы проекта в порядке, заданном пользователем: это же порядок
   *  столбцов доски. */
  const orderedStatuses = (statuses, projectId) =>
    statuses.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);

  const getStatus = (statuses, id) => statuses.find((s) => s.id === id) || null;

  const statusesOfKind = (statuses, projectId, kind) =>
    orderedStatuses(statuses, projectId).filter((s) => s.kind === kind);

  /** Куда попадает задача, у которой статуса ещё нет: первый «готово» для
   *  завершённой, первый «к выполнению» для остальных. Всё в пределах её
   *  проекта. */
  function defaultStatusId(statuses, projectId, done) {
    const pool = statusesOfKind(statuses, projectId, done ? 'done' : 'todo');
    const fallback = orderedStatuses(statuses, projectId);
    return (pool[0] || (done ? fallback[fallback.length - 1] : fallback[0]) || {}).id || null;
  }

  const isDoneStatus = (statuses, id) => {
    const s = getStatus(statuses, id);
    return !!s && s.kind === 'done';
  };
  const isClosedStatus = (statuses, id) => {
    const s = getStatus(statuses, id);
    return !!s && CLOSING_KINDS.includes(s.kind);
  };

  /** Набор по умолчанию для нового проекта. Возвращает готовые строки, но
   *  никуда их не кладёт: имя статуса и генератор идентификаторов приходят
   *  снаружи, потому что первое зависит от языка, а второй — от окружения. */
  function makeProjectStatuses(projectId, nameOf, uid) {
    return DEFAULT_STATUSES.map((s, i) => ({
      id: uid(), projectId, name: nameOf(s.key),
      color: s.color, kind: s.kind, order: i, builtin: true,
    }));
  }

  /** Что случится, если удалить статус: либо он заблокирован, либо известно,
   *  куда переедут его задачи. Решение отделено от самого удаления, потому
   *  что между ними стоит вопрос пользователю, а спрашивать имеет смысл
   *  только когда переезжать действительно есть чему.
   *
   *  Два запрета, и оба не про удобство. Единственный статус проекта убрать
   *  нельзя: доска осталась бы без столбцов, а задачам негде стоять.
   *  Последний «готово» — тоже: задачу станет нечем закрыть, а на этом
   *  держится и статистика, и повторения. */
  function planStatusDelete(statuses, tasks, id) {
    const st = getStatus(statuses, id);
    if (!st) return { blocked: 'missing' };
    const list = orderedStatuses(statuses, st.projectId);
    if (list.length <= 1) return { blocked: 'last' };
    if (st.kind === 'done' && statusesOfKind(statuses, st.projectId, 'done').length <= 1) {
      return { blocked: 'last_done' };
    }
    // Задачи переезжают в статус того же вида — «в работе» остаётся «в
    // работе», — и только если такого нет, в первый попавшийся.
    const target = list.find((s) => s.id !== st.id && s.kind === st.kind)
      || list.find((s) => s.id !== st.id);
    return { status: st, target, moving: tasks.filter((t) => t.statusId === st.id) };
  }

  /** Что должно случиться по галочке «выполнено».
   *
   *  Решение отделено от применения, потому что применяют его по-разному:
   *  десктоп правит объект задачи на месте, телефон заменяет его в сторе.
   *  А правило одно, и разойтись ему нельзя — иначе одна и та же галочка
   *  уводит задачу в разные статусы на разных устройствах.
   *
   *  Статус меняется, только если он сейчас не того вида, какой нужен. У
   *  проекта может быть несколько завершающих статусов, и галочка не должна
   *  схлопывать их в один: задача в «Сдано» при повторной отметке остаётся
   *  в «Сдано», а не переезжает в первый «Готово».
   *
   *  Снятие галочки уводит в первый статус вида «к выполнению», а не туда,
   *  откуда задача пришла: откуда именно, нигде не хранится.
   *
   *  @returns {{moveTo: string}|{setDone: boolean}} — либо переезд в статус,
   *    либо просто смена флага.
   */
  function planTaskDone(statuses, task, done) {
    if (!task) return { setDone: !!done };
    if (isDoneStatus(statuses, task.statusId) !== done) {
      const next = defaultStatusId(statuses, task.projectId, done);
      if (next) return { moveTo: next };
    }
    return { setDone: !!done };
  }

  const api = {
    STATUS_KINDS, CLOSING_KINDS, DEFAULT_STATUSES,
    orderedStatuses, getStatus, statusesOfKind, defaultStatusId, planStatusDelete, planTaskDone,
    isDoneStatus, isClosedStatus, makeProjectStatuses,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

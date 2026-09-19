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

  const api = {
    STATUS_KINDS, CLOSING_KINDS, DEFAULT_STATUSES,
    orderedStatuses, getStatus, statusesOfKind, defaultStatusId,
    isDoneStatus, isClosedStatus, makeProjectStatuses,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

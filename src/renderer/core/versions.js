/* Версии — чистая логика, без DOM и без state.
 *
 * Версия принадлежит проекту, в отличие от тегов, которые общие на всё
 * приложение. У задачи версия ровно одна: «в какой выпуск это уезжает» —
 * вопрос с одним ответом, в отличие от тегов, которых бывает сколько угодно.
 *
 * На доске версии показываются дорожками: по полосе на версию, внутри полосы
 * — обычные столбцы статусов.
 */
(function (global) {
  const getVersion = (versions, id) => versions.find((v) => v.id === id) || null;

  /** Версии проекта в заданном пользователем порядке. Порядок хранится в
   *  поле order — как у статусов; migrate следит, чтобы он был сплошным. */
  const versionsOf = (versions, projectId) => versions
    .filter((v) => v.projectId === projectId)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  /** Порядок дорожек: сначала то, над чем работают, потом уже выпущенное.
   *  Выпущенная версия закрыта, и держать её сверху значит каждый раз
   *  пролистывать мимо неё к живой работе. Внутри выпущенных — по дате
   *  выпуска, чтобы недавнее было ближе. */
  function laneVersions(versions, projectId) {
    const list = versionsOf(versions, projectId);
    const open = list.filter((v) => !v.releasedAt);
    const shipped = list
      .filter((v) => v.releasedAt)
      .sort((a, b) => String(b.releasedAt).localeCompare(String(a.releasedAt)));
    return open.concat(shipped);
  }

  /** Дорожки доски: версия и её задачи.
   *
   *  Последней идёт дорожка без версии — и только если в ней есть задачи:
   *  пустая полоса «Без версии» не сообщает ничего, а место занимает. Сюда же
   *  попадают задачи со ссылкой на удалённую версию, иначе они пропали бы с
   *  доски совсем.
   *
   *  @param {Array} tasks — уже отобранные задачи проекта */
  function boardLanes(versions, tasks, projectId) {
    const known = new Set(versions.map((v) => v.id));
    const lanes = laneVersions(versions, projectId).map((v) => ({
      version: v,
      tasks: tasks.filter((t) => t.versionId === v.id),
    }));
    const loose = tasks.filter((t) => !t.versionId || !known.has(t.versionId));
    if (loose.length) lanes.push({ version: null, tasks: loose });
    return lanes;
  }

  /** Сколько задач в версии. Нужно и для подписи в настройках, и для честного
   *  предупреждения при удалении. */
  const versionUsage = (tasks, versionId) => tasks.filter((t) => t.versionId === versionId).length;

  /** Есть ли в этом проекте версия с таким названием. Сравнение без учёта
   *  регистра и краевых пробелов: «v1.2» и «V1.2 » на глаз не различить.
   *  В разных проектах одинаковые названия — норма, они не пересекаются. */
  function versionNameTaken(versions, projectId, name, exceptId) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return false;
    return versions.some((v) => v.projectId === projectId
      && v.id !== exceptId
      && String(v.name || '').trim().toLowerCase() === n);
  }

  /** Отбор задач по проекту и версии — один на список, статистику, календарь
   *  и выгрузку, чтобы они не разошлись в трактовке «все».
   *
   *  'all' в любом из двух полей значит «не отбирать по нему». 'none' в
   *  версии — только задачи без версии; туда же попадают ссылки на удалённую
   *  версию, иначе такая задача пропала бы из всех разрезов разом.
   *
   *  @param {{projectId?: string, versionId?: string}} filter */
  function filterTasks(tasks, versions, filter) {
    const f = filter || {};
    let out = tasks;
    if (f.projectId && f.projectId !== 'all') out = out.filter((t) => t.projectId === f.projectId);
    if (f.versionId && f.versionId !== 'all') {
      if (f.versionId === 'none') {
        const known = new Set(versions.map((v) => v.id));
        out = out.filter((t) => !t.versionId || !known.has(t.versionId));
      } else {
        out = out.filter((t) => t.versionId === f.versionId);
      }
    }
    return out === tasks ? tasks.slice() : out;
  }

  /** Отбор включён хоть по одному полю — по этому решается, показывать ли
   *  полоску «фильтр включён» и кнопку сброса. */
  const filterActive = (filter) => {
    const f = filter || {};
    return (!!f.projectId && f.projectId !== 'all') || (!!f.versionId && f.versionId !== 'all');
  };

  const api = {
    getVersion, versionsOf, laneVersions, boardLanes, versionUsage, versionNameTaken,
    filterTasks, filterActive,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

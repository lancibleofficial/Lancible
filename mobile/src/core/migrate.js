/* Приведение сохранённых данных к текущей форме.
 *
 * Самая опасная функция в приложении: она трогает всё, что пользователь
 * накопил, при каждом запуске, и её ошибка необратима — испорченные данные
 * обратно не собрать. Поэтому она вынесена сюда и покрыта тестами.
 *
 * Состояние меняется на месте (как и раньше), но всё, что приходило из
 * окружения — перевод строк, генератор идентификаторов, палитра, список
 * валют, — теперь передаётся параметром deps. Это и делает функцию
 * проверяемой: тест подставляет свои.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const S = isNode ? require('./status.js') : global.Core;

  /**
   * @param {object} state — состояние приложения, меняется на месте
   * @param {object} deps  — { t, uid, langs, palette, currencies, sym2code,
   *                           defaultProjectNameKey, ui? }
   *   ui(state, { known, fallback }) — необязательный крючок: приводит в
   *   порядок поля интерфейса своей платформы, когда уже известно, какие
   *   проекты живы.
   * @returns {object} то же состояние, для удобства вызова
   */
  function migrate(state, deps) {
    const { t, uid, langs, palette, currencies, sym2code, defaultProjectNameKey } = deps;
    const { DEFAULT_STATUSES, STATUS_KINDS } = S;

    if (!Array.isArray(state.tasks)) state.tasks = [];
    if (!Array.isArray(state.projects)) state.projects = [];
    if (!Array.isArray(state.statuses)) state.statuses = [];
    if (!Array.isArray(state.tags)) state.tags = [];
    if (!Array.isArray(state.versions)) state.versions = [];
    // Документы (с 7 октября 2026). Документ без id не открыть и не удалить —
    // такой выбрасываем; ссылка на исчезнувший проект делает его общим.
    if (!Array.isArray(state.documents)) state.documents = [];
    state.documents = state.documents.filter((d) => d && typeof d === 'object' && d.id);
    {
      const alive = new Set(state.projects.map((p) => p.id));
      for (const d of state.documents) {
        if (d.projectId && !alive.has(d.projectId)) d.projectId = null;
        if (typeof d.title !== 'string') d.title = '';
      }
    }
    if (!state.ui || typeof state.ui !== 'object') state.ui = {};
    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
    if (!Number.isFinite(Number(state.settings.hourlyRate))) state.settings.hourlyRate = 0;
    if (!['system', 'light', 'dark'].includes(state.settings.theme)) state.settings.theme = 'system';
    if (!langs.includes(state.settings.lang)) state.settings.lang = 'ru';
    if (typeof state.settings.syncEnabled !== 'boolean') state.settings.syncEnabled = true;
    if (typeof state.settings.notifyEnabled !== 'boolean') state.settings.notifyEnabled = true;
    if (!state.settings.syncResolvedFor || typeof state.settings.syncResolvedFor !== 'object') state.settings.syncResolvedFor = null;

    let cur = state.settings.currency || 'RUB';
    if (sym2code[cur]) cur = sym2code[cur];
    if (!currencies[cur]) cur = 'RUB';
    state.settings.currency = cur;

    // Статусы принадлежат проекту: у каждого свой набор, который можно
    // настроить под его процесс. Новый проект получает набор по умолчанию, а
    // дальше это обычные пользовательские данные.
    //
    // Первая версия делала статусы общими для всех проектов. Здесь такой набор
    // (у него нет projectId) разводится по проектам: каждому достаётся своя
    // копия с теми же названиями и цветами, а задачи переезжают на копию своего
    // проекта. Без переноса задача осталась бы со статусом, которого в её
    // проекте нет, и молча сбросилась бы в «к выполнению».
    const projectIds = new Set(state.projects.map((p) => p.id));
    const legacy = state.statuses.filter((s) => !s.projectId);
    const template = legacy.length ? legacy : null;
    const remap = new Map(); // `${projectId}:${oldId}` -> новый id

    for (const p of state.projects) {
      if (state.statuses.some((s) => s.projectId === p.id)) continue;
      const source = template || DEFAULT_STATUSES.map((s, i) => ({
        id: `d${i}`, name: t(`status.default_${s.key}`), color: s.color, kind: s.kind, order: i, builtin: true,
      }));
      source.forEach((s, i) => {
        const copy = {
          id: uid(), projectId: p.id, name: s.name, color: s.color,
          kind: s.kind, order: Number.isFinite(Number(s.order)) ? s.order : i, builtin: !!s.builtin,
        };
        remap.set(`${p.id}:${s.id}`, copy.id);
        state.statuses.push(copy);
      });
    }
    if (legacy.length) state.statuses = state.statuses.filter((s) => s.projectId);
    state.statuses = state.statuses.filter((s) => projectIds.has(s.projectId));

    state.statuses.forEach((s, i) => {
      if (!STATUS_KINDS.includes(s.kind)) s.kind = 'todo';
      if (!s.color) s.color = palette[i % palette.length];
      if (!Number.isFinite(Number(s.order))) s.order = i;
      if (typeof s.builtin !== 'boolean') s.builtin = false;
    });
    for (const p of state.projects) {
      S.orderedStatuses(state.statuses, p.id).forEach((s, i) => { s.order = i; });
    }
    // Перенос задач на статусы их собственного проекта — до общей проверки ниже.
    if (remap.size) {
      for (const task of state.tasks) {
        const moved = remap.get(`${task.projectId}:${task.statusId}`);
        if (moved) task.statusId = moved;
      }
    }

    // Тег проекта, которого больше нет, никому не виден — убираем. Общий —
    // с пустым projectId (у тегов старой версии поля не было).
    state.tags = state.tags.filter((tg) => !tg.projectId || projectIds.has(tg.projectId));
    state.tags.forEach((tg, i) => {
      if (!tg.color) tg.color = palette[i % palette.length];
      if (typeof tg.name !== 'string') tg.name = '';
      if (!tg.projectId) tg.projectId = null;
    });

    state.versions = state.versions.filter((v) => projectIds.has(v.projectId));
    state.versions.forEach((v) => {
      if (typeof v.name !== 'string') v.name = '';
      if (v.releasedAt === undefined) v.releasedAt = null;
    });
    // Порядок версий — как у статусов: он решает, в каком порядке идут
    // дорожки на доске, и должен переживать перезагрузку. Нумерация сплошная
    // внутри проекта, иначе после удаления версии «выше/ниже» начинают
    // прыгать через дырки.
    const byProject = new Map();
    state.versions.forEach((v) => {
      if (!byProject.has(v.projectId)) byProject.set(v.projectId, []);
      byProject.get(v.projectId).push(v);
    });
    byProject.forEach((list) => {
      list.sort((a, b) => (Number.isFinite(a.order) ? a.order : Infinity) - (Number.isFinite(b.order) ? b.order : Infinity));
      list.forEach((v, i) => { v.order = i; });
    });

    const tagIds = new Set(state.tags.map((tg) => tg.id));
    const keepTags = (arr) => (Array.isArray(arr) ? arr.filter((id) => tagIds.has(id)) : []);

    state.projects.forEach((p, i) => {
      if (!p.color) p.color = palette[i % palette.length];
      if (typeof p.description !== 'string') p.description = '';
      if (p.pinnedAt === undefined) p.pinnedAt = null;
      p.tagIds = keepTags(p.tagIds);
      // Своя ставка и валюта проекта (с 7 октября 2026). Пусто — общие из
      // настроек. Валюта хранится кодом, символ переводится, как и общая.
      if (p.rate === null || p.rate === '' || p.rate === undefined || !Number.isFinite(Number(p.rate))) p.rate = null;
      else p.rate = Number(p.rate);
      let pc = p.currency || null;
      if (pc && sym2code[pc]) pc = sym2code[pc];
      p.currency = pc && currencies[pc] ? pc : null;
    });
    state.tasks.forEach((task) => {
      if (task.pinnedAt === undefined) task.pinnedAt = null;
      if (task.rate === undefined) task.rate = null;
      // Записи времени и их сумма. Без этой починки задача с sessions: null
      // роняет первый же подсчёт: sessionsOf зовёт .filter. Приехать такое
      // может из синхронизации или из правленого руками файла.
      if (!Array.isArray(task.sessions)) task.sessions = [];
      if (!Number.isFinite(task.totalMs)) task.totalMs = 0;
      // Срок и напоминание. remindOffsetMin — «за сколько минут до срока»
      // (0 = ровно в срок); когда он null, а remindAt задан — это выбранное
      // вручную время. notifiedAt не даёт уведомить о задаче дважды и
      // синхронизируется вместе с остальным, так что второе устройство
      // не покажет то же самое ещё раз.
      if (task.dueAt === undefined) task.dueAt = null;
      if (task.remindOffsetMin === undefined) task.remindOffsetMin = null;
      if (task.remindAt === undefined) task.remindAt = null;
      if (task.notifiedAt === undefined) task.notifiedAt = null;
      // Статус и done живут в паре. Ведущим остаётся done: на нём держатся
      // статистика, календарь и счётчики, и переписывать их разом было бы
      // рискованно. Статус добавляет подробность — в каком именно состоянии
      // задача, — а done отвечает на единственный вопрос «закончена ли».
      if (!task.statusId || !state.statuses.some((s) => s.id === task.statusId)) {
        task.statusId = S.defaultStatusId(state.statuses, task.projectId, task.done);
      }
      task.tagIds = keepTags(task.tagIds);
      if (task.versionId !== undefined && !state.versions.some((v) => v.id === task.versionId)) task.versionId = null;
      if (task.versionId === undefined) task.versionId = null;
      if (task.repeat !== undefined && task.repeat !== null && typeof task.repeat !== 'object') task.repeat = null;
      if (task.repeat === undefined) task.repeat = null;
      task.cancelled = S.isClosedStatus(state.statuses, task.statusId) && !task.done;
    });

    if (state.projects.length === 0 && state.tasks.length > 0) {
      state.projects.push({
        id: uid(), name: t(defaultProjectNameKey), createdAt: new Date().toISOString(),
        color: palette[0], description: '', pinnedAt: null,
      });
    }
    const known = new Set(state.projects.map((p) => p.id));
    const fallback = state.projects[0] ? state.projects[0].id : null;
    for (const task of state.tasks) if (!task.projectId || !known.has(task.projectId)) task.projectId = fallback;
    if (!known.has(state.ui.projectId)) state.ui.projectId = fallback;

    // Поля интерфейса у платформ свои и общими быть не могут: у десктопа
    // свёрнутая панель и отметка «уведомления просмотрены», у телефона
    // положение доски и подсказка про свайп. Чинит их каждая сторона сама —
    // здесь только место и список живых проектов, без которого не проверить
    // ссылки.
    if (deps.ui) deps.ui(state, { known, fallback });

    return state;
  }

  const api = { migrate };
  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Дублирование проекта и задачи — чистая логика, без DOM и без state.
 *
 * Копия — это новые записи с новыми идентификаторами, а не ссылки на старые:
 * правка копии не должна задевать оригинал, и наоборот. Поэтому всё вложенное
 * (текст задачи, правило повторения, документы) копируется глубоко, а ссылки
 * по id внутри копии переписываются на копии же: статус скопированной задачи
 * стоит в статусах скопированного проекта, а не оригинала. Общие теги
 * (projectId пуст) не копируются — их у копии и оригинала один набор.
 *
 * Записи времени (sessions, totalMs) не копируются никогда: иначе часы и деньги
 * в отчётах удвоились бы от одного нажатия.
 *
 * Картинки в тексте — ссылки asset:<id> на общее хранилище (src/editor/
 * assets.js), байты там лежат по id, а не внутри задачи. Копия получает те же
 * ссылки, байты не дублируются: ничто, кроме удаления аккаунта, картинку из
 * хранилища не стирает, а при удалении аккаунта пропадает всё сразу.
 *
 * Функции ничего не вставляют и не меняют в том, что получили: возвращают
 * готовые записи, а куда их положить — решает вызывающий. Генератор id и
 * «сейчас» приходят параметром o ({ uid, now, suffix }): первый зависит от
 * окружения, второй — от часов, и проверять на них тестом нельзя. suffix —
 * «(копия)» на языке интерфейса в момент копирования.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const S = isNode ? require('./status.js') : global.Core;

  /** Глубокая копия данных пользователя. Всё, что тут лежит, — JSON: так оно и
   *  сохраняется, и уходит в синхронизацию. */
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  /** Название копии: «Сайт (копия)». Пустое остаётся пустым: у новой задачи
   *  названия может ещё не быть, и «(копия)» вместо него уже было бы названием. */
  function copyTitle(title, suffix) {
    const s = String(title || '').trim();
    return s ? `${s} ${suffix}` : '';
  }

  /** Задача-копия без записей времени; id, проект и время правки — новые. Всё
   *  остальное (текст, теги, версия, срок, повторение, ставка, закрепление) —
   *  как у оригинала: что из этого менять дальше, решает вызывающий.
   *
   *  Исключение — отметка «уже напомнили» (notifiedAt): она про оригинал.
   *  Копия с тем же сроком и напоминанием унесла бы её с собой и никогда не
   *  напомнила бы о себе. То же с отметкой у отрезков «времени работы»
   *  (notifiedUpTo) и с датой возврата закрытой повторяющейся задачи
   *  (reopenAt): открытая копия своего возврата не ждёт. Копия, что остаётся
   *  закрытой (копия проекта), дату возврата берёт обратно — см.
   *  duplicateProject.
   *
   *  Напоминания списка (core/reminders.js) — со своими id и без отметок
   *  «уже напомнили» (notifiedUpTo, notifiedAt): это напоминания копии, а не
   *  оригинала. */
  function cloneTask(task, id, projectId, now, uid) {
    const copy = Object.assign(clone(task), {
      id, projectId, createdAt: now, updatedAt: now, sessions: [], totalMs: 0, notifiedAt: null, reopenAt: null,
    });
    if (Array.isArray(copy.slots)) {
      copy.slots = copy.slots.map((s) => (s && typeof s === 'object' ? { ...s, notifiedUpTo: null } : s));
    }
    if (Array.isArray(copy.reminders)) {
      copy.reminders = copy.reminders.map((r) => {
        if (!r || typeof r !== 'object' || Array.isArray(r)) return r;
        const fresh = { ...r, id: uid() };
        if ('notifiedUpTo' in fresh) fresh.notifiedUpTo = null;
        if ('notifiedAt' in fresh) fresh.notifiedAt = null;
        return fresh;
      });
    }
    return copy;
  }

  /** Копия задачи в том же проекте: всё, кроме записей времени и отметки
   *  «выполнено».
   *
   *  Статус тот же, но если он завершающий (выполнено, отменено), копия
   *  открыта, и ей нужен статус по умолчанию для открытых задач проекта: иначе
   *  она стояла бы в столбце «Готово» с done: false. То же и со статусом,
   *  которого в проекте уже нет.
   *
   *  @param {{tasks: Array, statuses: Array}} data
   *  @returns {object|null} задача-копия или null, если оригинала нет */
  function duplicateTask(data, taskId, o) {
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const copy = cloneTask(task, o.uid(), task.projectId, o.now, o.uid);
    copy.title = copyTitle(task.title, o.suffix);
    copy.done = false;
    copy.doneAt = null;
    copy.cancelled = false;
    if (!S.getStatus(data.statuses, task.statusId) || S.isClosedStatus(data.statuses, task.statusId)) {
      copy.statusId = S.defaultStatusId(data.statuses, task.projectId, false);
    }
    return copy;
  }

  /** Копия проекта целиком: настройки, статусы, версии, теги проекта, все
   *  задачи со всем содержимым и документы. Не копируются только записи
   *  времени. Выполненность задач, их статусы, закрепление и сроки — как есть,
   *  но статус, версия и теги проекта у задач копии — копии, а не оригинала.
   *
   *  @param {{projects, tasks, statuses, versions, tags, documents: Array}} data
   *  @returns {{project, statuses, versions, tags, tasks, documents}|null} —
   *    готовые записи копии, в данные они не вставлены; null, если проекта нет */
  function duplicateProject(data, projectId, o) {
    const project = data.projects.find((p) => p.id === projectId);
    if (!project) return null;
    const id = o.uid();
    const statusIds = new Map();
    const versionIds = new Map();
    const tagIds = new Map();
    const own = (rows) => (rows || []).filter((r) => r.projectId === projectId);
    // Строка проекта (статус, версия, тег) — копией со своим id; соответствие
    // старого id новому запоминается для ссылок из задач.
    const copyRow = (map) => (row) => {
      const copy = Object.assign(clone(row), { id: o.uid(), projectId: id });
      map.set(row.id, copy.id);
      return copy;
    };

    const statuses = own(data.statuses).map(copyRow(statusIds));
    const versions = own(data.versions).map(copyRow(versionIds));
    const tags = own(data.tags).map(copyRow(tagIds));
    // Общие теги в карте не значатся и остаются как были.
    const remapTags = (ids) => (Array.isArray(ids) ? ids : []).map((x) => tagIds.get(x) || x);

    const copy = Object.assign(clone(project), {
      id, name: copyTitle(project.name, o.suffix), createdAt: o.now, tagIds: remapTags(project.tagIds),
    });
    const tasks = own(data.tasks).map((task) => {
      const c = cloneTask(task, o.uid(), id, o.now, o.uid);
      c.statusId = statusIds.get(task.statusId) || S.defaultStatusId(statuses, id, !!task.done);
      c.versionId = versionIds.get(task.versionId) || null;
      c.tagIds = remapTags(task.tagIds);
      // Закрытая копия ждёт того же дня, что и оригинал. Без reopenAt её
      // подобрало бы лечение planReopen (core/slots.js) как закрытую старым
      // клиентом и засчитало бы раз серии второй раз.
      if (task.done && task.reopenAt) c.reopenAt = task.reopenAt;
      return c;
    });
    const documents = own(data.documents).map((d) => Object.assign(clone(d), {
      id: o.uid(), projectId: id, createdAt: o.now, updatedAt: o.now,
    }));
    return { project: copy, statuses, versions, tags, tasks, documents };
  }

  const api = { copyTitle, duplicateTask, duplicateProject };

  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Основной стор данных — порт мутирующей логики из src/renderer/app.js
// (создание/удаление/закрепление проектов и задач: app.js:2362-2486;
// таймер: app.js:2795-2825). В оригинале это "state-объект + render()",
// здесь то же самое через zustand: экшены сразу мутируют и сохраняют
// (persist сам пишет в AsyncStorage), подписчики перерисовываются сами —
// отдельный scheduleSave()/render() не нужен.
//
// Диалоги подтверждения ("удалить задачу?") — на совести экрана (Alert.alert
// перед вызовом deleteTask/deleteProject), а не стора: так короче для
// компонентных сценариев, чем портировать confirmDialog-паттерн сюда же.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyState, migrate, uid, PALETTE } from '../lib/migrate';
import { scheduleTaskReminder, cancelTaskReminder, rescheduleAll } from '../lib/notifications';
import { effectiveRate, earnedOf, taskElapsedMs } from '../lib/format';
import { seedProjectStatuses, defaultStatusId, getStatus, orderedStatuses, planStatusDelete, isDoneStatus } from '../lib/statuses';
import { t } from '../lib/i18n';
import Repeat from '../core/repeat.js';
import Versions from '../core/versions.js';

export const useAppStore = create(
  persist(
    (set, get) => ({
      ...emptyState(),
      hasHydrated: false,
      toastMessage: null,
      toastAction: null,

      _runMigration() {
        set((s) => migrate({ ...s }));
        set({ hasHydrated: true });
      },

      /** Тост. Вторым аргументом можно передать действие
       *  { label, onPress } — тогда рядом с текстом появляется кнопка.
       *  Действие живёт ровно столько же, сколько сам тост: это
       *  предложение «пока не поздно», а не постоянная кнопка. */
      showToast(message, action) {
        set({ toastMessage: message, toastAction: action || null });
        setTimeout(() => {
          if (get().toastMessage === message) set({ toastMessage: null, toastAction: null });
        }, 2500);
      },

      hideToast() {
        set({ toastMessage: null, toastAction: null });
      },

      // --- проекты ---
      createProject({ name, color, description, tagIds }) {
        const now = new Date().toISOString();
        const project = {
          id: uid(),
          name: (name || '').trim() || PALETTE[0],
          color: color || PALETTE[get().projects.length % PALETTE.length],
          description: description || '',
          tagIds: Array.isArray(tagIds) ? tagIds : [],
          createdAt: now,
          pinnedAt: null,
        };
        // Набор статусов заводится сразу: доска строится из них, и проект
        // без них был бы пустой доской, а задача — без статуса.
        set((s) => ({
          projects: [project, ...s.projects],
          statuses: [...s.statuses, ...seedProjectStatuses(project.id, s.settings.lang)],
        }));
        return project;
      },
      updateProject(id, patch) {
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      },
      togglePinProject(id) {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, pinnedAt: p.pinnedAt ? null : new Date().toISOString() } : p),
        }));
      },
      deleteProject(id) {
        set((s) => {
          const activeTask = s.activeTimer && s.tasks.find((task) => task.id === s.activeTimer.taskId);
          const dropActiveTimer = activeTask && activeTask.projectId === id;
          return {
            tasks: s.tasks.filter((task) => task.projectId !== id),
            projects: s.projects.filter((p) => p.id !== id),
            activeTimer: dropActiveTimer ? null : s.activeTimer,
          };
        });
      },

      // --- задачи ---
      createTask(projectId) {
        const now = new Date().toISOString();
        const task = {
          id: uid(), projectId, title: '', done: false, notes: null,
          totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
          dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
          // Поля заводятся здесь, а не только в migrate(): та правит уже
          // сохранённые данные при загрузке и до задачи, созданной в этом же
          // запуске, не доберётся.
          tagIds: [],
          statusId: defaultStatusId(get().statuses, projectId, false),
          versionId: null,
          repeat: null,
          cancelled: false,
        };
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return task;
      },
      // --- теги ---
      // Общие на всё приложение: один тег живёт и на проекте, и на задаче в
      // любом другом проекте. Чистая часть — в lib/tags.js.
      createTag({ name, color }) {
        const tag = {
          id: uid(),
          name: (name || '').trim(),
          color: color || PALETTE[get().tags.length % PALETTE.length],
        };
        set((s) => ({ tags: [...s.tags, tag] }));
        return tag;
      },
      updateTag(id, patch) {
        set((s) => ({ tags: s.tags.map((tg) => (tg.id === id ? { ...tg, ...patch } : tg)) }));
      },
      /** Удаление снимает тег со всех сущностей: переносить его некуда, в
       *  отличие от статуса, у которого есть соседний столбец. */
      deleteTag(id) {
        set((s) => ({
          tags: s.tags.filter((tg) => tg.id !== id),
          projects: s.projects.map((p) => ((p.tagIds || []).includes(id)
            ? { ...p, tagIds: p.tagIds.filter((x) => x !== id) } : p)),
          tasks: s.tasks.map((t) => ((t.tagIds || []).includes(id)
            ? { ...t, tagIds: t.tagIds.filter((x) => x !== id) } : t)),
        }));
      },
      setTaskTags(taskId, tagIds) {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId
            ? { ...t, tagIds, updatedAt: new Date().toISOString() } : t)),
        }));
      },
      setProjectTags(projectId, tagIds) {
        set((s) => ({ projects: s.projects.map((p) => (p.id === projectId ? { ...p, tagIds } : p)) }));
      },

      updateTask(id, patch) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task)),
        }));
      },
      /** Правка дедлайна/напоминания. notifiedAt сбрасывается, чтобы
       *  перенесённая задача могла уведомить заново, и тут же
       *  переставляется системное уведомление: приложение в фоне
       *  выгружено и само проверить время не сможет. */
      setTaskDue(id, patch) {
        let updated = null;
        set((s) => ({
          tasks: s.tasks.map((task) => {
            if (task.id !== id) return task;
            updated = { ...task, ...patch, notifiedAt: null, updatedAt: new Date().toISOString() };
            return updated;
          }),
        }));
        const { lang, notifyEnabled } = get().settings;
        if (updated) scheduleTaskReminder(updated, lang, notifyEnabled !== false);
      },
      markNotifSeen() {
        set((s) => ({ ui: { ...s.ui, notifSeenAt: new Date().toISOString() } }));
      },
      setNotifyEnabled(value) {
        set((s) => ({ settings: { ...s.settings, notifyEnabled: value } }));
        const { tasks, settings } = get();
        rescheduleAll(tasks, settings.lang, value);
      },
      /** Единственное место, где меняется статус задачи. done и cancelled
       *  следуют за видом статуса: иначе список, доска и статистика
       *  разойдутся между собой. */
      setTaskStatus(id, statusId) {
        const st = getStatus(get().statuses, statusId);
        if (!st) return;
        const before = get().tasks.find((t2) => t2.id === id);
        const wasDone = !!(before && before.done);
        const now = new Date().toISOString();
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id ? {
            ...task,
            statusId: st.id,
            done: st.kind === 'done',
            cancelled: st.kind === 'cancelled',
            doneAt: st.kind === 'done' ? (task.doneAt || now) : null,
            updatedAt: now,
          } : task)),
        }));
        get()._afterTaskClosed(id, wasDone);
      },

      /** Галочка «выполнено». Порт setTaskDone из src/renderer/app.js,
       *  вплоть до условия: статус меняется только если он сейчас не того
       *  вида, какой нужен. У проекта может быть несколько завершающих
       *  статусов, и галочка не должна схлопывать их в один — задача,
       *  стоящая в «Сдано», при повторной отметке остаётся в «Сдано», а не
       *  переезжает в первый «Готово».
       *
       *  Снятие галочки уводит задачу в первый статус вида «к выполнению»
       *  (defaultStatusId с done: false) — не в тот, откуда она пришла:
       *  откуда именно, нигде не хранится, и веб ведёт себя так же. */
      setTaskDone(id, done) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (!task) return;
        if (isDoneStatus(get().statuses, task.statusId) !== done) {
          const next = defaultStatusId(get().statuses, task.projectId, done);
          if (next) { get().setTaskStatus(id, next); return; }
        }
        const wasDone = !!task.done;
        const now = new Date().toISOString();
        set((s) => ({
          tasks: s.tasks.map((t2) => (t2.id === id
            ? { ...t2, done, doneAt: done ? now : null, updatedAt: now }
            : t2)),
        }));
        get()._afterTaskClosed(id, wasDone);
      },

      toggleTaskDone(id) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (task) get().setTaskDone(id, !task.done);
      },

      /** Задачу закрыли — если у неё есть правило, она возвращается со
       *  следующим сроком. С «оставлять копии» прежняя остаётся в списке
       *  выполненной, со своим временем. Порт afterTaskClosed/rollRepeat
       *  из src/renderer/app.js. */
      _afterTaskClosed(id, wasDone) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (task && !wasDone && task.done && task.repeat) get()._rollRepeat(id);
        const fresh = get().tasks.find((t2) => t2.id === id);
        const { lang, notifyEnabled } = get().settings;
        if (fresh) scheduleTaskReminder(fresh, lang, notifyEnabled !== false);
      },

      _rollRepeat(id) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (!task || !task.dueAt) return;
        const rule = Repeat.normalizeRepeat(task.repeat);
        if (!rule) return;
        const done = { ...rule, done: (rule.done || 0) + 1 };
        const now = new Date().toISOString();
        // Серия кончилась — задача просто остаётся закрытой.
        if (Repeat.repeatFinished(done)) {
          set((s) => ({ tasks: s.tasks.map((t2) => (t2.id === id ? { ...t2, repeat: done, updatedAt: now } : t2)) }));
          return;
        }
        const base = rule.from === 'completion' ? Date.now() : new Date(task.dueAt).getTime();
        const next = Repeat.nextDue(done, base);
        if (!next) return;
        const openStatus = defaultStatusId(get().statuses, task.projectId, false);
        const copyId = uid();
        set((s) => ({
          tasks: s.tasks.flatMap((t2) => {
            if (t2.id !== id) return [t2];
            const reopened = {
              ...t2,
              repeat: done,
              done: false,
              cancelled: false,
              doneAt: null,
              statusId: openStatus || t2.statusId,
              dueAt: new Date(next).toISOString(),
              notifiedAt: null,
              updatedAt: now,
            };
            if (!rule.keepHistory) return [reopened];
            // Копия — это история: своё время, своя запись, без правила.
            const copy = {
              ...t2,
              id: copyId,
              repeat: null,
              done: true,
              doneAt: t2.doneAt || now,
              pinnedAt: null,
              remindAt: null,
              notifiedAt: null,
              updatedAt: now,
            };
            return [{ ...reopened, totalMs: 0, sessions: [] }, copy];
          }),
        }));
      },

      setTaskRepeat(id, rule) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id
            ? { ...task, repeat: rule ? Repeat.normalizeRepeat(rule) : null, updatedAt: new Date().toISOString() }
            : task)),
        }));
      },

      setTaskVersion(id, versionId) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id
            ? { ...task, versionId: versionId || null, updatedAt: new Date().toISOString() }
            : task)),
        }));
      },

      // --- версии проекта ---
      createVersion(projectId, name) {
        const clean = (name || "").trim();
        if (!clean) return null;
        const own = Versions.versionsOf(get().versions, projectId);
        const version = {
          id: uid(), projectId, name: clean,
          order: own.length ? Math.max(...own.map((v) => v.order || 0)) + 1 : 0,
          releasedAt: null,
        };
        set((s) => ({ versions: [...s.versions, version] }));
        return version;
      },
      renameVersion(id, name) {
        const clean = (name || "").trim();
        if (!clean) return;
        set((s) => ({ versions: s.versions.map((v) => (v.id === id ? { ...v, name: clean } : v)) }));
      },
      toggleVersionReleased(id) {
        set((s) => ({
          versions: s.versions.map((v) => (v.id === id
            ? { ...v, releasedAt: v.releasedAt ? null : new Date().toISOString() }
            : v)),
        }));
      },
      deleteVersion(id) {
        // Версию убрали — задачи остаются, просто без неё.
        set((s) => ({
          versions: s.versions.filter((v) => v.id !== id),
          tasks: s.tasks.map((task) => (task.versionId === id
            ? { ...task, versionId: null, updatedAt: new Date().toISOString() }
            : task)),
        }));
      },
      togglePinTask(id) {
        set((s) => ({
          tasks: s.tasks.map((task) =>
            task.id === id
              ? { ...task, pinnedAt: task.pinnedAt ? null : new Date().toISOString(), updatedAt: new Date().toISOString() }
              : task),
        }));
      },
      deleteTask(id) {
        cancelTaskReminder(id);
        set((s) => ({
          tasks: s.tasks.filter((task) => task.id !== id),
          activeTimer: s.activeTimer && s.activeTimer.taskId === id ? null : s.activeTimer,
        }));
      },

      // --- таймер ---
      startTimer(taskId) {
        get().stopTimer();
        const now = new Date().toISOString();
        set({ activeTimer: { taskId, startedAt: now, heartbeatAt: now } });
      },
      stopTimer() {
        const { activeTimer } = get();
        if (!activeTimer) return;
        const { taskId, startedAt } = activeTimer;
        const end = new Date();
        const ms = Math.max(0, end.getTime() - new Date(startedAt).getTime());
        set((s) => ({
          tasks: ms >= 1000
            ? s.tasks.map((task) => (task.id === taskId
                ? {
                    ...task,
                    sessions: [
                      ...(task.sessions || []),
                      { start: startedAt, end: end.toISOString(), ms, rate: effectiveRate(task, s.settings.hourlyRate) },
                    ],
                    totalMs: (task.totalMs || 0) + ms,
                    updatedAt: end.toISOString(),
                  }
                : task))
            : s.tasks,
          activeTimer: null,
        }));
      },

      // --- статусы проекта ---
      // Набор свой у каждого проекта, поэтому правится он с доски этого
      // проекта, а не в общих настройках. Правила — в core/status.js,
      // тот же файл, по которому работает веб.

      /** Новый статус в конец списка. Возвращает id: экран ставит курсор
       *  в его название, как это делает addStatus в вебе. */
      addStatus(projectId) {
        const list = orderedStatuses(get().statuses, projectId);
        const row = {
          id: uid(),
          projectId,
          name: t(get().settings.lang, "status.add"),
          color: PALETTE[list.length % PALETTE.length],
          kind: "todo",
          order: list.length,
          builtin: false,
        };
        set((s) => ({ statuses: [...s.statuses, row] }));
        return row.id;
      },

      /** Название и цвет — всё, что меняется без последствий для задач. */
      updateStatus(id, patch) {
        set((s) => ({ statuses: s.statuses.map((st) => (st.id === id ? { ...st, ...patch } : st)) }));
      },

      /** Вид решает, закрыта ли задача и считается ли она сделанной, —
       *  поэтому все задачи этого статуса надо пересчитать. Иначе доска,
       *  галочки и статистика разойдутся; в вебе тот же пересчёт. */
      setStatusKind(id, kind) {
        set((s) => ({ statuses: s.statuses.map((st) => (st.id === id ? { ...st, kind } : st)) }));
        for (const task of get().tasks.filter((t2) => t2.statusId === id)) {
          get().setTaskStatus(task.id, id);
        }
      },

      /** Меняет статус местами с соседом: порядок статусов — это порядок
       *  столбцов доски, и другого способа задать его нет. */
      moveStatus(id, dir) {
        const st = get().statuses.find((s2) => s2.id === id);
        if (!st) return;
        const list = orderedStatuses(get().statuses, st.projectId);
        const i = list.findIndex((s2) => s2.id === id);
        const other = list[dir === "up" ? i - 1 : i + 1];
        if (!other) return;
        set((s) => ({
          statuses: s.statuses.map((row) => {
            if (row.id === st.id) return { ...row, order: other.order };
            if (row.id === other.id) return { ...row, order: st.order };
            return row;
          }),
        }));
      },

      /** Само удаление. Проверки и вопрос «куда переедут задачи» остаются
       *  экрану: между решением и действием стоит подтверждение. */
      deleteStatus(id) {
        const plan = planStatusDelete(get().statuses, get().tasks, id);
        if (plan.blocked || !plan.target) return;
        for (const task of plan.moving) get().setTaskStatus(task.id, plan.target.id);
        const projectId = plan.status.projectId;
        set((s) => {
          const rest = s.statuses.filter((st) => st.id !== id);
          // Порядок пересчитывается подряд, без дыр: иначе следующий
          // добавленный статус получит чужой номер.
          const order = new Map(orderedStatuses(rest, projectId).map((st, i) => [st.id, i]));
          return { statuses: rest.map((st) => (order.has(st.id) ? { ...st, order: order.get(st.id) } : st)) };
        });
      },

      /** Задача прямо в ячейке доски: тот же набор полей, что у
       *  newTaskInStatus в вебе, плюс версия ячейки и уже введённое
       *  название — на телефоне его спрашивают до создания, а не после. */
      createTaskInStatus(projectId, statusId, versionId, title) {
        const now = new Date().toISOString();
        const st = getStatus(get().statuses, statusId);
        const task = {
          id: uid(), projectId, title: String(title || "").trim(), notes: null,
          totalMs: 0, sessions: [], rate: null, pinnedAt: null, createdAt: now, updatedAt: now,
          dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
          tagIds: [], statusId, versionId: versionId || null, repeat: null,
          // Вид статуса решает, а не умолчание: задачу можно завести сразу
          // в «Готово», и тогда она выполненная с первой секунды.
          done: !!st && st.kind === "done",
          cancelled: !!st && st.kind === "cancelled",
        };
        task.doneAt = task.done ? now : null;
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return task;
      },
      // --- навигация (какой проект открыт — не персистится в UI-смысле,
      // но храним рядом с остальным state ради простоты) ---
      openProject(id) {
        set({ ui: { view: 'project', projectId: id } });
      },
      backHome() {
        set((s) => ({ ui: { ...s.ui, view: 'home' } }));
      },
      // Какой проект показывает вкладка «Доска». Живёт в ui, потому что это
      // именно состояние экрана, а не данные: пользователь открывает доску
      // и ожидает увидеть тот проект, на котором закончил.
      setBoardProject(id) {
        set((s) => ({ ui: { ...s.ui, boardProjectId: id } }));
      },
      /** Отбор по версии — свой у каждого проекта: у одного смотрят
       *  релиз, у другого всё сразу, и общая настройка сбрасывала бы
       *  чужой выбор. ALL_VERSIONS — без отбора, пустая строка — «без
       *  версии». */
      setBoardVersion(projectId, versionId) {
        set((s) => ({ ui: { ...s.ui, boardVersion: { ...s.ui.boardVersion, [projectId]: versionId } } }));
      },
      /** В какой проект «+» в шапке Главной кладёт задачу. Подряд их
       *  обычно заводят в один и тот же, поэтому лист открывается на
       *  том, где создали прошлую. */
      setQuickAddProject(id) {
        set((s) => ({ ui: { ...s.ui, quickAddProjectId: id } }));
      },
      /** Подсказка о свайпе показывается один раз за установку — это
       *  обучение, а не настройка, и синхронизировать его между
       *  устройствами нечего. */
      markSwipeHintShown() {
        set((s) => ({ ui: { ...s.ui, homeSwipeHintShown: true } }));
      },
      /** Свёрнутые ряды версий — тоже по проектам и тоже только на этом
       *  устройстве: это положение экрана, а не данные. */
      toggleBoardLane(projectId, laneId) {
        set((s) => {
          const all = s.ui.boardCollapsed || {};
          const mine = all[projectId] || [];
          const next = mine.includes(laneId) ? mine.filter((x) => x !== laneId) : [...mine, laneId];
          return { ui: { ...s.ui, boardCollapsed: { ...all, [projectId]: next } } };
        });
      },

      // --- настройки ---
      setSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
    }),
    {
      name: 'lancible-data',
      storage: createJSONStorage(() => AsyncStorage),
      // Теги, статусы и версии — такие же пользовательские данные, как
      // проекты и задачи. Без них в этом списке они жили только в памяти:
      // после перезапуска телефон оставался без статусов и версий до
      // первой синхронизации, а без учётной записи — навсегда.
      partialize: (s) => ({
        projects: s.projects, tasks: s.tasks, tags: s.tags,
        statuses: s.statuses, versions: s.versions,
        activeTimer: s.activeTimer, ui: s.ui, settings: s.settings,
      }),
      onRehydrateStorage: () => () => {
        // Срабатывает асинхронно после чтения AsyncStorage — к этому моменту
        // useAppStore уже точно проинициализирован.
        useAppStore.getState()._runMigration();
      },
    }
  )
);

// --- чистые геттеры (порт app.js:625-637) — принимают срез state явно,
// не читают стор сами, чтобы быть пригодными и внутри, и вне компонентов ---
export const getTask = (tasks, id) => tasks.find((task) => task.id === id) || null;
export const getProject = (projects, id) => projects.find((p) => p.id === id) || null;
export const tasksOf = (tasks, projectId) => tasks.filter((task) => task.projectId === projectId);
const byPinned = (a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt);

/** Задачи проекта: закреплённые / в работе / выполненные. */
export function sortedProjectTasks(tasks, projectId) {
  const list = tasksOf(tasks, projectId);
  const pinned = list.filter((task) => task.pinnedAt).sort(byPinned);
  const rest = list.filter((task) => !task.pinnedAt && !task.done);
  const done = list.filter((task) => !task.pinnedAt && task.done);
  return { pinned, rest, done, all: [...pinned, ...rest, ...done] };
}

export const projectMs = (tasks, projectId, activeTimer) =>
  tasksOf(tasks, projectId).reduce((a, task) => a + taskElapsedMs(task, activeTimer), 0);
export const projectMoney = (tasks, projectId, hourlyRate, activeTimer) =>
  tasksOf(tasks, projectId).reduce((a, task) => a + earnedOf(task, hourlyRate, activeTimer), 0);

/** Порт recentTasks() из app.js:1495-1508 — незавершённые задачи, по
 * которым недавно была активность (сессия или правка), новые сверху. */
export function recentTasks(tasks, limit) {
  return tasks
    .filter((task) => !task.done)
    .map((task) => {
      let last = 0;
      for (const s of task.sessions || []) last = Math.max(last, new Date(s.end || s.start).getTime());
      if (!last) last = new Date(task.updatedAt || task.createdAt || 0).getTime();
      return { task, last };
    })
    .filter((x) => x.last > 0)
    .sort((a, b) => b.last - a.last)
    .slice(0, limit)
    .map((x) => x.task);
}

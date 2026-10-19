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
import { rescheduleAll } from '../lib/notifications';
import { effectiveRate, earnedOf, taskElapsedMs } from '../lib/format';
import { ratesOf } from '../lib/rates';
import CoreMoney from '../core/money.js';
import { seedProjectStatuses, defaultStatusId, getStatus, orderedStatuses, planStatusDelete, planTaskDone } from '../lib/statuses';
import { t } from '../lib/i18n';
import Repeat from '../core/repeat.js';
import Slots from '../core/slots.js';
import Reminders from '../core/reminders.js';
import Versions from '../core/versions.js';
import DocCore from '../core/doc.js';
import Duplicate from '../core/duplicate.js';
import Accounts from '../core/accounts.js';
import Ai from '../core/ai.js';
import { unpackSync2, packSync2, freshExtra } from '../lib/oplogScope';

// Списки, которые правит предложение агента (core/ai.js: aiApply, aiUndo).
const AI_LISTS = ['projects', 'statuses', 'versions', 'tags', 'tasks', 'documents'];

/** Глубокая копия списков: ядро правит state на месте, стор — только set. */
function aiDraft(s) {
  return JSON.parse(JSON.stringify(Object.fromEntries(AI_LISTS.map((k) => [k, s[k] || []]))));
}

/** Правленая копия → патч стора: с миграцией, как приём синхронизации
 *  (lib/sync.js: applyBundle), — поля, которых ядро не заводит, она
 *  достроит так же, как при загрузке. */
function aiPatch(s, draft) {
  const fixed = migrate({ ...s, ...draft, ui: { ...s.ui }, settings: { ...s.settings } });
  return Object.fromEntries(AI_LISTS.map((k) => [k, fixed[k]]));
}

/** Отрезки задачи с id у каждого: пришедший из облака отрезок мог быть
 *  записан без него, а править и удалять без id нечем. */
function slotsWithIds(task) {
  return Slots.slotsOf(task).map((sl) => (sl.id ? sl : { ...sl, id: uid() }));
}

/** Задача после правки списка напоминаний: edit получает список (как его
 *  читает ядро) и отдаёт новый. Патч withReminders применяется целиком —
 *  вместе с зеркалом старых полей (remindOffsetMin, remindAt), которые читают
 *  десктоп 0.4.3 и телефон 1.2.2, и со снятой отметкой у изменённого. */
function withReminderList(task, edit) {
  return { ...task, ...Reminders.withReminders(task, edit(Reminders.remindersOf(task))), updatedAt: new Date().toISOString() };
}

// --- область данных (несколько аккаунтов, 17 октября 2026) ---
//
// persist пишет в хранилище после каждого set(...), и до того, как область
// прочитана, такая запись легла бы пустым состоянием поверх данных, а во
// время смены аккаунта — данными прежнего поверх нового. Поэтому запись
// закрыта, пока область не прочитана: от старта до первого openDataScope и
// на время каждой смены.
let scopeWrites = false;
const scopedStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => (scopeWrites ? AsyncStorage.setItem(key, value) : Promise.resolve()),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/** Состояние открытой области. Прочитанное ложится на пустое, а не на
 *  прежнее: поле, которого в записи нет, не должно приехать из области
 *  другого аккаунта. Записи нет вовсе — область открывают впервые: пустые
 *  данные, а язык и тема — от прежней области, это выбор человека на этом
 *  телефоне, а не данные аккаунта.
 *  Журнал правок области (поле sync2, lib/oplogScope.js) — тоже свой и
 *  ставится всегда: прежняя область свою пачку сюда не протащит, а чужая
 *  (sync2.uid не тот) не читается. */
function mergeScope(persisted, current) {
  const base = emptyState();
  const uid = (current && current.scopeUid) || null;
  if (persisted && typeof persisted === 'object') {
    const { sync2, oplog: _dev, ...rest } = persisted;
    const { bundle, extra } = unpackSync2(sync2, rest, uid);
    return { ...current, ...base, ...rest, oplog: bundle, syncExtra: extra };
  }
  const prev = (current && current.settings) || {};
  return {
    ...current,
    ...base,
    settings: { ...base.settings, ...(prev.lang ? { lang: prev.lang } : {}), ...(prev.theme ? { theme: prev.theme } : {}) },
    oplog: null,
    syncExtra: freshExtra(),
  };
}

// Чтение области упало (19 октября 2026): отказ AsyncStorage (на Android —
// строка длиннее ~2 МБ), битый JSON, исключение при разборе журнала правок.
// persist тогда зовёт колбэк с ошибкой, а стор остаётся прежним — со
// списками и журналом прежней области, хотя имя хранилища уже новое. Открой
// запись в этот миг — прежние данные и их неотправленные правки легли бы
// под ключ нового аккаунта и ушли бы в его облако; на старте пустое
// состояние легло бы поверх нечитаемой записи. Поэтому запись открывает
// только удачное чтение (onRehydrateStorage), а ошибка остаётся здесь.
let readError = null;
// Номер открытия: чтение, начатое раньше последнего открытия, ничего не
// решает (persist его колбэк и не зовёт).
let opens = 0;

/** Открыть область данных: uid аккаунта или null — гость. Пока читается,
 *  hasHydrated ложно (экраны ждут), запись закрыта; после чтения — миграция
 *  и возврат закрытых повторяющихся задач (_runMigration), как на старте.
 *  Чтение не удалось — запись остаётся закрытой (нечитаемая запись цела), в
 *  памяти — пусто, а не прежняя область, hasHydrated ложно (синхронизация
 *  молчит), scopeError — { uid }: RootNavigator показывает ошибку с
 *  «Повторить». Запись открывает только удачное чтение именно этого вызова:
 *  второе открытие, начатое поверх первого, не откроет её раньше времени.
 *  @returns прочиталась ли область */
export async function openDataScope(uid) {
  const mine = (opens += 1);
  scopeWrites = false;
  readError = null;
  useAppStore.setState({ hasHydrated: false, scopeUid: uid || null, scopeError: null });
  useAppStore.persist.setOptions({ name: Accounts.mobileDataName(uid) });
  await useAppStore.persist.rehydrate();
  if (mine !== opens) return false; // поверх открыли снова — решает то открытие
  if (!readError) return useAppStore.getState().hasHydrated;
  console.error('Не удалось прочитать данные на телефоне:', readError);
  readError = null;
  scopeWrites = false;
  useAppStore.setState((s) => ({ ...mergeScope(null, s), hasHydrated: false, scopeError: { uid: uid || null } }));
  return false;
}

/** Проект поменяли — у него новое время последнего изменения (круг 21):
 *  колода (Core.projectsByActivity) ставит свежий проект первым. Правка
 *  проекта — имя, описание, цвет, метки, ставка и валюта, его статусы, версии
 *  и свои теги; закрепление — не правка (оно больше не ставит проект первым).
 *  updatedAt у журнала правок — тихое поле (core/oplog.js, QUIET). */
export function touchProject(projects, id, now = new Date().toISOString()) {
  if (!id) return projects;
  return projects.map((p) => (p.id === id ? { ...p, updatedAt: now } : p));
}

export const useAppStore = create(
  persist(
    (set, get) => ({
      ...emptyState(),
      // Журнал правок открытой области (lib/oplogScope.js, lib/sync.js):
      // пачка — когда область связана с журналом, иначе null (гость и
      // аккаунт до первого обмена очередь не копят); syncExtra — зеркало для
      // старых клиентов, слепок, мост, ждущий перенос; scopeUid — чья область
      // открыта (null — гость).
      oplog: null,
      syncExtra: freshExtra(),
      scopeUid: null,
      hasHydrated: false,
      // Область не прочиталась: { uid } — чья (null — гость), иначе null.
      // Не сохраняется (partialize его не берёт).
      scopeError: null,
      toastMessage: null,
      toastAction: null,
      // Облако картинок редактора на паузе — пока удаляется аккаунт
      // (lib/auth.js: deleteAccount). Не сохраняется: пауза живёт одну попытку.
      assetsPaused: false,
      // id картинок, стёртых из облака при удалении аккаунта, которое не
      // удалось: их надо выгрузить обратно. Сохраняется — редактор может
      // открыться и после перезапуска (EditorScreen → DocEditor).
      // Чистится, как только страница редактора поставила их в очередь
      // (requeue), даже если входа сейчас нет и выгрузить нечем: дальше их
      // ведёт пометка pending в IndexedDB, и выгрузит следующий flush — при
      // ближайшем входе.
      assetRequeue: [],
      // Аккаунт, которому отдать картинки, вставленные без аккаунта (17 октября
      // 2026): данные «Без аккаунта» перенесли в аккаунт (useAuthStore:
      // moveGuestData), а их картинки в хранилище страницы редактора (IndexedDB)
      // ничьи и сами в облако не уходят. Отдаёт их страница редактора
      // (assets-adopt, src/editor/host.js) — ближайшая открытая: открытой нет —
      // ждёт её ready. Сохраняется: редактор могут открыть и после перезапуска.
      assetAdopt: null,

      _runMigration() {
        set((s) => migrate({ ...s }));
        // Закрытые повторяющиеся задачи без дат ждут своего дня: пока
        // приложение было выгружено, он мог наступить.
        get().reopenDue();
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
      createProject({ name, color, description, tagIds, rate, currency }) {
        const now = new Date().toISOString();
        const project = {
          id: uid(),
          name: (name || '').trim() || PALETTE[0],
          color: color || PALETTE[get().projects.length % PALETTE.length],
          description: description || '',
          tagIds: Array.isArray(tagIds) ? tagIds : [],
          // Своя ставка и валюта проекта (7 октября 2026): пусто — общие из
          // настроек. Правила расчёта — core/money.js.
          rate: rate === undefined || rate === '' ? null : rate,
          currency: currency || null,
          createdAt: now,
          updatedAt: now,
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
        const now = new Date().toISOString();
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now } : p)) }));
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
            // Свои теги проекта уходят вместе с ним; общие остаются.
            tags: s.tags.filter((tg) => tg.projectId !== id),
            // Документы проекта не удаляются вместе с ним — становятся общими.
            documents: (s.documents || []).map((d) => (d.projectId === id ? { ...d, projectId: null } : d)),
            activeTimer: dropActiveTimer ? null : s.activeTimer,
          };
        });
      },

      // --- документы ---
      createDocument(projectId) {
        const doc = DocCore.newDocument({ id: uid(), projectId: projectId || null });
        set((s) => ({ documents: [doc, ...(s.documents || [])] }));
        return doc.id;
      },
      updateDocument(id, patch) {
        set((s) => ({
          documents: (s.documents || []).map((d) => (d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d)),
        }));
      },
      deleteDocument(id) {
        set((s) => ({ documents: (s.documents || []).filter((d) => d.id !== id) }));
      },
      togglePinDocument(id) {
        set((s) => ({
          documents: (s.documents || []).map((d) => (d.id === id ? { ...d, pinnedAt: d.pinnedAt ? null : new Date().toISOString() } : d)),
        }));
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
      // Общие (без projectId) видны во всех проектах; свои у проекта — только
      // в нём (core/tags.js, tagsForProject). Чистая часть — в lib/tags.js.
      createTag({ name, color, projectId }) {
        const tag = {
          id: uid(),
          name: (name || '').trim(),
          color: color || PALETTE[get().tags.length % PALETTE.length],
          projectId: projectId || null,
        };
        set((s) => ({ tags: [...s.tags, tag], projects: touchProject(s.projects, tag.projectId) }));
        return tag;
      },
      updateTag(id, patch) {
        const own = (get().tags.find((tg) => tg.id === id) || {}).projectId;
        set((s) => ({ tags: s.tags.map((tg) => (tg.id === id ? { ...tg, ...patch } : tg)), projects: touchProject(s.projects, own) }));
      },
      /** Удаление снимает тег со всех сущностей: переносить его некуда, в
       *  отличие от статуса, у которого есть соседний столбец. */
      deleteTag(id) {
        const own = (get().tags.find((tg) => tg.id === id) || {}).projectId;
        set((s) => ({
          tags: s.tags.filter((tg) => tg.id !== id),
          projects: touchProject(s.projects.map((p) => ((p.tagIds || []).includes(id)
            ? { ...p, tagIds: p.tagIds.filter((x) => x !== id) } : p)), own),
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
        const now = new Date().toISOString();
        set((s) => ({ projects: s.projects.map((p) => (p.id === projectId ? { ...p, tagIds, updatedAt: now } : p)) }));
      },

      updateTask(id, patch) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task)),
        }));
      },
      /** Правка дедлайна: patch — {dueAt}. Напоминаний он не касается — они
       *  списком (addTaskReminder и другие ниже); «до дедлайна» едут за ним
       *  сами. notifiedAt сбрасывается, чтобы перенесённая задача могла
       *  уведомить заново. Системное уведомление переставит слежение за
       *  расписанием (lib/reminderSync.js): приложение в фоне выгружено и само
       *  проверить время не сможет. */
      setTaskDue(id, patch) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id
            ? { ...task, ...patch, notifiedAt: null, updatedAt: new Date().toISOString() }
            : task)),
        }));
      },

      // --- напоминания (core/reminders.js) ---
      // Список правится только через withReminders: он выдаёт патч вместе с
      // зеркалом старых полей и решает, у каких напоминаний отметка «уже
      // напомнили» остаётся.

      /** Новое напоминание: raw — {kind: 'before', anchor, offsetMin, unit},
       *  {kind: 'at', at} или {kind: 'repeat', rule, time, start}. Возвращает
       *  его id или null, если напоминание негодное (ничего не пишется). */
      addTaskReminder(taskId, raw) {
        const rem = Reminders.normalizeReminder({ ...raw, id: uid() });
        if (!rem) return null;
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === taskId ? withReminderList(task, (list) => [...list, rem]) : task)),
        }));
        return rem.id;
      },
      /** Правка напоминания: raw — как у addTaskReminder, целиком или частью.
       *  Другой вид заменяет напоминание, тот же — дополняет. Негодная правка
       *  его не портит: false. */
      updateTaskReminder(taskId, reminderId, raw) {
        const task = get().tasks.find((x) => x.id === taskId);
        const old = task ? Reminders.remindersOf(task).find((r) => r.id === reminderId) : null;
        if (!old) return false;
        const rem = Reminders.normalizeReminder({ ...((raw.kind || old.kind) === old.kind ? old : null), ...raw, id: old.id });
        if (!rem) return false;
        set((s) => ({
          tasks: s.tasks.map((x) => (x.id === taskId ? withReminderList(x, (list) => list.map((r) => (r.id === old.id ? rem : r))) : x)),
        }));
        return true;
      },
      removeTaskReminder(taskId, reminderId) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === taskId ? withReminderList(task, (list) => list.filter((r) => r.id !== reminderId)) : task)),
        }));
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
            // Открыли вручную — ждать «возвращения» больше нечего, и раз серии,
            // засчитанный закрытием, снимается (core/slots.js, planUntick).
            ...(st.kind !== 'done' ? Slots.planUntick(task) : null),
            updatedAt: now,
          } : task)),
        }));
        get()._afterTaskClosed(id, wasDone);
      },

      /** Галочка «выполнено». Само правило — в ядре (core/status.js,
       *  planTaskDone), общее с десктопом; здесь только применение к стору.
       *  Пересказывать правило тут нельзя: пересказ разойдётся с кодом
       *  раньше, чем кто-нибудь это заметит. */
      setTaskDone(id, done) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (!task) return;
        const plan = planTaskDone(get().statuses, task, done);
        if (plan.moveTo) { get().setTaskStatus(id, plan.moveTo); return; }
        const wasDone = !!task.done;
        const now = new Date().toISOString();
        set((s) => ({
          tasks: s.tasks.map((t2) => (t2.id === id
            ? {
              ...t2,
              done: plan.setDone,
              doneAt: plan.setDone ? now : null,
              ...(!plan.setDone ? Slots.planUntick(t2) : null),
              updatedAt: now,
            }
            : t2)),
        }));
        get()._afterTaskClosed(id, wasDone);
      },

      toggleTaskDone(id) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (task) get().setTaskDone(id, !task.done);
      },

      /** Вернуть в работу отменённую задачу: статус по умолчанию для открытой
       *  (первый «к выполнению» проекта) — тот же, что у снятой галочки. Само
       *  setTaskDone её не откроет: planTaskDone сверяет только «готово», а
       *  отменённая и так «не готова». */
      reopenTask(id) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (!task) return;
        const statusId = defaultStatusId(get().statuses, task.projectId, false);
        if (statusId) get().setTaskStatus(id, statusId);
      },

      /** Задачу закрыли — если у неё есть правило, она возвращается: со
       *  следующим сроком или, если у неё нет дат, в свой день. С «оставлять
       *  копии» прежняя остаётся в списке выполненной, со своим временем.
       *  Порт afterTaskClosed/rollRepeat из src/renderer/app.js. */
      _afterTaskClosed(id, wasDone) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (task && !wasDone && task.done && task.repeat) get()._rollRepeat(id);
      },

      /** Перекат закрытой повторяющейся задачи. Решение — в ядре
       *  (core/slots.js, planTaskRoll: есть дедлайн, есть разовое время
       *  работы или нет ни того ни другого), общее с десктопом; здесь только
       *  применение к стору.
       *
       *  Раньше это была своя реализация, и она разошлась с десктопом по
       *  четырём местам сразу: сравнивала from с несуществующим
       *  «completion» (то есть отсчёт от дня закрытия не работал вовсе),
       *  не догоняла просроченный срок, считала следующую дату от уже
       *  увеличенного счётчика и проверяла конец серии после увеличения,
       *  а не до. */
      _rollRepeat(id) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (!task) return;
        const plan = Slots.planTaskRoll(task, Date.now());
        if (plan) get()._applyRoll(id, plan);
      },

      /** Применяет решение ядра к задаче: ответ planTaskRoll или строку
       *  planReopen — формат у них один.
       *   • серия кончилась — задача остаётся закрытой, растёт только счётчик;
       *   • open: false — остаётся закрытой и ждёт своего дня (reopenAt);
       *   • open: true — открывается сейчас: статус по умолчанию, без отметки
       *     о закрытии и об уведомлении. С «оставлять копии» сначала
       *     откладывается копия (с записями времени), потом они у задачи
       *     очищаются. */
      _applyRoll(id, plan, nowMs = Date.now()) {
        const task = get().tasks.find((t2) => t2.id === id);
        if (!task) return;
        const now = new Date(nowMs).toISOString();
        if (plan.finished) {
          set((s) => ({ tasks: s.tasks.map((t2) => (t2.id === id ? { ...t2, repeat: plan.repeat, updatedAt: now } : t2)) }));
          return;
        }
        if (!plan.open) {
          set((s) => ({ tasks: s.tasks.map((t2) => (t2.id === id ? { ...t2, ...plan.patch, updatedAt: now } : t2)) }));
          return;
        }
        const copy = plan.keepHistory ? Slots.historyCopy(task, uid(), nowMs) : null;
        const openStatus = defaultStatusId(get().statuses, task.projectId, false);
        const reopened = {
          ...task,
          ...plan.patch,
          done: false,
          cancelled: false,
          doneAt: null,
          statusId: openStatus || task.statusId,
          notifiedAt: null,
          updatedAt: now,
          ...(plan.keepHistory ? { totalMs: 0, sessions: [] } : null),
        };
        set((s) => ({ tasks: s.tasks.flatMap((t2) => (t2.id !== id ? [t2] : copy ? [reopened, copy] : [reopened])) }));
      },

      /** Вернуть закрытые повторяющиеся задачи, чей день наступил. Зовётся
       *  при загрузке данных и когда приложение вернули на экран. */
      reopenDue() {
        const now = Date.now();
        for (const plan of Slots.planReopen(get().tasks, now)) get()._applyRoll(plan.taskId, plan, now);
      },

      setTaskRepeat(id, rule) {
        const next = rule ? Repeat.normalizeRepeat(rule) : null;
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id
            ? {
              ...task,
              repeat: next,
              // Правило сняли — возвращать задачу больше не к чему.
              ...(task.reopenAt && !next ? { reopenAt: null } : null),
              updatedAt: new Date().toISOString(),
            }
            : task)),
        }));
      },

      // --- время работы (core/slots.js) ---
      // Отрезок читается и пишется только через ядро: normalizeSlot бракует
      // мусор (конец не позже начала) и оставляет неизвестные ключи.

      /** Новый отрезок. Возвращает его id или null, если отрезок негодный. */
      addTaskSlot(taskId, raw) {
        const slot = Slots.normalizeSlot({ ...raw, id: uid() });
        if (!slot) return null;
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === taskId
            ? { ...task, slots: [...slotsWithIds(task), slot], updatedAt: new Date().toISOString() }
            : task)),
        }));
        return slot.id;
      },
      /** Правка отрезка. Негодная (конец не позже начала) отрезок не портит.
       *  Напоминаний у отрезка нет — «до начала» в списке задачи, и отметка
       *  «уже напомнили» живёт там (core/reminders.js). */
      updateTaskSlot(taskId, slotId, patch) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === taskId
            ? {
              ...task,
              slots: slotsWithIds(task).map((sl) => (sl.id === slotId ? Slots.normalizeSlot({ ...sl, ...patch, id: sl.id }) || sl : sl)),
              updatedAt: new Date().toISOString(),
            }
            : task)),
        }));
      },
      removeTaskSlot(taskId, slotId) {
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === taskId
            ? { ...task, slots: slotsWithIds(task).filter((sl) => sl.id !== slotId), updatedAt: new Date().toISOString() }
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
        set((s) => ({ versions: [...s.versions, version], projects: touchProject(s.projects, projectId) }));
        return version;
      },
      renameVersion(id, name) {
        const clean = (name || "").trim();
        if (!clean) return;
        const own = (get().versions.find((v) => v.id === id) || {}).projectId;
        set((s) => ({ versions: s.versions.map((v) => (v.id === id ? { ...v, name: clean } : v)), projects: touchProject(s.projects, own) }));
      },
      toggleVersionReleased(id) {
        const own = (get().versions.find((v) => v.id === id) || {}).projectId;
        set((s) => ({
          versions: s.versions.map((v) => (v.id === id
            ? { ...v, releasedAt: v.releasedAt ? null : new Date().toISOString() }
            : v)),
          projects: touchProject(s.projects, own),
        }));
      },
      deleteVersion(id) {
        // Версию убрали — задачи остаются, просто без неё.
        const own = (get().versions.find((v) => v.id === id) || {}).projectId;
        set((s) => ({
          versions: s.versions.filter((v) => v.id !== id),
          projects: touchProject(s.projects, own),
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
        set((s) => ({
          tasks: s.tasks.filter((task) => task.id !== id),
          activeTimer: s.activeTimer && s.activeTimer.taskId === id ? null : s.activeTimer,
        }));
      },
      /** «Дублировать» (17 октября 2026). Что копируется, решает ядро
       *  (core/duplicate.js, общее с вебом): всё, кроме записей времени и
       *  отметки «выполнено», «(копия)» в названии на языке интерфейса. Стор
       *  только кладёт копию сразу за оригиналом — как веб (app.js:
       *  duplicateTask). Возвращает копию или null, если оригинала нет. */
      duplicateTask(id) {
        const s = get();
        const copy = Duplicate.duplicateTask(s, id, { uid, now: new Date().toISOString(), suffix: t(s.settings.lang, 'docs.copy_suffix') });
        if (!copy) return null;
        set((st) => {
          const at = st.tasks.findIndex((task) => task.id === id);
          const tasks = st.tasks.slice();
          tasks.splice(at < 0 ? tasks.length : at + 1, 0, copy);
          return { tasks };
        });
        return copy;
      },

      // --- ИИ-агент (вкладка «Чат-бот», 18 октября 2026) ---
      /** Предложение агента — в данные одной правкой. Что и как меняется,
       *  решает ядро (core/ai.js: aiApply — то же, что у веба): оно правит
       *  копию списков, копия проходит миграцию и ложится одним set. Задачи,
       *  которые предложение закрыло, дальше идут путём галочки
       *  (_afterTaskClosed: повтор перекатывается).
       *  @returns ответ aiApply ({ok, created, updated, closed, undo}); при
       *    ошибках проверки ({ok: false, errors}) стор не тронут */
      applyAiProposal(ops) {
        const s = get();
        const draft = aiDraft(s);
        const res = Ai.aiApply(draft, ops, {
          uid, now: new Date().toISOString(), statusName: (key) => t(s.settings.lang, `status.default_${key}`),
        });
        if (!res || res.ok === false) return res;
        set(aiPatch(s, draft));
        for (const id of res.closed || []) get()._afterTaskClosed(id, false);
        return res;
      },
      /** Отмена применённого предложения (Core.aiUndo) — тоже одной правкой.
       *  Таймер задачи, которую отмена убрала, останавливается без записи,
       *  как при удалении задачи. @param undo — undo из ответа aiApply */
      undoAiProposal(undo) {
        const s = get();
        // Таймер — ядру на виду (19 октября 2026): созданную агентом задачу, по
        // которой идёт таймер, aiUndo не удаляет (её время — не его правка), и
        // тогда стор ниже его не останавливает.
        const draft = { ...aiDraft(s), activeTimer: s.activeTimer ? { ...s.activeTimer } : null };
        const res = Ai.aiUndo(draft, JSON.parse(JSON.stringify(undo)));
        const patch = aiPatch(s, draft);
        if (s.activeTimer && !patch.tasks.some((task) => task && task.id === s.activeTimer.taskId)) patch.activeTimer = null;
        set(patch);
        return res;
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
                    // Запись — сразу со своим id: по нему журнал правок
                    // (core/oplog.js) узнаёт её, когда её потом подвинут.
                    sessions: [
                      ...(task.sessions || []),
                      { id: uid(), start: startedAt, end: end.toISOString(), ms, rate: effectiveRate(task, ratesOf(s.settings, s.projects)) },
                    ],
                    totalMs: (task.totalMs || 0) + ms,
                    updatedAt: end.toISOString(),
                  }
                : task))
            : s.tasks,
          activeTimer: null,
        }));
      },

      // --- записи времени ---
      // Правило — в ядре (core/money.js, planSessionEdit): ставка запоминается
      // такой, какая сейчас, у правленой записи остаётся прежняя. Здесь
      // только применение к задаче, как applySessionEdit на десктопе.

      /** Новая запись (index null) или правка записи по индексу. span —
       *  { start, end, ms } из lib/sessions.js. */
      saveSession(taskId, index, span) {
        const task = get().tasks.find((t2) => t2.id === taskId);
        if (!task || !span) return;
        const upd = CoreMoney.planSessionEdit(task, index, span, ratesOf(get().settings, get().projects), Date.now());
        // Новая запись — со своим id (правка прежней id сохраняет сама,
        // core/money.js): журнал правок узнаёт записи по id.
        if (index === null || index === undefined) {
          const last = upd.sessions.length - 1;
          if (last >= 0 && !upd.sessions[last].id) upd.sessions[last] = { ...upd.sessions[last], id: uid() };
        }
        set((s) => ({ tasks: s.tasks.map((t2) => (t2.id === taskId ? { ...t2, ...upd } : t2)) }));
      },

      deleteSession(taskId, index) {
        set((s) => ({
          tasks: s.tasks.map((t2) => {
            if (t2.id !== taskId || !t2.sessions || !t2.sessions[index]) return t2;
            const removed = t2.sessions[index];
            return {
              ...t2,
              sessions: t2.sessions.filter((_, i) => i !== index),
              totalMs: Math.max(0, (t2.totalMs || 0) - (removed.ms || 0)),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      /** Переписывает время записи, сохраняя всё остальное: ставку и пометки
       *  о ручном вводе и восстановлении. Происхождение записи не меняется
       *  от того, что её подвинули на сетке. */
      setSessionSpan(taskId, index, startMs, endMs) {
        set((s) => ({
          tasks: s.tasks.map((t2) => {
            const old = t2.id === taskId && t2.sessions ? t2.sessions[index] : null;
            if (!old) return t2;
            const ms = endMs - startMs;
            const sessions = t2.sessions.slice();
            sessions[index] = { ...old, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), ms };
            return { ...t2, sessions, totalMs: Math.max(0, (t2.totalMs || 0) - (old.ms || 0) + ms), updatedAt: new Date().toISOString() };
          }),
        }));
      },

      /** Запись, заведённая прямо на сетке: ставка такая, какая сейчас. */
      addSessionSpan(taskId, startMs, endMs) {
        const ms = endMs - startMs;
        set((s) => ({
          tasks: s.tasks.map((t2) => (t2.id === taskId ? {
            ...t2,
            sessions: [...(t2.sessions || []), {
              id: uid(), start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), ms,
              rate: effectiveRate(t2, ratesOf(s.settings, s.projects)), manual: true,
            }],
            totalMs: (t2.totalMs || 0) + ms,
            updatedAt: new Date().toISOString(),
          } : t2)),
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
        set((s) => ({ statuses: [...s.statuses, row], projects: touchProject(s.projects, projectId) }));
        return row.id;
      },

      /** Название и цвет — всё, что меняется без последствий для задач. */
      updateStatus(id, patch) {
        const own = (getStatus(get().statuses, id) || {}).projectId;
        set((s) => ({ statuses: s.statuses.map((st) => (st.id === id ? { ...st, ...patch } : st)), projects: touchProject(s.projects, own) }));
      },

      /** Вид решает, закрыта ли задача и считается ли она сделанной, —
       *  поэтому все задачи этого статуса надо пересчитать. Иначе доска,
       *  галочки и статистика разойдутся; в вебе тот же пересчёт. */
      setStatusKind(id, kind) {
        const own = (getStatus(get().statuses, id) || {}).projectId;
        set((s) => ({ statuses: s.statuses.map((st) => (st.id === id ? { ...st, kind } : st)), projects: touchProject(s.projects, own) }));
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
          projects: touchProject(s.projects, st.projectId),
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
          return {
            statuses: rest.map((st) => (order.has(st.id) ? { ...st, order: order.get(st.id) } : st)),
            projects: touchProject(s.projects, projectId),
          };
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
      /** Свёрнутые группы списка задач — по проектам, только на этом
       *  устройстве: положение экрана, а не данные. */
      /** «Свернуть статистику» на «Времени» — как state.ui.timeStatsHidden
       *  на вебе: способ смотреть, а не данные. */
      toggleTimeStats() {
        set((s) => ({ ui: { ...s.ui, timeStatsHidden: !s.ui.timeStatsHidden } }));
      },
      toggleListGroup(projectId, key) {
        set((s) => {
          const all = s.ui.listCollapsed || {};
          const mine = all[projectId] || [];
          const next = mine.includes(key) ? mine.filter((x) => x !== key) : [...mine, key];
          return { ui: { ...s.ui, listCollapsed: { ...all, [projectId]: next } } };
        });
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

      // --- облако картинок редактора ---
      setAssetsPaused(on) {
        set({ assetsPaused: !!on });
      },
      queueAssetRequeue(ids) {
        set((s) => ({ assetRequeue: [...new Set([...(s.assetRequeue || []), ...ids])] }));
      },
      /** Без аргумента — очистить весь список. */
      clearAssetRequeue(ids) {
        if (!ids) { set({ assetRequeue: [] }); return; }
        const done = new Set(ids);
        set((s) => ({ assetRequeue: (s.assetRequeue || []).filter((id) => !done.has(id)) }));
      },
      queueAssetAdopt(userId) {
        set({ assetAdopt: userId ? String(userId) : null });
      },
      /** Страница редактора получила assets-adopt для userId. Без аргумента — снять. */
      clearAssetAdopt(userId) {
        set((s) => (userId === undefined || s.assetAdopt === userId ? { assetAdopt: null } : {}));
      },

      // --- настройки ---
      setSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
    }),
    {
      // Имя — область данных (17 октября 2026): гость — lancible-data, как
      // было до аккаунтов, аккаунт — lancible-data:<uid> (core/accounts.js).
      // Какую область открыть, решает список аккаунтов, поэтому сам стор
      // хранилище не читает: его открывает openDataScope.
      name: 'lancible-data',
      skipHydration: true,
      storage: createJSONStorage(() => scopedStorage),
      merge: mergeScope,
      // Теги, статусы и версии — такие же пользовательские данные, как
      // проекты и задачи. Без них в этом списке они жили только в памяти:
      // после перезапуска телефон оставался без статусов и версий до
      // первой синхронизации, а без учётной записи — навсегда.
      partialize: (s) => ({
        projects: s.projects, tasks: s.tasks, tags: s.tags,
        statuses: s.statuses, versions: s.versions, documents: s.documents,
        activeTimer: s.activeTimer, ui: s.ui, settings: s.settings,
        assetRequeue: s.assetRequeue,
        assetAdopt: s.assetAdopt,
        // Журнал правок — в той же записи, что и данные: свои неотправленные
        // правки сохраняются вместе с ними (lib/oplogScope.js).
        sync2: packSync2(s),
      }),
      onRehydrateStorage: () => (_state, error) => {
        // Срабатывает асинхронно после чтения AsyncStorage — к этому моменту
        // useAppStore уже точно проинициализирован. Область уже прочитана и
        // лежит в сторе — запись открывается, и миграция ляжет в свою область.
        // Чтение упало — в сторе прежнее: запись закрыта, миграции нет
        // (openDataScope, readError).
        if (error) {
          readError = error;
          return;
        }
        scopeWrites = true;
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

/** Когда по задаче последний раз шло время; 0 — записей не было. Идущая
 *  считается идущей сейчас. Недавнее — это то, над чем работали, а не то,
 *  что только что завели (то же правило, что lastSessionAt на десктопе). */
export function lastSessionAt(task, activeTimer) {
  let last = 0;
  for (const s of task.sessions || []) last = Math.max(last, new Date(s.end || s.start).getTime());
  if (activeTimer && activeTimer.taskId === task.id) last = Math.max(last, Date.now());
  return last;
}

/** Незавершённые задачи, по которым недавно шло время, свежие сверху. */
export function recentTasks(tasks, limit, activeTimer) {
  return tasks
    .filter((task) => !task.done)
    .map((task) => ({ task, last: lastSessionAt(task, activeTimer) }))
    .filter((x) => x.last > 0)
    .sort((a, b) => b.last - a.last)
    .slice(0, limit)
    .map((x) => x.task);
}

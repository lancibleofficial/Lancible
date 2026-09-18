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

export const useAppStore = create(
  persist(
    (set, get) => ({
      ...emptyState(),
      hasHydrated: false,
      toastMessage: null,

      _runMigration() {
        set((s) => migrate({ ...s }));
        set({ hasHydrated: true });
      },

      showToast(message) {
        set({ toastMessage: message });
        setTimeout(() => {
          if (get().toastMessage === message) set({ toastMessage: null });
        }, 2500);
      },

      // --- проекты ---
      createProject({ name, color, description }) {
        const now = new Date().toISOString();
        const project = {
          id: uid(),
          name: (name || '').trim() || PALETTE[0],
          color: color || PALETTE[get().projects.length % PALETTE.length],
          description: description || '',
          createdAt: now,
          pinnedAt: null,
        };
        set((s) => ({ projects: [project, ...s.projects] }));
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
        };
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return task;
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
      toggleTaskDone(id) {
        set((s) => ({
          tasks: s.tasks.map((task) =>
            task.id === id ? { ...task, done: !task.done, updatedAt: new Date().toISOString() } : task),
        }));
        // Выполненной задаче напоминать не о чем, а снятой галочке — снова есть.
        const task = get().tasks.find((t2) => t2.id === id);
        const { lang, notifyEnabled } = get().settings;
        if (task) scheduleTaskReminder(task, lang, notifyEnabled !== false);
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

      // --- навигация (какой проект открыт — не персистится в UI-смысле,
      // но храним рядом с остальным state ради простоты) ---
      openProject(id) {
        set({ ui: { view: 'project', projectId: id } });
      },
      backHome() {
        set((s) => ({ ui: { ...s.ui, view: 'home' } }));
      },

      // --- настройки ---
      setSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
    }),
    {
      name: 'lancible-data',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ projects: s.projects, tasks: s.tasks, activeTimer: s.activeTimer, ui: s.ui, settings: s.settings }),
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

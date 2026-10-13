// Что держит расписание уведомлений в ногу с данными. Само расписание —
// lib/notifications.js (rescheduleAll); здесь только «когда его пересобирать».
//
// Три повода:
//   • правка задач или смена языка/тумблера — через секунду тишины, чтобы
//     серия правок (набор названия, перетаскивание) не пересобирала расписание
//     на каждом знаке. Сюда же попадает приём из облака: он пишет в стор
//     теми же setState, и раньше расписание после него не обновлялось вовсе.
//     Правка задач считается, только если задеты поля, из которых собирается
//     расписание (REMINDER_FIELDS): заметки сохраняются раз в 300 мс, пока
//     человек пишет, и каждый раз отменять и ставить до 48 уведомлений
//     заново незачем (13 октября 2026);
//   • приложение вернули на экран — горизонт отрезков уехал вперёд, а закрытые
//     повторяющиеся задачи без дат пора вернуть (reopenDue в сторе), после
//     чего расписание собирается сразу;
//   • старт — вызвавший хочет расписание, как только данные подняты.
//
// И отдельно — будильник на ближайший reopenAt: приложение может стоять на
// экране через полночь, и тогда ни загрузки, ни возврата на экран нет, а
// задаче пора вернуться. Будильник переставляется на те же правки задач, а
// дальше суток не ставится: таймер, переживший сон телефона или перевод
// часов, мог бы сработать сильно позже — раз в сутки он просто сверяется.
import { AppState } from 'react-native';
import { useAppStore } from '../store/useAppStore';
import { rescheduleAll } from './notifications';

export const REMINDER_DEBOUNCE_MS = 1000;
/** Дальше этого будильник возврата не ставится (сутки). */
export const REOPEN_CHECK_MAX_MS = 86400000;

/** Поля задачи, из которых собирается расписание (core/reminders.js:
 *  pendingReminders, lib/reminderText.js) и будильник возврата. Старые поля
 *  напоминаний — тоже: задача без списка читается по ним. */
export const REMINDER_FIELDS = [
  'title', 'done', 'cancelled', 'statusId', 'dueAt', 'slots', 'repeat', 'reopenAt',
  'reminders', 'remindOffsetMin', 'remindAt', 'notifiedAt',
];

const sameValue = (a, b) => a === b
  || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

/** Задело ли изменение списка задач расписание. Задача, объект которой не
 *  менялся, не сравнивается; у остальных сравниваются только REMINDER_FIELDS
 *  (по ссылке, а при разных ссылках — по содержимому: приём из облака
 *  приносит новые объекты с теми же данными). */
export function remindersChanged(next, prev) {
  if (next === prev) return false;
  if (!Array.isArray(next) || !Array.isArray(prev) || next.length !== prev.length) return true;
  const byId = new Map(prev.map((task) => [task && task.id, task]));
  for (const task of next) {
    const old = byId.get(task && task.id);
    if (!old) return true;
    if (old === task) continue;
    if (REMINDER_FIELDS.some((f) => !sameValue(task[f], old[f]))) return true;
  }
  return false;
}

/** Запускает слежение и пересобирает расписание сразу.
 *  @returns остановка слежения (для эффекта в App.js и для тестов) */
export function startReminderSync(store = useAppStore) {
  let timer = null;
  let reopenTimer = null;

  /** Будильник на ближайший будущий reopenAt. Прошедшие не в счёт: их
   *  возвращает reopenDue на загрузке и на возврате на экран, а те, что он не
   *  вернул (правило сняли, серия кончилась), будили бы впустую без конца. */
  const armReopen = () => {
    clearTimeout(reopenTimer);
    reopenTimer = null;
    const now = Date.now();
    let next = Infinity;
    for (const task of store.getState().tasks) {
      const at = task && task.done && task.reopenAt ? Date.parse(task.reopenAt) : NaN;
      if (at > now && at < next) next = at;
    }
    if (next === Infinity) return;
    reopenTimer = setTimeout(() => {
      reopenTimer = null;
      store.getState().reopenDue();
      // Ничего не вернулось (сработал суточный предел) — задачи не менялись,
      // и подписка будильник не переставит.
      if (!reopenTimer) armReopen();
    }, Math.min(next - now, REOPEN_CHECK_MAX_MS));
  };

  const rebuild = () => {
    clearTimeout(timer);
    timer = null;
    const { tasks, settings } = store.getState();
    return rescheduleAll(tasks, settings.lang, settings.notifyEnabled !== false)
      .catch((err) => console.warn('Не удалось обновить расписание уведомлений:', err));
  };

  const unsubscribe = store.subscribe((state, prev) => {
    const tasksChanged = remindersChanged(state.tasks, prev.tasks);
    if (tasksChanged) armReopen();
    const changed = tasksChanged
      || state.settings.lang !== prev.settings.lang
      || state.settings.notifyEnabled !== prev.settings.notifyEnabled;
    if (!changed) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, REMINDER_DEBOUNCE_MS);
  });

  const appState = AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    store.getState().reopenDue();
    // Телефон мог спать: будильник сверяется с часами заново.
    armReopen();
    rebuild();
  });

  armReopen();
  rebuild();

  return () => {
    clearTimeout(timer);
    clearTimeout(reopenTimer);
    unsubscribe();
    if (appState && appState.remove) appState.remove();
  };
}

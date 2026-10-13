// Стор задач на телефоне. Запуск: npm run test:mobile (из корня)
//
// Что здесь проверяется и чего не дублируется. Само правило «что делать с
// галочкой» лежит в ядре (src/renderer/core/status.js, planTaskDone) и уже
// закрыто юнитами в tests/unit/status.test.js — общими с десктопом. Здесь
// проверяется другое: что телефон это правило применяет, а не пересказывает
// своими словами. Ровно этим пересказом экраны и расходились с вебом — галочка
// помечала задачу выполненной, но не двигала её по колонкам.
import { useAppStore } from '../src/store/useAppStore';
import Reminders from '../src/core/reminders.js';

/** Чистый стор перед каждым тестом: zustand хранит состояние в модуле, и без
 *  сброса второй тест видит задачи первого. */
const reset = () => {
  const s = useAppStore.getState();
  useAppStore.setState({
    projects: [], tasks: [], statuses: [], tags: [], activeTimer: null,
  });
  return s;
};

beforeEach(reset);

const project = () => {
  const { createProject } = useAppStore.getState();
  createProject({ name: 'Проект' });
  return useAppStore.getState().projects[0];
};

// createTask берёт id проекта, а не объект — и сам возвращает задачу.
const task = (projectId) => useAppStore.getState().createTask(projectId);

test('у нового проекта сразу есть колонки статусов', () => {
  const p = project();
  const mine = useAppStore.getState().statuses.filter((s) => s.projectId === p.id);
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.some((s) => s.kind === 'done')).toBe(true);
});

test('галочка переносит задачу в колонку «готово», а не просто помечает', () => {
  const p = project();
  const t = task(p.id);
  useAppStore.getState().setTaskDone(t.id, true);

  const after = useAppStore.getState().tasks.find((x) => x.id === t.id);
  const status = useAppStore.getState().statuses.find((s) => s.id === after.statusId);
  expect(status).toBeTruthy(); // задача должна оказаться в какой-то колонке
  expect(status.kind).toBe('done'); // и именно в закрытой
});

test('снятая галочка возвращает задачу из «готово» в рабочую колонку', () => {
  // Обратный ход — то место, где пересказ правила обычно и ломается: вернуть
  // задачу надо не в «никуда», а в колонку, которая не считается закрытой.
  const p = project();
  const t = task(p.id);
  useAppStore.getState().setTaskDone(t.id, true);
  useAppStore.getState().setTaskDone(t.id, false);

  const after = useAppStore.getState().tasks.find((x) => x.id === t.id);
  const status = useAppStore.getState().statuses.find((s) => s.id === after.statusId);
  expect(after.done).toBe(false); // снова не выполнена
  expect(status.kind).not.toBe('done'); // и не осталась в закрытой колонке
});

test('переключатель ходит в обе стороны', () => {
  const p = project();
  const t = task(p.id);
  const doneNow = () => {
    const x = useAppStore.getState().tasks.find((y) => y.id === t.id);
    const st = useAppStore.getState().statuses.find((s) => s.id === x.statusId);
    return st ? st.kind === 'done' : !!x.done;
  };
  useAppStore.getState().toggleTaskDone(t.id);
  expect(doneNow()).toBe(true);
  useAppStore.getState().toggleTaskDone(t.id);
  expect(doneNow()).toBe(false);
});

// --- повтор без дедлайна и «время работы» (11 октября 2026) ---------------
// Решения — в ядре (core/slots.js: planTaskRoll, planReopen; их юниты —
// tests/unit/slots.test.js). Здесь — что стор их применяет: открывает задачу
// или оставляет закрытой, двигает отрезки, возвращает по дню, чистит reopenAt.
describe('повтор без дедлайна', () => {
  // Среда 14 октября 2026, полдень: время зафиксировано, иначе тест зависит от дня.
  const NOW = new Date(2026, 9, 14, 12, 0, 0);
  const at = (day, h, m = 0) => new Date(2026, 9, day, h, m).toISOString();
  const daily = { freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
  const stored = (id) => useAppStore.getState().tasks.find((x) => x.id === id);
  const statusKind = (id) => useAppStore.getState().statuses.find((s) => s.id === stored(id).statusId).kind;

  beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
  afterEach(() => { jest.useRealTimers(); });

  /** Задача с правилом «каждый день» и заданными полями поверх. */
  const repeating = (extra) => {
    const p = project();
    const x = task(p.id);
    useAppStore.getState().updateTask(x.id, { repeat: daily, ...extra });
    return x.id;
  };

  test('(б) нет дедлайна, есть разовое время работы: задача открывается, отрезок едет на следующий день, «до начала» напомнит о новом', () => {
    // Напоминание уже сработало на сегодняшнее вхождение (отметка — его начало).
    const rem = { id: 'r1', kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min', notifiedUpTo: at(15, 10) };
    const id = repeating({ slots: [{ id: 'sl1', start: at(15, 10), end: at(15, 12) }], reminders: [rem], ...Reminders.legacyMirror([rem]) });
    useAppStore.getState().setTaskDone(id, true);

    const after = stored(id);
    expect(after.done).toBe(false);
    expect(statusKind(id)).not.toBe('done');
    expect(after.dueAt).toBeNull(); // дедлайн не появляется
    expect(after.reopenAt).toBeNull();
    expect(after.repeat.done).toBe(1);
    expect(after.slots).toHaveLength(1);
    expect(after.slots[0].start).toBe(at(16, 10));
    expect(after.slots[0].end).toBe(at(16, 12));
    // Новое вхождение — напомнить заново: отметка осталась позади его начала.
    expect(after.reminders).toHaveLength(1);
    expect(Date.parse(after.reminders[0].notifiedUpTo)).toBeLessThan(Date.parse(after.slots[0].start));
  });

  test('(б) все отрезки едут вместе с задачей: своего повтора у отрезка нет', () => {
    // Правило у задачи одно (core/slots.js); старое правило у отрезка
    // (данные разработки) ничего не значит и снимается.
    const legacy = { id: 'sl2', start: at(15, 14), end: at(15, 15), repeat: { ...daily } };
    const id = repeating({ slots: [{ id: 'sl1', start: at(15, 10), end: at(15, 12) }, legacy] });
    useAppStore.getState().setTaskDone(id, true);
    const moved = stored(id).slots;
    expect(moved.find((s) => s.id === 'sl1').start).toBe(at(16, 10));
    expect(moved.find((s) => s.id === 'sl2').start).toBe(at(16, 14));
    expect(moved.every((s) => !('repeat' in s))).toBe(true);
  });

  test('(в) нет ни дедлайна, ни разового времени: остаётся выполненной, вернётся завтра', () => {
    const id = repeating({});
    useAppStore.getState().setTaskDone(id, true);

    const after = stored(id);
    expect(after.done).toBe(true);
    expect(statusKind(id)).toBe('done');
    expect(after.dueAt).toBeNull();
    // Отсчёт — от закрытия: следующий день, с полуночи.
    expect(after.reopenAt).toBe(at(15, 0));
    expect(after.repeat.done).toBe(1);
  });

  test('(в) наступил её день — при загрузке данных задача открывается', () => {
    const id = repeating({});
    useAppStore.getState().setTaskDone(id, true);
    expect(stored(id).done).toBe(true);

    // До полуночи — остаётся закрытой.
    jest.setSystemTime(new Date(2026, 9, 14, 23, 0));
    useAppStore.getState()._runMigration();
    expect(stored(id).done).toBe(true);

    // Наступило 15 октября — открывается: статус по умолчанию, reopenAt снят.
    jest.setSystemTime(new Date(2026, 9, 15, 8, 0));
    useAppStore.getState()._runMigration();
    const after = stored(id);
    expect(after.done).toBe(false);
    expect(after.doneAt).toBeNull();
    expect(after.reopenAt).toBeNull();
    expect(statusKind(id)).not.toBe('done');
  });

  test('(в) с «оставлять копии»: при возвращении остаётся выполненная копия с записями времени', () => {
    const id = repeating({ repeat: { ...daily, keepHistory: true }, totalMs: 3_600_000, sessions: [{ start: at(14, 9), end: at(14, 10), ms: 3_600_000 }] });
    useAppStore.getState().setTaskDone(id, true);
    // Закрыта, записи при ней — копия появится только на возвращении.
    expect(useAppStore.getState().tasks).toHaveLength(1);

    jest.setSystemTime(new Date(2026, 9, 15, 8, 0));
    useAppStore.getState().reopenDue();
    const all = useAppStore.getState().tasks;
    expect(all).toHaveLength(2);
    const copy = all.find((x) => x.id !== id);
    expect(copy).toMatchObject({ done: true, repeat: null, reopenAt: null, slots: [], totalMs: 3_600_000 });
    expect(copy.sessions).toHaveLength(1);
    expect(stored(id)).toMatchObject({ done: false, totalMs: 0, sessions: [] });
  });

  test('закрытую старым клиентом (без reopenAt) загрузка лечит: считает, будто её закрыли только что', () => {
    const id = repeating({});
    // Как её оставил бы клиент без «времени работы»: закрыта вчера, правило
    // прежнее, ни reopenAt, ни сдвинутого счётчика.
    const doneStatus = useAppStore.getState().statuses.find((s) => s.kind === 'done');
    useAppStore.setState((s) => ({
      tasks: s.tasks.map((y) => (y.id === id ? { ...y, done: true, statusId: doneStatus.id, doneAt: at(13, 10) } : y)),
    }));
    expect(stored(id).reopenAt).toBeUndefined();
    useAppStore.getState().reopenDue();
    // Вчерашнее закрытие + «каждый день» = сегодня с полуночи: день уже наступил.
    expect(stored(id).done).toBe(false);
    expect(stored(id).repeat.done).toBe(1);
    // Идемпотентно: второй проход ничего не меняет.
    const once = stored(id);
    useAppStore.getState().reopenDue();
    expect(stored(id)).toBe(once);
  });

  test('открыли вручную — reopenAt снимается; снято правило — тоже', () => {
    const id = repeating({});
    useAppStore.getState().setTaskDone(id, true);
    expect(stored(id).reopenAt).not.toBeNull();
    useAppStore.getState().setTaskDone(id, false);
    expect(stored(id).done).toBe(false);
    expect(stored(id).reopenAt).toBeNull();

    // Закрыть снова (reopenAt ставится) и снять правило.
    useAppStore.getState().setTaskDone(id, true);
    expect(stored(id).reopenAt).not.toBeNull();
    useAppStore.getState().setTaskRepeat(id, null);
    expect(stored(id).repeat).toBeNull();
    expect(stored(id).reopenAt).toBeNull();
  });

  test('сняли галочку у ждущей задачи — раз серии, засчитанный закрытием, снимается', () => {
    // Серия «после 3 раз»: без этого каждое «закрыл по ошибке — открыл»
    // съедало бы один раз, и серия кончалась раньше.
    const id = repeating({ repeat: { ...daily, ends: { kind: 'after', count: 3, at: null } } });
    useAppStore.getState().setTaskDone(id, true);
    expect(stored(id).repeat.done).toBe(1);
    useAppStore.getState().setTaskDone(id, false);
    expect(stored(id)).toMatchObject({ done: false, reopenAt: null });
    expect(stored(id).repeat.done).toBe(0);

    // То же через статус (перенос на доске, меню статуса).
    useAppStore.getState().setTaskDone(id, true);
    expect(stored(id).repeat.done).toBe(1);
    const open = useAppStore.getState().statuses.find((s) => s.projectId === stored(id).projectId && s.kind !== 'done' && s.kind !== 'cancelled');
    useAppStore.getState().setTaskStatus(id, open.id);
    expect(stored(id)).toMatchObject({ done: false, reopenAt: null });
    expect(stored(id).repeat.done).toBe(0);
  });

  test('своё время напоминания едет с задачей: (в) — на день возврата, (б) — вместе с отрезком', () => {
    // Раньше оно оставалось вчерашним, и вернувшаяся задача тут же напоминала о нём снова.
    const c = repeating({ remindAt: at(14, 9) });
    useAppStore.getState().setTaskDone(c, true);
    expect(stored(c)).toMatchObject({ done: true, reopenAt: at(15, 0), remindAt: at(15, 9) });
    jest.setSystemTime(new Date(2026, 9, 15, 8, 0));
    useAppStore.getState().reopenDue();
    expect(stored(c)).toMatchObject({ done: false, remindAt: at(15, 9), notifiedAt: null });

    const b = repeating({ remindAt: at(15, 9, 30), slots: [{ id: 'sl1', start: at(15, 10), end: at(15, 12) }] });
    useAppStore.getState().setTaskDone(b, true);
    expect(stored(b)).toMatchObject({ done: false, remindAt: at(16, 9, 30) });
    expect(stored(b).slots[0].start).toBe(at(16, 10));
  });

  test('(а) только дедлайн — как прежде: следующий срок, открыта, отрезков нет', () => {
    const id = repeating({ dueAt: at(14, 18) });
    useAppStore.getState().setTaskDone(id, true);
    const after = stored(id);
    expect(after.done).toBe(false);
    expect(after.dueAt).toBe(at(15, 18));
    expect(after.reopenAt).toBeNull();
    expect(after.slots).toEqual([]);
  });
});

describe('время работы: действия стора', () => {
  const slot = { start: '2026-10-17T07:00:00.000Z', end: '2026-10-17T09:00:00.000Z' };
  const slotsOf = (id) => useAppStore.getState().tasks.find((x) => x.id === id).slots;

  test('addTaskSlot выдаёт id и кладёт отрезок; негодный (конец не позже начала) — null, ничего не пишет', () => {
    const p = project();
    const x = task(p.id);
    const id = useAppStore.getState().addTaskSlot(x.id, slot);
    expect(id).toBeTruthy();
    expect(slotsOf(x.id)).toEqual([expect.objectContaining({ id, ...slot })]);
    expect(useAppStore.getState().addTaskSlot(x.id, { ...slot, end: slot.start })).toBeNull();
    expect(slotsOf(x.id)).toHaveLength(1);
  });

  test('updateTaskSlot правит отрезок, негодная правка его не портит; removeTaskSlot убирает', () => {
    const p = project();
    const x = task(p.id);
    const id = useAppStore.getState().addTaskSlot(x.id, slot);
    useAppStore.getState().updateTaskSlot(x.id, id, { end: '2026-10-17T10:00:00.000Z', своё: 1 });
    expect(slotsOf(x.id)[0]).toMatchObject({ id, end: '2026-10-17T10:00:00.000Z', своё: 1 });
    useAppStore.getState().updateTaskSlot(x.id, id, { end: slot.start });
    expect(slotsOf(x.id)[0].end).toBe('2026-10-17T10:00:00.000Z');

    useAppStore.getState().removeTaskSlot(x.id, id);
    expect(slotsOf(x.id)).toEqual([]);
  });

  test('напоминаний у отрезка нет: правка и удаление отрезка список напоминаний задачи не трогают', () => {
    const p = project();
    const x = task(p.id);
    const rid = useAppStore.getState().addTaskReminder(x.id, { kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min' });
    const id = useAppStore.getState().addTaskSlot(x.id, slot);
    const list = () => useAppStore.getState().tasks.find((y) => y.id === x.id).reminders;
    const before = list();
    useAppStore.getState().updateTaskSlot(x.id, id, { start: '2026-10-17T06:00:00.000Z' });
    expect(list()).toEqual(before);
    useAppStore.getState().removeTaskSlot(x.id, id);
    expect(list()).toEqual(before);
    expect(list()[0].id).toBe(rid);
  });
});

// --- напоминания: список задачи (core/reminders.js) -----------------------
// Правила — в ядре (tests/unit/reminders.test.js). Здесь — что стор правит
// список только через withReminders: патч целиком, вместе с зеркалом старых
// полей, которые читают десктоп 0.4.3 и телефон 1.2.2.
describe('напоминания: действия стора', () => {
  const at = (day, h, m = 0) => new Date(2026, 9, day, h, m).toISOString();
  const get = (id) => useAppStore.getState().tasks.find((x) => x.id === id);
  const daily = { freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
  const dueTask = () => {
    const x = task(project().id);
    useAppStore.getState().updateTask(x.id, { dueAt: at(20, 18) });
    return x.id;
  };

  test('addTaskReminder: «до дедлайна» получает id, ложится в список и зеркалится в remindOffsetMin', () => {
    const id = dueTask();
    const rid = useAppStore.getState().addTaskReminder(id, { kind: 'before', anchor: 'due', offsetMin: 120, unit: 'hour' });
    expect(rid).toBeTruthy();
    expect(get(id).reminders).toEqual([expect.objectContaining({ id: rid, kind: 'before', anchor: 'due', offsetMin: 120, unit: 'hour', notifiedUpTo: null })]);
    expect(get(id)).toMatchObject({ remindOffsetMin: 120, remindAt: null, notifiedAt: null });
  });

  test('«один раз» зеркалится в remindAt, «повторять» и «до начала» старых полей не трогают', () => {
    const id = dueTask();
    const { addTaskReminder } = useAppStore.getState();
    addTaskReminder(id, { kind: 'at', at: at(18, 9) });
    expect(get(id)).toMatchObject({ remindOffsetMin: null, remindAt: at(18, 9) });
    addTaskReminder(id, { kind: 'repeat', rule: daily, time: '09:00', start: at(14, 12) });
    addTaskReminder(id, { kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min' });
    expect(get(id)).toMatchObject({ remindOffsetMin: null, remindAt: at(18, 9) });
    expect(get(id).reminders.map((r) => r.kind)).toEqual(['at', 'repeat', 'before']);
    // Появилось «до дедлайна» — оно сильнее своего времени, как в reminderTime.
    addTaskReminder(id, { kind: 'before', anchor: 'due', offsetMin: 30, unit: 'min' });
    expect(get(id)).toMatchObject({ remindOffsetMin: 30, remindAt: null });
  });

  test('негодное напоминание — null, ничего не пишется', () => {
    const id = dueTask();
    const before = get(id);
    expect(useAppStore.getState().addTaskReminder(id, { kind: 'before', anchor: 'nowhere', offsetMin: 5 })).toBeNull();
    expect(useAppStore.getState().addTaskReminder(id, { kind: 'at', at: 'не дата' })).toBeNull();
    expect(useAppStore.getState().addTaskReminder(id, {})).toBeNull();
    expect(get(id)).toBe(before);
  });

  test('updateTaskReminder: меняет время и зеркало, чужие напоминания и их отметки остаются', () => {
    const id = dueTask();
    const { addTaskReminder, updateTaskReminder } = useAppStore.getState();
    const a = addTaskReminder(id, { kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' });
    const b = addTaskReminder(id, { kind: 'at', at: at(18, 9) });
    // Второе уже сработало.
    useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === id ? { ...x, reminders: x.reminders.map((r) => (r.id === b ? { ...r, notifiedAt: at(18, 9) } : r)) } : x)) }));
    expect(updateTaskReminder(id, a, { offsetMin: 15, unit: 'min' })).toBe(true);
    expect(get(id).reminders.find((r) => r.id === a)).toMatchObject({ offsetMin: 15, unit: 'min', anchor: 'due' });
    expect(get(id)).toMatchObject({ remindOffsetMin: 15 });
    expect(get(id).reminders.find((r) => r.id === b).notifiedAt).toBe(at(18, 9));
  });

  test('подпись «120 мин» → «2 ч» отметку «уже напомнили» не снимает, другое время — снимает', () => {
    const id = dueTask();
    const { addTaskReminder, updateTaskReminder } = useAppStore.getState();
    const a = addTaskReminder(id, { kind: 'before', anchor: 'due', offsetMin: 120, unit: 'min' });
    useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === id ? { ...x, reminders: x.reminders.map((r) => ({ ...r, notifiedUpTo: at(20, 18) })) } : x)) }));
    updateTaskReminder(id, a, { offsetMin: 120, unit: 'hour' });
    expect(get(id).reminders[0]).toMatchObject({ unit: 'hour', notifiedUpTo: at(20, 18) });
    updateTaskReminder(id, a, { offsetMin: 90, unit: 'min' });
    expect(get(id).reminders[0]).toMatchObject({ offsetMin: 90, notifiedUpTo: null });
  });

  test('другой вид заменяет напоминание целиком: чужих ключей прежнего вида не остаётся', () => {
    const id = dueTask();
    const { addTaskReminder, updateTaskReminder } = useAppStore.getState();
    const a = addTaskReminder(id, { kind: 'at', at: at(18, 9) });
    expect(updateTaskReminder(id, a, { kind: 'repeat', rule: daily, time: '08:30', start: at(14, 12) })).toBe(true);
    const r = get(id).reminders[0];
    expect(r).toMatchObject({ id: a, kind: 'repeat', time: '08:30' });
    expect('at' in r).toBe(false);
    expect('notifiedAt' in r).toBe(false);
    expect(get(id)).toMatchObject({ remindOffsetMin: null, remindAt: null });
  });

  test('негодная правка и неизвестный id напоминание не портят', () => {
    const id = dueTask();
    const { addTaskReminder, updateTaskReminder } = useAppStore.getState();
    const a = addTaskReminder(id, { kind: 'at', at: at(18, 9) });
    const before = get(id);
    expect(updateTaskReminder(id, a, { at: 'не дата' })).toBe(false);
    expect(updateTaskReminder(id, 'нет-такого', { at: at(19, 9) })).toBe(false);
    expect(updateTaskReminder('нет-задачи', a, { at: at(19, 9) })).toBe(false);
    expect(get(id)).toBe(before);
  });

  test('removeTaskReminder: убирает одно, зеркало пересчитывается, у последнего — старые поля пусты и notifiedAt снят', () => {
    const id = dueTask();
    const { addTaskReminder, removeTaskReminder } = useAppStore.getState();
    const a = addTaskReminder(id, { kind: 'before', anchor: 'due', offsetMin: 30, unit: 'min' });
    const b = addTaskReminder(id, { kind: 'at', at: at(18, 9) });
    useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === id ? { ...x, notifiedAt: at(20, 17, 30) } : x)) }));
    removeTaskReminder(id, a);
    expect(get(id).reminders.map((r) => r.id)).toEqual([b]);
    expect(get(id)).toMatchObject({ remindOffsetMin: null, remindAt: at(18, 9), notifiedAt: null });
    removeTaskReminder(id, b);
    expect(get(id).reminders).toEqual([]);
    expect(get(id)).toMatchObject({ remindOffsetMin: null, remindAt: null });
  });

  test('задача со старыми полями (без списка): правка выводит список из них и правит его, id — legacy-…', () => {
    const id = dueTask();
    useAppStore.getState().updateTask(id, { remindOffsetMin: 60 });
    expect(get(id).reminders).toBeUndefined();
    expect(useAppStore.getState().updateTaskReminder(id, 'legacy-due', { offsetMin: 15, unit: 'min' })).toBe(true);
    expect(get(id).reminders).toEqual([expect.objectContaining({ id: 'legacy-due', anchor: 'due', offsetMin: 15 })]);
    expect(get(id).remindOffsetMin).toBe(15);
    useAppStore.getState().removeTaskReminder(id, 'legacy-due');
    expect(get(id)).toMatchObject({ reminders: [], remindOffsetMin: null, remindAt: null });
  });

  test('правка дедлайна напоминаний не трогает: «до дедлайна» остаётся, зеркало и список те же', () => {
    const id = dueTask();
    useAppStore.getState().addTaskReminder(id, { kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' });
    const list = get(id).reminders;
    useAppStore.getState().setTaskDue(id, { dueAt: at(25, 18) });
    expect(get(id).reminders).toBe(list);
    expect(get(id)).toMatchObject({ dueAt: at(25, 18), remindOffsetMin: 60 });
    useAppStore.getState().setTaskDue(id, { dueAt: null });
    expect(get(id).reminders).toBe(list);
    expect(get(id).remindOffsetMin).toBe(60);
  });
});

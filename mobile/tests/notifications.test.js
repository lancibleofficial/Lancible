// Расписание системных уведомлений (lib/notifications.js, lib/reminderSync.js).
// Запуск: npm run test:mobile
//
// Телефон планирует уведомления в системе заранее: приложение чаще всего
// выгружено, опрашивать время некому. Что именно ставить — решает ядро
// (core/reminders.js, pendingReminders: его юниты — tests/unit/reminders.test.js).
// Здесь — что телефон ставит это как надо: идентификаторы `rem-…`, заголовки,
// пределы и порядок; что два перепланирования не переплетаются; что
// расписание пересобирается после приёма из облака и по возвращении в
// приложение.
// Нативных уведомлений в Node нет — подмены в jest.setup.js, проверяются их вызовы.
import { AppState } from 'react-native';
import { useAppStore } from '../src/store/useAppStore';
import Reminders from '../src/core/reminders.js';
import { fmtWhen } from '../src/lib/format';
import { rescheduleAll, REMINDER_LIMITS } from '../src/lib/notifications';
import { startReminderSync, REMINDER_DEBOUNCE_MS, REOPEN_CHECK_MAX_MS } from '../src/lib/reminderSync';
import { t } from '../src/lib/i18n';

const schedule = jest.requireMock('expo-notifications/build/scheduleNotificationAsync').scheduleNotificationAsync;
const cancelAll = jest.requireMock('expo-notifications/build/cancelAllScheduledNotificationsAsync').cancelAllScheduledNotificationsAsync;
const permissions = jest.requireMock('expo-notifications/build/NotificationPermissions').getPermissionsAsync;

// Среда 14 октября 2026, полдень — время зафиксировано, иначе тест зависит от дня.
const NOW = new Date(2026, 9, 14, 12, 0, 0);
const at = (day, h, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const ms = (day, h, m = 0) => new Date(2026, 9, day, h, m).getTime();
const base = { projectId: 'p1', done: false, cancelled: false, totalMs: 0, sessions: [], tagIds: [], dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null };
const mk = (id, extra) => ({ ...base, id, title: `Задача ${id}`, ...extra });
// Своего повтора у отрезка нет: правило — у задачи (core/slots.js).
const slotOf = (id, extra) => ({ id, start: at(15, 10), end: at(15, 12), ...extra });
const rule = (extra) => ({ freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0, ...extra });
const daily = rule();
/** Задача со списком напоминаний — вместе с зеркалом старых полей, как её пишет стор. */
const withList = (task, list) => ({ ...task, ...Reminders.withReminders(task, list) });
const beforeRem = (anchor, offsetMin, unit = 'min', id = 'r1') => ({ id, kind: 'before', anchor, offsetMin, unit });
const atRem = (iso, id = 'r1') => ({ id, kind: 'at', at: iso });
const repeatRem = (r, time, start, id = 'r1') => ({ id, kind: 'repeat', rule: r, time, start });
/** Идентификатор уведомления: `rem-<задача>-<напоминание>-<момент мс>`. */
const nid = (taskId, remId, ms0) => `rem-${taskId}-${remId}-${ms0}`;
/** Задача с дедлайном и «в момент дедлайна» — самая короткая запись для тестов очереди. */
const dueTask = (id, day) => withList(mk(id, { dueAt: at(day, 18) }), [beforeRem('due', 0)]);

const requests = () => schedule.mock.calls.map(([req]) => req);
/** Дать доехать цепочке промисов: расписание собирается серией await. */
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  schedule.mockClear();
  cancelAll.mockClear();
  useAppStore.setState({ projects: [{ id: 'p1', name: 'Сайт', color: '#69d345' }], statuses: [], tasks: [] });
});
afterEach(() => { jest.useRealTimers(); });

describe('что ставится в систему', () => {
  test('до дедлайна: rem-<задача>-<напоминание>-<момент>, «Через 1 ч: название» и срок под ним; перед этим всё отменяется', async () => {
    await rescheduleAll([withList(mk('a', { title: 'Сдать отчёт', dueAt: at(15, 18) }), [beforeRem('due', 60, 'hour')])], 'ru', true);
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(cancelAll.mock.invocationCallOrder[0]).toBeLessThan(schedule.mock.invocationCallOrder[0]);
    const [req] = requests();
    expect(req.identifier).toBe(nid('a', 'r1', ms(15, 17)));
    expect(req.content).toMatchObject({ title: 'Через 1 ч: Сдать отчёт', body: `${t('ru', 'due.label')}: ${fmtWhen(at(15, 18), 'ru')}` });
    expect(req.trigger.date.getTime()).toBe(ms(15, 17));
  });

  test('в момент дедлайна: заголовок — просто название задачи', async () => {
    await rescheduleAll([dueTask('a', 15)], 'ru', true);
    const [req] = requests();
    expect(req.identifier).toBe(nid('a', 'r1', ms(15, 18)));
    expect(req.content.title).toBe('Задача a');
  });

  test('один раз: rem-…, название и «Напоминание»', async () => {
    await rescheduleAll([withList(mk('b'), [atRem(at(14, 18))])], 'ru', true);
    expect(requests().map((r) => r.identifier)).toEqual([nid('b', 'r1', ms(14, 18))]);
    expect(requests()[0].content).toMatchObject({ title: 'Задача b', body: t('ru', 'notif.reminder') });
    expect(requests()[0].trigger.date.getTime()).toBe(ms(14, 18));
  });

  test('до начала: «Через 15 мин: название», под ним «Время работы» и часы вхождения; за 15 минут до начала', async () => {
    await rescheduleAll([withList(mk('c', { title: 'Вёрстка', slots: [slotOf('s1')] }), [beforeRem('start', 15)])], 'ru', true);
    const [req] = requests();
    expect(req.identifier).toBe(nid('c', 'r1', ms(15, 9, 45)));
    expect(req.content).toMatchObject({ title: 'Через 15 мин: Вёрстка', body: `${t('ru', 'notif.slot')} · 10:00–12:00` });
    expect(req.trigger.date.getTime()).toBe(ms(15, 9, 45));
  });

  test('до начала на каждое вхождение каждого отрезка: два отрезка — два уведомления на одно напоминание', async () => {
    const task = withList(mk('c', { slots: [slotOf('s1'), slotOf('s2', { start: at(16, 14), end: at(16, 15) })] }), [beforeRem('start', 0)]);
    await rescheduleAll([task], 'ru', true);
    expect(requests().map((r) => r.identifier)).toEqual([nid('c', 'r1', ms(15, 10)), nid('c', 'r1', ms(16, 14))]);
  });

  test('еженедельная задача: до начала отрезка перед каждым понедельником и средой, остальные дни молчат', async () => {
    const weekly = rule({ freq: 'week', weekdays: [1, 3] });
    // Среда 14 октября, в 12:00 «сегодняшнее» вхождение в 10:00 уже прошло.
    await rescheduleAll([withList(mk('w', { repeat: weekly, slots: [slotOf('s1', { start: at(14, 10), end: at(14, 11) })] }), [beforeRem('start', 15)])], 'ru', true);
    expect(requests().map((r) => r.trigger.date.getTime())).toEqual([ms(19, 9, 45), ms(21, 9, 45), ms(26, 9, 45), ms(28, 9, 45)]);
    expect(requests().every((r) => r.content.title === 'Через 15 мин: Задача w')).toBe(true);
  });

  test('повторять по дням недели: понедельник и среда в 09:00, ближайшие первыми, в пределах горизонта', async () => {
    const task = withList(mk('rw'), [repeatRem(rule({ freq: 'week', weekdays: [1, 3] }), '09:00', at(14, 12))]);
    await rescheduleAll([task], 'ru', true);
    expect(requests().map((r) => r.identifier)).toEqual([19, 21, 26, 28].map((d) => nid('rw', 'r1', ms(d, 9))));
    expect(requests()[0].content).toMatchObject({ title: 'Задача rw', body: t('ru', 'notif.reminder') });
  });

  // 13 октября 2026: на вхождения одного напоминания было не больше 5, и
  // ежедневное замолкало на шестой день, хотя горизонт — 14 суток. Теперь
  // предел на напоминание покрывает горизонт; общий — 48, как и был.
  const days = (from, n) => Array.from({ length: n }, (_, i) => from + i);
  test('повторять каждый день: все 14 дней горизонта, а сегодняшнее до «сейчас» не ставится', async () => {
    await rescheduleAll([withList(mk('rd'), [repeatRem(daily, '09:00', at(14, 12))])], 'ru', true);
    expect(requests().map((r) => r.identifier)).toEqual(days(15, 14).map((d) => nid('rd', 'r1', ms(d, 9))));
  });

  test('старые поля (десктоп 0.4.3, телефон 1.2.2): дедлайн со смещением и своё время читаются как напоминания списка', async () => {
    await rescheduleAll([
      mk('o', { title: 'Сдать отчёт', dueAt: at(15, 18), remindOffsetMin: 60 }),
      mk('p', { remindAt: at(14, 18) }),
    ], 'ru', true);
    expect(requests().map((r) => r.identifier)).toEqual([nid('p', 'legacy-at', ms(14, 18)), nid('o', 'legacy-due', ms(15, 17))]);
    expect(requests()[1].content.title).toBe('Через 1 ч: Сдать отчёт');
  });

  test('язык берётся из настроек: «In 15 min: …» на английском', async () => {
    await rescheduleAll([withList(mk('c', { slots: [slotOf('s1')] }), [beforeRem('start', 15)]), dueTask('d', 15)], 'en', true);
    const titles = requests().map((r) => r.content.title).sort();
    expect(titles).toEqual(['In 15 min: Задача c', 'Задача d']);
    expect(requests().find((r) => r.content.title.startsWith('In ')).content.body).toBe(`${t('en', 'notif.slot')} · 10:00–12:00`);
  });

  test('«до начала» у ежедневной задачи — на каждый день горизонта: 14 вхождений, а не 5', async () => {
    await rescheduleAll([withList(mk('e', { repeat: daily, slots: [slotOf('s1', { start: at(14, 15), end: at(14, 16) })] }), [beforeRem('start', 15)])], 'ru', true);
    const reqs = requests();
    expect(reqs).toHaveLength(14);
    expect(reqs.map((r) => r.identifier)).toEqual(days(14, 14).map((d) => nid('e', 'r1', ms(d, 14, 45))));
  });

  test('пятеро ежедневных «до начала» — 70 вхождений, в систему уходят 48 ближайших', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => withList(mk(`d${i}`, {
      repeat: daily,
      slots: [slotOf('s', { start: at(14, 15, i), end: at(14, 16, i) })],
    }), [beforeRem('start', 0)]));
    await rescheduleAll(tasks, 'ru', true);
    const dates = requests().map((r) => r.trigger.date.getTime());
    expect(dates).toHaveLength(REMINDER_LIMITS.max);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  test('горизонт 14 суток: разовый отрезок через месяц не ставится; дедлайн через месяц — ставится, как и раньше', async () => {
    await rescheduleAll([
      withList(mk('f', { slots: [slotOf('s1', { start: at(30, 10), end: at(30, 11) }), slotOf('s2', { start: at(20, 10), end: at(20, 11) })] }), [beforeRem('start', 0)]),
      withList(mk('g', { dueAt: new Date(2026, 10, 20, 18).toISOString() }), [beforeRem('due', 60, 'hour')]),
    ], 'ru', true);
    expect(requests().map((r) => r.identifier)).toEqual([nid('f', 'r1', ms(20, 10)), nid('g', 'r1', new Date(2026, 10, 20, 17).getTime())]);
  });

  test('всего не больше 48, ближайшие первыми', async () => {
    expect(REMINDER_LIMITS).toMatchObject({ max: 48, perReminder: 14 });
    // 20 ежедневных задач с отрезком — 100 вхождений; уходят 48.
    const tasks = Array.from({ length: 20 }, (_, i) => withList(mk(`t${i}`, {
      repeat: daily,
      slots: [slotOf('s', { start: at(14, 13, i), end: at(14, 14, i) })],
    }), [beforeRem('start', 0)]));
    await rescheduleAll(tasks, 'ru', true);
    const dates = requests().map((r) => r.trigger.date.getTime());
    expect(dates).toHaveLength(48);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    // Самое позднее из 100 вхождений дальше самого позднего из отобранных.
    expect(dates[47]).toBeLessThan(ms(18, 13, 0));
  });

  test('выполненные и отменённые задачи, прошедшие и без напоминаний не ставятся', async () => {
    await rescheduleAll([
      withList(mk('done', { done: true, dueAt: at(15, 18), slots: [slotOf('s')] }), [beforeRem('due', 0), beforeRem('start', 15, 'min', 'r2')]),
      withList(mk('off', { cancelled: true, slots: [slotOf('s')] }), [beforeRem('start', 15)]),
      withList(mk('past', { dueAt: at(14, 9) }), [beforeRem('due', 0)]),
      mk('mute', { dueAt: at(15, 18), slots: [slotOf('s')] }),
    ], 'ru', true);
    expect(schedule).not.toHaveBeenCalled();
    expect(cancelAll).toHaveBeenCalledTimes(1);
  });

  test('уведомления выключены — только отмена всего, ничего не ставится', async () => {
    await rescheduleAll([dueTask('a', 15)], 'ru', false);
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });

  test('системе запретили уведомления — ничего не ставится', async () => {
    permissions.mockImplementation(async () => ({ status: 'denied', granted: false, canAskAgain: false }));
    try {
      await rescheduleAll([dueTask('a', 15)], 'ru', true);
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      permissions.mockImplementation(async () => ({ status: 'granted', granted: true }));
    }
  });
});

describe('очередь', () => {
  test('два перепланирования подряд идут по очереди: второе отменяет всё только после того, как первое закончило', async () => {
    const events = [];
    cancelAll.mockImplementation(async () => { events.push('cancel'); await flush(); });
    schedule.mockImplementation(async (req) => { events.push(req.identifier); await flush(); });
    try {
      const first = rescheduleAll([dueTask('a', 15)], 'ru', true);
      const second = rescheduleAll([dueTask('b', 16)], 'ru', true);
      await Promise.all([first, second]);
      expect(events).toEqual(['cancel', nid('a', 'r1', ms(15, 18)), 'cancel', nid('b', 'r1', ms(16, 18))]);
    } finally {
      cancelAll.mockImplementation(async () => undefined);
      schedule.mockImplementation(async () => 'id');
    }
  });

  test('сбой одного уведомления не ломает остальные и очередь', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    schedule.mockImplementationOnce(async () => { throw new Error('нет места'); });
    try {
      await rescheduleAll([dueTask('a', 15), dueTask('b', 16)], 'ru', true);
      expect(requests().map((r) => r.identifier)).toEqual([nid('a', 'r1', ms(15, 18)), nid('b', 'r1', ms(16, 18))]);
      await rescheduleAll([dueTask('c', 17)], 'ru', true);
      expect(requests().map((r) => r.identifier)).toContain(nid('c', 'r1', ms(17, 18)));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('слежение за данными (reminderSync)', () => {
  let stop;
  let onAppState;
  let appStateSpy;

  beforeEach(() => {
    appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((type, cb) => {
      onAppState = cb;
      return { remove: jest.fn() };
    });
  });
  afterEach(() => {
    if (stop) stop();
    stop = null;
    appStateSpy.mockRestore();
  });

  const start = async () => {
    stop = startReminderSync();
    await flush();
    schedule.mockClear();
    cancelAll.mockClear();
  };

  test('на старте расписание собирается сразу', async () => {
    useAppStore.setState({ tasks: [dueTask('a', 15)] });
    stop = startReminderSync();
    await flush();
    expect(requests().map((r) => r.identifier)).toEqual([nid('a', 'r1', ms(15, 18))]);
  });

  test('приём из облака (setState с чужими задачами) пересобирает расписание через секунду тишины', async () => {
    await start();
    // Так applyRemoteData кладёт данные: просто setState, без экшенов стора.
    useAppStore.setState({ tasks: [withList(mk('cloud', { title: 'Из облака', slots: [slotOf('s1')] }), [beforeRem('start', 15)])] });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS - 1);
    await flush();
    expect(cancelAll).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(requests().map((r) => r.identifier)).toEqual([nid('cloud', 'r1', ms(15, 9, 45))]);
  });

  test('серия правок подряд — одна пересборка, а не по одной на правку', async () => {
    await start();
    useAppStore.setState({ tasks: [dueTask('a', 15)] });
    jest.advanceTimersByTime(600);
    useAppStore.setState({ tasks: [dueTask('a', 16)] });
    jest.advanceTimersByTime(600);
    await flush();
    expect(cancelAll).not.toHaveBeenCalled();
    jest.advanceTimersByTime(400);
    await flush();
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(requests().map((r) => r.identifier)).toEqual([nid('a', 'r1', ms(16, 18))]);
    expect(requests()[0].trigger.date.getTime()).toBe(ms(16, 18));
  });

  test('правки, не задевающие задачи и язык, расписание не трогают', async () => {
    await start();
    useAppStore.setState({ ui: { ...useAppStore.getState().ui, notifSeenAt: at(14, 11) } });
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme: 'light' } });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS * 2);
    await flush();
    expect(cancelAll).not.toHaveBeenCalled();
  });

  // 13 октября 2026: расписание пересобиралось на любую правку задач — и на
  // каждое сохранение заметок (раз в 300 мс, пока человек пишет): отменить всё
  // и поставить до 48 уведомлений заново. Теперь — только когда задета часть
  // задачи, из которой собирается расписание.
  test('правка заметок, времени и тегов расписание не пересобирает', async () => {
    useAppStore.setState({ tasks: [dueTask('a', 15)] });
    await start();
    const { updateTask } = useAppStore.getState();
    updateTask('a', { notes: 'Новая заметка' });
    jest.advanceTimersByTime(500);
    updateTask('a', { totalMs: 60000, tagIds: ['tag1'] });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS * 2);
    await flush();
    expect(cancelAll).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  test.each([
    ['дедлайн', { dueAt: at(16, 18) }],
    ['название', { title: 'Другое' }],
    ['выполнена', { done: true }],
    ['отменена', { cancelled: true }],
    ['статус', { statusId: 's2' }],
    ['отрезки', { slots: [slotOf('s1')] }],
    ['повтор', { repeat: daily }],
    ['возврат', { reopenAt: at(20, 0) }],
    ['список напоминаний', { reminders: [beforeRem('due', 30)] }],
  ])('правка «%s» пересобирает расписание', async (_name, patch) => {
    useAppStore.setState({ tasks: [dueTask('a', 15)] });
    await start();
    useAppStore.getState().updateTask('a', patch);
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS);
    await flush();
    expect(cancelAll).toHaveBeenCalledTimes(1);
  });

  test('приём из облака с теми же задачами (новые объекты, те же поля) расписание не трогает; новая задача — пересобирает', async () => {
    useAppStore.setState({ tasks: [dueTask('a', 15)] });
    await start();
    useAppStore.setState({ tasks: JSON.parse(JSON.stringify(useAppStore.getState().tasks)) });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS * 2);
    await flush();
    expect(cancelAll).not.toHaveBeenCalled();
    useAppStore.setState({ tasks: [...useAppStore.getState().tasks, dueTask('b', 16)] });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS);
    await flush();
    expect(cancelAll).toHaveBeenCalledTimes(1);
  });

  test('смена языка и тумблера пересобирает: заголовки на новом языке, выключили — всё отменено', async () => {
    useAppStore.setState({ tasks: [withList(mk('a', { title: 'Отчёт', dueAt: at(15, 18) }), [beforeRem('due', 15)])], settings: { ...useAppStore.getState().settings, lang: 'ru', notifyEnabled: true } });
    await start();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'en' } });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS);
    await flush();
    expect(requests()[0].content.title).toBe('In 15 min: Отчёт');

    schedule.mockClear();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, notifyEnabled: false } });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS);
    await flush();
    expect(schedule).not.toHaveBeenCalled();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', notifyEnabled: true } });
  });

  test('приложение вернули на экран: закрытая повторяющаяся задача, чей день наступил, открывается, расписание собирается сразу', async () => {
    useAppStore.setState({ tasks: [mk('r', { done: true, repeat: daily, reopenAt: at(15, 0), statusId: null })] });
    await start();
    // Пока приложение было в фоне, наступил день возвращения.
    jest.setSystemTime(new Date(2026, 9, 15, 8, 0));
    onAppState('background');
    await flush();
    expect(useAppStore.getState().tasks[0].done).toBe(true);
    expect(cancelAll).not.toHaveBeenCalled();
    onAppState('active');
    await flush();
    expect(useAppStore.getState().tasks[0]).toMatchObject({ done: false, reopenAt: null });
    expect(cancelAll).toHaveBeenCalled();
  });

  // Приложение может стоять на экране через полночь: ни загрузки, ни возврата
  // на экран, а задаче пора вернуться. Раньше она ждала следующего «active».
  const reopenTask = (reopenAt) => mk('r', { done: true, repeat: daily, reopenAt, statusId: null });
  const stored = () => useAppStore.getState().tasks[0];

  test('приложение открыто через полночь: задача возвращается в свой день сама', async () => {
    useAppStore.setState({ tasks: [reopenTask(at(15, 0))] });
    await start();
    jest.advanceTimersByTime(ms(15, 0) - NOW.getTime() - 1);
    await flush();
    expect(stored().done).toBe(true);
    jest.advanceTimersByTime(1);
    await flush();
    expect(stored()).toMatchObject({ done: false, reopenAt: null });
    // Вернулась — расписание пересобирается обычным порядком.
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS);
    await flush();
    expect(cancelAll).toHaveBeenCalled();
  });

  test('будильник возврата встаёт на правку задач и дальше суток не ставится', async () => {
    await start();
    // Задача пришла позже (облако) и вернётся через двое с половиной суток.
    useAppStore.setState({ tasks: [reopenTask(at(17, 0))] });
    jest.advanceTimersByTime(REOPEN_CHECK_MAX_MS);
    await flush();
    expect(stored().done).toBe(true);
    jest.advanceTimersByTime(ms(17, 0) - Date.now() - 1);
    await flush();
    expect(stored().done).toBe(true);
    jest.advanceTimersByTime(1);
    await flush();
    expect(stored()).toMatchObject({ done: false, reopenAt: null });
  });

  test('после остановки будильник возврата не срабатывает', async () => {
    useAppStore.setState({ tasks: [reopenTask(at(15, 0))] });
    await start();
    stop();
    stop = null;
    jest.advanceTimersByTime(ms(15, 1) - NOW.getTime());
    await flush();
    expect(stored().done).toBe(true);
  });

  test('прошедший reopenAt, который вернуть нельзя (правило сняли), будильник впустую не крутит', async () => {
    const real = useAppStore.getState().reopenDue;
    const reopenDue = jest.fn(() => real());
    useAppStore.setState({ reopenDue, tasks: [mk('stale', { done: true, repeat: null, reopenAt: at(13, 0) })] });
    try {
      await start();
      jest.advanceTimersByTime(2 * REOPEN_CHECK_MAX_MS);
      await flush();
      expect(reopenDue).not.toHaveBeenCalled();
    } finally {
      useAppStore.setState({ reopenDue: real });
    }
  });

  test('после остановки слежения правки расписание не трогают', async () => {
    await start();
    stop();
    stop = null;
    useAppStore.setState({ tasks: [dueTask('a', 15)] });
    jest.advanceTimersByTime(REMINDER_DEBOUNCE_MS * 2);
    await flush();
    expect(cancelAll).not.toHaveBeenCalled();
  });
});

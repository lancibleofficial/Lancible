// Вкладка «Уведомления» (screens/NotificationsScreen.js). Запуск: npm run test:mobile
//
// Ленту собирает ядро (core/due.js, notificationFeed: его юниты —
// tests/unit/due.test.js). С 11 октября 2026 в ней записи дедлайна и записи
// списка напоминаний задачи (core/reminders.js), и ключ строки — уже не
// «задача-вид» (`${task.id}-${kind}`), а n.key ядра: у одной задачи может быть
// и дедлайн, и несколько напоминаний, и ключ по задаче с видом их склеил бы.
// Здесь проверяется, как их рисует экран: напоминание подписано словами.
import { render, fireEvent } from '@testing-library/react-native';
import NotificationsScreen from '../src/screens/NotificationsScreen';
import { useAppStore } from '../src/store/useAppStore';
import Reminders from '../src/core/reminders.js';
import { hm } from '../src/lib/sessions';
import { fmtWhen } from '../src/lib/format';
import { t } from '../src/lib/i18n';

// Вкладка помечает ленту прочитанной, когда в фокусе; навигатора в тесте нет.
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true }));

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn() });
const MIN = 60000;
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();
const base = { projectId: 'p1', statusId: 's1', done: false, cancelled: false, totalMs: 0, sessions: [], tagIds: [], dueAt: null, remindOffsetMin: null, remindAt: null, notifiedAt: null };
const mk = (id, extra) => ({ ...base, id, title: `Задача ${id}`, ...extra });
/** Задача со списком напоминаний — вместе с зеркалом старых полей, как её пишет стор. */
const withList = (task, list) => ({ ...task, ...Reminders.withReminders(task, list) });
// Своего повтора у отрезка нет: правило — у задачи (core/slots.js).
const slot = (id, extra) => ({ id, start: iso(NOW + 30 * MIN), end: iso(NOW + 90 * MIN), ...extra });
const before = (id, anchor, offsetMin, unit = 'min') => ({ id, kind: 'before', anchor, offsetMin, unit, notifiedUpTo: null });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#5ec8f2' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [],
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});
afterEach(() => { jest.useRealTimers(); });

const show = () => render(<NotificationsScreen navigation={nav()} />);

test('«до начала»: напоминание словами подписью и часы вхождения справа; нажатие открывает задачу', async () => {
  useAppStore.setState({ tasks: [withList(mk('a', { title: 'Вёрстка', slots: [slot('s1')] }), [before('r1', 'start', 60, 'hour')])] });
  const navigation = nav();
  const s = await render(<NotificationsScreen navigation={navigation} />);
  s.getByText('Вёрстка');
  s.getByText(`Сайт · ${t('ru', 'remind.before_start_n', { n: 1, unit: t('ru', 'remind.unit_hour') })}`);
  s.getByText(`${hm(NOW + 30 * MIN)}–${hm(NOW + 90 * MIN)}`);
  await fireEvent.press(s.getByText('Вёрстка'));
  expect(navigation.navigate).toHaveBeenCalledWith('TaskDetail', { taskId: 'a' });
});

test('«один раз» — «Напоминание» и момент срабатывания справа (старое поле remindAt читается так же)', async () => {
  const remindAt = iso(NOW - 20 * MIN);
  useAppStore.setState({ tasks: [mk('b', { title: 'Позвонить', remindAt }), withList(mk('b2', { title: 'Написать' }), [{ id: 'r1', kind: 'at', at: remindAt, notifiedAt: null }])] });
  const s = await show();
  for (const title of ['Позвонить', 'Написать']) s.getByText(title);
  expect(s.getAllByText(`Сайт · ${t('ru', 'notif.reminder')}`)).toHaveLength(2);
  expect(s.getAllByText(fmtWhen(remindAt, 'ru'))).toHaveLength(2);
});

test('«повторять» — правило словами подписью и последнее вхождение справа', async () => {
  const rule = { freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
  const start = new Date(2026, 9, 1, 8, 0).toISOString();
  useAppStore.setState({ tasks: [withList(mk('e', { title: 'Зарядка' }), [{ id: 'r1', kind: 'repeat', rule, time: '11:00', start, notifiedUpTo: null }])] });
  const s = await show();
  s.getByText('Зарядка');
  s.getByText(`Сайт · ${t('ru', 'remind.daily_at', { time: '11:00' })}`);
  s.getByText(fmtWhen(iso(new Date(2026, 9, 14, 11, 0).getTime()), 'ru'));
});

test('«до дедлайна», когда сам дедлайн ещё не в ленте: напоминание словами и срок справа', async () => {
  // Дедлайн через двое суток, напоминание за трое: момент уже наступил.
  useAppStore.setState({ tasks: [withList(mk('f', { title: 'Сдать отчёт', dueAt: iso(NOW + 2 * 86_400_000) }), [before('r1', 'due', 4320, 'day')])] });
  const s = await show();
  s.getByText('Сдать отчёт');
  s.getByText('Сайт · За 3 дня до дедлайна');
  s.getByText(t('ru', 'due.in_days', { n: 2 }));
});

test('дедлайны — как прежде: просрочен и срок справа от названия', async () => {
  useAppStore.setState({ tasks: [mk('c', { title: 'Отчёт', dueAt: iso(NOW - 3 * 3_600_000) })] });
  const s = await show();
  s.getByText(`Сайт · ${t('ru', 'notif.overdue')}`);
  s.getByText(t('ru', 'due.overdue'));
});

test('у одной задачи дедлайн и несколько вхождений — каждая запись своей строкой, ключи разные', async () => {
  // Прежний ключ `${task.id}-${kind}` склеил бы записи одной задачи; n.key ядра —
  // `due-<задача>` и `rem-<задача>-<напоминание>-<момент>` — различает их.
  const task = withList(mk('d', {
    title: 'Планёрка',
    dueAt: iso(NOW - 3_600_000),
    slots: [
      slot('s1', { start: iso(NOW + 30 * MIN), end: iso(NOW + 90 * MIN) }),
      slot('s2', { start: iso(NOW + 10 * MIN), end: iso(NOW + 40 * MIN) }),
    ],
  }), [before('r1', 'start', 60, 'hour')]);
  useAppStore.setState({ tasks: [task] });
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const s = await show();
    // Одно и то же название — три строки: просрочка и два вхождения.
    expect(s.getAllByText('Планёрка')).toHaveLength(3);
    // Предупреждения React о повторяющихся ключах нет.
    const dup = err.mock.calls.filter((c) => String(c[0]).includes('same key'));
    expect(dup).toEqual([]);
  } finally {
    err.mockRestore();
  }
});

test('ключ строки — n.key ядра, а не «задача-вид»', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'NotificationsScreen.js'), 'utf8');
  expect(src).toMatch(/key=\{n\.key\}/);
  expect(src).not.toMatch(/key=\{`\$\{n\.task\.id\}-\$\{n\.kind\}`\}/);
});

test('выполненные и отменённые задачи в ленту не попадают, пустая лента — «Дедлайнов и напоминаний пока нет»', async () => {
  useAppStore.setState({
    tasks: [
      withList(mk('x', { done: true, slots: [slot('s1')] }), [before('r1', 'start', 60, 'hour')]),
      withList(mk('y', { cancelled: true, slots: [slot('s1')] }), [before('r1', 'start', 60, 'hour')]),
    ],
  });
  const s = await show();
  s.getByText(t('ru', 'notif.empty'));
});

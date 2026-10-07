// Записи времени вручную на телефоне. Запуск: npm run test:mobile (из корня)
//
// Само правило — в ядре (core/money.js, planSessionEdit) и закрыто юнитами
// десктопа. Здесь — что телефон его применяет: новая запись берёт ставку
// проекта, правленая сохраняет свою, удаление списывает время; и разбор
// «дата + два времени» с переходом через полночь.
import { useAppStore } from '../src/store/useAppStore';
import { spanFromParts, presetRule, isPresetRule } from '../src/lib/sessions';

beforeEach(() => {
  useAppStore.setState({
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', rate: 3000, currency: null, createdAt: '2026-10-07T10:00:00.000Z', tagIds: [] }],
    tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, sessions: [], totalMs: 0, rate: null, tagIds: [] }],
    statuses: [], tags: [], versions: [], documents: [], activeTimer: null,
    settings: { ...useAppStore.getState().settings, hourlyRate: 2000, currency: 'RUB', lang: 'ru' },
  });
});

const task = () => useAppStore.getState().tasks.find((x) => x.id === 't1');
const HOUR = 3_600_000;

test('дата и два времени складываются в отрезок; конец раньше начала — через полночь', () => {
  const day = spanFromParts('2026-10-07', '10:00', '11:30');
  expect(day.ms).toBe(1.5 * HOUR);
  expect(day.start.getHours()).toBe(10);
  const night = spanFromParts('2026-10-07', '23:00', '01:30');
  expect(night.ms).toBe(2.5 * HOUR);
  expect(night.end.getDate()).toBe(8);
  expect(spanFromParts('', '10:00', '11:00')).toBeNull();
});

test('новая запись вручную запоминает ставку проекта, а не общую', () => {
  const span = spanFromParts('2026-10-07', '10:00', '12:00');
  useAppStore.getState().saveSession('t1', null, { start: span.start.getTime(), end: span.end.getTime(), ms: span.ms });
  const s = task().sessions[0];
  expect(s.manual).toBe(true);
  expect(s.rate).toBe(3000);
  expect(task().totalMs).toBe(2 * HOUR);
});

test('правка записи меняет время и оставляет прежнюю ставку', () => {
  useAppStore.setState({
    tasks: [{ ...task(), sessions: [{ start: '2026-10-07T07:00:00.000Z', end: '2026-10-07T08:00:00.000Z', ms: HOUR, rate: 1500 }], totalMs: HOUR }],
  });
  const span = spanFromParts('2026-10-07', '10:00', '13:00');
  useAppStore.getState().saveSession('t1', 0, { start: span.start.getTime(), end: span.end.getTime(), ms: span.ms });
  expect(task().sessions).toHaveLength(1);
  expect(task().sessions[0].rate).toBe(1500);
  expect(task().totalMs).toBe(3 * HOUR);
});

test('удаление записи списывает её время', () => {
  useAppStore.setState({
    tasks: [{ ...task(), sessions: [
      { start: '2026-10-07T07:00:00.000Z', end: '2026-10-07T08:00:00.000Z', ms: HOUR },
      { start: '2026-10-07T09:00:00.000Z', end: '2026-10-07T09:30:00.000Z', ms: HOUR / 2 },
    ], totalMs: 1.5 * HOUR }],
  });
  useAppStore.getState().deleteSession('t1', 0);
  expect(task().sessions).toHaveLength(1);
  expect(task().totalMs).toBe(HOUR / 2);
});

test('перенос записи на сетке меняет время, но не происхождение', () => {
  useAppStore.setState({
    tasks: [{ ...task(), sessions: [{ start: '2026-10-07T07:00:00.000Z', end: '2026-10-07T08:00:00.000Z', ms: HOUR, rate: 1500, manual: true }], totalMs: HOUR }],
  });
  const start = new Date('2026-10-08T10:00:00.000Z').getTime();
  useAppStore.getState().setSessionSpan('t1', 0, start, start + 2 * HOUR);
  const s = task().sessions[0];
  expect(s.manual).toBe(true);
  expect(s.rate).toBe(1500);
  expect(s.ms).toBe(2 * HOUR);
  expect(task().totalMs).toBe(2 * HOUR);
});

test('пресет повторения узнаётся в меню, а настроенное правило — нет', () => {
  expect(isPresetRule(presetRule('week', [1, 2, 3, 4, 5]), 'week', [1, 2, 3, 4, 5])).toBe(true);
  expect(isPresetRule(presetRule('week'), 'week', [1, 2, 3, 4, 5])).toBe(false);
  expect(isPresetRule({ ...presetRule('day'), every: 2 }, 'day')).toBe(false);
  expect(isPresetRule(null, 'day')).toBe(false);
});

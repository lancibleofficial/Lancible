// Лента «Задачи» по срочности (src/lib/inbox.js). Запуск: npm run test:mobile
import { inboxGroups, inboxGroupOf } from '../src/lib/inbox';

const NOW = new Date(2026, 9, 7, 15, 0).getTime(); // ср, 7 октября 2026, 15:00
const at = (daysFromNow, hour = 18) => {
  const d = new Date(2026, 9, 7 + daysFromNow, hour, 0);
  return d.toISOString();
};
const task = (id, over) => ({ id, projectId: 'p1', title: id, done: false, dueAt: null, pinnedAt: null, updatedAt: at(0, 10), ...over });

test('группы: идущая, сегодня (дедлайн и закреплённые), завтра, неделя, позже, без срока', () => {
  const tasks = [
    task('run', { dueAt: at(5) }),
    task('today', { dueAt: at(0, 18) }),
    task('overdue', { dueAt: at(-2) }),
    task('pinned', { pinnedAt: at(-1) }),
    task('tomorrow', { dueAt: at(1) }),
    task('week', { dueAt: at(4) }),
    task('later', { dueAt: at(12) }),
    task('nodue'),
    task('done', { done: true, dueAt: at(0) }),
  ];
  const groups = inboxGroups(tasks, { now: NOW, activeTimer: { taskId: 'run' } });
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g.tasks.map((t) => t.id)]));
  expect(byKey.now).toEqual(['run']);
  // Просроченное — вверху «Сегодня», закреплённое без срока — в конце.
  expect(byKey.today).toEqual(['overdue', 'today', 'pinned']);
  expect(byKey.tomorrow).toEqual(['tomorrow']);
  expect(byKey.week).toEqual(['week']);
  expect(byKey.later).toEqual(['later']);
  expect(byKey.nodue).toEqual(['nodue']);
  expect(byKey.done).toBeUndefined();
});

test('выполненные показываются отдельной группой только по просьбе', () => {
  const tasks = [task('a', { done: true }), task('b')];
  expect(inboxGroups(tasks, { now: NOW, activeTimer: null }).map((g) => g.key)).toEqual(['nodue']);
  expect(inboxGroups(tasks, { now: NOW, activeTimer: null, showDone: true }).map((g) => g.key)).toEqual(['nodue', 'done']);
});

test('пустых групп нет, порядок групп фиксированный', () => {
  const groups = inboxGroups([task('x', { dueAt: at(1) }), task('y')], { now: NOW, activeTimer: null });
  expect(groups.map((g) => g.key)).toEqual(['tomorrow', 'nodue']);
});

test('граница недели: шестой день — ещё неделя, седьмой — уже позже', () => {
  expect(inboxGroupOf(task('a', { dueAt: at(6) }), { now: NOW, activeTimer: null })).toBe('week');
  expect(inboxGroupOf(task('b', { dueAt: at(7) }), { now: NOW, activeTimer: null })).toBe('later');
});

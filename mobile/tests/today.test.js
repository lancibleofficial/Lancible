// Чистая логика «Сегодня» (src/lib/today.js). Запуск: npm run test:mobile
//
// Полоса дня и «недавние проекты» считаются без React и без стора — ровно
// так же, как renderDayIsland()/recentProjects() на вебе, и проверяются
// здесь числами, а не глазами.
import { todayStrip, recentProjects } from '../src/lib/today';

const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const iso = (d) => d.toISOString();
const session = (h0, m0, h1, m1) => ({ start: iso(at(h0, m0)), end: iso(at(h1, m1)), ms: at(h1, m1) - at(h0, m0) });

test('запись 9:00–10:30 ложится на полосу 8–20 с 8,3% шириной 12,5%', () => {
  const tasks = [{ id: 't1', projectId: 'p1', sessions: [session(9, 0, 10, 30)] }];
  const strip = todayStrip(tasks, null, at(12).getTime());
  expect(strip.h0).toBe(8);
  expect(strip.h1).toBe(20);
  expect(strip.blocks).toHaveLength(1);
  expect(strip.blocks[0].left).toBeCloseTo(8.33, 1);
  expect(strip.blocks[0].width).toBeCloseTo(12.5, 1);
  expect(strip.blocks[0].running).toBe(false);
});

test('ранняя и поздняя записи раздвигают полосу, идущий таймер — блок до «сейчас»', () => {
  const tasks = [
    { id: 't1', projectId: 'p1', sessions: [session(6, 30, 7, 0)] },
    { id: 't2', projectId: 'p1', sessions: [session(21, 0, 21, 30)] },
  ];
  const now = at(22).getTime();
  const strip = todayStrip(tasks, { taskId: 't2', startedAt: iso(at(21, 45)) }, now);
  expect(strip.h0).toBe(6);
  // Идущая запись длится до 22:00, и полоса растёт до следующего часа.
  expect(strip.h1).toBe(23);
  const running = strip.blocks.find((b) => b.running);
  expect(running.taskId).toBe('t2');
  expect(running.end).toBe(now);
  // «Сейчас» 22:00 на полосе 6–23: (16 ч / 17 ч) = 94,1%.
  expect(strip.nowPct).toBeCloseTo(94.1, 0);
});

test('вчерашняя запись на полосу не попадает, а ночная — только своим куском', () => {
  const y0 = at(23, 0); y0.setDate(y0.getDate() - 1);
  const y1 = at(1, 0);
  const tasks = [{ id: 't1', projectId: 'p1', sessions: [{ start: iso(y0), end: iso(y1), ms: y1 - y0 }] }];
  const strip = todayStrip(tasks, null, at(12).getTime());
  expect(strip.blocks).toHaveLength(1);
  expect(strip.h0).toBe(0); // кусок с полуночи до часа ночи
  expect(strip.blocks[0].end).toBe(y1.getTime());
});

test('недавние проекты — по последней записи, без записей — по дате создания', () => {
  const projects = [
    { id: 'a', name: 'A', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', name: 'B', createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'c', name: 'C', createdAt: '2026-02-01T00:00:00.000Z' },
  ];
  const tasks = [
    { id: 't1', projectId: 'a', sessions: [{ start: '2026-10-01T10:00:00.000Z', end: '2026-10-01T11:00:00.000Z', ms: 3600000 }] },
    { id: 't2', projectId: 'c', sessions: [{ start: '2026-10-05T10:00:00.000Z', end: '2026-10-05T11:00:00.000Z', ms: 3600000 }] },
  ];
  expect(recentProjects(projects, tasks, 3).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  expect(recentProjects(projects, tasks, 2).map((p) => p.id)).toEqual(['c', 'a']);
});

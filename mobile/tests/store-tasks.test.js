// Стор задач на телефоне. Запуск: npm run test:mobile (из корня)
//
// Что здесь проверяется и чего не дублируется. Само правило «что делать с
// галочкой» лежит в ядре (src/renderer/core/status.js, planTaskDone) и уже
// закрыто юнитами в tests/unit/status.test.js — общими с десктопом. Здесь
// проверяется другое: что телефон это правило применяет, а не пересказывает
// своими словами. Ровно этим пересказом экраны и расходились с вебом — галочка
// помечала задачу выполненной, но не двигала её по колонкам.
import { useAppStore } from '../src/store/useAppStore';

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

// Лист «Новая запись» (components/EntrySheet.js). Запуск: npm run test:mobile
//
// Правило — с веба (openAgendaDraft/attachToExisting): «Создать» заводит
// задачу в проекте и кладёт в неё запись за отрезок; выбор существующей
// задачи из найденных отдаёт отрезок ей, а новой задачи не появляется.
import { render, fireEvent } from '@testing-library/react-native';
import EntrySheet from '../src/components/EntrySheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

const H = 3_600_000;
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 1000 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', rate: null, currency: '' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{ id: 't0', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', totalMs: 0, sessions: [], done: false, updatedAt: '2026-10-01T00:00:00.000Z' }],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, quickAddProjectId: null },
  });
});

const footer = async () => render(useSheetStore.getState().footer);

test('«Создать» заводит задачу с записью за отрезок', async () => {
  const onDone = jest.fn();
  const { getByPlaceholderText } = await render(<EntrySheet initial={{ start: at(9), end: at(10) }} onDone={onDone} />);
  await fireEvent.changeText(getByPlaceholderText(t('ru', 'agenda.task_name_ph')), 'Новая задача');
  await fireEvent.press((await footer()).getByText(t('ru', 'agenda.create_btn')));

  const created = useAppStore.getState().tasks.find((task) => task.title === 'Новая задача');
  expect(created.projectId).toBe('p1');
  expect(created.sessions).toHaveLength(1);
  expect(created.sessions[0].ms).toBe(H);
  expect(created.sessions[0].manual).toBe(true);
  expect(created.sessions[0].rate).toBe(1000);
  expect(onDone).toHaveBeenCalledWith(created.id);
  // Проект запоминается для следующей записи.
  expect(useAppStore.getState().ui.quickAddProjectId).toBe('p1');
});

test('выбор найденной задачи отдаёт отрезок ей, новой задачи нет', async () => {
  const { getByPlaceholderText, getByText } = await render(<EntrySheet initial={{ start: at(9), end: at(11) }} />);
  await fireEvent.changeText(getByPlaceholderText(t('ru', 'agenda.task_name_ph')), 'вёрстка');
  getByText(t('ru', 'agenda.or_existing'));
  await fireEvent.press(getByText('Вёрстка шапки'));

  const { tasks } = useAppStore.getState();
  expect(tasks).toHaveLength(1);
  expect(tasks[0].sessions).toHaveLength(1);
  expect(tasks[0].sessions[0].ms).toBe(2 * H);
  expect(tasks[0].totalMs).toBe(2 * H);
});

// «Дублировать» в меню задачи на телефоне (17 октября 2026, как на вебе).
// Запуск: npm run test:mobile (из корня)
//
// Что копируется — правило ядра (core/duplicate.js: duplicateTask), оно
// закрыто юнитами (tests/unit/duplicate.test.js). Здесь — применение: пункт
// меню зовёт ядро, стор кладёт копию сразу за оригиналом, копия открывается
// поверх страницы оригинала (push, «назад» — к оригиналу) и есть тост.
import { render, fireEvent, act } from '@testing-library/react-native';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import BottomSheet from '../src/components/BottomSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import Duplicate from '../src/core/duplicate.js';
import { t } from '../src/lib/i18n';

// Редактор заметок — WebView без нативной части в Node.
jest.mock('../src/components/DocEditor', () => () => null);

const task = (id, title, extra) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, tagIds: [], notes: null,
  sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null, ...extra,
});
const nav = () => ({ navigate: jest.fn(), push: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), getState: () => ({ routes: [{ name: 'TaskDetail', params: { taskId: 't1' } }], index: 0 }) });

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    tags: [],
    activeTimer: null,
    toastMessage: null,
    tasks: [
      task('t0', 'Бриф'),
      task('t1', 'Вёрстка', { totalMs: 3_600_000, sessions: [{ start: '2026-10-16T10:00:00.000Z', end: '2026-10-16T11:00:00.000Z', ms: 3_600_000 }], pinnedAt: '2026-10-16T09:00:00.000Z' }),
      task('t2', 'Правки'),
    ],
  });
});
afterEach(() => jest.restoreAllMocks());

async function duplicateFromMenu(navigation = nav()) {
  const q = await render(<><TaskDetailScreen navigation={navigation} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
  await fireEvent.press(q.getByLabelText(t('ru', 'project.opts')));
  await fireEvent.press(q.getByText(t('ru', 'task.duplicate')));
  return { q, navigation };
}

test('в меню задачи — «Дублировать» со значком копии', async () => {
  const q = await render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);
  await fireEvent.press(q.getByLabelText(t('ru', 'project.opts')));
  const item = useSheetStore.getState().content.props.items.find((i) => i.key === 'duplicate');
  expect(item).toMatchObject({ icon: 'copy', label: t('ru', 'task.duplicate') });
  expect(t('ru', 'task.duplicate')).toBe('Дублировать');
});

test('пункт зовёт ядро; копия — в сторе сразу за оригиналом', async () => {
  const core = jest.spyOn(Duplicate, 'duplicateTask');
  await duplicateFromMenu();
  expect(core).toHaveBeenCalledTimes(1);
  const [data, id, o] = core.mock.calls[0];
  expect(id).toBe('t1');
  expect(data.tasks.map((x) => x.id)).toEqual(['t0', 't1', 't2']);
  expect(o).toEqual({ uid: expect.any(Function), now: expect.any(String), suffix: t('ru', 'docs.copy_suffix') });

  const tasks = useAppStore.getState().tasks;
  const copy = core.mock.results[0].value;
  expect(tasks.map((x) => x.id)).toEqual(['t0', 't1', copy.id, 't2']);
  // То, что отдало ядро, и легло в стор — телефон своих правил не добавляет.
  expect(tasks[2]).toBe(copy);
  expect(copy).toMatchObject({ title: 'Вёрстка (копия)', projectId: 'p1', totalMs: 0, sessions: [], done: false });
  // Оригинал не тронут.
  expect(tasks[1]).toMatchObject({ id: 't1', title: 'Вёрстка', totalMs: 3_600_000 });
});

test('копия открывается поверх оригинала и есть тост', async () => {
  const { navigation } = await duplicateFromMenu();
  const copy = useAppStore.getState().tasks[2];
  expect(navigation.push).toHaveBeenCalledWith('TaskDetail', { taskId: copy.id });
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(useAppStore.getState().toastMessage).toBe(t('ru', 'task.duplicated'));
});

test('набранное в названии уходит в оригинал до копирования — копия берёт последнее', async () => {
  const navigation = nav();
  const q = await render(<><TaskDetailScreen navigation={navigation} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
  await fireEvent.changeText(q.getByDisplayValue('Вёрстка'), 'Вёрстка шапки');
  await fireEvent.press(q.getByLabelText(t('ru', 'project.opts')));
  await fireEvent.press(q.getByText(t('ru', 'task.duplicate')));
  await act(async () => {});
  const tasks = useAppStore.getState().tasks;
  expect(tasks[1].title).toBe('Вёрстка шапки');
  expect(tasks[2].title).toBe('Вёрстка шапки (копия)');
});

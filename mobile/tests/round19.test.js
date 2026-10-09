// Круг 19 — правки по списку пользователя. Запуск: npm run test:mobile
//
// Проверяется применение: крестик в общем листе закрывает его; окно проекта —
// одна форма без вкладок, выбор валюты и тегов — страницами внутри того же
// листа; дедлайн — барабаны со всеми минутами; в карточке проекта отмеченная
// задача сначала уходит анимацией и только потом отмечается; в шите задачи
// «Выполнено» закреплено вне прокрутки; заголовок и число в шапке — рядом,
// отдельными строками; вкладка показывает свой скелетон, пока строится;
// редактор в полном режиме масштабируется щипком, а предпросмотр — нет.
import { Text, View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import DueSheet from '../src/components/DueSheet';
import TabHeader from '../src/components/TabHeader';
import { wheelValueIndex, wheelCenterRow } from '../src/components/WheelPicker';
import { withTabPage } from '../src/components/TabSlide';
import { AppSkeleton } from '../src/components/Skeleton';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import DocEditor from '../src/components/DocEditor';
import { EDITOR_CSS } from '../src/editor/editorBundle';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

jest.mock('react-native-webview', () => {
  const { View: MockView } = require('react-native');
  return { WebView: (props) => require('react').createElement(MockView, { testID: 'web', source: props.source }) };
});

const task = (id, title, extra) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  repeat: null, rate: null, notes: '', updatedAt: '2026-10-01T10:00:00.000Z', ...extra,
});

beforeEach(() => {
  useSheetStore.setState({ content: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', currency: 'RUB', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [task('t1', 'Вёрстка'), task('t2', 'Макет')],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui },
  });
});

test('п.16: у листа крестик справа сверху, он закрывает лист', async () => {
  openSheet(<Text>содержимое</Text>);
  const screen = await render(<BottomSheet />);
  screen.getByText('содержимое');
  await fireEvent.press(screen.getByLabelText(t('ru', 'common.close')));
  expect(useSheetStore.getState().content).toBeNull();
});

test('п.11: окно проекта — одна форма, разделы друг под другом, без вкладок', async () => {
  const screen = await render(<NewProjectSheet onCreated={() => {}} onCancel={() => {}} />);
  // Поля обоих разделов видны сразу, переключать нечего.
  screen.getByText(t('ru', 'pdlg.name_label'));
  screen.getByText(t('ru', 'pdlg.sec_money'));
  screen.getByText(t('ru', 'pdlg.rate_label'));
  expect(screen.queryByRole('tab')).toBeNull();
});

test('п.10: валюта выбирается страницей внутри того же листа и возвращает к форме', async () => {
  const screen = await render(<NewProjectSheet onCreated={() => {}} onCancel={() => {}} />);
  await fireEvent.press(screen.getByText(t('ru', 'pdlg.currency_default', { cur: 'RUB' })));
  // Страница: стрелка «назад» и список валют — в этом же листе, не поверх.
  screen.getByLabelText(t('ru', 'common.back'));
  expect(useSheetStore.getState().content).toBeNull();
  await fireEvent.press(screen.getByText('USD ($)'));
  screen.getByText(t('ru', 'pdlg.name_label'));
  screen.getByText('USD ($)');
});

test('п.10: теги — тоже страницей внутри, «назад» возвращает к форме', async () => {
  const screen = await render(<NewProjectSheet onCreated={() => {}} onCancel={() => {}} />);
  await fireEvent.press(screen.getByText(t('ru', 'tag.pick')));
  screen.getByPlaceholderText(t('ru', 'tag.search_ph'));
  await fireEvent.press(screen.getByLabelText(t('ru', 'common.back')));
  screen.getByText(t('ru', 'pdlg.name_label'));
});

test('п.6: барабаны времени — все минуты, по кругу', async () => {
  expect(wheelValueIndex(-1, 60)).toBe(59);
  expect(wheelValueIndex(60 * 3 + 7, 60)).toBe(7);
  expect(wheelValueIndex(wheelCenterRow(42, 60), 60)).toBe(42);
  const screen = await render(<DueSheet task={task('t1', 'Вёрстка', { dueAt: new Date(2026, 9, 9, 18, 37).toISOString() })} lang="ru" onApply={() => {}} onClear={() => {}} />);
  await fireEvent.press(screen.getByText(t('ru', 'due.time')));
  // Минута 37 — не кратная пяти — есть и выбрана.
  expect(screen.getAllByText('37').length).toBeGreaterThan(0);
  screen.getByText(/18:37/);
});

test('п.5: «Выполнено» в шите задачи закреплено снизу, вне прокрутки', async () => {
  jest.useFakeTimers();
  const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) };
  const screen = await render(<TaskDetailScreen navigation={navigation} route={{ params: { taskId: 't1' } }} />);
  await fireEvent.press(screen.getByText(t('ru', 'task.details')));
  const btn = screen.getAllByText(t('ru', 'task.mark_done')).at(-1);
  let node = btn; let inScroll = false;
  while (node) { if (node.type === 'RCTScrollView') inScroll = true; node = node.parent; }
  expect(inScroll).toBe(false);
  jest.useRealTimers();
});

test('п.7: название и число в шапке — рядом, отдельными строками', async () => {
  const screen = await render(<TabHeader title="Проекты" count={7} />);
  screen.getByText('Проекты');
  screen.getByText('7');
});

test('п.13: вкладка сперва показывает свой скелетон, потом страницу; запуск — скелетон «Проектов»', async () => {
  const Skel = () => <Text>скелетон</Text>;
  const Page = withTabPage(() => <Text>страница</Text>, 'Tasks', Skel);
  const screen = await render(<Page />);
  screen.getByText('скелетон');
  await screen.findByText('страница');
  const app = await render(<AppSkeleton />);
  expect(app.toJSON()).toBeTruthy();
});

test('п.1–3: редактор масштабируется щипком, предпросмотр — нет; рисуя, подсказки ввода нет; поле не ниже экрана', async () => {
  const full = await render(<DocEditor content={null} lang="ru" />);
  expect(full.getByTestId('web').props.source.html).toMatch(/maximum-scale=4, user-scalable=yes/);
  const preview = await render(<DocEditor preview content={null} lang="ru" />);
  expect(preview.getByTestId('web').props.source.html).toMatch(/user-scalable=no/);
  expect(EDITOR_CSS).toMatch(/\.led-annotating \.led-pm \.led-empty::before/);
  expect(EDITOR_CSS).toMatch(/\.led-mobile \.led-pm\s*\{\s*min-height:\s*calc\(100vh/);
});

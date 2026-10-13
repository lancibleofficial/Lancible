// Круг 19 — правки по списку пользователя. Запуск: npm run test:mobile
//
// Проверяется применение: крестик в общем листе закрывает его; окно проекта —
// одна форма без вкладок, выбор валюты и тегов — страницами внутри того же
// листа; дедлайн — барабаны со всеми минутами; в карточке проекта отмеченная
// задача сначала уходит анимацией и только потом отмечается; в шите задачи
// «Выполнено» закреплено вне прокрутки; заголовок и число в шапке — рядом,
// отдельными строками; вкладка показывает свой скелетон, пока строится;
// страница редактора щипком не масштабируется (с 12 октября 2026 щипок
// крупнит только текст).
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
import { useSheetStore, openSheet, useSheetHeader } from '../src/store/useSheetStore';
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
  useSheetStore.setState({ content: null, header: null, footer: null });
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

// 11 октября крестик остался только у листов с заголовком; безымянный лист
// закрывают свайпом или нажатием на затемнение (tests/sheetHeader.test.js).
function Titled() {
  useSheetHeader('Заголовок листа');
  return <Text>содержимое</Text>;
}
test('п.16: у листа с заголовком крестик справа сверху, он закрывает лист', async () => {
  openSheet(<Titled />);
  const screen = await render(<BottomSheet />);
  screen.getByText('содержимое');
  await fireEvent.press(screen.getByLabelText(t('ru', 'common.close')));
  expect(useSheetStore.getState().content).toBeNull();
});

test('п.16: безымянный лист — без крестика, закрывается нажатием на затемнение', async () => {
  openSheet(<Text>содержимое</Text>);
  const screen = await render(<BottomSheet />);
  screen.getByText('содержимое');
  expect(screen.queryByLabelText(t('ru', 'common.close'))).toBeNull();
  await fireEvent.press(screen.getByTestId('sheet-scrim'));
  expect(useSheetStore.getState().content).toBeNull();
});

test('п.11: окно проекта — одна форма, разделы друг под другом, без вкладок', async () => {
  const screen = await render(<NewProjectSheet onCreated={() => {}} onCancel={() => {}} />);
  // Название и строки обоих разделов видны сразу, переключать нечего
  // (12 октября 2026 разделы — строками, как в настройках проекта).
  screen.getByPlaceholderText(t('ru', 'pdlg.name_ph'));
  screen.getByText(t('ru', 'pdlg.sec_money'));
  screen.getByText(t('ru', 'pdlg.rate_row'));
  expect(screen.queryByRole('tab')).toBeNull();
});

test('п.10: валюта выбирается страницей внутри того же листа и возвращает к форме', async () => {
  const form = <NewProjectSheet onCreated={() => {}} onCancel={() => {}} />;
  openSheet(form);
  const screen = await render(<BottomSheet />);
  await fireEvent.press(screen.getByText(t('ru', 'pdlg.currency_inherit', { cur: 'RUB' })));
  // Страница: стрелка «назад» (в шапке листа) и список валют — в этом же
  // листе, не поверх: открытым остаётся тот же лист с формой.
  screen.getByLabelText(t('ru', 'common.back'));
  expect(useSheetStore.getState().content).toBe(form);
  await fireEvent.press(screen.getByText('USD ($)'));
  screen.getByPlaceholderText(t('ru', 'pdlg.name_ph'));
  screen.getByText('USD ($)');
});

test('п.10: теги — тоже страницей внутри, «назад» возвращает к форме', async () => {
  openSheet(<NewProjectSheet onCreated={() => {}} onCancel={() => {}} />);
  const screen = await render(<BottomSheet />);
  await fireEvent.press(screen.getByTestId('project-row-marks'));
  screen.getByPlaceholderText(t('ru', 'tag.search_ph'));
  await fireEvent.press(screen.getByLabelText(t('ru', 'common.back')));
  screen.getByPlaceholderText(t('ru', 'pdlg.name_ph'));
});

test('п.6: барабаны времени — все минуты, по кругу', async () => {
  expect(wheelValueIndex(-1, 60)).toBe(59);
  expect(wheelValueIndex(60 * 3 + 7, 60)).toBe(7);
  expect(wheelValueIndex(wheelCenterRow(42, 60), 60)).toBe(42);
  const screen = await render(<DueSheet task={task('t1', 'Вёрстка', { dueAt: new Date(2026, 9, 9, 18, 37).toISOString() })} lang="ru" onApply={() => {}} onClear={() => {}} />);
  await fireEvent.press(screen.getByText(t('ru', 'due.time')));
  // Минута 37 — не кратная пяти — есть и выбрана.
  expect(screen.getAllByText('37').length).toBeGreaterThan(0);
  // Время — значением строки «Время ›» и в сводке под строками.
  expect(screen.getByTestId('due-summary').props.children).toMatch(/18:37/);
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

test('п.1–3: страница редактора щипком не масштабируется; рисуя, подсказки ввода нет; поле не ниже экрана', async () => {
  // С 13 октября 2026 масштаба на телефоне нет вовсе — ни страницы, ни
  // текста: щипок мешал писать (tests/editorLive.test.js, «масштаба нет»).
  const full = await render(<DocEditor content={null} lang="ru" />);
  expect(full.getByTestId('web').props.source.html).toMatch(/user-scalable=no/);
  expect(full.getByTestId('web').props.source.html).not.toMatch(/user-scalable=yes/);
  expect(EDITOR_CSS).toMatch(/\.led-annotating \.led-pm \.led-empty::before/);
  expect(EDITOR_CSS).toMatch(/\.led-mobile \.led-pm\s*\{\s*min-height:\s*calc\(100vh/);
});

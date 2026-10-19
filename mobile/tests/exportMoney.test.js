// Выгрузка в Excel и режимы (17 октября 2026). Запуск: npm run test:mobile
//
// Форма листов — в ядре (core/reports.js, tests/unit/reports.test.js там же
// сверяет листы без денег с листами с деньгами). Здесь — применение: лист
// «Экспорт в Excel» и страница задачи берут money у Core.modeFlags
// (hooks/useModeFlags.js) и отдают его ядру отчётов; а построители тут
// настоящие, не подмена: в файле, который уйдёт на «Поделиться», в «личном»
// ни колонок ставки и суммы, ни строк «ставка» и «заработано».
import { render, fireEvent, within } from '@testing-library/react-native';
import Reports from '../src/core/reports.js';
import BottomSheet from '../src/components/BottomSheet';
import ExportPeriodSheet from '../src/components/ExportPeriodSheet';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import { runExport } from '../src/lib/exportRunner';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

jest.mock('../src/components/DocEditor', () => () => null);
jest.mock('../src/lib/exportRunner', () => ({ runExport: jest.fn(), shareTextFile: jest.fn(async () => {}) }));

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const H = 3_600_000;

// Подписи денежных колонок и строк — из словаря телефона, как их видит файл.
const CUR = '₽';
const MONEY_LABELS = ['xlsx.rate', 'xlsx.sum', 'xlsx.rate_now', 'xlsx.earned'].map((key) => t('ru', key, { cur: CUR }));
const TIME_LABELS = ['xlsx.hours', 'xlsx.duration'].map((key) => t('ru', key));

function setup(modePatch = {}) {
  const base = { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 1000, currency: 'RUB' };
  delete base.mode; delete base.showTimer; delete base.showEarnings;
  useAppStore.setState({
    settings: { ...base, ...modePatch },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: H, tagIds: [], notes: '',
      sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null, repeat: null, rate: null, pinnedAt: null, updatedAt: at(10),
    }],
    activeTimer: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useSheetStore.setState({ content: null, header: null, footer: null });
  setup();
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

const PERSONAL = { mode: 'personal' };

/** Всё, что ушло в файл последним runExport, одной строкой. */
const exported = () => JSON.stringify(runExport.mock.calls[runExport.mock.calls.length - 1][1]);

async function exportFromSheet({ month } = {}) {
  openSheet(<ExportPeriodSheet lang="ru" />);
  const s = await render(<BottomSheet />);
  if (month) {
    await fireEvent.press(s.getByTestId('export-period'));
    await fireEvent.press(within(s.getByTestId('export-periods')).getByText(t('ru', 'export.period_month')));
  }
  await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByTestId('primary-button'));
}

async function exportFromTask() {
  const s = await render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);
  await fireEvent.press(s.getByText(t('ru', 'task.history_n', { n: 1 })));
  await fireEvent.press(s.getByText(t('ru', 'task.export_history')));
}

const FLOWS = [
  ['лист «Экспорт»: всё время — сводка по проектам', () => exportFromSheet()],
  ['лист «Экспорт»: месяц — лист записей', () => exportFromSheet({ month: true })],
  ['страница задачи: «Экспорт истории»', () => exportFromTask()],
];

describe.each(FLOWS)('%s', (_name, flow) => {
  test('«фрилансер»: ядро отчётов получает money: true, в файле есть деньги', async () => {
    const spy = jest.spyOn(Reports, 'makeReports');
    await flow();
    expect(runExport).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ money: true }));
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ money: false }));
    const file = exported();
    // Хотя бы подписи колонок ставки и суммы; у листа задачи ещё две строки шапки.
    expect(file).toContain(MONEY_LABELS[0]);
    expect(file).toContain(MONEY_LABELS[1]);
  });

  test('«личное»: ядро отчётов получает money: false, в файле нет ни одной денежной подписи, время на месте', async () => {
    setup(PERSONAL);
    const spy = jest.spyOn(Reports, 'makeReports');
    await flow();
    expect(runExport).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ money: false }));
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ money: true }));
    const file = exported();
    for (const label of MONEY_LABELS) expect(file).not.toContain(label);
    expect(file).not.toContain(CUR);
    expect(file).toContain(TIME_LABELS[0]);
  });
});

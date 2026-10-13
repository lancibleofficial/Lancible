// Лист «Экспорт в Excel» (components/ExportPeriodSheet.js). Запуск: npm run test:mobile
//
// С 11 октября 2026 — как окно веба: «Период» — одно поле-выпадашка (страница
// листа со списком) и точная строка дат под ним, «Свой период…» — два поля
// «С» и «По»; «Проекты» — галочками, «Все проекты» по умолчанию, со страницы
// проекта предвыбран он; сводка «Будет выгружено: N записей, Xч Yм», при нуле
// «Экспорт» гаснет. Правила — побайтная копия core/export.js с веба; здесь —
// что лист их зовёт и что выгрузка получает именно выбранное.
import { render, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import ExportPeriodSheet, { fmtExportDate, exportPlan } from '../src/components/ExportPeriodSheet';
import Export from '../src/core/export.js';
import { buildPeriodSheets, buildAllProjectsSheets } from '../src/lib/xlsxReports';
import { runExport } from '../src/lib/exportRunner';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { dayKey } from '../src/lib/calendarMath';
import { t, pluralForm } from '../src/lib/i18n';
import { fmtDur } from '../src/lib/format';

jest.mock('../src/lib/xlsxReports', () => ({
  buildPeriodSheets: jest.fn(() => [{ name: 'period' }]),
  buildAllProjectsSheets: jest.fn(() => [{ name: 'all' }]),
  buildTaskSheets: jest.fn(() => []),
}));
jest.mock('../src/lib/exportRunner', () => ({ runExport: jest.fn() }));

const H = 3_600_000;
const now = new Date();
// Запись в этом месяце (2-го числа, в полдень) и запись два года назад.
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2, 12).toISOString();
const longAgo = new Date(now.getFullYear() - 2, 0, 15, 12).toISOString();
const session = (start, ms) => ({ start, end: new Date(new Date(start).getTime() + ms).toISOString(), ms });

const PROJECTS = [
  { id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'p2', name: 'Бот', color: '#5ec8f2', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'p3', name: 'Пусто', color: '#ff7a7a', createdAt: '2026-01-03T00:00:00.000Z' },
];
const TASKS = [
  { id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', sessions: [session(thisMonth, H), session(longAgo, 2 * H)], totalMs: 3 * H, tagIds: [] },
  { id: 't2', projectId: 'p2', title: 'Команды', statusId: 's1', sessions: [session(thisMonth, H / 2)], totalMs: H / 2, tagIds: [] },
  { id: 't3', projectId: 'p3', title: 'Ничего', statusId: 's1', sessions: [], totalMs: 0, tagIds: [] },
];

beforeEach(() => {
  jest.clearAllMocks();
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 1000 },
    projects: PROJECTS,
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: TASKS,
    activeTimer: null,
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

async function show(props = {}) {
  openSheet(<ExportPeriodSheet lang="ru" {...props} />);
  return render(<BottomSheet />);
}
const BACK = t('ru', 'common.back');
// Сводка — общая строка InfoRow: testID на её тексте.
const summaryText = (s) => s.getByTestId('export-summary').props.children;
const fieldText = (s, id) => within(s.getByTestId(id)).getByText(/./).props.children;
const exportBtn = (s) => within(s.getByTestId('sheet-footer-content')).getByTestId('primary-button');
const expectedSummary = (n, ms) => t('ru', 'export.summary', { n, plural: pluralForm('ru', n, 'plural.entry'), time: fmtDur(ms, 'ru') });

describe('период', () => {
  test('по умолчанию «Всё время»; под полем — от первой записи до последней', async () => {
    const s = await show();
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'export.title'));
    expect(fieldText(s, 'export-period')).toBe(t('ru', 'export.period_all'));
    const span = Export.exportSpan(TASKS);
    expect(s.getByTestId('export-range').props.children).toBe(Export.exportRangeLabel(span, (d, y) => fmtExportDate(d, y, 'ru')));
    // «Всё время» — по totalMs задач, как сводка по проектам в отчёте.
    expect(summaryText(s)).toBe(expectedSummary(3, 3.5 * H));
  });

  test('поле открывает страницу со списком периодов; выбор возвращает к форме, под полем — точные даты', async () => {
    const s = await show();
    await fireEvent.press(s.getByTestId('export-period'));
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'export.period_label'));
    within(s.getByTestId('sheet-head-row')).getByLabelText(BACK);
    const rows = within(s.getByTestId('export-periods')).getAllByRole('radio');
    expect(rows.map((r) => within(r).getByText(/./).props.children)).toEqual(Export.EXPORT_PERIODS.map((p) => t('ru', `export.period_${p}`)));
    await fireEvent.press(within(s.getByTestId('export-periods')).getByText(t('ru', 'export.period_month')));
    // Снова форма: заголовок листа, поле с выбранным, строка месяца целиком.
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'export.title'));
    expect(fieldText(s, 'export-period')).toBe(t('ru', 'export.period_month'));
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    expect(s.getByTestId('export-range').props.children).toBe(`${fmtExportDate(first, false, 'ru')} – ${fmtExportDate(last, true, 'ru')}`);
    expect(summaryText(s)).toBe(expectedSummary(2, 1.5 * H));
  });

  test('«Свой период…» — две строки «С ›» и «По ›»; календарь под открытой строкой; границы не расходятся', async () => {
    const s = await show();
    await fireEvent.press(s.getByTestId('export-period'));
    await fireEvent.press(within(s.getByTestId('export-periods')).getByText(t('ru', 'export.period_custom')));
    expect(s.queryByTestId('export-range')).toBeNull();
    within(s.getByTestId('export-from')).getByText(t('ru', 'export.from'));
    within(s.getByTestId('export-to')).getByText(t('ru', 'export.to'));
    const y = now.getFullYear();
    const m = now.getMonth();
    const key = (d) => dayKey(new Date(y, m, d));
    const shown = (id) => within(s.getByTestId(id)).getAllByText(/./)[1].props.children;
    // «По» — на 2-е, «С» — на 20-е: «По» подтягивается к «С».
    await fireEvent.press(s.getByTestId('export-to'));
    await fireEvent.press(s.getByText('2'));
    expect(shown('export-to')).toBe(fmtExportDate(new Date(y, m, 2), true, 'ru'));
    await fireEvent.press(s.getByTestId('export-from'));
    await fireEvent.press(s.getByText('20'));
    expect(shown('export-from')).toBe(fmtExportDate(new Date(y, m, 20), true, 'ru'));
    expect(shown('export-to')).toBe(fmtExportDate(new Date(y, m, 20), true, 'ru'));
    // Календарь закрылся после выбора.
    expect(s.queryByText('20')).toBeNull();
    // Сводка — по своему периоду: 20-е без записей.
    expect(key(20) > key(2)).toBe(true);
    expect(summaryText(s)).toBe(t('ru', 'export.empty'));
  });
});

describe('проекты', () => {
  test('по умолчанию «Все проекты»; со страницы проекта — предвыбран он, и сводка только по нему', async () => {
    const all = await show();
    expect(fieldText(all, 'export-projects')).toBe(t('ru', 'filter.all_projects'));
    await all.unmount();
    useSheetStore.setState({ content: null, header: null, footer: null });
    const s = await show({ projectId: 'p2' });
    expect(fieldText(s, 'export-projects')).toBe('Бот');
    expect(summaryText(s)).toBe(expectedSummary(1, H / 2));
  });

  test('галочки: «Все проекты» наверху, отметка сужает выбор, страница не закрывается', async () => {
    const s = await show({ projectId: 'p1' });
    await fireEvent.press(s.getByTestId('export-projects'));
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'export.projects_label'));
    const all = () => within(s.getByTestId('export-all-projects')).getByRole('checkbox');
    const rows = () => within(s.getByTestId('export-project-list')).getAllByRole('checkbox');
    expect(all().props.accessibilityState.checked).toBe(false);
    expect(rows().map((r) => r.props.accessibilityState.checked)).toEqual([true, false, false]);
    await fireEvent.press(rows()[1]);
    expect(rows().map((r) => r.props.accessibilityState.checked)).toEqual([true, true, false]);
    // Страница на месте, «Готово» в подвале возвращает к форме.
    await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.done')));
    expect(fieldText(s, 'export-projects')).toBe(t('ru', 'export.projects_n', { n: 2, plural: pluralForm('ru', 2, 'plural.project') }));
    // «Все проекты» снимает отметки.
    await fireEvent.press(s.getByTestId('export-projects'));
    await fireEvent.press(all());
    expect(all().props.accessibilityState.checked).toBe(true);
    expect(rows().every((r) => !r.props.accessibilityState.checked)).toBe(true);
    await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(BACK));
    expect(fieldText(s, 'export-projects')).toBe(t('ru', 'filter.all_projects'));
  });
});

describe('сводка и выгрузка', () => {
  test('записей нет — «Экспорт» неактивен, сводка объясняет; нажатие ничего не выгружает', async () => {
    const s = await show({ projectId: 'p3' });
    expect(summaryText(s)).toBe(t('ru', 'export.empty'));
    const btn = exportBtn(s);
    expect(btn.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(btn);
    expect(runExport).not.toHaveBeenCalled();
  });

  test('«Всё время» по одному проекту — сводка по проектам только с ним, в его валюте', async () => {
    const s = await show({ projectId: 'p1' });
    expect(exportBtn(s).props.accessibilityState || {}).not.toMatchObject({ disabled: true });
    await fireEvent.press(exportBtn(s));
    expect(buildAllProjectsSheets).toHaveBeenCalledTimes(1);
    const [projects, tasksOf] = buildAllProjectsSheets.mock.calls[0];
    expect(projects.map((p) => p.id)).toEqual(['p1']);
    expect(tasksOf('p1').map((x) => x.id)).toEqual(['t1']);
    expect(buildPeriodSheets).not.toHaveBeenCalled();
    expect(runExport).toHaveBeenCalledTimes(1);
    expect(runExport.mock.calls[0][0]).toContain('Сайт');
    expect(runExport.mock.calls[0][1]).toEqual([{ name: 'all' }]);
    // Лист закрылся.
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('период и проекты доходят до файла: лист записей за месяц только по выбранным', async () => {
    const s = await show();
    await fireEvent.press(s.getByTestId('export-period'));
    await fireEvent.press(within(s.getByTestId('export-periods')).getByText(t('ru', 'export.period_month')));
    await fireEvent.press(s.getByTestId('export-projects'));
    await fireEvent.press(within(s.getByTestId('export-project-list')).getByText('Бот'));
    await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(BACK));
    expect(summaryText(s)).toBe(expectedSummary(1, H / 2));
    await fireEvent.press(exportBtn(s));
    expect(buildPeriodSheets).toHaveBeenCalledTimes(1);
    const [tasks, , lang, , , range] = buildPeriodSheets.mock.calls[0];
    expect(tasks.map((x) => x.id)).toEqual(['t2']);
    expect(lang).toBe('ru');
    expect(range).toEqual(Export.exportRange('month', new Date()));
    expect(buildAllProjectsSheets).not.toHaveBeenCalled();
  });

  test('план выгрузки — та же функция, что и сводка: задачи, границы, выбранные проекты', () => {
    const plan = exportPlan(TASKS, PROJECTS, { period: 'all', from: null, to: null, projects: ['p1', 'p3'] });
    expect(plan.tasks.map((x) => x.id)).toEqual(['t1', 't3']);
    expect(plan.range).toBeNull();
    expect(plan.picked.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(plan.summary).toEqual({ count: 2, ms: 3 * H, empty: false });
  });
});

test('тексты листа — как на вебе, на четырёх языках', () => {
  const web = require('../../src/renderer/core/i18n.js').T;
  const pairs = [
    ['export.period_label', 'export.period_label'], ['export.projects_label', 'export.projects_label'],
    ['export.summary', 'export.summary'], ['export.empty', 'export.empty'], ['export.projects_n', 'export.projects_n'],
    ['export.from', 'export.date_from'], ['export.to', 'export.date_to'],
    ...Export.EXPORT_PERIODS.map((p) => [`export.period_${p}`, `export.period_${p}`]),
  ];
  for (const lang of ['ru', 'en', 'uk', 'kk']) {
    for (const [mine, theirs] of pairs) expect({ lang, mine, text: t(lang, mine) }).toEqual({ lang, mine, text: web[lang][theirs] });
    for (const key of ['plural.entry', 'plural.project']) expect({ lang, key, forms: pluralForm(lang, 5, key) }).toEqual({ lang, key, forms: web[lang][key][2] });
  }
});

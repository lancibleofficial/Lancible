// Режимы на телефоне (17 октября 2026). Запуск: npm run test:mobile
//
// Само правило — в ядре (core/modes.js, tests/unit/modes.test.js): «личное»
// прячет деньги целиком, выключенный счётчик — только «заработано»,
// выключенный таймер — кнопки запуска. Здесь — применение: экраны берут
// флаги у Core.modeFlags (hooks/useModeFlags.js) и прячут по ним то, что
// велено, а settings.mode / showTimer / showEarnings сами не читают.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { render, fireEvent } from '@testing-library/react-native';
import Modes from '../src/core/modes.js';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import StatsScreen from '../src/screens/StatsScreen';
import ProjectScreen from '../src/screens/ProjectScreen';
import ProjectsScreen from '../src/screens/ProjectsScreen';
import TaskRow from '../src/components/TaskRow';
import NewProjectSheet from '../src/components/NewProjectSheet';
import TaskMoveSheet from '../src/components/TaskMoveSheet';
import BottomSheet from '../src/components/BottomSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

jest.mock('../src/components/DocEditor', () => () => null);

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const H = 3_600_000;

const PERSONAL = { mode: 'personal' };
const NO_EARNINGS = { mode: 'freelance', showEarnings: false };
const NO_TIMER = { mode: 'freelance', showTimer: false };

function setup(modePatch = {}) {
  const base = { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 1000, currency: 'RUB' };
  delete base.mode; delete base.showTimer; delete base.showEarnings;
  useAppStore.setState({
    settings: { ...base, ...modePatch },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    tags: [],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: H, tagIds: [], notes: '',
      sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null, repeat: null, rate: null, pinnedAt: null, updatedAt: at(10),
    }],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
}

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  setup();
});
afterEach(() => jest.restoreAllMocks());

const task = () => render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);

describe('экраны берут флаги у Core.modeFlags', () => {
  test.each([
    ['страница задачи', task],
    ['«Цифры»', () => render(<StatsScreen navigation={nav()} />)],
    ['страница проекта', () => render(<ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />)],
    ['строка задачи', () => render(<TaskRow task={useAppStore.getState().tasks[0]} />)],
  ])('%s зовёт modeFlags с настройками', async (_name, open) => {
    const spy = jest.spyOn(Modes, 'modeFlags');
    await open();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ru', hourlyRate: 1000 }));
  });

  test('решает ядро, а не экран: modeFlags сказал «без денег» — денег нет, хотя в настройках фрилансер', async () => {
    jest.spyOn(Modes, 'modeFlags').mockReturnValue({ mode: 'personal', money: false, earnings: false, timer: false });
    const q = await task();
    expect(q.queryByTestId('task-more')).toBeNull();
    expect(q.queryByTestId('task-timer-button')).toBeNull();
  });

  test('исходники: settings.mode, showTimer и showEarnings никто, кроме hooks/useModeFlags.js, не читает', () => {
    const SRC = join(__dirname, '..', 'src');
    const files = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== 'core' && name !== 'editor') walk(full); } else if (name.endsWith('.js')) files.push(full);
      }
    })(SRC);
    const readers = files
      .filter((f) => /settings\??\.(mode|showTimer|showEarnings)\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).replace(/\\/g, '/'))
      .filter((f) => f !== 'hooks/useModeFlags.js');
    expect(readers).toEqual([]);
  });
});

describe('«Личное»: денег нет нигде', () => {
  beforeEach(() => setup(PERSONAL));

  test('задача: ни «заработано» у таймера, ни ставки в сведениях, ни сумм в истории', async () => {
    const q = await task();
    expect(q.queryByTestId('task-earned')).toBeNull();
    expect(q.queryByTestId('task-more')).toBeNull();
    expect(q.queryByTestId('task-rate-row')).toBeNull();
    expect(q.queryByText(/₽/)).toBeNull();
    await fireEvent.press(q.getByText(t('ru', 'task.history_n', { n: 1 })));
    expect(q.queryByTestId('task-history-money')).toBeNull();
    expect(q.queryByText(/₽/)).toBeNull();
  });

  test('«Цифры» и страница проекта — без сумм', async () => {
    const s = await render(<StatsScreen navigation={nav()} />);
    expect(s.queryByTestId('stats-money')).toBeNull();
    expect(s.queryByTestId('stats-per-hour')).toBeNull();
    expect(s.queryByText(/₽/)).toBeNull();
    const p = await render(<ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />);
    p.getByTestId('project-kpi');
    expect(p.queryByTestId('project-kpi-money')).toBeNull();
    expect(p.queryByText(t('ru', 'project.kpi_money'))).toBeNull();
  });

  test('карточка проекта в колоде — без суммы', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    q.getByTestId('deck-card-0');
    expect(q.queryByTestId('deck-money-0')).toBeNull();
  });

  test('новый проект — без группы «Деньги»', async () => {
    openSheet(<NewProjectSheet onCreated={() => {}} onCancel={() => {}} />);
    const s = await render(<BottomSheet />);
    s.getByTestId('project-form-group-project');
    expect(s.queryByTestId('project-form-group-money')).toBeNull();
  });

  test('настройки проекта — без группы «Деньги»', async () => {
    openSheet(<NewProjectSheet project={useAppStore.getState().projects[0]} />);
    const s = await render(<BottomSheet />);
    s.getByTestId('project-group-project');
    expect(s.queryByTestId('project-group-money')).toBeNull();
  });
});

describe('Фрилансер: всё на месте', () => {
  test('задача, «Цифры», проект и колода показывают суммы', async () => {
    const q = await task();
    q.getByTestId('task-earned');
    q.getByTestId('task-rate-row');
    q.getByTestId('task-timer-button');
    const s = await render(<StatsScreen navigation={nav()} />);
    s.getByTestId('stats-money');
    const p = await render(<ProjectScreen navigation={nav()} route={{ params: { projectId: 'p1' } }} />);
    p.getByTestId('project-kpi-money');
    const d = await render(<ProjectsScreen navigation={nav()} />);
    d.getByTestId('deck-money-0');
  });
});

describe('Счётчик заработка выключен: «заработано» нет, ставка осталась', () => {
  beforeEach(() => setup(NO_EARNINGS));

  test('задача без «заработано», но со ставкой', async () => {
    const q = await task();
    expect(q.queryByTestId('task-earned')).toBeNull();
    q.getByTestId('task-rate-row');
    // Карточки проектов — деньги, а не счётчик: сумма остаётся.
    const d = await render(<ProjectsScreen navigation={nav()} />);
    d.getByTestId('deck-money-0');
  });
});

describe('Таймер выключен: запуска нет, история и стоп идущего — есть', () => {
  beforeEach(() => setup(NO_TIMER));

  test('ни квадрата на задаче, ни квадрата в строке', async () => {
    const q = await task();
    expect(q.queryByTestId('task-timer-button')).toBeNull();
    expect(q.queryByLabelText(t('ru', 'timer.start'))).toBeNull();
    const r = await render(<TaskRow task={useAppStore.getState().tasks[0]} />);
    expect(r.queryByTestId('task-play-t1')).toBeNull();
  });

  test('запись вручную в истории остаётся', async () => {
    const q = await task();
    await fireEvent.press(q.getByText(t('ru', 'task.history_n', { n: 1 })));
    q.getByText(t('ru', 'task.add_manual'));
  });

  test('карточка доски: «Старт таймера» нет, статусы на месте', async () => {
    openSheet(<TaskMoveSheet taskId="t1" />);
    const s = await render(<BottomSheet />);
    s.getByTestId('move-list');
    expect(s.queryByTestId('move-timer')).toBeNull();
  });

  test('идущий таймер (запущен до выключения) остановить можно', async () => {
    useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: at(11), heartbeatAt: at(11) } });
    const q = await task();
    q.getByTestId('task-timer-button');
    q.getByLabelText(t('ru', 'timer.stop'));
    const r = await render(<TaskRow task={useAppStore.getState().tasks[0]} />);
    await fireEvent.press(r.getByTestId('task-play-t1'));
    expect(useAppStore.getState().activeTimer).toBeNull();
  });
});

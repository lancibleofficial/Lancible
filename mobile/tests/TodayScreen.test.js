// «Сегодня» (screens/HomeScreen.js). Запуск: npm run test:mobile
//
// Проверяется не расчёт (записи дня режет ядро Agenda.sessionSegments,
// неделя — aggregateDays), а что экран его показывает: остров недели,
// последняя задача с кнопкой «Старт», записи дня по проектам, идущая
// запись и остров «Сроки сегодня и завтра».
//
// 11 октября 2026 порядок блоков стал таким: неделя · последняя задача ·
// дедлайны · недавние задачи (четыре строки, «Смотреть все» — на вкладку
// «Задачи») · записи дня. У часовой сетки нет своей шапки дня («Вс / 11»).
import { render, fireEvent, within } from '@testing-library/react-native';
import HomeScreen from '../src/screens/HomeScreen';
import AgendaGrid from '../src/components/AgendaGrid';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn() });
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const H = 3_600_000;

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: H, tagIds: [],
      sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null, updatedAt: at(10),
    }],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});

test('без таймера — неделя, последняя задача и записи дня по проекту', async () => {
  const { getByText, getAllByText, queryByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'today.last_task'));
  getByText('Сайт');
  expect(getAllByText('Вёрстка').length).toBeGreaterThan(1);
  getByText('09:00–10:00');
  expect(queryByText(t('ru', 'today.no_entries'))).toBeNull();
  expect(queryByText(t('ru', 'today.deadlines'))).toBeNull();
});

test('«Старт» у последней задачи запускает её таймер', async () => {
  const { getAllByLabelText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  await fireEvent.press(getAllByLabelText(t('ru', 'timer.start'))[0]);
  expect(useAppStore.getState().activeTimer.taskId).toBe('t1');
});

test('идущая задача видна строкой «сейчас», а остров последней задачи прячется', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: at(11), heartbeatAt: at(11) } });
  const { getByText, queryByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'tasks.now').toLowerCase());
  expect(queryByText(t('ru', 'today.last_task'))).toBeNull();
});

test('просроченный дедлайн виден в острове «Сроки сегодня и завтра»', async () => {
  useAppStore.setState({
    tasks: [{ ...useAppStore.getState().tasks[0], dueAt: '2026-01-01T10:00:00.000Z' }],
  });
  const { getByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'today.deadlines'));
  getByText(t('ru', 'due.overdue'), { exact: false });
});

test('без записей за день — «Записей нет»', async () => {
  useAppStore.setState({ tasks: [{ ...useAppStore.getState().tasks[0], sessions: [], totalMs: 0 }] });
  const { getByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
  getByText(t('ru', 'today.no_entries'));
});

describe('часовая сетка', () => {
  const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  test('при смене режима шапки выбранного дня («Вс / 11») нет: день выбирает остров недели', async () => {
    const { getByRole, getByText, queryByTestId, queryAllByText } = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
    await fireEvent.press(getByRole('button', { name: t('ru', 'today.grid') }));
    getByText('09:00–10:00'); // сетка на месте
    expect(queryByTestId('agenda-day-names')).toBeNull();
    // Буквы дней недели — только в острове недели, по одной на день.
    for (const key of WEEK) expect([key, queryAllByText(t('ru', `weekday.${key}`)).length]).toEqual([key, 1]);
    // И обратно в список — тоже ничего лишнего.
    await fireEvent.press(getByRole('button', { name: t('ru', 'today.list') }));
    expect(queryByTestId('agenda-day-names')).toBeNull();
    for (const key of WEEK) expect([key, queryAllByText(t('ru', `weekday.${key}`)).length]).toEqual([key, 1]);
  });

  test('сама сетка по умолчанию шапку дней рисует (неделя, четыре дня), а «Сегодня» просит её убрать', async () => {
    const props = { tasks: useAppStore.getState().tasks, projects: useAppStore.getState().projects, from: new Date().setHours(0, 0, 0, 0), days: 1, nowMs: Date.now(), lang: 'ru', onTapBlock: jest.fn(), onTapDeadline: jest.fn(), onCreate: jest.fn(), onMove: jest.fn() };
    const withNames = await render(<AgendaGrid {...props} onOpenDay={jest.fn()} />);
    withNames.getByTestId('agenda-day-names');
    const without = await render(<AgendaGrid {...props} dayNames={false} />);
    expect(without.queryByTestId('agenda-day-names')).toBeNull();
  });
});

describe('порядок блоков', () => {
  // Шесть задач с записями за сегодня (свежее — с большим номером) и задача
  // без записей с просроченным дедлайном: в «недавние» она не попадает.
  const seedMany = () => useAppStore.setState({
    tasks: [
      ...[1, 2, 3, 4, 5, 6].map((n) => ({
        id: `t${n}`, projectId: 'p1', title: `Задача ${n}`, statusId: 's1', done: false, totalMs: H, tagIds: [],
        sessions: [{ start: at(n + 2), end: at(n + 3), ms: H }], dueAt: null, updatedAt: at(n + 3),
      })),
      { id: 'd1', projectId: 'p1', title: 'Отчёт', statusId: 's1', done: false, totalMs: 0, tagIds: [], sessions: [], dueAt: '2026-01-01T10:00:00.000Z', updatedAt: at(1) },
    ],
  });
  /** Строки экрана в порядке сверху вниз — как их читает человек. */
  const texts = (node, out = []) => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach((x) => texts(x, out));
    else if (node) texts(node.children, out);
    return out;
  };

  test('последняя задача → дедлайны → недавние (4 строки) → «Смотреть все» → записи дня', async () => {
    seedMany();
    const screen = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
    const all = texts(screen.toJSON());
    const at1 = (s) => { const i = all.indexOf(s); expect([s, i >= 0]).toEqual([s, true]); return i; };
    const marks = [
      at1(t('ru', 'today.last_task')),
      at1(t('ru', 'today.deadlines')),
      at1(t('ru', 'home.recent')),
      at1(t('ru', 'today.see_all')),
      at1('03:00–04:00'), // запись «Задачи 1»: записи дня идут последним блоком
    ];
    expect([...marks].sort((a, b) => a - b)).toEqual(marks);
  });

  test('«Недавние задачи» — ровно четыре строки: свежие после последней, сама последняя уже в острове', async () => {
    seedMany();
    const screen = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
    const block = within(screen.getByTestId('recent-block'));
    const rows = block.getAllByText(/^Задача \d$/).map((n) => n.props.children);
    expect(rows).toEqual(['Задача 5', 'Задача 4', 'Задача 3', 'Задача 2']);
    // «Задача 6» — остров последней задачи, а «Задача 1» — дальше четырёх.
    expect(block.queryByText('Задача 6')).toBeNull();
    expect(block.queryByText('Задача 1')).toBeNull();
    expect(block.queryByText('Отчёт')).toBeNull();
  });

  test('«Смотреть все» ведёт на вкладку «Задачи»', async () => {
    seedMany();
    const navigation = nav();
    const screen = await render(<HomeScreen navigation={navigation} route={{ params: {} }} />);
    await fireEvent.press(screen.getByText(t('ru', 'today.see_all')));
    expect(navigation.navigate).toHaveBeenCalledWith('Tasks');
  });

  test('строка «Недавних» открывает задачу', async () => {
    seedMany();
    const navigation = nav();
    const screen = await render(<HomeScreen navigation={navigation} route={{ params: {} }} />);
    await fireEvent.press(within(screen.getByTestId('recent-block')).getByText('Задача 5'));
    expect(navigation.navigate).toHaveBeenCalledWith('TaskDetail', { taskId: 't5' });
  });

  test('недавних нет (одна задача — она в острове) — блока и «Смотреть все» нет', async () => {
    const screen = await render(<HomeScreen navigation={nav()} route={{ params: {} }} />);
    expect(screen.queryByTestId('recent-block')).toBeNull();
    expect(screen.queryByText(t('ru', 'today.see_all'))).toBeNull();
    expect(screen.queryByText(t('ru', 'home.recent'))).toBeNull();
  });
});

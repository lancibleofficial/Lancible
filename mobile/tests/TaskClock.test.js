// Время задачи и сумма рядом. Запуск: npm run test:mobile (из корня)
//
// Правило «показывать ли сумму» живёт в ядре (earnedShown) и закрыто
// юнитами в tests/unit/money.test.js. Здесь — что телефон его зовёт:
// сумма появляется со ставкой, прячется без неё и растёт с идущим таймером.
import { render } from '@testing-library/react-native';
import TaskClock from '../src/components/TaskClock';
import { useAppStore } from '../src/store/useAppStore';
import { fmtMoney } from '../src/lib/format';

const HOUR = 3_600_000;
const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка', rate: null,
  totalMs: HOUR, sessions: [{ start: '2026-06-10T09:00:00.000Z', end: '2026-06-10T10:00:00.000Z', ms: HOUR }],
  ...over,
});
const settings = (over) => ({ ...useAppStore.getState().settings, lang: 'ru', currency: 'RUB', ...over });

beforeEach(() => {
  useAppStore.setState({ activeTimer: null, settings: settings({ hourlyRate: 2000 }) });
});

test('со ставкой сумма стоит рядом со временем', async () => {
  const { getByText } = await render(<TaskClock task={task()} elapsedMs={HOUR} />);
  getByText('01:00:00');
  getByText(fmtMoney(2000, 'ru', 'RUB'));
});

test('ни ставки, ни заработанного — суммы нет', async () => {
  useAppStore.setState({ settings: settings({ hourlyRate: 0 }) });
  const { queryByText } = await render(<TaskClock task={task()} elapsedMs={HOUR} />);
  expect(queryByText(fmtMoney(0, 'ru', 'RUB'))).toBeNull();
});

test('идущий таймер прибавляется к сумме', async () => {
  useAppStore.setState({ activeTimer: { taskId: 't1', startedAt: new Date(Date.now() - HOUR).toISOString() } });
  const { getByText } = await render(<TaskClock task={task()} elapsedMs={2 * HOUR} />);
  getByText(fmtMoney(4000, 'ru', 'RUB'));
});

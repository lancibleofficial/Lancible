// «Цифры» (screens/StatsScreen.js). Запуск: npm run test:mobile
//
// Выбор в календаре и границы по вкладкам — чистые функции, проверяются
// числами. Экран — что вкладки на месте, тап по дню показывает этот день в
// итоговой карточке, «снять» возвращает весь месяц.
import { render, fireEvent } from '@testing-library/react-native';
import StatsScreen, { nextSelection, statsBounds } from '../src/screens/StatsScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn() });
const H = 3_600_000;

test('nextSelection: день, период, снятие и новый день после периода', () => {
  expect(nextSelection(null, '2026-10-08')).toEqual({ from: '2026-10-08', to: '2026-10-08' });
  expect(nextSelection({ from: '2026-10-08', to: '2026-10-08' }, '2026-10-08')).toBeNull();
  expect(nextSelection({ from: '2026-10-08', to: '2026-10-08' }, '2026-10-12')).toEqual({ from: '2026-10-08', to: '2026-10-12' });
  expect(nextSelection({ from: '2026-10-08', to: '2026-10-12' }, '2026-10-20')).toEqual({ from: '2026-10-20', to: '2026-10-20' });
});

test('statsBounds: день, неделя с понедельника, месяц, выбор в месяце в любом порядке', () => {
  const thu = new Date(2026, 9, 8, 15, 30);
  const [d0, d1] = statsBounds('day', thu, null);
  expect([d0.getDate(), d0.getHours(), d1.getDate(), d1.getHours()]).toEqual([8, 0, 8, 23]);

  const [w0, w1] = statsBounds('week', thu, null);
  expect([w0.getDay(), w0.getDate(), w1.getDay(), w1.getDate()]).toEqual([1, 5, 0, 11]);

  const [m0, m1] = statsBounds('month', thu, null);
  expect([m0.getDate(), m1.getDate(), m1.getMonth()]).toEqual([1, 31, 9]);

  const [p0, p1] = statsBounds('month', thu, { from: '2026-10-12', to: '2026-10-05' });
  expect([p0.getDate(), p1.getDate(), p1.getHours()]).toEqual([5, 12, 23]);
});

describe('экран', () => {
  beforeEach(() => {
    const today = new Date();
    const at = (h) => { const d = new Date(today); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 0 },
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
      tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, totalMs: H, tagIds: [], sessions: [{ start: at(9), end: at(10), ms: H }] }],
      activeTimer: null,
    });
  });

  test('четыре вкладки и итоговая карточка месяца с подсказкой', async () => {
    const { getByText } = await render(<StatsScreen navigation={nav()} />);
    for (const key of ['calendar.day', 'calendar.week', 'calendar.month', 'stats.all_time']) getByText(t('ru', key));
    getByText(t('ru', 'calendar.for_month'));
    getByText(t('ru', 'stats.pick_hint'));
  });

  test('тап по сегодняшнему дню — карточка про этот день, «снять» возвращает месяц', async () => {
    const { getByText, getAllByText, queryByText } = await render(<StatsScreen navigation={nav()} />);
    const day = String(new Date().getDate());
    await fireEvent.press(getAllByText(day).find((n) => n.parent));
    expect(queryByText(t('ru', 'calendar.for_month'))).toBeNull();
    await fireEvent.press(getByText(t('ru', 'stats.clear_period')));
    getByText(t('ru', 'calendar.for_month'));
  });

  test('вкладка «День» — «Сегодня», итог за день и число записей', async () => {
    const { getByText } = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(getByText(t('ru', 'calendar.day')));
    getByText(t('ru', 'calendar.today'));
    getByText(t('ru', 'stats.for_day'));
    getByText(t('ru', 'task.records_n', { n: 1 }));
  });
});

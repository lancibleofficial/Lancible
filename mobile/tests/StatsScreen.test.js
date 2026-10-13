// «Цифры» (screens/StatsScreen.js). Запуск: npm run test:mobile
//
// Выбор в календаре и границы по вкладкам — чистые функции, проверяются
// числами. Экран — что вкладки Неделя · Месяц · Всё на месте и «Дня» среди
// них нет, тап по дню в месяце показывает этот день в итоговой карточке,
// «снять» возвращает весь месяц, а на «Неделе» тап по столбику показывает
// день, повторный тап или другой столбик переключает. Под днями недели — число
// месяца, у сегодняшнего на акцентной подложке; ряды календаря — по семь
// клеток (в ноябре 2026 последний день растягивался на весь ряд); неделя и
// месяц листаются свайпом так же, как стрелками.
import { StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import StatsScreen, { nextSelection, statsBounds, monthCells, periodSwipeDir, PERIOD_SWIPE, MODES } from '../src/screens/StatsScreen';
import * as ReduceMotion from '../src/hooks/useReduceMotion';
import { useAppStore } from '../src/store/useAppStore';
import { dayKey } from '../src/lib/calendarMath';
import { capFirst } from '../src/lib/format';
import { colors } from '../src/theme';
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
  // «день» — границы дня, выбранного столбиком на «Неделе».
  const [d0, d1] = statsBounds('day', thu, null);
  expect([d0.getDate(), d0.getHours(), d1.getDate(), d1.getHours()]).toEqual([8, 0, 8, 23]);

  const [w0, w1] = statsBounds('week', thu, null);
  expect([w0.getDay(), w0.getDate(), w1.getDay(), w1.getDate()]).toEqual([1, 5, 0, 11]);

  const [m0, m1] = statsBounds('month', thu, null);
  expect([m0.getDate(), m1.getDate(), m1.getMonth()]).toEqual([1, 31, 9]);

  const [p0, p1] = statsBounds('month', thu, { from: '2026-10-12', to: '2026-10-05' });
  expect([p0.getDate(), p1.getDate(), p1.getHours()]).toEqual([5, 12, 23]);
});

test('вкладки периода: Неделя · Месяц · Всё, вкладки «День» нет', () => {
  expect(MODES).toEqual(['week', 'month', 'all']);
});

describe('экран', () => {
  beforeEach(() => {
    const today = new Date();
    const at = (h) => { const d = new Date(today); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 0 },
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
      tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, totalMs: H, tagIds: [], sessions: [{ start: at(9), end: at(10), ms: H }] }],
      activeTimer: null,
    });
  });

  const dayText = (d) => capFirst(d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }));

  test('три вкладки без «Дня» и итоговая карточка месяца с подсказкой', async () => {
    const { getByText, queryByText } = await render(<StatsScreen navigation={nav()} />);
    for (const key of ['calendar.week', 'calendar.month', 'stats.all_time']) getByText(t('ru', key));
    expect(queryByText(t('ru', 'calendar.day'))).toBeNull();
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

  test('неделя: тап по столбику показывает день, повторный — всю неделю, другой — переключает', async () => {
    const { getByText, getAllByTestId, getByTestId, queryByText } = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(getByText(t('ru', 'calendar.week')));
    getByText(t('ru', 'calendar.for_week'));
    // Целая неделя: есть плитка «в день», выбранных столбиков нет.
    getByText(t('ru', 'stats.per_day'));
    expect(getAllByTestId(/^stats-bar-/)).toHaveLength(7);
    for (const bar of getAllByTestId(/^stats-bar-/)) expect(bar.props.accessibilityState.selected).toBe(false);

    // Тап по сегодняшнему столбику: итог и записи этого дня (то, что было на «Дне»).
    const todayId = `stats-bar-${dayKey(new Date())}`;
    await fireEvent.press(getByTestId(todayId));
    getByText(dayText(new Date()));
    getByText(t('ru', 'task.records_n', { n: 1 }));
    expect(queryByText(t('ru', 'calendar.for_week'))).toBeNull();
    // День целиком — плитки «в день» нет, как не было на вкладке «День».
    expect(queryByText(t('ru', 'stats.per_day'))).toBeNull();
    // Выбранный столбик подсвечен подложкой и отмечен для читалки экрана.
    expect(getByTestId(todayId).props.accessibilityState.selected).toBe(true);
    expect(StyleSheet.flatten(getByTestId(todayId).props.style).backgroundColor).toBe(colors.panel2);

    // Другой день: сегодняшний отпущен, показан выбранный.
    const other = getAllByTestId(/^stats-bar-/).find((b) => b.props.testID !== todayId);
    await fireEvent.press(other);
    getByText(t('ru', 'task.records_n', { n: 0 }));
    expect(queryByText(dayText(new Date()))).toBeNull();
    expect(getByTestId(todayId).props.accessibilityState.selected).toBe(false);
    expect(getByTestId(other.props.testID).props.accessibilityState.selected).toBe(true);

    // Повторный тап по нему — снова вся неделя.
    await fireEvent.press(getByTestId(other.props.testID));
    getByText(t('ru', 'calendar.for_week'));
    getByText(t('ru', 'stats.per_day'));
  });

  test('смена вкладки сбрасывает выбранный день', async () => {
    const { getByText, getByTestId } = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(getByText(t('ru', 'calendar.week')));
    const todayId = `stats-bar-${dayKey(new Date())}`;
    await fireEvent.press(getByTestId(todayId));
    await fireEvent.press(getByText(t('ru', 'calendar.month')));
    await fireEvent.press(getByText(t('ru', 'calendar.week')));
    getByText(t('ru', 'calendar.for_week'));
  });

  test.each(['ru', 'en', 'uk', 'kk'])('стрелки периода (%s): у обеих своя подпись — предыдущий и следующий период, на неделе и в месяце', async (lang) => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang } });
    const prev = t(lang, 'stats.prev_period');
    const next = t(lang, 'stats.next_period');
    // Ключи на месте, подписи разные и не «Назад»: стрелка листает период, а не экран.
    expect([prev, next]).not.toContain('stats.prev_period');
    expect([prev, next]).not.toContain('stats.next_period');
    expect(prev).not.toBe(next);
    expect(prev).not.toBe(t(lang, 'common.back'));

    const { getByText, getByTestId, getByLabelText } = await render(<StatsScreen navigation={nav()} />);
    for (const mode of ['calendar.month', 'calendar.week']) {
      await fireEvent.press(getByText(t(lang, mode)));
      expect(getByTestId('stats-prev').props.accessibilityLabel).toBe(prev);
      expect(getByTestId('stats-next').props.accessibilityLabel).toBe(next);
      expect(getByLabelText(prev)).toBe(getByTestId('stats-prev'));
      expect(getByLabelText(next)).toBe(getByTestId('stats-next'));
    }
  });
});

// Время прибито: фальшивой остаётся только Date, таймеры настоящие — иначе
// ждущий отрисовки render не дождётся.
const REAL_TIMERS = ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime'];
const pin = (y, m, d) => jest.useFakeTimers({ now: new Date(y, m, d, 12, 0, 0), doNotFake: REAL_TIMERS });
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
// Числа месяца под столбиками недели — по порядку слева направо.
const numsOf = (q) => q.getAllByTestId(/^stats-bar-\d/).map((bar) => Number(bar.props.testID.slice(-2)));

function seed() {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, totalMs: H, tagIds: [],
      sessions: [{ start: new Date(2026, 8, 30, 9).toISOString(), end: new Date(2026, 8, 30, 10).toISOString(), ms: H }],
    }],
    activeTimer: null,
  });
}

describe('неделя: числа месяца под днями', () => {
  beforeEach(seed);
  afterEach(() => { jest.useRealTimers(); });

  test('под каждым столбиком — число месяца его дня, через границу месяцев тоже', async () => {
    pin(2026, 8, 30); // среда; неделя с понедельника 28 сентября
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    expect(numsOf(q)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    // Число лежит в столбике своего дня, под подписью дня недели.
    expect(q.getByTestId('stats-daynum-2026-09-30').parent.props.testID).toBe('stats-bar-2026-09-30');
    const bar = q.getByTestId('stats-bar-2026-10-02');
    const kids = bar.children.map((c) => (c.props.testID ? c.props.testID : (c.children || []).join('')));
    expect(kids.at(-2)).toBe(t('ru', 'weekday.fri'));
    expect(kids.at(-1)).toBe('stats-daynum-2026-10-02');
  });

  test('сегодняшнее число — на акцентной подложке, остальные без неё', async () => {
    pin(2026, 8, 30);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    const pad = (key) => flat(q.getByTestId(`stats-daynum-${key}`)).backgroundColor;
    expect(pad('2026-09-30')).toBe(colors.accent);
    for (const key of ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      expect(pad(key)).toBeUndefined();
    }
    // Число на подложке — цветом «на акценте», остальные — тихим.
    expect(flat(q.getByTestId('stats-daynum-2026-09-30').children[0]).color).toBe(colors.accentText);
    expect(flat(q.getByTestId('stats-daynum-2026-10-02').children[0]).color).toBe(colors.textDim);
  });

  test('выбранный день не путается с сегодняшним: круг остаётся сегодняшнему', async () => {
    pin(2026, 8, 30);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    await fireEvent.press(q.getByTestId('stats-bar-2026-10-02'));
    // Выбрана пятница, 2 октября: у столбика подложка, у числа акцента нет.
    expect(q.getByTestId('stats-bar-2026-10-02').props.accessibilityState.selected).toBe(true);
    expect(flat(q.getByTestId('stats-bar-2026-10-02')).backgroundColor).toBe(colors.panel2);
    expect(flat(q.getByTestId('stats-daynum-2026-10-02')).backgroundColor).toBeUndefined();
    // Сегодняшний не выбран: столбик без подложки, а круг у числа на месте.
    expect(q.getByTestId('stats-bar-2026-09-30').props.accessibilityState.selected).toBe(false);
    expect(flat(q.getByTestId('stats-bar-2026-09-30')).backgroundColor).toBeUndefined();
    expect(flat(q.getByTestId('stats-daynum-2026-09-30')).backgroundColor).toBe(colors.accent);
  });

  test('на неделе без «сегодня» подложки нет ни у одного числа', async () => {
    pin(2026, 8, 30);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    await fireEvent.press(q.getByTestId('stats-next'));
    expect(numsOf(q)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    for (const el of q.getAllByTestId(/^stats-daynum-/)) expect(flat(el).backgroundColor).toBeUndefined();
  });
});

describe('месяц: последний ряд не растягивается', () => {
  beforeEach(seed);
  afterEach(() => { jest.useRealTimers(); });

  const MONTHS = [];
  for (const y of [2026, 2027]) for (let m = 0; m < 12; m += 1) MONTHS.push([y, m]);

  test('monthCells: все 24 месяца 2026–2027 — ряды по семь, дни подряд, с 1 по 6 днями в хвосте', () => {
    const tails = new Set();
    for (const [y, m] of MONTHS) {
      const rows = monthCells(y, m);
      const all = rows.flat();
      expect(rows.length).toBeGreaterThanOrEqual(5);
      for (const row of rows) expect(row).toHaveLength(7);
      // Дни месяца идут подряд с первого по последний, ключи не повторяются.
      const inMonth = all.filter((c) => !c.off).map((c) => c.day);
      expect(inMonth).toEqual(Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => i + 1));
      expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
      tails.add(rows.at(-1).filter((c) => !c.off).length);
    }
    // В последнем ряду бывает и 1, и 2 … и 6 дней месяца — все случаи покрыты.
    for (const n of [1, 2, 3, 4, 5, 6]) expect(tails.has(n)).toBe(true);
  });

  test('ноябрь 2026: 30-е — единственный день своего ряда, но ряд полный', () => {
    const rows = monthCells(2026, 10);
    expect(rows).toHaveLength(6);
    expect(rows.at(-1).map((c) => [c.day, c.off])).toEqual([[30, false], [1, true], [2, true], [3, true], [4, true], [5, true], [6, true]]);
  });

  test('на экране у каждого ряда семь клеток с одним стилем — ширина последнего равна обычной', async () => {
    // В Node вёрстки нет, но ширину клетки целиком задаёт flex: 1 в ряду: она
    // равна у всех, если клеток в рядах поровну и стиль один. Размеры на
    // устройстве — снимки эмулятора (E:\lancible\tmp\m4stats-*.png).
    for (const [y, m] of MONTHS) {
      pin(y, m, 15);
      const q = await render(<StatsScreen navigation={nav()} />);
      const rows = q.getAllByTestId(/^stats-cal-row-/);
      expect(rows.length).toBe(monthCells(y, m).length);
      let ref = null;
      for (const row of rows) {
        expect(row.children).toHaveLength(7);
        for (const cell of row.children) {
          const { flex, flexGrow, flexBasis, width, minWidth, maxWidth } = flat(cell);
          const own = { flex, flexGrow, flexBasis, width, minWidth, maxWidth };
          if (!ref) ref = own;
          expect(own).toEqual(ref);
        }
      }
      expect(ref.flex).toBe(1);
      await q.unmount();
      jest.useRealTimers();
    }
  });

  test('ноябрь 2026 на экране: последний ряд — 30 ноября и шесть дней декабря', async () => {
    pin(2026, 10, 15);
    const q = await render(<StatsScreen navigation={nav()} />);
    expect(q.getByTestId('stats-cal-row-5').children.map((c) => c.props.testID)).toEqual([
      'stats-cell-2026-11-30', 'stats-cell-2026-12-01', 'stats-cell-2026-12-02', 'stats-cell-2026-12-03',
      'stats-cell-2026-12-04', 'stats-cell-2026-12-05', 'stats-cell-2026-12-06',
    ]);
  });
});

describe('свайп по периоду', () => {
  beforeEach(seed);
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  // Один жест с нулевой точки, без остановок: общие значения reanimated в
  // jest-подмене на каждой отрисовке заводятся заново.
  const swipe = (translationX, { translationY = 0, velocityX = 0 } = {}) => act(async () => {
    fireGestureHandler(getByGestureTestId('stats-swipe'), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { translationX: translationX / 2, translationY: translationY / 2 },
      { translationX, translationY },
      { state: State.END, translationX, translationY, velocityX },
    ]);
  });

  test('periodSwipeDir: порог, быстрая отмашка, вертикаль не листает', () => {
    // Палец ушёл влево — вперёд, вправо — назад.
    expect(periodSwipeDir(-PERIOD_SWIPE, 0, 0)).toBe(1);
    expect(periodSwipeDir(PERIOD_SWIPE, 0, 0)).toBe(-1);
    // Не дотянули и без скорости — остаёмся.
    expect(periodSwipeDir(-(PERIOD_SWIPE - 1), 0, 0)).toBe(0);
    expect(periodSwipeDir(PERIOD_SWIPE - 1, 0, 100)).toBe(0);
    // Короткая, но быстрая отмашка листает.
    expect(periodSwipeDir(-30, 0, -1500)).toBe(1);
    expect(periodSwipeDir(30, 0, 1500)).toBe(-1);
    // Совсем крошечный сдвиг скоростью не заменить.
    expect(periodSwipeDir(-5, 0, -4000)).toBe(0);
    // Ушли по вертикали больше, чем по горизонтали, — это прокрутка.
    expect(periodSwipeDir(-80, 120, -2000)).toBe(0);
    expect(periodSwipeDir(-80, -80.5, 0)).toBe(0);
  });

  test('жест включается после горизонтального порога и сдаётся на вертикальном', async () => {
    pin(2026, 8, 30);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    const cfg = getByGestureTestId('stats-swipe').config;
    expect([cfg.activeOffsetXStart, cfg.activeOffsetXEnd]).toEqual([-16, 16]);
    expect([cfg.failOffsetYStart, cfg.failOffsetYEnd]).toEqual([-12, 12]);
  });

  test('неделя: влево — следующая, вправо — предыдущая, как стрелки', async () => {
    pin(2026, 8, 30);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    expect(numsOf(q)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    const title = () => q.getByTestId('stats-period').children.join('');
    const start = title();

    await swipe(-120);
    expect(numsOf(q)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    const next = title();
    expect(next).not.toBe(start);

    await swipe(120);
    expect(numsOf(q)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(title()).toBe(start);

    // Стрелки приводят к тому же.
    await fireEvent.press(q.getByTestId('stats-next'));
    expect(title()).toBe(next);
    await fireEvent.press(q.getByTestId('stats-prev'));
    expect(title()).toBe(start);

    // Две недели подряд.
    await swipe(-90);
    await swipe(-90);
    expect(numsOf(q)).toEqual([12, 13, 14, 15, 16, 17, 18]);
  });

  test('неделя: выбранный день остаётся позади, как и при стрелке', async () => {
    pin(2026, 8, 30);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    await fireEvent.press(q.getByTestId('stats-bar-2026-10-02'));
    expect(q.queryByText(t('ru', 'calendar.for_week'))).toBeNull();
    await swipe(-120);
    q.getByText(t('ru', 'calendar.for_week'));
  });

  test('короткая оттяжка и вертикальный жест ничего не листают', async () => {
    pin(2026, 8, 30);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    const week = [28, 29, 30, 1, 2, 3, 4];
    await swipe(-(PERIOD_SWIPE - 10));
    expect(numsOf(q)).toEqual(week);
    await swipe(40);
    expect(numsOf(q)).toEqual(week);
    // Вертикаль с горизонтальной примесью — прокрутка экрана, не листание.
    await swipe(-90, { translationY: 200, velocityX: -1800 });
    expect(numsOf(q)).toEqual(week);
  });

  test('месяц: влево — следующий, вправо — предыдущий, как стрелки', async () => {
    pin(2026, 10, 15);
    const q = await render(<StatsScreen navigation={nav()} />);
    const title = () => q.getByTestId('stats-period').children.join('');
    const nov = title();
    q.getByTestId('stats-cell-2026-11-15');

    await swipe(-120);
    const dec = title();
    expect(dec).not.toBe(nov);
    q.getByTestId('stats-cell-2026-12-15');
    expect(q.queryByTestId('stats-cell-2026-11-15')).toBeNull();

    await swipe(120);
    expect(title()).toBe(nov);
    await swipe(120);
    q.getByTestId('stats-cell-2026-10-15');

    // Стрелки ведут туда же.
    await fireEvent.press(q.getByTestId('stats-next'));
    expect(title()).toBe(nov);
    await fireEvent.press(q.getByTestId('stats-next'));
    expect(title()).toBe(dec);

    // Короткая оттяжка месяц не меняет.
    await swipe(-(PERIOD_SWIPE - 10));
    expect(title()).toBe(dec);
  });

  test('«уменьшение движения»: период листается сразу, без анимации', async () => {
    pin(2026, 10, 15);
    jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    const q = await render(<StatsScreen navigation={nav()} />);
    await swipe(-120);
    q.getByTestId('stats-cell-2026-12-15');
    expect(q.queryByTestId('stats-cell-2026-11-15')).toBeNull();
  });

  test('на вкладке «Всё» свайпа нет', async () => {
    pin(2026, 10, 15);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'stats.all_time')));
    expect(() => getByGestureTestId('stats-swipe')).toThrow();
  });
});

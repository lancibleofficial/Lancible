// Жидкое движение телефона (lib/liquid.js, components/Liquid.js, DESIGN.md
// «Телефон» → «Жидкое движение»). Запуск: npm run test:mobile
//
// Reanimated в jest подменён своей подделкой: пружина и время сразу отдают
// конечное значение. Поверх неё здесь шпионы — видно, какая анимация
// запущена и с какими настройками, и чем всё кончилось. Где нужно увидеть
// середину пути, пружина на один вызов «замирает» на полдороге.
//
// 1. Панель вкладок: на одно нажатие — ровно одна анимация (переезд плашки
//    и толчок иконки); перерисовка, повторное нажатие на открытую вкладку и
//    первая отрисовка — ни одной. Раньше иконка подпрыгивала withSequence
//    из двух пружин и через ~1,4 с сжималась второй раз.
// 2. Кнопка старта, бейдж таймера в шапке задачи, плашка идущей задачи:
//    старт и стоп запускают налив/каплю и приходят к конечному виду;
//    «уменьшение движения» и iOS 26+ — без жидкости, сразу.
// 3. Сегментный переключатель: подложка едет к нажатой, на полпути она шире
//    конечной (растяжение), первая отрисовка и смена размеров — без анимации.
//    Размер один везде: высота segmentHeight, подпись segmentFontSize — 14,
//    ступень строк настроек (страница проекта — вкладки и отбор, «Цифры»). Скругление — в тон кнопкам:
//    дорожка buttonRadius, подложка и кнопки — концентрично (минус отступ).
import { Platform, StyleSheet } from 'react-native';
import { useState } from 'react';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import * as Reanimated from 'react-native-reanimated';
import MainTabs from '../src/navigation/MainTabs.android';
import MainTabBar from '../src/navigation/MainTabBar';
import TaskRow from '../src/components/TaskRow';
import TimerMiniPlayer, { MINI_PLAYER_HEIGHT } from '../src/components/TimerMiniPlayer';
import DetailHeader from '../src/components/DetailHeader';
import Segmented, { innerRadius } from '../src/components/Segmented';
import ProjectScreen from '../src/screens/ProjectScreen';
import StatsScreen from '../src/screens/StatsScreen';
import { useAppStore } from '../src/store/useAppStore';
import { LIQUID, TAB_POP_KICK, JELLY_KICK, liquidSpan, liquidMorph, pourFill, liquidAllowed, resetKicks, noteKick, freshKick } from '../src/lib/liquid';
import { spacing, fontSize, segmentHeight, segmentFontSize, radius, buttonRadius } from '../src/theme';
import { t } from '../src/lib/i18n';

// Своя поправка подделки: у неё useSharedValue каждый раз новый, и записанное
// в эффекте до следующей отрисовки не доживает. Настоящий — один на всю жизнь
// компонента; здесь так же, через useRef.
jest.mock('react-native-reanimated', () => {
  const m = jest.requireActual('react-native-reanimated/mock');
  const { useRef } = jest.requireActual('react');
  return {
    ...m,
    useSharedValue: (init) => {
      const ref = useRef(null);
      if (!ref.current) ref.current = m.useSharedValue(init);
      return ref.current;
    },
    withSpring: jest.fn((to, cfg, cb) => m.withSpring(to, cfg, cb)),
    withTiming: jest.fn((to, cfg, cb) => m.withTiming(to, cfg, cb)),
    withSequence: jest.fn((...steps) => m.withSequence(...steps)),
  };
});
// «Уменьшение движения» — подменой хука: проверяется ответ деталей на него,
// а не сам системный запрос (у него свой путь).
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));
// Экран деталей с редактором в навигаторе не нужен: у WebView нет нативной части.
jest.mock('../src/components/DocEditor', () => () => null);

const { withSpring, withTiming, withSequence } = Reanimated;
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const layout = (x, y, width, height) => ({ nativeEvent: { layout: { x, y, width, height } } });
const translateX = (style) => (style.transform || []).find((tr) => 'translateX' in tr).translateX;
const springs = (pred) => withSpring.mock.calls.filter(([to, cfg]) => pred(to, cfg || {}));
const timings = (pred) => withTiming.mock.calls.filter(([to, cfg]) => pred(to, cfg || {}));

/** iOS заданной версии на время теста. */
function fakeIos(version) {
  const os = jest.replaceProperty(Platform, 'OS', 'ios');
  const d = Object.getOwnPropertyDescriptor(Platform, 'Version');
  const v = d && d.get ? jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version) : jest.replaceProperty(Platform, 'Version', version);
  return () => { os.restore(); if (v.mockRestore) v.mockRestore(); else v.restore(); };
}

const task = (id, title) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: '2026-10-11T08:00:00.000Z',
});
const running = (taskId) => ({ taskId, startedAt: new Date(Date.now() - 65_000).toISOString(), heartbeatAt: new Date().toISOString() });

beforeEach(() => {
  mockReduced = false;
  resetKicks();
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [task('t1', 'Вёрстка'), task('t2', 'Правки')],
    activeTimer: null,
  });
  withSpring.mockClear();
  withTiming.mockClear();
  withSequence.mockClear();
});

// --- 1. Панель вкладок ------------------------------------------------------

describe('панель вкладок: анимация — только в момент выбора, один раз', () => {
  const routes = ['Projects', 'Tasks', 'Chat', 'Stats', 'Menu'].map((name) => ({ key: name, name }));
  const props = (index) => ({
    state: { index, routes },
    descriptors: Object.fromEntries(routes.map((r) => [r.key, { options: { tabBarLabel: r.name } }])),
    navigation: { navigate: jest.fn() },
  });
  const glides = () => springs((to, cfg) => cfg === LIQUID.glide);
  const pops = () => springs((to, cfg) => cfg.velocity === TAB_POP_KICK);
  /** Место плашки под вкладкой i на панели шириной 390. */
  const slotX = (i) => i * 78 + (78 - 46) / 2;

  test('первая отрисовка и замер ширины — плашка стоит под открытой, без анимации', async () => {
    const s = await render(<MainTabBar {...props(1)} />);
    await fireEvent(s.getByTestId('tab-bar'), 'layout', layout(0, 0, 390, 60));
    await s.rerender(<MainTabBar {...props(1)} />);
    expect(glides()).toHaveLength(0);
    expect(pops()).toHaveLength(0);
    expect(withSequence).not.toHaveBeenCalled();
    const plate = flat(s.getByTestId('tab-bar-plate'));
    expect(translateX(plate)).toBe(slotX(1));
    expect(plate).toMatchObject({ width: 46, height: 28, top: spacing.sm, opacity: 1 });
  });

  test('смена вкладки — один переезд и один толчок; перерисовка без смены — ничего', async () => {
    const s = await render(<MainTabBar {...props(0)} />);
    await fireEvent(s.getByTestId('tab-bar'), 'layout', layout(0, 0, 390, 60));
    await s.rerender(<MainTabBar {...props(2)} />);
    expect(glides()).toHaveLength(1);
    expect(pops()).toHaveLength(1);
    // Ни одной цепочки шагов: второй шаг ждал бы успокоения первой пружины.
    expect(withSequence).not.toHaveBeenCalled();
    // Та же вкладка, новая отрисовка (тикнул таймер, сменился язык) — ничего.
    await s.rerender(<MainTabBar {...props(2)} />);
    await s.rerender(<MainTabBar {...props(2)} />);
    expect(glides()).toHaveLength(1);
    expect(pops()).toHaveLength(1);
    // Пришла под выбранную.
    expect(translateX(flat(s.getByTestId('tab-bar-plate')))).toBeCloseTo(slotX(2), 5);
  });

  test('настоящий навигатор: нажатие — одна анимация, и через полторы секунды второй нет', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    const screen = await render(<NavigationContainer><MainTabs /></NavigationContainer>);
    await fireEvent(screen.getByTestId('tab-bar'), 'layout', layout(0, 0, 390, 60));
    expect(glides()).toHaveLength(0);
    expect(pops()).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: t('ru', 'ai.tab') }));
    await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
    expect(glides()).toHaveLength(1);
    expect(pops()).toHaveLength(1);

    // Нажатие на уже открытую вкладку — не выбор: ничего не играет.
    await fireEvent.press(screen.getByRole('button', { name: t('ru', 'ai.tab') }));
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(glides()).toHaveLength(1);
    expect(pops()).toHaveLength(1);
    expect(withSequence).not.toHaveBeenCalled();
    await screen.unmount();
    os.restore();
  });

  test('«уменьшение движения» — плашка переставляется сразу, иконка не прыгает', async () => {
    mockReduced = true;
    const s = await render(<MainTabBar {...props(0)} />);
    await fireEvent(s.getByTestId('tab-bar'), 'layout', layout(0, 0, 390, 60));
    await s.rerender(<MainTabBar {...props(3)} />);
    await s.rerender(<MainTabBar {...props(3)} />);
    expect(glides()).toHaveLength(0);
    expect(pops()).toHaveLength(0);
    expect(translateX(flat(s.getByTestId('tab-bar-plate')))).toBe(slotX(3));
  });
});

// --- 2. Кнопка старта, бейдж, плашка идущей задачи ---------------------------

describe('кнопка старта: акцент наливается и стекает', () => {
  const row = () => <TaskRow task={useAppStore.getState().tasks[0]} onPress={() => {}} />;
  const pours = () => timings((to, cfg) => cfg === LIQUID.pour);
  const unpours = () => timings((to, cfg) => cfg === LIQUID.unpour);
  const jelly = () => springs((to, cfg) => Math.abs(cfg.velocity || 0) > 0 && cfg.stiffness === LIQUID.jelly.stiffness);
  const popsIcon = () => springs((to, cfg) => cfg === LIQUID.pop);
  const fillOf = (s) => flat(s.getByTestId('liquid-fill'));
  const tyOf = (style) => style.transform.find((tr) => 'translateY' in tr).translateY;

  test('стоит — пусто; старт — налив, желе и выпрыгнувший «■»; налито до конца', async () => {
    const s = await render(row());
    // Первая отрисовка — без движения: акцента нет.
    expect(fillOf(s).opacity).toBe(0);
    expect(pours()).toHaveLength(0);

    await fireEvent.press(s.getByLabelText(t('ru', 'timer.start')));
    expect(useAppStore.getState().activeTimer.taskId).toBe('t1');
    expect(pours()).toHaveLength(1);
    expect(pours()[0][0]).toBe(1);
    expect(jelly()).toHaveLength(2); // по ширине и по высоте, в разные стороны
    expect(jelly().map(([, cfg]) => Math.sign(cfg.velocity)).sort()).toEqual([-1, 1]);
    expect(popsIcon()).toHaveLength(1);
    expect(withSequence).not.toHaveBeenCalled();

    // Конечный вид: квадрат акцента накрыл кнопку, значок — «стоп».
    await s.rerender(row());
    expect(fillOf(s).opacity).toBe(1);
    expect(tyOf(fillOf(s))).toBe(pourFill(1, 38).ty);
    s.getByLabelText(t('ru', 'timer.stop'));
  });

  test('стоп — акцент стекает обратно', async () => {
    useAppStore.setState({ activeTimer: running('t1') });
    const s = await render(row());
    expect(fillOf(s).opacity).toBe(1);
    await fireEvent.press(s.getByLabelText(t('ru', 'timer.stop')));
    expect(useAppStore.getState().activeTimer).toBeNull();
    expect(unpours()).toHaveLength(1);
    expect(unpours()[0][0]).toBe(0);
    await s.rerender(row());
    expect(fillOf(s).opacity).toBe(0);
    s.getByLabelText(t('ru', 'timer.start'));
  });

  test('перерисованная сразу после старта кнопка подхватывает налив, а не встаёт налитой', async () => {
    noteKick('t1', true);
    expect(freshKick('t1', true)).toBe(true);
    useAppStore.setState({ activeTimer: running('t1') });
    await render(row());
    expect(pours()).toHaveLength(1);
  });

  test('«уменьшение движения» — сразу налито и сразу пусто, без анимаций', async () => {
    mockReduced = true;
    const s = await render(row());
    await fireEvent.press(s.getByLabelText(t('ru', 'timer.start')));
    await s.rerender(row());
    expect(fillOf(s).opacity).toBe(1);
    await fireEvent.press(s.getByLabelText(t('ru', 'timer.stop')));
    await s.rerender(row());
    expect(fillOf(s).opacity).toBe(0);
    expect(withTiming).not.toHaveBeenCalled();
    expect(withSpring).not.toHaveBeenCalled();
  });

  test('iOS 26+ — без жидкости: кнопка переключается сразу', async () => {
    const restore = fakeIos('26.0');
    expect(liquidAllowed()).toBe(false);
    const s = await render(row());
    await fireEvent.press(s.getByLabelText(t('ru', 'timer.start')));
    await s.rerender(row());
    expect(fillOf(s).opacity).toBe(1);
    expect(withTiming).not.toHaveBeenCalled();
    expect(withSpring).not.toHaveBeenCalled();
    restore();
  });

  test('iOS ниже 26 и Android — с жидкостью', () => {
    const restore = fakeIos('18.5');
    expect(liquidAllowed()).toBe(true);
    restore();
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    expect(liquidAllowed()).toBe(true);
    os.restore();
  });
});

describe('бейдж таймера в шапке задачи: капля набухает в плашку и стекает', () => {
  const header = (on) => <DetailHeader title="Сайт" color="#87ff65" running={on} runSince={on ? Date.now() - 65_000 : null} onBack={() => {}} backLabel="Назад" />;
  const swells = () => springs((to, cfg) => cfg === LIQUID.swell);
  const drains = () => timings((to, cfg) => cfg === LIQUID.drain);

  test('появился — капля пружиной до плашки; ушёл — стекла и пропала', async () => {
    const s = await render(header(false));
    expect(s.queryByTestId('run-badge')).toBeNull();
    await s.rerender(header(true));
    expect(swells()).toHaveLength(1);
    expect(swells()[0][0]).toBe(1);
    // Конечный вид — плашка своей высоты и ширины, содержимое видно.
    await s.rerender(header(true));
    const plate = flat(s.getByTestId('run-badge-plate'));
    expect(plate.height).toBe(28);
    expect(plate.width).toBeGreaterThan(28);
    expect(plate.borderRadius).toBe(14);
    s.getByText('00:01:05');

    await s.rerender(header(false));
    expect(drains()).toHaveLength(1);
    expect(drains()[0][0]).toBe(0);
    await s.rerender(header(false));
    expect(s.queryByTestId('run-badge')).toBeNull();
  });

  test('открыли страницу с идущим таймером — плашка стоит сразу, без капли', async () => {
    const s = await render(header(true));
    s.getByTestId('run-badge');
    expect(swells()).toHaveLength(0);
  });

  test('«уменьшение движения» — плашка есть или нет сразу', async () => {
    mockReduced = true;
    const s = await render(header(false));
    await s.rerender(header(true));
    s.getByText('00:01:05');
    expect(s.queryByTestId('run-badge-plate')).toBeNull();
    await s.rerender(header(false));
    expect(s.queryByText('00:01:05')).toBeNull();
    // Мерцает только точка «идёт» (Pulse) — это не капля.
    expect(swells()).toHaveLength(0);
    expect(drains()).toHaveLength(0);
  });

  test('iOS 26+ — без жидкости', async () => {
    const restore = fakeIos('26.1');
    const s = await render(header(false));
    await s.rerender(header(true));
    await s.rerender(header(false));
    expect(swells()).toHaveLength(0);
    expect(drains()).toHaveLength(0);
    restore();
  });
});

describe('плашка идущей задачи: вытягивается каплей из края и стягивается обратно', () => {
  const swells = () => springs((to, cfg) => cfg === LIQUID.swell);
  const drains = () => timings((to, cfg) => cfg === LIQUID.drain);
  const mini = () => <TimerMiniPlayer onOpen={() => {}} />;

  test('старт — капля в плашку во всю ширину; стоп — обратно в каплю и нет её', async () => {
    const s = await render(mini());
    expect(s.toJSON()).toBeNull();
    await act(() => useAppStore.setState({ activeTimer: running('t1') }));
    expect(swells()).toHaveLength(1);
    await s.rerender(mini());
    expect(flat(s.getByTestId('mini-player-plate'))).toMatchObject({ width: '100%', height: MINI_PLAYER_HEIGHT, borderRadius: 18 });
    s.getByText('Вёрстка');

    await act(() => useAppStore.setState({ activeTimer: null }));
    expect(drains()).toHaveLength(1);
    await s.rerender(mini());
    expect(s.toJSON()).toBeNull();
  });

  test('пока плашка стекает, место над панелью вкладок ещё её — страница не прыгает', async () => {
    const routes = ['Projects', 'Tasks', 'Chat', 'Stats', 'Menu'].map((name) => ({ key: name, name }));
    const bar = () => (
      <MainTabBar
        state={{ index: 0, routes }}
        descriptors={Object.fromEntries(routes.map((r) => [r.key, { options: { tabBarLabel: r.name } }]))}
        navigation={{ navigate: jest.fn() }}
      />
    );
    useAppStore.setState({ activeTimer: running('t1') });
    const s = await render(bar());
    const lift = -(MINI_PLAYER_HEIGHT + spacing.sm);
    expect(flat(s.toJSON()).marginTop).toBe(lift);
    // Стекание «в пути»: конец анимации ещё не наступил.
    let finish;
    withTiming.mockImplementationOnce((to, cfg, cb) => { finish = cb; return 0.5; });
    await act(() => useAppStore.setState({ activeTimer: null }));
    await s.rerender(bar());
    expect(flat(s.toJSON()).marginTop).toBe(lift);
    s.getByText('Вёрстка');
    // Стекла — место отдано странице.
    await act(() => finish(true));
    expect(flat(s.toJSON()).marginTop || 0).toBe(0);
    expect(s.queryByText('Вёрстка')).toBeNull();
  });

  test('«уменьшение движения» и iOS 26+ — сразу', async () => {
    mockReduced = true;
    const s = await render(mini());
    await act(() => useAppStore.setState({ activeTimer: running('t1') }));
    s.getByText('Вёрстка');
    await act(() => useAppStore.setState({ activeTimer: null }));
    expect(s.toJSON()).toBeNull();
    mockReduced = false;
    const restore = fakeIos('26.0');
    await act(() => useAppStore.setState({ activeTimer: running('t1') }));
    await act(() => useAppStore.setState({ activeTimer: null }));
    expect(swells()).toHaveLength(0);
    expect(drains()).toHaveLength(0);
    restore();
  });
});

// --- 3. Сегментный переключатель --------------------------------------------

describe('сегментный переключатель: подложка переезжает жидко', () => {
  const ITEMS = [{ key: 'a', label: 'Неделя' }, { key: 'b', label: 'Месяц' }, { key: 'c', label: 'Всё' }];
  const RECTS = { a: [3, 3, 100, 30], b: [105, 3, 100, 30], c: [207, 3, 100, 30] };
  function Host({ initial = 'a' }) {
    const [v, setV] = useState(initial);
    return <Segmented items={ITEMS} value={v} onChange={setV} testID="seg" />;
  }
  const glides = () => springs((to, cfg) => cfg === LIQUID.glide);
  const pill = (s) => flat(s.getByTestId('seg-pill'));
  async function mount() {
    const s = await render(<Host />);
    const buttons = within(s.getByTestId('seg')).getAllByRole('tab');
    for (const [i, key] of ['a', 'b', 'c'].entries()) await fireEvent(buttons[i], 'layout', layout(...RECTS[key]));
    await s.rerender(<Host />);
    return { s, buttons };
  }

  test('путь: на середине подложка шире конечной, в конце — ровно на месте, за концом — поджата', () => {
    const a = { x: 3, w: 100 };
    const c = { x: 207, w: 100 };
    const mid = liquidSpan(a, c, 0.5);
    expect(mid.w).toBeGreaterThan(c.w);
    expect(mid.sy).toBeLessThan(1); // вытянутая — тоньше
    expect(mid.x).toBeGreaterThan(a.x);
    expect(mid.x + mid.w).toBeLessThan(c.x + c.w);
    const end = liquidSpan(a, c, 1);
    expect(end.x).toBeCloseTo(c.x, 6);
    expect(end.w).toBeCloseTo(c.w, 6);
    expect(end.sy).toBeCloseTo(1, 6);
    const over = liquidSpan(a, c, 1.04);
    expect(over.w).toBeLessThan(c.w);
    // Ведущий край упёрся в цель, наезжает хвост: за дорожку подложка не вылезает.
    expect(over.x + over.w).toBeCloseTo(c.x + c.w, 6);
    expect(liquidSpan(c, a, 1.04).x).toBeCloseTo(a.x, 6);
    // Назад — так же, ведущий край левый.
    const back = liquidSpan(c, a, 0.5);
    expect(back.w).toBeGreaterThan(a.w);
    expect(back.x).toBeLessThan(c.x);
  });

  test('первая отрисовка — подложка под выбранной, без анимации', async () => {
    const { s } = await mount();
    expect(glides()).toHaveLength(0);
    expect(translateX(pill(s))).toBe(3);
    expect(pill(s)).toMatchObject({ width: 100, height: 30, top: 3, opacity: 1 });
  });

  test('нажатие — подложка едет к нажатой: в пути шире конечной, приходит точно под неё', async () => {
    const { s, buttons } = await mount();
    // Пружина «замерла» на полпути.
    withSpring.mockImplementationOnce(() => 0.5);
    await fireEvent.press(buttons[2]);
    await s.rerender(<Host />);
    expect(glides()).toHaveLength(1);
    const midway = pill(s);
    expect(midway.width).toBeGreaterThan(100);
    expect(translateX(midway)).toBeGreaterThan(3);
    expect(translateX(midway)).toBeLessThan(207);
    expect(buttons[2].props.accessibilityState).toMatchObject({ selected: true });

    // И обратно, уже без заморозки: в конце — под нажатой.
    await fireEvent.press(buttons[1]);
    await s.rerender(<Host />);
    expect(glides()).toHaveLength(2);
    expect(translateX(pill(s))).toBeCloseTo(105, 6);
    expect(pill(s).width).toBeCloseTo(100, 6);
  });

  test('смена размеров (язык, ширина) — встаёт на место сразу', async () => {
    const { s, buttons } = await mount();
    await fireEvent(buttons[0], 'layout', layout(3, 3, 120, 30));
    await s.rerender(<Host />);
    expect(glides()).toHaveLength(0);
    expect(pill(s).width).toBe(120);
  });

  test('«уменьшение движения» — подложка переставляется сразу', async () => {
    mockReduced = true;
    const { s, buttons } = await mount();
    await fireEvent.press(buttons[2]);
    await s.rerender(<Host />);
    expect(glides()).toHaveLength(0);
    expect(translateX(pill(s))).toBe(207);
  });
});

describe('сегментный переключатель: один размер везде, подпись — обычный текст', () => {
  /** Подписи кнопок переключателя и сама дорожка. */
  const parts = (track) => ({
    track: flat(track),
    labels: within(track).getAllByText(/./).map(flat),
  });
  const expectSize = (track) => {
    const { track: box, labels } = parts(track);
    expect(box.height).toBe(segmentHeight);
    expect(labels.length).toBeGreaterThan(1);
    for (const l of labels) expect(l.fontSize).toBe(segmentFontSize);
  };

  test('сам по себе: высота segmentHeight, подпись segmentFontSize (14, а не 16), кнопки делят строку поровну', async () => {
    const s = await render(<Segmented items={[{ key: 'a', label: 'Неделя' }, { key: 'b', label: 'Месяц' }]} value="a" onChange={() => {}} testID="seg" />);
    expectSize(s.getByTestId('seg'));
    expect(segmentHeight).toBeGreaterThanOrEqual(44);
    // 12 октября 2026: подпись на ступень мельче текста интерфейса — 14, как
    // названия строк настроек; не мелочь 12.5, как до 11 октября.
    expect(segmentFontSize).toBe(14);
    expect(segmentFontSize).toBe(fontSize.sm);
    expect(segmentFontSize).toBeLessThan(fontSize.md);
    expect(segmentFontSize).toBeGreaterThan(12.5);
    for (const b of within(s.getByTestId('seg')).getAllByRole('tab')) expect(flat(b).flex).toBe(1);
  });

  test('страница проекта: вкладки и отбор «Все · Активные · Готово» — того же размера', async () => {
    const nav = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}), getState: () => ({ routes: [], index: 0 }) };
    const s = await render(<ProjectScreen navigation={nav} route={{ params: { projectId: 'p1' } }} />);
    expectSize(s.getByTestId('project-tabs'));
    expectSize(s.getByTestId('project-filter-seg'));
  });

  test('«Цифры»: режимы того же размера', async () => {
    const nav = { navigate: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}) };
    const s = await render(<StatsScreen navigation={nav} />);
    expectSize(s.getByTestId('stats-modes'));
  });
});

describe('сегментный переключатель: скругление в тон кнопкам, внутри — концентрично', () => {
  test('дорожка — buttonRadius, подложка и кнопки — buttonRadius минус отступ', async () => {
    const s = await render(<Segmented items={[{ key: 'a', label: 'Неделя' }, { key: 'b', label: 'Месяц' }]} value="a" onChange={() => {}} testID="seg" />);
    const track = flat(s.getByTestId('seg'));
    expect(track.borderRadius).toBe(buttonRadius);
    const inner = buttonRadius - track.padding;
    expect(inner).toBeGreaterThan(radius.sm); // круглее, чем было (8)
    expect(flat(s.getByTestId('seg-pill')).borderRadius).toBe(inner);
    for (const b of within(s.getByTestId('seg')).getAllByRole('tab')) expect(flat(b).borderRadius).toBe(inner);
  });

  test('место задало дорожке своё скругление и рамку — подложка по тому же правилу', () => {
    expect(innerRadius(undefined)).toBe(buttonRadius - 3);
    expect(innerRadius({ borderRadius: 10, padding: 3, borderWidth: 1 })).toBe(6);
    expect(innerRadius([{ borderRadius: 14 }, { padding: 2 }])).toBe(12);
    expect(innerRadius({ borderRadius: 2, padding: 3 })).toBe(0);
  });

  test('«Цифры»: режимы — со скруглением кнопок', async () => {
    const nav = { navigate: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => () => {}) };
    const s = await render(<StatsScreen navigation={nav} />);
    expect(flat(s.getByTestId('stats-modes')).borderRadius).toBe(buttonRadius);
    expect(flat(s.getByTestId('stats-modes-pill')).borderRadius).toBe(buttonRadius - 3);
  });
});

describe('капля → плашка: форма по пути', () => {
  test('ничего — круглая капля — тянется тоньше — плашка; содержимое проявляется в конце', () => {
    expect(liquidMorph(0, 300, 56, 18)).toMatchObject({ w: 0, h: 0, content: 0 });
    const drop = liquidMorph(0.32, 300, 56, 18);
    expect(drop.w).toBeCloseTo(56, 6);
    expect(drop.r).toBeCloseTo(28, 6);
    const pull = liquidMorph(0.66, 300, 56, 18);
    expect(pull.w).toBeGreaterThan(56);
    expect(pull.w).toBeLessThan(300);
    expect(pull.h).toBeLessThan(56);
    expect(liquidMorph(1, 300, 56, 18)).toEqual({ w: 300, h: 56, r: 18, content: 1 });
    const over = liquidMorph(1.05, 300, 56, 18);
    expect(over.w).toBeGreaterThan(300);
    expect(over.h).toBeLessThan(56);
  });

  test('налив: в начале квадрат ниже кнопки, в конце накрывает её целиком', () => {
    const size = 38;
    const side = size * 1.9;
    expect(pourFill(0, size).ty).toBeGreaterThanOrEqual(size);
    const full = pourFill(1, size);
    expect(full.ty).toBeLessThanOrEqual(0);
    expect(full.ty + side).toBeGreaterThanOrEqual(size);
    expect(JELLY_KICK).toBeGreaterThan(0);
  });
});

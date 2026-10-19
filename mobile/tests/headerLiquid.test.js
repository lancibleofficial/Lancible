// Жидкое движение шапки (lib/headerLiquid.js, components/HeaderLiquid.js,
// DESIGN.md «Телефон» → «Жидкое движение» → «Шапка»). Запуск: npm run test:mobile
//
// Reanimated в jest подменён подделкой: пружина и время сразу отдают конечное
// значение. Поверх неё — шпионы: видно, какая анимация запущена и с какими
// настройками. Где нужно увидеть середину пути, пружина «замирает» на полдороге.
//
// 1. Нажатие круглых кнопок шапки (LiquidPress): сплюснуть, пока палец на
//    кнопке, отпустить одной пружиной с толчком (~0,2 с). Кнопка шапки вкладки,
//    «назад» и кнопка шапки задачи — все на нём.
// 2. Смена вкладки на настоящем навигаторе Android: название новой вкладки
//    проявляется каплей (при первой отрисовке и возврате с деталей — сразу),
//    лишние кнопки стекают в каплю, недостающие набухают, общие стоят на месте
//    тем же экземпляром.
// 3. Числа и формы: капля кнопки, сверка мест кнопок.
// 4. «Уменьшение движения» и iOS 26+ — сразу.
import { Platform, StyleSheet } from 'react-native';
import { createElement } from 'react';
import { render, fireEvent, act, within, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import * as Reanimated from 'react-native-reanimated';
import MainTabs from '../src/navigation/MainTabs.android';
import AppHeader from '../src/components/AppHeader';
import BackButton from '../src/components/BackButton';
import { DetailButton } from '../src/components/DetailHeader';
import { HeaderButton } from '../src/components/TabHeader';
import { LiquidPress, HeaderActions } from '../src/components/HeaderLiquid';
import { useAppStore } from '../src/store/useAppStore';
import { HEADER_LIQUID, PRESS_SQUASH, PRESS_KICK, dropIn, buttonDrop, slotSig, reconcileSlots } from '../src/lib/headerLiquid';
import { LIQUID, DROP, liquidAllowed } from '../src/lib/liquid';
import { spacing } from '../src/theme';
import { t } from '../src/lib/i18n';

// Своя поправка подделки: у неё useSharedValue каждый раз новый, и записанное
// в эффекте до следующей отрисовки не доживает (так же, как в liquid.test.js).
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
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));
jest.mock('../src/components/DocEditor', () => () => null);

const { withSpring, withTiming, withSequence } = Reanimated;
// Что подделка делала сама: тесты, которые «замораживают» пружину на полпути,
// возвращают её после себя (beforeEach).
const springImpl = withSpring.getMockImplementation();
const timingImpl = withTiming.getMockImplementation();
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const springs = (pred) => withSpring.mock.calls.filter(([to, cfg]) => pred(to, cfg || {}));
const timings = (pred) => withTiming.mock.calls.filter(([to, cfg]) => pred(to, cfg || {}));
const swells = () => springs((to, cfg) => cfg === LIQUID.swell);
const drains = () => timings((to, cfg) => cfg === HEADER_LIQUID.drain);
const titles = () => timings((to, cfg) => cfg === HEADER_LIQUID.title);
const squashes = () => timings((to, cfg) => cfg === HEADER_LIQUID.squash);
const releases = () => springs((to, cfg) => cfg.damping === HEADER_LIQUID.release.damping && cfg.stiffness === HEADER_LIQUID.release.stiffness);
const scaleOf = (style, axis) => (style.transform || []).find((tr) => axis in tr)[axis];

/** iOS заданной версии на время теста. */
function fakeIos(version) {
  const os = jest.replaceProperty(Platform, 'OS', 'ios');
  const d = Object.getOwnPropertyDescriptor(Platform, 'Version');
  const v = d && d.get ? jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version) : jest.replaceProperty(Platform, 'Version', version);
  return () => { os.restore(); if (v.mockRestore) v.mockRestore(); else v.restore(); };
}

const task = (id, title) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(),
});

let os;
beforeEach(() => {
  mockReduced = false;
  os = jest.replaceProperty(Platform, 'OS', 'android');
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [task('t1', 'Вёрстка'), task('t2', 'Правки')],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
  withSpring.mockClear();
  withTiming.mockClear();
  withSequence.mockClear();
  withSpring.mockImplementation(springImpl);
  withTiming.mockImplementation(timingImpl);
});
afterEach(() => os.restore());

const BACK = t('ru', 'common.back');
const noop = () => {};
const tabButton = (screen, key) => screen.getByRole('button', { name: t('ru', key) });
const btn = (scope, key) => scope.getByRole('button', { name: t('ru', key) });
const waitBtn = (scope, key) => scope.findByRole('button', { name: t('ru', key) });
/** «Задачи» построены: у шапки появилось число открытых (две). */
const tasksBuilt = (header) => waitFor(() => within(header).getByText('2'));

async function openApp() {
  const nav = createNavigationContainerRef();
  const screen = await render(<NavigationContainer ref={nav}><MainTabs /></NavigationContainer>);
  const header = screen.getByTestId('root-header');
  await waitBtn(within(header), 'search.placeholder');
  return { screen, header, nav };
}

// --- 1. Нажатие ----------------------------------------------------------------

describe('нажатие кнопок шапки: сплюснуть и отпустить с толчком', () => {
  const press = async (button) => { await fireEvent(button, 'pressIn'); await fireEvent(button, 'pressOut'); };

  test('палец лёг — кнопка сплющивается (шире и ниже) за короткое время; кнопка не сдвигается, только форма', async () => {
    const s = await render(<HeaderButton icon="search" label="Поиск" onPress={noop} />);
    const b = s.getByLabelText('Поиск');
    // В покое — единица по обеим осям; сжатия одним числом (Tap) тут нет.
    expect(scaleOf(flat(b), 'scaleX')).toBe(1);
    expect(scaleOf(flat(b), 'scaleY')).toBe(1);
    expect((flat(b).transform || []).some((tr) => 'scale' in tr)).toBe(false);

    await fireEvent(b, 'pressIn');
    expect(squashes().map(([to]) => to).sort()).toEqual([PRESS_SQUASH.y, PRESS_SQUASH.x].sort());
    expect(PRESS_SQUASH.x).toBeGreaterThan(1);
    expect(PRESS_SQUASH.y).toBeLessThan(1);
    expect(HEADER_LIQUID.squash.duration).toBeLessThanOrEqual(120);
    expect(releases()).toHaveLength(0);
  });

  test('палец ушёл — одна пружина на ось, толчком в разные стороны, и конечное значение — единица', async () => {
    const s = await render(<HeaderButton icon="search" label="Поиск" onPress={noop} />);
    await press(s.getByLabelText('Поиск'));
    expect(releases()).toHaveLength(2);
    expect(releases().map(([to]) => to)).toEqual([1, 1]);
    expect(releases().map(([, cfg]) => Math.sign(cfg.velocity)).sort()).toEqual([-1, 1]);
    expect(Math.abs(releases()[0][1].velocity)).toBe(PRESS_KICK);
    // Одна пружина на движение: цепочки шагов нет.
    expect(withSequence).not.toHaveBeenCalled();
  });

  test('пружина отпускания: подскок есть (ζ < 1), к 0,15–0,22 с стоит', () => {
    const { damping: c, stiffness: k, mass: m } = HEADER_LIQUID.release;
    const zeta = c / (2 * Math.sqrt(k * m));
    const settleMs = (4 / (zeta * Math.sqrt(k / m))) * 1000;
    expect(zeta).toBeLessThan(1);
    expect(settleMs).toBeGreaterThanOrEqual(150);
    expect(settleMs).toBeLessThanOrEqual(220);
  });

  test('нажатие по-прежнему нажимает: onPress зовётся, пока кнопка играет', async () => {
    const onPress = jest.fn();
    const s = await render(<HeaderButton icon="search" label="Поиск" onPress={onPress} />);
    await press(s.getByLabelText('Поиск'));
    await fireEvent.press(s.getByLabelText('Поиск'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('на нём все круглые кнопки шапок: кнопка вкладки, «назад» стека, «назад» и кнопка шапки задачи', async () => {
    const s = await render(
      <>
        <AppHeader navigation={{ goBack: noop }} route={{ name: 'Tags' }} options={{ title: 'Теги', headerRight: () => <DetailButton icon="check" label="Готово" onPress={noop} /> }} back={{ title: '' }} />
        <BackButton onPress={noop} label="Закрыть" />
        <HeaderButton icon="search" label="Поиск" onPress={noop} />
      </>,
    );
    for (const label of [BACK, 'Готово', 'Закрыть', 'Поиск']) {
      withTiming.mockClear();
      withSpring.mockClear();
      await press(s.getByLabelText(label));
      expect({ label, squashed: squashes().length, released: releases().length }).toEqual({ label, squashed: 2, released: 2 });
    }
  });

  test('LiquidPress принимает всё, что принимает Pressable: hitSlop, свои onPressIn и onPressOut; выключенный не нажимается', async () => {
    const [onPressIn, onPressOut] = [jest.fn(), jest.fn()];
    const s = await render(<LiquidPress testID="lp" onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={8}><></></LiquidPress>);
    const node = s.getByTestId('lp');
    expect(node.props.hitSlop).toBe(8);
    await press(node);
    expect([onPressIn.mock.calls.length, onPressOut.mock.calls.length]).toEqual([1, 1]);
    expect(squashes()).toHaveLength(2);

    withTiming.mockClear();
    const onPress = jest.fn();
    const off = await render(<LiquidPress testID="off" disabled onPress={onPress}><></></LiquidPress>);
    await fireEvent.press(off.getByTestId('off'));
    await fireEvent(off.getByTestId('off'), 'pressIn');
    expect(onPress).not.toHaveBeenCalled();
    expect(squashes()).toHaveLength(0);
  });

  test('«уменьшение движения» — кнопка не сплющивается и не прыгает, нажимается как обычно', async () => {
    mockReduced = true;
    const onPress = jest.fn();
    const s = await render(<HeaderButton icon="search" label="Поиск" onPress={onPress} />);
    await press(s.getByLabelText('Поиск'));
    await fireEvent.press(s.getByLabelText('Поиск'));
    expect(withTiming).not.toHaveBeenCalled();
    expect(withSpring).not.toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('iOS 26+ — без жидкости: кнопка там нативная, своя не играет', async () => {
    const restore = fakeIos('26.0');
    expect(liquidAllowed()).toBe(false);
    const s = await render(<HeaderButton icon="search" label="Поиск" onPress={noop} />);
    await press(s.getByLabelText('Поиск'));
    expect(withTiming).not.toHaveBeenCalled();
    expect(withSpring).not.toHaveBeenCalled();
    restore();
  });
});

// --- 2. Смена вкладки ------------------------------------------------------------

describe('смена вкладки: название каплей, кнопки по месту', () => {
  test('первая сборка экрана — кнопки набухают из капли; название при первой отрисовке стоит сразу', async () => {
    const { header } = await openApp();
    // Лупа и колокольчик «Проектов» пришли вместе с экраном — две капли.
    await waitFor(() => expect(swells()).toHaveLength(2));
    expect(drains()).toHaveLength(0);
    expect(titles()).toHaveLength(0);
    // В покое каждая — своя ширина, масштаб 1, видна.
    await waitFor(() => expect(within(header).getAllByTestId('header-slot').map((slot) => flat(slot).width)).toEqual([36, 36]));
    const slots = within(header).getAllByTestId('header-slot');
    expect(slots).toHaveLength(2);
    for (const slot of slots) expect(flat(slot)).toMatchObject({ width: 36, height: 36 });
    for (const body of within(header).getAllByTestId('header-slot-body')) {
      expect(flat(body).opacity).toBe(1);
      expect(scaleOf(flat(body), 'scaleX')).toBe(1);
      expect(scaleOf(flat(body), 'scaleY')).toBe(1);
    }
  });

  test('«Проекты» → «Задачи»: общие кнопки стоят на месте — те же экземпляры, ничего не набухает и не стекает; название проявляется каплей', async () => {
    const { screen, header } = await openApp();
    const bell = within(header).getByTestId('notif-bell');
    const slots = within(header).getAllByTestId('header-slot');
    const swollen = swells().length;

    await fireEvent.press(tabButton(screen, 'nav.tasks'));
    await tasksBuilt(header);
    await waitFor(() => expect(titles()).toHaveLength(1));
    // Те же места и те же кнопки: не пересоздавались (колокольчик не теряет звон).
    expect(within(header).getByTestId('notif-bell')).toBe(bell);
    const after = within(header).getAllByTestId('header-slot');
    expect(after).toHaveLength(2);
    after.forEach((slot, i) => expect(slot).toBe(slots[i]));
    expect(swells()).toHaveLength(swollen);
    expect(drains()).toHaveLength(0);
    // Название новой вкладки — каплей: одно проявление, за ~0,2 с.
    expect(titles()).toHaveLength(1);
    expect(titles()[0][0]).toBe(1);
    expect(HEADER_LIQUID.title.duration).toBeLessThanOrEqual(220);
    within(header).getByText(t('ru', 'nav.tasks'));
    expect(within(header).queryByText(t('ru', 'nav.projects'))).toBeNull();
  });

  test('«Проекты» → «Цифры»: лупа и колокольчик стекают в каплю, две свои кнопки набухают', async () => {
    const { screen, header } = await openApp();
    const swollen = swells().length;

    await fireEvent.press(tabButton(screen, 'nav.stats'));
    await waitBtn(within(header), 'menu.export_excel');
    await waitFor(() => expect(swells()).toHaveLength(swollen + 2));
    expect(drains()).toHaveLength(2);
    expect(drains().map(([to]) => to)).toEqual([0, 0]);
    // Стекли — их нет; пришедшие стоят.
    expect(within(header).queryByRole('button', { name: t('ru', 'search.placeholder') })).toBeNull();
    expect(within(header).queryByTestId('notif-bell')).toBeNull();
    btn(within(header), 'filter.project');
    expect(within(header).getAllByTestId('header-slot')).toHaveLength(2);
  });

  test('«Проекты» → «Меню» → «Задачи»: лупа и колокольчик везде одни и те же — ничего не стекает и не набухает', async () => {
    // С 19 октября 2026 в шапке «Меню» тоже лупа (поиск), поэтому при смене
    // вкладок обе кнопки остаются на месте теми же элементами.
    const { screen, header } = await openApp();
    const bell = within(header).getByTestId('notif-bell');
    await fireEvent.press(tabButton(screen, 'nav.menu'));
    await waitFor(() => expect(within(header).getAllByTestId('header-slot')).toHaveLength(2));
    expect(within(header).getByTestId('notif-bell')).toBe(bell);
    expect(drains()).toHaveLength(0);
    expect(swells()).toHaveLength(2);

    await fireEvent.press(tabButton(screen, 'nav.tasks'));
    await tasksBuilt(header);
    await waitFor(() => expect(within(header).getAllByTestId('header-slot')).toHaveLength(2));
    expect(within(header).getByTestId('notif-bell')).toBe(bell);
    expect(drains()).toHaveLength(0);
    expect(swells()).toHaveLength(2);
  });

  test('кнопка набухает из капли: на полпути место уже, форма меньше, видна не полностью; в конце — 36 и 1', async () => {
    const { screen, header } = await openApp();
    // Пружина «замирает» на полпути капли.
    withSpring.mockImplementation((to, cfg, cb) => (cfg === LIQUID.swell ? 0.16 : springImpl(to, cfg, cb)));
    await fireEvent.press(tabButton(screen, 'nav.stats'));
    await waitBtn(within(header), 'menu.export_excel');
    // Пришедшая — первое из видимых мест (стекающие лупа и колокольчик скрыты от чтения).
    await waitFor(() => expect(flat(within(header).getAllByTestId('header-slot')[0]).width).toBeLessThan(36));
    const slot = within(header).getAllByTestId('header-slot')[0];
    const body = within(header).getAllByTestId('header-slot-body')[0];
    const want = buttonDrop(0.16, 36, 36, spacing.sm);
    expect(flat(slot).width).toBeCloseTo(want.slotW, 6);
    expect(flat(slot).width).toBeLessThan(36);
    expect(flat(slot).marginRight).toBeLessThan(0);
    expect(scaleOf(flat(body), 'scaleX')).toBeCloseTo(want.sx, 6);
    expect(scaleOf(flat(body), 'scaleX')).toBeLessThan(1);
    expect(flat(body).opacity).toBeCloseTo(0.5, 6);
  });

  test('кнопка уходит каплей: пока стекает — на месте, но не нажимается и скрыта от чтения; стекла — нет в дереве', async () => {
    const row = { flexDirection: 'row', gap: spacing.sm };
    const A = <HeaderButton icon="search" label="Поиск" onPress={noop} />;
    const B = <HeaderButton icon="plus" label="Плюс" onPress={noop} />;
    const C = <HeaderButton icon="calendar" label="Календарь" onPress={noop} />;
    const at = (tab, items) => <HeaderActions tab={tab} items={items} style={row} />;
    const first = [A, B];
    const s = await render(at('Tasks', first));
    expect(s.getAllByTestId('header-slot')).toHaveLength(2);

    // Стекание «в пути»: конец анимации ещё не наступил.
    const finish = [];
    withTiming.mockImplementation((to, cfg, cb) => {
      if (cfg === HEADER_LIQUID.drain) { finish.push(cb); return 0.2; }
      return timingImpl(to, cfg, cb);
    });
    // Новая вкладка: «Плюс» остаётся (та же кнопка), «Поиск» уходит, «Календарь» приходит.
    const plus = s.getByLabelText('Плюс');
    await s.rerender(at('Stats', [B, C]));
    await s.rerender(at('Stats', [B, C]));
    expect(finish).toHaveLength(1);
    expect(drains()[0][0]).toBe(0);
    expect(s.getByLabelText('Плюс')).toBe(plus); // не пересоздавалась
    // Уходящая — каплей на своём месте: уже 36, пальцем не взять, чтением не видна.
    const leaving = s.getAllByTestId('header-slot', { includeHiddenElements: true }).filter((slot) => slot.props.pointerEvents === 'none');
    expect(leaving).toHaveLength(1);
    expect(flat(leaving[0]).width).toBeLessThan(36);
    expect(flat(leaving[0]).width).toBeCloseTo(buttonDrop(0.2, 36, 36, spacing.sm).slotW, 6);
    expect(leaving[0].props.importantForAccessibility).toBe('no-hide-descendants');
    expect(leaving[0].props.accessibilityElementsHidden).toBe(true);
    expect(s.queryByLabelText('Поиск')).toBeNull();

    // Стекла — места нет.
    await act(async () => { finish[0](true); });
    expect(s.queryByLabelText('Поиск', { includeHiddenElements: true })).toBeNull();
    expect(s.getAllByTestId('header-slot')).toHaveLength(2);
  });

  test('возврат с экрана деталей: название и кнопки стоят сразу, ничего не играет', async () => {
    const { screen, header, nav } = await openApp();
    await fireEvent.press(tabButton(screen, 'nav.tasks'));
    await tasksBuilt(header);
    const [swollen, drained, titled] = [swells().length, drains().length, titles().length];

    await fireEvent.press(btn(within(header), 'search.placeholder'));
    await screen.findByPlaceholderText(t('ru', 'search.placeholder'));
    await act(() => nav.goBack());
    within(header).getByText(t('ru', 'nav.tasks'));
    btn(within(header), 'search.placeholder');
    expect(within(header).getAllByTestId('header-slot')).toHaveLength(2);
    expect([swells().length, drains().length, titles().length]).toEqual([swollen, drained, titled]);
  });

  test('строка и фон шапки не гаснут и не двигаются: жидкость — только у названия и кнопок', async () => {
    const { screen, header } = await openApp();
    const bg = screen.getByTestId('root-header-bg');
    const content = within(header).getByTestId('root-header-content');
    await fireEvent.press(tabButton(screen, 'nav.stats'));
    await waitBtn(within(header), 'menu.export_excel');
    expect(within(header).getByTestId('root-header-content')).toBe(content);
    expect(screen.getByTestId('root-header-bg')).toBe(bg);
    for (const layer of [header, bg, content]) {
      expect(flat(layer).opacity).toBeUndefined();
      expect(flat(layer).transform).toBeUndefined();
    }
    expect(withSequence).not.toHaveBeenCalled();
  });

  test('«уменьшение движения» — название и кнопки меняются сразу, ничего не играет', async () => {
    mockReduced = true;
    const { screen, header } = await openApp();
    await fireEvent.press(tabButton(screen, 'nav.stats'));
    await waitBtn(within(header), 'menu.export_excel');
    expect(within(header).queryByTestId('notif-bell')).toBeNull();
    within(header).getByText(t('ru', 'nav.stats'));
    expect(swells()).toHaveLength(0);
    expect(drains()).toHaveLength(0);
    expect(titles()).toHaveLength(0);
    expect(within(header).getAllByTestId('header-slot')).toHaveLength(2);
  });
});

// --- 3. Числа и формы --------------------------------------------------------------

describe('числа и формы шапки', () => {
  test('название: в начале плоское и невидимое, в конце — форма и непрозрачность 1', () => {
    expect(dropIn(0)).toEqual({ o: 0, sx: 0.86, sy: 0.7 });
    expect(dropIn(1)).toEqual({ o: 1, sx: 1, sy: 1 });
    const mid = dropIn(0.25);
    expect(mid.o).toBeCloseTo(0.5, 6); // непрозрачность набирает первую половину пути
    expect(mid.sy).toBeLessThan(mid.sx); // капля плоская: ниже, чем шире
    expect(dropIn(2)).toEqual(dropIn(1));
    expect(dropIn(-1)).toEqual(dropIn(0));
  });

  test('капля кнопки: ничего — круглая капля — сплющенная кнопка — кнопка; соседи не прыгают', () => {
    const gap = spacing.sm;
    expect(buttonDrop(0, 36, 36, gap)).toMatchObject({ slotW: 0, sx: 0, sy: 0, o: 0, mr: -gap });
    // До DROP — круглая капля: ширина места и обоих масштабов одна.
    const drop = buttonDrop(DROP / 2, 36, 36, gap);
    expect(drop.slotW).toBeGreaterThan(0);
    expect(drop.slotW).toBeLessThan(36);
    expect(drop.sx).toBeCloseTo(drop.sy, 6);
    expect(drop.mr).toBeLessThan(0);
    expect(drop.mr).toBeGreaterThan(-gap);
    expect(drop.o).toBeCloseTo(0.5, 6);
    // На DROP капля — высотой с кнопку, дальше кнопка чуть ниже и отыгрывает.
    expect(buttonDrop(DROP, 36, 36, gap)).toMatchObject({ slotW: 36, sx: 1, o: 1 });
    const squash = buttonDrop(0.66, 36, 36, gap);
    expect(squash.sy).toBeLessThan(1);
    expect(squash.slotW).toBe(36);
    expect(Math.abs(squash.mr)).toBe(0);
    // В покое — ровно кнопка.
    expect(buttonDrop(1, 36, 36, gap)).toMatchObject({ slotW: 36, dx: 0, sx: 1, sy: 1, o: 1 });
    expect(Math.abs(buttonDrop(1, 36, 36, gap).mr)).toBe(0);
    // Перехлёст пружины — чуть ниже, не шире места.
    const over = buttonDrop(1.05, 36, 36, gap);
    expect(over.sy).toBeLessThan(1);
    expect(over.slotW).toBe(36);
  });

  test('широкая кнопка (чип) в капле стягивается к центру своего места', () => {
    const gap = spacing.sm;
    const drop = buttonDrop(DROP, 120, 36, gap);
    expect(drop.slotW).toBe(36);
    expect(drop.dx).toBe((36 - 120) / 2);
    expect(drop.sx).toBeCloseTo(36 / 120, 6);
    expect(buttonDrop(1, 120, 36, gap)).toMatchObject({ slotW: 120, dx: 0, sx: 1 });
  });

  describe('места кнопок', () => {
    const Btn = (props) => createElement('Btn', props);
    const Bell = () => createElement('Bell');
    const mk = (type, props) => { const el = createElement(type, props); return { el, sig: slotSig(el) }; };
    const slotOf = (id, n, extra) => ({ id, ...n, visible: true, entering: false, ...extra });
    let ids;
    const makeId = () => { ids += 1; return ids; };
    beforeEach(() => { ids = 100; });

    test('в пределах вкладки — по порядку: сменился значок кнопки «вид» — та же кнопка', () => {
      const prev = [slotOf(1, mk(Btn, { icon: 'plus', label: 'Новая' })), slotOf(2, mk(Btn, { icon: 'panel', label: 'Сетка' }))];
      const next = [mk(Btn, { icon: 'plus', label: 'Новая' }), mk(Btn, { icon: 'list', label: 'Список' })];
      const out = reconcileSlots(prev, next, false, makeId);
      expect(out.map((s) => [s.id, s.visible, s.entering])).toEqual([[1, true, false], [2, true, false]]);
      expect(out[1].sig.icon).toBe('list');
    });

    test('в пределах вкладки: лишние уходят, недостающие приходят', () => {
      const prev = [slotOf(1, mk(Btn, { icon: 'a' })), slotOf(2, mk(Btn, { icon: 'b' })), slotOf(3, mk(Btn, { icon: 'c' }))];
      const fewer = reconcileSlots(prev, [mk(Btn, { icon: 'a' })], false, makeId);
      expect(fewer.map((s) => [s.id, s.visible])).toEqual([[1, true], [2, false], [3, false]]);
      const more = reconcileSlots(fewer.slice(0, 1), [mk(Btn, { icon: 'a' }), mk(Btn, { icon: 'd' })], false, makeId);
      expect(more.map((s) => [s.id, s.visible, s.entering])).toEqual([[1, true, false], [101, true, true]]);
    });

    test('смена вкладки — по типу, значку и подписи: общие остаются теми же, остальные уходят и приходят', () => {
      const search = { icon: 'search', label: 'Поиск' };
      const prev = [slotOf(1, mk(Btn, search)), slotOf(2, mk(Bell, {}))];
      // «Задачи»: то же самое — ничего не уходит и не приходит.
      const same = reconcileSlots(prev, [mk(Btn, search), mk(Bell, {})], true, makeId);
      expect(same.map((s) => [s.id, s.visible, s.entering])).toEqual([[1, true, false], [2, true, false]]);
      // «Меню»: только колокольчик — лупа уходит, колокольчик тот же.
      const menu = reconcileSlots(prev, [mk(Bell, {})], true, makeId);
      expect(menu.find((s) => s.id === 2)).toMatchObject({ visible: true, entering: false });
      expect(menu.find((s) => s.id === 1)).toMatchObject({ visible: false });
      // Вкладка с тремя своими кнопками: обе прежние уходят, три приходят.
      const home = reconcileSlots(prev, [mk(Btn, { icon: 'plus' }), mk(Btn, { icon: 'calendar' }), mk(Btn, { icon: 'panel' })], true, makeId);
      expect(home.filter((s) => s.visible).map((s) => s.entering)).toEqual([true, true, true]);
      expect(home.filter((s) => !s.visible).map((s) => s.id).sort()).toEqual([1, 2]);
      expect(new Set(home.map((s) => s.id)).size).toBe(5);
    });

    test('уже стекающие остаются в ряду и не берутся заново; уходящие встают на своё место', () => {
      const prev = [slotOf(1, mk(Btn, { icon: 'a' }), { visible: false }), slotOf(2, mk(Btn, { icon: 'a' })), slotOf(3, mk(Btn, { icon: 'b' }))];
      const out = reconcileSlots(prev, [mk(Btn, { icon: 'b' })], true, makeId);
      // Стекающая «a» (1) не ожила от совпадения подписи; живая «a» (2) ушла; «b» (3) осталась.
      expect(out.find((s) => s.id === 1).visible).toBe(false);
      expect(out.find((s) => s.id === 2).visible).toBe(false);
      expect(out.find((s) => s.id === 3)).toMatchObject({ visible: true, entering: false });
      expect(out.map((s) => s.id)).toEqual([1, 2, 3]);
    });
  });
});

// Дрожь нижнего листа (components/BottomSheet.js). Запуск: npm run test:mobile
//
// 11 октября 2026 «некоторые листы дёргаются». На эмуляторе (420 dpi, 2,625
// пикселя на dp) нашлось три причины, все в общей машине листа:
//
// 1. Замер подвала кормил высоту, от которой сам зависел. Раскладка
//    округляет края к пикселям экрана, и один и тот же подвал, смотря где
//    стоит его верх, мерился то 123,8, то 124,2 dp; округление вверх
//    раздувало эту долю до целого dp (124 → 125 → 124 …), и лист бесконечно
//    дрожал на dp — «Сбросить» в фильтре, «Сохранить» в ставке, «Создать
//    проект». Уменьшение не больше SHEET_RESIZE_EPS теперь шум.
// 2. Высота участков жила в самом листе и переживала закрытие: новый лист
//    открывался по высоте прежнего (592 вместо 64) и схлопывался на выезде.
//    Теперь у каждого открытия и у каждого появления подвала своя обёртка
//    (EasedBox) со свежим значением.
// 3. Новый ход высоты начинался с конечной точки прежнего: прерванный ход
//    обрывался скачком, а подвал, пропавший из дерева на кадр перед тем, как
//    стать «призраком», мигал.
//
// Проверяется применение: в подделке reanimated (как в sheetResize.test.js)
// видно, какие значения ложатся в высоту обёртки и в каком порядке.
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import BottomSheet, { SHEET_RESIZE_EPS, SHEET_RESIZE_MS, SHEET_SETTLE_MS } from '../src/components/BottomSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet, closeSheet } from '../src/store/useSheetStore';

// Всё, что легло в высоту обёрток, по порядку: именно порядок отличает «едет
// оттуда, где стоит» от «сначала прыгнул в конец прежнего хода».
const assigned = [];
jest.mock('react-native-reanimated', () => {
  const m = jest.requireActual('react-native-reanimated/mock');
  const { useRef } = jest.requireActual('react');
  return {
    ...m,
    // Настоящий useSharedValue — один на всю жизнь компонента; свой, с записью.
    useSharedValue: (init) => {
      const ref = useRef(null);
      if (!ref.current) {
        let v = init;
        ref.current = {
          get value() { return v; },
          set value(next) { assigned.push(next); v = next; },
        };
      }
      return ref.current;
    },
    withTiming: jest.fn((to, cfg, cb) => m.withTiming(to, cfg, cb)),
    Easing: { ...m.Easing, cubic: (x) => x * x * x, out: (f) => (x) => 1 - f(1 - x) },
  };
});
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));

const { withTiming } = Reanimated;
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const rides = () => withTiming.mock.calls.filter(([, cfg]) => cfg && cfg.duration === SHEET_RESIZE_MS);
const rideTargets = () => rides().map(([to]) => to);

beforeEach(() => {
  withTiming.mockClear();
  assigned.length = 0;
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 } });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const settle = () => wait(SHEET_SETTLE_MS + 60);
async function show(content) {
  openSheet(content);
  return render(<BottomSheet />);
}
const resize = (screen, height) => fireEvent(screen.getByTestId('sheet-scroll'), 'contentSizeChange', 390, height);
const footLayout = (screen, height) => fireEvent(screen.getByTestId('sheet-footer-content'), 'layout', { nativeEvent: { layout: { height } } });
const setFooter = (footer) => act(async () => { useSheetStore.setState({ footer }); });
/** Высота обёртки сейчас: подделке нужна перерисовка, чтобы стиль пересчитался. */
async function heightOf(screen, id) {
  await screen.rerender(<BottomSheet />);
  return flat(screen.getByTestId(id)).height;
}

describe('замер шумит на пиксель — высота не пляшет', () => {
  test('подвал: 123,8 ↔ 124,2 даёт один рост, а не бесконечный 124 ↔ 125', async () => {
    const screen = await show(<Text>лист</Text>);
    await settle();
    await setFooter(<Text>кнопка</Text>);
    await footLayout(screen, 123.8); // подвал вырос на глазах — с нуля до 124
    await footLayout(screen, 124.2); // 125: рост принимается сразу
    await footLayout(screen, 123.8); // 124 — на пиксель ниже, это шум
    await footLayout(screen, 124.2);
    await footLayout(screen, 123.8);
    expect(rideTargets()).toEqual([124, 125]);
    expect(await heightOf(screen, 'sheet-footer')).toBe(125);
  });

  test('уменьшение больше допуска — настоящее, подвал едет', async () => {
    const screen = await show(<Text>лист</Text>);
    await settle();
    await setFooter(<Text>кнопка</Text>);
    await footLayout(screen, 124);
    await footLayout(screen, 124 - SHEET_RESIZE_EPS); // ровно допуск — ещё шум
    expect(rideTargets()).toEqual([124]);
    await footLayout(screen, 124 - SHEET_RESIZE_EPS - 1);
    expect(rideTargets()).toEqual([124, 122]);
  });

  test('содержимое: то же правило для высоты страницы', async () => {
    const screen = await show(<Text>лист</Text>);
    await settle();
    await resize(screen, 448); // первый замер — сразу
    await resize(screen, 448.2); // 449
    await resize(screen, 447.8); // 448: шум
    await resize(screen, 448.2);
    expect(rideTargets()).toEqual([449]);
    expect(await heightOf(screen, 'sheet-body')).toBe(449);
  });
});

describe('новый лист не помнит высот прежнего', () => {
  test('лист поверх листа: обёртка по содержимому, пока нет замера', async () => {
    const screen = await show(<Text>первый</Text>);
    await resize(screen, 700);
    expect(await heightOf(screen, 'sheet-body')).toBe(700);
    await act(async () => openSheet(<Text>второй</Text>));
    // Раньше тут было 700 — высота первого, и второй схлопывался на выезде.
    expect(await heightOf(screen, 'sheet-body')).toBeUndefined();
    await resize(screen, 64);
    expect(await heightOf(screen, 'sheet-body')).toBe(64);
  });

  test('закрыли и открыли другой: то же — без высоты прежнего', async () => {
    const screen = await show(<Text>первый</Text>);
    await resize(screen, 700);
    await act(async () => closeSheet());
    await wait(400); // лист уехал вниз и снят
    expect(screen.queryByTestId('sheet')).toBeNull();
    await act(async () => openSheet(<Text>второй</Text>));
    expect(await heightOf(screen, 'sheet-body')).toBeUndefined();
  });

  test('подвал при открытии — по содержимому, вырос позже — с нуля', async () => {
    function WithFooter() {
      useEffect(() => { useSheetStore.getState().setFooter(<Text>сохранить</Text>); return () => useSheetStore.getState().setFooter(null); }, []);
      return <Text>форма</Text>;
    }
    const screen = await show(<WithFooter />);
    // Лист ещё выезжает: подвал стоит по содержимому, первый замер встаёт сразу.
    expect(await heightOf(screen, 'sheet-footer')).toBeUndefined();
    await footLayout(screen, 124);
    expect(rides()).toHaveLength(0);
    await settle();
    // Лист стоит — подвал, пропавший и вернувшийся, растёт с нуля.
    await setFooter(null);
    await wait(SHEET_RESIZE_MS + 100);
    expect(screen.queryByTestId('sheet-footer')).toBeNull();
    await setFooter(<Text>снова</Text>);
    expect(await heightOf(screen, 'sheet-footer')).toBe(0);
    await footLayout(screen, 68);
    expect(rideTargets()).toContain(68);
  });
});

describe('ход высоты', () => {
  test('новый ход едет оттуда, где участок стоит: без скачка в конец прежнего', async () => {
    const screen = await show(<Text>лист</Text>);
    await settle();
    await resize(screen, 400);
    assigned.length = 0;
    await resize(screen, 520);
    // Только withTiming. Раньше перед ним в высоту ложилось «от»: 400.
    expect(assigned).toEqual([520]);
    assigned.length = 0;
    await resize(screen, 300); // прежний ход ещё идёт — подхватывается как есть
    expect(assigned).toEqual([300]);
  });

  test('участок выше потолка начинает с видимой части, а не с невидимой', async () => {
    const screen = await show(<Text>лист</Text>);
    await settle();
    await fireEvent(screen.getByTestId('sheet-header'), 'layout', { nativeEvent: { layout: { height: 54 } } });
    await resize(screen, 400);
    await resize(screen, 5000); // выше потолка: едет до потолка
    const cap = rideTargets()[rideTargets().length - 1];
    assigned.length = 0;
    await resize(screen, 300);
    // Прыжок вниз до потолка (он невидим: больше участок всё равно не показан), потом ход.
    expect(assigned).toHaveLength(2);
    expect(Math.abs(assigned[0] - cap)).toBeLessThan(1); // потолок без округления вверх
    expect(assigned[1]).toBe(300);
  });
});

describe('подвал не мигает при уходе', () => {
  test('пропал — те же кнопки стоят «призраком», их коробка не уходит из дерева', async () => {
    let mounts = 0;
    function Probe() {
      useEffect(() => { mounts += 1; }, []);
      return <Text>кнопка</Text>;
    }
    const screen = await show(<Text>лист</Text>);
    await settle();
    await setFooter(<Probe />);
    await footLayout(screen, 60);
    expect(mounts).toBe(1);
    await setFooter(null);
    // Раньше коробка на кадр уходила из дерева (кнопки гасли, лист садился на
    // высоту подвала) и возвращалась уже сворачиваться: кнопки собирались заново.
    expect(mounts).toBe(1);
    screen.getByTestId('sheet-footer', { includeHiddenElements: true });
    expect(rideTargets()).toEqual([60, 0]);
  });

  test('пропал и тут же вернулся, пока призрак сворачивается: участок едет обратно к замеру, а не стоит на нуле', async () => {
    // Фильтр: «Сбросить» снят и тут же снова нужен. Обёртка та же, размер
    // кнопок тот же — onLayout не приходит, и раньше участок оставался на нуле
    // (overflow: hidden — кнопок не видно).
    const screen = await show(<Text>лист</Text>);
    await settle();
    await setFooter(<Text>Сбросить</Text>);
    await footLayout(screen, 60);
    await setFooter(null);
    expect(rideTargets()).toEqual([60, 0]);
    await wait(SHEET_RESIZE_MS / 2); // призрак ещё стоит
    await setFooter(<Text>Сбросить</Text>);
    expect(rideTargets()).toEqual([60, 0, 60]);
    expect(await heightOf(screen, 'sheet-footer')).toBe(60);
    // Таймер призрака своё отработал — живой подвал на месте.
    await wait(SHEET_RESIZE_MS + 100);
    expect(await heightOf(screen, 'sheet-footer')).toBe(60);
    expect(screen.getByTestId('sheet-footer').props.pointerEvents).toBe('auto');
  });
});

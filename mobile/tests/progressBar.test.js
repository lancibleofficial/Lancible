// Шкалы натекают (components/ProgressBar.js, lib/liquid.js — liquidBar,
// liquidColumn; DESIGN.md «Телефон» → «Жидкое движение»). Запуск: npm run test:mobile
//
// Reanimated в jest подменён своей подделкой: пружина и время сразу отдают
// конечное значение. Поверх неё здесь шпионы — видно, какая анимация
// запущена, с какими настройками и чем кончилась; середину пути показывает
// пружина, на один вызов «замершая» на полдороге.
//
// 1. Появилась шкала — заливка натекает от нуля пружиной LIQUID.flow и
//    приходит точно к значению; новое значение — от того места, где она сейчас.
// 2. На ходу передний край — капля: толще шкалы и длиннее её торца; в покое
//    капли не видно (она и есть торец).
// 3. «Уменьшение движения» — сразу на месте, ни пружины, ни времени; iOS 26+ —
//    без капли, просто доползает (LIQUID.creep).
// 4. Столбик графика поднимается той же пружиной и на ходу тоньше.
// 5. Места: карточка колоды «Проекты», карточка цифр и полосы версий на
//    странице проекта, «По проектам» и неделя в «Цифрах», неделя на «Сегодня» —
//    общий компонент; своих полос нет ни у одного экрана (храповик — пустой
//    список).
// 6. Вниз — как вверх: задачу вернули, значение уменьшилось — шкала так же
//    жидко стекает (та же пружина, от того места, где заливка сейчас, капля на
//    переднем крае).
// 7. Дошла до 100 % снизу — «поп» (толчок пружины pop, заливка вспухает по
//    толщине) и брызги из торца, как у галочки (LiquidDrops), один раз за
//    переход. Появилась сразу полной — не играет; «уменьшение движения», iOS 26+
//    и celebrate={false} («По проектам» — доля от лидера, а не «выполнено») —
//    тоже.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Platform, StyleSheet } from 'react-native';
import { render, fireEvent, within, act } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import ProgressBar, { LiquidColumn } from '../src/components/ProgressBar';
import { dropsLife } from '../src/components/Liquid';
import StatsScreen from '../src/screens/StatsScreen';
import ProjectScreen from '../src/screens/ProjectScreen';
import HomeScreen from '../src/screens/HomeScreen';
import { useAppStore } from '../src/store/useAppStore';
import { LIQUID, CHECK_DROPS, BAR_POP_KICK, BAR_POP_DELAY, BAR_DROPS_ARC, liquidBar, liquidColumn, dropAt } from '../src/lib/liquid';
import { t } from '../src/lib/i18n';

jest.mock('react-native-reanimated', () => {
  const m = jest.requireActual('react-native-reanimated/mock');
  const { useRef } = jest.requireActual('react');
  return {
    ...m,
    // Настоящий useSharedValue один на всю жизнь компонента; подделка — новый
    // на каждую отрисовку. Здесь — как у настоящего.
    useSharedValue: (init) => {
      const ref = useRef(null);
      if (!ref.current) ref.current = m.useSharedValue(init);
      return ref.current;
    },
    withSpring: jest.fn((to, cfg, cb) => m.withSpring(to, cfg, cb)),
    withTiming: jest.fn((to, cfg, cb) => m.withTiming(to, cfg, cb)),
    withDelay: jest.fn((ms, next) => next),
  };
});
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));

const { withSpring, withTiming, withDelay } = Reanimated;
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const flows = () => withSpring.mock.calls.filter(([, cfg]) => cfg === LIQUID.flow);
const creeps = () => withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.creep);
// «Поп» шкалы — пружина pop с толчком BAR_POP_KICK; брызги — капли `bar-drop`.
const pops = () => withSpring.mock.calls.filter(([, cfg]) => cfg && cfg.velocity === BAR_POP_KICK && cfg.stiffness === LIQUID.pop.stiffness);
const layout = (width) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 4 } } });

function fakeIos(version) {
  const os = jest.replaceProperty(Platform, 'OS', 'ios');
  const d = Object.getOwnPropertyDescriptor(Platform, 'Version');
  const v = d && d.get ? jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version) : jest.replaceProperty(Platform, 'Version', version);
  return () => { os.restore(); if (v.mockRestore) v.mockRestore(); else v.restore(); };
}

beforeEach(() => {
  mockReduced = false;
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' } });
  withSpring.mockClear();
  withTiming.mockClear();
  withDelay.mockClear();
});

describe('шкала: формы пути (liquidBar)', () => {
  test('вниз — зеркало вверха: тот же путь заливки и та же капля', () => {
    for (const p of [0.25, 0.5, 0.75]) {
      const up = liquidBar(0.3, 0.8, p, 4);
      const down = liquidBar(0.8, 0.3, 1 - p, 4);
      // Середина пути вниз — там же, где середина пути вверх, с обратной стороны.
      expect(down.w).toBeCloseTo(up.w, 6);
      expect(down.headW).toBeCloseTo(up.headW, 6);
      expect(down.headH).toBeCloseTo(up.headH, 6);
    }
    expect(liquidBar(0.8, 0.3, 0.5, 4).headH).toBeCloseTo(liquidBar(0.3, 0.8, 0.5, 4).headH, 6);
  });

  test('в начале и в конце пути капли нет — только торец шкалы; на середине она толще и длиннее', () => {
    expect(liquidBar(0, 0.6, 0, 4)).toEqual({ w: 0, headW: 4, headH: 4 });
    const end = liquidBar(0, 0.6, 1, 4);
    expect(end.w).toBeCloseTo(0.6, 6);
    expect(end.headW).toBeCloseTo(4, 6);
    expect(end.headH).toBeCloseTo(4, 6);
    const mid = liquidBar(0, 0.6, 0.5, 4);
    expect(mid.w).toBeCloseTo(0.3, 6);
    expect(mid.headH).toBeGreaterThan(4 * 1.5);
    expect(mid.headW).toBeGreaterThan(4 * 3);
  });

  test('перехлёст: заливка перелетает значение и не выходит за шкалу; мелкий шаг — капля меньше', () => {
    expect(liquidBar(0.2, 0.6, 1.06, 4).w).toBeGreaterThan(0.6);
    expect(liquidBar(0.5, 1, 1.06, 4).w).toBe(1);
    expect(liquidBar(0.6, 0, 1.06, 4).w).toBe(0);
    expect(liquidBar(0.5, 0.55, 0.5, 4).headH).toBeLessThan(liquidBar(0.1, 0.6, 0.5, 4).headH);
  });

  test('пружина: перехлёст есть, но небольшой (до 8 %), и к ~0,6 с шкала стоит', () => {
    // Та же пружина, посчитанная численно: m·x'' + c·x' + k·(x − 1) = 0.
    const { damping: c, stiffness: k, mass: m } = LIQUID.flow;
    let x = 0; let v = 0; let peak = 0; let settled = null;
    const dt = 1 / 2000;
    for (let i = 1; i <= 2000; i++) {
      v += ((-k * (x - 1) - c * v) / m) * dt;
      x += v * dt;
      peak = Math.max(peak, x);
      if (settled === null && i * dt > 0.2 && Math.abs(x - 1) < 0.01 && Math.abs(v) < 0.1) settled = i * dt;
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.08);
    expect(settled).toBeLessThan(0.7);
  });
});

describe('ProgressBar', () => {
  const fillOf = (s) => flat(s.getByTestId('bar-fill'));
  const headOf = (s) => flat(s.getByTestId('bar-head'));

  test('появилась — натекает от нуля пружиной flow и приходит точно к значению', async () => {
    const s = await render(<ProgressBar value={0.6} testID="bar" />);
    await fireEvent(s.getByTestId('bar'), 'layout', layout(200));
    expect(flows()).toHaveLength(1);
    expect(flows()[0][0]).toBe(1);
    await s.rerender(<ProgressBar value={0.6} testID="bar" />);
    expect(fillOf(s).width).toBe('60%');
    // Значение — и для чтения с экрана.
    expect(s.getByTestId('bar').props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 60 });
    expect(s.getByTestId('bar').props.accessibilityRole).toBe('progressbar');
  });

  test('на полпути — капля на переднем крае толще шкалы; в покое — только торец', async () => {
    withSpring.mockImplementationOnce(() => 0.5);
    const s = await render(<ProgressBar value={0.6} height={4} testID="bar" />);
    await fireEvent(s.getByTestId('bar'), 'layout', layout(200));
    await s.rerender(<ProgressBar value={0.6} height={4} testID="bar" />);
    expect(fillOf(s).width).toBe('30%');
    const head = headOf(s);
    expect(head.opacity).toBe(1);
    expect(head.height).toBeGreaterThan(4);
    expect(head.width).toBeGreaterThan(4);
    // Капля стоит на конце заливки: её правый край — там, где кончается заливка.
    expect(head.left + head.width).toBeCloseTo(60, 6);
    expect(head.top).toBeLessThan(0);

    // Новое значение — от того места, где заливка сейчас, а не от нуля.
    await s.rerender(<ProgressBar value={0.9} height={4} testID="bar" />);
    expect(flows()).toHaveLength(2);
    await s.rerender(<ProgressBar value={0.9} height={4} testID="bar" />);
    expect(fillOf(s).width).toBe('90%');
    expect(headOf(s).height).toBeCloseTo(4, 6);
    expect(headOf(s).width).toBeCloseTo(4, 6);
  });

  test('то же значение при перерисовке — ничего не играет', async () => {
    const s = await render(<ProgressBar value={0.4} testID="bar" />);
    await s.rerender(<ProgressBar value={0.4} testID="bar" />);
    await s.rerender(<ProgressBar value={0.4} color="#87ff65" testID="bar" />);
    expect(flows()).toHaveLength(1);
  });

  test('«уменьшение движения» — сразу на месте, ни пружины, ни времени, капли нет', async () => {
    mockReduced = true;
    const s = await render(<ProgressBar value={0.35} testID="bar" />);
    await fireEvent(s.getByTestId('bar'), 'layout', layout(200));
    await s.rerender(<ProgressBar value={0.8} testID="bar" />);
    await s.rerender(<ProgressBar value={0.8} testID="bar" />);
    expect(flows()).toHaveLength(0);
    expect(creeps()).toHaveLength(0);
    expect(fillOf(s).width).toBe('80%');
    expect(headOf(s).opacity).toBe(0);
  });

  test('iOS 26+ — без капли и перехлёста: доползает по времени', async () => {
    const restore = fakeIos(26);
    try {
      const s = await render(<ProgressBar value={0.5} testID="bar" />);
      await fireEvent(s.getByTestId('bar'), 'layout', layout(200));
      await s.rerender(<ProgressBar value={0.5} testID="bar" />);
      expect(flows()).toHaveLength(0);
      expect(creeps()).toHaveLength(1);
      expect(fillOf(s).width).toBe('50%');
      expect(headOf(s).opacity).toBe(0);
    } finally {
      restore();
    }
  });

  test('значение за краями — по краю шкалы', async () => {
    const s = await render(<ProgressBar value={1.7} testID="bar" />);
    await s.rerender(<ProgressBar value={1.7} testID="bar" />);
    expect(fillOf(s).width).toBe('100%');
    await s.rerender(<ProgressBar value={-1} testID="bar" />);
    await s.rerender(<ProgressBar value={-1} testID="bar" />);
    expect(fillOf(s).width).toBe('0%');
  });
});

describe('ProgressBar: вниз — так же жидко, как вверх', () => {
  const fillOf = (s) => flat(s.getByTestId('bar-fill'));
  const headOf = (s) => flat(s.getByTestId('bar-head'));

  test('значение уменьшилось — пружина flow к меньшему, от того места, где заливка была; на переднем крае капля', async () => {
    const s = await render(<ProgressBar value={0.8} height={4} testID="bar" />);
    await fireEvent(s.getByTestId('bar'), 'layout', layout(200));
    await s.rerender(<ProgressBar value={0.8} height={4} testID="bar" />);
    expect(fillOf(s).width).toBe('80%');
    withSpring.mockClear();
    withSpring.mockImplementationOnce(() => 0.5);
    await s.rerender(<ProgressBar value={0.4} height={4} testID="bar" />);
    await s.rerender(<ProgressBar value={0.4} height={4} testID="bar" />);
    // Один новый путь — та же пружина flow, что и вверх.
    expect(flows()).toHaveLength(1);
    expect(flows()[0][0]).toBe(1);
    // На полпути от 80 к 40 — 60 %, и капля на переднем крае толще шкалы.
    expect(parseFloat(fillOf(s).width)).toBeCloseTo(60, 6);
    const head = headOf(s);
    expect(head.opacity).toBe(1);
    expect(head.height).toBeGreaterThan(4);
    expect(head.left + head.width).toBeCloseTo(120, 6);

    // Перебили на ходу — от того места, где заливка сейчас (60 %), а не от 80 или 40.
    await s.rerender(<ProgressBar value={0.2} height={4} testID="bar" />);
    await s.rerender(<ProgressBar value={0.2} height={4} testID="bar" />);
    expect(flows()).toHaveLength(2);
    expect(fillOf(s).width).toBe('20%');
    expect(headOf(s).height).toBeCloseTo(4, 6);
  });

  test('до нуля — тоже стекает, а не пропадает; вниз не играет «поп» и брызги', async () => {
    const s = await render(<ProgressBar value={0.5} testID="bar" />);
    await s.rerender(<ProgressBar value={0.5} testID="bar" />);
    withSpring.mockClear();
    await s.rerender(<ProgressBar value={0} testID="bar" />);
    await s.rerender(<ProgressBar value={0} testID="bar" />);
    expect(flows()).toHaveLength(1);
    expect(fillOf(s).width).toBe('0%');
    expect(pops()).toHaveLength(0);
    expect(s.queryAllByTestId('bar-drop')).toHaveLength(0);
  });

  test('iOS 26+ — вниз тоже просто доползает по времени', async () => {
    const restore = fakeIos(26);
    try {
      const s = await render(<ProgressBar value={0.9} testID="bar" />);
      await s.rerender(<ProgressBar value={0.9} testID="bar" />);
      withTiming.mockClear();
      await s.rerender(<ProgressBar value={0.3} testID="bar" />);
      await s.rerender(<ProgressBar value={0.3} testID="bar" />);
      expect(flows()).toHaveLength(0);
      expect(creeps()).toHaveLength(1);
      expect(fillOf(s).width).toBe('30%');
    } finally {
      restore();
    }
  });
});

describe('ProgressBar: дошла до 100 % — «поп» и брызги', () => {
  const dropsOf = (s) => s.queryAllByTestId('bar-drop');
  const fillOf = (s) => flat(s.getByTestId('bar-fill'));

  test('снизу до 100 % — «поп» и брызги, один раз за переход; цвет капель — цвет заливки', async () => {
    const s = await render(<ProgressBar value={0.6} color="#5ec8f2" testID="bar" />);
    await s.rerender(<ProgressBar value={0.6} color="#5ec8f2" testID="bar" />);
    expect(pops()).toHaveLength(0);
    expect(dropsOf(s)).toHaveLength(0);

    await s.rerender(<ProgressBar value={1} color="#5ec8f2" testID="bar" />);
    // «Поп» — одна пружина-толчок, когда заливка доехала до конца.
    expect(pops()).toHaveLength(1);
    expect(withDelay.mock.calls.map(([ms]) => ms)).toContain(BAR_POP_DELAY);
    // Брызги: те же капли, что у галочки, цвета заливки, из торца шкалы.
    expect(s.getByTestId('bar-drops')).toBeTruthy();
    expect(flat(s.getByTestId('bar-drops')).right).toBe(0);
    expect(dropsOf(s)).toHaveLength(CHECK_DROPS);
    for (const d of dropsOf(s)) expect(flat(d).backgroundColor).toBe('#5ec8f2');
    expect(withTiming.mock.calls.filter(([, cfg]) => cfg === LIQUID.burst)).toHaveLength(1);

    // Тот же 100 % при перерисовке не повторяется.
    await s.rerender(<ProgressBar value={1} color="#5ec8f2" testID="bar" />);
    await s.rerender(<ProgressBar value={1} color="#5ec8f2" testID="bar" />);
    expect(pops()).toHaveLength(1);
    expect(dropsOf(s)).toHaveLength(CHECK_DROPS);
    expect(fillOf(s).width).toBe('100%');
  });

  test('появилась сразу полной (100 % на первой отрисовке) — не играет', async () => {
    const s = await render(<ProgressBar value={1} testID="bar" />);
    await s.rerender(<ProgressBar value={1} testID="bar" />);
    expect(pops()).toHaveLength(0);
    expect(dropsOf(s)).toHaveLength(0);
    expect(withDelay).not.toHaveBeenCalled();
    expect(fillOf(s).width).toBe('100%');
  });

  test('упала с 100 % и дошла снова — играет снова; вниз — нет', async () => {
    const s = await render(<ProgressBar value={1} testID="bar" />);
    await s.rerender(<ProgressBar value={0.5} testID="bar" />);
    expect(pops()).toHaveLength(0);
    expect(dropsOf(s)).toHaveLength(0);
    await s.rerender(<ProgressBar value={1} testID="bar" />);
    expect(pops()).toHaveLength(1);
    expect(dropsOf(s)).toHaveLength(CHECK_DROPS);
  });

  test('значение больше единицы — тот же 100 %: переход снизу играет, дальше «поп» не повторяется', async () => {
    const s = await render(<ProgressBar value={0.3} testID="bar" />);
    await s.rerender(<ProgressBar value={1.4} testID="bar" />);
    expect(pops()).toHaveLength(1);
    await s.rerender(<ProgressBar value={1} testID="bar" />);
    expect(pops()).toHaveLength(1);
  });

  test('брызги уходят из дерева, когда растаяли', async () => {
    jest.useFakeTimers();
    try {
      const s = await render(<ProgressBar value={0.2} testID="bar" />);
      await s.rerender(<ProgressBar value={1} testID="bar" />);
      expect(dropsOf(s)).toHaveLength(CHECK_DROPS);
      await act(async () => { jest.advanceTimersByTime(dropsLife(BAR_POP_DELAY) + 20); });
      expect(dropsOf(s)).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('«уменьшение движения» — шкала сразу полная, без «попа» и брызг', async () => {
    mockReduced = true;
    const s = await render(<ProgressBar value={0.6} testID="bar" />);
    await s.rerender(<ProgressBar value={1} testID="bar" />);
    await s.rerender(<ProgressBar value={1} testID="bar" />);
    expect(pops()).toHaveLength(0);
    expect(dropsOf(s)).toHaveLength(0);
    expect(fillOf(s).width).toBe('100%');
  });

  test('iOS 26+ — без «попа» и брызг', async () => {
    const restore = fakeIos(26);
    try {
      const s = await render(<ProgressBar value={0.6} testID="bar" />);
      await s.rerender(<ProgressBar value={1} testID="bar" />);
      expect(pops()).toHaveLength(0);
      expect(dropsOf(s)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test('celebrate={false} («По проектам»: 100 % — лидер) — без «попа» и брызг, но натекает', async () => {
    const s = await render(<ProgressBar value={0.6} celebrate={false} testID="bar" />);
    await s.rerender(<ProgressBar value={1} celebrate={false} testID="bar" />);
    await s.rerender(<ProgressBar value={1} celebrate={false} testID="bar" />);
    expect(pops()).toHaveLength(0);
    expect(dropsOf(s)).toHaveLength(0);
    expect(flows()).toHaveLength(2);
    expect(fillOf(s).width).toBe('100%');
  });

  test('«поп»: заливка вспухает по толщине до ~1,7 и садится обратно; брызги летят вверх от торца', () => {
    // Та же пружина pop с толчком BAR_POP_KICK, посчитанная численно.
    const { damping: c, stiffness: k, mass: m } = LIQUID.pop;
    let x = 0; let v = BAR_POP_KICK; let peak = 0;
    const dt = 1 / 4000;
    for (let i = 0; i < 2000; i++) {
      v += ((-k * x - c * v) / m) * dt;
      x += v * dt;
      peak = Math.max(peak, x);
    }
    expect(1 + peak).toBeGreaterThan(1.5);
    expect(1 + peak).toBeLessThan(2);
    // «Поп» — когда заливка доехала до конца: пружина flow первый раз пересекает единицу.
    const { damping: fc, stiffness: fk, mass: fm } = LIQUID.flow;
    let fx = 0; let fv = 0; let cross = null;
    for (let i = 1; i <= 4000 && cross === null; i++) {
      fv += ((-fk * (fx - 1) - fc * fv) / fm) * dt;
      fx += fv * dt;
      if (fx >= 1) cross = i * dt * 1000;
    }
    expect(Math.abs(BAR_POP_DELAY - cross)).toBeLessThan(40);
    // Веер: ни одна капля не уходит вниз за торец шкалы.
    for (let i = 0; i < CHECK_DROPS; i++) {
      for (const q of [0.3, 0.6, 1]) expect(dropAt(i, CHECK_DROPS, q, 14, BAR_DROPS_ARC).y).toBeLessThan(0);
    }
    // Без веера — круг, как у галочки, и прежние числа.
    expect(dropAt(0, CHECK_DROPS, 0.5, 24)).toEqual(dropAt(0, CHECK_DROPS, 0.5, 24, undefined));
  });
});

describe('LiquidColumn: столбик графика', () => {
  test('поднимается пружиной flow к своей высоте; на ходу тоньше, в покое — в свою ширину', async () => {
    expect(liquidColumn(0, 40, 0.5).sx).toBeLessThan(1);
    expect(liquidColumn(0, 40, 1)).toEqual({ h: 40, sx: 1 });
    withSpring.mockImplementationOnce(() => 0.5);
    const s = await render(<LiquidColumn height={40} style={{ width: 20 }} testID="col" />);
    await s.rerender(<LiquidColumn height={40} style={{ width: 20 }} testID="col" />);
    expect(flows()).toHaveLength(1);
    const mid = flat(s.getByTestId('col'));
    expect(mid.height).toBe(20);
    expect(mid.transform.find((x) => 'scaleX' in x).scaleX).toBeLessThan(1);
    await s.rerender(<LiquidColumn height={52} style={{ width: 20 }} testID="col" />);
    await s.rerender(<LiquidColumn height={52} style={{ width: 20 }} testID="col" />);
    expect(flows()).toHaveLength(2);
    expect(flat(s.getByTestId('col')).height).toBe(52);
    expect(flat(s.getByTestId('col')).width).toBe(20);
  });

  test('«уменьшение движения» — сразу своей высоты', async () => {
    mockReduced = true;
    const s = await render(<LiquidColumn height={33} testID="col" />);
    expect(flows()).toHaveLength(0);
    expect(flat(s.getByTestId('col')).height).toBe(33);
  });
});

describe('места', () => {
  test('«Цифры»: «По проектам» — общая шкала, натекает к доле проекта', async () => {
    const today = new Date();
    const at = (h) => { const d = new Date(today); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 0 },
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }, { id: 'p2', name: 'Бот', color: '#5ec8f2' }],
      tasks: [
        { id: 't1', projectId: 'p1', title: 'Вёрстка', done: false, totalMs: 0, tagIds: [], sessions: [{ start: at(9), end: at(11), ms: 7_200_000 }] },
        { id: 't2', projectId: 'p2', title: 'Ответы', done: false, totalMs: 0, tagIds: [], sessions: [{ start: at(12), end: at(13), ms: 3_600_000 }] },
      ],
      activeTimer: null,
    });
    const s = await render(<StatsScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} />);
    await s.rerender(<StatsScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} />);
    expect(flat(s.getByTestId('stats-pr-p1-fill')).width).toBe('100%');
    expect(flat(s.getByTestId('stats-pr-p2-fill')).width).toBe('50%');
    expect(flat(s.getByTestId('stats-pr-p2-fill')).backgroundColor).toBe('#5ec8f2');
    expect(flows().length).toBeGreaterThanOrEqual(2);

    // Неделя: столбики дней — тоже жидкие (LiquidColumn), с прежней раскладкой.
    withSpring.mockClear();
    await fireEvent.press(s.getByText(t('ru', 'calendar.week')));
    expect(flows().length).toBeGreaterThanOrEqual(7);
  });

  test('страница проекта: отметили последнюю задачу — шкала доходит до 100 % с брызгами; вернули — стекает, без них', async () => {
    const task = (id, done) => ({
      id, projectId: 'p1', title: id, statusId: done ? 's2' : 's1', done, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, notes: '', versionId: null,
    });
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', tagIds: [] }],
      tags: [],
      statuses: [
        { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
        { id: 's2', projectId: 'p1', name: 'Готово', color: '#69d345', kind: 'done', order: 1 },
      ],
      versions: [],
      documents: [],
      tasks: [task('a', true), task('b', false)],
      activeTimer: null,
      ui: { ...useAppStore.getState().ui, boardVersion: {}, listCollapsed: {}, boardCollapsed: {} },
    });
    const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) };
    const screen = () => <ProjectScreen navigation={navigation} route={{ params: { projectId: 'p1' } }} />;
    const s = await render(screen());
    await s.rerender(screen());
    expect(flat(s.getByTestId('project-progress-fill')).width).toBe('50%');
    expect(s.queryAllByTestId('bar-drop')).toHaveLength(0);

    // Отметили вторую — 100 %: «поп» и брызги шкалы (у галочки свои, `check-drop`).
    await fireEvent.press(s.getAllByRole('checkbox').find((n) => n.props.accessibilityState.checked === false));
    await s.rerender(screen());
    expect(flat(s.getByTestId('project-progress-fill')).width).toBe('100%');
    expect(s.getByTestId('project-progress-drops')).toBeTruthy();
    expect(s.getAllByTestId('bar-drop')).toHaveLength(CHECK_DROPS);

    // Вернули — шкала стекает к 50 % той же пружиной, брызг нет.
    await act(async () => { await new Promise((r) => setTimeout(r, dropsLife(BAR_POP_DELAY) + 50)); });
    withSpring.mockClear();
    await fireEvent.press(s.getAllByRole('checkbox').find((n) => n.props.accessibilityState.checked === true));
    await s.rerender(screen());
    await s.rerender(screen());
    expect(flows()).toHaveLength(1);
    expect(flat(s.getByTestId('project-progress-fill')).width).toBe('50%');
    expect(s.queryAllByTestId('bar-drop')).toHaveLength(0);
  });

  test('страница проекта: шкала карточки цифр и полосы версий — общие, натекают к своей доле', async () => {
    const task = (id, versionId, done) => ({
      id, projectId: 'p1', title: id, statusId: 's1', done, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, notes: '', versionId,
    });
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description: '', tagIds: [] }],
      tags: [],
      statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
      versions: [{ id: 'v1', projectId: 'p1', name: 'v1.0', order: 0 }, { id: 'v2', projectId: 'p1', name: 'v2.0', order: 1 }],
      documents: [],
      // Готово 1 из 4 в карточке; в v1 — 1 из 2, в v2 — 0 из 2.
      tasks: [task('a', 'v1', true), task('b', 'v1', false), task('c', 'v2', false), task('d', 'v2', false)],
      activeTimer: null,
      ui: { ...useAppStore.getState().ui, boardVersion: {}, listCollapsed: {}, boardCollapsed: {} },
    });
    const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) };
    const screen = () => <ProjectScreen navigation={navigation} route={{ params: { projectId: 'p1' } }} />;
    const s = await render(screen());
    await s.rerender(screen());
    expect(flat(s.getByTestId('project-progress-fill')).width).toBe('25%');
    expect(flows().length).toBeGreaterThanOrEqual(1);

    withSpring.mockClear();
    await fireEvent.press(within(s.getByTestId('project-tabs')).getByText(t('ru', 'version.section')));
    await s.rerender(screen());
    expect(flat(s.getByTestId('project-version-v1-fill')).width).toBe('50%');
    expect(flat(s.getByTestId('project-version-v2-fill')).width).toBe('0%');
    expect(flows().length).toBeGreaterThanOrEqual(2);
  });

  test('«Сегодня»: столбики недели — LiquidColumn, по одному на день; день с записью — во всю высоту', async () => {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
      projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
      statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
      tasks: [{
        id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 3_600_000, tagIds: [],
        sessions: [{ start: today.toISOString(), end: new Date(today.getTime() + 3_600_000).toISOString(), ms: 3_600_000 }],
        dueAt: null, updatedAt: today.toISOString(),
      }],
      activeTimer: null,
      ui: { ...useAppStore.getState().ui, notifSeenAt: null },
    });
    const navigation = { navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn() };
    const screen = () => <HomeScreen navigation={navigation} route={{ params: {} }} />;
    const s = await render(screen());
    await s.rerender(screen());
    const bars = s.getAllByTestId(/^week-bar-/);
    expect(bars).toHaveLength(7);
    expect(flows().length).toBeGreaterThanOrEqual(7);
    expect(bars.map((b) => flat(b).height).sort((a, b) => a - b)).toEqual([4, 4, 4, 4, 4, 4, 56]);
    expect(flat(bars[0]).width).toBe('100%');
  });

  // Все исходники телефона, кроме ядра и редактора; [путь от src, текст].
  function sources() {
    const root = join(__dirname, '..', 'src');
    const out = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== 'core' && name !== 'editor') walk(full); continue; }
        if (name.endsWith('.js')) out.push([full.slice(root.length + 1).replace(/\\/g, '/'), readFileSync(full, 'utf8')]);
      }
    })(root);
    return out;
  }

  test('своей полосы (ширина в процентах строкой) не рисует ни один экран', () => {
    // Храповик: список пуст. Свою полосу завёл экран — не добавлять сюда, а
    // взять ProgressBar / LiquidColumn: у них и натекание вверх и вниз, и
    // «поп» с брызгами на 100 %.
    const own = [];
    for (const [rel, src] of sources()) {
      if (rel === 'components/ProgressBar.js') continue;
      // Заливка шкалы шириной `${…}%`, в долях от шкалы (flex: pct, scaleX: pct) или столбик высотой по доле от максимума.
      if (
        /width: `\$\{[^`]*\}%`/.test(src)
        || /(?:flex|flexGrow|scaleX): (?:pct|percent|ratio|share|frac|progress)\b/.test(src)
        || /<View style=\{\[styles\.barFill, \{ height:/.test(src)
        // Роль «шкала» — только у общего компонента: своя полоса с ней же — тоже своя.
        || /accessibilityRole=["']progressbar["']/.test(src)
      ) own.push(rel);
    }
    expect(own).toEqual([]);
  });

  test('каждое место шкал берёт общий компонент: проект, колода, «Цифры» — ProgressBar; недели — LiquidColumn', () => {
    const files = Object.fromEntries(sources());
    const uses = (file, name) => new RegExp(`import[^;]*\\b${name}\\b[^;]*from '\\.\\./components/ProgressBar'`).test(files[file]);
    // Шкала доли выполненных: страница проекта (карточка и версии) и карточка колоды.
    expect(uses('screens/ProjectScreen.js', 'ProgressBar')).toBe(true);
    expect(uses('screens/ProjectsScreen.js', 'ProgressBar')).toBe(true);
    // «Цифры»: полосы «По проектам» и столбики недели; «Сегодня»: столбики недели.
    expect(uses('screens/StatsScreen.js', 'ProgressBar')).toBe(true);
    expect(uses('screens/StatsScreen.js', 'LiquidColumn')).toBe(true);
    expect(uses('screens/HomeScreen.js', 'LiquidColumn')).toBe(true);
    // Сколько раз каждая зовёт шкалу: проект — карточка и версии, колода и «Цифры» — по одной.
    const count = (file) => (files[file].match(/<ProgressBar\b/g) || []).length;
    expect(count('screens/ProjectScreen.js')).toBe(2);
    expect(count('screens/ProjectsScreen.js')).toBe(1);
    expect(count('screens/StatsScreen.js')).toBe(1);
  });

  test('«По проектам» — доля от лидера, а не «выполнено»: у неё нет «попа» на 100 %', () => {
    const src = Object.fromEntries(sources())['screens/StatsScreen.js'];
    expect(/<ProgressBar\b[^>]*celebrate=\{false\}/.test(src)).toBe(true);
  });
});

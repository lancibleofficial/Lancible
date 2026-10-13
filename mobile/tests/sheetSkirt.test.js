// «Юбка» нижнего листа (components/BottomSheet.js). Запуск: npm run test:mobile
//
// Лист выезжает на пружине с перелётом: на миг он поднимается выше своего
// места, и если фон кончается ровно у низа листа, снизу открывается его
// нижний край — щель между листом и низом экрана. Лечится продлением фона
// ниже экрана: «юбкой» не меньше самого большого перелёта. Тест не гадает по
// глазам, а считает: перелёт — из конфига пружины (и сверен численным
// расчётом той же пружины), юбка — не меньше него на любой высоте окна,
// стоит она вплотную к низу листа и едет вместе с ним.
import { Animated, DeviceEventEmitter, Dimensions, LayoutAnimation, Platform, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as keyboardController from 'react-native-keyboard-controller';
import BottomSheet, { SHEET_SPRING, springOvershoot, skirtHeight } from '../src/components/BottomSheet';
import RateSheet from '../src/components/RateSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const WINDOW = Dimensions.get('window').height;

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 } });
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const event of ['keyboardDidHide', 'keyboardWillHide']) DeviceEventEmitter.emit(event, { endCoordinates: { screenY: WINDOW, height: 0, width: 390, screenX: 0 } });
});
// Кадр выезда листа не должен выпасть после разбора окружения.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

/** Перелёт той же пружины, посчитанный шагами по формуле Animated.spring:
 *  x'' = −(k/m)·x − (c/m)·x', от 1 к 0. Минимум x — и есть перелёт. */
function simulatedOvershoot({ stiffness, damping, mass }) {
  const dt = 0.0001;
  let x = 1;
  let v = 0;
  let min = 0;
  for (let t = 0; t < 3; t += dt) {
    v += ((-stiffness * x - damping * v) / mass) * dt;
    x += v * dt;
    if (x < min) min = x;
  }
  return -min;
}

describe('пружина выезда и её перелёт', () => {
  test('пружина с перелётом — иначе юбка не нужна, а выезд потерял бы живость', () => {
    expect(springOvershoot(SHEET_SPRING)).toBeGreaterThan(0.01);
  });

  test('формула перелёта совпадает с численным расчётом той же пружины', () => {
    expect(springOvershoot(SHEET_SPRING)).toBeCloseTo(simulatedOvershoot(SHEET_SPRING), 3);
  });

  test('критически демпфированная пружина не перелетает', () => {
    expect(springOvershoot({ stiffness: 100, damping: 20, mass: 1 })).toBe(0);
    expect(springOvershoot({ stiffness: 100, damping: 40, mass: 1 })).toBe(0);
  });

  test.each([568, 667, 844, 932, 1024, 1366])('юбка на окне %i не меньше перелёта: лист едет на всю высоту окна', (h) => {
    const overshootPx = h * simulatedOvershoot(SHEET_SPRING);
    expect(skirtHeight(h)).toBeGreaterThanOrEqual(Math.ceil(overshootPx));
    // И с запасом — на округление и дробные пиксели, не вплотную.
    expect(skirtHeight(h)).toBeGreaterThan(overshootPx);
  });

  test('выезд и возврат после неоконченного жеста идут на той же пружине, из которой посчитана юбка', async () => {
    const spring = jest.spyOn(Animated, 'spring');
    openSheet(<RateSheet lang="ru" initialValue={500} onSave={() => {}} />);
    await render(<BottomSheet />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(spring).toHaveBeenCalled();
    for (const [, config] of spring.mock.calls) expect(config).toMatchObject(SHEET_SPRING);
  });
});

describe('юбка под листом', () => {
  async function show(areaH = WINDOW) {
    openSheet(<RateSheet lang="ru" initialValue={500} onSave={() => {}} />);
    const screen = await render(<BottomSheet />);
    await fireEvent(screen.getByTestId('sheet-overlay'), 'layout', { nativeEvent: { layout: { height: areaH } } });
    return screen;
  }

  test('есть, продлевает фон листа ниже экрана на перелёт и запас', async () => {
    const screen = await show();
    const skirt = flat(screen.getByTestId('sheet-skirt'));
    const sheet = flat(screen.getByTestId('sheet'));
    expect(skirt.height).toBe(skirtHeight(WINDOW));
    expect(skirt.height).toBeGreaterThanOrEqual(WINDOW * simulatedOvershoot(SHEET_SPRING));
    // Тот же фон, что у листа, — шва не видно.
    expect(skirt.backgroundColor).toBe(sheet.backgroundColor);
    expect(skirt.backgroundColor).toBeTruthy();
  });

  test('начинается ровно у низа листа и целиком ниже видимой части экрана', async () => {
    const screen = await show();
    const skirt = flat(screen.getByTestId('sheet-skirt'));
    expect(skirt.position).toBe('absolute');
    expect(skirt.left).toBe(0);
    expect(skirt.right).toBe(0);
    // Верх юбки — на нижней границе подложки: bottom = −height.
    expect(skirt.bottom).toBe(-skirt.height);
  });

  test('едет вместе с листом: один и тот же translateY, касаний не ловит', async () => {
    const screen = await show();
    const skirt = screen.getByTestId('sheet-skirt');
    const sheet = flat(screen.getByTestId('sheet'));
    // Не равные по виду, а один и тот же Animated.Value: рассинхронизироваться им нечем.
    expect(flat(skirt).transform[0].translateY).toBe(sheet.transform[0].translateY);
    expect(skirt.props.pointerEvents).toBe('none');
  });

  test('клавиатура подняла лист (iOS) — юбка стоит под ним, а не под экраном', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    const screen = await show(WINDOW);
    await act(async () => {
      DeviceEventEmitter.emit('keyboardWillShow', { endCoordinates: { screenY: WINDOW - 300, height: 300, width: 390, screenX: 0 } });
    });
    const skirt = flat(screen.getByTestId('sheet-skirt'));
    const lift = flat(screen.getByTestId('sheet-overlay')).paddingBottom;
    expect(lift).toBe(300);
    expect(skirt.bottom).toBe(lift - skirt.height);
  });

  // Android: подложку поднимает высота клавиатуры по кадрам (поток
  // интерфейса), а юбка едет на translateY — к ходу листа прибавлен тот же
  // подъём со знаком минус (Animated, нативный драйвер).
  test('клавиатура подняла лист (Android) — юбка едет вверх ровно на подъём подложки', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const kbUi = keyboardController.useReanimatedKeyboardAnimation().height;
    const kbNative = keyboardController.useKeyboardAnimation().height;
    const insets = useSafeAreaInsets();
    const was = insets.bottom;
    insets.bottom = 24;
    try {
      const screen = await show(WINDOW);
      const offset = () => {
        // Animated отдаёт виду текущие значения: числа хода листа и юбки.
        const skirtY = flat(screen.getByTestId('sheet-skirt')).transform[0].translateY;
        const sheetY = flat(screen.getByTestId('sheet')).transform[0].translateY;
        return skirtY - sheetY;
      };
      // Верх юбки — у нижнего края подложки; сдвигает её только translateY.
      const skirt = flat(screen.getByTestId('sheet-skirt'));
      expect(skirt.bottom).toBe(-skirt.height);
      expect(offset()).toBe(0);
      for (const h of [10, 150, 370]) {
        kbUi.value = -h;
        kbNative.setValue(-h);
        await screen.rerender(<BottomSheet />);
        const lift = flat(screen.getByTestId('sheet-overlay')).paddingBottom;
        expect(lift).toBe(Math.max(0, h - 24));
        expect(offset()).toBeCloseTo(-lift, 6);
      }
    } finally {
      insets.bottom = was;
      kbUi.value = 0;
      kbNative.setValue(0);
    }
  });
});

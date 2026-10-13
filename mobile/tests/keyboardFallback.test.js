// Приложение без нативной части клавиатуры (src/lib/keyboard.js). Запуск: npm run test:mobile
//
// Expo Go на iOS везёт не все нативные модули: react-native-keyboard-controller
// в нём нет, и библиотека бросает «doesn't seem to be linked» уже на импорте —
// 11 октября 2026 приложение падало так на старте. Весь этот файл живёт без
// неё: импорт библиотеки бросает, как в том Expo Go. Проверяется, что обёртка
// отдаёт заглушки (нули тех же типов, провайдер-обёртку, обычную прокрутку),
// приложение и нижний лист рисуются, а лист на Android встаёт над
// клавиатурой прежним путём — по keyboardDidShow.
import { Animated, DeviceEventEmitter, Dimensions, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { render, renderHook, fireEvent, act } from '@testing-library/react-native';
import {
  KEYBOARD_NATIVE, KeyboardProvider, KeyboardAwareScrollView, useKeyboardAnimation, useReanimatedKeyboardAnimation,
} from '../src/lib/keyboard';
import App from '../App';
import BottomSheet from '../src/components/BottomSheet';
import { HEADER_CONTENT_HEIGHT } from '../src/components/AppHeader';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { spacing } from '../src/theme';

jest.mock('react-native-keyboard-controller', () => {
  throw new Error("The package 'react-native-keyboard-controller' doesn't seem to be linked.");
});
// Приложение целиком без экранов: навигатор тянет все экраны, а проверяется
// здесь каркас App — провайдеры и нижний лист.
jest.mock('../src/navigation/RootNavigator', () => () => null);
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const WINDOW = Dimensions.get('window').height;
const FULL = WINDOW - HEADER_CONTENT_HEIGHT; // insets в тестах — нули (jest.setup.js)

let os;
const setOS = (name) => { os = jest.replaceProperty(Platform, 'OS', name); };
beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' } });
});
afterEach(() => {
  if (os) os.restore();
  os = null;
  for (const event of ['keyboardDidHide', 'keyboardWillHide']) DeviceEventEmitter.emit(event, { endCoordinates: { screenY: WINDOW, height: 0, width: 390, screenX: 0 } });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

test('нативной части нет — флаг опущен', () => {
  expect(KEYBOARD_NATIVE).toBe(false);
});

test('высоты клавиатуры — нули тех же типов, что у библиотеки', async () => {
  const { result, rerender } = await renderHook(() => useKeyboardAnimation());
  const animated = result.current;
  expect(animated.height).toBeInstanceOf(Animated.Value);
  expect(animated.progress).toBeInstanceOf(Animated.Value);
  expect(animated.height.__getValue()).toBe(0);
  expect(animated.progress.__getValue()).toBe(0);
  // Одни и те же значения на каждой отрисовке: интерполяции юбки не пересобираются.
  await rerender();
  expect(result.current).toBe(animated);

  const reanimated = (await renderHook(() => useReanimatedKeyboardAnimation())).result.current;
  expect(reanimated.height.value).toBe(0);
  expect(reanimated.progress.value).toBe(0);
});

test('провайдер просто отдаёт детей', async () => {
  const screen = await render(<KeyboardProvider statusBarTranslucent navigationBarTranslucent><Text>внутри</Text></KeyboardProvider>);
  expect(screen.getByText('внутри')).toBeTruthy();
});

describe('KeyboardAwareScrollView без библиотеки — прокрутка Reanimated', () => {
  const scrollProps = async () => {
    const screen = await render(
      <KeyboardAwareScrollView testID="scroll" bottomOffset={12} enabled extraKeyboardSpace={4} keyboardShouldPersistTaps="handled">
        <TextInput testID="field" />
      </KeyboardAwareScrollView>,
    );
    expect(screen.getByTestId('field')).toBeTruthy();
    return screen.getByTestId('scroll').props;
  };

  test('iOS: поле над клавиатурой держит система, тапы — как задал экран', async () => {
    setOS('ios');
    const props = await scrollProps();
    expect(props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(props.keyboardShouldPersistTaps).toBe('handled');
    expect(props.testID).toBe('scroll');
    // Свойства библиотеки обычной прокрутке не уходят.
    for (const name of ['bottomOffset', 'enabled', 'extraKeyboardSpace']) expect(props).not.toHaveProperty(name);
  });

  test('Android: без системной подстройки, остальное то же', async () => {
    setOS('android');
    const props = await scrollProps();
    expect(props.automaticallyAdjustKeyboardInsets).toBe(false);
    expect(props.keyboardShouldPersistTaps).toBe('handled');
  });
});

test('приложение рисуется, нижний лист открывается', async () => {
  const screen = await render(<App />);
  expect(screen.queryByTestId('sheet')).toBeNull();
  await act(async () => { openSheet(<Text>лист</Text>); });
  expect(screen.getByTestId('sheet')).toBeTruthy();
  expect(screen.getByText('лист')).toBeTruthy();
});

describe('нижний лист без кадров клавиатуры', () => {
  const show = async (areaH = 844) => {
    openSheet(<View><TextInput testID="field" /></View>);
    const screen = await render(<BottomSheet />);
    await fireEvent(screen.getByTestId('sheet-overlay'), 'layout', { nativeEvent: { layout: { height: areaH } } });
    return screen;
  };
  const keyboard = (event, screenY, height) => act(async () => {
    DeviceEventEmitter.emit(event, { endCoordinates: { screenY, height, width: 390, screenX: 0 } });
  });
  const overlay = (s) => flat(s.getByTestId('sheet-overlay'));
  const sheet = (s) => flat(s.getByTestId('sheet'));

  test('Android: лист встаёт над клавиатурой по keyboardDidShow, как до библиотеки', async () => {
    setOS('android');
    const screen = await show();
    expect(overlay(screen).paddingBottom).toBe(0);
    // Подложка — обычный вид, лист укорачивает maxHeight, а не поток интерфейса.
    expect(sheet(screen).flexShrink).toBeUndefined();
    expect(sheet(screen).maxHeight).toBe(FULL);

    await keyboard('keyboardDidShow', 844 - 300, 300);
    expect(overlay(screen).paddingBottom).toBe(300);
    expect(sheet(screen).maxHeight).toBe(Math.min(FULL, 844 - 300 - spacing.md));

    await keyboard('keyboardDidHide', 844, 0);
    expect(overlay(screen).paddingBottom).toBe(0);
    expect(sheet(screen).maxHeight).toBe(FULL);
  });
});

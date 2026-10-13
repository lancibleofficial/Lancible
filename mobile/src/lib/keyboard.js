// Клавиатура по кадрам — react-native-keyboard-controller. Этот файл —
// единственное место, откуда приложение берёт библиотеку (держит
// mobile/tests/keyboardModule.test.js).
//
// Нативная часть библиотеки есть в сборке APK (автолинковка) и в Expo Go на
// Android, но не в каждом Expo Go на iOS. Без неё библиотека падает уже при
// загрузке: TurboModuleRegistry.get('KeyboardController') отдаёт null, на его
// место встаёт Proxy, который бросает «doesn't seem to be linked» на любое
// обращение, а new NativeEventEmitter(…) в её bindings обращается к нему
// (addListener) тут же, на импорте. Поэтому require — в try/catch: упал —
// нативной части нет (KEYBOARD_NATIVE = false), и наружу идут заглушки, с
// которыми приложение живёт прежним путём:
// - провайдер просто отдаёт детей;
// - высоты клавиатуры — нули тех же типов, что у библиотеки (shared value
//   Reanimated и Animated.Value);
// - KeyboardAwareScrollView — прокрутка Reanimated (принимает анимированный
//   стиль, как настоящая); тапы при открытой клавиатуре — как задал экран
//   (keyboardShouldPersistTaps), а на iOS сфокусированное поле над клавиатурой
//   держит сама система (automaticallyAdjustKeyboardInsets).
// Нижний лист (components/BottomSheet.js) по KEYBOARD_NATIVE выбирает путь на
// Android: кадры клавиатуры или прежний подъём по keyboardDidShow.
import { forwardRef, useMemo } from 'react';
import { Animated, Platform } from 'react-native';
import Reanimated, { useSharedValue } from 'react-native-reanimated';

function load() {
  try {
    return require('react-native-keyboard-controller');
  } catch {
    return null;
  }
}

const lib = load();

/** Есть ли нативная часть библиотеки: высота клавиатуры приходит по кадрам. */
export const KEYBOARD_NATIVE = lib != null;

function PassThrough({ children }) {
  return children;
}

// Без нативной части клавиатуры «по кадрам» нет: высота и доля хода стоят на
// нуле. Animated.Value — общие на всё приложение (их никто не двигает),
// shared value — свои у компонента, как положено Reanimated.
const ZERO_ANIMATED = { height: new Animated.Value(0), progress: new Animated.Value(0) };

function useZeroKeyboardAnimation() {
  return ZERO_ANIMATED;
}

function useZeroReanimatedKeyboardAnimation() {
  const height = useSharedValue(0);
  const progress = useSharedValue(0);
  return useMemo(() => ({ height, progress }), [height, progress]);
}

const PlainKeyboardAwareScrollView = forwardRef(function PlainKeyboardAwareScrollView(
  // Свойства библиотеки обычной прокрутке не нужны — дальше не идут.
  // eslint-disable-next-line no-unused-vars
  { bottomOffset, disableScrollOnKeyboardHide, enabled, extraKeyboardSpace, mode, ScrollViewComponent, ...rest },
  ref,
) {
  return <Reanimated.ScrollView ref={ref} automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} {...rest} />;
});

export const KeyboardProvider = lib ? lib.KeyboardProvider : PassThrough;
export const useKeyboardAnimation = lib ? lib.useKeyboardAnimation : useZeroKeyboardAnimation;
export const useReanimatedKeyboardAnimation = lib ? lib.useReanimatedKeyboardAnimation : useZeroReanimatedKeyboardAnimation;
export const KeyboardAwareScrollView = lib ? lib.KeyboardAwareScrollView : PlainKeyboardAwareScrollView;

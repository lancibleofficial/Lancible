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
// - KeyboardAvoidingView — системный, React Native (поле чата над
//   клавиатурой).
// - события клавиатуры (KeyboardEvents) — заглушка, подписка на которую
//   ничего не ждёт: без нативной части события берёт у самого React Native
//   hooks/useKeyboardState.js.
// Нижний лист (components/BottomSheet.js) по KEYBOARD_NATIVE выбирает путь на
// Android: кадры клавиатуры или прежний подъём по keyboardDidShow.
import { forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, KeyboardAvoidingView as RNKeyboardAvoidingView } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedRef, measure, runOnUI, runOnJS } from 'react-native-reanimated';

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

// Поле внизу экрана над клавиатурой (вкладка «Чат-бот», 18 октября 2026):
// библиотека считает перекрытие по кадрам на потоке интерфейса — по рамке
// самого вида и верху клавиатуры, поэтому ей всё равно, что под видом
// (панель вкладок на Android, которая уходит, пока клавиатура открыта).
// Без нативной части — системный KeyboardAvoidingView: на iOS окно под
// клавиатуру не ужимается, и он поднимает содержимое сам; на Android окно
// ужимает система.
//
/** Верх вида в координатах корня — тех же, в которых библиотека считает
 *  клавиатуру и рамку вида (на Android measureInWindow отсчитывает от низа
 *  строки состояния, а приложение рисуется под ней: разница — её высота).
 *  Замер на потоке интерфейса (measure), ответ — в JS; вида нет — null.
 *  @param ref useAnimatedRef, привязанный к виду Reanimated */
export function measurePageTop(ref, cb) {
  runOnUI(() => {
    'worklet';
    const m = measure(ref);
    runOnJS(cb)(m ? m.pageY : null);
  })();
}

// automaticOffset (19 октября 2026: поле чата пряталось под клавиатурой) —
// свой, а не библиотечный. Оба считают перекрытие как «низ вида − верх
// клавиатуры», где низ вида — из onLayout, то есть ОТ РОДИТЕЛЯ, а верх
// клавиатуры — от верха окна. Над экраном чата стоит шапка стека, и без
// поправки перекрытие выходило меньше на её высоту. Библиотечный
// automaticOffset берёт место вида в окне нативно (viewPositionInWindow), но
// в новой архитектуре вид по номеру он не находит (uiManager.resolveView) и
// молча откатывается к рамке от родителя — замер на эмуляторе: шапка 72 dp,
// поле ушло под клавиатуру. Поэтому место мерит обёртка — пустым видом-зондом
// во всю площадь (measurePageTop: в координатах корня, как у библиотеки), —
// и отдаёт сдвиг как keyboardVerticalOffset: его понимают и библиотека, и
// системный.
const AvoidBase = lib ? lib.KeyboardAvoidingView : forwardRef(function PlainKeyboardAvoidingView({ behavior, ...rest }, ref) {
  return <RNKeyboardAvoidingView ref={ref} behavior={Platform.OS === 'ios' ? behavior : undefined} {...rest} />;
});

export const KeyboardAvoidingView = forwardRef(function KeyboardAvoidingView(
  { automaticOffset, keyboardVerticalOffset = 0, onLayout, children, ...rest },
  ref,
) {
  const probe = useAnimatedRef();
  const ownY = useRef(0);
  const [shift, setShift] = useState(0);
  const take = useCallback((top) => { if (Number.isFinite(top)) setShift(Math.max(0, top - ownY.current)); }, []);
  // Сдвиг — насколько вид ниже своего y от родителя.
  const remeasure = useCallback(() => { if (automaticOffset) measurePageTop(probe, take); }, [automaticOffset, take]);
  const layout = useCallback((e) => {
    if (onLayout) onLayout(e);
    ownY.current = e && e.nativeEvent && e.nativeEvent.layout ? e.nativeEvent.layout.y || 0 : 0;
    remeasure();
  }, [onLayout, remeasure]);
  return (
    <AvoidBase ref={ref} keyboardVerticalOffset={keyboardVerticalOffset + (automaticOffset ? shift : 0)} onLayout={layout} {...rest}>
      {automaticOffset ? <Reanimated.View ref={probe} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={remeasure} testID="keyboard-avoid-probe" /> : null}
      {children}
    </AvoidBase>
  );
});
// События клавиатуры по библиотеке (keyboardWillShow, keyboardDidShow, …:
// { height, duration, … }). Они знают то, чего не знает React Native:
// плавающая клавиатура (Gboard) и строка над физической — открыты с высотой 0
// (17 октября 2026, hooks/useKeyboardState.js).
const NO_EVENTS = Object.freeze({ addListener: () => ({ remove() {} }) });
export const KeyboardEvents = lib && lib.KeyboardEvents ? lib.KeyboardEvents : NO_EVENTS;

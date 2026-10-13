import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch as NativeSwitch, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import Icon from './Icon';
import { MaterialSwitchView } from '../../modules/lancible-material-switch';
import { useColors, switchSize } from '../theme';

// Единый переключатель приложения. На iOS — системный UISwitch: он родной и
// привычный, его не трогаем. На Android системный SwitchCompat RN рисует
// старый вид (зелёная дорожка, крупный белый кружок, слабый контраст), поэтому
// там настоящий MaterialSwitch из Material Components — локальным модулем
// modules/lancible-material-switch (NativeMaterialSwitch ниже). Модуль есть
// только в собранном APK; в Expo Go и в jest его нет, и тогда тот же
// переключатель рисуется на JS в стиле Material 3, на Reanimated, как
// остальные анимации проекта:
// - выкл — тёмная дорожка 52×32 (switchOff) с контуром (borderStrong), внутри
//   слева маленький белый кружок (textOnColor, 16);
// - вкл — зелёная дорожка (switchOn), белый кружок крупнее (24), справа,
//   внутри тёмная галочка `check` (accentText);
// - под пальцем кружок растёт до 28 — как у M3.
// Кружок белый в обоих положениях (просьба 12 октября; было: вкл — тёмный на
// акценте, выкл — серый). Белый на неоновом accent читается 1.9 : 1, поэтому у
// дорожки свои токены: switchOn — тот же зелёный на ступень глубже, switchOff
// — тёмная (в светлой теме — серая) дорожка. Всё цветное — токены темы, обе
// темы работают сами; кружок читается на своей дорожке с контрастом не ниже
// 3:1 (держит mobile/tests/switch.test.js).
//
// Выкл- и вкл-слои лежат друг под другом, и вкл-слой проявляется по opacity:
// так цвета остаются обычными стилями с токенами, а анимируются только
// положение, размер и прозрачность. Кружок не меняет размер, а сжимается
// transform: scale от своего центра — геометрия дорожки при этом не плывёт.
const { width: W, height: H, thumbOff, thumbOn, thumbPressed } = switchSize;
const D = thumbPressed; // коробка кружка — по самому большому его состоянию
const CENTER_OFF = H / 2;
const CENTER_ON = W - H / 2;
const SPRING = { damping: 18, stiffness: 260, mass: 0.7 };
// Минимальная зона касания M3 (minTouchTargetSize). Нативному виду hitSlop
// не помогает — касания ему раздаёт Android по его рамке.
const TOUCH = 48;

/** @param {boolean} value
 *  @param {(next: boolean) => void} onValueChange
 *  @param {string} [accessibilityLabel]
 *  @param {boolean} [disabled]
 *  @param {string} [testID] */
export default function Switch({ value, onValueChange, accessibilityLabel, disabled, testID }) {
  const colors = useColors();
  const checked = !!value;

  if (Platform.OS !== 'android') {
    return (
      <NativeSwitch
        testID={testID}
        value={checked}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.raise, true: colors.accent }}
        ios_backgroundColor={colors.raise}
        thumbColor={colors.textOnColor}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  const props = { checked, onValueChange, accessibilityLabel, disabled, testID, colors };
  return MaterialSwitchView ? <NativeMaterialSwitch {...props} /> : <MaterialSwitch {...props} />;
}

// Нативный MaterialSwitch: анимация, ореол нажатия и перетаскивание —
// системные. Значением управляет экран: касание только сообщает новое
// значение, а кружок едет, когда оно вернётся пропом value (экран вправе его
// не принять — как у рисованного варианта). Цвета — те же токены: вкл —
// дорожка switchOn, белый кружок, тёмная галочка accentText; выкл — дорожка
// switchOff с контуром borderStrong, белый кружок. Kotlin своих цветов не
// знает — собирает ColorStateList из этих пропов. В раскладке вид занимает
// 52×32, как рисованный, а рамкой (и зоной касания) выходит на 8 выше и
// ниже — до 48.
function NativeMaterialSwitch({ checked, onValueChange, accessibilityLabel, disabled, testID, colors }) {
  return (
    <MaterialSwitchView
      testID={testID}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled: !!disabled }}
      value={checked}
      disabled={!!disabled}
      trackOnColor={colors.switchOn}
      trackOffColor={colors.switchOff}
      outlineOffColor={colors.borderStrong}
      thumbOnColor={colors.textOnColor}
      thumbOffColor={colors.textOnColor}
      iconColor={colors.accentText}
      onValueChange={(e) => onValueChange && onValueChange(e.nativeEvent.value)}
      style={[styles.native, disabled && styles.disabled]}
    />
  );
}

function MaterialSwitch({ checked, onValueChange, accessibilityLabel, disabled, testID, colors }) {
  const [pressed, setPressed] = useState(false);

  // Цель анимации задана прямо в стиле: сменился checked или pressed —
  // пружина едет к новой цели с того места, где кружок сейчас.
  const thumbStyle = useAnimatedStyle(() => {
    const size = !checked && !pressed ? thumbOff : pressed ? thumbPressed : thumbOn;
    const center = checked ? CENTER_ON : CENTER_OFF;
    return {
      transform: [
        { translateX: withSpring(center - D / 2, SPRING) },
        { scale: withSpring(size / D, SPRING) },
      ],
    };
  }, [checked, pressed]);
  const onLayerStyle = useAnimatedStyle(() => ({ opacity: withSpring(checked ? 1 : 0, SPRING) }), [checked]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      onPress={() => onValueChange && onValueChange(!checked)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.track, disabled && styles.disabled]}
    >
      <View
        testID="switch-track-off"
        style={[StyleSheet.absoluteFill, styles.round, { backgroundColor: colors.switchOff, borderWidth: switchSize.border, borderColor: colors.borderStrong }]}
      />
      <Animated.View
        testID="switch-track-on"
        style={[StyleSheet.absoluteFill, styles.round, { backgroundColor: colors.switchOn }, onLayerStyle]}
      />
      <Animated.View testID="switch-thumb" style={[styles.thumbBox, thumbStyle]}>
        <View testID="switch-thumb-off" style={[styles.thumb, { backgroundColor: colors.textOnColor }]} />
        <Animated.View testID="switch-thumb-on" style={[StyleSheet.absoluteFill, styles.thumbOn, { backgroundColor: colors.textOnColor }, onLayerStyle]}>
          <Icon name="check" size={D * 0.7} color={colors.accentText} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H },
  native: { width: W, height: TOUCH, marginVertical: (H - TOUCH) / 2 },
  round: { borderRadius: H / 2 },
  disabled: { opacity: 0.5 },
  // Коробка кружка — квадрат D, левый край 0: translateX ставит его центр.
  thumbBox: { position: 'absolute', left: 0, top: (H - D) / 2, width: D, height: D },
  thumb: { width: D, height: D, borderRadius: D / 2 },
  thumbOn: { borderRadius: D / 2, alignItems: 'center', justifyContent: 'center' },
});

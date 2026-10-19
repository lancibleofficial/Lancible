// Барабан выбора — как у таймера в iOS и Samsung: числа крутятся, середина
// крупно и ярко, щелчок отклика на каждом делении, по кругу (после 59 —
// снова 00). Одинаковый на iOS и Android: системный выбор времени на
// Android — циферблат, не барабан.
//
// Устроен двумя слоями. Снизу — прокручиваемый список бледных чисел. Поверх
// него в полосе посередине — тот же список крупно и ярко, сдвинутый вместе
// с прокруткой и обрезанный полосой: число, переезжающее через край
// полосы, наполовину бледное, наполовину яркое — как на настоящем барабане.
// Без анимации на каждое число: дёшево и при сотнях строк.
//
// Заливка полосы — на верхнем слое и непрозрачная: она закрывает бледное
// число под собой. До 11 октября 2026 заливка лежала отдельным видом под
// списком, верхний слой был прозрачным, и бледное мелкое число просвечивало
// из-под крупного — выбранное значение двоилось («21 : 02» с тенью). Держит
// mobile/tests/wheelPicker.test.js.
//
// По кругу — повторением списка: значение стоит в средней копии, после
// остановки барабан незаметно возвращается в неё же.
//
// TimeWheels — время двумя барабанами через двоеточие (часы — все 24, минуты
// — все подряд): одна деталь на дедлайн (DueSheet) и рабочие часы
// (WorkHoursSheet), вынесена сюда 18 октября 2026.
import { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedScrollHandler, useAnimatedStyle, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Text from './AppText';
import { useColors, radius, spacing, displayFamily } from '../theme';

export const WHEEL_ITEM_H = 40;
const VISIBLE = 5;
const COPIES = 7;
const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** Индекс строки (в повторённом списке) → индекс значения. */
export function wheelValueIndex(row, len) {
  'worklet';
  return ((row % len) + len) % len;
}

/** Строка, на которой значение стоит в средней копии. */
export function wheelCenterRow(valueIndex, len) {
  return Math.floor(COPIES / 2) * len + valueIndex;
}

export default function WheelPicker({ values, value, onChange, format = String, width = 76, accessibilityLabel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const len = values.length;
  const rows = useMemo(() => Array.from({ length: len * COPIES }, (_, i) => values[i % len]), [values, len]);
  const startRow = wheelCenterRow(Math.max(0, values.indexOf(value)), len);
  const ref = useRef(null);
  const y = useSharedValue(startRow * WHEEL_ITEM_H);

  // contentOffset на старте понимают не все версии ScrollView на Android —
  // встаём на место ещё и явно.
  useEffect(() => { ref.current?.scrollTo({ y: startRow * WHEEL_ITEM_H, animated: false }); }, []);

  const onScroll = useAnimatedScrollHandler((e) => { y.value = e.contentOffset.y; });
  const tick = () => { Haptics.selectionAsync().catch(() => {}); };
  useAnimatedReaction(() => Math.round(y.value / WHEEL_ITEM_H), (row, prev) => {
    if (prev !== null && row !== prev) runOnJS(tick)();
  });

  function settle(offsetY) {
    const row = Math.round(offsetY / WHEEL_ITEM_H);
    const vi = wheelValueIndex(row, len);
    if (values[vi] !== value) onChange(values[vi]);
    const center = wheelCenterRow(vi, len);
    if (center !== row) ref.current?.scrollTo({ y: center * WHEEL_ITEM_H, animated: false });
  }

  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: -y.value }] }));

  return (
    <View style={[styles.wrap, { width }]} accessibilityRole="adjustable" accessibilityLabel={accessibilityLabel} accessibilityValue={{ text: format(value) }}>
      <Animated.ScrollView
        ref={ref}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: startRow * WHEEL_ITEM_H }}
        contentContainerStyle={styles.pad}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => {
          const v = e.nativeEvent.velocity;
          if (!v || Math.abs(v.y) < 0.05) settle(e.nativeEvent.contentOffset.y);
        }}
      >
        {rows.map((v, i) => (
          <View key={i} style={styles.row}><Text style={styles.faint}>{format(v)}</Text></View>
        ))}
      </Animated.ScrollView>
      <View style={styles.window} pointerEvents="none" testID="wheel-window">
        <Animated.View style={strip}>
          {rows.map((v, i) => (
            <View key={i} style={styles.row}><Text style={styles.strong}>{format(v)}</Text></View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

/** Время двумя барабанами: hour 0…23 и minute 0…59, по кругу. */
export function TimeWheels({ hour, minute, onHour, onMinute, accessibilityLabel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.timeRow}>
      <WheelPicker values={HOURS} value={hour} onChange={onHour} format={pad2} accessibilityLabel={accessibilityLabel} />
      <Text style={styles.timeColon}>:</Text>
      <WheelPicker values={MINUTES} value={minute} onChange={onMinute} format={pad2} accessibilityLabel={accessibilityLabel} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  timeColon: { color: colors.text, fontSize: 24, fontWeight: '700' },
  wrap: { height: WHEEL_ITEM_H * VISIBLE },
  pad: { paddingVertical: WHEEL_ITEM_H * Math.floor(VISIBLE / 2) },
  // Полоса выбора посередине: непрозрачная заливка закрывает бледный список.
  window: {
    position: 'absolute', left: 0, right: 0, top: WHEEL_ITEM_H * Math.floor(VISIBLE / 2), height: WHEEL_ITEM_H,
    overflow: 'hidden', borderRadius: radius.md, backgroundColor: colors.panel2,
  },
  row: { height: WHEEL_ITEM_H, alignItems: 'center', justifyContent: 'center' },
  faint: { color: colors.textFaint, fontSize: 18, fontVariant: ['tabular-nums'] },
  strong: { color: colors.text, fontSize: 24, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
});

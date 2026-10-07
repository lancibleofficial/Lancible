// Шапка экранов задачи и редактора — одна на оба: квадрат «назад», крошка
// «● проект › что открыто», справа квадратные кнопки. Пока по задаче идёт
// таймер, крошка уступает место плашке с пульсирующей точкой и часами:
// с любого из этих экранов видно, что время считается.
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import Icon from './Icon';
import Tap from './Tap';
import { fmtClock } from '../lib/format';
import { useColors, spacing, radius, displayFamily } from '../theme';

/** Квадратная кнопка шапки 36×36; on — залита акцентом. */
export function DetailButton({ icon, on, onPress, label }) {
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  return (
    <Tap scale={0.9} hitSlop={6} onPress={onPress} style={[styles.btn, on && styles.btnOn]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={17} color={on ? colors.accentText : colors.textDim} />
    </Tap>
  );
}

function Pulse({ color }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.25, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }, st]} />;
}

/**
 * @param color   цвет проекта (точка в крошке)
 * @param title   проект; sub — что открыто (статус задачи, название задачи)
 * @param onTitle тап по крошке
 * @param running идёт ли таймер этой задачи; runMs — сколько уже
 * @param right   кнопки справа (DetailButton)
 */
export default function DetailHeader({ onBack, backLabel, color, title, sub, onTitle, running, runMs, right }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  return (
    <View style={styles.head}>
      <Tap scale={0.9} hitSlop={8} onPress={onBack} style={styles.btn} accessibilityRole="button" accessibilityLabel={backLabel}>
        <Icon name="chevron-left" size={18} color={colors.text} />
      </Tap>
      <Tap style={styles.crumb} onPress={onTitle} disabled={!onTitle} hitSlop={6} accessibilityRole={onTitle ? 'button' : undefined}>
        {running ? (
          <View style={styles.pill} accessibilityLiveRegion="polite">
            <Pulse color={colors.accentInk} />
            <Text style={styles.pillClock}>{fmtClock(runMs || 0)}</Text>
          </View>
        ) : null}
        {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
        <Text style={styles.crumbText} numberOfLines={1}>{title || ''}</Text>
        {sub ? <Text style={styles.crumbFaint} numberOfLines={1}>› {sub}</Text> : null}
      </Tap>
      {right}
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: 6 },
  btn: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  btnOn: { backgroundColor: colors.accent },
  crumb: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  crumbText: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  crumbFaint: { color: colors.textFaint, fontSize: 13, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.accentMuted },
  pillClock: { color: colors.accentInk, fontSize: 13, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
});

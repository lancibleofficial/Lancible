// Строка, которую тянут влево ради одного действия (закрепить / открепить).
//
// Кнопки нет: строка едет за пальцем, а за её правым краем едет хвост с
// иконкой и подписью. За порогом хвост заливается акцентом и щёлкает
// хаптика — «отпустишь, и сработает». Отпустил за порогом — действие
// выполняется, строка пружиной возвращается на место. Не дотянул — просто
// возвращается.
//
// Хвост лежит внутри самой строки (left: 100%), а не отдельной подложкой
// под ней: подложка-соседка на Android получала нулевую высоту и из-под
// строки торчал только край иконки. Внутри строки высота у хвоста её же.
//
// Конфликт с вертикальной прокруткой решён порогами жеста: он включается,
// только когда палец ушёл влево на SLOP, и сдаётся, если раньше ушёл по
// вертикали — тогда список прокручивается как обычно.
import { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, Extrapolation, runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, fontSize } from '../theme';

/** Сколько протянуть, чтобы отпускание сработало. */
export const SWIPE_TRIGGER = 84;
const SLOP = 18;
// Пружина возврата: быстрая, с лёгким перелётом.
const BACK = { damping: 14, stiffness: 240, mass: 0.8 };

/** Резинка за порогом: после max строка едет всё медленнее. */
export function rubberBand(d, max) {
  'worklet';
  if (d <= max) return d;
  const over = d - max;
  return max + over * (1 - Math.min(0.85, over / (over + 160)));
}

/** Сработает ли отпускание при таком сдвиге влево (dx < 0). */
export function swipeFires(dx) {
  'worklet';
  return -dx >= SWIPE_TRIGGER;
}

export default function SwipeRow({ children, label, icon = 'pin', onAction, enabled = true, style }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const x = useSharedValue(0);
  const armed = useSharedValue(0);

  const buzz = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }, []);
  // Действие — когда строка почти вернулась: видно, что она встала на место,
  // и только потом задача переезжает (закреплённая уходит в «Сегодня»).
  const fire = useCallback(() => { setTimeout(() => onAction && onAction(), 180); }, [onAction]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(-SLOP)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      const dx = Math.min(0, e.translationX);
      x.value = -rubberBand(-dx, SWIPE_TRIGGER * 1.4);
      const on = swipeFires(dx) ? 1 : 0;
      if (on !== armed.value) {
        armed.value = on;
        runOnJS(buzz)();
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(fire)();
      armed.value = 0;
      x.value = withSpring(0, BACK);
    })
    .onFinalize(() => {
      if (x.value !== 0 && armed.value === 0) x.value = withSpring(0, BACK);
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: withTiming(armed.value, { duration: 120 }) }));
  const onStyle = useAnimatedStyle(() => ({ opacity: withTiming(armed.value, { duration: 120 }) }));
  // Значок и подпись стоят посередине открывшейся полосы и едут вместе с ней.
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-x.value, [0, SWIPE_TRIGGER * 0.5], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: Math.max(0, (-x.value - SWIPE_TRIGGER) / 2) },
      { scale: withSpring(armed.value ? 1.12 : interpolate(-x.value, [0, SWIPE_TRIGGER], [0.6, 1], Extrapolation.CLAMP), { damping: 12, stiffness: 300 }) },
    ],
  }));

  return (
    <View style={[styles.container, style]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          {children}
          <View style={styles.trail} pointerEvents="none">
            <Animated.View style={[styles.fill, fillStyle]} />
            <Animated.View style={[styles.action, iconStyle]}>
              <View>
                <Icon name={icon} size={16} color={colors.text} />
                <Animated.View style={[styles.on, onStyle]}><Icon name={icon} size={16} color={colors.accentText} /></Animated.View>
              </View>
              <View>
                <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
                <Animated.View style={[styles.on, onStyle]}>
                  <Text style={[styles.actionText, { color: colors.accentText }]} numberOfLines={1}>{label}</Text>
                </Animated.View>
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { overflow: 'hidden' },
  // Хвост шире любого сдвига: за резинкой строка уходит максимум на ~1.7
  // порога, и хвост закрывает всё открывшееся место.
  trail: { position: 'absolute', top: 0, bottom: 0, left: '100%', width: SWIPE_TRIGGER * 3, backgroundColor: colors.raise },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.accent },
  action: { position: 'absolute', top: 0, bottom: 0, left: 0, width: SWIPE_TRIGGER, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  on: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  actionText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
});

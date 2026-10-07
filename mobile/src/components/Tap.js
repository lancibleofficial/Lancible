// Нажимаемое с откликом: вместо затемнения — лёгкое сжатие на пружине
// (ease out, чуть пружинит обратно). Та же деталь на всех кнопках, строках
// и чипах; Pressable остаётся только там, где отклик не нужен (подложки).
//
// Принимает всё, что принимает Pressable. Стиль-функция Pressable
// (`({ pressed }) => [...]`) разворачивается в состоянии «не нажато»:
// нажатие и так показывает сжатие.
import { Pressable } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const DOWN = { damping: 16, stiffness: 420, mass: 0.6 };
const UP = { damping: 11, stiffness: 300, mass: 0.7 };

export default function Tap({ scale = 0.96, style, onPressIn, onPressOut, disabled, children, ...rest }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const base = typeof style === 'function' ? style({ pressed: false }) : style;
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[base, anim]}
      onPressIn={(e) => { if (!disabled) s.value = withSpring(scale, DOWN); if (onPressIn) onPressIn(e); }}
      onPressOut={(e) => { s.value = withSpring(1, UP); if (onPressOut) onPressOut(e); }}
    >
      {children}
    </AnimatedPressable>
  );
}

// Пульсирующая точка «время идёт»: в крошке шапки задачи и в плашке идущей
// задачи на iOS 26. Мерцает прозрачностью туда-обратно, без конца.
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';

export default function Pulse({ color, size = 8 }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.25, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, st]} />;
}

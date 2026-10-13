// Уход строки из списка: уменьшается, тает и схлопывается по высоте, а соседи
// подъезжают (их layout — MOVE из hooks/useOrderHold.js). Раньше строка,
// выпавшая из списка («Сегодня»: задачу отметили), исчезала в одном кадре и
// соседи прыгали. Карточка колоды «Проекты» ту же пару — «уменьшается и
// тает» — играет сама (CardRow).
//
// Это exiting у Animated.View строки. Высота схлопывается только под
// overflow: hidden у самой строки (стиль места), иначе содержимое торчит.
// «Уменьшение движения» — exiting не отдаётся вовсе, строка пропадает сразу.
import { Easing, withTiming } from 'react-native-reanimated';

/** Сколько строка уходит, мс; соседи за это время успевают подъехать
 *  (MOVE_MS = 220). */
export const ROW_EXIT_MS = 240;

/** exiting для Animated.View строки списка. */
export function rowExit(values) {
  'worklet';
  const timing = { duration: ROW_EXIT_MS, easing: Easing.in(Easing.cubic) };
  return {
    initialValues: { opacity: 1, height: values.currentHeight, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, timing),
      height: withTiming(0, timing),
      transform: [{ scale: withTiming(0.86, timing) }],
    },
  };
}

// Булавка закреплённой задачи — рядом с названием в строке (TaskRow,
// TaskListItem). Закрепили — булавка падает сверху с поворотом и втыкается:
// уходит чуть глубже, сплющивается от удара и отыгрывает (пружина
// PIN_SPRING, pinDrop). Открепили — выдёргивается вверх с поворотом в другую
// сторону и тает (PIN_OUT, pinLift), потом её нет в дереве. Числа и формы —
// lib/motion.js.
//
// keep — булавка остаётся в строке, пока задача закреплена (колода, «Сегодня»).
// Без keep (лента «Задачи» и список проекта, где закреплённые и так в своём
// разделе) она только втыкается — видно, что закрепление случилось, — и
// гаснет (PIN_LINGER_MS, PIN_FADE).
//
// Строку могут перерисовать заново посреди втыкания (переехала в раздел
// «Закреплённые»): свежая булавка втыкается с начала, если закрепили только
// что (freshPin по pinnedAt). Первая отрисовка в остальном — без движения;
// «уменьшение движения» — сразу на месте, без падения и вылета.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay, runOnJS } from 'react-native-reanimated';
import Icon from './Icon';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { PIN_SPRING, PIN_OUT, PIN_FADE, PIN_LINGER_MS, pinDrop, pinLift, freshPin } from '../lib/motion';
import { useColors } from '../theme';

/**
 * @param pinnedAt когда закрепили (ISO) или null
 * @param keep     оставаться в строке, пока закреплена
 * @param size     размер значка (12)
 */
export default function PinMark({ pinnedAt, keep = true, size = 12, style }) {
  const colors = useColors();
  const still = useReduceMotion();
  const pinned = !!pinnedAt;
  const dropNow = pinned && !still && freshPin(pinnedAt);
  const [shown, setShown] = useState(pinned && (keep || dropNow));
  const p = useSharedValue(dropNow ? 0 : 1);
  const q = useSharedValue(0);
  const fade = useSharedValue(0);
  const was = useRef(pinned);

  function drop() {
    q.value = 0;
    fade.value = 0;
    p.value = 0;
    p.value = withSpring(1, PIN_SPRING);
    if (!keep) fade.value = withDelay(PIN_LINGER_MS, withTiming(1, PIN_FADE, (done) => { if (done) runOnJS(setShown)(false); }));
  }

  function lift() {
    p.value = 1;
    fade.value = 0;
    q.value = 0;
    q.value = withTiming(1, PIN_OUT, (done) => { if (done) runOnJS(setShown)(false); });
  }

  // Строку перерисовали сразу после закрепления — булавка втыкается с начала.
  useEffect(() => {
    if (dropNow) drop();
  }, []);

  useEffect(() => {
    if (was.current === pinned) return;
    was.current = pinned;
    if (still) {
      p.value = 1;
      q.value = 0;
      fade.value = 0;
      setShown(pinned && keep);
      return;
    }
    setShown(true);
    if (pinned) drop();
    else lift();
  }, [pinned]);

  // Ось поворота и сплющивания — острие булавки (низ значка).
  const tip = size / 2;
  const anim = useAnimatedStyle(() => {
    const a = q.value > 0 ? pinLift(q.value) : pinDrop(p.value);
    return {
      opacity: a.o * (1 - fade.value),
      transform: [{ translateY: a.ty + tip }, { rotate: `${a.rot}deg` }, { scaleY: a.sy }, { translateY: -tip }],
    };
  });

  if (!shown) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.pin, { width: size, height: size }, style, anim]}
      testID="pin-mark"
    >
      <Icon name="pin" size={size} color={colors.textFaint} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center', justifyContent: 'center' },
});

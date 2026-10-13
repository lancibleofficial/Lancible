// Шкалы — одна деталь на все места: прогресс проекта в карточке колоды
// («5/9»), полосы «По проектам» в «Цифрах» (ProgressBar) и столбики недели
// там же (LiquidColumn). Значение не прыгает, а натекает: заливка едет к нему
// пружиной LIQUID.flow с перехлёстом (~0,55 с) — упругая остановка, — а
// передний край на ходу — капля: толще шкалы и вытянута вперёд, к концу пути
// садится в круглый торец (liquidBar, lib/liquid.js). Столбик на ходу тоньше
// (liquidColumn). Числа и формы — lib/liquid.js, карта — DESIGN.md, «Телефон»
// → «Жидкое движение».
//
// Появилась шкала — натекает от нуля; сменилось значение — от того места, где
// заливка сейчас (перебили на ходу — не прыгает). Вверх и вниз одинаково:
// задачу вернули — шкала так же жидко стекает к меньшему значению. «Уменьшение
// движения» — сразу на месте. iOS 26+ — как остальная жидкость там: без капли
// и перехлёста, шкала просто доползает (LIQUID.creep).
//
// Дошла до 100 % снизу (не появилась сразу полной) — как у галочки: заливка
// вспухает по толщине («поп») и из торца брызгают капли (LiquidDrops из
// Liquid.js). Без движения и на iOS 26+ — без «попа» и брызг.
import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay } from 'react-native-reanimated';
import { LiquidDrops, useDropsBurst, dropsLife } from './Liquid';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { LIQUID, BAR_POP_KICK, BAR_POP_DELAY, BAR_DROPS_ARC, liquidAllowed, liquidBar, liquidColumn } from '../lib/liquid';
import { useColors } from '../theme';

/** Размер, от которого считается разлёт брызг у торца (у галочки — её сторона). */
const DROPS_SIZE = 14;

/** Путь к значению: from → to по p (0 → 1). Без движения — сразу to. */
function useFlow(target) {
  const reduced = useReduceMotion();
  const liquid = !reduced && liquidAllowed();
  const from = useSharedValue(reduced ? target : 0);
  const to = useSharedValue(target);
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      from.value = target;
      to.value = target;
      p.value = 1;
      return;
    }
    // С того места, где заливка сейчас, — даже если она ещё в пути.
    const now = from.value + (to.value - from.value) * p.value;
    from.value = now;
    to.value = target;
    p.value = 0;
    p.value = liquid ? withSpring(1, LIQUID.flow) : withTiming(1, LIQUID.creep);
  }, [target, reduced]);
  return { from, to, p, liquid };
}

/**
 * Шкала прогресса.
 * @param value  доля 0…1
 * @param color  цвет заливки (по умолчанию accent; у проекта — его цвет)
 * @param height толщина (4)
 * @param style  поля вокруг; дорожка — panel2, своего скругления и
 *               overflow: hidden ей не дают — капля на конце выходит за неё
 * @param celebrate «поп» и брызги, когда шкала дошла до 100 % (true). Шкалам
 *               без «завершения» — относительным, где 100 % значит «самая
 *               большая» (полосы «По проектам»), — false
 * @param testID у дорожки; у заливки — `${testID}-fill`, у капли — `${testID}-head`,
 *               у брызг — `${testID}-drops`
 */
export default function ProgressBar({ value, color, height = 4, style, testID, accessibilityLabel, celebrate = true }) {
  const colors = useColors();
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const { from, to, p, liquid } = useFlow(v);
  const trackW = useSharedValue(0);
  const pop = useSharedValue(1);
  const [burst, startBurst] = useDropsBurst(dropsLife(BAR_POP_DELAY));
  const was = useRef(v);

  // Дошла до 100 % снизу: заливка доехала до конца — «поп» и брызги. Что
  // стояло полным с первой отрисовки, не играет.
  useEffect(() => {
    const before = was.current;
    was.current = v;
    if (!celebrate || !liquid || before >= 1 || v < 1) return;
    pop.value = 1;
    pop.value = withDelay(BAR_POP_DELAY, withSpring(1, { ...LIQUID.pop, velocity: BAR_POP_KICK }));
    startBurst();
  }, [v]);

  const fill = useAnimatedStyle(() => ({
    width: `${liquidBar(from.value, to.value, p.value, height).w * 100}%`,
    transform: [{ scaleY: pop.value }],
  }));
  const head = useAnimatedStyle(() => {
    const b = liquidBar(from.value, to.value, p.value, height);
    const end = b.w * trackW.value;
    const w = Math.min(b.headW, end);
    return {
      opacity: liquid && w >= 1 ? 1 : 0,
      left: end - w,
      top: (height - b.headH) / 2,
      width: w,
      height: b.headH,
      borderRadius: b.headH / 2,
      transform: [{ scaleY: pop.value }],
    };
  });

  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: colors.panel2 }, style]}
      onLayout={(e) => { trackW.value = e.nativeEvent.layout.width; }}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      testID={testID}
    >
      <Animated.View style={[styles.fill, { borderRadius: height / 2, backgroundColor: color || colors.accent }, fill]} testID={testID ? `${testID}-fill` : undefined} />
      <Animated.View pointerEvents="none" style={[styles.head, { backgroundColor: color || colors.accent }, head]} testID={testID ? `${testID}-head` : undefined} />
      {burst ? (
        <LiquidDrops
          key={burst.id}
          at={burst.at}
          delay={BAR_POP_DELAY}
          size={DROPS_SIZE}
          color={color}
          arc={BAR_DROPS_ARC}
          style={{ right: 0, top: height / 2 }}
          testID={testID ? `${testID}-drops` : 'bar-drops'}
          dropTestID="bar-drop"
        />
      ) : null}
    </View>
  );
}

/**
 * Столбик графика: высота в dp растёт от нуля и едет к новой той же
 * пружиной, на ходу столбик тоньше. style — сам столбик (ширина, цвет,
 * скругление); высоту задаёт height.
 */
export function LiquidColumn({ height, style, testID }) {
  const { from, to, p, liquid } = useFlow(Math.max(0, Number(height) || 0));
  const anim = useAnimatedStyle(() => {
    const c = liquidColumn(from.value, to.value, p.value);
    return { height: c.h, transform: [{ scaleX: liquid ? c.sx : 1 }] };
  });
  return <Animated.View style={[style, anim]} testID={testID} />;
}

const styles = StyleSheet.create({
  track: { position: 'relative' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  head: { position: 'absolute' },
});

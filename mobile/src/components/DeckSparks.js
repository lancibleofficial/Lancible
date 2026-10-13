// Искры на плашке у правого края колоды «Проектов» (ProjectsScreen →
// PhraseCard). Тянешь последнюю карточку влево — от фразы разлетаются
// четырёхлучевые звёздочки: где-то акцентные, где-то приглушённые, разного
// размера. До отпускания их положение, размер и прозрачность — функция
// величины оттяжки (amount: 0 — не тянут, 1 — порог, где щёлкает хаптика),
// посчитанная на UI-потоке на каждом кадре: искры едут ровно за пальцем, а
// за порогом стоят на своих местах, как на пороге, и ждут. Потянули назад —
// идут назад вместе с пальцем.
//
// Разлёт — только с отпусканием. Если палец отпущен за порогом (fired = 1, а в
// пасхалке 2; ставит жест колоды в onEnd), искры замирают на своих местах и разлетаются в
// стороны, каждая по своему направлению от фразы: растут, докручиваются и
// гаснут за BURST_MS (burst, 0 → 1, разовая анимация на событие). Дальше они
// не возвращаются — как бы ни шла пружина колоды и ни убывала оттяжка; новая
// оттяжка (fired снова 0) показывает их заново. Если отпустили до порога,
// взрыва нет: пружина колоды возвращает оттяжку к нулю, и они втягиваются и
// тают вместе с плашкой. Фраза на плашке при этом остаётся.
//
// «Уменьшение движения» (still): искры не летят и не растут — стоят на местах,
// проявляются по мере оттяжки, а при отпускании за порогом быстро гаснут на
// месте.
//
// Пасхалка (egg, 0…1 — плавный ход, считает плашка): когда плашку оттянули
// совсем далеко, она становится пурпурной, и искры перекрашиваются вместе с ней —
// приглушённые в жёлтый (eggSpark), акцентные в белый (textOnColor: зелёный
// accentInk на пурпуре светлой темы не виден — тот же по яркости, а на тёмной
// спорит с ним; белый читается на плашке в обеих темах). Перекраска — перекрёстное затухание двух слоёв одной звезды, а не
// цвет, посчитанный на ходу: оба цвета остаются токенами темы, ни смеси, ни
// разбора цвета в JS. Отпустили в пасхалке — плашка уходит серой (egg снимается),
// а искры разлетаются жёлтыми до конца взрыва: fired = 2 держит их цвет
// (sparkEgg), пока новая оттяжка не снимет защёлку.
//
// Искры — не иконки словаря (у Solar такой формы нет): это украшение из одной
// простой формы, как сценки пустых экранов. Цвета — только токены темы: акцент
// искр — accentInk (читается на светлой и тёмной плашке), приглушённый —
// textFaint.
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useAnimatedStyle, useAnimatedReaction, useSharedValue, withTiming, Easing,
} from 'react-native-reanimated';
import { useColors } from '../theme';

/** Одна искра. fx — куда по горизонтали от середины видимой плашки (−1…1,
 *  доля свободной ширины), dy — на сколько pt вверх (−) или вниз (+) от
 *  фразы, size — сторона, at — с какой поры оттяжки вылетает (0 — сразу,
 *  1 — последней), spin — на сколько градусов докручивается в полёте. Ближе
 *  46 pt к фразе не стоят: четыре строки текста занимают до ±34. */
export const SPARKS = [
  { fx: -0.62, dy: -52, size: 12, at: 0.00, spin: -80, tone: 'accent' },
  { fx: 0.50, dy: -78, size: 16, at: 0.25, spin: 60, tone: 'muted' },
  { fx: -0.15, dy: -104, size: 9, at: 0.55, spin: -50, tone: 'accent' },
  { fx: 0.80, dy: -46, size: 8, at: 0.80, spin: 90, tone: 'muted' },
  { fx: 0.45, dy: 54, size: 13, at: 0.10, spin: 70, tone: 'accent' },
  { fx: -0.70, dy: 80, size: 10, at: 0.35, spin: -60, tone: 'muted' },
  { fx: 0.05, dy: 106, size: 15, at: 0.60, spin: 50, tone: 'accent' },
  { fx: -0.30, dy: 48, size: 8, at: 0.90, spin: -90, tone: 'muted' },
];

// Искра начинает вылетать с этой доли порога (+ её at × SPARK_STAGGER) и
// долетает за SPARK_SPAN: самая поздняя — ровно к порогу.
const SPARK_FROM = 0.1;
const SPARK_STAGGER = 0.45;
const SPARK_SPAN = 0.45;
/** Сколько длится взрыв после отпускания за порогом, мс. */
export const BURST_MS = 520;
// Взрыв: на сколько pt искра улетает наружу по своему направлению, во сколько
// раз вырастает к концу и на какую долю своего поворота докручивается.
const BURST_DIST = 64;
const BURST_GROW = 1;
const BURST_SPIN = 1.2;
// Поле от края видимой плашки до центра искры, сверх её половины.
const EDGE = 4;

function clamp01(v) {
  'worklet';
  return Math.max(0, Math.min(1, v));
}

/** Как далеко долетела искра с задержкой at при оттяжке amount: 0 — ещё на
 *  фразе, 1 — на своём месте. */
export function sparkFlight(amount, at) {
  'worklet';
  return clamp01((amount - (SPARK_FROM + at * SPARK_STAGGER)) / SPARK_SPAN);
}

/** Состояние искры spec: оттяжка amount (0…1), видимая ширина плашки room,
 *  fired — отпустили ли палец за порогом в этой оттяжке, burst (0…1) — как
 *  далеко ушёл взрыв, still — «уменьшение движения». x и y — сдвиг от левого
 *  края плашки по середине её высоты (до центра искры, а не угла). После
 *  выстрела amount больше не читается: искры стоят, как на пороге, и
 *  расходятся по burst. */
export function sparkState(amount, spec, room, fired, burst, still) {
  'worklet';
  const f = sparkFlight(fired ? 1 : amount, spec.at);
  // Вылет замедляется к концу: искра выстреливает и оседает.
  const e = 1 - (1 - f) * (1 - f);
  // Без движения искра с самого начала стоит на своём месте, а проявляется
  // одной прозрачностью.
  const k = still ? 1 : e;
  const half = Math.max(0, room / 2 - spec.size / 2 - EDGE);
  const ox = spec.fx * half;
  const st = {
    opacity: clamp01(f / 0.3),
    scale: still ? 1 : e,
    x: room / 2 + ox * k,
    y: spec.dy * k,
    // + 0: у отрицательного spin на месте вышло бы -0 (и "-0deg" в стиле).
    rotate: still ? 0 : spec.spin * (1 - e) + 0,
  };
  if (!fired) return st;
  const b = clamp01(burst);
  if (still) {
    // Без разлёта: с отпусканием за порогом быстро гаснет там, где стоит.
    st.opacity *= 1 - clamp01(b / 0.35);
    return st;
  }
  // Наружу — по направлению от фразы к искре; вылет замедляется.
  const out = 1 - (1 - b) * (1 - b);
  const len = Math.max(1, Math.hypot(ox, spec.dy));
  st.x += (ox / len) * BURST_DIST * out;
  st.y += (spec.dy / len) * BURST_DIST * out;
  st.scale = e * (1 + BURST_GROW * out);
  st.rotate += spec.spin * BURST_SPIN * out;
  // Гаснет за всё время взрыва: сначала держится, потом тает до нуля.
  st.opacity *= 1 - clamp01((b - 0.15) / 0.85);
  return st;
}

// Четырёхлучевая звезда с вогнутыми боками.
const STAR = 'M12 1C12.9 8 16 11.1 23 12C16 12.9 12.9 16 12 23C11.1 16 8 12.9 1 12C8 11.1 11.1 8 12 1Z';

/** Насколько искра в цвете пасхалки, 0…1: ход egg, а с разлётом из пасхалки
 *  (fired = 2) — полностью, как бы ни ушла сама пасхалка. */
export function sparkEgg(egg, fired) {
  'worklet';
  return fired === 2 ? 1 : egg;
}

function Spark({ spec, index, amount, room, fired, burst, egg, still, color, eggColor }) {
  const style = useAnimatedStyle(() => {
    const s = sparkState(amount.value, spec, room.value, fired.value > 0, burst.value, still);
    return {
      opacity: s.opacity * (spec.tone === 'muted' ? 0.85 : 1),
      transform: [
        { translateX: s.x - spec.size / 2 },
        { translateY: s.y },
        { rotate: `${s.rotate}deg` },
        { scale: s.scale },
      ],
    };
  });
  // Два слоя одной звезды: обычный и пасхальный; ход egg перетекает из первого во второй.
  const plain = useAnimatedStyle(() => ({ opacity: 1 - sparkEgg(egg.value, fired.value) }));
  const lit = useAnimatedStyle(() => ({ opacity: sparkEgg(egg.value, fired.value) }));
  return (
    <Animated.View
      testID={`deck-spark-${index}`}
      style={[{ position: 'absolute', left: 0, top: '50%', width: spec.size, height: spec.size, marginTop: -spec.size / 2 }, style]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, plain]}>
        <Svg width={spec.size} height={spec.size} viewBox="0 0 24 24">
          <Path d={STAR} fill={color} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, lit]} testID={`deck-spark-${index}-egg`}>
        <Svg width={spec.size} height={spec.size} viewBox="0 0 24 24">
          <Path d={STAR} fill={eggColor} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

/** Слой искр поверх плашки, под фразой. amount и room — общие значения
 *  reanimated: оттяжка в долях порога и видимая ширина плашки; fired — защёлка
 *  жеста колоды (1 с отпускания за порогом до начала следующей оттяжки, 2 —
 *  если отпустили в пасхалке: взрыв жёлтыми); по её фронту запускается взрыв. burst — прогресс взрыва: свой, но его можно
 *  подставить (тесты: в подмене reanimated анимации не идут). egg — ход
 *  пасхалки, 0…1 (0 — обычные цвета, 1 — приглушённые жёлтые); не передан —
 *  пасхалки нет. */
export default function DeckSparks({ amount, room, fired, egg: eggGiven, burst: given, still = false }) {
  const colors = useColors();
  const own = useSharedValue(0);
  const burst = given || own;
  const noEgg = useSharedValue(0);
  const egg = eggGiven || noEgg;
  useAnimatedReaction(
    () => fired.value,
    (now, prev) => {
      if (now > 0 && !(prev > 0)) burst.value = withTiming(1, { duration: BURST_MS, easing: Easing.out(Easing.quad) });
      // Новая оттяжка: взрыв сброшен, искры снова идут за пальцем.
      else if (!(now > 0) && prev > 0) burst.value = 0;
    },
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="deck-sparks" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {SPARKS.map((spec, i) => (
        <Spark
          key={i}
          index={i}
          spec={spec}
          amount={amount}
          room={room}
          fired={fired}
          burst={burst}
          egg={egg}
          still={still}
          color={spec.tone === 'accent' ? colors.accentInk : colors.textFaint}
          eggColor={spec.tone === 'accent' ? colors.textOnColor : colors.eggSpark}
        />
      ))}
    </View>
  );
}

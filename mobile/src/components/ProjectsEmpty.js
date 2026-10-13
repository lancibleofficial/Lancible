// «Проекты» без единого проекта — первый экран нового человека, поэтому
// богаче обычного пустого: крупная колода карточек (сценка projects из
// core/illustrations.js), под ней заголовок, три коротких пункта — что даёт
// проект — и одна акцентная кнопка, тот же лист нового проекта, что «+» у
// колоды. Пустой гигантской карточки больше нет: экран законченный сам.
//
// Сценка разложена на слои — подложка, две задние карточки, передняя и
// искра — и при появлении карточки раскрываются веером из-за передней, а
// искра вспыхивает последней и потом изредка поблёскивает (поворот на
// четверть: у четырёхлучевой искры он незаметен на стыке, повтор без шва).
// Играет только сценка: заголовок и пункты стоят сразу, страница не
// проявляется (DESIGN.md, «Без появления из нуля»). Включено «уменьшение
// движения» — сценка рисуется целиком и стоит.
import { useEffect, useMemo } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Svg from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withRepeat, withSequence, cancelAnimation, Easing,
} from 'react-native-reanimated';
import Text from './AppText';
import Icon from './Icon';
import Island, { IslandRow } from './Island';
import PrimaryButton from './PrimaryButton';
import ArtScene, { ArtShapes } from './ArtScene';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { artElements, pathBox } from '../lib/art';
import { useColors, spacing, screenPadding, radius, fontSize, displayFamily, typography } from '../theme';
import { t } from '../lib/i18n';

const FRAME = { x: 0, y: 0, width: 120, height: 88 };
// Раскрытие колоды и вспышка искры — одним ходом, части берут свои отрезки.
const OPEN = { duration: 900, easing: Easing.out(Easing.cubic) };
// Блеск искры: пауза, поворот на четверть с лёгким вдохом, снова пауза.
const GLINT_PAUSE = 2600;
const GLINT = { duration: 900, easing: Easing.inOut(Easing.quad) };

/** Слои сценки «Проекты»: подложка, задние карточки (es-back), искра —
 *  последняя форма, контур акцентом, — и всё остальное спереди. */
export function deckLayers(shapes) {
  const plate = shapes.filter((s) => s.parts.includes('es-plate'));
  const backs = shapes.filter((s) => s.parts.includes('es-back'));
  const last = shapes[shapes.length - 1];
  const spark = last && last.tag === 'path' && last.parts.includes('es-mark') ? [last] : [];
  const front = shapes.filter((s) => !plate.includes(s) && !backs.includes(s) && !spark.includes(s));
  return { plate, backs, front, spark };
}

/** Доля отрезка [a, b] пройденного хода v — 0…1. */
const seg = (v, a, b) => {
  'worklet';
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
};
const mix = (a, b, k) => {
  'worklet';
  return a + (b - a) * k;
};

/** Слой сценки — свой <Svg> на кусок рамки (box), в масштабе k. */
function Layer({ shapes, colors, k, box = FRAME, style, testID }) {
  return (
    <Animated.View testID={testID} style={[{ position: 'absolute', left: box.x * k, top: box.y * k, width: box.width * k, height: box.height * k }, style]}>
      <Svg width={box.width * k} height={box.height * k} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}>
        <ArtShapes shapes={shapes} colors={colors} />
      </Svg>
    </Animated.View>
  );
}

/** Колода с анимацией появления. Начальное положение — карточки сложены за
 *  передней, искры нет; ход p ведёт всё к сценке как она нарисована. */
function DeckMotion({ width, height, colors }) {
  const k = width / FRAME.width;
  const layers = useMemo(() => deckLayers(artElements('projects')), []);
  const sparkBox = useMemo(() => {
    if (!layers.spark.length) return FRAME;
    const b = pathBox(layers.spark[0].attrs.d);
    return { x: b.x - 1, y: b.y - 1, width: b.width + 2, height: b.height + 2 };
  }, [layers]);
  const p = useSharedValue(0);
  const glint = useSharedValue(0);

  useEffect(() => {
    p.value = withTiming(1, OPEN);
    glint.value = withDelay(OPEN.duration, withRepeat(withSequence(
      withDelay(GLINT_PAUSE, withTiming(1, GLINT)),
      withTiming(0, { duration: 0 }),
    ), -1, false));
    return () => { cancelAnimation(p); cancelAnimation(glint); };
  }, []);

  const plate = useAnimatedStyle(() => ({
    opacity: seg(p.value, 0, 0.3),
    transform: [{ scale: mix(0.92, 1, seg(p.value, 0, 0.45)) }],
  }));
  // Задние карточки выходят из-за передней: каждая — от своего угла к нулю.
  const backLeft = useAnimatedStyle(() => {
    const e = seg(p.value, 0.12, 0.7);
    return { opacity: seg(p.value, 0.08, 0.4), transform: [{ translateX: mix(15 * k, 0, e) }, { rotate: `${mix(12, 0, e)}deg` }] };
  });
  const backRight = useAnimatedStyle(() => {
    const e = seg(p.value, 0.18, 0.76);
    return { opacity: seg(p.value, 0.12, 0.44), transform: [{ translateX: mix(-15 * k, 0, e) }, { rotate: `${mix(-10, 0, e)}deg` }] };
  });
  const front = useAnimatedStyle(() => {
    const e = seg(p.value, 0, 0.55);
    return { opacity: seg(p.value, 0, 0.3), transform: [{ translateY: mix(10 * k, 0, e) }, { scale: mix(0.95, 1, e) }] };
  });
  const spark = useAnimatedStyle(() => {
    const e = seg(p.value, 0.55, 1);
    const g = glint.value;
    return {
      opacity: e,
      transform: [
        { rotate: `${mix(-90, 0, e) + 90 * g}deg` },
        { scale: mix(0.2, 1, e) * (1 + 0.22 * Math.sin(Math.PI * g)) },
      ],
    };
  });

  const [left, right] = layers.backs;
  return (
    <View testID="projects-art-motion" style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Layer shapes={layers.plate} colors={colors} k={k} style={plate} />
      {left ? <Layer shapes={[left]} colors={colors} k={k} style={backLeft} /> : null}
      {right ? <Layer shapes={[right]} colors={colors} k={k} style={backRight} /> : null}
      <Layer shapes={layers.front} colors={colors} k={k} style={front} testID="projects-art-front" />
      <Layer shapes={layers.spark} colors={colors} k={k} box={sparkBox} style={spark} />
    </View>
  );
}

/** Пункт «что даёт проект»: значок на акцентной подложке, название, строка. */
function Point({ icon, title, text, first, styles, colors }) {
  return (
    <IslandRow first={first} style={styles.point}>
      <View style={styles.pointIcon}><Icon name={icon} size={17} color={colors.accentInk} /></View>
      <View style={styles.pointBody}>
        <Text style={styles.pointTitle}>{title}</Text>
        <Text style={styles.pointText}>{text}</Text>
      </View>
    </IslandRow>
  );
}

export default function ProjectsEmpty({ lang, onCreate }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const still = useReduceMotion();
  const { width } = useWindowDimensions();
  // Крупная сценка: вдвое больше обычной, но с полями по краям экрана.
  const artW = Math.round(Math.min(240, width - 2 * spacing.xxl));
  const artH = Math.round((artW * FRAME.height) / FRAME.width);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false} testID="projects-empty">
      <View style={styles.col}>
        {still ? (
          <View testID="projects-art-still"><ArtScene name="projects" width={artW} height={artH} /></View>
        ) : (
          <DeckMotion width={artW} height={artH} colors={colors} />
        )}
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">{t(lang, 'empty.projects_title')}</Text>
          <Text style={styles.lead}>{t(lang, 'empty.projects_text')}</Text>
        </View>
        <Island padded={false} style={styles.points}>
          <Point first icon="board" title={t(lang, 'empty.projects_tasks')} text={t(lang, 'empty.projects_tasks_text')} styles={styles} colors={colors} />
          <Point icon="stopwatch" title={t(lang, 'empty.projects_timer')} text={t(lang, 'empty.projects_timer_text')} styles={styles} colors={colors} />
          <Point icon="wallet" title={t(lang, 'empty.projects_money')} text={t(lang, 'empty.projects_money_text')} styles={styles} colors={colors} />
        </Island>
        <PrimaryButton title={t(lang, 'empty.create_project')} icon="plus" onPress={onCreate} />
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  scroll: { flex: 1 },
  wrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: screenPadding, paddingVertical: spacing.lg },
  col: { width: '100%', maxWidth: 400, alignSelf: 'center', alignItems: 'center', gap: spacing.lg },
  head: { alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontFamily: displayFamily.bold, textAlign: 'center' },
  lead: { ...typography.caption, lineHeight: 20, color: colors.textDim, textAlign: 'center' },
  points: { alignSelf: 'stretch', paddingVertical: 2 },
  point: { paddingHorizontal: spacing.md, gap: spacing.md, paddingVertical: spacing.md },
  pointIcon: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  pointBody: { flex: 1, minWidth: 0, gap: 1 },
  pointTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  pointText: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
});

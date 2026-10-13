// Плашка идущей задачи — над таббаром на всех корневых экранах (макет B2:
// квадрат «стоп» слева, название, под ним цвет и имя проекта с заработком,
// справа время).
//
// Зачем: таймер запускают на странице задачи и уходят работать дальше. Без
// плашки единственный способ узнать, идёт ли он и сколько набежало, —
// вернуться в ту самую задачу; а единственный способ остановить — тоже.
//
// Где живёт: на iOS 26+ это нативный bottomAccessory нативного таббара (см.
// MainTabs.ios.js) — там стеклянную капсулу рисует система, и плашка своя,
// TimerAccessory: без фона и рамки, заполняет капсулу, как системные
// плееры. Везде ещё — полоса над таббаром (MainTabBar.js) со своей подложкой.
import { useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Tap from './Tap';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useLiquidEnabled, useLiquidPresence, useMorphStyles } from './Liquid';
import Text from './AppText';
import Icon from './Icon';
import Pulse from './Pulse';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { useTicker } from '../hooks/useTicker';
import { fmtClock, fmtMoney, earnedOf, earnedShown } from '../lib/format';
import { useColors, spacing, screenPadding, radius, fontSize, displayFamily, tabBarClearance, taskControlRadius } from '../theme';
import { t } from '../lib/i18n';

export const MINI_PLAYER_HEIGHT = 56;
/** Скругление плашки в покое (капля — круглая). */
const PLATE_RADIUS = 18;

/** Идёт ли таймер по задаче, которая ещё существует. Задачу могли удалить —
 *  тогда плашки быть не должно, а не должно быть падения. */
export function useRunningTask() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const tasks = useAppStore((s) => s.tasks);
  if (!activeTimer) return null;
  return getTask(tasks, activeTimer.taskId);
}

/** Нижний отступ для прокручиваемого содержимого корневых экранов: запас
 *  под таббар плюс, пока идёт таймер, ещё и под плашку над ним — чтобы
 *  последнюю строку можно было докрутить выше плашки. Только для прокрутки:
 *  сама плашка лежит поверх страницы, и раскладку экрана двигать нельзя.
 *
 *  Запас под таббар — только там, где он плавает над страницей (iOS: системная
 *  панель, страница идёт под неё, `tabBarClearance`). На Android панель
 *  (MainTabBar) стоит в раскладке под страницей и закрывать нечего: те же 108
 *  оставляли под последней строкой пустое поле высотой в панель — «Меню»
 *  докручивалось до пустоты. Там остаётся обычный нижний отступ страницы. */
export function useBottomClearance() {
  const task = useRunningTask();
  const bar = Platform.OS === 'ios' ? tabBarClearance : spacing.lg;
  return bar + (task ? MINI_PLAYER_HEIGHT + spacing.sm : 0);
}

/** Что показывает плашка: задача, проект, сколько набежало, подпись. */
function useRunningInfo() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const projects = useAppStore((s) => s.projects);
  const settings = useAppStore((s) => s.settings);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const rates = useRates();
  const task = useRunningTask();
  const lang = settings.lang;
  useTicker(!!task);
  if (!task) return { task: null, lang, stopTimer };
  const project = getProject(projects, task.projectId);
  const elapsed = (task.totalMs || 0) + (activeTimer ? Date.now() - new Date(activeTimer.startedAt).getTime() : 0);
  const earned = earnedOf(task, rates, activeTimer);
  const sub = [project ? project.name : null, earnedShown(task, rates, earned) ? fmtMoney(earned, lang, currencyOf(project, settings)) : null]
    .filter(Boolean).join(' · ');
  return { task, project, elapsed, sub, lang, stopTimer };
}

/**
 * iOS 26+: содержимое системной стеклянной капсулы над панелью вкладок.
 * Своего фона нет — только точка «идёт», название, время и «стоп» простой
 * иконкой, как у системных плееров.
 * @param placement 'regular' — над панелью; 'inline' — рядом со свёрнутой
 *                  панелью, места мало: точка, время и «стоп»
 */
export function TimerAccessory({ placement = 'regular', onOpen }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { task, project, elapsed, sub, lang, stopTimer } = useRunningInfo();
  if (!task) return null;
  const inline = placement === 'inline';
  const title = task.title || t(lang, 'task.no_name');
  return (
    <Tap scale={0.98} style={[styles.acc, inline && styles.accInline]} onPress={() => onOpen(task.id)} accessibilityRole="button" accessibilityLabel={title}>
      <Pulse color={project ? project.color : colors.accentInk} />
      {inline ? null : (
        <View style={styles.main}>
          <Text style={styles.accTitle} numberOfLines={1}>{title}</Text>
          {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      )}
      <Text style={[styles.accClock, inline && styles.accClockInline]}>{fmtClock(elapsed)}</Text>
      <Tap scale={0.85} onPress={stopTimer} hitSlop={8} style={styles.accStop} accessibilityRole="button" accessibilityLabel={t(lang, 'timer.stop')}>
        <Icon name="stop" size={inline ? 16 : 18} color={colors.text} />
      </Tap>
    </Tap>
  );
}

/**
 * Плашка над панелью вкладок (Android, iOS ниже 26). Появляется и уходит
 * жидко: из края у «стопа» набухает капля и вытягивается в плашку, при
 * остановке плашка стягивается обратно в каплю и исчезает (components/Liquid.js).
 * @param presence есть ли плашка — от того, кто держит под неё место
 *                 (MainTabBar: отступ над панелью живёт, пока плашка уходит);
 *                 без него плашка решает сама
 */
export default function TimerMiniPlayer({ onOpen, presence }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const info = useRunningInfo();
  const enabled = useLiquidEnabled();
  // Своя — только без presence сверху; иначе молчит.
  const own = useLiquidPresence(presence ? false : !!info.task, enabled && !presence);
  const shown = presence || own;
  // Уходя, плашка дорисовывает последнее, что показывала: задачи в сторе уже нет.
  const last = useRef(null);
  if (info.task) last.current = info;
  const width = useSharedValue(0);
  const morph = useMorphStyles(shown.p, width, MINI_PLAYER_HEIGHT, PLATE_RADIUS, { fill: true });

  if (!shown.mounted || !last.current) return null;
  const { task, project, elapsed, sub, lang, stopTimer } = last.current;
  const leaving = !info.task;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Tap
        style={styles.pill}
        onLayout={(e) => { width.value = e.nativeEvent.layout.width; }}
        onPress={() => onOpen(task.id)}
        pointerEvents={leaving ? 'none' : 'auto'}
        accessibilityRole="button"
        accessibilityLabel={task.title || t(lang, 'task.no_name')}
      >
        <Animated.View style={[styles.plate, morph.plate]} testID="mini-player-plate" />
        <Animated.View style={[styles.row, morph.content]}>
          <Tap
            onPress={stopTimer}
            hitSlop={8}
            style={styles.stop}
            accessibilityRole="button"
            accessibilityLabel={t(lang, 'timer.stop')}
          >
            <Icon name="stop" size={15} color={colors.accentText} />
          </Tap>
          <View style={styles.main}>
            <Text style={styles.title} numberOfLines={1}>{task.title || t(lang, 'task.no_name')}</Text>
            <View style={styles.subRow}>
              <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
              <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
            </View>
          </View>
          <Text style={styles.clock}>{fmtClock(elapsed)}</Text>
        </Animated.View>
      </Tap>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { paddingHorizontal: screenPadding },
  // Нажимается вся плашка; подложка и содержимое — слоями внутри: подложка
  // тянется каплей, содержимое проявляется поверх.
  pill: { justifyContent: 'center' },
  // Лежит поверх страницы: своя поверхность (белая на светлой) и мягкая
  // тень вместо серой заливки с рамкой. Тень — boxShadow, равномерно
  // размытая со всех сторон: системная тень Android (elevation) темнела к
  // середине нижнего края и выглядела грязно. Размер и скругление — от
  // капли (useMorphStyles), в покое — во всю ширину, высота плашки.
  plate: {
    position: 'absolute', left: 0,
    backgroundColor: colors.floating,
    boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 18, spreadDistance: 0, color: colors.shadow }],
  },
  row: {
    height: MINI_PLAYER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    paddingLeft: spacing.sm, paddingRight: spacing.md,
  },
  stop: { width: 38, height: 38, borderRadius: taskControlRadius, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  sub: { color: colors.textFaint, fontSize: 11.5, flexShrink: 1 },
  clock: { color: colors.text, fontSize: 17, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  // iOS 26: капсулу рисует система — свой фон, рамку и высоту не задаём,
  // заполняем то, что дали.
  acc: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingLeft: spacing.lg, paddingRight: spacing.xs },
  accInline: { gap: spacing.sm, paddingLeft: spacing.md },
  accTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  accClock: { color: colors.text, fontSize: 15, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  accClockInline: { flex: 1 },
  accStop: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});

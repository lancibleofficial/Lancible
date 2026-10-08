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
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Text from './AppText';
import Icon from './Icon';
import Pulse from './Pulse';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { useTicker } from '../hooks/useTicker';
import { fmtClock, fmtMoney, earnedOf, earnedShown } from '../lib/format';
import { useColors, spacing, radius, fontSize, displayFamily, tabBarClearance } from '../theme';
import { t } from '../lib/i18n';

export const MINI_PLAYER_HEIGHT = 56;
const FADE_MS = 200;

/** Идёт ли таймер по задаче, которая ещё существует. Задачу могли удалить —
 *  тогда плашки быть не должно, а не должно быть падения. */
export function useRunningTask() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const tasks = useAppStore((s) => s.tasks);
  if (!activeTimer) return null;
  return getTask(tasks, activeTimer.taskId);
}

/** Нижний отступ для прокручиваемого содержимого корневых экранов: запас
 *  под таббар плюс, пока идёт таймер, ещё и под плашку над ним. */
export function useBottomClearance() {
  const task = useRunningTask();
  return tabBarClearance + (task ? MINI_PLAYER_HEIGHT + spacing.sm : 0);
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

export default function TimerMiniPlayer({ onOpen }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { task, project, elapsed, sub, lang, stopTimer } = useRunningInfo();

  const opacity = useSharedValue(0);
  const shift = useSharedValue(8);
  useEffect(() => {
    const show = !!task;
    opacity.value = withTiming(show ? 1 : 0, { duration: FADE_MS });
    shift.value = withTiming(show ? 0 : 8, { duration: FADE_MS });
  }, [task]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: shift.value }] }));

  if (!task) return null;

  return (
    <Animated.View style={[styles.wrap, anim]} pointerEvents="box-none">
      <Tap style={styles.pill} onPress={() => onOpen(task.id)} accessibilityRole="button" accessibilityLabel={task.title || t(lang, 'task.no_name')}>
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
      </Tap>
    </Animated.View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md },
  pill: {
    height: MINI_PLAYER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    paddingLeft: spacing.sm, paddingRight: spacing.md,
    backgroundColor: colors.panel2, borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  stop: { width: 38, height: 38, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
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

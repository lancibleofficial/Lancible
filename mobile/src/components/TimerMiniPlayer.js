// Плашка идущей задачи — над таббаром на всех корневых экранах (макет B2:
// квадрат «стоп» слева, название, под ним цвет и имя проекта с заработком,
// справа время).
//
// Зачем: таймер запускают на странице задачи и уходят работать дальше. Без
// плашки единственный способ узнать, идёт ли он и сколько набежало, —
// вернуться в ту самую задачу; а единственный способ остановить — тоже.
//
// Где живёт: на iOS 26+ это нативный bottomAccessory нативного таббара (см.
// MainTabs.ios.js). Везде ещё — полоса над таббаром (MainTabBar.js). Поэтому
// компонент ничего не знает о своём положении: только рисует содержимое.
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Text from './AppText';
import Icon from './Icon';
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

export default function TimerMiniPlayer({ onOpen }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const projects = useAppStore((s) => s.projects);
  const settings = useAppStore((s) => s.settings);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const rates = useRates();
  const task = useRunningTask();
  const lang = settings.lang;

  useTicker(!!task);

  const opacity = useSharedValue(0);
  const shift = useSharedValue(8);
  useEffect(() => {
    const show = !!task;
    opacity.value = withTiming(show ? 1 : 0, { duration: FADE_MS });
    shift.value = withTiming(show ? 0 : 8, { duration: FADE_MS });
  }, [task]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: shift.value }] }));

  if (!task) return null;

  const project = getProject(projects, task.projectId);
  const elapsed = (task.totalMs || 0) + (activeTimer ? Date.now() - new Date(activeTimer.startedAt).getTime() : 0);
  const earned = earnedOf(task, rates, activeTimer);
  const sub = [project ? project.name : null, earnedShown(task, rates, earned) ? fmtMoney(earned, lang, currencyOf(project, settings)) : null]
    .filter(Boolean).join(' · ');

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
});

// Мини-плеер идущего таймера — полоса над таббаром на всех корневых экранах.
//
// Зачем: таймер запускают на странице задачи и уходят работать дальше. Без
// плеера единственный способ узнать, идёт ли он и сколько уже набежало, —
// вернуться в ту самую задачу; а единственный способ остановить — тоже.
//
// Где живёт: на iOS 26+ это нативный bottomAccessory нативного таббара (см.
// MainTabs.ios.js) — UIKit сам кладёт его над панелью и сам ведёт себя при
// прокрутке. Везде ещё — абсолютная полоса над таббаром (MainTabBar.js).
// Поэтому компонент ничего не знает о своём положении: он только рисует
// содержимое, а размещает его тот, кто вставил.
import { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Text from './AppText';
import Icon from './Icon';
import { useAppStore, getTask, getProject } from '../store/useAppStore';
import { useTicker } from '../hooks/useTicker';
import { fmtClock } from '../lib/format';
import { useColors, spacing, radius, fontSize, tabBarClearance } from '../theme';
import { t } from '../lib/i18n';

export const MINI_PLAYER_HEIGHT = 56;
const FADE_MS = 200;

/** Идёт ли таймер по задаче, которая ещё существует. Задачу могли удалить —
 *  тогда плеера быть не должно, а не должно быть падения. */
export function useRunningTask() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const tasks = useAppStore((s) => s.tasks);
  if (!activeTimer) return null;
  return getTask(tasks, activeTimer.taskId);
}

/** Нижний отступ для прокручиваемого содержимого корневых экранов: запас
 *  под таббар плюс, пока идёт таймер, ещё и под полосу плеера над ним.
 *  Плеер перекрывает контент, а не раздвигает его, — значит последняя
 *  карточка списка должна кончаться выше. */
export function useBottomClearance() {
  const task = useRunningTask();
  return tabBarClearance + (task ? MINI_PLAYER_HEIGHT + spacing.sm : 0);
}
export default function TimerMiniPlayer({ onOpen }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const projects = useAppStore((s) => s.projects);
  const lang = useAppStore((s) => s.settings.lang);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const task = useRunningTask();

  // Тикает раз в секунду, пока плеер на экране, — так же, как счётчик на
  // странице задачи.
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
  // Тот же расчёт, что на странице задачи: накопленное плюс текущий заход.
  const elapsed = (task.totalMs || 0)
    + (activeTimer ? Date.now() - new Date(activeTimer.startedAt).getTime() : 0);

  return (
    <Animated.View style={[styles.wrap, anim]} pointerEvents="box-none">
      <Pressable style={styles.bar} onPress={() => onOpen(task.id)}>
        <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
        <View style={styles.main}>
          <Text style={styles.title} numberOfLines={1}>{task.title || t(lang, 'task.no_name')}</Text>
          {project ? <Text style={styles.sub} numberOfLines={1}>{project.name}</Text> : null}
        </View>
        <Text style={styles.clock}>{fmtClock(elapsed)}</Text>
        {/* Своя зона нажатия не меньше 44pt: кнопка рядом с областью, которая
            открывает задачу, и промахиваться тут дорого. */}
        <Pressable
          onPress={stopTimer}
          hitSlop={12}
          style={styles.stop}
          accessibilityRole="button"
          accessibilityLabel={t(lang, 'timer.stop')}
        >
          <View style={styles.stopGlyph} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg },
  bar: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 3, flex: 0 },
  main: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: fontSize.sm },
  sub: { color: colors.textDim, fontSize: fontSize.xs, marginTop: 1 },
  clock: { color: colors.text, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  stop: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Квадрат, а не иконка: «стоп» у плееров всегда так и выглядит, и на 14
  // пикселях он читается лучше любого глифа.
  stopGlyph: { width: 14, height: 14, borderRadius: 3, backgroundColor: colors.danger },
});

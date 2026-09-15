import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore } from '../store/useAppStore';
import { fmtShort, taskElapsedMs } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Таймер запускается/останавливается только из TaskDetailScreen — в списке
// только индикация, что задача сейчас в работе (см. фидбек: кнопка "старт"
// в списке лишняя, путает с открытием задачи).
export default function TaskListItem({ task, onPress }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const toggleTaskDone = useAppStore((s) => s.toggleTaskDone);
  const togglePinTask = useAppStore((s) => s.togglePinTask);
  const isRunning = activeTimer && activeTimer.taskId === task.id;

  useTicker(!!isRunning);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Pressable hitSlop={10} onPress={() => toggleTaskDone(task.id)} style={[styles.checkbox, task.done && styles.checkboxOn]}>
        {task.done ? <Icon name="check" size={13} color={colors.accentText} /> : null}
      </Pressable>

      <View style={styles.mid}>
        <Text style={[styles.title, task.done && styles.titleDone]} numberOfLines={1}>
          {task.title || t(lang, 'task.no_name')}
        </Text>
        <View style={styles.timeRow}>
          {isRunning ? <View style={styles.liveDot} /> : null}
          <Text style={[styles.time, isRunning && styles.timeRunning]}>{fmtShort(taskElapsedMs(task, activeTimer), lang)}</Text>
        </View>
      </View>

      <Pressable hitSlop={10} onPress={() => togglePinTask(task.id)} style={styles.iconBtn}>
        <Icon name="pin" size={16} color={task.pinnedAt ? colors.accent : colors.textDim} />
      </Pressable>
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.8 },
  checkbox: {
    width: 24, height: 24, borderRadius: radius.sm, backgroundColor: colors.panel2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent },
  mid: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  titleDone: { color: colors.textDim, textDecorationLine: 'line-through' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  time: { color: colors.textDim, fontSize: fontSize.xs },
  timeRunning: { color: colors.accent, fontWeight: '700' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  iconBtn: { padding: spacing.xs },
});

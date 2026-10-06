// Что можно сделать с карточкой доски, не открывая задачу: переложить в
// другой статус и включить/выключить таймер.
//
// Отдельный лист, а не PickerSheet, по двум причинам: у статусов есть цвет,
// и он тут не украшение — по нему колонки и узнают; и рядом с выбором стоит
// действие таймера, которого у выбора одного из списка быть не может.
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useAppStore } from '../store/useAppStore';
import { orderedStatuses } from '../lib/statuses';
import { closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';
import { t } from '../lib/i18n';

export default function TaskMoveSheet({ taskId }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const task = useAppStore((s) => s.tasks.find((t2) => t2.id === taskId));
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const lang = useAppStore((s) => s.settings.lang);
  const setTaskStatus = useAppStore((s) => s.setTaskStatus);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);

  // Задачу могли удалить с другого устройства, пока лист открыт.
  if (!task) return null;

  const running = !!activeTimer && activeTimer.taskId === task.id;
  const columns = orderedStatuses(statuses, task.projectId);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={2}>{task.title || t(lang, 'task.no_name')}</Text>

      <Text style={styles.section}>{t(lang, 'board.move_to')}</Text>
      {columns.map((st) => {
        const active = st.id === task.statusId;
        return (
          <Pressable
            key={st.id}
            style={[styles.row, active && styles.rowActive]}
            onPress={() => { setTaskStatus(task.id, st.id); closeSheet(); }}
          >
            <View style={[styles.dot, { backgroundColor: st.color }]} />
            <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>{st.name}</Text>
            {active ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
          </Pressable>
        );
      })}

      <Pressable
        style={styles.timerRow}
        onPress={() => { if (running) stopTimer(); else startTimer(task.id); closeSheet(); }}
      >
        <Icon name={running ? 'pause' : 'play'} size={15} color={running ? colors.danger : colors.accentInk} />
        <Text style={styles.rowText}>{t(lang, running ? 'timer.stop' : 'timer.start')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.sm, paddingBottom: spacing.lg },
  title: { color: colors.text, ...typography.title },
  section: { color: colors.textDim, fontSize: fontSize.xs, textTransform: 'uppercase', marginTop: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  rowActive: { backgroundColor: colors.accentMuted },
  rowText: { flex: 1, color: colors.text, fontSize: fontSize.md },
  rowTextActive: { fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 3 },
  timerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
});

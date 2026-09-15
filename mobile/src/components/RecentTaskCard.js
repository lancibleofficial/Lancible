import { Pressable, View, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore, getProject } from '../store/useAppStore';
import { fmtShort, taskElapsedMs } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function RecentTaskCard({ task, onPress }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const projects = useAppStore((s) => s.projects);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const lang = useAppStore((s) => s.settings.lang);
  const project = getProject(projects, task.projectId);
  const isRunning = activeTimer && activeTimer.taskId === task.id;
  useTicker(!!isRunning);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
      <Text style={styles.title} numberOfLines={2}>{task.title || t(lang, 'task.no_name')}</Text>
      <View style={styles.footer}>
        <Text style={styles.project} numberOfLines={1}>{project ? project.name : ''}</Text>
        <Text style={[styles.time, isRunning && styles.timeRunning]}>{fmtShort(taskElapsedMs(task, activeTimer), lang)}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: {
    width: 160, backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.md,
    marginRight: spacing.sm, gap: spacing.sm, justifyContent: 'space-between', minHeight: 96,
  },
  pressed: { opacity: 0.8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  footer: { gap: 2 },
  project: { color: colors.textDim, fontSize: fontSize.xs },
  time: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600' },
  timeRunning: { color: colors.accent },
});

// Строка недавней задачи: плей или стоп, название и проект, когда шло время,
// справа — время по задаче. Одна на «Сегодня» и «Проекты», как .row-list с
// .rl-play на десктопе. Сама строка открывает задачу, квадрат — таймер.
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { IslandRow } from './Island';
import { useAppStore, getProject, lastSessionAt } from '../store/useAppStore';
import { fmtShort, fmtWhen, taskElapsedMs } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function RecentTaskRow({ task, first, onPress }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const projects = useAppStore((s) => s.projects);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const lang = useAppStore((s) => s.settings.lang);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const project = getProject(projects, task.projectId);
  const running = !!activeTimer && activeTimer.taskId === task.id;
  useTicker(running);

  const when = running ? t(lang, 'task.running_now') : fmtWhen(new Date(lastSessionAt(task, activeTimer)).toISOString(), lang);

  return (
    <IslandRow first={first} onPress={onPress}>
      <Pressable
        onPress={() => (running ? stopTimer() : startTimer(task.id))}
        hitSlop={8}
        style={[styles.play, running && styles.playOn]}
        accessibilityRole="button"
        accessibilityLabel={t(lang, running ? 'timer.stop' : 'timer.start')}
      >
        <Icon name={running ? 'stop' : 'play'} size={12} color={running ? colors.accentText : colors.text} />
      </Pressable>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>{task.title || t(lang, 'task.no_name')}</Text>
        <View style={styles.subRow}>
          <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
          <Text style={styles.sub} numberOfLines={1}>{`${project ? project.name : ''} · ${when}`}</Text>
        </View>
      </View>
      <Text style={[styles.time, running && styles.timeOn]}>{fmtShort(taskElapsedMs(task, activeTimer), lang)}</Text>
    </IslandRow>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  play: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  playOn: { backgroundColor: colors.accent },
  main: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 2 },
  sub: { color: colors.textFaint, fontSize: fontSize.xs, flexShrink: 1 },
  time: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
  timeOn: { color: colors.accentInk },
});

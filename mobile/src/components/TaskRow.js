// Строка задачи в колоде проектов и в ленте «Задачи» (макет B2): кружок
// статуса (тап — выполнено), название, тихая мета (идёт · дедлайн · версия
// · время), справа круглая кнопка плей/стоп. В ленте — ещё плашка проекта.
import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Text from './AppText';
import Icon from './Icon';
import { useAppStore, getProject } from '../store/useAppStore';
import { useTicker } from '../hooks/useTicker';
import { fmtShort, fmtClock, taskElapsedMs } from '../lib/format';
import { dueShort, dueState } from '../lib/due';
import { getStatus } from '../lib/statuses';
import { badgeBg } from '../lib/tags';
import { useColors, spacing, fontSize } from '../theme';
import { t } from '../lib/i18n';

/**
 * @param onToggleDone своя обработка галочки (колода проектов сначала
 *                     уводит строку анимацией, потом отмечает задачу)
 * @param checked      показать галочку, пока задача ещё не отмечена в сторе
 */
export default function TaskRow({ task, onPress, showProject = false, first = false, compact = false, onToggleDone, checked }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const projects = useAppStore((s) => s.projects);
  const versions = useAppStore((s) => s.versions);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const toggleTaskDone = useAppStore((s) => s.toggleTaskDone);

  const running = !!activeTimer && activeTimer.taskId === task.id;
  useTicker(running);
  const project = getProject(projects, task.projectId);
  const version = task.versionId ? versions.find((v) => v.id === task.versionId) : null;
  const elapsed = taskElapsedMs(task, activeTimer);
  const due = task.done ? null : dueState(task);
  const done = !!task.done || !!checked;

  const status = task.statusId ? getStatus(statuses, task.statusId) : null;
  const meta = [];
  if (status && !running) meta.push({ text: status.name, color: colors.textDim, dot: status.color });
  if (running) meta.push({ text: `${t(lang, 'task.running_now')} ${fmtClock(elapsed)}`, color: colors.accentInk, bold: true });
  if (task.pinnedAt && !running) meta.push({ text: t(lang, 'tasks.pinned_mark'), color: colors.textFaint });
  if (due) meta.push({ text: dueShort(task, lang), color: due === 'overdue' ? colors.danger : due === 'soon' ? colors.warn : colors.textFaint, bold: due !== 'later' });
  if (version) meta.push({ text: version.name, color: colors.textFaint });
  if (!running && elapsed > 0) meta.push({ text: fmtShort(elapsed, lang), color: colors.textFaint });

  return (
    <Tap
      onPress={onPress}
      style={({ pressed }) => [styles.row, compact && styles.rowCompact, !first && styles.rowBorder, running && styles.rowRunning, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Tap
        hitSlop={10}
        onPress={() => (onToggleDone ? onToggleDone(task) : toggleTaskDone(task.id))}
        style={[styles.circ, done && styles.circOn]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={t(lang, 'task.mark_done')}
      >
        {done ? <Icon name="check" size={11} color={colors.accentText} /> : null}
      </Tap>
      <View style={styles.mid}>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>{task.title || t(lang, 'task.no_name')}</Text>
        {(showProject && project) || meta.length ? (
          <View style={styles.meta}>
            {showProject && project ? (
              <View style={[styles.tag, { backgroundColor: badgeBg(project.color, 0.16) }]}>
                <Text style={[styles.tagText, { color: project.color }]} numberOfLines={1}>{project.name}</Text>
              </View>
            ) : null}
            {meta.map((m, i) => (
              <View key={i} style={styles.metaItem}>
                {i > 0 || (showProject && project) ? <Text style={styles.metaSep}>·</Text> : null}
                {m.dot ? <View style={[styles.metaDot, { backgroundColor: m.dot }]} /> : null}
                <Text style={[styles.metaText, { color: m.color }, m.bold && styles.metaBold]} numberOfLines={1}>{m.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <Tap
        hitSlop={8}
        onPress={() => (running ? stopTimer() : startTimer(task.id))}
        style={[styles.play, running && styles.playOn]}
        accessibilityRole="button"
        accessibilityLabel={t(lang, running ? 'timer.stop' : 'timer.start')}
      >
        <Icon name={running ? 'stop' : 'play'} size={12} color={running ? colors.accentText : colors.text} />
      </Tap>
    </Tap>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingVertical: 10, paddingHorizontal: spacing.md },
  rowCompact: { minHeight: 60 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowRunning: { backgroundColor: colors.accentMuted },
  pressed: { opacity: 0.75 },
  circ: { width: 24, height: 24, borderRadius: 999, borderWidth: 2, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center' },
  circOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  mid: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', columnGap: 5, rowGap: 3, marginTop: 4, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  metaSep: { color: colors.textFaint, fontSize: 12 },
  metaDot: { width: 7, height: 7, borderRadius: 3 },
  metaText: { fontSize: 12, flexShrink: 1 },
  metaBold: { fontWeight: '600' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, maxWidth: 140 },
  tagText: { fontSize: 11, fontWeight: '700' },
  play: { width: 38, height: 38, borderRadius: 999, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  playOn: { backgroundColor: colors.accent },
});

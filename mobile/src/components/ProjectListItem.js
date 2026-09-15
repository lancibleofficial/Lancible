import { Pressable, View, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { fmtDur, fmtMoney } from '../lib/format';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';

export default function ProjectListItem({ project, onPress, onLongPress, onTogglePin }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const lang = useAppStore((s) => s.settings.lang);
  const currency = useAppStore((s) => s.settings.currency);
  const list = tasksOf(tasks, project.id);
  const done = list.filter((task) => task.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  const ms = projectMs(tasks, project.id, activeTimer);
  const money = projectMoney(tasks, project.id, hourlyRate, activeTimer);

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.stripe, { backgroundColor: project.color }]} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
        {project.description ? <Text style={styles.desc} numberOfLines={1}>{project.description}</Text> : null}
        <View style={styles.statsRow}>
          <View style={styles.statItem}><Icon name="clock" size={12} color={colors.textDim} /><Text style={styles.stat}>{fmtDur(ms, lang)}</Text></View>
          <View style={styles.statItem}><Icon name="wallet" size={12} color={colors.textDim} /><Text style={styles.stat}>{fmtMoney(money, lang, currency)}</Text></View>
          <View style={styles.statItem}><Icon name="check" size={12} color={colors.textDim} /><Text style={styles.stat}>{done}/{list.length}</Text></View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: project.color }]} />
        </View>
      </View>

      <Pressable hitSlop={10} onPress={onTogglePin} style={styles.pinBtn}>
        <Icon name="pin" size={15} color={project.pinnedAt ? colors.accent : colors.textDim} />
      </Pressable>
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.8 },
  stripe: { width: 5 },
  body: { flex: 1, padding: spacing.lg, paddingRight: 40, gap: spacing.xs },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  desc: { color: colors.textDim, fontSize: fontSize.sm },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stat: { color: colors.textDim, fontSize: fontSize.xs },
  progressTrack: { height: 4, borderRadius: radius.pill, backgroundColor: colors.panel2, marginTop: spacing.sm, overflow: 'hidden' },
  progressFill: { height: '100%' },
  pinBtn: { position: 'absolute', top: spacing.sm, right: spacing.sm, padding: spacing.xs },
});

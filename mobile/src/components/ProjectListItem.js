import { Pressable, View, StyleSheet } from 'react-native';
import Text from './AppText';
import { useAppStore, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { fmtDur, fmtMoney } from '../lib/format';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';

// Кнопки-пина на карточке нет: закрепление переехало на свайп влево и в
// меню по долгому нажатию. Здесь от пина осталась только пометка — по ней
// видно, почему проект стоит наверху списка.
export default function ProjectListItem({ project, onPress, onLongPress }) {
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
        <View style={styles.nameRow}>
          {project.pinnedAt ? <Icon name="pin" size={12} color={colors.textDim} /> : null}
          <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
        </View>
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

    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  // Ни скругления, ни нижнего отступа: и то и другое держит строка
  // свайпа снаружи (SwipeRow). Со своим скруглением у открытой строки
  // между карточкой и кнопкой оставался вырез, а со своим отступом
  // кнопка вылезала ниже карточки.
  card: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.8 },
  stripe: { width: 5 },
  // Правый отступ вернулся к обычному: место под кнопку-пин больше
  // резервировать не нужно.
  body: { flex: 1, padding: spacing.lg, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { flexShrink: 1, color: colors.text, fontSize: fontSize.md, fontFamily: displayFamily.bold },
  desc: { color: colors.textDim, fontSize: fontSize.sm },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stat: { color: colors.textDim, fontSize: fontSize.xs },
  progressTrack: { height: 4, borderRadius: radius.pill, backgroundColor: colors.panel2, marginTop: spacing.sm, overflow: 'hidden' },
  progressFill: { height: '100%' },
});

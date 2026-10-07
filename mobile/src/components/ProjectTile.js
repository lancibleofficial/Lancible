// Карточка проекта — остров: цвет и название, меню, описание, время и
// деньги за всё время, прогресс, готовые из всех и ближайший дедлайн. Та же
// .ptile, что на странице «Проекты» веба.
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import Island from './Island';
import { useAppStore, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, fmtDateShort } from '../lib/format';
import { useTicker } from '../hooks/useTicker';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

export default function ProjectTile({ project, onPress, onMenu }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const rates = useRates();
  const lang = settings.lang;

  const list = tasksOf(tasks, project.id);
  const done = list.filter((task) => task.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  const ms = projectMs(list, project.id, activeTimer);
  const money = projectMoney(list, project.id, rates, activeTimer);
  const nextDue = list.filter((task) => !task.done && task.dueAt).map((task) => task.dueAt).sort()[0];
  const runningHere = !!activeTimer && list.some((task) => task.id === activeTimer.taskId);
  useTicker(runningHere);

  return (
    <Island onPress={onPress} accessibilityRole="button" accessibilityLabel={project.name}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: project.color || colors.accent }]} />
        <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
        {project.pinnedAt ? <Icon name="pin" size={12} color={colors.textFaint} /> : null}
        <Pressable onPress={onMenu} hitSlop={10} style={styles.menuBtn} accessibilityLabel={t(lang, 'project.opts')}>
          <Icon name="kebab" size={16} color={colors.textDim} />
        </Pressable>
      </View>
      {project.description ? <Text style={styles.desc} numberOfLines={1}>{project.description}</Text> : null}
      <View style={styles.figs}>
        <Text style={styles.time}>{fmtDur(ms, lang)}</Text>
        <Text style={styles.money}> · {fmtMoney(money, lang, currencyOf(project, settings))}</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.note}>{t(lang, 'home.total_label')}</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
      <View style={styles.foot}>
        <Text style={styles.footText}>{t(lang, 'home.tasks_done', { done, total: list.length })}</Text>
        <Text style={styles.footText} numberOfLines={1}>
          {nextDue ? t(lang, 'home.next_due', { date: fmtDateShort(nextDue, lang) }) : t(lang, 'home.no_due')}
        </Text>
      </View>
    </Island>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  name: { flex: 1, color: colors.text, fontSize: fontSize.md, fontFamily: displayFamily.bold },
  menuBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  desc: { color: colors.textFaint, fontSize: fontSize.sm, marginTop: 2 },
  figs: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.sm },
  time: { color: colors.text, fontSize: fontSize.lg, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  money: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },
  note: { color: colors.textFaint, fontSize: fontSize.xs },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: colors.panel2, overflow: 'hidden', marginTop: spacing.sm },
  fill: { height: '100%', backgroundColor: colors.accent },
  foot: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm },
  footText: { color: colors.textFaint, fontSize: fontSize.xs, flexShrink: 1 },
});

import { useLayoutEffect, useMemo, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import Text from '../components/AppText';
import { useAppStore, tasksOf, projectMs, projectMoney, getProject } from '../store/useAppStore';
import { fmtDur, fmtMoney, fmtClock, taskElapsedMs, earnedOf } from '../lib/format';
import { buildAllProjectsSheets, buildPeriodSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { useTicker } from '../hooks/useTicker';
import Icon from '../components/Icon';
import PrimaryButton from '../components/PrimaryButton';
import StatCard from '../components/StatCard';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, spacing, radius, fontSize, tabBarClearance } from '../theme';
import { t } from '../lib/i18n';

export default function StatsScreen({ navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const lang = useAppStore((s) => s.settings.lang);
  const currency = useAppStore((s) => s.settings.currency);
  const openProject = useAppStore((s) => s.openProject);
  const showToast = useAppStore((s) => s.showToast);
  const [exporting, setExporting] = useState(false);

  useTicker(!!activeTimer);

  async function onExportRange(range) {
    if (exporting) return;
    closeSheet();
    setExporting(true);
    const sheets = range
      ? buildPeriodSheets(tasks, (id) => getProject(projects, id), lang, currency, hourlyRate, range)
      : buildAllProjectsSheets(projects, (id) => tasksOf(tasks, id), lang, currency, hourlyRate);
    await runExport(`Lancible — ${t(lang, 'export.all_projects')} — ${new Date().toISOString().slice(0, 10)}`, sheets, lang, showToast);
    setExporting(false);
  }

  function onOpenPeriodExport() {
    openSheet(<ExportPeriodSheet lang={lang} onConfirm={onExportRange} onCancel={closeSheet} />);
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          hitSlop={10}
          style={styles.headerIconBtnLast}
          onPress={() => navigation.navigate('Home', { screen: 'HomeMain', params: { openSearch: true } })}
        >
          <Icon name="search" size={20} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, colors]);

  const totalMs = tasks.reduce((a, task) => a + taskElapsedMs(task, activeTimer), 0);
  const totalMoney = tasks.reduce((a, task) => a + earnedOf(task, hourlyRate, activeTimer), 0);
  const runningTask = activeTimer && tasks.find((task) => task.id === activeTimer.taskId);

  const byProject = useMemo(
    () => [...projects]
      .map((p) => ({ project: p, ms: projectMs(tasks, p.id, activeTimer), money: projectMoney(tasks, p.id, hourlyRate, activeTimer) }))
      .sort((a, b) => b.ms - a.ms),
    [projects, tasks, activeTimer, hourlyRate],
  );

  const byTask = useMemo(
    () => [...tasks]
      .map((task) => ({ task, ms: taskElapsedMs(task, activeTimer), money: earnedOf(task, hourlyRate, activeTimer) }))
      .filter((row) => row.ms > 0)
      .sort((a, b) => b.ms - a.ms),
    [tasks, activeTimer, hourlyRate],
  );

  const listData = [
    ...(byProject.length ? [{ row: 'header', key: 'h-project', label: t(lang, 'stats.by_project') }] : []),
    ...byProject.map((r) => ({ row: 'project', key: `p-${r.project.id}`, ...r })),
    ...(byTask.length ? [{ row: 'header', key: 'h-task', label: t(lang, 'stats.by_task') }] : []),
    ...byTask.map((r) => ({ row: 'task', key: `t-${r.task.id}`, ...r })),
  ];

  function openTask(task) {
    openProject(task.projectId);
    navigation.navigate('Home', { screen: 'Project', params: { projectId: task.projectId } });
    navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId: task.id } });
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      data={listData}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={
        <View style={{ gap: spacing.lg }}>
          <View style={styles.grid}>
            <StatCard icon="clock" label={t(lang, 'stats.worked')} value={fmtDur(totalMs, lang)} />
            <StatCard icon="wallet" label={t(lang, 'stats.earned')} value={fmtMoney(totalMoney, lang, currency)} />
          </View>

          <View style={styles.exportRow}>
            <PrimaryButton icon="download" title={t(lang, 'export.short')} onPress={() => onExportRange(null)} loading={exporting} style={styles.exportRowBtn} shrinkText />
            <PrimaryButton title={t(lang, 'export.pick_period')} variant="ghost" onPress={onOpenPeriodExport} style={styles.exportRowBtn} shrinkText />
          </View>

          {runningTask ? (
            <View style={styles.runningCard}>
              <Icon name="clock" color={colors.accent} />
              <Text style={styles.runningName} numberOfLines={1}>{runningTask.title || t(lang, 'task.no_name')}</Text>
              <Text style={styles.runningTime}>{fmtClock(Date.now() - new Date(activeTimer.startedAt).getTime())}</Text>
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        if (item.row === 'header') return <Text style={styles.sectionTitle}>{item.label}</Text>;
        if (item.row === 'task') {
          const project = getProject(projects, item.task.projectId);
          return (
            <Pressable onPress={() => openTask(item.task)} style={styles.projectRow}>
              <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
              <Text style={styles.projectName} numberOfLines={1}>{item.task.title || t(lang, 'task.no_name')}</Text>
              <Text style={styles.projectStat}>{fmtDur(item.ms, lang)}</Text>
              <Text style={styles.projectStat}>{fmtMoney(item.money, lang, currency)}</Text>
            </Pressable>
          );
        }
        return (
          <View style={styles.projectRow}>
            <View style={[styles.dot, { backgroundColor: item.project.color }]} />
            <Text style={styles.projectName} numberOfLines={1}>{item.project.name}</Text>
            <Text style={styles.projectStat}>{fmtDur(item.ms, lang)}</Text>
            <Text style={styles.projectStat}>{fmtMoney(item.money, lang, currency)}</Text>
          </View>
        );
      }}
    />
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: insets.bottom + tabBarClearance },
  headerIconBtnLast: { paddingLeft: spacing.sm, paddingRight: spacing.lg },
  grid: { flexDirection: 'row', gap: spacing.sm },
  exportRow: { flexDirection: 'row', gap: spacing.sm },
  exportRowBtn: { flex: 1, width: undefined },
  runningCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.lg, padding: spacing.md,
  },
  runningName: { flex: 1, color: colors.text, fontSize: fontSize.sm },
  runningTime: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sectionTitle: {
    color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  projectName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  projectStat: { color: colors.textDim, fontSize: fontSize.xs, marginLeft: spacing.sm },
});

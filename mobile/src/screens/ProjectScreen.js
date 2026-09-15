import { useLayoutEffect, useMemo } from 'react';
import { View, SectionList, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import PrimaryButton from '../components/PrimaryButton';
import { useAppStore, sortedProjectTasks, tasksOf, projectMs, projectMoney, getProject } from '../store/useAppStore';
import { fmtDur, fmtMoney } from '../lib/format';
import { buildProjectSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import TaskListItem from '../components/TaskListItem';
import Icon from '../components/Icon';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function ProjectScreen({ route, navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const { projectId } = route.params;
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const LANG = useAppStore((s) => s.settings.lang);
  const currency = useAppStore((s) => s.settings.currency);
  const createTask = useAppStore((s) => s.createTask);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const showToast = useAppStore((s) => s.showToast);

  const project = getProject(projects, projectId);
  const { pinned, rest, done } = useMemo(() => sortedProjectTasks(tasks, projectId), [tasks, projectId]);

  function onDeleteProject() {
    if (!project) return;
    confirmSheet({
      message: t(LANG, 'confirm.delete_project', { name: project.name }),
      actions: [
        { label: t(LANG, 'project.delete'), destructive: true, onPress: () => { deleteProject(project.id); navigation.goBack(); } },
        { label: t(LANG, 'common.cancel'), cancel: true },
      ],
    });
  }

  function onExportConfirm(range) {
    closeSheet();
    const allTasks = tasksOf(tasks, projectId);
    runExport(
      `${project.name} — ${t(LANG, 'export.all_tasks')} — ${new Date().toISOString().slice(0, 10)}`,
      buildProjectSheets(project, allTasks, LANG, currency, hourlyRate, range),
      LANG,
      showToast,
    );
  }

  function onOpenExport() {
    openSheet(<ExportPeriodSheet lang={LANG} onConfirm={onExportConfirm} onCancel={closeSheet} />);
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: project ? project.name : '',
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable hitSlop={10} onPress={() => togglePinProject(projectId)} style={styles.headerIconBtn}>
            <Icon name="pin" size={20} color={project && project.pinnedAt ? colors.accent : colors.text} />
          </Pressable>
          <Pressable hitSlop={10} onPress={onDeleteProject} style={styles.headerIconBtnLast}>
            <Icon name="trash" size={20} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, project, colors]);

  function onAddTask() {
    const task = createTask(projectId);
    navigation.navigate('TaskDetail', { taskId: task.id });
  }

  if (!project) return null;

  const ms = projectMs(tasks, projectId, activeTimer);
  const money = projectMoney(tasks, projectId, hourlyRate, activeTimer);
  const sections = [
    pinned.length ? { key: 'pinned', label: t(LANG, 'home.pinned'), data: pinned } : null,
    rest.length ? { key: 'rest', label: t(LANG, 'filter.active'), data: rest } : null,
    done.length ? { key: 'done', label: t(LANG, 'filter.done'), data: done } : null,
  ].filter(Boolean);

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <View style={styles.statCard}>
          <Icon name="wallet" size={14} color={colors.textDim} />
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{fmtMoney(money, LANG, currency)}</Text>
        </View>
        <View style={styles.statCard}>
          <Icon name="clock" size={14} color={colors.textDim} />
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{fmtDur(ms, LANG)}</Text>
        </View>
        <PrimaryButton icon="download" title={t(LANG, 'export.short')} onPress={onOpenExport} style={styles.exportBtn} shrinkText />
      </View>
      <SectionList
        style={styles.list}
        sections={sections}
        keyExtractor={(task) => task.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.label}</Text>
            <View style={styles.sectionBadge}><Text style={styles.sectionBadgeText}>{section.data.length}</Text></View>
          </View>
        )}
        renderItem={({ item }) => (
          <TaskListItem task={item} onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })} />
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t(LANG, 'sidebar.empty_default')}</Text>}
      />
      <View style={styles.bottomBar}>
        <PrimaryButton icon="plus" title={t(LANG, 'project.new_task_label')} onPress={onAddTask} />
      </View>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center', gap: 2,
  },
  statValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  exportBtn: { width: undefined, flexShrink: 0 },
  list: { flex: 1 },
  listContent: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.lg },
  headerActions: { flexDirection: 'row' },
  headerIconBtn: { paddingHorizontal: spacing.sm },
  headerIconBtnLast: { paddingLeft: spacing.sm, paddingRight: spacing.lg },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, marginBottom: spacing.sm, paddingBottom: spacing.xs,
  },
  sectionTitle: {
    color: colors.text, fontSize: fontSize.xs, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  sectionBadge: { backgroundColor: colors.panel2, borderRadius: radius.pill, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sectionBadgeText: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing.xxl, fontSize: fontSize.sm },
  bottomBar: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: (insets.bottom || spacing.md) + spacing.sm,
    backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
});

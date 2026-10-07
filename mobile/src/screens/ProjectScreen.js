// Страница проекта: сводка, отбор по версии и список задач.
//
// В шапке остались только «назад», название и ⋮. Четыре иконки подряд
// съедали место у названия и всё равно требовали угадывать, что делает
// каждая; в меню у действия есть подпись.
//
// Отбор по версии здесь тот же, что на доске, — один на проект. Два
// независимых отбора расходились бы молча: на доске смотришь v1.0, а в
// списке задач почему-то всё.
import { useLayoutEffect, useMemo } from 'react';
import { View, SectionList, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import PrimaryButton from '../components/PrimaryButton';
import NewProjectSheet from '../components/NewProjectSheet';
import PickerSheet from '../components/PickerSheet';
import MenuSheet from '../components/MenuSheet';
import QuickTaskSheet from '../components/QuickTaskSheet';
import SwipeRow from '../components/SwipeRow';
import { useAppStore, sortedProjectTasks, tasksOf, projectMs, projectMoney, getProject } from '../store/useAppStore';
import { fmtDur, fmtMoney } from '../lib/format';
import { defaultStatusId } from '../lib/statuses';
import { buildProjectSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import TaskListItem from '../components/TaskListItem';
import Icon from '../components/Icon';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import Versions from '../core/versions.js';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t, pluralForm } from '../lib/i18n';

export default function ProjectScreen({ route, navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const { projectId } = route.params;
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const setBoardProject = useAppStore((s) => s.setBoardProject);
  const boardVersion = useAppStore((s) => s.ui.boardVersion);
  const setBoardVersion = useAppStore((s) => s.setBoardVersion);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const LANG = useAppStore((s) => s.settings.lang);
  const currency = useAppStore((s) => s.settings.currency);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const togglePinTask = useAppStore((s) => s.togglePinTask);
  const showToast = useAppStore((s) => s.showToast);
  const versions = useAppStore((s) => s.versions);

  const project = getProject(projects, projectId);
  // Идёт таймер по задаче этого проекта — время и деньги в сводке должны
  // расти на глазах, а не после возврата на экран.
  const runningHere = !!activeTimer
    && (tasks.find((task) => task.id === activeTimer.taskId) || {}).projectId === projectId;
  useTicker(runningHere);

  const versionFilter = (boardVersion && boardVersion[projectId]) || 'all';
  const projectVersions = useMemo(
    () => Versions.versionsOf(versions, projectId),
    [versions, projectId],
  );
  const visibleTasks = useMemo(
    () => Versions.filterTasks(tasks, versions, { projectId, versionId: versionFilter }),
    [tasks, versions, projectId, versionFilter],
  );
  const { pinned, rest, done } = useMemo(
    () => sortedProjectTasks(visibleTasks, projectId),
    [visibleTasks, projectId],
  );

  function onDeleteProject() {
    if (!project) return;
    confirmSheet({
      title: t(LANG, 'confirm.are_you_sure'),
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

  function onOpenBoard() {
    setBoardProject(projectId);
    navigation.navigate('Board', { screen: 'BoardMain' });
  }

  function onOpenStats() {
    navigation.navigate('Stats');
  }

  function onEditProject() {
    openSheet(<NewProjectSheet project={project} onCancel={closeSheet} onCreated={closeSheet} />);
  }

  function onOpenMenu() {
    openSheet(
      <MenuSheet
        title={project ? project.name : ''}
        items={[
          { key: 'edit', icon: 'settings', label: t(LANG, 'project.menu_edit'), onPress: onEditProject },
          { key: 'stats', icon: 'chart', label: t(LANG, 'project.menu_stats'), onPress: onOpenStats },
          { key: 'board', icon: 'board', label: t(LANG, 'project.menu_board'), onPress: onOpenBoard },
          // Документы проекта (круг 5) — тот же раздел, отфильтрованный по нему.
          { key: 'docs', icon: 'doc', label: t(LANG, 'nav.docs'), onPress: () => navigation.navigate('Documents', { projectId }) },
          {
            key: 'pin',
            icon: 'pin',
            label: t(LANG, project && project.pinnedAt ? 'pin.unpin' : 'pin.pin'),
            onPress: () => togglePinProject(projectId),
          },
          { key: 'export', icon: 'download', label: t(LANG, 'menu.export_excel'), onPress: onOpenExport },
          {
            key: 'delete',
            icon: 'trash',
            label: t(LANG, 'project.delete'),
            danger: true,
            separated: true,
            onPress: onDeleteProject,
          },
        ]}
      />,
    );
  }

  function onPickVersion() {
    openSheet(
      <PickerSheet
        title={t(LANG, 'version.label')}
        value={versionFilter}
        options={[
          { value: 'all', label: t(LANG, 'board.all_versions') },
          ...projectVersions.map((v) => ({ value: v.id, label: v.name })),
          { value: 'none', label: t(LANG, 'version.none') },
        ]}
        onSelect={(value) => setBoardVersion(projectId, value)}
      />,
    );
  }

  function onAddTask() {
    // Версия берётся из отбора: смотришь v1.0 — заводишь в v1.0. При «Все
    // версии» и «Без версии» брать нечего, задача уходит без версии.
    const versionId = versionFilter !== 'all' && versionFilter !== 'none' ? versionFilter : null;
    openSheet(
      <QuickTaskSheet
        projectId={projectId}
        statusId={defaultStatusId(statuses, projectId, false)}
        versionId={versionId}
        contextLabel={project ? project.name : ''}
      />,
    );
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: project ? project.name : '',
      headerRight: () => (
        <Pressable hitSlop={6} onPress={onOpenMenu} style={styles.menuBtn}>
          <Icon name="kebab" size={18} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, project, colors, LANG, versionFilter]);

  if (!project) return null;

  const ms = projectMs(visibleTasks, projectId, activeTimer);
  const money = projectMoney(visibleTasks, projectId, hourlyRate, activeTimer);
  const doneCount = done.length;
  const totalCount = pinned.length + rest.length + done.length;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  const sections = [
    pinned.length ? { key: 'pinned', label: t(LANG, 'home.pinned'), data: pinned } : null,
    rest.length ? { key: 'rest', label: t(LANG, 'section.active'), data: rest } : null,
    done.length ? { key: 'done', label: t(LANG, 'filter.done'), data: done } : null,
  ].filter(Boolean);
  // Заголовки нужны, только когда есть что от чего отделять — как в вебе.
  const showHeaders = sections.length > 1;

  return (
    <View style={styles.container}>
      <Pressable style={styles.summary} onPress={onOpenStats}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText} numberOfLines={1}>
            {fmtDur(ms, LANG)} · {fmtMoney(money, LANG, currency)} · {t(LANG, 'project.summary_tasks', {
              done: doneCount,
              total: totalCount,
              plural: pluralForm(LANG, totalCount, 'plural.task'),
            })}
          </Text>
          <Icon name="chevron-right" size={13} color={colors.textDim} />
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      </Pressable>

      {projectVersions.length ? (
        <Pressable style={styles.versionRow} onPress={onPickVersion} hitSlop={6}>
          <Text style={styles.versionText} numberOfLines={1}>
            {versionLabel(versionFilter, projectVersions, LANG)}
          </Text>
          <Icon name="chevron-down" size={12} color={colors.textDim} />
        </Pressable>
      ) : null}

      <SectionList
        style={styles.list}
        sections={sections}
        keyExtractor={(task) => task.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (showHeaders ? (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.label}</Text>
            <View style={styles.sectionBadge}><Text style={styles.sectionBadgeText}>{section.data.length}</Text></View>
          </View>
        ) : null)}
        renderItem={({ item }) => (
          <SwipeRow
            label={t(LANG, item.pinnedAt ? 'pin.unpin' : 'pin.pin')}
            onAction={() => togglePinTask(item.id)}
            style={styles.taskRow}
          >
            <TaskListItem task={item} onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })} />
          </SwipeRow>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t(LANG, 'sidebar.empty_default')}</Text>}
      />
      <View style={styles.bottomBar}>
        <PrimaryButton icon="plus" title={t(LANG, 'project.new_task_label')} onPress={onAddTask} />
      </View>
    </View>
  );
}

/** Подпись отбора: «Все версии», имя версии или «Без версии». */
function versionLabel(filter, list, lang) {
  if (filter === 'all') return t(lang, 'board.all_versions');
  if (filter === 'none') return t(lang, 'version.none');
  const found = list.find((v) => v.id === filter);
  return found ? found.name : t(lang, 'board.all_versions');
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Одна строка вместо двух плиток и кнопки: всё, что было в них, читается
  // фразой, а освободившееся место отдано списку задач.
  summary: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.panel, borderRadius: radius.lg, gap: spacing.sm,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryText: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  progressTrack: { height: 4, borderRadius: radius.pill, backgroundColor: colors.panel2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },

  versionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  versionText: { color: colors.textDim, fontSize: fontSize.sm },

  // Список задач плотнее списка проектов: строки короче, и зазор в 12
  // между ними рвал бы его на отдельные карточки.
  taskRow: { marginBottom: spacing.sm, borderRadius: radius.md },
  list: { flex: 1 },
  listContent: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.lg },
  menuBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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

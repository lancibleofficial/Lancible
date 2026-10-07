// «Проекты»: карточки проектов и остров недавних задач — как на странице
// «Проекты» веба. Закреплённые первыми, в порядке закрепления; меню
// карточки — открыть, в быстрый доступ, редактировать, Excel, удалить.
import { useMemo } from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import Island, { IslandHead, IslandEmpty } from '../components/Island';
import ProjectTile from '../components/ProjectTile';
import RecentTaskRow from '../components/RecentTaskRow';
import NewProjectSheet from '../components/NewProjectSheet';
import MenuSheet from '../components/MenuSheet';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import PrimaryButton from '../components/PrimaryButton';
import SearchHeader from '../components/SearchHeader';
import { useAppStore, recentTasks, tasksOf } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { buildProjectSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, fontSize, typography, gap } from '../theme';
import { t } from '../lib/i18n';

const byPinned = (a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt);

export default function ProjectsScreen({ navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets, useBottomClearance());
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const lang = settings.lang;
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const openProject = useAppStore((s) => s.openProject);
  const showToast = useAppStore((s) => s.showToast);
  const rates = useRates();

  const ordered = useMemo(() => {
    const pinned = projects.filter((p) => p.pinnedAt).sort(byPinned);
    return [...pinned, ...projects.filter((p) => !p.pinnedAt)];
  }, [projects]);
  const recent = useMemo(() => recentTasks(tasks, 8, activeTimer), [tasks, activeTimer]);

  function openProjectScreen(id) {
    openProject(id);
    navigation.navigate('Project', { projectId: id });
  }

  function openTask(task) {
    openProject(task.projectId);
    navigation.navigate('TaskDetail', { taskId: task.id });
  }

  function onNewProject() {
    openSheet(
      <NewProjectSheet
        onCancel={closeSheet}
        onCreated={(project) => { closeSheet(); openProjectScreen(project.id); }}
      />,
    );
  }

  function onExport(p) {
    openSheet(
      <ExportPeriodSheet
        lang={lang}
        onCancel={closeSheet}
        onConfirm={(range) => {
          closeSheet();
          runExport(
            `${p.name} — ${t(lang, 'export.all_tasks')} — ${new Date().toISOString().slice(0, 10)}`,
            buildProjectSheets(p, tasksOf(tasks, p.id), lang, currencyOf(p, settings), rates, range),
            lang,
            showToast,
          );
        }}
      />,
    );
  }

  function onDelete(p) {
    confirmSheet({
      title: t(lang, 'confirm.are_you_sure'),
      message: t(lang, 'confirm.delete_project', { name: p.name }),
      actions: [
        { label: t(lang, 'project.delete'), destructive: true, onPress: () => deleteProject(p.id) },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  function onMenu(p) {
    openSheet(
      <MenuSheet
        title={p.name}
        items={[
          { key: 'open', icon: 'board', label: t(lang, 'common.open'), onPress: () => openProjectScreen(p.id) },
          { key: 'pin', icon: 'pin', label: t(lang, p.pinnedAt ? 'pin.quick_remove' : 'pin.quick_add'), onPress: () => togglePinProject(p.id) },
          {
            key: 'edit', icon: 'settings', label: t(lang, 'project.menu_edit'),
            onPress: () => openSheet(<NewProjectSheet project={p} onCancel={closeSheet} onCreated={closeSheet} />),
          },
          { key: 'export', icon: 'download', label: t(lang, 'menu.export_excel'), onPress: () => onExport(p) },
          { key: 'delete', icon: 'trash', label: t(lang, 'project.delete'), danger: true, separated: true, onPress: () => onDelete(p) },
        ]}
      />,
    );
  }

  const header = (
    <View style={styles.pageHead}>
      <Text style={styles.pageTitle}>
        {t(lang, 'nav.projects')}
        {projects.length ? <Text style={styles.count}> · {projects.length}</Text> : null}
      </Text>
      <View style={{ flex: 1 }} />
      {projects.length ? (
        <Pressable onPress={onNewProject} style={styles.newBtn} hitSlop={6} accessibilityRole="button">
          <Icon name="plus" size={13} color={colors.accentText} />
          <Text style={styles.newBtnText}>{t(lang, 'home.create')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <SearchHeader navigation={navigation} />
      <FlatList
        data={ordered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          <Island style={styles.emptyCard}>
            <Icon name="grid" size={32} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{t(lang, 'home.empty_title')}</Text>
            <Text style={styles.emptyText}>{t(lang, 'home.empty_text')}</Text>
            <PrimaryButton title={t(lang, 'home.new_project_title')} onPress={onNewProject} />
          </Island>
        )}
        renderItem={({ item }) => (
          <ProjectTile project={item} onPress={() => openProjectScreen(item.id)} onMenu={() => onMenu(item)} />
        )}
        ListFooterComponent={projects.length ? (
          <Island style={styles.recent}>
            <IslandHead title={t(lang, 'home.recent')} />
            {recent.length === 0 ? <IslandEmpty>{t(lang, 'home.recent_empty')}</IslandEmpty> : null}
            {recent.map((task, i) => (
              <RecentTaskRow key={task.id} task={task} first={i === 0} onPress={() => openTask(task)} />
            ))}
          </Island>
        ) : null}
      />
    </View>
  );
}

const makeStyles = (colors, insets, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + clearance, gap },
  pageHead: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: spacing.xs },
  pageTitle: { ...typography.title, color: colors.text },
  count: { color: colors.textFaint, fontSize: fontSize.md, fontFamily: 'Onest-Regular' },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: spacing.md, height: 32,
  },
  newBtnText: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '700' },
  recent: { marginTop: spacing.xs },
  emptyCard: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.text, ...typography.title, textAlign: 'center' },
  emptyText: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },
});

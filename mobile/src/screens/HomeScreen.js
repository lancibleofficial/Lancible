import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import { useAppStore, recentTasks, getProject } from '../store/useAppStore';
import { fmtShort, fmtDur, fmtMoney, taskElapsedMs } from '../lib/format';
import { computeTodayStats } from '../lib/todayStats';
import { confirmSheet } from '../lib/dialogs';
import ProjectListItem from '../components/ProjectListItem';
import RecentTaskCard from '../components/RecentTaskCard';
import NewProjectSheet from '../components/NewProjectSheet';
import StatCard from '../components/StatCard';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useTicker } from '../hooks/useTicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, spacing, radius, fontSize, tabBarClearance } from '../theme';
import { t } from '../lib/i18n';

const byPinned = (a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt);
const ADD_TILE = { id: '__add__' };
const HEADER_PINNED = { id: '__header_pinned__' };
const HEADER_REST = { id: '__header_rest__' };

export default function HomeScreen({ navigation, route }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const currency = useAppStore((s) => s.settings.currency);
  const lang = useAppStore((s) => s.settings.lang);
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const openProject = useAppStore((s) => s.openProject);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  useTicker(!!activeTimer);
  const { todayMs, todayMoney } = useMemo(
    () => computeTodayStats(tasks, activeTimer, hourlyRate),
    [tasks, activeTimer, hourlyRate],
  );
  const doneCount = useMemo(() => tasks.filter((task) => task.done).length, [tasks]);

  // Иконка поиска в хедере есть на всех вкладках (см. MainTabs.js) — с
  // других вкладок она переключает на Home и просит открыть поиск здесь же.
  useEffect(() => {
    if (route.params?.openSearch) {
      setSearchOpen(true);
      navigation.setParams({ openSearch: undefined });
    }
  }, [route.params?.openSearch]);

  // Кнопка "+" теперь живёт в плавающем таббаре (FloatingTabBar.js), а не
  // отдельным FAB на этом экране — с любой другой вкладки она так же
  // переключает на Home и просит открыть тут диалог создания, как поиск.
  useEffect(() => {
    if (route.params?.openCreate) {
      openNewProjectSheet();
      navigation.setParams({ openCreate: undefined });
    }
  }, [route.params?.openCreate]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: searchOpen
        ? () => (
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t(lang, 'search.placeholder')}
            placeholderTextColor={colors.textDim}
            autoFocus
          />
        )
        : () => (
          <View style={styles.brandRow}>
            <Logo size={20} color={colors.accent} />
            <Text style={styles.brandText}>Lancible</Text>
          </View>
        ),
      headerTitleContainerStyle: searchOpen ? { flex: 1 } : undefined,
      headerLeft: searchOpen ? () => null : undefined,
      headerRight: () => (
        <Pressable
          hitSlop={10}
          style={styles.headerIconBtnLast}
          onPress={() => { setSearchOpen((v) => !v); setQuery(''); }}
        >
          <Icon name={searchOpen ? 'x' : 'search'} size={20} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, searchOpen, query, colors, lang]);

  const pinnedProjects = useMemo(() => projects.filter((p) => p.pinnedAt).sort(byPinned), [projects]);
  const restProjects = useMemo(() => projects.filter((p) => !p.pinnedAt), [projects]);

  const recent = useMemo(() => recentTasks(tasks, 12), [tasks]);

  const q = query.trim().toLowerCase();
  const isSearching = q.length > 0;
  const matches = (p) => p.name.toLowerCase().includes(q);
  const visiblePinned = isSearching ? pinnedProjects.filter(matches) : pinnedProjects;
  const visibleRest = isSearching ? restProjects.filter(matches) : restProjects;
  const matchingTasks = useMemo(
    () => (isSearching ? tasks.filter((task) => (task.title || '').toLowerCase().includes(q)) : []),
    [tasks, q, isSearching],
  );

  const listData = [
    ...(visiblePinned.length ? [HEADER_PINNED, ...visiblePinned] : []),
    ...(visibleRest.length ? [HEADER_REST, ...visibleRest] : []),
    ...(isSearching ? [] : [ADD_TILE]),
  ];

  function openProjectScreen(id) {
    openProject(id);
    navigation.navigate('Project', { projectId: id });
  }

  function openTask(task) {
    navigation.navigate('Project', { projectId: task.projectId });
    navigation.navigate('TaskDetail', { taskId: task.id });
  }

  function onLongPressProject(p) {
    confirmSheet({
      title: p.name,
      actions: [
        { label: p.pinnedAt ? t(lang, 'project.unpin') : t(lang, 'project.pin'), onPress: () => togglePinProject(p.id) },
        {
          label: t(lang, 'project.delete'),
          destructive: true,
          onPress: () => confirmSheet({
            title: t(lang, 'confirm.are_you_sure'),
            message: t(lang, 'confirm.delete_project', { name: p.name }),
            actions: [
              { label: t(lang, 'project.delete'), destructive: true, onPress: () => deleteProject(p.id) },
              { label: t(lang, 'common.cancel'), cancel: true },
            ],
          }),
        },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  function openNewProjectSheet() {
    openSheet(
      <NewProjectSheet
        onCancel={closeSheet}
        onCreated={(project) => {
          closeSheet();
          openProjectScreen(project.id);
        }}
      />,
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={listData}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {isSearching ? null : (
              <View style={styles.todayGrid}>
                <StatCard icon="wallet" label={t(lang, 'stats.today_earned')} value={fmtMoney(todayMoney, lang, currency)} />
                <StatCard icon="clock" label={t(lang, 'stats.today_worked')} value={fmtDur(todayMs, lang)} />
                <StatCard icon="check" label={t(lang, 'stats.done')} value={`${doneCount}/${tasks.length}`} />
              </View>
            )}
            {isSearching ? (
              matchingTasks.length ? (
                <View style={styles.recentSection}>
                  <Text style={styles.sectionTitle}>{t(lang, 'search.tasks_found')}</Text>
                  {matchingTasks.map((task) => (
                    <SearchTaskRow key={task.id} task={task} projects={projects} activeTimer={activeTimer} lang={lang} styles={styles} colors={colors} onPress={() => openTask(task)} />
                  ))}
                </View>
              ) : null
            ) : recent.length ? (
              <View style={styles.recentSection}>
                <Text style={styles.sectionTitle}>{t(lang, 'home.recent')}</Text>
                <FlatList
                  data={recent}
                  keyExtractor={(task) => task.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => <RecentTaskCard task={item} onPress={() => openTask(item)} />}
                  contentContainerStyle={{ paddingRight: spacing.lg }}
                />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          if (item.id === '__header_pinned__') return <Text style={styles.sectionTitle}>{t(lang, 'home.pinned')}</Text>;
          if (item.id === '__header_rest__') return <Text style={styles.sectionTitle}>{visiblePinned.length ? t(lang, 'home.other') : t(lang, 'home.title')}</Text>;
          if (item.id === '__add__') {
            return (
              <Pressable style={styles.addTile} onPress={openNewProjectSheet}>
                <Icon name="plus" size={20} color={colors.textDim} />
                <Text style={styles.addTileText}>{t(lang, 'home.create')}</Text>
              </Pressable>
            );
          }
          return (
            <ProjectListItem
              project={item}
              onPress={() => openProjectScreen(item.id)}
              onLongPress={() => onLongPressProject(item)}
              onTogglePin={() => togglePinProject(item.id)}
            />
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{t(lang, 'home.empty')}</Text>}
      />
    </View>
  );
}

function SearchTaskRow({ task, projects, activeTimer, lang, styles, colors, onPress }) {
  const project = getProject(projects, task.projectId);
  return (
    <Pressable onPress={onPress} style={styles.searchTaskRow}>
      <View style={[styles.searchTaskDot, { backgroundColor: project ? project.color : colors.accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.searchTaskTitle} numberOfLines={1}>{task.title || t(lang, 'task.no_name')}</Text>
        <Text style={styles.searchTaskProject} numberOfLines={1}>{project ? project.name : ''}</Text>
      </View>
      <Text style={styles.searchTaskTime}>{fmtShort(taskElapsedMs(task, activeTimer), lang)}</Text>
    </Pressable>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, paddingBottom: insets.bottom + tabBarClearance },
  // paddingRight:0, не spacing.lg — этот экран лежит внутри native-stack
  // (HomeStack.js), у которого свой встроенный отступ у последней иконки
  // хедера (нативный Android-тулбар через react-native-screens, а не тот же
  // JS Header, что у вкладок Stats/Calendar/Settings напрямую в bottom-tabs)
  // — он не обнуляется через headerRightContainerStyle. Экспериментально
  // подтверждено (uiautomator): нативный отступ там сам по себе уже равен
  // тому, что здесь дают spacing.lg на вкладках без вложенного стека —
  // добавлять spacing.lg ещё и сверху удваивало итоговый зазор.
  headerIconBtnLast: { paddingLeft: spacing.sm, paddingRight: 0 },
  todayGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  recentSection: { marginBottom: spacing.lg, gap: spacing.sm },
  sectionTitle: {
    color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.sm, marginTop: spacing.xs,
  },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing.xxl, fontSize: fontSize.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  brandText: { color: colors.text, fontSize: fontSize.lg, fontFamily: 'BasiquePro-Regular' },
  searchInput: {
    backgroundColor: colors.inputBg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8,
    color: colors.text, fontSize: fontSize.md, width: '100%',
  },
  addTile: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.lg, paddingVertical: spacing.lg, marginBottom: spacing.md,
  },
  addTileText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  searchTaskRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  searchTaskDot: { width: 8, height: 8, borderRadius: 4 },
  searchTaskTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  searchTaskProject: { color: colors.textDim, fontSize: fontSize.xs },
  searchTaskTime: { color: colors.textDim, fontSize: fontSize.xs },
});

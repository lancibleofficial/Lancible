// Главная: что сегодня, чем занимался последним и какие есть проекты.
//
// Шапка своя, а не навигационная (HomeStack отдаёт этому экрану
// headerShown: false). Причина простая: поле поиска должно занимать всю
// ширину и раскрываться в отдельный режим, а навигационная шапка на всех
// вкладках одна и под такое не гнётся. Логотипа нет — на своём экране
// приложение себя не представляет, место дороже.
//
// Поиск — это режим, а не фильтр списка. Прежняя версия просеивала тот же
// список проектов и дорисовывала задачи сверху; теперь на время поиска
// Главная уступает место результатам целиком, а по «Отмена» возвращается
// как была. Позиция прокрутки при этом сохраняется сама: список Главной не
// размонтируется, результаты просто накрывают его сверху.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, BackHandler, Keyboard } from 'react-native';
import Text from '../components/AppText';
import { useAppStore, recentTasks, getProject, tasksOf } from '../store/useAppStore';
import { fmtDur, fmtMoney } from '../lib/format';
import { computeTodayStats } from '../lib/todayStats';
import { getStatus } from '../lib/statuses';
import { confirmSheet } from '../lib/dialogs';
import ProjectListItem from '../components/ProjectListItem';
import RecentTaskCard from '../components/RecentTaskCard';
import NewProjectSheet from '../components/NewProjectSheet';
import PrimaryButton from '../components/PrimaryButton';
import SwipeRow, { closeOpenSwipeRows } from '../components/SwipeRow';
import SearchHeader, { SEARCH_HEADER_HEIGHT } from '../components/SearchHeader';
import Icon from '../components/Icon';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useTicker } from '../hooks/useTicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, spacing, radius, fontSize, typography } from '../theme';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { t } from '../lib/i18n';

const byPinned = (a, b) => new Date(a.pinnedAt) - new Date(b.pinnedAt);
const SECTION_PROJECTS = { id: '__projects__' };
// Подсказка свайпа: через сколько после появления списка приоткрыть первую
// строку и сколько подержать открытой.
const HINT_DELAY_MS = 600;
const HINT_HOLD_MS = 900;

export default function HomeScreen({ navigation, route }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets, useBottomClearance());
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const currency = useAppStore((s) => s.settings.currency);
  const lang = useAppStore((s) => s.settings.lang);
  const hintShown = useAppStore((s) => s.ui.homeSwipeHintShown);
  const markSwipeHintShown = useAppStore((s) => s.markSwipeHintShown);
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const openProject = useAppStore((s) => s.openProject);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const firstRow = useRef(null);

  // Подсказка о свайпе — один раз за установку. Открывается и закрывается
  // тем же механизмом, что и настоящий жест: свой сдвиг содержимого внутри
  // Swipeable не работает — библиотека держит на детях собственный
  // transform, и вложенный просто не доезжает до экрана. Заодно подсказка
  // показывает ровно то, что увидит палец.
  useEffect(() => {
    if (hintShown || searchOpen || !projects.length) return undefined;
    let frame = null;
    const open = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        if (firstRow.current) firstRow.current.open();
      });
    }, HINT_DELAY_MS);
    const close = setTimeout(() => {
      if (firstRow.current) firstRow.current.close();
      markSwipeHintShown();
    }, HINT_DELAY_MS + HINT_HOLD_MS);
    return () => { clearTimeout(open); clearTimeout(close); if (frame) cancelAnimationFrame(frame); };
  }, [hintShown, searchOpen, projects.length]);

  useTicker(!!activeTimer);
  const { todayMs, todayMoney } = useMemo(
    () => computeTodayStats(tasks, activeTimer, hourlyRate),
    [tasks, activeTimer, hourlyRate],
  );

  // С других вкладок поиск больше не зовут — иконки там убраны, — но параметр
  // оставлен: он же используется голосовыми ярлыками и пригодится, когда
  // поиск понадобится открыть снаружи.
  useEffect(() => {
    if (route.params?.openSearch) {
      openSearch();
      navigation.setParams({ openSearch: undefined });
    }
  }, [route.params?.openSearch]);

  // Системное «назад» на Android закрывает поиск, а не приложение: для
  // пользователя это ровно тот же выход, что и «Отмена».
  useEffect(() => {
    if (!searchOpen) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeSearch(); return true; });
    return () => sub.remove();
  }, [searchOpen]);

  const pinned = useMemo(() => projects.filter((p) => p.pinnedAt).sort(byPinned), [projects]);
  const rest = useMemo(() => projects.filter((p) => !p.pinnedAt), [projects]);
  // Одной секцией: закреплённые сверху, остальные следом. Отдельные
  // заголовки «Закреплённые» и «Остальные» только дробили короткий список.
  const ordered = useMemo(() => [...pinned, ...rest], [pinned, rest]);
  const recent = useMemo(() => recentTasks(tasks, 12), [tasks]);

  const q = query.trim().toLowerCase();
  const foundProjects = useMemo(
    () => (q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : []),
    [projects, q],
  );
  const foundTasks = useMemo(
    () => (q ? tasks.filter((task) => (task.title || '').toLowerCase().includes(q)) : []),
    [tasks, q],
  );

  function openSearch() {
    closeOpenSwipeRows();
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery('');
    Keyboard.dismiss();
  }

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
        onCreated={(project) => { closeSheet(); openProjectScreen(project.id); }}
      />,
    );
  }

  const renderProject = useCallback(({ item, index }) => (
    <SwipeRow
      ref={index === 0 ? firstRow : null}
      label={t(lang, item.pinnedAt ? 'pin.unpin' : 'pin.pin')}
      onAction={() => togglePinProject(item.id)}
    >
      <ProjectListItem
        project={item}
        onPress={() => openProjectScreen(item.id)}
        onLongPress={() => onLongPressProject(item)}
      />
    </SwipeRow>
  ), [lang, togglePinProject]);

  const header = (
    <SearchHeader
      navigation={navigation}
      active={searchOpen}
      value={query}
      onChangeText={setQuery}
      onOpen={openSearch}
      onCancel={closeSearch}
      inputRef={searchRef}
    />
  );

  return (
    <View style={styles.container}>
      {header}

      {projects.length === 0 && !searchOpen ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyCard}>
            <Icon name="board" size={36} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{t(lang, 'home.empty_title')}</Text>
            <Text style={styles.emptyText}>{t(lang, 'home.empty_text')}</Text>
            <PrimaryButton title={t(lang, 'home.new_project_title')} onPress={openNewProjectSheet} />
          </View>
        </View>
      ) : (
        <FlatList
          data={ordered.length ? [SECTION_PROJECTS, ...ordered] : []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={closeOpenSwipeRows}
          ListHeaderComponent={
            <View>
              <Pressable
                style={styles.todayRow}
                onPress={() => navigation.navigate('Stats', { period: 'today' })}
              >
                <Text style={styles.todayLabel}>{t(lang, 'home.today')}</Text>
                <Text style={styles.todaySep}>·</Text>
                <Text style={[styles.todayValue, !todayMs && styles.todayZero]}>{fmtDur(todayMs, lang)}</Text>
                <Text style={styles.todaySep}>·</Text>
                <Text style={[styles.todayValue, !todayMoney && styles.todayZero]}>
                  {fmtMoney(todayMoney, lang, currency)}
                </Text>
                <View style={{ flex: 1 }} />
                <Icon name="chevron-right" size={13} color={colors.textDim} />
              </Pressable>

              {recent.length ? (
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
          renderItem={({ item, index }) => {
            if (item.id === SECTION_PROJECTS.id) {
              return (
                <View style={styles.projectsHead}>
                  <Text style={styles.sectionTitle}>{t(lang, 'home.title')}</Text>
                  <Pressable onPress={openNewProjectSheet} hitSlop={12} style={styles.newProjectBtn}>
                    <Icon name="plus" size={13} color={colors.accentInk} />
                    <Text style={styles.newProjectText}>{t(lang, 'home.new_project')}</Text>
                  </Pressable>
                </View>
              );
            }
            return renderProject({ item, index: index - 1 });
          }}
        />
      )}

      {searchOpen ? (
        <SearchResults
          query={q}
          recent={recent}
          projects={foundProjects}
          tasks={foundTasks}
          allProjects={projects}
          allTasks={tasks}
          statuses={statuses}
          lang={lang}
          colors={colors}
          styles={styles}
          onProject={openProjectScreen}
          onTask={openTask}
        />
      ) : null}
    </View>
  );
}

/** Результаты поиска поверх Главной. Отдельным слоем, а не подменой данных
 *  списка: так Главная остаётся смонтированной и по выходу показывает ту же
 *  позицию прокрутки, на которой её оставили. */
function SearchResults({
  query, recent, projects, tasks, allProjects, allTasks, statuses,
  lang, colors, styles, onProject, onTask,
}) {
  const empty = query && !projects.length && !tasks.length;
  const rows = [];
  if (!query) {
    // Пустой запрос — недавние задачи строками: подсказка, что искать, и
    // заодно самый частый переход.
    if (recent.length) rows.push({ key: 'h-recent', head: t(lang, 'home.recent') });
    for (const task of recent) rows.push({ key: 't-' + task.id, task });
  } else {
    if (projects.length) rows.push({ key: 'h-p', head: t(lang, 'search.projects_group') });
    for (const p of projects) rows.push({ key: 'p-' + p.id, project: p });
    if (tasks.length) rows.push({ key: 'h-t', head: t(lang, 'search.tasks_group') });
    for (const task of tasks) rows.push({ key: 't-' + task.id, task });
  }

  return (
    <View style={styles.results}>
      {empty ? (
        <Text style={styles.resultsEmpty}>{t(lang, 'search.nothing_found')}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            if (item.head) return <Text style={styles.sectionTitle}>{item.head}</Text>;
            if (item.project) {
              const count = tasksOf(allTasks, item.project.id).length;
              return (
                <Pressable style={styles.resultRow} onPress={() => onProject(item.project.id)}>
                  <View style={[styles.resultDot, { backgroundColor: item.project.color }]} />
                  <Text style={styles.resultTitle} numberOfLines={1}>{item.project.name}</Text>
                  <Text style={styles.resultCount}>{count}</Text>
                </Pressable>
              );
            }
            const project = getProject(allProjects, item.task.projectId);
            const status = getStatus(statuses, item.task.statusId);
            return (
              <Pressable style={styles.resultRow} onPress={() => onTask(item.task)}>
                <View style={[styles.resultDot, { backgroundColor: project ? project.color : colors.accent }]} />
                <View style={styles.resultBody}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.task.title || t(lang, 'task.no_name')}
                  </Text>
                  <View style={styles.resultSubRow}>
                    <Text style={styles.resultSub} numberOfLines={1}>{project ? project.name : ''}</Text>
                    {status ? (
                      <>
                        <Text style={styles.resultSub}>·</Text>
                        <View style={[styles.statusChip, { backgroundColor: status.color }]} />
                        <Text style={styles.resultSub} numberOfLines={1}>{status.name}</Text>
                      </>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors, insets, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },


  // Сверху воздух: шапка не должна упираться в первую карточку.
  listContent: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    paddingBottom: insets.bottom + clearance,
  },

  // Одна строка вместо трёх плиток: цифры за сегодня — это ориентир, а не
  // отчёт, и читать их удобнее одной фразой.
  todayRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  todayLabel: { color: colors.textDim, fontSize: fontSize.sm },
  todayValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  // Нули не прячем: строка на месте — значит день ещё впереди.
  todayZero: { color: colors.textDim, fontWeight: '400' },
  todaySep: { color: colors.textFaint, fontSize: fontSize.sm },

  recentSection: { marginBottom: spacing.lg, gap: spacing.sm },
  sectionTitle: {
    color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  projectsHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm, minHeight: 44,
  },
  newProjectBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  newProjectText: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '700' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyCard: {
    alignItems: 'center', gap: spacing.md, alignSelf: 'stretch',
    backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.xl,
  },
  emptyTitle: { color: colors.text, ...typography.title, textAlign: 'center' },
  emptyText: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },

  // Результаты кладутся поверх, а не вместо: Главная под ними остаётся жива
  // вместе со своей позицией прокрутки.
  // Координаты расписаны руками, а не через StyleSheet.absoluteFillObject:
  // в React Native 0.86 этого поля уже нет, остался только absoluteFill, и
  // спред несуществующего объекта тихо давал стиль без position — слой
  // вставал в поток под Главную вместо того, чтобы накрыть её.
  results: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    top: insets.top + SEARCH_HEADER_HEIGHT + spacing.sm * 2,
    backgroundColor: colors.bg,
  },
  resultsEmpty: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xxl },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  resultDot: { width: 10, height: 10, borderRadius: 3 },
  resultBody: { flex: 1, gap: 2 },
  resultTitle: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  resultCount: { color: colors.textFaint, fontSize: fontSize.xs },
  resultSubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  resultSub: { color: colors.textDim, fontSize: fontSize.xs, flexShrink: 1 },
  statusChip: { width: 8, height: 8, borderRadius: 2 },
});

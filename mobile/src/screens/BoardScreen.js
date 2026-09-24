// Канбан-доска проекта: столбцы статусов, а при заведённых версиях — ряды,
// внутри каждого те же столбцы. Порт renderBoard/boardColumn из веба.
//
// Главное решение здесь — устройство прокрутки. Рядов может быть сколько
// угодно, и если каждому дать свой горизонтальный ScrollView, их придётся
// синхронизировать вручную: один сдвинули — остальные догоняют, и на
// инерционной прокрутке они разъезжаются. Поэтому горизонтальный скролл
// ровно один на всю сетку, а ряды лежат внутри него друг под другом:
// синхронность получается сама, синхронизировать нечего.
//
// Из этого же следует, где живут «липкие» части. Шапка статусов стоит над
// вертикальной прокруткой (иначе уехала бы вверх) и сдвигается по X на
// минус прокрутку. Заголовок ряда стоит внутри ряда и сдвигается на плюс
// прокрутку — так он остаётся у левого края экрана. Тот же приём, что в
// вебе с --lane-x, только сдвиг считает reanimated на UI-потоке, а не
// обработчик события.
//
// Перетаскивания карточек нет намеренно: столбец шириной почти в экран, и
// тащить через край с автопрокруткой на телефоне мучительно. Вместо этого
// долгое нажатие открывает лист со статусами — то же действие, но без
// борьбы с пальцем.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import BoardCard from '../components/BoardCard';
import PickerSheet from '../components/PickerSheet';
import QuickTaskSheet from '../components/QuickTaskSheet';
import TaskMoveSheet from '../components/TaskMoveSheet';
import PrimaryButton from '../components/PrimaryButton';
import SearchHeader from '../components/SearchHeader';
import NewProjectSheet from '../components/NewProjectSheet';
import { useAppStore, getProject } from '../store/useAppStore';
import { orderedStatuses } from '../lib/statuses';
import Versions from '../core/versions.js';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { confirmSheet } from '../lib/dialogs';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Отступ от края экрана — общий с остальными экранами.
const GUTTER = spacing.lg;
// Зазор между столбцами.
const COL_GAP = spacing.sm;
// Сколько остаётся на край следующего столбца: по нему и видно, что доска
// продолжается вправо.
const PEEK = 56;
const COLLAPSE_MS = 200;

export default function BoardScreen({ navigation }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const clearance = useBottomClearance();

  const columnWidth = Math.max(160, width - PEEK);
  const snap = columnWidth + COL_GAP;
  const laneWidth = width - GUTTER * 2;
  const styles = useMemo(
    () => makeStyles(colors, columnWidth, laneWidth, clearance),
    [colors, columnWidth, laneWidth, clearance],
  );

  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const boardProjectId = useAppStore((s) => s.ui.boardProjectId);
  const boardVersion = useAppStore((s) => s.ui.boardVersion);
  const boardCollapsed = useAppStore((s) => s.ui.boardCollapsed);
  const lang = useAppStore((s) => s.settings.lang);
  const setBoardProject = useAppStore((s) => s.setBoardProject);
  const setBoardVersion = useAppStore((s) => s.setBoardVersion);
  const toggleBoardLane = useAppStore((s) => s.toggleBoardLane);

  // Проект мог быть удалён на другом устройстве — тогда просто первый.
  const project = getProject(projects, boardProjectId) || projects[0];
  const projectId = project ? project.id : null;

  const columns = useMemo(() => orderedStatuses(statuses, projectId), [statuses, projectId]);
  const projectVersions = useMemo(() => Versions.versionsOf(versions, projectId), [versions, projectId]);
  const filter = (boardVersion && boardVersion[projectId]) || 'all';

  const own = useMemo(() => tasks.filter((task) => task.projectId === projectId), [tasks, projectId]);
  const shown = useMemo(
    () => Versions.filterTasks(own, versions, { versionId: filter }),
    [own, versions, filter],
  );
  const doneCount = shown.filter((task) => task.done).length;

  // Ряды нужны только когда есть из чего их делать: без версий доска — это
  // просто столбцы, а при выбранном отборе ряд всё равно остался бы один, и
  // подпись над ним повторяла бы то, что уже написано в шапке.
  const lanes = useMemo(() => {
    if (!projectVersions.length || filter !== 'all') return null;
    const list = Versions.boardLanes(versions, shown, projectId).filter((lane) => lane.tasks.length);
    return list.length ? list : null;
  }, [projectVersions, filter, versions, shown, projectId]);

  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollX.value = e.contentOffset.x; });
  const headStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }));

  // Прокрутка отсчитывается от начала столбца, поэтому точки остановки —
  // просто кратные его ширине с зазором.
  const offsets = useMemo(() => columns.map((_, i) => i * snap), [columns, snap]);

  const openTask = useCallback(
    (taskId) => navigation.navigate('TaskDetail', { taskId }),
    [navigation],
  );
  const onCardLongPress = useCallback((taskId) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    openSheet(<TaskMoveSheet taskId={taskId} />);
  }, []);

  function onPickProject() {
    openSheet(
      <PickerSheet
        title={t(lang, 'board.pick_project')}
        value={projectId || ''}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        onSelect={setBoardProject}
      />,
    );
  }

  function onPickVersion() {
    openSheet(
      <PickerSheet
        title={t(lang, 'version.label')}
        value={filter}
        options={[
          { value: 'all', label: t(lang, 'board.all_versions') },
          ...projectVersions.map((v) => ({ value: v.id, label: v.name })),
          { value: 'none', label: t(lang, 'version.none') },
        ]}
        onSelect={(value) => setBoardVersion(projectId, value)}
      />,
    );
  }

  function onMenu() {
    confirmSheet({
      title: project ? project.name : '',
      actions: [
        {
          label: t(lang, 'board.open_project'),
          onPress: () => navigation.navigate('Home', { screen: 'Project', params: { projectId } }),
        },
        {
          label: t(lang, 'board.project_statuses'),
          onPress: () => navigation.navigate('ProjectStatuses', { projectId }),
        },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  function onAdd(statusId, versionId) {
    const status = columns.find((s) => s.id === statusId);
    const version = versionId ? projectVersions.find((v) => v.id === versionId) : null;
    openSheet(
      <QuickTaskSheet
        projectId={projectId}
        statusId={statusId}
        versionId={versionId}
        contextLabel={[status && status.name, version && version.name].filter(Boolean).join(' · ')}
      />,
    );
  }

  if (!project) {
    return (
      <View style={styles.screen}>
        <SearchHeader navigation={navigation} />
        <View style={styles.emptyWrap}>
        <Icon name="board" size={40} color={colors.textFaint} />
        <Text style={styles.emptyText}>{t(lang, 'board.empty')}</Text>
        {/* Лист создания проекта глобальный — открывается прямо отсюда,
            без перепрыгивания на Главную и просьбы открыть его там. */}
        <PrimaryButton
          title={t(lang, 'home.new_project_title')}
          onPress={() => openSheet(
            <NewProjectSheet
              onCancel={closeSheet}
              onCreated={(project) => { closeSheet(); setBoardProject(project.id); }}
            />,
          )}
        />
        </View>
      </View>
    );
  }

  /** Один столбец: карточки статуса и кнопка добавления под ними. */
  const renderColumn = (status, laneTasks, versionId) => {
    const inColumn = laneTasks.filter((task) => task.statusId === status.id);
    return (
      <View key={status.id} style={styles.columnSlot}>
        <View style={styles.column}>
          {inColumn.map((task) => (
            <BoardCard
              key={task.id}
              task={task}
              color={status.color}
              runningSince={activeTimer && activeTimer.taskId === task.id ? activeTimer.startedAt : null}
              lang={lang}
              onPress={openTask}
              onLongPress={onCardLongPress}
            />
          ))}
          <Pressable style={styles.add} onPress={() => onAdd(status.id, versionId)}>
            <Icon name="plus" size={11} color={colors.textDim} />
            <Text style={styles.addText}>{t(lang, 'board.add_task')}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderRow = (laneTasks, versionId) => (
    <View style={styles.row}>
      {columns.map((status) => renderColumn(status, laneTasks, versionId))}
    </View>
  );

  // Отбор по конкретной версии — новые задачи заводятся сразу в неё.
  const plainVersionId = filter !== 'all' && filter !== 'none' ? filter : null;

  return (
    <View style={styles.container}>
      <SearchHeader navigation={navigation} />
      <View style={styles.headerRow}>
        <Pressable style={styles.chip} onPress={onPickProject} hitSlop={6}>
          <View style={[styles.dot, { backgroundColor: project.color || colors.accent }]} />
          <Text style={styles.chipText} numberOfLines={1}>{project.name}</Text>
          <Icon name="chevron-down" size={12} color={colors.textDim} />
        </Pressable>
        <Pressable style={styles.menuBtn} onPress={onMenu} hitSlop={10}>
          <Icon name="kebab" size={18} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.headerRow}>
        {projectVersions.length ? (
          <Pressable style={[styles.chip, styles.chipQuiet]} onPress={onPickVersion} hitSlop={6}>
            <Text style={styles.chipQuietText} numberOfLines={1}>{versionLabel(filter, projectVersions, lang)}</Text>
            <Icon name="chevron-down" size={12} color={colors.textDim} />
          </Pressable>
        ) : <View style={{ flex: 1 }} />}
        <Text style={styles.counter}>{doneCount}/{shown.length}</Text>
      </View>

      {columns.length ? (
        <>
          <View style={styles.stickyHead}>
            <Animated.View style={[styles.headInner, headStyle]}>
              {columns.map((status) => (
                <View key={status.id} style={styles.headCell}>
                  <View style={[styles.dot, { backgroundColor: status.color }]} />
                  <Text style={styles.headName} numberOfLines={1}>{status.name}</Text>
                  <Text style={styles.headCount}>
                    {shown.filter((task) => task.statusId === status.id).length}
                  </Text>
                </View>
              ))}
            </Animated.View>
          </View>

          <ScrollView
            style={styles.vertical}
            contentContainerStyle={styles.verticalContent}
            // Жест, начатый по одной оси, по другой уже не поедет: без этого
            // доска ползёт по диагонали и «липкие» части дрожат.
            directionalLockEnabled
            showsVerticalScrollIndicator={false}
          >
            <Animated.ScrollView
              horizontal
              onScroll={onScroll}
              scrollEventThrottle={16}
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              snapToOffsets={offsets}
              decelerationRate="fast"
              contentContainerStyle={styles.horizontalContent}
            >
              <View>
                {lanes
                  ? lanes.map((lane) => (
                    <Lane
                      key={lane.version ? lane.version.id : 'none'}
                      lane={lane}
                      lang={lang}
                      styles={styles}
                      colors={colors}
                      scrollX={scrollX}
                      collapsed={((boardCollapsed && boardCollapsed[projectId]) || [])
                        .includes(lane.version ? lane.version.id : 'none')}
                      onToggle={() => toggleBoardLane(projectId, lane.version ? lane.version.id : 'none')}
                      renderRow={renderRow}
                    />
                  ))
                  : renderRow(shown, plainVersionId)}
              </View>
            </Animated.ScrollView>
          </ScrollView>
        </>
      ) : (
        <Text style={styles.emptyText}>{t(lang, 'board.empty')}</Text>
      )}
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

/** Ряд одной версии: заголовок на всю видимую ширину и сетка столбцов под
 *  ним.
 *
 *  Высота задаётся ТОЛЬКО пока ряд сворачивается или свёрнут. Стоит
 *  оставить её заданной и у развёрнутого — и замер начнёт возвращать её
 *  же вместо настоящей: содержимое меряется внутри родителя, которому
 *  высоту уже назначили. Ряд после этого перестаёт расти, и добавленная
 *  карточка оказывается обрезанной. */
function Lane({ lane, lang, styles, colors, scrollX, collapsed, onToggle, renderRow }) {
  const [height, setHeight] = useState(0);
  const [free, setFree] = useState(!collapsed);
  const progress = useSharedValue(collapsed ? 0 : 1);

  useEffect(() => {
    progress.value = withTiming(collapsed ? 0 : 1, { duration: COLLAPSE_MS });
    if (collapsed) { setFree(false); return undefined; }
    // Высоту отпускаем по таймеру, а не по колбэку withTiming: тот
    // исполняется воркletом на UI-потоке, и возврат в JS оттуда зависит
    // от того, как babel-плагин разобрал замыкание. Таймер той же длины
    // делает ровно то же и не зависит ни от чего.
    const id = setTimeout(() => setFree(true), COLLAPSE_MS);
    return () => clearTimeout(id);
  }, [collapsed]);

  const headStyle = useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
  const bodyStyle = useAnimatedStyle(() => ({
    height: free ? undefined : height * progress.value,
    opacity: progress.value,
  }));

  return (
    <View style={styles.lane}>
      <Animated.View style={[styles.laneHead, headStyle]}>
        <Pressable style={styles.laneHeadInner} onPress={onToggle}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={11} color={colors.textDim} />
          <Text style={styles.laneName} numberOfLines={1}>
            {lane.version ? lane.version.name : t(lang, 'version.none')}
          </Text>
          <Text style={styles.laneCount}>{lane.tasks.length}</Text>
        </Pressable>
      </Animated.View>
      <Animated.View style={[styles.laneBody, bodyStyle]}>
        {/* Замеряем только пока высота не задана: иначе замер вернёт
            назначенную высоту, а не настоящую, и ряд перестанет расти. */}
        <View onLayout={(e) => { if (free) setHeight(e.nativeEvent.layout.height); }}>
          {renderRow(lane.tasks, lane.version ? lane.version.id : null)}
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors, columnWidth, laneWidth, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: colors.bg },

  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: GUTTER, paddingTop: spacing.sm,
  },
  chip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  // Отбор по версии — второстепенный: без рамки и фона, чтобы не спорить с
  // выбором проекта над ним.
  chipQuiet: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: spacing.xs, flex: 0 },
  chipText: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  // Точка цвета — и у проекта в шапке, и у статуса над столбцом: по ней
  // столбец и узнают, когда название не помещается целиком.
  dot: { width: 10, height: 10, borderRadius: 3 },
  chipQuietText: { color: colors.textDim, fontSize: fontSize.sm },
  menuBtn: { padding: spacing.xs },
  counter: { marginLeft: 'auto', color: colors.textDim, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },

  // Шапка статусов стоит над прокруткой, поэтому вертикально не уезжает;
  // лишнее по бокам режется, чтобы сдвинутая строка не вылезала за экран.
  stickyHead: { overflow: 'hidden', paddingTop: spacing.md, paddingBottom: spacing.xs },
  headInner: { flexDirection: 'row', paddingLeft: GUTTER },
  headCell: {
    width: columnWidth, marginRight: COL_GAP,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  headName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  headCount: { color: colors.textFaint, fontSize: fontSize.xs },

  vertical: { flex: 1 },
  verticalContent: { paddingBottom: clearance + spacing.xl },
  // Справа запас в ширину выглядывающего края: без него последний столбец
  // упирается в конец прокрутки и не доезжает до своего места у отступа.
  horizontalContent: { paddingLeft: GUTTER, paddingRight: PEEK },

  lane: { marginBottom: spacing.lg },
  // Ширина — видимая часть экрана, а не всей сетки: заголовок должен стоять
  // у левого края, а не растягиваться на все столбцы.
  laneHead: { width: laneWidth, marginBottom: spacing.sm },
  laneHeadInner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.boardCol, borderRadius: radius.md,
  },
  laneName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  laneCount: { color: colors.textFaint, fontSize: fontSize.xs },
  laneBody: { overflow: 'hidden' },

  // alignItems: stretch — столбцы ряда одной высоты по самому высокому.
  // По содержимому они получались разной длины, и ряд выглядел рваным.
  row: { flexDirection: 'row', alignItems: 'stretch' },
  columnSlot: { width: columnWidth, marginRight: COL_GAP },
  column: {
    flex: 1, gap: spacing.sm,
    backgroundColor: colors.boardCol, borderRadius: radius.md,
    padding: spacing.sm,
  },
  // Пунктир — как .board-add в вебе, но видна всегда: на телефоне нет
  // наведения, при котором кнопка могла бы появляться.
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  addText: { color: colors.textDim, fontSize: fontSize.xs },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  emptyText: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xl },
});

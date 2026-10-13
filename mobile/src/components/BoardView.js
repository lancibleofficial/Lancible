// Канбан-доска проекта — вкладка «Доска» на странице проекта: столбцы
// статусов, а при заведённых версиях — ряды, внутри каждого те же столбцы.
// Порт renderBoard/boardColumn из веба.
//
// Главное решение здесь — устройство прокрутки. Рядов может быть сколько
// угодно, и если каждому дать свой горизонтальный ScrollView, их придётся
// синхронизировать вручную: один сдвинули — остальные догоняют, и на
// инерционной прокрутке они разъезжаются. Поэтому горизонтальный скролл
// ровно один на всю сетку, а ряды лежат внутри него друг под другом:
// синхронность получается сама, синхронизировать нечего.
//
// Своей вертикальной прокрутки у доски нет (с 11 октября 2026): она лежит
// в странице проекта, а та прокручивается целиком — название, цифры,
// вкладки и доска едут вместе. Вложенная вертикальная прокрутка спорила бы
// со страничной за один и тот же жест; горизонтальная внутри вертикальной —
// нет: каждая ловит свою ось.
//
// Шапка статусов стоит над горизонтальной прокруткой и сдвигается по X на
// минус прокрутку. Заголовок ряда стоит внутри ряда и сдвигается на плюс
// прокрутку — так он остаётся у левого края экрана.
//
// Перетаскивания карточек нет намеренно: столбец шириной почти в экран, и
// тащить через край с автопрокруткой на телефоне мучительно. Вместо этого
// долгое нажатие открывает лист со статусами — то же действие, но без
// борьбы с пальцем.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Text from './AppText';
import Icon from './Icon';
import BoardCard from './BoardCard';
import QuickTaskSheet from './QuickTaskSheet';
import TaskMoveSheet from './TaskMoveSheet';
import { useAppStore } from '../store/useAppStore';
import { orderedStatuses } from '../lib/statuses';
import Versions from '../core/versions.js';
import { openSheet } from '../store/useSheetStore';
import { useColors, spacing, screenPadding, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Отступ от края экрана — общий с остальными экранами.
const GUTTER = screenPadding;
// Зазор между столбцами.
const COL_GAP = spacing.sm;
// Сколько остаётся на край следующего столбца: по нему и видно, что доска
// продолжается вправо.
const PEEK = 56;
const COLLAPSE_MS = 200;

/** @param projectId — чья доска; @param versionFilter — 'all' | id | 'none';
 *  @param onOpenTask(taskId). */
export default function BoardView({ projectId, versionFilter = 'all', onOpenTask }) {
  const colors = useColors();
  const { width } = useWindowDimensions();

  const columnWidth = Math.max(160, width - PEEK);
  const snap = columnWidth + COL_GAP;
  const laneWidth = width - GUTTER * 2;
  const styles = useMemo(
    () => makeStyles(colors, columnWidth, laneWidth),
    [colors, columnWidth, laneWidth],
  );

  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const boardCollapsed = useAppStore((s) => s.ui.boardCollapsed);
  const lang = useAppStore((s) => s.settings.lang);
  const toggleBoardLane = useAppStore((s) => s.toggleBoardLane);

  const columns = useMemo(() => orderedStatuses(statuses, projectId), [statuses, projectId]);
  const projectVersions = useMemo(() => Versions.versionsOf(versions, projectId), [versions, projectId]);
  const filter = versionFilter || 'all';

  const own = useMemo(() => tasks.filter((task) => task.projectId === projectId), [tasks, projectId]);
  const shown = useMemo(
    () => Versions.filterTasks(own, versions, { versionId: filter }),
    [own, versions, filter],
  );

  // Ряды нужны только когда есть из чего их делать: без версий доска — это
  // просто столбцы, а при выбранном отборе ряд всё равно остался бы один.
  const lanes = useMemo(() => {
    if (!projectVersions.length || filter !== 'all') return null;
    const list = Versions.boardLanes(versions, shown, projectId).filter((lane) => lane.tasks.length);
    return list.length ? list : null;
  }, [projectVersions, filter, versions, shown, projectId]);

  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollX.value = e.contentOffset.x; });
  const headStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }));

  const offsets = useMemo(() => columns.map((_, i) => i * snap), [columns, snap]);

  const onCardLongPress = useCallback((taskId) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    openSheet(<TaskMoveSheet taskId={taskId} />);
  }, []);

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
              onPress={onOpenTask}
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

  if (!columns.length) return <Text style={styles.emptyText}>{t(lang, 'board.empty')}</Text>;

  return (
    <View>
      <View style={styles.head}>
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

      <Animated.ScrollView
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Жест, начатый по одной оси, по другой уже не поедет: без этого
        // доска ползёт по диагонали вместе со страницей и шапка дрожит.
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
    </View>
  );
}

/** Ряд одной версии: заголовок на всю видимую ширину и сетка столбцов под
 *  ним. Высота задаётся ТОЛЬКО пока ряд сворачивается или свёрнут —
 *  оставить её у развёрнутого значило бы мерить назначенное, а не настоящее. */
function Lane({ lane, lang, styles, colors, scrollX, collapsed, onToggle, renderRow }) {
  const [height, setHeight] = useState(0);
  const [free, setFree] = useState(!collapsed);
  const progress = useSharedValue(collapsed ? 0 : 1);

  useEffect(() => {
    progress.value = withTiming(collapsed ? 0 : 1, { duration: COLLAPSE_MS });
    if (collapsed) { setFree(false); return undefined; }
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
        <View onLayout={(e) => { if (free) setHeight(e.nativeEvent.layout.height); }}>
          {renderRow(lane.tasks, lane.version ? lane.version.id : null)}
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors, columnWidth, laneWidth) => StyleSheet.create({
  // Шапка статусов едет по X вместе со столбцами; лишнее по бокам режется,
  // чтобы сдвинутая строка не вылезала за экран.
  head: { overflow: 'hidden', paddingTop: spacing.xs, paddingBottom: spacing.xs },
  headInner: { flexDirection: 'row', paddingLeft: GUTTER },
  headCell: {
    width: columnWidth, marginRight: COL_GAP,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  dot: { width: 10, height: 10, borderRadius: 3 },
  headName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  headCount: { color: colors.textFaint, fontSize: fontSize.xs },

  horizontalContent: { paddingLeft: GUTTER, paddingRight: PEEK },

  lane: { marginBottom: spacing.lg },
  laneHead: { width: laneWidth, marginBottom: spacing.sm },
  laneHeadInner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md,
  },
  laneName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  laneCount: { color: colors.textFaint, fontSize: fontSize.xs },
  laneBody: { overflow: 'hidden' },

  // alignItems: stretch — столбцы ряда одной высоты по самому высокому.
  row: { flexDirection: 'row', alignItems: 'stretch' },
  columnSlot: { width: columnWidth, marginRight: COL_GAP },
  // Столбец — остров; карточка в нём — поле на ступень светлее (BoardCard).
  column: {
    flex: 1, gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.lg,
    padding: spacing.sm,
  },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.panel2,
  },
  addText: { color: colors.textDim, fontSize: fontSize.xs },
  emptyText: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xl },
});

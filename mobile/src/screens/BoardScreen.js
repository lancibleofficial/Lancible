// Канбан-доска проекта: столбцы статусов, а при заведённых версиях —
// дорожки, внутри каждой те же столбцы.
//
// Отличие от десктопа только в способе перенести задачу. Там её тащат мышью;
// на телефоне столбец шириной в треть экрана, и перетаскивание через край с
// автопрокруткой — это мучение. Поэтому долгое нажатие на карточке открывает
// список статусов (и версий, если они есть) — то же действие, но без борьбы
// с пальцем.
import { useLayoutEffect, useMemo } from 'react';
import { View, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import PickerSheet from '../components/PickerSheet';
import { useAppStore, getProject } from '../store/useAppStore';
import { orderedStatuses } from '../lib/statuses';
import Versions from '../core/versions.js';
import { fmtDur, fmtMoney, earnedOf, taskElapsedMs } from '../lib/format';
import { openSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, tabBarClearance } from '../theme';
import { t } from '../lib/i18n';

export default function BoardScreen({ route, navigation }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  // Столбец чуть уже половины экрана: так видно, что справа есть следующий, и
  // доска читается как лента, а не как одна колонка.
  const columnWidth = Math.round(Math.min(280, width * 0.62));
  const styles = useMemo(() => makeStyles(colors, columnWidth), [colors, columnWidth]);

  const { projectId } = route.params;
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const currency = useAppStore((s) => s.settings.currency);
  const LANG = useAppStore((s) => s.settings.lang);
  const setTaskStatus = useAppStore((s) => s.setTaskStatus);
  const setTaskVersion = useAppStore((s) => s.setTaskVersion);

  const project = getProject(projects, projectId);
  const columns = orderedStatuses(statuses, projectId);
  const own = useMemo(() => tasks.filter((task) => task.projectId === projectId), [tasks, projectId]);
  const lanes = useMemo(
    () => Versions.boardLanes(versions, own, projectId),
    [versions, own, projectId],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ title: project ? project.name : '' });
  }, [navigation, project]);

  function onMove(task) {
    openSheet(
      <PickerSheet
        title={t(LANG, 'task.status_label')}
        value={task.statusId}
        options={columns.map((s) => ({ value: s.id, label: s.name }))}
        onSelect={(id) => setTaskStatus(task.id, id)}
      />,
    );
  }

  function onMoveVersion(task) {
    openSheet(
      <PickerSheet
        title={t(LANG, 'version.label')}
        value={task.versionId || ''}
        options={[
          { value: '', label: t(LANG, 'version.none') },
          ...Versions.versionsOf(versions, projectId).map((v) => ({ value: v.id, label: v.name })),
        ]}
        onSelect={(id) => setTaskVersion(task.id, id || null)}
      />,
    );
  }

  if (!project) return null;

  if (!columns.length) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>{t(LANG, 'board.empty')}</Text>
      </View>
    );
  }

  const renderColumns = (laneTasks) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.columns}
      // Столбцы прилипают: палец отпускают — и следующий встаёт на место, а
      // не замирает посередине.
      snapToInterval={columnWidth + spacing.sm}
      decelerationRate="fast"
    >
      {columns.map((col) => {
        const inColumn = laneTasks.filter((task) => task.statusId === col.id);
        const ms = inColumn.reduce((sum, task) => sum + taskElapsedMs(task, activeTimer), 0);
        return (
          <View key={col.id} style={styles.column}>
            <View style={styles.columnHead}>
              <View style={[styles.dot, { backgroundColor: col.color }]} />
              <Text style={styles.columnName} numberOfLines={1}>{col.name}</Text>
              <Text style={styles.columnCount}>{inColumn.length}</Text>
              <Text style={styles.columnTime}>{fmtDur(ms, LANG)}</Text>
            </View>
            <View style={styles.columnBody}>
              {inColumn.map((task) => (
                <Pressable
                  key={task.id}
                  style={[styles.card, { borderLeftColor: col.color }]}
                  onPress={() => navigation.navigate('TaskDetail', { taskId: task.id })}
                  onLongPress={() => onMove(task)}
                  delayLongPress={300}
                >
                  <Text style={[styles.cardTitle, task.done && styles.cardTitleDone]} numberOfLines={2}>
                    {task.title || t(LANG, 'task.no_name')}
                  </Text>
                  <View style={styles.cardFoot}>
                    <Icon name="clock" size={10} color={colors.textDim} />
                    <Text style={styles.cardTime}>{fmtDur(taskElapsedMs(task, activeTimer), LANG)}</Text>
                    <Text style={styles.cardMoney}>{fmtMoney(earnedOf(task, hourlyRate, activeTimer), LANG, currency)}</Text>
                  </View>
                </Pressable>
              ))}
              {inColumn.length === 0 ? <Text style={styles.columnEmpty}>—</Text> : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  // Дорожек нет вовсе, пока у проекта нет версий: доска остаётся ровно такой,
  // какой была бы без них.
  const hasLanes = lanes.length > 1 || (lanes.length === 1 && lanes[0].version);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.page}>
      {hasLanes
        ? lanes.map((lane) => (
          <View key={lane.version ? lane.version.id : 'none'} style={styles.lane}>
            <Pressable
              style={styles.laneHead}
              onLongPress={() => (lane.tasks[0] ? onMoveVersion(lane.tasks[0]) : null)}
            >
              <Text style={styles.laneName} numberOfLines={1}>
                {lane.version ? lane.version.name : t(LANG, 'version.none')}
              </Text>
              {lane.version && lane.version.releasedAt ? (
                <Text style={styles.laneReleased}>
                  {new Date(lane.version.releasedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                </Text>
              ) : null}
              <Text style={styles.laneCount}>{lane.tasks.length}</Text>
            </Pressable>
            {renderColumns(lane.tasks)}
          </View>
        ))
        : renderColumns(own)}
    </ScrollView>
  );
}

const makeStyles = (colors, columnWidth) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  page: { paddingVertical: spacing.md, paddingBottom: tabBarClearance + spacing.xl, gap: spacing.lg },
  empty: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xl },

  lane: { gap: spacing.sm },
  laneHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.boardCol, borderRadius: radius.md,
  },
  laneName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  laneReleased: { color: colors.textDim, fontSize: fontSize.xs },
  laneCount: { color: colors.textFaint, fontSize: fontSize.xs },

  // alignItems: stretch — столбцы дорожки одной высоты по самому высокому.
  // По содержимому они получались разной длины, и ряд выглядел рваным.
  columns: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'stretch' },
  column: {
    width: columnWidth,
    backgroundColor: colors.boardCol, borderRadius: radius.md,
    paddingBottom: spacing.sm,
  },
  columnHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 3 },
  columnName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  columnCount: { color: colors.textFaint, fontSize: fontSize.xs },
  columnTime: { color: colors.textDim, fontSize: fontSize.xs },
  columnBody: { flex: 1, paddingHorizontal: spacing.sm, gap: spacing.sm },
  columnEmpty: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'center', paddingVertical: spacing.md },

  // Карточка на ступень светлее столбца — то же правило, что на десктопе.
  card: {
    backgroundColor: colors.boardCard, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs,
  },
  cardTitle: { color: colors.text, fontSize: fontSize.sm, lineHeight: 19 },
  cardTitleDone: { color: colors.textDim, textDecorationLine: 'line-through' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTime: { color: colors.textDim, fontSize: fontSize.xs },
  cardMoney: { color: colors.textFaint, fontSize: fontSize.xs, marginLeft: 'auto' },
});

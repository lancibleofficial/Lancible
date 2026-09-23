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
import { useColors, spacing, radius, fontSize } from '../theme';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { t } from '../lib/i18n';

export default function BoardScreen({ route, navigation }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  // Столбец чуть уже половины экрана: так видно, что справа есть следующий, и
  // доска читается как лента, а не как одна колонка.
  const columnWidth = Math.round(Math.min(280, width * 0.62));
  const clearance = useBottomClearance();
  const styles = useMemo(
    () => makeStyles(colors, columnWidth, clearance),
    [colors, columnWidth, clearance],
  );

  const projects = useAppStore((s) => s.projects);
  const boardProjectId = useAppStore((s) => s.ui.boardProjectId);
  const setBoardProject = useAppStore((s) => s.setBoardProject);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const currency = useAppStore((s) => s.settings.currency);
  const LANG = useAppStore((s) => s.settings.lang);
  const setTaskStatus = useAppStore((s) => s.setTaskStatus);
  const setTaskVersion = useAppStore((s) => s.setTaskVersion);

  // Экран живёт в двух местах сразу: вкладкой таббара и страницей внутри
  // проекта. Проект приходит параметром только со страницы проекта — у
  // вкладки его неоткуда взять, поэтому она помнит выбранный в ui и
  // показывает переключатель, а первый раз открывается на первом проекте.
  const fromProject = !!(route.params && route.params.projectId);
  const chosen = fromProject ? route.params.projectId : boardProjectId;
  const project = getProject(projects, chosen) || (fromProject ? null : projects[0]);
  const projectId = project ? project.id : null;
  const columns = orderedStatuses(statuses, projectId);
  const own = useMemo(() => tasks.filter((task) => task.projectId === projectId), [tasks, projectId]);
  const lanes = useMemo(
    () => Versions.boardLanes(versions, own, projectId),
    [versions, own, projectId],
  );

  useLayoutEffect(() => {
    // У вкладки заголовок свой («Доска») и меняться не должен: какой
    // проект открыт, видно по переключателю под шапкой.
    if (fromProject) navigation.setOptions({ title: project ? project.name : '' });
  }, [navigation, project, fromProject]);

  // Со страницы проекта задача открывается в том же стеке; из вкладки —
  // в стеке «Главной», где TaskDetail и живёт.
  function openTask(taskId) {
    if (fromProject) navigation.navigate('TaskDetail', { taskId });
    else navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId } });
  }

  function pickProject() {
    openSheet(
      <PickerSheet
        title={t(LANG, 'board.pick_project')}
        value={projectId || ''}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        onSelect={(id) => setBoardProject(id)}
      />,
    );
  }

  // Шапка вкладки: какой проект показан и чем его сменить. На странице
  // проекта её нет — там это и так заголовок экрана.
  const picker = fromProject ? null : (
    <Pressable style={styles.picker} onPress={pickProject} hitSlop={6}>
      <View style={[styles.dot, { backgroundColor: project ? project.color : colors.textFaint }]} />
      <Text style={styles.pickerName} numberOfLines={1}>{project ? project.name : ''}</Text>
      <Icon name="chevron-down" size={12} color={colors.textDim} />
    </Pressable>
  );

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

  // Проектов нет вовсе — показывать нечего и выбирать не из чего.
  if (!project) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>{t(LANG, fromProject ? 'board.empty' : 'home.empty')}</Text>
      </View>
    );
  }

  if (!columns.length) {
    return (
      <View style={styles.container}>
        {picker}
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
                  onPress={() => openTask(task.id)}
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
    <View style={styles.container}>
      {picker}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
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
    </View>
  );
}

const makeStyles = (colors, columnWidth, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  page: { paddingVertical: spacing.md, paddingBottom: clearance + spacing.xl, gap: spacing.lg },
  empty: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xl },

  picker: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  pickerName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },

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

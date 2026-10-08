// Страница проекта — как на вебе после «островов»: шапка-остров (цвет,
// название, описание, «+ Задача»), вкладки Список · Доска · Версии ·
// Документы, итоги; во вкладке «Список» — остров списка по статусам с
// фильтрами и под ним острова «Прогресс», «Версии», «Последние записи».
//
// Отбор по версии здесь тот же, что на доске, — один на проект. Два
// независимых отбора расходились бы молча: на доске смотришь v1.0, а в
// списке задач почему-то всё.
import { useLayoutEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Tap from '../components/Tap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import PrimaryButton from '../components/PrimaryButton';
import TextInput from '../components/AppTextInput';
import NewProjectSheet from '../components/NewProjectSheet';
import PickerSheet from '../components/PickerSheet';
import MenuSheet from '../components/MenuSheet';
import QuickTaskSheet from '../components/QuickTaskSheet';
import SwipeRow from '../components/SwipeRow';
import Island, { IslandHead, IslandRow, IslandEmpty } from '../components/Island';
import BoardView from '../components/BoardView';
import DocumentList from '../components/DocumentList';
import { useAppStore, tasksOf, projectMs, projectMoney, getProject } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, fmtWhen } from '../lib/format';
import { defaultStatusId, orderedStatuses } from '../lib/statuses';
import { buildProjectSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { confirmSheet } from '../lib/dialogs';
import TaskListItem from '../components/TaskListItem';
import Icon from '../components/Icon';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import Versions from '../core/versions.js';
import Views from '../core/views.js';
import DocCore from '../core/doc.js';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, displayFamily, gap } from '../theme';
import { t } from '../lib/i18n';

const TABS = ['list', 'board', 'versions', 'docs'];
const TAB_KEY = { list: 'project.tab_list', board: 'nav.board', versions: 'version.section', docs: 'nav.docs' };

export default function ProjectScreen({ route, navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const { projectId } = route.params;
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const versions = useAppStore((s) => s.versions);
  const documents = useAppStore((s) => s.documents || []);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const boardVersion = useAppStore((s) => s.ui.boardVersion);
  const listCollapsed = useAppStore((s) => s.ui.listCollapsed);
  const setBoardVersion = useAppStore((s) => s.setBoardVersion);
  const toggleListGroup = useAppStore((s) => s.toggleListGroup);
  const settings = useAppStore((s) => s.settings);
  const LANG = settings.lang;
  const deleteProject = useAppStore((s) => s.deleteProject);
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const togglePinTask = useAppStore((s) => s.togglePinTask);
  const createDocument = useAppStore((s) => s.createDocument);
  const showToast = useAppStore((s) => s.showToast);
  const rates = useRates();

  const project = getProject(projects, projectId);
  const currency = currencyOf(project, settings);
  // Идёт таймер по задаче этого проекта — время и деньги в сводке должны
  // расти на глазах, а не после возврата на экран.
  const runningHere = !!activeTimer
    && (tasks.find((task) => task.id === activeTimer.taskId) || {}).projectId === projectId;
  useTicker(runningHere);

  const [tab, setTab] = useState((route.params && route.params.tab) || 'list');
  const [statusFilter, setStatusFilter] = useState('all');
  const [draft, setDraft] = useState('');
  const versionFilter = (boardVersion && boardVersion[projectId]) || 'all';
  const projectVersions = useMemo(() => Versions.versionsOf(versions, projectId), [versions, projectId]);
  const own = useMemo(() => tasksOf(tasks, projectId), [tasks, projectId]);
  const byVersion = useMemo(
    () => Versions.filterTasks(own, versions, { projectId, versionId: versionFilter }),
    [own, versions, projectId, versionFilter],
  );
  const visible = useMemo(() => byVersion.filter((task) => (
    statusFilter === 'all' ? true : statusFilter === 'done' ? task.done : !task.done
  )), [byVersion, statusFilter]);
  const groups = useMemo(() => Views.projectListGroups(visible, {
    statuses, projectId, collapsed: (listCollapsed && listCollapsed[projectId]) || [], activeTimer, now: Date.now(),
  }), [visible, statuses, projectId, listCollapsed, activeTimer]);
  const versionRows = useMemo(
    () => Views.versionRows(tasks, versions, projectId, { rates, activeTimer, now: Date.now() }),
    [tasks, versions, projectId, rates, activeTimer],
  );
  const projectDocs = useMemo(() => DocCore.sortDocuments(documents.filter((d) => d.projectId === projectId)), [documents, projectId]);

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

  function onOpenExport() {
    openSheet(
      <ExportPeriodSheet
        lang={LANG}
        onCancel={closeSheet}
        onConfirm={(range) => {
          closeSheet();
          runExport(
            `${project.name} — ${t(LANG, 'export.all_tasks')} — ${new Date().toISOString().slice(0, 10)}`,
            buildProjectSheets(project, own, LANG, currency, rates, range),
            LANG,
            showToast,
          );
        }}
      />,
    );
  }

  function onEditProject(section) {
    openSheet(
      <NewProjectSheet
        project={project}
        section={section}
        onCancel={closeSheet}
        onCreated={closeSheet}
        onOpenStatuses={() => { closeSheet(); navigation.navigate('ProjectStatuses', { projectId }); }}
      />,
    );
  }

  function onOpenMenu() {
    openSheet(
      <MenuSheet
        title={project ? project.name : ''}
        items={[
          { key: 'task', icon: 'plus', label: t(LANG, 'project.new_task_short'), onPress: onAddTask },
          { key: 'edit', icon: 'settings', label: t(LANG, 'project.menu_settings'), onPress: () => onEditProject('main') },
          { key: 'statuses', icon: 'board', label: t(LANG, 'board.project_statuses'), onPress: () => navigation.navigate('ProjectStatuses', { projectId }) },
          {
            key: 'pin', icon: 'pin',
            label: t(LANG, project && project.pinnedAt ? 'pin.quick_remove' : 'pin.quick_add'),
            onPress: () => togglePinProject(projectId),
          },
          { key: 'export', icon: 'download', label: t(LANG, 'menu.export_excel'), onPress: onOpenExport },
          { key: 'delete', icon: 'trash', label: t(LANG, 'project.delete'), danger: true, separated: true, onPress: onDeleteProject },
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
    // Версия берётся из отбора: смотришь v1.0 — заводишь в v1.0.
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

  const openTask = (taskId) => navigation.navigate('TaskDetail', { taskId });

  /** Строка быстрого добавления: завести задачу и сразу открыть её. */
  function submitDraft() {
    const title = draft.trim();
    if (!title) return;
    const versionId = versionFilter !== 'all' && versionFilter !== 'none' ? versionFilter : null;
    const task = createTaskInStatus(projectId, defaultStatusId(statuses, projectId, false), versionId, title);
    setDraft('');
    openTask(task.id);
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '',
      headerRight: () => (
        <Tap hitSlop={6} onPress={onOpenMenu} style={styles.menuBtn} accessibilityLabel={t(LANG, 'project.opts')}>
          <Icon name="kebab" size={18} color={colors.text} />
        </Tap>
      ),
    });
  }, [navigation, project, colors, LANG, versionFilter]);

  if (!project) return null;

  const ms = projectMs(own, projectId, activeTimer);
  const money = projectMoney(own, projectId, rates, activeTimer);
  const doneCount = own.filter((task) => task.done).length;
  const pct = own.length ? Math.round((doneCount / own.length) * 100) : 0;
  const versionLabel = versionFilter === 'all' ? t(LANG, 'board.all_versions')
    : versionFilter === 'none' ? t(LANG, 'version.none')
      : (projectVersions.find((v) => v.id === versionFilter) || {}).name || t(LANG, 'board.all_versions');

  // Последние записи по всем задачам проекта.
  const recs = [];
  for (const task of own) for (const sess of task.sessions || []) recs.push({ task, sess, at: new Date(sess.end || sess.start).getTime() });
  recs.sort((a, b) => b.at - a.at);

  const head = (
    <Island style={styles.head}>
      <View style={styles.headRow}>
        <View style={[styles.dot, { backgroundColor: project.color || colors.accent }]} />
        <Text style={styles.name} numberOfLines={2}>{project.name}</Text>
      </View>
      {project.description ? <Text style={styles.desc} numberOfLines={2}>{project.description}</Text> : null}
      <View style={styles.qa}>
        <Icon name="plus" size={14} color={colors.textFaint} />
        <TextInput
          style={styles.qaInput}
          value={draft}
          onChangeText={setDraft}
          placeholder={t(LANG, 'tasks.new_ph')}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          onSubmitEditing={submitDraft}
          accessibilityLabel={t(LANG, 'tasks.new_ph')}
        />
        <Tap scale={0.92} hitSlop={6} onPress={submitDraft} style={[styles.qaGo, draft.trim() && styles.qaGoOn]} accessibilityRole="button" accessibilityLabel={t(LANG, 'agenda.create_btn')}>
          <Text style={[styles.qaGoText, draft.trim() && styles.qaGoTextOn]}>{t(LANG, 'agenda.create_btn')}</Text>
        </Tap>
      </View>
      <View style={styles.tabs}>
        {TABS.map((key) => (
          <Tap key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabOn]}>
            <Text style={[styles.tabText, tab === key && styles.tabTextOn]} numberOfLines={1}>
              {t(LANG, TAB_KEY[key])}
              {key === 'versions' && projectVersions.length ? ` ${projectVersions.length}` : ''}
              {key === 'docs' && projectDocs.length ? ` ${projectDocs.length}` : ''}
            </Text>
          </Tap>
        ))}
      </View>
      {own.length ? (
        <Text style={styles.kpis} numberOfLines={1}>
          <Text style={styles.kpiNum}>{fmtDur(ms, LANG)}</Text>
          {' · '}
          <Text style={styles.kpiNum}>{fmtMoney(money, LANG, currency)}</Text>
          {' · '}{t(LANG, 'project.done_of', { done: doneCount, total: own.length })}
        </Text>
      ) : null}
    </Island>
  );

  if (tab === 'board') {
    return (
      <View style={styles.container}>
        <View style={styles.boardHead}>
          {head}
          {projectVersions.length ? (
            <Tap style={styles.versionChip} onPress={onPickVersion} hitSlop={6}>
              <Text style={styles.versionChipText} numberOfLines={1}>{versionLabel}</Text>
              <Icon name="chevron-down" size={11} color={colors.textFaint} />
            </Tap>
          ) : null}
        </View>
        <BoardView projectId={projectId} versionFilter={versionFilter} onOpenTask={openTask} bottomPadding={insets.bottom} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {head}

        {tab === 'list' ? (
          <>
            <Island>
              <View style={styles.filterRow}>
                <View style={styles.seg}>
                  {['all', 'active', 'done'].map((key) => (
                    <Tap key={key} onPress={() => setStatusFilter(key)} style={[styles.segBtn, statusFilter === key && styles.segBtnOn]}>
                      <Text style={[styles.segText, statusFilter === key && styles.segTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t(LANG, `filter.${key}`)}</Text>
                    </Tap>
                  ))}
                </View>
                {projectVersions.length ? (
                  <Tap style={styles.versionChip} onPress={onPickVersion} hitSlop={6}>
                    <Text style={styles.versionChipText} numberOfLines={1}>{versionLabel}</Text>
                    <Icon name="chevron-down" size={11} color={colors.textFaint} />
                  </Tap>
                ) : null}
              </View>

              {groups.length === 0 ? <IslandEmpty>{t(LANG, 'sidebar.empty_default')}</IslandEmpty> : null}
              {groups.map((g, gi) => (
                <View key={g.key}>
                  <Tap
                    style={[styles.group, gi === 0 && styles.groupFirst]}
                    onPress={() => toggleListGroup(projectId, g.key)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !g.collapsed }}
                  >
                    <Icon name={g.collapsed ? 'chevron-right' : 'chevron-down'} size={11} color={colors.textFaint} />
                    {g.status ? <View style={[styles.groupDot, { backgroundColor: g.status.color }]} /> : <Icon name="pin" size={11} color={colors.textFaint} />}
                    <Text style={styles.groupName} numberOfLines={1}>{g.status ? g.status.name : t(LANG, 'home.pinned')}</Text>
                    <Text style={styles.groupCount}>{g.tasks.length}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.groupTime}>{fmtDur(g.ms, LANG)}</Text>
                  </Tap>
                  {g.collapsed ? null : g.tasks.map((task) => (
                    <SwipeRow
                      key={task.id}
                      label={t(LANG, task.pinnedAt ? 'pin.unpin' : 'pin.pin')}
                      onAction={() => togglePinTask(task.id)}
                    >
                      <View style={styles.rowBg}>
                        <TaskListItem task={task} showStatus={false} onPress={() => openTask(task.id)} />
                      </View>
                    </SwipeRow>
                  ))}
                </View>
              ))}
            </Island>

            <Island>
              <IslandHead title={t(LANG, 'project.progress')} note={own.length ? `${pct}%` : ''} />
              <Text style={styles.ppLine}>
                <Text style={styles.ppNum}>{doneCount}</Text>
                <Text style={styles.ppOf}> {t(LANG, 'project.of_done', { total: own.length })}</Text>
              </Text>
              <View style={styles.ppBar}>
                {orderedStatuses(statuses, projectId).map((st) => {
                  const n = own.filter((task) => task.statusId === st.id).length;
                  if (!n) return null;
                  return <View key={st.id} style={{ width: `${(n / own.length) * 100}%`, backgroundColor: st.color }} />;
                })}
              </View>
              <View style={styles.ppLegend}>
                {orderedStatuses(statuses, projectId).map((st) => {
                  const n = own.filter((task) => task.statusId === st.id).length;
                  if (!n) return null;
                  return (
                    <View key={st.id} style={styles.ppLegendItem}>
                      <View style={[styles.groupDot, { backgroundColor: st.color }]} />
                      <Text style={styles.ppLegendText}>{st.name} · {n}</Text>
                    </View>
                  );
                })}
              </View>
            </Island>

            {projectVersions.length ? (
              <Island>
                <IslandHead title={t(LANG, 'version.section')} note={t(LANG, 'version.all_short')} onPressNote={() => setTab('versions')} />
                {versionRows.slice(0, 4).map((r, i) => (
                  <VersionRow key={r.id || 'none'} r={r} first={i === 0} styles={styles} colors={colors} lang={LANG}
                    onPress={r.id ? () => { setBoardVersion(projectId, r.id); setTab('list'); } : undefined} />
                ))}
              </Island>
            ) : null}

            <Island>
              <IslandHead title={t(LANG, 'project.last_sessions')} />
              {recs.length === 0 ? <IslandEmpty>{t(LANG, 'project.ps_empty')}</IslandEmpty> : null}
              {recs.slice(0, 5).map((r, i) => (
                <IslandRow key={`${r.task.id}-${r.sess.start}`} first={i === 0} onPress={() => openTask(r.task.id)}>
                  <Text style={styles.psWhen} numberOfLines={1}>{fmtWhen(new Date(r.at).toISOString(), LANG)}</Text>
                  <Text style={styles.psName} numberOfLines={1}>{r.task.title || t(LANG, 'task.no_name')}</Text>
                  <Text style={styles.psDur}>{fmtDur(r.sess.ms, LANG)}</Text>
                </IslandRow>
              ))}
            </Island>
          </>
        ) : null}

        {tab === 'versions' ? (
          <Island>
            <IslandHead title={t(LANG, 'version.section')} note={t(LANG, 'version.manage')} onPressNote={() => onEditProject('versions')} />
            {versionRows.length === 0 ? <IslandEmpty>{t(LANG, 'version.empty_hint')}</IslandEmpty> : null}
            {versionRows.map((r, i) => (
              <VersionRow key={r.id || 'none'} r={r} first={i === 0} styles={styles} colors={colors} lang={LANG} money={fmtMoney(r.money, LANG, currency)}
                onPress={r.id ? () => { setBoardVersion(projectId, r.id); setTab('list'); } : undefined} />
            ))}
          </Island>
        ) : null}

        {tab === 'docs' ? (
          <Island>
            <IslandHead title={t(LANG, 'nav.docs')} note={t(LANG, 'docs.new')} onPressNote={() => navigation.navigate('Editor', { kind: 'doc', id: createDocument(projectId) })} />
            {projectDocs.length === 0 ? <IslandEmpty>{t(LANG, 'docs.empty_list')}</IslandEmpty> : null}
            <DocumentList flat documents={projectDocs} onOpen={(id) => navigation.navigate('Editor', { kind: 'doc', id })} />
          </Island>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Строка версии: имя, готовые из всех и время, полоса прогресса. */
function VersionRow({ r, first, styles, colors, lang, money, onPress }) {
  if (!r.id) {
    return (
      <IslandRow first={first}>
        <Text style={styles.pvNone} numberOfLines={1}>{t(lang, 'version.none')} — {t(lang, 'project.done_of', { done: r.done, total: r.total })}</Text>
      </IslandRow>
    );
  }
  return (
    <IslandRow first={first} onPress={onPress} style={styles.pvRow}>
      <View style={styles.pvHead}>
        <Text style={styles.pvName} numberOfLines={1}>{r.name || t(lang, 'task.no_name')}</Text>
        <Text style={styles.pvSum} numberOfLines={1}>
          {t(lang, 'project.done_of', { done: r.done, total: r.total })} · {fmtDur(r.ms, lang)}{money ? ` · ${money}` : ''}
        </Text>
      </View>
      <View style={styles.pvBar}><View style={[styles.pvFill, { width: `${r.total ? Math.round((r.done / r.total) * 100) : 0}%` }]} /></View>
    </IslandRow>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: insets.bottom + spacing.xl, gap },
  boardHead: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, gap: spacing.sm },
  menuBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  head: { gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 4 },
  name: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontFamily: displayFamily.bold },
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 42, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.panel2 },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaGo: { height: 30, paddingHorizontal: 11, borderRadius: 8, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  qaGoOn: { backgroundColor: colors.accent },
  qaGoText: { color: colors.textDim, fontSize: 12.5, fontWeight: '700' },
  qaGoTextOn: { color: colors.accentText },
  desc: { color: colors.textFaint, fontSize: fontSize.sm },
  tabs: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.md, padding: 3, gap: 3 },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm, paddingHorizontal: 4 },
  tabOn: { backgroundColor: colors.tabActiveBg },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: colors.text },
  kpis: { color: colors.textDim, fontSize: fontSize.sm },
  kpiNum: { color: colors.text, fontFamily: displayFamily.bold },

  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  seg: { flex: 1, flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.sm, padding: 2, gap: 2 },
  segBtn: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 6, paddingHorizontal: 2 },
  segBtnOn: { backgroundColor: colors.tabActiveBg },
  segText: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600' },
  segTextOn: { color: colors.text },
  versionChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, height: 30, borderRadius: radius.sm, backgroundColor: colors.panel2, maxWidth: 140 },
  versionChipText: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600', flexShrink: 1 },

  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  groupFirst: { borderTopWidth: 0, marginTop: 0 },
  groupDot: { width: 8, height: 8, borderRadius: 2 },
  groupName: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 1 },
  groupCount: { color: colors.textFaint, fontSize: fontSize.xs },
  groupTime: { color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  rowBg: { backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  ppLine: { marginTop: spacing.xs },
  ppNum: { color: colors.text, fontSize: 24, fontFamily: displayFamily.bold },
  ppOf: { color: colors.textDim, fontSize: fontSize.sm },
  ppBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.panel2, marginTop: spacing.sm },
  ppLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  ppLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ppLegendText: { color: colors.textDim, fontSize: fontSize.xs },

  pvRow: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  pvHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pvName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1 },
  pvSum: { flex: 1, textAlign: 'right', color: colors.textFaint, fontSize: fontSize.xs },
  pvBar: { height: 4, borderRadius: 2, backgroundColor: colors.panel2, overflow: 'hidden' },
  pvFill: { height: '100%', backgroundColor: colors.accent },
  pvNone: { color: colors.textFaint, fontSize: fontSize.xs },

  psWhen: { width: 96, color: colors.textFaint, fontSize: fontSize.xs },
  psName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  psDur: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

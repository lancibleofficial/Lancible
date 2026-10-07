// «Время» — календарь и статистика одним разделом, как на вебе после
// «островов»: режимы День · 4 дня · Неделя · Месяц · Расписание, фильтр
// проекта и версии, числа 2×2 (сворачиваются), часовая сетка с записями
// (AgendaGrid), месяц с выбором периода и панелью дня по проектам,
// «+ Запись» и Excel за период. Порт renderTimePage/renderAgendaPage/
// renderCalendar/renderPeriodSummary из app.js.
import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import Island, { IslandHead, IslandRow, IslandEmpty } from '../components/Island';
import SearchHeader from '../components/SearchHeader';
import PickerSheet from '../components/PickerSheet';
import SessionSheet from '../components/SessionSheet';
import EntrySheet from '../components/EntrySheet';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import AgendaGrid, { hmOf } from '../components/AgendaGrid';
import { useAppStore, getProject, getTask } from '../store/useAppStore';
import { useRates, useRatesMain, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, monthLabel, capFirst, taskElapsedMs, earnedOf, sessionMoney } from '../lib/format';
import { dayKey, keyToDate, aggregateDays, rangeAgg } from '../lib/calendarMath';
import { buildPeriodSheets, buildAllProjectsSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import Agenda from '../core/agenda.js';
import Versions from '../core/versions.js';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius, fontSize, displayFamily, gap } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const MODES = ['day', 'days4', 'week', 'month', 'agenda'];
const MODE_KEY = { day: 'calendar.day', days4: 'agenda.days4', week: 'calendar.week', month: 'calendar.month', agenda: 'agenda.schedule' };
const GRID_MODES = ['day', 'days4', 'week'];
const WEEKDAY_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];
const GRID_GAP = 4;
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** Сводка по проектам: [{project, rows, ms, money}], крупные первыми. */
function groupByProject(rows, projects) {
  const map = new Map();
  for (const r of rows) {
    const pid = r.task.projectId;
    let g = map.get(pid);
    if (!g) { g = { project: getProject(projects, pid), rows: [], ms: 0, money: 0 }; map.set(pid, g); }
    g.rows.push(r);
    g.ms += r.ms;
    g.money += r.money;
  }
  return [...map.values()].sort((a, b) => b.ms - a.ms);
}

export default function TimeScreen({ navigation, route }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const clearance = useBottomClearance();
  const cellSize = Math.floor((width - spacing.lg * 4 - GRID_GAP * 6) / 7);
  const styles = useMemo(() => makeStyles(colors, cellSize, insets, clearance), [colors, cellSize, insets, clearance]);

  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const versions = useAppStore((s) => s.versions);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const statsHidden = useAppStore((s) => s.ui.timeStatsHidden);
  const toggleTimeStats = useAppStore((s) => s.toggleTimeStats);
  const setSessionSpan = useAppStore((s) => s.setSessionSpan);
  const showToast = useAppStore((s) => s.showToast);
  const lang = settings.lang;
  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const rates = useRates();
  const ratesMain = useRatesMain();

  // Режим и якорь — как agenda.mode/anchor на вебе. На телефоне по
  // умолчанию день: неделя в семь узких столбцов — для обзора, а не для
  // чтения.
  const [mode, setMode] = useState('day');
  const [anchor, setAnchor] = useState(() => Agenda.startOfDayMs(Date.now()));
  const [filter, setFilter] = useState({ projectId: 'all', versionId: 'all' });
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [periodOn, setPeriodOn] = useState(false);
  const [range, setRange] = useState({ from: null, to: null, picking: false });

  useTicker(!!activeTimer);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // «Открыть день» с «Сегодня»: режим и дата приходят параметрами.
  useEffect(() => {
    const p = route.params || {};
    if (!p.mode) return;
    setMode(p.mode);
    if (p.anchor) {
      setAnchor(Agenda.startOfDayMs(keyToDate(p.anchor).getTime()));
      setSelected(p.anchor);
    }
    navigation.setParams({ mode: undefined, anchor: undefined });
  }, [route.params?.mode, route.params?.anchor]);

  // --- фильтр, как statsTasks()/statsRates() на вебе ---
  const filterProject = filter.projectId !== 'all' ? getProject(projects, filter.projectId) : null;
  const projectVersions = useMemo(
    () => (filterProject ? Versions.versionsOf(versions, filterProject.id) : []),
    [versions, filterProject],
  );
  const shown = useMemo(() => {
    if (!filterProject) return tasks;
    const own = tasks.filter((task) => task.projectId === filterProject.id);
    return Versions.filterTasks(own, versions, { projectId: filterProject.id, versionId: filter.versionId });
  }, [tasks, versions, filterProject, filter.versionId]);
  const statsRates = filterProject ? rates : ratesMain;
  const statsCurrency = filterProject ? currencyOf(filterProject, settings) : settings.currency;
  const getProjectById = (id) => getProject(projects, id);

  // --- числа 2×2 ---
  const totalMs = shown.reduce((a, task) => a + taskElapsedMs(task, activeTimer), 0);
  const totalMoney = shown.reduce((a, task) => a + earnedOf(task, statsRates, activeTimer), 0);
  const nowDate = new Date(nowMs);
  const monthFrom = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  const monthTo = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0, 23, 59, 59, 999);
  const monthMoney = useMemo(() => rangeAgg(shown, statsRates, monthFrom, monthTo).money, [shown, statsRates, dayKey(nowDate)]);
  const doneCount = shown.filter((task) => task.done).length;

  // --- отрезок сетки ---
  const { from, days } = useMemo(() => Agenda.agendaRange(mode, anchor), [mode, anchor]);
  const to = from + days * Agenda.DAY;

  const title = useMemo(() => {
    const a = new Date(from);
    const b = new Date(to - 1);
    if (mode === 'month') { const d = new Date(anchor); return monthLabel(lang, d.getFullYear(), d.getMonth()); }
    if (mode === 'day') return capFirst(a.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }));
    const short = { day: 'numeric', month: 'short' };
    return `${a.toLocaleDateString(locale, short)} – ${b.toLocaleDateString(locale, short)}`;
  }, [mode, from, to, anchor, lang]);

  const shift = (dir) => setAnchor((a) => Agenda.shiftAnchor(mode, a, dir));
  const goToday = () => { setAnchor(Agenda.startOfDayMs(Date.now())); setSelected(dayKey(new Date())); };
  const openDay = (startMs) => { setAnchor(Agenda.startOfDayMs(startMs)); setSelected(dayKey(new Date(startMs))); setMode('day'); };

  // --- действия ---
  const openTask = (taskId) => navigation.navigate('TaskDetail', { taskId });

  /** Запись завели в проекте, который фильтр прячет, — иначе создание
   *  выглядит как «ничего не произошло». */
  function revealProjectOnTime(projectId) {
    if (filter.projectId === 'all' || filter.projectId === projectId) return;
    setFilter({ projectId: 'all', versionId: 'all' });
  }

  function onTapBlock(taskId, index) {
    const task = getTask(tasks, taskId);
    if (!task) return;
    openSheet(<SessionSheet task={task} index={index} onOpenTask={openTask} />);
  }
  function onCreate(span) {
    if (!projects.length) { showToast(t(lang, 'agenda.no_projects')); return; }
    openSheet(
      <EntrySheet
        initial={span}
        projectId={filterProject ? filterProject.id : null}
        onDone={(taskId) => { const task = getTask(useAppStore.getState().tasks, taskId); if (task) revealProjectOnTime(task.projectId); }}
      />,
    );
  }
  function onMove(taskId, index, start, end) { setSessionSpan(taskId, index, start, end); }
  function addEntry() { onCreate({ start: nowMs - 3_600_000, end: nowMs }); }

  function pickProject() {
    openSheet(
      <PickerSheet
        title={t(lang, 'filter.project')}
        value={filter.projectId}
        options={[{ value: 'all', label: t(lang, 'filter.all_projects') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        onSelect={(value) => setFilter({ projectId: value, versionId: 'all' })}
      />,
    );
  }
  function pickVersion() {
    openSheet(
      <PickerSheet
        title={t(lang, 'version.label')}
        value={filter.versionId}
        options={[
          { value: 'all', label: t(lang, 'board.all_versions') },
          ...projectVersions.map((v) => ({ value: v.id, label: v.name })),
          { value: 'none', label: t(lang, 'version.none') },
        ]}
        onSelect={(value) => setFilter((f) => ({ ...f, versionId: value }))}
      />,
    );
  }
  function onExcel() {
    openSheet(
      <ExportPeriodSheet
        lang={lang}
        onCancel={closeSheet}
        onConfirm={(r) => {
          closeSheet();
          const sheets = r
            ? buildPeriodSheets(shown, getProjectById, lang, statsCurrency, statsRates, r)
            : buildAllProjectsSheets(projects, (id) => shown.filter((task) => task.projectId === id), lang, statsCurrency, statsRates);
          runExport(`Lancible — ${t(lang, 'export.all_projects')} — ${new Date().toISOString().slice(0, 10)}`, sheets, lang, showToast);
        }}
      />,
    );
  }

  // --- месяц ---
  const monthDate = new Date(anchor);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const cells = useMemo(() => {
    const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const dim = new Date(year, month + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < startOffset; i += 1) out.push(null);
    for (let d = 1; d <= dim; d += 1) out.push({ key: dayKey(new Date(year, month, d)), day: d });
    while (out.length % 7) out.push(null);
    const rows = [];
    for (let i = 0; i < out.length; i += 7) rows.push(out.slice(i, i + 7));
    return rows;
  }, [year, month]);
  const dayAgg = useMemo(() => aggregateDays(shown, statsRates), [shown, statsRates]);
  const monthTotal = useMemo(
    () => rangeAgg(shown, statsRates, new Date(year, month, 1), endOfDay(new Date(year, month + 1, 0))),
    [shown, statsRates, year, month],
  );
  const rangeBounds = useMemo(() => {
    if (!range.from || !range.to) return null;
    let a = keyToDate(range.from);
    let b = keyToDate(range.to);
    if (a > b) [a, b] = [b, a];
    return [a, endOfDay(b)];
  }, [range.from, range.to]);

  function togglePeriod() {
    if (!periodOn) setRange({ from: dayKey(new Date(year, month, 1)), to: dayKey(new Date(year, month + 1, 0)), picking: false });
    setPeriodOn((v) => !v);
  }
  function pickRangeDay(key) {
    setRange((r) => (r.picking ? { ...r, to: key, picking: false } : { from: key, to: key, picking: true }));
  }

  // Панель периода: задачи с суммами за отрезок, по проектам.
  const periodRows = useMemo(() => {
    if (!periodOn || !rangeBounds) return [];
    const [a, b] = rangeBounds;
    const byTask = new Map();
    for (const task of shown) {
      for (const s of task.sessions || []) {
        const d = new Date(s.start);
        if (d < a || d > b) continue;
        let e = byTask.get(task.id);
        if (!e) { e = { task, ms: 0, money: 0 }; byTask.set(task.id, e); }
        e.ms += s.ms;
        e.money += sessionMoney(s, task, statsRates);
      }
    }
    return [...byTask.values()].sort((x, y) => y.ms - x.ms);
  }, [periodOn, rangeBounds, shown, statsRates]);
  const periodTotal = periodRows.reduce((a, r) => ({ ms: a.ms + r.ms, money: a.money + r.money }), { ms: 0, money: 0 });

  // Панель дня: записи выбранного дня, по проектам.
  const dayRows = useMemo(() => {
    const d0 = keyToDate(selected).getTime();
    return Agenda.sessionSegments(shown, d0, d0 + Agenda.DAY).map((seg) => {
      const task = getTask(shown, seg.taskId);
      const s = task.sessions[seg.index];
      return { task, seg, index: seg.index, ms: seg.ms, money: sessionMoney({ ...s, ms: seg.ms }, task, statsRates) };
    });
  }, [shown, selected, statsRates]);
  const dayTotal = dayRows.reduce((a, r) => ({ ms: a.ms + r.ms, money: a.money + r.money }), { ms: 0, money: 0 });

  const monthSwipe = useMemo(() => Gesture.Pan()
    .enabled(isFocused && mode === 'month')
    .runOnJS(true)
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onEnd((e) => { if (Math.abs(e.translationX) > 60 || Math.abs(e.velocityX) > 700) shift(e.translationX < 0 ? 1 : -1); }),
  [isFocused, mode]);

  // --- расписание (список на 30 дней) ---
  const agendaDays = useMemo(() => {
    if (mode !== 'agenda') return [];
    const segs = Agenda.sessionSegments(shown, from, to);
    const dls = Agenda.deadlineItems(shown, from, to).concat(Agenda.repeatGhosts(shown, from, to));
    const byDay = new Map();
    const put = (i, row) => { if (!byDay.has(i)) byDay.set(i, []); byDay.get(i).push(row); };
    for (const dl of dls) put(dl.dayIndex, { kind: 'dl', at: dl.at, dl });
    for (const seg of segs) put(seg.dayIndex, { kind: 'seg', at: seg.start, seg });
    return [...byDay.keys()].sort((a, b) => a - b).map((i) => ({
      start: from + i * Agenda.DAY,
      rows: byDay.get(i).sort((a, b) => a.at - b.at),
    }));
  }, [mode, shown, from, to]);

  const todayKey = dayKey(nowDate);
  const colorOf = (projectId) => { const p = getProject(projects, projectId); return p ? p.color : colors.accent; };
  const nameOf = (task) => (task ? (task.title || t(lang, 'task.no_name')) : '');

  const head = (
    <View style={styles.head}>
      <View style={styles.modes}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[styles.modeTab, mode === m && styles.modeTabOn]}>
            <Text style={[styles.modeText, mode === m && styles.modeTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {t(lang, MODE_KEY[m])}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.navRow}>
        <Pressable hitSlop={10} onPress={() => shift(-1)} style={styles.navBtn}><Icon name="chevron-left" size={16} color={colors.text} /></Pressable>
        <Pressable onPress={goToday} style={styles.navTitleBtn}><Text style={styles.navTitle} numberOfLines={1}>{title}</Text></Pressable>
        <Pressable hitSlop={10} onPress={() => shift(1)} style={styles.navBtn}><Icon name="chevron-right" size={16} color={colors.text} /></Pressable>
      </View>
      <View style={styles.toolRow}>
        <Pressable style={[styles.chip, filterProject && styles.chipOn]} onPress={pickProject} hitSlop={4}>
          {filterProject ? <View style={[styles.dot, { backgroundColor: filterProject.color }]} /> : null}
          <Text style={[styles.chipText, filterProject && styles.chipTextOn]} numberOfLines={1}>{filterProject ? filterProject.name : t(lang, 'filter.all_projects')}</Text>
          <Icon name="chevron-down" size={10} color={colors.textFaint} />
        </Pressable>
        {filterProject && projectVersions.length ? (
          <Pressable style={[styles.chip, filter.versionId !== 'all' && styles.chipOn]} onPress={pickVersion} hitSlop={4}>
            <Text style={styles.chipText} numberOfLines={1}>
              {filter.versionId === 'all' ? t(lang, 'board.all_versions') : filter.versionId === 'none' ? t(lang, 'version.none') : ((projectVersions.find((v) => v.id === filter.versionId) || {}).name || '')}
            </Text>
            <Icon name="chevron-down" size={10} color={colors.textFaint} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable style={styles.iconBtn} onPress={toggleTimeStats} hitSlop={4} accessibilityLabel={t(lang, statsHidden ? 'time.show_stats' : 'time.hide_stats')}>
          <Icon name="panel" size={15} color={statsHidden ? colors.textFaint : colors.text} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={onExcel} hitSlop={4} accessibilityLabel={t(lang, 'menu.export_excel')}>
          <Icon name="download" size={15} color={colors.text} />
        </Pressable>
        <Pressable style={styles.addBtn} onPress={addEntry} hitSlop={4}>
          <Icon name="plus" size={12} color={colors.accentText} />
          <Text style={styles.addBtnText}>{t(lang, 'agenda.entry')}</Text>
        </Pressable>
      </View>

      {!statsHidden ? (
        <Island style={styles.stats} testID="time-stats">
          <View style={styles.kpiRow}>
            <View style={styles.kpi}><Text style={styles.kpiNum} numberOfLines={1}>{fmtDur(totalMs, lang)}</Text><Text style={styles.kpiLabel} numberOfLines={1}>{t(lang, 'stats.worked')}</Text></View>
            <View style={styles.kpi}><Text style={styles.kpiNum} numberOfLines={1}>{fmtMoney(totalMoney, lang, statsCurrency)}</Text><Text style={styles.kpiLabel} numberOfLines={1}>{t(lang, 'stats.earned')}</Text></View>
          </View>
          <View style={styles.kpiRow}>
            <View style={styles.kpi}><Text style={styles.kpiNum} numberOfLines={1}>{fmtMoney(monthMoney, lang, statsCurrency)}</Text><Text style={styles.kpiLabel} numberOfLines={1}>{t(lang, 'stats.month')}</Text></View>
            <View style={styles.kpi}><Text style={styles.kpiNum} numberOfLines={1}>{shown.length ? `${doneCount} / ${shown.length}` : '0'}</Text><Text style={styles.kpiLabel} numberOfLines={1}>{t(lang, 'stats.done')}</Text></View>
          </View>
        </Island>
      ) : null}
    </View>
  );

  const sessionRow = (r, i, extra) => (
    <IslandRow key={`${r.task.id}-${r.index}-${i}`} first={i === 0} onPress={() => onTapBlock(r.task.id, r.index)}>
      <Text style={styles.rowTime}>{`${hmOf(r.seg.start)}–${hmOf(r.seg.end)}`}</Text>
      <Text style={styles.rowName} numberOfLines={1}>{nameOf(r.task)}</Text>
      {extra}
      <Text style={styles.rowDur}>{fmtDur(r.ms, lang)}</Text>
    </IslandRow>
  );

  if (GRID_MODES.includes(mode)) {
    return (
      <View style={styles.container}>
        <SearchHeader navigation={navigation} />
        {head}
        <AgendaGrid
          tasks={shown}
          projects={projects}
          from={from}
          days={days}
          nowMs={nowMs}
          lang={lang}
          enabled={isFocused}
          bottomPadding={insets.bottom + clearance}
          onOpenDay={openDay}
          onTapBlock={onTapBlock}
          onTapDeadline={openTask}
          onCreate={onCreate}
          onMove={onMove}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SearchHeader navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {head}

        {mode === 'month' ? (
          <>
            <Island testID="time-month">
              <View style={styles.monthHead}>
                <Text style={styles.monthTot} numberOfLines={1}>
                  {t(lang, 'calendar.for_month')} · <Text style={styles.monthTotNum}>{fmtDur(monthTotal.ms, lang)} · {fmtMoney(monthTotal.money, lang, statsCurrency)}</Text>
                </Text>
                <Pressable onPress={togglePeriod} style={[styles.periodBtn, periodOn && styles.periodBtnOn]} hitSlop={4}>
                  <Text style={[styles.periodBtnText, periodOn && styles.periodBtnTextOn]}>{t(lang, periodOn ? 'calendar.period_off' : 'calendar.choose_period')}</Text>
                </Pressable>
              </View>
              <View style={styles.weekdaysRow}>
                {WEEKDAY_KEYS.map((k) => <Text key={k} style={styles.weekday}>{t(lang, k)}</Text>)}
              </View>
              <GestureDetector gesture={monthSwipe}>
                <View style={styles.grid} collapsable={false}>
                  {cells.map((row, ri) => (
                    <View key={ri} style={styles.gridRow}>
                      {row.map((c, ci) => {
                        if (!c) return <View key={`e${ri}-${ci}`} style={[styles.cell, styles.cellEmpty]} />;
                        const agg = dayAgg.get(c.key);
                        const pct = agg ? Math.min(100, (agg.ms / (8 * 3_600_000)) * 100) : 0;
                        const inRange = periodOn && rangeBounds && keyToDate(c.key) >= rangeBounds[0] && keyToDate(c.key) <= rangeBounds[1];
                        const isEnd = periodOn && (c.key === range.from || c.key === range.to);
                        const isSel = !periodOn && c.key === selected;
                        return (
                          <Pressable
                            key={c.key}
                            onPress={() => (periodOn ? pickRangeDay(c.key) : setSelected(c.key))}
                            style={[styles.cell, isSel && styles.cellSel, inRange && styles.cellInRange, isEnd && styles.cellEnd]}
                          >
                            <Text style={[styles.cellNum, c.key === todayKey && styles.cellNumToday]}>{c.day}</Text>
                            {agg ? <Text style={styles.cellTime} numberOfLines={1}>{fmtDur(agg.ms, lang)}</Text> : null}
                            {agg ? <View style={styles.cellBarTrack}><View style={[styles.cellBar, { width: `${pct}%` }]} /></View> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </GestureDetector>
              {periodOn && rangeBounds ? (
                <View style={styles.periodBar}>
                  <Text style={styles.periodRange} numberOfLines={1}>
                    {t(lang, 'calendar.period_label')} · {rangeBounds[0].toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – {rangeBounds[1].toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                  </Text>
                  <Text style={styles.periodSum}>{fmtDur(periodTotal.ms, lang)} · {fmtMoney(periodTotal.money, lang, statsCurrency)}</Text>
                </View>
              ) : null}
            </Island>

            <Island testID="time-panel">
              {periodOn ? (
                <>
                  <IslandHead title={t(lang, 'calendar.period_label')} note={periodRows.length ? fmtDur(periodTotal.ms, lang) : ''} />
                  {periodRows.length === 0 ? <IslandEmpty>{t(lang, 'calendar.day_empty')}</IslandEmpty> : null}
                  {groupByProject(periodRows, projects).map((g) => (
                    <View key={g.project ? g.project.id : 'none'}>
                      <View style={styles.group}>
                        <View style={[styles.dot, { backgroundColor: g.project ? g.project.color : colors.accent }]} />
                        <Text style={styles.groupName} numberOfLines={1}>{g.project ? g.project.name : ''}</Text>
                        <Text style={styles.groupSum}>{fmtDur(g.ms, lang)} · {fmtMoney(g.money, lang, currencyOf(g.project, settings))}</Text>
                      </View>
                      {g.rows.map((r, i) => (
                        <IslandRow key={r.task.id} first={i === 0} onPress={() => openTask(r.task.id)}>
                          <Icon name="check" size={11} color={r.task.done ? colors.accentInk : colors.textFaint} />
                          <Text style={styles.rowName} numberOfLines={1}>{nameOf(r.task)}</Text>
                          <Text style={styles.rowMoney}>{fmtMoney(r.money, lang, currencyOf(g.project, settings))}</Text>
                          <Text style={styles.rowDur}>{fmtDur(r.ms, lang)}</Text>
                        </IslandRow>
                      ))}
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <IslandHead
                    title={capFirst(keyToDate(selected).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' }))}
                    note={`${t(lang, 'home.open_day')} →`}
                    onPressNote={() => openDay(keyToDate(selected).getTime())}
                  />
                  {dayRows.length ? <Text style={styles.dayTot}>{fmtDur(dayTotal.ms, lang)} · {fmtMoney(dayTotal.money, lang, statsCurrency)}</Text> : null}
                  {dayRows.length === 0 ? <IslandEmpty>{t(lang, 'calendar.day_empty')}</IslandEmpty> : null}
                  {groupByProject(dayRows, projects).map((g) => (
                    <View key={g.project ? g.project.id : 'none'}>
                      <View style={styles.group}>
                        <View style={[styles.dot, { backgroundColor: g.project ? g.project.color : colors.accent }]} />
                        <Text style={styles.groupName} numberOfLines={1}>{g.project ? g.project.name : ''}</Text>
                        <Text style={styles.groupSum}>{fmtDur(g.ms, lang)}</Text>
                      </View>
                      {g.rows.map((r, i) => sessionRow(r, i))}
                    </View>
                  ))}
                </>
              )}
            </Island>
          </>
        ) : null}

        {mode === 'agenda' ? (
          <>
            {agendaDays.length === 0 ? <Island><IslandEmpty>{t(lang, 'agenda.empty')}</IslandEmpty></Island> : null}
            {agendaDays.map((d) => (
              <Island key={d.start}>
                <IslandHead title={capFirst(new Date(d.start).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' }))} note={dayKey(new Date(d.start)) === todayKey ? t(lang, 'calendar.today') : ''} />
                {d.rows.map((row, i) => {
                  if (row.kind === 'dl') {
                    const task = getTask(tasks, row.dl.taskId);
                    return (
                      <IslandRow key={`dl-${row.dl.taskId}-${row.dl.at}`} first={i === 0} onPress={() => openTask(row.dl.taskId)} style={row.dl.ghost && styles.ghostRow}>
                        <Text style={styles.rowTime}>{hmOf(row.dl.at)}</Text>
                        <View style={[styles.dot, { backgroundColor: colorOf(row.dl.projectId) }]} />
                        <Text style={styles.rowName} numberOfLines={1}>{(row.dl.ghost ? '↻ ' : '') + nameOf(task)}</Text>
                        <Text style={styles.rowTag}>{t(lang, 'agenda.deadline')}</Text>
                      </IslandRow>
                    );
                  }
                  const task = getTask(tasks, row.seg.taskId);
                  return (
                    <IslandRow key={`s-${row.seg.taskId}-${row.seg.index}-${row.seg.start}`} first={i === 0} onPress={() => onTapBlock(row.seg.taskId, row.seg.index)}>
                      <Text style={styles.rowTime}>{`${hmOf(row.seg.start)}–${hmOf(row.seg.end)}`}</Text>
                      <View style={[styles.dot, { backgroundColor: colorOf(row.seg.projectId) }]} />
                      <Text style={styles.rowName} numberOfLines={1}>{nameOf(task)}</Text>
                      <Text style={styles.rowDur}>{fmtDur(row.seg.ms, lang)}</Text>
                    </IslandRow>
                  );
                })}
              </Island>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors, cellSize, insets, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: insets.bottom + clearance + spacing.xl, gap },
  head: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  modes: { flexDirection: 'row', gap: 3, padding: 3, backgroundColor: colors.panel2, borderRadius: radius.md },
  modeTab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.sm, paddingHorizontal: 2 },
  modeTabOn: { backgroundColor: colors.tabActiveBg },
  modeText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  modeTextOn: { color: colors.text },
  navRow: { flexDirection: 'row', alignItems: 'center' },
  navBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  navTitleBtn: { flex: 1, alignItems: 'center' },
  navTitle: { color: colors.text, fontSize: fontSize.md, fontFamily: displayFamily.bold },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.panel2, maxWidth: 150 },
  chipOn: { backgroundColor: colors.accentMuted },
  chipText: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600', flexShrink: 1 },
  chipTextOn: { color: colors.text },
  dot: { width: 8, height: 8, borderRadius: 2 },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.panel2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.accent },
  addBtnText: { color: colors.accentText, fontSize: fontSize.xs, fontWeight: '700' },

  stats: { gap: spacing.sm, marginTop: spacing.xs },
  kpiRow: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, minWidth: 0 },
  kpiNum: { color: colors.text, fontSize: 18, fontFamily: displayFamily.bold },
  kpiLabel: { color: colors.textFaint, fontSize: fontSize.xs },

  monthHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  monthTot: { flex: 1, color: colors.textDim, fontSize: fontSize.xs },
  monthTotNum: { color: colors.text, fontWeight: '700' },
  periodBtn: { height: 28, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.panel2, justifyContent: 'center' },
  periodBtnOn: { backgroundColor: colors.accent },
  periodBtnText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  periodBtnTextOn: { color: colors.accentText },
  weekdaysRow: { flexDirection: 'row', gap: GRID_GAP, marginBottom: spacing.xs },
  weekday: { width: cellSize, textAlign: 'center', color: colors.textFaint, fontSize: 10 },
  grid: { gap: GRID_GAP },
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  cell: { width: cellSize, minHeight: 50, alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.sm, gap: 2, backgroundColor: colors.panel2 },
  cellEmpty: { backgroundColor: 'transparent' },
  cellSel: { backgroundColor: colors.accentMuted },
  cellInRange: { backgroundColor: colors.accentMuted },
  cellEnd: { backgroundColor: colors.accentMuted, borderWidth: 2, borderColor: colors.accent },
  cellNum: { color: colors.text, fontSize: fontSize.sm },
  cellNumToday: { color: colors.accentInk, fontWeight: '800' },
  cellTime: { color: colors.textDim, fontSize: 9 },
  cellBarTrack: { width: '70%', height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  cellBar: { height: '100%', backgroundColor: colors.accent },
  periodBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  periodRange: { flex: 1, color: colors.textDim, fontSize: fontSize.xs },
  periodSum: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },

  dayTot: { color: colors.textDim, fontSize: fontSize.xs, marginTop: 2 },
  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md, marginBottom: 2 },
  groupName: { flex: 1, color: colors.text, fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  groupSum: { color: colors.textFaint, fontSize: fontSize.xs },
  rowTime: { width: 86, color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  rowName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  rowMoney: { color: colors.textFaint, fontSize: fontSize.xs },
  rowDur: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowTag: { color: colors.textFaint, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  ghostRow: { opacity: 0.6 },
});

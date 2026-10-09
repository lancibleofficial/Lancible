// «Сегодня» (макет B2): неделя столбиками сверху, под ней последняя задача
// с кнопкой запуска, затем записи выбранного дня по проектам и сроки на
// сегодня и завтра. Имя вкладки в навигации осталось «Home» — на него
// ссылаются переходы со всех экранов.
//
// Часовая сетка дня с перетаскиванием (AgendaGrid) не ушла: кнопка в шапке
// переключает список записей на сетку того же дня и обратно.
import { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import Island, { IslandHead, IslandRow, IslandEmpty } from '../components/Island';
import TaskRow from '../components/TaskRow';
import TabHeader, { HeaderButton } from '../components/TabHeader';
import EntrySheet from '../components/EntrySheet';
import SessionSheet from '../components/SessionSheet';
import DatePickSheet from '../components/DatePickSheet';
import AgendaGrid, { hmOf } from '../components/AgendaGrid';
import { useAppStore, recentTasks, getProject, getTask, lastSessionAt } from '../store/useAppStore';
import { useRates, useRatesMain, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, fmtShort, fmtDateShort, fmtWhen, taskElapsedMs, earnedOf, earnedShown, sessionMoney, capFirst } from '../lib/format';
import { dayKey, keyToDate, mondayOf, aggregateDays } from '../lib/calendarMath';
import { useTicker } from '../hooks/useTicker';
import { openSheet } from '../store/useSheetStore';
import Agenda from '../core/agenda.js';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius, fontSize, displayFamily, gap } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const DAY = 86400000;
const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

export default function HomeScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const styles = useMemo(() => makeStyles(colors, clearance), [colors, clearance]);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const startTimer = useAppStore((s) => s.startTimer);
  const setSessionSpan = useAppStore((s) => s.setSessionSpan);
  const lang = settings.lang;
  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const rates = useRates();
  const ratesMain = useRatesMain();
  useTicker(!!activeTimer);
  const now = Date.now();

  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [view, setView] = useState('list');
  const selDate = keyToDate(selected);
  const dayStart = selDate.getTime();
  const todayKey = dayKey(new Date(now));

  // --- неделя выбранного дня ---
  const weekFrom = mondayOf(selDate);
  const agg = useMemo(() => aggregateDays(tasks, ratesMain), [tasks, ratesMain]);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekFrom.getTime() + i * DAY);
    const key = dayKey(d);
    const e = agg.get(key) || { ms: 0, money: 0 };
    return { key, d, ms: e.ms, money: e.money };
  });
  const weekTotal = weekDays.reduce((a, x) => ({ ms: a.ms + x.ms, money: a.money + x.money }), { ms: 0, money: 0 });
  const maxMs = Math.max(3_600_000, ...weekDays.map((x) => x.ms));
  const weekTo = new Date(weekFrom.getTime() + 6 * DAY);

  // --- последняя задача (не идущая) ---
  const lastTask = useMemo(
    () => recentTasks(tasks, 3, activeTimer).find((task) => !(activeTimer && activeTimer.taskId === task.id)) || null,
    [tasks, activeTimer],
  );
  const lastProject = lastTask ? getProject(projects, lastTask.projectId) : null;

  // --- записи дня по проектам ---
  const segments = useMemo(() => Agenda.sessionSegments(tasks, dayStart, dayStart + DAY), [tasks, dayStart]);
  const rows = segments.map((seg) => {
    const task = getTask(tasks, seg.taskId);
    const s = task ? (task.sessions || [])[seg.index] : null;
    return task && s ? { task, seg, money: sessionMoney({ ...s, ms: seg.ms }, task, ratesMain) } : null;
  }).filter(Boolean);
  const runningToday = activeTimer && getTask(tasks, activeTimer.taskId)
    && new Date(activeTimer.startedAt).getTime() < dayStart + DAY && now > dayStart;
  const runningStart = runningToday ? Math.max(new Date(activeTimer.startedAt).getTime(), dayStart) : 0;
  const dayTotal = {
    ms: rows.reduce((a, r) => a + r.seg.ms, 0) + (runningToday ? now - runningStart : 0),
    money: rows.reduce((a, r) => a + r.money, 0),
  };
  const byProject = [];
  for (const r of rows) {
    let g = byProject.find((x) => x.projectId === r.task.projectId);
    if (!g) { g = { projectId: r.task.projectId, project: getProject(projects, r.task.projectId), rows: [], ms: 0, money: 0 }; byProject.push(g); }
    g.rows.push(r); g.ms += r.seg.ms; g.money += r.money;
  }
  byProject.sort((a, b) => b.ms - a.ms);
  if (runningToday) {
    const task = getTask(tasks, activeTimer.taskId);
    let g = byProject.find((x) => x.projectId === task.projectId);
    if (!g) { g = { projectId: task.projectId, project: getProject(projects, task.projectId), rows: [], ms: 0, money: 0 }; byProject.unshift(g); }
    g.running = { task, start: runningStart };
  }

  // --- сроки сегодня и завтра ---
  const dueSoon = useMemo(() => tasks.filter((task) => {
    if (task.done || !task.dueAt) return false;
    const due = new Date(task.dueAt).getTime();
    return due < dayStart + 2 * DAY;
  }).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)), [tasks, dayStart]);

  const openTask = (taskId) => navigation.navigate('TaskDetail', { taskId });
  function onEntry(r) {
    openSheet(<SessionSheet task={r.task} index={r.seg.index} onOpenTask={openTask} />);
  }
  function addEntry() {
    const base = selected === todayKey ? now : dayStart + 12 * 3_600_000;
    openSheet(<EntrySheet initial={{ start: base - 3_600_000, end: base }} />);
  }
  function pickDay() {
    openSheet(<DatePickSheet title={t(lang, 'today.pick_day')} valueKey={selected} onPick={setSelected} />);
  }

  const dayTitle = selected === todayKey
    ? t(lang, 'calendar.today')
    : capFirst(selDate.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' }));
  const dayLong = capFirst(selDate.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' }));

  const weekIsland = (
    <Island style={styles.week}>
      <View style={styles.weekHead}>
        <Text style={styles.label}>{t(lang, 'today.week_label', { range: `${fmtDateShort(weekFrom, lang)}–${fmtDateShort(weekTo, lang)}` })}</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.weekNum}>{fmtDur(weekTotal.ms, lang)}</Text>
        <Text style={[styles.weekNum, { color: colors.textDim }]}>{fmtMoney(weekTotal.money, lang, settings.currency)}</Text>
      </View>
      <View style={styles.bars}>
        {weekDays.map((x) => {
          const on = x.key === selected;
          return (
            <Tap key={x.key} onPress={() => setSelected(x.key)} style={[styles.bar, on && styles.barOn]} accessibilityRole="button" accessibilityLabel={dayLong}>
              <Text style={styles.barVal}>{x.ms ? fmtShort(x.ms, lang) : ''}</Text>
              <View style={[styles.barFill, { height: Math.max(4, Math.round((x.ms / maxMs) * 56)) }, on && styles.barFillOn]} />
              <Text style={[styles.barDay, on && styles.barDayOn]}>{t(lang, WEEKDAY_KEY[x.d.getDay()])}</Text>
            </Tap>
          );
        })}
      </View>
    </Island>
  );

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.home')}>
        <HeaderButton icon="plus" label={t(lang, 'agenda.new_entry')} onPress={addEntry} />
        <HeaderButton icon="calendar" label={t(lang, 'today.pick_day')} onPress={pickDay} />
        <HeaderButton icon={view === 'list' ? 'panel' : 'list'} label={t(lang, view === 'list' ? 'today.grid' : 'today.list')} onPress={() => setView((v) => (v === 'list' ? 'grid' : 'list'))} />
      </TabHeader>

      {view === 'grid' ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: spacing.md }}>{weekIsland}</View>
          <AgendaGrid
            tasks={tasks}
            projects={projects}
            from={dayStart}
            days={1}
            nowMs={now}
            lang={lang}
            bottomPadding={clearance}
            onOpenDay={(ms) => setSelected(dayKey(new Date(ms)))}
            onTapBlock={(taskId, index) => { const task = getTask(tasks, taskId); if (task) openSheet(<SessionSheet task={task} index={index} onOpenTask={openTask} />); }}
            onTapDeadline={openTask}
            onCreate={(span) => openSheet(<EntrySheet initial={span} />)}
            onMove={(taskId, index, start, end) => setSessionSpan(taskId, index, start, end)}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {weekIsland}

          {lastTask ? (
            <Island style={styles.last}>
              <Tap onPress={() => startTimer(lastTask.id)} style={styles.lastPlay} accessibilityRole="button" accessibilityLabel={t(lang, 'timer.start')}>
                <Icon name="play" size={16} color={colors.accentText} />
              </Tap>
              <Tap style={{ flex: 1, minWidth: 0 }} onPress={() => openTask(lastTask.id)}>
                <Text style={styles.label}>{t(lang, 'today.last_task')}</Text>
                <Text style={styles.lastName} numberOfLines={1}>{lastTask.title || t(lang, 'task.no_name')}</Text>
                <View style={styles.lastSub}>
                  <View style={[styles.dot, { backgroundColor: lastProject ? lastProject.color : colors.accent }]} />
                  <Text style={styles.lastSubText} numberOfLines={1}>
                    {[lastProject ? lastProject.name : null, fmtWhen(new Date(lastSessionAt(lastTask, activeTimer)).toISOString(), lang), t(lang, 'task.total_label', { time: fmtShort(taskElapsedMs(lastTask, activeTimer), lang) })].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Tap>
              {earnedShown(lastTask, rates, earnedOf(lastTask, rates, activeTimer)) ? (
                <Text style={styles.lastMoney}>{fmtMoney(earnedOf(lastTask, rates, activeTimer), lang, currencyOf(lastProject, settings))}</Text>
              ) : null}
            </Island>
          ) : null}

          <View style={styles.dayHead}>
            <Text style={styles.dayTitle}>{dayTitle}</Text>
            <View style={{ flex: 1 }} />
            {dayTotal.ms ? (
              <>
                <Text style={styles.weekNum}>{fmtDur(dayTotal.ms, lang)}</Text>
                <Text style={[styles.weekNum, { color: colors.textDim }]}>{fmtMoney(dayTotal.money, lang, settings.currency)}</Text>
              </>
            ) : null}
          </View>

          <Island padded={false} style={styles.day}>
            {byProject.length === 0 ? <View style={{ padding: spacing.md }}><IslandEmpty>{t(lang, 'today.no_entries')}</IslandEmpty></View> : null}
            {byProject.map((g) => (
              <View key={g.projectId}>
                <View style={styles.group}>
                  <View style={[styles.dot, { backgroundColor: g.project ? g.project.color : colors.accent }]} />
                  <Text style={styles.groupName} numberOfLines={1}>{g.project ? g.project.name : ''}</Text>
                  <Text style={styles.groupSum}>{fmtDur(g.ms + (g.running ? now - g.running.start : 0), lang)}{g.money ? ` · ${fmtMoney(g.money, lang, currencyOf(g.project, settings))}` : ''}</Text>
                </View>
                {g.rows.map((r, i) => (
                  <IslandRow key={`${r.task.id}-${r.seg.index}-${r.seg.start}`} first={i === 0} onPress={() => onEntry(r)} style={styles.entry}>
                    <Text style={styles.entryTime}>{`${hmOf(r.seg.start)}–${hmOf(r.seg.end)}`}</Text>
                    <Text style={styles.entryName} numberOfLines={1}>{r.task.title || t(lang, 'task.no_name')}</Text>
                    <Text style={styles.entryDur}>{fmtShort(r.seg.ms, lang)}</Text>
                  </IslandRow>
                ))}
                {g.running ? (
                  <IslandRow first={g.rows.length === 0} onPress={() => openTask(g.running.task.id)} style={[styles.entry, styles.entryRun]}>
                    <Text style={styles.entryTime}>{hmOf(g.running.start)}–<Text style={{ color: colors.accentInk }}>{t(lang, 'tasks.now').toLowerCase()}</Text></Text>
                    <Text style={styles.entryName} numberOfLines={1}>{g.running.task.title || t(lang, 'task.no_name')}</Text>
                    <Text style={[styles.entryDur, { color: colors.accentInk }]}>{fmtShort(now - g.running.start, lang)}</Text>
                  </IslandRow>
                ) : null}
              </View>
            ))}
          </Island>

          {dueSoon.length ? (
            <Island padded={false} style={styles.day}>
              <View style={styles.group}>
                <Icon name="clock" size={13} color={colors.textDim} />
                <Text style={[styles.groupName, { color: colors.textDim }]}>{t(lang, 'today.deadlines')}</Text>
              </View>
              {dueSoon.map((task, i) => <TaskRow key={task.id} task={task} first={i === 0} showProject onPress={() => openTask(task.id)} />)}
            </Island>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.md, paddingTop: 2, paddingBottom: clearance, gap },
  label: { color: colors.textFaint, fontSize: 10.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  week: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  weekHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 4 },
  weekNum: { color: colors.text, fontSize: 15, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', gap: 5, height: 100, alignItems: 'flex-end' },
  bar: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 5, borderRadius: 9, paddingVertical: 5 },
  barOn: { backgroundColor: colors.panel2 },
  barVal: { color: colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
  barFill: { width: '100%', maxWidth: 26, borderRadius: 6, backgroundColor: colors.raise },
  barFillOn: { backgroundColor: colors.accent },
  barDay: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  barDayOn: { color: colors.text },
  last: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  lastPlay: { width: 46, height: 46, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  lastName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', marginTop: 1 },
  lastSub: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lastSubText: { color: colors.textFaint, fontSize: 11.5, flexShrink: 1 },
  lastMoney: { color: colors.textDim, fontSize: fontSize.sm, fontFamily: displayFamily.bold },
  dot: { width: 8, height: 8, borderRadius: 3 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingHorizontal: spacing.xs },
  dayTitle: { color: colors.text, fontSize: 16, fontFamily: displayFamily.bold },
  day: { overflow: 'hidden', paddingBottom: 4 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 3 },
  groupName: { flex: 1, color: colors.text, fontSize: 12.5, fontWeight: '700' },
  groupSum: { color: colors.textDim, fontSize: 12, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  entry: { paddingHorizontal: spacing.md, minHeight: 46 },
  entryRun: { backgroundColor: colors.accentMuted },
  entryTime: { width: 82, color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  entryName: { flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '600' },
  entryDur: { color: colors.textDim, fontSize: 13, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
});

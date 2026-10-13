// «Сегодня» (макет B2): неделя столбиками сверху, под ней последняя задача
// с кнопкой запуска, затем дедлайны на сегодня и завтра, недавние задачи
// (четыре строки и «Смотреть все» — на вкладку «Задачи») и в самом конце
// записи выбранного дня по проектам. Имя вкладки в навигации осталось
// «Home» — на него ссылаются переходы со всех экранов.
//
// Часовая сетка дня с перетаскиванием (AgendaGrid) не ушла: кнопка в шапке
// переключает список записей на сетку того же дня и обратно. День в сетке
// выбирает остров недели над ней, поэтому своей шапки дня («Вс / 11») у
// сетки здесь нет.
//
// Строки задач в «Сроках» и «Недавних» (TodayRow): галочка наливается с «попом»
// и брызгами, а задача отмечается в тот же миг (шкалы и счётчики не ждут),
// строка же стоит на месте до конца налива (hold.markNow), потом уходит —
// уменьшается, тает и схлопывается (rowExit), соседи подъезжают (layout из
// useOrderHold). Отменённых в этих списках нет. Пока человек на странице,
// ничего не прыгает: запуск таймера порядок по-прежнему не двигает.
import { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import Island, { IslandHead, IslandRow } from '../components/Island';
import EmptyState from '../components/EmptyState';
import NewProjectSheet from '../components/NewProjectSheet';
import TaskRow from '../components/TaskRow';
import { LiquidButton } from '../components/Liquid';
import { LiquidColumn } from '../components/ProgressBar';
import TabHeader, { HeaderButton } from '../components/TabHeader';
import EntrySheet from '../components/EntrySheet';
import SessionSheet from '../components/SessionSheet';
import DatePickSheet from '../components/DatePickSheet';
import AgendaGrid, { hmOf } from '../components/AgendaGrid';
import { useAppStore, recentTasks, getProject, getTask, lastSessionAt } from '../store/useAppStore';
import { useRates, useRatesMain, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, fmtShort, fmtDateShort, fmtWhen, taskElapsedMs, earnedOf, earnedShown, sessionMoney, capFirst } from '../lib/format';
import { dayKey, keyToDate, mondayOf, addDays, aggregateDays } from '../lib/calendarMath';
import { useTicker } from '../hooks/useTicker';
import { useOrderHold } from '../hooks/useOrderHold';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { isCancelled } from '../lib/statuses';
import { rowExit } from '../lib/rowExit';
import { openSheet, closeSheet } from '../store/useSheetStore';
import Agenda from '../core/agenda.js';
import Slots from '../core/slots.js';
import { rangeText } from '../lib/slotText';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, screenPadding, radius, fontSize, displayFamily, gap, taskControlRadius } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];
// Сколько строк в «Недавних задачах». Остальное — на вкладке «Задачи».
const RECENT_SHOWN = 4;

/**
 * Строка задачи в «Сроках» и «Недавних». Галочка меняет задачу сразу, а строку
 * не убирает: она стоит на месте, пока играет налив с «попом» и брызгами
 * (LiquidCheck, LIQUID.check; hold.markNow держит её и ставит layout
 * переезда), потом выпадает из списка и уходит (exiting), соседи подъезжают
 * (layout). Повторяющаяся задача после отметки остаётся в списке со следующим
 * сроком — галочка тогда стекает обратно. «Уменьшение движения» — всё сразу,
 * exiting нет.
 * @param exiting rowExit или ничего (без движения)
 * @param style   коробка строки: заливка острова (соседи при переезде не
 *                просвечивают) и overflow: hidden (высота схлопывается)
 */
function TodayRow({ task, first, hold, exiting, style, onOpen }) {
  const onDone = (_task, change) => hold.markNow(change, task);
  return (
    <Animated.View layout={hold.layout} exiting={exiting} style={style} testID={`today-row-${task.id}`}>
      <TaskRow task={task} first={first} showProject checked={hold.marked(task.id)} onToggleDone={onDone} onPress={() => onOpen(task.id)} />
    </Animated.View>
  );
}

export default function HomeScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const styles = useMemo(() => makeStyles(colors, clearance), [colors, clearance]);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const setSessionSpan = useAppStore((s) => s.setSessionSpan);
  const lang = settings.lang;
  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const rates = useRates();
  const ratesMain = useRatesMain();
  useTicker(!!activeTimer);
  // Порядок «последней задачи» и проектов дня: запуск его не двигает,
  // остановка — плавный переезд, уход с экрана — пересчёт без движения.
  const hold = useOrderHold(navigation);
  // Строка, выпавшая из списка (отметили), уходит жидко; без движения — сразу.
  const exiting = useReduceMotion() ? undefined : rowExit;
  const now = Date.now();

  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [view, setView] = useState('list');
  const selDate = keyToDate(selected);
  const dayStart = selDate.getTime();
  // Конец дня и начало послезавтра — по календарю: в день перевода часов сутки
  // длятся 23 или 25 часов, и `dayStart + 86400000` захватил бы чужой час.
  const dayEnd = addDays(selDate, 1).getTime();
  const dayAfterNext = addDays(selDate, 2).getTime();
  const todayKey = dayKey(new Date(now));

  // --- неделя выбранного дня ---
  const weekFrom = mondayOf(selDate);
  const agg = useMemo(() => aggregateDays(tasks, ratesMain), [tasks, ratesMain]);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekFrom, i);
    const key = dayKey(d);
    const e = agg.get(key) || { ms: 0, money: 0 };
    return { key, d, ms: e.ms, money: e.money };
  });
  const weekTotal = weekDays.reduce((a, x) => ({ ms: a.ms + x.ms, money: a.money + x.money }), { ms: 0, money: 0 });
  const maxMs = Math.max(3_600_000, ...weekDays.map((x) => x.ms));
  const weekTo = addDays(weekFrom, 6);

  // --- последняя задача ---
  // На входе идущая из «последней» уходит: она в записях дня строкой «сейчас»,
  // а остров показывает следующую. Но запуск на самом экране остров не
  // перестраивает: задача остаётся на месте, кнопка становится «стоп» — до
  // остановки или ухода с экрана.
  // Списки задач строятся по viewTasks: отмеченная галочкой задача в сторе уже
  // отмечена, но пока налив играет, строка стоит на месте (hold.view).
  const viewTasks = hold.view(tasks);
  const recent = useMemo(
    () => recentTasks(viewTasks.filter((task) => !isCancelled(task, statuses)), RECENT_SHOWN + 1, activeTimer),
    [viewTasks, statuses, activeTimer],
  );
  const recentRows = hold.rows('recent', recent);
  const lastTask = (hold.frozen
    ? recentRows[0]
    : recentRows.find((task) => !(activeTimer && activeTimer.taskId === task.id))) || null;
  const lastRunning = !!activeTimer && !!lastTask && activeTimer.taskId === lastTask.id;
  const lastProject = lastTask ? getProject(projects, lastTask.projectId) : null;
  // «Недавние задачи» — те же свежие, кроме последней: она уже стоит
  // островом выше, и дважды подряд одна и та же задача была бы лишней. Порядок
  // общий с островом (hold), поэтому запуск строки списка её не переставляет,
  // а остановка — плавно поднимает.
  const recentList = recentRows.filter((task) => task !== lastTask).slice(0, RECENT_SHOWN);

  // --- записи дня по проектам ---
  const segments = useMemo(() => Agenda.sessionSegments(tasks, dayStart, dayEnd), [tasks, dayStart, dayEnd]);
  const rows = segments.map((seg) => {
    const task = getTask(tasks, seg.taskId);
    const s = task ? (task.sessions || [])[seg.index] : null;
    return task && s ? { task, seg, money: sessionMoney({ ...s, ms: seg.ms }, task, ratesMain) } : null;
  }).filter(Boolean);
  const runningToday = activeTimer && getTask(tasks, activeTimer.taskId)
    && new Date(activeTimer.startedAt).getTime() < dayEnd && now > dayStart;
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
  // Проекты стоят по времени за день: остановка может переставить проект,
  // запуск — нет (hold держит показанный порядок).
  const groups = hold.rows('projects', byProject, (g) => g.projectId);
  // Проект остановленной задачи на время переезда — поверх соседей.
  const risingTask = hold.rising ? getTask(tasks, hold.rising) : null;

  // --- сроки сегодня и завтра ---
  const dueSoon = useMemo(() => viewTasks.filter((task) => {
    if (task.done || !task.dueAt || isCancelled(task, statuses)) return false;
    const due = new Date(task.dueAt).getTime();
    return due < dayAfterNext;
  }).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)), [viewTasks, statuses, dayAfterNext]);

  // --- время работы выбранного дня ---
  // Вхождения отрезков открытых задач по времени, как их режет календарь;
  // закрытых задач плановых блоков нет (core/slots.js, slotItems).
  const planned = useMemo(() => Slots.slotItems(tasks, dayStart, dayEnd), [tasks, dayStart, dayEnd]);

  const openTask = (taskId) => navigation.navigate('TaskDetail', { taskId });
  function onEntry(r) {
    openSheet(<SessionSheet task={r.task} index={r.seg.index} onOpenTask={openTask} />);
  }
  function addEntry() {
    const base = selected === todayKey ? now : Agenda.atDayFraction(dayStart, 0.5);
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
              {/* Столбик поднимается к своей высоте жидко (components/ProgressBar.js). */}
              <LiquidColumn height={Math.max(4, Math.round((x.ms / maxMs) * 56))} style={[styles.barFill, on && styles.barFillOn]} testID={`week-bar-${x.key}`} />
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
          <View style={{ paddingHorizontal: screenPadding }}>{weekIsland}</View>
          <AgendaGrid
            tasks={tasks}
            projects={projects}
            from={dayStart}
            days={1}
            nowMs={now}
            lang={lang}
            bottomPadding={clearance}
            dayNames={false}
            onTapBlock={(taskId, index) => { const task = getTask(tasks, taskId); if (task) openSheet(<SessionSheet task={task} index={index} onOpenTask={openTask} />); }}
            onTapDeadline={openTask}
            onCreate={(span) => openSheet(<EntrySheet initial={span} />)}
            onMove={(taskId, index, start, end) => setSessionSpan(taskId, index, start, end)}
          />
        </View>
      ) : (
        <ScrollView testID="today-scroll" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {weekIsland}

          {lastTask ? (
            <Island style={styles.last}>
              {/* Запуск остров не перестраивает: задача остаётся, кнопка
                  наливается и становится «стоп» (hold, см. выше). */}
              <LiquidButton
                on={lastRunning}
                kickId={lastTask.id}
                onPress={() => (lastRunning ? stopTimer() : startTimer(lastTask.id))}
                style={styles.lastPlay}
                iconSize={16}
                iconColor={colors.accentText}
                accessibilityRole="button"
                accessibilityLabel={t(lang, lastRunning ? 'timer.stop' : 'timer.start')}
              />
              <Tap style={{ flex: 1, minWidth: 0 }} onPress={() => openTask(lastTask.id)}>
                <Text style={styles.label}>{t(lang, 'today.last_task')}</Text>
                <Text style={styles.lastName} numberOfLines={1}>{lastTask.title || t(lang, 'task.no_name')}</Text>
                <View style={styles.lastSub}>
                  <View style={[styles.dot, { backgroundColor: lastProject ? lastProject.color : colors.accent }]} />
                  <Text style={styles.lastSubText} numberOfLines={1}>
                    {[lastProject ? lastProject.name : null, lastRunning ? t(lang, 'task.running_now') : fmtWhen(new Date(lastSessionAt(lastTask, activeTimer)).toISOString(), lang), t(lang, 'task.total_label', { time: fmtShort(taskElapsedMs(lastTask, activeTimer), lang) })].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Tap>
              {earnedShown(lastTask, rates, earnedOf(lastTask, rates, activeTimer)) ? (
                <Text style={styles.lastMoney}>{fmtMoney(earnedOf(lastTask, rates, activeTimer), lang, currencyOf(lastProject, settings))}</Text>
              ) : null}
            </Island>
          ) : null}

          {dueSoon.length ? (
            <Island padded={false} style={styles.day}>
              <View style={styles.group}>
                <Icon name="clock" size={13} color={colors.textDim} />
                <Text style={[styles.groupName, { color: colors.textDim }]}>{t(lang, 'today.deadlines')}</Text>
              </View>
              {dueSoon.map((task, i) => (
                <TodayRow key={task.id} task={task} first={i === 0} hold={hold} exiting={exiting} style={styles.rowBox} onOpen={openTask} />
              ))}
            </Island>
          ) : null}

          {planned.length ? (
            <Island padded={false} style={styles.day} testID="slots-block">
              <View style={styles.group}>
                <Icon name="calendar" size={13} color={colors.textDim} />
                <Text style={[styles.groupName, { color: colors.textDim }]}>{t(lang, 'slot.label')}</Text>
              </View>
              {planned.map((p, i) => {
                const task = getTask(tasks, p.taskId);
                const project = getProject(projects, p.projectId);
                return (
                  <IslandRow key={`${p.taskId}-${p.slotId}-${p.start}`} first={i === 0} onPress={() => openTask(p.taskId)} style={styles.entry}>
                    <Text style={styles.entryTime}>{rangeText(p.start, p.end)}</Text>
                    <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
                    <Text style={styles.entryName} numberOfLines={1}>{(task && task.title) || t(lang, 'task.no_name')}</Text>
                  </IslandRow>
                );
              })}
            </Island>
          ) : null}

          {recentList.length ? (
            <Island padded={false} style={styles.day} testID="recent-block">
              <View style={styles.group}>
                <Icon name="stopwatch" size={13} color={colors.textDim} />
                <Text style={[styles.groupName, { color: colors.textDim }]}>{t(lang, 'home.recent')}</Text>
              </View>
              {recentList.map((task, i) => (
                <TodayRow
                  key={task.id}
                  task={task}
                  first={i === 0}
                  hold={hold}
                  exiting={exiting}
                  style={[styles.rowBox, task.id === hold.rising && styles.groupRise]}
                  onOpen={openTask}
                />
              ))}
              {/* «Смотреть все» едет вместе со строками, а не прыгает вверх. */}
              <Animated.View layout={hold.layout} style={styles.groupBox}>
                <IslandRow onPress={() => navigation.navigate('Tasks')} style={styles.seeAll}>
                  <Text style={styles.seeAllText}>{t(lang, 'today.see_all')}</Text>
                  <Icon name="arrow-right" size={14} color={colors.accentInk} />
                </IslandRow>
              </Animated.View>
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
            {/* День без записей — пустой экран острова: есть проекты — «Новая
                запись» (тот же лист, что «+» в шапке, поэтому тихая); нет ни
                одного — записи некуда лечь, начать с проекта. */}
            {byProject.length === 0 ? (projects.length ? (
              <EmptyState
                size="sm"
                art="time"
                title={t(lang, 'today.no_entries')}
                text={t(lang, 'empty.entries_text')}
                actionLabel={t(lang, 'agenda.new_entry')}
                onAction={addEntry}
              />
            ) : (
              <EmptyState
                size="sm"
                art="projects"
                title={t(lang, 'empty.start_project')}
                text={t(lang, 'empty.start_project_text')}
                actionLabel={t(lang, 'deck.new_project')}
                actionIcon="plus"
                onAction={() => openSheet(<NewProjectSheet onCancel={closeSheet} onCreated={closeSheet} />)}
                primary
              />
            )) : null}
            {groups.map((g) => (
              <Animated.View key={g.projectId} testID={`day-group-${g.projectId}`} layout={hold.layout} style={[styles.groupBox, risingTask && g.projectId === risingTask.projectId && styles.groupRise]}>
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
              </Animated.View>
            ))}
          </Island>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: screenPadding, paddingTop: 2, paddingBottom: clearance, gap },
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
  lastPlay: { width: 46, height: 46, borderRadius: taskControlRadius, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  lastName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', marginTop: 1 },
  lastSub: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lastSubText: { color: colors.textFaint, fontSize: 11.5, flexShrink: 1 },
  lastMoney: { color: colors.textDim, fontSize: fontSize.sm, fontFamily: displayFamily.bold },
  dot: { width: 8, height: 8, borderRadius: 3 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingHorizontal: spacing.xs },
  dayTitle: { color: colors.text, fontSize: 16, fontFamily: displayFamily.bold },
  day: { overflow: 'hidden', paddingBottom: 4 },
  // Проект едет на новое место с заливкой острова: без неё соседи на
  // пересечении просвечивали бы друг сквозь друга.
  groupBox: { backgroundColor: colors.panel },
  // Строка задачи: то же, и overflow: hidden — на уходе её высота схлопывается.
  rowBox: { backgroundColor: colors.panel, overflow: 'hidden' },
  groupRise: { zIndex: 2 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 3 },
  groupName: { flex: 1, color: colors.text, fontSize: 12.5, fontWeight: '700' },
  // «Смотреть все →» — последняя строка «Недавних задач», по центру, тихая акцентом.
  seeAll: { justifyContent: 'center', gap: 6, minHeight: 44 },
  seeAllText: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '600' },
  groupSum: { color: colors.textDim, fontSize: 12, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  entry: { paddingHorizontal: spacing.md, minHeight: 46 },
  entryRun: { backgroundColor: colors.accentMuted },
  entryTime: { width: 82, color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  entryName: { flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '600' },
  entryDur: { color: colors.textDim, fontSize: 13, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
});

// «Сегодня» — первая вкладка, как на вебе после «островов»: день полосой
// по часам, «Сейчас идёт» (или «Продолжить»), числа день/неделя/месяц,
// три недавних проекта, дедлайны и недавние задачи. Порт renderHome()
// и renderStats() из app.js, острова в один столбец.
//
// Шапка своя, а не навигационная (HomeStack отдаёт этому экрану
// headerShown: false): поле поиска занимает всю ширину и раскрывается в
// отдельный режим. Поиск — это режим, а не фильтр: на время поиска экран
// уступает место результатам целиком, а по «Отмена» возвращается как был.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, FlatList, Pressable, StyleSheet, BackHandler, Keyboard } from 'react-native';
import Text from '../components/AppText';
import { useAppStore, recentTasks, getProject, getTask, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { fmtDur, fmtMoney, fmtClock, fmtShort, fmtDateShort, monthLabel, taskElapsedMs, earnedOf, earnedShown } from '../lib/format';
import { dayKey, mondayOf, aggregateDays, rangeAgg } from '../lib/calendarMath';
import { notificationFeed, dueShort } from '../lib/due';
import { hm } from '../lib/sessions';
import { getStatus } from '../lib/statuses';
import { useRates, useRatesMain, currencyOf } from '../hooks/useRates';
import Island, { IslandHead, IslandRow, IslandEmpty } from '../components/Island';
import RecentTaskRow from '../components/RecentTaskRow';
import NewProjectSheet from '../components/NewProjectSheet';
import EntrySheet from '../components/EntrySheet';
import PrimaryButton from '../components/PrimaryButton';
import SearchHeader, { SEARCH_HEADER_HEIGHT } from '../components/SearchHeader';
import Icon from '../components/Icon';
import { recentProjects, todayStrip } from '../lib/today';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useTicker } from '../hooks/useTicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, spacing, radius, fontSize, typography, displayFamily, gap } from '../theme';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { t, pluralForm, LOCALE_MAP } from '../lib/i18n';

const pad2 = (n) => String(n).padStart(2, '0');
export default function HomeScreen({ navigation, route }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets, useBottomClearance());
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const openProject = useAppStore((s) => s.openProject);
  const lang = settings.lang;
  const rates = useRates();
  const ratesMain = useRatesMain();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  useTicker(!!activeTimer);
  const now = Date.now();
  const nowDate = new Date(now);

  useEffect(() => {
    if (route.params?.openSearch) {
      openSearch();
      navigation.setParams({ openSearch: undefined });
    }
  }, [route.params?.openSearch]);

  // Системное «назад» на Android закрывает поиск, а не приложение.
  useEffect(() => {
    if (!searchOpen) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeSearch(); return true; });
    return () => sub.remove();
  }, [searchOpen]);

  // --- данные островов ---
  const agg = useMemo(() => aggregateDays(tasks, ratesMain), [tasks, ratesMain]);
  const today = agg.get(dayKey(nowDate)) || { ms: 0, money: 0 };
  const weekFrom = mondayOf(nowDate);
  const weekTo = new Date(weekFrom.getTime() + 6 * 86400000);
  weekTo.setHours(23, 59, 59, 999);
  const week = useMemo(() => rangeAgg(tasks, ratesMain, weekFrom, weekTo), [tasks, ratesMain, dayKey(nowDate)]);
  const monthFrom = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  const monthTo = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0, 23, 59, 59);
  const month = useMemo(() => rangeAgg(tasks, ratesMain, monthFrom, monthTo), [tasks, ratesMain, dayKey(nowDate)]);
  const doneCount = tasks.filter((task) => task.done).length;

  const strip = todayStrip(tasks, activeTimer, now);
  const runningTask = activeTimer ? getTask(tasks, activeTimer.taskId) : null;
  const recent = useMemo(() => recentTasks(tasks, 8, activeTimer), [tasks, activeTimer]);
  const nowTask = runningTask || recent[0] || null;
  const nowProject = nowTask ? getProject(projects, nowTask.projectId) : null;
  const nowEarned = nowTask ? earnedOf(nowTask, rates, activeTimer) : 0;
  const homeProjects = useMemo(() => recentProjects(projects, tasks, 3), [projects, tasks]);
  const feed = useMemo(() => notificationFeed(tasks, seenAt).slice(0, 6), [tasks, seenAt, Math.floor(now / 60000)]);
  const overdue = feed.filter((n) => n.kind === 'overdue').length;

  const q = query.trim().toLowerCase();
  const foundProjects = useMemo(
    () => (q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : []),
    [projects, q],
  );
  const foundTasks = useMemo(
    () => (q ? tasks.filter((task) => (task.title || '').toLowerCase().includes(q)) : []),
    [tasks, q],
  );

  function openSearch() { setSearchOpen(true); }
  function closeSearch() { setSearchOpen(false); setQuery(''); Keyboard.dismiss(); }

  function openProjectScreen(id) {
    openProject(id);
    navigation.navigate('Project', { projectId: id });
  }
  function openTask(task) {
    navigation.navigate('Project', { projectId: task.projectId });
    navigation.navigate('TaskDetail', { taskId: task.id });
  }
  function openTaskById(id) {
    const task = getTask(tasks, id);
    if (task) openTask(task);
  }
  function openDay() {
    navigation.navigate('Time', { screen: 'TimeMain', params: { mode: 'day', anchor: dayKey(nowDate) } });
  }
  function addEntry() {
    openSheet(<EntrySheet initial={{ start: now - 3_600_000, end: now }} onDone={() => {}} />);
  }
  function openNewProjectSheet() {
    openSheet(
      <NewProjectSheet
        onCancel={closeSheet}
        onCreated={(project) => { closeSheet(); openProjectScreen(project.id); }}
      />,
    );
  }

  const dayTitleRaw = nowDate.toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayTitle = dayTitleRaw.charAt(0).toUpperCase() + dayTitleRaw.slice(1);
  const hours = Array.from({ length: strip.h1 - strip.h0 }, (_, i) => strip.h0 + i);
  // Подписей часов столько, сколько помещается: при 12 часах — каждый
  // второй, при 16 и больше — каждый третий.
  const hourStep = hours.length > 14 ? 3 : hours.length > 9 ? 2 : 1;

  return (
    <View style={styles.container}>
      <SearchHeader
        navigation={navigation}
        active={searchOpen}
        value={query}
        onChangeText={setQuery}
        onOpen={openSearch}
        onCancel={closeSearch}
        inputRef={searchRef}
      />

      {projects.length === 0 && !searchOpen ? (
        <View style={styles.emptyWrap}>
          <Island style={styles.emptyCard}>
            <Icon name="board" size={36} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{t(lang, 'home.empty_title')}</Text>
            <Text style={styles.emptyText}>{t(lang, 'home.empty_text')}</Text>
            <PrimaryButton title={t(lang, 'home.new_project_title')} onPress={openNewProjectSheet} />
          </Island>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* День */}
          <Island testID="today-day">
            <View style={styles.dayHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.dayTitle} numberOfLines={1}>{dayTitle}</Text>
                <Text style={styles.daySub} numberOfLines={2}>
                  {t(lang, 'home.recorded')}{' '}
                  <Text style={styles.daySubNum}>{fmtDur(today.ms, lang)}</Text>
                  {' · '}
                  <Text style={styles.daySubNum}>{fmtMoney(today.money, lang, settings.currency)}</Text>
                  {activeTimer ? <Text style={styles.daySubMuted}>{` · ${t(lang, 'home.since', { time: hm(new Date(activeTimer.startedAt)) })}`}</Text> : null}
                </Text>
              </View>
            </View>
            <View style={styles.track}>
              {hours.map((h, i) => (i ? <View key={h} style={[styles.gridLine, { left: `${(i / hours.length) * 100}%` }]} /> : null))}
              {strip.blocks.map((b, i) => {
                const task = getTask(tasks, b.taskId);
                const name = task ? (task.title || t(lang, 'task.no_name')) : '';
                return (
                  <Pressable
                    key={`${b.taskId}-${b.start}-${i}`}
                    style={[styles.blk, b.running && styles.blkRun, { left: `${b.left}%`, width: `${b.width}%` }]}
                    onPress={() => openTaskById(b.taskId)}
                    accessibilityLabel={`${name} · ${hm(new Date(b.start))}–${b.running ? '…' : hm(new Date(b.end))}`}
                  >
                    {b.width > 14 ? (
                      <Text style={[styles.blkText, b.running && styles.blkTextRun]} numberOfLines={1}>
                        {b.running ? `${t(lang, 'task.running_now')} · ${fmtShort(b.end - b.start, lang)}` : name}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
              {strip.nowPct != null ? <View style={[styles.nowLine, { left: `${strip.nowPct}%` }]} /> : null}
            </View>
            <View style={styles.hoursRow}>
              {hours.map((h, i) => (
                <Text key={h} style={[styles.hour, { left: `${(i / hours.length) * 100}%` }]}>
                  {i % hourStep === 0 ? pad2(h) : ''}
                </Text>
              ))}
            </View>
            <View style={styles.dayActions}>
              <Pressable style={styles.softBtn} onPress={addEntry} hitSlop={4}>
                <Icon name="plus" size={12} color={colors.text} />
                <Text style={styles.softBtnText}>{t(lang, 'agenda.entry')}</Text>
              </Pressable>
              <Pressable style={styles.ghostBtn} onPress={openDay} hitSlop={4}>
                <Text style={styles.ghostBtnText}>{t(lang, 'home.open_day')} →</Text>
              </Pressable>
            </View>
          </Island>

          {/* Сейчас идёт / Продолжить */}
          {nowTask ? (
            <Island style={runningTask ? styles.nowIsland : null} testID="today-now">
              <IslandHead
                title={t(lang, runningTask ? 'home.now_running' : 'home.now_idle')}
                note={runningTask ? hm(new Date(activeTimer.startedAt)) : t(lang, 'home.continue')}
              />
              <Pressable onPress={() => openTask(nowTask)} hitSlop={4}>
                <Text style={styles.nowTitle} numberOfLines={2}>{nowTask.title || t(lang, 'task.no_name')}</Text>
              </Pressable>
              <View style={styles.nowProj}>
                <View style={[styles.dot, { backgroundColor: nowProject ? nowProject.color : colors.accent }]} />
                <Text style={styles.nowProjText} numberOfLines={1}>{nowProject ? nowProject.name : ''}</Text>
              </View>
              <View style={styles.nowRow}>
                <Pressable
                  onPress={() => (runningTask ? stopTimer() : startTimer(nowTask.id))}
                  style={[styles.sqBtn, runningTask && styles.sqBtnRun]}
                  accessibilityRole="button"
                  accessibilityLabel={t(lang, runningTask ? 'timer.stop' : 'timer.start')}
                >
                  <Icon name={runningTask ? 'stop' : 'play'} size={16} color={runningTask ? colors.accentText : colors.text} />
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.nowTime}>{fmtClock(taskElapsedMs(nowTask, activeTimer))}</Text>
                  {earnedShown(nowTask, rates, nowEarned) ? (
                    <Text style={styles.nowMoney}>{fmtMoney(nowEarned, lang, currencyOf(nowProject, settings))}</Text>
                  ) : null}
                </View>
                <Pressable style={styles.softBtn} onPress={() => openTask(nowTask)} hitSlop={4}>
                  <Text style={styles.softBtnText}>{t(lang, 'home.open_short')}</Text>
                </Pressable>
              </View>
            </Island>
          ) : null}

          {/* Числа: день, неделя, месяц */}
          <Island testID="today-kpis">
            <View style={styles.kpis}>
              <View style={styles.kpi}>
                <Text style={styles.kpiLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t(lang, 'calendar.today')}</Text>
                <Text style={styles.kpiNum} numberOfLines={1}>{fmtDur(today.ms, lang)}</Text>
                <Text style={styles.kpiSub} numberOfLines={1}>{fmtMoney(today.money, lang, settings.currency)}</Text>
              </View>
              <View style={styles.kpi}>
                <Text style={styles.kpiLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t(lang, 'home.week_label', { range: `${fmtDateShort(weekFrom, lang)}–${fmtDateShort(weekTo, lang)}` })}</Text>
                <Text style={styles.kpiNum} numberOfLines={1}>{fmtDur(week.ms, lang)}</Text>
                <Text style={styles.kpiSub} numberOfLines={1}>{fmtMoney(week.money, lang, settings.currency)}</Text>
              </View>
              <View style={styles.kpi}>
                <Text style={styles.kpiLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{monthLabel(lang, nowDate.getFullYear(), nowDate.getMonth())}</Text>
                <Text style={styles.kpiNum} numberOfLines={1}>{fmtDur(month.ms, lang)}</Text>
                <Text style={styles.kpiSub} numberOfLines={1}>{fmtMoney(month.money, lang, settings.currency)}</Text>
              </View>
            </View>
            {tasks.length ? (
              <Text style={styles.kpiDone}>{t(lang, 'home.tasks_done', { done: doneCount, total: tasks.length })}</Text>
            ) : null}
          </Island>

          {/* Недавние проекты */}
          {homeProjects.length ? (
            <Island testID="today-projects">
              <IslandHead
                title={t(lang, 'home.recent_projects')}
                note={`${t(lang, 'home.all_projects')} →`}
                onPressNote={() => navigation.navigate('Projects')}
              />
              {homeProjects.map((p, i) => {
                const own = tasksOf(tasks, p.id);
                const done = own.filter((task) => task.done).length;
                const pct = own.length ? Math.round((done / own.length) * 100) : 0;
                return (
                  <IslandRow key={p.id} first={i === 0} onPress={() => openProjectScreen(p.id)} style={styles.hpRow}>
                    <View style={styles.hpHead}>
                      <View style={[styles.dot, { backgroundColor: p.color || colors.accent }]} />
                      <Text style={styles.hpName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.hpCount}>{done}/{own.length}</Text>
                    </View>
                    <Text style={styles.hpFigs} numberOfLines={1}>
                      <Text style={styles.hpNum}>{fmtDur(projectMs(tasks, p.id, activeTimer), lang)}</Text>
                      {' · '}{fmtMoney(projectMoney(tasks, p.id, rates, activeTimer), lang, currencyOf(p, settings))}
                    </Text>
                    <View style={styles.hpBar}><View style={[styles.hpFill, { width: `${pct}%`, backgroundColor: p.color || colors.accent }]} /></View>
                  </IslandRow>
                );
              })}
            </Island>
          ) : null}

          {/* Дедлайны */}
          <Island testID="today-due">
            <IslandHead
              title={t(lang, 'home.due')}
              right={overdue ? <Text style={styles.overdueNote}>{t(lang, 'home.overdue_n', { n: overdue })}</Text> : null}
            />
            {feed.length === 0 ? <IslandEmpty>{t(lang, 'notif.empty')}</IslandEmpty> : null}
            {feed.map((n, i) => {
              const p = getProject(projects, n.task.projectId);
              return (
                <IslandRow key={n.task.id} first={i === 0} onPress={() => openTask(n.task)}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={styles.rlName} numberOfLines={1}>{n.task.title || t(lang, 'task.no_name')}</Text>
                    <View style={styles.rlSubRow}>
                      <View style={[styles.dotSm, { backgroundColor: p ? p.color : colors.accent }]} />
                      <Text style={styles.rlSub} numberOfLines={1}>
                        {p ? p.name : ''}{n.kind === 'reminder' ? ` · ${t(lang, 'notif.reminder')}` : ''}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.rlWhen, n.kind === 'overdue' && styles.rlOverdue]} numberOfLines={1}>{dueShort(n.task, lang)}</Text>
                </IslandRow>
              );
            })}
          </Island>

          {/* Недавние задачи */}
          <Island testID="today-recent">
            <IslandHead title={t(lang, 'home.recent')} />
            {recent.length === 0 ? <IslandEmpty>{t(lang, 'home.recent_empty')}</IslandEmpty> : null}
            {recent.map((task, i) => (
              <RecentTaskRow key={task.id} task={task} first={i === 0} onPress={() => openTask(task)} />
            ))}
          </Island>
        </ScrollView>
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

/** Результаты поиска поверх «Сегодня». Отдельным слоем, а не подменой
 *  данных: экран под ними остаётся смонтированным и по выходу показывает
 *  ту же позицию прокрутки. */
function SearchResults({
  query, recent, projects, tasks, allProjects, allTasks, statuses,
  lang, colors, styles, onProject, onTask,
}) {
  const empty = query && !projects.length && !tasks.length;
  const rows = [];
  if (!query) {
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
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            if (item.head) return <Text style={styles.sectionTitle}>{item.head}</Text>;
            if (item.project) {
              const count = tasksOf(allTasks, item.project.id).length;
              return (
                <Pressable style={styles.resultRow} onPress={() => onProject(item.project.id)}>
                  <View style={[styles.dot, { backgroundColor: item.project.color }]} />
                  <Text style={styles.resultTitle} numberOfLines={1}>{item.project.name}</Text>
                  <Text style={styles.resultCount}>{t(lang, 'search.project_sub', { n: count, plural: pluralForm(lang, count, 'plural.task') })}</Text>
                </Pressable>
              );
            }
            const project = getProject(allProjects, item.task.projectId);
            const status = getStatus(statuses, item.task.statusId);
            return (
              <Pressable style={styles.resultRow} onPress={() => onTask(item.task)}>
                <View style={[styles.dot, { backgroundColor: project ? project.color : colors.accent }]} />
                <View style={styles.resultBody}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.task.title || t(lang, 'task.no_name')}
                  </Text>
                  <View style={styles.rlSubRow}>
                    <Text style={styles.rlSub} numberOfLines={1}>{project ? project.name : ''}</Text>
                    {status ? (
                      <>
                        <Text style={styles.rlSub}>·</Text>
                        <View style={[styles.dotSm, { backgroundColor: status.color }]} />
                        <Text style={styles.rlSub} numberOfLines={1}>{status.name}</Text>
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
  content: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.xs,
    paddingBottom: insets.bottom + clearance + spacing.xl, gap,
  },

  dayHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dayTitle: { color: colors.text, fontSize: fontSize.lg, fontFamily: displayFamily.bold },
  daySub: { color: colors.textDim, fontSize: fontSize.sm, marginTop: 2 },
  daySubNum: { color: colors.text, fontWeight: '700' },
  daySubMuted: { color: colors.textFaint },
  // Полоса дня: ступень panel2, сетка часов тонкими линиями, записи —
  // блоками accentMuted, идущая — акцентом, «сейчас» — красной чертой.
  track: { height: 40, borderRadius: radius.sm, backgroundColor: colors.panel2, marginTop: spacing.md, overflow: 'hidden' },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  blk: { position: 'absolute', top: 4, bottom: 4, borderRadius: 4, backgroundColor: colors.accentMuted, justifyContent: 'center', paddingHorizontal: 4, overflow: 'hidden' },
  blkRun: { backgroundColor: colors.accent },
  blkText: { color: colors.accentInk, fontSize: 10, fontWeight: '700' },
  blkTextRun: { color: colors.accentText },
  nowLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.danger },
  hoursRow: { height: 14, marginTop: 2 },
  hour: { position: 'absolute', top: 0, color: colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
  dayActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  softBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 32 },
  softBtnText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  ghostBtn: { paddingHorizontal: spacing.sm, height: 32, justifyContent: 'center', marginLeft: 'auto' },
  ghostBtnText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },

  // Идущая задача — остров с акцентной подложкой (.now-island на вебе).
  nowIsland: { backgroundColor: colors.accentMuted },
  nowTitle: { color: colors.text, fontSize: 17, fontFamily: displayFamily.bold, marginTop: spacing.xs },
  nowProj: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
  nowProjText: { color: colors.textDim, fontSize: fontSize.xs, flexShrink: 1 },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  sqBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  sqBtnRun: { backgroundColor: colors.accent },
  nowTime: { color: colors.text, fontSize: 22, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  nowMoney: { color: colors.textDim, fontSize: fontSize.xs },

  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, minWidth: 0, gap: 2 },
  kpiLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiNum: { color: colors.text, fontSize: 18, fontFamily: displayFamily.bold },
  kpiSub: { color: colors.textDim, fontSize: fontSize.xs },
  kpiDone: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: spacing.sm },

  hpRow: { flexDirection: 'column', alignItems: 'stretch', gap: 4 },
  hpHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hpName: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  hpCount: { color: colors.textFaint, fontSize: fontSize.xs },
  hpFigs: { color: colors.textDim, fontSize: fontSize.xs },
  hpNum: { color: colors.text, fontWeight: '700' },
  hpBar: { height: 4, borderRadius: 2, backgroundColor: colors.panel2, overflow: 'hidden', marginTop: 2 },
  hpFill: { height: '100%' },

  overdueNote: { color: colors.danger, ...typography.islandNote },
  rlName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  rlSubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rlSub: { color: colors.textFaint, fontSize: fontSize.xs, flexShrink: 1 },
  rlWhen: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600' },
  rlOverdue: { color: colors.danger },
  dot: { width: 10, height: 10, borderRadius: 3 },
  dotSm: { width: 7, height: 7, borderRadius: 2 },

  sectionTitle: {
    color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.xs,
  },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyCard: { alignItems: 'center', gap: spacing.md, alignSelf: 'stretch', padding: spacing.xl },
  emptyTitle: { color: colors.text, ...typography.title, textAlign: 'center' },
  emptyText: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },

  // Результаты кладутся поверх, а не вместо. Координаты расписаны руками:
  // в React Native 0.86 absoluteFillObject нет, остался только absoluteFill.
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
  resultBody: { flex: 1, gap: 2 },
  resultTitle: { flex: 1, color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  resultCount: { color: colors.textFaint, fontSize: fontSize.xs },
});

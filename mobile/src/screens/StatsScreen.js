// «Цифры» (макет B2): вкладки Неделя · Месяц · Всё. У каждой сверху свой
// выбор — неделя столбиками, месяц календарём, — а под ним одна и та же
// итоговая карточка (часы и деньги за выбранное), плитки и «По проектам».
// Отдельной вкладки «День» нет: на «Неделе» тап по столбику показывает этот
// день (итог, число записей, проекты за день), повторный тап или другой
// столбик переключает, выбранный день подсвечен. В месяце тап по дню
// показывает этот день, тап по второму дню — период между ними, следующий
// тап начинает выбор заново. Фильтр по проекту — чип в шапке, Excel — кнопка.
// Неделя и месяц листаются стрелками ‹ › и свайпом по столбикам и по клеткам
// месяца (PeriodSwipe): содержимое едет за пальцем, за порогом уезжает, и
// новое въезжает с другой стороны.
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import { GlassBg } from '../components/Glass';
import Island, { IslandHead } from '../components/Island';
import EmptyState from '../components/EmptyState';
import TabHeader, { HeaderButton } from '../components/TabHeader';
import Segmented from '../components/Segmented';
import ProgressBar, { LiquidColumn } from '../components/ProgressBar';
import PickerSheet from '../components/PickerSheet';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import { useAppStore, getProject, tasksOf } from '../store/useAppStore';
import { useRates, useRatesMain, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, fmtShort, monthLabel, fmtDateShort, capFirst } from '../lib/format';
import { dayKey, keyToDate, mondayOf, addDays, aggregateDays, rangeAgg, sessionsOfDay } from '../lib/calendarMath';
import { useTicker } from '../hooks/useTicker';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { openSheet } from '../store/useSheetStore';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, screenPadding, radius, displayFamily, gap } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

export const MODES = ['week', 'month', 'all'];
const MODE_KEY = { week: 'calendar.week', month: 'calendar.month', all: 'stats.all_time' };
const WEEKDAY_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** Клетки месяца по неделям с понедельника; дни соседних месяцев — off.
 *  Каждый ряд — ровно семь клеток: у клетки flex: 1, и единственный день в
 *  последнем ряду (ноябрь 2026) растягивался на всю ширину. Хвост ряда
 *  дополняют днями следующего месяца — теми же off, что и в первом ряду. */
export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const start = mondayOf(first);
  const out = [];
  for (let i = 0; i < 42; i += 1) {
    const d = addDays(start, i);
    // Обрываем только на границе ряда: сначала дописывается начатая неделя.
    if (i >= 35 && i % 7 === 0 && d.getMonth() !== month) break;
    out.push({ key: dayKey(d), day: d.getDate(), off: d.getMonth() !== month });
  }
  const rows = [];
  for (let i = 0; i < out.length; i += 7) rows.push(out.slice(i, i + 7));
  return rows;
}

/** Выбор в календаре месяца после тапа по дню key. null — ничего не выбрано;
 *  {from, to} — день (from === to) или период. Тап по выбранному дню снимает
 *  выбор, по другому дню — достраивает период, после периода — новый день. */
export function nextSelection(sel, key) {
  if (!sel) return { from: key, to: key };
  if (sel.from === sel.to) return key === sel.from ? null : { from: sel.from, to: key };
  return { from: key, to: key };
}

/** Границы выбранного: [начало, конец] включительно. anchor — любой день
 *  недели для «Недели» и любой день месяца для «Месяца»; sel — выбор в
 *  календаре месяца (или null — весь месяц). Режим 'day' — один день anchor:
 *  так считается день, выбранный столбиком на «Неделе». */
export function statsBounds(mode, anchor, sel) {
  if (mode === 'day') return [startOfDay(anchor), endOfDay(anchor)];
  if (mode === 'week') {
    const from = mondayOf(anchor);
    return [from, endOfDay(addDays(from, 6))];
  }
  if (mode === 'month') {
    if (sel) {
      let a = keyToDate(sel.from);
      let b = keyToDate(sel.to);
      if (a > b) [a, b] = [b, a];
      return [a, endOfDay(b)];
    }
    return [new Date(anchor.getFullYear(), anchor.getMonth(), 1), endOfDay(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))];
  }
  return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
}

/** Сколько протянуть пальцем, чтобы отпускание листнуло период. */
export const PERIOD_SWIPE = 56;
// Короткая, но быстрая отмашка тоже листает: от этого сдвига и этой скорости.
const FLING_DX = 24;
const FLING_V = 700;
// Включение жеста: ушли по горизонтали на 16 — он наш, ушли по вертикали на
// 12 раньше — сдаёмся, и экран прокручивается как обычно.
const SLOP_X = 16;
const SLOP_Y = 12;
const BACK = { damping: 18, stiffness: 260, mass: 0.8 };
const LEAVE = { duration: 130 };
const ENTER = { duration: 190 };

/** Куда листнёт отпускание: 1 — вперёд (палец ушёл влево), -1 — назад, 0 —
 *  остаться. Больше уехавший по вертикали, чем по горизонтали, жест не листает. */
export function periodSwipeDir(dx, dy, vx) {
  'worklet';
  if (Math.abs(dy) > Math.abs(dx)) return 0;
  const far = Math.abs(dx) >= PERIOD_SWIPE;
  const quick = Math.abs(dx) >= FLING_DX && Math.abs(vx) >= FLING_V;
  if (!far && !quick) return 0;
  return dx < 0 ? 1 : -1;
}

/** Свайп по периоду: содержимое едет за пальцем и тает; за порогом уезжает
 *  совсем, период меняется (onShift(dir) — то же, что нажатие стрелки), и
 *  новое въезжает с противоположной стороны. Не дотянули — пружиной на
 *  место. При «уменьшении движения» ничего не едет: период меняется сразу. */
function PeriodSwipe({ onShift, testID, children }) {
  const still = useReduceMotion();
  const { width } = useWindowDimensions();
  // Дальше этого сдвига содержимое уже прозрачно.
  const out = Math.max(1, width * 0.5);
  const x = useSharedValue(0);
  const startX = useSharedValue(0);
  const leaving = useSharedValue(0);
  const [turn, setTurn] = useState({ n: 0, dir: 0 });

  const commit = useCallback((dir) => {
    onShift(dir);
    if (!still) setTurn((s) => ({ n: s.n + 1, dir }));
  }, [onShift, still]);

  // Въезд — после того, как отрисован новый период: до этого содержимое
  // стоит за краем и прозрачно, прежнее не мигнёт.
  useLayoutEffect(() => {
    if (!turn.n) return;
    leaving.value = 0;
    x.value = turn.dir * out;
    x.value = withTiming(0, ENTER);
  }, [turn]);

  const pan = Gesture.Pan()
    .withTestId(testID)
    .activeOffsetX([-SLOP_X, SLOP_X])
    .failOffsetY([-SLOP_Y, SLOP_Y])
    .onStart(() => { startX.value = x.value; leaving.value = 0; })
    .onUpdate((e) => {
      if (!still) x.value = Math.max(-out, Math.min(out, startX.value + e.translationX));
    })
    .onEnd((e) => {
      const dir = periodSwipeDir(e.translationX, e.translationY, e.velocityX);
      if (!dir) {
        if (!still) x.value = withSpring(0, BACK);
        return;
      }
      if (still) { runOnJS(commit)(dir); return; }
      leaving.value = 1;
      x.value = withTiming(-dir * out, LEAVE, (done) => { if (done) runOnJS(commit)(dir); });
    })
    .onFinalize((e, ok) => {
      if (!ok && !leaving.value && !still) x.value = withSpring(0, BACK);
    });

  const slide = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(x.value) / out),
    transform: [{ translateX: x.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={slide} collapsable={false}>{children}</Animated.View>
    </GestureDetector>
  );
}

export default function StatsScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const styles = useMemo(() => makeStyles(colors, clearance), [colors, clearance]);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const lang = settings.lang;
  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const rates = useRates();
  const ratesMain = useRatesMain();
  useTicker(!!activeTimer);

  const [mode, setMode] = useState('month');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [projectId, setProjectId] = useState('all');
  const [sel, setSel] = useState(null);
  // День, выбранный столбиком на «Неделе» (ключ дня) или null — вся неделя.
  const [pickedDay, setPickedDay] = useState(null);

  const project = projectId !== 'all' ? getProject(projects, projectId) : null;
  const shown = useMemo(() => (project ? tasksOf(tasks, project.id) : tasks), [tasks, project]);
  const statsRates = project ? rates : ratesMain;
  const currency = project ? currencyOf(project, settings) : settings.currency;

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const todayKey = dayKey(new Date());
  const dayLabel = (d) => capFirst(d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' }));

  const dayView = mode === 'week' && pickedDay ? keyToDate(pickedDay) : null;
  const bounds = dayView ? statsBounds('day', dayView, null) : statsBounds(mode, anchor, sel);
  const from = bounds[0].getTime();
  const to = bounds[1].getTime();
  const total = useMemo(() => rangeAgg(shown, statsRates, bounds[0], bounds[1]), [shown, statsRates, from, to]);
  const dayAgg = useMemo(() => aggregateDays(shown, statsRates), [shown, statsRates]);
  const activeDays = mode === 'all'
    ? dayAgg.size
    : [...dayAgg.entries()].filter(([k, e]) => { const d = keyToDate(k).getTime(); return e.ms > 0 && d >= from && d <= to; }).length;
  const doneInRange = shown.filter((task) => task.done && (task.doneAt ? new Date(task.doneAt).getTime() >= from && new Date(task.doneAt).getTime() <= to : mode === 'all')).length;
  const perDay = activeDays ? total.ms / activeDays : 0;
  const perHour = total.ms ? total.money / (total.ms / 3_600_000) : 0;
  const records = dayView ? sessionsOfDay(shown, pickedDay).length : 0;

  const byProject = useMemo(() => (project ? [project] : projects).map((p) => {
    const agg = rangeAgg(tasksOf(shown, p.id), statsRates, bounds[0], bounds[1]);
    return { project: p, ...agg };
  }).filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms), [projects, project, shown, statsRates, from, to]);
  const maxProjectMs = byProject.length ? byProject[0].ms : 1;

  // Другая неделя — выбранный день остаётся позади.
  // Стрелки и свайп зовут одни и те же функции — правила у них общие.
  const shiftWeek = (dir) => { setAnchor((a) => new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir * 7)); setPickedDay(null); };
  const shiftMonth = (dir) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  const pickMode = (m) => { setMode(m); setPickedDay(null); };
  function pickProject() {
    openSheet(
      <PickerSheet
        title={t(lang, 'filter.project')}
        value={projectId}
        options={[{ value: 'all', label: t(lang, 'filter.all_projects') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        onSelect={setProjectId}
      />,
    );
  }
  // Лист экспорта сам выбирает период и проекты и сам собирает файл (как окно
  // веба); выбранный здесь проект в нём предвыбран.
  function onExcel() {
    openSheet(<ExportPeriodSheet lang={lang} projectId={project ? project.id : undefined} />);
  }

  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const weekFrom = mondayOf(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekFrom, i);
    const key = dayKey(d);
    return { key, d, ms: (dayAgg.get(key) || { ms: 0 }).ms };
  });
  const maxWeekMs = Math.max(3_600_000, ...weekDays.map((x) => x.ms));

  // --- итоговая карточка: что выбрано и что о нём сказать ---
  let sumTitle;
  let sumNote;
  let onNote;
  if (dayView) {
    sumTitle = dayLabel(dayView);
    sumNote = t(lang, 'task.records_n', { n: records });
  } else if (mode === 'week') {
    sumTitle = t(lang, 'calendar.for_week');
    sumNote = t(lang, 'stats.active_days', { n: activeDays });
  } else if (mode === 'month') {
    if (!sel) {
      sumTitle = t(lang, 'calendar.for_month');
      sumNote = t(lang, 'stats.pick_hint');
    } else {
      sumTitle = sel.from === sel.to
        ? dayLabel(keyToDate(sel.from))
        : `${fmtDateShort(bounds[0], lang)} – ${fmtDateShort(bounds[1], lang)}`;
      sumNote = t(lang, 'stats.clear_period');
      onNote = () => setSel(null);
    }
  } else {
    sumTitle = t(lang, 'stats.for_all');
    sumNote = t(lang, 'stats.active_days', { n: activeDays });
  }

  const nav = (title, onPrev, onNext) => (
    <View style={styles.calHead}>
      <Tap scale={0.9} onPress={onPrev} style={styles.arrow} accessibilityRole="button" accessibilityLabel={t(lang, 'stats.prev_period')} testID="stats-prev"><Icon name="chevron-left" size={15} color={colors.text} /></Tap>
      <View style={styles.calTitleBtn}>
        <Text style={styles.calTitle} numberOfLines={1} testID="stats-period">{title}</Text>
      </View>
      <Tap scale={0.9} onPress={onNext} style={styles.arrow} accessibilityRole="button" accessibilityLabel={t(lang, 'stats.next_period')} testID="stats-next"><Icon name="chevron-right" size={15} color={colors.text} /></Tap>
    </View>
  );

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.stats')}>
        <Tap onPress={pickProject} style={styles.chip} accessibilityRole="button" accessibilityLabel={t(lang, 'filter.project')}>
          <GlassBg radius={999} backgroundColor={project ? colors.raise : colors.panel} />
          <View style={[styles.dot, { backgroundColor: project ? project.color : colors.textDim }]} />
          <Text style={styles.chipText} numberOfLines={1}>{project ? project.name : t(lang, 'filter.all_projects')}</Text>
          <Icon name="chevron-down" size={10} color={colors.textFaint} />
        </Tap>
        <HeaderButton icon="download" label={t(lang, 'menu.export_excel')} onPress={onExcel} />
      </TabHeader>

      <View style={styles.segWrap}>
        <Segmented
          items={MODES.map((m) => ({ key: m, label: t(lang, MODE_KEY[m]) }))}
          value={mode}
          onChange={pickMode}
          testID="stats-modes"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {mode === 'week' ? (
          <Island style={styles.cal}>
            {nav(`${fmtDateShort(weekFrom, lang)} – ${fmtDateShort(addDays(weekFrom, 6), lang)}`, () => shiftWeek(-1), () => shiftWeek(1))}
            <PeriodSwipe onShift={shiftWeek} testID="stats-swipe">
              <View style={styles.bars}>
                {weekDays.map((x) => {
                  const picked = x.key === pickedDay;
                  const isToday = x.key === todayKey;
                  // Акцентом залит один столбик: выбранный, а пока выбора нет — сегодняшний.
                  const lit = pickedDay ? picked : isToday;
                  return (
                    <Tap
                      key={x.key}
                      onPress={() => setPickedDay((k) => (k === x.key ? null : x.key))}
                      style={[styles.bar, picked && styles.barPicked]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: picked }}
                      accessibilityLabel={dayLabel(x.d)}
                      testID={`stats-bar-${x.key}`}
                    >
                      <Text style={styles.barVal}>{x.ms ? fmtShort(x.ms, lang) : ''}</Text>
                      {/* Столбик поднимается к своей высоте жидко (components/ProgressBar.js). */}
                      <LiquidColumn height={Math.max(4, Math.round((x.ms / maxWeekMs) * 60))} style={[styles.barFill, lit && styles.barFillOn]} />
                      <Text style={[styles.barDay, (lit || isToday) && { color: colors.text }]}>{t(lang, WEEKDAY_KEYS[(x.d.getDay() + 6) % 7])}</Text>
                      {/* Число месяца; сегодняшнее — на акцентной подложке, выбранный день её не получает. */}
                      <View style={[styles.barNum, isToday && styles.barNumToday]} testID={`stats-daynum-${x.key}`}>
                        <Text style={[styles.barNumText, isToday && styles.barNumTextToday]}>{x.d.getDate()}</Text>
                      </View>
                    </Tap>
                  );
                })}
              </View>
            </PeriodSwipe>
          </Island>
        ) : null}

        {mode === 'month' ? (
          <Island style={styles.cal}>
            {nav(monthLabel(lang, year, month), () => shiftMonth(-1), () => shiftMonth(1))}
            <View style={styles.wdRow}>
              {WEEKDAY_KEYS.map((k) => <Text key={k} style={styles.wd}>{t(lang, k)}</Text>)}
            </View>
            <PeriodSwipe onShift={shiftMonth} testID="stats-swipe">
              {cells.map((row, ri) => (
                <View key={ri} style={styles.calRow} testID={`stats-cal-row-${ri}`}>
                  {row.map((c) => {
                    const e = dayAgg.get(c.key);
                    const d = keyToDate(c.key).getTime();
                    const inSel = !!sel && d >= from && d <= to;
                    const end = !!sel && (c.key === sel.from || c.key === sel.to);
                    return (
                      <Tap
                        key={c.key}
                        scale={0.9}
                        onPress={() => setSel((s) => nextSelection(s, c.key))}
                        style={[styles.cell, c.off && styles.cellOff, inSel && styles.cellIn, end && styles.cellEnd, c.key === todayKey && styles.cellToday]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: inSel }}
                        testID={`stats-cell-${c.key}`}
                      >
                        <Text style={[styles.cellNum, c.off && styles.cellNumOff, end && styles.cellNumEnd]}>{c.day}</Text>
                        {e && e.ms ? <Text style={[styles.cellMs, end && styles.cellNumEnd]}>{fmtShort(e.ms, lang)}</Text> : null}
                      </Tap>
                    );
                  })}
                </View>
              ))}
            </PeriodSwipe>
          </Island>
        ) : null}

        <Island style={styles.sum}>
          <IslandHead title={sumTitle} note={sumNote} onPressNote={onNote} />
          <View style={styles.sumRow}>
            <Text style={styles.big}>{fmtDur(total.ms, lang)}</Text>
            <Text style={[styles.big, { color: colors.textDim }]}>{fmtMoney(total.money, lang, currency)}</Text>
          </View>
        </Island>

        <View style={styles.tiles}>
          <View style={styles.tile}><Text style={styles.tileNum}>{doneInRange}<Text style={styles.tileOf}> / {shown.length}</Text></Text><Text style={styles.tileLabel}>{t(lang, 'stats.tasks_done_short')}</Text></View>
          {dayView ? null : <View style={styles.tile}><Text style={styles.tileNum}>{fmtShort(perDay, lang)}</Text><Text style={styles.tileLabel}>{t(lang, 'stats.per_day')}</Text></View>}
          <View style={styles.tile}><Text style={styles.tileNum}>{fmtMoney(Math.round(perHour), lang, currency)}</Text><Text style={styles.tileLabel}>{t(lang, 'stats.per_hour')}</Text></View>
        </View>

        <Island padded={false} style={{ paddingVertical: 4 }}>
          <Text style={styles.label}>{t(lang, 'stats.by_project_period')}</Text>
          {/* За период пусто — без кнопки: «Цифры» отчитываются, а не заводят. */}
          {byProject.length === 0 ? <EmptyState size="sm" art="time" title={t(lang, 'stats.period_empty')} text={t(lang, 'empty.stats_text')} /> : null}
          {byProject.map((x, i) => (
            <Tap key={x.project.id} onPress={() => navigation.navigate('Project', { projectId: x.project.id })} style={[styles.pr, i > 0 && styles.prBorder]}>
              <View style={[styles.dot, { backgroundColor: x.project.color }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.prHead}>
                  <Text style={styles.prName} numberOfLines={1}>{x.project.name}</Text>
                  <Text style={styles.prNum}>{fmtDur(x.ms, lang)} · {fmtMoney(x.money, lang, currencyOf(x.project, settings))}</Text>
                </View>
                {/* Доля от самого большого проекта, а не «выполнено»: 100 % здесь
                    значит «лидер», поэтому «попа» и брызг у этих шкал нет. */}
                <ProgressBar value={x.ms / maxProjectMs} color={x.project.color} style={styles.prBar} celebrate={false} testID={`stats-pr-${x.project.id}`} />
              </View>
            </Tap>
          ))}
        </Island>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 11, borderRadius: 999, maxWidth: 170 },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  // Режимы — общий Segmented (подложка выбранного переезжает жидко).
  segWrap: { paddingHorizontal: screenPadding, paddingBottom: spacing.sm },
  content: { paddingHorizontal: screenPadding, paddingBottom: clearance, gap },
  // overflow: hidden — съезжающее при свайпе содержимое не выходит за остров.
  cal: { paddingHorizontal: 10, paddingVertical: 10, overflow: 'hidden' },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  arrow: { width: 36, height: 32, borderRadius: 9, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  calTitleBtn: { flex: 1, alignItems: 'center' },
  calTitle: { color: colors.text, fontSize: 16, fontFamily: displayFamily.bold },
  wdRow: { flexDirection: 'row', gap: 4, paddingTop: 6, paddingBottom: 4 },
  wd: { flex: 1, textAlign: 'center', color: colors.textFaint, fontSize: 10.5, fontWeight: '600', textTransform: 'uppercase' },
  calRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  cell: { flex: 1, height: 48, borderRadius: 9, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', gap: 1 },
  cellOff: { backgroundColor: 'transparent' },
  cellIn: { backgroundColor: colors.accentMuted },
  cellEnd: { backgroundColor: colors.accent },
  cellToday: { borderWidth: 2, borderColor: colors.accent },
  cellNum: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  cellNumOff: { color: colors.textFaint, fontWeight: '400' },
  cellNumEnd: { color: colors.accentText },
  cellMs: { color: colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
  // Под подписью дня — число месяца в круге 22: высота ряда выросла на него.
  bars: { flexDirection: 'row', gap: 6, height: 144, alignItems: 'flex-end', paddingTop: 10 },
  bar: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 4, paddingVertical: 4, borderRadius: radius.md },
  // Выбранный день — подложкой на ступень над островом.
  barPicked: { backgroundColor: colors.panel2 },
  barVal: { color: colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
  barFill: { width: '100%', maxWidth: 28, borderRadius: 6, backgroundColor: colors.raise },
  barFillOn: { backgroundColor: colors.accent },
  barDay: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  // Круг стоит у каждого дня (прозрачный), чтобы числа не прыгали; акцентом
  // заливается только сегодняшний.
  barNum: { minWidth: 22, height: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  barNumToday: { backgroundColor: colors.accent },
  barNumText: { color: colors.textDim, fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barNumTextToday: { color: colors.accentText },
  sum: { paddingVertical: spacing.md },
  sumRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 4 },
  big: { color: colors.text, fontSize: 24, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.panel, borderRadius: radius.lg, paddingHorizontal: 11, paddingVertical: 9, minWidth: 0 },
  tileNum: { color: colors.text, fontSize: 16, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  tileOf: { color: colors.textFaint, fontSize: 12 },
  tileLabel: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  label: { color: colors.textFaint, fontSize: 10.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: spacing.md, paddingTop: 8 },
  pr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, paddingVertical: 9 },
  prBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  prHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  prName: { color: colors.text, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  prNum: { color: colors.textDim, fontSize: 12.5, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  // Полоса — общий ProgressBar (толщина 4, дорожка panel2); здесь только поле.
  prBar: { marginTop: 5 },
});

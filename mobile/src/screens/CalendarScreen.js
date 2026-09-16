import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import Text from '../components/AppText';
import { useAppStore, getProject } from '../store/useAppStore';
import { fmtDur, fmtMoney, monthLabel, capFirst, fmtTime, sessionMoney } from '../lib/format';
import { dayKey, keyToDate, mondayOf, aggregateDays, rangeAgg, sessionsOfDay, allSessionPairs } from '../lib/calendarMath';
import { buildPeriodSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import Icon from '../components/Icon';
import PrimaryButton from '../components/PrimaryButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, spacing, radius, fontSize, tabBarClearance } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const WEEKDAY_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];
const now = new Date();
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const GRID_GAP = 4;
// Доля ширины страницы, после которой отпущенный свайп считается
// "достаточным", чтобы долистать до соседнего месяца/недели (а не откатиться
// назад) — независимо от неё быстрый "флик" (см. FLING_VELOCITY) тоже
// засчитывается, даже если протащили немного.
const COMMIT_FRACTION = 0.22;
const FLING_VELOCITY = 700;
// Небольшой зазор между панелями карусели — раньше панели шли впритык, и на
// свайпе соседний месяц/неделя наезжал(а) без единого просвета, что и
// ощущалось "поломанным". Зазор входит в шаг слайда (step), а не в ширину
// самой панели (pageWidth) — размеры сетки внутри панели не меняются.
const PANEL_GAP = 14;
// overshootClamping:true — пружина останавливается ровно в цели без
// "перелёта"/пружинения назад (это выглядело бы как ещё один излишний рывок
// поверх самого перелистывания); velocity из жеста передаётся в конфиг при
// каждом вызове, чтобы отпускание пальца на ходу продолжало движение с той
// же скоростью, а не дёргалось к новой отправной точке.
const springConfig = (velocity = 0) => ({ velocity, damping: 28, stiffness: 280, mass: 0.9, overshootClamping: true });

// Чистые функции без хуков — считают сетку/соседние даты для ЛЮБЫХ
// параметров, не только текущих. Нужны, чтобы одновременно отрисовать три
// панели (предыдущую/текущую/следующую) для настоящей карусели свайпа —
// раньше был только один набор ячеек, а "смена месяца" была иллюзией
// (сетка чуть отъезжала, содержимое подменялось, сетка возвращалась) без
// реального соседнего контента под пальцем, из-за чего свайп ощущался
// сломанным, а не как перелистывание.
function buildCells(mode, year, month, weekStart) {
  if (mode === 'week') {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart.getTime() + i * 86400000);
      return { key: dayKey(d), day: d.getDate() };
    });
  }
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const dim = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let i = 0; i < startOffset; i++) out.push(null);
  for (let d = 1; d <= dim; d++) out.push({ key: dayKey(new Date(year, month, d)), day: d });
  while (out.length % 7) out.push(null);
  return out;
}

function shiftParams(mode, year, month, weekStart, delta) {
  if (mode === 'week') return { year, month, weekStart: new Date(weekStart.getTime() + delta * 7 * 86400000) };
  const dt = new Date(year, month + delta, 1);
  return { year: dt.getFullYear(), month: dt.getMonth(), weekStart };
}

export default function CalendarScreen({ navigation }) {
  const colors = useColors();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // 7 колонок ровно по ширине страницы (минус её паддинг и зазоры между
  // ячейками) — процентная ширина+gap раньше давала неточное совпадение и
  // "плывущую" сетку. Ширина ОДНОЙ панели карусели (см. ниже) — та же самая
  // величина: сетка внутри панели всегда влезает ровно по краям страницы.
  const cellSize = (windowWidth - spacing.lg * 2 - GRID_GAP * 6) / 7;
  const pageWidth = windowWidth - spacing.lg * 2;
  // Шаг слайда карусели = ширина панели + зазор между ними (см. PANEL_GAP) —
  // используется везде, где раньше был просто pageWidth для позиционирования
  // (translateX/пороги жеста), сама ширина панели (pageWidth) не меняется.
  const step = pageWidth + PANEL_GAP;
  const styles = makeStyles(colors, cellSize, insets);
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const lang = useAppStore((s) => s.settings.lang);
  const currency = useAppStore((s) => s.settings.currency);
  const openProject = useAppStore((s) => s.openProject);
  const showToast = useAppStore((s) => s.showToast);

  const [mode, setMode] = useState('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [weekStart, setWeekStart] = useState(mondayOf(now));
  const [selected, setSelected] = useState(dayKey(now));
  const [periodOn, setPeriodOn] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(null);
  const [rangeTo, setRangeTo] = useState(null);
  const [picking, setPicking] = useState(false);

  // Карусель из трёх панелей [пред][текущая][след], каждая шириной pageWidth
  // и разделённых зазором PANEL_GAP, выровненных в ряд — translateX = -step
  // показывает среднюю (текущую) панель по центру видимой области. Во время
  // свайпа translateX следует за пальцем 1:1 (зажато между -2*step и 0, т.е.
  // не дальше соседних панелей) — в отличие от прежней версии, где сетка
  // лишь символически "подглядывала" на несколько пикселей, тут
  // действительно видно реальное содержимое соседнего месяца/недели,
  // наезжающее с края экрана, с небольшим просветом между страницами.
  const translateX = useSharedValue(-step);
  const carouselAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  const days = useMemo(() => aggregateDays(tasks, hourlyRate), [tasks, hourlyRate]);

  function currentViewBounds() {
    if (mode === 'week') return [new Date(weekStart), new Date(weekStart.getTime() + 6 * 86400000)];
    return [new Date(year, month, 1), new Date(year, month + 1, 0)];
  }

  function togglePeriod() {
    if (!periodOn) {
      const [from, to] = currentViewBounds();
      setRangeFrom(dayKey(from));
      setRangeTo(dayKey(to));
      setPicking(false);
    }
    setPeriodOn((v) => !v);
  }

  function pickRangeDay(key) {
    if (!picking) {
      setRangeFrom(key);
      setRangeTo(key);
      setPicking(true);
    } else {
      setRangeTo(key);
      setPicking(false);
    }
  }

  function shift(delta) {
    if (mode === 'month') {
      const dt = new Date(year, month + delta, 1);
      setYear(dt.getFullYear());
      setMonth(dt.getMonth());
    } else if (mode === 'week') {
      setWeekStart(new Date(weekStart.getTime() + delta * 7 * 86400000));
    }
  }

  // Направление, "ожидающее" сброса позиции карусели после смены данных —
  // см. useLayoutEffect ниже. Обычный ref, не shared value: читается/пишется
  // только из JS-потока.
  const pendingShiftDirRef = useRef(0);

  function commitShift(dir) {
    pendingShiftDirRef.current = dir;
    shift(dir);
  }

  // Довершает перелистывание: пружина докатывает карусель до соседней панели
  // (полностью, а не на символическую дистанцию), сохраняя скорость жеста —
  // отпустил на ходу, и лист продолжает ехать с той же скоростью, а не
  // одёргивается к другому темпу. По завершении данные месяца/недели меняются
  // и useLayoutEffect мгновенно (без анимации) возвращает карусель в центр —
  // к этому моменту "текущая" панель уже отрисована с новыми данными, скачка
  // не видно.
  function animateShift(dir, velocity = 0) {
    const target = dir === 1 ? -2 * step : 0;
    translateX.value = withSpring(target, springConfig(velocity), (finished) => {
      if (finished) runOnJS(commitShift)(dir);
    });
  }

  function cancelShift(velocity = 0) {
    translateX.value = withSpring(-step, springConfig(velocity));
  }

  useLayoutEffect(() => {
    if (!pendingShiftDirRef.current) return;
    pendingShiftDirRef.current = 0;
    translateX.value = -step;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, weekStart, step]);

  // Свайп для смены месяца/недели — карусель едет строго за пальцем (см.
  // комментарий у translateX выше), поэтому чувствуется как настоящее
  // перелистывание, а не декоративный сдвиг. Отключён (.enabled), когда
  // вкладка не в фокусе или открыт режим "День" — экран остаётся
  // смонтированным в фоне таббара, и активный жест на неактивной вкладке
  // иначе мог перехватывать нажатия на других вкладках.
  const swipeGesture = useMemo(
    () => Gesture.Pan()
      .enabled(isFocused && mode !== 'day')
      .activeOffsetX([-20, 20])
      .failOffsetY([-15, 15])
      .onUpdate((e) => {
        const raw = -step + e.translationX;
        translateX.value = Math.max(-2 * step, Math.min(0, raw));
      })
      .onEnd((e) => {
        const delta = translateX.value + step;
        const shouldCommit = Math.abs(delta) > step * COMMIT_FRACTION || Math.abs(e.velocityX) > FLING_VELOCITY;
        if (shouldCommit) {
          const dir = delta < 0 ? 1 : -1;
          runOnJS(animateShift)(dir, e.velocityX);
        } else {
          runOnJS(cancelShift)(e.velocityX);
        }
      }),
    [isFocused, mode, year, month, weekStart, step],
  );

  function goToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setWeekStart(mondayOf(now));
    setSelected(dayKey(now));
  }

  const prevParams = useMemo(() => shiftParams(mode, year, month, weekStart, -1), [mode, year, month, weekStart]);
  const nextParams = useMemo(() => shiftParams(mode, year, month, weekStart, 1), [mode, year, month, weekStart]);
  const prevCells = useMemo(
    () => buildCells(mode, prevParams.year, prevParams.month, prevParams.weekStart),
    [mode, prevParams],
  );
  const currCells = useMemo(() => buildCells(mode, year, month, weekStart), [mode, year, month, weekStart]);
  const nextCells = useMemo(
    () => buildCells(mode, nextParams.year, nextParams.month, nextParams.weekStart),
    [mode, nextParams],
  );

  const [viewFrom, viewTo] = useMemo(() => currentViewBounds(), [mode, year, month, weekStart]);

  const viewTotal = useMemo(() => rangeAgg(tasks, hourlyRate, viewFrom, endOfDay(viewTo)), [tasks, hourlyRate, viewFrom, viewTo]);

  const title = mode === 'week'
    ? `${viewFrom.toLocaleDateString(LOCALE_MAP[lang], { day: 'numeric', month: 'short' })} – ${viewTo.toLocaleDateString(LOCALE_MAP[lang], { day: 'numeric', month: 'short' })}`
    : monthLabel(lang, year, month);

  const todayKey = dayKey(now);

  const rangeBounds = useMemo(() => {
    if (!rangeFrom || !rangeTo) return null;
    let a = keyToDate(rangeFrom);
    let b = keyToDate(rangeTo);
    if (a > b) [a, b] = [b, a];
    return [a, endOfDay(b)];
  }, [rangeFrom, rangeTo]);

  const periodSummary = useMemo(() => {
    if (!periodOn || !rangeBounds) return null;
    const [from, to] = rangeBounds;
    const byTask = new Map();
    for (const { task, s } of allSessionPairs(tasks)) {
      const d = new Date(s.start);
      if (d < from || d > to) continue;
      let e = byTask.get(task.id);
      if (!e) { e = { task, ms: 0, money: 0 }; byTask.set(task.id, e); }
      e.ms += s.ms;
      e.money += sessionMoney(s, task, hourlyRate);
    }
    const rows = [...byTask.values()].sort((a, b) => b.ms - a.ms);
    const totalMs = rows.reduce((a, x) => a + x.ms, 0);
    const totalMoney = rows.reduce((a, x) => a + x.money, 0);
    return { rows, totalMs, totalMoney };
  }, [periodOn, rangeBounds, tasks, hourlyRate]);

  const daySessions = useMemo(() => sessionsOfDay(tasks, selected), [tasks, selected]);
  const dayTotal = daySessions.reduce(
    (a, { task, s }) => ({ ms: a.ms + s.ms, money: a.money + sessionMoney(s, task, hourlyRate) }),
    { ms: 0, money: 0 },
  );

  function openTask(task) {
    openProject(task.projectId);
    navigation.navigate('Home', { screen: 'Project', params: { projectId: task.projectId } });
    navigation.navigate('Home', { screen: 'TaskDetail', params: { taskId: task.id } });
  }

  function onExportPeriod() {
    if (!rangeBounds) return;
    const [from, to] = rangeBounds;
    runExport(
      `Lancible — ${dayKey(from)}_${dayKey(to)}`,
      buildPeriodSheets(tasks, (id) => getProject(projects, id), lang, currency, hourlyRate, { from, to }),
      lang,
      showToast,
    );
  }

  function renderGridPanel(panelCells) {
    return (
      <View style={styles.grid}>
        {panelCells.map((c, i) => {
          if (!c) return <View key={`e${i}`} style={[styles.cell, styles.cellEmpty]} />;
          const agg = days.get(c.key);
          const pct = agg ? Math.min(100, (agg.ms / (8 * 3_600_000)) * 100) : 0;
          const isToday = c.key === todayKey;
          const inRange = periodOn && rangeBounds && keyToDate(c.key) >= rangeBounds[0] && keyToDate(c.key) <= rangeBounds[1];
          const isRangeEnd = periodOn && (c.key === rangeFrom || c.key === rangeTo);
          const isSel = !periodOn && c.key === selected;
          return (
            <Pressable
              key={c.key}
              onPress={() => (periodOn ? pickRangeDay(c.key) : setSelected(c.key))}
              style={[styles.cell, isSel && styles.cellSel, inRange && styles.cellInRange, isRangeEnd && styles.cellRangeEnd]}
            >
              <Text style={[styles.cellNum, isToday && styles.cellNumToday]}>{c.day}</Text>
              {agg ? <Text style={styles.cellTime}>{fmtDur(agg.ms, lang)}</Text> : null}
              {agg ? <View style={styles.cellBarTrack}><View style={[styles.cellBar, { width: `${pct}%` }]} /></View> : null}
            </Pressable>
          );
        })}
      </View>
    );
  }

  const listData = mode === 'day' ? [] : periodOn ? [] : daySessions;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={listData}
      keyExtractor={(item, i) => `${item.task.id}-${i}`}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View>
          <View style={styles.modeRow}>
            {['month', 'week', 'day'].map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.modeTab, mode === m && styles.modeTabActive]}>
                <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{t(lang, `calendar.${m}`)}</Text>
              </Pressable>
            ))}
          </View>

          {mode !== 'day' ? (
            <>
              <View style={styles.navRow}>
                <Pressable hitSlop={10} onPress={() => animateShift(-1)} style={styles.navBtn}><Icon name="chevron-left" size={18} color={colors.text} /></Pressable>
                <Text style={styles.navTitle}>{capFirst(title)}</Text>
                <Pressable hitSlop={10} onPress={() => animateShift(1)} style={styles.navBtn}><Icon name="chevron-right" size={18} color={colors.text} /></Pressable>
              </View>

              <View style={styles.actionsRow}>
                <Pressable onPress={goToday} style={styles.todayBtn}>
                  <Icon name="check" size={12} color={colors.text} />
                  <Text style={styles.todayBtnText}>{t(lang, 'calendar.today')}</Text>
                </Pressable>
                <Pressable onPress={togglePeriod} style={[styles.periodBtn, periodOn && styles.periodBtnActive]}>
                  <Icon name="calendar" size={13} color={periodOn ? colors.accentText : colors.text} />
                  <Text style={[styles.periodBtnText, periodOn && styles.periodBtnTextActive]}>{t(lang, 'calendar.choose_period')}</Text>
                </Pressable>
              </View>

              <View style={styles.weekdaysRow}>
                {WEEKDAY_KEYS.map((k) => <Text key={k} style={styles.weekday}>{t(lang, k)}</Text>)}
              </View>

              <View style={[styles.carouselViewport, { width: pageWidth }]}>
                <GestureDetector gesture={swipeGesture}>
                  <Animated.View style={[styles.carouselTrack, { width: pageWidth * 3 + PANEL_GAP * 2 }, carouselAnimatedStyle]}>
                    <View style={{ width: pageWidth }}>{renderGridPanel(prevCells)}</View>
                    <View style={{ width: pageWidth }}>{renderGridPanel(currCells)}</View>
                    <View style={{ width: pageWidth }}>{renderGridPanel(nextCells)}</View>
                  </Animated.View>
                </GestureDetector>
              </View>

              {!periodOn ? (
                <View style={styles.viewTotalBar}>
                  <Text style={styles.viewTotalLabel}>{mode === 'month' ? t(lang, 'calendar.for_month') : t(lang, 'calendar.for_week')}</Text>
                  <Text style={styles.viewTotalValue}>{fmtDur(viewTotal.ms, lang)} · {fmtMoney(viewTotal.money, lang, currency)}</Text>
                </View>
              ) : (
                <View style={styles.viewTotalBar}>
                  <Text style={styles.viewTotalLabel} numberOfLines={1}>
                    {rangeBounds ? `${dayKey(rangeBounds[0])} – ${dayKey(rangeBounds[1])}` : t(lang, 'calendar.choose_period')}
                  </Text>
                  {periodSummary && periodSummary.rows.length ? (
                    <Text style={styles.viewTotalValue}>{fmtDur(periodSummary.totalMs, lang)} · {fmtMoney(periodSummary.totalMoney, lang, currency)}</Text>
                  ) : null}
                </View>
              )}

              {periodOn ? (
                <>
                  {periodSummary && periodSummary.rows.length ? (
                    <View style={styles.exportBtnWrap}>
                      <PrimaryButton icon="download" title={t(lang, 'export.title')} onPress={onExportPeriod} />
                    </View>
                  ) : null}
                  {!periodSummary || !periodSummary.rows.length ? <Text style={styles.empty}>{t(lang, 'calendar.day_empty')}</Text> : null}
                  {periodSummary ? periodSummary.rows.map(({ task, ms, money }) => {
                    const project = getProject(projects, task.projectId);
                    return (
                      <Pressable key={task.id} onPress={() => openTask(task)} style={styles.sessionRow}>
                        <View style={[styles.sessionDot, { backgroundColor: project ? project.color : colors.accent }]} />
                        <View style={styles.sessionMid}>
                          <Text style={styles.sessionTask} numberOfLines={1}>{task.title || t(lang, 'task.no_name')}</Text>
                          <Text style={styles.sessionMeta}>{project ? project.name : ''} · {fmtMoney(money, lang, currency)}</Text>
                        </View>
                        <Text style={styles.sessionDur}>{fmtDur(ms, lang)}</Text>
                      </Pressable>
                    );
                  }) : null}
                </>
              ) : (
                <>
                  <View style={styles.dayHeadRow}>
                    <Text style={styles.dayHead}>{capFirst(keyToDate(selected).toLocaleDateString(LOCALE_MAP[lang], { weekday: 'short', day: 'numeric', month: 'long' }))}</Text>
                    {daySessions.length ? <Text style={styles.dayHeadTot}>{fmtDur(dayTotal.ms, lang)} · {fmtMoney(dayTotal.money, lang, currency)}</Text> : null}
                  </View>
                  {!daySessions.length ? <Text style={styles.empty}>{t(lang, 'calendar.day_empty')}</Text> : null}
                </>
              )}
            </>
          ) : (
            <View style={styles.dayStub}>
              <Icon name="clock" size={32} color={colors.textDim} />
              <Text style={styles.empty}>{t(lang, 'calendar.day')} — скоро</Text>
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const { task, s } = item;
        const project = getProject(projects, task.projectId);
        return (
          <Pressable onPress={() => openTask(task)} style={styles.sessionRow}>
            <View style={[styles.sessionDot, { backgroundColor: project ? project.color : colors.accent }]} />
            <View style={styles.sessionMid}>
              <Text style={styles.sessionTask} numberOfLines={1}>{task.title || t(lang, 'task.no_name')}</Text>
              <Text style={styles.sessionMeta}>{fmtTime(s.start, lang)}–{s.end ? fmtTime(s.end, lang) : '…'} · {project ? project.name : ''}</Text>
            </View>
            <Text style={styles.sessionDur}>{fmtDur(s.ms, lang)}</Text>
          </Pressable>
        );
      }}
    />
  );
}

const makeStyles = (colors, cellSize, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: insets.bottom + tabBarClearance },
  modeRow: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.md, padding: 4, marginBottom: spacing.md },
  modeTab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  modeTabActive: { backgroundColor: colors.tabActiveBg },
  modeText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  // Текст выбранного таба — обычный "текстовый" цвет (чёрный на светлой,
  // белый на тёмной), не акцентный зелёный: сам факт выбора уже видно по
  // подложке (tabActiveBg), а зелёный текст на некоторых фонах читался хуже.
  modeTextActive: { color: colors.text },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  navBtn: { padding: spacing.sm },
  navTitle: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '700', textAlign: 'center' },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  todayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.panel2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
  },
  todayBtnText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  // В отличие от todayBtn (плоская пилюля) у этой — рамка и заливка "panel"
  // вместо "panel2": рядом с одинаковой на вид todayBtn пользователь не считывал
  // её как кнопку. Не зелёная (это состояние занято periodBtnActive).
  periodBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
  },
  periodBtnText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  periodBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  periodBtnTextActive: { color: colors.accentText },
  viewTotalBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, marginBottom: spacing.md,
  },
  viewTotalLabel: { flexShrink: 1, color: colors.textDim, fontSize: fontSize.md, fontWeight: '600' },
  viewTotalValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  weekdaysRow: { flexDirection: 'row', marginBottom: spacing.xs, gap: GRID_GAP },
  weekday: { width: cellSize, textAlign: 'center', color: colors.textDim, fontSize: fontSize.xs },
  // overflow:hidden — окно, через которое видна только одна из трёх панелей
  // карусели одновременно; сама карусель (carouselTrack) в 3 раза шире.
  carouselViewport: { overflow: 'hidden', marginBottom: spacing.lg },
  carouselTrack: { flexDirection: 'row', gap: PANEL_GAP },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  cell: { width: cellSize, minHeight: 56, alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.sm, gap: 2, backgroundColor: colors.panel2 },
  cellEmpty: { backgroundColor: 'transparent' },
  cellSel: { backgroundColor: colors.accentMuted },
  cellInRange: { backgroundColor: colors.accentMuted },
  cellRangeEnd: { backgroundColor: colors.accentMuted, borderWidth: 2, borderColor: colors.accent },
  cellNum: { color: colors.text, fontSize: fontSize.sm },
  cellNumToday: { color: colors.accent, fontWeight: '800' },
  cellTime: { color: colors.textDim, fontSize: 10 },
  cellBarTrack: { width: '70%', height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  cellBar: { height: '100%', backgroundColor: colors.accent },
  dayHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  dayHead: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  dayHeadTot: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  empty: { color: colors.textDim, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.md },
  dayStub: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  exportBtnWrap: { marginBottom: spacing.md },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  sessionDot: { width: 8, height: 8, borderRadius: 4 },
  sessionMid: { flex: 1, gap: 2 },
  sessionTask: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sessionMeta: { color: colors.textDim, fontSize: fontSize.xs },
  sessionDur: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '600' },
});

// «Цифры» (макет B2): месячный календарь с часами в каждом дне, выбор
// периода двумя тапами, сводка и «По проектам». Режимы: неделя, месяц,
// период, всё время. Фильтр по проекту — чип в шапке, Excel — кнопка.
import { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import Island, { IslandHead, IslandEmpty } from '../components/Island';
import TabHeader, { HeaderButton } from '../components/TabHeader';
import PickerSheet from '../components/PickerSheet';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import { useAppStore, getProject, tasksOf } from '../store/useAppStore';
import { useRates, useRatesMain, currencyOf } from '../hooks/useRates';
import { fmtDur, fmtMoney, fmtShort, monthLabel, fmtDateShort } from '../lib/format';
import { dayKey, keyToDate, mondayOf, aggregateDays, rangeAgg } from '../lib/calendarMath';
import { buildPeriodSheets, buildAllProjectsSheets } from '../lib/xlsxReports';
import { runExport } from '../lib/exportRunner';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { useColors, spacing, radius, fontSize, displayFamily, gap } from '../theme';
import { t, LOCALE_MAP } from '../lib/i18n';

const DAY = 86400000;
const MODES = ['week', 'month', 'period', 'all'];
const MODE_KEY = { week: 'calendar.week', month: 'calendar.month', period: 'stats.period', all: 'stats.all_time' };
const WEEKDAY_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** Клетки месяца по неделям с понедельника; дни соседних месяцев — off. */
export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const start = mondayOf(first);
  const out = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start.getTime() + i * DAY);
    if (i >= 35 && d.getMonth() !== month) break;
    out.push({ key: dayKey(d), day: d.getDate(), off: d.getMonth() !== month });
  }
  const rows = [];
  for (let i = 0; i < out.length; i += 7) rows.push(out.slice(i, i + 7));
  return rows;
}

export default function StatsScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const styles = useMemo(() => makeStyles(colors, clearance), [colors, clearance]);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const settings = useAppStore((s) => s.settings);
  const showToast = useAppStore((s) => s.showToast);
  const lang = settings.lang;
  const locale = LOCALE_MAP[lang] || 'ru-RU';
  const rates = useRates();
  const ratesMain = useRatesMain();
  useTicker(!!activeTimer);

  const [mode, setMode] = useState('month');
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [projectId, setProjectId] = useState('all');
  const [range, setRange] = useState({ from: null, to: null, picking: false });

  const project = projectId !== 'all' ? getProject(projects, projectId) : null;
  const shown = useMemo(() => (project ? tasksOf(tasks, project.id) : tasks), [tasks, project]);
  const statsRates = project ? rates : ratesMain;
  const currency = project ? currencyOf(project, settings) : settings.currency;

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const todayKey = dayKey(new Date());

  // --- границы по режиму ---
  const rangeBounds = useMemo(() => {
    if (!range.from || !range.to) return null;
    let a = keyToDate(range.from);
    let b = keyToDate(range.to);
    if (a > b) [a, b] = [b, a];
    return [a, endOfDay(b)];
  }, [range.from, range.to]);
  const bounds = (() => {
    if (mode === 'week') { const from = mondayOf(anchor); return [from, endOfDay(new Date(from.getTime() + 6 * DAY))]; }
    if (mode === 'month') return [new Date(year, month, 1), endOfDay(new Date(year, month + 1, 0))];
    if (mode === 'period') return rangeBounds || [new Date(year, month, 1), endOfDay(new Date(year, month + 1, 0))];
    return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
  })();
  const total = useMemo(() => rangeAgg(shown, statsRates, bounds[0], bounds[1]), [shown, statsRates, bounds[0].getTime(), bounds[1].getTime()]);
  const dayAgg = useMemo(() => aggregateDays(shown, statsRates), [shown, statsRates]);
  const inRange = (task) => (task.sessions || []).some((s) => { const d = new Date(s.start); return d >= bounds[0] && d <= bounds[1]; });
  const doneInRange = shown.filter((task) => task.done && (task.doneAt ? new Date(task.doneAt) >= bounds[0] && new Date(task.doneAt) <= bounds[1] : mode === 'all')).length;
  const daysSpan = mode === 'all'
    ? Math.max(1, dayAgg.size)
    : Math.max(1, Math.round((bounds[1].getTime() - bounds[0].getTime()) / DAY));
  const activeDays = mode === 'all' ? daysSpan : [...dayAgg.keys()].filter((k) => { const d = keyToDate(k); return d >= bounds[0] && d <= bounds[1]; }).length;
  const perDay = activeDays ? total.ms / activeDays : 0;
  const perHour = total.ms ? total.money / (total.ms / 3_600_000) : 0;

  const byProject = useMemo(() => {
    const list = (project ? [project] : projects).map((p) => {
      const own = tasksOf(shown, p.id);
      const agg = rangeAgg(own, statsRates, bounds[0], bounds[1]);
      return { project: p, ...agg };
    }).filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms);
    return list;
  }, [projects, project, shown, statsRates, bounds[0].getTime(), bounds[1].getTime()]);
  const maxProjectMs = byProject.length ? byProject[0].ms : 1;

  const shiftMonth = (dir) => setAnchor(new Date(year, month + dir, 1));
  const shiftWeek = (dir) => setAnchor(new Date(mondayOf(anchor).getTime() + dir * 7 * DAY));

  function onCell(key) {
    if (mode === 'period') {
      setRange((r) => (r.picking ? { ...r, to: key, picking: false } : { from: key, to: key, picking: true }));
    } else {
      setMode('period');
      setRange({ from: key, to: key, picking: true });
    }
  }

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
  function onExcel() {
    openSheet(
      <ExportPeriodSheet
        lang={lang}
        onCancel={closeSheet}
        onConfirm={(r) => {
          closeSheet();
          const sheets = r
            ? buildPeriodSheets(shown, (id) => getProject(projects, id), lang, currency, statsRates, r)
            : buildAllProjectsSheets(project ? [project] : projects, (id) => tasksOf(shown, id), lang, currency, statsRates);
          runExport(`Lancible — ${t(lang, 'export.all_projects')} — ${new Date().toISOString().slice(0, 10)}`, sheets, lang, showToast);
        }}
      />,
    );
  }

  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const weekFrom = mondayOf(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekFrom.getTime() + i * DAY);
    const key = dayKey(d);
    return { key, d, ms: (dayAgg.get(key) || { ms: 0 }).ms };
  });
  const maxWeekMs = Math.max(3_600_000, ...weekDays.map((x) => x.ms));

  const periodLabel = rangeBounds
    ? `${rangeBounds[0].toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${rangeBounds[1].toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`
    : t(lang, 'stats.pick_hint');

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.stats')}>
        <Tap onPress={pickProject} style={[styles.chip, project && styles.chipOn]} accessibilityRole="button" accessibilityLabel={t(lang, 'filter.project')}>
          <View style={[styles.dot, { backgroundColor: project ? project.color : colors.textDim }]} />
          <Text style={styles.chipText} numberOfLines={1}>{project ? project.name : t(lang, 'filter.all_projects')}</Text>
          <Icon name="chevron-down" size={10} color={colors.textFaint} />
        </Tap>
        <HeaderButton icon="download" label={t(lang, 'menu.export_excel')} onPress={onExcel} />
      </TabHeader>

      <View style={styles.segWrap}>
        <View style={styles.seg}>
          {MODES.map((m) => (
            <Tap key={m} onPress={() => setMode(m)} style={[styles.segBtn, mode === m && styles.segOn]}>
              <Text style={[styles.segText, mode === m && styles.segTextOn]} numberOfLines={1}>{t(lang, MODE_KEY[m])}</Text>
            </Tap>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {mode === 'week' ? (
          <Island style={styles.cal}>
            <View style={styles.calHead}>
              <Tap onPress={() => shiftWeek(-1)} style={styles.arrow} accessibilityLabel={t(lang, 'common.back')}><Icon name="chevron-left" size={15} color={colors.text} /></Tap>
              <Text style={styles.calTitle}>{`${fmtDateShort(weekFrom, lang)} – ${fmtDateShort(new Date(weekFrom.getTime() + 6 * DAY), lang)}`}</Text>
              <Tap onPress={() => shiftWeek(1)} style={styles.arrow}><Icon name="chevron-right" size={15} color={colors.text} /></Tap>
            </View>
            <View style={styles.bars}>
              {weekDays.map((x) => (
                <View key={x.key} style={styles.bar}>
                  <Text style={styles.barVal}>{x.ms ? fmtShort(x.ms, lang) : ''}</Text>
                  <View style={[styles.barFill, { height: Math.max(4, Math.round((x.ms / maxWeekMs) * 60)) }, x.key === todayKey && styles.barFillOn]} />
                  <Text style={[styles.barDay, x.key === todayKey && { color: colors.text }]}>{t(lang, WEEKDAY_KEYS[(x.d.getDay() + 6) % 7])}</Text>
                </View>
              ))}
            </View>
          </Island>
        ) : null}

        {mode === 'month' || mode === 'period' ? (
          <Island style={styles.cal}>
            <View style={styles.calHead}>
              <Tap onPress={() => shiftMonth(-1)} style={styles.arrow} accessibilityLabel={t(lang, 'common.back')}><Icon name="chevron-left" size={15} color={colors.text} /></Tap>
              <Text style={styles.calTitle}>{monthLabel(lang, year, month)}</Text>
              <Tap onPress={() => shiftMonth(1)} style={styles.arrow}><Icon name="chevron-right" size={15} color={colors.text} /></Tap>
            </View>
            <View style={styles.wdRow}>
              {WEEKDAY_KEYS.map((k) => <Text key={k} style={styles.wd}>{t(lang, k)}</Text>)}
            </View>
            {cells.map((row, ri) => (
              <View key={ri} style={styles.calRow}>
                {row.map((c) => {
                  const e = dayAgg.get(c.key);
                  const d = keyToDate(c.key);
                  const sel = mode === 'period' && rangeBounds && d >= rangeBounds[0] && d <= rangeBounds[1];
                  const end = mode === 'period' && (c.key === range.from || c.key === range.to);
                  return (
                    <Tap
                      key={c.key}
                      onPress={() => onCell(c.key)}
                      style={[styles.cell, c.off && styles.cellOff, sel && styles.cellIn, end && styles.cellEnd, c.key === todayKey && styles.cellToday]}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.cellNum, c.off && styles.cellNumOff, end && styles.cellNumEnd]}>{c.day}</Text>
                      {e && e.ms ? <Text style={[styles.cellMs, end && styles.cellNumEnd]}>{fmtShort(e.ms, lang)}</Text> : null}
                    </Tap>
                  );
                })}
              </View>
            ))}
            {mode === 'period' ? (
              <View style={styles.periodBar}>
                <Text style={styles.periodLabel}>{t(lang, 'stats.period')}</Text>
                <Text style={styles.periodRange} numberOfLines={1}>{periodLabel}</Text>
                <View style={{ flex: 1 }} />
                {rangeBounds ? <Text style={styles.periodSum}>{fmtDur(total.ms, lang)} · {fmtMoney(total.money, lang, currency)}</Text> : null}
                {rangeBounds ? <Tap hitSlop={8} onPress={() => setRange({ from: null, to: null, picking: false })}><Text style={styles.periodClear}>{t(lang, 'stats.clear_period')}</Text></Tap> : null}
              </View>
            ) : (
              <View style={styles.periodBar}>
                <Text style={styles.periodLabel}>{t(lang, 'calendar.for_month')}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.periodSum}>{fmtDur(total.ms, lang)} · {fmtMoney(total.money, lang, currency)}</Text>
              </View>
            )}
          </Island>
        ) : null}

        {mode === 'all' ? (
          <Island style={styles.cal}>
            <IslandHead title={t(lang, 'stats.all_time')} note={`${dayAgg.size} ${t(lang, 'stats.per_day')}`} />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 4 }}>
              <Text style={styles.big}>{fmtDur(total.ms, lang)}</Text>
              <Text style={[styles.big, { color: colors.textDim }]}>{fmtMoney(total.money, lang, currency)}</Text>
            </View>
          </Island>
        ) : null}

        <View style={styles.tiles}>
          <View style={styles.tile}><Text style={styles.tileNum}>{doneInRange}<Text style={styles.tileOf}> / {shown.length}</Text></Text><Text style={styles.tileLabel}>{t(lang, 'stats.tasks_done_short')}</Text></View>
          <View style={styles.tile}><Text style={styles.tileNum}>{fmtShort(perDay, lang)}</Text><Text style={styles.tileLabel}>{t(lang, 'stats.per_day')}</Text></View>
          <View style={styles.tile}><Text style={styles.tileNum}>{fmtMoney(Math.round(perHour), lang, currency)}</Text><Text style={styles.tileLabel}>{t(lang, 'stats.per_hour')}</Text></View>
        </View>

        <Island padded={false} style={{ paddingVertical: 4 }}>
          <Text style={styles.label}>{t(lang, 'stats.by_project_period')}</Text>
          {byProject.length === 0 ? <View style={{ padding: spacing.md }}><IslandEmpty>{t(lang, 'stats.period_empty')}</IslandEmpty></View> : null}
          {byProject.map((x, i) => (
            <Tap key={x.project.id} onPress={() => navigation.navigate('Project', { projectId: x.project.id })} style={[styles.pr, i > 0 && styles.prBorder]}>
              <View style={[styles.dot, { backgroundColor: x.project.color }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.prHead}>
                  <Text style={styles.prName} numberOfLines={1}>{x.project.name}</Text>
                  <Text style={styles.prNum}>{fmtDur(x.ms, lang)} · {fmtMoney(x.money, lang, currencyOf(x.project, settings))}</Text>
                </View>
                <View style={styles.prBar}><View style={[styles.prFill, { width: `${Math.round((x.ms / maxProjectMs) * 100)}%`, backgroundColor: x.project.color }]} /></View>
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
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.panel, maxWidth: 170 },
  chipOn: { backgroundColor: colors.raise },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  segWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  seg: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: radius.md, backgroundColor: colors.panel },
  segBtn: { flex: 1, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segOn: { backgroundColor: colors.raise },
  segText: { color: colors.textDim, fontSize: 12.5, fontWeight: '500' },
  segTextOn: { color: colors.text, fontWeight: '600' },
  content: { paddingHorizontal: spacing.md, paddingBottom: clearance, gap },
  cal: { paddingHorizontal: 10, paddingVertical: 10 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  arrow: { width: 36, height: 32, borderRadius: 9, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  calTitle: { color: colors.text, fontSize: 16, fontFamily: displayFamily.bold },
  wdRow: { flexDirection: 'row', gap: 4, paddingBottom: 4 },
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
  periodBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, padding: 8, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.panel2 },
  periodLabel: { color: colors.textDim, fontSize: 12.5 },
  periodRange: { color: colors.text, fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  periodSum: { color: colors.text, fontSize: 13, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  periodClear: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  bars: { flexDirection: 'row', gap: 6, height: 104, alignItems: 'flex-end', paddingTop: 4 },
  bar: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  barVal: { color: colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
  barFill: { width: '100%', maxWidth: 28, borderRadius: 6, backgroundColor: colors.raise },
  barFillOn: { backgroundColor: colors.accent },
  barDay: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
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
  prBar: { height: 4, borderRadius: 2, backgroundColor: colors.panel2, overflow: 'hidden', marginTop: 5 },
  prFill: { height: '100%', borderRadius: 2 },
});

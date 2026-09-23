// Расписание: часовая сетка с записями времени и дедлайнами.
//
// Неделя на телефоне сделана так же, как её сделали в мобильном Google
// Calendar, и по тем же причинам: семь столбцов помещаются целиком, без
// горизонтальной прокрутки, потому что «неделя, которую надо листать вбок» —
// это уже не неделя. Ради этого узкая колонка времени (38 px вместо 54 на
// десктопе), заголовок дня в две строки (буква и число) и мелкий кегль в
// блоках. В режимах «День» и «4 дня» колонки шире, и в блоке помещается
// время вместе с названием.
//
// Раскладку считает src/core/agenda.js — тот же файл, что на десктопе:
// нарезка записей по дням, разбор пересечений по колонкам, отбор дедлайнов.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Text from '../components/AppText';
import Icon from '../components/Icon';
import Agenda from '../core/agenda.js';
import { useAppStore, getProject } from '../store/useAppStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { t, LOCALE_MAP } from '../lib/i18n';

const HOUR_H = 52;
const GRID_H = HOUR_H * 24;
const GUTTER = 38;
// Открываем сетку на рабочем утре, а не на полуночи: ночью записей почти не
// бывает, и пустая верхняя треть — просто потерянный экран.
const OPEN_AT_HOUR = 7.5;

const MODES = ['day', 'days4', 'week'];
const MODE_KEY = { day: 'calendar.day', days4: 'agenda.days4', week: 'calendar.week' };
const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

const pad2 = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export default function ScheduleView({ onExit, navigate }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useBottomClearance();
  const scrollRef = useRef(null);
  const openedRef = useRef(false);

  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const lang = useAppStore((s) => s.settings.lang);
  const locale = LOCALE_MAP[lang] || 'ru-RU';

  const [mode, setMode] = useState('day');
  const [anchor, setAnchor] = useState(() => Agenda.startOfDayMs(Date.now()));
  // Минута, чтобы черта «сейчас» двигалась, а не замирала на моменте входа.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const { from, days } = useMemo(() => Agenda.agendaRange(mode, anchor), [mode, anchor]);
  const to = from + days * Agenda.DAY;

  const segments = useMemo(() => Agenda.sessionSegments(tasks, from, to), [tasks, from, to]);
  const deadlines = useMemo(() => Agenda.deadlineItems(tasks, from, to), [tasks, from, to]);

  const colorOf = (projectId) => {
    const p = getProject(projects, projectId);
    return p ? p.color : colors.accent;
  };
  const titleOf = (taskId) => {
    const task = tasks.find((x) => x.id === taskId);
    return task ? (task.title || t(lang, 'task.no_name')) : '';
  };

  const colWidth = (width - GUTTER - spacing.lg) / days;
  const dense = days > 4;

  // Один раз при входе прокручиваем к утру. Дальше положение — дело
  // пользователя, и возвращать его при каждой смене дня было бы навязчиво.
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y: OPEN_AT_HOUR * HOUR_H, animated: false }), 60);
    return () => clearTimeout(id);
  }, []);

  const title = useMemo(() => {
    const a = new Date(from);
    const b = new Date(to - Agenda.DAY);
    if (days === 1) return a.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    const short = { day: 'numeric', month: 'short' };
    return `${a.toLocaleDateString(locale, short)} – ${b.toLocaleDateString(locale, short)}`;
  }, [from, to, days, locale]);

  const shift = (dir) => setAnchor((a) => Agenda.shiftAnchor(mode, a, dir));

  const todayIndex = (() => {
    const i = Math.round((Agenda.startOfDayMs(nowMs) - from) / Agenda.DAY);
    return i >= 0 && i < days ? i : -1;
  })();

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        <Pressable onPress={onExit} style={styles.modeTab}>
          <Text style={styles.modeText}>{t(lang, 'calendar.month')}</Text>
        </Pressable>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[styles.modeTab, mode === m && styles.modeTabActive]}>
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{t(lang, MODE_KEY[m])}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.navRow}>
        <Pressable hitSlop={10} onPress={() => shift(-1)} style={styles.navBtn}>
          <Icon name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => setAnchor(Agenda.startOfDayMs(Date.now()))} style={styles.navTitleBtn}>
          <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
        </Pressable>
        <Pressable hitSlop={10} onPress={() => shift(1)} style={styles.navBtn}>
          <Icon name="chevron-right" size={18} color={colors.text} />
        </Pressable>
      </View>

      {/* Шапка дней: буква и число. В неделе это единственное, что помещается,
          и этого достаточно — месяц виден в заголовке выше. */}
      <View style={styles.dayNames}>
        <View style={{ width: GUTTER }} />
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(from + (i * Agenda.DAY));
          const isToday = i === todayIndex;
          return (
            <Pressable
              key={i}
              style={[styles.dayName, { width: colWidth }]}
              onPress={() => { setAnchor(Agenda.startOfDayMs(d.getTime())); setMode('day'); }}
            >
              <Text style={[styles.dow, isToday && styles.dowToday]}>
                {t(lang, WEEKDAY_KEY[d.getDay()]).slice(0, dense ? 1 : 2)}
              </Text>
              <View style={[styles.dnum, isToday && styles.dnumToday]}>
                <Text style={[styles.dnumText, isToday && styles.dnumTextToday]}>{d.getDate()}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Полоса «весь день»: дедлайны. Её высота не зависит от прокрутки
          сетки — иначе сроки уезжали бы за экран вместе с ночными часами. */}
      {deadlines.length ? (
        <View style={styles.allDay}>
          <Text style={styles.allDayLabel}>{t(lang, 'agenda.all_day')}</Text>
          <View style={styles.allDayCells}>
            {Array.from({ length: days }, (_, i) => (
              <View key={i} style={[styles.allDayCell, { width: colWidth }]}>
                {deadlines.filter((d) => d.dayIndex === i).map((d) => (
                  <Pressable
                    key={`${d.taskId}-${d.at}`}
                    onPress={() => navigate(d.taskId)}
                    style={[styles.dl, { backgroundColor: `${colorOf(d.projectId)}33` }]}
                  >
                    <Text style={styles.dlText} numberOfLines={1}>{titleOf(d.taskId)}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ height: GRID_H + clearance }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          <View style={styles.gutter}>
            {Array.from({ length: 24 }, (_, h) => (
              // Полночь не подписываем: её метка висела бы над первой линией и
              // читалась подписью ко всей сетке.
              <Text key={h} style={[styles.hour, { top: (h * HOUR_H) - 6 }]}>{h ? `${pad2(h)}:00` : ''}</Text>
            ))}
          </View>

          <View style={styles.cols}>
            {/* Линии часовые и получасовые — как на десктопе: шаг в полчаса
                видно, а час остаётся главным. */}
            {Array.from({ length: 47 }, (_, k) => {
              const half = (k + 1) % 2 === 1;
              return <View key={k} style={[styles.line, half && styles.lineHalf, { top: ((k + 1) * HOUR_H) / 2 }]} />;
            })}

            {Array.from({ length: days }, (_, i) => {
              const dayStart = from + (i * Agenda.DAY);
              const laid = Agenda.layoutOverlaps(segments.filter((s) => s.dayIndex === i));
              return (
                <View key={i} style={[styles.col, { width: colWidth }, i === todayIndex && styles.colToday]}>
                  {laid.map((seg) => {
                    const top = ((seg.start - dayStart) / Agenda.DAY) * GRID_H;
                    const height = Math.max(16, (seg.ms / Agenda.DAY) * GRID_H);
                    const w = (colWidth - 2) / seg.cols;
                    const tint = colorOf(seg.projectId);
                    return (
                      <Pressable
                        key={`${seg.taskId}-${seg.index}-${seg.start}`}
                        onPress={() => navigate(seg.taskId)}
                        style={[styles.ev, {
                          top,
                          height,
                          left: 1 + (seg.col * w),
                          width: w - 1,
                          backgroundColor: `${tint}2e`,
                          borderLeftColor: tint,
                        }]}
                      >
                        {/* В плотной неделе время не пишем — на 44 пикселя
                            ширины помещается либо оно, либо название. */}
                        {!dense && height >= 30 ? (
                          <Text style={styles.evTime} numberOfLines={1}>{`${hm(seg.start)}–${hm(seg.end)}`}</Text>
                        ) : null}
                        <Text style={styles.evName} numberOfLines={dense ? 2 : 1}>{titleOf(seg.taskId)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}

            {todayIndex >= 0 ? (
              <View
                pointerEvents="none"
                style={[styles.now, {
                  top: ((nowMs - Agenda.startOfDayMs(nowMs)) / Agenda.DAY) * GRID_H,
                  // Черта живёт внутри .cols, который уже начинается после
                  // колонки времени — смещать на GUTTER ещё раз не нужно.
                  left: todayIndex * colWidth,
                  width: colWidth,
                }]}
              >
                <View style={styles.nowDot} />
                <View style={styles.nowLine} />
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  modeRow: {
    flexDirection: 'row', gap: 3, padding: 3, marginHorizontal: spacing.lg, marginTop: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md,
  },
  modeTab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.sm },
  modeTabActive: { backgroundColor: colors.tabActiveBg },
  modeText: { color: colors.textDim, fontSize: fontSize.xs },
  modeTextActive: { color: colors.text, fontWeight: '700' },

  navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  navBtn: { padding: spacing.xs },
  navTitleBtn: { flex: 1, alignItems: 'center' },
  navTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },

  dayNames: { flexDirection: 'row' },
  dayName: { alignItems: 'center', paddingBottom: spacing.xs, gap: 2 },
  dow: { color: colors.textFaint, fontSize: 10 },
  dowToday: { color: colors.accent },
  // Фиксированный квадрат, а не minWidth: иначе двузначное число делает
  // подложку шире высоты, и кружок сегодняшнего дня превращается в овал.
  dnum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dnumToday: { backgroundColor: colors.accent },
  dnumText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  dnumTextToday: { color: colors.accentText },

  allDay: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
    paddingVertical: 3, maxHeight: 74,
  },
  allDayLabel: { width: GUTTER, color: colors.textFaint, fontSize: 9, textAlign: 'right', paddingRight: 6 },
  allDayCells: { flexDirection: 'row', flex: 1 },
  allDayCell: { gap: 2, paddingHorizontal: 1, borderLeftWidth: 1, borderLeftColor: colors.borderSoft },
  dl: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  dlText: { color: colors.text, fontSize: 9 },

  scroll: { flex: 1 },
  grid: { flexDirection: 'row', height: GRID_H },
  gutter: { width: GUTTER },
  hour: { position: 'absolute', right: 6, color: colors.textFaint, fontSize: 10 },
  cols: { flex: 1, flexDirection: 'row' },
  line: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.borderSoft },
  lineHalf: { opacity: 0.5 },
  col: { height: GRID_H, borderLeftWidth: 1, borderLeftColor: colors.borderSoft },
  colToday: { backgroundColor: `${colors.accent}0f` },

  ev: {
    position: 'absolute', borderRadius: 5, borderLeftWidth: 2,
    paddingHorizontal: 3, paddingTop: 1, overflow: 'hidden',
  },
  evTime: { color: colors.textDim, fontSize: 9 },
  evName: { color: colors.text, fontSize: 10, lineHeight: 12 },

  now: { position: 'absolute', height: 2, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger, marginLeft: -3 },
  nowLine: { flex: 1, height: 2, backgroundColor: colors.danger },
});

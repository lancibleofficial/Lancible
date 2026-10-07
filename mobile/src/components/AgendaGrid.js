// Часовая сетка «Времени»: день, четыре дня или неделя — записи времени
// блоками, дедлайны полосой «весь день», красная черта «сейчас».
//
// Неделя сделана как в мобильном Google Calendar: семь столбцов помещаются
// целиком, без горизонтальной прокрутки, ради этого узкая колонка времени
// и мелкий кегль в блоках. Раскладку считает src/core/agenda.js — тот же
// файл, что на десктопе: нарезка по дням, пересечения, прилипание.
//
// Касания — как на вебе, но через долгое нажатие, потому что простой
// палец по сетке — это прокрутка:
//   • долгое нажатие по пустому месту — новая запись (без движения — час,
//     с протягиванием — отрезок);
//   • долгое нажатие по блоку и протягивание — перенос (длительность
//     сохраняется, можно в соседний день);
//   • долгое нажатие по нижней кромке блока и протягивание — растяжение;
//   • короткое нажатие по блоку — открыть запись.
// Жест один на всю сетку: что именно под пальцем, решает проверка по
// геометрии блоков. Так не нужен отдельный распознаватель на каждый блок
// и не бывает спора «кто первый» между ними и пустым местом.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Text from './AppText';
import Agenda from '../core/agenda.js';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export const HOUR_H = 52;
export const GRID_H = HOUR_H * 24;
const GUTTER = 38;
// Открываем сетку на рабочем утре, а не на полуночи.
const OPEN_AT_HOUR = 7.5;
// Те же правила, что на вебе: шаг 15 минут, не короче 15 минут.
export const AG_SNAP_MIN = 15;
export const AG_MIN_MIN = 15;
const LONG_PRESS_MS = 350;
// Нижняя кромка блока, за которую его растягивают.
const GRIP_PX = 14;
const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

const pad2 = (n) => String(n).padStart(2, '0');
export const hmOf = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * @param tasks — уже отобранные фильтром; @param from/days — отрезок сетки;
 * @param enabled — жесты работают только на вкладке в фокусе;
 * @param onOpenDay(dayStartMs); @param onTapBlock(taskId, index);
 * @param onTapDeadline(taskId); @param onCreate({start, end});
 * @param onMove(taskId, index, start, end).
 */
export default function AgendaGrid({
  tasks, projects, from, days, nowMs, lang, enabled = true, bottomPadding = 0,
  onOpenDay, onTapBlock, onTapDeadline, onCreate, onMove,
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scrollRef = useRef(null);
  const openedRef = useRef(false);
  const to = from + days * Agenda.DAY;

  const segments = useMemo(() => Agenda.sessionSegments(tasks, from, to), [tasks, from, to]);
  const deadlines = useMemo(
    () => Agenda.deadlineItems(tasks, from, to).concat(Agenda.repeatGhosts(tasks, from, to)),
    [tasks, from, to],
  );

  const colorOf = (projectId) => {
    const p = projects.find((x) => x.id === projectId);
    return p ? p.color : colors.accent;
  };
  const titleOf = (taskId) => {
    const task = tasks.find((x) => x.id === taskId);
    return task ? (task.title || t(lang, 'task.no_name')) : '';
  };

  const colWidth = (width - GUTTER - spacing.lg) / days;
  const dense = days > 4;

  useEffect(() => {
    if (openedRef.current) return undefined;
    openedRef.current = true;
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y: OPEN_AT_HOUR * HOUR_H, animated: false }), 60);
    return () => clearTimeout(id);
  }, []);

  const todayIndex = (() => {
    const i = Math.round((Agenda.startOfDayMs(nowMs) - from) / Agenda.DAY);
    return i >= 0 && i < days ? i : -1;
  })();

  // Геометрия блоков — для проверки «что под пальцем» в жесте.
  const laidByDay = useMemo(() => Array.from({ length: days }, (_, i) => {
    const dayStart = from + i * Agenda.DAY;
    return Agenda.layoutOverlaps(segments.filter((s) => s.dayIndex === i)).map((seg) => {
      const top = ((seg.start - dayStart) / Agenda.DAY) * GRID_H;
      const height = Math.max(16, (seg.ms / Agenda.DAY) * GRID_H);
      const w = (colWidth - 2) / seg.cols;
      return { ...seg, dayStart, top, height, left: 1 + seg.col * w, width: w - 1 };
    });
  }), [segments, days, from, colWidth]);
  const laidRef = useRef(laidByDay);
  laidRef.current = laidByDay;

  // --- перетаскивание ---
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const setDragBoth = (next) => { dragRef.current = next; setDrag(next); };

  const pointAt = (x, y) => {
    const dayIndex = Math.max(0, Math.min(days - 1, Math.floor(x / colWidth)));
    const frac = Math.max(0, Math.min(1, y / GRID_H));
    const dayStart = from + dayIndex * Agenda.DAY;
    return { dayIndex, dayStart, ms: dayStart + frac * Agenda.DAY };
  };

  const hitBlock = (x, y) => {
    const dayIndex = Math.max(0, Math.min(days - 1, Math.floor(x / colWidth)));
    const lx = x - dayIndex * colWidth;
    const list = laidRef.current[dayIndex] || [];
    // Поздние блоки лежат выше ранних — проверяем с конца.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const b = list[i];
      if (y >= b.top && y <= b.top + b.height && lx >= b.left && lx <= b.left + b.width) return b;
    }
    return null;
  };

  const sessionSpan = (taskId, index) => {
    const task = tasks.find((x) => x.id === taskId);
    const s = task && task.sessions ? task.sessions[index] : null;
    if (!s) return null;
    const a = new Date(s.start).getTime();
    const b = s.end ? new Date(s.end).getTime() : a + (s.ms || 0);
    return { start: a, end: b };
  };

  const pan = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .runOnJS(true)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart((e) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const point = pointAt(e.x, e.y);
      const block = hitBlock(e.x, e.y);
      if (block) {
        const span = sessionSpan(block.taskId, block.index);
        if (!span) return;
        const resize = e.y > block.top + block.height - GRIP_PX;
        setDragBoth({
          kind: resize ? 'resize' : 'move', taskId: block.taskId, index: block.index,
          dayStart: block.dayStart, start: span.start, end: span.end, grab: point.ms - span.start, moved: false,
        });
      } else {
        const start = Agenda.snapMinutes(point.ms, AG_SNAP_MIN);
        setDragBoth({ kind: 'create', dayStart: point.dayStart, start, end: start, anchor: start, moved: false });
      }
    })
    .onUpdate((e) => {
      const d = dragRef.current;
      if (!d) return;
      const point = pointAt(e.x, e.y);
      let next;
      if (d.kind === 'create') {
        const edge = Agenda.snapMinutes(point.ms, AG_SNAP_MIN);
        const a = Math.min(d.dayStart + Agenda.DAY, Math.max(d.dayStart, Math.min(edge, d.anchor)));
        const b = Math.min(d.dayStart + Agenda.DAY, Math.max(edge, d.anchor));
        next = { ...d, start: a, end: b, moved: true };
      } else if (d.kind === 'resize') {
        // Растягивают в пределах своего дня: день берётся у блока, высота —
        // у пальца, даже если он уехал в соседний столбец.
        const ms = d.dayStart + Math.max(0, Math.min(1, e.y / GRID_H)) * Agenda.DAY;
        const span = Agenda.clampSpan(d.dayStart, d.start, Agenda.snapMinutes(ms, AG_SNAP_MIN), AG_MIN_MIN);
        next = { ...d, start: span.start, end: span.end, moved: true };
      } else {
        const dur = d.end - d.start;
        const start = Agenda.snapMinutes(point.ms - d.grab, AG_SNAP_MIN);
        const span = Agenda.clampSpan(point.dayStart, start, start + dur, AG_MIN_MIN);
        next = { ...d, dayStart: point.dayStart, start: span.start, end: span.end, moved: true };
      }
      if (next.start !== d.start || next.end !== d.end || next.dayStart !== d.dayStart) setDragBoth(next);
      else dragRef.current = next;
    })
    .onEnd(() => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'create') {
        let { start, end } = d;
        // Нажатие без протягивания — час с этой отметки, как в Google.
        if (!d.moved || end - start < AG_MIN_MIN * 60000) end = start + 3_600_000;
        onCreate(Agenda.clampSpan(d.dayStart, start, end, AG_MIN_MIN));
        return;
      }
      if (!d.moved) { onTapBlock(d.taskId, d.index); return; }
      onMove(d.taskId, d.index, d.start, d.end);
    })
    .onFinalize(() => setDragBoth(null)), [enabled, days, from, colWidth, tasks]);

  // Пока тянут, сетка не прокручивается: иначе блок и палец разъезжаются.
  const scrolling = !drag;

  const ghost = drag ? (() => {
    const dayIndex = Math.round((Agenda.startOfDayMs(drag.start) - from) / Agenda.DAY);
    if (dayIndex < 0 || dayIndex >= days) return null;
    const dayStart = from + dayIndex * Agenda.DAY;
    return {
      left: dayIndex * colWidth + 1,
      top: ((drag.start - dayStart) / Agenda.DAY) * GRID_H,
      height: Math.max(16, ((drag.end - drag.start) / Agenda.DAY) * GRID_H),
      width: colWidth - 2,
      label: `${hmOf(drag.start)}–${hmOf(drag.end)}`,
    };
  })() : null;

  return (
    <View style={styles.container}>
      {/* Шапка дней: буква и число. */}
      <View style={styles.dayNames}>
        <View style={{ width: GUTTER }} />
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(from + i * Agenda.DAY);
          const isToday = i === todayIndex;
          return (
            <Pressable key={i} style={[styles.dayName, { width: colWidth }]} onPress={() => onOpenDay(d.getTime())}>
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

      {deadlines.length ? (
        <View style={styles.allDay}>
          <Text style={styles.allDayLabel}>{t(lang, 'agenda.all_day')}</Text>
          <View style={styles.allDayCells}>
            {Array.from({ length: days }, (_, i) => (
              <View key={i} style={[styles.allDayCell, { width: colWidth }]}>
                {deadlines.filter((d) => d.dayIndex === i).map((d) => (
                  <Pressable
                    key={`${d.taskId}-${d.at}`}
                    onPress={() => onTapDeadline(d.taskId)}
                    style={[styles.dl, { backgroundColor: `${colorOf(d.projectId)}33` }, d.done && styles.dlDone, d.ghost && styles.dlGhost]}
                  >
                    <Text style={styles.dlText} numberOfLines={1}>{(d.ghost ? '↻ ' : '') + titleOf(d.taskId)}</Text>
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
        contentContainerStyle={{ height: GRID_H + bottomPadding }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrolling}
      >
        <View style={styles.grid}>
          <View style={styles.gutter}>
            {Array.from({ length: 24 }, (_, h) => (
              <Text key={h} style={[styles.hour, { top: h * HOUR_H - 6 }]}>{h ? `${pad2(h)}:00` : ''}</Text>
            ))}
          </View>

          <GestureDetector gesture={pan}>
            <View style={styles.cols} collapsable={false}>
              {Array.from({ length: 47 }, (_, k) => {
                const half = (k + 1) % 2 === 1;
                return <View key={k} style={[styles.line, half && styles.lineHalf, { top: ((k + 1) * HOUR_H) / 2 }]} />;
              })}

              {/* Подсветка сегодняшнего столбца — только когда столбцов несколько:
                  в режиме дня она заливала бы всю сетку. */}
              {laidByDay.map((laid, i) => (
                <View key={i} style={[styles.col, { width: colWidth }, days > 1 && i === todayIndex && styles.colToday]}>
                  {laid.map((seg) => {
                    const tint = colorOf(seg.projectId);
                    const dragging = drag && drag.kind !== 'create' && drag.taskId === seg.taskId && drag.index === seg.index;
                    return (
                      <Pressable
                        key={`${seg.taskId}-${seg.index}-${seg.start}`}
                        onPress={() => onTapBlock(seg.taskId, seg.index)}
                        style={[styles.ev, {
                          top: seg.top, height: seg.height, left: seg.left, width: seg.width,
                          backgroundColor: `${tint}2e`, borderLeftColor: tint,
                        }, dragging && styles.evDragging]}
                      >
                        {!dense && seg.height >= 30 ? (
                          <Text style={styles.evTime} numberOfLines={1}>{`${hmOf(seg.start)}–${hmOf(seg.end)}`}</Text>
                        ) : null}
                        <Text style={styles.evName} numberOfLines={dense ? 2 : 1}>{titleOf(seg.taskId)}</Text>
                        <View style={styles.grip} />
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              {ghost ? (
                <View pointerEvents="none" style={[styles.ghost, { left: ghost.left, top: ghost.top, height: ghost.height, width: ghost.width }]}>
                  <Text style={styles.ghostText} numberOfLines={1}>{ghost.label}</Text>
                </View>
              ) : null}

              {todayIndex >= 0 ? (
                <View
                  pointerEvents="none"
                  style={[styles.now, {
                    top: ((nowMs - Agenda.startOfDayMs(nowMs)) / Agenda.DAY) * GRID_H,
                    left: todayIndex * colWidth,
                    width: colWidth,
                  }]}
                >
                  <View style={styles.nowDot} />
                  <View style={styles.nowLine} />
                </View>
              ) : null}
            </View>
          </GestureDetector>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1 },
  dayNames: { flexDirection: 'row', paddingTop: spacing.xs },
  dayName: { alignItems: 'center', paddingBottom: spacing.xs, gap: 2 },
  dow: { color: colors.textFaint, fontSize: 10 },
  dowToday: { color: colors.accentInk },
  dnum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dnumToday: { backgroundColor: colors.accent },
  dnumText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  dnumTextToday: { color: colors.accentText },

  allDay: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    paddingVertical: 3, maxHeight: 74,
  },
  allDayLabel: { width: GUTTER, color: colors.textFaint, fontSize: 9, textAlign: 'right', paddingRight: 6 },
  allDayCells: { flexDirection: 'row', flex: 1 },
  allDayCell: { gap: 2, paddingHorizontal: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.borderSoft },
  dl: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  dlDone: { opacity: 0.5 },
  dlGhost: { opacity: 0.55 },
  dlText: { color: colors.text, fontSize: 9 },

  scroll: { flex: 1 },
  grid: { flexDirection: 'row', height: GRID_H },
  gutter: { width: GUTTER },
  hour: { position: 'absolute', right: 6, color: colors.textFaint, fontSize: 10 },
  cols: { flex: 1, flexDirection: 'row', height: GRID_H },
  line: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  lineHalf: { opacity: 0.5 },
  col: { height: GRID_H, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.borderSoft },
  colToday: { backgroundColor: colors.accentMuted },

  ev: {
    position: 'absolute', borderRadius: 5, borderLeftWidth: 2,
    paddingHorizontal: 3, paddingTop: 1, overflow: 'hidden',
  },
  evDragging: { opacity: 0.35 },
  evTime: { color: colors.textDim, fontSize: 9 },
  evName: { color: colors.text, fontSize: 10, lineHeight: 12 },
  // Ручка растяжения — короткая чёрточка у нижней кромки (.ag-ev-grip).
  grip: { position: 'absolute', bottom: 2, left: '40%', right: '40%', height: 3, borderRadius: 2, backgroundColor: colors.border },

  ghost: {
    position: 'absolute', borderRadius: 5, backgroundColor: colors.accentMuted,
    borderWidth: 1.5, borderColor: colors.accent, paddingHorizontal: 3, paddingTop: 1,
  },
  ghostText: { color: colors.accentInk, fontSize: 9, fontWeight: '700' },

  now: { position: 'absolute', height: 2, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger, marginLeft: -3 },
  nowLine: { flex: 1, height: 2, backgroundColor: colors.danger },
});

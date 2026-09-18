import { useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions, Animated, PanResponder } from 'react-native';
import Text from './AppText';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { monthLabel, capFirst } from '../lib/format';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

const WEEKDAY_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];
const GRID_GAP = 4;
const COMMIT_RATIO = 0.25;
// PanResponder отдаёт скорость в px/мс (в отличие от gesture-handler, где
// это px/с) — отсюда доли единицы, а не сотни.
const FLING_VELOCITY = 0.5;

// Календарь для листов. Оформление намеренно повторяет сетку экрана
// «Календарь» (те же ячейки на panel2, тот же зазор, тот же заголовок
// месяца с шевронами и свайпом) — до этого здесь была своя мелкая сетка, и
// два календаря в одном приложении выглядели как из разных приложений.
//
// Работает в двух режимах:
//   valueKey            — выбор одной даты (дедлайн задачи);
//   fromKey/toKey       — выбор диапазона (период экспорта). Подсвечивает
//                         обе границы и всё между ними; решение, какую из
//                         границ двигает нажатие, принимает родитель.
export default function MiniDatePicker({ valueKey, fromKey, toKey, lang, onPick }) {
  const colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
  const cellSize = Math.floor((windowWidth - spacing.lg * 2 - GRID_GAP * 6) / 7);
  const styles = makeStyles(colors, cellSize);

  const initial = valueKey || fromKey;
  const [view, setView] = useState(initial ? keyToDate(initial) : new Date());
  const translateX = useRef(new Animated.Value(0)).current;

  const y = view.getFullYear();
  const m = view.getMonth();
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const todayKey = dayKey(new Date());

  function shift(dir) {
    setView(new Date(y, m + dir, 1));
    translateX.setValue(dir * cellSize * 3);
    Animated.timing(translateX, { toValue: 0, duration: 160, useNativeDriver: true }).start();
  }

  // Свайп на PanResponder, а не на gesture-handler: лист (BottomSheet.js)
  // сам построен на PanResponder и обычном ScrollView, и жест из другой
  // библиотеки внутри него просто не получал управление — сначала свайп
  // молча не срабатывал вовсе. Здесь обе стороны в одной системе
  // ответчиков, и претензия на горизонтальное движение выигрывает у
  // вертикального скролла явно.
  const pan = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => translateX.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        const far = Math.abs(g.dx) > windowWidth * COMMIT_RATIO;
        const fast = Math.abs(g.vx) > FLING_VELOCITY;
        if (far || fast) shift(g.dx < 0 ? 1 : -1);
        else Animated.timing(translateX, { toValue: 0, duration: 140, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.timing(translateX, { toValue: 0, duration: 140, useNativeDriver: true }).start();
      },
    }),
    [windowWidth, y, m],
  );

  function stateOf(key) {
    if (!key) return null;
    if (valueKey) return key === valueKey ? 'end' : null;
    if (!fromKey) return null;
    if (key === fromKey || key === toKey) return 'end';
    if (toKey && key > fromKey && key < toKey) return 'mid';
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.nav}>
        <Pressable hitSlop={10} onPress={() => shift(-1)} style={styles.navBtn}>
          <Icon name="chevron-left" size={16} color={colors.text} />
        </Pressable>
        <Text style={styles.navTitle}>{capFirst(monthLabel(lang, y, m))}</Text>
        <Pressable hitSlop={10} onPress={() => shift(1)} style={styles.navBtn}>
          <Icon name="chevron-right" size={16} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.weekdaysRow}>
        {WEEKDAY_KEYS.map((k) => <Text key={k} style={styles.weekday}>{t(lang, k)}</Text>)}
      </View>

      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX }] }}>
          <View style={styles.grid}>
            {Array.from({ length: Math.ceil(cells.length / 7) }, (_, ri) => cells.slice(ri * 7, ri * 7 + 7)).map((row, ri) => (
              <View key={ri} style={styles.gridRow}>
                {row.map((d, ci) => {
                  if (!d) return <View key={ci} style={[styles.cell, styles.cellEmpty]} />;
                  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const st = stateOf(key);
                  return (
                    <Pressable
                      key={ci}
                      onPress={() => onPick(key)}
                      style={[styles.cell, st === 'mid' && styles.cellMid, st === 'end' && styles.cellEnd]}
                    >
                      <Text style={[
                        styles.cellNum,
                        key === todayKey && styles.cellNumToday,
                        st === 'end' && styles.cellNumEnd,
                      ]}>{d}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors, cellSize) => StyleSheet.create({
  wrap: { gap: spacing.sm, overflow: 'hidden' },
  nav: { flexDirection: 'row', alignItems: 'center' },
  navBtn: { padding: spacing.xs },
  navTitle: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' },
  weekdaysRow: { flexDirection: 'row', gap: GRID_GAP },
  weekday: { width: cellSize, textAlign: 'center', color: colors.textDim, fontSize: fontSize.xs },
  grid: { gap: GRID_GAP },
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  cell: {
    width: cellSize, height: cellSize, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm, backgroundColor: colors.panel2,
    borderWidth: 2, borderColor: 'transparent',
  },
  cellEmpty: { backgroundColor: 'transparent' },
  cellMid: { backgroundColor: colors.accentMuted },
  cellEnd: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  cellNum: { color: colors.text, fontSize: fontSize.sm },
  cellNumToday: { color: colors.accent, fontWeight: '800' },
  cellNumEnd: { color: colors.text, fontWeight: '700' },
});

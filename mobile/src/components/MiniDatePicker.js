import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import { dayKey, keyToDate } from '../lib/calendarMath';
import { monthLabel, capFirst } from '../lib/format';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

const WEEKDAY_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];

// Компактный попап выбора одной даты — свой вместо системного date-picker,
// как на десктопе (там тоже кастомная сетка вместо <input type="date">).
// Используется дважды (С/По) при выборе своего периода для экспорта.
export default function MiniDatePicker({ valueKey, lang, onPick }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [view, setView] = useState(valueKey ? keyToDate(valueKey) : new Date());
  const y = view.getFullYear();
  const m = view.getMonth();
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  const todayKey = dayKey(new Date());

  return (
    <View style={styles.wrap}>
      <View style={styles.nav}>
        <Pressable hitSlop={8} onPress={() => setView(new Date(y, m - 1, 1))}><Icon name="chevron-left" size={14} color={colors.text} /></Pressable>
        <Text style={styles.navTitle}>{capFirst(monthLabel(lang, y, m))}</Text>
        <Pressable hitSlop={8} onPress={() => setView(new Date(y, m + 1, 1))}><Icon name="chevron-right" size={14} color={colors.text} /></Pressable>
      </View>
      <View style={styles.weekdaysRow}>
        {WEEKDAY_KEYS.map((k) => <Text key={k} style={styles.weekday}>{t(lang, k)}</Text>)}
      </View>
      <View style={styles.grid}>
        {Array.from({ length: Math.ceil(cells.length / 7) }, (_, ri) => cells.slice(ri * 7, ri * 7 + 7)).map((row, ri) => (
          <View key={ri} style={styles.gridRow}>
            {row.map((d, i) => {
              if (!d) return <View key={`e${ri}-${i}`} style={styles.cell} />;
              const key = dayKey(new Date(y, m, d));
              const isSel = key === valueKey;
              const isToday = key === todayKey;
              return (
                <Pressable key={key} onPress={() => onPick(key)} style={[styles.cell, isSel && styles.cellSel]}>
                  <Text style={[styles.cellText, isToday && !isSel && styles.cellTextToday, isSel && styles.cellTextSel]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { backgroundColor: colors.panel2, borderRadius: radius.md, padding: spacing.sm },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs, marginBottom: spacing.xs },
  navTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  weekdaysRow: { flexDirection: 'row' },
  weekday: { flexBasis: `${100 / 7}%`, textAlign: 'center', color: colors.textDim, fontSize: 10 },
  grid: {},
  gridRow: { flexDirection: 'row' },
  cell: { flexBasis: `${100 / 7}%`, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  cellSel: { backgroundColor: colors.accent },
  cellText: { color: colors.text, fontSize: fontSize.sm },
  cellTextToday: { color: colors.accent, fontWeight: '800' },
  cellTextSel: { color: colors.accentText, fontWeight: '800' },
});

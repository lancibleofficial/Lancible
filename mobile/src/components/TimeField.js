// Поле времени «ЧЧ:ММ» для листов: кнопка-значение, по нажатию под ней
// раскрываются два столбца — часы и минуты через пять, как tp-pop на
// десктопе и столбцы в листе дедлайна. Одно на запись времени и на срок.
import { useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import { useColors, spacing, radius, fontSize } from '../theme';

const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/** @param value 'ЧЧ:ММ'; onChange('ЧЧ:ММ'). Минуты, не кратные пяти,
 *  показываются как есть, пока их не поменяли. */
export default function TimeField({ label, value, onChange, open, onToggle }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [h, m] = (value || '00:00').split(':').map(Number);
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort((a, b) => a - b);

  return (
    <View style={styles.wrap}>
      <Pressable style={[styles.btn, open && styles.btnOpen]} onPress={onToggle}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </Pressable>
      {open ? (
        <View style={styles.cols}>
          <ScrollView style={styles.col} contentContainerStyle={styles.colInner} showsVerticalScrollIndicator={false}>
            {HOURS.map((x) => (
              <Pressable key={x} onPress={() => onChange(`${pad2(x)}:${pad2(m)}`)} style={[styles.cell, x === h && styles.cellOn]}>
                <Text style={[styles.cellText, x === h && styles.cellTextOn]}>{pad2(x)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView style={styles.col} contentContainerStyle={styles.colInner} showsVerticalScrollIndicator={false}>
            {minutes.map((x) => (
              <Pressable key={x} onPress={() => onChange(`${pad2(h)}:${pad2(x)}`)} style={[styles.cell, x === m && styles.cellOn]}>
                <Text style={[styles.cellText, x === m && styles.cellTextOn]}>{pad2(x)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** Два поля в строке — начало и конец. Открыто не больше одного. */
export function TimeRange({ startLabel, endLabel, start, end, onStart, onEnd }) {
  const [open, setOpen] = useState(null);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TimeField label={startLabel} value={start} onChange={onStart} open={open === 'start'} onToggle={() => setOpen(open === 'start' ? null : 'start')} />
        <TimeField label={endLabel} value={end} onChange={onEnd} open={open === 'end'} onToggle={() => setOpen(open === 'end' ? null : 'end')} />
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { flex: 1, gap: spacing.sm },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  btnOpen: { backgroundColor: colors.accentMuted },
  label: { color: colors.textDim, fontSize: fontSize.sm },
  value: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cols: { flexDirection: 'row', gap: spacing.sm, height: 180 },
  col: { flex: 1, backgroundColor: colors.panel2, borderRadius: radius.md },
  colInner: { padding: 4, gap: 2 },
  cell: { paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  cellOn: { backgroundColor: colors.accent },
  cellText: { color: colors.text, fontSize: fontSize.md, fontVariant: ['tabular-nums'] },
  cellTextOn: { color: colors.accentText, fontWeight: '700' },
});

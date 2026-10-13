// Время «ЧЧ:ММ» для листов: два столбца — часы и минуты через пять, как
// tp-pop на десктопе. С 12 октября 2026 столбцы раскрываются под строкой
// «Начало · 10:00 ›» (ExpandRow в Island.js), а не под своей кнопкой-полем:
// строка даты и строки времени в листах отрезка, записи и напоминания — одна
// и та же строка острова. У дедлайна вместо столбцов — барабаны (DueSheet).
// Раскрытые столбцы сразу показывают выбранное (прокручены к нему), а не
// «00»: иначе 10:00 надо было бы искать прокруткой.
import { useRef } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import { useColors, spacing, radius, fontSize } from '../theme';

const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
/** Над выбранной ячейкой при раскрытии — столько воздуха (видны соседние). */
const ABOVE = 60;

/** Столбец: прокручивается к выбранной ячейке один раз, при первом замере. */
function Column({ values, selected, onPick, styles }) {
  const scroll = useRef(null);
  const target = useRef(null);
  const placed = useRef(false);
  // Прокрутка — когда известны и место ячейки, и высота содержимого: раньше
  // (в onLayout ячейки) Android прокрутку ещё не принимает.
  const place = () => {
    if (placed.current || target.current == null || !scroll.current) return;
    placed.current = true;
    const y = target.current;
    setTimeout(() => { if (scroll.current) scroll.current.scrollTo({ y, animated: false }); }, 0);
  };
  return (
    <ScrollView ref={scroll} style={styles.col} contentContainerStyle={styles.colInner} showsVerticalScrollIndicator={false} nestedScrollEnabled onContentSizeChange={place}>
      {values.map((x) => (
        <Pressable
          key={x}
          onPress={() => onPick(x)}
          onLayout={x === selected ? (e) => {
            if (target.current == null) target.current = Math.max(0, e.nativeEvent.layout.y - ABOVE);
            place();
          } : undefined}
          style={[styles.cell, x === selected && styles.cellOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: x === selected }}
        >
          <Text style={[styles.cellText, x === selected && styles.cellTextOn]}>{pad2(x)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** @param value 'ЧЧ:ММ'; onChange('ЧЧ:ММ'). Минуты, не кратные пяти,
 *  показываются как есть, пока их не поменяли. */
export default function TimeColumns({ value, onChange, testID = 'time-columns' }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [h, m] = (value || '00:00').split(':').map(Number);
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort((a, b) => a - b);

  return (
    <View style={styles.cols} testID={testID}>
      <Column values={HOURS} selected={h} onPick={(x) => onChange(`${pad2(x)}:${pad2(m)}`)} styles={styles} />
      <Column values={minutes} selected={m} onPick={(x) => onChange(`${pad2(h)}:${pad2(x)}`)} styles={styles} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  cols: { flexDirection: 'row', gap: spacing.sm, height: 180 },
  col: { flex: 1, backgroundColor: colors.panel2, borderRadius: radius.md },
  colInner: { padding: 4, gap: 2 },
  cell: { paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  cellOn: { backgroundColor: colors.accent },
  cellText: { color: colors.text, fontSize: fontSize.md, fontVariant: ['tabular-nums'] },
  cellTextOn: { color: colors.accentText, fontWeight: '700' },
});

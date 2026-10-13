// Выбор цвета из общей палитры отдельным листом.
//
// Раскладка та же, что у свотчей в TagEditSheet, но здесь это самостоятельный
// лист: цвет статуса правится из строки списка, а не из формы, и открывать
// ради него целую форму было бы странно. Выбор сразу закрывает лист — как в
// PickerSheet, отдельного «Готово» не нужно.
import { View, Pressable, StyleSheet } from 'react-native';
import { PALETTE } from '../lib/migrate';
import { closeSheet, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing, radius } from '../theme';

/** @param embedded страница внутри другого листа (настройки проекта): без
 *  своего заголовка и не закрывает лист — выбор отдаётся наверх. */
export default function ColorPickerSheet({ title, value, onSelect, embedded }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  useSheetHeader(embedded ? null : title);
  return (
    <View style={styles.wrap}>
      <View style={styles.grid} testID="color-grid">
        {PALETTE.map((c) => (
          <Pressable
            key={c}
            onPress={() => { onSelect(c); if (!embedded) closeSheet(); }}
            style={[styles.ring, value === c && styles.ringSel]}
            accessibilityRole="button"
            accessibilityState={{ selected: value === c }}
            testID={`color-${c}`}
          >
            <View style={[styles.swatch, { backgroundColor: c }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.md },
  // Сетка, а не лента: цветов шестнадцать, и в строку они не помещаются —
  // а искать нужный горизонтальной прокруткой дольше, чем взглядом.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  ring: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  ringSel: { backgroundColor: colors.panel2 },
  swatch: { width: 38, height: 38, borderRadius: radius.sm },
});

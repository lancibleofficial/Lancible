// Выбор цвета из общей палитры отдельным листом.
//
// Раскладка та же, что у свотчей в TagEditSheet, но здесь это самостоятельный
// лист: цвет статуса правится из строки списка, а не из формы, и открывать
// ради него целую форму было бы странно. Выбор сразу закрывает лист — как в
// PickerSheet, отдельного «Готово» не нужно.
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import { PALETTE } from '../lib/migrate';
import { closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';

export default function ColorPickerSheet({ title, value, onSelect }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.grid}>
        {PALETTE.map((c) => (
          <Pressable
            key={c}
            onPress={() => { onSelect(c); closeSheet(); }}
            style={[styles.ring, value === c && styles.ringSel]}
          >
            <View style={[styles.swatch, { backgroundColor: c }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.md, paddingBottom: spacing.lg },
  title: { color: colors.text, ...typography.title },
  // Сетка, а не лента: цветов шестнадцать, и в строку они не помещаются —
  // а искать нужный горизонтальной прокруткой дольше, чем взглядом.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  ring: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  ringSel: { backgroundColor: colors.panel2 },
  swatch: { width: 38, height: 38, borderRadius: radius.sm },
});

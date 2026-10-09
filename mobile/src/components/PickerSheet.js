import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';

// Простой список выбора одного варианта — язык, валюта и т.п. Выбор сразу
// закрывает лист, отдельная кнопка "Готово" не нужна.
/** @param embedded внутри другого листа: без своего заголовка и не закрывает лист */
export default function PickerSheet({ title, options, value, onSelect, embedded }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
      {embedded ? null : <Text style={styles.title}>{title}</Text>}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => { onSelect(opt.value); if (!embedded) closeSheet(); }}
            style={[styles.option, active && styles.optionActive]}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]}>{opt.label}</Text>
            {active ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, ...typography.title, marginBottom: spacing.xs },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.panel2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  optionActive: { backgroundColor: colors.accentMuted },
  optionText: { color: colors.text, fontSize: fontSize.md },
  optionTextActive: { color: colors.text, fontWeight: '700' },
});

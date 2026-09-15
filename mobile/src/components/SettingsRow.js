import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, fontSize } from '../theme';

// Строка настроек в духе референса пользователя: иконка + подпись слева,
// текущее значение (или произвольный right-элемент вроде свитчера) справа,
// шеврон — только если есть onPress (значит тап открывает нижний лист).
export default function SettingsRow({ icon, label, value, right, onPress, last, danger }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const body = (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Icon name={icon} size={17} color={danger ? colors.danger : colors.textDim} />
      <Text style={[styles.label, danger && { color: colors.danger }]} numberOfLines={1}>{label}</Text>
      <View style={{ flex: 1 }} />
      {right != null ? right : (
        <>
          {value != null ? <Text style={styles.value} numberOfLines={1}>{value}</Text> : null}
          {onPress ? <Icon name="chevron-right" size={13} color={colors.textDim} /> : null}
        </>
      )}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

export function SettingsCard({ children }) {
  const colors = useColors();
  return <View style={{ backgroundColor: colors.panel, borderRadius: 16, overflow: 'hidden' }}>{children}</View>;
}

const makeStyles = (colors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  label: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  value: { color: colors.textDim, fontSize: fontSize.sm, maxWidth: 140 },
});

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
      <View style={{ flex: 1, minWidth: spacing.sm }} />
      <View style={styles.rightSlot}>
        {right != null ? right : (
          <>
            {value != null ? <Text style={styles.value} numberOfLines={1}>{value}</Text> : null}
            {onPress ? <Icon name="chevron-right" size={13} color={colors.textDim} /> : null}
          </>
        )}
      </View>
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
  // flexShrink -- without it, a long label (esp. longer translated strings)
  // had nothing stopping it from pushing the right-side control (e.g. the
  // sync Toggle) past the row's edge on narrower screens instead of eliding.
  label: { flexShrink: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  // Never shrinks -- the switch/value/chevron must stay full-size and fully
  // visible even when the label above has to give up space to fit.
  rightSlot: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  value: { color: colors.textDim, fontSize: fontSize.sm, maxWidth: 140 },
});

// Остров — панель на земле: заливка panel, скругление 14, без рамки и
// тени. Та же деталь, что .island на десктопе и в вебе: всё содержимое
// экранов лежит островами, а экран подправляет только поля и отступы.
//
// IslandHead — строка «подзаголовок слева, тихая подпись или действие
// справа» (.island-head / .island-title / .island-note). IslandRow — строка
// внутри острова с линией сверху (списки записей, дедлайнов, свойств).
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import { useColors, spacing, radius, typography } from '../theme';

export default function Island({ children, style, padded = true, onPress, onLongPress, ...rest }) {
  const colors = useColors();
  const base = [
    { backgroundColor: colors.panel, borderRadius: radius.lg },
    padded ? { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 } : null,
    style,
  ];
  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [base, pressed && { opacity: 0.9 }]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={base} {...rest}>{children}</View>;
}

/** Шапка острова: подзаголовок и, справа, подпись или элемент. */
export function IslandHead({ title, note, right, onPressNote, style }) {
  const colors = useColors();
  const noteNode = note ? (
    onPressNote ? (
      <Pressable onPress={onPressNote} hitSlop={8}>
        <Text style={[typography.islandNote, { color: colors.accentInk }]}>{note}</Text>
      </Pressable>
    ) : <Text style={[typography.islandNote, { color: colors.textFaint }]} numberOfLines={1}>{note}</Text>
  ) : null;
  return (
    <View style={[styles.head, style]}>
      <Text style={[typography.islandTitle, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>{title}</Text>
      <View style={{ flex: 1, minWidth: spacing.sm }} />
      {right != null ? right : noteNode}
    </View>
  );
}

/** Строка внутри острова; у всех, кроме первой, линия сверху. */
export function IslandRow({ children, first, onPress, onLongPress, style }) {
  const colors = useColors();
  const rowStyle = [
    styles.row,
    !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    style,
  ];
  if (onPress || onLongPress) {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [rowStyle, pressed && { opacity: 0.75 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{children}</View>;
}

/** Тихая пустая подпись внутри острова (.island-empty). */
export function IslandEmpty({ children }) {
  const colors = useColors();
  return <Text style={[typography.caption, { color: colors.textFaint, marginTop: spacing.sm }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
});

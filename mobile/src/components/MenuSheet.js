// Меню действий нижним листом: строки с иконками, а не столбик кнопок.
//
// Не то же самое, что ActionSheetContent: тот — замена Alert.alert, где две-три
// кнопки и одна из них главная. Здесь пунктов полдюжины и главного среди них
// нет, поэтому одинаковые акцентные кнопки только мешали бы выбирать.
//
// Разрушительный пункт отделён чертой и покрашен: «Удалить» в общем ряду
// слишком легко нажать, целясь в соседнее.
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';

/**
 * @param {string} [title] — шапка листа.
 * @param {Array<{key, label, icon?, danger?, separated?, onPress}>} items
 */
export default function MenuSheet({ title, items }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
      {items.map((item) => (
        <View key={item.key}>
          {item.separated ? <View style={styles.separator} /> : null}
          <Pressable
            style={styles.row}
            onPress={() => { closeSheet(); item.onPress(); }}
          >
            {item.icon ? (
              <Icon name={item.icon} size={16} color={item.danger ? colors.danger : colors.textDim} />
            ) : null}
            <Text style={[styles.label, item.danger && styles.labelDanger]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { paddingBottom: spacing.lg },
  title: { color: colors.text, ...typography.title, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    // 52 — не «покрупнее»: пункты идут подряд, и соседний не должен ловить
    // палец, нацеленный сюда.
    minHeight: 52, paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  label: { flex: 1, color: colors.text, fontSize: fontSize.md },
  labelDanger: { color: colors.danger },
  separator: {
    height: StyleSheet.hairlineWidth, backgroundColor: colors.border,
    marginVertical: spacing.sm, marginHorizontal: spacing.md,
  },
});

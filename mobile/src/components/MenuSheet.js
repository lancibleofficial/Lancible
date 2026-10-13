// Меню действий нижним листом: строки с иконками, а не столбик кнопок.
//
// Не то же самое, что ActionSheetContent: тот — замена Alert.alert, где две-три
// кнопки и одна из них главная. Здесь пунктов полдюжины и главного среди них
// нет, поэтому одинаковые акцентные кнопки только мешали бы выбирать.
//
// Строки — общие SettingRow на островах (12 октября 2026), те же, что в
// «Меню» приложения и настройках: значок, название, без шеврона (пункт — это
// действие, а не настройка). Разрушительный пункт отделён — своим островом —
// и покрашен: «Удалить» в общем ряду слишком легко нажать, целясь в соседнее.
import { View, StyleSheet } from 'react-native';
import { RowGroup, SettingRow } from './Island';
import { closeSheet, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';

/**
 * @param {string} [title] — заголовок в общей шапке листа.
 * @param {Array<{key, label, icon?, danger?, separated?, onPress}>} items —
 *   separated начинает новый остров.
 */
export default function MenuSheet({ title, items }) {
  useSheetHeader(title);
  const groups = [];
  items.forEach((item, i) => {
    if (i === 0 || item.separated) groups.push([]);
    groups[groups.length - 1].push(item);
  });
  // Своего нижнего отступа у меню нет: воздух под последним пунктом — общий
  // у всех листов (BottomSheet, SHEET_BOTTOM_GAP).
  return (
    <View style={styles.content}>
      {groups.map((group) => (
        <RowGroup key={group[0].key}>
          {group.map((item) => (
            <SettingRow
              key={item.key}
              icon={item.icon}
              label={item.label}
              danger={item.danger}
              chevron={false}
              onPress={() => { closeSheet(); item.onPress(); }}
              testID={`menu-${item.key}`}
            />
          ))}
        </RowGroup>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
});

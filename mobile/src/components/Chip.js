// Чип быстрого выбора из короткого списка — один на «Сведения» задачи (статус,
// версия, «+ теги») и листы времени работы и напоминания: подложка panel2,
// выбранный — raise и подпись жирнее; у статуса — точка его цвета.
import { View, StyleSheet } from 'react-native';
import Tap from './Tap';
import Text from './AppText';
import { useColors } from '../theme';

/** @param dot цвет точки слева (статус) — данные пользователя, не токен */
export default function Chip({ label, on, onPress, dot, testID, accessibilityLabel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Tap onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }} accessibilityLabel={accessibilityLabel} testID={testID}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Tap>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.panel2 },
  dot: { width: 8, height: 8, borderRadius: 3 },
  chipOn: { backgroundColor: colors.raise },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '500', maxWidth: 220 },
  chipTextOn: { color: colors.text, fontWeight: '600' },
});

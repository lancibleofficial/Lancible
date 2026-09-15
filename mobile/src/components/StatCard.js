import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize } from '../theme';

// Общая карточка "иконка + значение + подпись" — используется на Home
// (статистика за сегодня) и на Stats (общая статистика).
export default function StatCard({ icon, label, value }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.statCard}>
      <Icon name={icon} size={18} color={colors.textDim} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  statCard: { flex: 1, backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  statValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  statLabel: { color: colors.textDim, fontSize: fontSize.xs },
});

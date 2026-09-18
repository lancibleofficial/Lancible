import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useColors, spacing, radius } from '../theme';

// Заглушки на время загрузки. Смысл не в украшении: приложение читает данные
// из хранилища не мгновенно, и раньше на этом месте крутился спиннер по центру
// пустого экрана. Спиннер ничего не говорит о том, что появится, и переход от
// него к готовому экрану выглядит как рывок. Скелетон же повторяет будущую
// раскладку, поэтому содержимое как бы проявляется на своих местах.
//
// Пульсация вместо бегущего блика: она дешевле (одно свойство, нативный
// драйвер) и не отвлекает. При включённом «уменьшении движения» система сама
// приглушает анимации, а статичный блок и без пульсации читается правильно.
const PULSE_MS = 900;

export function Skeleton({ width, height = 14, radius: r = radius.sm, style }) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: r, backgroundColor: colors.panel2, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) },
        style,
      ]}
    />
  );
}

/** Заглушка главного экрана: три карточки статистики, заголовок и плитки
 *  проектов — ровно то, что там окажется. Показывается, пока восстанавливается
 *  локальное хранилище и разрешается сессия. */
export function HomeSkeleton() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const styles = makeStyles(colors);
  const tileWidth = (width - spacing.lg * 2 - spacing.md) / 2;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Skeleton width={128} height={22} />
        <View style={styles.headerActions}>
          <Skeleton width={24} height={24} radius={12} />
          <Skeleton width={24} height={24} radius={12} />
        </View>
      </View>

      <View style={styles.statsRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.statCard}>
            <Skeleton width={20} height={20} radius={6} />
            <Skeleton width={54} height={18} style={{ marginTop: spacing.sm }} />
            <Skeleton width={72} height={10} style={{ marginTop: 6 }} />
          </View>
        ))}
      </View>

      <Skeleton width={104} height={13} style={{ marginTop: spacing.lg }} />
      <View style={styles.tiles}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.tile, { width: tileWidth }]}>
            <Skeleton width="70%" height={15} />
            <Skeleton width="45%" height={11} style={{ marginTop: spacing.sm }} />
            <Skeleton width="100%" height={4} radius={2} style={{ marginTop: 'auto' }} />
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  headerActions: { flexDirection: 'row', gap: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  tile: { height: 132, backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.md },
});

export default Skeleton;

import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { badgeInk, badgeBg } from '../lib/tags';
import { useColors, useThemeMode, spacing, fontSize } from '../theme';

// Бейдж тега — тот же вид, что на десктопе: подложка цветом тега, надпись
// тем же цветом, смешанным с цветом текста темы.
//
// Доля цвета зависит от темы не для красоты: яркий цвет, годный на тёмном
// фоне, на белом даёт контраст около 2,8 при пороге 4,5, и надпись
// становится нечитаемой. В React Native нет color-mix, поэтому смешиваем
// руками в lib/tags.js.
const INK_DARK = 0.62;
const INK_LIGHT = 0.34;

export default function TagBadge({ tag, onRemove }) {
  const colors = useColors();
  const mode = useThemeMode();
  const styles = makeStyles(colors);
  const ink = badgeInk(tag.color, colors.text, mode === 'light' ? INK_LIGHT : INK_DARK);
  return (
    <View style={[styles.badge, { backgroundColor: badgeBg(tag.color, 0.16) }]}>
      <Text style={[styles.name, { color: ink }]} numberOfLines={1}>{tag.name}</Text>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityLabel={tag.name}
          style={styles.remove}
        >
          <Icon name="x" size={10} color={ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Ряд бейджей. Переносится по строкам: тегов на задаче может быть сколько
 *  угодно, а ширина телефона не резиновая. */
export function TagBadgeRow({ tags, onRemove, style }) {
  if (!tags.length) return null;
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, style]}>
      {tags.map((tag) => (
        <TagBadge key={tag.id} tag={tag} onRemove={onRemove ? () => onRemove(tag.id) : undefined} />
      ))}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, maxWidth: '100%',
  },
  name: { fontSize: fontSize.xs, fontWeight: '600', flexShrink: 1 },
  remove: { marginRight: -2 },
});

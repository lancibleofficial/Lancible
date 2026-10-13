import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import Tap from './Tap';
import Icon from './Icon';
import { badgeColors, fitTagCount } from '../lib/tags';
import { useColors, useThemeMode, spacing, fontSize } from '../theme';

// Бейдж тега — тот же вид, что на десктопе: подложка цветом тега, надпись
// тем же цветом, смешанным с цветом текста темы. В React Native нет color-mix,
// поэтому смешиваем руками, в lib/tags.js (badgeColors): доля цвета зависит от
// темы, и та же формула красит плашку проекта в строке задачи (TaskRow).

export default function TagBadge({ tag, onRemove }) {
  const colors = useColors();
  const mode = useThemeMode();
  const styles = makeStyles(colors);
  const { bg, ink } = badgeColors(tag.color, colors.text, mode);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
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

// Строка тегов в одну линию (TagBadgeFit): зазор тот же, что у ряда выше, а
// высота строки — высота бейджа (шрифт xs + по 2 сверху и снизу), чтобы
// строка не прыгала, пока бейджи ещё измеряются.
const FIT_GAP = spacing.xs;
const FIT_MIN_H = 20;

/** Теги в одну строку: сколько влезло — столько и показано, остальные
 *  сворачиваются в бейдж «+N» (нажатие — onMore, обычно лист со всеми тегами).
 *
 *  Сколько влезает, решают измеренные ширины, а не оценка по длине имён:
 *  бейджи сперва рисуются невидимо вне потока (onLayout), и только когда
 *  измерены и они, и сама строка, показывается видимый ряд — без мерцания
 *  «все, потом обрезано». Смена ширины строки пересчитывает ряд без нового
 *  измерения бейджей; смена имени или масштаба шрифта измеряет их заново
 *  сама (onLayout сработает снова). Арифметика — lib/tags.js, fitTagCount.
 *  @param {object[]} tags — [{ id, name, color }]
 *  @param {function} onMore — нажали «+N»
 *  @param {string} [moreLabel] — подпись «+N» для скринридера */
export function TagBadgeFit({ tags, onMore, moreLabel, style, testID = 'tag-fit' }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [avail, setAvail] = useState(0);
  const [widths, setWidths] = useState({});
  const [moreW, setMoreW] = useState(0);
  const setWidth = (id, w) => setWidths((prev) => (prev[id] === w ? prev : { ...prev, [id]: w }));

  if (!tags.length) return null;
  const measured = tags.every((tag) => widths[tag.id] > 0);
  const ready = avail > 0 && moreW > 0 && measured;
  // Один пиксель запаса: ширины и сумма считаются дробными, а раскладка
  // округляет — без запаса последний бейдж иногда терял край надписи.
  const shown = ready ? fitTagCount(tags.map((tag) => widths[tag.id]), avail - 1, FIT_GAP, () => moreW) : 0;
  const rest = tags.length - shown;

  return (
    <View
      style={[styles.fit, style]}
      testID={testID}
      onLayout={(e) => setAvail(e.nativeEvent.layout.width)}
    >
      {ready ? (
        <View style={styles.fitRow}>
          {tags.slice(0, shown).map((tag, i) => (
            <View key={tag.id} style={i === 0 ? styles.fitFirst : styles.fitItem} testID={`${testID}-badge-${tag.id}`}>
              <TagBadge tag={tag} />
            </View>
          ))}
          {rest > 0 ? (
            <Tap
              scale={0.92}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={onMore}
              style={styles.more}
              accessibilityRole="button"
              accessibilityLabel={moreLabel}
              testID={`${testID}-more`}
            >
              <Text style={styles.moreText}>+{rest}</Text>
            </Tap>
          ) : null}
        </View>
      ) : null}

      {/* Мерный слой: те же бейджи, вне потока; не виден и не слышен. */}
      <View
        pointerEvents="none"
        style={styles.measure}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {tags.map((tag) => (
          <View key={tag.id} onLayout={(e) => setWidth(tag.id, e.nativeEvent.layout.width)} testID={`${testID}-measure-${tag.id}`}>
            <TagBadge tag={tag} />
          </View>
        ))}
        {/* «+N» по самому длинному числу — с запасом для меньших. */}
        <View style={styles.more} onLayout={(e) => setMoreW(e.nativeEvent.layout.width)} testID={`${testID}-measure-more`}>
          <Text style={styles.moreText}>+{tags.length}</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, maxWidth: '100%',
  },
  name: { fontSize: fontSize.xs, fontWeight: '600', flexShrink: 1 },
  remove: { marginRight: -2 },

  fit: { alignSelf: 'stretch', minHeight: FIT_MIN_H },
  fitRow: { flexDirection: 'row', alignItems: 'center', gap: FIT_GAP },
  // Ужимается только первый бейдж — когда он один не влез вместе с «+N»;
  // остальные ровно по измеренной ширине.
  fitFirst: { flexShrink: 1, minWidth: 0 },
  fitItem: { flexShrink: 0 },
  measure: { position: 'absolute', left: 0, top: 0, flexDirection: 'row', alignItems: 'flex-start', gap: FIT_GAP, opacity: 0 },
  // «+N» — тот же размер и скругление, что у бейджа тега, но не цветной:
  // это не тег, а счётчик скрытых.
  more: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: colors.panel2 },
  moreText: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700' },
});

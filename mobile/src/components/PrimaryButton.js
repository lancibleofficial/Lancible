import { Pressable, View, StyleSheet, ActivityIndicator } from 'react-native';
import Tap from './Tap';
import Text from './AppText';
import Icon from './Icon';
import { useColors, spacing, fontSize, buttonHeight, buttonHeightSm, buttonRadius } from '../theme';

// Малой кнопке до зоны касания в 44 pt не хватает высоты — добираем hitSlop-ом.
const SM_HIT_SLOP = { top: (44 - buttonHeightSm) / 2, bottom: (44 - buttonHeightSm) / 2 };

// Все варианты (акцентная, ghost, danger) — одной высоты и одного скругления:
// buttonHeight и buttonRadius из theme.js. Своей высоты у кнопки нет — ни
// «compact», ни style с height; тест mobile/tests/buttons.test.js обходит все
// места, где кнопка рисуется. testID — чтобы тест находил кнопки на экранах.
//
// size="sm" — малая кнопка: высота buttonHeightSm (токен, а не число у вызова)
// и шрифт fontSize.sm; скругление то же. Для карточек с двумя кнопками в ряд;
// размер не «подгоняют» под место стилем, а просят этим свойством.
export default function PrimaryButton({ title, onPress, disabled, loading, variant = 'primary', size = 'md', icon, style, shrinkText, testID = 'primary-button' }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const small = size === 'sm';
  const isGhost = variant === 'ghost';
  const isDanger = variant === 'danger';
  const fillStyle = isGhost ? styles.ghost : isDanger ? styles.danger : styles.primary;
  const textStyle = isGhost ? styles.ghostText : isDanger ? styles.dangerText : styles.primaryText;
  const iconColor = isGhost ? colors.text : isDanger ? colors.danger : colors.accentText;
  const spinnerColor = isGhost ? colors.accentInk : isDanger ? colors.danger : colors.accentText;
  const isDisabled = disabled || loading;
  return (
    <Tap
      // На Android Pressable, изначально смонтированный с disabled=true, при
      // последующем disabled=false может оставить нативную зону касания
      // прилипшей к исходным (маленьким) границам — реально воспроизводится
      // на кнопке "Создать проект" (пустое название → disabled, тап мимо
      // текста после ввода названия не срабатывал, хотя кнопка визуально уже
      // выглядела активной). key, завязанный на isDisabled, форсирует React
      // размонтировать/примонтировать Pressable заново при каждом переходе
      // между состояниями — так нативная view создаётся с нуля, без унаследованного
      // залипшего хит-теста.
      key={isDisabled ? 'off' : 'on'}
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={small ? SM_HIT_SLOP : undefined}
      style={({ pressed }) => [
        styles.base,
        small && styles.baseSm,
        fillStyle,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={16} color={iconColor} /> : null}
          {title ? (
            <Text
              style={[textStyle, small && styles.textSm]}
              numberOfLines={shrinkText ? 1 : undefined}
              adjustsFontSizeToFit={shrinkText}
              minimumFontScale={shrinkText ? 0.75 : undefined}
            >
              {title}
            </Text>
          ) : null}
        </View>
      )}
    </Tap>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  base: {
    width: '100%',
    minHeight: buttonHeight,
    borderRadius: buttonRadius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  baseSm: { minHeight: buttonHeightSm, paddingHorizontal: spacing.md },
  textSm: { fontSize: fontSize.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: colors.panel2 },
  // Опасная — не акцентная: подложка вторичной кнопки и красная подпись. С
  // 11 октября 2026 красной заливки нет — «Удалить запись» под «Сохранить»
  // спорила с главной кнопкой за взгляд (держит buttons.test.js).
  danger: { backgroundColor: colors.panel2 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  primaryText: { color: colors.accentText, fontSize: fontSize.md, fontWeight: '700' },
  ghostText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  dangerText: { color: colors.danger, fontSize: fontSize.md, fontWeight: '600' },
});

import { Pressable, View, StyleSheet, ActivityIndicator } from 'react-native';
import Text from './AppText';
import Icon from './Icon';
import { useColors, radius, spacing, fontSize, buttonHeight } from '../theme';

export default function PrimaryButton({ title, onPress, disabled, loading, variant = 'primary', icon, compact, style, shrinkText }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const isGhost = variant === 'ghost';
  const isDanger = variant === 'danger';
  const fillStyle = isGhost ? styles.ghost : isDanger ? styles.danger : styles.primary;
  const textStyle = isGhost ? styles.ghostText : isDanger ? styles.dangerText : styles.primaryText;
  const iconColor = isGhost ? colors.text : colors.accentText;
  const isDisabled = disabled || loading;
  return (
    <Pressable
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
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        fillStyle,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isGhost ? colors.accent : colors.accentText} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={16} color={iconColor} /> : null}
          {title ? (
            <Text
              style={textStyle}
              numberOfLines={shrinkText ? 1 : undefined}
              adjustsFontSizeToFit={shrinkText}
              minimumFontScale={shrinkText ? 0.75 : undefined}
            >
              {title}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  base: {
    width: '100%',
    minHeight: buttonHeight,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  compact: { minHeight: buttonHeight - 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: colors.panel2 },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  primaryText: { color: colors.accentText, fontSize: fontSize.md, fontWeight: '700' },
  ghostText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  dangerText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});

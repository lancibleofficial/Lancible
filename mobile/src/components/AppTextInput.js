// Обёртка над RN TextInput с тем же шрифтом по умолчанию — см. AppText.js
// для полного объяснения (в т.ч. почему fontWeight нужно убирать из style,
// а не просто добавлять fontFamily).
import { forwardRef } from 'react';
import { TextInput as RNTextInput, Pressable, StyleSheet } from 'react-native';

import Text, { FAMILY_BY_WEIGHT, DEFAULT_FAMILY } from './AppText';
import Icon from './Icon';
import { useColors, spacing, radius, fontSize, buttonHeight } from '../theme';

const TextInput = forwardRef(({ style, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || DEFAULT_FAMILY;
  return <RNTextInput ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined }]} />;
});

export default TextInput;

/** Вид поля — один на всё приложение: подложка inputBg, скругление поля
 *  (radius.md), без рамки; высота однострочного — buttonHeight, та же, что у
 *  кнопки, поэтому квадратная «+» рядом с полем с ним вровень. До 11 октября
 *  2026 поля версий в окне проекта были со своей рамкой, мельче и с другим
 *  скруглением, а «+» рядом — крупнее поля (держит mobile/tests/fields.test.js).
 *  Многострочное — от 72 в высоту, текст сверху. */
export function fieldStyle(colors, multiline = false) {
  return {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, color: colors.text, fontSize: fontSize.md,
    ...(multiline
      ? { minHeight: 72, paddingVertical: spacing.md, textAlignVertical: 'top' }
      : { minHeight: buttonHeight, paddingVertical: 0, textAlignVertical: 'center' }),
  };
}

/** Поле ввода с видом fieldStyle. invalid — красная рамка (имя занято и т. п.);
 *  рамка внутри коробки, высота поля не меняется. style экрана — поверх: ширина,
 *  flex, выравнивание текста.
 *  big — главное поле листа, название того, что заводят («Название проекта»,
 *  «Название задачи» в новой записи): тот же вид, текст на ступень крупнее
 *  (fontSize.lg) и плотнее; подписи над ним не нужно — её говорит
 *  плейсхолдер. */
export const Field = forwardRef(({ style, invalid, multiline, big, ...props }, ref) => {
  const colors = useColors();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textFaint}
      {...props}
      multiline={multiline}
      style={[fieldStyle(colors, multiline), big && bigStyle, invalid && { borderWidth: 1, borderColor: colors.danger }, style]}
    />
  );
});

const bigStyle = { fontSize: fontSize.lg, fontWeight: '600' };

/** Поле-выпадашка: то же поле, но вместо ввода — выбор (лист или страница
 *  листа со списком). Подпись слева, справа шеврон вниз. */
export function SelectField({ label, onPress, dim, style, testID, accessibilityLabel }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [selectStyles.box, { backgroundColor: pressed ? colors.raise : colors.inputBg }, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Text style={[selectStyles.text, { color: dim ? colors.textDim : colors.text }]} numberOfLines={1}>{label}</Text>
      <Icon name="chevron-down" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

const selectStyles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: buttonHeight, paddingHorizontal: spacing.md, borderRadius: radius.md,
  },
  text: { flex: 1, fontSize: fontSize.md },
});

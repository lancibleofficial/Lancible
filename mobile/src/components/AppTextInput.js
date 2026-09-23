// Обёртка над RN TextInput с тем же шрифтом по умолчанию — см. AppText.js
// для полного объяснения (в т.ч. почему fontWeight нужно убирать из style,
// а не просто добавлять fontFamily).
import { forwardRef } from 'react';
import { TextInput as RNTextInput, StyleSheet } from 'react-native';

// Сдвиг на ступень вниз — см. AppText.js.
const FAMILY_BY_WEIGHT = {
  100: 'Gravity-Light', 200: 'Gravity-Light', 300: 'Gravity-Light',
  400: 'Gravity-Book', normal: 'Gravity-Book',
  500: 'Gravity-Regular', 600: 'Gravity-Regular',
  700: 'Gravity-Bold', bold: 'Gravity-Bold',
  800: 'Gravity-Bold', 900: 'Gravity-Bold',
};

const TextInput = forwardRef(({ style, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || 'Gravity-Book';
  return <RNTextInput ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined }]} />;
});

export default TextInput;

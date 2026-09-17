// Обёртка над RN TextInput с тем же шрифтом по умолчанию — см. AppText.js
// для полного объяснения (в т.ч. почему fontWeight нужно убирать из style,
// а не просто добавлять fontFamily).
import { forwardRef } from 'react';
import { TextInput as RNTextInput, StyleSheet } from 'react-native';

// Сдвиг на ступень вниз — см. AppText.js.
const FAMILY_BY_WEIGHT = {
  100: 'BasiquePro-Light', 200: 'BasiquePro-Light', 300: 'BasiquePro-Light',
  400: 'BasiquePro-Light', normal: 'BasiquePro-Light',
  500: 'BasiquePro-Light', 600: 'BasiquePro-Regular',
  700: 'BasiquePro-Regular', bold: 'BasiquePro-Regular',
  800: 'BasiquePro-Bold', 900: 'BasiquePro-Bold',
};

const TextInput = forwardRef(({ style, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || 'BasiquePro-Light';
  return <RNTextInput ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined }]} />;
});

export default TextInput;

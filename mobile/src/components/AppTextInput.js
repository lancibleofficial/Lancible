// Обёртка над RN TextInput с тем же шрифтом по умолчанию — см. AppText.js
// для полного объяснения (в т.ч. почему fontWeight нужно убирать из style,
// а не просто добавлять fontFamily).
import { forwardRef } from 'react';
import { TextInput as RNTextInput, StyleSheet } from 'react-native';

// Сдвиг на ступень вниз — см. AppText.js.
const FAMILY_BY_WEIGHT = {
  100: 'Basique Pro Light', 200: 'Basique Pro Light', 300: 'Basique Pro Light',
  400: 'Basique Pro Light', normal: 'Basique Pro Light',
  500: 'Basique Pro Light', 600: 'Basique Pro',
  700: 'Basique Pro', bold: 'Basique Pro',
  800: 'Basique Pro Bold', 900: 'Basique Pro Bold',
};

const TextInput = forwardRef(({ style, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || 'Basique Pro Light';
  return <RNTextInput ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined }]} />;
});

export default TextInput;

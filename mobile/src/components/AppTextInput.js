// Обёртка над RN TextInput с тем же шрифтом по умолчанию — см. AppText.js
// для полного объяснения (в т.ч. почему fontWeight нужно убирать из style,
// а не просто добавлять fontFamily).
import { forwardRef } from 'react';
import { TextInput as RNTextInput, StyleSheet } from 'react-native';

import { FAMILY_BY_WEIGHT, DEFAULT_FAMILY } from './AppText';

const TextInput = forwardRef(({ style, ...props }, ref) => {
  const flat = StyleSheet.flatten(style) || {};
  const family = flat.fontFamily || FAMILY_BY_WEIGHT[flat.fontWeight] || DEFAULT_FAMILY;
  return <RNTextInput ref={ref} {...props} style={[style, { fontFamily: family, fontWeight: undefined }]} />;
});

export default TextInput;

import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { parseNum } from '../lib/format';
import { setSheetFooter, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function RateSheet({ lang, initialValue, onSave }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [text, setText] = useState(initialValue ? String(initialValue) : '');

  function save() {
    onSave(parseNum(text));
    closeSheet();
  }

  useEffect(() => {
    setSheetFooter(<PrimaryButton title={t(lang, 'common.save')} onPress={save} />);
    return () => setSheetFooter(null);
  }, [text]);

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{t(lang, 'settings.rate_label')}</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.textDim}
        autoFocus
      />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  input: {
    backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
});

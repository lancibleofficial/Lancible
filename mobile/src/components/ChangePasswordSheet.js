import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { setSheetFooter, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function ChangePasswordSheet() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const changePassword = useAuthStore((s) => s.changePassword);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (pw.length < 6) { setError(t(lang, 'profile.password_too_short')); return; }
    if (pw !== pw2) { setError(t(lang, 'profile.password_mismatch')); return; }
    setError('');
    setSaving(true);
    const result = await changePassword(pw);
    setSaving(false);
    if (result.ok) {
      closeSheet();
      showToast(t(lang, 'profile.password_updated'));
    } else {
      setError(t(lang, 'auth.error_generic'));
    }
  }

  useEffect(() => {
    setSheetFooter(<PrimaryButton title={t(lang, 'common.save')} onPress={save} loading={saving} />);
    return () => setSheetFooter(null);
  }, [pw, pw2, saving, lang]);

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{t(lang, 'profile.change_password')}</Text>
      <TextInput
        style={styles.input}
        value={pw}
        onChangeText={(v) => { setPw(v); setError(''); }}
        placeholder={t(lang, 'profile.new_password')}
        placeholderTextColor={colors.textDim}
        secureTextEntry
        autoFocus
      />
      <TextInput
        style={styles.input}
        value={pw2}
        onChangeText={(v) => { setPw2(v); setError(''); }}
        placeholder={t(lang, 'profile.confirm_password')}
        placeholderTextColor={colors.textDim}
        secureTextEntry
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm },
});

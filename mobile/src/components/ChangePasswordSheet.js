import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { Hint } from './RepeatControls';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { setSheetFooter, clearSheetFooter, closeSheet, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';
import { t } from '../lib/i18n';

/** Смена пароля: два поля и «Сохранить».
 *  @param embedded страница листа профиля (ProfileSheet): без своего
 *    заголовка — его и стрелку «назад» ставит профиль. */
export default function ChangePasswordSheet({ embedded }) {
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const changePassword = useAuthStore((s) => s.changePassword);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useSheetHeader(embedded ? null : t(lang, 'profile.change_password'));

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
    const footer = <PrimaryButton title={t(lang, 'common.save')} onPress={save} loading={saving} />;
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [pw, pw2, saving, lang]);

  return (
    <View style={styles.content}>
      <Field
        value={pw}
        onChangeText={(v) => { setPw(v); setError(''); }}
        placeholder={t(lang, 'profile.new_password')}
        secureTextEntry
        autoFocus
      />
      <Field
        value={pw2}
        onChangeText={(v) => { setPw2(v); setError(''); }}
        placeholder={t(lang, 'profile.confirm_password')}
        secureTextEntry
      />
      {error ? <Hint danger>{error}</Hint> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
});

import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { setSheetFooter, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Вход и регистрация в одном листе — переключаются табом сверху, а не двумя
// отдельными экранами/шитами: общий email+пароль, меняется только
// поведение onSubmit и подпись единственной акцентной кнопки внизу.
export default function AuthSheet({ initialTab = 'signin' }) {
  const lang = useAppStore((s) => s.settings.lang);
  const colors = useColors();
  const styles = makeStyles(colors);
  const [tab, setTab] = useState(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [offerSignup, setOfferSignup] = useState(false);
  const { authError, pendingConfirmEmail, signIn, signUp, clearAuthError } = useAuthStore();

  function switchTab(next) {
    setTab(next);
    setOfferSignup(false);
    clearAuthError();
  }

  async function onSubmit() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setOfferSignup(false);
    if (tab === 'signin') {
      const result = await signIn(email, password);
      if (result.ok) closeSheet();
      else if (result.offerSignup) setOfferSignup(true);
    } else {
      const result = await signUp(email, password);
      if (result.ok && !result.needsConfirmation) closeSheet();
    }
    setLoading(false);
  }

  useEffect(() => {
    if (pendingConfirmEmail) {
      setSheetFooter(<PrimaryButton title={t(lang, 'common.ok')} onPress={closeSheet} />);
      return () => setSheetFooter(null);
    }
    setSheetFooter(
      <PrimaryButton
        title={t(lang, tab === 'signin' ? 'auth.sign_in' : 'auth.create_account')}
        onPress={onSubmit}
        loading={loading}
      />,
    );
    return () => setSheetFooter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, email, password, loading, lang, pendingConfirmEmail]);

  if (pendingConfirmEmail) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Text style={styles.title}>{t(lang, 'auth.confirm_title')}</Text>
        <Text style={styles.subtitle}>{t(lang, 'auth.confirm_text', { email: pendingConfirmEmail })}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.tabRow}>
        <Pressable style={[styles.tab, tab === 'signin' && styles.tabActive]} onPress={() => switchTab('signin')}>
          <Text style={[styles.tabText, tab === 'signin' && styles.tabTextActive]}>{t(lang, 'auth.sign_in')}</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'signup' && styles.tabActive]} onPress={() => switchTab('signup')}>
          <Text style={[styles.tabText, tab === 'signup' && styles.tabTextActive]}>{t(lang, 'auth.create_account')}</Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t(lang, 'auth.email_label')}</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={(v) => { setEmail(v); clearAuthError(); }}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
          placeholderTextColor={colors.textDim}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t(lang, 'auth.password_label')}</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={(v) => { setPassword(v); clearAuthError(); }}
          secureTextEntry
          textContentType={tab === 'signin' ? 'password' : 'newPassword'}
          placeholderTextColor={colors.textDim}
        />
      </View>

      {authError ? <Text style={styles.error}>{t(lang, authError)}</Text> : null}
      {offerSignup ? <Text style={styles.hint}>{t(lang, 'auth.no_account')}</Text> : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: fontSize.sm },
  tabRow: { flexDirection: 'row', backgroundColor: colors.panel2, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.tabActiveBg },
  tabText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  // См. комментарий у modeTextActive в CalendarScreen.js — тот же принцип.
  tabTextActive: { color: colors.text },
  field: { gap: spacing.xs },
  label: { color: colors.textDim, fontSize: fontSize.xs },
  input: {
    backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm },
  hint: { color: colors.textDim, fontSize: fontSize.sm },
});

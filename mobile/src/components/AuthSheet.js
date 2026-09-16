import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { setSheetFooter, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Тот же четырёхцветный логотип, что в src/renderer/index.html — своя
// раскраска, не монохромная как у остальных иконок (Icon.js), поэтому не
// через общий компонент, а отдельным SVG прямо тут.
function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.8 2.73v2.27h2.92c1.71-1.57 2.68-3.88 2.68-6.64z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
      <Path fill="#FBBC05" d="M3.97 10.7c-.18-.54-.28-1.11-.28-1.7s.1-1.16.28-1.7V4.96H.96A8.996 8.996 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.34z" />
      <Path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </Svg>
  );
}

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
  const [googleLoading, setGoogleLoading] = useState(false);
  const [offerSignup, setOfferSignup] = useState(false);
  const { authError, pendingConfirmEmail, signIn, signUp, signInWithGoogle, clearAuthError } = useAuthStore();

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

  async function onGooglePress() {
    setGoogleLoading(true);
    clearAuthError();
    const result = await signInWithGoogle();
    setGoogleLoading(false);
    if (result.ok) closeSheet();
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
      <Pressable style={styles.googleBtn} onPress={onGooglePress} disabled={googleLoading}>
        <GoogleIcon />
        <Text style={styles.googleBtnText}>{t(lang, 'auth.google_btn')}</Text>
      </Pressable>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t(lang, 'auth.or_divider')}</Text>
        <View style={styles.dividerLine} />
      </View>

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
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  googleBtnText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: { color: colors.textDim, fontSize: fontSize.xs, textTransform: 'uppercase' },
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

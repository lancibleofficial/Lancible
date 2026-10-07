import { useState } from 'react';
import { View, Pressable, StyleSheet, KeyboardAvoidingView, ScrollView, Platform, Switch } from 'react-native';
import Text from '../../components/AppText';
import TextInput from '../../components/AppTextInput';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../lib/i18n';
import { openLegal } from '../../lib/legalLinks';
import Legal from '../../core/legal.js';
import PrimaryButton from '../../components/PrimaryButton';
import { useColors, spacing, radius, fontSize, displayFamily } from '../../theme';

const USE_CASES = [
  { value: 'personal', key: 'auth.usecase_personal' },
  { value: 'freelance', key: 'auth.usecase_freelance' },
  { value: 'team', key: 'auth.usecase_team' },
  { value: 'other', key: 'auth.usecase_other' },
];

/** Шаг после входа. Новый аккаунт: имя и назначение (оба необязательны) и
 *  согласие. consentOnly — профиль уже есть, но принятая редакция документов
 *  старая: только согласие. Дальше — лишь с включённым переключателем
 *  согласия; отказаться можно, выйдя из аккаунта. Тот же шаг, что у
 *  десктопа (openOnboarding в app.js). */
export default function OnboardingScreen({ consentOnly = false }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const LANG = useAppStore((s) => s.settings.lang);
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding);
  const signOut = useAuthStore((s) => s.signOut);

  async function submit(withProfile) {
    if (!agreed) return;
    setLoading(true);
    setError(null);
    const result = await completeOnboarding(name, useCase, { consentOnly, withProfile });
    setLoading(false);
    if (!result.ok) setError(t(LANG, result.errorKey || 'auth.error_generic'));
  }

  // «Мне уже исполнилось 16 лет. Я принимаю {terms} и {privacy}.» —
  // подстановки становятся ссылками на документы.
  const consentText = t(LANG, 'auth.consent_text', { age: Legal.MIN_AGE, terms: '{terms}', privacy: '{privacy}' });
  const termsLabel = t(LANG, 'auth.consent_terms');
  const privacyLabel = t(LANG, 'auth.consent_privacy');
  const plainConsent = consentText.replace('{terms}', termsLabel).replace('{privacy}', privacyLabel);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t(LANG, consentOnly ? 'auth.consent_title' : 'auth.onboarding_title')}</Text>

        {consentOnly ? (
          <Text style={styles.sub}>{t(LANG, 'auth.consent_sub')}</Text>
        ) : (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>{`${t(LANG, 'auth.name_label')} (${t(LANG, 'auth.optional')})`}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholderTextColor={colors.textDim}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>{t(LANG, 'auth.usecase_label')}</Text>
              <View style={styles.pillRow}>
                {USE_CASES.map((uc) => (
                  <Pressable
                    key={uc.value}
                    onPress={() => setUseCase(useCase === uc.value ? null : uc.value)}
                    style={[styles.pill, useCase === uc.value && styles.pillActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: useCase === uc.value }}
                  >
                    <Text style={[styles.pillText, useCase === uc.value && styles.pillTextActive]}>{t(LANG, uc.key)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}

        <View style={styles.consentRow}>
          <Switch
            testID="consent-switch"
            value={agreed}
            onValueChange={setAgreed}
            accessibilityLabel={plainConsent}
            trackColor={{ false: colors.panel2, true: colors.accent }}
            ios_backgroundColor={colors.panel2}
            thumbColor={colors.textOnColor}
          />
          <Text style={styles.consentText} onPress={() => setAgreed(!agreed)}>
            {consentText.split(/(\{terms\}|\{privacy\})/).map((part, i) => {
              if (part === '{terms}') return <Text key={i} style={styles.link} onPress={() => openLegal('terms', LANG)}>{termsLabel}</Text>;
              if (part === '{privacy}') return <Text key={i} style={styles.link} onPress={() => openLegal('privacy', LANG)}>{privacyLabel}</Text>;
              return part;
            })}
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          title={t(LANG, consentOnly ? 'auth.consent_accept' : 'common.continue')}
          onPress={() => submit(true)}
          loading={loading}
          disabled={!agreed}
        />
        {consentOnly ? null : (
          <PrimaryButton variant="ghost" title={t(LANG, 'common.skip')} onPress={() => submit(false)} disabled={!agreed || loading} />
        )}
        <Pressable onPress={signOut} accessibilityRole="button" style={styles.decline}>
          <Text style={styles.declineText}>{t(LANG, 'auth.sign_out')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.xl, fontFamily: displayFamily.bold },
  sub: { color: colors.textDim, fontSize: fontSize.sm, lineHeight: 20 },
  field: { gap: spacing.sm },
  label: { color: colors.textDim, fontSize: fontSize.xs },
  input: {
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    backgroundColor: colors.panel,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pillActive: { backgroundColor: colors.accent },
  pillText: { color: colors.text, fontSize: fontSize.sm },
  pillTextActive: { color: colors.accentText, fontWeight: '700' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  consentText: { flex: 1, color: colors.textDim, fontSize: fontSize.sm, lineHeight: 20 },
  link: { color: colors.accentInk, textDecorationLine: 'underline' },
  error: { color: colors.danger, fontSize: fontSize.sm },
  decline: { alignSelf: 'center', paddingVertical: spacing.sm },
  declineText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
});

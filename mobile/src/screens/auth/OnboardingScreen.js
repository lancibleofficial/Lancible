import { useState } from 'react';
import { View, Pressable, StyleSheet, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import Text from '../../components/AppText';
import TextInput from '../../components/AppTextInput';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { t } from '../../lib/i18n';
import PrimaryButton from '../../components/PrimaryButton';
import { useColors, spacing, radius, fontSize } from '../../theme';

const USE_CASES = [
  { value: 'personal', key: 'auth.usecase_personal' },
  { value: 'freelance', key: 'auth.usecase_freelance' },
  { value: 'team', key: 'auth.usecase_team' },
  { value: 'other', key: 'auth.usecase_other' },
];

export default function OnboardingScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const LANG = useAppStore((s) => s.settings.lang);
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState(null);
  const [loading, setLoading] = useState(false);
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding);

  async function onSubmit() {
    setLoading(true);
    await completeOnboarding(name, useCase);
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t(LANG, 'auth.onboarding_title')}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t(LANG, 'auth.name_label')}</Text>
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
                onPress={() => setUseCase(uc.value)}
                style={[styles.pill, useCase === uc.value && styles.pillActive]}
              >
                <Text style={[styles.pillText, useCase === uc.value && styles.pillTextActive]}>{t(LANG, uc.key)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <PrimaryButton title={t(LANG, 'common.continue')} onPress={onSubmit} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
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
});

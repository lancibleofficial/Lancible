import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import Icon from './Icon';
import ChangePasswordSheet from './ChangePasswordSheet';
import { confirmSheet } from '../lib/dialogs';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { openSheet, closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function ProfileSheet() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const updateName = useAuthStore((s) => s.updateName);
  const signOut = useAuthStore((s) => s.signOut);
  const [name, setName] = useState(user ? user.name || '' : '');

  function onSaveName() {
    const trimmed = name.trim();
    confirmSheet({
      message: t(lang, 'profile.change_name_confirm', { name: trimmed || user.email }),
      actions: [
        {
          label: t(lang, 'common.save'),
          onPress: async () => {
            const result = await updateName(trimmed);
            closeSheet();
            if (result.ok) showToast(t(lang, 'profile.name_updated'));
          },
        },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  function onOpenChangePassword() {
    openSheet(<ChangePasswordSheet />);
  }

  function onSignOut() {
    closeSheet();
    signOut();
  }

  useEffect(() => {
    setSheetFooter(
      <PrimaryButton title={t(lang, 'common.save')} onPress={onSaveName} disabled={name.trim() === (user?.name || '')} />,
    );
    return () => setSheetFooter(null);
  }, [name, lang, user]);

  if (!user) return null;

  return (
    <View style={styles.content}>
      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user.name || user.email || '?')[0].toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t(lang, 'auth.name_label')}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={t(lang, 'auth.name_label')}
          placeholderTextColor={colors.textDim}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t(lang, 'profile.email_label')}</Text>
        <View style={styles.inputDisabled}>
          <Text style={styles.inputDisabledText} numberOfLines={1}>{user.email}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Pressable style={styles.actionRow} onPress={onOpenChangePassword}>
        <Icon name="lock" size={16} color={colors.textDim} />
        <Text style={styles.actionText}>{t(lang, 'profile.change_password')}</Text>
        <View style={{ flex: 1 }} />
        <Icon name="chevron-right" size={13} color={colors.textDim} />
      </Pressable>

      <Pressable style={styles.actionRow} onPress={onSignOut}>
        <Icon name="logout" size={16} color={colors.danger} />
        <Text style={[styles.actionText, { color: colors.danger }]}>{t(lang, 'auth.sign_out')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  avatarRow: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.xs },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: fontSize.xl, fontWeight: '800' },
  field: { gap: spacing.sm },
  label: { color: colors.textDim, fontSize: fontSize.xs },
  input: {
    backgroundColor: colors.panel2, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  inputDisabled: {
    backgroundColor: colors.panel2, borderRadius: radius.md, opacity: 0.6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  inputDisabledText: { color: colors.textDim, fontSize: fontSize.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  actionText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
});

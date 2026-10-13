// Профиль: имя, почта, пароль, выход и удаление аккаунта — одним листом.
//
// Собран из общих кирпичей (12 октября 2026): имя — поле под подписью Block;
// почта и «Изменить пароль» — строки острова, как в «Меню»; «Выйти» и
// «Удалить аккаунт» — красные строки своим островом. Всё, что раньше
// открывало лист поверх (смена пароля, подтверждения), — страницы этого же
// листа со стрелкой «назад»: лист в приложении один, и открытый поверх
// закрывал бы собой этот.
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import ActionSheetContent from './ActionSheetContent';
import ChangePasswordSheet from './ChangePasswordSheet';
import SheetPage, { usePageMotion } from './SheetPage';
import { RowGroup, SettingRow } from './Island';
import { Block } from './RepeatControls';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Заголовки страниц; у формы заголовка нет — её открывает аватар.
const PAGE_TITLE = { password: 'profile.change_password', name: 'auth.name_label', delete: 'account.delete_title' };

export default function ProfileSheet() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const updateName = useAuthStore((s) => s.updateName);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [name, setName] = useState(user ? user.name || '' : '');
  // Страница: 'main' — форма; 'password', 'name' (подтверждение имени),
  // 'delete' (подтверждение удаления).
  const [page, setPage] = useState('main');
  const motion = usePageMotion(page === 'main' ? 0 : 1);
  const back = () => setPage('main');
  useSheetHeader(page === 'main' ? null : t(lang, PAGE_TITLE[page]), page === 'main' ? null : back);

  function onSignOut() {
    closeSheet();
    signOut();
  }

  useEffect(() => {
    if (page !== 'main') return undefined;
    const footer = <PrimaryButton title={t(lang, 'common.save')} onPress={() => setPage('name')} disabled={name.trim() === (user?.name || '')} />;
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [page, name, lang, user]);

  if (!user) return null;

  if (page === 'password') {
    return (
      <SheetPage key="password" motion={motion}>
        <ChangePasswordSheet embedded />
      </SheetPage>
    );
  }

  if (page === 'name') {
    const trimmed = name.trim();
    return (
      <SheetPage key="name" motion={motion}>
        <ActionSheetContent
          embedded
          message={t(lang, 'profile.change_name_confirm', { name: trimmed || user.email })}
          onCancel={back}
          actions={[
            {
              label: t(lang, 'common.save'),
              onPress: async () => {
                const result = await updateName(trimmed);
                if (result.ok) showToast(t(lang, 'profile.name_updated'));
              },
            },
            { label: t(lang, 'common.cancel'), cancel: true },
          ]}
        />
      </SheetPage>
    );
  }

  // Удаление — только после подтверждения: действие необратимое, а случайный
  // тап по нижней строке листа — обычное дело.
  if (page === 'delete') {
    return (
      <SheetPage key="delete" motion={motion}>
        <ActionSheetContent
          embedded
          message={t(lang, 'account.delete_confirm')}
          onCancel={back}
          actions={[
            {
              label: t(lang, 'account.delete'),
              destructive: true,
              onPress: async () => {
                const result = await deleteAccount();
                if (result.ok) showToast(t(lang, 'account.deleted_toast'));
                // Картинки стереть не вышло — аккаунт цел, и сказать надо именно это.
                else if (result.reason === 'assets') showToast(t(lang, 'account.delete_assets_error'));
                else showToast(t(lang, 'account.delete_error'));
              },
            },
            { label: t(lang, 'common.cancel'), cancel: true },
          ]}
        />
      </SheetPage>
    );
  }

  return (
    <SheetPage key="main" motion={motion} style={styles.content}>
      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user.name || user.email || '?')[0].toUpperCase()}</Text>
        </View>
      </View>

      <Block label={t(lang, 'auth.name_label')}>
        <Field
          value={name}
          onChangeText={setName}
          placeholder={t(lang, 'auth.name_label')}
        />
      </Block>

      <RowGroup testID="profile-account">
        <SettingRow icon="account" label={t(lang, 'profile.email_label')} value={user.email} testID="profile-email" />
        <SettingRow icon="lock" label={t(lang, 'profile.change_password')} onPress={() => setPage('password')} testID="profile-password" />
      </RowGroup>

      <RowGroup testID="profile-exit">
        <SettingRow icon="logout" danger label={t(lang, 'auth.sign_out')} onPress={onSignOut} chevron={false} testID="profile-sign-out" />
        <SettingRow icon="trash" danger label={t(lang, 'account.delete')} onPress={() => setPage('delete')} chevron={false} testID="profile-delete" />
      </RowGroup>
    </SheetPage>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  avatarRow: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.xs },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: fontSize.xl, fontWeight: '800' },
});

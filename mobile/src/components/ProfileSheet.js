// Лист имени аккаунта (круг 21, 19 октября 2026) — как на вебе: в разделе
// «Аккаунт» строка «Имя › Аня» открывает лист с одним полем и «Сохранить».
// Раньше здесь был весь профиль (аватар, почта, пароль, выход, удаление); всё
// это теперь строками разделов: пароль, синхронизация и «Выйти» — в «Аккаунте»,
// почта — в списке аккаунтов над ними, «Удалить аккаунт» — в «Данных», и оно
// открывает этот же лист на подтверждении (page="delete").
//
// Подтверждения смены имени нет, как и на вебе: имя ничего не ломает, а
// неудачное поправят тем же полем.
import { useEffect, useState } from 'react';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import ActionSheetContent from './ActionSheetContent';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { t } from '../lib/i18n';

const TITLE = { name: 'profile.name_label', delete: 'account.delete_title' };

/** @param page 'name' — поле имени; 'delete' — подтверждение «Удалить
 *  аккаунт» из раздела «Данные». */
export default function ProfileSheet({ page = 'name' } = {}) {
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const updateName = useAuthStore((s) => s.updateName);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [name, setName] = useState(user ? user.name || '' : '');
  const [saving, setSaving] = useState(false);
  useSheetHeader(t(lang, TITLE[page] || TITLE.name));

  const unchanged = name.trim() === ((user && user.name) || '');
  async function save() {
    if (unchanged || saving) return;
    setSaving(true);
    const result = await updateName(name.trim());
    setSaving(false);
    showToast(t(lang, result && result.ok ? 'profile.name_updated' : 'profile.update_failed'));
    if (result && result.ok) closeSheet();
  }

  useEffect(() => {
    if (page !== 'name') return undefined;
    const footer = <PrimaryButton title={t(lang, 'common.save')} onPress={save} disabled={unchanged} loading={saving} />;
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [page, name, saving, lang, user]);

  if (!user) return null;

  // Удаление — только после подтверждения: действие необратимое.
  if (page === 'delete') {
    return (
      <ActionSheetContent
        message={t(lang, 'account.delete_confirm')}
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
    );
  }

  return (
    <Field
      value={name}
      onChangeText={setName}
      placeholder={t(lang, 'profile.name_label')}
      accessibilityLabel={t(lang, 'profile.name_label')}
      autoFocus
      returnKeyType="done"
      onSubmitEditing={save}
      testID="profile-name"
    />
  );
}

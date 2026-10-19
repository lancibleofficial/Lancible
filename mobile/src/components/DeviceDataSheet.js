// «Удалить данные аккаунта с устройства» — раздел «Данные» (17 октября 2026).
//
// «Выйти» убирает аккаунт из списка, а его копию на телефоне не трогает;
// стереть её — здесь. Список — аккаунты, чьи данные лежат на телефоне (и те,
// из которых уже вышли: подпись помнит lib/accounts.js), выбор — страница
// подтверждения этого же листа со стрелкой «назад». Один такой аккаунт —
// лист сразу на подтверждении. Облако данных не трогается; сеанс аккаунта
// отзывается на сервере, как у веба (store/useAuthStore.js: forgetDeviceData,
// lib/auth.js: revokeAccountSession); открытый аккаунт после удаления
// сменяется следующим или гостем.
import { useState } from 'react';
import ChoiceList from './ChoiceList';
import ActionSheetContent from './ActionSheetContent';
import SheetPage, { usePageMotion } from './SheetPage';
import { Block } from './RepeatControls';
import { useAuthStore, useDeviceScopes } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, useSheetHeader } from '../store/useSheetStore';
import { labelEntry, accountColor } from '../lib/accounts';
import Accounts from '../core/accounts.js';
import { t } from '../lib/i18n';

/** @param uid сразу на подтверждении для этого аккаунта */
export default function DeviceDataSheet({ uid: initialUid = null } = {}) {
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const accounts = useAuthStore((s) => s.accounts);
  const current = useAuthStore((s) => s.current);
  const scopes = useDeviceScopes();
  const forget = useAuthStore((s) => s.forgetDeviceData);
  const [direct] = useState(() => initialUid || (scopes.length === 1 ? scopes[0] : null));
  const [uid, setUid] = useState(direct);
  const motion = usePageMotion(uid ? 1 : 0);
  // Подпись: имя, иначе почта; аккаунт, о котором не помним ничего, — «Аккаунт без входа».
  const nameOf = (entry) => Accounts.accountLabel(entry, () => t(lang, 'accounts.signed_out_account'));
  const back = direct ? null : () => setUid(null);
  useSheetHeader(t(lang, uid ? 'accounts.forget_title' : 'accounts.forget'), uid ? back : null);

  if (uid) {
    const name = nameOf(labelEntry(accounts, uid));
    const message = [
      t(lang, 'accounts.forget_confirm', { name }),
      uid === current ? t(lang, 'accounts.forget_current') : null,
    ].filter(Boolean).join(' ');
    return (
      <SheetPage key="confirm" motion={motion}>
        <ActionSheetContent
          embedded
          message={message}
          onCancel={back || closeSheet}
          actions={[
            {
              label: t(lang, 'common.delete'),
              destructive: true,
              onPress: async () => {
                const result = await forget(uid);
                if (result.ok) showToast(t(lang, 'accounts.forgot_toast'));
              },
            },
            { label: t(lang, 'common.cancel'), cancel: true },
          ]}
        />
      </SheetPage>
    );
  }

  return (
    <SheetPage key="pick" motion={motion}>
      <Block label={t(lang, 'accounts.device_group')}>
        <ChoiceList
          testID="device-data-list"
          options={scopes.map((id) => {
            const entry = labelEntry(accounts, id);
            return {
              value: id,
              label: nameOf(entry),
              note: id === current ? t(lang, 'accounts.current') : (entry.name ? entry.email : ''),
              color: accountColor(id),
              testID: `device-data-${id}`,
            };
          })}
          onSelect={setUid}
        />
      </Block>
    </SheetPage>
  );
}

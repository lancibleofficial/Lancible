// Обновление приложения: проверка при заходе в «Меню» и установка по
// нажатию. Одно на плашку в «Меню» и строку в «О приложении».
//
// Android: качаем APK прямо здесь и отдаём системному установщику. iOS
// такого не позволяет — там остаётся переход по ссылке.
//
// Не вышло — говорим, что именно, и даём выбрать. Раньше экран молча
// открывал страницу релиза, и поломка самого обновления с 1.1.1 по 1.2.0
// выглядела как «так задумано».
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { checkForUpdate, downloadAndInstall } from '../lib/updateCheck';
import { confirmSheet } from '../lib/dialogs';
import { t } from '../lib/i18n';

/** { update, updating, progress, install } — update null, пока нечего ставить. */
export function useAppUpdate(lang) {
  const [update, setUpdate] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then((result) => { if (!cancelled && result && result.available) setUpdate(result); });
    return () => { cancelled = true; };
  }, []);

  async function install() {
    if (!update) return;
    if (!update.canInstall) { Linking.openURL(update.url); return; }
    setUpdating(true);
    setProgress(0);
    const res = await downloadAndInstall(update, setProgress);
    setUpdating(false);
    if (res.ok) return;
    const why = {
      download: t(lang, 'settings.update_error_download'),
      size: t(lang, 'settings.update_error_size'),
      install: t(lang, 'settings.update_error_install'),
    };
    confirmSheet({
      title: t(lang, 'settings.update_failed'),
      message: why[res.reason] || why.download,
      actions: [
        { label: t(lang, 'settings.update_retry'), onPress: install },
        { label: t(lang, 'settings.update_in_browser'), onPress: () => Linking.openURL(update.url) },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  return { update, updating, progress, install };
}

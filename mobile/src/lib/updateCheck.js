// Проверка новой версии для сайдлоуд-APK (не через Google Play, у которого
// это было бы бесплатно из коробки). GitHub-репозиторий с исходниками
// приватный, так что сам APK не может спросить его Releases API без токена
// (а зашивать токен с доступом к приватному репо в публично раздаваемый
// APK нельзя — вытаскивается декомпиляцией). Вместо этого опрашивается
// отдельный МАЛЕНЬКИЙ публичный репозиторий-манифест с одним JSON-файлом,
// который обновляется вручную при каждом релизе APK.
import Constants from 'expo-constants';

const MANIFEST_URL = 'https://raw.githubusercontent.com/lancibleofficial/lancible-updates/main/latest.json';
const FALLBACK_RELEASES_URL = 'https://github.com/lancibleofficial/Lancible/releases/latest';

function isNewer(remote, local) {
  const r = String(remote).split('.').map(Number);
  const l = String(local).split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

/** {available, version, url} — available:false также при любой сетевой
 * ошибке или отсутствии манифеста, чтобы это никогда не ломало Settings. */
export async function checkForUpdate() {
  try {
    const res = await fetch(MANIFEST_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { available: false };
    const data = await res.json();
    const entry = data && data.android;
    if (!entry || !entry.version) return { available: false };
    const currentVersion = (Constants.expoConfig && Constants.expoConfig.version) || '0.0.0';
    if (!isNewer(entry.version, currentVersion)) return { available: false };
    return { available: true, version: entry.version, url: entry.url || FALLBACK_RELEASES_URL };
  } catch {
    return { available: false };
  }
}

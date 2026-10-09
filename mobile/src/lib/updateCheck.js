// Проверка, скачивание и установка новой версии для сайдлоуд-сборки (не через
// сторы, у которых это было бы бесплатно из коробки).
//
// Версия берётся не из Releases API, а из отдельного маленького публичного
// репозитория-манифеста с одним JSON-файлом. Причина не в доступе (репозиторий
// с исходниками публичный), а в том, что релизы у проекта общие для всех
// платформ: тег «последнего» релиза почти всегда десктопный, и мобильному
// приложению пришлось бы перебирать список в поисках тега mobile-*. Манифест
// же прямо называет актуальную версию каждой платформы; обновляется вручную
// при каждом релизе.
//
// Форма манифеста:
//   { "android": { "version": "1.1.0", "url": "<страница релиза>",
//                  "apk": "<прямая ссылка на .apk>",
//                  "size": <размер .apk в байтах, необязательно> },
//     "ios":     { "version": "1.1.0", "url": "<TestFlight или App Store>" } }
//
// Про iOS. Поставить обновление «прямо из приложения» там невозможно в
// принципе: система разрешает установку только через App Store и TestFlight,
// сторонний установщик заблокирован на уровне ОС. Поэтому для iOS доступен
// только переход по ссылке — это не упрощение, а единственный существующий
// путь. На Android установщик системный, и туда файл передать можно.
import { Platform } from 'react-native';
// Только классы File и Paths. Функции из корня пакета (deleteAsync,
// createDownloadResumable, getContentUriAsync…) с SDK 54 бросают ошибку на
// вызове — на них обновление и не работало с 1.1.1 по 1.2.0.
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';

const MANIFEST_URL = 'https://raw.githubusercontent.com/lancibleofficial/lancible-updates/main/latest.json';
// Общий список релизов, а НЕ /releases/latest: последний релиз — десктопный,
// APK в нём нет, и пользователь попадал бы на страницу без нужного файла.
const FALLBACK_RELEASES_URL = 'https://github.com/lancibleofficial/Lancible/releases';

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

export function currentVersion() {
  return (Constants.expoConfig && Constants.expoConfig.version) || '0.0.0';
}

/** {available, version, url, apk, canInstall} — available:false также при любой
 *  сетевой ошибке или отсутствии манифеста, чтобы это никогда не ломало
 *  Settings. canInstall говорит, можно ли поставить обновление, не выходя из
 *  приложения: на Android — да, если в манифесте есть ссылка на .apk. */
export async function checkForUpdate() {
  try {
    const res = await fetch(MANIFEST_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { available: false };
    const data = await res.json();
    const entry = data && data[Platform.OS];
    if (!entry || !entry.version) return { available: false };
    if (!isNewer(entry.version, currentVersion())) return { available: false };
    return {
      available: true,
      version: entry.version,
      url: entry.url || FALLBACK_RELEASES_URL,
      apk: entry.apk || null,
      size: Number(entry.size) || null,
      canInstall: Platform.OS === 'android' && !!entry.apk,
    };
  } catch {
    return { available: false };
  }
}

/**
 * Скачивает APK во временную папку приложения и отдаёт его системному
 * установщику. onProgress(0..1) вызывается по мере скачивания.
 *
 * Возвращает {ok} либо {ok:false, reason}, где reason — что именно не вышло:
 *   download — файл не скачался (нет сети, ответ сервера не 2xx);
 *   size     — скачался не целиком: меньше, чем обещали манифест или сервер;
 *   install  — система не открыла установщик.
 * Установку дальше ведёт система: она сама покажет запрос на разрешение
 * «ставить из этого источника», если пользователь его ещё не давал, и сама
 * спросит подтверждение. Подменить этот экран приложение не может и не должно.
 */
export async function downloadAndInstall(update, onProgress) {
  if (Platform.OS !== 'android' || !update || !update.apk) return { ok: false, reason: 'unsupported' };
  const file = new File(Paths.cache, `Lancible-${update.version}.apk`);
  // Сколько байт обещал сервер (Content-Length); -1 — не сказал. Берётся
  // наибольшее: закончив, DownloadTask сам шлёт последний прогресс с
  // totalBytes = размер файла, и у недокачанного он меньше обещанного.
  let announced = -1;
  try {
    // Остаток прошлой попытки мог остаться битым — качаем заново.
    if (file.exists) file.delete();
    const task = File.createDownloadTask(update.apk, file, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        announced = Math.max(announced, totalBytes);
        if (onProgress && totalBytes > 0) onProgress(bytesWritten / totalBytes);
      },
    });
    // Ответ не 2xx здесь бросает («HTTP 404»), а не ложится в файл
    // страницей ошибки.
    if (!(await task.downloadAsync())) return { ok: false, reason: 'download' };
  } catch (err) {
    console.warn('Не удалось скачать обновление:', err);
    return { ok: false, reason: 'download' };
  }

  // Недокачанный APK установщик отвергнет с невнятным «Приложение не
  // установлено» — лучше остановиться здесь и сказать, что случилось.
  // Манифест знает размер точно, сервер — по Content-Length; если не знает
  // никто, отсекается хотя бы пустой файл.
  const expected = update.size || (announced > 0 ? announced : 0);
  if (file.size === 0 || (expected && file.size !== expected)) {
    console.warn(`Обновление скачалось не целиком: ${file.size} байт из ${expected || '?'}`);
    try { file.delete(); } catch { /* не удалилось — перезапишется следующей попыткой */ }
    return { ok: false, reason: 'size' };
  }

  try {
    // Системному установщику нельзя передать file:// — начиная с Android 7
    // это падает с FileUriExposedException. Нужен content:// через
    // FileProvider, который expo-file-system выдаёт сам.
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: file.contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION — без него установщик не прочитает файл
    });
    return { ok: true };
  } catch (err) {
    console.warn('Не удалось открыть установщик:', err);
    return { ok: false, reason: 'install' };
  }
}

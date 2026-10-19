// Системный выбор файла на телефоне — один на всё: фото редактора и формы
// обратной связи (lib/photoPicker.js: pickImageFile), PDF редактора
// (lib/editorPdf.js: pickPdf) и «Файл» у агента (lib/aiAttach.js). Это
// File.pickFileAsync из expo-file-system: модуль входит в Expo Go
// (документация SDK 57) и грузится на старте и так — файлы читает он же.
//
// 20 октября 2026: PDF и «Файл» шли через expo-document-picker, импортом
// верхнего уровня. В Expo Go на iPhone его нативного модуля не оказалось, и
// падал весь запуск: «Cannot find native module 'ExpoDocumentPicker'». Пакет
// убран из зависимостей; что он не вернётся и что необязательные нативные
// модули грузятся по требованию — стережёт tests/unit/mobile-native-modules.test.js.
//
// Копия. На iOS выбор отдаёт временную копию файла (file://), оригинал не
// трогает — копию после чтения удаляют (pickedCopy). На Android — адрес
// content:// на сам файл человека: право читать его выдал выбор, удалять его
// нельзя. Копии там и не нужно: в Expo Go копия в кеш ложилась мимо папок,
// разрешённых expo-file-system («Missing 'READ' permission», эмулятор,
// 17 октября 2026).
import { Platform } from 'react-native';
import { File } from 'expo-file-system';

/** Один файл из системного выбора. mimeTypes — строка или список
 *  ('image/*', ['application/pdf', 'text/plain']). null — человек передумал;
 *  иначе сам файл expo-file-system: uri, name, type, size, base64().
 *  @returns {Promise<File | null>} */
export async function pickFile(mimeTypes) {
  const res = await File.pickFileAsync({ mimeTypes });
  if (!res || res.canceled) return null;
  // Прежняя форма ответа — сам файл (или их список), новая — { result, canceled }.
  const picked = res.result !== undefined ? res.result : res;
  const file = Array.isArray(picked) ? picked[0] : picked;
  return file && file.uri ? file : null;
}

/** Адрес копии, которую сделал выбор (iOS, file://), — её удаляют после
 *  чтения. null — копии нет: на Android адрес ведёт на сам файл человека. */
export function pickedCopy(file) {
  const uri = file && file.uri ? String(file.uri) : '';
  return Platform.OS === 'ios' && /^file:/i.test(uri) ? uri : null;
}

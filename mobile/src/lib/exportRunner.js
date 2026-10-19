// Сохранение + шеринг xlsx-файла на устройстве. Порт runExport() из
// src/renderer/app.js:2772-2778 — там это window.api.exportXlsx (Electron
// save-dialog), здесь нативного "сохранить как" на мобильном нет: пишем во
// временную папку приложения и сразу открываем системный лист "Поделиться"
// (Sharing.shareAsync) — оттуда можно сохранить в Файлы/Диск/отправить куда
// угодно, это и есть мобильный эквивалент диалога сохранения.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { buildWorkbook } from './xlsx';
import { t } from './i18n';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sanitizeFileName(name) {
  return (name || 'export').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120);
}

export async function runExport(defaultName, sheets, langCode, showToast) {
  try {
    const bytes = buildWorkbook(sheets);
    const file = new File(Paths.cache, `${sanitizeFileName(defaultName)}.xlsx`);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME, dialogTitle: t(langCode, 'export.share_title') });
    }
    showToast(t(langCode, 'toast.file_saved'));
  } catch (err) {
    console.error('Не удалось экспортировать в Excel:', err);
    showToast(t(langCode, 'toast.export_failed'));
  }
}

/** Текст документа файлом — тот же лист «Поделиться», что у Excel: заметка
 *  или документ из редактора в Markdown (кнопка «Экспорт» панели редактора) и
 *  то, что редактор отдаёт сам (сообщение export, lib/editorBridge.js). */
export async function shareTextFile(name, mime, text, langCode, showToast) {
  const title = t(langCode, 'editor.share_title');
  try {
    const file = new File(Paths.cache, sanitizeFileName(name));
    if (file.exists) file.delete();
    file.create();
    file.write(text || '');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: mime || 'text/plain', dialogTitle: title });
    }
  } catch (err) {
    console.error('Не удалось отдать файл:', err);
    if (showToast) showToast(t(langCode, 'toast.export_failed'));
  }
}

/** Двоичный файл из редактора — байтами base64 (без префикса data:), тем же
 *  листом «Поделиться»: «Сохранить как PDF» (export kind pdf, протокол 3).
 *  Оттуда — в «Файлы», на диск, в почту. */
export async function shareBase64File(name, mime, base64, langCode, showToast) {
  const type = mime || 'application/octet-stream';
  try {
    const file = new File(Paths.cache, sanitizeFileName(name));
    if (file.exists) file.delete();
    file.create();
    file.write(String(base64 || ''), { encoding: 'base64' });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: type,
        dialogTitle: t(langCode, 'editor.share_file_title'),
        ...(type === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : null),
      });
    }
  } catch (err) {
    console.error('Не удалось отдать файл:', err);
    if (showToast) showToast(t(langCode, 'toast.export_failed'));
  }
}

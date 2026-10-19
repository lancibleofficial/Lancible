// Системный выбор файла (src/lib/filePicker.js). Запуск: npm run test:mobile (из корня)
//
// Один выбор на телефон — File.pickFileAsync из expo-file-system: фото
// редактора и обратной связи, PDF редактора, «Файл» у агента. До 20 октября
// 2026 PDF и «Файл» шли через expo-document-picker, и в Expo Go на iPhone без
// его нативного модуля падал весь запуск. Нативный модуль подменён:
// проверяется, что у него просят и как разбирается ответ — обе его формы.
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { pickFile, pickedCopy } from '../src/lib/filePicker';
import { PDF_TYPES } from '../src/lib/editorPdf';
import { ATTACH_FILE_TYPES } from '../src/lib/aiAttach';

jest.mock('expo-file-system', () => ({ File: { pickFileAsync: jest.fn() } }));

const fileOf = (uri, extra) => ({ uri, name: 'a.pdf', type: 'application/pdf', size: 10, base64: jest.fn(async () => 'JVBE'), ...extra });

beforeEach(() => File.pickFileAsync.mockReset());

test('типы уходят выбору как есть: PDF редактора, «Файл» агента — PDF и текст, фото — image/*', async () => {
  File.pickFileAsync.mockResolvedValue({ canceled: true, result: null });
  await pickFile(PDF_TYPES);
  await pickFile(ATTACH_FILE_TYPES);
  await pickFile('image/*');
  expect(File.pickFileAsync.mock.calls).toEqual([
    [{ mimeTypes: ['application/pdf'] }],
    [{ mimeTypes: ATTACH_FILE_TYPES }],
    [{ mimeTypes: 'image/*' }],
  ]);
  // «Файл» — только PDF и текст: ни Word, ни Excel, ни «всё подряд».
  expect([...ATTACH_FILE_TYPES].sort()).toEqual(['application/pdf', 'text/comma-separated-values', 'text/csv', 'text/markdown', 'text/plain', 'text/x-markdown']);
});

test('передумали — null (и в новой форме ответа, и пустой ответ)', async () => {
  File.pickFileAsync.mockResolvedValueOnce({ canceled: true, result: null });
  expect(await pickFile(PDF_TYPES)).toBeNull();
  File.pickFileAsync.mockResolvedValueOnce(null);
  expect(await pickFile(PDF_TYPES)).toBeNull();
  File.pickFileAsync.mockResolvedValueOnce({ canceled: false, result: [] });
  expect(await pickFile(PDF_TYPES)).toBeNull();
});

test('новая форма { canceled, result } — сам файл; список — первый', async () => {
  const one = fileOf('file:///tmp/Inbox/a.pdf');
  File.pickFileAsync.mockResolvedValueOnce({ canceled: false, result: one });
  expect(await pickFile(PDF_TYPES)).toBe(one);
  const two = [fileOf('file:///tmp/Inbox/b.pdf'), fileOf('file:///tmp/Inbox/c.pdf')];
  File.pickFileAsync.mockResolvedValueOnce({ canceled: false, result: two });
  expect(await pickFile(PDF_TYPES)).toBe(two[0]);
});

test('прежняя форма — сам файл или их список; файл без адреса — как отмена', async () => {
  const one = fileOf('content://docs/a.pdf');
  File.pickFileAsync.mockResolvedValueOnce(one);
  expect(await pickFile(PDF_TYPES)).toBe(one);
  const list = [fileOf('content://docs/b.pdf')];
  File.pickFileAsync.mockResolvedValueOnce(list);
  expect(await pickFile(PDF_TYPES)).toBe(list[0]);
  File.pickFileAsync.mockResolvedValueOnce({ canceled: false, result: { name: 'x.pdf' } });
  expect(await pickFile(PDF_TYPES)).toBeNull();
});

test('копия выбора: на iOS file:// удаляют после чтения; на Android content:// — сам файл человека', () => {
  expect(Platform.OS).toBe('ios');
  expect(pickedCopy(fileOf('file:///tmp/com.lancible.app-Inbox/a.pdf'))).toBe('file:///tmp/com.lancible.app-Inbox/a.pdf');
  expect(pickedCopy(null)).toBeNull();
  expect(pickedCopy({})).toBeNull();
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    expect(pickedCopy(fileOf('content://com.android.providers.downloads.documents/document/42'))).toBeNull();
    expect(pickedCopy(fileOf('file:///storage/emulated/0/Download/a.pdf'))).toBeNull();
  } finally {
    os.restore();
  }
});

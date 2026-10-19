// PDF в редакторе на телефоне (17 октября 2026, протокол 3 — src/editor/host.js,
// DESIGN.md «Редактор на телефоне: протокол»). Сторона телефона:
//
// - выбор файла: редактор шлёт pdf-pick, телефон открывает системный выбор
//   файла (lib/filePicker.js, File.pickFileAsync — только application/pdf),
//   читает байты (expo-file-system) и отдаёт странице base64 (pdf-file). Больше
//   PDF_MAX_BYTES — отказ с кодом PDF_TOO_BIG до чтения: строка base64 на
//   сотню мегабайт уронила бы мост, а редактор всё равно взял бы не больше
//   20 МБ (src/editor/pdf.js: PDF_MAX_MB);
// - PDF-модуль: pdf.js, pdf-lib и шрифт (3 МБ) в строку редактора
//   (editorBundle.js) не входят — сборка кладёт их ассетом
//   mobile/assets/editor-pdf.txt (scripts/build-editor.js). Редактор просит
//   модуль сообщением pdf-module; телефон читает ассет (expo-asset — и в
//   Expo Go с Metro, и из APK без сети) и впрыскивает его в WebView одной
//   строкой (pdfModuleScript). Строка сама исполняет модуль и сама отвечает
//   редактору pdf-module-ready — после модуля, а не «где-то рядом», — и
//   телефону pdf-module-loaded (впрыскивать ли в следующий раз);
// - «Сохранить как PDF» (export kind pdf) — lib/exportRunner.js: shareBase64File.
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { inline } from './editorBridge';
import { pickFile, pickedCopy } from './filePicker';

/** Наибольший PDF — как у редактора (src/editor/pdf.js: PDF_MAX_MB). */
export const PDF_MAX_MB = 20;
export const PDF_MAX_BYTES = PDF_MAX_MB * 1024 * 1024;
/** Код отказа: файл больше PDF_MAX_BYTES. */
export const PDF_TOO_BIG = 'pdf_too_big';

const tooBig = (bytes) => Object.assign(new Error('pdf too big'), { code: PDF_TOO_BIG, bytes });
const drop = (file) => { try { if (file && file.exists) file.delete(); } catch { /* кеш почистит система */ } };

/** Что предлагает выбор: только PDF. */
export const PDF_TYPES = ['application/pdf'];

/** Выбрать PDF. null — передумали. Больше PDF_MAX_BYTES — отказ (code
 *  PDF_TOO_BIG), не читая файл. Копия выбора (iOS) после чтения удаляется;
 *  на Android копии нет — и удалять нечего: адрес ведёт на сам файл человека
 *  (lib/filePicker.js: pickedCopy).
 *  @returns {Promise<{ name: string, base64: string } | null>} */
export async function pickPdf() {
  const file = await pickFile(PDF_TYPES);
  if (!file) return null;
  const copy = pickedCopy(file);
  try {
    const size = Number(file.size) || 0;
    if (size > PDF_MAX_BYTES) throw tooBig(size);
    const base64 = await file.base64();
    return { name: file.name || 'document.pdf', base64 };
  } finally {
    if (copy) drop(file);
  }
}

/** Ассет модуля: require — здесь, а не наверху файла, чтобы его знал только
 *  этот путь (Metro всё равно берёт ассет в сборку: путь в require строкой). */
function moduleAsset() {
  return require('../../assets/editor-pdf.txt');
}

/** Текст PDF-модуля из ассета. */
export async function loadPdfModuleText() {
  const asset = Asset.fromModule(moduleAsset());
  if (!asset.localUri) await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error('editor-pdf.txt: нет адреса ассета');
  const text = await new File(uri).text();
  if (!text) throw new Error('editor-pdf.txt пуст');
  return text;
}

/** Строка для WebView.injectJavaScript: исполнить модуль в глобальной
 *  области (непрямой eval — синтаксическая ошибка ловится, а не обрывает
 *  строку без ответа) и ответить редактору (window.__ed, DocEditor) и
 *  телефону. */
export function pdfModuleScript(text) {
  return `(function(){var err=null;
try{(0,eval)(${inline(String(text))});}catch(e){err=String((e&&e.message)||e);}
var ok=!err&&!!window.LancibleEditorPdf;
try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'pdf-module-loaded',ok:ok,error:err}));}catch(e){}
try{if(window.__ed)window.__ed.receive(err?{type:'pdf-module-ready',error:err}:{type:'pdf-module-ready'});}catch(e){}
})();true;`;
}

// PDF-модуль отдельным файлом: точка входа второй сборки
// scripts/build-editor.js → src/renderer/editor-pdf.js (глобал
// window.LancibleEditorPdf). В нём pdf.js — чтение PDF (импорт страниц и
// текста, src/editor/pdf.js) — и с 17 октября 2026 pdf-lib с fontkit и
// шрифтом Onest — запись PDF («Сохранить как PDF», src/editor/pdfwrite.js).
//
// Почему отдельно (17 октября 2026). Внутри editor.js pdf.js с воркером
// весил 1,7 МБ, а pdf-lib с fontkit — ещё больше мегабайта; их получали бы
// все, кто открывает заметку, и телефон, где PDF пока нет вовсе. Теперь
// редактор грузит этот файл тегом <script> рядом с собой при первом PDF
// (src/editor/pdf.js: loadPdfJs), а в сборку телефона он не попадает.
//
// Воркер — в том же файле и в том же потоке: модуль pdf.worker при загрузке
// ставит globalThis.pdfjsWorker, и pdf.js берёт его вместо отдельного Worker
// (fake worker). Поэтому он импортируется первым. Ни файла воркера, ни blob:
// в CSP (script-src 'self') не нужно. Сборка legacy: в обычной есть
// Map.prototype.getOrInsert и Math.sumPrecise, которых нет в Chromium 130
// (Electron 33).
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';

export { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
export { writePdf } from './pdfwrite.js';

// Настройки Metro для телефона — те же, что у Expo по умолчанию, плюс одно:
// ассеты .txt. PDF-модуль редактора (pdf.js, pdf-lib, шрифт; 3 МБ) лежит
// текстом в assets/editor-pdf.txt (кладёт scripts/build-editor.js) и
// впрыскивается в WebView по запросу (src/lib/editorPdf.js) — в бандл JS он
// не входит, иначе каждый запуск приложения разбирал бы лишние 3 МБ.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('txt')) config.resolver.assetExts.push('txt');

module.exports = config;

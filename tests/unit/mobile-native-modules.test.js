// Телефон и нативные модули на старте. Запуск: npm run test:unit
//
// Откуда взялось. 20 октября 2026 приложение в Expo Go на iPhone падало на
// старте целиком: «Cannot find native module 'ExpoDocumentPicker'». Пакет
// expo-document-picker (выбор PDF редактора и «Файла» у агента) был
// подключён импортом верхнего уровня, и отсутствие одного необязательного
// модуля роняло весь запуск — хотя документация SDK 57 пишет о нём
// «Included in Expo Go». Выбор файла с тех пор — File.pickFileAsync из
// expo-file-system (mobile/src/lib/filePicker.js), пакет из телефона убран.
//
// Правило на все исходники телефона разом:
// - expo-document-picker нет нигде: ни в коде, ни в зависимостях, ни в
//   плагинах app.json;
// - импортом верхнего уровня — только пакеты из списка ниже. Нативные в нём —
//   те, что грузятся на старте и в Expo Go того iPhone уже были (модули
//   исполняются в порядке импортов, и до ExpoDocumentPicker они загрузились),
//   либо сами переносят отсутствие нативной части (requireOptionalNativeModule,
//   пустая заглушка на iOS). Необязательные (OPTIONAL) — только внутри
//   действия, require по требованию: нет модуля — отказ действия, а не
//   запуска (mobile/tests/nativeOptional.test.js).
//
// Новый пакет наверху файла — тест красный: сверь страницу пакета в
// документации Expo v57 (https://docs.expo.dev/versions/v57.0.0/) и решай —
// обязательный и есть в Expo Go — в TOP_LEVEL; необязательный — в OPTIONAL и
// require внутри действия.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MOBILE = path.join(__dirname, '..', '..', 'mobile');
const read = (p) => fs.readFileSync(path.join(MOBILE, p), 'utf8');

/** Можно импортом верхнего уровня. */
const TOP_LEVEL = new Set([
  // Чистый JS.
  'react', 'zustand', '@supabase/supabase-js', 'react-native-url-polyfill',
  '@react-navigation/native', '@react-navigation/native-stack', '@react-navigation/bottom-tabs',
  // Каркас: без них приложения нет.
  'react-native', 'expo', 'react-native-reanimated', 'react-native-gesture-handler',
  'react-native-safe-area-context', 'react-native-svg', 'react-native-webview',
  '@react-native-async-storage/async-storage',
  'expo-font', 'expo-splash-screen', 'expo-system-ui', 'expo-status-bar', 'expo-asset',
  'expo-file-system', 'expo-sharing',
  // Уведомления — поимённо из build/ (src/lib/notifications.js); локальные в
  // Expo Go есть, на старте грузились.
  'expo-notifications',
  // Сами переносят отсутствие нативной части: requireOptionalNativeModule
  // (haptics, constants), на iOS — пустая заглушка (intent-launcher).
  'expo-haptics', 'expo-constants', 'expo-intent-launcher',
]);

/** Необязательные: только по требованию, внутри действия. */
const OPTIONAL = new Set([
  'expo-clipboard', // «Копировать» в редакторе — hooks/useEditorSession.js: copyText
  'expo-image-manipulator', // перекодировка фото — lib/photoPicker.js: withScaledImage
  'expo-web-browser', // вход через Google — lib/auth.js: signInWithGoogle
  'expo-linking', // он же
  'expo-glass-effect', // стекло iOS 26 — components/Glass.js
  'react-native-keyboard-controller', // кадры клавиатуры — lib/keyboard.js
]);

const BANNED = 'expo-document-picker';

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [...sources(path.join(MOBILE, 'src')), path.join(MOBILE, 'App.js'), path.join(MOBILE, 'index.js')];
const rel = (file) => path.relative(MOBILE, file).replace(/\\/g, '/');
const pkgOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
/** Импорты верхнего уровня: import … from 'x', import 'x', export … from 'x'. */
const topImports = (src) => [...src.matchAll(/^\s*(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+[^'";]*?\s+from\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const requires = (src) => [...src.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

test('expo-document-picker в телефоне нет: ни в коде, ни в зависимостях, ни в плагинах', () => {
  const used = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of [...topImports(src), ...requires(src)]) if (pkgOf(spec) === BANNED) used.push(rel(file));
  }
  assert.deepEqual(used, [], 'выбор файла — lib/filePicker.js (File.pickFileAsync из expo-file-system)');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!(pkg.dependencies || {})[BANNED] && !(pkg.devDependencies || {})[BANNED], `${BANNED} в mobile/package.json`);
  const lock = JSON.parse(read('package-lock.json'));
  assert.ok(!lock.packages[`node_modules/${BANNED}`], `${BANNED} в mobile/package-lock.json`);
  const plugins = (JSON.parse(read('app.json')).expo.plugins || []).map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(!plugins.includes(BANNED), `${BANNED} в плагинах mobile/app.json`);
});

test('импортом верхнего уровня — только пакеты из списка; необязательные — по требованию', () => {
  const optionalOnTop = [];
  const unknown = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of topImports(src)) {
      if (spec.startsWith('.')) continue;
      const pkg = pkgOf(spec);
      if (OPTIONAL.has(pkg)) optionalOnTop.push(`${rel(file)}: ${spec}`);
      else if (!TOP_LEVEL.has(pkg)) unknown.push(`${rel(file)}: ${spec}`);
    }
  }
  assert.deepEqual(optionalOnTop, [], 'необязательный нативный модуль импортом верхнего уровня: без него в Expo Go упадёт весь запуск — require внутри действия');
  assert.deepEqual(unknown, [], 'новый пакет наверху файла: сверь с документацией Expo v57 и внеси в TOP_LEVEL или OPTIONAL');
});

test('необязательные действительно в ходу — по требованию, и стоят в зависимостях', () => {
  const pkg = JSON.parse(read('package.json'));
  const lazy = new Set();
  for (const file of files) for (const spec of requires(fs.readFileSync(file, 'utf8'))) lazy.add(pkgOf(spec));
  for (const name of OPTIONAL) {
    assert.ok(lazy.has(name), `${name} в OPTIONAL, но require('${name}') нигде нет — убери из списка`);
    assert.ok((pkg.dependencies || {})[name], `${name} не стоит в mobile/package.json`);
  }
});

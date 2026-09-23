// Собирает web/ из общих исходников перед деплоем на Vercel (Build Command
// в web/package.json). Копирует общий с десктопом код (app.js/styles.css/
// xlsx.js) и вендорные библиотеки (Quill, Supabase UMD — из web/node_modules,
// куда их кладёт обычный `npm install` внутри web/, т.к. Root Directory на
// Vercel — web/, и корневой node_modules там недоступен) + закоммиченные
// шрифты Basique Pro. web/index.html, web/api-shim.js, web/responsive.css —
// пишутся руками и не трогаются этим скриптом.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'web');
const webNodeModules = path.join(webDir, 'node_modules');
const vendorDest = path.join(webDir, 'vendor');
const fontDest = path.join(vendorDest, 'fonts');

try {
  fs.mkdirSync(fontDest, { recursive: true });

  // Общий код с десктопом — буквально те же файлы.
  fs.copyFileSync(path.join(root, 'src', 'renderer', 'app.js'), path.join(webDir, 'app.js'));
  fs.copyFileSync(path.join(root, 'src', 'renderer', 'styles.css'), path.join(webDir, 'styles.css'));
  fs.copyFileSync(path.join(root, 'src', 'xlsx.js'), path.join(webDir, 'xlsx.js'));

  // Чистая логика из src/renderer/core — те же файлы, что тестируются в Node.
  // Копируется вся папка целиком, чтобы новый модуль не пришлось дописывать
  // сюда отдельной строкой и не забыть.
  const coreSrc = path.join(root, 'src', 'renderer', 'core');
  const coreDest = path.join(webDir, 'core');
  fs.mkdirSync(coreDest, { recursive: true });
  for (const name of fs.readdirSync(coreSrc)) {
    fs.copyFileSync(path.join(coreSrc, name), path.join(coreDest, name));
  }

  // Quill + Supabase UMD — из web/node_modules (свои зависимости в web/package.json).
  fs.copyFileSync(
    path.join(webNodeModules, 'quill', 'dist', 'quill.js'),
    path.join(vendorDest, 'quill.js'),
  );
  fs.copyFileSync(
    path.join(webNodeModules, 'quill', 'dist', 'quill.snow.css'),
    path.join(vendorDest, 'quill.snow.css'),
  );
  fs.copyFileSync(
    path.join(webNodeModules, '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
    path.join(vendorDest, 'supabase.js'),
  );

  // Шрифты — закоммиченные .woff2 в assets/fonts (не локальная папка font/,
  // которой на Vercel/у контрибьюторов может не быть). Берём папку целиком:
  // добавили начертание — оно уезжает в веб само, править список не нужно.
  const fontSrc = path.join(root, 'assets', 'fonts');
  for (const name of fs.readdirSync(fontSrc).filter((n) => n.endsWith('.woff2'))) {
    fs.copyFileSync(path.join(fontSrc, name), path.join(fontDest, name));
  }

  console.log('[sync-web-assets] app.js/styles.css/xlsx.js/core/vendor скопированы в', webDir);
} catch (err) {
  console.error('[sync-web-assets] Ошибка синхронизации:', err.message);
  process.exitCode = 1;
}

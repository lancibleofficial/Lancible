// Копирует внешние ассеты (Quill, шрифт Basique Pro) в src/renderer/vendor,
// чтобы рендерер грузил всё из своей папки — и в dev, и в собранном .exe.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'src', 'renderer', 'vendor');
const fontDest = path.join(dest, 'fonts');

// [источник, назначение]
const quill = [
  [path.join(root, 'node_modules', 'quill', 'dist', 'quill.js'), 'quill.js'],
  [path.join(root, 'node_modules', 'quill', 'dist', 'quill.snow.css'), 'quill.snow.css'],
  // UMD-сборка supabase-js — рендерер грузит её как обычный <script> (contextIsolation
  // не даёт require() из node_modules напрямую), даёт глобальный window.supabase.createClient().
  [path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'), 'supabase.js'],
];

// Basique Pro: Basique_4=Thin(100) 3=Light(300) 2=Regular(400) 1=Bold(700) (без Black) → берём woff2.
const fonts = [
  ['Basique_3.woff2', 'Basique-Light.woff2'],
  ['Basique_2.woff2', 'Basique-Regular.woff2'],
  ['Basique_1.woff2', 'Basique-Bold.woff2'],
  ['Basique.woff2', 'Basique-Black.woff2'],
];

try {
  fs.mkdirSync(fontDest, { recursive: true });

  for (const [from, name] of quill) {
    fs.copyFileSync(from, path.join(dest, name));
  }

  const fontSrc = path.join(root, 'font');
  if (fs.existsSync(fontSrc)) {
    for (const [from, name] of fonts) {
      const p = path.join(fontSrc, from);
      if (fs.existsSync(p)) fs.copyFileSync(p, path.join(fontDest, name));
    }
    console.log('[copy-vendor] Quill + шрифт Basique Pro скопированы в', dest);
  } else {
    console.warn('[copy-vendor] Папка font/ не найдена — шрифт не скопирован, интерфейс на системном шрифте.');
  }
} catch (err) {
  console.error('[copy-vendor] Ошибка копирования:', err.message);
  process.exitCode = 1;
}

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

// Имена в личной папке font/ свои: Basique_4=Thin(100) 3=Light(300)
// 2=Regular(400) 1=Bold(700), Basique=Black(900). Gravity туда кладётся
// в .otf, и её .woff2 берутся только из assets/fonts.
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
  const committedFonts = path.join(root, 'assets', 'fonts'); // .woff2 в гите — есть всегда
  // Сначала закоммиченные .woff2 целиком: они покрывают и Basique, и Gravity.
  let copied = 0;
  if (fs.existsSync(committedFonts)) {
    for (const name of fs.readdirSync(committedFonts).filter((n) => n.endsWith('.woff2'))) {
      fs.copyFileSync(path.join(committedFonts, name), path.join(fontDest, name));
      copied += 1;
    }
  }
  // Поверх — личная папка font/, если она есть: там исходники Basique Pro
  // под своими именами, и они главнее копии в гите.
  if (fs.existsSync(fontSrc)) {
    for (const [from, name] of fonts) {
      const p = path.join(fontSrc, from);
      if (fs.existsSync(p)) fs.copyFileSync(p, path.join(fontDest, name));
    }
  }
  if (copied) {
    console.log(`[copy-vendor] Quill + шрифты (${copied} начертаний) скопированы в`, dest);
  } else {
    console.warn('[copy-vendor] Шрифты не найдены — интерфейс на системном шрифте.');
  }
} catch (err) {
  console.error('[copy-vendor] Ошибка копирования:', err.message);
  process.exitCode = 1;
}

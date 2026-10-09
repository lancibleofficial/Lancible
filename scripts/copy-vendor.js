// Копирует внешние ассеты (Supabase, шрифты Onest и Basique Pro для логотипа) в src/renderer/vendor,
// чтобы рендерер грузил всё из своей папки — и в dev, и в собранном .exe.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'src', 'renderer', 'vendor');
const fontDest = path.join(dest, 'fonts');

// [источник, назначение]
// Редактор текста собирается отдельно (scripts/build-editor.js) и лежит рядом
// с app.js, а не здесь.
const vendor = [
  // UMD-сборка supabase-js — рендерер грузит её как обычный <script> (contextIsolation
  // не даёт require() из node_modules напрямую), даёт глобальный window.supabase.createClient().
  [path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'), 'supabase.js'],
];

// Имена в личной папке font/ свои: Basique_1 — Bold(700). С 9 октября 2026
// Basique Pro нужен только логотипу, остальное набрано Onest. Onest в
// font/ нет — его .woff2 берутся только из assets/fonts.
const fonts = [
  ['Basique_1.woff2', 'Basique-Bold.woff2'],
];

try {
  fs.mkdirSync(fontDest, { recursive: true });

  for (const [from, name] of vendor) {
    fs.copyFileSync(from, path.join(dest, name));
  }

  const fontSrc = path.join(root, 'font');
  const committedFonts = path.join(root, 'assets', 'fonts'); // .woff2 в гите — есть всегда
  // Сначала закоммиченные .woff2 целиком: они покрывают и Basique, и Onest.
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
    console.log(`[copy-vendor] Supabase + шрифты (${copied} начертаний) скопированы в`, dest);
  } else {
    console.warn('[copy-vendor] Шрифты не найдены — интерфейс на системном шрифте.');
  }
} catch (err) {
  console.error('[copy-vendor] Ошибка копирования:', err.message);
  process.exitCode = 1;
}

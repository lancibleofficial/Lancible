// Копирует внешние ассеты (Supabase, шрифт Onest) в src/renderer/vendor,
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

try {
  // Шрифты — точное зеркало assets/fonts: папку очищаем, иначе убранное
  // начертание оставалось бы в vendor/ и уезжало в установщик десктопа.
  // Так 10 октября 2026 ушёл Basique Pro (лицензии на него нет): логотип
  // теперь набран Onest, как и всё остальное.
  fs.rmSync(fontDest, { recursive: true, force: true });
  fs.mkdirSync(fontDest, { recursive: true });

  for (const [from, name] of vendor) {
    fs.copyFileSync(from, path.join(dest, name));
  }

  const committedFonts = path.join(root, 'assets', 'fonts'); // .woff2 в гите — есть всегда
  let copied = 0;
  if (fs.existsSync(committedFonts)) {
    for (const name of fs.readdirSync(committedFonts).filter((n) => n.endsWith('.woff2'))) {
      fs.copyFileSync(path.join(committedFonts, name), path.join(fontDest, name));
      copied += 1;
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

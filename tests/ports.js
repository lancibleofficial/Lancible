// Порты для браузерных прогонов. Вынесены отдельно, чтобы конфигурация
// Playwright и сами тесты брали одно и то же число, а не держали его в двух
// местах.
//
// Почему у каждой копии свои. С 10 октября 2026 над проектом работают
// несколько сессий, каждая в своей копии репозитория (E:\lancible\<папка>,
// git worktree). Пока порты были прибиты числами (5199/5198), все копии
// поднимали сервер на одном и том же порту — и прогон из одной копии,
// застав чужой сервер, молча проверял чужой код. Теперь порты вычисляются от
// пути копии: у разных папок разные порты, у одной папки — всегда одни и те
// же.
//
// Почему пар две. Сторож (npm run watch) гоняет те же наборы в фоне, и если
// он и ручной прогон делят порт, они мешают друг другу: Playwright поднимает
// сервер сам и гасит его, закончив, — прямо из-под соседнего прогона. Поэтому
// сторож ставит LANCIBLE_TEST_PORTS=watch и работает на своей паре.
//
// Почему не 5173/5174: на них живут npm run serve:web и serve:landing.
// Диапазон 20000–35999 выбран в стороне от них, от Metro (8081) и от портов,
// которые Windows держит за собой (5357, 50000–50059 на этой машине).
//
// Совпало у двух копий (так бывает, вариантов 4000) — LANCIBLE_TEST_PORT_BASE
// задаёт начало вручную. Какие порты у копии, печатает
// `node tests/ports.js`.
const path = require('node:path');

const FIRST = 20000;
const SLOTS = 4000; // по четыре порта на копию: 20000 … 35999

/** Путь копии в одном написании: на Windows регистр букв и вид слэшей не
 *  меняют папку, а значит не должны менять и порты.
 *
 *  Путь с буквой диска разбирается правилами Windows (path.win32) на любой
 *  платформе. Иначе на Linux path.resolve('E:\\lancible\\qa-web') считает его
 *  относительным, приклеивает к текущей папке — и тот же путь даёт там
 *  другие порты (так и упал CI 10 октября 2026). */
function normalizeRoot(root) {
  const windowsPath = process.platform === 'win32' || /^[a-z]:[\\/]/i.test(root);
  const abs = (windowsPath ? path.win32.resolve(root) : path.posix.resolve(root))
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return windowsPath ? abs.toLowerCase() : abs;
}

/** FNV-1a: короткий, без зависимостей и одинаковый на любой машине. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const ch of Buffer.from(text, 'utf8')) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Четыре порта копии: пара для ручного прогона и пара для сторожа. */
function portsFor(root, { base } = {}) {
  const start = base != null ? Number(base) : FIRST + (fnv1a(normalizeRoot(root)) % SLOTS) * 4;
  return {
    run: { PORT_WEB: start, PORT_LANDING: start + 1 },
    watch: { PORT_WEB: start + 2, PORT_LANDING: start + 3 },
  };
}

const ROOT = path.join(__dirname, '..');
const mine = portsFor(ROOT, { base: process.env.LANCIBLE_TEST_PORT_BASE || undefined });
const current = process.env.LANCIBLE_TEST_PORTS === 'watch' ? mine.watch : mine.run;

module.exports = { ...current, ROOT, portsFor, normalizeRoot, FIRST, SLOTS };

if (require.main === module) {
  console.log(`${ROOT}\n  прогон: web ${mine.run.PORT_WEB}, landing ${mine.run.PORT_LANDING}\n  сторож: web ${mine.watch.PORT_WEB}, landing ${mine.watch.PORT_LANDING}`);
}

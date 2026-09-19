// Минимальный статический сервер для локальной разработки/проверки — без
// сторонних зависимостей (в духе остального проекта). Запуск:
// node scripts/serve-web.js [порт] [--root <папка>]
//
// По умолчанию раздаёт web/; --root landing позволяет тем же сервером
// посмотреть лендинг, не поднимая второй.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const rootDir = rootArg !== -1 ? args[rootArg + 1] : 'web';
const root = path.join(__dirname, '..', rootDir);
const port = Number(args.find((a) => /^\d+$/.test(a))) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http
  .createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    // Адрес без расширения отдаём как .html — так же, как это делает Vercel
    // по rewrite'у: /logs должен открываться локально ровно как на сайте.
    if (!path.extname(reqPath) && fs.existsSync(path.join(root, reqPath + '.html'))) reqPath += '.html';
    const filePath = path.join(root, reqPath);
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found: ' + reqPath); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`[serve-web] http://localhost:${port}`));

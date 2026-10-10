// Сервер под тестом отдаёт веб именно этой копии. Запуск: npm run test:e2e
//
// Копий репозитория несколько, и прогон, заставший на порту чужой сервер,
// раньше молча проверял чужой код. Порты теперь у каждой копии свои
// (tests/ports.js), но последняя проверка — по содержимому: файлы, которые
// отдаёт сервер, совпадают с файлами этой папки байт в байт.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');

for (const file of ['index.html', 'app.js', 'styles.css']) {
  test(`сервер отдаёт web/${file} этой копии`, async ({ request }) => {
    const res = await request.get(`/${file}`);
    expect(res.status()).toBe(200);
    const served = await res.body();
    const local = fs.readFileSync(path.join(WEB, file));
    expect(served.equals(local), `web/${file} на сервере не тот, что в ${WEB} — чужой сервер или web/ не пересобран`).toBe(true);
  });
}

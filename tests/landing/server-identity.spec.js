// Сервер под тестом отдаёт лендинг именно этой копии. Запуск: npm run test:landing
//
// То же, что tests/e2e/server-identity.spec.js, для лендинга: файлы на
// сервере совпадают с файлами этой папки байт в байт.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const LANDING = path.join(__dirname, '..', '..', 'landing');

for (const file of ['index.html', 'landing.css']) {
  test(`сервер отдаёт landing/${file} этой копии`, async ({ request }) => {
    const res = await request.get(`/${file}`);
    expect(res.status()).toBe(200);
    const served = await res.body();
    const local = fs.readFileSync(path.join(LANDING, file));
    expect(served.equals(local), `landing/${file} на сервере не тот, что в ${LANDING} — чужой сервер`).toBe(true);
  });
}

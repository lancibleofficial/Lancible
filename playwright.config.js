// Браузерные тесты. Запуск: npm run test:e2e (веб), npm run test:landing
// (лендинг), npm run test:visual (снимки с эталоном) — или playwright test
// целиком.
//
// Почему настоящий браузер, а не подделка DOM: приложение целиком про DOM —
// фокус, хранилище вкладки, перерисовка списков. Подделка всё это имитирует,
// и тест остаётся зелёным там, где продукт сломан.
//
// Три набора, три папки, три сервера-источника:
//   tests/e2e/     — веб-версия приложения (web/), поведение и данные
//   tests/landing/ — лендинг (landing/), отрисованная шапка/подвал и размеры
//   tests/visual/  — снимки обоих с эталоном, см. tests/visual/shot.js
const { defineConfig, devices } = require('@playwright/test');
const { PORT_WEB, PORT_LANDING } = require('./tests/ports');

module.exports = defineConfig({
  // Гонять параллельно нельзя: у вкладок общее хранилище на один адрес, и
  // тесты начнут видеть проекты друг друга.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'web',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT_WEB}` },
    },
    {
      name: 'landing',
      testDir: './tests/landing',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT_LANDING}` },
    },
    {
      name: 'visual',
      testDir: './tests/visual',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT_LANDING}` },
    },
  ],
  // Серверы поднимаются сами — тест не должен зависеть от того, что кто-то
  // заранее запустил npm run serve:web.
  webServer: [
    {
      // Веб собирается перед каждым прогоном — см. tests/serve-built-web.js.
      command: `node tests/serve-built-web.js ${PORT_WEB}`,
      url: `http://localhost:${PORT_WEB}/index.html`,
      reuseExistingServer: !process.env.CI,
      // Сборка — секунда, но в свежей копии сначала ставятся web/node_modules.
      timeout: 180_000,
    },
    {
      command: `node scripts/serve-web.js ${PORT_LANDING} --root landing`,
      url: `http://localhost:${PORT_LANDING}/index.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});

// Браузерные тесты веб-версии. Запуск: npm run test:e2e
//
// Почему настоящий браузер, а не подделка DOM: приложение целиком про DOM —
// фокус, хранилище вкладки, перерисовка списков. Подделка всё это имитирует,
// и тест остаётся зелёным там, где продукт сломан.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 5199; // не 5173: тесты не должны драться за порт с открытым превью

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Гонять параллельно нельзя: у вкладок общее хранилище на один адрес, и
  // тесты начнут видеть проекты друг друга.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Сервер поднимается сам — тест не должен зависеть от того, что кто-то
  // заранее запустил npm run serve:web.
  webServer: {
    command: `node scripts/serve-web.js ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

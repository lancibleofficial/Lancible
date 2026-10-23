// Порт админки для браузерных прогонов (проект admin в playwright.config.js).
//
// Пара портов копии (tests/ports.js) занята вебом и лендингом, а соседние
// числа — портами других копий. Поэтому у админки свой ряд: 36000 + 2 × номер
// копии (прогон) и следующий (сторож), 36000–43999 — в стороне и от ряда
// копий (20000–35999), и от портов, которые держит Windows (50000–50059).
// Начало, заданное руками (LANCIBLE_TEST_PORT_BASE), — его +4 и +5.
const { portsFor, ROOT, FIRST } = require('../ports');

const ADMIN_FIRST = 36000;

function adminPortsFor(root, { base } = {}) {
  if (base != null) return { run: Number(base) + 4, watch: Number(base) + 5 };
  const { run } = portsFor(root);
  const slot = Math.floor((run.PORT_WEB - FIRST) / 4);
  return { run: ADMIN_FIRST + slot * 2, watch: ADMIN_FIRST + slot * 2 + 1 };
}

const mine = adminPortsFor(ROOT, { base: process.env.LANCIBLE_TEST_PORT_BASE || undefined });
const PORT_ADMIN = process.env.LANCIBLE_TEST_PORTS === 'watch' ? mine.watch : mine.run;

module.exports = { PORT_ADMIN, adminPortsFor, ADMIN_FIRST };

if (require.main === module) console.log(`админка: прогон ${mine.run}, сторож ${mine.watch}`);

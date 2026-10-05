// Пересоздать эталоны снимков для этой системы. Запуск:
// npm run test:visual:update
//
// Зачем отдельный скрипт, а не флаг в npm-строке. Режим «сейчас мы заводим
// эталоны» должен быть явным, и отличать его надо не по умолчаниям
// Playwright. Первая попытка опиралась на config.updateSnapshots: мол, если
// он не 'none', значит эталоны создают. Оказалось, что по умолчанию он
// 'missing' — то есть «пиши недостающие и считай тест упавшим», — и на
// GitHub все 22 снимка не пропустились, а записались и покраснели.
//
// Переменная окружения такой двусмысленности не допускает: она выставлена
// только отсюда. Ставить её прямо в npm-строке нельзя — на Windows запись
// VAR=x команда не работает, а тащить ради этого зависимость не хочется.
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const child = spawn(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', '--project=visual', '--update-snapshots'],
  {
    cwd: ROOT,
    env: { ...process.env, LANCIBLE_SNAPSHOTS: 'update' },
    stdio: 'inherit',
  },
);

child.on('close', (code) => process.exit(code ?? 1));

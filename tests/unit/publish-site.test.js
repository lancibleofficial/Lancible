// Граф на /graph берёт библиотеку рисования со своего адреса. Запуск: npm run test:unit
//
// Шаблон graphify грузит vis-network с unpkg, а Политика cookie обещает, что
// сторонние сервисы о визите не узнают. scripts/publish-site.js подменяет
// ссылку копией из landing/vendor и не публикует граф, если внешний адрес
// остался. Здесь — что подмена срабатывает на том, что graphify отдаёт на
// самом деле (тег в три строки, с integrity), и что любой другой внешний
// адрес публикацию останавливает.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { localizeVendor, VIS } = require('../../scripts/publish-site.js');

const OWN = `<script src="vendor/${VIS}"></script>`;
const CDN = '<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"\r\n'
  + '        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"\r\n'
  + '        crossorigin="anonymous"></script>';

test('ссылка graphify на unpkg подменяется своей копией без integrity', () => {
  const out = localizeVendor(`<head>\n${CDN}\n</head>\n<script>draw()</script>`);
  assert.equal(out, `<head>\n${OWN}\n</head>\n<script>draw()</script>`);
});

test('любая другая внешняя загрузка останавливает публикацию', () => {
  const tags = [
    '<script src="https://unpkg.com/vis-network@9.2.0/standalone/umd/vis-network.min.js"></script>',
    '<link rel="stylesheet" href="//cdn.example.com/x.css">',
    "<img alt='' src='http://example.com/x.png'>",
    '<iframe src="https://example.com/"></iframe>',
  ];
  for (const tag of tags) {
    assert.throws(() => localizeVendor(`<head>${tag}</head>`), /внешняя загрузка/, tag);
  }
});

test('свои адреса и адреса внутри данных графа публикацию не останавливают', () => {
  const html = `<head>${OWN}<link rel="icon" href="favicon.svg"></head>`
    + '<script>const nodes = [{"label": "<img src=\\"https://example.com/x.png\\">"}];</script>';
  assert.equal(localizeVendor(html), html);
});

test('выложенный граф берёт библиотеку со своего адреса', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'landing', 'graph-view.html'), 'utf8');
  assert.ok(html.includes(OWN), `в landing/graph-view.html нет ${OWN}`);
  assert.doesNotThrow(() => localizeVendor(html));
});

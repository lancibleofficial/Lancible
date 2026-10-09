// Иконки — Solar Bold из одного словаря. Запуск: npm run test:unit
//
// Откуда тест. 9 октября 2026 все иконки — телефон, десктоп, веб, редактор,
// лендинг и нативные панели iOS — переехали на Solar Bold. Раньше у каждой
// поверхности был свой набор путей: в app.js, в двух index.html, в Icon.js
// телефона, в SF Symbols шапки iOS, — и они расходились незаметно. Теперь
// словарь один (src/renderer/core/icons.js, его собирает
// scripts/make-solar-icons.js), и здесь проверяется, что мимо него иконка
// не появится: ни строкой пути в разметке, ни именем, которого нет, ни
// системным символом iOS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ICONS, iconPaths } = require('../../src/renderer/core/icons.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const APP_HTML = ['src/renderer/index.html', 'web/index.html'];
const LANDING_HTML = fs.readdirSync(path.join(ROOT, 'landing')).filter((f) => f.endsWith('.html')).map((f) => `landing/${f}`);

/** Все <svg …>…</svg> файла: атрибуты открывающего тега и содержимое. */
const svgsOf = (src) => [...src.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)].map((m) => ({ attrs: m[1], inner: m[2] }));

/** Файлы .js внутри папки, кроме сборок и копий ядра. */
function jsFiles(dir, skip) {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${f}`;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { if (!skip.includes(f)) out.push(...jsFiles(rel, skip)); } else if (f.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('словарь: у каждой иконки рамка и хотя бы один путь', () => {
  assert.ok(Object.keys(ICONS).length > 40);
  for (const [name, ic] of Object.entries(ICONS)) {
    assert.match(ic.vb, /^[\d.]+ [\d.]+ [\d.]+ [\d.]+$/, `${name}: рамка`);
    assert.ok(ic.p.length > 0 && ic.p.every(([d]) => /^M/.test(d)), `${name}: пути`);
  }
});

test('каждый <svg data-icon> в HTML — из словаря и с его путями', () => {
  // Пути в разметку вписывает генератор. Поменяли словарь и не запустили —
  // HTML показывал бы старую иконку.
  for (const rel of [...APP_HTML, ...LANDING_HTML]) {
    for (const { attrs, inner } of svgsOf(read(rel))) {
      const name = (attrs.match(/data-icon="([^"]+)"/) || [])[1];
      if (!name) continue;
      assert.ok(ICONS[name], `${rel}: иконки ${name} нет в словаре`);
      assert.equal(inner, iconPaths(name), `${rel}: ${name} устарела — node scripts/make-solar-icons.js`);
      assert.ok(attrs.includes(`viewBox="${ICONS[name].vb}"`), `${rel}: у ${name} старая рамка`);
    }
  }
});

test('в разметке приложения нет иконок мимо словаря', () => {
  // Исключения — знаки брендов: логотип Lancible (и фавикон data:-адресом)
  // и цветная «G» Google.
  for (const rel of APP_HTML) {
    for (const { attrs, inner } of svgsOf(read(rel))) {
      if (/data-icon=|tb-logo-mark|%22/.test(attrs) || /fill="#[0-9A-Fa-f]{3,6}"/.test(inner)) continue;
      assert.fail(`${rel}: <svg${attrs.slice(0, 60)}…> без data-icon — возьмите иконку из словаря`);
    }
  }
});

test('app.js рисует иконки только через icon(), и все имена есть в словаре', () => {
  const src = read('src/renderer/app.js');
  assert.doesNotMatch(src, /viewBox=/, 'в app.js строка <svg> с путями — замените на icon(имя)');
  const names = [...src.matchAll(/\bicon\('([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 10);
  for (const n of names) assert.ok(ICONS[n], `app.js: icon('${n}') — нет в словаре`);
});

test('телефон: каждое имя иконки есть в словаре', () => {
  const missing = [];
  for (const rel of jsFiles('mobile/src', ['editor', 'core'])) {
    const src = read(rel);
    const found = [
      ...[...src.matchAll(/(?:<Icon\b[^>]*?\bname=|\bicon=|\bicon: *)['"]([a-z][a-z0-9-]*)['"]/g)].map((m) => m[1]),
      // имя выражением: name={on ? 'stop' : 'play'}
      ...[...src.matchAll(/(?:<Icon\b[^>]*?\bname|\bicon)=\{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((q) => q[1])),
    ];
    for (const n of found) if (!ICONS[n]) missing.push(`${rel}: ${n}`);
  }
  const tabs = read('mobile/src/navigation/MainTabBar.js').match(/const ICON_NAMES = \{([^}]*)\}/)[1];
  for (const m of tabs.matchAll(/'([a-z-]+)'/g)) if (!ICONS[m[1]]) missing.push(`MainTabBar: ${m[1]}`);
  assert.deepEqual(missing, []);
});

test('iOS: вкладки, кнопки шапки и «назад» — наши картинки, а не SF Symbols', () => {
  for (const rel of jsFiles('mobile/src', ['editor', 'core'])) {
    assert.doesNotMatch(read(rel), /sfSymbol/, `${rel}: SF Symbol — iOS нарисовал бы свою иконку`);
  }
  const header = read('mobile/src/navigation/nativeHeader.js');
  assert.match(header, /headerBackIcon: \{ type: 'image', source: require\('\.\.\/\.\.\/assets\/header\/back\.png'\) \}/, 'системный шеврон «назад»');

  // Каждая картинка, на которую ссылается код, лежит в трёх плотностях.
  const required = [
    ...[...header.matchAll(/require\('\.\.\/\.\.\/(assets\/header\/[a-z-]+)\.png'\)/g)].map((m) => m[1]),
    ...[...read('mobile/src/navigation/MainTabs.ios.js').matchAll(/require\('\.\.\/\.\.\/(assets\/tabs\/[a-z-]+)\.png'\)/g)].map((m) => m[1]),
  ];
  assert.ok(required.length >= 10);
  for (const base of required) {
    for (const k of ['', '@2x', '@3x']) assert.ok(exists(`mobile/${base}${k}.png`), `нет mobile/${base}${k}.png — npx electron scripts/make-ios-icons.js`);
  }

  // Кнопки шапки на iOS 26 уходят в нативную шапку: у каждой должна быть
  // картинка, иначе вместо иконки встанет запасная.
  const images = new Set([...header.match(/HEADER_ICONS = \{([^}]*)\}/)[1].matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]));
  const used = new Set(['bell', 'kebab']); // колокольчик TabHeader и меню проекта
  for (const rel of jsFiles('mobile/src', ['editor', 'core'])) {
    const src = read(rel);
    for (const m of src.matchAll(/<(?:HeaderButton|DetailButton)\b[^>]*?\bicon=(?:"([a-z-]+)"|\{([^}]*)\})/g)) {
      if (m[1]) used.add(m[1]);
      else for (const q of m[2].matchAll(/'([a-z-]+)'/g)) used.add(q[1]);
    }
  }
  for (const n of used) assert.ok(images.has(n), `кнопка шапки «${n}» без картинки в HEADER_ICONS`);
});

test('редактор: всё, что он берёт у Solar, есть в словаре', () => {
  const src = read('src/editor/util.js');
  const block = src.slice(src.indexOf('const SOLAR = {'), src.indexOf('const LUCIDE = {'));
  const names = [...block.matchAll(/: '([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 40);
  for (const n of names) assert.ok(ICONS[n], `редактор: ${n} — нет в словаре`);
});

test('лицензия Solar (CC BY 4.0) названа на странице реквизитов на всех языках', () => {
  const docs = [...read('landing/legal.html').matchAll(/<article class="legal-doc" data-lang="(\w+)"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.ok(docs.length >= 4);
  for (const [, lang, body] of docs) assert.match(body, /Solar Icon Set[\s\S]*CC BY 4\.0/, `/legal (${lang}): нет атрибуции Solar`);
});

// Разбор CSS для тестов: селектор, тело правила и обрамляющий @media.
//
// Полноценный разборщик нам не нужен и не нужен как зависимость: вопросы, на
// которые отвечают тесты, — «одинаковы ли правила шапки на всех страницах» и
// «есть ли у этой модалки своё правило положения». Для них хватает трёх
// полей. Всё, что сложнее (вложенность по стандарту 2023 года, @supports
// внутри @media), в наших стилях не встречается; если встретится — разбор
// просто отдаст его как ещё один уровень в `at`.

/** Правила файла: [{ at, sel, body }]. `at` — цепочка @-правил через « | ». */
function cssRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const atStack = [];
  let buf = '';
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '{') {
      const head = buf.replace(/\s+/g, ' ').trim();
      buf = '';
      if (head.startsWith('@')) { atStack.push(head); i += 1; continue; }
      let depth = 1;
      let j = i + 1;
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth += 1;
        else if (clean[j] === '}') depth -= 1;
        j += 1;
      }
      out.push({
        at: atStack.join(' | '),
        sel: head,
        body: clean.slice(i + 1, j - 1).replace(/\s+/g, ' ').trim(),
      });
      i = j;
      continue;
    }
    if (ch === '}') { atStack.pop(); buf = ''; i += 1; continue; }
    buf += ch;
    i += 1;
  }
  return out;
}

/** Правило целиком одной строкой — удобно сравнивать и показывать в ошибке. */
const ruleText = (r) => `${r.at ? `${r.at} ` : ''}${r.sel} { ${r.body} }`;

/** Объявления правила как пары имя→значение. */
function declarations(body) {
  const out = {};
  for (const part of body.split(';')) {
    const k = part.indexOf(':');
    if (k === -1) continue;
    out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return out;
}

module.exports = { cssRules, ruleText, declarations };

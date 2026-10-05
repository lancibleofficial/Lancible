/* Языки и машинка перевода — без единой строки самого перевода.
 *
 * Почему это отдельный файл, а не часть i18n.js. Словари у десктопа и
 * телефона разные по делу: на десктопе 416 ключей, на телефоне 314, и общих
 * из них 268. Экранов у них разные, и сливать словари в один — значит возить
 * на телефон полторы сотни чужих строк ради видимости единства.
 *
 * А вот машинка была одинаковой слово в слово: translate — пять строк,
 * pluralForm — четырнадцать, вплоть до комментария про общее славянское
 * правило. Две копии правила склонения — ровно тот случай, из-за которого
 * заведено ядро.
 *
 * Поэтому здесь только то, что у платформ общее: карта локалей, названия
 * языков и две функции, которым словарь приходит параметром. Сам словарь
 * остаётся у каждой стороны свой — core/i18n.js у десктопа,
 * mobile/src/lib/i18n.js у телефона.
 */
(function (global) {
  const LOCALE_MAP = { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', kk: 'kk-KZ' };
  const LANG_NAMES = { ru: 'Русский', en: 'English', uk: 'Українська', kk: 'Қазақша' };

  /** Строка по ключу с подстановками. Неизвестный язык и пропущенный
   *  перевод откатываются на русский, а отсутствующий ключ показывает сам
   *  себя: так пропажа видна в интерфейсе, а не превращается в пустоту. */
  function translate(T, lang, key, vars) {
    const dict = T[lang] || T.ru;
    let s = dict[key] !== undefined ? dict[key] : (T.ru[key] !== undefined ? T.ru[key] : key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  }

  /** Правильная форма слова под число и язык. */
  function pluralForm(T, lang, n, baseKey) {
    const forms = (T[lang] && T[lang][baseKey]) || T.ru[baseKey];
    if (lang === 'en') return forms[n === 1 ? 0 : 1];
    if (lang === 'kk') return forms[0];
    // ru / uk — общее славянское правило
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
    return forms[2];
  }

  const api = { LOCALE_MAP, LANG_NAMES, translate, pluralForm };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

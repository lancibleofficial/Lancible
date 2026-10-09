/* Язык лендинга — один на все его страницы.
 *
 * До этого языков было два независимых: правовые документы помнили свой в
 * lancible:legal-lang (и умели ru/en/uk/kk), а лента блога — свой в
 * lancible:blog-lang (ru/en, без автоопределения, по умолчанию русский).
 * Выбрав английский в блоге, человек всё равно получал русскую шапку, а
 * сменив язык документа — русский блог. Теперь ключ один: lancible:lang.
 *
 * Откуда берётся язык, по убыванию старшинства:
 *   1. ?lang= в адресе — по нему приложение открывает документы (core/legal.js);
 *   2. прошлый выбор из lancible:lang, а если его нет — из старых ключей,
 *      чтобы выбор вернувшегося человека не потерялся;
 *   3. язык браузера (navigator.languages), первый из поддерживаемых;
 *   4. английский — как язык по умолчанию для всех остальных локалей.
 *
 * Тексты лежат в landing/strings.js. Нет ключа в нужном языке — берётся
 * английский, потом русский: страница не опустеет из-за недопереведённой
 * строки.
 *
 * Разметка: data-i18n — textContent, data-i18n-aria — aria-label,
 * data-i18n-content — атрибут content (для <meta>).
 */
(function (global) {
  const LANGS = ['ru', 'en', 'uk', 'kk'];
  const KEY = 'lancible:lang';
  const LEGACY_KEYS = ['lancible:legal-lang', 'lancible:blog-lang'];
  const FALLBACK = ['en', 'ru'];

  const readStore = (key) => {
    try { return global.localStorage.getItem(key); } catch { return null; }
  };

  function resolve() {
    const fromUrl = new URLSearchParams(global.location.search).get('lang');
    if (LANGS.includes(fromUrl)) return fromUrl;
    for (const key of [KEY, ...LEGACY_KEYS]) {
      const saved = readStore(key);
      if (LANGS.includes(saved)) return saved;
    }
    const nav = global.navigator || {};
    const list = (nav.languages && nav.languages.length) ? nav.languages : [nav.language];
    for (const entry of list) {
      const code = String(entry || '').toLowerCase().split('-')[0];
      if (LANGS.includes(code)) return code;
    }
    return 'en';
  }

  let lang = resolve();
  const listeners = [];

  /** Текст по ключу: нужный язык, затем английский, затем русский. */
  function t(key, forLang) {
    const dicts = global.LANCIBLE_STRINGS || {};
    for (const code of [forLang || lang, ...FALLBACK]) {
      const dict = dicts[code];
      if (dict && dict[key] !== undefined) return dict[key];
    }
    return '';
  }

  /** Подставляет строки в размеченные элементы. root — чтобы можно было
   *  обработать кусок, построенный скриптом (баннер cookie, карточки блога). */
  function translate(root) {
    const scope = root || global.document;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      const value = t(el.dataset.i18n);
      if (value) el.textContent = value;
    }
    for (const el of scope.querySelectorAll('[data-i18n-aria]')) {
      const value = t(el.dataset.i18nAria);
      if (value) el.setAttribute('aria-label', value);
    }
    for (const el of scope.querySelectorAll('[data-i18n-content]')) {
      const value = t(el.dataset.i18nContent);
      if (value) el.setAttribute('content', value);
    }
  }

  /** Отмечает выбранный язык в каждом переключателе.
   *
   *  В шапке кнопок две — ru и en: UK и KK есть только у правовых документов,
   *  а четыре кнопки не помещаются в бюджет ширины шапки. Но язык сайта может
   *  стать украинским или казахским — по языку браузера или выбором на
   *  правовой странице. Тогда кнопку такого языка добавляем на месте, чтобы
   *  переключатель не стоял с пустым выбором и человек мог вернуться назад.
   */
  function paintSwitches() {
    for (const box of global.document.querySelectorAll('.lang-switch')) {
      const buttons = [...box.querySelectorAll('button[data-lang]')];
      if (buttons.length && !buttons.some((b) => b.dataset.lang === lang)) {
        const btn = global.document.createElement('button');
        btn.type = 'button';
        btn.dataset.lang = lang;
        btn.textContent = lang.toUpperCase();
        btn.addEventListener('click', () => api.set(lang));
        box.append(btn);
        buttons.push(btn);
      }
      for (const btn of buttons) btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
    }
  }

  function apply(save) {
    global.document.documentElement.lang = lang;
    translate();
    paintSwitches();
    if (save) {
      try { global.localStorage.setItem(KEY, lang); } catch { /* не сохранится — не беда */ }
      // Адрес несёт язык дальше: по нему открываются документы и делятся ссылкой.
      const url = new URL(global.location.href);
      url.searchParams.set('lang', lang);
      global.history.replaceState(null, '', url);
    }
    for (const fn of listeners) fn(lang);
    global.document.dispatchEvent(new CustomEvent('lancible:lang', { detail: { lang } }));
  }

  // Локали для Intl и дата в ленте блога: раньше формат лежал отдельно на
  // главной и на странице блога и знал только ru/en.
  const LOCALES = { ru: 'ru-RU', en: 'en-GB', uk: 'uk-UA', kk: 'kk-KZ' };

  function formatDate(iso) {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const text = d.toLocaleDateString(LOCALES[lang] || LOCALES.en, { day: 'numeric', month: 'long', year: 'numeric' });
    // ru и uk дописывают в конце « г.» и « р.» — в ленте этот хвост лишний.
    // В kk пометка «ж.» стоит после года в середине строки и остаётся.
    return text.replace(/\s+(?:г|р)\.$/u, '');
  }

  const api = {
    LANGS,
    KEY,
    get current() { return lang; },
    t,
    translate,
    formatDate,
    /** Подписка на язык: обработчик зовётся сразу и на каждую смену. */
    subscribe(fn) {
      listeners.push(fn);
      if (ready) fn(lang);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    set(next) {
      if (!LANGS.includes(next) || next === lang) return;
      lang = next;
      apply(true);
    },
  };

  let ready = false;
  global.LancibleLang = api;

  global.document.addEventListener('DOMContentLoaded', () => {
    ready = true;
    apply(false);
    for (const btn of global.document.querySelectorAll('.lang-switch button[data-lang]')) {
      btn.addEventListener('click', () => api.set(btn.dataset.lang));
    }
  });
})(window);

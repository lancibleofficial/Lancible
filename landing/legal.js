/* Правовые страницы лендинга: язык документа и реквизиты.
 *
 * Каждая страница несёт все четыре перевода сразу — <article data-lang="ru">,
 * «en», «uk», «kk» — и без скрипта показывает русский. Скрипт выбирает
 * язык (?lang= в адресе → прошлый выбор → язык браузера → ru), прячет
 * остальные переводы, подписывает шапку и меню документов и подставляет
 * реквизиты из landing/business.js.
 *
 * Приложение открывает документы с ?lang= своего языка (core/legal.js), так
 * что человек сразу видит текст на том языке, на котором пользуется
 * Lancible.
 */
(function () {
  const LANGS = ['ru', 'en', 'uk', 'kk'];
  const KEY = 'lancible:legal-lang';

  const UI = {
    ru: {
      eyebrow: 'Правовая информация', switch: 'Язык документа', nav: 'Документы', blank: '[не заполнено]',
      docs: { privacy: 'Конфиденциальность', terms: 'Условия использования', cookies: 'Cookie', refund: 'Возвраты', 'delete-account': 'Удаление аккаунта', legal: 'Реквизиты' },
    },
    en: {
      eyebrow: 'Legal', switch: 'Document language', nav: 'Documents', blank: '[not provided yet]',
      docs: { privacy: 'Privacy', terms: 'Terms of Service', cookies: 'Cookies', refund: 'Refunds', 'delete-account': 'Delete account', legal: 'Business details' },
    },
    uk: {
      eyebrow: 'Правова інформація', switch: 'Мова документа', nav: 'Документи', blank: '[не заповнено]',
      docs: { privacy: 'Конфіденційність', terms: 'Умови використання', cookies: 'Cookie', refund: 'Повернення коштів', 'delete-account': 'Видалення акаунта', legal: 'Реквізити' },
    },
    kk: {
      eyebrow: 'Құқықтық ақпарат', switch: 'Құжат тілі', nav: 'Құжаттар', blank: '[толтырылмаған]',
      docs: { privacy: 'Құпиялылық', terms: 'Пайдалану шарттары', cookies: 'Cookie', refund: 'Қаражатты қайтару', 'delete-account': 'Аккаунтты жою', legal: 'Деректемелер' },
    },
  };

  function initialLang() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(KEY);
      if (LANGS.includes(saved)) return saved;
    } catch { /* хранилище закрыто — не беда */ }
    const nav = (navigator.language || '').slice(0, 2);
    return LANGS.includes(nav) ? nav : 'ru';
  }

  function fillBusiness(root, lang) {
    const biz = window.LANCIBLE_BUSINESS || {};
    for (const el of root.querySelectorAll('[data-biz]')) {
      const value = (biz[el.dataset.biz] || '').trim();
      el.classList.toggle('biz-blank', !value);
      if (el.dataset.biz === 'email' && value) {
        el.innerHTML = '';
        const a = document.createElement('a');
        a.href = `mailto:${value}`;
        a.textContent = value;
        el.appendChild(a);
      } else {
        el.textContent = value || UI[lang].blank;
      }
    }
  }

  function apply(lang, save) {
    const ui = UI[lang];
    let shown = null;
    for (const art of document.querySelectorAll('article[data-lang]')) {
      const on = art.dataset.lang === lang;
      art.hidden = !on;
      if (on) shown = art;
    }
    if (!shown) return;
    document.documentElement.lang = lang;
    if (shown.dataset.title) document.title = shown.dataset.title;
    const h1 = document.querySelector('[data-legal="heading"]');
    if (h1 && shown.dataset.heading) h1.textContent = shown.dataset.heading;
    const eyebrow = document.querySelector('[data-legal="eyebrow"]');
    if (eyebrow) eyebrow.textContent = ui.eyebrow;
    const sw = document.querySelector('.lang-switch');
    if (sw) {
      sw.setAttribute('aria-label', ui.switch);
      for (const b of sw.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    }
    const nav = document.querySelector('.legal-nav');
    if (nav) {
      nav.setAttribute('aria-label', ui.nav);
      for (const a of nav.querySelectorAll('a[data-doc]')) {
        a.textContent = ui.docs[a.dataset.doc];
        a.href = `${a.dataset.doc}.html?lang=${lang}`;
      }
    }
    fillBusiness(shown, lang);
    if (save) {
      try { localStorage.setItem(KEY, lang); } catch { /* не критично */ }
      const url = new URL(location.href);
      url.searchParams.set('lang', lang);
      history.replaceState(null, '', url);
    }
    document.dispatchEvent(new CustomEvent('lancible:lang', { detail: { lang } }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    apply(initialLang(), false);
    for (const b of document.querySelectorAll('.lang-switch button')) {
      b.addEventListener('click', () => apply(b.dataset.lang, true));
    }
  });
})();

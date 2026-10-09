/* Правовые страницы лендинга: перевод документа и реквизиты.
 *
 * Каждая страница несёт все четыре перевода сразу — <article data-lang="ru">,
 * «en», «uk», «kk» — и без скрипта показывает русский. Скрипт прячет лишние,
 * подписывает шапку документа и меню и подставляет реквизиты из
 * landing/business.js.
 *
 * Язык сюда больше не выбирается: он общий для всего сайта и живёт в
 * landing/i18n.js. Раньше у документов был отдельный ключ хранилища, и
 * человек, выбравший английский на главной, всё равно получал русский
 * договор; переносом прошлого выбора занимается i18n.js.
 *
 * Приложение открывает документы с ?lang= своего языка (core/legal.js) —
 * этот адрес читает i18n.js и он по-прежнему старше сохранённого выбора.
 */
(function () {
  const DOCS = ['privacy', 'terms', 'cookies', 'refund', 'delete-account', 'legal'];

  function fillBusiness(root, t) {
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
        el.textContent = value || t('legal.blank');
      }
    }
  }

  function apply(lang) {
    const t = (key) => window.LancibleLang.t(key);
    let shown = null;
    for (const art of document.querySelectorAll('article[data-lang]')) {
      const on = art.dataset.lang === lang;
      art.hidden = !on;
      if (on) shown = art;
    }
    // Перевода документа на выбранный язык может не быть — тогда остаётся
    // русский оригинал, он на странице всегда.
    if (!shown) {
      shown = document.querySelector('article[data-lang="ru"]');
      if (!shown) return;
      shown.hidden = false;
    }
    if (shown.dataset.title) document.title = shown.dataset.title;
    const h1 = document.querySelector('[data-legal="heading"]');
    if (h1 && shown.dataset.heading) h1.textContent = shown.dataset.heading;
    const eyebrow = document.querySelector('[data-legal="eyebrow"]');
    if (eyebrow) eyebrow.textContent = t('legal.eyebrow');
    const nav = document.querySelector('.legal-nav');
    if (nav) {
      nav.setAttribute('aria-label', t('legal.nav'));
      for (const a of nav.querySelectorAll('a[data-doc]')) {
        if (!DOCS.includes(a.dataset.doc)) continue;
        a.textContent = t(`doc.${a.dataset.doc}`);
        a.href = `${a.dataset.doc}.html?lang=${lang}`;
      }
    }
    fillBusiness(shown, t);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Подписка зовётся сразу — отдельный первый вызов не нужен.
    window.LancibleLang.subscribe(apply);
  });
})();

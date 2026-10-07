/* Согласие на cookie и похожие хранилища — баннер лендинга.
 *
 * Подключается каждой страницей лендинга перед </body>. Сейчас сайт
 * пользуется только необходимым хранилищем (выбор языка, сам этот выбор), а
 * аналитики нет вовсе. Категория «Аналитика» заведена заранее: когда она
 * появится, её скрипт грузится только так —
 *
 *   LancibleConsent.onChange((c) => { if (c.analytics) loadAnalytics(); });
 *
 * onChange зовёт обработчик сразу, если выбор уже сделан, и потом при каждой
 * его смене. Ничего, кроме необходимого, до ответа человека не грузится.
 *
 * Правила, на которых держится честность баннера (сторожат
 * tests/unit/consent.test.js и tests/landing/legal.spec.js):
 *   — «Принять» и «Отклонить» одной кнопкой и одного вида — отказ не
 *     прячется за «Настроить» и не мельче согласия;
 *   — галочки необязательных категорий по умолчанию сняты;
 *   — выбор можно поменять в любой момент кнопкой «Настройки cookie» в
 *     подвале, и отозвать согласие так же легко, как дать;
 *   — сменилась версия (появилась новая категория) — спрашиваем заново.
 *
 * Выбор живёт в localStorage под ключом lancible:consent. Лендинг и веб
 * (/app) — один адрес, поэтому выбор, сделанный здесь, действует и там.
 */
(function (global) {
  const KEY = 'lancible:consent';
  /** Растёт, когда меняется набор категорий: старый ответ тогда не в счёт. */
  const VERSION = 1;
  /** Необязательные категории. Необходимое согласия не требует и в списке
   *  не значится: отключить его нельзя, оно и есть работа сайта. */
  const OPTIONAL = ['analytics'];
  const LANGS = ['ru', 'en', 'uk', 'kk'];

  const TEXT = {
    ru: {
      region: 'Согласие на cookie',
      title: 'Мы бережём ваши данные',
      body: 'Сайт хранит в браузере только необходимое: язык и этот выбор. Аналитику мы включим, только если вы разрешите. Подробно — в',
      policy: 'Политике cookie',
      accept: 'Принять все',
      reject: 'Отклонить',
      settings: 'Настроить',
      save: 'Сохранить выбор',
      necessary: 'Необходимые',
      necessaryNote: 'Нужны для работы сайта, всегда включены.',
      analytics: 'Аналитика',
      analyticsNote: 'Помогает понять, какие страницы полезны. Сейчас не используется.',
    },
    en: {
      region: 'Cookie consent',
      title: 'We take care of your data',
      body: 'This site only stores what it needs in your browser: your language and this choice. We will turn on analytics only if you allow it. Details are in the',
      policy: 'Cookie Policy',
      accept: 'Accept all',
      reject: 'Reject',
      settings: 'Customize',
      save: 'Save choice',
      necessary: 'Necessary',
      necessaryNote: 'Required for the site to work, always on.',
      analytics: 'Analytics',
      analyticsNote: 'Helps us see which pages are useful. Not in use yet.',
    },
    uk: {
      region: 'Згода на cookie',
      title: 'Ми дбаємо про ваші дані',
      body: 'Сайт зберігає в браузері лише необхідне: мову та цей вибір. Аналітику ми ввімкнемо, тільки якщо ви дозволите. Докладно — у',
      policy: 'Політиці cookie',
      accept: 'Прийняти всі',
      reject: 'Відхилити',
      settings: 'Налаштувати',
      save: 'Зберегти вибір',
      necessary: 'Необхідні',
      necessaryNote: 'Потрібні для роботи сайту, завжди ввімкнені.',
      analytics: 'Аналітика',
      analyticsNote: 'Допомагає зрозуміти, які сторінки корисні. Зараз не використовується.',
    },
    kk: {
      region: 'Cookie файлдарына келісім',
      title: 'Деректеріңізді қорғаймыз',
      body: 'Сайт браузерде тек қажеттісін сақтайды: тіл мен осы таңдауды. Аналитиканы тек сіз рұқсат етсеңіз ғана қосамыз. Толығырақ —',
      policy: 'Cookie саясатында',
      accept: 'Барлығын қабылдау',
      reject: 'Бас тарту',
      settings: 'Баптау',
      save: 'Таңдауды сақтау',
      necessary: 'Қажетті',
      necessaryNote: 'Сайттың жұмысына керек, әрқашан қосулы.',
      analytics: 'Аналитика',
      analyticsNote: 'Қай беттер пайдалы екенін түсінуге көмектеседі. Әзірге қолданылмайды.',
    },
  };

  // --- чистая логика: её же гоняет tests/unit/consent.test.js -------------

  /** Сохранённый выбор или null, если его нет, он битый или старой версии. */
  function parse(raw) {
    if (!raw) return null;
    let v;
    try { v = JSON.parse(raw); } catch { return null; }
    if (!v || v.v !== VERSION || typeof v.at !== 'string') return null;
    const out = { v: VERSION, at: v.at };
    for (const c of OPTIONAL) out[c] = v[c] === true;
    return out;
  }

  /** Запись выбора: choice — 'all', 'none' или { analytics: true, … }. */
  function decide(choice, now) {
    const out = { v: VERSION, at: new Date(now).toISOString() };
    for (const c of OPTIONAL) {
      out[c] = choice === 'all' ? true : choice === 'none' ? false : !!(choice && choice[c]);
    }
    return out;
  }

  /** Язык баннера: ?lang= в адресе, затем язык документов, затем язык
   *  страницы. Лендинг написан по-русски, поэтому по умолчанию — ru. */
  function pickLang(search, stored, htmlLang) {
    const fromUrl = new URLSearchParams(search || '').get('lang');
    for (const l of [fromUrl, stored, (htmlLang || '').slice(0, 2)]) {
      if (LANGS.includes(l)) return l;
    }
    return 'ru';
  }

  const api = { KEY, VERSION, OPTIONAL, LANGS, TEXT, parse, decide, pickLang };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // --- браузер ---------------------------------------------------------------

  const doc = global.document;
  const listeners = [];
  let state = null;
  try { state = parse(global.localStorage.getItem(KEY)); } catch { /* хранилище закрыто — спросим */ }

  const store = (s) => {
    state = s;
    try { global.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* не сохранится — спросим в следующий раз */ }
    for (const fn of listeners) fn(Object.assign({}, s));
  };

  const lang = () => {
    let stored = null;
    try { stored = global.localStorage.getItem('lancible:legal-lang'); } catch { /* нет хранилища */ }
    return pickLang(global.location.search, stored, doc.documentElement.lang);
  };

  let box = null;
  let returnFocus = null;

  function close() {
    if (!box) return;
    box.remove();
    box = null;
    if (returnFocus && doc.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
  }

  function render(detailed) {
    const t = TEXT[lang()];
    if (box) box.remove();
    box = doc.createElement('section');
    box.className = 'consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', t.region);
    box.setAttribute('lang', lang());
    const current = state || decide('none', Date.now());
    const rows = detailed ? `
      <div class="consent-cats">
        <label class="consent-cat"><input type="checkbox" checked disabled>
          <span><b>${t.necessary}</b><small>${t.necessaryNote}</small></span></label>
        ${OPTIONAL.map((c) => `
        <label class="consent-cat"><input type="checkbox" data-cat="${c}"${current[c] ? ' checked' : ''}>
          <span><b>${t[c]}</b><small>${t[`${c}Note`]}</small></span></label>`).join('')}
      </div>` : '';
    box.innerHTML = `
      <div class="consent-text">
        <p class="consent-title">${t.title}</p>
        <p>${t.body} <a href="cookies.html">${t.policy}</a>.</p>
      </div>
      ${rows}
      <div class="consent-actions">
        <button type="button" class="btn btn-ghost" data-act="reject">${t.reject}</button>
        ${detailed
          ? `<button type="button" class="btn btn-ghost" data-act="save">${t.save}</button>`
          : `<button type="button" class="btn btn-ghost" data-act="settings">${t.settings}</button>`}
        <button type="button" class="btn btn-ghost" data-act="accept">${t.accept}</button>
      </div>`;
    box.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'settings') { render(true); box.querySelector('[data-cat]').focus(); return; }
      if (a === 'accept') store(decide('all', Date.now()));
      else if (a === 'reject') store(decide('none', Date.now()));
      else if (a === 'save') {
        const choice = {};
        for (const el of box.querySelectorAll('[data-cat]')) choice[el.dataset.cat] = el.checked;
        store(decide(choice, Date.now()));
      }
      close();
    });
    box.addEventListener('keydown', (e) => {
      // Escape закрывает только открытое повторно окно: первый раз без ответа
      // баннер не уходит — молчание не согласие, но и не отказ.
      if (e.key === 'Escape' && state) close();
    });
    // Первым в документе: с клавиатуры до баннера доходят сразу, а не
    // после всей страницы.
    doc.body.prepend(box);
  }

  function open() {
    returnFocus = doc.activeElement;
    render(true);
    box.querySelector('[data-cat]').focus();
  }

  global.LancibleConsent = {
    get: () => (state ? Object.assign({}, state) : null),
    allowed: (cat) => !!(state && state[cat]),
    open,
    onChange(fn) { listeners.push(fn); if (state) fn(Object.assign({}, state)); },
  };

  function start() {
    for (const b of doc.querySelectorAll('[data-consent-open]')) b.addEventListener('click', open);
    if (!state) render(false);
  }
  // Документы лендинга переключают язык на ходу — баннер говорит на нём же.
  doc.addEventListener('lancible:lang', () => { if (box) render(!!box.querySelector('[data-cat]')); });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);

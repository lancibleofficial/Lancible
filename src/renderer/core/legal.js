/* Правовое: адреса документов и согласие с ними — чистая логика, без DOM.
 *
 * Документы живут на лендинге (privacy, terms, cookies, refund, legal,
 * delete-account) на четырёх языках. Приложение открывает их ссылкой и
 * передаёт свой язык параметром ?lang=, чтобы страница сразу показала нужный
 * перевод.
 *
 * Согласие. При первом входе (и email, и Google) пользователь отмечает
 * галочку «мне есть 16 лет, принимаю Условия и Политику». Отметка ложится в
 * profiles тремя полями: terms_version, terms_accepted_at, age_confirmed.
 * Когда документы меняются по существу, растёт TERMS_VERSION — и каждый,
 * кто принимал старую версию, при следующем входе видит шаг согласия снова.
 * Схема полей — supabase/legal.sql.
 *
 * «Сейчас» приходит параметром: иначе запись нельзя проверить в заданную
 * минуту.
 */
(function (global) {
  /** Версия Условий и Политики. Дата редакции, а не счётчик: по ней видно,
   *  какой текст человек принял. Меняется вместе с текстом документов. */
  const TERMS_VERSION = '2026-10-10';

  /** Сервис не для детей: младше этого возраста аккаунт не заводят, поэтому
   *  согласие родителей не собирается вовсе. */
  const MIN_AGE = 16;

  const LEGAL_DOCS = ['privacy', 'terms', 'cookies', 'refund', 'legal', 'delete-account'];
  const LEGAL_LANGS = ['ru', 'en', 'uk', 'kk'];

  /** Адрес документа на лендинге: base + '/privacy?lang=en'. Незнакомый язык
   *  не передаём — страница выберет сама. */
  function legalUrl(base, doc, lang) {
    if (!LEGAL_DOCS.includes(doc)) throw new Error(`Неизвестный документ: ${doc}`);
    const root = String(base || '').replace(/\/+$/, '');
    const q = LEGAL_LANGS.includes(lang) ? `?lang=${lang}` : '';
    return `${root}/${doc}${q}`;
  }

  /** Нужно ли спросить согласие: профиля нет, версия старая или возраст не
   *  подтверждён. */
  function needsConsent(profile) {
    if (!profile) return true;
    return profile.terms_version !== TERMS_VERSION || profile.age_confirmed !== true;
  }

  /** Поля профиля, которые записывает принятое согласие. */
  function consentFields(now) {
    return {
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date(now).toISOString(),
      age_confirmed: true,
    };
  }

  const api = { TERMS_VERSION, MIN_AGE, LEGAL_DOCS, LEGAL_LANGS, legalUrl, needsConsent, consentFields };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

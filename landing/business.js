/* Реквизиты владельца Lancible — БЛАНК.
 *
 * Единственное место, где они записаны. Документы на лендинге (privacy,
 * terms, refund, cookies, legal, delete-account) не повторяют их текстом, а
 * ставят метку <span data-biz="поле">, и landing/legal.js подставляет сюда
 * значение. Пустое поле показывается пометкой «[не заполнено]» — видно и
 * читателю, и нам.
 *
 * Пока бланк не заполнен, tests/unit/legal-pages.test.js показывает это
 * отдельной недоработкой ({ todo }) — сборку она не красит, но и не
 * теряется. Как заполнять — COMPLIANCE.md, раздел «Реквизиты».
 */
(function (global) {
  const LANCIBLE_BUSINESS = {
    // Кто отвечает за сервис и данные: ФИО индивидуального предпринимателя
    // или полное наименование компании.
    name: '',
    // Организационно-правовая форма: ИП, ТОО, ООО, ФОП, Ltd…
    form: '',
    // Страна регистрации.
    country: '',
    // Регистрационный номер: БИН/ИИН, ОГРН(ИП), ЄДРПОУ/РНОКПП, Company No.
    regNumber: '',
    // Налоговый номер, если отличается от регистрационного (VAT/ИНН).
    taxId: '',
    // Юридический адрес.
    address: '',
    // Почта для обращений: вопросы по данным, удаление, жалобы, поддержка.
    email: '',
    // Право какой страны применяется к Условиям.
    governingLaw: '',
    // Где физически лежит база (регион проекта Supabase), например
    // «ЕС (Франкфурт)». Смотреть: Supabase → Project Settings → General.
    dataRegion: '',
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LANCIBLE_BUSINESS;
  else global.LANCIBLE_BUSINESS = LANCIBLE_BUSINESS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

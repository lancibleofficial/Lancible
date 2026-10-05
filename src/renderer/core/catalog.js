/* Справочники продукта: палитра, валюты, ключ имени проекта по умолчанию.
 *
 * Это не настройки платформы, а свойства самого Lancible: шестнадцать цветов,
 * которыми красятся проекты, теги и статусы, и десять валют, в которых
 * считаются деньги. Лежали они в двух экземплярах — в app.js и в
 * mobile/src/lib/migrate.js, — слово в слово теми же. Добавить валюту на
 * одной стороне и забыть про другую было делом одной правки, и заметил бы
 * это пользователь, а не тест.
 *
 * Порядок в PALETTE имеет значение: цвет новому проекту выдаётся по номеру
 * (`palette[i % palette.length]`), так что перестановка перекрасит уже
 * заведённые проекты у всех.
 *
 * SYM2CODE нужен для старых данных: до 0.2 валюта хранилась символом, а не
 * кодом. Он намеренно неполный — в нём нет KGS, потому что «сом» символом
 * никогда не записывался.
 */
(function (global) {
  const DEFAULT_PROJECT_NAME_KEY = 'app.default_project_name';

  const PALETTE = [
    '#87ff65', '#5ec8f2', '#b98cf0', '#f5c451', '#f0736b', '#f58cc0', '#a4c2a8', '#8a93a5',
    '#e63950', '#2dd4bf', '#5468ff', '#ff9142', '#d946a8', '#6ee7b7', '#c8956d', '#6b7cad',
  ];

  const CURRENCIES = {
    USD: '$', EUR: '€', GBP: '£', RUB: '₽', KZT: '₸',
    UAH: '₴', KGS: 'сом', BYN: 'Br', PLN: 'zł', TRY: '₺',
  };

  const SYM2CODE = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₽': 'RUB', '₸': 'KZT', '₴': 'UAH', '₺': 'TRY', 'Br': 'BYN', 'zł': 'PLN' };

  const api = { DEFAULT_PROJECT_NAME_KEY, PALETTE, CURRENCIES, SYM2CODE };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

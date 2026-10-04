// Форматирование и деньги на телефоне.
//
// Общее лежит в src/core/format.js и src/core/money.js — побайтных копиях
// десктопного ядра. Раньше это были две реализации: совпадали они дословно,
// но держались порознь и могли разойтись в любой момент.
//
// Здесь остались три вещи:
//   — обёртки, подставляющие язык, локаль и «сейчас» (ядро берёт их
//     параметрами, чтобы результат можно было проверить тестом);
//   — форматы, завязанные на локаль телефона, которых на десктопе нет;
//   — символы валют.
//
// Про fmtTime отдельно. В ядре это ЧЧ:ММ:СС — формат для выгрузки, где
// секунды сессии важны. Экрану секунды не нужны, и для него есть
// fmtTimeShort. Раньше обе функции назывались fmtTime и значили разное: на
// экране ЧЧ:ММ, а в отчётах — то же самое ЧЧ:ММ, из-за чего выгрузка с
// телефона отличалась от десктопной. Одно имя — один смысл.
import CoreFormat from '../core/format.js';
import CoreMoney from '../core/money.js';
import { LOCALE_MAP } from './i18n';
import { t } from './i18n';

// --- взято у ядра как есть ---------------------------------------------------
export const {
  fmtClock, fmtShort, fmtDur, parseNum, hoursOf, capFirst, fmtDate, fmtTime,
} = CoreFormat;

export const { effectiveRate, sessionRate, sessionMoney } = CoreMoney;

// --- обёртки: ядру нужны локаль, перевод и «сейчас» --------------------------

/** Прошедшее время задачи, включая идущий таймер. */
export const taskElapsedMs = (task, activeTimer) =>
  CoreFormat.taskElapsedMs(task, activeTimer, Date.now());

/** Заработано по задаче, включая идущий таймер. */
export const earnedOf = (task, hourlyRate, activeTimer) =>
  CoreMoney.earnedOf(task, hourlyRate, activeTimer, Date.now());

/** «сегодня в 18:00» или «04.03 18:00». */
export const fmtWhen = (iso, langCode) => CoreFormat.fmtWhen(
  iso,
  LOCALE_MAP[langCode] || 'ru-RU',
  (key, params) => t(langCode, key, params),
  Date.now(),
);

// --- своё: завязано на локаль телефона --------------------------------------

export const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', RUB: '₽', KZT: '₸',
  UAH: '₴', KGS: 'сом', BYN: 'Br', PLN: 'zł', TRY: '₺',
};

/** ЧЧ:ММ по локали — для экрана, где секунды только мешают. */
export function fmtTimeShort(iso, langCode) {
  const locale = LOCALE_MAP[langCode] || 'ru-RU';
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** «18 сент.» — короткая дата для меток дедлайна. */
export function fmtDateShort(iso, langCode) {
  return new Date(iso).toLocaleDateString(LOCALE_MAP[langCode] || 'ru-RU', { day: 'numeric', month: 'short' });
}

export function monthLabel(langCode, y, m) {
  const locale = LOCALE_MAP[langCode] || 'ru-RU';
  return `${capFirst(new Date(y, m, 1).toLocaleDateString(locale, { month: 'long' }))} ${y}`;
}

export function moneyFmt(langCode) {
  return new Intl.NumberFormat(LOCALE_MAP[langCode] || 'ru-RU', { maximumFractionDigits: 2 });
}

export function fmtMoney(n, langCode, currencyCode) {
  const sym = CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽';
  return `${moneyFmt(langCode).format(Math.round((n + Number.EPSILON) * 100) / 100)} ${sym}`;
}

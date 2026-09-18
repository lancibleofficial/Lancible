// Порт денежных/временных форматеров из src/renderer/app.js (строки 662-767
// в оригинале) — чистая логика, без обращений к DOM. В отличие от
// десктопной версии, локаль/язык/валюта передаются параметрами явно, а не
// читаются из глобального `state`.
import { LOCALE_MAP, t } from './i18n';

export const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', RUB: '₽', KZT: '₸',
  UAH: '₴', KGS: 'сом', BYN: 'Br', PLN: 'zł', TRY: '₺',
};

const DUR_UNITS = {
  ru: { h: 'ч', m: 'м' }, en: { h: 'h', m: 'm' }, uk: { h: 'г', m: 'хв' }, kk: { h: 'сағ', m: 'мин' },
};

const pad2 = (n) => String(n).padStart(2, '0');

export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}

export function fmtShort(ms, langCode) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  const u = DUR_UNITS[langCode] || DUR_UNITS.ru;
  if (h === 0) return `${m}${u.m}`;
  return m === 0 ? `${h}${u.h}` : `${h}${u.h} ${m}${u.m}`;
}

export function fmtDur(ms, langCode) {
  const s = fmtShort(ms, langCode);
  return s === '—' ? `0${(DUR_UNITS[langCode] || DUR_UNITS.ru).m}` : s;
}

export function fmtWhen(iso, langCode) {
  const locale = LOCALE_MAP[langCode] || 'ru-RU';
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return t(langCode, 'session.today', { time });
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${time}`;
}

/** «18 сент.» — короткая дата для меток дедлайна (порт fmtDateShort
 *  из десктопной версии). */
export function fmtDateShort(iso, langCode) {
  return new Date(iso).toLocaleDateString(LOCALE_MAP[langCode] || 'ru-RU', { day: 'numeric', month: 'short' });
}

export const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const pad2xlsx = (n) => String(n).padStart(2, '0');
/** YYYY-MM-DD, локаль-независимо — для ячеек Excel-выгрузки. */
export function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2xlsx(d.getMonth() + 1)}-${pad2xlsx(d.getDate())}`;
}

export function monthLabel(langCode, y, m) {
  const locale = LOCALE_MAP[langCode] || 'ru-RU';
  return `${capFirst(new Date(y, m, 1).toLocaleDateString(locale, { month: 'long' }))} ${y}`;
}

export function fmtTime(iso, langCode) {
  const locale = LOCALE_MAP[langCode] || 'ru-RU';
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function moneyFmt(langCode) {
  return new Intl.NumberFormat(LOCALE_MAP[langCode] || 'ru-RU', { maximumFractionDigits: 2 });
}

export function fmtMoney(n, langCode, currencyCode) {
  const sym = CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽';
  return `${moneyFmt(langCode).format(Math.round((n + Number.EPSILON) * 100) / 100)} ${sym}`;
}

export function parseNum(s) {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const hoursOf = (ms) => ms / 3_600_000;

/** Ставка задачи: своя, если задана, иначе — ставка по умолчанию из settings. */
export function effectiveRate(task, hourlyRate) {
  const own = task.rate;
  if (own !== null && own !== undefined && own !== '' && Number.isFinite(Number(own))) return Number(own);
  return Number(hourlyRate) || 0;
}

export function sessionRate(s, task, hourlyRate) {
  const r = s && s.rate;
  return r !== null && r !== undefined && Number.isFinite(Number(r)) ? Number(r) : effectiveRate(task, hourlyRate);
}

export const sessionMoney = (s, task, hourlyRate) => hoursOf(s.ms) * sessionRate(s, task, hourlyRate);

/** Прошедшее время задачи, включая текущую сессию, если таймер идёт именно по ней. */
export function taskElapsedMs(task, activeTimer) {
  let ms = task.totalMs || 0;
  if (activeTimer && activeTimer.taskId === task.id) {
    ms += Date.now() - new Date(activeTimer.startedAt).getTime();
  }
  return ms;
}

export function earnedOf(task, hourlyRate, activeTimer) {
  let money = (task.sessions || []).reduce((a, s) => a + sessionMoney(s, task, hourlyRate), 0);
  if (activeTimer && activeTimer.taskId === task.id) {
    const runMs = Date.now() - new Date(activeTimer.startedAt).getTime();
    money += hoursOf(runMs) * effectiveRate(task, hourlyRate);
  }
  return money;
}

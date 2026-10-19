// Отчёты для Excel-выгрузки на телефоне.
//
// Сама форма отчёта — строки, колонки, формулы, итоги — лежит в
// src/core/reports.js, побайтной копии десктопного ядра: раньше это были две
// независимые реализации, которые уже начали расходиться. Здесь остались
// только обёртки, подставляющие язык, валюту и ставку, потому что словарь и
// format у телефона свои.
//
// Подписи и формат берутся из ./i18n и ./format, а не из ядра, намеренно: на
// телефоне строки короче, и держать их общими с десктопом нельзя.
//
// Деньги. Последний аргумент построителей — { money }: флаг из
// useModeFlags() (Core.modeFlags). money === false — «личное»: ядро собирает
// листы сразу без колонок ставки и суммы, формулы в них на своих местах.
// Вырезать колонки из готового листа здесь нельзя: форма листа — в ядре.
import Core from '../core/reports.js';
import {
  fmtClock, fmtDate, fmtTime, hoursOf,
  effectiveRate, sessionRate, sessionMoney, CURRENCY_SYMBOLS,
} from './format';
import { t } from './i18n';

/** Ядро отчётов, привязанное к языку, валюте и ставке. money — не задан или
 *  true: с деньгами, false: без. */
const reports = (langCode, currencyCode, hourlyRate, money) => Core.makeReports({
  money,
  t: (key, params) => t(langCode, key, params),
  cur: CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽',
  fmtClock,
  fmtDate,
  // Секунды в выгрузке нужны: это отчёт по учёту времени. Формат — как в
  // ядре, тот же, что на десктопе.
  fmtTime,
  hoursOf,
  effectiveRate: (task) => effectiveRate(task, hourlyRate),
  sessionRate: (s, task) => sessionRate(s, task, hourlyRate),
  sessionMoney: (s, task) => sessionMoney(s, task, hourlyRate),
});

export function buildTaskSheets(task, project, langCode, currencyCode, hourlyRate, opts) {
  return reports(langCode, currencyCode, hourlyRate, opts && opts.money).buildTaskSheets(task, project);
}

export function buildAllProjectsSheets(projects, tasksByProjectId, langCode, currencyCode, hourlyRate, opts) {
  return reports(langCode, currencyCode, hourlyRate, opts && opts.money).buildAllProjectsSheets(projects, tasksByProjectId);
}

/** @param range — {from, to}: Date. Отбирает СЕССИИ, а не задачи: время и
 *  деньги в листе — только за период. */
export function buildPeriodSheets(tasks, getProjectById, langCode, currencyCode, hourlyRate, range, opts) {
  return reports(langCode, currencyCode, hourlyRate, opts && opts.money).buildPeriodSheets(tasks, getProjectById, range);
}

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
import Core from '../core/reports.js';
import {
  fmtClock, fmtDate, fmtTime, hoursOf,
  effectiveRate, sessionRate, sessionMoney, CURRENCY_SYMBOLS,
} from './format';
import { t } from './i18n';

/** Ядро отчётов, привязанное к языку, валюте и ставке. */
const reports = (langCode, currencyCode, hourlyRate) => Core.makeReports({
  t: (key, params) => t(langCode, key, params),
  cur: CURRENCY_SYMBOLS[currencyCode] || currencyCode || '₽',
  fmtClock,
  fmtDate,
  fmtTime: (ts) => fmtTime(ts, langCode),
  hoursOf,
  effectiveRate: (task) => effectiveRate(task, hourlyRate),
  sessionRate: (s, task) => sessionRate(s, task, hourlyRate),
  sessionMoney: (s, task) => sessionMoney(s, task, hourlyRate),
});

export function buildTaskSheets(task, project, langCode, currencyCode, hourlyRate) {
  return reports(langCode, currencyCode, hourlyRate).buildTaskSheets(task, project);
}

/** @param range — {from, to}: Date. Отбирает СЕССИИ, а не задачи: в отчёт
 *  попадут все задачи проекта, но со временем и деньгами за период. */
export function buildProjectSheets(project, tasks, langCode, currencyCode, hourlyRate, range) {
  return reports(langCode, currencyCode, hourlyRate).buildProjectSheets(project, tasks, { range });
}

export function buildAllProjectsSheets(projects, tasksByProjectId, langCode, currencyCode, hourlyRate) {
  return reports(langCode, currencyCode, hourlyRate).buildAllProjectsSheets(projects, tasksByProjectId);
}

export function buildPeriodSheets(tasks, getProjectById, langCode, currencyCode, hourlyRate, range) {
  return reports(langCode, currencyCode, hourlyRate).buildPeriodSheets(tasks, getProjectById, range);
}

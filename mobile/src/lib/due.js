// Сроки — тонкий слой над ядром.
//
// Правила лежат в src/renderer/core/due.js и копируются сюда побайтно
// (scripts/sync-mobile-core.js, сверка в tests/unit/mobile-core.test.js).
// Здесь остаётся только привязка к телефону: язык и «сейчас».
//
// Раньше тут лежали свои копии правил сроков — дословные, слово в слово те
// же. Причём часть из них к тому моменту уже была в ядре, просто спрятана в
// money.js, где их никто не искал. Две копии одного правила расходятся
// молча, и это не гипотеза: ровно так разошлись rollRepeat и формат времени
// в выгрузке.
//
// Поле dueAt — сам дедлайн (ISO | null). Напоминания у задачи с 11 октября
// 2026 списком, task.reminders (src/core/reminders.js, на экранах —
// lib/reminderText.js); три старых поля — remindOffsetMin, remindAt и
// notifiedAt — остались зеркалом списка для десктопа 0.4.3 и телефона 1.2.2.
import Core from '../core/due.js';
import { t } from './i18n';
import { fmtDateShort } from './format';

/** 'overdue' | 'soon' (в пределах суток) | 'later' | null. */
export const dueState = (task) => Core.dueState(task, Date.now());

/** Короткая подпись для карточки задачи и ленты уведомлений. */
export const dueShort = (task, langCode) => Core.dueShort(
  task,
  Date.now(),
  (key, params) => t(langCode, key, params),
  (date) => fmtDateShort(date, langCode),
);

/** Лента уведомлений: просроченные, дедлайн в пределах суток, и те, у кого
 *  напоминание уже сработало. Ничего не хранит — считается из задач. */
export const notificationFeed = (tasks, seenAtIso) =>
  Core.notificationFeed(tasks, seenAtIso, Date.now());

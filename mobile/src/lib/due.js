// Сроки и напоминания — тонкий слой над ядром.
//
// Правила лежат в src/renderer/core/due.js и копируются сюда побайтно
// (scripts/sync-mobile-core.js, сверка в tests/unit/mobile-core.test.js).
// Здесь остаётся только привязка к телефону: язык и «сейчас».
//
// Раньше тут лежали свои копии remindKey, reminderTime, dueState и
// notificationFeed — дословные, слово в слово те же. Причём reminderTime и
// dueState к тому моменту уже были в ядре, просто спрятаны в money.js, где
// их никто не искал. Две копии одного правила расходятся молча, и это не
// гипотеза: ровно так разошлись rollRepeat и формат времени в выгрузке.
//
// Модель полей — общая на все три поверхности, они едут в одном JSON-блоке
// синхронизации:
//
//   dueAt           ISO | null   — сам дедлайн
//   remindOffsetMin число | null — за сколько минут до дедлайна напомнить
//                                  (0 = ровно в срок); при переносе дедлайна
//                                  напоминание едет вместе с ним
//   remindAt        ISO | null   — своё время напоминания, когда смещение снято
//   notifiedAt      ISO | null   — уже уведомили, повторно не будем
import Core from '../core/due.js';
import { t } from './i18n';
import { fmtDateShort } from './format';

/** Пресеты в том же порядке и с теми же значениями, что на десктопе. */
export const { REMIND_PRESETS, REMIND_LABEL, remindKey, reminderTime } = Core;

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

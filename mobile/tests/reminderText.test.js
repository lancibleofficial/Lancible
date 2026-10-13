// Слова и начало отсчёта напоминаний (lib/reminderText.js, lib/reminderRepeat.js).
// Запуск: npm run test:mobile
//
// Правила — в ядре (core/reminders.js, tests/unit/reminders.test.js): describeReminder
// отдаёт структуру, а тексты собирает телефон. Здесь — что подписи читаются на
// всех четырёх языках и что начало отсчёта «повторять» не даёт напоминанию
// всплыть сразу после сохранения и не пропускает первое настоящее.
import Reminders from '../src/core/reminders.js';
import { reminderLabel, notificationContent, offsetText } from '../src/lib/reminderText';
import { repeatStart } from '../src/lib/reminderRepeat';
import { fmtDateShort, fmtWhen } from '../src/lib/format';
import { t } from '../src/lib/i18n';

const LANGS = ['ru', 'en', 'uk', 'kk'];
const iso = (m, d, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();
const rule = (extra) => ({ freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0, ...extra });
const before = (anchor, offsetMin, unit = 'min') => ({ id: 'r', kind: 'before', anchor, offsetMin, unit });

describe('подписи чипов', () => {
  test('«до начала» и «до дедлайна»: число и единица как ввели; ноль — «в момент»', () => {
    expect(reminderLabel(before('start', 15), 'ru')).toBe('За 15 мин до начала');
    expect(reminderLabel(before('due', 60, 'hour'), 'ru')).toBe('За 1 ч до дедлайна');
    expect(reminderLabel(before('due', 120, 'min'), 'ru')).toBe('За 120 мин до дедлайна');
    expect(reminderLabel(before('start', 0), 'ru')).toBe('В момент начала');
    expect(reminderLabel(before('due', 0), 'ru')).toBe('В момент дедлайна');
  });

  test('дни — словом по числу: 1 день, 2 дня, 5 дней; минуты и часы остаются сокращёнными', () => {
    expect(reminderLabel(before('due', 1440, 'day'), 'ru')).toBe('За 1 день до дедлайна');
    expect(reminderLabel(before('due', 2880, 'day'), 'ru')).toBe('За 2 дня до дедлайна');
    expect(reminderLabel(before('due', 5 * 1440, 'day'), 'ru')).toBe('За 5 дней до дедлайна');
    expect(reminderLabel(before('start', 1440, 'day'), 'ru')).toBe('За 1 день до начала');
    expect(reminderLabel(before('start', 21 * 1440, 'day'), 'ru')).toBe('За 21 день до начала');
    expect(reminderLabel(before('due', 1440, 'day'), 'en')).toBe('1 day before the deadline');
    expect(reminderLabel(before('due', 2880, 'day'), 'en')).toBe('2 days before the deadline');
    expect(reminderLabel(before('due', 5 * 1440, 'day'), 'uk')).toBe('За 5 днів до дедлайну');
    expect(reminderLabel(before('due', 2880, 'day'), 'uk')).toBe('За 2 дні до дедлайну');
    expect(reminderLabel(before('due', 2880, 'day'), 'kk')).toBe('Дедлайнға 2 күн қалғанда');
    expect(offsetText('ru', 1, 'day')).toBe('1 день');
    expect(offsetText('ru', 2, 'day')).toBe('2 дня');
    expect(offsetText('ru', 5, 'day')).toBe('5 дней');
    expect(offsetText('en', 3, 'day')).toBe('3 days');
    expect(offsetText('ru', 2, 'hour')).toBe('2 ч');
  });

  test('«один раз» — день и время; «повторять» — каждый день, дни недели с понедельника, число месяца', () => {
    const at = iso(10, 12, 9);
    expect(reminderLabel({ id: 'r', kind: 'at', at }, 'ru')).toBe(`${fmtDateShort(at, 'ru')}, 09:00`);
    expect(reminderLabel({ id: 'r', kind: 'repeat', rule: rule(), time: '09:00', start: at }, 'ru')).toBe('Каждый день в 09:00');
    // Дни хранятся от воскресенья (0), а читаются с понедельника.
    expect(reminderLabel({ id: 'r', kind: 'repeat', rule: rule({ freq: 'week', weekdays: [0, 3, 1] }), time: '18:30', start: at }, 'ru')).toBe('По Пн, Ср, Вс в 18:30');
    expect(reminderLabel({ id: 'r', kind: 'repeat', rule: rule({ freq: 'month' }), time: '09:00', start: iso(11, 5) }, 'ru')).toBe('Каждый месяц 5-го в 09:00');
  });

  test('неделя без дней — день недели начала; правило, которого экран не собирает (раз в две недели), — словами правила', () => {
    // 12 октября 2026 — понедельник.
    expect(reminderLabel({ id: 'r', kind: 'repeat', rule: rule({ freq: 'week' }), time: '09:00', start: iso(10, 12, 8) }, 'ru')).toBe('По Пн в 09:00');
    const every2 = reminderLabel({ id: 'r', kind: 'repeat', rule: rule({ freq: 'week', every: 2, weekdays: [1] }), time: '09:00', start: iso(10, 12, 8) }, 'ru');
    expect(every2).toMatch(/09:00$/);
    expect(every2).not.toMatch(/^По /);
  });

  test('мусор — пустая подпись, а не падение', () => {
    expect(reminderLabel(null, 'ru')).toBe('');
    expect(reminderLabel({ kind: 'before', anchor: 'nowhere', offsetMin: 5 }, 'ru')).toBe('');
  });

  test('все четыре языка: подписи собраны из своих словарей, подстановки заполнены', () => {
    for (const lang of LANGS) {
      const labels = [
        reminderLabel(before('start', 15), lang),
        reminderLabel(before('due', 60, 'hour'), lang),
        reminderLabel(before('start', 0), lang),
        reminderLabel(before('due', 0), lang),
        reminderLabel({ id: 'r', kind: 'repeat', rule: rule(), time: '09:00', start: iso(10, 12) }, lang),
        reminderLabel({ id: 'r', kind: 'repeat', rule: rule({ freq: 'week', weekdays: [1, 3] }), time: '09:00', start: iso(10, 12) }, lang),
        reminderLabel({ id: 'r', kind: 'repeat', rule: rule({ freq: 'month' }), time: '09:00', start: iso(11, 5) }, lang),
      ];
      for (const text of labels) {
        expect(text).toBeTruthy();
        expect(text).not.toMatch(/[{}]|remind\./);
      }
      expect(labels[0]).toContain('15');
      expect(labels[0]).toContain(t(lang, 'remind.unit_min'));
      expect(labels[4]).toContain('09:00');
      expect(labels[6]).toContain('5');
    }
    expect(offsetText('en', 15, 'min')).toBe('15 min');
  });
});

describe('текст системного уведомления', () => {
  const task = { id: 't1', title: 'Сдать отчёт' };
  const entry = (extra) => ({ key: 'k', taskId: 't1', reminderId: 'r', kind: 'before', anchor: 'due', at: 0, start: new Date(2026, 9, 15, 18).getTime(), end: null, ...extra });
  const withList = (list) => ({ ...task, ...Reminders.withReminders(task, list) });

  test('до дедлайна: «Через 1 ч: название», под ним срок; в момент — просто название', () => {
    const t1 = withList([before('due', 60, 'hour')]);
    expect(notificationContent(entry(), t1, 'ru')).toEqual({
      title: 'Через 1 ч: Сдать отчёт',
      body: `${t('ru', 'due.label')}: ${fmtWhen(iso(10, 15, 18), 'ru')}`,
    });
    const t0 = withList([before('due', 0)]);
    expect(notificationContent(entry(), t0, 'ru').title).toBe('Сдать отчёт');
  });

  test('за дни — «Через 1 день», «Через 2 дня», «Через 5 дней»', () => {
    for (const [days, word] of [[1, 'день'], [2, 'дня'], [5, 'дней']]) {
      const tt = withList([before('due', days * 1440, 'day')]);
      expect(notificationContent(entry(), tt, 'ru').title).toBe(`Через ${days} ${word}: Сдать отчёт`);
    }
    expect(notificationContent(entry(), withList([before('due', 2880, 'day')]), 'en').title).toBe('In 2 days: Сдать отчёт');
  });

  test('до начала: «Через 15 мин: название», под ним «Время работы» и часы вхождения', () => {
    const tt = withList([before('start', 15)]);
    const e = entry({ anchor: 'start', start: new Date(2026, 9, 15, 10).getTime(), end: new Date(2026, 9, 15, 12).getTime() });
    expect(notificationContent(e, tt, 'ru')).toEqual({ title: 'Через 15 мин: Сдать отчёт', body: `${t('ru', 'notif.slot')} · 10:00–12:00` });
    expect(notificationContent(e, tt, 'en').title).toBe('In 15 min: Сдать отчёт');
    expect(notificationContent(e, tt, 'kk').title).toBe('15 мин кейін: Сдать отчёт');
  });

  test('один раз и повторять: название и «Напоминание»; задача без названия — «Без названия»', () => {
    expect(notificationContent(entry({ kind: 'at', anchor: null }), task, 'ru')).toEqual({ title: 'Сдать отчёт', body: t('ru', 'notif.reminder') });
    expect(notificationContent(entry({ kind: 'repeat', anchor: null }), { id: 't1', title: '' }, 'ru').title).toBe(t('ru', 'task.no_name'));
  });

  test('напоминание уже удалили, а уведомление в очереди — заголовок без «Через …», ничего не падает', () => {
    expect(notificationContent(entry({ reminderId: 'нет-такого' }), withList([]), 'ru').title).toBe('Сдать отчёт');
  });
});

describe('начало отсчёта «повторять»', () => {
  // Среда 14 октября 2026, 15:00:30 — секунды есть, как у настоящего Date.now():
  // вхождение «в 15:00» уже позади.
  const NOW = new Date(2026, 9, 14, 15, 0, 30).getTime();
  const task = (list) => ({ id: 't1', title: 'x', ...Reminders.withReminders({ id: 't1' }, list) });
  const rem = (r, time, start) => ({ id: 'r', kind: 'repeat', rule: r, time, start });
  /** Ближайшие вхождения напоминания, поставленного в момент now. */
  const upcoming = (freq, day, time, extra, now = NOW) => {
    const start = repeatStart(freq, day, time, now);
    const r = rem(rule({ freq, ...extra }), time, start);
    return { start, occ: Reminders.reminderOccurrences({}, r, now, now + 120 * 86400000, 4).map((o) => o.at), r };
  };

  test('день и неделя: отсчёт — сейчас; сегодняшнее «каждый день в 09:00» уже прошло и молчит, первым будет завтра', () => {
    expect(repeatStart('day', 1, '09:00', NOW)).toBe(new Date(NOW).toISOString());
    expect(repeatStart('week', 1, '09:00', NOW)).toBe(new Date(NOW).toISOString());
    const { occ } = upcoming('day', 1, '09:00');
    expect(occ[0]).toBe(new Date(2026, 9, 15, 9).getTime());
    // А вечернее сегодня ещё впереди.
    expect(upcoming('day', 1, '18:00').occ[0]).toBe(new Date(2026, 9, 14, 18).getTime());
  });

  test('месяц: число впереди в этом месяце — это месяц; число уже прошло — следующий; сегодня, но время вышло, — следующий', () => {
    expect(upcoming('month', 20, '09:00').occ[0]).toBe(new Date(2026, 9, 20, 9).getTime());
    expect(upcoming('month', 5, '09:00').occ[0]).toBe(new Date(2026, 10, 5, 9).getTime());
    expect(upcoming('month', 14, '09:00').occ[0]).toBe(new Date(2026, 10, 14, 9).getTime());
    // Сегодня и время ещё впереди — сегодня.
    expect(upcoming('month', 14, '18:00').occ[0]).toBe(new Date(2026, 9, 14, 18).getTime());
  });

  test('число месяца берётся у самого начала: describeReminder читает его оттуда', () => {
    for (const day of [1, 5, 14, 20, 28, 29, 30, 31]) {
      const { r } = upcoming('month', day, '09:00');
      expect(Reminders.describeReminder(r).monthDay).toBe(day);
    }
  });

  test('31-е: в октябре оно есть; в ноябре — 30-е без сползания, дальше снова 31-е', () => {
    const oct = upcoming('month', 31, '09:00');
    expect(oct.occ.slice(0, 3)).toEqual([new Date(2026, 9, 31, 9).getTime(), new Date(2026, 10, 30, 9).getTime(), new Date(2026, 11, 31, 9).getTime()]);
    // 11 ноября: 31-е в этом месяце нет — первым будет 30 ноября, потом 31 декабря, 31 января.
    const nov = upcoming('month', 31, '09:00', {}, new Date(2026, 10, 11, 15, 0, 30).getTime());
    expect(nov.occ.slice(0, 3)).toEqual([new Date(2026, 10, 30, 9).getTime(), new Date(2026, 11, 31, 9).getTime(), new Date(2027, 0, 31, 9).getTime()]);
    expect(Reminders.describeReminder(nov.r).monthDay).toBe(31);
  });

  test('31-е в феврале: 28-е (не високосный), потом 31 марта', () => {
    const now = new Date(2027, 1, 10, 12, 0).getTime();
    const start = repeatStart('month', 31, '09:00', now);
    const r = rem(rule({ freq: 'month' }), '09:00', start);
    const occ = Reminders.reminderOccurrences({}, r, now, now + 80 * 86400000, 3).map((o) => o.at);
    expect(occ[0]).toBe(new Date(2027, 1, 28, 9).getTime());
    expect(occ[1]).toBe(new Date(2027, 2, 31, 9).getTime());
  });

  test('сохранённое только что напоминание не всплывает сразу ни в одном из видов', () => {
    for (const [freq, day, time, extra] of [
      ['day', 1, '09:00', {}], ['day', 1, '15:00', {}], ['week', 1, '09:00', { weekdays: [3] }], ['week', 1, '09:00', { weekdays: [2] }],
      ['month', 14, '09:00', {}], ['month', 13, '18:00', {}], ['month', 15, '09:00', {}], ['month', 31, '09:00', {}],
    ]) {
      const start = repeatStart(freq, day, time, NOW);
      const tk = task([rem(rule({ freq, ...extra }), time, start)]);
      expect(Reminders.remindersDue([tk], NOW)).toEqual([]);
    }
  });

  test('число вне 1…31 прижимается', () => {
    expect(Reminders.describeReminder(rem(rule({ freq: 'month' }), '09:00', repeatStart('month', 99, '09:00', NOW))).monthDay).toBe(31);
    expect(Reminders.describeReminder(rem(rule({ freq: 'month' }), '09:00', repeatStart('month', 0, '09:00', NOW))).monthDay).toBe(1);
  });
});

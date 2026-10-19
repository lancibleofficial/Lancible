// Календарь в день перевода часов. Запуск: npm run test:mobile
//
// Сутки в такой день длятся 23 или 25 часов. Сетка месяца и полоска недели
// считали дни как `начало + i * 86400000`: после перевода назад один день
// повторялся, соседний терялся, и все клетки дальше сдвигались на день — тап по
// клетке ловил чужой ключ. На Linux с поясом UTC в CI это не видно, поэтому
// пояс здесь задаётся самим тестом: Киев (перевод 25.10.2026, воскресенье),
// Нью-Йорк (1.11.2026), Каир (перевод в четверг в 24:00, 29.10.2026 — неделя с
// понедельника рвётся посреди), Сантьяго (перевод в ночь на воскресенье) и
// Сидней.
//
// Пояс процесса в jest не меняется записью в process.env.TZ: process в
// песочнице теста — копия. Настоящий process живёт в главном контексте, туда
// и пишет vm.runInThisContext (V8 пересчитывает пояс при записи в TZ).
import vm from 'vm';
import { render, fireEvent } from '@testing-library/react-native';
import StatsScreen, { monthCells, statsBounds } from '../src/screens/StatsScreen';
import { useAppStore } from '../src/store/useAppStore';
import { dayKey, keyToDate, mondayOf, addDays } from '../src/lib/calendarMath';
import { spanFromParts } from '../src/lib/sessions';
import { fmtDateShort, capFirst } from '../src/lib/format';
import { t } from '../src/lib/i18n';

const H = 3_600_000;
const inMainContext = (code) => vm.runInThisContext(code);
const ORIGINAL_TZ = inMainContext('process.env.TZ');
const setZone = (tz) => inMainContext(`process.env.TZ = ${JSON.stringify(tz)}`);

/** Сколько часов длится календарный день (y, m — с нуля, d). */
const dayHours = (y, m, d) => (new Date(y, m, d + 1) - new Date(y, m, d)) / H;
/** Ключ следующего календарного дня. */
const nextKey = (key) => { const d = keyToDate(key); return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); };

afterEach(() => { jest.useRealTimers(); });
afterAll(() => {
  inMainContext(ORIGINAL_TZ === undefined ? 'delete process.env.TZ' : `process.env.TZ = ${JSON.stringify(ORIGINAL_TZ)}`);
});

describe('пояс действует', () => {
  // Если запись в TZ не доходит до V8, остальные проверки зелёные впустую.
  test('в Киеве 25 октября 2026 — 25 часов, 29 марта — 23', () => {
    setZone('Europe/Kyiv');
    expect(dayHours(2026, 9, 25)).toBe(25);
    expect(dayHours(2026, 2, 29)).toBe(23);
    expect(dayHours(2026, 9, 24)).toBe(24);
  });

  test('в Нью-Йорке 1 ноября 2026 — 25 часов, в Каире 29 октября — 25', () => {
    setZone('America/New_York');
    expect(dayHours(2026, 10, 1)).toBe(25);
    setZone('Africa/Cairo');
    expect(dayHours(2026, 9, 29)).toBe(25);
  });
});

describe('addDays', () => {
  test('addDays шагает по календарю: через перевод часов день не повторяется и не теряется', () => {
    setZone('Europe/Kyiv');
    const keys = Array.from({ length: 10 }, (_, i) => dayKey(addDays(new Date(2026, 9, 22), i)));
    expect(keys).toEqual([
      '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26',
      '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31',
    ]);
    expect(addDays(new Date(2026, 9, 25), -1).getDate()).toBe(24);
    expect(addDays(new Date(2026, 9, 31, 15, 40), 1).getHours()).toBe(0);
  });
});

describe('сетка месяца', () => {
  const monthKeys = (y, m) => monthCells(y, m).flat().map((c) => c.key);

  test('октябрь 2026, Киев: 31 разный день, 25 и 26 октября не повторяются', () => {
    setZone('Europe/Kyiv');
    const rows = monthCells(2026, 9);
    const all = rows.flat();
    const inMonth = all.filter((c) => !c.off).map((c) => c.day);
    expect(inMonth).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
    for (const day of [25, 26]) expect(all.filter((c) => c.key === `2026-10-${day}`)).toHaveLength(1);
    // Неделя с понедельника по воскресенье, ряды по семь, сетка кончается воскресеньем 1 ноября.
    for (const row of rows) {
      expect(row).toHaveLength(7);
      expect(keyToDate(row[0].key).getDay()).toBe(1);
    }
    expect([all[0].key, all.at(-1).key]).toEqual(['2026-09-28', '2026-11-01']);
    // Клетка 25-го — в воскресной колонке, 26-го — в понедельничной следующего ряда.
    expect(rows[3].at(-1).key).toBe('2026-10-25');
    expect(rows[4][0].key).toBe('2026-10-26');
  });

  test('ноябрь 2026, Нью-Йорк: 1 ноября (перевод часов) один раз, 30 разных дней', () => {
    setZone('America/New_York');
    const all = monthCells(2026, 10).flat();
    expect(all.filter((c) => !c.off).map((c) => c.day)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(all.filter((c) => c.key === '2026-11-01')).toHaveLength(1);
    expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
    // Сетка начинается с понедельника 26 октября, 1 ноября — воскресная клетка первого ряда.
    expect(all[0].key).toBe('2026-10-26');
    expect(monthCells(2026, 10)[0].at(-1).key).toBe('2026-11-01');
  });

  const ZONES = ['Europe/Kyiv', 'America/New_York', 'Africa/Cairo', 'America/Santiago', 'Australia/Sydney', 'Asia/Almaty'];
  test.each(ZONES)('%s: все 24 месяца 2026–2027 — дни подряд без повторов и пропусков', (zone) => {
    setZone(zone);
    for (const y of [2026, 2027]) {
      for (let m = 0; m < 12; m += 1) {
        const keys = monthKeys(y, m);
        // Каждый следующий ключ — следующий календарный день.
        keys.slice(1).forEach((key, i) => expect([zone, y, m, key]).toEqual([zone, y, m, nextKey(keys[i])]));
        expect(keys[0]).toBe(dayKey(mondayOf(new Date(y, m, 1))));
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});

describe('неделя с понедельника', () => {
  test('statsBounds: неделя в Каире, где часы переводят в ночь на пятницу, доходит до воскресенья', () => {
    setZone('Africa/Cairo');
    const [from, to] = statsBounds('week', new Date(2026, 9, 28), null);
    expect([from.getMonth(), from.getDate(), from.getHours()]).toEqual([9, 26, 0]);
    expect([to.getMonth(), to.getDate(), to.getHours(), to.getMinutes()]).toEqual([10, 1, 23, 59]);
    // Воскресная запись в границах недели.
    const sunday = new Date(2026, 10, 1, 12).getTime();
    expect(sunday >= from.getTime() && sunday <= to.getTime()).toBe(true);
  });

  test('statsBounds: неделя в Киеве с переводом в воскресенье и в Сантьяго с переводом в ночь на воскресенье', () => {
    for (const [zone, anchor, [m, d]] of [['Europe/Kyiv', new Date(2026, 9, 22), [9, 25]], ['America/Santiago', new Date(2026, 3, 2), [3, 5]]]) {
      setZone(zone);
      const to = statsBounds('week', anchor, null)[1];
      expect([zone, to.getMonth(), to.getDate(), to.getHours()]).toEqual([zone, m, d, 23]);
    }
  });
});

// Время прибито: фальшивой остаётся только Date, таймеры настоящие.
const REAL_TIMERS = ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime'];
const pin = (y, m, d) => jest.useFakeTimers({ now: new Date(y, m, d, 12, 0, 0), doNotFake: REAL_TIMERS });
const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn() });

function seed(sessionStart) {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: H, tagIds: [],
      sessions: [{ start: sessionStart.toISOString(), end: new Date(+sessionStart + H).toISOString(), ms: H }],
    }],
    activeTimer: null,
  });
}

describe('«Цифры» на экране', () => {
  test('октябрь 2026, Киев: каждый день один раз, тап по 26-му выбирает 26-е', async () => {
    setZone('Europe/Kyiv');
    seed(new Date(2026, 9, 26, 9));
    pin(2026, 9, 15);
    const q = await render(<StatsScreen navigation={nav()} />);
    for (let day = 1; day <= 31; day += 1) {
      expect(q.queryAllByTestId(`stats-cell-2026-10-${String(day).padStart(2, '0')}`)).toHaveLength(1);
    }
    expect(q.queryAllByTestId(/^stats-cell-/)).toHaveLength(35);
    // Воскресная колонка 25-го и понедельничная 26-го: клетки в рядах на своих местах.
    expect(q.getByTestId('stats-cal-row-3').children.at(-1).props.testID).toBe('stats-cell-2026-10-25');
    expect(q.getByTestId('stats-cal-row-4').children[0].props.testID).toBe('stats-cell-2026-10-26');

    await fireEvent.press(q.getByTestId('stats-cell-2026-10-26'));
    q.getByText(capFirst(new Date(2026, 9, 26).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })));
  });

  test('неделя в Каире 26 октября – 1 ноября: семь своих дней, воскресенье на месте', async () => {
    setZone('Africa/Cairo');
    seed(new Date(2026, 10, 1, 12));
    pin(2026, 9, 28);
    const q = await render(<StatsScreen navigation={nav()} />);
    await fireEvent.press(q.getByText(t('ru', 'calendar.week')));
    expect(q.getAllByTestId(/^stats-bar-\d/).map((b) => b.props.testID.slice('stats-bar-'.length))).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
    // Заголовок периода кончается воскресеньем, а не субботой.
    expect(q.getByTestId('stats-period').children.join('')).toBe(`${fmtDateShort(new Date(2026, 9, 26), 'ru')} – ${fmtDateShort(new Date(2026, 10, 1), 'ru')}`);
  });
});

describe('запись через полночь', () => {
  // «Конец раньше начала» — это следующий день. Раньше к концу прибавлялись
  // 24 часа: в 25-часовой день 23:30–00:30 схлопывалась в ноль, в 23-часовой
  // растягивалась до двух часов.
  test.each([
    ['Europe/Kyiv', '2026-10-25'], ['Europe/Kyiv', '2026-03-29'],
    ['America/New_York', '2026-11-01'], ['America/New_York', '2026-03-08'], ['Asia/Almaty', '2026-10-25'],
  ])('%s, %s: 23:30–00:30 — ровно час, конец — 00:30 следующего дня', (zone, key) => {
    setZone(zone);
    const span = spanFromParts(key, '23:30', '00:30');
    expect(span.ms).toBe(H);
    expect([dayKey(span.end), span.end.getHours(), span.end.getMinutes()]).toEqual([nextKey(key), 0, 30]);
  });
});

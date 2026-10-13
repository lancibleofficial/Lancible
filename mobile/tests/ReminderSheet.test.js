// Лист напоминания (components/ReminderSheet.js). Запуск: npm run test:mobile
//
// Вид — строки с галочкой (12 октября 2026; были сегменты «До… · Один раз ·
// Повторять» и под ними ещё сегменты якоря): «До начала» и «До дедлайна» —
// только те, что есть у задачи (нет обоих — тихая строка «Добавьте время
// работы или дедлайн»), «Один раз», «Повторять». Параметры — под списком:
// чипы пресетов и своё число с единицей чипами; дата и время строками с
// выбором под строкой; частота — строками, дни и число месяца — квадратами.
// Правила — в ядре (core/reminders.js, tests/unit/reminders.test.js); здесь
// проверяется лист: какие виды он предлагает, как собирает смещение, чем
// кончается «Сохранить» и «Удалить».
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import ReminderSheet from '../src/components/ReminderSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors } from '../src/theme';
import Reminders from '../src/core/reminders.js';
import { t, T } from '../src/lib/i18n';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const iso = (day, h, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const baseTask = {
  id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], sessions: [],
};
const slot = { id: 'sl1', start: iso(17, 10), end: iso(17, 12) };
const daily = { freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };

const setTask = (extra) => useAppStore.setState({ tasks: [{ ...baseTask, ...extra }] });
/** Задача со списком напоминаний — вместе с зеркалом старых полей, как её пишет стор. */
const setList = (list, extra) => {
  const task = { ...baseTask, ...extra };
  useAppStore.setState({ tasks: [{ ...task, ...Reminders.withReminders(task, list) }] });
};
const stored = () => useAppStore.getState().tasks[0];
const list = () => Reminders.remindersOf(stored());

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#69d345' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [],
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

async function show(reminderId) {
  openSheet(<ReminderSheet taskId="t1" reminderId={reminderId} />);
  return render(<BottomSheet />);
}
const footer = (s) => within(s.getByTestId('sheet-footer-content'));
const buttons = (s) => footer(s).getAllByTestId('primary-button');
const label = (node) => within(node).getByText(/./).props.children;
/** Строка или чип выбраны ли (галочка у строки — selected, у чипа — тоже). */
const on = (s, id) => !!s.getByTestId(id).props.accessibilityState.selected;
/** Подписи строк списка-выбора по порядку. */
const rows = (s, list) => within(s.getByTestId(list)).getAllByRole('radio').map((r) => within(r).getByText(/./).props.children);
const save = (s) => fireEvent.press(footer(s).getByText(t('ru', 'common.save')));

describe('виды — строки с галочкой', () => {
  test('новое у задачи с дедлайном: заголовок «Напоминание», «До дедлайна · Один раз · Повторять», выбрано «До дедлайна», внизу одна «Сохранить»', async () => {
    setTask({ dueAt: iso(18, 18) });
    const s = await show(null);
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'notif.reminder'));
    expect(rows(s, 'remind-kind')).toEqual([t('ru', 'remind.anchor_due'), t('ru', 'remind.kind_at'), t('ru', 'remind.kind_repeat')]);
    expect(on(s, 'remind-kind-due')).toBe(true);
    expect(buttons(s).map(label)).toEqual([t('ru', 'common.save')]);
    // Подсказки «нужен якорь» нет — якорь есть.
    expect(s.queryByTestId('remind-need-anchor')).toBeNull();
    // Сегментов в листе нет.
    expect(s.queryAllByRole('tab')).toHaveLength(0);
    expect(s.queryByTestId('remind-kind-pill')).toBeNull();
  });

  test('есть только время работы — строка «До начала», «До дедлайна» нет', async () => {
    setTask({ slots: [slot] });
    const s = await show(null);
    expect(rows(s, 'remind-kind')).toEqual([t('ru', 'remind.anchor_start'), t('ru', 'remind.kind_at'), t('ru', 'remind.kind_repeat')]);
    expect(on(s, 'remind-kind-start')).toBe(true);
    expect(s.queryByTestId('remind-kind-due')).toBeNull();
  });

  test('есть и то и другое — обе строки, по умолчанию «До начала»; выбор «До дедлайна» кладёт напоминание с этим якорем', async () => {
    setTask({ slots: [slot], dueAt: iso(18, 18) });
    const s = await show(null);
    expect(rows(s, 'remind-kind').slice(0, 2)).toEqual([t('ru', 'remind.anchor_start'), t('ru', 'remind.anchor_due')]);
    expect(on(s, 'remind-kind-start')).toBe(true);
    await fireEvent.press(s.getByTestId('remind-kind-due'));
    expect(on(s, 'remind-kind-due')).toBe(true);
    expect(on(s, 'remind-kind-start')).toBe(false);
    // Чип «в момент» — у своего якоря.
    s.getByText(t('ru', 'remind.at'));
    await save(s);
    expect(list()).toEqual([expect.objectContaining({ kind: 'before', anchor: 'due', offsetMin: 15 })]);
  });

  test('нет ни времени работы, ни дедлайна — вместо «До…» тихая строка-подсказка, она не нажимается; выбран «Один раз»', async () => {
    setTask({});
    const { result } = await renderHook(() => useColors());
    const s = await show(null);
    const need = s.getByTestId('remind-need-anchor');
    within(need).getByText(t('ru', 'remind.need_anchor'));
    expect(need.props.accessibilityState.disabled).toBe(true);
    expect(flat(within(need).getByText(t('ru', 'remind.need_anchor'))).color).toBe(result.current.textFaint);
    expect(on(s, 'remind-kind-at')).toBe(true);
    await fireEvent.press(need);
    expect(on(s, 'remind-kind-at')).toBe(true);
    expect(need.props.accessibilityState.selected).toBe(false);
    expect(s.queryByTestId('remind-kind-start')).toBeNull();
    expect(s.queryByTestId('remind-kind-due')).toBeNull();
  });

  test('у напоминания, чьего якоря у задачи уже нет (дедлайн сняли), строка «До дедлайна» на месте и выбрана — его можно прочитать и поправить', async () => {
    setList([{ id: 'a', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' }], { dueAt: iso(18, 18) });
    useAppStore.setState({ tasks: [{ ...stored(), dueAt: null }] });
    const s = await show('a');
    expect(s.queryByTestId('remind-need-anchor')).toBeNull();
    expect(on(s, 'remind-kind-due')).toBe(true);
    expect(s.queryByTestId('remind-kind-start')).toBeNull();
  });

  test('ключа «До…» (вида, который теперь — две строки) в словарях нет', () => {
    for (const lang of ['ru', 'en', 'uk', 'kk']) expect('remind.kind_before' in T[lang]).toBe(false);
  });
});

describe('«До…»: чипы, своё число и единица', () => {
  test('чипы — из пресетов ядра; у «до дедлайна» первый — «В момент дедлайна», у «до начала» — «В момент начала»', async () => {
    expect(Reminders.REMIND_PRESETS).toEqual([0, 5, 15, 60, 1440]);
    setTask({ dueAt: iso(18, 18) });
    const due = await show(null);
    for (const text of [t('ru', 'remind.at'), `5 ${t('ru', 'remind.unit_min')}`, `15 ${t('ru', 'remind.unit_min')}`, `1 ${t('ru', 'remind.unit_hour')}`, '1 день']) due.getByText(text);
    expect(due.queryByText(t('ru', 'remind.at_start'))).toBeNull();

    setTask({ slots: [slot] });
    const start = await show(null);
    start.getByText(t('ru', 'remind.at_start'));
  });

  test('единица — чипы «мин · ч · дн», не сегменты', async () => {
    setTask({ dueAt: iso(18, 18) });
    const s = await show(null);
    const unit = s.getByTestId('remind-unit');
    expect(within(unit).getAllByRole('button').map((b) => within(b).getByText(/./).props.children))
      .toEqual([t('ru', 'remind.unit_min'), t('ru', 'remind.unit_hour'), t('ru', 'remind.unit_day')]);
    expect(within(unit).queryAllByRole('tab')).toHaveLength(0);
    expect(on(s, 'remind-unit-min')).toBe(true);
  });

  test('по умолчанию выбрано «15 мин»; нажатие на чип переставляет число и единицу, «Сохранить» кладёт напоминание', async () => {
    setTask({ dueAt: iso(18, 18) });
    const s = await show(null);
    expect(on(s, 'remind-preset-15')).toBe(true);
    expect(s.getByTestId('remind-n').props.value).toBe('15');
    await fireEvent.press(s.getByTestId('remind-preset-60'));
    expect(on(s, 'remind-preset-60')).toBe(true);
    expect(on(s, 'remind-preset-15')).toBe(false);
    // 60 минут — это «1 ч»: число и единица подставлены по ядру (splitOffset).
    expect(s.getByTestId('remind-n').props.value).toBe('1');
    expect(on(s, 'remind-unit-hour')).toBe(true);
    await save(s);
    expect(list()).toEqual([expect.objectContaining({ kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour', notifiedUpTo: null })]);
    expect(stored()).toMatchObject({ remindOffsetMin: 60, remindAt: null });
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('«В момент»: смещение 0 — отдельный чип', async () => {
    setTask({ dueAt: iso(18, 18) });
    const s = await show(null);
    await fireEvent.press(s.getByTestId('remind-preset-0'));
    expect(s.getByTestId('remind-n').props.value).toBe('0');
    await save(s);
    expect(list()[0]).toMatchObject({ offsetMin: 0 });
  });

  test('своё число и единица: 90 мин → записано как введено; открыли снова — те же «90» и «мин»; сменили единицу — другое смещение', async () => {
    setTask({ dueAt: iso(18, 18) });
    let s = await show(null);
    await fireEvent.changeText(s.getByTestId('remind-n'), '90');
    // Ни один из чипов не выбран: 90 минут среди пресетов нет.
    for (const min of Reminders.REMIND_PRESETS) expect(on(s, `remind-preset-${min}`)).toBe(false);
    await save(s);
    const id = list()[0].id;
    expect(list()[0]).toMatchObject({ offsetMin: 90, unit: 'min' });

    s = await show(id);
    expect(s.getByTestId('remind-n').props.value).toBe('90');
    expect(on(s, 'remind-unit-min')).toBe(true);
    await fireEvent.changeText(s.getByTestId('remind-n'), '2');
    await fireEvent.press(s.getByTestId('remind-unit-hour'));
    await save(s);
    expect(list()).toHaveLength(1);
    expect(list()[0]).toMatchObject({ id, offsetMin: 120, unit: 'hour' });

    s = await show(id);
    expect(s.getByTestId('remind-n').props.value).toBe('2');
    expect(on(s, 'remind-unit-hour')).toBe(true);
    await fireEvent.press(s.getByTestId('remind-unit-day'));
    await fireEvent.changeText(s.getByTestId('remind-n'), '3');
    await save(s);
    expect(list()[0]).toMatchObject({ offsetMin: 4320, unit: 'day' });
    expect(stored().remindOffsetMin).toBe(4320);
  });

  test('в поле — только цифры: буквы и знаки отбрасываются', async () => {
    setTask({ dueAt: iso(18, 18) });
    const s = await show(null);
    await fireEvent.changeText(s.getByTestId('remind-n'), '1a5.-');
    expect(s.getByTestId('remind-n').props.value).toBe('15');
  });

  test('потолок — 60 дней: больше — красное поле и подсказка, «Сохранить» ничего не пишет; ровно 60 — проходит', async () => {
    setTask({ dueAt: iso(18, 18) });
    const { result } = await renderHook(() => useColors());
    const s = await show(null);
    await fireEvent.press(s.getByTestId('remind-unit-day'));
    await fireEvent.changeText(s.getByTestId('remind-n'), '61');
    expect(s.getByTestId('remind-error').props.children).toBe(t('ru', 'remind.too_far', { n: 60 }));
    expect(flat(s.getByTestId('remind-error')).color).toBe(result.current.danger);
    expect(flat(s.getByTestId('remind-n')).borderColor).toBe(result.current.danger);
    await save(s);
    expect(list()).toEqual([]);
    expect(useSheetStore.getState().content).not.toBeNull();

    await fireEvent.changeText(s.getByTestId('remind-n'), '60');
    expect(s.queryByTestId('remind-error')).toBeNull();
    await save(s);
    expect(list()[0]).toMatchObject({ offsetMin: Reminders.REMIND_MAX_OFFSET_MIN, unit: 'day' });
  });

  test('потолок в часах и минутах считается так же: 1441 час и 86401 минута — за пределом', async () => {
    setTask({ dueAt: iso(18, 18) });
    const s = await show(null);
    await fireEvent.press(s.getByTestId('remind-unit-hour'));
    await fireEvent.changeText(s.getByTestId('remind-n'), '1441');
    s.getByTestId('remind-error');
    await fireEvent.changeText(s.getByTestId('remind-n'), '1440');
    expect(s.queryByTestId('remind-error')).toBeNull();
    await fireEvent.press(s.getByTestId('remind-unit-min'));
    await fireEvent.changeText(s.getByTestId('remind-n'), '86401');
    s.getByTestId('remind-error');
  });

  test('пустое поле — без подсказки, но и без сохранения', async () => {
    setTask({ dueAt: iso(18, 18) });
    const s = await show(null);
    await fireEvent.changeText(s.getByTestId('remind-n'), '');
    expect(s.queryByTestId('remind-error')).toBeNull();
    await save(s);
    expect(list()).toEqual([]);
  });
});

describe('«Один раз»', () => {
  test('по умолчанию — ближайший целый час; «Сохранить» кладёт напоминание «один раз» и зеркалит его в remindAt', async () => {
    setTask({});
    const s = await show(null);
    const next = new Date();
    next.setHours(next.getHours() + 1, 0, 0, 0);
    await save(s);
    expect(list()).toEqual([expect.objectContaining({ kind: 'at', at: next.toISOString(), notifiedAt: null })]);
    expect(stored()).toMatchObject({ remindAt: next.toISOString(), remindOffsetMin: null });
  });

  test('дата и время — строки острова «Дата ›» и «Время ›»; выбор раскрывается под строкой, открыта одна', async () => {
    setTask({});
    const s = await show(null);
    const date = s.getByTestId('remind-date');
    const time = s.getByTestId('remind-time');
    within(date).getByText(t('ru', 'sdlg.date_label'));
    within(time).getByText(t('ru', 'due.time'));
    expect(date.props.accessibilityState.expanded).toBe(false);
    expect(s.queryByTestId('time-columns')).toBeNull();
    await fireEvent.press(time);
    s.getByTestId('time-columns');
    expect(s.getByTestId('remind-time').props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(s.getByTestId('remind-date'));
    expect(s.queryByTestId('time-columns')).toBeNull();
    expect(s.getByTestId('remind-date').props.accessibilityState.expanded).toBe(true);
  });

  test('правка существующего меняет только то, что выбрали', async () => {
    setList([{ id: 'a', kind: 'at', at: iso(20, 9) }], { dueAt: iso(25, 18) });
    const s = await show('a');
    expect(on(s, 'remind-kind-at')).toBe(true);
    // Дата: открыли календарь, выбрали 22-е (месяц — октябрь 2026, как у напоминания).
    await fireEvent.press(s.getByTestId('remind-date'));
    await fireEvent.press(s.getByText('22'));
    // Время: открыли строку, выбрали 14 часов и 30 минут.
    await fireEvent.press(s.getByText(t('ru', 'due.time')));
    await fireEvent.press(within(s.getByTestId('time-columns')).getByText('14'));
    await fireEvent.press(within(s.getByTestId('time-columns')).getByText('30'));
    await save(s);
    expect(list()).toEqual([expect.objectContaining({ id: 'a', kind: 'at', at: iso(22, 14, 30) })]);
    expect(stored().remindAt).toBe(iso(22, 14, 30));
  });

  test('нет ни дедлайна, ни времени работы — «Один раз» доступно и сохраняется', async () => {
    setTask({});
    const s = await show(null);
    await fireEvent.press(s.getByTestId('remind-date'));
    await save(s);
    expect(list()).toHaveLength(1);
  });
});

describe('«Повторять»', () => {
  test('частота — строки «Каждый день · Каждую неделю · Каждый месяц»; «каждый день» кладёт правило, время 09:00 и начало отсчёта «сейчас»', async () => {
    setTask({});
    const s = await show(null);
    await fireEvent.press(s.getByTestId('remind-kind-repeat'));
    expect(rows(s, 'remind-freq')).toEqual([t('ru', 'repeat.daily'), t('ru', 'repeat.weekly'), t('ru', 'repeat.monthly')]);
    s.getByText(t('ru', 'remind.how_often'));
    expect(on(s, 'remind-freq-day')).toBe(true);
    within(s.getByTestId('remind-time')).getByText('09:00');
    const before = Date.now();
    await save(s);
    const rem = list()[0];
    expect(rem).toMatchObject({ kind: 'repeat', time: '09:00', rule: expect.objectContaining({ freq: 'day', every: 1 }) });
    expect(Date.parse(rem.start)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(rem.start)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(stored()).toMatchObject({ remindOffsetMin: null, remindAt: null });
  });

  test('неделя: дни недели квадратами, последний день не снимается; число месяца скрыто', async () => {
    setList([{ id: 'a', kind: 'repeat', rule: { ...daily, freq: 'week', weekdays: [1] }, time: '08:00', start: iso(12, 8) }]);
    const s = await show('a');
    expect(on(s, 'remind-freq-week')).toBe(true);
    expect(s.queryByTestId('monthday-chips')).toBeNull();
    const day = (d) => s.getByTestId(`weekday-chips-${d}`).props.accessibilityState.selected;
    expect(day(1)).toBe(true);
    await fireEvent.press(s.getByTestId('weekday-chips-1'));
    expect(day(1)).toBe(true); // единственный день не снимается
    await fireEvent.press(s.getByTestId('weekday-chips-3'));
    await fireEvent.press(s.getByTestId('weekday-chips-0'));
    expect([1, 3, 0].map(day)).toEqual([true, true, true]);
    await fireEvent.press(s.getByTestId('weekday-chips-1'));
    expect(day(1)).toBe(false);
    await save(s);
    expect(list()[0].rule.weekdays).toEqual([0, 3]);
    expect(list()[0]).toMatchObject({ id: 'a', time: '08:00' });
  });

  test('месяц: число 1…31 одним выбором, время; дни недели скрыты', async () => {
    setList([{ id: 'a', kind: 'repeat', rule: { ...daily, freq: 'month' }, time: '09:00', start: new Date(2026, 10, 5).toISOString() }]);
    const s = await show('a');
    expect(on(s, 'remind-freq-month')).toBe(true);
    expect(s.queryByTestId('weekday-chips')).toBeNull();
    expect(s.getByTestId('monthday-chips-5').props.accessibilityState.selected).toBe(true);
    for (const d of [1, 15, 31]) s.getByTestId(`monthday-chips-${d}`);
    expect(s.queryByTestId('monthday-chips-32')).toBeNull();
    await fireEvent.press(s.getByTestId('monthday-chips-31'));
    expect(s.getByTestId('monthday-chips-5').props.accessibilityState.selected).toBe(false);
    expect(s.getByTestId('monthday-chips-31').props.accessibilityState.selected).toBe(true);
    await save(s);
    const rem = list()[0];
    expect(Reminders.describeReminder(rem)).toMatchObject({ freq: 'month', monthDay: 31, time: '09:00' });
  });

  test('правка без перемен в расписании оставляет начало отсчёта и отметку «уже напомнили»', async () => {
    setList([{ id: 'a', kind: 'repeat', rule: { ...daily }, time: '09:00', start: iso(12, 8) }]);
    useAppStore.setState({ tasks: [{ ...stored(), reminders: stored().reminders.map((r) => ({ ...r, notifiedUpTo: iso(13, 9) })) }] });
    const s = await show('a');
    await save(s);
    expect(list()[0]).toMatchObject({ start: iso(12, 8), notifiedUpTo: iso(13, 9) });
  });

  test('сменили время — отсчёт заново, отметка снята', async () => {
    setList([{ id: 'a', kind: 'repeat', rule: { ...daily }, time: '09:00', start: iso(12, 8) }]);
    useAppStore.setState({ tasks: [{ ...stored(), reminders: stored().reminders.map((r) => ({ ...r, notifiedUpTo: iso(13, 9) })) }] });
    const s = await show('a');
    await fireEvent.press(s.getByText(t('ru', 'due.time')));
    await fireEvent.press(within(s.getByTestId('time-columns')).getByText('21'));
    await save(s);
    expect(list()[0]).toMatchObject({ time: '21:00', notifiedUpTo: null });
    expect(list()[0].start).not.toBe(iso(12, 8));
  });
});

describe('существующее напоминание', () => {
  test('внизу «Сохранить» и серая «Удалить напоминание» с красной подписью; «Удалить» убирает его и закрывает лист', async () => {
    setList([{ id: 'a', kind: 'before', anchor: 'due', offsetMin: 30, unit: 'min' }, { id: 'b', kind: 'at', at: iso(20, 9) }], { dueAt: iso(25, 18) });
    const { result } = await renderHook(() => useColors());
    const s = await show('a');
    const btns = buttons(s);
    expect(btns.map(label)).toEqual([t('ru', 'common.save'), t('ru', 'remind.delete')]);
    expect(flat(btns[1]).backgroundColor).toBe(result.current.panel2);
    expect(flat(within(btns[1]).getByText(t('ru', 'remind.delete'))).color).toBe(result.current.danger);
    await fireEvent.press(btns[1]);
    expect(list().map((r) => r.id)).toEqual(['b']);
    expect(stored()).toMatchObject({ remindOffsetMin: null, remindAt: iso(20, 9) });
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('вид и значения подставлены из напоминания: «до начала» за 2 часа — строка «До начала», «2» и «ч»', async () => {
    setList([{ id: 'a', kind: 'before', anchor: 'start', offsetMin: 120, unit: 'hour' }], { slots: [slot] });
    const s = await show('a');
    expect(on(s, 'remind-kind-start')).toBe(true);
    expect(s.queryByTestId('remind-kind-due')).toBeNull();
    expect(s.getByTestId('remind-n').props.value).toBe('2');
    expect(on(s, 'remind-unit-hour')).toBe(true);
  });

  test('«Сохранить» без правок отметку «уже напомнили» не снимает, а смена вида заменяет напоминание целиком', async () => {
    setList([{ id: 'a', kind: 'before', anchor: 'due', offsetMin: 30, unit: 'min' }], { dueAt: iso(25, 18) });
    useAppStore.setState({ tasks: [{ ...stored(), reminders: stored().reminders.map((r) => ({ ...r, notifiedUpTo: iso(25, 18) })) }] });
    let s = await show('a');
    await save(s);
    expect(list()[0]).toMatchObject({ id: 'a', notifiedUpTo: iso(25, 18) });

    s = await show('a');
    await fireEvent.press(s.getByTestId('remind-kind-at'));
    await save(s);
    expect(list()).toHaveLength(1);
    expect(list()[0]).toMatchObject({ id: 'a', kind: 'at' });
    expect('anchor' in list()[0]).toBe(false);
    expect('offsetMin' in list()[0]).toBe(false);
  });

  test('напоминание, которого уже нет (удалили с другого устройства), открывается как новое', async () => {
    setTask({ dueAt: iso(25, 18) });
    const s = await show('нет-такого');
    expect(buttons(s).map(label)).toEqual([t('ru', 'common.save')]);
  });
});

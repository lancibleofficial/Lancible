// Лист «Время работы» (components/SlotSheet.js). Запуск: npm run test:mobile
//
// Отрезок — когда заниматься задачей: дата, начало и конец — строки острова,
// выбор раскрывается под строкой. Своего повтора у отрезка нет (12 октября
// 2026, как у события в Google Календаре): правило одно — у задачи, и
// отрезок повторяется вместе с ней. В листе — сводка «Повторяется … вместе с
// задачей» или «Один раз» и строка «Повторение задачи ›»: страница этого же
// листа (RepeatSheet со стрелкой «назад»), она пишет правило задачи.
// Напоминаний у отрезка нет (с 11 октября 2026): «до начала» — общий список
// задачи (ReminderSheet). Сами правила (разбор, вхождения) — в ядре
// (core/slots.js, tests/unit/slots.test.js).
//
// Ни рабочих часов, ни рабочих дней у отрезка нет (18 октября 2026): часы —
// все 24, суббота 23:00 сохраняется без вопроса. Чужой отрезок в том же
// промежутке (Core.slotOverlaps, с повторами) — страница этого же листа
// «Время уже занято»: «В этом промежутке уже есть задача «X» (10:00–11:00).
// Создать в то же время?» с «Создать» и «Отмена»; у правки — «Сохранить».
// Слова и правила — те же, что у окна отрезка на вебе.
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import SlotSheet, { overlapText } from '../src/components/SlotSheet';
import SlotListSheet from '../src/components/SlotListSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors } from '../src/theme';
import Slots from '../src/core/slots.js';
import { t, T } from '../src/lib/i18n';
import { hm } from '../src/lib/sessions';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
// Суббота 17 октября 2026 — день для проверок «по будням» (ближайший — понедельник 19-го).
const iso = (day, h, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const baseTask = {
  id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], sessions: [],
};
const slot = (extra) => ({ id: 'sl1', start: iso(17, 10), end: iso(17, 12), notifiedUpTo: null, ...extra });
const weekly = { freq: 'week', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
const stored = () => useAppStore.getState().tasks[0];
const slotsOfStore = () => Slots.slotsOf(stored());
const patchTask = (patch) => useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => ({ ...x, ...patch })) }));

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{ ...baseTask, repeat: null, slots: [slot()] }],
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

async function show(slotId) {
  openSheet(<SlotSheet taskId="t1" slotId={slotId} />);
  return render(<BottomSheet />);
}
const footerButtons = (s) => within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button');
const label = (node) => within(node).getByText(/./).props.children;
const head = (s) => within(s.getByTestId('sheet-head-row'));

test('новый отрезок: заголовок «Время работы», строки «Дата · Начало · Конец», одна кнопка «Сохранить»', async () => {
  const s = await show(null);
  head(s).getByText(t('ru', 'slot.label'));
  for (const [id, key] of [['slot-date', 'sdlg.date_label'], ['slot-start', 'sdlg.start_label'], ['slot-end', 'sdlg.end_label']]) {
    const row = s.getByTestId(id);
    within(row).getByText(t('ru', key));
    expect(row.props.accessibilityState.expanded).toBe(false);
  }
  expect(footerButtons(s).map(label)).toEqual([t('ru', 'common.save')]);
});

test('выбора повтора в листе нет: ни чипов, ни строк-пресетов; ни ключа «повтор отрезка» в исходнике', async () => {
  const s = await show('sl1');
  for (const id of ['slot-repeat-once', 'slot-repeat-daily', 'slot-repeat-weekly', 'slot-repeat-weekdays_preset', 'slot-repeat-custom', 'repeat-preset']) {
    expect(s.queryByTestId(id)).toBeNull();
  }
  expect(s.queryByText(t('ru', 'repeat.daily'))).toBeNull();
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'SlotSheet.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  expect(src).not.toMatch(/repeat:\s*rule/);
  expect(src).not.toMatch(/mode="slot"/);
  expect(src).not.toMatch(/Chip/);
});

test('напоминания в листе нет: ни подписи, ни чипов; ключей, на которых они держались, в словарях тоже', async () => {
  const s = await show(null);
  expect(s.queryByTestId('slot-remind-none')).toBeNull();
  expect(s.queryByTestId('slot-remind-0')).toBeNull();
  expect(s.queryByText('Напомнить')).toBeNull();
  expect(s.queryByText(t('ru', 'remind.at_start'))).toBeNull();
  for (const lang of ['ru', 'en', 'uk', 'kk']) {
    for (const key of ['slot.remind_start', 'due.remind_at', 'remind.none', 'remind.15m']) expect(key in T[lang]).toBe(false);
  }
});

test('у задачи без повтора — одна строка «Повторение задачи · Не повторяется ›»', async () => {
  const s = await show('sl1');
  expect(s.queryByTestId('slot-repeat-info')).toBeNull();
  const row = s.getByTestId('slot-task-repeat');
  within(row).getByText(t('ru', 'repeat.dialog_title'));
  expect(s.getByTestId('slot-task-repeat-value').props.children).toBe(t('ru', 'repeat.none'));
});

test('у задачи с повтором значение строки — «Повторяется каждую неделю вместе с задачей»', async () => {
  patchTask({ repeat: weekly });
  const s = await show('sl1');
  expect(s.getByTestId('slot-task-repeat-value').props.children).toBe(t('ru', 'slot.repeat_with_task', { rule: 'каждую неделю' }));
});

test('«Сохранить» кладёт в задачу отрезок — только дату и часы, без своего повтора и напоминания, и закрывает лист', async () => {
  useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => ({ ...x, slots: [] })) }));
  const s = await show(null);
  await fireEvent.press(footerButtons(s)[0]);
  const list = slotsOfStore();
  expect(list).toHaveLength(1);
  expect(list[0].id).toBeTruthy();
  expect('repeat' in list[0]).toBe(false);
  expect('remindOffsetMin' in list[0]).toBe(false);
  expect(Date.parse(list[0].end)).toBeGreaterThan(Date.parse(list[0].start));
  expect(useSheetStore.getState().content).toBeNull();
});

test('у существующего отрезка внизу «Сохранить» и серая «Удалить время» с красной подписью', async () => {
  const s = await show('sl1');
  const { result } = await renderHook(() => useColors());
  const buttons = footerButtons(s);
  expect(buttons.map(label)).toEqual([t('ru', 'common.save'), t('ru', 'slot.delete')]);
  expect(flat(buttons[1]).backgroundColor).toBe(result.current.panel2);
  expect(flat(within(buttons[1]).getByText(t('ru', 'slot.delete'))).color).toBe(result.current.danger);
});

test('«Удалить время» убирает отрезок и закрывает лист', async () => {
  const s = await show('sl1');
  await fireEvent.press(footerButtons(s)[1]);
  expect(slotsOfStore()).toEqual([]);
  expect(useSheetStore.getState().content).toBeNull();
});

test('начало — строка «Начало · 10:00 ›»: часы раскрываются под ней; конец не позже начала — ошибка, «Сохранить» ничего не пишет', async () => {
  const s = await show('sl1');
  expect(s.queryByTestId('slot-error')).toBeNull();
  within(s.getByTestId('slot-start')).getByText('10:00');
  // Начало 10:00 → 13:00, конец остаётся 12:00.
  await fireEvent.press(s.getByText(t('ru', 'sdlg.start_label')));
  expect(s.getByTestId('slot-start').props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(within(s.getByTestId('time-columns')).getByText('13'));
  within(s.getByTestId('slot-start')).getByText('13:00');
  expect(s.getByTestId('slot-error').props.children).toBe(t('ru', 'slot.end_before_start'));
  const before = stored();
  await fireEvent.press(footerButtons(s)[0]);
  expect(stored()).toBe(before);
  expect(useSheetStore.getState().content).not.toBeNull();
});

test('правило задачи «по будням»: первое вхождение — только подходящий день, суббота сдвигается на понедельник', async () => {
  patchTask({ repeat: { ...weekly, weekdays: [1, 2, 3, 4, 5] } });
  const s = await show('sl1');
  await fireEvent.press(footerButtons(s)[0]);
  const saved = slotsOfStore()[0];
  const first = new Date(saved.start);
  expect(first.getDay()).toBe(1);
  expect(first.getDate()).toBe(19);
  // Время суток и длительность те же.
  expect(first.getHours()).toBe(10);
  expect(Date.parse(saved.end) - Date.parse(saved.start)).toBe(2 * 3_600_000);
});

test('«Повторение задачи ›» — страница внутри листа со стрелкой «назад»; «Готово» пишет правило задачи и возвращает на форму', async () => {
  const s = await show('sl1');
  await fireEvent.press(s.getByTestId('slot-task-repeat'));
  head(s).getByText(t('ru', 'repeat.dialog_title'));
  head(s).getByLabelText(t('ru', 'common.back'));
  // Тот же лист повтора, что у задачи: строки и «Отсчёт» в тонкой настройке.
  await fireEvent.press(s.getByTestId('repeat-daily'));
  await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.done')));
  head(s).getByText(t('ru', 'slot.label'));
  expect(stored().repeat).toMatchObject({ freq: 'day', every: 1 });
  // Отрезок своего правила не получил; сводка — по правилу задачи.
  expect('repeat' in slotsOfStore()[0]).toBe(false);
  expect(s.getByTestId('slot-task-repeat-value').props.children).toBe(t('ru', 'slot.repeat_with_task', { rule: 'каждый день' }));
  // Подвал формы вернулся.
  expect(footerButtons(s).map(label)).toEqual([t('ru', 'common.save'), t('ru', 'slot.delete')]);
});

test('«назад» со страницы повтора ничего не пишет; «Не повторяется» снимает правило задачи', async () => {
  patchTask({ repeat: weekly });
  const s = await show('sl1');
  await fireEvent.press(s.getByTestId('slot-task-repeat'));
  await fireEvent.press(s.getByTestId('repeat-daily'));
  await fireEvent.press(head(s).getByLabelText(t('ru', 'common.back')));
  expect(stored().repeat).toMatchObject({ freq: 'week' });
  await fireEvent.press(s.getByTestId('slot-task-repeat'));
  await fireEvent.press(s.getByTestId('repeat-none'));
  await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.done')));
  expect(stored().repeat).toBeNull();
  expect(s.getByTestId('slot-task-repeat-value').props.children).toBe(t('ru', 'repeat.none'));
});

test('список отрезков: тап по строке — отрезок страницей этого же листа (лист не меняется), «назад» — к списку', async () => {
  openSheet(<SlotListSheet taskId="t1" />);
  const s = await render(<BottomSheet />);
  const content = useSheetStore.getState().content;
  head(s).getByText(t('ru', 'slot.label'));
  await fireEvent.press(s.getByTestId('slot-list-sl1'));
  expect(useSheetStore.getState().content).toBe(content);
  s.getByTestId('slot-date');
  head(s).getByLabelText(t('ru', 'common.back'));
  await fireEvent.press(head(s).getByLabelText(t('ru', 'common.back')));
  s.getByTestId('slot-list-sl1');
  expect(s.queryByTestId('slot-date')).toBeNull();
  // «Сохранить» на странице отрезка тоже возвращает к списку.
  await fireEvent.press(s.getByTestId('slot-list-add'));
  await fireEvent.press(footerButtons(s)[0]);
  expect(useSheetStore.getState().content).toBe(content);
  expect(slotsOfStore()).toHaveLength(2);
  s.getByTestId('slot-list-add');
});

describe('пересечение с другой задачей — вопрос страницей этого же листа', () => {
  const pad2 = (n) => String(n).padStart(2, '0');
  const other = (start, end, extra) => ({ ...baseTask, id: 't2', title: 'Созвон', repeat: null, slots: [{ id: 'o1', start, end }], ...extra });
  const withOther = (o, ownSlots = []) => useAppStore.setState((st) => ({ tasks: [{ ...st.tasks[0], slots: ownSlots }, o] }));
  const t1Slots = () => Slots.slotsOf(useAppStore.getState().tasks.find((x) => x.id === 't1'));
  // Новый отрезок встаёт сегодня на ближайший целый час (ночью — на 10:00).
  const nextHour = () => { const h = new Date().getHours() + 1; return h <= 22 ? h : 10; };
  const today = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const question = (title, from, to, verb = 'Создать') => `В этом промежутке уже есть задача «${title}» (${from}–${to}). ${verb} в то же время?`;

  test('новый отрезок поверх чужого: «Сохранить» спрашивает; «Отмена» — назад к форме, ничего не пишет; «Создать» создаёт', async () => {
    const h = nextHour();
    withOther(other(today(h), today(h + 1)));
    const s = await show(null);
    await fireEvent.press(footerButtons(s)[0]);
    s.getByText(question('Созвон', `${pad2(h)}:00`, `${pad2(h + 1)}:00`));
    expect(footerButtons(s).map(label)).toEqual(['Создать', 'Отмена']);
    head(s).getByText('Время уже занято');
    head(s).getByLabelText(t('ru', 'common.back'));
    expect(t1Slots()).toEqual([]);
    // «Отмена» — к форме: лист открыт, отрезка нет.
    await fireEvent.press(footerButtons(s)[1]);
    s.getByTestId('slot-date');
    expect(t1Slots()).toEqual([]);
    expect(useSheetStore.getState().content).not.toBeNull();
    // Снова «Сохранить» → «Создать»: отрезок в задаче, лист закрыт.
    await fireEvent.press(footerButtons(s)[0]);
    await fireEvent.press(footerButtons(s)[0]);
    expect(t1Slots()).toHaveLength(1);
    expect(hm(t1Slots()[0].start)).toBe(`${pad2(h)}:00`);
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('правка своего отрезка поверх чужого — «Сохранить в то же время?»; «Сохранить» переносит', async () => {
    withOther(other(iso(17, 13), iso(17, 14)), [slot()]);
    const s = await show('sl1');
    // Конец 12:00 → 14:00: 10:00–14:00 накрывает чужие 13:00–14:00.
    await fireEvent.press(s.getByText(t('ru', 'sdlg.end_label')));
    await fireEvent.press(within(s.getByTestId('time-columns')).getByText('14'));
    await fireEvent.press(footerButtons(s)[0]);
    s.getByText(question('Созвон', '13:00', '14:00', 'Сохранить'));
    expect(footerButtons(s).map(label)).toEqual(['Сохранить', 'Отмена']);
    expect(hm(t1Slots()[0].end)).toBe('12:00');
    await fireEvent.press(footerButtons(s)[0]);
    expect(hm(t1Slots()[0].end)).toBe('14:00');
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('из списка отрезков «Создать» возвращает к списку, а не закрывает лист', async () => {
    const h = nextHour();
    withOther(other(today(h), today(h + 1)), [slot()]);
    openSheet(<SlotListSheet taskId="t1" />);
    const s = await render(<BottomSheet />);
    const content = useSheetStore.getState().content;
    await fireEvent.press(s.getByTestId('slot-list-add'));
    await fireEvent.press(footerButtons(s)[0]);
    s.getByText(question('Созвон', `${pad2(h)}:00`, `${pad2(h + 1)}:00`));
    await fireEvent.press(footerButtons(s)[0]);
    expect(useSheetStore.getState().content).toBe(content);
    s.getByTestId('slot-list-add');
    expect(t1Slots()).toHaveLength(2);
  });

  test('правка, не сдвинувшая время, заново не спрашивает', async () => {
    withOther(other(iso(17, 11), iso(17, 12)), [slot()]);
    const s = await show('sl1');
    await fireEvent.press(footerButtons(s)[0]);
    expect(s.queryByText(/в то же время/)).toBeNull();
    expect(useSheetStore.getState().content).toBeNull();
  });

  test.each([
    ['касание краями', (h) => other(today(h + 1), today(h + 2))],
    ['закрытая задача', (h) => other(today(h), today(h + 1), { done: true })],
  ])('%s — не пересечение: сохраняется без вопроса', async (_, make) => {
    withOther(make(nextHour()));
    const s = await show(null);
    await fireEvent.press(footerButtons(s)[0]);
    expect(t1Slots()).toHaveLength(1);
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('суббота 23:00 — без вопроса и без рабочих часов: столбцы часов — все 24', async () => {
    // Суббота 17 октября 2026; у другой задачи — утро того же дня.
    withOther(other(iso(17, 10), iso(17, 11)), [slot()]);
    const s = await show('sl1');
    await fireEvent.press(s.getByText(t('ru', 'sdlg.start_label')));
    const cols = within(s.getByTestId('time-columns'));
    for (const hh of ['01', '06', '23']) cols.getByText(hh);
    await fireEvent.press(cols.getByText('23'));
    await fireEvent.press(s.getByText(t('ru', 'sdlg.end_label')));
    await fireEvent.press(within(s.getByTestId('time-columns')).getByText('23'));
    await fireEvent.press(within(s.getByTestId('time-columns')).getByText('55'));
    within(s.getByTestId('slot-start')).getByText('23:00');
    within(s.getByTestId('slot-end')).getByText('23:55');
    await fireEvent.press(footerButtons(s)[0]);
    expect(s.queryByText(/в то же время/)).toBeNull();
    const saved = t1Slots()[0];
    expect(new Date(saved.start).getDay()).toBe(6);
    expect(hm(saved.start)).toBe('23:00');
    expect(hm(saved.end)).toBe('23:55');
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('несколько задач — до трёх по имени и «и ещё N»; одно вхождение дважды — один раз', () => {
    const hit = (title, h) => ({ taskId: title, title, start: iso(17, h), end: iso(17, h + 1) });
    expect(overlapText([hit('А', 10), hit('Б', 11), hit('А', 10)], 'ru'))
      .toBe('В этом промежутке уже есть задачи: «А» (10:00–11:00), «Б» (11:00–12:00). Создать в то же время?');
    expect(overlapText([hit('А', 10), hit('Б', 11), hit('В', 12), hit('Г', 13), hit('Д', 14)], 'ru', true))
      .toBe('В этом промежутке уже есть задачи: «А» (10:00–11:00), «Б» (11:00–12:00), «В» (12:00–13:00) и ещё 2. Сохранить в то же время?');
    expect(overlapText([{ ...hit('', 10) }], 'ru')).toContain('«Без названия»');
    for (const lang of ['ru', 'en', 'uk', 'kk']) expect(overlapText([hit('А', 10)], lang)).toContain('А');
  });
});

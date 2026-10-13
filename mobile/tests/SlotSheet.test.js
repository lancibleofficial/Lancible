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
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import SlotSheet from '../src/components/SlotSheet';
import SlotListSheet from '../src/components/SlotListSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors } from '../src/theme';
import Slots from '../src/core/slots.js';
import { t, T } from '../src/lib/i18n';

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

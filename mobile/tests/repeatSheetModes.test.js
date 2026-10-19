// Лист повтора (components/RepeatSheet.js): строки, «Настроить…», якорь,
// вложенный вид. Запуск: npm run test:mobile
//
// 12 октября 2026 лист стал строками с галочкой, как список повтора в
// календарях: «Не повторяется · Каждый день · Каждую неделю · По будням ·
// Каждый месяц · Каждый год · Настроить…». «Настроить…» раскрывает под
// списком тонкую настройку (каждые N, дни, по числу или дню недели, отсчёт,
// окончание, копии), внизу сводка, подвал — одна «Готово». У отрезка своего
// повтора больше нет (core/slots.js) — режима «slot» у листа тоже.
import { render, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import RepeatSheet, { endDayKey } from '../src/components/RepeatSheet';
import { fixRepeatEnds } from '../src/lib/migrate';
import Repeat from '../src/core/repeat.js';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

const weekly = { freq: 'week', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
const custom = { ...weekly, every: 2, weekdays: [2] };
const noop = () => {};
const ANCHOR = new Date(2026, 9, 17, 10, 0).toISOString();

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' } });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

const show = (props) => {
  openSheet(<RepeatSheet lang="ru" rule={weekly} onApply={noop} onClear={noop} {...props} />);
  return render(<BottomSheet />);
};
const on = (s, id) => !!s.getByTestId(id).props.accessibilityState.selected;
// Переключатель: на iOS — системный (value), на Android — свой (accessibilityState).
const checked = (n) => (n.props.accessibilityState && 'checked' in n.props.accessibilityState ? n.props.accessibilityState.checked : n.props.value);
const done = (s) => fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.done')));

describe('строки с галочкой', () => {
  test('семь строк по порядку; у правила-пресета выбрана его строка; тонкой настройки не видно', async () => {
    const s = await show({ anchorAt: ANCHOR });
    const labels = within(s.getByTestId('repeat-preset')).getAllByRole('radio').map((r) => within(r).getByText(/./).props.children);
    expect(labels).toEqual([
      t('ru', 'repeat.none'), t('ru', 'repeat.daily'), t('ru', 'repeat.weekly'), t('ru', 'repeat.weekdays_preset'),
      t('ru', 'repeat.monthly'), t('ru', 'repeat.yearly'), t('ru', 'repeat.custom'),
    ]);
    expect(on(s, 'repeat-weekly')).toBe(true);
    expect(s.queryByText(t('ru', 'repeat.every'))).toBeNull();
    expect(s.queryAllByRole('tab')).toHaveLength(0);
  });

  test('правила нет — выбрано «Не повторяется», сводка так и говорит; «Готово» зовёт onClear', async () => {
    const onClear = jest.fn();
    const onApply = jest.fn();
    const s = await show({ rule: null, onClear, onApply });
    expect(on(s, 'repeat-none')).toBe(true);
    expect(s.getByTestId('repeat-summary').props.children).toBe(t('ru', 'repeat.none'));
    await done(s);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('строка пресета — его правило по «Готово»; «По будням» — неделя с Пн–Пт', async () => {
    const onApply = jest.fn();
    const s = await show({ rule: null, onApply });
    await fireEvent.press(s.getByTestId('repeat-weekdays_preset'));
    expect(on(s, 'repeat-weekdays_preset')).toBe(true);
    expect(on(s, 'repeat-none')).toBe(false);
    await done(s);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ freq: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] }));
  });

  test('тот же пресет, что был, — прежнее правило со своим счётом вхождений', async () => {
    const onApply = jest.fn();
    const s = await show({ rule: { ...weekly, done: 4 }, onApply });
    await done(s);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ freq: 'week', done: 4 }));
  });

  test('нестандартное правило — выбрана «Настроить…», и тонкая настройка уже раскрыта', async () => {
    const s = await show({ rule: custom, anchorAt: ANCHOR });
    expect(on(s, 'repeat-custom')).toBe(true);
    s.getByText(t('ru', 'repeat.every'));
    expect(s.getByLabelText(t('ru', 'repeat.every')).props.value).toBe('2');
  });

  test('«Настроить…» продолжает с выбранного пресета: «Каждый день» → каждые 1 дн.; правка числа и единицы уходит по «Готово»', async () => {
    const onApply = jest.fn();
    const s = await show({ rule: null, onApply });
    await fireEvent.press(s.getByTestId('repeat-daily'));
    await fireEvent.press(s.getByTestId('repeat-custom'));
    expect(on(s, 'repeat-freq-day')).toBe(true);
    expect(s.getByLabelText(t('ru', 'repeat.every')).props.value).toBe('1');
    await fireEvent.changeText(s.getByLabelText(t('ru', 'repeat.every')), '3');
    await fireEvent.press(s.getByTestId('repeat-freq-week'));
    await fireEvent.press(s.getByTestId('weekday-chips-2'));
    await done(s);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ freq: 'week', every: 3, weekdays: [2] }));
  });

  test('месяц: «по числу / по дню недели» — строки с галочкой', async () => {
    const onApply = jest.fn();
    const s = await show({ rule: { ...custom, freq: 'month', weekdays: [] }, onApply });
    const rows = within(s.getByTestId('repeat-month-mode')).getAllByRole('radio');
    expect(rows.map((r) => within(r).getByText(/./).props.children)).toEqual([t('ru', 'repeat.month_mode_day'), t('ru', 'repeat.month_mode_weekday')]);
    await fireEvent.press(rows[1]);
    await done(s);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ freq: 'month', monthMode: 'weekday' }));
  });

  test('окончание: строки «Никогда · После · До даты»; «После» — поле числа с «раз», «До даты» — строка даты с календарём под ней', async () => {
    const onApply = jest.fn();
    const s = await show({ rule: custom, onApply });
    const ends = within(s.getByTestId('repeat-ends'));
    expect(ends.getAllByRole('radio').map((r) => within(r).getByText(/./).props.children))
      .toEqual([t('ru', 'repeat.ends_never'), t('ru', 'repeat.ends_after'), t('ru', 'repeat.ends_on')]);
    await fireEvent.press(ends.getByText(t('ru', 'repeat.ends_after')));
    await fireEvent.changeText(s.getByLabelText(t('ru', 'repeat.ends_after')), '5');
    s.getByText(t('ru', 'repeat.ends_times'));
    await fireEvent.press(within(s.getByTestId('repeat-ends')).getByText(t('ru', 'repeat.ends_on')));
    // Даты ещё нет — календарь сразу раскрыт под строкой.
    expect(s.getByTestId('repeat-ends-at').props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(s.getByText('20'));
    expect(s.getByTestId('repeat-ends-at').props.accessibilityState.expanded).toBe(false);
    await done(s);
    expect(onApply.mock.calls[0][0].ends.kind).toBe('on');
    // День окончания — ключом дня, как его ждёт ядро (17 октября 2026; был ISO-момент).
    const now = new Date();
    expect(onApply.mock.calls[0][0].ends.at).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-20`);
  });
});

// 17 октября 2026: лист писал «До даты» ISO-моментом, а nextDue ядра ждёт
// день (`${ends.at}T23:59:59`) — серия с окончанием не кончалась никогда.
describe('окончание «До даты» — днём', () => {
  test('записанный день ядро понимает: после него следующего срока нет', async () => {
    const onApply = jest.fn();
    const s = await show({ rule: { ...custom, every: 1, weekdays: [], ends: { kind: 'on', count: 10, at: '2026-10-20' } }, onApply });
    await done(s);
    const rule = onApply.mock.calls[0][0];
    expect(rule.ends.at).toBe('2026-10-20');
    expect(Repeat.nextDue(rule, new Date(2026, 9, 12, 10, 0).getTime())).toBe(new Date(2026, 9, 19, 10, 0).getTime());
    expect(Repeat.nextDue(rule, new Date(2026, 9, 19, 10, 0).getTime())).toBeNull();
  });

  test('старое значение ISO-моментом читается днём: строка показывает его, «Готово» пишет ключ дня', async () => {
    const onApply = jest.fn();
    const old = new Date(2026, 11, 31).toISOString();
    const s = await show({ rule: { ...custom, ends: { kind: 'on', count: 10, at: old } }, onApply });
    within(s.getByTestId('repeat-ends-at')).getByText(new Date(2026, 11, 31).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }));
    await done(s);
    expect(onApply.mock.calls[0][0].ends.at).toBe('2026-12-31');
  });

  test('endDayKey: день остаётся днём, момент — местным днём, мусор — null', () => {
    expect(endDayKey('2026-12-31')).toBe('2026-12-31');
    expect(endDayKey(new Date(2026, 0, 5, 0, 0).toISOString())).toBe('2026-01-05');
    expect(endDayKey('завтра')).toBeNull();
    expect(endDayKey(null)).toBeNull();
  });

  test('при чтении сохранённого состояния старые окончания приводятся к дню, повторный прогон ничего не меняет', () => {
    const tasks = [
      { id: 'a', repeat: { ...custom, ends: { kind: 'on', count: 10, at: new Date(2026, 11, 31).toISOString() } } },
      { id: 'b', repeat: { ...custom, ends: { kind: 'on', count: 10, at: '2026-11-01' } } },
      { id: 'c', repeat: null },
    ];
    fixRepeatEnds(tasks);
    expect(tasks.map((x) => x.repeat && x.repeat.ends.at)).toEqual(['2026-12-31', '2026-11-01', null]);
    const again = JSON.stringify(tasks);
    fixRepeatEnds(tasks);
    expect(JSON.stringify(tasks)).toBe(again);
  });
});

describe('«Отсчёт» и копии', () => {
  test('у задачи с якорем (дедлайн или разовое время работы) — «Отсчёт» строками и «Оставлять копии» на месте', async () => {
    const s = await show({ anchorAt: ANCHOR, rule: custom });
    s.getByText(t('ru', 'repeat.from_label'));
    expect(within(s.getByTestId('repeat-from')).getAllByRole('radio')).toHaveLength(2);
    s.getByText(t('ru', 'repeat.keep_history'));
  });

  test('без якоря «Отсчёта» нет — задача вернётся от дня закрытия сама; копии остаются', async () => {
    const s = await show({ anchorAt: null, rule: custom });
    expect(s.queryByText(t('ru', 'repeat.from_label'))).toBeNull();
    expect(s.queryByText(t('ru', 'repeat.from_schedule'))).toBeNull();
    s.getByText(t('ru', 'repeat.keep_history'));
  });

  test('копии — строка с переключателем: нажатие на строку и на переключатель включает', async () => {
    const onApply = jest.fn();
    const s = await show({ anchorAt: ANCHOR, rule: custom, onApply });
    expect(checked(s.getByRole('switch'))).toBe(false);
    await fireEvent.press(s.getByTestId('repeat-keep-row'));
    expect(checked(s.getByRole('switch'))).toBe(true);
    await done(s);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ keepHistory: true }));
  });
});

describe('сводка: ближайшие сроки', () => {
  const upcomingFrom = (base) => Repeat.upcomingDue(weekly, base, base + 400 * 86400000, 3)
    .map((ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }))
    .join(' · ');

  test('считаются от якоря', async () => {
    const s = await show({ anchorAt: ANCHOR });
    s.getByText(upcomingFrom(Date.parse(ANCHOR)));
    expect(s.getByTestId('repeat-summary').props.children).toBe(t('ru', 'repeat.weekly'));
  });

  test('без якоря — от «сейчас», а не пусто: сводка работает и для повтора без дат', async () => {
    const s = await show({ anchorAt: null });
    const now = Date.now();
    // Секунда на выполнение теста: ближайшие сроки сутки не меняют.
    s.getByText(upcomingFrom(now));
  });
});

describe('подвал и вложенный вид (embedded)', () => {
  test('подвал — одна «Готово»: «Не повторяется» — строка списка, а не кнопка', async () => {
    const s = await show({});
    const buttons = within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button');
    expect(buttons.map((b) => within(b).getByText(/./).props.children)).toEqual([t('ru', 'common.done')]);
  });

  test('без своего заголовка; «Готово» отдаёт правило и зовёт onDone, лист не закрывает', async () => {
    const onApply = jest.fn();
    const onDone = jest.fn();
    const s = await show({ embedded: true, anchorAt: ANCHOR, onApply, onDone });
    // Заголовок — у того, кто держит страницу (SlotSheet): лист его не пишет.
    expect(useSheetStore.getState().header).toBeNull();
    await done(s);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ freq: 'week' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useSheetStore.getState().content).not.toBeNull();
  });

  test('«Не повторяется» строкой и «Готово» — onClear и onDone, лист не закрывается', async () => {
    const onClear = jest.fn();
    const onDone = jest.fn();
    const s = await show({ embedded: true, onClear, onDone });
    await fireEvent.press(s.getByTestId('repeat-none'));
    await done(s);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useSheetStore.getState().content).not.toBeNull();
  });

  test('сам по себе (не вложенный) лист пишет свой заголовок и закрывается по «Готово»', async () => {
    const onApply = jest.fn();
    const s = await show({ onApply });
    expect(useSheetStore.getState().header).toEqual({ title: t('ru', 'repeat.dialog_title'), onBack: null });
    await done(s);
    expect(onApply).toHaveBeenCalled();
    expect(useSheetStore.getState().content).toBeNull();
  });
});

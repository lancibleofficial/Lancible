// Списки выбора в листах — один общий ChoiceList. Запуск: npm run test:mobile
//
// До 11 октября 2026 каждый лист рисовал свой список: пункт — серая плашка
// (panel2), выбранный — зелёная заливка строки (accentMuted). Теперь подложка
// одна на весь список, строки на ней своих подложек не имеют, между ними
// волосяная линия; выбранный — галочка accentInk и подпись жирнее; нажатие —
// подсветка raise. Проверяется и сам компонент, и что листы со списками
// берут его, а не рисуют свой: язык и валюта (PickerSheet), статус карточки
// (TaskMoveSheet), теги (TagPickerSheet), период и проекты экспорта,
// существующие задачи в «Новой записи». Список «Напомнить» в листе дедлайна
// (DueSheet) ушёл вместе с напоминанием у дедлайна: напоминания теперь
// списком в свойствах задачи, ReminderSheet.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import ChoiceList from '../src/components/ChoiceList';
import BottomSheet from '../src/components/BottomSheet';
import PickerSheet from '../src/components/PickerSheet';
import TaskMoveSheet from '../src/components/TaskMoveSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import ExportPeriodSheet from '../src/components/ExportPeriodSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors, buttonHeight, radius } from '../src/theme';
import { t } from '../src/lib/i18n';
import { ICONS } from '../src/core/icons';
import { processColor } from 'react-native';

const noop = () => {};
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const styleOf = flat;
/** Все хост-узлы под узлом (сам узел — тоже). */
const walk = (node) => [node, ...(node.children || []).filter((c) => typeof c === 'object').flatMap(walk)];
const CHECK_D = ICONS.check.p[0][0];
/** Галочки под узлом — контуры значка check и их заливка. */
const checksIn = (node) => walk(node).filter((n) => n.type === 'RNSVGPath' && n.props.d === CHECK_D);
const OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'kk', label: 'Қазақша' },
];

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [
      { id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'p2', name: 'Бот', color: '#5ec8f2', createdAt: '2026-10-02T00:00:00.000Z' },
    ],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    tags: [{ id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null }, { id: 'g2', name: 'срочно', color: '#ff7a7a', projectId: null }],
    tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], updatedAt: '2026-10-01T10:00:00.000Z' }],
    activeTimer: null,
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

describe.each(['dark', 'light'])('ChoiceList (%s)', (theme) => {
  beforeEach(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } }));

  test('одна подложка на список, у строк своей нет; линии между строками, у первой — нет', async () => {
    const { result } = await renderHook(() => useColors());
    const c = result.current;
    const s = await render(<ChoiceList options={OPTIONS} value="en" onSelect={noop} />);
    const list = s.getByTestId('choice-list');
    expect(flat(list)).toMatchObject({ backgroundColor: c.panel2, borderRadius: radius.lg, overflow: 'hidden' });
    const rows = s.getAllByRole('radio');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // Ни серой плашки, ни зелёной заливки у строки в покое.
      expect(styleOf(row).backgroundColor).toBeUndefined();
      expect(styleOf(row).borderRadius).toBeUndefined();
      expect(styleOf(row).minHeight).toBe(buttonHeight);
    }
    expect(within(rows[0]).queryByTestId('choice-list-line')).toBeNull();
    expect(flat(within(rows[1]).getByTestId('choice-list-line')).backgroundColor).toBe(c.border);
    expect(flat(within(rows[2]).getByTestId('choice-list-line')).height).toBe(StyleSheet.hairlineWidth);
  });

  test('выбранный — галочка акцентом и подпись жирнее, без заливки; нажатие — лёгкая подсветка', async () => {
    const { result } = await renderHook(() => useColors());
    const c = result.current;
    const s = await render(<ChoiceList options={OPTIONS} value="en" onSelect={noop} />);
    const [ru, en] = s.getAllByRole('radio');
    expect(en.props.accessibilityState).toMatchObject({ selected: true });
    expect(ru.props.accessibilityState).toMatchObject({ selected: false });
    // Галочка только у выбранного, цветом accentInk.
    expect(checksIn(s.getByTestId('choice-list'))).toHaveLength(1);
    expect(checksIn(en)).toHaveLength(1);
    expect(checksIn(en)[0].props.fill.payload).toBe(processColor(c.accentInk));
    within(en).getByText('English');
    expect(flat(within(en).getByText('English')).fontFamily).not.toBe(flat(within(ru).getByText('Русский')).fontFamily);
    // Заливки нет ни у какой строки, а нажатая подсвечивается ступенью raise.
    expect(styleOf(en).backgroundColor).toBeUndefined();
    await fireEvent(ru, 'pressIn');
    expect(styleOf(ru).backgroundColor).toBe(c.raise);
    await fireEvent(ru, 'pressOut');
    expect(styleOf(ru).backgroundColor).toBeUndefined();
    expect(c.raise).not.toBe(c.accentMuted);
  });
});

test('несколько выбранных — флажки; нажатие отдаёт значение пункта', async () => {
  const onSelect = jest.fn();
  const s = await render(<ChoiceList multi options={OPTIONS} selected={['ru', 'kk']} onSelect={onSelect} />);
  const rows = s.getAllByRole('checkbox');
  expect(rows.map((r) => r.props.accessibilityState.checked)).toEqual([true, false, true]);
  await fireEvent.press(rows[1]);
  expect(onSelect).toHaveBeenCalledWith('en');
});

// 12 октября 2026: ChoiceList — и выбор вида в листе; пункт, который сейчас
// выбрать нельзя («Добавьте время работы или дедлайн»), — disabled.
test('пункт disabled — тише (textFaint), не нажимается и не бывает выбранным', async () => {
  const c = (await renderHook(() => useColors())).result.current;
  const onSelect = jest.fn();
  const s = await render(
    <ChoiceList
      options={[{ value: 'need', label: 'Нужен якорь', disabled: true, testID: 'need' }, { value: 'at', label: 'Один раз', testID: 'at' }]}
      value="need"
      onSelect={onSelect}
    />,
  );
  const need = s.getByTestId('need');
  expect(need.props.accessibilityState).toMatchObject({ disabled: true, selected: false });
  expect(styleOf(within(need).getByText('Нужен якорь')).color).toBe(c.textFaint);
  expect(checksIn(s.getByTestId('choice-list'))).toHaveLength(0);
  await fireEvent.press(need);
  expect(onSelect).not.toHaveBeenCalled();
  await fireEvent.press(s.getByTestId('at'));
  expect(onSelect).toHaveBeenCalledWith('at');
});

test('точка цвета, подпись справа и значок действия — без галочки', async () => {
  const s = await render(
    <ChoiceList
      options={[{ value: 'p1', label: 'Сайт', color: '#87ff65', note: 'общий' }, { value: 'new', label: 'Создать', icon: 'plus' }]}
      value="new"
      onSelect={noop}
    />,
  );
  s.getByText('общий');
  // У действия выбора не бывает: оно кнопка, и галочки у него нет даже при совпадении.
  expect(s.getAllByRole('button')).toHaveLength(1);
  expect(checksIn(s.getByTestId('choice-list'))).toHaveLength(0);
});

describe('листы со списками берут ChoiceList', () => {
  const show = async (content) => { openSheet(content); return render(<BottomSheet />); };

  test('PickerSheet: язык — общий список, выбор закрывает лист', async () => {
    const onSelect = jest.fn();
    const s = await show(<PickerSheet title="Язык" value="ru" options={OPTIONS} onSelect={onSelect} />);
    const list = s.getByTestId('picker-list');
    expect(within(list).getAllByRole('radio')).toHaveLength(3);
    await fireEvent.press(within(list).getByText('English'));
    expect(onSelect).toHaveBeenCalledWith('en');
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('PickerSheet: проект — с точкой цвета', async () => {
    const s = await show(<PickerSheet title="Проект" value="p1" options={[{ value: 'p1', label: 'Сайт', color: '#87ff65' }]} onSelect={noop} />);
    const row = within(s.getByTestId('picker-list')).getByRole('radio');
    expect(walk(row).filter((n) => flat(n).backgroundColor === '#87ff65')).toHaveLength(1);
  });

  test('TaskMoveSheet: статусы — общий список с точками, таймер — отдельной строкой-действием', async () => {
    const s = await show(<TaskMoveSheet taskId="t1" />);
    const rows = within(s.getByTestId('move-list')).getAllByRole('radio');
    expect(rows).toHaveLength(2);
    expect(rows[0].props.accessibilityState.selected).toBe(true);
    within(s.getByTestId('move-timer')).getByText(t('ru', 'timer.start'));
  });

  test('TagPickerSheet: теги — флажками в общем списке', async () => {
    const s = await show(<TagPickerSheet value={['g2']} onChange={noop} />);
    const rows = within(s.getByTestId('tag-list')).getAllByRole('checkbox');
    expect(rows.map((r) => r.props.accessibilityState.checked)).toEqual([false, true]);
  });

  test('ExportPeriodSheet: период и проекты — общие списки', async () => {
    const s = await show(<ExportPeriodSheet lang="ru" />);
    await fireEvent.press(s.getByTestId('export-period'));
    expect(within(s.getByTestId('export-periods')).getAllByRole('radio')).toHaveLength(7);
    await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back')));
    await fireEvent.press(s.getByTestId('export-projects'));
    expect(within(s.getByTestId('export-project-list')).getAllByRole('checkbox')).toHaveLength(2);
  });

});

test('исходники листов: нет своих «выбранных» заливок строк и плашек пунктов', () => {
  // Старое устройство списка: стиль optionActive / rowActive с заливкой
  // accentMuted и option / row с подложкой panel2. Кто вернёт — увидит здесь.
  const dir = join(__dirname, '..', 'src', 'components');
  const bad = [];
  for (const name of readdirSync(dir).filter((n) => /Sheet\.js$/.test(n))) {
    const src = readFileSync(join(dir, name), 'utf8');
    if (/\b(optionActive|rowActive)\b/.test(src)) bad.push(`${name}: optionActive/rowActive`);
    if (/\boption: \{[^}]*backgroundColor: colors\.panel2/.test(src)) bad.push(`${name}: option с подложкой panel2`);
  }
  expect(bad).toEqual([]);
});

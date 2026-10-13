// Острова (components/Island.js). Запуск: npm run test:mobile
//
// Острова не проявляются из нуля: раньше каждый въезжал с FadeInDown, и
// при открытии любой страницы она приезжала пустой и потом проявлялась —
// это выглядело морганием.
//
// Строка с выбором под ней (ExpandRow, 12 октября 2026): «Дата · 18 сент. ›»
// раскрывает календарь, «Время · 21:00 ›» — часы. Открытая строка
// заканчивает свой остров, выбор лежит под ним на подложке листа, следующие
// строки — новым островом. Подсказка под островом — note (Hint). Подвал
// листа уходящая страница убирает только свой (clearSheetFooter).
import { Text, StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import Island, { RowGroup, SettingRow, ExpandRow } from '../src/components/Island';
import { useSheetStore, setSheetFooter, clearSheetFooter } from '../src/store/useSheetStore';
import { useAppStore } from '../src/store/useAppStore';
import { useColors, fontSize } from '../src/theme';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};

function props(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => props(n, out)); return out; }
  if (typeof node === 'object') {
    out.push(node.props || {});
    props(node.children, out);
  }
  return out;
}

test('остров виден сразу, без анимации появления', async () => {
  const plain = await render(<Island><Text>сводка</Text></Island>);
  const pressable = await render(<Island onPress={() => {}}><Text>сводка</Text></Island>);
  for (const tree of [plain.toJSON(), pressable.toJSON()]) {
    const all = props(tree);
    expect(all.some((p) => 'entering' in p)).toBe(false);
    expect(all.some((p) => p.style && [].concat(p.style).some((s) => s && s.opacity === 0))).toBe(false);
  }
  plain.getByText('сводка');
});

describe('строка с выбором под ней (ExpandRow)', () => {
  beforeEach(() => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme: 'dark' } });
  });

  function Rows({ open, onToggle = () => {} }) {
    return (
      <RowGroup testID="rows" note="Подсказка">
        <ExpandRow icon="calendar" label="Дата" value="18 сент." open={open === 'date'} onToggle={onToggle} testID="row-date">
          <Text testID="picker-date">календарь</Text>
        </ExpandRow>
        <ExpandRow icon="clock" label="Время" value="21:00" open={open === 'time'} onToggle={onToggle} testID="row-time">
          <Text testID="picker-time">часы</Text>
        </ExpandRow>
        <SettingRow label="Ещё" value="нет" testID="row-more" />
      </RowGroup>
    );
  }

  test('закрыты — один остров, выбора нет; строки — «expanded: false», шеврон вправо', async () => {
    const s = await render(<Rows open={null} />);
    expect(s.getAllByTestId(/^rows/)).toHaveLength(1);
    expect(s.queryByTestId('picker-date')).toBeNull();
    expect(s.getByTestId('row-date').props.accessibilityState).toEqual({ expanded: false });
    // У обычной строки состояния раскрытия нет.
    expect(s.getByTestId('row-more').props.accessibilityState).toBeUndefined();
  });

  test('открыта первая — она последней в своём острове, под ним выбор, дальше новый остров', async () => {
    const colors = (await renderHook(() => useColors())).result.current;
    const s = await render(<Rows open="date" />);
    const first = s.getByTestId('rows');
    const second = s.getByTestId('rows-1');
    within(first).getByTestId('row-date');
    expect(within(first).queryByTestId('row-time')).toBeNull();
    within(second).getByTestId('row-time');
    within(second).getByTestId('row-more');
    // Выбор — между островами, не внутри.
    const picker = s.getByTestId('picker-date');
    expect(within(first).queryByTestId('picker-date')).toBeNull();
    expect(within(second).queryByTestId('picker-date')).toBeNull();
    expect(picker).toBeTruthy();
    // Открытая строка: expanded, значение акцентом.
    expect(s.getByTestId('row-date').props.accessibilityState).toEqual({ expanded: true });
    expect(flat(within(s.getByTestId('row-date')).getByText('18 сент.')).color).toBe(colors.accentInk);
    expect(flat(within(s.getByTestId('row-time')).getByText('21:00')).color).toBe(colors.textFaint);
    // Оба острова — panel2.
    expect(flat(first).backgroundColor).toBe(colors.panel2);
    expect(flat(second).backgroundColor).toBe(colors.panel2);
  });

  test('нажатие на строку зовёт onToggle; подсказка — под островом, тише', async () => {
    const colors = (await renderHook(() => useColors())).result.current;
    const onToggle = jest.fn();
    const s = await render(<Rows open="time" onToggle={onToggle} />);
    await fireEvent.press(s.getByTestId('row-time'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    const hint = flat(s.getByText('Подсказка'));
    expect(hint.color).toBe(colors.textFaint);
    expect(hint.fontSize).toBe(fontSize.xs);
    expect(within(s.getByTestId('rows')).queryByText('Подсказка')).toBeNull();
  });
});

test('clearSheetFooter убирает подвал, только если он всё ещё свой', () => {
  const mine = <Text>мой</Text>;
  const theirs = <Text>чужой</Text>;
  setSheetFooter(mine);
  clearSheetFooter(theirs);
  expect(useSheetStore.getState().footer).toBe(mine);
  setSheetFooter(theirs);
  clearSheetFooter(mine);
  expect(useSheetStore.getState().footer).toBe(theirs);
  clearSheetFooter(theirs);
  expect(useSheetStore.getState().footer).toBeNull();
});

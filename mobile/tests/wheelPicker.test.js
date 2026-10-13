// Барабан выбора (components/WheelPicker.js). Запуск: npm run test:mobile
//
// С живого телефона 11 октября 2026: в листе дедлайна выбранное время
// двоилось — «21 : 02» жирным, а за ним бледная мелкая копия тех же цифр.
// Барабан — два слоя: снизу прокручиваемый бледный список, сверху в полосе
// выбора тот же список крупно. Заливка полосы лежала отдельным видом под
// списком, верхний слой был прозрачным, и бледное число просвечивало из-под
// крупного. Теперь заливка — у верхнего слоя и непрозрачная: в полосе видно
// одно число. Пиксели без устройства не проверить (закрыто снимками на
// эмуляторе); здесь — порядок слоёв, непрозрачность и одна подпись на строку.
//
// Барабан стоит только в листе дедлайна (DueSheet), под строкой «Время ›».
// Время в листах отрезка, записи и напоминания (TimeColumns) — столбцы с
// одной подписью на ячейку, наложения там нет.
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import WheelPicker from '../src/components/WheelPicker';
import DueSheet from '../src/components/DueSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useColors } from '../src/theme';
import { t } from '../src/lib/i18n';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Непрозрачный цвет: #rgb или #rrggbb, без доли прозрачности.
const OPAQUE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Все хост-виды поддерева, у которых есть заливка. */
function filled(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.props && flat(node).backgroundColor) out.push(node);
  (node.children || []).forEach((c) => filled(c, out));
  return out;
}

function setTheme(theme) {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme } });
}

describe.each(['dark', 'light'])('тема %s', (theme) => {
  beforeEach(() => setTheme(theme));

  test('полоса выбора непрозрачна и лежит поверх бледного списка — выбранное число видно одно', async () => {
    const colors = (await renderHook(() => useColors())).result.current;
    const s = await render(<WheelPicker values={HOURS} value={21} onChange={() => {}} format={pad2} />);
    const win = s.getByTestId('wheel-window');
    // Заливка полосы — у верхнего слоя, цвета поля (panel2) и без прозрачности:
    // она закрывает бледное число в строке под собой.
    expect(flat(win).backgroundColor).toBe(colors.panel2);
    expect(flat(win).backgroundColor).toMatch(OPAQUE);
    expect(flat(win).overflow).toBe('hidden');
    // Верхний слой — последний в барабане, после прокрутки: рисуется поверх.
    const kids = win.parent.children;
    expect(kids[kids.length - 1]).toBe(win);
    expect(kids.findIndex((k) => k.type === 'RCTScrollView')).toBeLessThan(kids.indexOf(win));
    // Отдельной подложки полосы под списком нет: заливка цвета полосы в
    // барабане одна, у верхнего слоя (прежде она лежала под прозрачным).
    expect(filled(win.parent).filter((n) => flat(n).backgroundColor === colors.panel2)).toEqual([win]);
  });

  test('в полосе на каждую строку одна подпись — крупная; бледная остаётся под заливкой', async () => {
    const s = await render(<WheelPicker values={HOURS} value={21} onChange={() => {}} format={pad2} />);
    const win = s.getByTestId('wheel-window');
    const strip = win.children[0];
    // Строка полосы — один вид с одной подписью, второй копии в ней нет.
    expect(strip.children.length).toBeGreaterThan(0);
    for (const row of strip.children) {
      expect(row.children).toHaveLength(1);
      expect(row.children[0].type).toBe('Text');
    }
    // Выбранное значение в полосе — столько же раз, сколько строк с ним в
    // списке (по копии на круг), а не вдвое больше.
    const scroll = win.parent.children.find((k) => k.type === 'RCTScrollView');
    expect(within(win).getAllByText('21')).toHaveLength(within(scroll).getAllByText('21').length);
  });
});

test('лист дедлайна: оба барабана («21 : 02») с непрозрачной полосой', async () => {
  setTheme('dark');
  const colors = (await renderHook(() => useColors())).result.current;
  const task = { id: 't1', projectId: 'p1', title: 'Вёрстка', dueAt: new Date(2026, 9, 9, 21, 2).toISOString() };
  const s = await render(<DueSheet task={task} lang="ru" onApply={() => {}} onClear={() => {}} />);
  await fireEvent.press(s.getByText(t('ru', 'due.time')));
  expect(s.getByTestId('due-summary').props.children).toMatch(/21:02/);
  const wins = s.getAllByTestId('wheel-window');
  expect(wins).toHaveLength(2);
  for (const win of wins) {
    expect(flat(win).backgroundColor).toBe(colors.panel2);
    expect(flat(win).backgroundColor).toMatch(OPAQUE);
  }
});

// Шит задачи и клавиатура (screens/TaskDetailScreen.js). Запуск: npm run test:mobile
//
// С живого телефона 11 октября 2026: в шите задачи («Сведения») поле
// «Ставка в час» оставалось под клавиатурой. Шит — не Modal, а вид в окне
// приложения; окно под клавиатуру не ужимается (edge-to-edge, KeyboardProvider
// в App.js), а прокрутка шита была обычным ScrollView, который о клавиатуре
// не знает. Подъём листов (BottomSheet) касался только Modal.
//
// Теперь тело шита — KeyboardAwareScrollView из react-native-keyboard-controller:
// снизу место на высоту клавиатуры и докрутка сфокусированного поля над ней
// кадр за кадром, с воздухом PANEL_FIELD_GAP. Само правило (как докрутить)
// живёт в библиотеке; здесь проверяется применение: поля шита лежат в этой
// прокрутке, воздух задан, шит по-прежнему тянется и прокручивается.
// Нативной клавиатуры в Node нет — подмена библиотеки из jest.setup.js, а
// KeyboardAwareScrollView в ней обёрнут, чтобы видеть, с чем его зовут.
import { StyleSheet } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import TaskDetailScreen, { PANEL_FIELD_GAP } from '../src/screens/TaskDetailScreen';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { spacing } from '../src/theme';
import { t } from '../src/lib/i18n';

jest.mock('react-native-keyboard-controller', () => {
  const lib = require('react-native-keyboard-controller/jest');
  const { createElement } = require('react');
  return { ...lib, KeyboardAwareScrollView: jest.fn((props) => createElement(lib.KeyboardAwareScrollView, props)) };
});
jest.mock('../src/components/DocEditor', () => () => null);

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });

beforeEach(() => {
  KeyboardAwareScrollView.mockClear();
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 1000, currency: 'RUB' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], notes: '',
      sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null,
    }],
    activeTimer: null,
  });
});

const screen = () => render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);
const lastProps = () => KeyboardAwareScrollView.mock.calls[KeyboardAwareScrollView.mock.calls.length - 1][0];

// С 12 октября 2026 поля ставки на панели нет: в «Сведениях» — строка
// «Ставка» со значением словами, а вводят её в листе (RateSheet). Лист —
// BottomSheet, он сам поднимается над клавиатурой (sheetKeyboard.test.js).
// Тело шита осталось KeyboardAwareScrollView: поле, появившееся в «Сведениях»
// снова, не окажется под клавиатурой.
test('в «Сведениях» нет полей ввода: ставка — строкой, ввод — в листе с полем ставки', async () => {
  const s = await screen();
  // Шит раскрыт вкладкой «Сведения», как это делает человек.
  await fireEvent.press(s.getByText(t('ru', 'task.details')));
  const scroll = s.getByTestId('task-sheet-scroll');
  expect(within(scroll).queryByTestId('task-rate-input')).toBeNull();
  // Ни одного поля ввода в прокрутке шита: заголовок задачи — над шитом.
  const inputs = (json) => (JSON.stringify(json).match(/"type":"TextInput"/g) || []).length;
  expect(inputs(scroll.toJSON())).toBe(0);
  expect(inputs(s.toJSON())).toBeGreaterThan(0);
  // Строка ставки открывает лист с полем: цифровая клавиатура, фокус сразу.
  await fireEvent.press(within(scroll).getByTestId('task-rate-row'));
  const sheet = useSheetStore.getState().content;
  const field = await render(sheet);
  const input = field.getByTestId('rate-input');
  expect(input.props.keyboardType).toBe('decimal-pad');
  expect(input.props.autoFocus).toBe(true);
});

test('тело шита — по-прежнему прокрутка, которая знает о клавиатуре; воздух как у листа', async () => {
  const s = await screen();
  await fireEvent.press(s.getByText(t('ru', 'task.details')));
  // Тело шита — KeyboardAwareScrollView, а не обычная прокрутка: он и
  // докручивает сфокусированное поле над клавиатурой.
  expect(KeyboardAwareScrollView).toHaveBeenCalled();
  const props = lastProps();
  expect(props.testID).toBe('task-sheet-scroll');
  expect(props.enabled).not.toBe(false);
  // Поле встаёт над клавиатурой с тем же воздухом, что у нижнего листа (12).
  expect(PANEL_FIELD_GAP).toBe(spacing.md);
  expect(props.bottomOffset).toBe(PANEL_FIELD_GAP);
  // Тапы по чипам и строкам при открытой клавиатуре проходят с первого раза.
  expect(props.keyboardShouldPersistTaps).toBe('handled');
  // Раскрытый шит прокручивается.
  expect(lastProps().scrollEnabled).toBe(true);
});

test('шит свёрнут — прокрутка тела выключена, как раньше; заголовок задачи — вне шита', async () => {
  const s = await screen();
  expect(lastProps().scrollEnabled).toBe(false);
  // Тело гаснет вместе со свёрнутым шитом: стиль прозрачности на месте.
  expect(StyleSheet.flatten(lastProps().style)).toMatchObject({ flex: 1 });
  // Заголовок задачи живёт в прокрутке страницы, а не шита.
  expect(within(s.getByTestId('task-sheet-scroll')).queryByDisplayValue('Вёрстка')).toBeNull();
  s.getByDisplayValue('Вёрстка');
});

// Страница задачи (screens/TaskDetailScreen.js). Запуск: npm run test:mobile
//
// Шит снизу: таймер с заработком всегда виден, вкладки «Сведения» и
// «История» раскрывают его. Проверяется применение, а не правило: кнопка
// таймера зовёт startTimer/stopTimer, статус-чип — setTaskStatus, галочка
// в шапке — setTaskDone, вкладка «История» показывает записи и «Экспорт».
import { StyleSheet, DeviceEventEmitter } from 'react-native';
import { render, renderHook, fireEvent, within, act } from '@testing-library/react-native';
import * as KeyboardLib from 'react-native-keyboard-controller';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import { TOOLBAR_HIDE_DELAY, TOOLBAR_GAP, TOOLBAR_SPACE } from '../src/components/EditorToolbar';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { colors, buttonHeight, useColors, fontSize, radius } from '../src/theme';
import { fieldStyle } from '../src/components/AppTextInput';
import { CURRENCY_SYMBOLS, fmtDateShort, fmtMoney } from '../src/lib/format';
import Reminders from '../src/core/reminders.js';
import BottomSheet from '../src/components/BottomSheet';
import DueSheet from '../src/components/DueSheet';
import SlotSheet from '../src/components/SlotSheet';
import SlotListSheet from '../src/components/SlotListSheet';
import RepeatSheet from '../src/components/RepeatSheet';
import ReminderSheet from '../src/components/ReminderSheet';
import RateSheet from '../src/components/RateSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import { t, T } from '../src/lib/i18n';

// Редактор — WebView, у него нативная часть; здесь заметки пустые, а сам
// живой редактор страницы проверяет tests/editorLive.test.js. Подмена
// запоминает пропсы: тест панели сообщает «фокус в тексте» за редактор.
jest.mock('../src/components/DocEditor', () => (props) => { global.__docEditor = props; return null; });

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const H = 3_600_000;

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 1000, currency: 'RUB' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    tags: [],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: H, tagIds: [], notes: '',
      sessions: [{ start: at(9), end: at(10), ms: H }], dueAt: null, repeat: null, rate: null, pinnedAt: null,
    }],
    activeTimer: null,
  });
});

const screen = () => render(<TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} />);
// Страница и нижний лист одним деревом: новый render заменяет прежний, а
// лист, открытый со страницы, должен быть виден вместе с ней.
const screenWithSheet = () => render(<><TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);

test('заголовок, проект в крошке, таймер и вкладки на месте', async () => {
  const { getByDisplayValue, getByText, getAllByText } = await screen();
  getByDisplayValue('Вёрстка');
  expect(getAllByText('Сайт').length).toBeGreaterThan(0);
  getByText(t('ru', 'task.details'));
  getByText(t('ru', 'task.history_n', { n: 1 }));
  getByText('01:00:00');
});

test('заметки: живой редактор, «Во весь экран» нет — только точка «сохранено»', async () => {
  const q = await screen();
  expect(global.__docEditor.live).toBe(true);
  expect(q.queryByTestId('editor-fullscreen')).toBeNull();
  expect(q.queryByText('Во весь экран')).toBeNull();
  q.getByTestId('editor-saved');
});

// 13 октября 2026: закрылась клавиатура — панель редактора уезжает вниз
// вместе с ней и уходит ПОД шит с таймером; шит возвращается после неё. Раньше
// панель была отрисована поверх шита и на миг закрывала таймер.
describe('панель редактора и шит с таймером', () => {
  const kb = (shown) => act(async () => {
    DeviceEventEmitter.emit(shown ? 'keyboardWillShow' : 'keyboardWillHide', { endCoordinates: { height: shown ? 300 : 0, screenY: shown ? 544 : 844, width: 390, screenX: 0 } });
  });
  /** testID в порядке отрисовки: кто позже — тот поверх. */
  const order = (tree, ids) => {
    const seen = [];
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.props && ids.includes(n.props.testID)) seen.push(n.props.testID);
      (n.children || []).forEach(walk);
    }(tree));
    return seen;
  };
  const ty = (node) => (StyleSheet.flatten(node.props.style).transform || []).find((x) => 'translateY' in x).translateY;
  afterEach(async () => {
    KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 0;
    KeyboardLib.useReanimatedKeyboardAnimation().height.value = 0;
    await kb(false);
  });

  test('панель отрисована до шита: шит поверх неё, а не наоборот', async () => {
    const q = await screenWithSheet();
    const down = ty(q.getByTestId('task-sheet'));
    await act(async () => { global.__docEditor.onFormat({ focused: true }); });
    await kb(true);
    q.getByTestId('editor-toolbar');
    expect(order(q.toJSON(), ['editor-toolbar', 'task-sheet'])).toEqual(['editor-toolbar', 'task-sheet']);
    // Панель и шит — соседи: один и тот же родитель, порядок отрисовки — порядок детей.
    const dock = q.getByTestId('editor-toolbar').parent;
    expect(dock.parent.children.indexOf(dock)).toBeLessThan(dock.parent.children.indexOf(q.getByTestId('task-sheet')));
    // С клавиатурой шит ушёл вниз целиком — панель над клавиатурой ничем не закрыта.
    expect(ty(q.getByTestId('task-sheet')) - down).toBeGreaterThanOrEqual(130);
  });

  test('клавиатура съехала: панель внизу под шитом, шит вернулся; панель уходит следом', async () => {
    jest.useFakeTimers();
    try {
      const q = await screenWithSheet();
      const down = ty(q.getByTestId('task-sheet'));
      await act(async () => { global.__docEditor.onFormat({ focused: true }); });
      await kb(true);
      // Кадры: клавиатура уже съехала, а событие о закрытии ещё не пришло —
      // шит ждёт внизу, панель едет с клавиатурой (её подъём — 0, остров —
      // на воздух TOOLBAR_GAP над низом экрана).
      KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 0;
      KeyboardLib.useReanimatedKeyboardAnimation().height.value = 0;
      await q.rerender(<><TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
      expect(ty(q.getByTestId('task-sheet')) - down).toBeGreaterThanOrEqual(130);
      expect(ty(q.getByTestId('editor-toolbar').parent)).toBe(-TOOLBAR_GAP);
      // Остров с воздухом целиком ниже верха свёрнутого шита (130) — шит
      // закрывает его весь.
      expect(TOOLBAR_SPACE).toBeLessThan(130);
      // Событие пришло — шит возвращается; панель ещё на месте, но под ним.
      await kb(false);
      expect(ty(q.getByTestId('task-sheet'))).toBe(down);
      q.getByTestId('editor-toolbar');
      expect(order(q.toJSON(), ['editor-toolbar', 'task-sheet'])).toEqual(['editor-toolbar', 'task-sheet']);
      await act(async () => { jest.advanceTimersByTime(TOOLBAR_HIDE_DELAY + 10); });
      expect(q.queryByTestId('editor-toolbar')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

test('кнопка таймера запускает и останавливает', async () => {
  const { getByLabelText } = await screen();
  await fireEvent.press(getByLabelText(t('ru', 'timer.start')));
  expect(useAppStore.getState().activeTimer.taskId).toBe('t1');
  await fireEvent.press(getByLabelText(t('ru', 'timer.stop')));
  expect(useAppStore.getState().activeTimer).toBeNull();
});

test('статус-чип меняет статус, галочка в шапке — выполнено', async () => {
  const { getByText, getByLabelText } = await screen();
  await fireEvent.press(getByText('Готово'));
  expect(useAppStore.getState().tasks[0].statusId).toBe('s2');
  await fireEvent.press(getByLabelText(t('ru', 'task.reopen')));
  expect(useAppStore.getState().tasks[0].done).toBe(false);
  expect(useAppStore.getState().tasks[0].statusId).toBe('s1');
});

test('вкладка «История»: записи по дням, «Запись вручную» и «Экспорт истории»', async () => {
  const { getByText, queryByText } = await screen();
  expect(queryByText(t('ru', 'task.export_history'))).toBeNull();
  await fireEvent.press(getByText(t('ru', 'task.history_n', { n: 1 })));
  getByText(t('ru', 'task.records_n', { n: 1 }));
  getByText('09:00 – 10:00');
  getByText(t('ru', 'task.add_manual'));
  getByText(t('ru', 'task.export_history'));
});

// TagBadgeRow отдаёт в onRemove id тега, а экран раньше ждал объект и
// фильтровал по tag.id === undefined — крестик на теге задачи ничего не снимал.
test('крестик на теге снимает тег с задачи', async () => {
  useAppStore.setState((s) => ({
    tags: [{ id: 'g1', name: 'Срочно', color: '#ff7a6b' }, { id: 'g2', name: 'Клиент', color: '#5ec8f2' }],
    tasks: s.tasks.map((x) => (x.id === 't1' ? { ...x, tagIds: ['g1', 'g2'] } : x)),
  }));
  const { getAllByLabelText } = await screen();
  await fireEvent.press(getAllByLabelText('Срочно')[0]);
  expect(useAppStore.getState().tasks.find((x) => x.id === 't1').tagIds).toEqual(['g2']);
});

// Свойства задачи (вкладка «Сведения», 11 октября 2026): «Закрепить вверху» и
// строка «Выбрать проект» убраны, «Ставка в час» — обычное поле формы без
// приписки «по умолчанию».
describe('свойства задачи', () => {
  const flat = (node) => StyleSheet.flatten(node.props.style) || {};
  const LANGS = ['ru', 'en', 'uk', 'kk'];
  // Цвета в проверках — токены тёмной темы.
  beforeEach(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme: 'dark' } }));

  test('«Закрепить вверху» нет — ни подписи, ни переключателя; закрепление осталось в свайпе списков', async () => {
    const s = await screen();
    expect(s.queryByText('Закрепить вверху')).toBeNull();
    expect(s.queryByLabelText('Закрепить вверху')).toBeNull();
    // Дедлайна нет — переключателей на вкладке нет совсем.
    expect(s.queryAllByRole('switch')).toHaveLength(0);
    // Ключа в словарях тоже нет: ни одна версия языка его не покажет.
    for (const lang of LANGS) expect('task.pin_top' in T[lang]).toBe(false);
  });

  test('есть дедлайн — переключателей нет совсем: «Напомнить за час» ушёл вместе с напоминанием у дедлайна', async () => {
    useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === 't1' ? { ...x, dueAt: at(18) } : x)) }));
    const s = await screen();
    expect(s.queryAllByRole('switch')).toHaveLength(0);
    expect(s.queryByTestId('task-remind-row')).toBeNull();
    for (const lang of LANGS) expect('task.remind_hour' in T[lang]).toBe(false);
  });

  test('строки «Выбрать проект» нет; проект по-прежнему открывается из меню и с названия в шапке', async () => {
    const s = await screen();
    expect(s.queryByText(t('ru', 'board.pick_project'))).toBeNull();
    // Название проекта — только в шапке, второй строки с ним на вкладке нет.
    expect(s.getAllByText('Сайт')).toHaveLength(1);
    await fireEvent.press(s.getByLabelText(t('ru', 'project.opts')));
    const items = useSheetStore.getState().content.props.items;
    // «Дублировать» — с 17 октября 2026 (duplicateTask.test.js).
    expect(items.map((i) => i.key)).toEqual(['project', 'duplicate', 'export', 'delete']);
    expect(items[0].label).toBe(t('ru', 'task.open_project'));
  });

  // 12 октября 2026: поле ставки с панели ушло — в группе «Ещё» строка
  // «Ставка в час» со значением словами, ввод — в листе ставки (RateSheet).
  const perHour = (n, cur = 'RUB') => `${fmtMoney(n, 'ru', cur)}${t('ru', 'rate.per_hour')}`;

  test('«Ставка в час» — строкой в группе «Ещё», значение словами; поля ввода на панели нет', async () => {
    const s = await screen();
    expect(s.queryByTestId('task-rate-input')).toBeNull();
    const more = s.getByTestId('task-more');
    const row = within(more).getByTestId('task-rate-row');
    within(row).getByText(t('ru', 'task.rate_label'));
    // Своей ставки нет, у проекта нет — общая из настроек.
    expect(s.getByTestId('task-rate-value').props.children).toBe(t('ru', 'rate.shared', { rate: perHour(1000) }));
    // Своя — числом с валютой и «/ч».
    await act(async () => { useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => ({ ...x, rate: 2500 })) })); });
    expect(s.getByTestId('task-rate-value').props.children).toBe(perHour(2500));
    // Не своя, у проекта своя — «как у проекта — …».
    await act(async () => {
      useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => ({ ...x, rate: null })), projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', rate: 1800 }] }));
    });
    expect(s.getByTestId('task-rate-value').props.children).toBe(t('ru', 'task.rate_project', { rate: perHour(1800) }));
    // Ставки нет нигде — «не задана» (слово «ставка» уже в названии строки).
    await act(async () => {
      useAppStore.setState({ projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }], settings: { ...useAppStore.getState().settings, hourlyRate: 0 } });
    });
    expect(s.getByTestId('task-rate-value').props.children).toBe(t('ru', 'rate.none'));
    expect(t('ru', 'rate.none')).toBe('не задана');
  });

  test('строка ставки открывает лист ставки: заголовок, «₽/ч», серым — ставка, по которой считается; приписок «по умолчанию» нет', async () => {
    const s = await screenWithSheet();
    const sheet = s;
    await fireEvent.press(s.getByTestId('task-rate-row'));
    const el = useSheetStore.getState().content;
    expect(el.type).toBe(RateSheet);
    expect(el.props).toMatchObject({
      title: t('ru', 'task.rate_label'),
      nullable: true,
      placeholder: '1000',
      unit: `${CURRENCY_SYMBOLS.RUB}${t('ru', 'rate.per_hour')}`,
      hint: t('ru', 'task.rate_hint'),
    });
    within(sheet.getByTestId('sheet-head-row')).getByText(t('ru', 'task.rate_label'));
    const input = sheet.getByTestId('rate-input');
    // Поле — Field из AppTextInput: вид общий, своего оформления нет.
    expect(flat(input)).toMatchObject(fieldStyle(colors));
    expect(flat(input).minHeight).toBe(buttonHeight);
    expect(input.props.keyboardType).toBe('decimal-pad');
    expect(input.props.value).toBe('');
    expect(input.props.placeholder).toBe('1000');
    expect(input.props.placeholderTextColor).toBe(colors.textFaint);
    sheet.getByText(`${CURRENCY_SYMBOLS.RUB}${t('ru', 'rate.per_hour')}`);
    expect(s.queryByText(/по умолчанию|по проекту|своя/)).toBeNull();
    for (const key of ['task.rate_default', 'task.rate_by_project', 'task.rate_own']) {
      for (const lang of LANGS) expect(key in T[lang]).toBe(false);
    }
    // Ставка проекта — плейсхолдер берёт её.
    await act(async () => { useAppStore.setState({ projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', rate: 1800 }] }); });
    await fireEvent.press(s.getByTestId('task-rate-row'));
    expect(useSheetStore.getState().content.props.placeholder).toBe('1800');
  });

  test('ввод ставки в листе пишется в задачу; пустое поле возвращает ставку не свою (rate = null)', async () => {
    const s = await screenWithSheet();
    const sheet = s;
    const saveIn = () => fireEvent.press(within(sheet.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.save')));
    await fireEvent.press(s.getByTestId('task-rate-row'));
    await fireEvent.changeText(sheet.getByTestId('rate-input'), '2500');
    await saveIn();
    expect(useAppStore.getState().tasks[0].rate).toBe(2500);
    expect(useSheetStore.getState().content).toBeNull();
    expect(s.getByTestId('task-rate-value').props.children).toBe(perHour(2500));
    // Снова: поле с прежним значением; стёрли — ставка не своя.
    await fireEvent.press(s.getByTestId('task-rate-row'));
    expect(sheet.getByTestId('rate-input').props.value).toBe('2500');
    await fireEvent.changeText(sheet.getByTestId('rate-input'), '');
    await saveIn();
    expect(useAppStore.getState().tasks[0].rate).toBeNull();
  });
});

// Три правила «Сведений» (12 октября 2026, DESIGN.md «Настройки на телефоне:
// одна логика»): быстрый выбор — чипами (статус, версия; теги бейджами);
// своё у настройки — строкой «название · значение ›» на острове, тап — её
// лист; строки по группам «Когда», «Напоминания», «Ещё» с подписью Block.
describe('«Сведения»: чипы, группы и строки', () => {
  const sheetEl = () => useSheetStore.getState().content;
  const flat = (node) => StyleSheet.flatten(node.props.style) || {};
  const patchTask = (patch) => useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === 't1' ? { ...x, ...patch } : x)) }));
  beforeEach(() => useSheetStore.setState({ content: null, header: null, footer: null }));

  test('сверху вниз: Статус, Теги, Когда, Напоминания, Ещё — подписи Block (textDim, мелко, без заглавных)', async () => {
    const { result } = await renderHook(() => useColors());
    const s = await screen();
    const details = s.getByTestId('task-details');
    const order = ['task.status_label', 'tag.pick', 'task.group_when', 'remind.label', 'task.group_more'].map((k) => t('ru', k));
    const seen = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'Text' && node.children && order.includes(node.children[0]) && !seen.includes(node.children[0])) seen.push(node.children[0]);
      walk(node.children);
    };
    walk(s.toJSON());
    expect(seen).toEqual(order);
    for (const caption of order) {
      const st = flat(within(details).getAllByText(caption)[0]);
      expect(st.color).toBe(result.current.textDim);
      expect(st.fontSize).toBe(fontSize.xs);
      expect(st.textTransform).toBeUndefined();
    }
    // Версий у проекта нет — и подписи «Версия» нет.
    expect(within(details).queryByText(t('ru', 'version.label'))).toBeNull();
  });

  test('группы — острова panel2 со скруглением острова; в «Когда» три строки', async () => {
    const { result } = await renderHook(() => useColors());
    const s = await screen();
    for (const id of ['task-when', 'task-reminders', 'task-more']) {
      expect(flat(s.getByTestId(id))).toMatchObject({ backgroundColor: result.current.panel2, borderRadius: radius.lg });
    }
    const when = s.getByTestId('task-when');
    for (const id of ['task-due-row', 'task-slots', 'task-repeat']) within(when).getByTestId(id);
    within(s.getByTestId('task-due-row')).getByText(t('ru', 'due.label'));
    within(s.getByTestId('task-slots')).getByText(t('ru', 'slot.label'));
    within(s.getByTestId('task-repeat')).getByText(t('ru', 'repeat.label'));
  });

  test('значения словами: «не задан», «не задано», «Не повторяется»', async () => {
    const s = await screen();
    expect(s.getByTestId('task-due-value').props.children).toBe(t('ru', 'due.none'));
    expect(s.getByTestId('task-slots-value').props.children).toBe(t('ru', 'slot.none'));
    expect(s.getByTestId('task-repeat-value').props.children).toBe(t('ru', 'repeat.none'));
    expect(t('ru', 'due.none')).toBe('не задан');
    expect(t('ru', 'slot.none')).toBe('не задано');
  });

  test('каждая строка открывает свой лист', async () => {
    const s = await screen();
    const opens = async (id, type) => { await fireEvent.press(s.getByTestId(id)); expect(sheetEl().type).toBe(type); };
    await opens('task-due-row', DueSheet);
    await opens('task-slots', SlotSheet);
    await opens('task-repeat', RepeatSheet);
    await opens('task-reminder-add', ReminderSheet);
    await opens('task-rate-row', RateSheet);
  });

  test('чипсов повтора на панели нет — ни пресетов, ни «Настроить…»', async () => {
    const s = await screen();
    const details = s.getByTestId('task-details');
    for (const key of ['repeat.daily', 'repeat.weekly', 'repeat.weekdays_preset', 'repeat.monthly', 'repeat.yearly', 'repeat.custom']) {
      expect(within(details).queryByText(t('ru', key))).toBeNull();
    }
    // Выбранное правило — значением строки: пресет своим словом, своё — описанием.
    await act(async () => { patchTask({ repeat: { freq: 'week', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 } }); });
    expect(s.getByTestId('task-repeat-value').props.children).toBe(t('ru', 'repeat.weekly'));
    await act(async () => { patchTask({ repeat: { freq: 'week', every: 2, weekdays: [1, 3], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 } }); });
    expect(s.getByTestId('task-repeat-value').props.children).toBe('Каждые 2 нед., по Пн, Ср');
  });

  test('статус и версия — чипами на месте; теги — бейджами с крестиком и чипом «+ теги»', async () => {
    useAppStore.setState({
      versions: [{ id: 'v1', projectId: 'p1', name: '1.0', order: 0, releasedAt: null, createdAt: '2026-10-01T00:00:00.000Z' }],
      tags: [{ id: 'g1', name: 'Срочно', color: '#ff7a6b' }],
    });
    patchTask({ tagIds: ['g1'] });
    const s = await screen();
    const statuses = s.getByTestId('task-statuses');
    expect(within(statuses).getAllByRole('button')).toHaveLength(2);
    await fireEvent.press(within(statuses).getByText('Готово'));
    expect(useAppStore.getState().tasks[0].statusId).toBe('s2');
    const versions = s.getByTestId('task-versions');
    await fireEvent.press(within(versions).getByText('1.0'));
    expect(useAppStore.getState().tasks[0].versionId).toBe('v1');
    const tags = s.getByTestId('task-tags');
    within(tags).getByText('Срочно');
    within(tags).getByLabelText('Срочно');
    const add = within(tags).getByTestId('task-tag-add');
    within(add).getByText(`+ ${t('ru', 'tag.pick').toLowerCase()}`);
    await fireEvent.press(add);
    expect(sheetEl().type).toBe(TagPickerSheet);
  });

  test('строка «Дедлайн» показывает срок словами', async () => {
    patchTask({ dueAt: at(18) });
    const s = await screen();
    expect(s.getByTestId('task-due-value').props.children).toMatch(/18:00$/);
  });
});

// Повтор без дедлайна, «Время работы» и напоминание без дедлайна (11 октября
// 2026). Решения о возвращении задачи — в ядре (tests/unit/slots.test.js) и в
// сторе (store-tasks.test.js); здесь — что страница их не запрещает и показывает.
describe('повтор без дедлайна и время работы', () => {
  const LANGS = ['ru', 'en', 'uk', 'kk'];
  const stored = () => useAppStore.getState().tasks[0];
  const patchTask = (patch) => useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === 't1' ? { ...x, ...patch } : x)) }));
  const slotAt = (extra) => ({ id: 'sl1', start: '2026-10-17T10:00:00', end: '2026-10-17T12:00:00', notifiedUpTo: null, ...extra });
  const weeklyOn = (weekdays) => ({ freq: 'week', every: 1, weekdays, monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 });
  const sheetEl = () => useSheetStore.getState().content;
  beforeEach(() => useSheetStore.setState({ content: null, header: null, footer: null }));

  test('нет дедлайна — лист повтора ставит правило, тоста «нужен дедлайн» нет; ключа в словарях тоже', async () => {
    const s = await screenWithSheet();
    const sheet = s;
    expect(stored().dueAt).toBeNull();
    const footer = () => within(sheet.getByTestId('sheet-footer-content'));
    await fireEvent.press(s.getByTestId('task-repeat'));
    expect(sheetEl().type).toBe(RepeatSheet);
    // Лист — строки с галочкой: без правила выбрано «Не повторяется».
    expect(sheet.getByTestId('repeat-none').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(sheet.getByTestId('repeat-weekly'));
    await fireEvent.press(footer().getByText(t('ru', 'common.done')));
    expect(stored().repeat).toMatchObject({ freq: 'week', every: 1 });
    expect(useAppStore.getState().toastMessage).toBeNull();
    expect(s.getByTestId('task-repeat-value').props.children).toBe(t('ru', 'repeat.weekly'));
    // Сняли строкой «Не повторяется» — тоже без тоста.
    await fireEvent.press(s.getByTestId('task-repeat'));
    await fireEvent.press(sheet.getByTestId('repeat-none'));
    await fireEvent.press(footer().getByText(t('ru', 'common.done')));
    expect(stored().repeat).toBeNull();
    expect(useAppStore.getState().toastMessage).toBeNull();
    for (const lang of LANGS) expect('repeat.needs_due' in T[lang]).toBe(false);
  });

  test('строка «Повторение» без дедлайна открывает лист повтора — тоста нет; якорь превью: дедлайн, иначе разовое время работы, иначе ничего', async () => {
    const s = await screen();
    await fireEvent.press(s.getByTestId('task-repeat'));
    expect(useAppStore.getState().toastMessage).toBeNull();
    expect(sheetEl().props.anchorAt).toBeNull();

    await act(async () => { patchTask({ slots: [slotAt()] }); });
    await fireEvent.press(s.getByTestId('task-repeat'));
    expect(sheetEl().props.anchorAt).toBe(new Date('2026-10-17T10:00:00').toISOString());

    await act(async () => { patchTask({ dueAt: at(18) }); });
    await fireEvent.press(s.getByTestId('task-repeat'));
    expect(sheetEl().props.anchorAt).toBe(at(18));
  });

  test('«Время работы»: без отрезков — «не задано», строка открывает сразу пустой лист отрезка', async () => {
    const s = await screen();
    const row = s.getByTestId('task-slots');
    within(row).getByText(t('ru', 'slot.label'));
    expect(s.getByTestId('task-slots-value').props.children).toBe(t('ru', 'slot.none'));
    await fireEvent.press(row);
    expect(sheetEl().type).toBe(SlotSheet);
    expect(sheetEl().props).toMatchObject({ taskId: 't1' });
    expect(sheetEl().props.slotId).toBeUndefined();
    // Пришли не из списка — «назад» в шапке листа нет.
    expect(sheetEl().props.onBack).toBeUndefined();
  });

  test('«Время работы»: значение — первый отрезок и «+N»; задача каждую неделю по дням — просто дни (повтор — у задачи, не у отрезка)', async () => {
    patchTask({
      slots: [
        slotAt(),
        slotAt({ id: 'sl2', start: '2026-10-19T09:00:00', end: '2026-10-19T09:30:00' }),
      ],
    });
    const s = await screen();
    expect(s.getByTestId('task-slots-value').props.children).toMatch(/^Сб, 17 окт\.? 10:00–12:00 \+1$/);
    await act(async () => {
      patchTask({ repeat: weeklyOn([3, 1]), slots: [slotAt({ id: 'sl2', start: '2026-10-19T09:00:00', end: '2026-10-19T09:30:00' })] });
    });
    expect(s.getByTestId('task-slots-value').props.children).toBe('Пн, Ср 09:00–09:30');
    // Иное правило задачи — дата первого отрезка: повтор виден своей строкой.
    await act(async () => { patchTask({ repeat: { ...weeklyOn([]), freq: 'day' } }); });
    expect(s.getByTestId('task-slots-value').props.children).toMatch(/^Пн, 19 окт\.? 09:00–09:30$/);
  });

  test('«Время работы»: отрезки есть — строка открывает их список; в нём часы и день или дни повтора задачи, колокольчика нет; строка — отрезок страницей со стрелкой к списку', async () => {
    patchTask({
      slots: [
        slotAt(),
        slotAt({ id: 'sl2', start: '2026-10-19T09:00:00', end: '2026-10-19T09:30:00' }),
      ],
    });
    const s = await screenWithSheet();
    const sheet = s;
    await fireEvent.press(s.getByTestId('task-slots'));
    expect(sheetEl().type).toBe(SlotListSheet);
    within(sheet.getByTestId('sheet-head-row')).getByText(t('ru', 'slot.label'));
    const first = sheet.getByTestId('slot-list-sl1');
    within(first).getByText('10:00–12:00');
    within(first).getByText(/17 окт/);
    const second = sheet.getByTestId('slot-list-sl2');
    within(second).getByText('09:00–09:30');
    within(second).getByText(/19 окт/);
    // Напоминаний у отрезка нет — они в списке задачи: значков в обеих строках поровну
    // (часы и шеврон), колокольчика ни у какой.
    const icons = (node) => JSON.stringify(node.toJSON()).split('RNSVGSvgView').length;
    expect(icons(first)).toBe(icons(second));
    // «Добавить время» — последней строкой списка.
    within(sheet.getByTestId('slot-list-add')).getByText(t('ru', 'slot.add'));
    // Отрезок — страница этого же листа (другой лист из листа не открывается).
    await fireEvent.press(first);
    expect(sheetEl().type).toBe(SlotListSheet);
    within(sheet.getByTestId('slot-start')).getByText('10:00');
    // «Назад» в шапке отрезка — к списку.
    await fireEvent.press(within(sheet.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back')));
    sheet.getByTestId('slot-list-sl1');
    // «Добавить время» — пустой отрезок, тоже со стрелкой к списку.
    await fireEvent.press(sheet.getByTestId('slot-list-add'));
    expect(sheetEl().type).toBe(SlotListSheet);
    sheet.getByTestId('slot-date');
    within(sheet.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back'));
    await fireEvent.press(within(sheet.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back')));
    // Задача повторяется по Пн и Ср — у строк отрезков дни повтора задачи.
    await act(async () => { patchTask({ repeat: weeklyOn([1, 3]) }); });
    within(sheet.getByTestId('slot-list-sl2')).getByText('Пн, Ср');
    within(sheet.getByTestId('slot-list-sl1')).getByText('Пн, Ср');
  });

  test('повторяющаяся задача без дат закрыта и ждёт своего дня — «Вернётся …»; открыта или без reopenAt — подписи нет', async () => {
    const rule = { freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
    patchTask({ repeat: rule });
    const s = await screen();
    expect(s.queryByTestId('task-returns')).toBeNull();
    await act(async () => { patchTask({ done: true, statusId: 's2', reopenAt: '2026-10-18T00:00:00.000Z' }); });
    const line = s.getByTestId('task-returns');
    expect(line.props.children).toBe(t('ru', 'repeat.returns', { date: fmtDateShort('2026-10-18T00:00:00.000Z', 'ru') }));
    await act(async () => { patchTask({ done: false, statusId: 's1', reopenAt: null }); });
    expect(s.queryByTestId('task-returns')).toBeNull();
  });
});

// Напоминания (11 октября 2026): строка со списком чипов вместо переключателя
// «Напомнить за час» и строки «Напомнить». Правила — в ядре
// (tests/unit/reminders.test.js), сам лист — tests/ReminderSheet.test.js; здесь
// — что страница показывает список словами, открывает лист и не оставила
// напоминаний у дедлайна.
describe('напоминания', () => {
  const LANGS = ['ru', 'en', 'uk', 'kk'];
  const stored = () => useAppStore.getState().tasks[0];
  const sheetEl = () => useSheetStore.getState().content;
  const patchTask = (patch) => useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === 't1' ? { ...x, ...patch } : x)) }));
  /** Список напоминаний вместе с зеркалом старых полей — так его пишет стор. */
  const setList = (list, extra) => useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === 't1' ? { ...x, ...extra, ...Reminders.withReminders({ ...x, ...extra }, list) } : x)) }));
  const rule = (extra) => ({ freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0, ...extra });
  const slotAt = { id: 'sl1', start: '2026-10-17T10:00:00', end: '2026-10-17T12:00:00', repeat: null };
  beforeEach(() => useSheetStore.setState({ content: null, header: null, footer: null }));

  test('списка нет: подпись «Напоминания» и одна строка «Добавить напоминание», которая открывает пустой лист; чипсов нет', async () => {
    const s = await screen();
    s.getByText(t('ru', 'remind.label'));
    const box = s.getByTestId('task-reminders');
    expect(within(box).getAllByRole('button')).toHaveLength(1);
    const add = s.getByTestId('task-reminder-add');
    within(add).getByText(t('ru', 'remind.add'));
    expect(t('ru', 'remind.add')).toBe('Добавить напоминание');
    // Строка добавления — без шеврона: она не открывает настройку, а заводит
    // новую. Значков в ней на один меньше, чем в строке «Дедлайн» (значок и шеврон).
    const icons = (node) => JSON.stringify(node.toJSON()).split('RNSVGSvgView').length;
    expect(icons(add)).toBe(icons(s.getByTestId('task-due-row')) - 1);
    await fireEvent.press(add);
    expect(sheetEl().props).toMatchObject({ taskId: 't1' });
    expect(sheetEl().props.reminderId).toBeUndefined();
  });

  test('чипы по списку: каждое напоминание словами; нажатие открывает лист этого напоминания', async () => {
    const day = new Date(2026, 9, 18, 9, 0).toISOString();
    patchTask({ dueAt: at(18), slots: [slotAt] });
    setList([
      { id: 'a', kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min' },
      { id: 'b', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' },
      { id: 'c', kind: 'before', anchor: 'due', offsetMin: 0, unit: 'min' },
      { id: 'd', kind: 'before', anchor: 'start', offsetMin: 0, unit: 'min' },
      { id: 'e', kind: 'at', at: day },
      { id: 'f', kind: 'repeat', rule: rule(), time: '09:00', start: day },
      { id: 'g', kind: 'repeat', rule: rule({ freq: 'week', weekdays: [3, 1] }), time: '09:00', start: day },
      { id: 'h', kind: 'repeat', rule: rule({ freq: 'month' }), time: '09:00', start: new Date(2026, 10, 5).toISOString() },
      { id: 'i', kind: 'before', anchor: 'due', offsetMin: 2880, unit: 'day' },
    ]);
    const s = await screen();
    const expected = {
      a: 'За 15 мин до начала',
      b: 'За 1 ч до дедлайна',
      c: 'В момент дедлайна',
      d: 'В момент начала',
      e: `${fmtDateShort(day, 'ru')}, 09:00`,
      f: 'Каждый день в 09:00',
      g: 'По Пн, Ср в 09:00',
      h: 'Каждый месяц 5-го в 09:00',
      i: 'За 2 дня до дедлайна',
    };
    for (const [id, text] of Object.entries(expected)) within(s.getByTestId(`task-reminder-${id}`)).getByText(text);
    expect(within(s.getByTestId('task-reminders')).getAllByRole('button')).toHaveLength(Object.keys(expected).length + 1);
    await fireEvent.press(s.getByTestId('task-reminder-g'));
    expect(sheetEl().props).toMatchObject({ taskId: 't1', reminderId: 'g' });
  });

  test('на английском и казахском те же чипы собираются из своих словарей', async () => {
    patchTask({ dueAt: at(18) });
    setList([{ id: 'b', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' }]);
    const s = await screen();
    for (const lang of LANGS) {
      await act(async () => { useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang } }); });
      within(s.getByTestId('task-reminder-b')).getByText(t(lang, 'remind.before_due_n', { n: 1, unit: t(lang, 'remind.unit_hour') }));
      s.getByText(t(lang, 'remind.label'));
    }
  });

  test('только старые поля (десктоп 0.4.3, телефон 1.2.2): «до дедлайна» и «один раз» читаются как чипы', async () => {
    patchTask({ dueAt: at(18), remindOffsetMin: 60 });
    const s = await screen();
    within(s.getByTestId('task-reminder-legacy-due')).getByText('За 1 ч до дедлайна');
    await act(async () => { patchTask({ remindOffsetMin: null, remindAt: new Date(2026, 9, 19, 8, 30).toISOString() }); });
    within(s.getByTestId('task-reminder-legacy-at')).getByText(`${fmtDateShort(new Date(2026, 9, 19, 8, 30).toISOString(), 'ru')}, 08:30`);
  });

  test('чип, чьего якоря у задачи нет (дедлайн сняли), тише остальных — но остаётся и открывается', async () => {
    const { result } = await renderHook(() => useColors());
    patchTask({ dueAt: at(18), slots: [slotAt] });
    setList([
      { id: 'a', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' },
      { id: 'b', kind: 'before', anchor: 'start', offsetMin: 15, unit: 'min' },
    ]);
    const s = await screen();
    const colorOf = (id, text) => (StyleSheet.flatten(within(s.getByTestId(`task-reminder-${id}`)).getByText(text).props.style) || {}).color;
    const live = colorOf('a', 'За 1 ч до дедлайна');
    expect(live).not.toBe(result.current.textFaint);
    await act(async () => { patchTask({ dueAt: null }); });
    expect(colorOf('a', 'За 1 ч до дедлайна')).toBe(result.current.textFaint);
    // Якорь есть — цвет прежний.
    expect(colorOf('b', 'За 15 мин до начала')).toBe(live);
    await fireEvent.press(s.getByTestId('task-reminder-a'));
    expect(sheetEl().props).toMatchObject({ reminderId: 'a' });
  });

  test('у строки дедлайна напоминаний нет: ни «Напомнить», ни переключателя; лист дедлайна — только дата и время', async () => {
    patchTask({ dueAt: at(18) });
    const s = await screen();
    expect(s.queryByTestId('task-remind-row')).toBeNull();
    expect(s.queryByTestId('task-remind-value')).toBeNull();
    expect(s.queryAllByRole('switch')).toHaveLength(0);

    await fireEvent.press(s.getByTestId('task-due-value'));
    expect(sheetEl().props.remindOnly).toBeUndefined();
    const sheet = await render(<BottomSheet />);
    within(sheet.getByTestId('sheet-head-row')).getByText(t('ru', 'due.label'));
    sheet.getByText(t('ru', 'due.date'));
    sheet.getByText(t('ru', 'due.time'));
    expect(sheet.queryByTestId('remind-list')).toBeNull();
    expect(sheet.queryByText('Напомнить')).toBeNull();
  });

  test('дедлайн переносится — список напоминаний и зеркало остаются как были', async () => {
    patchTask({ dueAt: at(18) });
    setList([{ id: 'b', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' }]);
    const list = stored().reminders;
    const s = await screen();
    await fireEvent.press(s.getByTestId('task-due-value'));
    const sheet = await render(<BottomSheet />);
    await fireEvent.press(within(sheet.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.save')));
    expect(stored().dueAt).toBeTruthy();
    expect(stored().reminders).toBe(list);
    expect(stored().remindOffsetMin).toBe(60);
  });

  test('дедлайн снят — напоминания остаются (ждут нового дедлайна), старые поля не обнуляются', async () => {
    patchTask({ dueAt: at(18) });
    setList([{ id: 'b', kind: 'before', anchor: 'due', offsetMin: 60, unit: 'hour' }]);
    const list = stored().reminders;
    const s = await screen();
    await fireEvent.press(s.getByTestId('task-due-value'));
    const sheet = await render(<BottomSheet />);
    await fireEvent.press(within(sheet.getByTestId('sheet-footer-content')).getByText(t('ru', 'due.clear')));
    expect(stored().dueAt).toBeNull();
    expect(stored().reminders).toBe(list);
    expect(stored().remindOffsetMin).toBe(60);
    s.getByTestId('task-reminder-b');
  });
});

// Заметки задачи — во всю высоту экрана (17 октября 2026, третья жалоба:
// «блок редактирования текста должен быть на всю высоту экрана на мобилке;
// я рисую, а рисуется только в ограниченной области»).
// Запуск: npm run test:mobile (из корня)
//
// Правило (TaskDetailScreen.js: notesFloor, notesMinHeight): WebView заметок
// занимает всё от своего верха до низа экрана за вычетом того, что там лежит, —
// клавиатуры с панелью над ней, панели пера или свёрнутого шита, — при любой
// длине текста и без полосы воздуха под собой; высота известна с первого
// кадра (из окна), а не только после замера раскладки. Пустое место под
// текстом внутри WebView — сам #host страницы (min-height: 100vh): касание и
// перо ловит редактор. Холст пера внутри страницы (src/editor/ink.js) — его
// забота; здесь — что телефон отдаёт странице всю площадь.
//
// Проверяется применение: что экран задачи даёт DocEditor и что DocEditor
// кладёт в страницу. Окно — из useWindowDimensions, как у экрана.
//
// Клавиатура без высоты (17 октября 2026, найдено в волне 1 на Android):
// плавающая Gboard и строка над физической клавиатурой открыты, но места
// снизу не занимают. React Native шлёт keyboardDidShow с высотой 0, а
// библиотека клавиатуры (react-native-keyboard-controller) — «открыта,
// высота 0» и progress 1: шит уходил вниз по её кадрам, а поле держало место
// под шит — под ним пустая полоса ~144 dp. Теперь «открыта ли» при нулевой
// высоте решает библиотека, и поле — до панели редактора над низом экрана.
//
// Парящий остров (19 октября 2026): панель стоит над опорой с воздухом
// TOOLBAR_GAP, и поле кончается у верха острова — под ним TOOLBAR_SPACE
// (остров и воздух), а не одна высота строки: последняя строка текста не
// уходит под остров.
import { DeviceEventEmitter, StyleSheet, useWindowDimensions } from 'react-native';
import { render, renderHook, act } from '@testing-library/react-native';
import * as KeyboardLib from 'react-native-keyboard-controller';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import BottomSheet from '../src/components/BottomSheet';
import { EDITOR_BASE_URL } from '../src/components/DocEditor';
import { TOOLBAR_HEIGHT, TOOLBAR_GAP, TOOLBAR_SPACE } from '../src/components/EditorToolbar';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';

// WebView — с нативной частью: подменён, пропсы последнего — global.__web.
jest.mock('react-native-webview', () => {
  const React = require('react');
  return {
    WebView: React.forwardRef((props, ref) => {
      global.__web = props;
      React.useImperativeHandle(ref, () => ({ postMessage: () => {} }));
      return null;
    }),
  };
});

// Шапка страницы задачи: insets.top (в тестах 0) и 48.
const HEADER = 48;
// Свёрнутый шит до замера — SHEET_COLLAPSED (130), системной панели в тестах нет.
const SHEET = 130;
// Окно — как его видит экран (useWindowDimensions).
let WIN;
beforeAll(async () => { WIN = (await renderHook(() => useWindowDimensions())).result.current; });
const window = () => WIN;

const say = (m) => act(async () => { global.__web.onMessage({ nativeEvent: { url: EDITOR_BASE_URL, data: JSON.stringify(m) } }); });
const keyboard = (shown, height = 300) => act(async () => {
  const H = window().height;
  // В jest Platform.OS — ios: экран слушает keyboardWill*.
  DeviceEventEmitter.emit(shown ? 'keyboardWillShow' : 'keyboardWillHide', { endCoordinates: { height: shown ? height : 0, screenY: shown ? H - height : H, width: 390, screenX: 0 } });
});
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), push: jest.fn(), setOptions: jest.fn(), getState: () => ({ routes: [], index: 0 }), addListener: jest.fn(() => () => {}) });

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', editor: {} },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], notes: null, sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null }],
    activeTimer: null,
  });
});
afterEach(async () => {
  KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 0;
  await keyboard(false);
  await libKeyboard(null);
});

/** Событие библиотеки клавиатуры (KeyboardEvents) всем, кто на него
 *  подписан: { height } — keyboardDidShow, null — keyboardDidHide. */
const libKeyboard = (e) => act(async () => {
  const name = e ? 'keyboardDidShow' : 'keyboardDidHide';
  KeyboardLib.KeyboardEvents.addListener.mock.calls
    .filter(([event]) => event === name)
    .forEach(([, fn]) => fn(e || { height: 0 }));
});

async function openTask() {
  const q = await render(<><TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
  return {
    q,
    /** Высота WebView заметок (обёртка doc-editor). */
    height: () => StyleSheet.flatten(q.getByTestId('doc-editor').props.style).height,
    /** Нижний отступ страницы под полем. */
    pageBottom: () => StyleSheet.flatten(q.getByTestId('task-scroll').props.contentContainerStyle).paddingBottom,
    /** Раскладка, как на телефоне: прокрутка — от шапки до низа окна, поле заметок — на top в ней. */
    layout: (top) => act(async () => {
      q.getByTestId('task-scroll').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: window().height - HEADER } } });
      q.getByTestId('task-notes').props.onLayout({ nativeEvent: { layout: { x: 10, y: top, width: 370, height: 96 } } });
    }),
  };
}

test('до первого замера: поле — от шапки до низа окна за вычетом шита, с пером — панели пера', async () => {
  const H = window().height;
  const { height } = await openTask();
  // Пустые заметки: редактор присылает высоту текста — малую.
  await say({ type: 'height', px: 80, height: 80 });
  expect(height()).toBeGreaterThanOrEqual(H - HEADER - SHEET);
  await say({ type: 'ink', on: true, tool: 'pen', color: 'ink', size: 3 });
  expect(height()).toBeGreaterThanOrEqual(H - HEADER - TOOLBAR_SPACE);
});

test('после замера: низ поля — ровно у того, что под ним (шит, панель пера, клавиатура с панелью), при любом тексте', async () => {
  const H = window().height;
  const top = 120;
  const { height, pageBottom, layout } = await openTask();
  await layout(top);
  await say({ type: 'height', px: 80, height: 80 });
  /** Низ поля в окне. */
  const bottom = () => HEADER + top + height();

  // Без клавиатуры и пера — до свёрнутого шита, без полосы воздуха.
  expect(bottom()).toBe(H - SHEET);
  // Перо: шит уходит вниз, поле — до панели пера.
  await say({ type: 'ink', on: true, tool: 'pen', color: 'ink', size: 3 });
  expect(bottom()).toBe(H - TOOLBAR_SPACE);
  await say({ type: 'ink', on: false });
  // Клавиатура 320: до панели над ней.
  await keyboard(true, 320);
  expect(bottom()).toBe(H - 320 - TOOLBAR_SPACE);
  await keyboard(false);
  expect(bottom()).toBe(H - SHEET);

  // Короткий текст страницу не листает: снизу она держит ровно то, что под
  // полем, и вместе с ним выходит в высоту прокрутки.
  expect(top + height() + pageBottom()).toBe(H - HEADER);

  // Длинный текст растит поле дальше низа экрана — прокручивает страница.
  await say({ type: 'height', px: H * 2, height: H * 2 });
  expect(height()).toBe(H * 2);
  await say({ type: 'height', px: 80, height: 80 });
  expect(bottom()).toBe(H - SHEET);
});

test('пустое место под текстом — сам #host страницы, во всю высоту WebView', async () => {
  await openTask();
  expect(global.__web.source.html).toMatch(/#host{min-height:100vh;}/);
  // Страница не листается сама — высоту ей задаёт телефон.
  expect(global.__web.scrollEnabled).toBe(false);
});

test('клавиатура 0 при видимом фокусе (плавающая, физическая): поле — до панели редактора, без полосы под шит', async () => {
  const H = window().height;
  const top = 120;
  const { q, height, pageBottom, layout } = await openTask();
  await layout(top);
  await say({ type: 'height', px: 80, height: 80 });
  const bottom = () => HEADER + top + height();
  expect(bottom()).toBe(H - SHEET);

  // Фокус в тексте; React Native: «открыта» с высотой 0 — сам по себе это
  // не «закрыта», но и не «открыта»: решает библиотека.
  await say({ type: 'format', state: { focused: true } });
  await keyboard(true, 0);
  // Библиотека: открыта, высота 0, ход окончен (progress 1 — шит внизу).
  KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 1;
  await libKeyboard({ height: 0 });

  // Под полем — только панель редактора (системной панели в тестах нет):
  // ни места под шит, ни лишней прокрутки.
  expect(q.getByTestId('editor-toolbar')).toBeTruthy();
  expect(bottom()).toBe(H - TOOLBAR_SPACE);
  expect(pageBottom()).toBe(TOOLBAR_SPACE);
  expect(top + height() + pageBottom()).toBe(H - HEADER);

  // Клавиатуру снова прикрепили (320): поле — до панели над ней; места под
  // клавиатуру страница больше не держит — его добавляет прокрутка.
  await libKeyboard({ height: 320 });
  expect(bottom()).toBe(H - 320 - TOOLBAR_SPACE);
  expect(pageBottom()).toBe(0);

  // Закрылась — поле снова до свёрнутого шита.
  KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 0;
  await libKeyboard(null);
  await keyboard(false);
  expect(bottom()).toBe(H - SHEET);
});

test('панель — остров с воздухом: поле кончается ровно у его верха — над клавиатурой и над шитом при выделенной картинке', async () => {
  expect(TOOLBAR_SPACE).toBe(TOOLBAR_HEIGHT + TOOLBAR_GAP);
  expect(TOOLBAR_GAP).toBeGreaterThan(0);
  const H = window().height;
  const top = 120;
  const { q, height, layout } = await openTask();
  await layout(top);
  await say({ type: 'height', px: 80, height: 80 });
  const bottom = () => HEADER + top + height();
  /** Верх острова в окне: низ дока поднят на translateY, остров — TOOLBAR_HEIGHT над ним. */
  const islandTop = () => {
    const dock = StyleSheet.flatten(q.getByTestId('editor-toolbar-dock').props.style);
    return H + dock.transform.find((x) => 'translateY' in x).translateY - TOOLBAR_HEIGHT;
  };
  const frames = KeyboardLib.useReanimatedKeyboardAnimation();
  try {
    // Клавиатура 320 (кадры библиотеки и событие): остров на воздух выше её
    // верха, поле — до острова, последняя строка под него не уходит.
    await say({ type: 'format', state: { focused: true } });
    frames.height.value = -320;
    await keyboard(true, 320);
    expect(islandTop()).toBe(H - 320 - TOOLBAR_GAP - TOOLBAR_HEIGHT);
    expect(bottom()).toBe(islandTop());
    frames.height.value = 0;
    await keyboard(false);
    await say({ type: 'format', state: { focused: false } });
    // Выделили картинку без клавиатуры: остров — над свёрнутым шитом с тем
    // же воздухом, поле — снова до его верха.
    await say({ type: 'context', kind: 'image', state: { align: 'center', widthPct: 60 } });
    q.getByTestId('tb-row-cx-image');
    expect(islandTop()).toBe(H - SHEET - TOOLBAR_GAP - TOOLBAR_HEIGHT);
    expect(bottom()).toBe(islandTop());
  } finally {
    frames.height.value = 0;
  }
});

test('без фокуса в тексте и без клавиатуры событие React Native с высотой 0 клавиатуру не открывает', async () => {
  const H = window().height;
  const top = 120;
  const { height, layout } = await openTask();
  await layout(top);
  await say({ type: 'height', px: 80, height: 80 });
  await keyboard(true, 0);
  expect(HEADER + top + height()).toBe(H - SHEET);
});

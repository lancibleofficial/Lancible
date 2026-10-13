// Редактор на телефоне вживую (12 октября 2026). Запуск: npm run test:mobile (из корня)
//
// Заметки задачи — живой редактор прямо на странице, а не предпросмотр:
// касание — курсор, клавиатура, панель над ней; шит с таймером, пока открыта
// клавиатура, уходит вниз и возвращается. Редактор документа — на той же
// нативной панели. Проверяется применение: что экран шлёт странице и что
// делает по её сообщениям (протокол — lib/editorBridge.js).
//
// 13 октября 2026 (пользователь на настоящем телефоне: «неудобно»): масштаба
// (щипка) нет; полноэкранного режима у заметок нет — только точка
// «сохранено» в строке тегов; поле заметок тянется до низа видимой страницы
// (до шита, а с клавиатурой — до панели над ней), а касание пустого места
// под текстом ставит курсор в конец (это делает редактор — e2e editor.spec).
import { DeviceEventEmitter, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import * as KeyboardLib from 'react-native-keyboard-controller';
import TaskDetailScreen, { caretShift, CARET_GAP, notesMinHeight } from '../src/screens/TaskDetailScreen';
import EditorScreen from '../src/screens/EditorScreen';
import DocumentsScreen from '../src/screens/DocumentsScreen';
import BottomSheet from '../src/components/BottomSheet';
import { EDITOR_BASE_URL } from '../src/components/DocEditor';
import { TOOLBAR_HEIGHT } from '../src/components/EditorToolbar';
import { SAVE_MS } from '../src/hooks/useEditorSession';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { shareTextFile } from '../src/lib/exportRunner';
import { pickPhoto } from '../src/lib/photoPicker';
import DocCore from '../src/core/doc.js';
import { EDITOR_CSS, EDITOR_JS } from '../src/editor/editorBundle';
import { spacing } from '../src/theme';
import { t } from '../src/lib/i18n';

// WebView — с нативной частью: подменён. Пропсы последнего — global.__web,
// посланное в страницу копится в global.__posted.
jest.mock('react-native-webview', () => {
  const React = require('react');
  return {
    WebView: React.forwardRef((props, ref) => {
      global.__web = props;
      React.useImperativeHandle(ref, () => ({ postMessage: (m) => global.__posted.push(JSON.parse(m)) }));
      return null;
    }),
  };
});
jest.mock('../src/lib/exportRunner', () => ({ runExport: jest.fn(), shareTextFile: jest.fn(async () => {}) }));
// Системный выбор файла — нативный: подменён, отдаёт то, что задаст тест.
jest.mock('../src/lib/photoPicker', () => ({ pickPhoto: jest.fn(), PHOTO_TOO_BIG: 'photo_too_big', PHOTO_MAX_BYTES: 2 * 1024 * 1024 }));

const NOTES = DocCore.writeNotes({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Старое' }] }] }, comments: [], ink: [] });
const container = (text) => ({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, comments: [], ink: [] });
// Сообщение страницы — с её адресом: чужие DocEditor не принимает.
const say = (m) => act(async () => { global.__web.onMessage({ nativeEvent: { url: EDITOR_BASE_URL, data: JSON.stringify(m) } }); });
const posted = (type) => global.__posted.filter((m) => m.type === type);
const lastPosted = (type) => posted(type).pop();
/** Начальные данные страницы — объект S из её скрипта. */
const pageInit = () => JSON.parse(global.__web.source.html.match(/var S = (\{.*?\});\n/s)[1]);
const nav = () => {
  const ls = {};
  return {
    navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), getState: () => ({ routes: [], index: 0 }),
    addListener: jest.fn((event, fn) => { ls[event] = fn; return () => { delete ls[event]; }; }),
    fire: (event) => act(async () => { if (ls[event]) ls[event]({ data: {} }); }),
  };
};
const keyboard = (shown) => act(async () => {
  // В jest Platform.OS — ios: экран слушает keyboardWill*.
  DeviceEventEmitter.emit(shown ? 'keyboardWillShow' : 'keyboardWillHide', { endCoordinates: { height: shown ? 300 : 0, screenY: shown ? 544 : 844, width: 390, screenX: 0 } });
});
const translateY = (node) => (StyleSheet.flatten(node.props.style).transform || []).find((x) => 'translateY' in x).translateY;

beforeEach(() => {
  global.__posted = [];
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 1000, currency: 'RUB', editor: {} },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    documents: [{ id: 'd1', projectId: null, title: 'Бриф', pinnedAt: null, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z', body: container('Текст брифа') }],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], notes: NOTES,
      sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null,
    }],
    activeTimer: null,
  });
});
afterEach(async () => {
  KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 0;
  await keyboard(false);
});

const task = (navigation = nav()) => render(<><TaskDetailScreen navigation={navigation} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
const editor = (params, navigation = nav()) => render(<><EditorScreen navigation={navigation} route={{ params }} /><BottomSheet /></>);
/** Текст в фокусе и клавиатура открыта — так панель встаёт над ней. */
const typing = async () => { await say({ type: 'format', state: { focused: true, canUndo: true } }); await keyboard(true); };

describe('заметки задачи — живой редактор на странице', () => {
  test('не предпросмотр: правится на месте, высота по тексту, панель нативная', async () => {
    const q = await task();
    const S = pageInit();
    expect(S).toMatchObject({ live: true, placeholder: t('ru', 'editor.empty') });
    expect(global.__web.source.html).toMatch(/nativeToolbar: true/);
    expect(S.content.doc.content[0].content[0].text).toBe('Старое');
    expect(global.__web.source.html).toMatch(/autoHeight: !!S\.live/);
    // Страница не прокручивается сама — её прокручивает экран задачи.
    expect(global.__web.scrollEnabled).toBe(false);
    await say({ type: 'height', px: 420, height: 420 });
    expect(StyleSheet.flatten(q.getByTestId('doc-editor').props.style).height).toBe(420);
  });

  test('полноэкранного режима нет: ни кнопки, ни перехода — только точка «сохранено» в строке тегов', async () => {
    const navigation = nav();
    const q = await task(navigation);
    expect(q.queryByTestId('editor-fullscreen')).toBeNull();
    expect(q.queryByTestId('editor-collapse')).toBeNull();
    expect(q.queryByText('Во весь экран')).toBeNull();
    expect(t('ru', 'editor.fullscreen')).toBe('editor.fullscreen');
    // Точка — последним в строке тегов, после «+ теги».
    const dot = q.getByTestId('editor-saved');
    const row = dot.parent;
    expect(row.children[row.children.length - 1]).toBe(dot);
    expect(StyleSheet.flatten(dot.props.style)).toMatchObject({ width: 8, height: 8, marginLeft: 'auto' });
    await say({ type: 'change', content: container('Набрал') });
    await navigation.fire('blur');
    expect(navigation.navigate).not.toHaveBeenCalled();
    // Уходя со страницы, набранное — сразу в задачу.
    expect(DocCore.readNotes(useAppStore.getState().tasks[0].notes).doc.content[0].content[0].text).toBe('Набрал');
  });

  test('поле заметок — до низа видимой страницы: до шита, с клавиатурой — до панели; длинный текст растит его', async () => {
    const q = await task();
    const height = () => StyleSheet.flatten(q.getByTestId('doc-editor').props.style).height;
    // Прокрутка 700 по высоте, поле начинается на 120.
    await act(async () => { q.getByTestId('task-scroll').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } }); });
    await act(async () => { q.getByTestId('task-notes').props.onLayout({ nativeEvent: { layout: { x: 10, y: 120, width: 370, height: 96 } } }); });
    // Свёрнутый шит — 130 (без системной панели в тестах), и воздух.
    const toSheet = 700 - 120 - 130 - spacing.lg;
    expect(height()).toBe(toSheet);
    expect(notesMinHeight({ viewH: 700, top: 120, sheetH: 130 })).toBe(toSheet);
    await say({ type: 'height', px: 200, height: 200 });
    // Короткий текст — поле всё равно до шита.
    expect(height()).toBe(toSheet);
    await say({ type: 'height', px: 900, height: 900 });
    // Длинный текст растит поле.
    expect(height()).toBe(900);
    await say({ type: 'height', px: 200, height: 200 });
    // Клавиатура 300: поле — до панели над ней.
    await keyboard(true);
    expect(height()).toBe(700 - 120 - 300 - TOOLBAR_HEIGHT - spacing.lg);
    // Пока шит внизу, страница не держит под него места — короткий текст не листается.
    expect(StyleSheet.flatten(q.getByTestId('task-scroll').props.contentContainerStyle).paddingBottom).toBe(spacing.lg);
    await keyboard(false);
    expect(height()).toBe(toSheet);
    expect(StyleSheet.flatten(q.getByTestId('task-scroll').props.contentContainerStyle).paddingBottom).toBe(130 + spacing.lg);
    // Пустое место под коротким текстом — сам #host страницы: касание по нему
    // ловит редактор (src/editor/index.js: onBlankDown).
    expect(global.__web.source.html).toMatch(/#host{min-height:100vh;}/);
  });

  test('правка сохраняется в задачу через 300 мс; точка «сохранено» гаснет и зажигается', async () => {
    jest.useFakeTimers();
    try {
      const q = await task();
      q.getByTestId('editor-saved');
      await say({ type: 'change', content: container('Новое') });
      q.getByTestId('editor-saving');
      await act(async () => { jest.advanceTimersByTime(SAVE_MS + 10); });
      q.getByTestId('editor-saved');
      expect(DocCore.readNotes(useAppStore.getState().tasks[0].notes).doc.content[0].content[0].text).toBe('Новое');
    } finally {
      jest.useRealTimers();
    }
  });

  test('клавиатура открыта — шит с таймером уходит вниз и возвращается (кадры клавиатуры)', async () => {
    const q = await task();
    const down = translateY(q.getByTestId('task-sheet'));
    KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 1;
    await q.rerender(<><TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
    // Свёрнутая часть шита (130) и воздух — целиком ниже экрана.
    expect(translateY(q.getByTestId('task-sheet')) - down).toBe(130 + spacing.lg);
    KeyboardLib.useReanimatedKeyboardAnimation().progress.value = 0;
    await q.rerender(<><TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);
    expect(translateY(q.getByTestId('task-sheet'))).toBe(down);
  });

  test('без кадров — по событию клавиатуры: ушёл и вернулся', async () => {
    const q = await task();
    const down = translateY(q.getByTestId('task-sheet'));
    await keyboard(true);
    expect(translateY(q.getByTestId('task-sheet')) - down).toBe(130 + spacing.lg);
    await keyboard(false);
    expect(translateY(q.getByTestId('task-sheet'))).toBe(down);
  });

  test('раскрытый шит не уходит: его поля — его дело', async () => {
    const q = await task();
    await fireEvent.press(q.getByText(t('ru', 'task.details')));
    // Положение раскрытого шита ведёт его жест (в подмене Reanimated оно не
    // едет); клавиатура к нему ничего не добавляет.
    const open = translateY(q.getByTestId('task-sheet'));
    await keyboard(true);
    expect(translateY(q.getByTestId('task-sheet'))).toBe(open);
  });

  test('панель — с клавиатурой и фокусом в тексте; кнопки шлют команды странице', async () => {
    const q = await task();
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
    await typing();
    q.getByTestId('editor-toolbar');
    await fireEvent.press(q.getByTestId('tb-format'));
    await fireEvent.press(q.getByTestId('tb-bold'));
    await fireEvent.press(q.getByTestId('tb-back'));
    await fireEvent.press(q.getByTestId('tb-undo'));
    expect(posted('exec')).toEqual([{ type: 'exec', name: 'bold' }, { type: 'exec', name: 'undo' }]);
  });

  test('фокус в названии задачи (не в тексте) — панели редактора нет', async () => {
    const q = await task();
    await say({ type: 'format', state: { focused: false } });
    await keyboard(true);
    expect(q.queryByTestId('editor-toolbar')).toBeNull();
  });

  test('перо: страница переходит в пометки, палец рисует — страница не листается, шит внизу', async () => {
    const q = await task();
    const down = translateY(q.getByTestId('task-sheet'));
    await typing();
    await fireEvent.press(q.getByTestId('tb-pen-mode'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'annotate', arg: true });
    await say({ type: 'ink', on: true, tool: 'pen', color: 'ink', size: 3 });
    await keyboard(false);
    q.getByTestId('tb-row-ink');
    expect(q.getByTestId('task-scroll').props.scrollEnabled).toBe(false);
    expect(translateY(q.getByTestId('task-sheet')) - down).toBe(130 + spacing.lg);
    await fireEvent.press(q.getByTestId('tb-inkDone'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'inkDone' });
  });

  test('курсор под клавиатурой — докрутить вниз, над шапкой — вверх, виден — стоять', () => {
    const kbTop = 544;
    const base = { boxTop: 200, kbTop, viewTop: 100 };
    // Низ курсора на 520 + воздух: под панелью (544 − 48).
    expect(caretShift({ ...base, caret: { top: 300, bottom: 320 } })).toBe(200 + 320 + CARET_GAP - (kbTop - TOOLBAR_HEIGHT));
    expect(caretShift({ ...base, caret: { top: 20, bottom: 40 } })).toBe(0);
    expect(caretShift({ ...base, boxTop: -400, caret: { top: 420, bottom: 440 } })).toBe(-(100 - (-400 + 420 - CARET_GAP)));
  });
});

describe('редактор документа', () => {
  test('документ из «Документов» — та же нативная панель; экран — только для документов', async () => {
    const navigation = nav();
    const list = await render(<DocumentsScreen navigation={navigation} route={{}} />);
    await fireEvent.press(list.getByText('Бриф'));
    expect(navigation.navigate).toHaveBeenCalledWith('Editor', { id: 'd1' });
    const q = await editor(navigation.navigate.mock.calls[0][1]);
    q.getByTestId('editor-saved');
    expect(q.queryByTestId('editor-collapse')).toBeNull();
    expect(pageInit()).toMatchObject({ live: false });
    expect(pageInit().content.doc.content[0].content[0].text).toBe('Текст брифа');
    await typing();
    await fireEvent.press(q.getByTestId('tb-bullet'));
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'bullet' });
    q.getByTestId('tb-pen-mode');
  });

  test('ссылку спрашивает нижний лист: адрес и подпись уходят в setLink', async () => {
    const q = await editor({ id: 'd1' });
    await say({ type: 'link', href: '', needText: true });
    await fireEvent.changeText(q.getByTestId('link-url'), 'lancible.app');
    await fireEvent.changeText(q.getByTestId('link-text'), 'Сайт');
    await fireEvent.press(q.getByTestId('link-save'));
    expect(lastPosted('setLink')).toEqual({ type: 'setLink', href: 'lancible.app', text: 'Сайт' });
  });

  test('ссылка уже есть — её можно убрать пустым адресом', async () => {
    const q = await editor({ id: 'd1' });
    await say({ type: 'link', href: 'https://a.b', needText: false });
    expect(q.queryByTestId('link-text')).toBeNull();
    await fireEvent.press(q.getByTestId('link-remove'));
    expect(lastPosted('setLink')).toEqual({ type: 'setLink', href: '', text: '' });
  });

  test('фото выбирает телефон и отдаёт странице байтами; передумали — cancel', async () => {
    const q = await editor({ id: 'd1' });
    await typing();
    await fireEvent.press(q.getByTestId('tb-photo'));
    // Кнопка — команда редактору, а он просит фото у телефона (image-pick).
    expect(lastPosted('exec')).toEqual({ type: 'exec', name: 'image' });
    pickPhoto.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,AAAA', name: 'photo.png' });
    await say({ type: 'image-pick', purpose: 'insert' });
    expect(lastPosted('insertImage')).toEqual({ type: 'insertImage', dataUrl: 'data:image/png;base64,AAAA', name: 'photo.png' });
    pickPhoto.mockResolvedValueOnce(null);
    await say({ type: 'image-pick', purpose: 'replace' });
    expect(lastPosted('insertImage')).toEqual({ type: 'insertImage', cancel: true });
  });

  test('фото и после сжатия больше 2 МБ — тост, а странице cancel; другая ошибка — без тоста', async () => {
    // Тост гаснет по таймеру — часы подменены, чтобы он не пережил тест.
    jest.useFakeTimers();
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await editor({ id: 'd1' });
      pickPhoto.mockRejectedValueOnce(Object.assign(new Error('photo too big'), { code: 'photo_too_big', bytes: 3e6 }));
      await say({ type: 'image-pick', purpose: 'insert' });
      expect(lastPosted('insertImage')).toEqual({ type: 'insertImage', cancel: true });
      expect(useAppStore.getState().toastMessage).toBe(t('ru', 'editor.photo_too_big', { mb: 2 }));
      expect(err).not.toHaveBeenCalled();
      await act(async () => { jest.runOnlyPendingTimers(); });
      expect(useAppStore.getState().toastMessage).toBeNull();

      global.__posted = [];
      pickPhoto.mockRejectedValueOnce(new Error('нет доступа'));
      await say({ type: 'image-pick', purpose: 'insert' });
      expect(lastPosted('insertImage')).toEqual({ type: 'insertImage', cancel: true });
      expect(useAppStore.getState().toastMessage).toBeNull();
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
      jest.useRealTimers();
    }
  });

  test('экспорт: файл отдаёт телефон — листом «Поделиться»', async () => {
    const q = await editor({ id: 'd1' });
    await say({ type: 'export', kind: 'html', name: 'Бриф.html', mime: 'text/html', text: '<p>x</p>' });
    expect(shareTextFile).toHaveBeenLastCalledWith('Бриф.html', 'text/html', '<p>x</p>', 'ru', expect.any(Function));
    await typing();
    await fireEvent.press(q.getByTestId('tb-more'));
    await fireEvent.press(q.getByTestId('tb-export'));
    expect(shareTextFile).toHaveBeenLastCalledWith('Бриф.md', 'text/markdown', expect.stringContaining('Текст брифа'), 'ru', expect.any(Function));
  });

});

describe('масштаба нет (13 октября 2026)', () => {
  test('страница щипком не масштабируется, масштаба текста нет — и прошлый из настроек не возвращается', async () => {
    // На устройстве мог остаться масштаб прошлой версии — он больше ничего не значит.
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, editor: { zoom: 1.4 } } });
    const q = await task();
    // Страница без сборки редактора: сам редактор setZoom понимает (десктоп).
    const html = global.__web.source.html.replace(EDITOR_JS, '').replace(EDITOR_CSS, '');
    expect(html).toMatch(/user-scalable=no/);
    expect(html).not.toMatch(/user-scalable=yes|maximum-scale=4/);
    expect(html).not.toMatch(/--led-zoom|S\.zoom|zoom:/);
    expect(pageInit()).not.toHaveProperty('zoom');
    await say({ type: 'ready' });
    expect(posted('setZoom')).toEqual([]);
    // Жеста щипка над страницей нет: у обёртки редактора нет обработчика жестов.
    expect(q.getByTestId('doc-editor').props.onGestureHandlerEvent).toBeUndefined();
    expect(Object.keys(q.getByTestId('doc-editor').props).filter((k) => /gesture/i.test(k))).toEqual([]);
  });
});

// 13 октября 2026: последние буквы, набранные перед «назад», терялись.
// Страница держала правку 150 мс, а телефон, уходя, сохранял только то, что
// уже получил: спросить страницу он не успевает — WebView размонтирован. Теперь
// страница с nativeToolbar шлёт правку сразу (src/editor/host.js: changeDelay,
// tests/unit/editor-host.test.js), уходя телефон всё же просит её отдать
// задержанное, а название задачи уходит в стор, не дожидаясь своего таймера.
describe('уходя со страницы, набранное не теряется', () => {
  const notesText = () => DocCore.readNotes(useAppStore.getState().tasks[0].notes).doc.content[0].content[0].text;

  test('заметки: уходя (blur), телефон просит страницу отдать задержанное; пришедшее — в задаче и после размонтирования', async () => {
    const navigation = nav();
    const q = await task(navigation);
    expect(posted('flush')).toEqual([]);
    await navigation.fire('blur');
    expect(posted('flush')).toEqual([{ type: 'flush' }]);
    // Ответ страницы пришёл, и экран тут же размонтирован — до 300 мс таймера.
    await say({ type: 'change', content: container('Последние буквы') });
    await q.unmount();
    expect(notesText()).toBe('Последние буквы');
  });

  test('документ: beforeRemove просит страницу отдать задержанное', async () => {
    const navigation = nav();
    await editor({ id: 'd1' }, navigation);
    await navigation.fire('beforeRemove');
    expect(posted('flush')).toEqual([{ type: 'flush' }]);
  });

  test('название задачи: набранное перед уходом — в задаче и на blur, и на размонтировании', async () => {
    jest.useFakeTimers();
    try {
      const navigation = nav();
      const q = await task(navigation);
      await fireEvent.changeText(q.getByDisplayValue('Вёрстка'), 'Вёрстка шапки');
      expect(useAppStore.getState().tasks[0].title).toBe('Вёрстка');
      await navigation.fire('blur');
      expect(useAppStore.getState().tasks[0].title).toBe('Вёрстка шапки');
      await fireEvent.changeText(q.getByDisplayValue('Вёрстка шапки'), 'Вёрстка подвала');
      await q.unmount();
      expect(useAppStore.getState().tasks[0].title).toBe('Вёрстка подвала');
    } finally {
      jest.useRealTimers();
    }
  });

  test('задачу удалили с набранным названием — уход её не возвращает', async () => {
    jest.useFakeTimers();
    try {
      const q = await task();
      await fireEvent.changeText(q.getByDisplayValue('Вёрстка'), 'Вёрстка шапки');
      await act(async () => { useAppStore.getState().deleteTask('t1'); });
      await q.unmount();
      expect(useAppStore.getState().tasks.find((x) => x.id === 't1')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

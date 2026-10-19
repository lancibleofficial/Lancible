// PDF в редакторе на телефоне и перенос картинки с автопрокруткой
// (17 октября 2026, протокол 3 — src/editor/host.js). Запуск: npm run test:mobile (из корня)
//
// С нативной панелью файлов у страницы WebView нет, а PDF-модуль (pdf.js,
// pdf-lib, шрифт; 3 МБ) в строку редактора не входит. Поэтому:
//  - «PDF» в редакторе — pdf-pick: файл выбирает телефон (системный выбор
//    файла, File.pickFileAsync — lib/filePicker.js; только application/pdf,
//    до 20 МБ) и отдаёт странице base64 (pdf-file);
//  - pdf-module — телефон читает ассет assets/editor-pdf.txt (expo-asset) и
//    впрыскивает его в WebView один раз на загрузку страницы; ответ
//    pdf-module-ready даёт сама впрыснутая строка — после модуля;
//  - «Сохранить как PDF» — export kind pdf с base64: файл в кеш и лист
//    «Поделиться»;
//  - autoscroll { dy } — перенос картинки у края: страницу задачи сдвигает
//    телефон, а видимую часть WebView сообщает ей сам (viewport).
// Нативные части (выбор файла, ассет, файлы, «Поделиться», WebView) подменены:
// проверяется, что у них просят и что уходит странице.
import { ScrollView } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { Asset } from 'expo-asset';
import * as Sharing from 'expo-sharing';
import TaskDetailScreen, { notesViewport, VIEWPORT_MS } from '../src/screens/TaskDetailScreen';
import EditorScreen from '../src/screens/EditorScreen';
import BottomSheet from '../src/components/BottomSheet';
import { EDITOR_BASE_URL, PDF_MODULE_WAIT_MS } from '../src/components/DocEditor';
import { parseMessage } from '../src/lib/editorBridge';
import { pickPdf, pdfModuleScript, PDF_MAX_BYTES, PDF_TOO_BIG, PDF_TYPES } from '../src/lib/editorPdf';
import { GESTURE_TIMEOUT_MS } from '../src/hooks/useEditorSession';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

// WebView: пропсы последнего — global.__web, посланное — global.__posted,
// впрыснутое — global.__injected.
jest.mock('react-native-webview', () => {
  const React = require('react');
  return {
    WebView: React.forwardRef((props, ref) => {
      global.__web = props;
      React.useImperativeHandle(ref, () => ({
        postMessage: (m) => global.__posted.push(JSON.parse(m)),
        injectJavaScript: (code) => global.__injected.push(code),
      }));
      return null;
    }),
  };
});
// Ассет модуля: число, как отдаёт require в Metro (самого файла может ещё не
// быть — его кладёт сборка редактора).
jest.mock('../assets/editor-pdf.txt', () => 7, { virtual: true });
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn() } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
// Файлы: { uri → { text, base64, size } } — что «лежит на диске»; записанное и
// удалённое копится в mockFs.log.
const mockFs = { files: {}, log: [] };
jest.mock('expo-file-system', () => {
  class File {
    constructor(a, b) { this.uri = b === undefined ? String(a) : `${a}/${b}`; }
    get exists() { return !!mockFs.files[this.uri]; }
    get size() { return (mockFs.files[this.uri] || {}).size || 0; }
    create() { mockFs.files[this.uri] = mockFs.files[this.uri] || {}; }
    delete() { mockFs.log.push({ delete: this.uri }); delete mockFs.files[this.uri]; }
    write(content, opts) { mockFs.log.push({ write: this.uri, content, opts }); mockFs.files[this.uri] = { content }; }
    async base64() { return mockFs.files[this.uri].base64; }
    async text() { return mockFs.files[this.uri].text; }
  }
  File.pickFileAsync = jest.fn();
  return { File, Paths: { cache: 'file:///cache' } };
});

const say = (m) => act(async () => { global.__web.onMessage({ nativeEvent: { url: EDITOR_BASE_URL, data: JSON.stringify(m) } }); });
const posted = (type) => global.__posted.filter((m) => m.type === type);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), push: jest.fn(), setOptions: jest.fn(), getState: () => ({ routes: [], index: 0 }), addListener: jest.fn(() => () => {}) });
const container = (text) => ({ v: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, comments: [], ink: [] });

/** PDF в «выборе файла»: File.pickFileAsync отдаст его (как на iOS — копией
 *  во временной папке), байты — на «диске». */
function pickedPdf({ name = 'Договор.pdf', size = 120000, base64 = 'JVBERi0xLjcK', uri = 'file:///tmp/com.lancible.app-Inbox/1.pdf' } = {}) {
  mockFs.files[uri] = { base64, size };
  const file = Object.assign(new File(uri), { name, type: 'application/pdf' });
  File.pickFileAsync.mockResolvedValueOnce({ canceled: false, result: file });
  return uri;
}
const cancelled = () => File.pickFileAsync.mockResolvedValueOnce({ canceled: true, result: null });
/** Ассет модуля: текст на «диске», downloadAsync даёт localUri. */
function moduleAsset(text = 'window.LancibleEditorPdf={v:1};') {
  const localUri = 'file:///cache/ExponentAsset-pdf.txt';
  mockFs.files[localUri] = { text };
  const asset = {
    uri: 'http://10.0.2.2:8081/assets/editor-pdf.txt',
    localUri: null,
    downloadAsync: jest.fn(async () => { asset.localUri = localUri; return asset; }),
  };
  Asset.fromModule.mockReturnValue(asset);
  return asset;
}
/** Исполнить впрыснутую строку в «странице»: что получил редактор и что ушло телефону. */
function runInjected(code) {
  const got = { ed: [], host: [] };
  const win = {
    __ed: { receive: (m) => { got.ed.push(m); return true; } },
    ReactNativeWebView: { postMessage: (s) => got.host.push(JSON.parse(s)) },
  };
  // В «странице» window — это win; непрямой eval строки модуля пишет в
  // глобальную область, поэтому модуль из тестов ставит window.… явно.
  const prev = global.window;
  global.window = win;
  try {
    // eslint-disable-next-line no-new-func
    new Function(code)();
  } finally {
    global.window = prev;
  }
  return { ...got, win };
}

beforeEach(() => {
  global.__posted = [];
  global.__injected = [];
  mockFs.files = {};
  mockFs.log = [];
  File.pickFileAsync.mockReset();
  Asset.fromModule.mockReset();
  Sharing.shareAsync.mockClear();
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', editor: {} },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    documents: [{ id: 'd1', projectId: null, title: 'Бриф', pinnedAt: null, createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z', body: container('Текст брифа') }],
    tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], notes: null, sessions: [], dueAt: null, repeat: null, rate: null, pinnedAt: null }],
    activeTimer: null,
  });
});

const doc = () => render(<><EditorScreen navigation={nav()} route={{ params: { id: 'd1' } }} /><BottomSheet /></>);
const task = () => render(<><TaskDetailScreen navigation={nav()} route={{ params: { taskId: 't1' } }} /><BottomSheet /></>);

describe('сообщения протокола 3', () => {
  test('pdf-pick, pdf-module, autoscroll и export с base64 — в одном виде', () => {
    expect(parseMessage({ type: 'pdf-pick', extra: 1 })).toEqual({ type: 'pdf-pick' });
    expect(parseMessage({ type: 'pdf-module' })).toEqual({ type: 'pdf-module' });
    expect(parseMessage({ type: 'autoscroll', dy: -18 })).toEqual({ type: 'autoscroll', dy: -18 });
    expect(parseMessage({ type: 'autoscroll', dy: '7' })).toEqual({ type: 'autoscroll', dy: 7 });
    expect(parseMessage({ type: 'autoscroll', dy: 'x' })).toBeNull();
    expect(parseMessage({ type: 'autoscroll', dy: 0 })).toBeNull();
    expect(parseMessage({ type: 'export', kind: 'pdf', name: 'a.pdf', mime: 'application/pdf', base64: 'data:application/pdf;base64,JVBE' }))
      .toEqual({ type: 'export', kind: 'pdf', name: 'a.pdf', mime: 'application/pdf', text: '', base64: 'JVBE' });
    // Текстовая выгрузка — как была, без base64.
    expect(parseMessage({ type: 'export', kind: 'md', name: 'a.md', mime: 'text/markdown', text: '# a' })).not.toHaveProperty('base64');
  });
});

describe('выбор PDF', () => {
  test('iOS: выбор — File.pickFileAsync, только application/pdf; байты — base64, временная копия выбора после чтения удаляется', async () => {
    const uri = pickedPdf();
    expect(await pickPdf()).toEqual({ name: 'Договор.pdf', base64: 'JVBERi0xLjcK' });
    expect(PDF_TYPES).toEqual(['application/pdf']);
    expect(File.pickFileAsync).toHaveBeenCalledWith({ mimeTypes: ['application/pdf'] });
    expect(mockFs.log).toContainEqual({ delete: uri });
  });

  test('Android: читается сам content:// (копии нет — в Expo Go она ложилась мимо разрешённых папок), и он не удаляется', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      pickedPdf({ name: 'sample-2p.pdf', size: 1265, base64: 'JVBE', uri: 'content://com.android.providers.downloads.documents/document/42' });
      expect(await pickPdf()).toEqual({ name: 'sample-2p.pdf', base64: 'JVBE' });
      expect(File.pickFileAsync).toHaveBeenCalledWith({ mimeTypes: ['application/pdf'] });
      expect(mockFs.log).toEqual([]);
    } finally {
      os.restore();
    }
  });

  test('прежняя форма ответа (сам файл) — тоже PDF; без имени — «document.pdf»', async () => {
    const uri = 'file:///tmp/com.lancible.app-Inbox/2.pdf';
    mockFs.files[uri] = { base64: 'JVBE', size: 10 };
    File.pickFileAsync.mockResolvedValueOnce(new File(uri));
    expect(await pickPdf()).toEqual({ name: 'document.pdf', base64: 'JVBE' });
  });

  test('передумали — null; больше 20 МБ — отказ PDF_TOO_BIG, не читая файл', async () => {
    cancelled();
    expect(await pickPdf()).toBeNull();
    expect(PDF_MAX_BYTES).toBe(20 * 1024 * 1024);
    const uri = pickedPdf({ size: PDF_MAX_BYTES + 1 });
    const read = jest.fn();
    mockFs.files[uri].base64 = undefined;
    Object.defineProperty(mockFs.files[uri], 'base64', { get: read });
    await expect(pickPdf()).rejects.toMatchObject({ code: PDF_TOO_BIG });
    expect(read).not.toHaveBeenCalled();
    expect(mockFs.log).toContainEqual({ delete: uri });
  });

  test('редактор просит PDF — телефон выбирает и отдаёт странице pdf-file; передумали — cancel', async () => {
    await doc();
    pickedPdf();
    await say({ type: 'pdf-pick' });
    await flush();
    expect(posted('pdf-file')).toEqual([{ type: 'pdf-file', name: 'Договор.pdf', base64: 'JVBERi0xLjcK' }]);

    cancelled();
    await say({ type: 'pdf-pick' });
    await flush();
    expect(posted('pdf-file')[1]).toEqual({ type: 'pdf-file', cancel: true });
  });

  test('больше 20 МБ — тост, а странице cancel', async () => {
    await doc();
    pickedPdf({ size: PDF_MAX_BYTES * 2 });
    await say({ type: 'pdf-pick' });
    await flush();
    expect(posted('pdf-file')).toEqual([{ type: 'pdf-file', cancel: true }]);
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'editor.pdf_too_big', { mb: 20 }));
  });
});

describe('PDF-модуль', () => {
  test('по запросу — ассет читается и впрыскивается; ответ редактору — из самой строки, после модуля', async () => {
    const asset = moduleAsset();
    await doc();
    await say({ type: 'ready' });
    await say({ type: 'pdf-module' });
    await flush();
    expect(Asset.fromModule).toHaveBeenCalledWith(7);
    expect(asset.downloadAsync).toHaveBeenCalled();
    expect(global.__injected).toHaveLength(1);
    // Сам телефон pdf-module-ready не шлёт: строка ответит, когда модуль исполнится.
    expect(posted('pdf-module-ready')).toEqual([]);
    const run = runInjected(global.__injected[0]);
    expect(run.win.LancibleEditorPdf).toEqual({ v: 1 });
    expect(run.ed).toEqual([{ type: 'pdf-module-ready' }]);
    expect(run.host).toEqual([{ type: 'pdf-module-loaded', ok: true, error: null }]);

    // Повторный запрос на той же странице — сразу ready, без второго впрыска.
    await say({ type: 'pdf-module-loaded', ok: true, error: null });
    await say({ type: 'pdf-module' });
    await flush();
    expect(global.__injected).toHaveLength(1);
    expect(posted('pdf-module-ready')).toEqual([{ type: 'pdf-module-ready' }]);

    // Страница перезагрузилась (тема) — модуля в ней нет, впрыск заново.
    await say({ type: 'ready' });
    await say({ type: 'pdf-module' });
    await flush();
    expect(global.__injected).toHaveLength(2);
  });

  test('пока строка в пути, второй запрос не впрыскивает её ещё раз', async () => {
    moduleAsset();
    await doc();
    await say({ type: 'pdf-module' });
    await say({ type: 'pdf-module' });
    await flush();
    expect(global.__injected).toHaveLength(1);
    expect(PDF_MODULE_WAIT_MS).toBe(30000);
  });

  test('ассет не прочитался — редактору pdf-module-ready с ошибкой; следующий запрос пробует снова', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const asset = moduleAsset();
    asset.downloadAsync.mockRejectedValueOnce(new Error('нет сети'));
    await doc();
    await say({ type: 'pdf-module' });
    await flush();
    expect(posted('pdf-module-ready')).toEqual([{ type: 'pdf-module-ready', error: 'нет сети' }]);
    expect(global.__injected).toHaveLength(0);
    await say({ type: 'pdf-module' });
    await flush();
    expect(global.__injected).toHaveLength(1);
    spy.mockRestore();
  });

  test('модуль с ошибкой — строка не обрывается: редактор получает error, телефон — ok: false', () => {
    const run = runInjected(pdfModuleScript('this is not js {'));
    expect(run.ed).toHaveLength(1);
    expect(run.ed[0].type).toBe('pdf-module-ready');
    expect(run.ed[0].error).toBeTruthy();
    expect(run.host[0]).toMatchObject({ type: 'pdf-module-loaded', ok: false });
    // Исполнился, но глобала нет — редактор узнает это сам (pdfGlobal), телефон впрыснет снова.
    const empty = runInjected(pdfModuleScript('var x = 1;'));
    expect(empty.ed).toEqual([{ type: 'pdf-module-ready' }]);
    expect(empty.host[0]).toMatchObject({ ok: false, error: null });
  });

  test('строка модуля с </script> и разделителями строк остаётся строкой', () => {
    const run = runInjected(pdfModuleScript('window.LancibleEditorPdf={s:"</script>\\u2028"};'));
    expect(run.win.LancibleEditorPdf.s).toBe('</script> ');
  });
});

describe('«Сохранить как PDF»', () => {
  test('export kind pdf — байты в файл кеша (base64) и лист «Поделиться» с типом PDF', async () => {
    await doc();
    await say({ type: 'export', kind: 'pdf', name: 'Бриф.pdf', mime: 'application/pdf', base64: 'JVBERi0xLjcK' });
    await flush();
    expect(mockFs.log).toContainEqual({ write: 'file:///cache/Бриф.pdf', content: 'JVBERi0xLjcK', opts: { encoding: 'base64' } });
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/Бриф.pdf', expect.objectContaining({ mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }));
  });

  test('имя файла — название задачи, а не «document.pdf» редактора; не вышло — тост', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await task();
    await say({ type: 'export', kind: 'pdf', name: 'document.pdf', mime: 'application/pdf', base64: 'JVBE' });
    await flush();
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/Вёрстка.pdf', expect.anything());
    Sharing.shareAsync.mockRejectedValueOnce(new Error('нет'));
    await say({ type: 'export', kind: 'pdf', name: 'x.pdf', mime: 'application/pdf', base64: 'JVBE' });
    await flush();
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'toast.export_failed'));
    spy.mockRestore();
  });
});

describe('перенос картинки: автопрокрутка страницы задачи', () => {
  const HEADER = 48;
  const SHEET = 130;
  const scrollTo = ScrollView.prototype.scrollTo;
  beforeEach(() => scrollTo.mockClear());

  /** Раскладка: прокрутка — от шапки до низа окна, поле на top, содержимое — contentH. */
  async function laidOut(q, { top = 120, viewH = 796, contentH = 3000 } = {}) {
    const scroll = q.getByTestId('task-scroll');
    await act(async () => {
      scroll.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: viewH } } });
      q.getByTestId('task-notes').props.onLayout({ nativeEvent: { layout: { x: 10, y: top, width: 370, height: 96 } } });
      scroll.props.onContentSizeChange(390, contentH);
    });
    return scroll;
  }

  test('видимая часть WebView: от верха прокрутки до того, что лежит снизу', () => {
    expect(notesViewport({ scrollY: 0, notesTop: 120, viewH: 796, floor: 130 })).toEqual({ top: 0, height: 546 });
    expect(notesViewport({ scrollY: 500, notesTop: 120, viewH: 796, floor: 130 })).toEqual({ top: 380, height: 666 });
  });

  test('autoscroll сдвигает страницу на dy и сообщает редактору новую видимую часть; дальше краёв не уходит', async () => {
    const q = await task();
    await say({ type: 'ready' });
    await say({ type: 'height', px: 2600, height: 2600 });
    const viewH = 844 - HEADER;
    await laidOut(q, { viewH, contentH: 3000 });
    const vp = () => posted('viewport').pop();
    // Без прокрутки видно от верха WebView до свёрнутого шита.
    expect(vp()).toEqual({ type: 'viewport', top: 0, height: viewH - 120 - SHEET });

    await say({ type: 'autoscroll', dy: 18 });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 18, animated: false });
    await say({ type: 'autoscroll', dy: 18 });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 36, animated: false });
    expect(vp()).toEqual({ type: 'viewport', top: 0, height: viewH - 120 - SHEET + 36 });
    // Вверх — не выше начала.
    await say({ type: 'autoscroll', dy: -100 });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
    const calls = scrollTo.mock.calls.length;
    await say({ type: 'autoscroll', dy: -10 });
    expect(scrollTo.mock.calls.length).toBe(calls);
    // Вниз — не дальше конца содержимого.
    await say({ type: 'autoscroll', dy: 5000 });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 3000 - viewH, animated: false });
    expect(vp()).toEqual({ type: 'viewport', top: 3000 - viewH - 120, height: viewH - SHEET });
  });

  test('прокрутили пальцем — видимая часть уходит редактору (не чаще VIEWPORT_MS)', async () => {
    const q = await task();
    await say({ type: 'ready' });
    const scroll = await laidOut(q);
    const before = posted('viewport').length;
    await act(async () => { scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 400 } } }); });
    await act(async () => { scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 410 } } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, VIEWPORT_MS + 20)); });
    const sent = posted('viewport').slice(before);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.length).toBeLessThanOrEqual(2);
    expect(sent.pop()).toEqual({ type: 'viewport', top: 410 - 120, height: 796 - SHEET });
  });
});

describe('палец ведёт редактор (gesture): страница задачи не прокручивается', () => {
  // На Android ScrollView страницы перехватывал движение после долгого
  // нажатия на ручке картинки: WebView получал touchcancel на первом же
  // сдвиге, и перенос обрывался (эмулятор, 17 октября 2026). Редактор
  // сообщает, когда ведёт палец сам, — прокрутка на это время выключена.
  const scrollOn = (q) => q.getByTestId('task-scroll').props.scrollEnabled;

  test('on — прокрутка выключена, off — включена; ни перо, ни жест её не включают раньше времени', async () => {
    const q = await task();
    await say({ type: 'ready' });
    expect(scrollOn(q)).toBe(true);
    await say({ type: 'gesture', on: true });
    expect(scrollOn(q)).toBe(false);
    await say({ type: 'gesture', on: false });
    expect(scrollOn(q)).toBe(true);
    // Перо — само по себе тоже выключает.
    await say({ type: 'ink', on: true });
    await say({ type: 'gesture', on: true });
    await say({ type: 'gesture', on: false });
    expect(scrollOn(q)).toBe(false);
  });

  test('страховка: off не пришёл — прокрутка возвращается через GESTURE_TIMEOUT_MS тишины; autoscroll продлевает; перезагрузка страницы снимает сразу', async () => {
    jest.useFakeTimers();
    try {
      const q = await task();
      await say({ type: 'ready' });
      await say({ type: 'gesture', on: true });
      await act(async () => { jest.advanceTimersByTime(GESTURE_TIMEOUT_MS - 1000); });
      expect(scrollOn(q)).toBe(false);
      // Палец у края — страница едет, жест жив.
      await say({ type: 'autoscroll', dy: 10 });
      await act(async () => { jest.advanceTimersByTime(GESTURE_TIMEOUT_MS - 1000); });
      expect(scrollOn(q)).toBe(false);
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(scrollOn(q)).toBe(true);
      // Страница перезагрузилась посреди жеста.
      await say({ type: 'gesture', on: true });
      expect(scrollOn(q)).toBe(false);
      await say({ type: 'ready' });
      expect(scrollOn(q)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('сообщение в одном виде', () => {
    expect(parseMessage({ type: 'gesture', on: 1 })).toEqual({ type: 'gesture', on: true });
    expect(parseMessage({ type: 'gesture' })).toEqual({ type: 'gesture', on: false });
  });
});

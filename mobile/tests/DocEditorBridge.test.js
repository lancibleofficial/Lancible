// Мост DocEditor ↔ страница редактора в WebView. Запуск: npm run test:mobile (из корня)
//
// Откуда взялось (2026-10-10-mobile-image-upload). С телефона в облако не
// ушло ни одной картинки: сессия приходит асинхронно (useEditorAuth), и
// сообщение «auth» уходило в WebView раньше, чем страница загрузилась, — а
// такое сообщение WebView теряет. В странице вход оставался пустым, и
// выгрузка не делала ни одного запроса. Теперь по «ready» страница получает
// вход и язык заново.
//
// WebView подменён: у него нативная часть. Посланные в него сообщения
// копятся в global.__posted.
import { Linking, StyleSheet } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';
import DocEditor, { EDITOR_BASE_URL, fromEditor } from '../src/components/DocEditor';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAssetForget, queueAssetForget, loadAssetForget, ASSET_FORGET_KEY } from '../src/lib/assetForget';
import { parseMessage } from '../src/lib/editorBridge';

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

const AUTH = { url: 'https://example.supabase.co', anonKey: 'anon', accessToken: 'tok-1', userId: 'u1' };
const say = (m) => act(() => global.__web.onMessage({ nativeEvent: { url: EDITOR_BASE_URL, data: JSON.stringify(m) } }));
const last = (type) => global.__posted.filter((m) => m.type === type).pop();

beforeEach(() => { global.__posted = []; });

test('вход, пришедший до готовности страницы, она получает по «ready»', async () => {
  const view = await render(<DocEditor content={null} lang="ru" auth={null} />);
  // Сессия пришла, страница ещё грузится: это сообщение WebView потеряет.
  await view.rerender(<DocEditor content={null} lang="kk" auth={AUTH} />);
  global.__posted = [];

  await say({ type: 'ready' });
  expect(last('auth')).toEqual({ type: 'auth', auth: AUTH });
  expect(last('lang')).toEqual({ type: 'lang', lang: 'kk' });
});

test('страница редактора открыта отладчику только в разработке', async () => {
  await render(<DocEditor content={null} lang="ru" auth={null} />);
  expect(global.__web.webviewDebuggingEnabled).toBe(__DEV__);
});

// 13 октября 2026: масштаба нет, окно страницы не масштабируется; живой
// редактор не ниже minHeight — поле заметок тянется до низа страницы задачи.
test('окно страницы: щипком не масштабируется, масштаба текста нет', async () => {
  await render(<DocEditor content={null} lang="ru" auth={null} />);
  const { html } = global.__web.source;
  expect(html).toMatch(/<meta name="viewport" content="[^"]*maximum-scale=1, user-scalable=no/);
  expect(html).not.toMatch(/:root{--led-zoom|zoom: S.zoom/);
});

test('живой редактор: высота — по тексту, но не ниже minHeight; пустое место под ним — #host', async () => {
  const view = await render(<DocEditor content={null} lang="ru" auth={null} live minHeight={480} />);
  const h = () => StyleSheet.flatten(view.getByTestId('doc-editor').props.style).height;
  expect(h()).toBe(480);
  await say({ type: 'height', px: 700, height: 700 });
  expect(h()).toBe(700);
  await say({ type: 'height', px: 120, height: 120 });
  expect(h()).toBe(480);
  expect(global.__web.source.html).toMatch(/#host{min-height:100vh;}/);
  // Полный редактор (документ) — своей прокруткой, без этого правила.
  await render(<DocEditor content={null} lang="ru" auth={null} />);
  expect(global.__web.source.html).not.toMatch(/#host{min-height:100vh;}/);
});

// 13 октября 2026: окно редактора закрыто. Страница — своя, строкой из
// сборки; уйти с неё WebView не должен (ссылка из документа — в браузер
// системы), а сообщения принимаются только от неё — чужая страница или
// кадр командовать телефоном не могут.
describe('окно редактора закрыто от чужого', () => {
  test('грузит только свою страницу; ссылку наружу открывает браузер системы, прочее — никуда', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      await render(<DocEditor content={null} lang="ru" auth={null} />);
      const allow = global.__web.onShouldStartLoadWithRequest;
      expect(typeof allow).toBe('function');
      expect(global.__web.source.baseUrl).toBe(EDITOR_BASE_URL);
      expect(allow({ url: EDITOR_BASE_URL, isTopFrame: true })).toBe(true);
      expect(allow({ url: `${EDITOR_BASE_URL}#h-1`, isTopFrame: true })).toBe(true);
      expect(allow({ url: 'about:blank', isTopFrame: false })).toBe(true);
      expect(open).not.toHaveBeenCalled();

      expect(allow({ url: 'https://example.com/login', isTopFrame: true })).toBe(false);
      expect(open).toHaveBeenLastCalledWith('https://example.com/login');
      expect(allow({ url: 'mailto:hi@example.com', isTopFrame: true })).toBe(false);
      expect(open).toHaveBeenLastCalledWith('mailto:hi@example.com');
      // Тот же сайт, но не страница редактора, — тоже наружу.
      expect(allow({ url: 'https://lancible.vercel.app/privacy', isTopFrame: true })).toBe(false);
      expect(open).toHaveBeenLastCalledWith('https://lancible.vercel.app/privacy');

      open.mockClear();
      for (const url of ['javascript:alert(1)', 'file:///data/user/0/app/files/x', 'intent://scan#Intent;end', 'data:text/html,<b>x</b>', '']) {
        expect(allow({ url, isTopFrame: true })).toBe(false);
      }
      // Чужой кадр внутри страницы не грузится и браузер не открывает.
      expect(allow({ url: 'https://ads.example/frame', isTopFrame: false })).toBe(false);
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  test('сообщения принимаются только от страницы редактора', async () => {
    const onChange = jest.fn();
    await render(<DocEditor content={null} lang="ru" auth={null} onChange={onChange} />);
    const from = (url) => act(() => global.__web.onMessage({ nativeEvent: { url, data: JSON.stringify({ type: 'change', content: { v: 1 } }) } }));
    await from('https://evil.example/');
    await from('https://lancible.vercel.app.evil.example/app/');
    await from('http://lancible.vercel.app/app/');
    await from(undefined);
    expect(onChange).not.toHaveBeenCalled();
    // iOS называет адрес кадра, Android (WebMessageListener) — источник без пути.
    await from(EDITOR_BASE_URL);
    await from('https://lancible.vercel.app');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test('старый Android (без WebMessageListener) называет страницу, загруженную строкой, about:blank — там она своя; на iOS — нет', () => {
    expect(fromEditor('about:blank', 'android')).toBe(true);
    expect(fromEditor('about:blank', 'ios')).toBe(false);
    expect(fromEditor('https://evil.example', 'android')).toBe(false);
  });
});

// 19 октября 2026 (ревью редактора, находка 2): хранилище картинок создавалось
// без owner, и хозяином записи становился тот, чьё облако сейчас открыто
// (src/editor/assets.js: ownerNow). С выключенной синхронизацией, посреди
// переключения или пока сеанс не пришёл облака нет — картинка получала
// owner: null навсегда и в облако не уходила никогда. Теперь хозяин — открытая
// область, как у десктопа и веба (owner: () => scopeUid).
describe('хозяин картинок — открытая область', () => {
  /** Исполнить скрипт страницы (последний <script>) с подменённым редактором:
   *  что получило хранилище картинок и как страница принимает сообщения. */
  function runPage(html) {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const code = scripts[scripts.length - 1];
    const got = { storeOpts: null, posted: [], listeners: [] };
    const assets = { flush: jest.fn(), requeue: jest.fn(async () => 0) };
    const LancibleEditor = {
      createAssetStore: (o) => { got.storeOpts = o; return assets; },
      create: (_host, opts) => ({ receive: () => false, flush: jest.fn(), assets: opts.assets }),
    };
    const doc = { getElementById: () => ({}), addEventListener: (_t, fn) => got.listeners.push(fn) };
    const win = { ReactNativeWebView: { postMessage: (m) => got.posted.push(JSON.parse(m)) }, addEventListener: () => {} };
    // eslint-disable-next-line no-new-func
    new Function('LancibleEditor', 'document', 'window', code)(LancibleEditor, doc, win);
    got.send = (m) => got.listeners.forEach((fn) => fn({ data: JSON.stringify(m) }));
    return got;
  }

  afterEach(() => useAppStore.setState({ scopeUid: null }));

  test('аккаунт без открытого облака (синхронизация выключена, сеанса нет) — хозяин всё равно его uid', async () => {
    useAppStore.setState({ scopeUid: 'u1' });
    await render(<DocEditor content={null} lang="ru" auth={null} />);
    const page = runPage(global.__web.source.html);
    expect(typeof page.storeOpts.owner).toBe('function');
    expect(page.storeOpts.owner()).toBe('u1');
    expect(page.storeOpts.remote()).toBeNull();
  });

  test('гость — null; хозяин приходит и сообщением owner, и заново по «ready»', async () => {
    useAppStore.setState({ scopeUid: null });
    const view = await render(<DocEditor content={null} lang="ru" auth={null} />);
    const page = runPage(global.__web.source.html);
    expect(page.storeOpts.owner()).toBeNull();
    page.send({ type: 'owner', owner: 'u2' });
    expect(page.storeOpts.owner()).toBe('u2');
    // Область сменилась, пока редактор открыт, — странице уходит новый хозяин.
    await act(async () => { useAppStore.setState({ scopeUid: 'u3' }); });
    await view.rerender(<DocEditor content={null} lang="ru" auth={null} />);
    expect(last('owner')).toEqual({ type: 'owner', owner: 'u3' });
    global.__posted = [];
    await say({ type: 'ready' });
    expect(last('owner')).toEqual({ type: 'owner', owner: 'u3' });
  });
});

// 19 октября 2026, протокол 5 редактора (src/editor/host.js): гостевые
// картинки открытого документа — аккаунту области (assets-adopt referenced) и
// стирание картинок аккаунта, убранного с телефона (assets-forget →
// assets-forgotten, очередь — lib/assetForget.js).
describe('картинки аккаунта: протокол 5', () => {
  const posted = (type) => global.__posted.filter((m) => m.type === type);
  const signedAs = (uid) => useAuthStore.setState({ status: uid ? 'signedIn' : 'signedOut', user: uid ? { id: uid, email: `${uid}@example.com` } : null, current: uid });

  afterEach(async () => {
    useAppStore.setState({ scopeUid: null });
    signedAs(null);
    useAssetForget.setState({ uids: [] });
    await AsyncStorage.removeItem(ASSET_FORGET_KEY);
  });

  test('область аккаунта, и он вошёл: по ready — assets-adopt referenced для этого аккаунта', async () => {
    useAppStore.setState({ scopeUid: 'u1' });
    signedAs('u1');
    await render(<DocEditor content={null} lang="ru" auth={null} />);
    // До ready страница сообщение потеряла бы — его и не шлём.
    expect(posted('assets-adopt')).toEqual([]);
    await say({ type: 'ready' });
    expect(posted('assets-adopt')).toEqual([{ type: 'assets-adopt', userId: 'u1', referenced: true }]);
  });

  test('после setContent — тоже: новый документ, его картинки (сообщение идёт следом за документом)', async () => {
    useAppStore.setState({ scopeUid: 'u1' });
    signedAs('u1');
    const ref = { current: null };
    await render(<DocEditor ref={ref} content={null} lang="ru" auth={null} />);
    await say({ type: 'ready' });
    global.__posted = [];
    await act(async () => { ref.current.setContent({ v: 1 }); });
    expect(global.__posted.map((m) => m.type)).toEqual(['setContent', 'assets-adopt']);
    expect(global.__posted[1]).toEqual({ type: 'assets-adopt', userId: 'u1', referenced: true });
  });

  test('гостю — никогда; аккаунт без входа — тоже; вошёл, пока редактор открыт, — сразу', async () => {
    useAppStore.setState({ scopeUid: null });
    signedAs(null);
    let view = await render(<DocEditor content={null} lang="ru" auth={null} />);
    await say({ type: 'ready' });
    expect(posted('assets-adopt')).toEqual([]);
    await view.unmount();

    useAppStore.setState({ scopeUid: 'u1' });
    signedAs(null);
    view = await render(<DocEditor content={null} lang="ru" auth={null} />);
    await say({ type: 'ready' });
    expect(posted('assets-adopt')).toEqual([]);
    // Сеанс другого аккаунта (переключение) — не этот.
    await act(async () => { signedAs('u2'); useAuthStore.setState({ current: 'u1' }); });
    expect(posted('assets-adopt')).toEqual([]);
    await act(async () => { signedAs('u1'); });
    expect(posted('assets-adopt')).toEqual([{ type: 'assets-adopt', userId: 'u1', referenced: true }]);
  });

  test('стирание: очередь — в AsyncStorage; ближайший редактор шлёт assets-forget по ready, uid уходит по ответу', async () => {
    await queueAssetForget('u-old');
    expect(JSON.parse(await AsyncStorage.getItem(ASSET_FORGET_KEY))).toEqual(['u-old']);
    useAppStore.setState({ scopeUid: 'u1' });
    await render(<DocEditor content={null} lang="ru" auth={null} />);
    expect(posted('assets-forget')).toEqual([]);
    await say({ type: 'ready' });
    expect(posted('assets-forget')).toEqual([{ type: 'assets-forget', userId: 'u-old' }]);
    // Ответ про другой аккаунт очередь не снимает.
    await say({ type: 'assets-forgotten', userId: 'u-other', n: 0 });
    expect(useAssetForget.getState().uids).toEqual(['u-old']);
    await say({ type: 'assets-forgotten', userId: 'u-old', n: 3 });
    await waitFor(() => expect(useAssetForget.getState().uids).toEqual([]));
    expect(JSON.parse(await AsyncStorage.getItem(ASSET_FORGET_KEY))).toEqual([]);
  });

  test('редактор открыт, когда аккаунт убрали, — стирание уходит сразу; очередь после перезапуска читается из хранилища', async () => {
    await render(<DocEditor content={null} lang="ru" auth={null} />);
    await say({ type: 'ready' });
    await act(async () => { await queueAssetForget('u-gone'); });
    expect(posted('assets-forget')).toEqual([{ type: 'assets-forget', userId: 'u-gone' }]);
    // «Перезапуск»: в памяти пусто, в хранилище — то, что не успело уйти.
    useAssetForget.setState({ uids: [] });
    await AsyncStorage.setItem(ASSET_FORGET_KEY, JSON.stringify(['u-left']));
    await loadAssetForget();
    expect(useAssetForget.getState().uids).toEqual(['u-left']);
  });

  test('ответ редактора разбирается: userId строкой, n числом', () => {
    expect(parseMessage(JSON.stringify({ type: 'assets-forgotten', userId: 'u1', n: '2' }))).toEqual({ type: 'assets-forgotten', userId: 'u1', n: 2 });
    expect(parseMessage(JSON.stringify({ type: 'assets-forgotten', userId: 5 }))).toEqual({ type: 'assets-forgotten', userId: null, n: 0 });
  });
});

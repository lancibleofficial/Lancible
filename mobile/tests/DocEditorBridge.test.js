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
import { render, act } from '@testing-library/react-native';
import DocEditor, { EDITOR_BASE_URL, fromEditor } from '../src/components/DocEditor';

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

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
import { render, act } from '@testing-library/react-native';
import DocEditor from '../src/components/DocEditor';

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
const say = (m) => act(() => global.__web.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
const last = (type) => global.__posted.filter((m) => m.type === type).pop();

beforeEach(() => { global.__posted = []; });

test('вход, пришедший до готовности страницы, она получает по «ready»', async () => {
  const view = await render(<DocEditor content={null} lang="ru" auth={null} />);
  // Сессия пришла, страница ещё грузится: это сообщение WebView потеряет.
  await view.rerender(<DocEditor content={null} lang="kk" auth={AUTH} />);
  global.__posted = [];

  say({ type: 'ready' });
  expect(last('auth')).toEqual({ type: 'auth', auth: AUTH });
  expect(last('lang')).toEqual({ type: 'lang', lang: 'kk' });
});

test('страница редактора открыта отладчику только в разработке', async () => {
  await render(<DocEditor content={null} lang="ru" auth={null} />);
  expect(global.__web.webviewDebuggingEnabled).toBe(__DEV__);
});

// Удаление аккаунта: картинки в облаке стираются раньше аккаунта.
// Запуск: npm run test:mobile (из корня)
//
// Откуда взялось (2026-10-10-delete-account-storage). Картинки редактора лежат
// в doc-assets/<uid>/ и каскадом за аккаунтом не уходят, а страж в базе не
// даёт удалить аккаунт, пока в папке что-то есть. Поэтому порядок такой:
// пауза докачки → list/remove, пока папка не опустеет → delete_my_account;
// на «account assets remain» — один повтор; если аккаунт остался, а папку уже
// стёрли, стёртое встаёт в очередь на возврат, и редактор выгрузит его снова.
//
// Supabase подменён: сети в Node нет, а проверяется порядок вызовов и что
// клиент делает с каждым ответом. WebView подменён: у него нативная часть.
import { render, renderHook, act, waitFor } from '@testing-library/react-native';
import { useAppStore } from '../src/store/useAppStore';
import { deleteAccount } from '../src/lib/auth';
import { sb } from '../src/lib/supabaseClient';
import { useEditorAuth } from '../src/hooks/useEditorAuth';
import DocEditor from '../src/components/DocEditor';

jest.mock('../src/lib/supabaseClient', () => {
  const bucket = { list: jest.fn(), remove: jest.fn() };
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    sb: {
      bucket,
      storage: { from: jest.fn(() => bucket) },
      rpc: jest.fn(),
      auth: {
        getSession: jest.fn(() => Promise.resolve({ data: { session: { access_token: 'tok', user: { id: 'u1' } } } })),
        signOut: jest.fn(() => Promise.resolve({})),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
    },
  };
});

// WebView: props последнего — в global.__web, посланные в него сообщения — в
// global.__posted.
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

// Облако: содержимое папки и ответы delete_my_account по очереди. Каждый
// вызов пишется в calls — по ним сверяется порядок.
let folder;
let rpcAnswers;
let calls;

beforeEach(() => {
  calls = [];
  folder = new Set(['a', 'b']);
  rpcAnswers = [];
  sb.storage.from.mockClear();
  sb.auth.signOut.mockClear();
  sb.bucket.list.mockReset().mockImplementation(async (uid) => {
    calls.push(`list ${uid}`);
    // Подпапка приходит без id — её стирать нечем и незачем.
    return { data: [...[...folder].map((name) => ({ id: `id-${name}`, name })), { id: null, name: 'sub' }], error: null };
  });
  sb.bucket.remove.mockReset().mockImplementation(async (paths) => {
    calls.push(`remove ${paths.join(',')}`);
    paths.forEach((p) => folder.delete(p.split('/')[1]));
    return { data: paths.map((name) => ({ name })), error: null };
  });
  sb.rpc.mockReset().mockImplementation(async (name) => {
    calls.push(`rpc ${name}, пауза ${useAppStore.getState().assetsPaused}`);
    return rpcAnswers.shift() || { data: null, error: null };
  });
  useAppStore.setState({ assetsPaused: false, assetRequeue: [], settings: { ...useAppStore.getState().settings, syncEnabled: true } });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.__posted = [];
});

afterEach(() => jest.restoreAllMocks());

const state = () => useAppStore.getState();

test('папка в doc-assets стирается до пустоты, и только потом удаляется аккаунт', async () => {
  expect(await deleteAccount()).toEqual({ ok: true });
  expect(sb.storage.from).toHaveBeenCalledWith('doc-assets');
  expect(calls).toEqual([
    'list u1',
    'remove u1/a,u1/b',
    'list u1',
    'rpc delete_my_account, пауза true',
  ]);
  expect(sb.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(state().assetsPaused).toBe(false);
  expect(state().assetRequeue).toEqual([]);
});

test('хранилище ответило ошибкой — аккаунт не трогаем', async () => {
  sb.bucket.remove.mockImplementation(async () => ({ data: null, error: { message: 'boom' } }));
  expect(await deleteAccount()).toEqual({ ok: false });
  expect(sb.rpc).not.toHaveBeenCalled();
  expect(state().assetsPaused).toBe(false);
  // Ничего не стёрто — и возвращать нечего.
  expect(state().assetRequeue).toEqual([]);
});

test('remove, который ничего не стёр, — ошибка, а не вечный цикл', async () => {
  // Так отвечает правило доступа, не пустившее удаление: без ошибки, но
  // пустым списком.
  sb.bucket.remove.mockImplementation(async () => ({ data: [], error: null }));
  expect(await deleteAccount()).toEqual({ ok: false });
  expect(sb.bucket.list).toHaveBeenCalledTimes(1);
  expect(sb.rpc).not.toHaveBeenCalled();
  expect(state().assetsPaused).toBe(false);
});

test('«account assets remain» — один повтор стирания и удаления', async () => {
  // Загрузка, начатая до паузы, успела положить файл между стиранием и
  // удалением.
  rpcAnswers = [{ error: { message: 'account assets remain' } }];
  sb.rpc.mockImplementationOnce(async (name) => {
    calls.push(`rpc ${name}, пауза ${state().assetsPaused}`);
    folder.add('late');
    return rpcAnswers.shift();
  });
  expect(await deleteAccount()).toEqual({ ok: true });
  expect(calls).toEqual([
    'list u1', 'remove u1/a,u1/b', 'list u1', 'rpc delete_my_account, пауза true',
    'list u1', 'remove u1/late', 'list u1', 'rpc delete_my_account, пауза true',
  ]);
});

test('повтор — один: второй «account assets remain» — отказ', async () => {
  rpcAnswers = [{ error: { message: 'account assets remain' } }, { error: { message: 'account assets remain' } }];
  expect(await deleteAccount()).toEqual({ ok: false });
  expect(sb.rpc).toHaveBeenCalledTimes(2);
  expect(state().assetsPaused).toBe(false);
});

test('папку стёрли, а аккаунт остался — стёртое встаёт в очередь на возврат', async () => {
  rpcAnswers = [{ error: { message: 'Failed to fetch' } }];
  expect(await deleteAccount()).toEqual({ ok: false });
  expect(state().assetRequeue).toEqual(['a', 'b']);
  expect(state().assetsPaused).toBe(false);
  expect(sb.auth.signOut).not.toHaveBeenCalled();
});

test('пока идёт удаление, редактор не видит облака картинок', async () => {
  const { result } = await renderHook(() => useEditorAuth());
  await waitFor(() => expect(result.current && result.current.userId).toBe('u1'));
  await act(async () => state().setAssetsPaused(true));
  expect(result.current).toBeNull();
  await act(async () => state().setAssetsPaused(false));
  expect(result.current.userId).toBe('u1');
});

test('редактор получает список на возврат, когда готов, и сообщает, что поставил его в очередь', async () => {
  useAppStore.setState({ assetRequeue: ['a', 'b'] });
  await render(
    <DocEditor content={null} lang="ru" auth={null} requeue={state().assetRequeue} onRequeued={state().clearAssetRequeue} />,
  );
  // Страница внутри WebView ставит картинки в очередь сама: requeue и flush.
  expect(global.__web.source.html).toContain('ed.assets.requeue(m.ids)');
  // До «ready» страница сообщение потеряла бы — его и нет.
  expect(global.__posted.filter((m) => m.type === 'requeue')).toEqual([]);

  const say = (m) => act(() => global.__web.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
  say({ type: 'ready' });
  expect(global.__posted.filter((m) => m.type === 'requeue')).toEqual([{ type: 'requeue', ids: ['a', 'b'] }]);

  say({ type: 'requeued', ids: ['a', 'b'], n: 2 });
  expect(state().assetRequeue).toEqual([]);
});

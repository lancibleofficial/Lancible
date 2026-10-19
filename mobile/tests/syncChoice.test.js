// Вход при данных и на телефоне, и в облаке. Запуск: npm run test:mobile (из корня)
//
// До 17 октября 2026 телефон в этом случае спрашивал «какие данные оставить»
// (askSyncChoice) и брал одну сторону целиком, а вторая пропадала. С журналом
// правок (core/oplog.js, lib/sync.js) вопроса нет: облако становится пачкой
// аккаунта, а местное вливается в неё без потерь (adoptGuestState) — новое
// уходит правками, общее сравнивается по полям, и расходящееся остаётся
// конфликтом («Другая версия»), а не затирается. Правила — в ядре и закрыты
// юнитами веба; здесь — что телефон их применяет и ничего не спрашивает.
//
// Лист входа (AuthSheet) закрывает свой лист, а не тот, что успел встать на
// его место: так встаёт вопрос «Перенести данные?» (lib/accounts.js).
//
// Сеть подменена (tests/fakeSupabase.js — сервер журнала), lib/sync.js,
// стор и лист — настоящие.
import { Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { useAppStore, openDataScope } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { setSyncUser, syncOnSignIn } from '../src/lib/sync';
import { deviceId } from '../src/lib/device';
import BottomSheet from '../src/components/BottomSheet';
import AuthSheet from '../src/components/AuthSheet';
import { t } from '../src/lib/i18n';

jest.setTimeout(30000);

jest.mock('../src/lib/supabaseClient', () => {
  const { createWorld } = require('./fakeSupabase');
  if (!global.__oplogWorld) global.__oplogWorld = createWorld();
  return { sb: global.__oplogWorld.client, __world: global.__oplogWorld };
});

const { settle, until } = require('./fakeSupabase');
const world = () => require('../src/lib/supabaseClient').__world;

const project = (id, name) => ({ id, name, color: '#5ec8f2', tagIds: [], createdAt: '2026-10-07T10:00:00.000Z' });
const task = (id, title, projectId, extra = {}) => ({
  id, projectId, title, statusId: null, done: false, sessions: [], totalMs: 0, tagIds: [], reminders: [], remindOffsetMin: null, remindAt: null,
  updatedAt: '2026-10-07T10:00:00.000Z', ...extra,
});
const CLOUD = { projects: [project('pc', 'Облачный')], tasks: [task('tc', 'Из облака', 'pc')], statuses: [], tags: [], versions: [], documents: [] };

afterEach(() => setSyncUser(null));

describe('данные есть и тут, и в облаке', () => {
  test('ничего не спрашивается: облако и своё — вместе, своё ушло в журнал, общее расходящееся — «другой версией»', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    world().db.uid = 'u1';
    world().db.syncState.u1 = { user_id: 'u1', data: CLOUD, updated_at: '2026-10-17T10:00:00.000Z', updated_by: 'old-desktop' };
    // Копия аккаунта на телефоне (старая версия): своя задача и та же облачная,
    // переименованная здесь позже.
    const local = {
      projects: [project('pc', 'Облачный'), project('pl', 'Местный')],
      tasks: [task('tc', 'Из облака, правка с телефона', 'pc', { updatedAt: '2026-10-17T11:00:00.000Z' }), task('tl', 'С телефона', 'pl')],
      settings: { lang: 'ru', syncEnabled: true, syncResolvedFor: null },
    };
    await AsyncStorage.setItem('lancible-data:u1', JSON.stringify({ state: local, version: 0 }));
    await openDataScope('u1');
    await settle(50);
    const q = await render(<BottomSheet />);
    setSyncUser('u1');
    await act(async () => { await syncOnSignIn('u1'); });
    await act(async () => { await until(() => !useAppStore.getState().oplog.pending.length); });
    // Вопроса нет.
    expect(useSheetStore.getState().content).toBeNull();
    expect(q.queryByText('Какие данные оставить?')).toBeNull();
    const titles = useAppStore.getState().tasks.map((x) => x.title).sort();
    expect(titles).toEqual(['Из облака, правка с телефона', 'С телефона']);
    // Своё — в журнале аккаунта; облачная версия названия — рядом, конфликтом.
    const mine = world().db.changes.filter((r) => r.device_id === deviceId());
    expect(mine.some((r) => r.field === '*' && r.entity_id === 'tl')).toBe(true);
    const c = useAppStore.getState().oplog.conflicts.find((x) => x.id === 'task:tc:title');
    expect(c.versions.map((v) => v.value).sort()).toEqual(['Из облака', 'Из облака, правка с телефона']);
  });
});

describe('лист входа', () => {
  beforeEach(() => {
    useSheetStore.setState({ content: null, header: null, footer: null });
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' } });
  });

  test('вход вернулся — закрывается свой лист, а не вопрос, занявший его место', async () => {
    // Как в жизни: supabase-js ждёт обработчик onAuthStateChange, и вопрос
    // «Перенести данные?» встаёт в лист раньше, чем вход вернул ответ.
    const question = <Text>Перенести данные?</Text>;
    const signInMock = jest.fn(async () => { openSheet(question); return { ok: true }; });
    const original = useAuthStore.getState().signIn;
    useAuthStore.setState({ signIn: signInMock });
    try {
      const q = await render(<BottomSheet />);
      await act(async () => { openSheet(<AuthSheet initialTab="signin" />); });
      await fireEvent.changeText(q.getByPlaceholderText('you@example.com'), 'a@b.c');
      // Пароль — единственное пустое поле, когда почта уже набрана.
      const password = q.getByDisplayValue('');
      await fireEvent.changeText(password, 'secret');
      await fireEvent.press(q.getAllByText(t('ru', 'auth.sign_in')).pop());
      await act(async () => { await settle(20); });
      expect(signInMock).toHaveBeenCalled();
      expect(useSheetStore.getState().content).toBe(question);
    } finally {
      useAuthStore.setState({ signIn: original });
    }
  });

  test('обычный вход без вопроса — лист входа закрывается', async () => {
    const signInMock = jest.fn(async () => ({ ok: true }));
    const original = useAuthStore.getState().signIn;
    useAuthStore.setState({ signIn: signInMock });
    try {
      const q = await render(<BottomSheet />);
      await act(async () => { openSheet(<AuthSheet initialTab="signin" />); });
      await fireEvent.changeText(q.getByPlaceholderText('you@example.com'), 'a@b.c');
      // Пароль — единственное пустое поле, когда почта уже набрана.
      const password = q.getByDisplayValue('');
      await fireEvent.changeText(password, 'secret');
      await fireEvent.press(q.getAllByText(t('ru', 'auth.sign_in')).pop());
      await act(async () => { await settle(20); });
      expect(signInMock).toHaveBeenCalled();
      expect(useSheetStore.getState().content).toBeNull();
    } finally {
      useAuthStore.setState({ signIn: original });
    }
  });
});

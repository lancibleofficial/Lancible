// Обратная связь на телефоне (screens/FeedbackScreen.js, lib/feedback.js).
// Запуск: npm run test:mobile
//
// Форма одна на веб и телефон; здесь — что телефон шлёт в supabase то же
// тело (feedback.sql): вид, текст, платформа, версия из app.json, язык,
// модель; снимок — в бакет feedback по пути <uuid>.<ext>, путь — в
// screenshot_path; гость — без user_id. Не ушло — красная строка и
// «Повторить», черновик на месте, картинка второй раз не грузится.
//
// Снимок с круга 21 — не переключатель, а строка со скрепкой: нажатие на всю
// строку открывает выбор, выбранная — миниатюра с крестиком в той же строке.
//
// С 19 октября 2026 («разумное ограничение», supabase/feedback.sql): id
// строки заводит телефон, сначала уходит строка, потом снимок по пути
// <id>.<ext>. Отказ базы по частоте ('feedback rate', P0001) — своя строка,
// текст на месте. Отказала только загрузка — «ушло без снимка», повтор
// догружает снимок и строку второй раз не шлёт.
import { Platform } from 'react-native';
import { render, fireEvent, within, act } from '@testing-library/react-native';
import FeedbackScreen from '../src/screens/FeedbackScreen';
import { feedbackRow, deviceName, uuid4, base64ToBytes, parseImage, clearDraft, isRateLimited, sendFeedback, FEEDBACK_MAX } from '../src/lib/feedback';
import { sb } from '../src/lib/supabaseClient';
import { pickPhoto } from '../src/lib/photoPicker';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { t } from '../src/lib/i18n';
import { ICONS } from '../src/core/icons';

const APP_VERSION = require('../app.json').expo.version;

jest.mock('../src/lib/supabaseClient', () => {
  const bucket = { upload: jest.fn() };
  const table = { insert: jest.fn() };
  return {
    sb: {
      bucket,
      table,
      from: jest.fn(() => table),
      storage: { from: jest.fn(() => bucket) },
    },
  };
});
jest.mock('../src/lib/photoPicker', () => ({
  pickPhoto: jest.fn(),
  PHOTO_TOO_BIG: 'photo_too_big',
  PHOTO_MAX_BYTES: 2 * 1024 * 1024,
}));

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Так PostgREST отдаёт отказ триггера feedback_rate.
const RATE = { code: 'P0001', message: 'feedback rate', details: null, hint: 'С аккаунта — не больше 5 сообщений за 10 минут и 20 за сутки.' };
const SHOT_DOWN = { statusCode: '500', error: 'internal', message: 'storage unavailable' };
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

beforeEach(() => {
  clearDraft();
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' }, toastMessage: null });
  useAuthStore.setState({ status: 'signedOut', user: null });
  sb.table.insert.mockReset().mockResolvedValue({ error: null });
  sb.bucket.upload.mockReset().mockResolvedValue({ data: { path: 'x' }, error: null });
  sb.from.mockClear();
  sb.storage.from.mockClear();
  pickPhoto.mockReset().mockResolvedValue({ dataUrl: PNG, name: 'screen.png' });
});
afterEach(() => jest.restoreAllMocks());

const open = (navigation = nav()) => render(<FeedbackScreen navigation={navigation} />);
async function type(q, text) {
  await fireEvent.changeText(q.getByTestId('feedback-text'), text);
}
async function attach(q) {
  await act(async () => { fireEvent.press(q.getByTestId('feedback-attach')); });
}
/** Текст красной строки (InfoRow вешает testID на сам Text). */
const errorText = (q) => q.getByTestId('feedback-error').props.children;

describe('форма', () => {
  test('вид сегментами «Ошибка · Идея · Другое», поле до 4000, снимок, «Отправить»', async () => {
    const q = await open();
    const kinds = within(q.getByTestId('feedback-kind'));
    for (const k of ['bug', 'idea', 'other']) kinds.getByText(t('ru', `feedback.kind_${k}`));
    expect(q.getByTestId('feedback-text').props.maxLength).toBe(FEEDBACK_MAX);
    within(q.getByTestId('feedback-attach')).getByText(t('ru', 'feedback.attach'));
    // Пустой текст — отправлять нечего.
    expect(q.getByTestId('feedback-send').props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('гость: уходит строка с видом, текстом, платформой, версией из app.json, языком и моделью — без user_id', async () => {
    const navigation = nav();
    const q = await open(navigation);
    await fireEvent.press(within(q.getByTestId('feedback-kind')).getByText(t('ru', 'feedback.kind_idea')));
    await type(q, '  Тёмная тема для графиков  ');
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.from).toHaveBeenCalledWith('feedback');
    expect(sb.table.insert).toHaveBeenCalledTimes(1);
    expect(sb.table.insert).toHaveBeenCalledWith({
      id: expect.stringMatching(UUID),
      kind: 'idea',
      text: 'Тёмная тема для графиков',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      app_version: APP_VERSION,
      lang: 'ru',
      device: expect.any(String),
      screenshot_path: null,
    });
    expect(sb.bucket.upload).not.toHaveBeenCalled();
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'feedback.sent'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('вошедший — со своим user_id', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'a@b.c', name: 'А' } });
    const q = await open();
    await type(q, 'Ошибка в выгрузке');
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.table.insert.mock.calls[0][0]).toMatchObject({ kind: 'bug', user_id: 'u1' });
  });

  test('снимок: сначала строка с путём <id>.png, потом картинка в бакет feedback по этому пути', async () => {
    const q = await open();
    await type(q, 'Кнопка уехала');
    await attach(q);
    expect(pickPhoto).toHaveBeenCalledTimes(1);
    // Неподвижная картинка: GIF бакет feedback не примет (19 октября 2026).
    expect(pickPhoto).toHaveBeenCalledWith({ still: true });
    q.getByTestId('feedback-thumb');
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.storage.from).toHaveBeenCalledWith('feedback');
    const [path, body, opts] = sb.bucket.upload.mock.calls[0];
    expect(path).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(body.byteLength).toBe(8);
    expect(opts).toEqual({ contentType: 'image/png', upsert: false });
    const row = sb.table.insert.mock.calls[0][0];
    expect(row.screenshot_path).toBe(path);
    expect(path).toBe(`${row.id}.png`);
    // Бакет примет только снимок, который строка уже назвала.
    expect(sb.table.insert.mock.invocationCallOrder[0]).toBeLessThan(sb.bucket.upload.mock.invocationCallOrder[0]);
  });

  test('снимок — строка со скрепкой, а не переключатель: нажатие на всю строку открывает выбор', async () => {
    const q = await open();
    const row = q.getByTestId('feedback-attach');
    expect(row.props.accessibilityRole).toBe('button');
    expect(q.queryByRole('switch')).toBeNull();
    // Значок — скрепка из словаря (paperclip), не картинка.
    const walk = (node) => [node, ...(node.children || []).filter((c) => typeof c === 'object').flatMap(walk)];
    const paths = walk(row).filter((n) => n.type === 'RNSVGPath').map((n) => n.props.d);
    expect(paths).toContain(ICONS.paperclip.p[0][0]);
    expect(q.queryByTestId('feedback-thumb')).toBeNull();
    // Нажали на подпись — тоже выбор: нажимается вся строка.
    await act(async () => { fireEvent.press(within(row).getByText(t('ru', 'feedback.attach'))); });
    expect(pickPhoto).toHaveBeenCalledTimes(1);
    q.getByTestId('feedback-thumb');
  });

  test('выбранная — миниатюра с крестиком; крестик убирает, снимок не уходит', async () => {
    const q = await open();
    await type(q, 'Кнопка уехала');
    await attach(q);
    expect(q.getByTestId('feedback-thumb').props.source).toEqual({ uri: PNG });
    const remove = q.getByTestId('feedback-shot-remove');
    expect(remove.props.accessibilityLabel).toBe(t('ru', 'feedback.shot_remove'));
    await act(async () => { fireEvent.press(remove); });
    expect(q.queryByTestId('feedback-thumb')).toBeNull();
    expect(pickPhoto).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.bucket.upload).not.toHaveBeenCalled();
    expect(sb.table.insert.mock.calls[0][0].screenshot_path).toBeNull();
  });

  test('повторное нажатие меняет картинку; передумали выбирать — прежняя остаётся', async () => {
    const q = await open();
    await attach(q);
    pickPhoto.mockResolvedValueOnce({ dataUrl: 'data:image/jpeg;base64,aGk=', name: 'two.jpg' });
    await attach(q);
    expect(q.getByTestId('feedback-thumb').props.source).toEqual({ uri: 'data:image/jpeg;base64,aGk=' });
    pickPhoto.mockResolvedValueOnce(null);
    await attach(q);
    expect(q.getByTestId('feedback-thumb').props.source).toEqual({ uri: 'data:image/jpeg;base64,aGk=' });
  });

  test('передумали выбирать с первого раза — миниатюры нет', async () => {
    pickPhoto.mockResolvedValue(null);
    const q = await open();
    await attach(q);
    expect(q.queryByTestId('feedback-shot')).toBeNull();
  });

  test('сеть упала: красная строка и «Повторить», текст на месте; повтор — та же запись, снимок — после неё', async () => {
    sb.table.insert.mockResolvedValueOnce({ error: { message: 'Network request failed' } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const navigation = nav();
    const q = await open(navigation);
    await type(q, 'Не синхронизируется');
    await attach(q);
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(errorText(q)).toBe(t('ru', 'feedback.failed'));
    within(q.getByTestId('feedback-send')).getByText(t('ru', 'feedback.retry'));
    expect(q.getByTestId('feedback-text').props.value).toBe('Не синхронизируется');
    expect(navigation.goBack).not.toHaveBeenCalled();
    // Строка не дошла — снимок не грузился.
    expect(sb.bucket.upload).not.toHaveBeenCalled();

    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.table.insert).toHaveBeenCalledTimes(2);
    const [first, second] = sb.table.insert.mock.calls.map((c) => c[0]);
    expect(second.id).toBe(first.id);
    expect(sb.bucket.upload).toHaveBeenCalledTimes(1);
    expect(second.screenshot_path).toBe(sb.bucket.upload.mock.calls[0][0]);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('база отказала по частоте: своя строка, текст и снимок на месте, в бакет ничего не ушло', async () => {
    sb.table.insert.mockResolvedValueOnce({ data: null, error: RATE });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const navigation = nav();
    const q = await open(navigation);
    await type(q, 'Шестое за десять минут');
    await attach(q);
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(errorText(q)).toBe(t('ru', 'feedback.rate'));
    expect(q.queryByText(t('ru', 'feedback.failed'))).toBeNull();
    expect(q.getByTestId('feedback-text').props.value).toBe('Шестое за десять минут');
    q.getByTestId('feedback-thumb');
    expect(sb.bucket.upload).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(useAppStore.getState().toastMessage).toBeNull();
    // Через несколько минут — та же запись, снимок следом.
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.table.insert).toHaveBeenCalledTimes(2);
    expect(sb.table.insert.mock.calls[1][0].id).toBe(sb.table.insert.mock.calls[0][0].id);
    expect(sb.bucket.upload).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('отказала только загрузка снимка: «ушло без снимка», повтор догружает снимок, а строку второй раз не шлёт', async () => {
    sb.bucket.upload.mockResolvedValueOnce({ data: null, error: SHOT_DOWN });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const navigation = nav();
    const q = await open(navigation);
    await type(q, 'Съехала таблица');
    await attach(q);
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(errorText(q)).toBe(t('ru', 'feedback.shot_failed'));
    within(q.getByTestId('feedback-send')).getByText(t('ru', 'feedback.retry'));
    expect(q.getByTestId('feedback-text').props.value).toBe('Съехала таблица');
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(sb.table.insert).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.table.insert).toHaveBeenCalledTimes(1);
    expect(sb.bucket.upload).toHaveBeenCalledTimes(2);
    const row = sb.table.insert.mock.calls[0][0];
    expect(sb.bucket.upload.mock.calls.map((c) => c[0])).toEqual([`${row.id}.png`, `${row.id}.png`]);
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'feedback.sent'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('строка ушла без снимка, а снимок убрали — следующее «Отправить» — уже новое сообщение', async () => {
    sb.bucket.upload.mockResolvedValueOnce({ data: null, error: SHOT_DOWN });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const q = await open();
    await type(q, 'Не грузится картинка');
    await attach(q);
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    q.getByTestId('feedback-error');
    await act(async () => { fireEvent.press(q.getByTestId('feedback-shot-remove')); });
    // Прежнее сообщение уже у нас — красной строки нет.
    expect(q.queryByTestId('feedback-error')).toBeNull();
    await act(async () => { fireEvent.press(q.getByTestId('feedback-send')); });
    expect(sb.table.insert).toHaveBeenCalledTimes(2);
    const [first, second] = sb.table.insert.mock.calls.map((c) => c[0]);
    expect(second.id).not.toBe(first.id);
    expect(second.screenshot_path).toBeNull();
    expect(sb.bucket.upload).toHaveBeenCalledTimes(1);
  });

  test('черновик переживает уход с экрана', async () => {
    let q = await open();
    await fireEvent.press(within(q.getByTestId('feedback-kind')).getByText(t('ru', 'feedback.kind_other')));
    await type(q, 'Наполовину написано');
    q.unmount();
    q = await open();
    expect(q.getByTestId('feedback-text').props.value).toBe('Наполовину написано');
    expect(q.getByTestId('feedback-text').props.placeholder).toBe(t('ru', 'feedback.ph_other'));
  });
});

describe('lib/feedback', () => {
  test('feedbackRow: Android — платформа и модель словами; неизвестный вид — other; текст режется до 4000', () => {
    const row = feedbackRow({
      kind: 'wish', text: 'x'.repeat(5000), lang: 'kk', os: 'android',
      constants: { Brand: 'Google', Model: 'Pixel 8', Release: '15' },
    });
    expect(row).toEqual({
      kind: 'other', text: 'x'.repeat(4000), platform: 'android', app_version: APP_VERSION,
      lang: 'kk', device: 'Google Pixel 8 · Android 15', screenshot_path: null,
    });
    expect(deviceName('ios', { systemName: 'iOS', osVersion: '26.0' })).toBe('iPhone · iOS 26.0');
  });

  test('feedbackRow: id строки, если передан; отказ по частоте узнаётся по коду и тексту', () => {
    const row = feedbackRow({ id: '0b7c2a8e-3f1d-4c5a-9e2b-7d6f5a4c3b21', kind: 'bug', text: 'x', os: 'android', constants: {} });
    expect(row.id).toBe('0b7c2a8e-3f1d-4c5a-9e2b-7d6f5a4c3b21');
    expect(isRateLimited(RATE)).toBe(true);
    expect(isRateLimited({ code: 'P0001', message: 'account assets remain' })).toBe(false);
    expect(isRateLimited({ code: '42501', message: 'feedback rate' })).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });

  test('sendFeedback: строка, потом снимок по пути <id>.<ext>; дошедшая строка в повторе не уходит', async () => {
    const jpeg = { dataUrl: 'data:image/jpeg;base64,aGk=' };
    sb.bucket.upload.mockResolvedValueOnce({ data: null, error: SHOT_DOWN });
    const first = await sendFeedback({ kind: 'bug', text: 'Снимок', lang: 'ru', shot: jpeg });
    expect(first).toMatchObject({ ok: false, stage: 'shot', rate: false });
    expect(first.attempt.id).toMatch(UUID);
    expect(first.attempt).toMatchObject({ sent: true, uploaded: false, path: `${first.attempt.id}.jpg` });
    const again = await sendFeedback({ kind: 'bug', text: 'Снимок', lang: 'ru', shot: jpeg, attempt: first.attempt });
    expect(again.ok).toBe(true);
    expect(sb.table.insert).toHaveBeenCalledTimes(1);
    expect(sb.bucket.upload.mock.calls.map((c) => c[0])).toEqual([first.attempt.path, first.attempt.path]);
    // Файл под этим именем уже лежит (ответ на прошлую загрузку потерялся) — это наш.
    sb.bucket.upload.mockResolvedValueOnce({ data: null, error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } });
    const dup = await sendFeedback({ kind: 'bug', text: 'Снимок', lang: 'ru', shot: jpeg, attempt: { ...first.attempt, uploaded: false } });
    expect(dup.ok).toBe(true);
    // Строка уже есть (ответ потерялся) — 23505, это успех, и снимок следом.
    sb.table.insert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key value violates unique constraint "feedback_pkey"' } });
    const lost = await sendFeedback({ kind: 'bug', text: 'Снимок', lang: 'ru', shot: { dataUrl: PNG }, attempt: { id: first.attempt.id, sent: false, uploaded: false } });
    expect(lost).toMatchObject({ ok: true, attempt: { sent: true, uploaded: true, path: `${first.attempt.id}.png` } });
    // Отказ по частоте — rate, снимок не грузится.
    sb.table.insert.mockResolvedValueOnce({ data: null, error: RATE });
    sb.bucket.upload.mockClear();
    const rate = await sendFeedback({ kind: 'bug', text: 'Снимок', lang: 'ru', shot: jpeg });
    expect(rate).toMatchObject({ ok: false, stage: 'row', rate: true, attempt: { sent: false } });
    expect(sb.bucket.upload).not.toHaveBeenCalled();
    // GIF бакет не примет — строка не уходит вовсе.
    sb.table.insert.mockClear();
    const gif = await sendFeedback({ kind: 'bug', text: 'Снимок', lang: 'ru', shot: { dataUrl: 'data:image/gif;base64,aGk=' } });
    expect(gif).toMatchObject({ ok: false, stage: 'row' });
    expect(sb.table.insert).not.toHaveBeenCalled();
  });

  test('uuid4 — версия 4; base64 и data URL картинки разбираются в байты', () => {
    expect(uuid4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Array.from(base64ToBytes('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
    expect(parseImage('data:image/jpeg;base64,aGk=')).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
    expect(parseImage('data:image/gif;base64,aGk=')).toBeNull();
  });
});

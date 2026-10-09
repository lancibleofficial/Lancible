// Плашка обновления в «Меню». Запуск: npm run test:mobile (из корня)
//
// Что делает загрузка — в updateCheck.test.js. Здесь — что экран делает с её
// ответом. С 1.1.1 по 1.2.0 на любой отказ он молча открывал страницу
// релиза, и сломанное обновление выглядело как задуманное. Теперь отказ
// называется словами, а дальше выбирает пользователь.
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Linking } from 'react-native';
import SettingsScreen from '../src/screens/SettingsScreen';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { checkForUpdate, downloadAndInstall } from '../src/lib/updateCheck';

jest.mock('../src/lib/updateCheck', () => ({ checkForUpdate: jest.fn(), downloadAndInstall: jest.fn() }));

const UPDATE = { available: true, version: '1.2.1', url: 'https://example.com/release', apk: 'https://example.com/a.apk', size: 1000, canInstall: true };

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' } });
  useAuthStore.setState({ status: 'signedOut', user: null });
  useSheetStore.setState({ content: null, footer: null });
  checkForUpdate.mockResolvedValue(UPDATE);
  downloadAndInstall.mockReset();
  // Linking.openURL в моках RN — уже jest.fn: spyOn вернёт его же, а
  // restoreAllMocks не сбросит, и вызовы прошлого теста перешли бы сюда.
  jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

/** Экран с плашкой «Доступна версия 1.2.1», нажатой один раз. */
async function pressUpdate() {
  const screen = await render(<SettingsScreen navigation={{ navigate: jest.fn() }} />);
  await waitFor(() => screen.getByText('Доступна версия 1.2.1'));
  await act(async () => { fireEvent.press(screen.getByText('Обновить')); });
  return screen;
}
/** Открытый лист: текст и кнопки. Кнопки содержимое кладёт в подвал своим
 *  эффектом, поэтому подвал рендерится вторым — как в BottomSheet. */
async function sheet() {
  const content = await render(useSheetStore.getState().content);
  const footer = await render(useSheetStore.getState().footer);
  return { getByText: (text) => content.queryByText(text) || footer.getByText(text) };
}

test('отказ — лист с причиной и выбором, а не молчаливый браузер', async () => {
  downloadAndInstall.mockResolvedValue({ ok: false, reason: 'size' });
  await pressUpdate();
  expect(Linking.openURL).not.toHaveBeenCalled();
  const s = await sheet();
  s.getByText('Не удалось обновить');
  s.getByText('Файл скачался не целиком. Попробуйте ещё раз.');
  s.getByText('Повторить');
  s.getByText('Скачать в браузере');
  s.getByText('Отмена');
});

test('«Повторить» качает заново, «Скачать в браузере» открывает страницу релиза', async () => {
  downloadAndInstall.mockResolvedValue({ ok: false, reason: 'download' });
  await pressUpdate();
  let s = await sheet();
  s.getByText('Файл не скачался. Проверьте интернет и попробуйте ещё раз.');
  await act(async () => { fireEvent.press(s.getByText('Повторить')); });
  expect(downloadAndInstall).toHaveBeenCalledTimes(2);

  s = await sheet();
  fireEvent.press(s.getByText('Скачать в браузере'));
  expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/release');
});

test('всё вышло — никакого листа: дальше ведёт системный установщик', async () => {
  downloadAndInstall.mockResolvedValue({ ok: true });
  await pressUpdate();
  expect(downloadAndInstall).toHaveBeenCalledWith(UPDATE, expect.any(Function));
  expect(useSheetStore.getState().content).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
});

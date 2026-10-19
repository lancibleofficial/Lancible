// Удаление аккаунта: что видит человек. Запуск: npm run test:mobile (из корня)
//
// «Удалить аккаунт» — строка раздела «Данные»; она открывает лист аккаунта
// сразу на подтверждении (ProfileSheet page="delete"; с круга 21 сам лист —
// только имя, своей строки удаления в нём нет).
//
// Что делает само удаление — в deleteAccount.test.js. Здесь — какое сообщение
// показывает лист на каждый исход: отказ из-за картинок называется своей
// правовой строкой (account.delete_assets_error), а не общим «не удалось
// удалить» — аккаунт цел именно потому, что картинки стереть не вышло.
import { render, fireEvent, act } from '@testing-library/react-native';
import ProfileSheet from '../src/components/ProfileSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

const ru = (key) => t('ru', key);

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' }, toastMessage: null });
  useSheetStore.setState({ content: null, footer: null });
});

/** Подтверждение «Удалить аккаунт» → тост. */
async function deleteWith(result) {
  const deleteAccount = jest.fn(async () => result);
  useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'qa@example.com', name: 'QA' }, deleteAccount });
  const sheet = await render(<ProfileSheet page="delete" />);
  // Текст — в листе, кнопки — в подвале, который лист кладёт своим эффектом
  // (как в BottomSheet).
  sheet.getByText(ru('account.delete_confirm'));
  expect(useSheetStore.getState().header).toMatchObject({ title: ru('account.delete_title') });
  const footer = await render(useSheetStore.getState().footer);
  await act(async () => { fireEvent.press(footer.getByText(ru('account.delete'))); });
  expect(deleteAccount).toHaveBeenCalledTimes(1);
  return useAppStore.getState().toastMessage;
}

test('картинки стереть не вышло — своя строка, а не общая ошибка', async () => {
  expect(await deleteWith({ ok: false, reason: 'assets' })).toBe(ru('account.delete_assets_error'));
});

test('прочий отказ — общая ошибка', async () => {
  expect(await deleteWith({ ok: false, reason: 'delete' })).toBe(ru('account.delete_error'));
});

test('удалён — сообщение об удалении', async () => {
  expect(await deleteWith({ ok: true })).toBe(ru('account.deleted_toast'));
});

test('«Отмена» закрывает лист и ничего не удаляет', async () => {
  const deleteAccount = jest.fn(async () => ({ ok: true }));
  useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'qa@example.com', name: 'QA' }, deleteAccount });
  useSheetStore.setState({ content: 'лист' });
  await render(<ProfileSheet page="delete" />);
  const footer = await render(useSheetStore.getState().footer);
  await act(async () => { fireEvent.press(footer.getByText(ru('common.cancel'))); });
  expect(deleteAccount).not.toHaveBeenCalled();
  expect(useSheetStore.getState().content).toBeNull();
});

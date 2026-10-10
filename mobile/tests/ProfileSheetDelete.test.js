// Удаление аккаунта в листе профиля: что видит человек. Запуск: npm run test:mobile (из корня)
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

/** Лист профиля → «Удалить аккаунт» → подтверждение → тост. */
async function deleteWith(result) {
  const deleteAccount = jest.fn(async () => result);
  useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'qa@example.com', name: 'QA' }, deleteAccount });
  const sheet = await render(<ProfileSheet />);
  await act(async () => { fireEvent.press(sheet.getByText(ru('account.delete'))); });
  // Подтверждение — нижний лист: текст в content, кнопки — в подвале, который
  // content кладёт своим эффектом (как в BottomSheet).
  await render(useSheetStore.getState().content);
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

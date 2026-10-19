// Несколько аккаунтов: что видно в «Меню» (17 октября 2026). Запуск: npm run test:mobile
//
// Раздел «Аккаунт» — строки аккаунтов с галочкой у текущего (общий
// ChoiceList), «Без аккаунта», если у гостя есть данные, строка-действие
// «Добавить аккаунт»; ниже — профиль, пароль, синхронизация и «Выйти»
// текущего, у аккаунта без сеанса — «Войти заново». Плашка «Меню»
// показывает текущего. «Данные» — «Удалить данные аккаунта с устройства» с
// подтверждением. Пока открывается другая область — «Переключаю…». Как
// переключение устроено внутри — tests/accounts.test.js; здесь стор
// подставлен состоянием, а его действия — подменами, которые видно тесту.
import { StyleSheet } from 'react-native';
import { render, fireEvent, within, act } from '@testing-library/react-native';
import SettingsScreen from '../src/screens/SettingsScreen';
import SettingsSectionScreen from '../src/screens/SettingsSectionScreen';
import RootNavigator from '../src/navigation/RootNavigator';
import BottomSheet from '../src/components/BottomSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

jest.mock('../src/components/DocEditor', () => () => null);
jest.mock('../src/lib/updateCheck', () => ({ checkForUpdate: jest.fn(async () => ({ available: false })), downloadAndInstall: jest.fn() }));

const ANN = { uid: 'u-ann', email: 'ann@example.com', name: 'Аня', accessToken: 'a', refreshToken: 'r', lastUsedAt: 2, needsSignIn: false };
const BOB = { uid: 'u-bob', email: 'bob@example.com', name: '', accessToken: 'b', refreshToken: 'q', lastUsedAt: 1, needsSignIn: false };
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() });
const section = (key) => render(<SettingsSectionScreen navigation={nav()} route={{ params: { section: key } }} />);
const selected = (node) => !!(node.props.accessibilityState && node.props.accessibilityState.selected);

let actions;
function signedInAs(entry, { list = [ANN, BOB], guestHasData = false } = {}) {
  useAuthStore.setState({
    status: 'signedIn', user: { id: entry.uid, email: entry.email, name: entry.name || null },
    accounts: { list, current: entry.uid, known: {} }, current: entry.uid, guestHasData, ...actions,
  });
}

beforeEach(() => {
  actions = {
    switchAccount: jest.fn(async () => ({ ok: true })),
    signOut: jest.fn(async () => {}),
    forgetDeviceData: jest.fn(async () => ({ ok: true })),
  };
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' }, tasks: [], projects: [], tags: [], documents: [], toastMessage: null, scopeError: null });
  useAuthStore.setState({ status: 'signedOut', user: null, accounts: { list: [], current: null, known: {} }, current: null, guestHasData: false, deviceScopes: [], switching: false, switchPending: false, ...actions });
  useSheetStore.setState({ content: null, header: null, footer: null });
});

describe('раздел «Аккаунт»', () => {
  test('аккаунты строками, галочка у текущего; «Без аккаунта» — когда у гостя есть данные; «Добавить аккаунт» — действие без галочки', async () => {
    signedInAs(ANN, { guestHasData: true });
    const q = await section('account');
    const list = q.getByTestId('settings-accounts');
    within(list).getByText('Аня');
    within(list).getByText('ann@example.com');
    // У Боба имени нет — строка подписана почтой.
    within(list).getByText('bob@example.com');
    expect(selected(q.getByTestId('account-row-u-ann'))).toBe(true);
    expect(selected(q.getByTestId('account-row-u-bob'))).toBe(false);
    within(q.getByTestId('account-row-guest')).getByText(t('ru', 'accounts.guest'));
    expect(q.getByTestId('account-add').props.accessibilityRole).toBe('button');
    // Ниже — «Имя ›», пароль, синхронизация и выход текущего (круг 21: «Имя» —
    // лист только с полем имени, как на вебе).
    within(q.getByTestId('settings-name')).getByText(t('ru', 'profile.name_label'));
    q.getByTestId('settings-password');
    q.getByText(t('ru', 'sync.toggle_label'));
    q.getByText(t('ru', 'accounts.sign_out_hint'));
  });

  test('у гостя без данных строки «Без аккаунта» нет', async () => {
    signedInAs(ANN, { guestHasData: false });
    const q = await section('account');
    expect(q.queryByTestId('account-row-guest')).toBeNull();
  });

  test('касание строки переключает: на аккаунт — его uid, на «Без аккаунта» — null; на текущий — ничего нового', async () => {
    signedInAs(ANN, { guestHasData: true });
    const q = await section('account');
    await fireEvent.press(q.getByTestId('account-row-u-bob'));
    await fireEvent.press(q.getByTestId('account-row-guest'));
    expect(actions.switchAccount.mock.calls).toEqual([['u-bob'], [null]]);
  });

  // 19 октября 2026: флаг встаёт до того, как уходят правки прежнего (сеть), —
  // второе касание не запускает второй круг.
  test('пока идёт переключение — строки других аккаунтов, «Без аккаунта» и «Добавить» не нажимаются; текущий с галочкой', async () => {
    signedInAs(ANN, { guestHasData: true });
    useAuthStore.setState({ switchPending: true });
    const q = await section('account');
    for (const id of ['account-row-u-bob', 'account-row-guest', 'account-add']) {
      expect(q.getByTestId(id).props.accessibilityState).toMatchObject({ disabled: true });
    }
    expect(selected(q.getByTestId('account-row-u-ann'))).toBe(true);
    await fireEvent.press(q.getByTestId('account-row-u-bob'));
    await fireEvent.press(q.getByTestId('account-row-guest'));
    expect(actions.switchAccount).not.toHaveBeenCalled();
    // Кончилось — снова нажимаются.
    await act(async () => { useAuthStore.setState({ switchPending: false }); });
    await fireEvent.press(q.getByTestId('account-row-u-bob'));
    expect(actions.switchAccount.mock.calls).toEqual([['u-bob']]);
  });

  test('«Добавить аккаунт» — лист входа с заголовком и подсказкой, что текущий останется', async () => {
    signedInAs(ANN);
    const q = await section('account');
    await fireEvent.press(q.getByTestId('account-add'));
    const s = await render(<BottomSheet />);
    s.getByText(t('ru', 'accounts.add'));
    expect(s.getByTestId('auth-keep-hint').props.children).toBe(t('ru', 'accounts.add_note', { name: 'Аня' }));
    s.getByTestId('auth-mode');
  });

  test('«Выйти» зовёт выход текущего', async () => {
    signedInAs(ANN);
    const q = await section('account');
    await fireEvent.press(q.getByTestId('settings-sign-out'));
    expect(actions.signOut).toHaveBeenCalled();
  });

  test('открыт аккаунт без сеанса: строка «нужно войти заново», «Войти заново» — лист входа с почтой; «Выйти» на месте', async () => {
    const stale = { ...BOB, needsSignIn: true, refreshToken: '' };
    useAuthStore.setState({ accounts: { list: [ANN, stale], current: 'u-bob', known: {} }, current: 'u-bob' });
    const q = await section('account');
    expect(selected(q.getByTestId('account-row-u-bob'))).toBe(true);
    within(q.getByTestId('account-row-u-bob')).getByText(t('ru', 'accounts.needs_sign_in'));
    expect(q.queryByTestId('settings-name')).toBeNull();
    await fireEvent.press(q.getByTestId('settings-sign-out'));
    expect(actions.signOut).toHaveBeenCalled();
    await fireEvent.press(q.getByTestId('settings-sign-in-again'));
    const s = await render(<BottomSheet />);
    s.getByDisplayValue('bob@example.com');
  });

  test('лист входа у гостя с данными говорит, что они останутся «Без аккаунта»', async () => {
    useAuthStore.setState({ guestHasData: true });
    const q = await section('account');
    await fireEvent.press(q.getByTestId('settings-sign-in'));
    const s = await render(<BottomSheet />);
    expect(s.getByTestId('auth-keep-hint').props.children).toBe(t('ru', 'accounts.add_note_guest'));
  });
});

describe('плашка «Меню»', () => {
  test('открыт аккаунт без сеанса — плашка его, с «нужно войти заново», и ведёт в «Аккаунт»', async () => {
    useAuthStore.setState({ accounts: { list: [{ ...BOB, needsSignIn: true }], current: 'u-bob', known: {} }, current: 'u-bob' });
    const navigation = nav();
    const q = await render(<SettingsScreen navigation={navigation} />);
    const plate = q.getByTestId('menu-profile');
    within(plate).getByText('bob@example.com');
    within(plate).getByText(t('ru', 'accounts.needs_sign_in'));
    // Строки «Аккаунт» в «Меню» нет (круг 21) — туда ведёт эта плашка.
    expect(q.queryByTestId('menu-section-account')).toBeNull();
    await fireEvent.press(plate);
    expect(navigation.navigate).toHaveBeenCalledWith('SettingsSection', { section: 'account' });
  });

  test('гость при аккаунтах в списке — «Без аккаунта», тоже ведёт в «Аккаунт»; без аккаунтов — прежние «Войти» и «Создать аккаунт»', async () => {
    useAuthStore.setState({ accounts: { list: [ANN], current: null, known: {} } });
    let q = await render(<SettingsScreen navigation={nav()} />);
    within(q.getByTestId('menu-profile')).getByText(t('ru', 'accounts.guest'));
    useAuthStore.setState({ accounts: { list: [], current: null, known: {} } });
    q = await render(<SettingsScreen navigation={nav()} />);
    expect(q.queryByTestId('menu-profile')).toBeNull();
    q.getByText(t('ru', 'auth.create_account'));
  });
});

describe('«Данные» — перенести данные без аккаунта', () => {
  test('строка есть, пока открыт аккаунт и у гостя есть данные; подтверждение переносит и говорит об этом', async () => {
    signedInAs(ANN, { guestHasData: true });
    actions.moveGuestData = jest.fn(async () => ({ ok: true }));
    useAuthStore.setState({ moveGuestData: actions.moveGuestData });
    const q = await section('data');
    const label = within(q.getByTestId('settings-move-guest')).getByText(t('ru', 'accounts.move_row'));
    // Длинное действие без значения справа — на всю ширину, до двух строк, а не обрезано на 62 %.
    expect(label.props.numberOfLines).toBe(2);
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ flexShrink: 1, maxWidth: '100%' });
    await fireEvent.press(q.getByTestId('settings-move-guest'));
    const s = await render(<BottomSheet />);
    s.getByText(t('ru', 'accounts.move_title'));
    s.getByText(t('ru', 'accounts.move_text'));
    await act(async () => { fireEvent.press(s.getByText(t('ru', 'accounts.move_ok'))); });
    expect(actions.moveGuestData).toHaveBeenCalled();
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'accounts.moved_toast'));
  });

  test('у гостя данных нет или открыт гость — строки нет', async () => {
    signedInAs(ANN, { guestHasData: false });
    let q = await section('data');
    expect(q.queryByTestId('settings-move-guest')).toBeNull();
    useAuthStore.setState({ status: 'signedOut', user: null, current: null, guestHasData: true, accounts: { list: [], current: null, known: {} } });
    q = await section('data');
    expect(q.queryByTestId('settings-move-guest')).toBeNull();
  });
});

describe('«Данные» — удалить данные аккаунта с устройства', () => {
  test('строки нет, пока на телефоне нет данных аккаунтов', async () => {
    const q = await section('data');
    expect(q.queryByTestId('settings-forget-device')).toBeNull();
  });

  test('один аккаунт — лист сразу на подтверждении; «Удалить» стирает его данные и говорит об этом', async () => {
    useAuthStore.setState({ deviceScopes: ['u-bob'], accounts: { list: [], current: null, known: { 'u-bob': { email: 'bob@example.com', name: '' } } } });
    const q = await section('data');
    await fireEvent.press(q.getByTestId('settings-forget-device'));
    const s = await render(<BottomSheet />);
    s.getByText(t('ru', 'accounts.forget_title'));
    s.getByText(t('ru', 'accounts.forget_confirm', { name: 'bob@example.com' }));
    expect(s.queryByLabelText(t('ru', 'common.back'))).toBeNull();
    await act(async () => { fireEvent.press(s.getByText(t('ru', 'common.delete'))); });
    expect(actions.forgetDeviceData).toHaveBeenCalledWith('u-bob');
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'accounts.forgot_toast'));
  });

  test('несколько — сначала выбор, потом подтверждение со стрелкой «назад»; у открытого — что откроется гость', async () => {
    signedInAs(ANN);
    useAuthStore.setState({ deviceScopes: ['u-ann', 'u-bob'] });
    const q = await section('data');
    await fireEvent.press(q.getByTestId('settings-forget-device'));
    const s = await render(<BottomSheet />);
    s.getByText(t('ru', 'accounts.device_group'));
    within(s.getByTestId('device-data-u-ann')).getByText(t('ru', 'accounts.current'));
    await fireEvent.press(s.getByTestId('device-data-u-ann'));
    s.getByText(`${t('ru', 'accounts.forget_confirm', { name: 'Аня' })} ${t('ru', 'accounts.forget_current')}`);
    await fireEvent.press(s.getByLabelText(t('ru', 'common.back')));
    s.getByTestId('device-data-list');
    expect(actions.forgetDeviceData).not.toHaveBeenCalled();
  });
});

test('пока открывается другая область — «Переключаю…» вместо вкладок', async () => {
  useAuthStore.setState({ switching: true, init: jest.fn() });
  const q = await render(<RootNavigator />);
  q.getByTestId('switching-screen');
  q.getByText(t('ru', 'accounts.switching'));
});

describe('область не прочиталась (19 октября 2026)', () => {
  test('вместо вкладок — ошибка с «Повторить»; у аккаунта — ещё и «Без аккаунта»', async () => {
    const reopenScope = jest.fn(async () => true);
    useAuthStore.setState({ init: jest.fn(), reopenScope });
    useAppStore.setState({ hasHydrated: false, scopeError: { uid: 'u-ann' } });
    const q = await render(<RootNavigator />);
    q.getByTestId('scope-error-screen');
    q.getByText(t('ru', 'accounts.read_failed_title'));
    q.getByText(t('ru', 'accounts.read_failed_text'));
    await fireEvent.press(q.getByText(t('ru', 'accounts.read_retry')));
    expect(reopenScope).toHaveBeenCalledTimes(1);
    await fireEvent.press(q.getByTestId('scope-error-guest'));
    expect(actions.switchAccount.mock.calls).toEqual([[null]]);
  });

  test('у гостя — только «Повторить»', async () => {
    useAuthStore.setState({ init: jest.fn(), reopenScope: jest.fn(async () => true) });
    useAppStore.setState({ hasHydrated: false, scopeError: { uid: null } });
    const q = await render(<RootNavigator />);
    q.getByTestId('scope-error-screen');
    expect(q.queryByTestId('scope-error-guest')).toBeNull();
  });
});

// «Меню» по разделам (17 октября 2026). Запуск: npm run test:mobile
//
// Вкладка «Меню» — строки-разделы, тот же набор и порядок, что на вебе:
// Основное, Работа, Аккаунт, Данные, О приложении, Обратная связь. Строка —
// значок, название, сводка словами, шеврон; тап открывает раздел экраном
// стека (push). Здесь — что строки на месте и ведут куда надо, что названия
// — те же, что у веба, и что каждый раздел собран из своих строк.
//
// Круг 21: строки «Аккаунт» в «Меню» нет — её повторяла плашка профиля, она и
// ведёт в раздел; в шапке «Меню» — поиск. В разделе «Аккаунт» вместо строки,
// открывавшей лист профиля, — «Имя ›» с листом только для имени (как на вебе);
// пароль, синхронизация и выход — строками раздела, удаление — в «Данных».
import { render, fireEvent, within, act } from '@testing-library/react-native';
import SettingsScreen from '../src/screens/SettingsScreen';
import SettingsSectionScreen, { SETTINGS_SECTIONS, MENU_SECTIONS, workHoursText } from '../src/screens/SettingsSectionScreen';
import BottomSheet from '../src/components/BottomSheet';
import { DETAIL_ROUTES } from '../src/navigation/detailScreens';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t, T } from '../src/lib/i18n';
import { WHEEL_ITEM_H, wheelCenterRow } from '../src/components/WheelPicker';

// detailScreens тянет страницу задачи, а с ней WebView редактора.
jest.mock('../src/components/DocEditor', () => () => null);
jest.mock('../src/lib/updateCheck', () => ({ checkForUpdate: jest.fn(async () => ({ available: false })), downloadAndInstall: jest.fn() }));

const LANGS = ['ru', 'en', 'uk', 'kk'];
const ORDER = ['main', 'work', 'account', 'data', 'about', 'feedback'];
/** Строки «Меню»: те же, без «Аккаунта» — он плашкой профиля. */
const MENU = ORDER.filter((k) => k !== 'account');
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() });
const USER = { id: 'u1', email: 'ann@example.com', name: 'Аня' };

beforeEach(() => {
  const settings = { ...useAppStore.getState().settings, lang: 'ru', hourlyRate: 5000, currency: 'KZT', theme: 'dark' };
  delete settings.mode; delete settings.showTimer; delete settings.showEarnings; delete settings.workHours;
  useAppStore.setState({ settings, tasks: [], projects: [], tags: [], documents: [] });
  useAuthStore.setState({ status: 'signedOut', user: null, signOut: jest.fn() });
  useSheetStore.setState({ content: null, header: null, footer: null });
});

const menu = (navigation = nav()) => render(<SettingsScreen navigation={navigation} />);
const section = (key, navigation = nav()) => render(<SettingsSectionScreen navigation={navigation} route={{ params: { section: key } }} />);
const switchOf = (q, id) => q.getByTestId(id);
const checked = (n) => (n.props.accessibilityState && 'checked' in n.props.accessibilityState ? n.props.accessibilityState.checked : n.props.value);

describe('строки разделов в «Меню»', () => {
  test('разделы по порядку веба, с названиями на месте; строки «Аккаунт» нет — она повторяла плашку профиля', async () => {
    expect(SETTINGS_SECTIONS.map((s) => s.key)).toEqual(ORDER);
    expect(MENU_SECTIONS.map((s) => s.key)).toEqual(MENU);
    const q = await menu();
    const rows = within(q.getByTestId('menu-sections')).getAllByRole('button');
    expect(rows.map((r) => r.props.testID)).toEqual(MENU.map((k) => `menu-section-${k}`));
    expect(MENU.map((k) => within(q.getByTestId(`menu-section-${k}`)).getAllByText(/./)[0].props.children))
      .toEqual(['Основное', 'Работа', 'Данные', 'О приложении', 'Обратная связь']);
    expect(q.queryByTestId('menu-section-account')).toBeNull();
    expect(within(q.getByTestId('menu-sections')).queryByText(t('ru', 'settings.section_account'))).toBeNull();
  });

  test('названия — те же, что у разделов веба (на всех языках, где у веба ключ уже есть)', () => {
    const web = require('../../src/renderer/core/i18n.js').T;
    const diff = [];
    for (const s of SETTINGS_SECTIONS) {
      for (const lang of LANGS) {
        expect(T[lang][s.title]).toBeTruthy();
        if (web[lang] && web[lang][s.title] && web[lang][s.title] !== T[lang][s.title]) diff.push(`${lang}: ${s.title}`);
      }
    }
    expect(diff).toEqual([]);
  });

  test('тап ведёт в раздел экраном стека; «Обратная связь» — своим экраном', async () => {
    const navigation = nav();
    const q = await menu(navigation);
    for (const key of MENU) await fireEvent.press(q.getByTestId(`menu-section-${key}`));
    expect(navigation.navigate.mock.calls).toEqual([
      ...MENU.slice(0, 4).map((section) => ['SettingsSection', { section }]),
      ['Feedback'],
    ]);
    // Разделы — детали стека: таббар на них прячется, как на документах.
    expect(DETAIL_ROUTES).toEqual(expect.arrayContaining(['SettingsSection', 'Feedback']));
  });

  test('сводка словами: язык и режим, ставка, версия', async () => {
    let q = await menu();
    expect(q.getByTestId('menu-section-main-value').props.children).toBe('Русский · Фрилансер');
    expect(q.getByTestId('menu-section-work-value').props.children).toMatch(/5\s000.*₸.*\/ч/);
    q.getByTestId('menu-section-about-value');
    // «Личное» — в сводке «Работы» ставки нет.
    await act(async () => { useAppStore.getState().setSettings({ mode: 'personal' }); });
    q = await menu();
    expect(q.getByTestId('menu-section-main-value').props.children).toBe('Русский · Личное');
    expect(q.queryByTestId('menu-section-work-value')).toBeNull();
  });

  test('профиль-остров ведёт в «Аккаунт» — и у вошедшего, и у открытого без сеанса', async () => {
    useAuthStore.setState({ status: 'signedIn', user: USER });
    let navigation = nav();
    let q = await menu(navigation);
    within(q.getByTestId('menu-profile')).getByText(USER.name);
    await fireEvent.press(q.getByTestId('menu-profile'));
    expect(navigation.navigate).toHaveBeenCalledWith('SettingsSection', { section: 'account' });
    const accounts = useAuthStore.getState().accounts;
    await act(async () => {
      useAuthStore.setState({ status: 'signedOut', user: null, current: 'u1', accounts: { ...accounts, list: [{ uid: 'u1', email: USER.email, name: '', needsSignIn: true }] } });
    });
    navigation = nav();
    q = await menu(navigation);
    await fireEvent.press(q.getByTestId('menu-profile'));
    expect(navigation.navigate).toHaveBeenCalledWith('SettingsSection', { section: 'account' });
    await act(async () => { useAuthStore.setState({ current: null, accounts }); });
  });

  test('шапка «Меню»: поиск — тот же экран, что у «Задач» и «Проектов»; колокольчик рядом', async () => {
    const navigation = nav();
    const q = await menu(navigation);
    const search = q.getByTestId('menu-search');
    expect(search.props.accessibilityLabel).toBe(t('ru', 'search.placeholder'));
    await fireEvent.press(search);
    expect(navigation.navigate).toHaveBeenCalledWith('Search');
    // Поиск — экран стека и в «Меню»: таббар на нём прячется, как везде.
    expect(DETAIL_ROUTES).toContain('Search');
  });
});

describe('«Основное»', () => {
  test('язык, тёмная тема, режим сегментами, напоминания', async () => {
    const q = await section('main');
    q.getByTestId('settings-language');
    q.getByText(t('ru', 'menu.theme_dark'));
    q.getByText(t('ru', 'menu.remind'));
    q.getByText(t('ru', 'notif.system'));
    const seg = q.getByTestId('settings-mode');
    within(seg).getByText(t('ru', 'mode.freelance'));
    q.getByText(t('ru', 'mode.hint_freelance'));
  });

  test('режим «Личное» пишется в настройки, подсказка меняется', async () => {
    const q = await section('main');
    await fireEvent.press(within(q.getByTestId('settings-mode')).getByText(t('ru', 'mode.personal')));
    expect(useAppStore.getState().settings.mode).toBe('personal');
    q.getByText(t('ru', 'mode.hint_personal'));
  });
});

describe('«Работа»', () => {
  test('фрилансер: ставка, валюта, таймер, счётчик заработка, рабочие часы — без «скоро», с подписью про агента', async () => {
    const q = await section('work');
    q.getByTestId('settings-rate');
    q.getByTestId('settings-currency');
    expect(checked(switchOf(q, 'settings-timer'))).toBe(true);
    expect(checked(switchOf(q, 'settings-earnings'))).toBe(true);
    const wh = q.getByTestId('settings-work-hours');
    expect(within(wh).queryByText('скоро')).toBeNull();
    expect(q.getByTestId('settings-work-hours-value').props.children).toBe('Пн–Пт 09:00–18:00');
    q.getByText('Агент ищет свободное время в эти часы. Задачи можно ставить на любое время.');
  });

  test('переключатели пишут showTimer и showEarnings', async () => {
    const q = await section('work');
    await fireEvent(switchOf(q, 'settings-timer'), 'valueChange', false);
    await fireEvent(switchOf(q, 'settings-earnings'), 'valueChange', false);
    // Рисованный переключатель (jest без нативного модуля) отдаёт значение нажатием.
    if (useAppStore.getState().settings.showTimer === undefined) {
      await fireEvent.press(switchOf(q, 'settings-timer'));
      await fireEvent.press(switchOf(q, 'settings-earnings'));
    }
    expect(useAppStore.getState().settings).toMatchObject({ showTimer: false, showEarnings: false });
  });

  test('«Личное»: ни ставки, ни валюты, ни счётчика заработка — таймер остаётся', async () => {
    useAppStore.getState().setSettings({ mode: 'personal' });
    const q = await section('work');
    expect(q.queryByTestId('settings-rate')).toBeNull();
    expect(q.queryByTestId('settings-currency')).toBeNull();
    expect(q.queryByTestId('settings-earnings')).toBeNull();
    q.getByTestId('settings-timer');
  });

  test('workHoursText: подряд — промежутком, вразбивку — списком', () => {
    expect(workHoursText({ start: '10:00', end: '19:00', days: [1, 2, 3, 4, 5] }, 'ru')).toBe('Пн–Пт 10:00–19:00');
    expect(workHoursText({ start: '10:00', end: '12:00', days: [1, 3] }, 'ru')).toBe('Пн, Ср 10:00–12:00');
  });
});

describe('«Рабочие часы» правятся: начало и конец — барабаны, дни — квадраты', () => {
  const sheet = async () => {
    const q = await section('work');
    await fireEvent.press(q.getByTestId('settings-work-hours'));
    return render(<BottomSheet />);
  };
  const footer = (s) => within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button');
  /** Повернуть барабан (первый — часы, второй — минуты) на значение. */
  const spin = async (s, which, value, len) => {
    const win = s.getAllByTestId('wheel-window')[which];
    const scroll = win.parent.children.find((k) => k.type === 'RCTScrollView');
    await fireEvent(scroll, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 0, y: wheelCenterRow(value, len) * WHEEL_ITEM_H } } });
  };
  const day = (s, d) => s.getByTestId(`work-hours-days-${d}`);
  const on = (node) => !!node.props.accessibilityState.selected;

  test('тап по строке — лист «Рабочие часы»: «Начало ›», «Конец ›», дни; выбор — под строкой, открыт один', async () => {
    const s = await sheet();
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'settings.work_hours'));
    within(s.getByTestId('work-hours-start')).getByText('09:00');
    within(s.getByTestId('work-hours-end')).getByText('18:00');
    expect(s.queryAllByTestId('wheel-window')).toHaveLength(0);
    await fireEvent.press(s.getByTestId('work-hours-start'));
    expect(s.getAllByTestId('wheel-window')).toHaveLength(2);
    await fireEvent.press(s.getByTestId('work-hours-end'));
    expect(s.getAllByTestId('wheel-window')).toHaveLength(2);
    expect(s.getByTestId('work-hours-end').props.accessibilityState.expanded).toBe(true);
    expect(s.getByTestId('work-hours-start').props.accessibilityState.expanded).toBe(false);
    expect([1, 2, 3, 4, 5].every((d) => on(day(s, d)))).toBe(true);
    expect(on(day(s, 6)) || on(day(s, 0))).toBe(false);
  });

  test('«Сохранить» пишет settings.workHours {start, end, days}, строка показывает новые часы', async () => {
    const s = await sheet();
    await fireEvent.press(s.getByTestId('work-hours-start'));
    await spin(s, 0, 10, 24);
    await spin(s, 1, 30, 60);
    within(s.getByTestId('work-hours-start')).getByText('10:30');
    await fireEvent.press(s.getByTestId('work-hours-end'));
    await spin(s, 0, 22, 24);
    within(s.getByTestId('work-hours-end')).getByText('22:00');
    await fireEvent.press(day(s, 1));
    await fireEvent.press(day(s, 6));
    await fireEvent.press(day(s, 0));
    await fireEvent.press(footer(s)[0]);
    expect(useAppStore.getState().settings.workHours).toEqual({ start: '10:30', end: '22:00', days: [0, 2, 3, 4, 5, 6] });
    expect(useSheetStore.getState().content).toBeNull();
    const q = await section('work');
    expect(q.getByTestId('settings-work-hours-value').props.children).toBe('Вт–Вс 10:30–22:00');
  });

  test('свои часы открываются в листе как есть', async () => {
    useAppStore.getState().setSettings({ workHours: { start: '07:15', end: '12:00', days: [6, 0] } });
    const s = await sheet();
    within(s.getByTestId('work-hours-start')).getByText('07:15');
    within(s.getByTestId('work-hours-end')).getByText('12:00');
    expect([6, 0].every((d) => on(day(s, d)))).toBe(true);
    expect(on(day(s, 1))).toBe(false);
  });

  test('конец не позже начала или ни одного дня — красная подсказка, «Сохранить» ничего не пишет', async () => {
    const s = await sheet();
    await fireEvent.press(s.getByTestId('work-hours-end'));
    await spin(s, 0, 9, 24);
    s.getByTestId('work-hours-error');
    await fireEvent.press(footer(s)[0]);
    expect(useAppStore.getState().settings.workHours).toBeUndefined();
    await spin(s, 0, 17, 24);
    expect(s.queryByTestId('work-hours-error')).toBeNull();
    for (const d of [1, 2, 3, 4, 5]) await fireEvent.press(day(s, d));
    expect(s.getByTestId('work-hours-days-error').props.children).toBe('Нужен хотя бы один день');
    await fireEvent.press(footer(s)[0]);
    expect(useAppStore.getState().settings.workHours).toBeUndefined();
    expect(useSheetStore.getState().content).not.toBeNull();
  });
});

describe('«Аккаунт» и «Данные»', () => {
  test('гость: «Войти» и «Создать аккаунт» строками', async () => {
    const q = await section('account');
    q.getByTestId('settings-sign-in');
    q.getByTestId('settings-sign-up');
    expect(q.queryByTestId('settings-sign-out')).toBeNull();
  });

  test('вошедший: «Имя ›» со значением-именем, пароль, синхронизация, выход; почта — в строке аккаунта', async () => {
    useAuthStore.setState({ status: 'signedIn', user: USER });
    const q = await section('account');
    within(q.getByTestId('settings-name')).getByText(t('ru', 'profile.name_label'));
    expect(q.getByTestId('settings-name-value').props.children).toBe(USER.name);
    expect(q.queryByTestId('settings-profile')).toBeNull();
    within(q.getByTestId('settings-accounts')).getByText(USER.email);
    q.getByTestId('settings-password');
    q.getByText(t('ru', 'sync.toggle_label'));
    await fireEvent.press(q.getByTestId('settings-sign-out'));
    expect(useAuthStore.getState().signOut).toHaveBeenCalled();
  });

  test('без имени — «Не указано», как на вебе', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { ...USER, name: '' } });
    const q = await section('account');
    expect(q.getByTestId('settings-name-value').props.children).toBe(t('ru', 'profile.no_name'));
  });

  test('«Имя ›» — лист только с полем имени и «Сохранить»; сохраняет без подтверждения', async () => {
    const updateName = jest.fn(async (name) => ({ ok: true, user: { ...USER, name } }));
    useAuthStore.setState({ status: 'signedIn', user: USER, updateName });
    const q = await section('account');
    await fireEvent.press(q.getByTestId('settings-name'));
    const s = await render(<BottomSheet />);
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'profile.name_label'));
    const field = s.getByTestId('profile-name');
    expect(field.props.value).toBe(USER.name);
    // Ничего, кроме поля: ни почты, ни пароля, ни выхода, ни удаления.
    for (const key of ['profile.change_password', 'auth.sign_out', 'account.delete']) expect(s.queryByText(t('ru', key))).toBeNull();
    expect(s.queryByText(USER.email)).toBeNull();
    const save = () => within(s.getByTestId('sheet-footer-content')).getByTestId('primary-button');
    // Имя не менялось — сохранять нечего.
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(field, '  Анна  ');
    await act(async () => { fireEvent.press(save()); });
    expect(updateName).toHaveBeenCalledWith('Анна');
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'profile.name_updated'));
    expect(useSheetStore.getState().content).toBeNull();
  });

  test('имя не сохранилось — тост об ошибке, лист остаётся', async () => {
    const updateName = jest.fn(async () => ({ ok: false }));
    useAuthStore.setState({ status: 'signedIn', user: USER, updateName });
    const q = await section('account');
    await fireEvent.press(q.getByTestId('settings-name'));
    const s = await render(<BottomSheet />);
    await fireEvent.changeText(s.getByTestId('profile-name'), 'Анна');
    await act(async () => { fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByTestId('primary-button')); });
    expect(useAppStore.getState().toastMessage).toBe(t('ru', 'profile.update_failed'));
    expect(useSheetStore.getState().content).not.toBeNull();
  });

  test('«Данные»: экспорт в Excel; «Удалить аккаунт» — подтверждение без шага «назад» к профилю', async () => {
    useAuthStore.setState({ status: 'signedIn', user: USER });
    const q = await section('data');
    q.getByTestId('settings-export');
    await fireEvent.press(q.getByTestId('settings-delete-account'));
    const s = await render(<BottomSheet />);
    s.getByText(t('ru', 'account.delete_title'));
    s.getByText(t('ru', 'account.delete_confirm'));
    expect(s.queryByLabelText(t('ru', 'common.back'))).toBeNull();
  });

  test('«Данные» у гостя — без удаления аккаунта', async () => {
    const q = await section('data');
    q.getByTestId('settings-export');
    expect(q.queryByTestId('settings-delete-account')).toBeNull();
  });
});

describe('«О приложении»', () => {
  test('версия, документы и блог', async () => {
    const q = await section('about');
    q.getByTestId('settings-version');
    q.getByText(t('ru', 'about.privacy'));
    q.getByText(t('ru', 'about.terms'));
    q.getByText(t('ru', 'about.blog'));
  });
});

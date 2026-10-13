// Название страницы — одно на корневые вкладки и экраны стека
// (components/AppHeader.js: screenTitleStyle, components/TabHeader.js).
// Запуск: npm run test:mobile
//
// «Уведомления» открываются поверх вкладки, и название на них было мельче и
// тоньше, чем у «Проектов» и «Задач» (20 обычным против 22 жирным). Теперь
// размер и начертание берутся из одной функции, а середина строки шапки стоит
// на той же высоте, что у шапки вкладки. Тест гоняет настоящий навигатор
// Android и настоящие экраны: проверяется применение правила, а не его пересказ.
import { Platform, StyleSheet } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import MainTabs from '../src/navigation/MainTabs.android';
import AppHeader, { StackTitle, screenTitleStyle } from '../src/components/AppHeader';
import TabHeader, { headerHeight } from '../src/components/TabHeader';
import { detailScreens } from '../src/navigation/detailScreens';
import { leftTitleOptions } from '../src/navigation/nativeHeader';
import { useAppStore } from '../src/store/useAppStore';
import { colors, displayFamily } from '../src/theme';
import { t } from '../src/lib/i18n';

// Редактор документа — WebView, у него в Node нет нативной части.
jest.mock('../src/components/DocEditor', () => () => null);

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const TITLE = { fontSize: 22, fontFamily: displayFamily.bold };

let os;
beforeEach(() => {
  os = jest.replaceProperty(Platform, 'OS', 'android');
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});
afterEach(() => os.restore());

test('screenTitleStyle: 22, фирменный жирный, цвет текста', () => {
  expect(screenTitleStyle(colors)).toEqual({ color: colors.text, ...TITLE });
});

describe('название страницы тем же стилем: вкладка, экран стека, нативная шапка', () => {
  const stackHeader = (title) => (
    <AppHeader navigation={{ goBack: jest.fn() }} route={{ name: 'Notifications' }} options={{ title }} back={{ title: '' }} />
  );

  test('AppHeader, StackTitle и TabHeader — один размер, начертание и цвет', async () => {
    const stack = await render(stackHeader('Уведомления'));
    const stackTitle = flat(stack.getByText('Уведомления'));
    const native = await render(<StackTitle text="Теги" />);
    const nativeTitle = flat(native.getByText('Теги'));
    const tab = await render(<TabHeader title="Проекты" />);
    const tabTitle = flat(tab.getByText('Проекты'));

    for (const title of [stackTitle, nativeTitle, tabTitle]) {
      expect(title).toMatchObject({ color: colors.text, ...TITLE });
    }
  });

  test('середина строки шапки стека стоит на той же высоте, что у шапки вкладки', async () => {
    const stack = await render(stackHeader('Уведомления'));
    const row = flat(stack.getByTestId('app-header-row'));
    // Содержимое центрируется в строке без верхнего поля: центр — поле + половина остатка.
    const center = (row.paddingTop || 0) + (row.height - (row.paddingTop || 0)) / 2;
    // У шапки вкладки: поле 8, кнопка 36, поле 8 — центр на половине её высоты.
    expect(center).toBe(headerHeight(0) / 2);
    // Поля по бокам те же.
    const tab = await render(<TabHeader title="Проекты" />);
    const wrap = flat(tab.getByText('Проекты').parent.parent);
    expect(row.paddingHorizontal).toBe(wrap.paddingHorizontal);
  });
});

describe('экраны стека поверх вкладки', () => {
  const screens = () => detailScreens({ Screen: 'Screen' }, 'ru');
  const optionsOf = (name) => screens().find((el) => el.props.name === name).props.options;

  test('«Уведомления» — те же опции шапки, что у «Тегов», «Документов» и «Статусов»', () => {
    const own = leftTitleOptions(t('ru', 'notif.title'));
    expect(optionsOf('Notifications')).toEqual(own);
    // Ни своей шапки, ни спрятанной нативной: тот же AppHeader, что у соседей.
    for (const name of ['Documents', 'Tags', 'ProjectStatuses']) {
      expect(Object.keys(optionsOf(name))).toEqual(Object.keys(optionsOf('Notifications')));
    }
    expect(optionsOf('Notifications')).not.toHaveProperty('header');
    expect(optionsOf('Notifications')).not.toHaveProperty('headerShown');
  });

  test('открытые колокольчиком «Уведомления» — название как у вкладки и рабочая «назад»', async () => {
    const nav = createNavigationContainerRef();
    const screen = await render(<NavigationContainer ref={nav}><MainTabs /></NavigationContainer>);
    const header = screen.getByTestId('root-header');
    await within(header).findByRole('button', { name: t('ru', 'search.placeholder') });
    // Название вкладки, как оно стоит до перехода.
    const tabTitle = flat(within(header).getByText(t('ru', 'nav.projects')));

    await fireEvent.press(within(header).getByRole('button', { name: t('ru', 'notif.title') }));
    await screen.findByText(t('ru', 'notif.empty'));
    // Название на странице одно (своего заголовка у экрана нет) и стиль вкладки.
    const stackTitle = flat(screen.getByText(t('ru', 'notif.title')));
    expect(stackTitle).toMatchObject({ color: tabTitle.color, fontSize: tabTitle.fontSize, fontFamily: tabTitle.fontFamily });
    expect(stackTitle.fontSize).toBe(22);

    // «Назад» на месте и возвращает на вкладку.
    await fireEvent.press(screen.getByRole('button', { name: t('ru', 'common.back') }));
    await within(header).findByRole('button', { name: t('ru', 'search.placeholder') });
    expect(screen.queryByText(t('ru', 'notif.empty'))).toBeNull();
  });
});

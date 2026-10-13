// Шапка корневых вкладок стоит на месте и не моргает при смене вкладки
// (components/TabHeader.js: RootHeaderHost, navigation/rootHeaderLayout.js).
// Запуск: npm run test:mobile
//
// Раньше шапка жила внутри экрана вкладки и уезжала вместе со страницей.
// Теперь она одна над навигатором: под содержимым лежит один слой фона
// (`root-header-bg`) и одна строка содержимого (`root-header-content`),
// которые при смене вкладки не меняются — без растворения и сдвига самих
// слоёв; сменяется то, что в строке (название — каплей, кнопки — по месту;
// жидкость шапки держит headerLiquid.test.js). Тест гоняет настоящий
// навигатор Android (MainTabs.android.js, настоящие экраны и стор):
// проверяется применение правила, а не его пересказ.
import { Platform, StyleSheet, Text } from 'react-native';
import { render, fireEvent, act, within, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import * as Reanimated from 'react-native-reanimated';
import MainTabs from '../src/navigation/MainTabs.android';
import { LegacyMiniPlayerLayout } from '../src/navigation/MainTabs.ios';
import TabHeader, { HeaderButton, RootHeaderHost, headerHeight } from '../src/components/TabHeader';
import { withTabPage } from '../src/components/TabSlide';
import { TasksSkeleton } from '../src/components/Skeleton';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

// Редактор документа — WebView, у него в Node нет нативной части; к шапке
// вкладок он отношения не имеет (как и в TaskDetailScreen.test.js).
jest.mock('../src/components/DocEditor', () => () => null);

const DAY = 86_400_000;
const task = (id, title, extra) => ({
  id, projectId: 'p1', title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: new Date().toISOString(), ...extra,
});

let os;
beforeEach(() => {
  // Корень вкладки на Android — без въезда, как на iOS; шапку это не касается.
  os = jest.replaceProperty(Platform, 'OS', 'android');
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [task('t1', 'Вёрстка'), task('t2', 'Правки')],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});
afterEach(() => os.restore());

const tabButton = (screen, key) => screen.getByRole('button', { name: t('ru', key) });
const btn = (scope, key) => scope.getByRole('button', { name: t('ru', key) });
const noBtn = (scope, key) => expect(scope.queryByRole('button', { name: t('ru', key) })).toBeNull();
/** Ждёт кнопку: пока экран вкладки строится, в шапке стоит одно название. */
const waitBtn = (scope, key) => scope.findByRole('button', { name: t('ru', key) });
/** Ждёт, пока «Задачи» построятся: у шапки появляется число открытых (две). Пока
 *  экран строится, в шапке стоят кнопки прежней вкладки, и не нажимаются. */
const tasksBuilt = (header) => waitFor(() => within(header).getByText('2'));

/** Приложение с общей шапкой; ждёт, пока первая вкладка построится целиком. */
async function openApp() {
  const nav = createNavigationContainerRef();
  const screen = await render(<NavigationContainer ref={nav}><MainTabs /></NavigationContainer>);
  const header = screen.getByTestId('root-header');
  await waitBtn(within(header), 'search.placeholder');
  return { screen, header, nav };
}

/** Предки узла от него самого вверх. */
const above = (node) => { const out = []; for (let n = node; n; n = n.parent) out.push(n); return out; };
const typesAbove = (node) => above(node).map((n) => n.type);
/** Ближайший общий предок двух узлов. */
const commonAncestor = (a, b) => { const up = above(b); return above(a).find((n) => up.includes(n)); };
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
/** Пустое место под шапку в страницах вкладок: View данной высоты внутри экрана навигатора. */
const spacers = (root, height) => root.queryAll((n) => n.type === 'View' && flat(n).height === height && typesAbove(n).includes('RNSScreen'));
/** Своя шапка экрана вкладки в странице (рисуется, пока поверх открыты детали). */
const ownHeaders = (screen) => screen.queryAllByTestId('tab-header-own', { includeHiddenElements: true });
/** Растворения шапки (бывшие 150 мс) нет: других длительностей не касаемся — у
 *  панели вкладок свои. Сами слои шапки при этом без непрозрачности и сдвига. */
const fadeCalls = (spy) => spy.mock.calls.filter(([, config]) => config && config.duration === 150);
const layoutOf = (height) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });

test('шапка стоит над навигатором, а не внутри пролистываемой страницы', async () => {
  const { header } = await openApp();
  const title = within(header).getByText(t('ru', 'nav.projects'));
  // Среди предков заголовка нет ни страницы вкладки, ни контейнера экранов:
  // страницы — соседи шапки, и листает их навигатор.
  expect(typesAbove(title)).not.toContain('RNSScreen');
  expect(typesAbove(title)).not.toContain('RNSScreenContainer');
  expect(header.parent.queryAll((n) => n.type === 'RNSScreenContainer')).toHaveLength(1);
  // В самой странице заголовка нет: там только пустое место под шапку.
  const pages = header.parent.queryAll((n) => n.type === 'RNSScreenContainer')[0];
  expect(within(pages).queryByText(t('ru', 'nav.projects'))).toBeNull();
});

test('место под шапку в странице и сама шапка одной высоты, и она та же, что без хоста', async () => {
  const { screen } = await openApp();
  expect(spacers(screen.container, headerHeight(0))).toHaveLength(1);
  expect(flat(screen.getByTestId('root-header')).height).toBe(headerHeight(0));
  // Вне хоста (экран сам по себе) шапка в странице той же высоты — в покое ничего не изменилось.
  const alone = await render(<TabHeader title="Задачи" />);
  expect(StyleSheet.flatten(alone.toJSON().props.style).minHeight).toBe(headerHeight(0));
  expect(headerHeight(0)).toBe(52);
});

test('смена вкладки: тот же экземпляр шапки, заголовок и кнопки — новой вкладки', async () => {
  const { screen, header } = await openApp();
  // «Проекты»: лупа и колокольчик.
  btn(within(header), 'search.placeholder');
  btn(within(header), 'notif.title');

  await fireEvent.press(tabButton(screen, 'nav.home'));
  await waitBtn(within(header), 'agenda.new_entry');
  // «Сегодня»: «+», календарь, переключатель вида; ни лупы, ни колокольчика, ни прежнего заголовка.
  within(header).getByText(t('ru', 'nav.home'));
  btn(within(header), 'today.pick_day');
  noBtn(within(header), 'notif.title');
  noBtn(within(header), 'search.placeholder');
  expect(within(header).queryByText(t('ru', 'nav.projects'))).toBeNull();

  await fireEvent.press(tabButton(screen, 'nav.stats'));
  await waitBtn(within(header), 'menu.export_excel');
  within(header).getByText(t('ru', 'nav.stats'));
  btn(within(header), 'filter.project');
  expect(within(header).queryByText(t('ru', 'nav.home'))).toBeNull();

  await fireEvent.press(tabButton(screen, 'nav.menu'));
  await waitBtn(within(header), 'notif.title');
  within(header).getByText(t('ru', 'nav.menu'));

  // Всё это время шапка — один и тот же элемент: не пересоздавалась.
  expect(screen.getByTestId('root-header')).toBe(header);
});

test('смена вкладки: фон и строка шапки — те же слои и не меняются, содержимое меняется сразу, растворения нет', async () => {
  const withTiming = jest.spyOn(Reanimated, 'withTiming');
  const { screen, header } = await openApp();
  const bg = screen.getByTestId('root-header-bg');
  const bgStyle = flat(bg);
  // Фон лежит в шапке первым и один: под ним и над ним других слоёв фона нет.
  expect(header.children[0]).toBe(bg);
  expect(header.queryAll((n) => n.props.testID === 'root-header-bg')).toHaveLength(1);
  const contentBefore = within(header).getByTestId('root-header-content');
  withTiming.mockClear();

  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  // Без ожидания и без findBy: новое содержимое уже на месте, прежнего нет.
  within(header).getByText(t('ru', 'nav.tasks'));
  expect(within(header).queryByText(t('ru', 'nav.projects'))).toBeNull();
  // Строка содержимого — та же: на ней не мигает ни фон, ни кнопки, что остаются.
  const contentAfter = within(header).getByTestId('root-header-content');
  expect(contentAfter).toBe(contentBefore);

  // Фон — тот же экземпляр, стиль прежний, непрозрачность и сдвиг не заданы вовсе.
  expect(screen.getByTestId('root-header-bg')).toBe(bg);
  expect(header.children[0]).toBe(bg);
  expect(flat(bg)).toEqual(bgStyle);
  for (const layer of [header, bg, contentBefore, contentAfter]) {
    expect(flat(layer).opacity).toBeUndefined();
    expect(flat(layer).transform).toBeUndefined();
  }
  // Растворения (бывшие 150 мс) больше нет.
  expect(fadeCalls(withTiming)).toHaveLength(0);

  // Возврат — так же: фон тот же, содержимое прежней вкладки сразу.
  await fireEvent.press(tabButton(screen, 'nav.projects'));
  within(header).getByText(t('ru', 'nav.projects'));
  expect(screen.getByTestId('root-header-bg')).toBe(bg);
  expect(fadeCalls(withTiming)).toHaveLength(0);
  withTiming.mockRestore();
});

test('число рядом с названием и бейдж колокольчика на месте', async () => {
  const { screen, header } = await openApp();
  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  // Две открытые задачи — число рядом с названием (экран строится не мгновенно).
  await waitFor(() => within(header).getByText('2'));
  expect(within(btn(within(header), 'notif.title')).queryByText('1')).toBeNull();
  // Срок вчера: в ленте уведомлений появилось непрочитанное — бейдж на колокольчике.
  await act(() => useAppStore.setState({
    tasks: [task('t1', 'Вёрстка', { dueAt: new Date(Date.now() - DAY).toISOString() }), task('t2', 'Правки')],
  }));
  within(btn(within(header), 'notif.title')).getByText('1');
});

test('кнопки в общей шапке работают: лупа открывает поиск, колокольчик — уведомления', async () => {
  const { screen, header, nav } = await openApp();
  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  await tasksBuilt(header);

  await fireEvent.press(btn(within(header), 'search.placeholder'));
  await screen.findByPlaceholderText(t('ru', 'search.placeholder'));

  await act(() => nav.goBack());
  within(header).getByText(t('ru', 'nav.tasks'));

  await fireEvent.press(btn(within(header), 'notif.title'));
  await screen.findByText(t('ru', 'notif.empty'));
});

test('детали поверх вкладки: общая шапка спрятана целиком и сразу, а экран вкладки под ними рисует свою', async () => {
  const withTiming = jest.spyOn(Reanimated, 'withTiming');
  const { screen, header, nav } = await openApp();
  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  await tasksBuilt(header);
  const bg = screen.getByTestId('root-header-bg');
  // В покое своей шапки в странице нет — там пустое место.
  expect(ownHeaders(screen)).toHaveLength(0);
  expect(flat(header).display).toBeUndefined();
  // Пустое место есть у каждой построенной страницы — «Проекты» и «Задачи».
  const slots = spacers(screen.container, headerHeight(0)).length;
  expect(slots).toBe(2);
  withTiming.mockClear();

  await fireEvent.press(btn(within(header), 'search.placeholder'));
  await screen.findByPlaceholderText(t('ru', 'search.placeholder'));
  // Общая шапка: ни содержимого, ни фона на виду (у деталей своя шапка в стеке),
  // и спрятана она сразу — без растворения.
  expect(flat(header).display).toBe('none');
  expect(header.queryAll((n) => n.props.testID === 'root-header-content')).toHaveLength(0);
  expect(fadeCalls(withTiming)).toHaveLength(0);
  // Экран вкладки под деталью с шапкой: на жесте «назад» он выезжает не голым.
  const [own] = ownHeaders(screen);
  // Экран под деталью система прячет от чтения с экрана — поэтому и запросы «в том числе скрытое».
  const hidden = { includeHiddenElements: true };
  within(own).getByText(t('ru', 'nav.tasks'), hidden);
  within(own).getByText('2', hidden);
  within(own).getByRole('button', { name: t('ru', 'search.placeholder'), ...hidden });
  within(own).getByRole('button', { name: t('ru', 'notif.title'), ...hidden });
  // Её пустого места уже нет — осталось только у «Проектов».
  expect(spacers(screen.container, headerHeight(0))).toHaveLength(slots - 1);

  // Возврат: в той же отрисовке своя шапка уходит, а общая встаёт на место —
  // тот же экземпляр фона, никакого растворения.
  await act(() => nav.goBack());
  expect(ownHeaders(screen)).toHaveLength(0);
  expect(flat(header).display).toBeUndefined();
  within(header).getByText(t('ru', 'nav.tasks'));
  btn(within(header), 'search.placeholder');
  expect(screen.getByTestId('root-header-bg')).toBe(bg);
  expect(spacers(screen.container, headerHeight(0))).toHaveLength(slots);
  expect(fadeCalls(withTiming)).toHaveLength(0);
  withTiming.mockRestore();

  // Колокольчик ведёт так же.
  await fireEvent.press(btn(within(header), 'notif.title'));
  await screen.findByText(t('ru', 'notif.empty'));
  expect(flat(header).display).toBe('none');
  expect(ownHeaders(screen)).toHaveLength(1);
});

test('крупный системный шрифт: шапка выше 52 — пустое место и шапка берут замеренную высоту', async () => {
  const { screen, header } = await openApp();
  const content = within(header).getByTestId('root-header-content');
  // Шапка растёт по minHeight, а не прибита к 52.
  expect(flat(content).height).toBeUndefined();
  expect(flat(content).minHeight).toBe(headerHeight(0));
  expect(spacers(screen.container, 52)).toHaveLength(1);

  // Заголовок на Android ×2 вырос: onLayout отдал шапке 96.
  await fireEvent(content, 'layout', layoutOf(96));
  expect(flat(header).height).toBe(96);
  expect(spacers(screen.container, 96)).toHaveLength(1);
  expect(spacers(screen.container, 52)).toHaveLength(0);

  // Вкладка, которую ещё не показывали, берёт наибольший из известных замеров —
  // первая строка не наезжает под шапку, пока та не измерена.
  await fireEvent.press(tabButton(screen, 'nav.tasks'));
  expect(flat(header).height).toBe(96);
  expect(spacers(screen.container, 96)).toHaveLength(2);
  // Дальше у неё свой замер.
  await fireEvent(within(header).getByTestId('root-header-content'), 'layout', layoutOf(80));
  expect(flat(header).height).toBe(80);
  expect(spacers(screen.container, 80)).toHaveLength(1);
  // Дробные доли замера высоту не дёргают.
  await fireEvent(within(header).getByTestId('root-header-content'), 'layout', layoutOf(80.2));
  expect(flat(header).height).toBe(80);

  // Прежняя вкладка помнит свой замер.
  await fireEvent.press(tabButton(screen, 'nav.projects'));
  expect(flat(header).height).toBe(96);
});

/** Экран вкладки для проверок отдачи шапки хосту: Probe считает, сколько раз
 *  хост перерисовывал кнопки — они отрисуются заново, только если хост получил
 *  новое содержимое. */
function Probe({ onRender }) {
  onRender();
  return null;
}
function hostedPage(tab = 'Tasks') {
  return withTabPage(({ title, label, onPress, onRender, tick }) => (
    <>
      <TabHeader title={title} count={2}>
        <HeaderButton icon="search" label={label} onPress={onPress} />
        <Probe onRender={onRender} />
      </TabHeader>
      <Text>{`тик ${tick}`}</Text>
    </>
  ), tab);
}
const hosted = (Page, props) => (
  <RootHeaderHost tab="Tasks" hidden={false}><Page {...props} /></RootHeaderHost>
);

test('повторная отрисовка экрана с теми же данными не трогает шапку хоста; обработчики при этом свежие', async () => {
  const Page = hostedPage();
  const first = jest.fn();
  const second = jest.fn();
  const renders = jest.fn();
  const base = { title: 'Задачи', label: 'Поиск', onPress: first, onRender: renders, tick: 0 };
  const screen = await render(hosted(Page, base));
  const header = screen.getByTestId('root-header');
  within(header).getByText('Задачи');
  const drawn = renders.mock.calls.length;
  expect(drawn).toBeGreaterThan(0);

  // Тикает таймер на экране: тот же заголовок, число и кнопки, новые функции.
  for (let tick = 1; tick <= 3; tick += 1) {
    await screen.rerender(hosted(Page, { ...base, tick, onPress: tick === 3 ? second : () => first(), onRender: () => renders() }));
  }
  screen.getByText('тик 3');
  expect(renders.mock.calls.length).toBe(drawn);
  // Кнопка зовёт обработчик последней отрисовки, а не первой.
  await fireEvent.press(within(header).getByRole('button', { name: 'Поиск' }));
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();

  // Изменилась подпись кнопки — хост получает новое содержимое.
  await screen.rerender(hosted(Page, { ...base, tick: 4, label: 'Найти', onPress: second }));
  within(header).getByRole('button', { name: 'Найти' });
  expect(within(header).queryByRole('button', { name: 'Поиск' })).toBeNull();
  const afterLabel = renders.mock.calls.length;
  expect(afterLabel).toBeGreaterThan(drawn);

  // И заголовок.
  await screen.rerender(hosted(Page, { ...base, tick: 5, title: 'Дела', label: 'Найти', onPress: second }));
  within(header).getByText('Дела');
  expect(within(header).queryByText('Задачи')).toBeNull();
  expect(renders.mock.calls.length).toBeGreaterThan(afterLabel);
});

test('первый заход на вкладку: пока строится экран, в шапке сразу настоящее название, а полос и пульса в шапке нет', async () => {
  const Page = withTabPage(({ onPress }) => (
    <TabHeader title={t('ru', 'nav.tasks')} count={2}><HeaderButton icon="search" label="Поиск" onPress={onPress} /></TabHeader>
  ), 'Tasks', TasksSkeleton);
  // Заглушка сама по себе (вне хоста): название — настоящая шапка, полос и пульса в ней нет,
  // а пульсирует только содержимое страницы под ней.
  const alone = await render(<TasksSkeleton />);
  const own = alone.getByTestId('skeleton-header');
  within(own).getByText(t('ru', 'nav.tasks'));
  expect(within(own).queryAllByTestId('skeleton')).toHaveLength(0);
  expect(alone.queryAllByTestId('skeleton').length).toBeGreaterThan(0);

  const screen = await render(hosted(Page, { onPress: jest.fn() }));
  const header = screen.getByTestId('root-header');
  // Экран ещё не построен: заглушка на месте, а шапка уже подписана — без кнопок и числа.
  expect(within(header).queryByRole('button', { name: 'Поиск' })).toBeNull();
  within(header).getByText(t('ru', 'nav.tasks'));
  expect(within(header).queryAllByTestId('skeleton')).toHaveLength(0);
  expect(screen.queryByTestId('skeleton-header')).toBeNull();
  expect(screen.queryAllByTestId('skeleton').length).toBeGreaterThan(0);
  // Пустое место под шапку в странице есть.
  expect(screen.container.queryAll((n) => n.type === 'View' && flat(n).height === headerHeight(0))
    .filter((n) => !above(n).includes(header))).toHaveLength(1);

  // Экран построился: название то же, на месте, дальше приехали кнопки и число.
  await within(header).findByRole('button', { name: 'Поиск' });
  within(header).getByText(t('ru', 'nav.tasks'));
  within(header).getByText('2');
});

test('iOS ниже 26: layout навигатора тоже держит общую шапку, страницы въезжают без неё', async () => {
  os.restore(); // страница вкладки на iOS въезжает (IosTabPage) — это и проверяем
  const onSearch = jest.fn();
  const pageOf = (tab, title, label) => withTabPage(() => (
    <>
      <TabHeader title={title}><HeaderButton icon="search" label={label} onPress={onSearch} /></TabHeader>
      <Text>{`страница ${title}`}</Text>
    </>
  ), tab);
  const Projects = pageOf('Projects', 'Проекты', 'Поиск проектов');
  const Tasks = pageOf('Tasks', 'Задачи', 'Поиск задач');
  const routes = ['Projects', 'Tasks'].map((name) => ({ key: name, name }));
  const descriptors = Object.fromEntries(routes.map((r) => [r.key, { options: {} }]));
  const at = (index) => (
    <LegacyMiniPlayerLayout state={{ index, routes }} descriptors={descriptors} navigation={{ navigate: jest.fn() }}>
      <Projects />
      <Tasks />
    </LegacyMiniPlayerLayout>
  );
  const screen = await render(at(0));
  const header = screen.getByTestId('root-header');
  const bg = screen.getByTestId('root-header-bg');
  await within(header).findByText('Проекты');
  within(header).getByRole('button', { name: 'Поиск проектов' });
  // Страницы смонтированы обе, а шапка — одна и вне них: с содержимым страницы
  // заголовок встречается только в корне layout, где лежит и сама шапка.
  const page = screen.getByText('страница Проекты');
  screen.getByText('страница Задачи');
  expect(commonAncestor(within(header).getByText('Проекты'), page)).toBe(header.parent);

  await screen.rerender(at(1));
  // Сразу: без ожидания растворения.
  const search = within(header).getByRole('button', { name: 'Поиск задач' });
  within(header).getByText('Задачи');
  expect(within(header).queryByText('Проекты')).toBeNull();
  expect(screen.getByTestId('root-header')).toBe(header);
  // Общий статичный слой фона — тот же экземпляр, без прозрачности и сдвига.
  expect(screen.getByTestId('root-header-bg')).toBe(bg);
  expect(flat(bg).opacity).toBeUndefined();
  expect(flat(bg).transform).toBeUndefined();
  // Кнопка из общей шапки зовёт обработчик экрана.
  await fireEvent.press(search);
  expect(onSearch).toHaveBeenCalledTimes(1);
});

// Заглушки грузят только содержимое страницы (components/Skeleton.js).
// Запуск: npm run test:mobile
//
// Шапка (название вкладки и кнопки) и нижняя панель вкладок у всех экранов
// одни и те же и уже готовы: ни при запуске, ни при первом заходе на вкладку
// они не полосы и не пульсируют. Пульс — Skeleton с testID `skeleton`; в шапке
// и панели его быть не должно, а в содержимом — должен. iOS 26 — отдельный
// файл, skeleton.ios26.test.js.
import { render, within } from '@testing-library/react-native';
import { AppSkeleton, ProjectsSkeleton, TasksSkeleton, TodaySkeleton, StatsSkeleton, MenuSkeleton } from '../src/components/Skeleton';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const TAB_KEYS = ['nav.projects', 'nav.tasks', 'nav.home', 'nav.stats', 'nav.menu'];

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' } });
});

describe('запуск: AppSkeleton', () => {
  test('шапка — настоящее название «Проектов», полос и пульса в ней нет', async () => {
    const screen = await render(<AppSkeleton />);
    const header = screen.getByTestId('skeleton-header');
    within(header).getByText(t('ru', 'nav.projects'));
    expect(within(header).queryAllByTestId('skeleton')).toHaveLength(0);
  });

  test('панель вкладок — настоящая: все подписи, плашка выбранной, пульса нет', async () => {
    const screen = await render(<AppSkeleton />);
    const bar = screen.getByTestId('skeleton-tab-bar');
    for (const key of TAB_KEYS) within(bar).getByText(t('ru', key));
    // Это сама панель приложения (MainTabBar), а не её копия из полос.
    within(bar).getByTestId('tab-bar');
    within(bar).getByTestId('tab-bar-plate');
    expect(within(bar).queryAllByTestId('skeleton')).toHaveLength(0);
    // «Проекты» выбраны, как в первый показ.
    expect(within(bar).getByRole('button', { name: t('ru', 'nav.projects') }).props.accessibilityState).toMatchObject({ selected: true });
  });

  test('пульсирует только содержимое страницы: полосы есть, и все вне шапки и панели', async () => {
    const screen = await render(<AppSkeleton />);
    const all = screen.getAllByTestId('skeleton');
    expect(all.length).toBeGreaterThan(10);
    const header = screen.getByTestId('skeleton-header');
    const bar = screen.getByTestId('skeleton-tab-bar');
    for (const node of all) {
      for (let n = node.parent; n; n = n.parent) expect([header, bar]).not.toContain(n);
    }
  });

  test('подписи панели и шапки — на языке стора', async () => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'en' } });
    const screen = await render(<AppSkeleton />);
    within(screen.getByTestId('skeleton-header')).getByText(t('en', 'nav.projects'));
    for (const key of TAB_KEYS) within(screen.getByTestId('skeleton-tab-bar')).getByText(t('en', key));
  });

  test('панель запуска ничего не нажимает: навигатора ещё нет', async () => {
    const screen = await render(<AppSkeleton />);
    expect(screen.getByTestId('skeleton-tab-bar').props.pointerEvents).toBe('none');
  });
});

describe.each([
  ['«Проекты»', ProjectsSkeleton, 'nav.projects'],
  ['«Задачи»', TasksSkeleton, 'nav.tasks'],
  ['«Сегодня»', TodaySkeleton, 'nav.home'],
  ['«Цифры»', StatsSkeleton, 'nav.stats'],
  ['«Меню»', MenuSkeleton, 'nav.menu'],
])('заглушка вкладки %s', (_name, Sk, titleKey) => {
  test('название в шапке настоящее, полос и пульса в шапке нет, содержимое пульсирует', async () => {
    const screen = await render(<Sk />);
    const header = screen.getByTestId('skeleton-header');
    within(header).getByText(t('ru', titleKey));
    expect(within(header).queryAllByTestId('skeleton')).toHaveLength(0);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(3);
    // Нижней панели в заглушке вкладки нет: она настоящая и стоит в навигаторе.
    expect(screen.queryByTestId('skeleton-tab-bar')).toBeNull();
    expect(screen.queryByTestId('tab-bar')).toBeNull();
  });
});

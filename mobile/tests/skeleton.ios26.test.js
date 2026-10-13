// Заглушки на iOS 26+ (components/Skeleton.js). Запуск: npm run test:mobile
//
// Там шапка вкладок нативная и уже стоит над экраном: заглушка вкладки своей
// шапки не рисует. Исключение — запуск (AppSkeleton): навигатора ещё нет, и
// название стоит настоящей шапкой в странице — как и прежде. Пульса в шапке и
// панели нет и там.
import { render, within } from '@testing-library/react-native';
import { AppSkeleton, TasksSkeleton } from '../src/components/Skeleton';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

jest.mock('../src/navigation/nativeHeader', () => ({
  ...jest.requireActual('../src/navigation/nativeHeader'),
  IOS_NATIVE_HEADER: true,
}));

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru' } });
});

test('заглушка вкладки: шапки нет вовсе, нативная уже над экраном; содержимое пульсирует', async () => {
  const screen = await render(<TasksSkeleton />);
  expect(screen.queryByTestId('skeleton-header')).toBeNull();
  expect(screen.queryByText(t('ru', 'nav.tasks'))).toBeNull();
  expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(3);
});

test('запуск: название «Проектов» — настоящая шапка, панель — настоящая, пульса в них нет', async () => {
  const screen = await render(<AppSkeleton />);
  const header = screen.getByTestId('skeleton-header');
  within(header).getByText(t('ru', 'nav.projects'));
  expect(within(header).queryAllByTestId('skeleton')).toHaveLength(0);
  const bar = screen.getByTestId('skeleton-tab-bar');
  within(bar).getByText(t('ru', 'nav.stats'));
  expect(within(bar).queryAllByTestId('skeleton')).toHaveLength(0);
});

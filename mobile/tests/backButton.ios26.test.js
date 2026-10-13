// «Назад» на iOS 26+ (navigation/nativeHeader.js, components/DetailHeader.js).
// Запуск: npm run test:mobile
//
// Там шапка нативная, со стеклом: «назад» рисует система, и своей подложки у
// неё быть не должно — ни у шапки стека, ни у шапки задачи. Версия системы
// подменяется до загрузки nativeHeader (она читает её один раз, при загрузке),
// поэтому модули берутся через require после подмены, а не import сверху.
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { colors } from '../src/theme';

jest.replaceProperty(Platform, 'OS', 'ios');
jest.spyOn(Platform, 'Version', 'get').mockReturnValue(26);

const { IOS_NATIVE_HEADER, stackHeaderOptions } = require('../src/navigation/nativeHeader');
const DetailHeader = require('../src/components/DetailHeader').default;

const mockNavigation = { setOptions: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

beforeEach(() => mockNavigation.setOptions.mockClear());

test('iOS 26+: шапка нативная', () => {
  expect(IOS_NATIVE_HEADER).toBe(true);
});

test('шапка стека — системная: своей AppHeader (а с ней и подложки под «назад») нет, стрелка — наша картинка', () => {
  const options = stackHeaderOptions(colors);
  expect(options.header).toBeUndefined();
  expect(options.headerBackIcon).toBeDefined();
  expect(options.headerBackVisible).not.toBe(false);
});

test('шапка задачи ничего не рисует сама: «назад» — системная, без подложки', async () => {
  const onBack = jest.fn();
  const screen = await render(<DetailHeader onBack={onBack} backLabel="Назад" title="Сайт" sub="Вёрстка" />);
  expect(screen.toJSON()).toBeNull();
  expect(screen.queryByLabelText('Назад')).toBeNull();
  const options = mockNavigation.setOptions.mock.calls.at(-1)[0];
  expect(options.headerBackVisible).toBe(true);
});

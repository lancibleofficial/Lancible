// Шапка задачи на iOS 26+ (components/DetailHeader.js). Запуск: npm run test:mobile
//
// Нативная шапка встречает каждое обновление опций пересозданием всех
// кнопок — стекло при этом моргает. Раньше часы идущего таймера уходили в
// опции, и шапка обновлялась каждую секунду. Теперь часы тикают сами, а
// опции меняются, только когда меняется то, что в шапке видно.
import { render } from '@testing-library/react-native';
import DetailHeader, { DetailButton } from '../src/components/DetailHeader';

jest.mock('../src/navigation/nativeHeader', () => ({
  ...jest.requireActual('../src/navigation/nativeHeader'),
  IOS_NATIVE_HEADER: true,
}));
const mockNavigation = { setOptions: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

beforeEach(() => mockNavigation.setOptions.mockClear());

const header = (props) => (
  <DetailHeader
    color="#87ff65"
    title="Сайт"
    sub="В работе"
    running
    runSince={1_000_000}
    right={<DetailButton icon="check" label="Готово" onPress={() => {}} />}
    {...props}
  />
);

test('идущий таймер не обновляет шапку каждую секунду', async () => {
  const screen = await render(header());
  expect(mockNavigation.setOptions).toHaveBeenCalledTimes(1);
  // Экран задачи перерисовывается раз в секунду — шапка остаётся прежней.
  await screen.rerender(header());
  await screen.rerender(header());
  expect(mockNavigation.setOptions).toHaveBeenCalledTimes(1);
  // А то, что в шапке видно, по-прежнему до неё доходит.
  await screen.rerender(header({ sub: 'Готово' }));
  expect(mockNavigation.setOptions).toHaveBeenCalledTimes(2);
});

test('часы в крошке считают от начала записи сами', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 65_000);
  await render(header());
  const [crumb] = mockNavigation.setOptions.mock.calls.at(-1)[0].unstable_headerLeftItems();
  const { getByText } = await render(crumb.element);
  getByText('00:01:05');
  now.mockRestore();
});

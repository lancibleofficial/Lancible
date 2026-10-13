// Стрелка «назад» в шапке — на подложке (components/BackButton.js). Запуск: npm run test:mobile
//
// Раньше «назад» стояла голой стрелкой, а кнопки справа — квадратами на
// подложке. Теперь у шапок стека (AppHeader) и задачи (DetailHeader) она
// такой же квадрат 36, заливка та же, что у HeaderButton, скругление то же
// (headerButtonRadius). Подпись для доступности прежняя. Нативная шапка iOS 26+
// на стекле — отдельный файл, backButton.ios26.test.js.
import { Platform, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import AppHeader from '../src/components/AppHeader';
import DetailHeader, { DetailButton } from '../src/components/DetailHeader';
import BackButton, { BACK_SIZE } from '../src/components/BackButton';
import { HeaderButton } from '../src/components/TabHeader';
import { headerButtonRadius } from '../src/components/Glass';
import { useAppStore } from '../src/store/useAppStore';
import { colors, radius } from '../src/theme';
import { t } from '../src/lib/i18n';

jest.mock('../src/components/DocEditor', () => () => null);

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const BACK = t('ru', 'common.back');
const noop = () => {};

beforeEach(() => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' } });
});

/** Квадрат кнопки и подложка под значком: первый ребёнок кнопки — подложка (GlassBg). */
function parts(button) {
  const plate = button.children.find((c) => c && c.props && StyleSheet.flatten(c.props.style) && StyleSheet.flatten(c.props.style).backgroundColor);
  return { box: flat(button), plate: plate ? flat(plate) : null };
}

const stackHeader = (goBack = jest.fn()) => (
  <AppHeader navigation={{ goBack }} route={{ name: 'Tags' }} options={{ title: 'Теги' }} back={{ title: '' }} />
);
const taskHeader = (onBack = jest.fn()) => <DetailHeader onBack={onBack} backLabel={BACK} title="Сайт" sub="Вёрстка" />;

describe.each([
  ['Android', () => jest.replaceProperty(Platform, 'OS', 'android')],
  ['iOS ниже 26', () => { const os = jest.replaceProperty(Platform, 'OS', 'ios'); const v = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(18); return { restore: () => { os.restore(); v.mockRestore(); } }; }],
])('%s: «назад» на подложке, как кнопки справа', (_name, fake) => {
  let restore;
  beforeEach(() => { restore = fake(); });
  afterEach(() => restore.restore());

  /** Эталон: квадратная кнопка шапки справа. */
  async function reference() {
    const screen = await render(<HeaderButton icon="search" label="Поиск" onPress={noop} />);
    return parts(screen.getByLabelText('Поиск'));
  }

  test('AppHeader: квадрат 36, заливка panel, скругление кнопки шапки; подпись «Назад»', async () => {
    const goBack = jest.fn();
    const screen = await render(stackHeader(goBack));
    const button = screen.getByLabelText(BACK);
    expect(button.props.accessibilityRole).toBe('button');
    const { box, plate } = parts(button);
    expect(box).toMatchObject({ width: BACK_SIZE, height: BACK_SIZE, borderRadius: headerButtonRadius(36, radius.md) });
    expect(plate).toMatchObject({ backgroundColor: colors.panel, borderRadius: box.borderRadius });
    // И по-прежнему возвращает назад (нажатие — до второй отрисовки: она снимает первую).
    await fireEvent.press(button);
    expect(goBack).toHaveBeenCalledTimes(1);
    // Тот же вид, что у кнопки шапки справа: размер, скругление, заливка.
    const ref = await reference();
    expect(box).toMatchObject({ width: ref.box.width, height: ref.box.height, borderRadius: ref.box.borderRadius });
    expect(plate.backgroundColor).toBe(ref.plate.backgroundColor);
  });

  test('DetailHeader: «назад» на той же подложке', async () => {
    const onBack = jest.fn();
    const screen = await render(taskHeader(onBack));
    const button = screen.getByLabelText(BACK);
    const { box, plate } = parts(button);
    expect(box).toMatchObject({ width: 36, height: 36, borderRadius: headerButtonRadius(36, radius.md) });
    expect(plate.backgroundColor).toBe(colors.panel);
    await fireEvent.press(button);
    expect(onBack).toHaveBeenCalledTimes(1);
    // Рядом справа — кнопка DetailButton: у неё та же подложка.
    const right = await render(<DetailButton icon="check" label="Готово" onPress={noop} />);
    const { box: rbox, plate: rplate } = parts(right.getByLabelText('Готово'));
    expect(box).toMatchObject({ width: rbox.width, height: rbox.height, borderRadius: rbox.borderRadius });
    expect(plate.backgroundColor).toBe(rplate.backgroundColor);
  });

  test('шапка стека без «назад» (корневой экран стека) стрелки не рисует', async () => {
    const screen = await render(<AppHeader navigation={{ goBack: noop }} route={{ name: 'Menu' }} options={{ title: 'Меню' }} />);
    expect(screen.queryByLabelText(BACK)).toBeNull();
  });
});

test('BackButton: подпись и действие приходят от шапки, подпись не зашита', async () => {
  const onPress = jest.fn();
  const screen = await render(<BackButton onPress={onPress} label="Back" />);
  await fireEvent.press(screen.getByLabelText('Back'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('«назад» шапки стека стоит на одной высоте с кнопками шапки вкладки: центр строки 26', async () => {
  const screen = await render(stackHeader());
  const row = flat(screen.getByTestId('app-header-row'));
  // Строка 48: верх 4, остальные 44 делятся пополам — центр 4 + 22 = 26, как у кнопки 36 в шапке вкладки (8 + 18).
  expect(row.paddingTop + (row.height - row.paddingTop) / 2).toBe(26);
  expect(row.alignItems).toBe('center');
});

// Метки в листе «Новый проект» (components/NewProjectSheet.js). Запуск: npm run test:mobile
//
// 12 октября 2026: новый проект — как настройки проекта: метки — строкой
// острова «Метки проекта · значение ›» (было: ряд бейджей с «+ теги» прямо в
// форме). Значение — первая метка бейджем (TagBadge) и «+N» или «нет»; тап
// открывает тот же выбор (TagPickerSheet) страницей внутри листа, там бейджи
// с крестиком снимают метку.
import { render, fireEvent, within, act } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

const noop = () => {};

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [],
    tasks: [],
    versions: [],
    tags: [
      { id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null },
      { id: 'g2', name: 'срочно', color: '#ff7a7a', projectId: null },
    ],
  });
});
// Кадр выезда листа не должен выпасть после разбора окружения.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

async function show(props) {
  openSheet(<NewProjectSheet onCreated={noop} onCancel={noop} {...props} />);
  return render(<BottomSheet />);
}

test('меток нет — строка «Метки проекта · нет ›», ряда бейджей и «+ теги» в форме нет', async () => {
  const s = await show();
  const row = s.getByTestId('project-row-marks');
  within(row).getByText(t('ru', 'pdlg.marks_label'));
  within(row).getByText(t('ru', 'common.none_value'));
  expect(row.props.accessibilityRole).toBe('button');
  expect(s.queryByTestId('project-form-tags')).toBeNull();
  expect(s.queryByTestId('project-form-tag-add')).toBeNull();
});

test('выбранные метки — первая бейджем TagBadge и «+N», а не текстом', async () => {
  const s = await show({ initial: { tagIds: ['g1', 'g2'] } });
  const value = s.getByTestId('project-row-marks-value');
  within(value).getByText('клиент');
  within(value).getByText('+1');
  expect(within(value).queryByText('срочно')).toBeNull();
});

test('тап — выбор меток страницей внутри листа; крестик на бейдже там снимает метку; создаётся проект без снятой', async () => {
  const onCreated = jest.fn();
  const s = await show({ initial: { name: 'Сайт', tagIds: ['g1', 'g2'] }, onCreated });
  await fireEvent.press(s.getByTestId('project-row-marks'));
  // Страница выбора: заголовок — название строки, поле поиска; формы под ней нет.
  within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'pdlg.marks_label'));
  s.getByPlaceholderText(t('ru', 'tag.search_ph'));
  expect(s.queryByTestId('project-row-marks')).toBeNull();
  await fireEvent.press(s.getByLabelText('клиент'));
  await fireEvent.press(s.getByLabelText(t('ru', 'common.back')));
  const value = s.getByTestId('project-row-marks-value');
  within(value).getByText('срочно');
  expect(within(value).queryByText('клиент')).toBeNull();
  await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'home.create')));
  expect(onCreated).toHaveBeenCalledTimes(1);
  expect(onCreated.mock.calls[0][0].tagIds).toEqual(['g2']);
  expect(useAppStore.getState().projects[0].tagIds).toEqual(['g2']);
});

test('выбранная на странице метка по возврату — значением строки', async () => {
  const s = await show();
  await fireEvent.press(s.getByTestId('project-row-marks'));
  await fireEvent.press(within(s.getByTestId('tag-list')).getByText('срочно'));
  await fireEvent.press(s.getByLabelText(t('ru', 'common.back')));
  within(s.getByTestId('project-row-marks-value')).getByText('срочно');
});

test('на четырёх языках строка подписана названием настройки', async () => {
  for (const lang of ['ru', 'en', 'uk', 'kk']) {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang } });
    const s = await show();
    within(s.getByTestId('project-row-marks')).getByText(t(lang, 'pdlg.marks_label'));
    await act(async () => { useSheetStore.setState({ content: null }); });
    await s.unmount();
  }
});

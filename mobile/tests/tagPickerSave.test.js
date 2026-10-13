// Лист тегов: «Сохранить» в закреплённом подвале. Запуск: npm run test:mobile
//
// С 11 октября 2026 лист тегов задачи и проекта (TagPickerSheet) применяет
// выбор кнопкой «Сохранить» — как «Дедлайн», «Повторение», «Изменить запись»
// и окно проекта: отметки копятся в листе, крестик и свайп их отменяют.
// Кнопка активна всегда. Встроенный в окно проекта пикер отдаёт отметку сразу:
// у окна своя «Сохранить».
import { render, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

const SAVE = t('ru', 'common.save');

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', tagIds: [] }],
    tasks: [],
    tags: [
      { id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null },
      { id: 'g2', name: 'срочно', color: '#ff7a7a', projectId: null },
    ],
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

async function show(props) {
  openSheet(<TagPickerSheet value={['g1']} {...props} />);
  return render(<BottomSheet />);
}
const footer = (s) => s.getByTestId('sheet-footer-content');
const saveBtn = (s) => within(footer(s)).getByTestId('primary-button');
const checked = (s) => within(s.getByTestId('tag-list')).getAllByRole('checkbox').map((r) => r.props.accessibilityState.checked);

test('внизу — «Сохранить», одна кнопка, активна и без правок', async () => {
  const s = await show({ onChange: jest.fn() });
  expect(within(footer(s)).getAllByTestId('primary-button')).toHaveLength(1);
  within(saveBtn(s)).getByText(SAVE);
  expect(saveBtn(s).props.accessibilityState || {}).not.toMatchObject({ disabled: true });
});

test('отметки копятся в листе; «Сохранить» применяет их и закрывает лист', async () => {
  const onChange = jest.fn();
  const s = await show({ onChange });
  await fireEvent.press(within(s.getByTestId('tag-list')).getByText('срочно'));
  await fireEvent.press(within(s.getByTestId('tag-list')).getByText('клиент'));
  expect(checked(s)).toEqual([false, true]);
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(saveBtn(s));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(['g2']);
  expect(useSheetStore.getState().content).toBeNull();
});

test('«Сохранить» без правок — тот же набор; пустой набор тоже сохраняется', async () => {
  const onChange = jest.fn();
  const s = await show({ onChange });
  await fireEvent.press(saveBtn(s));
  expect(onChange).toHaveBeenCalledWith(['g1']);
  useSheetStore.setState({ content: null, header: null, footer: null });
  await s.unmount();
  const empty = await show({ onChange, value: [] });
  await fireEvent.press(saveBtn(empty));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

test('крестик закрывает без сохранения', async () => {
  const onChange = jest.fn();
  const s = await show({ onChange });
  await fireEvent.press(within(s.getByTestId('tag-list')).getByText('срочно'));
  await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.close')));
  expect(onChange).not.toHaveBeenCalled();
  expect(useSheetStore.getState().content).toBeNull();
});

test('крестик на бейдже выбранного тоже копится до «Сохранить»', async () => {
  const onChange = jest.fn();
  const s = await show({ onChange });
  await fireEvent.press(s.getByLabelText('клиент'));
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(saveBtn(s));
  expect(onChange).toHaveBeenCalledWith([]);
});

test('с onDone «Сохранить» отдаёт набор вызывающему, а не просто закрывает', async () => {
  const onChange = jest.fn();
  const onDone = jest.fn();
  const s = await show({ onChange, onDone });
  await fireEvent.press(within(s.getByTestId('tag-list')).getByText('срочно'));
  await fireEvent.press(saveBtn(s));
  expect(onChange).toHaveBeenCalledWith(['g1', 'g2']);
  expect(onDone).toHaveBeenCalledWith(['g1', 'g2']);
});

test('новый тег из поиска — страница этого же листа со стрелкой «назад»; после создания — снова выбор с прежними отметками и новым тегом, ещё не сохранёнными', async () => {
  const onChange = jest.fn();
  const s = await show({ onChange });
  const content = useSheetStore.getState().content;
  await fireEvent.press(within(s.getByTestId('tag-list')).getByText('срочно'));
  await fireEvent.changeText(s.getByPlaceholderText(t('ru', 'tag.search_ph')), 'дизайн');
  await fireEvent.press(within(s.getByTestId('tag-create')).getByText(t('ru', 'tag.create_named', { name: 'дизайн' })));
  // Другой лист из листа не открывается: тот же лист, страница нового тега.
  expect(useSheetStore.getState().content).toBe(content);
  expect(content.type).toBe(TagPickerSheet);
  within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'tag.dialog_new'));
  within(s.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back'));
  expect(s.getByDisplayValue('дизайн')).toBeTruthy();
  await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button')[0]);
  const made = useAppStore.getState().tags.find((tg) => tg.name === 'дизайн');
  // Снова выбор: новый тег отмечен вместе с прежними, подвал — «Сохранить».
  s.getByPlaceholderText(t('ru', 'tag.search_ph'));
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(saveBtn(s));
  expect(onChange).toHaveBeenCalledWith(['g1', 'g2', made.id]);
});

test('встроенный (страница окна проекта): подвала нет, отметка уходит сразу', async () => {
  const onChange = jest.fn();
  const s = await show({ onChange, embedded: true });
  expect(s.queryByTestId('sheet-footer-content')).toBeNull();
  await fireEvent.press(within(s.getByTestId('tag-list')).getByText('срочно'));
  expect(onChange).toHaveBeenCalledWith(['g1', 'g2']);
});

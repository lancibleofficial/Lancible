// Закреплённая шапка нижнего листа (components/BottomSheet.js). Запуск: npm run test:mobile
//
// Проверяется применение, а не пиксели: шапка стоит вне ScrollView и потому
// не прокручивается; «назад», заголовок и крестик лежат в одной строке с
// выравниванием по центру; заголовок лист отдаёт сам (useSheetHeader), и в
// содержимом его второго экземпляра нет. Лист без заголовка — только ручка:
// ни крестика, ни строки под него (закрывают свайпом или нажатием на затемнение).
// Таблица ниже — все листы, что открываются через стор: добавили лист со своим
// заголовком в содержимом — он окажется на экране дважды, и тест это скажет.
import { StyleSheet, Text, View } from 'react-native';
import { render, renderHook, fireEvent, within, act } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import ActionSheetContent from '../src/components/ActionSheetContent';
import ChangePasswordSheet from '../src/components/ChangePasswordSheet';
import ColorPickerSheet from '../src/components/ColorPickerSheet';
import DatePickSheet from '../src/components/DatePickSheet';
import DueSheet from '../src/components/DueSheet';
import EntrySheet from '../src/components/EntrySheet';
import ExportPeriodSheet from '../src/components/ExportPeriodSheet';
import MenuSheet from '../src/components/MenuSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import PickerSheet from '../src/components/PickerSheet';
import QuickTaskSheet from '../src/components/QuickTaskSheet';
import ReminderSheet from '../src/components/ReminderSheet';
import AuthSheet from '../src/components/AuthSheet';
import RateSheet from '../src/components/RateSheet';
import RepeatSheet from '../src/components/RepeatSheet';
import SlotSheet from '../src/components/SlotSheet';
import SlotListSheet from '../src/components/SlotListSheet';
import SessionSheet from '../src/components/SessionSheet';
import TagEditSheet from '../src/components/TagEditSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import TaskMoveSheet from '../src/components/TaskMoveSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors } from '../src/theme';
import { t } from '../src/lib/i18n';

const noop = () => {};
const task = {
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [],
  pinnedAt: null, dueAt: null, repeat: null, rate: null, notes: '', updatedAt: '2026-10-01T10:00:00.000Z',
};

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [],
    tasks: [task],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, quickAddProjectId: null },
  });
});

// BottomSheet выезжает в кадре после открытия (requestAnimationFrame). Кадр
// последнего теста не должен выпасть уже после разбора окружения — иначе
// воркер падает, а не тест.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const ancestors = (node) => { const list = []; for (let n = node.parent; n; n = n.parent) list.push(n); return list; };
const inScroll = (node) => ancestors(node).some((n) => n.type === 'RCTScrollView');
const BACK = t('ru', 'common.back');
const CLOSE = t('ru', 'common.close');

/** Лист открыт и нарисован целиком — шапка, содержимое, подвал. */
async function show(content) {
  openSheet(content);
  return render(<BottomSheet />);
}

test('шапка закреплена: «назад», заголовок и крестик — одна строка, по центру, вне прокрутки', async () => {
  openSheet(<NewProjectSheet onCreated={noop} onCancel={noop} />);
  const screen = await render(<BottomSheet />);
  await fireEvent.press(screen.getByTestId('project-row-currency'));

  const row = screen.getByTestId('sheet-head-row');
  const back = within(row).getByLabelText(BACK);
  const title = within(row).getByText(t('ru', 'pdlg.currency_label'));
  const close = within(row).getByLabelText(CLOSE);
  // Одна строка с выравниванием по центру: у трёх общий родитель-ряд.
  expect(flat(row).flexDirection).toBe('row');
  expect(flat(row).alignItems).toBe('center');
  // Кнопки одного размера, заголовок один раз и в одну строку.
  expect(flat(back).height).toBe(flat(close).height);
  expect(flat(back).width).toBe(flat(close).width);
  expect(title.props.numberOfLines).toBe(1);

  // Шапка вне ScrollView — не прокручивается; прокручивается содержимое.
  expect(inScroll(row)).toBe(false);
  expect(inScroll(screen.getByTestId('sheet-header'))).toBe(false);
  expect(inScroll(screen.getByText('USD ($)'))).toBe(true);
});

test('тянуть вниз можно за всю шапку, не только за ручку', async () => {
  const screen = await show(<RateSheet lang="ru" initialValue={0} onSave={noop} />);
  const header = screen.getByTestId('sheet-header');
  expect(typeof header.props.onMoveShouldSetResponderCapture).toBe('function');
  expect(typeof header.props.onResponderRelease).toBe('function');
  // Строка с заголовком и крестиком — внутри той же шапки, что тянется.
  within(header).getByTestId('sheet-head-row');
  within(header).getByLabelText(CLOSE);
});

describe('заголовок листа живёт в шапке и не дублируется в содержимом', () => {
  const sheets = [
    ['ActionSheetContent', 'Удалить запись?', () => <ActionSheetContent title="Удалить запись?" message="Это нельзя отменить." actions={[{ label: 'Удалить', onPress: noop }]} />],
    ['ChangePasswordSheet', t('ru', 'profile.change_password'), () => <ChangePasswordSheet />],
    ['ColorPickerSheet', 'Цвет статуса', () => <ColorPickerSheet title="Цвет статуса" value="#87ff65" onSelect={noop} />],
    ['DatePickSheet', 'Выберите день', () => <DatePickSheet title="Выберите день" valueKey="2026-10-10" onPick={noop} />],
    ['DueSheet', t('ru', 'due.label'), () => <DueSheet task={task} lang="ru" onApply={noop} onClear={noop} />],
    ['EntrySheet', t('ru', 'agenda.create_title'), () => <EntrySheet initial={{ start: 1_700_000_000_000, end: 1_700_003_600_000 }} />],
    ['ExportPeriodSheet', t('ru', 'export.title'), () => <ExportPeriodSheet lang="ru" onConfirm={noop} onCancel={noop} />],
    ['MenuSheet', 'Проект «Сайт»', () => <MenuSheet title="Проект «Сайт»" items={[{ key: 'a', label: 'Настройки', onPress: noop }]} />],
    ['NewProjectSheet', t('ru', 'project.new_title'), () => <NewProjectSheet onCreated={noop} onCancel={noop} />],
    // Настройки существующего проекта — отдельным тестом ниже: заголовок —
    // название проекта, и оно же значение строки «Название и описание».
    ['PickerSheet', 'Язык', () => <PickerSheet title="Язык" value="ru" options={[{ value: 'ru', label: 'Русский' }]} onSelect={noop} />],
    ['RateSheet', t('ru', 'settings.rate_label'), () => <RateSheet lang="ru" initialValue={500} onSave={noop} />],
    ['RepeatSheet', t('ru', 'repeat.dialog_title'), () => <RepeatSheet lang="ru" anchorAt={null} rule={null} onApply={noop} onClear={noop} />],
    ['ReminderSheet', t('ru', 'notif.reminder'), () => <ReminderSheet taskId="t1" />],
    ['SessionSheet', t('ru', 'sdlg.add_title'), () => <SessionSheet task={task} index={null} />],
    ['SlotSheet', t('ru', 'slot.label'), () => <SlotSheet taskId="t1" />],
    ['SlotListSheet', t('ru', 'slot.label'), () => <SlotListSheet taskId="t1" />],
    ['TagEditSheet', t('ru', 'tag.dialog_new'), () => <TagEditSheet />],
    ['TagPickerSheet', t('ru', 'tag.pick'), () => <TagPickerSheet value={[]} onChange={noop} />],
    ['TaskMoveSheet', 'Вёрстка шапки', () => <TaskMoveSheet taskId="t1" />],
  ];

  test.each(sheets)('%s', async (_name, title, make) => {
    const screen = await show(make());
    // Заголовок на экране один, и он в шапке: не в ScrollView, рядом с крестиком.
    const found = screen.getAllByText(title);
    expect(found).toHaveLength(1);
    expect(inScroll(found[0])).toBe(false);
    within(screen.getByTestId('sheet-head-row')).getByText(title);
    // Лист отдал заголовок в стор; стрелки «назад» у листа без страниц нет.
    expect(useSheetStore.getState().header).toEqual({ title, onBack: null });
    expect(screen.queryByLabelText(BACK)).toBeNull();
  });

  test.each([
    ['QuickTaskSheet', () => <QuickTaskSheet projectId="p1" statusId="s1" contextLabel="В работе" />],
    ['AuthSheet', () => <AuthSheet />],
  ])('%s без заголовка: только ручка — ни крестика, ни строки под него', async (_name, make) => {
    const screen = await show(make());
    // Ручка и вся шапка (за неё тянут вниз) на месте; строки в шапке нет.
    const header = screen.getByTestId('sheet-header');
    expect(header.children).toHaveLength(1);
    expect(flat(header.children[0]).height).toBe(4);
    expect(screen.queryByTestId('sheet-head-row')).toBeNull();
    expect(screen.queryByLabelText(CLOSE)).toBeNull();
    expect(screen.queryByLabelText(BACK)).toBeNull();
    expect(screen.queryByRole('header')).toBeNull();
    expect(useSheetStore.getState().header).toBeNull();
    // Лист при этом закрывается нажатием на затемнение.
    expect(screen.getByTestId('sheet-overlay')).toBeTruthy();
  });

  test('с заголовком крестик и строка под него на месте', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={0} onSave={noop} />);
    within(screen.getByTestId('sheet-head-row')).getByLabelText(CLOSE);
  });

  test('«назад» без заголовка — строка есть: стрелка и крестик', async () => {
    const screen = await show(<Text>содержимое</Text>);
    await act(async () => { useSheetStore.getState().setHeader({ title: '', onBack: noop }); });
    const row = screen.getByTestId('sheet-head-row');
    within(row).getByLabelText(BACK);
    within(row).getByLabelText(CLOSE);
  });
});

test('страница внутри листа меняет заголовок и показывает «назад»; «назад» возвращает', async () => {
  const screen = await show(<NewProjectSheet onCreated={noop} onCancel={noop} />);
  const row = () => screen.getByTestId('sheet-head-row');
  // Форма: свой заголовок, стрелки нет.
  within(row()).getByText(t('ru', 'project.new_title'));
  expect(within(row()).queryByLabelText(BACK)).toBeNull();

  // Метки: заголовок страницы (название настройки) и стрелка. Встроенный
  // пикер своего заголовка не ставит.
  await fireEvent.press(screen.getByTestId('project-row-marks'));
  within(row()).getByText(t('ru', 'pdlg.marks_label'));
  within(row()).getByLabelText(BACK);
  expect(screen.queryByText(t('ru', 'project.new_title'))).toBeNull();
  expect(screen.getAllByText(t('ru', 'pdlg.marks_label'))).toHaveLength(1);

  // Создание тега из выбора меток — ещё глубже; «назад» ведёт к меткам, не на форму.
  await fireEvent.changeText(screen.getByPlaceholderText(t('ru', 'tag.search_ph')), 'Срочно');
  await fireEvent.press(screen.getByText(t('ru', 'tag.create_named', { name: 'Срочно' })));
  within(row()).getByText(t('ru', 'tag.project_add'));
  await fireEvent.press(within(row()).getByLabelText(BACK));
  within(row()).getByText(t('ru', 'pdlg.marks_label'));
  within(row()).getByLabelText(BACK);

  // «Назад» с тегов — на форму: заголовок формы, стрелка пропала.
  await fireEvent.press(within(row()).getByLabelText(BACK));
  within(row()).getByText(t('ru', 'project.new_title'));
  expect(within(row()).queryByLabelText(BACK)).toBeNull();
  expect(useSheetStore.getState().header).toEqual({ title: t('ru', 'project.new_title'), onBack: null });
});

test('настройки проекта: заголовок — название проекта, в шапке; в содержимом оно только значением строки', async () => {
  const screen = await show(<NewProjectSheet project={{ id: 'p1', name: 'Сайт', color: '#87ff65' }} onCreated={noop} onCancel={noop} />);
  within(screen.getByTestId('sheet-head-row')).getByText('Сайт');
  expect(inScroll(within(screen.getByTestId('sheet-head-row')).getByText('Сайт'))).toBe(false);
  expect(useSheetStore.getState().header).toEqual({ title: 'Сайт', onBack: null });
  expect(screen.queryByLabelText(BACK)).toBeNull();
  // Второй раз — это значение строки «Название и описание», а не заголовок.
  const inContent = screen.getAllByText('Сайт').filter(inScroll);
  expect(inContent).toHaveLength(1);
  expect(within(screen.getByTestId('project-row-name')).getByText('Сайт')).toBe(inContent[0]);
});

test('крестик закрывает лист и уносит шапку', async () => {
  const screen = await show(<RateSheet lang="ru" initialValue={0} onSave={noop} />);
  expect(useSheetStore.getState().header.title).toBe(t('ru', 'settings.rate_label'));
  await fireEvent.press(within(screen.getByTestId('sheet-head-row')).getByLabelText(CLOSE));
  expect(useSheetStore.getState().content).toBeNull();
  expect(useSheetStore.getState().header).toBeNull();
});

test('лист на месте другого: заголовок прежнего не остаётся', async () => {
  const screen = await show(<RateSheet lang="ru" initialValue={0} onSave={noop} />);
  screen.getByText(t('ru', 'settings.rate_label'));
  // Без заголовка у нового листа — шапка пуста, а не залежалась от прошлого.
  await act(async () => openSheet(<Text>просто текст</Text>));
  await screen.findByText('просто текст');
  expect(screen.queryByText(t('ru', 'settings.rate_label'))).toBeNull();
  expect(useSheetStore.getState().header).toBeNull();
  // С другим заголовком — новый.
  await act(async () => openSheet(<PickerSheet title="Язык" value="ru" options={[]} onSelect={noop} />));
  await screen.findByText('Язык');
  expect(screen.getAllByText('Язык')).toHaveLength(1);
});

test('длинный заголовок — в одну строку с многоточием, крестик на месте', async () => {
  const long = 'Очень длинное название проекта, которое никак не помещается в одну строку шапки листа и не должно наезжать на кнопки';
  const screen = await show(<MenuSheet title={long} items={[{ key: 'a', label: 'Настройки', onPress: noop }]} />);
  const row = screen.getByTestId('sheet-head-row');
  const title = within(row).getByText(long);
  expect(title.props.numberOfLines).toBe(1);
  expect(title.props.ellipsizeMode).toBe('tail');
  // Коробка заголовка сжимается (minWidth: 0) и не выталкивает крестик.
  const box = title.parent;
  expect(flat(box).flex).toBe(1);
  expect(flat(box).minWidth).toBe(0);
  within(row).getByLabelText(CLOSE);
});

describe('линия под шапкой видна только при прокрутке вниз', () => {
  const long = () => <View>{Array.from({ length: 40 }, (_, i) => <Text key={i}>строка {i + 1}</Text>)}</View>;
  const scrollTo = (screen, y) => fireEvent.scroll(screen.getByText('строка 1'), { nativeEvent: { contentOffset: { y } } });

  test.each(['dark', 'light'])('нет → есть → нет (%s)', async (theme) => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } });
    const { result } = await renderHook(() => useColors());
    const screen = await show(long());
    const line = () => screen.getByTestId('sheet-head-line');
    const color = () => flat(line()).backgroundColor;

    // Линия — часть шапки, а не содержимого: сама не прокручивается, место держит всегда.
    expect(inScroll(line())).toBe(false);
    expect(flat(line()).height).toBe(StyleSheet.hairlineWidth);

    // В покое линии нет; лист не прокручен.
    expect(color()).toBe('transparent');
    // Прокрутили вниз — линия цвета границы из темы.
    await scrollTo(screen, 120);
    expect(color()).toBe(result.current.border);
    await scrollTo(screen, 1);
    expect(color()).toBe(result.current.border);
    // Вернули наверх — линии снова нет. Оттяжка iOS вверх (y < 0) — тоже верх.
    await scrollTo(screen, 0);
    expect(color()).toBe('transparent');
    await scrollTo(screen, 120);
    await scrollTo(screen, -12);
    expect(color()).toBe('transparent');
  });

  test('другой лист на месте прокрученного начинается без линии', async () => {
    const screen = await show(long());
    await scrollTo(screen, 120);
    expect(flat(screen.getByTestId('sheet-head-line')).backgroundColor).not.toBe('transparent');
    await act(async () => openSheet(<Text>другой лист</Text>));
    await screen.findByText('другой лист');
    expect(flat(screen.getByTestId('sheet-head-line')).backgroundColor).toBe('transparent');
  });
});

test.each(['dark', 'light'])('цвета шапки — токены темы (%s)', async (theme) => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } });
  const { result } = await renderHook(() => useColors());
  const screen = await show(<RateSheet lang="ru" initialValue={0} onSave={noop} />);
  const row = screen.getByTestId('sheet-head-row');
  expect(flat(within(row).getByText(t('ru', 'settings.rate_label'))).color).toBe(result.current.text);
  expect(flat(within(row).getByLabelText(CLOSE)).backgroundColor).toBe(result.current.panel2);
  expect(flat(screen.getByTestId('sheet-header').children[0]).backgroundColor).toBe(result.current.borderStrong);
});

// 13 октября 2026: системная «назад» Android (onRequestClose у Modal) на
// странице листа закрывала весь лист — вместе с тем, что набрали на первой
// странице. Теперь она делает то же, что стрелка в шапке, а закрывает лист
// только там, где стрелки нет.
test('системная «назад» на странице листа — шаг назад, а на первой странице — закрыть лист', async () => {
  openSheet(<NewProjectSheet onCreated={noop} onCancel={noop} />);
  const screen = await render(<BottomSheet />);
  const modal = ancestors(screen.getByTestId('sheet-overlay')).find((n) => typeof n.props.onRequestClose === 'function');
  const systemBack = () => act(async () => { modal.props.onRequestClose(); });
  await fireEvent.press(screen.getByTestId('project-row-currency'));
  within(screen.getByTestId('sheet-head-row')).getByLabelText(BACK);

  await systemBack();
  expect(useSheetStore.getState().content).not.toBeNull();
  expect(useSheetStore.getState().header).toEqual({ title: t('ru', 'project.new_title'), onBack: null });
  expect(within(screen.getByTestId('sheet-head-row')).queryByLabelText(BACK)).toBeNull();

  await systemBack();
  expect(useSheetStore.getState().content).toBeNull();
});

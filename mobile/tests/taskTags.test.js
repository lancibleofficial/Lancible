// Теги в строке списка проекта и переключатель листа входа. Запуск: npm run test:mobile
//
// Внутри проекта у каждой задачи видны её теги — бейджами под названием и
// метой, одной строкой. Влезло сколько влезло, остальные — бейдж «+N»; нажатие
// на него открывает лист со всеми тегами задачи (TagPickerSheet), а строку не
// открывает. «Влезло» решают измеренные ширины: в Jest раскладки нет, поэтому
// onLayout здесь шлют руками — как это делает сам движок на устройстве.
//
// Тут же — лист входа: «Войти / Создать аккаунт» — две строки с галочкой
// (общий ChoiceList; с 12 октября 2026 сегментов в листах нет).
import { StyleSheet } from 'react-native';
import { render, fireEvent, within, act } from '@testing-library/react-native';
import TaskListItem, { TASK_ROW_MIN_H } from '../src/components/TaskListItem';
import ProjectScreen from '../src/screens/ProjectScreen';
import TagPickerSheet from '../src/components/TagPickerSheet';
import AuthSheet from '../src/components/AuthSheet';
import BottomSheet from '../src/components/BottomSheet';
import { fitTagCount } from '../src/lib/tags';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

const HIDDEN = { includeHiddenElements: true };
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const layout = (width, height = 20) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

const TAGS = [
  { id: 'a', name: 'клиент', color: '#5ec8f2', projectId: null },
  { id: 'b', name: 'срочно', color: '#ff7a59', projectId: null },
  { id: 'c', name: 'вёрстка', color: '#87ff65', projectId: 'p1' },
  { id: 'd', name: 'дизайн', color: '#c792ea', projectId: null },
  { id: 'e', name: 'релиз', color: '#ffd166', projectId: null },
];
const task = (over) => ({
  id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', totalMs: 0, sessions: [], done: false,
  tagIds: ['a', 'b', 'c', 'd', 'e'], ...over,
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', tagIds: [] }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: TAGS,
    tasks: [task()],
    activeTimer: null,
  });
  useSheetStore.setState({ content: null });
});

/** Раскладка строки тегов: ширина строки, ширина каждого бейджа и «+N». */
async function lay(screen, { id = 't1', width, badge = 60, more = 24, ids = ['a', 'b', 'c', 'd', 'e'] }) {
  await fireEvent(screen.getByTestId(`task-tags-${id}`), 'layout', layout(width));
  for (const tagId of ids) {
    await fireEvent(screen.getByTestId(`task-tags-${id}-measure-${tagId}`, HIDDEN), 'layout', layout(badge));
  }
  await fireEvent(screen.getByTestId(`task-tags-${id}-measure-more`, HIDDEN), 'layout', layout(more));
}
const visibleIds = (screen, id = 't1') => TAGS.map((tg) => tg.id).filter((x) => screen.queryByTestId(`task-tags-${id}-badge-${x}`));

describe('fitTagCount: сколько бейджей влезает в строку', () => {
  const more = () => 24;
  test('влезли все — «+N» не нужен', () => {
    expect(fitTagCount([60, 60, 60], 200, 4, more)).toBe(3);
    // Впритык: 60·3 + 4·2 = 188.
    expect(fitTagCount([60, 60, 60], 188, 4, more)).toBe(3);
  });
  test('не влезли — берутся первые K, после которых ещё есть место для «+N»', () => {
    // Ширина 160: два бейджа (124) + зазор + «+N» (24) = 152 ≤ 160, третий — уже нет.
    expect(fitTagCount([60, 60, 60, 60, 60], 160, 4, more)).toBe(2);
    expect(fitTagCount([60, 60, 60, 60, 60], 100, 4, more)).toBe(1);
  });
  test('последний влезает без «+N», хотя вместе с ним не влез бы', () => {
    // Два по 50 и один 10: все три = 118 ≤ 125, хотя после второго «+N» не умещался бы.
    expect(fitTagCount([50, 50, 10], 125, 4, more)).toBe(3);
  });
  test('первый показывается всегда — даже если сам с «+N» не влез, он ужмётся', () => {
    expect(fitTagCount([200, 60], 100, 4, more)).toBe(1);
    expect(fitTagCount([80], 40, 4, more)).toBe(1);
  });
  test('тегов нет — ноль', () => {
    expect(fitTagCount([], 300, 4, more)).toBe(0);
  });
  test('«+N» считается от числа оставшихся', () => {
    const calls = [];
    fitTagCount([60, 60, 60, 60], 150, 4, (n) => { calls.push(n); return 24; });
    expect(calls).toEqual([3, 2]);
  });
});

describe('строка списка проекта: выше прежней, теги видны', () => {
  test('минимальная высота строки — токен, больше прежних ~43, и отступ сверху-снизу не меньше прежнего', async () => {
    const s = await render(<TaskListItem task={task({ tagIds: [] })} onPress={() => {}} />);
    const row = flat(s.getByTestId('task-row-t1'));
    expect(row.minHeight).toBe(TASK_ROW_MIN_H);
    expect(TASK_ROW_MIN_H).toBeGreaterThanOrEqual(56);
    expect(row.paddingVertical).toBeGreaterThan(9); // было spacing.sm + 1
  });

  test('теги задачи — бейджами с именами, а не точками; у задачи без тегов ряда нет', async () => {
    const s = await render(<TaskListItem task={task({ tagIds: ['a', 'b'] })} onPress={() => {}} />);
    await lay(s, { width: 300, ids: ['a', 'b'] });
    expect(visibleIds(s)).toEqual(['a', 'b']);
    s.getByText('клиент');
    s.getByText('срочно');
    expect(s.queryByTestId('task-tags-t1-more')).toBeNull();

    const none = await render(<TaskListItem task={task({ id: 't2', tagIds: [] })} onPress={() => {}} />);
    expect(none.queryByTestId('task-tags-t2')).toBeNull();
  });

  test('сначала меряем, потом показываем: до раскладки видимых бейджей нет, и текста тегов тоже', async () => {
    const s = await render(<TaskListItem task={task()} onPress={() => {}} />);
    expect(visibleIds(s)).toEqual([]);
    expect(s.queryByTestId('task-tags-t1-more')).toBeNull();
    expect(s.queryByText('клиент')).toBeNull(); // мерный слой для чтения с экрана скрыт
    // Измерена строка, но не бейджи — всё ещё ждём.
    await fireEvent(s.getByTestId('task-tags-t1'), 'layout', layout(300));
    expect(visibleIds(s)).toEqual([]);
  });

  test('узко и тегов много: видны первые K и «+(N−K)»', async () => {
    const s = await render(<TaskListItem task={task()} onPress={() => {}} />);
    await lay(s, { width: 160 });
    expect(visibleIds(s)).toEqual(['a', 'b']);
    within(s.getByTestId('task-tags-t1-more')).getByText('+3');
    // Скринридеру — не голый «+3», а что за этим: сколько и куда нажать.
    expect(s.getByTestId('task-tags-t1-more').props.accessibilityLabel).toBe(t('ru', 'tag.more_a11y', { n: 5 }));
  });

  test('широко — «+N» нет; ширина изменилась — ряд пересчитывается без нового измерения бейджей', async () => {
    const s = await render(<TaskListItem task={task()} onPress={() => {}} />);
    await lay(s, { width: 160 });
    expect(visibleIds(s)).toHaveLength(2);
    await fireEvent(s.getByTestId('task-tags-t1'), 'layout', layout(400));
    expect(visibleIds(s)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(s.queryByTestId('task-tags-t1-more')).toBeNull();
    await fireEvent(s.getByTestId('task-tags-t1'), 'layout', layout(110));
    expect(visibleIds(s)).toEqual(['a']);
    within(s.getByTestId('task-tags-t1-more')).getByText('+4');
  });

  test('нажатие на «+N» открывает лист тегов задачи и не открывает саму задачу', async () => {
    const onPress = jest.fn();
    const s = await render(<TaskListItem task={task()} onPress={onPress} />);
    await lay(s, { width: 160 });
    await fireEvent.press(s.getByTestId('task-tags-t1-more'));
    expect(onPress).not.toHaveBeenCalled();
    const content = useSheetStore.getState().content;
    expect(content.type).toBe(TagPickerSheet);
    expect(content.props.value).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(content.props.projectId).toBe('p1');
    expect(content.props.title).toBe(t('ru', 'tag.task_title'));
    // Снять и добавить — прямо из листа, и строка перерисуется.
    await act(async () => { content.props.onChange(['a', 'b']); });
    expect(useAppStore.getState().tasks[0].tagIds).toEqual(['a', 'b']);
    // Нажатие на саму строку — по-прежнему открывает задачу.
    await fireEvent.press(s.getByTestId('task-row-t1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('лист тегов задачи: заголовок — «Теги задачи» на четырёх языках', async () => {
    for (const lang of ['ru', 'en', 'uk', 'kk']) {
      expect(t(lang, 'tag.task_title')).not.toBe('tag.task_title');
      expect(t(lang, 'tag.more_a11y', { n: 3 })).toContain('3');
    }
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'en' } });
    const s = await render(<TaskListItem task={task()} onPress={() => {}} />);
    await lay(s, { width: 160 });
    await fireEvent.press(s.getByTestId('task-tags-t1-more'));
    expect(useSheetStore.getState().content.props.title).toBe('Task tags');
  });
});

describe('страница проекта: теги в каждой строке списка', () => {
  const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), getState: () => ({ routes: [], index: 0 }) });

  test('у задачи с тегами в списке проекта — бейджи, у «+N» своё нажатие, строка открывается как раньше', async () => {
    const navigation = nav();
    const s = await render(<ProjectScreen navigation={navigation} route={{ params: { projectId: 'p1' } }} />);
    await lay(s, { width: 160 });
    expect(visibleIds(s)).toEqual(['a', 'b']);
    await fireEvent.press(s.getByTestId('task-tags-t1-more'));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(useSheetStore.getState().content.type).toBe(TagPickerSheet);
    await fireEvent.press(s.getByText('Вёрстка'));
    expect(navigation.navigate).toHaveBeenCalledWith('TaskDetail', { taskId: 't1' });
  });
});

describe('лист входа: «Войти / Создать аккаунт» — две строки с галочкой', () => {
  test('режим — общий ChoiceList из двух строк; выбранная соответствует initialTab; вкладок нет', async () => {
    const s = await render(<AuthSheet initialTab="signup" />);
    const list = s.getByTestId('auth-mode');
    const rows = within(list).getAllByRole('radio');
    expect(rows).toHaveLength(2);
    within(rows[0]).getByText(t('ru', 'auth.sign_in'));
    within(rows[1]).getByText(t('ru', 'auth.create_account'));
    expect(rows[0].props.accessibilityState).toMatchObject({ selected: false });
    expect(rows[1].props.accessibilityState).toMatchObject({ selected: true });
    expect(s.queryAllByRole('tab')).toHaveLength(0);
    expect(s.queryByTestId('auth-tabs')).toBeNull();
  });

  test('нажатие переключает режим: меняются галочка и подпись главной кнопки', async () => {
    useSheetStore.setState({ content: <AuthSheet initialTab="signin" /> });
    const s = await render(<BottomSheet />);
    const primary = () => within(s.getByTestId('primary-button')).getByText(/./);
    expect(primary().props.children).toBe(t('ru', 'auth.sign_in'));
    await fireEvent.press(s.getByTestId('auth-mode-signup'));
    expect(s.getByTestId('auth-mode-signup').props.accessibilityState).toMatchObject({ selected: true });
    expect(s.getByTestId('auth-mode-signin').props.accessibilityState).toMatchObject({ selected: false });
    expect(primary().props.children).toBe(t('ru', 'auth.create_account'));
  });

  test('исходник листа без своих вкладок и сегментов: ни tabRow, ни Segments', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'components', 'AuthSheet.js'), 'utf8');
    expect(src).toMatch(/import ChoiceList from '\.\/ChoiceList'/);
    expect(src).not.toMatch(/Segment/);
    expect(src).not.toMatch(/tabRow|styles\.tab\b|styles\.tabActive|styles\.tabText/);
  });
});

// Нижний отступ листов — один на все. Запуск: npm run test:mobile
//
// До 11 октября 2026 под последней строкой листа складывались три отступа:
// у содержимого BottomSheet (24), свой у каждого листа (8–32: меню проекта,
// выбор языка, теги, повторение) и «безопасная зона или 12» под самим листом.
// Под последним пунктом меню проекта стояла пустота в полпальца. Теперь под
// содержимым (или под кнопками подвала) ровно SHEET_BOTTOM_GAP, ниже —
// только безопасная зона системы. Тест обходит все листы, что открываются
// через стор: у каждого низ — токен, а своего отступа снизу лист не заводит.
// «Юбка» под пружиной (sheet-skirt) — ниже экрана и в отступ не входит.
import { StyleSheet } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { SHEET_BOTTOM_GAP } from '../src/components/BottomSheet';
import ActionSheetContent from '../src/components/ActionSheetContent';
import AuthSheet from '../src/components/AuthSheet';
import ChangePasswordSheet from '../src/components/ChangePasswordSheet';
import ColorPickerSheet from '../src/components/ColorPickerSheet';
import DueSheet from '../src/components/DueSheet';
import ExportPeriodSheet from '../src/components/ExportPeriodSheet';
import MenuSheet from '../src/components/MenuSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import PickerSheet from '../src/components/PickerSheet';
import ProfileSheet from '../src/components/ProfileSheet';
import QuickTaskSheet from '../src/components/QuickTaskSheet';
import RateSheet from '../src/components/RateSheet';
import ReminderSheet from '../src/components/ReminderSheet';
import RepeatSheet from '../src/components/RepeatSheet';
import SlotSheet from '../src/components/SlotSheet';
import SlotListSheet from '../src/components/SlotListSheet';
import SessionSheet from '../src/components/SessionSheet';
import TagEditSheet from '../src/components/TagEditSheet';
import TagPickerSheet from '../src/components/TagPickerSheet';
import TaskMoveSheet from '../src/components/TaskMoveSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { spacing } from '../src/theme';

const noop = () => {};
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
/** Стиль содержимого прокрутки листа (contentContainerStyle). */
const contentOf = (screen) => StyleSheet.flatten(screen.getByTestId('sheet-scroll').props.contentContainerStyle) || {};
const task = {
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, totalMs: 3_600_000,
  sessions: [{ start: '2026-10-10T09:00:00.000Z', end: '2026-10-10T10:00:00.000Z', ms: 3_600_000 }], tagIds: [],
  pinnedAt: null, dueAt: null, repeat: null, rate: null, notes: '', updatedAt: '2026-10-01T10:00:00.000Z',
};

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAuthStore.setState({ status: 'signedOut', user: null, signOut: jest.fn() });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    versions: [],
    tags: [{ id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null }],
    tasks: [task],
    documents: [],
    activeTimer: null,
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

/** Первый хост-узел содержимого листа — корень того, что нарисовал лист. */
function sheetRoot(screen) {
  const container = screen.getByTestId('sheet-scroll').children[0];
  return container.children.find((c) => typeof c === 'object') || null;
}

const SHEETS = [
  ['ActionSheetContent', () => <ActionSheetContent title="Удалить?" message="Это нельзя отменить." actions={[{ label: 'Удалить', destructive: true }, { label: 'Отмена', cancel: true }]} />],
  ['AuthSheet', () => <AuthSheet />],
  ['ChangePasswordSheet', () => <ChangePasswordSheet />],
  ['ColorPickerSheet', () => <ColorPickerSheet title="Цвет" value="#87ff65" onSelect={noop} />],
  ['DueSheet', () => <DueSheet task={task} lang="ru" onApply={noop} onClear={noop} />],
  ['ExportPeriodSheet', () => <ExportPeriodSheet lang="ru" />],
  ['MenuSheet (меню проекта)', () => <MenuSheet title="Сайт" items={['Задача', 'Настройки', 'Статусы', 'Быстрый доступ', 'Экспорт'].map((label) => ({ key: label, label, icon: 'settings', onPress: noop })).concat([{ key: 'del', label: 'Удалить проект', icon: 'trash', danger: true, separated: true, onPress: noop }])} />],
  ['NewProjectSheet', () => <NewProjectSheet onCreated={noop} onCancel={noop} />],
  ['PickerSheet', () => <PickerSheet title="Язык" value="ru" options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} onSelect={noop} />],
  ['ProfileSheet', () => { useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'me@example.com', name: 'Я' } }); return <ProfileSheet />; }],
  ['QuickTaskSheet', () => <QuickTaskSheet projectId="p1" statusId="s1" contextLabel="В работе" />],
  ['RateSheet', () => <RateSheet lang="ru" initialValue={500} onSave={noop} />],
  ['RepeatSheet', () => <RepeatSheet lang="ru" anchorAt={null} rule={null} onApply={noop} onClear={noop} />],
  ['ReminderSheet', () => <ReminderSheet taskId="t1" />],
  ['SessionSheet', () => <SessionSheet task={task} index={0} onOpenTask={noop} />],
  ['SlotSheet', () => <SlotSheet taskId="t1" />],
  ['SlotListSheet', () => <SlotListSheet taskId="t1" />],
  ['NewProjectSheet (настройки проекта)', () => <NewProjectSheet project={{ id: 'p1', name: 'Сайт', color: '#87ff65' }} onCreated={noop} onCancel={noop} />],
  ['TagEditSheet', () => <TagEditSheet />],
  ['TagPickerSheet', () => <TagPickerSheet value={[]} onChange={noop} />],
  ['TaskMoveSheet', () => <TaskMoveSheet taskId="t1" />],
];

describe('низ каждого листа — токен, своего отступа снизу у листа нет', () => {
  test.each(SHEETS)('%s', async (_name, make) => {
    openSheet(make());
    const screen = await render(<BottomSheet />);
    const footer = screen.queryByTestId('sheet-footer-content');
    const content = contentOf(screen);
    if (footer) {
      // Под кнопками — ровно токен; между содержимым и кнопками — обычный воздух.
      expect(flat(footer).paddingBottom).toBe(SHEET_BOTTOM_GAP);
      expect(content.paddingBottom).toBe(spacing.md);
    } else {
      expect(content.paddingBottom).toBe(SHEET_BOTTOM_GAP);
    }
    // Под листом — только безопасная зона (в тестах ноль), без «или 12».
    expect(flat(screen.getByTestId('sheet')).paddingBottom).toBe(0);
    // Корень содержимого листа своего нижнего отступа не добавляет.
    const root = sheetRoot(screen);
    expect(root).toBeTruthy();
    const st = flat(root);
    expect({ paddingBottom: st.paddingBottom || 0, marginBottom: st.marginBottom || 0, paddingVertical: st.paddingVertical || 0 })
      .toEqual({ paddingBottom: 0, marginBottom: 0, paddingVertical: 0 });
    // Своей прокрутки с запасом снизу внутри листа тоже нет (так было у
    // «Повторения»: ScrollView с paddingBottom 32 внутри листа).
    for (const inner of screen.queryAllByTestId('sheet-scroll')) expect(inner).toBe(screen.getByTestId('sheet-scroll'));
  });
});

test('токен — небольшой: не больше 16 и не меньше 8', () => {
  expect(SHEET_BOTTOM_GAP).toBeGreaterThanOrEqual(spacing.sm);
  expect(SHEET_BOTTOM_GAP).toBeLessThanOrEqual(spacing.lg);
});

test('безопасная зона снизу — под листом ровно она, а воздух над ней — тот же токен', async () => {
  const insets = useSafeAreaInsets();
  const was = insets.bottom;
  insets.bottom = 34;
  try {
    openSheet(<MenuSheet title="Сайт" items={[{ key: 'a', label: 'Настройки', onPress: noop }]} />);
    const screen = await render(<BottomSheet />);
    expect(flat(screen.getByTestId('sheet')).paddingBottom).toBe(34);
    expect(contentOf(screen).paddingBottom).toBe(SHEET_BOTTOM_GAP);
    // Юбка под пружиной — ниже экрана, а не отступ листа.
    expect(flat(screen.getByTestId('sheet-skirt')).bottom).toBeLessThan(0);
    await act(async () => useSheetStore.setState({ content: null }));
  } finally {
    insets.bottom = was;
  }
});

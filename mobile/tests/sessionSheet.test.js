// Лист «Изменить запись» (components/SessionSheet.js). Запуск: npm run test:mobile
//
// С 11 октября 2026: под заголовком — строка задачи (название, под ним проект
// с точкой цвета, справа шеврон); нажатие на неё открывает задачу — вместо
// кнопки «Открыть задачу». «Отмены» нет: лист закрывают крестик и свайп.
// Внизу две кнопки — «Сохранить» и «Удалить запись», вторая серая с красной
// подписью (опасная, не акцентная).
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import SessionSheet from '../src/components/SessionSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors } from '../src/theme';
import { t } from '../src/lib/i18n';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const walk = (node) => [node, ...(node.children || []).filter((c) => typeof c === 'object').flatMap(walk)];
const task = {
  id: 't1', projectId: 'p1', title: 'Вёрстка шапки', statusId: 's1', done: false, totalMs: 3_600_000, tagIds: [],
  sessions: [{ start: '2026-10-10T09:00:00.000Z', end: '2026-10-10T10:00:00.000Z', ms: 3_600_000 }],
};

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', hourlyRate: 0 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [task],
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

async function show(props) {
  openSheet(<SessionSheet task={task} index={0} {...props} />);
  return render(<BottomSheet />);
}

test('под заголовком — строка задачи: название, проект с точкой, шеврон; нажатие открывает задачу', async () => {
  const onOpenTask = jest.fn();
  const s = await show({ onOpenTask });
  within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'sdlg.edit_title'));
  const row = s.getByTestId('session-task');
  const title = within(row).getByText('Вёрстка шапки');
  const project = within(row).getByText('Сайт');
  // Проект — под названием (второй строкой), с точкой цвета проекта.
  expect(title.props.numberOfLines).toBe(1);
  expect(walk(row).some((n) => flat(n).backgroundColor === '#87ff65')).toBe(true);
  expect(project).not.toBe(title);
  // Шеврон справа: последний значок строки — chevron-right.
  expect(walk(row).filter((n) => n.type === 'RNSVGSvgView')).toHaveLength(1);
  expect(row.props.accessibilityRole).toBe('button');
  expect(row.props.accessibilityLabel).toContain('Вёрстка шапки');
  await fireEvent.press(row);
  expect(onOpenTask).toHaveBeenCalledWith('t1');
  expect(useSheetStore.getState().content).toBeNull();
});

test('внизу две кнопки — «Сохранить» и «Удалить запись»; «Отмены» и «Открыть задачу» нет', async () => {
  const s = await show({ onOpenTask: jest.fn() });
  const buttons = within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button');
  expect(buttons.map((b) => within(b).getByText(/./).props.children)).toEqual([t('ru', 'common.save'), t('ru', 'session.delete_title')]);
  expect(s.queryByText(t('ru', 'common.cancel'))).toBeNull();
  expect(s.queryByText(t('ru', 'agenda.open_task'))).toBeNull();
});

test.each(['dark', 'light'])('«Удалить запись» — серая подложка и красная подпись, без красной заливки (%s)', async (theme) => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme } });
  const { result } = await renderHook(() => useColors());
  const c = result.current;
  const s = await show({});
  const del = within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button')[1];
  expect(flat(del).backgroundColor).toBe(c.panel2);
  expect(flat(within(del).getByText(t('ru', 'session.delete_title'))).color).toBe(c.danger);
});

test('со страницы задачи (без onOpenTask) строка не нажимается и без шеврона', async () => {
  const s = await show({});
  const row = s.getByTestId('session-task');
  within(row).getByText('Вёрстка шапки');
  within(row).getByText('Сайт');
  expect(row.props.accessibilityRole).toBeUndefined();
  expect(walk(row).filter((n) => n.type === 'RNSVGSvgView')).toHaveLength(0);
});

test('новая запись — одна кнопка «Сохранить»', async () => {
  const s = await show({ index: null });
  within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'sdlg.add_title'));
  expect(within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button')).toHaveLength(1);
});

test('«Удалить запись» спрашивает подтверждение страницей этого же листа; «Отмена» возвращает, «Удалить» — удаляет', async () => {
  const s = await show({});
  const content = useSheetStore.getState().content;
  const footer = () => within(s.getByTestId('sheet-footer-content'));
  await fireEvent.press(footer().getAllByTestId('primary-button')[1]);
  // Тот же лист: страница подтверждения со стрелкой «назад».
  expect(useSheetStore.getState().content).toBe(content);
  within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'confirm.are_you_sure'));
  within(s.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back'));
  expect(footer().getAllByTestId('primary-button').map((b) => within(b).getByText(/./).props.children))
    .toEqual([t('ru', 'common.delete'), t('ru', 'common.cancel')]);
  await fireEvent.press(footer().getByText(t('ru', 'common.cancel')));
  s.getByTestId('session-date');
  expect(useAppStore.getState().tasks[0].sessions).toHaveLength(1);
  await fireEvent.press(footer().getAllByTestId('primary-button')[1]);
  await fireEvent.press(footer().getByText(t('ru', 'common.delete')));
  expect(useAppStore.getState().tasks[0].sessions).toHaveLength(0);
  expect(useSheetStore.getState().content).toBeNull();
});

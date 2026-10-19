// Нижние листы собраны из одних кирпичей — один каркас на все листы
// (DESIGN.md, «Нижние листы»). Запуск: npm run test:mobile
//
// Сестра repeatSheetStyle.test.js: там закреплено, что взяли «Повторение» и
// «Напоминание»; здесь — что то же самое взяли остальные. Каркас (12 октября
// 2026):
//   • шапка — заголовок слева, крестик справа; страница внутри листа —
//     стрелка «назад» (общая шапка BottomSheet);
//   • тело — группы с подписью Block над островом строк (RowGroup и
//     SettingRow из Island.js), поле Field / SelectField, чипы Chip для
//     короткого выбора, ChoiceList — список-выбор с галочкой;
//   • выбор вида или режима — строки с галочкой (ChoiceList): сегментов
//     (Segments / Segmented) в листах нет вовсе, они только на экранах;
//   • дата и время — строка острова, выбор раскрывается под строкой
//     (ExpandRow); сводка — серая InfoRow;
//   • подвал — PrimaryButton во всю ширину колонкой: главная, под ней серая
//     ghost или danger (серая подложка и красная подпись);
//   • из листа другой лист не открывается — только страница этого же листа.
// Первая половина — по исходникам всех листов (новый лист, заведший своё,
// упадёт здесь), вторая — по отрисовке.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import AuthSheet from '../src/components/AuthSheet';
import DueSheet from '../src/components/DueSheet';
import ExportPeriodSheet from '../src/components/ExportPeriodSheet';
import MenuSheet from '../src/components/MenuSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import ProfileSheet from '../src/components/ProfileSheet';
import QuickTaskSheet from '../src/components/QuickTaskSheet';
import SessionSheet from '../src/components/SessionSheet';
import SlotSheet from '../src/components/SlotSheet';
import SlotListSheet from '../src/components/SlotListSheet';
import RateSheet from '../src/components/RateSheet';
import TagEditSheet from '../src/components/TagEditSheet';
import TaskMoveSheet from '../src/components/TaskMoveSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors, fontSize, radius, spacing } from '../src/theme';
import { t } from '../src/lib/i18n';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const noop = () => {};

// ---------------------------------------------------------------------------
// Исходники: у листов нет своего вида
// ---------------------------------------------------------------------------

const COMPONENTS = join(__dirname, '..', 'src', 'components');
/** Все листы: *Sheet.js и содержимое подтверждений, кроме самой машины листа. */
const SHEET_FILES = readdirSync(COMPONENTS)
  .filter((f) => (/Sheet\.js$/.test(f) || f === 'ActionSheetContent.js') && f !== 'BottomSheet.js');
const code = (file) => readFileSync(join(COMPONENTS, file), 'utf8')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n');

describe('исходники всех листов', () => {
  test('обходятся все листы: перечень не пустеет и называет приведённые', () => {
    expect(SHEET_FILES).toEqual(expect.arrayContaining([
      'AuthSheet.js', 'DueSheet.js', 'SlotSheet.js', 'TaskMoveSheet.js', 'ExportPeriodSheet.js',
      'ProfileSheet.js', 'TagEditSheet.js', 'NewProjectSheet.js', 'SessionSheet.js',
      'RepeatSheet.js', 'ReminderSheet.js', 'SlotListSheet.js', 'RateSheet.js', 'TagPickerSheet.js',
      'ColorPickerSheet.js', 'PickerSheet.js', 'QuickTaskSheet.js', 'ChangePasswordSheet.js', 'MenuSheet.js',
      'FilterSheet.js', 'WorkHoursSheet.js',
    ]));
  });

  test.each(SHEET_FILES)('%s — ни рамок, ни заглавных подписей', (file) => {
    const src = code(file);
    expect(src).not.toMatch(/textTransform/);
    expect(src).not.toMatch(/letterSpacing/);
    expect(src).not.toMatch(/borderColor/);
    // borderWidth: 0 (сброс у названия записи) — не рамка; волосяная линия
    // разделителя — hairlineWidth, а не borderWidth.
    expect(src).not.toMatch(/borderWidth: [1-9]/);
  });

  test.each(SHEET_FILES)('%s — ни сегментов, ни своих вкладок: выбор вида — строки с галочкой', (file) => {
    const src = code(file);
    expect(src).not.toMatch(/\bSegments?\b|\bSegmented\b/);
    expect(src).not.toMatch(/from '\.\/Segmented'/);
    expect(src).not.toMatch(/tabRow|tabActive|styles\.tab\b|segTrack|\bseg: \{/);
  });

  test.each(SHEET_FILES)('%s — подписи — Block, подсказки — Hint, строки — общие', (file) => {
    const src = code(file);
    // Своя подпись над полем: стиль «…label» цвета textDim мелким шрифтом, свой раздел.
    expect(src).not.toMatch(/\w*[lL]abel: \{[^}]*colors\.textDim[^}]*fontSize\.xs/);
    expect(src).not.toMatch(/\bsection: \{[^}]*textDim/);
    // Своя подсказка: стиль «hint»/«error» тихим или красным цветом — это Hint.
    expect(src).not.toMatch(/\b(hint|error): \{[^}]*colors\.(textFaint|danger)/);
    // Своя строка даты: ряд «значок · подпись · значение» на panel2 — это ExpandRow.
    expect(src).not.toMatch(/dateBtn: \{[^}]*flexDirection: 'row'/);
    expect(src).not.toMatch(/\bDateRow\b|\bTimeRange\b/);
    // Своя строка-кнопка на panel2 (проект, задача, действие) — это SettingRow.
    expect(src).not.toMatch(/(projBtn|projectRow|taskRow|actionRow): \{/);
  });

  test.each(SHEET_FILES)('%s — подвал только из PrimaryButton, своих стилей кнопок нет', (file) => {
    const src = code(file);
    expect(src).not.toMatch(/footer\w*: \{|ghostBtn|doneBtn|cancelBtn|footerGhost|footerDone/);
  });

  test.each(SHEET_FILES)('%s — другой лист из листа не открывается: ни openSheet, ни confirmSheet', (file) => {
    const src = code(file);
    expect(src).not.toMatch(/\bopenSheet\s*\(/);
    expect(src).not.toMatch(/\bconfirmSheet\b/);
  });

  test.each(['ReminderSheet.js', 'RepeatSheet.js', 'AuthSheet.js'])('%s — выбор вида через ChoiceList', (file) => {
    expect(code(file)).toMatch(/import ChoiceList from '\.\/ChoiceList'/);
  });
});

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

const ANCHOR = new Date(2026, 9, 17, 10, 0).toISOString();
const task = {
  id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 3_600_000,
  sessions: [{ start: '2026-10-10T09:00:00.000Z', end: '2026-10-10T10:00:00.000Z', ms: 3_600_000 }],
  tagIds: [], pinnedAt: null, dueAt: null, repeat: null, rate: null, notes: '', updatedAt: '2026-10-01T10:00:00.000Z',
  slots: [{ id: 'sl1', start: ANCHOR, end: new Date(2026, 9, 17, 12, 0).toISOString(), notifiedUpTo: null }],
};

let colors;
beforeEach(async () => {
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
  colors = (await renderHook(() => useColors())).result.current;
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

const show = async (el) => { openSheet(el); return render(<BottomSheet />); };

/** Подпись над полем или группой — textDim мелко, без заглавных и разрядки. */
function expectCaption(node) {
  const st = flat(node);
  expect(st.color).toBe(colors.textDim);
  expect(st.fontSize).toBe(fontSize.xs);
  expect(st.textTransform).toBeUndefined();
  expect(st.letterSpacing).toBeUndefined();
}

/** Серая строка-сводка листа: panel2 и скругление radius.md (InfoRow). */
function expectGreyRow(node) {
  const st = flat(node);
  expect(st.backgroundColor).toBe(colors.panel2);
  expect(st.borderRadius).toBe(radius.md);
}

/** Строка острова — та же, что в «Меню»: высота 46, поля spacing.md. */
function expectSettingRow(node) {
  const st = flat(node);
  expect(st.minHeight).toBe(46);
  expect(st.paddingHorizontal).toBe(spacing.md);
  expect(st.gap).toBe(spacing.md);
}

/** Остров строк в листе: panel2, скругление острова, без рамки. */
function expectIsland(node) {
  const st = flat(node);
  expect(st.backgroundColor).toBe(colors.panel2);
  expect(st.borderRadius).toBe(radius.lg);
  expect(st.borderWidth || 0).toBe(0);
}

/** Список-выбор с галочкой: общий ChoiceList, строки — radio. */
function expectChoiceList(node) {
  expect(flat(node).backgroundColor).toBe(colors.panel2);
  expect(within(node).getAllByRole('radio').length).toBeGreaterThan(1);
}

/** Подвал: кнопки колонкой во всю ширину, виды — по порядку.
 *  primary — акцент; ghost — серая подложка и обычная подпись; danger — серая
 *  подложка и красная подпись. */
function expectFooter(screen, kinds) {
  const footer = screen.getByTestId('sheet-footer-content');
  expect(flat(footer).flexDirection).not.toBe('row');
  const buttons = within(footer).getAllByTestId('primary-button');
  expect(buttons).toHaveLength(kinds.length);
  buttons.forEach((b, i) => {
    expect(flat(b).width).toBe('100%');
    const text = flat(within(b).getByText(/./));
    if (kinds[i] === 'primary') {
      expect(flat(b).backgroundColor).toBe(colors.accent);
    } else {
      expect(flat(b).backgroundColor).toBe(colors.panel2);
      if (kinds[i] === 'danger') expect(text.color).toBe(colors.danger);
      else expect(text.color).not.toBe(colors.danger);
    }
  });
}

/** На экране листа нет сегментов: ни вкладок, ни дорожки с подложкой. */
const expectNoSegments = (s) => expect(s.queryAllByRole('tab')).toHaveLength(0);

describe('вход', () => {
  test('«Войти / Создать аккаунт» — две строки с галочкой (ChoiceList), сегментов нет', async () => {
    const s = await show(<AuthSheet />);
    expectChoiceList(s.getByTestId('auth-mode'));
    expectNoSegments(s);
    expect(s.getByTestId('auth-mode-signin').props.accessibilityState.selected).toBe(true);
  });

  test('подписи полей — Block, «или» — без заглавных, «Войти через Google» — серая без рамки', async () => {
    const s = await show(<AuthSheet />);
    expectCaption(s.getByText(t('ru', 'auth.email_label')));
    expectCaption(s.getByText(t('ru', 'auth.password_label')));
    expect(flat(s.getByText(t('ru', 'auth.or_divider'))).textTransform).toBeUndefined();
    const google = flat(s.getByTestId('google-button'));
    expect(google.borderWidth || 0).toBe(0);
    expect(google.backgroundColor).toBe(colors.panel2);
  });

  test('подвал — одна главная кнопка', async () => {
    expectFooter(await show(<AuthSheet />), ['primary']);
  });
});

describe('дедлайн', () => {
  const due = (dueAt) => <DueSheet task={{ ...task, dueAt }} lang="ru" onApply={noop} onClear={noop} />;

  test('«Дата ›» и «Время ›» — строки острова, а не сегменты; выбор раскрывается под строкой, открыта одна', async () => {
    const s = await show(due(new Date(2026, 9, 9, 18, 37).toISOString()));
    expectNoSegments(s);
    expectIsland(s.getByTestId('due-rows'));
    expectSettingRow(s.getByTestId('due-date'));
    expectSettingRow(s.getByTestId('due-time'));
    within(s.getByTestId('due-time')).getByText('18:37');
    // У заданного дедлайна всё закрыто; «Время» раскрывает барабаны.
    expect(s.queryAllByTestId('wheel-window')).toHaveLength(0);
    await fireEvent.press(s.getByText(t('ru', 'due.time')));
    expect(s.getAllByTestId('wheel-window')).toHaveLength(2);
    expect(s.getByTestId('due-time').props.accessibilityState.expanded).toBe(true);
    // Открытая строка — значение акцентом.
    expect(flat(within(s.getByTestId('due-time')).getByText('18:37')).color).toBe(colors.accentInk);
    // «Дата» закрывает часы и открывает календарь.
    await fireEvent.press(s.getByText(t('ru', 'due.date')));
    expect(s.queryAllByTestId('wheel-window')).toHaveLength(0);
    expect(s.getByTestId('due-date').props.accessibilityState.expanded).toBe(true);
  });

  test('новый дедлайн начинают с даты — календарь уже раскрыт', async () => {
    const s = await show(due(null));
    expect(s.getByTestId('due-date').props.accessibilityState.expanded).toBe(true);
  });

  test('сводка — серая строка InfoRow, как у «Повторения»', async () => {
    const s = await show(due(new Date(2026, 9, 9, 18, 37).toISOString()));
    expectGreyRow(s.getByTestId('due-summary-row'));
    expect(s.getByTestId('due-summary').props.children).toMatch(/18:37/);
  });

  test('подвал: «Сохранить» и серая «Убрать дедлайн» под ней — только у существующего', async () => {
    expectFooter(await show(due(new Date(2026, 9, 9, 18, 37).toISOString())), ['primary', 'ghost']);
    expectFooter(await show(due(null)), ['primary']);
  });
});

describe('время работы', () => {
  test('дата, начало и конец — строки острова; повтор — одна строка «Повторение задачи ›»', async () => {
    const s = await show(<SlotSheet taskId="t1" />);
    expectNoSegments(s);
    expectIsland(s.getByTestId('slot-rows'));
    for (const id of ['slot-date', 'slot-start', 'slot-end', 'slot-task-repeat']) expectSettingRow(s.getByTestId(id));
    expect(s.queryByTestId('slot-repeat-info-row')).toBeNull();
    expect(s.queryByTestId('repeat-preset')).toBeNull();
  });

  test('подвал существующего отрезка: «Сохранить» и серая красная «Удалить время»', async () => {
    expectFooter(await show(<SlotSheet taskId="t1" slotId="sl1" />), ['primary', 'danger']);
  });
});

describe('перенос карточки', () => {
  test('«Переместить в» — Block, а не заглавные', async () => {
    const s = await show(<TaskMoveSheet taskId="t1" />);
    expectCaption(s.getByText(t('ru', 'board.move_to')));
  });
});

describe('экспорт', () => {
  test('подписи «Период» и «Проекты» — Block; сводка — InfoRow', async () => {
    const s = await show(<ExportPeriodSheet lang="ru" />);
    expectCaption(s.getByText(t('ru', 'export.period_label')));
    expectCaption(s.getByText(t('ru', 'export.projects_label')));
    expectGreyRow(s.getByTestId('export-summary-row'));
    expectFooter(s, ['primary']);
  });

  test('«С» и «По» своего периода — строки острова; открытая — значение акцентом, рамки нет', async () => {
    const s = await show(<ExportPeriodSheet lang="ru" />);
    await fireEvent.press(s.getByTestId('export-period'));
    await fireEvent.press(within(s.getByTestId('export-periods')).getByText(t('ru', 'export.period_custom')));
    expectIsland(s.getByTestId('export-dates'));
    expectSettingRow(s.getByTestId('export-from'));
    expect(s.getByTestId('export-from').props.accessibilityState.expanded).toBe(false);
    await fireEvent.press(s.getByTestId('export-from'));
    const open = s.getByTestId('export-from');
    expect(open.props.accessibilityState.expanded).toBe(true);
    expect(flat(open).borderWidth || 0).toBe(0);
    expect(flat(open).borderColor).toBeUndefined();
    const value = within(open).getAllByText(/./).at(-1);
    expect(flat(value).color).toBe(colors.accentInk);
  });
});

describe('профиль, тег, проект, запись', () => {
  // Круг 21: лист профиля — только имя (как на вебе); пароль, выход и
  // удаление — строками разделов «Аккаунт» и «Данные».
  test('имя: заголовок «Имя», одно поле без своей подписи и островов; подвал — «Сохранить»', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'me@example.com', name: 'Я' } });
    const s = await show(<ProfileSheet />);
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'profile.name_label'));
    expect(s.getByTestId('profile-name').props.value).toBe('Я');
    expect(s.queryByText(t('ru', 'auth.name_label'))).toBeNull();
    expect(s.queryByText('me@example.com')).toBeNull();
    expect(s.queryByText(t('ru', 'profile.change_password'))).toBeNull();
    expectFooter(s, ['primary']);
  });

  test('«Удалить аккаунт» из «Данных»: подтверждение без стрелки «назад», подвал — danger и серая «Отмена»', async () => {
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'me@example.com', name: 'Я' } });
    const s = await show(<ProfileSheet page="delete" />);
    within(s.getByTestId('sheet-head-row')).getByText(t('ru', 'account.delete_title'));
    expect(within(s.getByTestId('sheet-head-row')).queryByLabelText(t('ru', 'common.back'))).toBeNull();
    s.getByText(t('ru', 'account.delete_confirm'));
    expectFooter(s, ['danger', 'ghost']);
  });

  test('тег: подпись «Цвет» — Block мелким шрифтом (было fontSize.sm); подвал существующего — три кнопки', async () => {
    const s = await show(<TagEditSheet tag={{ id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null }} />);
    expectCaption(s.getByText(t('ru', 'tag.color_label')));
    expectFooter(s, ['primary', 'danger', 'ghost']);
  });

  test('тег: «Удалить» спрашивает подтверждение страницей этого же листа', async () => {
    const s = await show(<TagEditSheet tag={{ id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null }} />);
    const content = useSheetStore.getState().content;
    await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.delete')));
    expect(useSheetStore.getState().content).toBe(content);
    within(s.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back'));
    expectFooter(s, ['danger', 'ghost']);
    await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.delete')));
    expect(useAppStore.getState().tags).toEqual([]);
  });

  test('новый проект: крупное «Название», группы строк «Проект» и «Деньги» с подписями Block; подвал — «Создать проект» и серая «Отмена»', async () => {
    const s = await show(<NewProjectSheet onCreated={noop} onCancel={noop} />);
    expect(flat(s.getByTestId('project-form-name')).fontSize).toBe(fontSize.lg);
    for (const key of ['pdlg.sec_project', 'pdlg.sec_money']) expectCaption(s.getByText(t('ru', key)));
    expectIsland(s.getByTestId('project-form-group-project'));
    expectIsland(s.getByTestId('project-form-group-money'));
    for (const id of ['color', 'desc', 'marks', 'rate', 'currency']) expectSettingRow(s.getByTestId(`project-row-${id}`));
    expectFooter(s, ['primary', 'ghost']);
  });

  test('запись времени: строка задачи и дата — строки острова; подвал существующей — «Сохранить» и серая красная «Удалить»', async () => {
    const s = await show(<SessionSheet task={task} index={0} />);
    expectSettingRow(s.getByTestId('session-task'));
    expectSettingRow(s.getByTestId('session-date'));
    expectGreyRow(s.getByTestId('session-duration-row'));
    expectFooter(s, ['primary', 'danger']);
  });

  test('быстрая задача: подпись ячейки — Block над полем; из шапки проект — строка острова и страница выбора', async () => {
    const s = await show(<QuickTaskSheet projectId="p1" statusId="s1" contextLabel="В работе" />);
    expectCaption(s.getByText('В работе'));
    expectFooter(s, ['primary', 'ghost']);
    const h = await show(<QuickTaskSheet pickProject />);
    expectSettingRow(h.getByTestId('quick-project'));
    await fireEvent.press(h.getByTestId('quick-project'));
    within(h.getByTestId('sheet-head-row')).getByText(t('ru', 'board.pick_project'));
    within(h.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back'));
  });

  test('меню: пункты — строки острова без шеврона; опасный — своим островом, красный', async () => {
    const s = await show(<MenuSheet title="Сайт" items={[
      { key: 'a', label: 'Настройки', icon: 'settings', onPress: noop },
      { key: 'b', label: 'Экспорт', icon: 'download', onPress: noop },
      { key: 'c', label: 'Удалить', icon: 'trash', danger: true, separated: true, onPress: noop },
    ]} />);
    for (const k of ['a', 'b', 'c']) expectSettingRow(s.getByTestId(`menu-${k}`));
    expect(flat(within(s.getByTestId('menu-c')).getByText('Удалить')).color).toBe(colors.danger);
    // Опасный пункт — в другом острове, чем остальные.
    const islandOf = (id) => s.getByTestId(id).parent;
    expect(islandOf('menu-a')).toBe(islandOf('menu-b'));
    expect(islandOf('menu-c')).not.toBe(islandOf('menu-a'));
  });
});

// Строки настроек (12 октября 2026): в листе группа строк — подпись Block над
// островом panel2 со скруглением острова, строки — общая SettingRow (та же,
// что в «Меню»): высота 46, поля spacing.md, значение textFaint 13.
describe('строки настроек в листах', () => {
  test('настройки проекта: подписи групп — Block, острова — panel2, строки — общие, подвала нет', async () => {
    const s = await show(<NewProjectSheet project={{ id: 'p1', name: 'Сайт', color: '#87ff65' }} onCreated={noop} onCancel={noop} onOpenStatuses={noop} />);
    for (const key of ['pdlg.sec_project', 'pdlg.sec_money', 'pdlg.sec_setup']) expectCaption(s.getByText(t('ru', key)));
    for (const id of ['project-group-project', 'project-group-money', 'project-group-setup']) expectIsland(s.getByTestId(id));
    for (const id of ['name', 'color', 'marks', 'rate', 'currency', 'statuses', 'versions', 'tags']) expectSettingRow(s.getByTestId(`project-row-${id}`));
    expect(s.queryByTestId('sheet-footer-content')).toBeNull();
  });

  test('время работы списком: остров panel2, строки отрезков и «Добавить время» — общие строки', async () => {
    const s = await show(<SlotListSheet taskId="t1" />);
    expectSettingRow(s.getByTestId('slot-list-sl1'));
    expectSettingRow(s.getByTestId('slot-list-add'));
    expectIsland(s.getByTestId('slot-list-island'));
  });

  test('ставка: поле с единицей и подсказкой Hint; подвал — одна «Сохранить»', async () => {
    const s = await show(<RateSheet lang="ru" title="Ставка в час" initialValue={null} placeholder="1000" unit="₽/ч" hint="Подсказка" nullable onSave={noop} />);
    s.getByText('₽/ч');
    expect(flat(s.getByText('Подсказка')).color).toBe(colors.textFaint);
    expect(flat(s.getByText('Подсказка')).fontSize).toBe(fontSize.xs);
    expectFooter(s, ['primary']);
  });
});

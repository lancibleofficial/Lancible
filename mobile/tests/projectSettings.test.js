// Настройки проекта и создание проекта (components/NewProjectSheet.js) и одна
// строка настройки на три места (components/Island.js, SettingRow).
// Запуск: npm run test:mobile
//
// 12 октября 2026, три правила настроек телефона (DESIGN.md, «Настройки на
// телефоне: одна логика»): быстрый выбор — чипами на месте; всё, у чего свои
// параметры, — строкой «название · значение ›» на острове, тап открывает
// страницу или лист этой настройки; строки сгруппированы по вопросу, подпись
// группы (Block) над островом.
//
// Настройки проекта — короткий список: «Проект» (название и описание, цвет,
// метки), «Деньги» (ставка, валюта), «Устройство проекта» (статусы, версии,
// теги проекта). Значение каждой строки — словами; выбор на странице
// сохраняется сразу, у полей — своя «Сохранить». Создание (12 октября 2026) —
// то же, что настройки: крупное поле названия сверху, строки «Проект» (цвет,
// описание, метки) и «Деньги» (ставка, валюта) со страницами, подвал
// «Создать проект» и «Отмена».
import { StyleSheet } from 'react-native';
import { render, renderHook, fireEvent, within, act } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import NewProjectSheet from '../src/components/NewProjectSheet';
import TaskDetailScreen from '../src/screens/TaskDetailScreen';
import SettingsSectionScreen from '../src/screens/SettingsSectionScreen';
import { useAppStore } from '../src/store/useAppStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { fmtMoney } from '../src/lib/format';
import { useColors, fontSize, radius, spacing } from '../src/theme';
import { t, T } from '../src/lib/i18n';

jest.mock('../src/components/DocEditor', () => () => null);

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const noop = () => {};
const LANGS = ['ru', 'en', 'uk', 'kk'];
const BACK = t('ru', 'common.back');
const perHour = (n, cur = 'RUB') => `${fmtMoney(n, 'ru', cur)}${t('ru', 'rate.per_hour')}`;
const live = () => useAppStore.getState().projects.find((p) => p.id === 'p1');

beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAuthStore.setState({ status: 'signedOut', user: null, signOut: jest.fn() });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 1000 },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', description: 'Лендинг', tagIds: ['g1', 'g2'], createdAt: '2026-10-01T00:00:00.000Z' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p1', name: 'Готово', color: '#87ff65', kind: 'done', order: 1 },
    ],
    versions: [],
    tags: [
      { id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null },
      { id: 'g2', name: 'срочно', color: '#ff7a7a', projectId: null },
    ],
    tasks: [{
      id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [],
      pinnedAt: null, dueAt: null, repeat: null, rate: null, notes: '',
    }],
    documents: [],
    activeTimer: null,
  });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

const project = { id: 'p1', name: 'Сайт', color: '#87ff65' };
async function settings(props = {}) {
  const onOpenStatuses = jest.fn();
  openSheet(<NewProjectSheet project={project} onCreated={noop} onCancel={noop} onOpenStatuses={onOpenStatuses} {...props} />);
  const s = await render(<BottomSheet />);
  return { s, onOpenStatuses };
}
const value = (s, id) => s.getByTestId(`project-row-${id}-value`).props.children;
const headTitle = () => useSheetStore.getState().header && useSheetStore.getState().header.title;

describe('настройки проекта: список строк', () => {
  test('три группы с подписью Block над островом: «Проект», «Деньги», «Устройство проекта»; подвала нет', async () => {
    const { result } = await renderHook(() => useColors());
    const { s } = await settings();
    // Заголовок листа — название проекта, стрелки нет.
    expect(useSheetStore.getState().header).toEqual({ title: 'Сайт', onBack: null });
    const groups = [['project-group-project', 'pdlg.sec_project'], ['project-group-money', 'pdlg.sec_money'], ['project-group-setup', 'pdlg.sec_setup']];
    for (const [id, key] of groups) {
      const island = s.getByTestId(id);
      expect(flat(island)).toMatchObject({ backgroundColor: result.current.panel2, borderRadius: radius.lg });
      const caption = flat(s.getByText(t('ru', key)));
      expect(caption.color).toBe(result.current.textDim);
      expect(caption.fontSize).toBe(fontSize.xs);
      expect(caption.textTransform).toBeUndefined();
    }
    expect(t('ru', 'pdlg.sec_money')).toBe('Деньги');
    expect(t('ru', 'pdlg.sec_setup')).toBe('Устройство проекта');
    within(s.getByTestId('project-group-project')).getByTestId('project-row-name');
    within(s.getByTestId('project-group-project')).getByTestId('project-row-color');
    within(s.getByTestId('project-group-project')).getByTestId('project-row-marks');
    within(s.getByTestId('project-group-money')).getByTestId('project-row-rate');
    within(s.getByTestId('project-group-money')).getByTestId('project-row-currency');
    within(s.getByTestId('project-group-setup')).getByTestId('project-row-statuses');
    within(s.getByTestId('project-group-setup')).getByTestId('project-row-versions');
    within(s.getByTestId('project-group-setup')).getByTestId('project-row-tags');
    // Всё сохраняется сразу — у списка нет ни «Сохранить», ни «Отмены».
    expect(s.queryByTestId('sheet-footer-content')).toBeNull();
  });

  test('значения строк словами: название, кружок цвета, метки, «общая — …», «как в настройках (RUB)», счётчики и «нет»', async () => {
    const { s } = await settings();
    within(s.getByTestId('project-row-name')).getByText(t('ru', 'pdlg.name_desc'));
    within(s.getByTestId('project-row-name')).getByText('Сайт');
    expect(flat(s.getByTestId('project-row-color-value')).backgroundColor).toBe('#87ff65');
    // Метки: первая плашкой и «+N».
    const marks = s.getByTestId('project-row-marks-value');
    within(marks).getByText('клиент');
    within(marks).getByText('+1');
    expect(value(s, 'rate')).toBe(t('ru', 'rate.shared', { rate: perHour(1000) }));
    expect(value(s, 'currency')).toBe(t('ru', 'pdlg.currency_inherit', { cur: 'RUB' }));
    expect(value(s, 'statuses')).toBe('2');
    expect(value(s, 'versions')).toBe(t('ru', 'common.none_value'));
    expect(value(s, 'tags')).toBe(t('ru', 'common.none_value'));
    expect(t('ru', 'common.none_value')).toBe('нет');

    // Своё у проекта — своим значением; меняется сразу, без переоткрытия.
    await act(async () => {
      useAppStore.setState((st) => ({
        projects: st.projects.map((p) => ({ ...p, rate: 5000, currency: 'KZT', tagIds: [] })),
        versions: ['1', '2', '3'].map((name, i) => ({ id: `v${i}`, projectId: 'p1', name, order: i, releasedAt: null, createdAt: '2026-10-01T00:00:00.000Z' })),
        tags: [...st.tags, { id: 'g3', name: 'дизайн', color: '#87ff65', projectId: 'p1' }],
      }));
    });
    expect(value(s, 'rate')).toBe(perHour(5000, 'KZT'));
    expect(value(s, 'rate')).toMatch(/₸\/ч$/);
    expect(value(s, 'currency')).toBe('KZT (₸)');
    expect(value(s, 'versions')).toBe('3');
    expect(value(s, 'tags')).toBe('1');
    within(s.getByTestId('project-row-marks')).getByText(t('ru', 'common.none_value'));
  });

  test('«Название и описание» — страница с двумя полями и «Сохранить»; сохранение — в проект и назад к списку', async () => {
    const { s } = await settings();
    await fireEvent.press(s.getByTestId('project-row-name'));
    expect(headTitle()).toBe(t('ru', 'pdlg.name_desc'));
    within(s.getByTestId('sheet-head-row')).getByLabelText(BACK);
    expect(s.getByTestId('project-form-name').props.value).toBe('Сайт');
    expect(s.getByTestId('project-form-desc').props.value).toBe('Лендинг');
    await fireEvent.changeText(s.getByTestId('project-form-name'), 'Сайт 2.0');
    await fireEvent.changeText(s.getByTestId('project-form-desc'), 'Новый лендинг');
    await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.save')));
    expect(live()).toMatchObject({ name: 'Сайт 2.0', description: 'Новый лендинг' });
    // Назад к списку: новое значение в строке и в заголовке.
    within(s.getByTestId('project-row-name')).getByText('Сайт 2.0');
    expect(headTitle()).toBe('Сайт 2.0');
  });

  test('«Назад» без «Сохранить» ничего не пишет, и поле в следующий раз — живое значение', async () => {
    const { s } = await settings();
    await fireEvent.press(s.getByTestId('project-row-name'));
    await fireEvent.changeText(s.getByTestId('project-form-name'), 'Черновик');
    await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(BACK));
    expect(live().name).toBe('Сайт');
    await fireEvent.press(s.getByTestId('project-row-name'));
    expect(s.getByTestId('project-form-name').props.value).toBe('Сайт');
  });

  test('«Цвет» — страница с палитрой: выбор пишется сразу и возвращает к списку', async () => {
    const { s } = await settings();
    await fireEvent.press(s.getByTestId('project-row-color'));
    expect(headTitle()).toBe(t('ru', 'pdlg.color_label'));
    s.getByTestId('color-grid');
    // Выбор не закрывает лист: страница внутри него.
    await fireEvent.press(s.getByTestId('color-#5ec8f2'));
    expect(live().color).toBe('#5ec8f2');
    expect(useSheetStore.getState().content).not.toBeNull();
    expect(flat(s.getByTestId('project-row-color-value')).backgroundColor).toBe('#5ec8f2');
  });

  test('«Метки проекта» — выбор тегов: отметка пишется сразу, «Готово» — назад', async () => {
    const { s } = await settings();
    await fireEvent.press(s.getByTestId('project-row-marks'));
    expect(headTitle()).toBe(t('ru', 'pdlg.marks_label'));
    s.getByPlaceholderText(t('ru', 'tag.search_ph'));
    await fireEvent.press(within(s.getByTestId('tag-list')).getByText('клиент'));
    expect(live().tagIds).toEqual(['g2']);
    await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.ok')));
    within(s.getByTestId('project-row-marks-value')).getByText('срочно');
  });

  test('«Ставка» — страница с полем, «₽/ч» и подсказкой; «Сохранить» пишет ставку, пустое — общая', async () => {
    const { s } = await settings();
    await fireEvent.press(s.getByTestId('project-row-rate'));
    expect(headTitle()).toBe(t('ru', 'pdlg.rate_label'));
    const input = s.getByTestId('project-form-rate');
    expect(input.props.keyboardType).toBe('decimal-pad');
    s.getByText(`₽${t('ru', 'rate.per_hour')}`);
    s.getByText(t('ru', 'pdlg.rate_hint', { rate: '1 000 ₽' }));
    await fireEvent.changeText(input, '2500');
    await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.save')));
    expect(live().rate).toBe(2500);
    expect(value(s, 'rate')).toBe(perHour(2500));
    await fireEvent.press(s.getByTestId('project-row-rate'));
    expect(s.getByTestId('project-form-rate').props.value).toBe('2500');
    await fireEvent.changeText(s.getByTestId('project-form-rate'), '');
    await fireEvent.press(within(s.getByTestId('sheet-footer-content')).getByText(t('ru', 'common.save')));
    expect(live().rate).toBeNull();
  });

  test('«Валюта» — список валют: выбор пишется сразу и возвращает к списку', async () => {
    const { s } = await settings();
    await fireEvent.press(s.getByTestId('project-row-currency'));
    expect(headTitle()).toBe(t('ru', 'pdlg.currency_label'));
    await fireEvent.press(s.getByText('USD ($)'));
    expect(live().currency).toBe('USD');
    expect(value(s, 'currency')).toBe('USD ($)');
  });

  test('«Статусы» ведут на экран статусов; «Версии» — страница версий; «Теги проекта» — их список со сценкой и «Новый тег проекта»', async () => {
    const { s, onOpenStatuses } = await settings();
    await fireEvent.press(s.getByTestId('project-row-statuses'));
    expect(onOpenStatuses).toHaveBeenCalledTimes(1);

    await fireEvent.press(s.getByTestId('project-row-versions'));
    expect(headTitle()).toBe(t('ru', 'pdlg.sec_versions'));
    s.getByTestId('version-new-name');
    await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(BACK));

    await fireEvent.press(s.getByTestId('project-row-tags'));
    expect(headTitle()).toBe(t('ru', 'pdlg.sec_tags'));
    s.getByText(t('ru', 'tag.project_empty'));
    s.getByText(t('ru', 'tag.global_hint'));
    // «Новый тег проекта» — правка тега глубже; «назад» — к тегам проекта.
    await fireEvent.press(s.getByTestId('project-own-tag-add'));
    expect(headTitle()).toBe(t('ru', 'tag.project_add'));
    await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(BACK));
    expect(headTitle()).toBe(t('ru', 'pdlg.sec_tags'));
  });

  test('теги проекта списком строк: точка цвета, название, где используется; тап — правка тега', async () => {
    useAppStore.setState((st) => ({ tags: [...st.tags, { id: 'g3', name: 'дизайн', color: '#87ff65', projectId: 'p1' }] }));
    const { s } = await settings({ section: 'tags' });
    const row = s.getByTestId('project-own-tag-g3');
    within(row).getByText('дизайн');
    within(row).getByText(t('ru', 'tag.unused'));
    await fireEvent.press(row);
    expect(headTitle()).toBe(t('ru', 'tag.dialog_edit'));
  });
});

describe('настройки проекта: проп section открывает страницу сразу', () => {
  test.each([
    ['name', 'pdlg.name_desc'],
    ['color', 'pdlg.color_label'],
    ['marks', 'pdlg.marks_label'],
    ['rate', 'pdlg.rate_label'],
    ['money', 'pdlg.rate_label'],
    ['currency', 'pdlg.currency_label'],
    ['versions', 'pdlg.sec_versions'],
    ['tags', 'pdlg.sec_tags'],
  ])('%s → страница «%s», «назад» — к списку', async (section, key) => {
    const { s } = await settings({ section });
    expect(headTitle()).toBe(t('ru', key));
    expect(s.queryByTestId('project-group-project')).toBeNull();
    await fireEvent.press(within(s.getByTestId('sheet-head-row')).getByLabelText(BACK));
    s.getByTestId('project-group-project');
    expect(headTitle()).toBe('Сайт');
  });

  test.each(['main', 'statuses', undefined])('%s → список строк', async (section) => {
    const { s, onOpenStatuses } = await settings({ section });
    s.getByTestId('project-group-setup');
    expect(onOpenStatuses).not.toHaveBeenCalled();
  });
});

describe('создание проекта', () => {
  const showNew = async (props) => {
    openSheet(<NewProjectSheet onCreated={noop} onCancel={noop} {...props} />);
    return render(<BottomSheet />);
  };
  const head = (s) => within(s.getByTestId('sheet-head-row'));
  const footer = (s) => within(s.getByTestId('sheet-footer-content'));

  test('сверху — крупное поле «Название» с фокусом; ниже строки «Проект» (цвет, описание, метки) и «Деньги» (ставка, валюта); подписи «появятся после» нет', async () => {
    const s = await showNew();
    const name = s.getByTestId('project-form-name');
    expect(name.props.autoFocus).toBe(true);
    expect(name.props.placeholder).toBe(t('ru', 'pdlg.name_ph'));
    expect(flat(name).fontSize).toBe(fontSize.lg);
    const projectGroup = s.getByTestId('project-form-group-project');
    expect(flat(projectGroup).backgroundColor).toBe((await renderHook(() => useColors())).result.current.panel2);
    s.getByText(t('ru', 'pdlg.sec_project'));
    s.getByText(t('ru', 'pdlg.sec_money'));
    const labels = (id) => within(s.getByTestId(id)).getAllByRole('button').map((r) => within(r).getAllByText(/./)[0].props.children);
    expect(labels('project-form-group-project')).toEqual([t('ru', 'pdlg.color_label'), t('ru', 'pdlg.desc_label'), t('ru', 'pdlg.marks_label')]);
    expect(labels('project-form-group-money')).toEqual([t('ru', 'pdlg.rate_row'), t('ru', 'pdlg.currency_row')]);
    // Значения словами: описания и меток нет, ставка общая, валюта — как в настройках.
    expect(s.getByTestId('project-row-desc-value').props.children).toBe(t('ru', 'common.none_value'));
    within(s.getByTestId('project-row-marks')).getByText(t('ru', 'common.none_value'));
    expect(s.getByTestId('project-row-rate-value').props.children).toBe(t('ru', 'rate.shared', { rate: perHour(1000) }));
    expect(s.getByTestId('project-row-currency-value').props.children).toBe(t('ru', 'pdlg.currency_inherit', { cur: 'RUB' }));
    // Ни строк настроек, ни статусов, версий и тегов проекта — их ещё нет.
    expect(s.queryByTestId('project-group-setup')).toBeNull();
    expect(s.queryByText(t('ru', 'pdlg.sec_statuses'))).toBeNull();
    expect(s.queryByText(t('ru', 'pdlg.sec_versions'))).toBeNull();
    for (const lang of LANGS) {
      expect('pdlg.create_first' in T[lang]).toBe(false);
      expect('pdlg.statuses_hint' in T[lang]).toBe(false);
    }
    // Подвал: «Создать проект» (главная) и «Отмена» (серая).
    footer(s).getByText(t('ru', 'home.create'));
    footer(s).getByText(t('ru', 'common.cancel'));
  });

  test('каждая строка открывает свою страницу со стрелкой «назад»; выбранное — значением строки', async () => {
    const s = await showNew();
    // Цвет — палитра; выбор возвращает к форме.
    await fireEvent.press(s.getByTestId('project-row-color'));
    head(s).getByText(t('ru', 'pdlg.color_label'));
    head(s).getByLabelText(BACK);
    await fireEvent.press(s.getByTestId('color-#5ec8f2'));
    expect(flat(s.getByTestId('project-row-color-value')).backgroundColor).toBe('#5ec8f2');
    // Описание — поле и «Готово».
    await fireEvent.press(s.getByTestId('project-row-desc'));
    head(s).getByText(t('ru', 'pdlg.desc_label'));
    await fireEvent.changeText(s.getByTestId('project-form-desc'), 'Лендинг клиента');
    await fireEvent.press(footer(s).getByText(t('ru', 'common.done')));
    expect(s.getByTestId('project-row-desc-value').props.children).toBe('Лендинг клиента');
    // Ставка — поле с единицей, подсказкой и «Готово».
    await fireEvent.press(s.getByTestId('project-row-rate'));
    head(s).getByText(t('ru', 'pdlg.rate_label'));
    s.getByText(/Пусто — общая/);
    await fireEvent.changeText(s.getByTestId('project-form-rate'), '700');
    await fireEvent.press(footer(s).getByText(t('ru', 'common.done')));
    expect(s.getByTestId('project-row-rate-value').props.children).toBe(perHour(700));
    // Валюта — список; выбор возвращает к форме.
    await fireEvent.press(s.getByTestId('project-row-currency'));
    head(s).getByText(t('ru', 'pdlg.currency_label'));
    await fireEvent.press(s.getByText('USD ($)'));
    expect(s.getByTestId('project-row-currency-value').props.children).toBe('USD ($)');
    // Метки — выбор тегов и «ОК».
    await fireEvent.press(s.getByTestId('project-row-marks'));
    head(s).getByText(t('ru', 'pdlg.marks_label'));
    await fireEvent.press(within(s.getByTestId('tag-list')).getByText('клиент'));
    await fireEvent.press(footer(s).getByText(t('ru', 'common.ok')));
    within(s.getByTestId('project-row-marks-value')).getByText('клиент');
    // «Назад» со страницы ничего не теряет — подвал формы на месте.
    await fireEvent.press(s.getByTestId('project-row-desc'));
    await fireEvent.press(head(s).getByLabelText(BACK));
    footer(s).getByText(t('ru', 'home.create'));
    // Фокус на названии — только при открытии: возврат со страницы клавиатуру не поднимает.
    expect(s.getByTestId('project-form-name').props.autoFocus).toBe(false);
  });

  test('«Создать проект» заводит проект со всем, что набрали на страницах; без названия — не заводит', async () => {
    const onCreated = jest.fn();
    const s = await showNew({ onCreated });
    // Без названия кнопка неактивна.
    await fireEvent.press(footer(s).getByText(t('ru', 'home.create')));
    expect(onCreated).not.toHaveBeenCalled();
    await fireEvent.changeText(s.getByTestId('project-form-name'), 'Новый');
    await fireEvent.press(s.getByTestId('project-row-desc'));
    await fireEvent.changeText(s.getByTestId('project-form-desc'), 'Описание');
    await fireEvent.press(footer(s).getByText(t('ru', 'common.done')));
    await fireEvent.press(s.getByTestId('project-row-rate'));
    await fireEvent.changeText(s.getByTestId('project-form-rate'), '700');
    await fireEvent.press(footer(s).getByText(t('ru', 'common.done')));
    await fireEvent.press(s.getByTestId('project-row-currency'));
    await fireEvent.press(s.getByText('USD ($)'));
    await fireEvent.press(footer(s).getByText(t('ru', 'home.create')));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0]).toMatchObject({ name: 'Новый', description: 'Описание', rate: 700, currency: 'USD' });
  });
});

// Одна строка настройки на три места: «Меню», «Сведения» задачи и настройки
// проекта — высота, поля, значение и шеврон одни (SettingRow).
describe('одна строка настройки', () => {
  const rowLook = (node) => {
    const st = flat(node);
    return { minHeight: st.minHeight, paddingHorizontal: st.paddingHorizontal, gap: st.gap, paddingVertical: st.paddingVertical };
  };

  test('«Язык» в «Меню», «Дедлайн» в сведениях задачи и «Название и описание» в настройках проекта — одна и та же строка', async () => {
    const { result } = await renderHook(() => useColors());
    // «Язык» с 17 октября 2026 — в разделе «Основное» меню.
    const menu = await render(<SettingsSectionScreen navigation={{ navigate: noop }} route={{ params: { section: 'main' } }} />);
    const langRow = menu.getByText(t('ru', 'nav.language'));
    // Строка — нажимаемый предок подписи.
    const rowOf = (label) => { let n = label.parent; while (n && !n.props.onClick && !n.props.onPress && n.props.accessibilityRole !== 'button') n = n.parent; return n; };
    const settingsLook = rowLook(rowOf(langRow));
    expect(settingsLook).toEqual({ minHeight: 46, paddingHorizontal: spacing.md, gap: spacing.md, paddingVertical: spacing.sm + 2 });
    const settingsValue = flat(menu.getByText('Русский'));
    expect(settingsValue).toMatchObject({ color: result.current.textFaint, fontSize: 13 });

    const task = await render(<TaskDetailScreen navigation={{ navigate: noop, setOptions: noop, goBack: noop, getState: () => ({ routes: [], index: 0 }) }} route={{ params: { taskId: 't1' } }} />);
    expect(rowLook(task.getByTestId('task-due-row'))).toEqual(settingsLook);
    expect(flat(task.getByTestId('task-due-value'))).toMatchObject({ color: result.current.textFaint, fontSize: 13 });

    const { s } = await settings();
    expect(rowLook(s.getByTestId('project-row-name'))).toEqual(settingsLook);
    expect(flat(within(s.getByTestId('project-row-name')).getByText('Сайт'))).toMatchObject({ color: result.current.textFaint, fontSize: 13 });
  });
});

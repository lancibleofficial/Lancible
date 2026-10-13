// Листы «Повторение задачи» и «Напоминание» — обычные кирпичи нижних листов,
// своего вида у них нет (DESIGN.md, «Нижние листы»). Запуск: npm run test:mobile
//
// 12 октября 2026: сегментов в листах нет. Выбор вида — строки с галочкой
// (общий ChoiceList: подложка panel2 на весь список, галочка accentInk), число
// — общий Field во всю строку, единица — чипами или тихим словом, переключатель
// копий — строка острова (SettingRow) с Switch справа и подсказкой под
// островом, дата и время — строки острова с выбором под строкой (ExpandRow),
// сводка — серая строка InfoRow, подвал — кнопки колонкой. Правила и значения
// листов — repeatSheetModes.test.js и ReminderSheet.test.js.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Platform, StyleSheet } from 'react-native';
import { render, renderHook, within } from '@testing-library/react-native';
import BottomSheet from '../src/components/BottomSheet';
import RepeatSheet from '../src/components/RepeatSheet';
import ReminderSheet from '../src/components/ReminderSheet';
import * as Controls from '../src/components/RepeatControls';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { useColors, buttonHeight, fontSize, radius, spacing } from '../src/theme';
import Reminders from '../src/core/reminders.js';
import { t } from '../src/lib/i18n';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const noop = () => {};
const ANCHOR = new Date(2026, 9, 17, 10, 0).toISOString();
const weekly = { freq: 'week', every: 1, weekdays: [1], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };

let os;
const setOS = (name) => { os = jest.replaceProperty(Platform, 'OS', name); };
afterEach(() => { if (os) os.restore(); os = null; });

let colors;
beforeEach(async () => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#69d345' }],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [{ id: 't1', projectId: 'p1', title: 'Вёрстка', statusId: 's1', done: false, totalMs: 0, tagIds: [], sessions: [], dueAt: ANCHOR }],
  });
  colors = (await renderHook(() => useColors())).result.current;
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

// weekly с днём — нестандартное правило: «Настроить…» раскрыта сразу.
const showRepeat = async (props) => {
  openSheet(<RepeatSheet lang="ru" rule={weekly} onApply={noop} onClear={noop} anchorAt={ANCHOR} {...props} />);
  return render(<BottomSheet />);
};
const showReminder = async () => {
  openSheet(<ReminderSheet taskId="t1" />);
  return render(<BottomSheet />);
};

/** Список-выбор — общий ChoiceList: одна подложка panel2 на весь список. */
function expectChoiceList(node) {
  const st = flat(node);
  expect(st.backgroundColor).toBe(colors.panel2);
  expect(st.borderRadius).toBe(radius.lg);
  expect(st.borderWidth || 0).toBe(0);
  expect(within(node).getAllByRole('radio').length).toBeGreaterThan(1);
}

describe('выбор вида — строки с галочкой, сегментов нет', () => {
  test('сегментов в кирпичах больше нет: Segments ушёл из RepeatControls', () => {
    expect(Controls.Segments).toBeUndefined();
  });

  test('повтор: пресеты, способ задать месяц, отсчёт и окончание — общие списки с галочкой', async () => {
    const s = await showRepeat({ rule: { ...weekly, freq: 'month', weekdays: [], every: 2 } });
    for (const id of ['repeat-preset', 'repeat-month-mode', 'repeat-from', 'repeat-ends']) expectChoiceList(s.getByTestId(id));
    expect(s.queryAllByRole('tab')).toHaveLength(0);
    // Выбранный — галочка акцентом (accentInk), а не заливка строки.
    const picked = within(s.getByTestId('repeat-preset')).getByRole('radio', { selected: true });
    expect(flat(picked).backgroundColor).toBeUndefined();
  });

  test('напоминание: виды и частота — те же списки; единица — чипы', async () => {
    const s = await showReminder();
    expectChoiceList(s.getByTestId('remind-kind'));
    const unit = flat(s.getByTestId('remind-unit-min'));
    expect(unit.backgroundColor).toBe(colors.raise);
    expect(unit.borderRadius).toBe(999);
    expect(s.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('поле числа', () => {
  test('повтор: «Повторять каждые» — подпись над полем, общий Field во всю строку, единица — чипами справа', async () => {
    const s = await showRepeat();
    const caption = s.getByText(t('ru', 'repeat.every'));
    expect(flat(caption).color).toBe(colors.textDim);
    expect(flat(caption).fontSize).toBe(fontSize.xs);
    const field = s.getByLabelText(t('ru', 'repeat.every'));
    const st = flat(field);
    expect(st.backgroundColor).toBe(colors.inputBg);
    expect(st.minHeight).toBe(buttonHeight);
    expect(st.borderRadius).toBe(radius.md);
    expect(st.flex).toBe(1);
    expect(st.width).toBeUndefined();
    expect(st.textAlign).toBeUndefined();
    expect(st.borderWidth || 0).toBe(0);
    const units = within(s.getByTestId('repeat-freq')).getAllByRole('button').map((b) => within(b).getByText(/./).props.children);
    expect(units).toEqual(['unit_day', 'unit_week', 'unit_month', 'unit_year'].map((k) => t('ru', `repeat.${k}`)));
    expect(s.getByTestId('repeat-freq-week').props.accessibilityState.selected).toBe(true);
  });

  test('повтор: «После N раз» — тот же Field с единицей «раз»', async () => {
    const s = await showRepeat({ rule: { ...weekly, ends: { kind: 'after', count: 5, at: null } } });
    const field = s.getByLabelText(t('ru', 'repeat.ends_after'));
    expect(flat(field).flex).toBe(1);
    expect(flat(field).minHeight).toBe(buttonHeight);
    s.getByText(t('ru', 'repeat.ends_times'));
  });

  test('напоминание: своё число — Field без своей ширины, на всю строку', async () => {
    const s = await showReminder();
    const st = flat(s.getByTestId('remind-n'));
    expect(st.backgroundColor).toBe(colors.inputBg);
    expect(st.minHeight).toBe(buttonHeight);
    expect(st.width).toBeUndefined();
    expect(st.textAlign).toBeUndefined();
  });
});

describe('подписи', () => {
  test('над полями и списками — textDim fontSize.xs без заглавных, как «Период» в экспорте', async () => {
    const s = await showRepeat();
    for (const key of ['repeat.on_days', 'repeat.from_label', 'repeat.ends_label']) {
      const st = flat(s.getByText(t('ru', key)));
      expect(st.color).toBe(colors.textDim);
      expect(st.fontSize).toBe(fontSize.xs);
      expect(st.textTransform).toBeUndefined();
    }
    const r = await showReminder();
    const st = flat(r.getByText(t('ru', 'remind.how_long')));
    expect(st.color).toBe(colors.textDim);
    expect(st.textTransform).toBeUndefined();
  });
});

describe('переключатель копий', () => {
  test('строка острова: название слева, переключатель справа; подсказка — под островом, тише', async () => {
    setOS('android');
    const s = await showRepeat();
    const row = s.getByTestId('repeat-keep-row');
    within(row).getByText(t('ru', 'repeat.keep_history'));
    expect(within(row).getByRole('switch')).toBeTruthy();
    // Та же строка, что в «Меню»: высота 46, поля spacing.md.
    expect(flat(row).minHeight).toBe(46);
    expect(flat(row).paddingHorizontal).toBe(spacing.md);
    expect(within(row).queryByText(t('ru', 'repeat.keep_history_hint'))).toBeNull();
    const hint = flat(s.getByText(t('ru', 'repeat.keep_history_hint')));
    expect(hint.color).toBe(colors.textFaint);
    expect(hint.fontSize).toBe(fontSize.xs);
  });
});

describe('сводка и дата', () => {
  test('сводка — спокойная серая строка panel2, как у «Дедлайна»: не зелёная карточка', async () => {
    const s = await showRepeat();
    const row = flat(s.getByTestId('repeat-summary-row'));
    expect(row.backgroundColor).toBe(colors.panel2);
    expect(row.backgroundColor).not.toBe(colors.accentMuted);
    expect(row.borderRadius).toBe(radius.md);
    s.getByTestId('repeat-summary');
  });

  test('«До даты»: строка острова «Дата ›» — значок, подпись слева, значение справа, остров panel2', async () => {
    const s = await showRepeat({ rule: { ...weekly, ends: { kind: 'on', count: 10, at: null } } });
    const date = s.getByTestId('repeat-ends-at');
    within(date).getByText(t('ru', 'sdlg.date_label'));
    within(date).getByText(t('ru', 'due.none'));
    expect(flat(date).minHeight).toBe(46);
    expect(flat(s.getByTestId('repeat-ends-date')).backgroundColor).toBe(colors.panel2);
  });
});

describe('квадраты дней', () => {
  test('на panel2 без рамки; выбранный залит акцентом', async () => {
    const s = await showRepeat();
    const off = flat(s.getByTestId('weekday-chips-3'));
    expect(off.backgroundColor).toBe(colors.panel2);
    expect(off.borderWidth || 0).toBe(0);
    const on = flat(s.getByTestId('weekday-chips-1'));
    expect(on.backgroundColor).toBe(colors.accent);
    expect(on.borderWidth || 0).toBe(0);
  });
});

describe('подвал', () => {
  test('повтор: одна главная кнопка во всю ширину; «Не повторяется» — строка списка', async () => {
    const s = await showRepeat();
    const buttons = within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button');
    expect(buttons.map((b) => within(b).getByText(/./).props.children)).toEqual([t('ru', 'common.done')]);
    expect(flat(buttons[0]).width).toBe('100%');
    expect(flat(buttons[0]).backgroundColor).toBe(colors.accent);
    within(s.getByTestId('repeat-preset')).getByText(t('ru', 'repeat.none'));
    expect(flat(s.getByTestId('sheet-footer-content')).flexDirection).not.toBe('row');
  });

  test('напоминание: «Сохранить» и серая «Удалить напоминание» с красной подписью, во всю ширину', async () => {
    useAppStore.setState((st) => ({
      tasks: st.tasks.map((x) => ({ ...x, ...Reminders.withReminders(x, [{ id: 'a', kind: 'at', at: ANCHOR }]) })),
    }));
    openSheet(<ReminderSheet taskId="t1" reminderId="a" />);
    const s = await render(<BottomSheet />);
    const buttons = within(s.getByTestId('sheet-footer-content')).getAllByTestId('primary-button');
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(flat(b).width).toBe('100%');
    expect(flat(buttons[1]).backgroundColor).toBe(colors.panel2);
    expect(flat(within(buttons[1]).getByText(t('ru', 'remind.delete'))).color).toBe(colors.danger);
  });
});

describe('исходники: своего вида у листов нет', () => {
  const src = (name) => readFileSync(join(__dirname, '..', 'src', 'components', name), 'utf8');

  test.each(['RepeatSheet.js', 'ReminderSheet.js', 'RepeatControls.js'])('%s — ни рамок, ни заглавных подписей, ни своей ширины поля, ни сегментов', (file) => {
    const code = src(file).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/borderWidth/);
    expect(code).not.toMatch(/borderColor/);
    expect(code).not.toMatch(/textTransform/);
    expect(code).not.toMatch(/letterSpacing/);
    expect(code).not.toMatch(/\bwidth: \d+/);
    expect(code).not.toMatch(/footerGhost|footerDone|everyInput|nInput/);
    expect(code).not.toMatch(/Segment/);
  });
});

// «Время работы» на календаре и на «Сегодня». Запуск: npm run test:mobile
//
// Вхождения отрезков считает ядро (core/slots.js, slotItems: его юниты —
// tests/unit/slots.test.js). Здесь — что их показывают: на часовой сетке
// плановой полосой под блоками записей, на «Сегодня» — островом выбранного дня.
import { StyleSheet } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';
import AgendaGrid, { HOUR_H } from '../src/components/AgendaGrid';
import HomeScreen from '../src/screens/HomeScreen';
import { useAppStore } from '../src/store/useAppStore';
import { t } from '../src/lib/i18n';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const H = 3_600_000;
// Суббота 17 октября 2026 — день сетки; даты явные, время не плавает.
const DAY = new Date(2026, 9, 17).getTime();
const ms = (day, h, m = 0) => new Date(2026, 9, day, h, m).getTime();
const iso = (day, h, m = 0) => new Date(ms(day, h, m)).toISOString();
const COLOR = '#5ec8f2';
const project = { id: 'p1', name: 'Сайт', color: COLOR, createdAt: '2026-10-01T00:00:00.000Z' };
const base = { projectId: 'p1', statusId: 's1', done: false, cancelled: false, totalMs: 0, sessions: [], tagIds: [], dueAt: null };
// Своего повтора у отрезка нет: правило — у задачи (core/slots.js).
const slot = (extra) => ({ id: 'sl1', start: iso(17, 10), end: iso(17, 12), remindOffsetMin: null, notifiedUpTo: null, ...extra });
const task = (extra) => ({ ...base, id: 't1', title: 'Вёрстка', slots: [slot()], ...extra });

const grid = (tasks, props) => render(
  <AgendaGrid
    tasks={tasks}
    projects={[project]}
    from={DAY}
    days={1}
    nowMs={ms(17, 8)}
    lang="ru"
    onTapBlock={jest.fn()}
    onTapDeadline={jest.fn()}
    onCreate={jest.fn()}
    onMove={jest.fn()}
    {...props}
  />,
);
const planned = (s) => s.queryAllByTestId(/^agenda-plan-/);

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [project],
    statuses: [{ id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 }],
    tasks: [],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui, notifSeenAt: null },
  });
});

describe('плановый слой на часовой сетке', () => {
  test('отрезок — полоса с testID: по часам сетки, цвет проекта контуром, во всю ширину столбца', async () => {
    const s = await grid([task()]);
    const bands = planned(s);
    expect(bands).toHaveLength(1);
    expect(bands[0].props.testID).toBe(`agenda-plan-t1-sl1-${ms(17, 10)}`);
    const st = flat(bands[0]);
    // 10:00–12:00 = 10 и 12 часов от верха сетки.
    expect(st.top).toBeCloseTo(10 * HOUR_H, 5);
    expect(st.height).toBeCloseTo(2 * HOUR_H, 5);
    expect(st.borderColor).toBe(COLOR);
    expect(st.borderWidth).toBeGreaterThan(0);
    // Контур, а не сплошной блок: заливка — полупрозрачная проекта.
    expect(st.backgroundColor.startsWith(COLOR)).toBe(true);
    expect(st.backgroundColor).not.toBe(COLOR);
    expect(st).toMatchObject({ left: 1, right: 1 });
    expect(bands[0].props.accessibilityLabel).toBe(`${t('ru', 'agenda.planned')}: Вёрстка`);
  });

  test('полоса лежит под блоками записей времени: в столбце она раньше них', async () => {
    const s = await grid([task({ sessions: [{ start: iso(17, 10, 30), end: iso(17, 11, 30), ms: H }], totalMs: H })]);
    const col = (function find(node) {
      if (!node || typeof node !== 'object') return null;
      const kids = node.children || [];
      if (kids.some((c) => c && c.props && /^agenda-plan-/.test(c.props.testID || ''))) return node;
      for (const k of kids) { const hit = find(k); if (hit) return hit; }
      return null;
    }(s.toJSON()));
    const order = col.children.map((c) => (/^agenda-plan-/.test(c.props.testID || '') ? 'plan' : flat(c).borderLeftWidth === 2 ? 'block' : 'other'));
    expect(order.indexOf('plan')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('block')).toBeGreaterThan(order.indexOf('plan'));
  });

  test('нажатие открывает задачу: onTapPlanned, а без него — как дедлайн', async () => {
    const onTapDeadline = jest.fn();
    const without = await grid([task()], { onTapDeadline });
    await fireEvent.press(planned(without)[0]);
    expect(onTapDeadline).toHaveBeenCalledWith('t1');

    const onTapPlanned = jest.fn();
    const withOwn = await grid([task()], { onTapDeadline: jest.fn(), onTapPlanned });
    await fireEvent.press(planned(withOwn)[0]);
    expect(onTapPlanned).toHaveBeenCalledWith('t1');
  });

  test('отрезок ежедневной задачи — полоса в каждом дне видимого периода', async () => {
    const daily = { freq: 'day', every: 1, weekdays: [], monthMode: 'day', from: 'schedule', keepHistory: false, ends: { kind: 'never', count: 10, at: null }, done: 0 };
    const s = await grid([task({ repeat: daily, slots: [slot()] })], { days: 3 });
    expect(planned(s).map((n) => n.props.testID)).toEqual([17, 18, 19].map((d) => `agenda-plan-t1-sl1-${ms(d, 10)}`));
  });

  test('закрытой задачи плановых блоков нет; чужой день — тоже', async () => {
    expect(planned(await grid([task({ done: true })]))).toHaveLength(0);
    expect(planned(await grid([task({ cancelled: true })]))).toHaveLength(0);
    expect(planned(await grid([task({ slots: [slot({ start: iso(20, 10), end: iso(20, 12) })] })]))).toHaveLength(0);
    expect(planned(await grid([task({ slots: [] })]))).toHaveLength(0);
  });

  test('отрезок через полночь режется по дням, как записи времени', async () => {
    const s = await grid([task({ slots: [slot({ start: iso(17, 23), end: iso(18, 1) })] })], { days: 2 });
    const bands = planned(s);
    expect(bands).toHaveLength(2);
    expect(flat(bands[0]).top).toBeCloseTo(23 * HOUR_H, 5);
    expect(flat(bands[1]).top).toBeCloseTo(0, 5);
  });
});

describe('остров «Время работы» на «Сегодня»', () => {
  const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn(), setParams: jest.fn() });
  const texts = (node, out = []) => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach((x) => texts(x, out));
    else if (node) texts(node.children, out);
    return out;
  };
  const today = (list) => useAppStore.setState({ tasks: list });
  const home = (navigation = nav()) => render(<HomeScreen navigation={navigation} route={{ params: {} }} />);

  test('отрезки выбранного дня — по времени, с названием и точкой проекта; нажатие открывает задачу', async () => {
    today([
      task({ id: 'late', title: 'Тесты', slots: [slot({ id: 'b', start: at(15), end: at(16, 30) })] }),
      task({ id: 'early', title: 'Вёрстка', slots: [slot({ id: 'a', start: at(9), end: at(10) })] }),
    ]);
    const navigation = nav();
    const s = await home(navigation);
    const block = within(s.getByTestId('slots-block'));
    block.getByText(t('ru', 'slot.label'));
    block.getByText('09:00–10:00');
    block.getByText('15:00–16:30');
    // По времени: утренний раньше дневного.
    const all = texts(s.toJSON());
    expect(all.indexOf('Вёрстка')).toBeGreaterThanOrEqual(0);
    const inBlock = texts(s.getByTestId('slots-block').children);
    expect(inBlock.indexOf('Вёрстка')).toBeLessThan(inBlock.indexOf('Тесты'));
    await fireEvent.press(block.getByText('Тесты'));
    expect(navigation.navigate).toHaveBeenCalledWith('TaskDetail', { taskId: 'late' });
  });

  test('остров стоит после дедлайнов и перед «Недавними»', async () => {
    today([
      task({ dueAt: '2026-01-01T10:00:00.000Z', slots: [slot({ start: at(9), end: at(10) })], sessions: [{ start: at(7), end: at(8), ms: H }], totalMs: H }),
    ]);
    const s = await home();
    const all = texts(s.toJSON());
    const at1 = (str) => { const i = all.indexOf(str); expect([str, i >= 0]).toEqual([str, true]); return i; };
    expect(at1(t('ru', 'today.deadlines'))).toBeLessThan(at1(t('ru', 'slot.label')));
    // Записи дня — последним блоком, после острова.
    expect(at1(t('ru', 'slot.label'))).toBeLessThan(at1('07:00–08:00'));
  });

  test('отрезков в этот день нет, задача закрыта — острова нет', async () => {
    today([task({ slots: [slot({ start: iso(1, 10), end: iso(1, 11) })] })]);
    expect((await home()).queryByTestId('slots-block')).toBeNull();
    today([task({ done: true, slots: [slot({ start: at(9), end: at(10) })] })]);
    expect((await home()).queryByTestId('slots-block')).toBeNull();
  });
});

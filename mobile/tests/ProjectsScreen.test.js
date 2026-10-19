// «Проекты» — колода (screens/ProjectsScreen.js). Запуск: npm run test:mobile
//
// Карточки: имя, сводка по задачам, строка быстрого добавления, список
// задач карточки (cardTasks — чистая функция, проверяется числами).
//
// Пагинация и края колоды: размер точек — функция положения колоды (а не
// остановки на карточке), в окне пять позиций (с «+» и уменьшенными
// крайними), точки не выходят за рамку, «+» — первая позиция того же ряда
// (слот точки, тот же шаг и размер, не растёт, светлеет за порогом, уезжает
// из окна как крайняя точка); у правого края серая плашка со случайной фразой
// (30 на язык) и искрами: до отпускания летят за пальцем и на пороге (хаптика)
// ждут на местах, а разлетаются взрывом только с отпусканием за порогом и до
// новой оттяжки не возвращаются; отпустили раньше — тают вместе с плашкой;
// колода остаётся на последней карточке. Пасхалка: оттяжка почти через весь
// экран (EGG_TRIGGER) делает плашку пурпурной, приглушённые искры жёлтыми, а
// фразу — шуткой deck.egg_*; с отпусканием всё снимается, искры разлетаются
// жёлтыми. Проект без задач — пустой экран
// посередине карточки, на ступень мельче страничного.
//
// Колода каруселью: центральная карточка в полный рост, соседние меньше и
// приглушены — масштаб, сдвиг и затемнение карточки есть функция положения
// колоды (а не остановки на карточке). За краем: плашки «+» и с фразой —
// уменьшенные, как соседки, и растут с оттяжкой до размера центральной и чуть
// больше; крайняя карточка проекта на оттяжке уменьшается и не растёт.
//
// Порядок карточек (круг 21) — по свежести (Core.projectsByActivity): первым —
// проект с последними изменениями, закреплённый первым не встаёт, новый —
// слева; в фокусе порядок держится, вне фокуса — пересчёт, а на экране та же
// карточка (после создания — новая). Ни в одном кадре перестановки посередине
// нет чужой карточки или пустой оболочки, карточка на экране не пересоздаётся;
// колода, дочитывающая данные в пустую, — по свежести и на первой (жалоба
// 19 октября: карточки проявлялись по одной).
import { useRef, Profiler } from 'react';
import { StyleSheet, Dimensions, processColor } from 'react-native';
import { render, fireEvent, act, within, screen } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { State } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import * as Reanimated from 'react-native-reanimated';
import * as SparksModule from '../src/components/DeckSparks';
import * as ReduceMotion from '../src/hooks/useReduceMotion';
import ProjectsScreen, {
  cardTasks, nextPinTop, Dots, dotsProgress, dotOn, dotWidth, dotsStart, dotsWidth, dotsFrameWidth, dotScale,
  pullAmount, deckTarget, dotsLayout, dotsStripShift, plusScale, nextPhrase, DECK_PHRASES, PULL_TRIGGER, MAX_SLOTS,
  deckAway, deckPull, deckScale, deckShift, deckDim, DeckSlot, SIDE_SCALE, SIDE_DIM, EDGE_GROW,
  edgeScale, edgeScaleY, edgeShift, PlusCard, PhraseCard, EGG_TRIGGER, DECK_EGG_PHRASES,
  deckStart, deckNext, deckChoose, deckTouched, deckSettle, deckDrawn, DECK_KEEP,
} from '../src/screens/ProjectsScreen';
import * as Store from '../src/store/useAppStore';
import DeckSparks, { SPARKS, sparkFlight, sparkState, sparkEgg, BURST_MS } from '../src/components/DeckSparks';
import { rubberBand } from '../src/components/SwipeRow';
import NewProjectSheet from '../src/components/NewProjectSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, closeSheet } from '../src/store/useSheetStore';
import { colors, typography, fontSize, screenPadding } from '../src/theme';
import { t, T } from '../src/lib/i18n';

const nav = () => ({ navigate: jest.fn(), setOptions: jest.fn() });
const task = (id, projectId, title, extra) => ({
  id, projectId, title, statusId: 's1', done: false, totalMs: 0, sessions: [], tagIds: [], pinnedAt: null, dueAt: null,
  updatedAt: '2026-10-01T10:00:00.000Z', ...extra,
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru' },
    projects: [{ id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' }, { id: 'p2', name: 'Бот', color: '#5ec8f2', createdAt: '2026-10-02T00:00:00.000Z' }],
    statuses: [
      { id: 's1', projectId: 'p1', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
      { id: 's2', projectId: 'p2', name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 },
    ],
    tasks: [task('t1', 'p1', 'Вёрстка'), task('t2', 'p1', 'Макет', { done: true }), task('t3', 'p2', 'Команды')],
    activeTimer: null,
    ui: { ...useAppStore.getState().ui },
  });
});

test('cardTasks: идущая первой, выполненные не попадают, дальше — по последнему изменению', () => {
  const tasks = [
    task('a', 'p1', 'Старая', { updatedAt: '2026-01-01T00:00:00.000Z' }),
    task('b', 'p1', 'Выполнена', { done: true }),
    task('c', 'p1', 'Закреплена', { pinnedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }),
    task('d', 'p1', 'Свежая', { updatedAt: '2026-09-01T00:00:00.000Z' }),
  ];
  const list = cardTasks(tasks, { taskId: 'a', startedAt: '2026-10-01T00:00:00.000Z' });
  // Закреплённая выше свежей не поднимается: сверху всегда последняя изменённая.
  expect(list.map((x) => x.id)).toEqual(['a', 'd', 'c']);
  expect(cardTasks(tasks, null).map((x) => x.id)).toEqual(['d', 'c', 'a']);
});

test('карточки проектов: имя, сводка и задачи', async () => {
  const { getByText, getAllByText } = await render(<ProjectsScreen navigation={nav()} />);
  getByText('Сайт');
  getByText('Бот');
  getByText('Вёрстка');
  getByText('Команды');
  getByText('1/2');
  expect(getAllByText(t('ru', 'deck.open'))).toHaveLength(2);
});

test('строка быстрого добавления на карточке заводит задачу в её проект и открывает её', async () => {
  const navigation = nav();
  const q = await render(<ProjectsScreen navigation={navigation} />);
  // Колода по свежести: «Бот» заведён позже «Сайта» — его карточка первая.
  const card = q.getByTestId('deck-card-0');
  within(card).getByText('Бот');
  const input = within(card).getByLabelText(t('ru', 'tasks.new_ph'));
  await fireEvent.changeText(input, 'Деплой');
  await fireEvent(input, 'submitEditing');
  const added = useAppStore.getState().tasks.find((x) => x.title === 'Деплой');
  expect(added.projectId).toBe('p2');
  expect(added.statusId).toBe('s2');
  expect(navigation.navigate).toHaveBeenLastCalledWith('TaskDetail', { taskId: added.id });
  expect(useAppStore.getState().activeTimer).toBeNull();
});

test('nextPinTop: идущая держится первой, пока её таймер идёт', () => {
  expect(nextPinTop('a', { taskId: 'a' })).toBe('a');
  expect(nextPinTop('a', null)).toBeNull();
  expect(nextPinTop('a', { taskId: 'b' })).toBeNull();
  expect(nextPinTop(null, { taskId: 'b' })).toBeNull();
});

describe('идущая задача в карточке', () => {
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  beforeEach(() => {
    useAppStore.setState({
      tasks: [
        task('a', 'p1', 'Старая', { updatedAt: '2026-01-01T00:00:00.000Z' }),
        task('b', 'p1', 'Свежая', { updatedAt: '2026-09-01T00:00:00.000Z' }),
      ],
      activeTimer: null,
    });
  });
  const order = (q) => q.getAllByText(/^(Старая|Свежая)$/).map((n) => n.props.children);

  test('идущая на входе — первая', async () => {
    useAppStore.setState({ activeTimer: { taskId: 'a', startedAt: ago(5), heartbeatAt: ago(0) } });
    const q = await render(<ProjectsScreen navigation={nav()} />);
    expect(order(q)).toEqual(['Старая', 'Свежая']);
  });

  test('запустили — не прыгает; остановили — уезжает наверх по свежести', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    expect(order(q)).toEqual(['Свежая', 'Старая']);
    await act(async () => { useAppStore.setState({ activeTimer: { taskId: 'a', startedAt: ago(5), heartbeatAt: ago(0) } }); });
    expect(order(q)).toEqual(['Свежая', 'Старая']);
    await act(async () => { useAppStore.getState().stopTimer(); });
    expect(order(q)).toEqual(['Старая', 'Свежая']);
  });
});

// --- Пагинация и края колоды ---

const STEP = 300;
// Ширина экрана в jest — та, по которой экран считает шаг колоды.
const { width } = Dimensions.get('window');
const projectsOf = (n) => Array.from({ length: n }, (_, i) => ({
  id: `q${i + 1}`, name: `Проект ${i + 1}`, color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z',
}));
const dotLabel = (i) => `${t('ru', 'nav.projects')} ${i + 1}`;
// Стиль, который считается при каждом чтении, как кадр UI-потока: полосу
// колоды (x) двигают без отрисовки React (жест, layout-эффект), а карточки
// под memo со сменой страницы не перерисовываются — стиль, посчитанный в
// отрисовке, отставал бы от кадра.
const live = (cb) => new Proxy({}, {
  get: (_, key) => cb()[key],
  has: (_, key) => key in cb(),
  ownKeys: () => Reflect.ownKeys(cb()),
  getOwnPropertyDescriptor: (_, key) => {
    const now = cb();
    return key in now ? { value: now[key], enumerable: true, configurable: true, writable: true } : undefined;
  },
});

describe('точки пагинации — функция положения колоды', () => {
  test('dotsProgress: страницы от сдвига полосы, не выходят за колоду', () => {
    expect(dotsProgress(0, STEP, 5)).toBe(0);
    expect(dotsProgress(-STEP * 1.5, STEP, 5)).toBe(1.5);
    expect(dotsProgress(-STEP * 4, STEP, 5)).toBe(4);
    // Резинка за краями колоды положение не уводит.
    expect(dotsProgress(80, STEP, 5)).toBe(0);
    expect(dotsProgress(-STEP * 4 - 90, STEP, 5)).toBe(4);
  });

  test('размер точки — функция положения: промежуточное положение даёт промежуточные размеры', () => {
    // Колода стоит на второй точке: она пилюля 22, остальные круглые 7.
    expect(dotWidth(1, 1)).toBe(22);
    expect(dotWidth(0, 1)).toBe(7);
    expect(dotWidth(2, 1)).toBe(7);
    // Ровно посередине между второй и третьей — обе по полпилюли.
    expect(dotWidth(1, 1.5)).toBe(14.5);
    expect(dotWidth(2, 1.5)).toBe(14.5);
    expect(dotWidth(0, 1.5)).toBe(7);
    // Четверть пути: ближняя ещё почти пилюля, дальняя почти круглая.
    expect(dotWidth(1, 1.25)).toBeCloseTo(7 + 15 * 0.75, 10);
    expect(dotWidth(2, 1.25)).toBeCloseTo(7 + 15 * 0.25, 10);
    // Ширина растёт и убывает непрерывно, без скачков.
    let prev = dotWidth(2, 0);
    for (let p = 0.05; p <= 2; p += 0.05) {
      const w = dotWidth(2, p);
      expect(Math.abs(w - prev)).toBeLessThan(1.6);
      prev = w;
    }
    // Пилюля не исчезает и не раздувается: сумма ширин всегда одна и та же.
    for (let p = 0; p <= 4; p += 0.1) {
      const sum = [0, 1, 2, 3, 4].reduce((a, i) => a + dotWidth(i, p), 0);
      expect(sum).toBeCloseTo(4 * 7 + 22, 10);
    }
    expect(dotOn(3, 2.5)).toBe(0.5);
  });

  test('крайние позиции ряда не появляются сразу полными: растут из нуля по мере подъезда', () => {
    const n = 10;
    // Ряд — «+» и десять точек; окно упирается в его конец на начале n + 1 − MAX_SLOTS.
    const end = n + 1 - MAX_SLOTS;
    // Последняя уходит в окно справа: за окном нет, у края — растёт до полной.
    expect(dotScale(n - 1, end - 1, n)).toBe(0);
    expect(dotScale(n - 1, end - 0.5, n)).toBe(0.5);
    expect(dotScale(n - 1, end, n)).toBe(1);
    // «+» так же слева: в окне полный, уходя за край — до нуля.
    expect(plusScale(1, n)).toBe(0);
    expect(plusScale(0.5, n)).toBe(0.5);
    expect(plusScale(0, n)).toBe(1);
    // Первая точка у левого края окна уменьшена (за ней есть «+») и растёт к центру.
    expect(dotScale(0, 0, n)).toBe(1);
    expect(dotScale(0, 1, n)).toBeLessThan(1);
    expect(dotScale(0, 2, n)).toBe(0);
  });

  test('окно ряда — пять позиций с «+» и уменьшенными крайними: в центре пилюля, рядом полные, по краям малые', () => {
    expect(MAX_SLOTS).toBe(5);
    const n = 12;
    // Ряд при положении колоды p: «+» (позиция 0) и по точке на проект (i + 1).
    const row = (p) => {
      const start = dotsStart(p, n);
      return [plusScale(start, n), ...Array.from({ length: n }, (_, i) => dotScale(i, start, n))];
    };
    const small = dotScale(3, 4, n);
    expect(small).toBeGreaterThan(0.3);
    expect(small).toBeLessThan(0.8);
    // Колода стоит на любой карточке — видны ровно пять позиций, текущая в полный рост.
    for (let p = 0; p < n; p += 1) {
      const r = row(p);
      expect(r.filter((s) => s > 0)).toHaveLength(MAX_SLOTS);
      expect(r[p + 1]).toBe(1);
    }
    // Середина: [малая, полная, текущая, полная, малая], остальные — ноль.
    expect(row(5).slice(4, 9)).toEqual([small, 1, 1, 1, small]);
    expect(row(5).filter((s) => s > 0)).toHaveLength(5);
    // Текущая стоит по центру окна, пока оно не упёрлось в край ряда.
    for (let p = 1; p <= n - 3; p += 1) expect(p + 1 - dotsStart(p, n)).toBe(2);
    // Левый край: «+» первым в окне и в полный рост, малая только справа.
    expect(row(0).slice(0, 5)).toEqual([1, 1, 1, 1, small]);
    expect(row(1).slice(0, 5)).toEqual([1, 1, 1, 1, small]);
    expect(row(0).slice(5).every((s) => s === 0)).toBe(true);
    // Правый край: последняя в полный рост, малая только слева.
    expect(row(n - 1).slice(n + 1 - 5)).toEqual([small, 1, 1, 1, 1]);
    expect(row(n - 1).slice(0, n + 1 - 5).every((s) => s === 0)).toBe(true);
    // В пути окно едет плавно: уходящая гаснет до нуля, въезжающая растёт из нуля;
    // одновременно видно не больше шести позиций (пять и одна въезжающая) и не меньше пяти.
    let prev = row(0);
    for (let p = 0.05; p <= n - 1 + 1e-9; p += 0.05) {
      const r = row(p);
      const seen = r.filter((s) => s > 0.001).length;
      expect(seen).toBeGreaterThanOrEqual(MAX_SLOTS);
      expect(seen).toBeLessThanOrEqual(MAX_SLOTS + 1);
      r.forEach((s, q) => expect(Math.abs(s - prev[q])).toBeLessThan(0.12));
      prev = r;
    }
    // До четырёх проектов ряд помещается в окно целиком: все полные, окно не ездит.
    for (const k of [1, 2, 3, 4]) {
      for (let p = 0; p < k; p += 0.5) {
        expect(dotsStart(p, k)).toBe(0);
        expect(plusScale(0, k)).toBe(1);
        for (let i = 0; i < k; i += 1) expect(dotScale(i, 0, k)).toBe(1);
      }
    }
  });

  test('рамка: не меньше суммы наибольших размеров позиций окна и с запасом по краям', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10, 40]) {
      // Позиции окна — «+» и точки: круглые 7 с зазором 6 и одна пилюля 22.
      const visible = Math.min(n + 1, MAX_SLOTS);
      const sumMax = (visible - 1) * 7 + 22 + (visible - 1) * 6;
      expect(dotsFrameWidth(n)).toBeGreaterThanOrEqual(sumMax);
      expect(dotsFrameWidth(n)).toBe(dotsWidth(n) + 2 * (7 + 6));
    }
    expect(dotsFrameWidth(0)).toBe(0);
    // Пять позиций, одна из них пилюля: рамка длинной колоды не растёт.
    expect(dotsWidth(40)).toBe(4 * (7 + 6) + 22);
    expect(dotsWidth(40)).toBe(dotsWidth(MAX_SLOTS));
  });

  test('ни одна видимая позиция не выходит за рамку ни при каком положении колоды', () => {
    const frameOf = dotsFrameWidth;
    const outside = [];
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10, 25]) {
      for (let p = 0; p <= n - 1 + 1e-9; p += 0.05) {
        const shift = dotsStripShift(p, n);
        const start = dotsStart(p, n);
        let left = 0;
        // «+» (позиция 0) и по точке на проект.
        for (let q = 0; q <= n; q += 1) {
          const w = q === 0 ? 7 : dotWidth(q - 1, p);
          const s = q === 0 ? plusScale(start, n) : dotScale(q - 1, start, n);
          // Позиция видна, когда её масштаб больше нуля; её реальный след —
          // середина слота ± половина масштабированной ширины.
          if (s > 0.01) {
            const l = shift + left + (w * (1 - s)) / 2;
            const r = shift + left + (w * (1 + s)) / 2;
            if (l < -1e-9 || r > frameOf(n) + 1e-9) outside.push(`n=${n} p=${p.toFixed(2)} q=${q}: [${l.toFixed(1)}, ${r.toFixed(1)}] из ${frameOf(n)}`);
          }
          left += w + 6;
        }
      }
    }
    expect(outside).toEqual([]);
  });

  test('pullAmount: порог и потолок', () => {
    expect(pullAmount(-20)).toBe(0);
    expect(pullAmount(PULL_TRIGGER / 2)).toBe(0.5);
    expect(pullAmount(PULL_TRIGGER)).toBe(1);
    expect(pullAmount(PULL_TRIGGER * 9)).toBe(1);
  });

  test('отпустили за правым краем — колода остаётся на последней карточке, к первой не едет', () => {
    // Четыре проекта, колода на последней (страница 3) и оттянута влево за неё.
    expect(deckTarget(-3 * STEP - 90, 0, STEP, 3, 4)).toBe(3);
    expect(deckTarget(-3 * STEP - 160, -1500, STEP, 3, 4)).toBe(3);
  });
});

describe('«+» — первая позиция ряда точек', () => {
  // Шаг ряда: точка (7) и зазор (6).
  const SLOT = 7 + 6;

  test('раскладка: «+» ровно на шаг левее первой точки, при любом числе проектов', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10, 40]) {
      const lay = dotsLayout(n);
      expect(lay.firstDot - lay.plusLeft).toBe(SLOT);
      // Зона нажатия «+» (26) целиком внутри рамки: за рамкой не нажимается.
      expect(lay.plusLeft + 7 / 2 - 26 / 2).toBeGreaterThanOrEqual(0);
      // Рамка — окно позиций с запасом слота и полем под зону нажатия с обеих сторон.
      expect(lay.frameWidth).toBe(dotsFrameWidth(n) + 2 * lay.reach);
      // Окно у левого края: «+» первым в окне, после запаса рамки и поля нажатия.
      expect(lay.plusLeft).toBe(lay.reach + SLOT);
      expect(lay.plusLeft).toBe(lay.reach + dotsStripShift(0, n));
    }
  });

  test('ряд едет вместе с «+»: первая позиция окна всегда стоит на запасе рамки', () => {
    for (const n of [3, 7, 12]) {
      let prev = dotsStripShift(0, n);
      for (let p = 0; p <= n - 1; p += 0.25) {
        const shift = dotsStripShift(p, n);
        // Позиция начала окна (в слотах от «+») после сдвига — ровно на запасе рамки.
        expect(shift + dotsStart(p, n) * SLOT).toBeCloseTo(SLOT, 10);
        // Ряд только уезжает влево, пока колода идёт вправо.
        expect(shift).toBeLessThanOrEqual(prev);
        prev = shift;
      }
    }
    // Ряд помещается в окно целиком — стоит на месте.
    for (const p of [0, 1, 2, 3]) expect(dotsStripShift(p, 4)).toBe(SLOT);
  });

  test('plusScale: у левого края окна — в рост, из окна уходит как крайняя позиция, из нуля не появляется', () => {
    const n = 10;
    expect(plusScale(0, n)).toBe(1);
    expect(plusScale(0.5, n)).toBe(0.5);
    expect(plusScale(1, n)).toBe(0);
    expect(plusScale(n + 1 - MAX_SLOTS, n)).toBe(0);
    // Уменьшение до нуля за шаг окна, назад не растёт.
    let prev = 1;
    for (let st = 0; st <= n + 1 - MAX_SLOTS; st += 0.1) {
      const s = plusScale(st, n);
      expect(s).toBeCloseTo(Math.max(0, 1 - st), 10);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
    // Ряд помещается в окно (проектов не больше четырёх) — «+» всегда на месте.
    for (const k of [1, 3, 4]) expect(plusScale(0, k)).toBe(1);
  });
});

describe('фразы у правого края', () => {
  test('30 фраз, все четыре языка, без повторов внутри языка, короткие для плашки', () => {
    expect(DECK_PHRASES.length).toBeGreaterThanOrEqual(30);
    for (const lang of ['ru', 'en', 'uk', 'kk']) {
      const texts = DECK_PHRASES.map((key) => T[lang][key]);
      expect(texts.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
      expect(new Set(texts).size).toBe(texts.length);
      // Плашка узкая (строка — 92 pt): длиннее сорока знаков не поместится в четыре строки.
      for (const x of texts) expect(x.length).toBeLessThanOrEqual(40);
    }
  });

  test('nextPhrase: случайная, но не та же, что в прошлый раз, и каждая достижима', () => {
    const n = DECK_PHRASES.length;
    const seen = new Set();
    for (let prev = 0; prev < n; prev += 1) {
      for (let r = 0; r < 1; r += 0.01) {
        const next = nextPhrase(prev, n, () => r);
        expect(next).not.toBe(prev);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(n);
        seen.add(next);
      }
    }
    expect(seen.size).toBe(n);
    // Первой — любая; крайние значения случайности не выводят за список.
    expect(nextPhrase(-1, n, () => 0)).toBe(0);
    expect(nextPhrase(-1, n, () => 0.999999)).toBe(n - 1);
    expect(nextPhrase(3, n, () => 0.999999)).toBe(n - 1);
  });

  test('подряд одна и та же не выпадает: длинная серия оттяжек со случайным источником', () => {
    const n = DECK_PHRASES.length;
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    let prev = nextPhrase(-1, n, rnd);
    const used = new Set([prev]);
    for (let k = 0; k < 5000; k += 1) {
      const next = nextPhrase(prev, n, rnd);
      expect(next).not.toBe(prev);
      used.add(next);
      prev = next;
    }
    expect(used.size).toBe(n);
  });

  // Русские шутки пасхалки продиктовал пользователь — слово в слово.
  const EGG_RU = ['Тебе делать нечего?', 'Ты случаем не тестировщик?', 'Что ты здесь ищешь?', 'Нет, тут нет золота', 'ЗАКРОЙ ШТОРУ, ЁПТ'];

  test('пасхалка: пять шуток на каждом из четырёх языков, русские — как у пользователя, не из обычных фраз', () => {
    expect(DECK_EGG_PHRASES).toEqual(['deck.egg_1', 'deck.egg_2', 'deck.egg_3', 'deck.egg_4', 'deck.egg_5']);
    expect(DECK_EGG_PHRASES.map((key) => T.ru[key])).toEqual(EGG_RU);
    for (const lang of ['ru', 'en', 'uk', 'kk']) {
      const texts = DECK_EGG_PHRASES.map((key) => T[lang][key]);
      expect(texts.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
      expect(new Set(texts).size).toBe(texts.length);
      for (const x of texts) expect(x.length).toBeLessThanOrEqual(40);
      const usual = new Set(DECK_PHRASES.map((key) => T[lang][key]));
      for (const x of texts) expect(usual.has(x)).toBe(false);
    }
  });

  test('шутки пасхалки подряд не повторяются, и каждая достижима', () => {
    const n = DECK_EGG_PHRASES.length;
    let seed = 777;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    let prev = nextPhrase(-1, n, rnd);
    const used = new Set([prev]);
    for (let k = 0; k < 2000; k += 1) {
      const next = nextPhrase(prev, n, rnd);
      expect(next).not.toBe(prev);
      used.add(next);
      prev = next;
    }
    expect(used.size).toBe(n);
  });
});

describe('искры на плашке справа: за пальцем, взрыв — только с отпусканием за порогом', () => {
  const ROOM = 110;
  const flat = (node) => StyleSheet.flatten(node.props.style) || {};
  // sparkState(оттяжка, искра, ширина плашки, выстрел, прогресс взрыва, без движения)
  const at = (x, amount, fired = false, burst = 0, still = false) => sparkState(amount, x, ROOM, fired, burst, still);
  const FIRST = SPARKS.reduce((a, b) => (a.at < b.at ? a : b));
  // Расстояние искры от середины видимой плашки (от фразы).
  const away = (st) => Math.hypot(st.x - ROOM / 2, st.y);

  test('5–8 искр: разные размеры, акцентные и приглушённые, вверх и вниз от фразы, не на тексте', () => {
    expect(SPARKS.length).toBeGreaterThanOrEqual(5);
    expect(SPARKS.length).toBeLessThanOrEqual(8);
    expect(new Set(SPARKS.map((x) => x.size)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(SPARKS.map((x) => x.tone))).toEqual(new Set(['accent', 'muted']));
    // Четыре строки фразы занимают до ±34 от середины: искры дальше.
    for (const x of SPARKS) expect(Math.abs(x.dy)).toBeGreaterThanOrEqual(46);
    expect(SPARKS.some((x) => x.dy < 0) && SPARKS.some((x) => x.dy > 0)).toBe(true);
  });

  test('sparkFlight: без оттяжки — на фразе, на пороге долетели все, в промежутке — монотонно и по очереди', () => {
    for (const x of SPARKS) {
      expect(sparkFlight(0, x.at)).toBe(0);
      expect(sparkFlight(1, x.at)).toBe(1);
      let prev = 0;
      for (let a = 0; a <= 1; a += 0.02) {
        const f = sparkFlight(a, x.at);
        expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = f;
      }
    }
    const late = SPARKS.reduce((a, b) => (a.at > b.at ? a : b));
    expect(sparkFlight(0.4, FIRST.at)).toBeGreaterThan(0);
    expect(sparkFlight(0.4, late.at)).toBe(0);
  });

  test('до порога: при нуле скрыты, на пороге видны на своих местах, в пути — между', () => {
    for (const x of SPARKS) {
      const zero = at(x, 0);
      expect(zero.opacity).toBe(0);
      expect(zero.scale).toBe(0);
      const end = at(x, 1);
      expect(end.opacity).toBe(1);
      expect(end.scale).toBe(1);
      expect(end.y).toBe(x.dy);
      expect(end.rotate).toBe(0);
      // На своём месте — целиком внутри видимой плашки.
      expect(end.x - x.size / 2).toBeGreaterThanOrEqual(0);
      expect(end.x + x.size / 2).toBeLessThanOrEqual(ROOM);
    }
    // В пути: у ранней искры при трети оттяжки — уже в полёте, но не на месте.
    const mid = at(FIRST, 0.3);
    expect(mid.scale).toBeGreaterThan(0);
    expect(mid.scale).toBeLessThan(1);
    expect(Math.abs(mid.y)).toBeGreaterThan(0);
    expect(Math.abs(mid.y)).toBeLessThan(Math.abs(FIRST.dy));
    expect(mid.rotate).not.toBe(0);
    // Прозрачность и размер — функция оттяжки: растут вместе с ней, назад не идут;
    // тянут обратно — искры втягиваются по тем же значениям.
    let a0 = 0;
    let s0 = 0;
    for (let a = 0; a <= 1; a += 0.02) {
      const st = at(FIRST, a);
      expect(st.opacity).toBeGreaterThanOrEqual(a0 - 1e-12);
      expect(st.scale).toBeGreaterThanOrEqual(s0 - 1e-12);
      a0 = st.opacity;
      s0 = st.scale;
    }
    expect(at(FIRST, 0.5)).toEqual(at(FIRST, 0.5, false, 1));
  });

  test('отпустили за порогом: искры замирают на своих местах и разлетаются — наружу, крупнее, прозрачнее', () => {
    for (const x of SPARKS) {
      // Выстрел без прошедшего времени — то же, что на пороге: скачка нет.
      expect(at(x, 1, true, 0)).toEqual(at(x, 1));
      let prev = away(at(x, 1, true, 0));
      let prevOp = 1;
      for (let b = 0.1; b <= 1.0001; b += 0.1) {
        const st = at(x, 1, true, b);
        // Каждая летит наружу по своему направлению: от фразы всё дальше.
        expect(away(st)).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = away(st);
        // Гаснет: прозрачность только убывает.
        expect(st.opacity).toBeLessThanOrEqual(prevOp + 1e-12);
        prevOp = st.opacity;
      }
      const gone = at(x, 1, true, 1);
      // «Улетели»: далеко от места, крупнее, повёрнуты дальше и прозрачные.
      expect(away(gone)).toBeGreaterThan(away(at(x, 1)) + 40);
      expect(gone.scale).toBeGreaterThan(1.5);
      expect(gone.opacity).toBe(0);
      expect(Math.abs(gone.rotate)).toBeGreaterThan(0);
      // Направление — то же, что у искры от фразы: dy того же знака.
      expect(Math.sign(gone.y)).toBe(Math.sign(x.dy));
    }
    // Разлёт идёт разными путями: у каждой искры своё направление смещения.
    const angles = SPARKS.map((x) => {
      const rest = at(x, 1);
      const gone = at(x, 1, true, 1);
      return Math.round(Math.atan2(gone.y - rest.y, gone.x - rest.x) * 50);
    });
    expect(new Set(angles).size).toBe(SPARKS.length);
  });

  test('после выстрела оттяжка больше не читается: как ни тяни и ни отпускай, искры не возвращаются', () => {
    for (const x of SPARKS) {
      for (const amount of [0, 0.2, 0.5, 0.9, 1]) {
        // Взрыв доигран: оттяжка отпущена до нуля, снова на пороге — искр нет.
        expect(at(x, amount, true, 1).opacity).toBe(0);
        // В середине взрыва положение от оттяжки не зависит.
        expect(at(x, amount, true, 0.4)).toEqual(at(x, 1, true, 0.4));
      }
    }
  });

  test('новая оттяжка после разлёта: защёлка снята — искры снова идут за пальцем', () => {
    for (const x of SPARKS) {
      // fired снова ложь (взрыв сброшен в нуль): всё как в начале.
      expect(at(x, 0, false, 0).opacity).toBe(0);
      expect(at(x, 1, false, 0).opacity).toBe(1);
      expect(at(x, 1, false, 0).scale).toBe(1);
    }
    expect(at(FIRST, 0.5, false, 0).opacity).toBeGreaterThan(0);
  });

  test('взрыв длится 400–600 мс', () => {
    expect(BURST_MS).toBeGreaterThanOrEqual(400);
    expect(BURST_MS).toBeLessThanOrEqual(600);
  });

  test('при «уменьшении движения»: проявляются на месте, а с отпусканием за порогом без разлёта гаснут', () => {
    for (const x of SPARKS) {
      const a = at(x, 0.4, false, 0, true);
      const b = at(x, 1, false, 0, true);
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      expect(a.scale).toBe(1);
      expect(a.rotate).toBe(0);
      expect(at(x, 0, false, 0, true).opacity).toBe(0);
      expect(b.opacity).toBe(1);
      // Порог: ни сдвига, ни роста, ни поворота — только прозрачность, и быстрее взрыва.
      const g = at(x, 1, true, 0.35, true);
      expect(g).toMatchObject({ x: b.x, y: b.y, scale: 1, rotate: 0, opacity: 0 });
      expect(at(x, 1, true, 0, true)).toEqual(b);
      for (let k = 0; k <= 1.0001; k += 0.1) {
        const st = at(x, 1, true, k, true);
        expect(st.x).toBe(b.x);
        expect(st.y).toBe(b.y);
        expect(st.scale).toBe(1);
      }
      expect(at(x, 0.3, true, 1, true).opacity).toBe(0);
    }
  });

  // Слой искр с заданными оттяжкой, выстрелом и прогрессом взрыва (в подмене
  // reanimated анимации не идут, поэтому burst подставляется).
  const renderAt = async (amount, { fired = 0, burst = 0, still = false } = {}) => {
    const q = await render(
      <DeckSparks amount={{ value: amount }} room={{ value: ROOM }} fired={{ value: fired }} burst={{ value: burst }} still={still} />,
    );
    const out = SPARKS.map((_, i) => {
      const st = flat(q.getByTestId(`deck-spark-${i}`, { includeHiddenElements: true }));
      const tr = Object.assign({}, ...st.transform);
      return { opacity: st.opacity, x: tr.translateX, y: tr.translateY, scale: tr.scale, rotate: tr.rotate };
    });
    await q.unmount();
    return out;
  };

  test('слой искр: до порога видимость — функция оттяжки; взрыв уводит их в «улетели»; снятая защёлка возвращает', async () => {
    const rest = await renderAt(0);
    for (const sp of rest) {
      expect(sp.opacity).toBe(0);
      expect(sp.scale).toBe(0);
    }
    const full = await renderAt(1);
    for (const sp of full) {
      expect(sp.opacity).toBeGreaterThanOrEqual(0.85);
      expect(sp.scale).toBe(1);
    }
    const half = await renderAt(0.5);
    expect(half.some((sp, i) => sp.y !== full[i].y && Math.abs(sp.y) > 0)).toBe(true);
    expect(half.some((sp, i) => sp.scale > 0 && sp.scale < full[i].scale)).toBe(true);

    // Порог пересечён: взрыв в середине — искры в пути наружу, крупнее и не до конца прозрачные…
    const mid = await renderAt(1, { fired: 1, burst: 0.4 });
    mid.forEach((sp, i) => {
      expect(Math.abs(sp.y)).toBeGreaterThan(Math.abs(full[i].y));
      expect(sp.scale).toBeGreaterThan(1);
      expect(sp.opacity).toBeGreaterThan(0);
      expect(sp.opacity).toBeLessThan(full[i].opacity);
    });
    // …взрыв доигран — «улетели»: прозрачные, как бы ни тянули дальше (и назад, к нулю).
    for (const amount of [0, 0.5, 1]) {
      for (const sp of await renderAt(amount, { fired: 1, burst: 1 })) expect(sp.opacity).toBe(0);
    }
    // Новая оттяжка после отпускания: защёлка снята, взрыв сброшен — снова идут за пальцем.
    const again = await renderAt(0.5, { fired: 0, burst: 0 });
    expect(again).toEqual(half);
  });

  test('слой искр при «уменьшении движения»: места не меняются, на пороге гаснут без разлёта', async () => {
    const half = await renderAt(0.5, { still: true });
    const full = await renderAt(1, { still: true });
    half.forEach((sp, i) => {
      expect(sp.x).toBe(full[i].x);
      expect(sp.y).toBe(full[i].y);
      expect(sp.scale).toBe(1);
      expect(sp.rotate).toBe('0deg');
    });
    expect(half.some((sp, i) => sp.opacity > 0 && sp.opacity <= full[i].opacity)).toBe(true);
    expect((await renderAt(0, { still: true })).every((sp) => sp.opacity === 0)).toBe(true);
    const gone = await renderAt(1, { fired: 1, burst: 0.5, still: true });
    gone.forEach((sp, i) => {
      expect(sp.x).toBe(full[i].x);
      expect(sp.y).toBe(full[i].y);
      expect(sp.scale).toBe(1);
      expect(sp.opacity).toBe(0);
    });
  });

  // Пасхалка: у каждой искры два слоя одной звезды — обычный и пасхальный,
  // перетекают по ходу egg; взрыв после отпускания в пасхалке (fired = 2) идёт
  // в цвете пасхалки, как бы ни ушла сама пасхалка.
  const walkNodes = (n, out = []) => { if (n && typeof n === 'object') { out.push(n); (n.children || []).forEach((c) => walkNodes(c, out)); } return out; };
  const layersAt = async ({ egg = 0, fired = 0 }) => {
    const q = await render(
      <DeckSparks amount={{ value: 1 }} room={{ value: ROOM }} fired={{ value: fired }} burst={{ value: 0 }} egg={{ value: egg }} />,
    );
    const out = SPARKS.map((sp, i) => {
      const spark = q.getByTestId(`deck-spark-${i}`, { includeHiddenElements: true });
      const [plain, lit] = spark.children;
      const fill = (layer) => walkNodes(layer).find((n) => n.type === 'RNSVGPath').props.fill.payload;
      return { tone: sp.tone, plain: flat(plain).opacity, lit: flat(lit).opacity, plainFill: fill(plain), litFill: fill(lit) };
    });
    await q.unmount();
    return out;
  };

  test('искры: обычные цвета — accentInk и textFaint, пасхальные — белый textOnColor и жёлтый eggSpark; слои перетекают по ходу egg', async () => {
    // Токены тёмной темы (colors из theme.js — она): тему выбираем явно.
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, theme: 'dark' } });
    const plainFill = (tone) => processColor(tone === 'accent' ? colors.accentInk : colors.textFaint);
    const litFill = (tone) => processColor(tone === 'accent' ? colors.textOnColor : colors.eggSpark);
    expect(SPARKS.some((x) => x.tone === 'muted')).toBe(true);
    for (const sp of await layersAt({ egg: 0 })) {
      expect(sp).toMatchObject({ plain: 1, lit: 0, plainFill: plainFill(sp.tone), litFill: litFill(sp.tone) });
    }
    for (const sp of await layersAt({ egg: 1 })) expect(sp).toMatchObject({ plain: 0, lit: 1, litFill: litFill(sp.tone) });
    for (const sp of await layersAt({ egg: 0.25 })) expect(sp).toMatchObject({ plain: 0.75, lit: 0.25 });
    // Серые становятся именно жёлтыми — не акцентом и не прежним серым.
    const muted = (await layersAt({ egg: 1 })).find((x) => x.tone === 'muted');
    expect(muted.litFill).toBe(processColor(colors.eggSpark));
    expect(muted.litFill).not.toBe(muted.plainFill);
  });

  test('взрыв из пасхалки жёлтый, а обычный — нет: цвет держит защёлка fired = 2, а не сама пасхалка', async () => {
    expect(sparkEgg(0.3, 0)).toBe(0.3);
    expect(sparkEgg(0, 1)).toBe(0);
    expect(sparkEgg(0, 2)).toBe(1);
    expect(sparkEgg(1, 2)).toBe(1);
    // Пасхалку уже сняли (egg 0), а защёлка 2: искры жёлтые.
    for (const sp of await layersAt({ egg: 0, fired: 2 })) expect(sp).toMatchObject({ plain: 0, lit: 1 });
    // Отпустили между порогами: защёлка 1 — обычные цвета.
    for (const sp of await layersAt({ egg: 0, fired: 1 })) expect(sp).toMatchObject({ plain: 1, lit: 0 });
    // Взрыв идёт и при защёлке 2: искры разлетаются, как при 1.
    const burst = SPARKS.map((spec) => sparkState(1, spec, ROOM, true, 0.5, false));
    SPARKS.forEach((spec, i) => expect(burst[i].scale).toBeGreaterThan(sparkState(1, spec, ROOM, false, 0, false).scale));
  });
});

describe('Dots: рисует точки по положению колоды', () => {
  const styles = new Proxy({}, { get: () => ({}) });
  const flat = (node) => StyleSheet.flatten(node.props.style) || {};
  const widthsAt = async (xv, count = 5) => {
    const q = await render(<Dots x={{ value: xv }} step={STEP} count={count} armed={{ value: 0 }} onGo={() => {}} onNew={() => {}} styles={styles} lang="ru" />);
    const widths = Array.from({ length: count }, (_, i) => flat(q.getByLabelText(dotLabel(i))).width);
    const frame = flat(q.getByTestId('deck-dots-frame')).width;
    await q.unmount();
    return { widths, frame };
  };

  test('стоит на карточке — пилюля под ней; на полпути — две половинки; у резинки — не дальше края', async () => {
    expect((await widthsAt(0)).widths).toEqual([22, 7, 7, 7, 7]);
    expect((await widthsAt(-STEP)).widths).toEqual([7, 22, 7, 7, 7]);
    // Колода проехала полкарточки — пилюля уже перетекает, а не ждёт остановки.
    expect((await widthsAt(-STEP * 0.5)).widths).toEqual([14.5, 14.5, 7, 7, 7]);
    expect((await widthsAt(-STEP * 2.75)).widths.map((w) => Math.round(w * 100) / 100)).toEqual([7, 7, 10.75, 18.25, 7]);
    // Оттянули за последнюю карточку: пилюля на последней, а не за краем.
    expect((await widthsAt(-STEP * 4 - 90)).widths).toEqual([7, 7, 7, 7, 22]);
    expect((await widthsAt(60)).widths).toEqual([22, 7, 7, 7, 7]);
  });

  test('рамка по ширине — dotsLayout (окно, запас слота и поле под «+»), а не впритык к пилюле', async () => {
    const { frame } = await widthsAt(0);
    expect(frame).toBe(dotsLayout(5).frameWidth);
    expect(frame).toBeGreaterThan(dotsFrameWidth(5));
    expect(frame).toBeGreaterThan(dotsWidth(5));
  });

  // «+» — первый в том же ряду, что и точки; масштаб — тот же закон, что у крайних точек.
  const plusAt = async (xv, count) => {
    const q = await render(<Dots x={{ value: xv }} step={STEP} count={count} armed={{ value: 0 }} onGo={() => {}} onNew={() => {}} styles={styles} lang="ru" />);
    const plus = q.getByTestId('deck-plus-dot');
    const row = q.getByTestId('deck-dots-row');
    const buttons = within(row).getAllByRole('button');
    const out = {
      scale: flat(plus).transform.find((tr) => 'scale' in tr).scale,
      first: buttons[0] === plus,
      buttons: buttons.length,
      plus: flat(plus),
      row: flat(row),
    };
    await q.unmount();
    return out;
  };

  test('«+» — первый элемент ряда точек: слот точки с зоной нажатия шире, едет вместе с рядом', async () => {
    const at = await plusAt(0, 5);
    // Тот же ряд: «+» и по точке на проект; «+» первым.
    expect(at.first).toBe(true);
    expect(at.buttons).toBe(5 + 1);
    // В раскладке «+» занимает ровно слот точки (7): 26 минус поля по 9.5 с обеих сторон.
    expect(at.plus.width + at.plus.marginLeft + at.plus.marginRight).toBe(7);
    // Поле слева — тот же reach, что у рамки: зона нажатия внутри ряда.
    expect(at.row.paddingLeft).toBe(-at.plus.marginLeft);
    expect(at.row.transform[0].translateX).toBe(dotsStripShift(0, 5));
    // Ряд сдвинулся на проезд колоды — «+» поехал вместе с ним.
    const moved = await plusAt(-STEP * 3, 10);
    expect(moved.row.transform[0].translateX).toBe(dotsStripShift(3, 10));
  });

  test('у левого края «+» в полный рост, в середине длинной колоды — убран до нуля, у короткой колоды всегда на месте', async () => {
    // Десять проектов: окно у левого края, пока колода на первых двух.
    expect((await plusAt(0, 10)).scale).toBe(1);
    expect((await plusAt(-STEP, 10)).scale).toBe(1);
    // Окно поехало — «+» уменьшается как крайняя позиция ряда.
    expect((await plusAt(-STEP * 1.5, 10)).scale).toBe(0.5);
    expect((await plusAt(-STEP * 2, 10)).scale).toBe(0);
    // Середина и конец колоды: «+» нет — ни виден, ни нажимается (нулевая площадь).
    expect((await plusAt(-STEP * 5, 10)).scale).toBe(0);
    expect((await plusAt(-STEP * 9, 10)).scale).toBe(0);
    // Не больше четырёх проектов: ряд помещается в окно, «+» всегда на месте.
    for (const xv of [0, -STEP, -STEP * 3]) expect((await plusAt(xv, 4)).scale).toBe(1);
  });
});

describe('карусель: масштаб, сдвиг и затемнение карточки — функция положения колоды', () => {
  const W = 330;
  const at = (page) => -page * STEP;
  const near = (a, b) => expect(a).toBeCloseTo(b, 6);

  test('в центре — 1, у соседней — 0.94, дальше соседней не меньше', () => {
    expect(SIDE_SCALE).toBe(0.94);
    for (let page = 0; page < 5; page++) {
      for (let i = 0; i < 5; i++) {
        const d = Math.abs(i - page);
        const want = d === 0 ? 1 : SIDE_SCALE;
        near(deckScale(i, at(page), STEP, 5, false), want);
        near(deckDim(i, at(page), STEP, 5), d === 0 ? 0 : SIDE_DIM);
        expect(deckShift(i, at(page), STEP, 5, W) === 0).toBe(d === 0);
      }
    }
  });

  test('между положениями — между значениями, монотонно и вместе с пальцем', () => {
    // Колода проехала полкарточки: уходящая и приходящая — ровно посередине.
    const half = at(0.5);
    near(deckScale(0, half, STEP, 5, false), (1 + SIDE_SCALE) / 2);
    near(deckScale(1, half, STEP, 5, false), (1 + SIDE_SCALE) / 2);
    near(deckDim(0, half, STEP, 5), SIDE_DIM / 2);
    // Подъезжающая карточка (1) растёт, уезжающая (0) уменьшается — шаг за шагом.
    let prevIn = -1;
    let prevOut = 2;
    for (let k = 0; k <= 20; k++) {
      const x = -STEP * (k / 20);
      const grow = deckScale(1, x, STEP, 5, false);
      const shrink = deckScale(0, x, STEP, 5, false);
      expect(grow).toBeGreaterThanOrEqual(prevIn);
      expect(shrink).toBeLessThanOrEqual(prevOut);
      expect(grow).toBeGreaterThanOrEqual(SIDE_SCALE);
      expect(grow).toBeLessThanOrEqual(1);
      prevIn = grow;
      prevOut = shrink;
    }
    // Четверть пути — на четверть между SIDE_SCALE и 1.
    near(deckScale(1, at(0.25), STEP, 5, false), SIDE_SCALE + (1 - SIDE_SCALE) * 0.25);
  });

  test('ближний к центру край карточки остаётся на месте: зазор между карточками не растёт', () => {
    // Край карточки после масштаба от её центра и сдвига: центр ± s·W/2 + сдвиг.
    const edge = (i, x, side) => {
      const s = deckScale(i, x, STEP, 5, false);
      const c = W / 2 + deckShift(i, x, STEP, 5, W);
      return side === 'left' ? c - (s * W) / 2 : c + (s * W) / 2;
    };
    // Колода у карточки 0: соседка справа (1) стоит левым краем там, где стояла.
    expect(edge(1, at(0), 'left')).toBeCloseTo(0, 6);
    // Карточка слева от центра (0, когда колода у 1) — правым краем на месте.
    expect(edge(0, at(1), 'right')).toBeCloseTo(W, 6);
    // В пути ближний край к центру не заезжает на соседку и не отъезжает от неё.
    for (const k of [0, 0.3, 0.5, 0.8, 1]) {
      expect(edge(1, at(k), 'left')).toBeLessThanOrEqual(1e-9);
      expect(edge(0, at(k), 'right')).toBeGreaterThanOrEqual(W - 1e-9);
    }
  });

  test('deckAway: −1…1 в страницах, знак — по сторону от центра, за краями колоды не уходит', () => {
    expect(deckAway(2, at(2), STEP, 5)).toBe(0);
    expect(deckAway(1, at(2), STEP, 5)).toBe(1);
    expect(deckAway(3, at(2), STEP, 5)).toBe(-1);
    expect(deckAway(0, at(4), STEP, 5)).toBe(1);
    // За левым краем (резинка вправо): первая — всё ещё «в центре».
    expect(deckAway(0, 60, STEP, 5)).toBe(0);
    expect(deckAway(0, at(4) - 60, STEP, 5)).toBe(1);
    expect(deckAway(4, at(4) - 60, STEP, 5)).toBe(0);
  });

  test('оттяжка первой карточки вправо: уменьшается до соседской и не растёт, дальше порога не меняется', () => {
    expect(deckPull(0, 0, STEP, 5)).toBe(0);
    // Оттяжка идёт с пальцем: знак «карточка правее центра», −1 на пороге.
    let prev = 0;
    for (const x of [10, 20, 35, 50, PULL_TRIGGER]) {
      const g = deckPull(0, x, STEP, 5);
      expect(g).toBeLessThan(prev);
      prev = g;
    }
    near(deckPull(0, PULL_TRIGGER / 2, STEP, 5), -0.5);
    near(deckPull(0, PULL_TRIGGER * 3, STEP, 5), -1);
    // Масштаб только убывает — от 1 до SIDE_SCALE, выше 1 не бывает ни при какой оттяжке.
    let scale = 1;
    for (let x = 0; x <= PULL_TRIGGER * 3; x += 5) {
      const v = deckScale(0, x, STEP, 5, false);
      expect(v).toBeLessThanOrEqual(scale + 1e-12);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(SIDE_SCALE - 1e-12);
      scale = v;
    }
    near(deckScale(0, 0, STEP, 5, false), 1);
    near(deckScale(0, PULL_TRIGGER / 2, STEP, 5, false), (1 + SIDE_SCALE) / 2);
    near(deckScale(0, PULL_TRIGGER, STEP, 5, false), SIDE_SCALE);
    near(deckScale(0, PULL_TRIGGER * 3, STEP, 5, false), SIDE_SCALE);
    // Остальные карточки от оттяжки не меняются; соседка остаётся соседкой.
    for (const i of [1, 2, 3, 4]) {
      expect(deckPull(i, PULL_TRIGGER, STEP, 5)).toBe(0);
      near(deckScale(i, PULL_TRIGGER, STEP, 5, false), SIDE_SCALE);
    }
    // Вернули — вернулась: масштаб снова 1.
    near(deckScale(0, 0, STEP, 5, false), 1);
  });

  test('оттяжка последней карточки влево — то же, зеркально; обычный ход к ней не уменьшает сверх карусели', () => {
    const last = at(4);
    expect(deckPull(4, last, STEP, 5)).toBe(0);
    near(deckPull(4, last - PULL_TRIGGER / 2, STEP, 5), 0.5);
    near(deckPull(4, last - PULL_TRIGGER * 3, STEP, 5), 1);
    near(deckScale(4, last - PULL_TRIGGER / 2, STEP, 5, false), (1 + SIDE_SCALE) / 2);
    near(deckScale(4, last - PULL_TRIGGER, STEP, 5, false), SIDE_SCALE);
    near(deckScale(3, last - PULL_TRIGGER, STEP, 5, false), SIDE_SCALE);
    // Первую влево (обычный ход) и последнюю вправо (к предпоследней) оттяжкой не считают.
    expect(deckPull(0, at(1), STEP, 5)).toBe(0);
    expect(deckPull(4, at(3), STEP, 5)).toBe(0);
    // Единственная карточка: тянут в любую сторону — уменьшается, и не растёт.
    near(deckScale(0, 40, STEP, 1, false), deckScale(0, -40, STEP, 1, false));
    expect(deckScale(0, 40, STEP, 1, false)).toBeLessThan(1);
    expect(deckPull(0, 40, STEP, 1)).toBeLessThan(0);
    expect(deckPull(0, -40, STEP, 1)).toBeGreaterThan(0);
  });

  test('потянутая крайняя карточка уходит от плашки, как соседка: край, обращённый к ней, остаётся на месте', () => {
    // Край карточки после масштаба от её центра и сдвига: центр ± s·W/2 + сдвиг.
    const left = (i, x) => W / 2 + deckShift(i, x, STEP, 5, W, false) - (deckScale(i, x, STEP, 5, false) * W) / 2;
    const right = (i, x) => W / 2 + deckShift(i, x, STEP, 5, W, false) + (deckScale(i, x, STEP, 5, false) * W) / 2;
    for (const k of [0, 0.25, 0.5, 1, 3]) {
      // Первая тянется вправо — к «+»: левый край (у «+») на месте, зазор не растёт.
      expect(left(0, PULL_TRIGGER * k)).toBeCloseTo(0, 6);
      // Последняя — влево, правый край у плашки с фразой.
      expect(right(4, at(4) - PULL_TRIGGER * k)).toBeCloseTo(W, 6);
    }
    // Дальний край сдвигается внутрь: карточка в самом деле меньше.
    expect(right(0, PULL_TRIGGER)).toBeCloseTo(W * SIDE_SCALE, 6);
    expect(deckShift(0, PULL_TRIGGER, STEP, 5, W, false)).toBeLessThan(0);
    expect(deckShift(4, at(4) - PULL_TRIGGER, STEP, 5, W, false)).toBeGreaterThan(0);
  });

  test('плашки «+» и с фразой: уменьшенные соседки, с оттяжкой растут по ширине до 1 + EDGE_GROW, по высоте — не выше 1', () => {
    expect(EDGE_GROW).toBeCloseTo(0.04, 6);
    // Не тянут — как боковые карточки карусели; на пороге — по ширине чуть больше центральной, по высоте ровно она.
    near(edgeScale(0, false), SIDE_SCALE);
    near(edgeScaleY(0, false), SIDE_SCALE);
    near(edgeScale(1, false), 1 + EDGE_GROW);
    near(edgeScaleY(1, false), 1);
    expect(edgeScaleY(1, false)).toBeLessThan(edgeScale(1, false));
    // Выше центральной карточки не бывает ни при какой оттяжке — даже дальше порога.
    for (let a = 0; a <= 3; a += 0.05) expect(edgeScaleY(a, false)).toBeLessThanOrEqual(1);
    // Растёт вместе с оттяжкой, назад не идёт; на полпути — между соседской и порогом.
    let prev = 0;
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const v = edgeScale(a, false);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(edgeScale(0.5, false)).toBeGreaterThan(SIDE_SCALE);
    expect(edgeScale(0.5, false)).toBeLessThan(1 + EDGE_GROW);
    // Крайняя карточка проекта и плашка идут навстречу: одна убывает до соседской, другая растёт.
    for (const x of [0, 20, 40, 60, PULL_TRIGGER]) {
      const a = pullAmount(x);
      expect(deckScale(0, x, STEP, 5, false)).toBeCloseTo(1 - (1 - SIDE_SCALE) * a, 10);
      expect(edgeScale(a, false)).toBeCloseTo(SIDE_SCALE + (1 + EDGE_GROW - SIDE_SCALE) * a, 10);
    }
    // Плашка уходит далеко за край (84 + 600): край у карточек стоит на месте, как её ни масштабируй.
    const WC = 84 + 600;
    for (const a of [0, 0.3, 1]) {
      near(edgeShift(a, false, 1), (1 - edgeScale(a, false)) * (WC / 2));
      // «+» слева: её правый край (у первой карточки) на месте; фраза справа: левый.
      near(WC / 2 + edgeShift(a, false, 1) + (edgeScale(a, false) * WC) / 2, WC);
      near(WC / 2 + edgeShift(a, false, -1) - (edgeScale(a, false) * WC) / 2, 0);
    }
  });

  test('«уменьшение движения»: от оттяжки ничего не меняется, а масштаб по положению остаётся плавным', () => {
    near(deckScale(0, PULL_TRIGGER, STEP, 5, true), 1);
    near(deckScale(4, at(4) - PULL_TRIGGER, STEP, 5, true), 1);
    expect(deckShift(0, PULL_TRIGGER, STEP, 5, W, true) + 0).toBe(0);
    expect(deckShift(4, at(4) - PULL_TRIGGER, STEP, 5, W, true) + 0).toBe(0);
    // Плашки у краёв — без масштаба и без сдвига.
    for (const a of [0, 0.5, 1]) {
      expect(edgeScale(a, true)).toBe(1);
      expect(edgeScaleY(a, true)).toBe(1);
      expect(edgeShift(a, true, 1) + 0).toBe(0);
      expect(edgeShift(a, true, -1) + 0).toBe(0);
    }
    // Положение по-прежнему меняет масштаб непрерывно — без скачка в обе стороны.
    let prev = deckScale(1, 0, STEP, 5, true);
    for (let k = 1; k <= 40; k++) {
      const v = deckScale(1, -STEP * (k / 40), STEP, 5, true);
      expect(Math.abs(v - prev)).toBeLessThan(0.01);
      prev = v;
    }
  });

  test('DeckSlot рисует это же: transform и затемнение берёт у положения колоды', async () => {
    const styles = new Proxy({}, { get: () => ({}) });
    const look = async (xv, index, still = false) => {
      const q = await render(<DeckSlot deck={{ x: { value: xv }, step: STEP, count: 5, cardW: W, still }} index={index} styles={styles} />);
      const card = StyleSheet.flatten(q.getByTestId(`deck-card-${index}`).props.style);
      const dim = StyleSheet.flatten(q.getByTestId(`deck-dim-${index}`).props.style);
      await q.unmount();
      return { card, dim };
    };
    const tr = (card) => Object.assign({}, ...card.transform);
    // Колода на карточке 1: она в полный рост, соседние меньше и приглушены.
    const centre = await look(at(1), 1);
    expect(tr(centre.card)).toEqual({ translateX: 0, scale: 1 });
    expect(centre.dim.opacity).toBe(0);
    const side = await look(at(1), 2);
    near(tr(side.card).scale, SIDE_SCALE);
    expect(tr(side.card).translateX).toBeLessThan(0);
    near(side.dim.opacity, SIDE_DIM);
    expect(tr((await look(at(1), 0)).card).translateX).toBeGreaterThan(0);
    // На полпути — между.
    const mid = await look(at(1.5), 1);
    near(tr(mid.card).scale, (1 + SIDE_SCALE) / 2);
    near(mid.dim.opacity, SIDE_DIM / 2);
    // Оттяжка первой карточки вправо: меньше 1, как у соседки, и к плашке; с отпусканием — снова 1.
    const pulled = await look(PULL_TRIGGER, 0);
    near(tr(pulled.card).scale, SIDE_SCALE);
    expect(tr(pulled.card).translateX).toBeLessThan(0);
    near(tr((await look(0, 0)).card).scale, 1);
    // «Уменьшение движения»: оттяжка карточку не трогает.
    expect(tr((await look(PULL_TRIGGER, 0, true)).card)).toEqual({ translateX: 0, scale: 1 });
    // Только трансформации: раскладку анимация не трогает.
    expect(centre.card.transform.map((t) => Object.keys(t)[0])).toEqual(['translateX', 'scale']);
  });
});

describe('края колоды', () => {
  beforeEach(() => {
    closeSheet();
    jest.clearAllMocks();
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
      projects: projectsOf(4),
      statuses: [],
      tasks: [],
      activeTimer: null,
    });
  });
  const flatten = (node) => StyleSheet.flatten(node.props.style) || {};
  const near = (a, b) => expect(a).toBeCloseTo(b, 6);
  // Общие значения reanimated в jest-подмене на каждой отрисовке заводятся
  // заново, поэтому весь путь — одним жестом с нулевой точки, без остановок.
  const swipe = (q, translationX, velocityX = 0) => act(async () => {
    fireGestureHandler(getByGestureTestId('deck-pan'), [
      { state: State.BEGAN, translationX: 0 },
      { state: State.ACTIVE, translationX: 0 },
      { translationX: translationX / 2 },
      { translationX },
      { state: State.END, translationX, velocityX },
    ]);
  });

  test('«+» в ряду точек размером с точку и не растёт: за порогом только светлеет', async () => {
    const styles = new Proxy({}, { get: () => ({}) });
    const plusAt = async (xv, armed) => {
      const q = await render(<Dots x={{ value: xv }} step={STEP} count={4} armed={{ value: armed }} onGo={() => {}} onNew={() => {}} styles={styles} lang="ru" />);
      const glyph = q.getByTestId('deck-plus-glyph');
      const icons = glyph.children.filter((n) => n.type === 'RNSVGSvgView' || (n.children || []).some((c) => c.type === 'RNSVGSvgView'));
      const svg = (n) => (n.type === 'RNSVGSvgView' ? n : n.children.find((c) => c.type === 'RNSVGSvgView'));
      const out = {
        transform: StyleSheet.flatten(glyph.props.style).transform,
        size: icons.map((n) => svg(n).props.width),
        lit: StyleSheet.flatten(icons[1].props.style).opacity,
      };
      await q.unmount();
      return out;
    };
    const rest = await plusAt(0, 0);
    const pulled = await plusAt(PULL_TRIGGER * 2, 1);
    // Размер один и тот же в покое и за порогом — роста нет, масштаба нет.
    expect(rest.size).toEqual([9, 9]);
    expect(pulled.size).toEqual(rest.size);
    expect(rest.transform).toBeUndefined();
    expect(pulled.transform).toBeUndefined();
    // Светлеет: в покое подсветки нет, на полпути — часть, за порогом — целиком.
    expect(rest.lit).toBe(0);
    expect((await plusAt(PULL_TRIGGER / 2, 0)).lit).toBeCloseTo(0.45 * 0.5, 10);
    expect(pulled.lit).toBe(1);
  });

  test('слева от точек стоит «+»: он ведёт к созданию проекта', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    const plus = q.getByTestId('deck-plus-dot');
    expect(plus.props.accessibilityLabel).toBe(t('ru', 'deck.new_project'));
    // Рядом с точками — «+» и по точке на проект.
    for (let i = 0; i < 4; i += 1) q.getByLabelText(dotLabel(i));
    expect(useSheetStore.getState().content).toBeNull();
    await fireEvent.press(plus);
    expect(useSheetStore.getState().content.type).toBe(NewProjectSheet);
  });

  // Фраза на плашке — одна из списка, в двух слоях (серая и светлая за порогом).
  const phraseOf = (q) => {
    const card = q.getByTestId('deck-phrase');
    const ru = DECK_PHRASES.map((key) => t('ru', key));
    const shown = ru.filter((p) => within(card).queryAllByText(p, { includeHiddenElements: true }).length === 2);
    expect(shown).toHaveLength(1);
    return shown[0];
  };

  test('правый край: серая плашка (серая шкала, не акцент) с фразой, без стрелки', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    const card = q.getByTestId('deck-phrase');
    // Плашка — ступень panel2, при срабатывании светлеет на ступень (raise).
    expect(flatten(card).backgroundColor).toBe(colors.panel2);
    const lit = flatten(q.getByTestId('deck-phrase-on')).backgroundColor;
    expect(lit).toBe(colors.raise);
    for (const c of [flatten(card).backgroundColor, lit]) {
      expect(c).not.toBe(colors.accent);
      expect(c).not.toBe(colors.accentText);
      expect(c).not.toBe(colors.accentMuted);
    }
    // Значков на плашке нет — ни стрелки «к первому», ни «+»: из путей на ней
    // одни искры (по два слоя на искру — обычный и пасхальный), и лежат они в своём слое.
    const walk = (n, out = []) => { if (n && typeof n === 'object') { out.push(n); (n.children || []).forEach((c) => walk(c, out)); } return out; };
    const paths = (n) => walk(n).filter((x) => x.type === 'RNSVGPath');
    expect(paths(card)).toHaveLength(SPARKS.length * 2);
    expect(paths(within(card).getByTestId('deck-sparks', { includeHiddenElements: true }))).toHaveLength(SPARKS.length * 2);
    expect(card.props.accessibilityLabel).toBe(phraseOf(q));
  });

  test('единственный проект: плашка с фразой справа тоже есть, «+» у точек на месте', async () => {
    useAppStore.setState({ projects: projectsOf(1) });
    const q = await render(<ProjectsScreen navigation={nav()} />);
    q.getByTestId('deck-phrase');
    q.getByTestId('deck-plus-dot');
  });

  test('жест у правого края: за порогом щелчок, на каждой оттяжке новая фраза, колода к первой не едет', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    const toLast = -3 * (width - screenPadding - 40 + 10);
    // Провели до последней и чуть дальше — порога нет: щелчка нет, но
    // оттяжка началась — фраза уже новая.
    const first = phraseOf(q);
    await swipe(q, toLast - 40);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    const second = phraseOf(q);
    expect(second).not.toBe(first);

    // Дальше порога и отпустили — щелчок, новая фраза, проект не создаётся,
    // колода не уезжает к первой (видна третья карточка рядом с текущей).
    await swipe(q, toLast - PULL_TRIGGER * 3);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(phraseOf(q)).not.toBe(second);
    q.getByText('Проект 3');
    expect(useSheetStore.getState().content).toBeNull();
    expect(useAppStore.getState().projects).toHaveLength(4);
  });

  // Жест одним вызовом, с отпусканием (END) или без. Подмена reanimated на каждой
  // отрисовке заводит общие значения заново, а жест держит значения первой
  // отрисовки; чтобы видеть, что жест записал, значения на время теста
  // заменяются на стабильные — те же объекты на всех отрисовках.
  const hold = (release, ...translations) => act(async () => {
    const last = translations[translations.length - 1];
    fireGestureHandler(getByGestureTestId('deck-pan'), [
      { state: State.BEGAN, translationX: 0 },
      { state: State.ACTIVE, translationX: 0 },
      ...translations.map((translationX) => ({ translationX })),
      ...(release ? [{ state: State.END, translationX: last, velocityX: 0 }] : []),
    ]);
  });

  test('взрыв искр: защёлка ставится с отпусканием за порогом, а не на пороге; недотянул — не ставится; снимается новой оттяжкой', async () => {
    // Порядок записей в общие значения: по нему видно, когда выстрелила защёлка —
    // посреди жеста (на пороге) или в его конце (с отпусканием).
    const writes = [];
    const ids = new Map();
    let made = 0;
    const stable = jest.spyOn(Reanimated, 'useSharedValue').mockImplementation((init) => {
      const ref = useRef(null);
      if (!ref.current) {
        const id = made++;
        ref.current = new Proxy({ value: init }, {
          set: (target, prop, value) => {
            target[prop] = value;
            if (prop === 'value') writes.push({ id, value });
            return true;
          },
        });
        ids.set(ref.current, id);
      }
      return ref.current;
    });
    // Защёлку слой искр получает свойством: смотрим на то, что ему отдано.
    const spy = jest.spyOn(SparksModule, 'default');
    try {
      await render(<ProjectsScreen navigation={nav()} />);
      const stepReal = width - screenPadding - 40 + 10;
      const firedSV = spy.mock.calls[spy.mock.calls.length - 1][0].fired;
      const fired = () => firedSV.value;
      const firedId = ids.get(firedSV);
      // Колода на последней карточке: дальше любая оттяжка влево — за край.
      for (let k = 0; k < 3; k++) await hold(true, -stepReal);
      // Что жест записал в сдвиг колоды (первое значение экрана) и в защёлку.
      const gesture = async (...args) => {
        const from = writes.length;
        await hold(...args);
        return writes.slice(from);
      };
      const firedAt = (log) => log.findIndex((w) => w.id === firedId && w.value === 1);
      const lastX = -3 * stepReal;

      // Оттяжка есть, порога нет: ни хаптики, ни выстрела — искры идут за пальцем и тают с плашкой.
      await gesture(false, -40);
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
      expect(fired()).toBe(0);

      // Перешли порог и держим дальше (два кадра оттяжки за порогом): хаптика на
      // пороге, а защёлка — только после последнего кадра оттяжки, то есть с отпусканием.
      const held = await gesture(false, -100, -PULL_TRIGGER * 3);
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
      const lastPull = held.reduce((a, w, k) => (w.id === 0 && w.value < lastX - PULL_TRIGGER ? k : a), -1);
      expect(lastPull).toBeGreaterThan(0);
      expect(firedAt(held)).toBeGreaterThan(lastPull);
      expect(fired()).toBe(1);

      // Перешли порог и вернулись под него, не отпуская: порог снят (ещё один
      // щелчок), отпустили ниже порога — взрыва нет, искры тают вместе с плашкой.
      const back = await gesture(false, -PULL_TRIGGER * 3, -20);
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(3);
      expect(firedAt(back)).toBe(-1);
      expect(fired()).toBe(0);

      // Отпустили за порогом: защёлка не сбрасывается — взрыв доигрывает, а плашка
      // уезжает, и искры не должны вернуться вместе с оттяжкой, идущей к нулю.
      await hold(true, -PULL_TRIGGER * 3);
      expect(fired()).toBe(1);
      // Колода осталась на последней карточке. Новая оттяжка (от неё жест
      // считает сдвиг заново): защёлка снята, порога нет — искры идут за пальцем.
      await hold(false, -40);
      expect(fired()).toBe(0);
      // И с отпусканием за порогом в этой оттяжке — снова выстрел.
      await hold(false, -PULL_TRIGGER * 3);
      expect(fired()).toBe(1);
    } finally {
      spy.mockRestore();
      stable.mockRestore();
    }
  });

  // Карусель на экране целиком. Утилита жестов сама заканчивает любой жест
  // (END), поэтому «середину» не увидеть по картинке после жеста: вместо этого
  // на каждую запись в x (первое общее значение экрана — сдвиг колоды) снимается
  // кадр — то, что на устройстве сделал бы UI-поток: вид всех четырёх карточек
  // (deck-card-i, настоящей или оболочки) по новому x. Стили живые (live), а
  // значения стабильные: жест пишет в те же объекты, что читает кадр. Кадр
  // читается с экрана по номеру карточки, а не по порядку отрисовок: карточки
  // под memo со сменой страницы не перерисовываются.
  const carousel = async (body) => {
    const frames = [];
    let made = 0;
    const looksNow = () => {
      try {
        return [0, 1, 2, 3].map((i) => Object.assign({}, ...flatten(screen.getByTestId(`deck-card-${i}`)).transform));
      } catch (e) {
        return [];
      }
    };
    const shared = jest.spyOn(Reanimated, 'useSharedValue').mockImplementation((init) => {
      const ref = useRef(null);
      if (!ref.current) {
        const id = made++;
        // Запись в значение — кадр: стили карточек пересчитываются по новому x.
        ref.current = new Proxy({ value: init }, {
          set: (target, prop, value) => {
            target[prop] = value;
            if (id === 0 && prop === 'value') frames.push({ x: value, looks: looksNow() });
            return true;
          },
        });
      }
      return ref.current;
    });
    const styled = jest.spyOn(Reanimated, 'useAnimatedStyle').mockImplementation(live);
    try { await body(frames); } finally { styled.mockRestore(); shared.mockRestore(); }
  };
  const STEP_REAL = width - screenPadding - 40 + 10;
  const scales = (frame) => frame.looks.map((l) => l.scale);

  test('карусель в покое: центральная в полный рост, соседние и дальние — 0.94 и приглушены', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    const look = (i) => {
      const tr = Object.assign({}, ...flatten(q.getByTestId(`deck-card-${i}`)).transform);
      return { scale: tr.scale, shift: tr.translateX, dim: flatten(q.getByTestId(`deck-dim-${i}`)).opacity };
    };
    expect(look(0)).toMatchObject({ scale: 1, shift: 0, dim: 0 });
    // Пустые оболочки далёких карточек выглядят так же, как настоящие соседки.
    for (const i of [1, 2, 3]) expect(look(i)).toMatchObject({ scale: SIDE_SCALE, dim: SIDE_DIM });
    // Плашка с фразой у правого края, пока её не тянут, — такая же уменьшенная соседка.
    const phrase = Object.assign({}, ...flatten(q.getByTestId('deck-phrase')).transform);
    near(phrase.scaleX, SIDE_SCALE);
    near(phrase.scaleY, SIDE_SCALE);
  });

  test('посреди перелистывания: масштаб — функция положения, растёт приходящая, уменьшается уходящая', async () => {
    await carousel(async (frames) => {
      await render(<ProjectsScreen navigation={nav()} />);
      frames.length = 0;
      await hold(false, -STEP_REAL * 0.25, -STEP_REAL * 0.75);
      // Кадры: 25% пути, 75% пути и встала на следующей карточке (пружина).
      const [a, b, end] = frames;
      expect(a.x).toBeCloseTo(-STEP_REAL * 0.25, 6);
      near(scales(a)[0], 1 - (1 - SIDE_SCALE) * 0.25);
      near(scales(a)[1], SIDE_SCALE + (1 - SIDE_SCALE) * 0.25);
      near(scales(b)[1], SIDE_SCALE + (1 - SIDE_SCALE) * 0.75);
      expect(scales(b)[1]).toBeGreaterThan(scales(a)[1]);
      expect(scales(b)[0]).toBeLessThan(scales(a)[0]);
      // Дальние карточки в пути остаются соседскими, не растут.
      near(scales(a)[2], SIDE_SCALE);
      near(scales(b)[3], SIDE_SCALE);
      // Отпустили — следующая в полный рост, прежняя — соседка.
      expect(end.x).toBeCloseTo(-STEP_REAL, 6);
      expect(end.looks[1]).toMatchObject({ scale: 1, translateX: 0 });
      near(scales(end)[0], SIDE_SCALE);
    });
  });

  test('оттяжка первой карточки вправо: уменьшается с оттяжкой, не растёт, с отпусканием возвращается, проект не создаётся', async () => {
    await carousel(async (frames) => {
      await render(<ProjectsScreen navigation={nav()} />);
      frames.length = 0;
      await hold(false, 10, 40);
      const [a, b, end] = frames;
      expect(a.x).toBeGreaterThan(0);
      // Не растёт: меньше 1 уже на первой оттяжке и дальше только меньше — до соседской.
      expect(scales(a)[0]).toBeLessThan(1);
      expect(scales(b)[0]).toBeLessThan(scales(a)[0]);
      expect(scales(b)[0]).toBeGreaterThanOrEqual(SIDE_SCALE);
      near(scales(b)[0], 1 - (1 - SIDE_SCALE) * pullAmount(b.x));
      // Уходит к «+», а не от него: сдвиг влево.
      expect(b.looks[0].translateX).toBeLessThan(0);
      // Соседка остаётся соседкой.
      near(scales(b)[1], SIDE_SCALE);
      // Отпустили до порога: колода на месте, карточка снова 1.
      expect(end.x).toBeCloseTo(0, 6);
      expect(end.looks[0]).toMatchObject({ scale: 1, translateX: 0 });
      expect(useSheetStore.getState().content).toBeNull();
    });
  });

  test('оттяжка последней карточки влево: уменьшается, не растёт, с отпусканием возвращается, колода на ней', async () => {
    await carousel(async (frames) => {
      const q = await render(<ProjectsScreen navigation={nav()} />);
      for (let k = 0; k < 3; k++) await hold(true, -STEP_REAL);
      frames.length = 0;
      await hold(false, -20, -60);
      const [a, b, end] = frames;
      expect(scales(a)[3]).toBeLessThan(1);
      expect(scales(b)[3]).toBeLessThan(scales(a)[3]);
      expect(scales(b)[3]).toBeGreaterThanOrEqual(SIDE_SCALE);
      expect(b.looks[3].translateX).toBeGreaterThan(0);
      near(scales(b)[2], SIDE_SCALE);
      // Отпустили: колода встаёт на последнюю (к первой не едет), карточка снова 1.
      expect(end.x).toBeCloseTo(-3 * STEP_REAL, 6);
      expect(end.looks[3]).toMatchObject({ scale: 1, translateX: 0 });
      q.getByText('Проект 4');
    });
  });

  test('«уменьшение движения»: карточка от оттяжки не меняется, соседки по-прежнему меньше', async () => {
    const still = jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    try {
      await carousel(async (frames) => {
        await render(<ProjectsScreen navigation={nav()} />);
        frames.length = 0;
        await hold(false, 10, 60);
        for (const f of frames) {
          expect(f.looks[0]).toMatchObject({ scale: 1, translateX: 0 });
          near(scales(f)[1], SIDE_SCALE);
        }
      });
    } finally {
      still.mockRestore();
    }
  });

  // Плашки у краёв отдельно: вид корня по заданному сдвигу колоды (в реальном
  // порядке — зеркальные, поэтому у каждой своя оттяжка).
  const plankAt = async (which, xv, { armed = 0 } = {}) => {
    const styles = new Proxy({}, { get: () => ({}) });
    const q = await render(which === 'plus'
      ? <PlusCard x={{ value: xv }} armed={{ value: armed }} styles={styles} lang="ru" />
      : <PhraseCard x={{ value: xv }} armed={{ value: armed }} fired={{ value: 0 }} count={4} step={STEP} width={width} styles={styles} lang="ru" />);
    const root = which === 'plus' ? q.getByLabelText(t('ru', 'deck.new_project')) : q.getByTestId('deck-phrase');
    const tr = Object.assign({}, ...flatten(root).transform);
    await q.unmount();
    return tr;
  };
  const LAST = -3 * STEP;

  test('плашка «+» слева: уменьшенная соседка, с оттяжкой первой карточки растёт до 1 + EDGE_GROW', async () => {
    // Не тянут — как боковая карточка; и в ту сторону, где «+» не нужна, тоже.
    const rest = await plankAt('plus', 0);
    near(rest.scaleX, SIDE_SCALE);
    near(rest.scaleY, SIDE_SCALE);
    near((await plankAt('plus', -STEP)).scaleX, SIDE_SCALE);
    // Растёт вместе с пальцем: на полпути — между, на пороге — чуть больше 1, дальше не растёт.
    let prev = rest.scaleX;
    for (const x of [10, 25, 40, 55, PULL_TRIGGER]) {
      const v = (await plankAt('plus', x)).scaleX;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    const full = await plankAt('plus', PULL_TRIGGER);
    near(full.scaleX, 1 + EDGE_GROW);
    // По высоте — до высоты центральной карточки и не выше: верх не уходит под шапку.
    near(full.scaleY, 1);
    near((await plankAt('plus', PULL_TRIGGER * 3)).scaleX, 1 + EDGE_GROW);
    near((await plankAt('plus', PULL_TRIGGER / 2)).scaleX, edgeScale(0.5, false));
    // Край у первой карточки на месте: сдвиг — поправка к масштабу от центра плашки.
    near(full.translateX, edgeShift(1, false, 1));
    near(rest.translateX, edgeShift(0, false, 1));
  });

  test('плашка с фразой справа: уменьшенная соседка, с оттяжкой последней карточки растёт до 1 + EDGE_GROW', async () => {
    const rest = await plankAt('phrase', LAST);
    near(rest.scaleX, SIDE_SCALE);
    near(rest.scaleY, SIDE_SCALE);
    // «+» тянут вправо — плашка с фразой остаётся соседкой.
    near((await plankAt('phrase', 0)).scaleX, SIDE_SCALE);
    let prev = rest.scaleX;
    for (const pull of [10, 25, 40, 55, PULL_TRIGGER]) {
      const v = (await plankAt('phrase', LAST - pull)).scaleX;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    const full = await plankAt('phrase', LAST - PULL_TRIGGER);
    near(full.scaleX, 1 + EDGE_GROW);
    near(full.scaleY, 1);
    near((await plankAt('phrase', LAST - PULL_TRIGGER * 3)).scaleX, 1 + EDGE_GROW);
    // Край у последней карточки на месте — поправка в другую сторону, чем у «+».
    near(full.translateX, edgeShift(1, false, -1));
    near(rest.translateX, edgeShift(0, false, -1));
    expect(rest.translateX).toBeLessThan(0);
    expect((await plankAt('plus', 0)).translateX).toBeGreaterThan(0);
  });

  test('максимальная оттяжка: плашка не выше центральной карточки и верх не выше верха колоды, с обеих сторон', async () => {
    // Коробка колоды: центральная карточка и плашка у края занимают её во всю высоту,
    // плашка масштабируется от центра коробки. Высота колоды в тесте — условная.
    const H = 600;
    const geometry = (tr) => ({ height: H * tr.scaleY, top: (H - H * tr.scaleY) / 2 });
    const card = geometry({ scaleY: deckScale(1, -STEP, STEP, 5, false) });
    expect(card).toEqual({ height: H, top: 0 });
    for (const pulls of [PULL_TRIGGER, PULL_TRIGGER * 1.25, PULL_TRIGGER * 3, PULL_TRIGGER * 20]) {
      const g = [geometry(await plankAt('plus', pulls)), geometry(await plankAt('phrase', LAST - pulls))];
      for (const { height, top } of g) {
        expect(height).toBeLessThanOrEqual(card.height + 1e-9);
        expect(top).toBeGreaterThanOrEqual(-1e-9);
      }
    }
    // На пороге высота равна центральной карточке ровно: растёт до неё, выше не идёт.
    near(geometry(await plankAt('plus', PULL_TRIGGER)).height, H);
    near(geometry(await plankAt('phrase', LAST - PULL_TRIGGER)).height, H);
    // А по ширине — как задумано, чуть шире центральной.
    expect((await plankAt('plus', PULL_TRIGGER * 3)).scaleX).toBeGreaterThan(1);
  });

  test('«уменьшение движения»: плашки у краёв без масштаба', async () => {
    const still = jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true);
    try {
      for (const tr of [await plankAt('plus', 0), await plankAt('plus', PULL_TRIGGER), await plankAt('phrase', LAST), await plankAt('phrase', LAST - PULL_TRIGGER)]) {
        expect(tr).toMatchObject({ scaleX: 1, scaleY: 1 });
        expect(tr.translateX + 0).toBe(0);
      }
    } finally {
      still.mockRestore();
    }
  });

  test('проект без задач — пустой экран посередине карточки, на ступень мельче страничного, без кнопки', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    const [art] = q.getAllByTestId('art-tasks', { includeHiddenElements: true });
    // Сценка 90 × 66 вместо страничных 120 × 88, пропорции те же.
    expect(flatten(art)).toMatchObject({ width: 90, height: 66 });
    expect(90 / 66).toBeCloseTo(120 / 88, 2);
    // Заголовок и пояснение — на ступень мельче страничных (шкала fontSize): 16
    // против 20 и 12 против 14.
    const title = flatten(q.getAllByText(t('ru', 'deck.no_tasks'))[0]);
    const text = flatten(q.getAllByText(t('ru', 'empty.tasks_text'))[0]);
    expect(title.fontSize).toBe(fontSize.md);
    expect(title.fontSize).toBeLessThan(typography.title.fontSize);
    expect(text.fontSize).toBe(fontSize.xs);
    expect(text.fontSize).toBeLessThan(typography.caption.fontSize);
    // Посередине: обёртка растягивается на всю высоту списка и ставит по центру.
    const wrap = art.parent.parent;
    let box = wrap;
    while (box && flatten(box).justifyContent !== 'center') box = box.parent;
    expect(flatten(box)).toMatchObject({ flex: 1, justifyContent: 'center' });
    // Кнопки нет: строка новой задачи прямо над списком.
    expect(within(wrap).queryByTestId('primary-button')).toBeNull();
    expect(q.getAllByLabelText(t('ru', 'tasks.new_ph')).length).toBeGreaterThan(0);
  });

  test('жест у левого края по-прежнему открывает создание проекта', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    await swipe(q, PULL_TRIGGER * 3);
    expect(useSheetStore.getState().content.type).toBe(NewProjectSheet);
    q.getByText('Проект 1');
  });

  // --- Пасхалка у правого края -------------------------------------------------------

  // Дистанция пальца (pt), при которой оттяжка справа доходит до pull: жест
  // считает её через резинку (×0.8, потом rubberBand от 1.25 порога).
  const pullBy = (finger) => rubberBand(finger * 0.8, PULL_TRIGGER * 1.25);
  const fingerFor = (pull) => {
    let lo = 0;
    let hi = 4000;
    for (let k = 0; k < 60; k += 1) { const mid = (lo + hi) / 2; if (pullBy(mid) < pull) lo = mid; else hi = mid; }
    return hi;
  };
  const jokesRu = () => DECK_EGG_PHRASES.map((key) => t('ru', key));
  const usualRu = () => DECK_PHRASES.map((key) => t('ru', key));
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  test('порог пасхалки — одна константа, куда дальше обычного: палец проходит ~320 pt, почти весь экран', () => {
    expect(EGG_TRIGGER).toBe(170);
    expect(EGG_TRIGGER).toBeGreaterThan(PULL_TRIGGER * 2.2);
    const finger = fingerFor(EGG_TRIGGER);
    expect(finger).toBeGreaterThan(300);
    expect(finger).toBeLessThan(340);
    // Обычный порог — 87.5 pt пальцем; пасхальный в разы дальше.
    expect(finger).toBeGreaterThan(fingerFor(PULL_TRIGGER) * 3.5);
    // Сильная оттяжка за первый порог (200–300 pt) его не включает, а пролистывание тем более.
    for (const d of [100, 150, 200, 250, 300]) expect(pullBy(d)).toBeLessThan(EGG_TRIGGER);
    // Через почти весь экран достаётся: от ширины экрана — поле 20 pt (у края системный жест
    // «назад») и ~18 pt люфта, пока жест не активируется (замер на эмуляторе, Android). На телефоне
    // 360 pt шириной одним пальцем впритык (пасхалка там — двумя пальцами), на 393 и шире — с запасом.
    for (const w of [393, 411, 430]) expect(pullBy(w - 20 - 18)).toBeGreaterThan(EGG_TRIGGER);
    expect(pullBy(360 - 20 - 18)).toBeLessThan(EGG_TRIGGER + 2);
  });

  test('токены пасхалки: белый текст на пурпуре читается (не ниже 4.5 : 1), жёлтый — не серый, пурпур — не акцент', () => {
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    expect(ratio('#ffffff', colors.eggPlate)).toBeGreaterThanOrEqual(4.5);
    expect(colors.eggSpark).not.toBe(colors.textFaint);
    expect(colors.eggPlate).not.toBe(colors.accent);
  });

  // Плашка с готовыми значениями (подмена reanimated на отрисовке не считает
  // жест, поэтому egg и fired подставляются). Стили — пустышки: цвет проверяется
  // отдельно, на настоящем экране.
  const plankWith = async ({ egg = 0, fired = 0, still = false, ref } = {}) => {
    const styles = new Proxy({}, { get: () => ({}) });
    const spy = still ? jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true) : null;
    const q = await render(
      <PhraseCard x={{ value: LAST - 200 }} armed={{ value: 1 }} fired={{ value: fired }} egg={{ value: egg }} count={4} step={STEP} width={width} styles={styles} lang="ru" eggRef={ref} />,
    );
    return {
      q,
      done: () => { if (spy) spy.mockRestore(); },
      view: () => ({
        purple: flatten(q.getByTestId('deck-phrase-egg')).opacity,
        gray: flatten(q.getByTestId('deck-phrase-gray')).opacity,
        joke: flatten(q.getByTestId('deck-phrase-joke')).opacity,
        label: q.getByTestId('deck-phrase').props.accessibilityLabel,
        sparks: SPARKS.map((_, i) => flatten(q.getByTestId(`deck-spark-${i}-egg`, { includeHiddenElements: true })).opacity),
      }),
    };
  };

  test('плашка ниже порога пасхалки: серая, обычная фраза из списка, шутка и жёлтые слои искр скрыты', async () => {
    const { view, done } = await plankWith({ egg: 0 });
    try {
      const v = view();
      expect(v).toMatchObject({ purple: 0, gray: 1, joke: 0 });
      expect(v.sparks.every((o) => o === 0)).toBe(true);
      expect(usualRu()).toContain(v.label);
    } finally { done(); }
  });

  test('плашка за порогом пасхалки: пурпурный слой, шутка вместо фразы, жёлтые искры', async () => {
    const { q, view, done } = await plankWith({ egg: 1 });
    try {
      expect(view()).toMatchObject({ purple: 1, gray: 0, joke: 1, sparks: SPARKS.map(() => 1) });
      // Шутка — одна из пяти пасхальных, в одном экземпляре.
      const shown = jokesRu().filter((j) => within(q.getByTestId('deck-phrase-joke')).queryAllByText(j, { includeHiddenElements: true }).length === 1);
      expect(shown).toHaveLength(1);
    } finally { done(); }
  });

  test('плашка на полпути: цвет перетекает по ходу пасхалки, а фразы меняются по очереди — два текста вместе не видны', async () => {
    for (const egg of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      const { view, done } = await plankWith({ egg });
      try {
        const v = view();
        expect(v.purple).toBeCloseTo(egg, 6);
        // Первая половина гасит прежнюю фразу, вторая проявляет шутку.
        expect(v.gray).toBeCloseTo(Math.max(0, 1 - 2 * egg), 6);
        expect(v.joke).toBeCloseTo(Math.max(0, 2 * egg - 1), 6);
        expect(Math.min(v.gray, v.joke)).toBe(0);
      } finally { done(); }
    }
  });

  test('подпись плашки следует за пасхалкой, шутки на каждый заход разные, обратно — обычная фраза', async () => {
    const ref = { current: null };
    const { q, view, done } = await plankWith({ egg: 0, ref });
    try {
      const usual = view().label;
      expect(usualRu()).toContain(usual);
      let prev = null;
      for (let k = 0; k < 25; k += 1) {
        await act(async () => { ref.current(true); });
        const label = view().label;
        expect(jokesRu()).toContain(label);
        expect(label).not.toBe(prev);
        // Текст шутки в плашке — тот же, что в подписи.
        within(q.getByTestId('deck-phrase-joke')).getByText(label, { includeHiddenElements: true });
        prev = label;
        await act(async () => { ref.current(false); });
        expect(view().label).toBe(usual);
      }
    } finally { done(); }
  });

  test('после отпускания: пасхалка снята (серая плашка, обычная фраза), а искры взрыва остаются жёлтыми', async () => {
    // egg уже 0, защёлка взрыва 2 — состояние сразу после отпускания в пасхалке.
    const { view, done } = await plankWith({ egg: 0, fired: 2 });
    try {
      const v = view();
      expect(v).toMatchObject({ purple: 0, gray: 1, joke: 0 });
      expect(usualRu()).toContain(v.label);
      expect(v.sparks.every((o) => o === 1)).toBe(true);
    } finally { done(); }
  });

  test('«уменьшение движения»: пасхалка без перехода (withTiming не зовётся), шутка не подпрыгивает, цвет меняется сразу', async () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    const fades = () => timing.mock.calls.filter((c) => c[1] && c[1].duration === 260).length;
    try {
      const moving = await plankWith({ egg: 1 });
      expect(fades()).toBeGreaterThan(0);
      moving.done();
      timing.mockClear();
      const still = await plankWith({ egg: 1, still: true });
      try {
        expect(fades()).toBe(0);
        expect(still.view()).toMatchObject({ purple: 1, gray: 0, joke: 1 });
      } finally { still.done(); }
      // Подъём шутки (5 pt до появления) — только с движением.
      const lift = async (opts) => {
        const x = await plankWith(opts);
        const tr = flatten(x.q.getByTestId('deck-phrase-joke')).transform;
        x.done();
        return Object.assign({}, ...tr).translateY;
      };
      expect(await lift({ egg: 0 })).toBe(5);
      expect(await lift({ egg: 0, still: true })).toBe(0);
    } finally { timing.mockRestore(); }
  });

  test('настоящий экран: пурпурный слой — токен eggPlate, шутка — textOnColor, в покое слой прозрачен', async () => {
    const q = await render(<ProjectsScreen navigation={nav()} />);
    expect(flatten(q.getByTestId('deck-phrase-egg'))).toMatchObject({ backgroundColor: colors.eggPlate, opacity: 0 });
    // Серая плашка и её светлая ступень остались как были — пасхалка лежит поверх, а не вместо.
    expect(flatten(q.getByTestId('deck-phrase')).backgroundColor).toBe(colors.panel2);
    expect(flatten(q.getByTestId('deck-phrase-on')).backgroundColor).toBe(colors.raise);
    const joke = within(q.getByTestId('deck-phrase-joke')).getAllByText(/./, { includeHiddenElements: true });
    expect(joke).toHaveLength(1);
    expect(flatten(joke[0]).color).toBe(colors.textOnColor);
    expect(flatten(q.getByTestId('deck-phrase-joke')).opacity).toBe(0);
    expect(flatten(q.getByTestId('deck-phrase-gray')).opacity).toBe(1);
  });

  // Жесты у правого края с живыми значениями: каждая запись в любое общее значение
  // снимает, какими в этот миг видят пасхалку и защёлку искры (производные значения
  // подменены на живые, стили слоя искр читают их же).
  const withEdge = async (body, { still = false } = {}) => {
    const sparks = jest.spyOn(SparksModule, 'default');
    const trace = [];
    let tracing = false;
    const seen = () => {
      const props = sparks.mock.calls[sparks.mock.calls.length - 1][0];
      return { egg: props.egg.value, fired: props.fired.value };
    };
    const shared = jest.spyOn(Reanimated, 'useSharedValue').mockImplementation((init) => {
      const ref = useRef(null);
      if (!ref.current) {
        ref.current = new Proxy({ value: init }, {
          set: (target, prop, value) => {
            target[prop] = value;
            if (tracing && prop === 'value') trace.push(seen());
            return true;
          },
        });
      }
      return ref.current;
    });
    const derived = jest.spyOn(Reanimated, 'useDerivedValue').mockImplementation((fn) => ({ get value() { return fn(); } }));
    const motion = still ? jest.spyOn(ReduceMotion, 'useReduceMotion').mockReturnValue(true) : null;
    try {
      const q = await render(<ProjectsScreen navigation={nav()} />);
      // Колода на последней карточке: дальше любая оттяжка влево — за край.
      for (let k = 0; k < 3; k += 1) await hold(true, -STEP_REAL);
      Haptics.impactAsync.mockClear();
      // Жест с отпусканием: что снимали на пути, по порядку, без подряд идущих повторов.
      const run = async (...translations) => {
        trace.length = 0;
        tracing = true;
        await hold(true, ...translations);
        tracing = false;
        const dedupe = (key) => trace.map((f) => f[key]).filter((v, i, all) => i === 0 || v !== all[i - 1]);
        return { egg: dedupe('egg'), fired: dedupe('fired'), haptics: Haptics.impactAsync.mock.calls.map((c) => c[0]) };
      };
      await body({ q, run });
    } finally {
      if (motion) motion.mockRestore();
      derived.mockRestore();
      shared.mockRestore();
      sparks.mockRestore();
    }
  };
  const jokeShown = (q) => jokesRu().filter((j) => within(q.getByTestId('deck-phrase-joke')).queryAllByText(j, { includeHiddenElements: true }).length === 1);
  const sparkLit = (q) => SPARKS.map((_, i) => flatten(q.getByTestId(`deck-spark-${i}-egg`, { includeHiddenElements: true })).opacity);

  test('жест: сильная оттяжка за первый порог (палец 300 pt) пасхалку не включает — обычный щелчок, обычный взрыв', async () => {
    await withEdge(async ({ run }) => {
      const r = await run(-100, -300);
      expect(r.egg).toEqual([0]);
      expect(r.haptics).toEqual(['medium']);
      expect(r.fired).toEqual([0, 1]);
    });
  });

  test('жест: палец прошёл ~340 pt — пасхалка включилась один раз, тяжёлый удар после обычного щелчка, взрыв жёлтый (2); отпустили — снята', async () => {
    await withEdge(async ({ q, run }) => {
      const before = jokeShown(q);
      expect(before).toHaveLength(1);
      const r = await run(-100, -340);
      expect(r.egg).toEqual([0, 1, 0]);
      expect(r.haptics).toEqual(['medium', 'heavy']);
      expect(r.fired).toEqual([0, 2]);
      // Отпустили: пасхалка и всё её — сброшено. Плашка серая, подпись — обычная фраза,
      // шутка уже другая, чем была, а искры взрыва жёлтые.
      const style = (id) => flatten(q.getByTestId(id));
      expect(style('deck-phrase-egg').opacity).toBe(0);
      expect(style('deck-phrase-joke').opacity).toBe(0);
      expect(style('deck-phrase-gray').opacity).toBe(1);
      expect(usualRu()).toContain(q.getByTestId('deck-phrase').props.accessibilityLabel);
      const after = jokeShown(q);
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(before[0]);
      expect(sparkLit(q).every((o) => o === 1)).toBe(true);
    });
  });

  test('жест: рывок через оба порога разом — один тяжёлый удар, без обычного щелчка; глубже держишь — не повторяется', async () => {
    await withEdge(async ({ run }) => {
      expect((await run(-400)).haptics).toEqual(['heavy']);
      Haptics.impactAsync.mockClear();
      const held = await run(-100, -400, -420, -450, -480);
      expect(held.haptics).toEqual(['medium', 'heavy']);
      expect(held.egg).toEqual([0, 1, 0]);
    });
  });

  test('жест: вернулся под порог пасхалки, не отпуская, — обычная плашка без хаптики; заход заново — ещё удар', async () => {
    await withEdge(async ({ run }) => {
      const back = await run(-100, -400, -300);
      // Снята до отпускания: защёлка взрыва — обычная, 1, а не жёлтая.
      expect(back.egg).toEqual([0, 1, 0]);
      expect(back.fired).toEqual([0, 1]);
      expect(back.haptics).toEqual(['medium', 'heavy']);
      Haptics.impactAsync.mockClear();
      const again = await run(-100, -400, -300, -400);
      expect(again.egg).toEqual([0, 1, 0, 1, 0]);
      expect(again.haptics).toEqual(['medium', 'heavy', 'heavy']);
      // Начало жеста снимает защёлку прошлой оттяжки (1), конец ставит жёлтую (2).
      expect(again.fired).toEqual([1, 0, 2]);
    });
  });

  test('жест: после отпускания из пасхалки новая оттяжка до обычного порога — серая плашка, обычная фраза, искры серые', async () => {
    await withEdge(async ({ q, run }) => {
      const first = await run(-100, -400);
      expect(first.fired).toEqual([0, 2]);
      Haptics.impactAsync.mockClear();
      // Новая оттяжка: защёлка прошлой (2) снята началом, пасхалки нет, щелчка нет.
      const next = await run(-50);
      expect(next.egg).toEqual([0]);
      expect(next.fired).toEqual([2, 0]);
      expect(next.haptics).toEqual([]);
      const style = (id) => flatten(q.getByTestId(id));
      expect(style('deck-phrase-egg')).toMatchObject({ backgroundColor: colors.eggPlate, opacity: 0 });
      expect(style('deck-phrase-joke').opacity).toBe(0);
      expect(style('deck-phrase-gray').opacity).toBe(1);
      expect(usualRu()).toContain(q.getByTestId('deck-phrase').props.accessibilityLabel);
      expect(sparkLit(q).every((o) => o === 0)).toBe(true);
      // Дошёл до обычного порога и отпустил — обычный взрыв (1), снова не жёлтый.
      const usual = await run(-100);
      expect(usual.egg).toEqual([0]);
      expect(usual.fired).toEqual([0, 1]);
      expect(sparkLit(q).every((o) => o === 0)).toBe(true);
    });
  });

  test('жест: серия заходов в пасхалку — шутки подряд не повторяются', async () => {
    let seed = 4242;
    const random = jest.spyOn(Math, 'random').mockImplementation(() => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; });
    try {
      await withEdge(async ({ q, run }) => {
        const seq = [jokeShown(q)[0]];
        for (let k = 0; k < 20; k += 1) {
          await run(-100, -400);
          seq.push(jokeShown(q)[0]);
        }
        for (let i = 1; i < seq.length; i += 1) expect(seq[i]).not.toBe(seq[i - 1]);
        expect(new Set(seq).size).toBeGreaterThanOrEqual(3);
        for (const j of seq) expect(jokesRu()).toContain(j);
      });
    } finally { random.mockRestore(); }
  });

  test('жест при «уменьшении движения»: хаптика пасхалки остаётся, снятие с отпусканием — то же', async () => {
    await withEdge(async ({ run }) => {
      const r = await run(-100, -400);
      expect(r.haptics).toEqual(['medium', 'heavy']);
      expect(r.egg).toEqual([0, 1, 0]);
      expect(r.fired).toEqual([0, 2]);
    }, { still: true });
  });
});

describe('порядок колоды — по свежести (круг 21)', () => {
  /** Навигация с настоящими focus и blur: колода держит порядок в фокусе. */
  const focusNav = () => {
    const subs = {};
    return {
      navigate: jest.fn(),
      setOptions: jest.fn(),
      isFocused: () => true,
      addListener: (name, cb) => {
        (subs[name] = subs[name] || new Set()).add(cb);
        return () => subs[name].delete(cb);
      },
      emit: (name) => act(async () => { (subs[name] || new Set()).forEach((cb) => cb()); }),
    };
  };
  // Подмена reanimated заводит общие значения на каждой отрисовке заново —
  // колода не помнила бы, куда встала. На время теста — стабильные значения, а
  // стиль — живой (live): считается при каждом чтении, как кадр UI-потока.
  let restore = null;
  beforeEach(() => {
    const shared = jest.spyOn(Reanimated, 'useSharedValue').mockImplementation((init) => {
      const ref = useRef(null);
      if (!ref.current) ref.current = { value: init };
      return ref.current;
    });
    const styled = jest.spyOn(Reanimated, 'useAnimatedStyle').mockImplementation(live);
    restore = () => { styled.mockRestore(); shared.mockRestore(); };
  });
  afterEach(() => { if (restore) restore(); restore = null; });
  const flatten = (node) => StyleSheet.flatten(node.props.style) || {};
  const nameAt = (q, i) => {
    const card = q.getByTestId(`deck-card-${i}`);
    return ['Сайт', 'Бот', 'Почта', 'Новый'].find((n) => within(card).queryByText(n));
  };
  /** Какая карточка в центре — в полный рост. */
  const inView = (q, n) => Array.from({ length: n }, (_, i) => i)
    .find((i) => Object.assign({}, ...flatten(q.getByTestId(`deck-card-${i}`)).transform).scale === 1);

  test('первым — проект с последними изменениями (в задачах или в нём самом); закреплённый первым не встаёт', async () => {
    useAppStore.setState({
      projects: [
        { id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z', pinnedAt: '2026-10-03T00:00:00.000Z' },
        { id: 'p2', name: 'Бот', color: '#5ec8f2', createdAt: '2026-10-02T00:00:00.000Z' },
        { id: 'p3', name: 'Почта', color: '#ff7a59', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z' },
      ],
      tasks: [task('t1', 'p1', 'Вёрстка'), task('t3', 'p2', 'Команды', { updatedAt: '2026-10-05T00:00:00.000Z' })],
    });
    const q = await render(<ProjectsScreen navigation={nav()} />);
    // «Бот» — свежая задача, «Почта» — правка самого проекта, «Сайт» закреплён, но старше всех.
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Бот', 'Почта']);
    expect(inView(q, 3)).toBe(0);
  });

  test('в фокусе порядок держится: новая задача в карточке колоду не переставляет; ушли — по свежести, на экране та же карточка', async () => {
    const navigation = focusNav();
    const q = await render(<ProjectsScreen navigation={navigation} />);
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Бот', 'Сайт']);
    // Задача в «Сайт» — он теперь свежее, но под пальцем колода не прыгает.
    const site = within(q.getByTestId('deck-card-1')).getByLabelText(t('ru', 'tasks.new_ph'));
    await fireEvent.changeText(site, 'Футер');
    await fireEvent(site, 'submitEditing');
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Бот', 'Сайт']);
    expect(inView(q, 2)).toBe(0);
    // Ушли с экрана (задача открылась поверх) — порядок заново: «Сайт» первым,
    // а на экране всё тот же «Бот» — уже второй карточкой.
    await navigation.emit('blur');
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Сайт', 'Бот']);
    expect(inView(q, 2)).toBe(1);
    await navigation.emit('focus');
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Сайт', 'Бот']);
    expect(inView(q, 2)).toBe(1);
  });

  test('новый проект — слева; заведённый из колоды — на экране, когда к ней вернулись', async () => {
    const navigation = focusNav();
    const q = await render(<ProjectsScreen navigation={navigation} />);
    await fireEvent.press(q.getByTestId('deck-plus-dot'));
    const sheet = useSheetStore.getState().content;
    expect(sheet.type).toBe(NewProjectSheet);
    // Лист заводит проект и зовёт onCreated — колода открывает его страницу.
    let made;
    await act(async () => {
      made = useAppStore.getState().createProject({ name: 'Новый' });
      sheet.props.onCreated(made);
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Project', { projectId: made.id });
    expect(nameAt(q, 0)).toBe('Новый');
    await navigation.emit('blur');
    await navigation.emit('focus');
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Новый', 'Бот']);
    expect(inView(q, 3)).toBe(0);
  });

  test('новый проект, заведённый не из колоды, тоже встаёт слева, а на экране остаётся прежняя', async () => {
    const q = await render(<ProjectsScreen navigation={focusNav()} />);
    await act(async () => { useAppStore.getState().createProject({ name: 'Новый' }); });
    expect([0, 1, 2].map((i) => nameAt(q, i))).toEqual(['Новый', 'Бот', 'Сайт']);
    expect(inView(q, 3)).toBe(1);
  });

  // --- кадры: колода не проявляется по одной (жалоба 19 октября) ---
  //
  // Порядок лежал в ref и менялся в отрисовке, а страницу догонял эффект после
  // неё: на экран успевала фиксация с новым порядком и старой страницей —
  // посередине чужая карточка, нужная — пустой оболочкой (окно ±1 на старом
  // номере); следом её карточка пересоздавалась. На каждый шаг дочитывания
  // данных. Кадр — то, что после фиксации (layout-эффекты прошли) на экране.

  /** Какая карточка посередине (номер, имя; '_' — пустая оболочка) и какие
   *  нарисованы настоящими. */
  const frame = (q) => {
    const cards = q.queryAllByTestId(/^deck-card-\d+$/);
    const at = cards.findIndex((card) => Object.assign({}, ...(flatten(card).transform || [])).scale === 1);
    return { at, name: at < 0 ? null : nameAt(q, at) || '_', real: cards.map((_, i) => i).filter((i) => nameAt(q, i)) };
  };
  /** Экран, у которого записан кадр каждой фиксации. */
  async function watched(navigation) {
    const frames = [];
    let q = null;
    q = await render(<Profiler id="deck" onRender={() => { if (q) frames.push(frame(q)); }}><ProjectsScreen navigation={navigation} /></Profiler>);
    return { q, frames };
  }
  const SITE = { id: 'p1', name: 'Сайт', color: '#87ff65', createdAt: '2026-10-01T00:00:00.000Z' };
  const BOT = { id: 'p2', name: 'Бот', color: '#5ec8f2', createdAt: '2026-10-02T00:00:00.000Z' };
  const MAIL = { id: 'p3', name: 'Почта', color: '#ff7a59', createdAt: '2026-09-01T00:00:00.000Z' };
  const retime = (id, at) => (s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, updatedAt: at } : x)) });

  test('данные дочитываются шагами в пустую колоду: в каждом кадре посередине первая, настоящие — окно вокруг неё (±DECK_KEEP), порядок по свежести шага', async () => {
    useAppStore.setState({ projects: [], tasks: [] });
    const navigation = focusNav();
    const { q, frames } = await watched(navigation);
    const steps = [
      // Прочиталась область: два проекта с задачами.
      [() => useAppStore.setState({ projects: [SITE, BOT], tasks: [task('t1', 'p1', 'Вёрстка'), task('t3', 'p2', 'Команды')] }), ['Бот', 'Сайт']],
      // Первая связь: с другого устройства приехала «Почта», её правили позже.
      [() => useAppStore.setState((s) => ({ projects: [...s.projects, { ...MAIL, updatedAt: '2026-10-04T00:00:00.000Z' }] })), ['Почта', 'Бот', 'Сайт']],
      // Приём правок: задачу «Сайта» правили позже всех.
      [() => useAppStore.setState(retime('t1', '2026-10-05T00:00:00.000Z')), ['Сайт', 'Почта', 'Бот']],
      // Миграция после приёма: те же данные новыми объектами.
      [() => useAppStore.setState((s) => ({ projects: s.projects.map((x) => ({ ...x })), tasks: s.tasks.map((x) => ({ ...x })) })), ['Сайт', 'Почта', 'Бот']],
    ];
    for (const [change, order] of steps) {
      frames.length = 0;
      await act(async () => { change(); });
      expect(frames.length).toBeGreaterThan(0);
      // Карточек не больше трёх — все в окне ±2 от первой.
      for (const f of frames) expect(f).toEqual({ at: 0, name: order[0], real: order.map((_, i) => i) });
      expect(nameAt(q, 1)).toBe(order[1]);
    }
    // Колоду тронули — дочитывание кончилось: дальше в фокусе порядок держится.
    await fireEvent(q.getByTestId('deck'), 'touchStart');
    await act(async () => { useAppStore.setState(retime('t3', '2026-10-06T00:00:00.000Z')); });
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Сайт', 'Почта']);
    // Ушли — порядок по свежести, на экране та, что была.
    await navigation.emit('blur');
    expect([0, 1, 2].map((i) => nameAt(q, i))).toEqual(['Бот', 'Сайт', 'Почта']);
    expect(frame(q)).toEqual({ at: 1, name: 'Сайт', real: [0, 1, 2] });
  });

  test('ушли с экрана, порядок сменился: в каждом кадре посередине та же карточка, она не пересоздаётся — черновик в ней цел', async () => {
    useAppStore.setState({ projects: [SITE, BOT, MAIL] });
    const navigation = focusNav();
    const { q, frames } = await watched(navigation);
    // Колода по свежести: «Бот», «Сайт», «Почта». Встали на «Почту».
    await fireEvent.press(q.getByLabelText(dotLabel(2)));
    expect(frame(q)).toEqual({ at: 2, name: 'Почта', real: [0, 1, 2] });
    const draft = () => within(q.getByTestId(`deck-card-${frame(q).at}`)).getByLabelText(t('ru', 'tasks.new_ph')).props.value;
    await fireEvent.changeText(within(q.getByTestId('deck-card-2')).getByLabelText(t('ru', 'tasks.new_ph')), 'Письмо');
    await navigation.emit('blur');
    // Пока экрана не видно, «Почту» переименовали на другом устройстве — она свежее всех.
    frames.length = 0;
    await act(async () => { useAppStore.setState((s) => ({ projects: s.projects.map((x) => (x.id === 'p3' ? { ...x, name: 'Почта', updatedAt: '2026-10-07T00:00:00.000Z' } : x)) })); });
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(f).toEqual({ at: 0, name: 'Почта', real: [0, 1, 2] });
    await navigation.emit('focus');
    expect([0, 1].map((i) => nameAt(q, i))).toEqual(['Почта', 'Бот']);
    expect(frame(q)).toEqual({ at: 0, name: 'Почта', real: [0, 1, 2] });
    expect(draft()).toBe('Письмо');
  });

  test('новый проект приехал, пока смотрят колоду: в каждом кадре посередине та же карточка', async () => {
    const { q, frames } = await watched(focusNav());
    frames.length = 0;
    await act(async () => { useAppStore.getState().createProject({ name: 'Новый' }); });
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(f).toEqual({ at: 1, name: 'Бот', real: [0, 1, 2] });
    expect(nameAt(q, 0)).toBe('Новый');
  });

  test('deckNext: удалили карточку на экране — встаёт соседняя, не за краем; ничего не поменялось — то же состояние', () => {
    let d = deckChoose(deckStart(['a', 'b', 'c'], true), 2);
    expect(d).toMatchObject({ page: 2, viewed: 'c', loading: false });
    d = deckNext(d, { have: ['a', 'b'], fresh: () => ['b', 'a'], focused: true });
    // В фокусе порядок держится: удалённая уходит, остальные на местах.
    expect(d).toMatchObject({ ids: ['a', 'b'], page: 1, viewed: 'b' });
    // Тот же набор — порядок свежих данных даже не спрашивается.
    expect(deckNext(d, { have: ['b', 'a'], fresh: () => { throw new Error('не нужен'); }, focused: true })).toBe(d);
    // Пустая колода дочитывает; тронули — уже нет.
    const empty = deckStart([], true);
    expect(empty.loading).toBe(true);
    expect(deckTouched(empty)).toBe(empty);
    const loaded = deckNext(empty, { have: ['a'], fresh: () => ['a'], focused: true });
    expect(loaded).toMatchObject({ ids: ['a'], page: 0, viewed: null, loading: true });
    expect(deckTouched(loaded)).toMatchObject({ loading: false });
  });
});

// --- окно карточек (жалоба 20 октября: «прогрузка следующей карточки тормозит») ---
//
// С отпусканием колоды страница менялась сразу, и в тот же миг монтировалась
// новая соседка — тяжёлая карточка (список задач, теги, поле ввода), а все
// смонтированные перерисовывались: на новой архитектуре виды создаются на
// UI-потоке, и пружина спотыкалась под конец хода. Теперь настоящие карточки —
// окно ±DECK_KEEP вокруг страницы, на которой колода встала (deck.win), и
// сдвигается оно только с остановкой пружины; видимые (страница ± 1) настоящие
// всегда. Карточки под memo: смена страницы их не перерисовывает.
describe('окно карточек: монтаж — когда колода встала, а не на ходу пружины', () => {
  let springs = [];
  let restore = null;
  beforeEach(() => {
    closeSheet();
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark' },
      projects: projectsOf(6),
      statuses: [],
      tasks: [],
      activeTimer: null,
    });
    springs = [];
    // Общие значения стабильные (как на устройстве), стили живые (кадр
    // UI-потока). Пружина колоды доезжает, только когда тест скажет
    // (finish); любая следующая запись в то же значение — новый жест,
    // перестановка — её прерывает: колбэк получает false, как на устройстве.
    const shared = jest.spyOn(Reanimated, 'useSharedValue').mockImplementation((init) => {
      const ref = useRef(null);
      if (!ref.current) {
        ref.current = new Proxy({ value: init }, {
          set: (target, prop, value) => {
            if (prop === 'value') {
              springs = springs.filter((s) => {
                if (!s.sv && value === s.to) { s.sv = target; return true; }
                if (s.sv === target) { s.cb(false); return false; }
                return true;
              });
            }
            target[prop] = value;
            return true;
          },
        });
      }
      return ref.current;
    });
    const styled = jest.spyOn(Reanimated, 'useAnimatedStyle').mockImplementation(live);
    const spring = jest.spyOn(Reanimated, 'withSpring').mockImplementation((to, _cfg, cb) => {
      if (cb) springs.push({ to, cb, sv: null });
      return to;
    });
    restore = () => { spring.mockRestore(); styled.mockRestore(); shared.mockRestore(); };
  });
  afterEach(() => { if (restore) restore(); restore = null; });

  const STEP_REAL = width - screenPadding - 40 + 10;
  const flatten = (node) => StyleSheet.flatten(node.props.style) || {};
  /** Пружина колоды доехала. */
  const finish = () => act(async () => { const now = springs; springs = []; now.forEach((s) => s.cb(true)); });
  /** Жест на шаг влево (к следующей карточке) или вправо, с отпусканием. */
  const swipe = (dx) => act(async () => {
    fireGestureHandler(getByGestureTestId('deck-pan'), [
      { state: State.BEGAN, translationX: 0 },
      { state: State.ACTIVE, translationX: 0 },
      { translationX: dx / 2 },
      { translationX: dx },
      { state: State.END, translationX: dx, velocityX: 0 },
    ]);
  });
  const cards = (q) => q.queryAllByTestId(/^deck-card-\d+$/);
  /** Какие карточки настоящие (у настоящей — поле новой задачи). */
  const real = (q) => cards(q).map((card, i) => (within(card).queryByLabelText(t('ru', 'tasks.new_ph')) ? i : -1)).filter((i) => i >= 0);
  /** Какая посередине — в полный рост (стиль живой: по нынешнему x). */
  const center = (q) => cards(q).findIndex((card) => Object.assign({}, ...(flatten(card).transform || [])).scale === 1);
  /** Видимые — посередине и края соседок — настоящие. */
  const visibleReal = (q) => {
    const c = center(q);
    const n = cards(q).length;
    const have = real(q);
    return [c - 1, c, c + 1].filter((i) => i >= 0 && i < n).every((i) => have.includes(i));
  };
  /** Экран, у которого после каждой фиксации проверено: видимые — настоящие. */
  async function watched(navigation = nav()) {
    const frames = [];
    let q = null;
    q = await render(<Profiler id="deck" onRender={() => { if (q) frames.push({ at: center(q), real: real(q), ok: visibleReal(q) }); }}><ProjectsScreen navigation={navigation} /></Profiler>);
    return { q, frames };
  }
  const allOk = (frames) => frames.every((f) => f.ok);

  test('deckSettle и deckDrawn: окно идёт за остановкой, видимые — всегда; выбор страницы окна не двигает', () => {
    expect(DECK_KEEP).toBe(2);
    let d = deckStart(['a', 'b', 'c', 'd', 'e', 'f'], true);
    expect(d.win).toBe(0);
    // Отпустили на второй: страница сменилась, окно — нет.
    d = deckChoose(d, 1);
    expect(d).toMatchObject({ page: 1, win: 0 });
    // Устаревшая остановка (колоду уже перелистнули дальше) ничего не делает.
    const later = deckChoose(d, 2);
    expect(deckSettle(later, 1)).toBe(later);
    // Встала — окно за ней; второй раз — то же состояние.
    d = deckSettle(d, 1);
    expect(d).toMatchObject({ page: 1, win: 1 });
    expect(deckSettle(d, 1)).toBe(d);
    // Перестановка ставит полосу на место сразу: окно — вокруг новой страницы.
    const moved = deckNext(deckChoose(deckStart(['a', 'b', 'c', 'd'], true), 3), { have: ['a', 'b', 'c', 'd', 'n'], fresh: () => ['n', 'a', 'b', 'c', 'd'], focused: true });
    expect(moved).toMatchObject({ page: 4, win: 4, viewed: 'd' });
    // Окно ±2 от остановки и видимые ±1 от страницы.
    expect([0, 1, 2, 3, 4, 5].filter((i) => deckDrawn(i, 0, 0))).toEqual([0, 1, 2]);
    expect([0, 1, 2, 3, 4, 5].filter((i) => deckDrawn(i, 1, 0))).toEqual([0, 1, 2]);
    expect([0, 1, 2, 3, 4, 5].filter((i) => deckDrawn(i, 4, 0))).toEqual([0, 1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].filter((i) => deckDrawn(i, 3, 3))).toEqual([1, 2, 3, 4, 5]);
  });

  test('отпустили колоду — пока пружина едет, ничего не монтируется; встала — окно сдвинуто; соседка новой страницы готова заранее', async () => {
    const { q, frames } = await watched();
    // В покое на первой: настоящие — она, соседка и соседка соседки (готова до жеста).
    expect(real(q)).toEqual([0, 1, 2]);
    const third = q.getByTestId('deck-card-2');
    frames.length = 0;
    await swipe(-STEP_REAL);
    // Страница сменилась сразу (посередине вторая), пружина ещё едет — и на
    // этой фиксации ни одна карточка не смонтирована и не снята.
    expect(center(q)).toBe(1);
    expect(springs).toHaveLength(1);
    expect(real(q)).toEqual([0, 1, 2]);
    expect(q.getByTestId('deck-card-2')).toBe(third);
    for (const f of frames) expect(f.real).toEqual([0, 1, 2]);
    // Пружина встала — окно вокруг второй: монтируется четвёртая.
    await finish();
    expect(real(q)).toEqual([0, 1, 2, 3]);
    expect(q.getByTestId('deck-card-2')).toBe(third);
    expect(allOk(frames)).toBe(true);
  });

  test('смена страницы не перерисовывает карточки, у которых ничего не поменялось', async () => {
    const drawn = jest.spyOn(Store, 'projectMs');
    try {
      await render(<ProjectsScreen navigation={nav()} />);
      expect(drawn.mock.calls.map((c) => c[1])).toEqual(['q1', 'q2', 'q3']);
      drawn.mockClear();
      // Отпустили: ни одна смонтированная карточка не перерисована.
      await swipe(-STEP_REAL);
      expect(drawn).not.toHaveBeenCalled();
      // Встала: рисуется только новая дальняя, прежние — нет.
      await finish();
      expect(drawn.mock.calls.map((c) => c[1])).toEqual(['q4']);
      drawn.mockClear();
      // Точка соседней страницы — то же.
      await fireEvent.press(screen.getByLabelText(dotLabel(2)));
      expect(drawn).not.toHaveBeenCalled();
      await finish();
      expect(drawn.mock.calls.map((c) => c[1])).toEqual(['q5']);
    } finally {
      drawn.mockRestore();
    }
  });

  test('правка задачи и часы идущей перерисовывают только её карточку', async () => {
    jest.useFakeTimers();
    const drawn = jest.spyOn(Store, 'projectMs');
    try {
      useAppStore.setState({
        statuses: projectsOf(6).map((p, i) => ({ id: `s${i + 1}`, projectId: p.id, name: 'В работе', color: '#5ec8f2', kind: 'progress', order: 0 })),
        tasks: projectsOf(6).map((p, i) => task(`t${i + 1}`, p.id, `Задача ${i + 1}`, { statusId: `s${i + 1}` })),
      });
      await render(<ProjectsScreen navigation={nav()} />);
      drawn.mockClear();
      // Правка задачи второго проекта — перерисовывается только его карточка.
      await act(async () => { useAppStore.getState().updateTask('t2', { title: 'Другое' }); });
      expect([...new Set(drawn.mock.calls.map((c) => c[1]))]).toEqual(['q2']);
      // Таймер идёт по задаче первого: раз в секунду тикает только её карточка.
      await act(async () => { useAppStore.getState().startTimer('t1'); });
      drawn.mockClear();
      // По секунде на act: внутри одного act React сводит тики в одну отрисовку.
      for (let k = 0; k < 3; k++) await act(async () => { jest.advanceTimersByTime(1000); });
      const ticked = drawn.mock.calls.map((c) => c[1]);
      expect(ticked.length).toBeGreaterThanOrEqual(3);
      expect([...new Set(ticked)]).toEqual(['q1']);
    } finally {
      drawn.mockRestore();
      jest.useRealTimers();
    }
  });

  test('жесты подряд, не дав колоде встать: видимые — всегда настоящие, прерванная пружина окна не двигает', async () => {
    const { q, frames } = await watched();
    frames.length = 0;
    for (let k = 1; k <= 4; k++) {
      await swipe(-STEP_REAL);
      expect(center(q)).toBe(k);
      // Новый жест прервал прежнюю пружину: ждёт только последняя.
      expect(springs).toHaveLength(1);
    }
    // Колода ни разу не встала — окно всё ещё у первой, а видимые у пятой
    // настоящие: первая не снята на ходу, к пятой и её соседкам — смонтированы.
    expect(real(q)).toEqual([0, 1, 2, 3, 4, 5]);
    await finish();
    expect(real(q)).toEqual([2, 3, 4, 5]);
    expect(frames.length).toBeGreaterThan(0);
    expect(allOk(frames)).toBe(true);
  });

  test('точка через несколько страниц: видимые у цели — сразу, окно — когда колода встала', async () => {
    const { q, frames } = await watched();
    frames.length = 0;
    await fireEvent.press(q.getByLabelText(dotLabel(4)));
    expect(center(q)).toBe(4);
    expect(real(q)).toEqual([0, 1, 2, 3, 4, 5]);
    await finish();
    expect(real(q)).toEqual([2, 3, 4, 5]);
    expect(allOk(frames)).toBe(true);
  });

  test('новый проект из колоды и удалённые проекты: окно — вокруг карточки на экране, без пустых оболочек на видимых', async () => {
    const { q, frames } = await watched();
    // Встали на четвёртую.
    await fireEvent.press(q.getByLabelText(dotLabel(3)));
    await finish();
    expect(real(q)).toEqual([1, 2, 3, 4, 5]);
    frames.length = 0;
    // Удалили проект левее: та же карточка, номер на один меньше, окно — с ней.
    await act(async () => { useAppStore.getState().deleteProject('q1'); });
    expect(center(q)).toBe(2);
    expect(within(q.getByTestId('deck-card-2')).getByText('Проект 4')).toBeTruthy();
    expect(real(q)).toEqual([0, 1, 2, 3, 4]);
    // Удалили ту, что на экране: встаёт соседняя, окно вокруг неё.
    await act(async () => { useAppStore.getState().deleteProject('q4'); });
    expect(center(q)).toBe(2);
    expect(within(q.getByTestId('deck-card-2')).getByText('Проект 5')).toBeTruthy();
    expect(real(q)).toEqual([0, 1, 2, 3]);
    expect(allOk(frames)).toBe(true);
    // Новый проект из колоды: он слева, на экране, окно — вокруг него.
    frames.length = 0;
    await fireEvent.press(q.getByTestId('deck-plus-dot'));
    const sheet = useSheetStore.getState().content;
    await act(async () => {
      const made = useAppStore.getState().createProject({ name: 'Новый' });
      sheet.props.onCreated(made);
    });
    expect(center(q)).toBe(0);
    expect(within(q.getByTestId('deck-card-0')).getByText('Новый')).toBeTruthy();
    expect(real(q)).toEqual([0, 1, 2]);
    expect(allOk(frames)).toBe(true);
  });
});

describe('правка проекта ставит ему свежую отметку (project.updatedAt)', () => {
  const at = (id) => useAppStore.getState().projects.find((x) => x.id === id).updatedAt;
  const OLD = '2026-10-01T00:00:00.000Z';
  beforeEach(() => {
    useAppStore.setState({
      projects: useAppStore.getState().projects.map((x) => ({ ...x, updatedAt: OLD })),
      versions: [{ id: 'v1', projectId: 'p1', name: '1.0', order: 0, releasedAt: null }],
      tags: [{ id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: 'p1' }, { id: 'g0', name: 'общий', color: '#87ff65', projectId: null }],
    });
  });

  test.each([
    ['имя, цвет, описание, ставка', (st) => st.updateProject('p1', { name: 'Сайт 2', color: '#ff7a59' })],
    ['метки проекта', (st) => st.setProjectTags('p1', ['g0'])],
    ['новый статус', (st) => st.addStatus('p1')],
    ['имя статуса', (st) => st.updateStatus('s1', { name: 'Готово' })],
    ['вид статуса', (st) => st.setStatusKind('s1', 'done')],
    ['новая версия', (st) => st.createVersion('p1', '2.0')],
    ['имя версии', (st) => st.renameVersion('v1', '1.1')],
    ['выпуск версии', (st) => st.toggleVersionReleased('v1')],
    ['удаление версии', (st) => st.deleteVersion('v1')],
    ['свой тег проекта', (st) => st.updateTag('g1', { name: 'заказчик' })],
    ['новый свой тег', (st) => st.createTag({ name: 'срочно', projectId: 'p1' })],
  ])('%s', (_name, edit) => {
    edit(useAppStore.getState());
    expect(at('p1')).not.toBe(OLD);
    expect(new Date(at('p1')).getTime()).toBeGreaterThan(new Date(OLD).getTime());
    // Соседний проект не трогается.
    expect(at('p2')).toBe(OLD);
  });

  test('закрепление и общий тег — не правка проекта', () => {
    useAppStore.getState().togglePinProject('p1');
    useAppStore.getState().updateTag('g0', { name: 'всем' });
    expect(at('p1')).toBe(OLD);
    expect(at('p2')).toBe(OLD);
  });

  test('новый проект заводится с отметкой — и встаёт первым', () => {
    const made = useAppStore.getState().createProject({ name: 'Новый' });
    expect(made.updatedAt).toBe(made.createdAt);
  });
});

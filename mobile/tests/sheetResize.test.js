// Смена страницы внутри нижнего листа (components/BottomSheet.js, NewProjectSheet.js).
// Запуск: npm run test:mobile
//
// Раньше при смене страницы — «Новый проект» → «Теги» → назад, выбор валюты —
// высота листа прыгала: ScrollView и подвал просто становились другого роста.
// Теперь высота содержимого и подвала едет к новой (withTiming, ease out,
// 250 мс, без перехлёста), страницы меняются мягко и в сторону навигации, а
// шапка встаёт в тот же кадр. Проверяется применение: в подделке reanimated
// (как в liquid.test.js) видно, к какой высоте и как именно лист поехал.
import { Dimensions, StyleSheet, Text } from 'react-native';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import BottomSheet, { SHEET_RESIZE_MS, SHEET_SETTLE_MS } from '../src/components/BottomSheet';
import { HEADER_CONTENT_HEIGHT } from '../src/components/AppHeader';
import NewProjectSheet from '../src/components/NewProjectSheet';
import RateSheet from '../src/components/RateSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet } from '../src/store/useSheetStore';
import { t } from '../src/lib/i18n';

// Своя поправка подделки: useSharedValue там каждый раз новый, а настоящий —
// один на всю жизнь компонента; здесь так же, через useRef.
jest.mock('react-native-reanimated', () => {
  const m = jest.requireActual('react-native-reanimated/mock');
  const { useRef } = jest.requireActual('react');
  return {
    ...m,
    useSharedValue: (init) => {
      const ref = useRef(null);
      if (!ref.current) ref.current = m.useSharedValue(init);
      return ref.current;
    },
    withSpring: jest.fn((to, cfg, cb) => m.withSpring(to, cfg, cb)),
    withTiming: jest.fn((to, cfg, cb) => m.withTiming(to, cfg, cb)),
    // В подделке кривые — пустышки (Easing.out вернёт то, что дали); настоящие
    // формулы нужны, чтобы тест видел, какая кривая выбрана.
    Easing: { ...m.Easing, cubic: (x) => x * x * x, out: (f) => (x) => 1 - f(1 - x) },
  };
});
// «Уменьшение движения» — подменой хука: проверяется ответ листа на него.
let mockReduced = false;
jest.mock('../src/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));

const { withTiming, withSpring, FadeInRight, FadeInLeft } = Reanimated;
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const WINDOW = Dimensions.get('window').height;
// Лист раскрывается до нижней границы шапки приложения.
const FULL = WINDOW - HEADER_CONTENT_HEIGHT;
const noop = () => {};

beforeEach(() => {
  mockReduced = false;
  withTiming.mockClear();
  withSpring.mockClear();
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 },
    projects: [],
    tasks: [],
    versions: [],
    tags: [{ id: 'g1', name: 'клиент', color: '#5ec8f2', projectId: null }],
  });
});
// Кадр выезда листа не должен выпасть после разбора окружения.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

async function show(content) {
  openSheet(content);
  return render(<BottomSheet />);
}
/** Прошло время выезда: высоты снова едут, а не встают сразу. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, SHEET_SETTLE_MS + 60)); });
/** Содержимое листа поменяло рост: ScrollView сообщает новый размер. */
const resize = (screen, height) => fireEvent(screen.getByTestId('sheet-scroll'), 'contentSizeChange', 390, height);
/** Подвал сообщил свой рост. */
const footLayout = (screen, height) => fireEvent(screen.getByTestId('sheet-footer-content'), 'layout', { nativeEvent: { layout: { height } } });
/** Ходы высоты: withTiming с конфигом листа (прочие анимации приложения — не в счёт). */
const rides = () => withTiming.mock.calls.filter(([, cfg]) => cfg && cfg.duration === SHEET_RESIZE_MS);
const rideTargets = () => rides().map(([to]) => to);
/** Высота обёртки содержимого сейчас: подделке нужна перерисовка, чтобы стиль пересчитался. */
async function bodyHeight(screen) {
  await screen.rerender(<BottomSheet />);
  return flat(screen.getByTestId('sheet-body')).height;
}
const setFooter = (footer) => act(async () => { useSheetStore.setState({ footer }); });

describe('высота содержимого едет к новой', () => {
  test('первый замер при открытии встаёт сразу: лист ещё выезжает', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await resize(screen, 400);
    expect(rides()).toHaveLength(0);
    expect(await bodyHeight(screen)).toBe(400);
  });

  test('после выезда новая высота — withTiming: ease out, 250 мс, не пружина', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await settle();
    await resize(screen, 400);
    await resize(screen, 520);
    expect(rideTargets()).toEqual([520]);
    const [, cfg] = rides()[0];
    expect(cfg.duration).toBe(250);
    expect(typeof cfg.easing).toBe('function');
    // Ease out: движение быстрое в начале и замедляется к концу, назад не заходит.
    expect(cfg.easing(0)).toBe(0);
    expect(cfg.easing(1)).toBe(1);
    expect(cfg.easing(0.5)).toBeGreaterThan(0.5);
    for (let x = 0; x < 1; x += 0.05) expect(cfg.easing(x + 0.05)).toBeGreaterThanOrEqual(cfg.easing(x));
    expect(withSpring).not.toHaveBeenCalled();
    expect(await bodyHeight(screen)).toBe(520);
  });

  test('тот же рост ничего не запускает, дробь округляется вверх: лист не короче содержимого', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await settle();
    await resize(screen, 400);
    await resize(screen, 520);
    await resize(screen, 520);
    await resize(screen, 519.4);
    expect(rideTargets()).toEqual([520]);
    await resize(screen, 520.2);
    expect(rideTargets()).toEqual([520, 521]);
  });

  test('страница выше листа едет только до видимой части, а не до невидимой высоты', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await settle();
    await fireEvent(screen.getByTestId('sheet-header'), 'layout', { nativeEvent: { layout: { height: 54 } } });
    await setFooter(<Text>кнопка</Text>);
    await footLayout(screen, 120);
    await resize(screen, 300);
    await resize(screen, 5000);
    // Лист минус безопасная зона снизу (в тестах ноль), шапка с линией и подвал.
    const cap = FULL - (54 + StyleSheet.hairlineWidth) - 120;
    expect(rideTargets()).toEqual([Math.ceil(cap)]);
  });

  test('при открытии другого листа высота встаёт сразу: он выезжает заново', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await settle();
    await resize(screen, 500);
    await act(async () => openSheet(<NewProjectSheet onCreated={noop} onCancel={noop} />));
    await resize(screen, 300);
    expect(rides()).toHaveLength(0);
    expect(await bodyHeight(screen)).toBe(300);
  });

  test('«уменьшение движения»: высота меняется сразу, withTiming не зовётся', async () => {
    mockReduced = true;
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await settle();
    await resize(screen, 400);
    await resize(screen, 520);
    expect(rides()).toHaveLength(0);
    expect(await bodyHeight(screen)).toBe(520);
  });
});

describe('подвал', () => {
  test('сменил рост — едет; пропал — сворачивается, прежние кнопки стоят до конца', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await settle();
    await setFooter(<Text>Создать проект</Text>);
    await footLayout(screen, 120);
    expect(rides()).toHaveLength(0); // первый замер подвала — сразу
    await footLayout(screen, 60);
    expect(rideTargets()).toEqual([60]);

    await setFooter(null);
    expect(rideTargets()).toEqual([60, 0]);
    // Кнопки ещё на месте, но нажатий не ловят и скрыты от чтения с экрана
    // (поэтому запросы теста их видят только с includeHiddenElements).
    const box = screen.getByTestId('sheet-footer', { includeHiddenElements: true });
    within(box).getByText('Создать проект', { includeHiddenElements: true });
    expect(box.props.pointerEvents).toBe('none');
    expect(box.props.importantForAccessibility).toBe('no-hide-descendants');
    // Свернулся — убрались.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, SHEET_RESIZE_MS + 100)); });
    expect(screen.queryByText('Создать проект')).toBeNull();
    expect(screen.queryByTestId('sheet-footer')).toBeNull();
  });

  test('«уменьшение движения»: подвал уходит сразу, призрака нет', async () => {
    mockReduced = true;
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await settle();
    await setFooter(<Text>Создать проект</Text>);
    await footLayout(screen, 120);
    await setFooter(null);
    expect(rides()).toHaveLength(0);
    expect(screen.queryByText('Создать проект')).toBeNull();
  });

  test('подвал берётся из стора в тот же кадр: ждать копии не надо', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={500} onSave={noop} />);
    await setFooter(<Text>Сохранить</Text>);
    expect(within(screen.getByTestId('sheet-footer')).getByText('Сохранить')).toBeTruthy();
  });
});

describe('страницы внутри листа: форма → теги → назад', () => {
  async function formSheet() {
    const screen = await show(<NewProjectSheet onCreated={noop} onCancel={noop} />);
    await settle();
    return screen;
  }
  const entering = (screen) => screen.getByTestId('sheet-page').props.entering;

  test('высота едет за страницей: к короткой «Теги» и обратно к форме', async () => {
    const screen = await formSheet();
    await resize(screen, 700);
    expect(rides()).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('project-row-marks'));
    await resize(screen, 300);
    expect(rideTargets()).toEqual([300]);
    await fireEvent.press(screen.getByLabelText(t('ru', 'common.back')));
    await resize(screen, 700);
    expect(rideTargets()).toEqual([300, 700]);
  });

  test('заголовок и «назад» встают в тот же кадр, что страница', async () => {
    const screen = await formSheet();
    expect(useSheetStore.getState().header).toEqual({ title: t('ru', 'project.new_title'), onBack: null });
    await fireEvent.press(screen.getByTestId('project-row-marks'));
    // Сразу после нажатия: страница меток на экране, и шапка уже её — без
    // ожидания. Заголовок страницы — название настройки («Метки проекта»).
    screen.getByPlaceholderText(t('ru', 'tag.search_ph'));
    expect(useSheetStore.getState().header.title).toBe(t('ru', 'pdlg.marks_label'));
    within(screen.getByTestId('sheet-head-row')).getByText(t('ru', 'pdlg.marks_label'));
    within(screen.getByTestId('sheet-head-row')).getByLabelText(t('ru', 'common.back'));
  });

  test('вперёд новая страница въезжает справа, назад — слева; при открытии — без хода', async () => {
    const screen = await show(<NewProjectSheet onCreated={noop} onCancel={noop} />);
    expect(entering(screen)).toBeUndefined();
    await settle();
    await fireEvent.press(screen.getByTestId('project-row-marks'));
    expect(entering(screen)).toBe(FadeInRight);
    await fireEvent.press(screen.getByLabelText(t('ru', 'common.back')));
    expect(entering(screen)).toBe(FadeInLeft);
  });

  test('«уменьшение движения»: страницы меняются без хода', async () => {
    mockReduced = true;
    const screen = await formSheet();
    await fireEvent.press(screen.getByTestId('project-row-marks'));
    expect(entering(screen)).toBeUndefined();
    expect(screen.getByTestId('sheet-page').props.exiting).toBeUndefined();
    await fireEvent.press(screen.getByLabelText(t('ru', 'common.back')));
    expect(entering(screen)).toBeUndefined();
  });

  test('шапка при смене страницы проявляется; при открытии и без движения — нет', async () => {
    const titleBox = (screen, title) => within(screen.getByTestId('sheet-head-row')).getByText(title).parent;
    const opened = await show(<NewProjectSheet onCreated={noop} onCancel={noop} />);
    expect(titleBox(opened, t('ru', 'project.new_title')).props.entering).toBeUndefined();
    await settle();
    await fireEvent.press(opened.getByTestId('project-row-marks'));
    expect(titleBox(opened, t('ru', 'pdlg.marks_label')).props.entering).toBeDefined();
    await opened.unmount();

    mockReduced = true;
    const calm = await formSheet();
    await fireEvent.press(calm.getByTestId('project-row-marks'));
    expect(titleBox(calm, t('ru', 'pdlg.marks_label')).props.entering).toBeUndefined();
  });
});

// Страховка от съехавшего вида: лист держит свои закреплённые части.
test('шапка и подвал по-прежнему вне прокрутки: высота едет только у содержимого', async () => {
  const screen = await show(<NewProjectSheet onCreated={noop} onCancel={noop} />);
  const body = screen.getByTestId('sheet-body');
  const scroll = screen.getByTestId('sheet-scroll');
  expect(within(body).getByTestId('sheet-scroll')).toBe(scroll);
  expect(within(body).queryByTestId('sheet-header')).toBeNull();
  expect(within(body).queryByTestId('sheet-footer')).toBeNull();
  // Обёртка сжимается под клавиатуру (flexShrink), как раньше ScrollView.
  expect(flat(body).flexShrink).toBe(1);
  expect(flat(scroll).flexShrink).toBe(1);
});

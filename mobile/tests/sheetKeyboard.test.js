// Клавиатура и нижний лист (components/BottomSheet.js). Запуск: npm run test:mobile
//
// Раньше на Android клавиатура закрывала поле внизу листа (например «Ставка
// проекта» в «Новом проекте»): окно Modal не ужималось, а KeyboardAvoidingView
// там ничего не делал. Теперь лист сам встаёт над клавиатурой и докручивает
// сфокусированное поле. Проверяется применение: события клавиатуры приходят
// как в приложении (DeviceEventEmitter), замеры подложки — через onLayout.
// Пиксели настоящей клавиатуры без устройства не проверить; они закрыты
// скриншотами на эмуляторе, а здесь — арифметика и поведение.
//
// С 11 октября 2026 на Android лист поднимает не событие keyboardDidShow (оно
// приходит, когда клавиатура уже встала, — лист прыгал за кадр), а высота
// клавиатуры по кадрам из react-native-keyboard-controller: стиль подложки
// считается из неё в потоке интерфейса. Подмена библиотеки (jest.setup.js)
// отдаёт эту высоту общим объектом — тест выставляет её, как кадр клавиатуры,
// и перерисовывает лист (на устройстве стиль пересчитывается без перерисовки).
import { useEffect } from 'react';
import { Dimensions, DeviceEventEmitter, Keyboard, LayoutAnimation, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as keyboardController from 'react-native-keyboard-controller';
import BottomSheet from '../src/components/BottomSheet';
import { HEADER_CONTENT_HEIGHT } from '../src/components/AppHeader';
import RateSheet from '../src/components/RateSheet';
import { useAppStore } from '../src/store/useAppStore';
import { useSheetStore, openSheet, closeSheet, setSheetFooter, useSheetHeader } from '../src/store/useSheetStore';
import { spacing } from '../src/theme';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};
const WINDOW = Dimensions.get('window').height;
const FULL = WINDOW - HEADER_CONTENT_HEIGHT; // insets в тестах — нули (jest.setup.js)

let os;
const setOS = (name) => { os = jest.replaceProperty(Platform, 'OS', name); };
beforeEach(() => {
  useSheetStore.setState({ content: null, header: null, footer: null });
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, lang: 'ru', theme: 'dark', currency: 'RUB', hourlyRate: 0 } });
  ScrollView.prototype.scrollTo.mockClear();
  ScrollView.prototype.getInnerViewRef.mockReset();
  TextInput.State = { currentlyFocusedInput: jest.fn(() => null) };
});
afterEach(() => {
  if (os) os.restore();
  os = null;
  jest.restoreAllMocks();
  // Сам Keyboard помнит последнюю показанную клавиатуру (isVisible, metrics),
  // и лист при открытии её спрашивает: уходим явно, чтобы тест не оставил её
  // следующему, как делает человек, закрыв клавиатуру.
  for (const event of ['keyboardDidHide', 'keyboardWillHide']) DeviceEventEmitter.emit(event, { endCoordinates: { screenY: WINDOW, height: 0, width: 390, screenX: 0 } });
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));

/** Лист с полем внизу, заголовком в шапке и кнопкой в подвале. */
function FormSheet() {
  useSheetHeader('Форма');
  // Подвал регистрируется в эффекте, как у настоящих листов.
  useEffect(() => { setSheetFooter(<Text>Сохранить</Text>); return () => setSheetFooter(null); }, []);
  return (
    <View>
      <Text>выше</Text>
      <TextInput testID="field" placeholder="Ставка" />
    </View>
  );
}

/** Лист открыт, подложка померена: как после первой раскладки на устройстве. */
async function show(content, areaH = 844) {
  openSheet(content);
  const screen = await render(<BottomSheet />);
  await fireEvent(screen.getByTestId('sheet-overlay'), 'layout', { nativeEvent: { layout: { height: areaH } } });
  return screen;
}
const keyboard = (event, screenY, height, extra = {}) => act(async () => {
  DeviceEventEmitter.emit(event, { endCoordinates: { screenY, height, width: 390, screenX: 0 }, ...extra });
});
const overlay = (s) => flat(s.getByTestId('sheet-overlay'));
const sheet = (s) => flat(s.getByTestId('sheet'));

// Высота клавиатуры по кадрам — те же объекты, что отдают листу хуки
// библиотеки: shared value для подложки и Animated.Value для юбки, со знаком
// минус (0 → −H), как у keyboard-controller.
const kbUi = keyboardController.useReanimatedKeyboardAnimation().height;
const kbNative = keyboardController.useKeyboardAnimation().height;
/** Кадр клавиатуры высотой h (dp над низом окна). */
async function kbFrame(screen, h) {
  kbUi.value = -h;
  kbNative.setValue(-h);
  await screen.rerender(<BottomSheet />);
}
afterEach(() => { kbUi.value = 0; kbNative.setValue(0); });
/** Сколько места остаётся листу по высоте: на Android его укорачивает
 *  подложка (отступы сверху и снизу, лист сжимается), а не maxHeight. */
const room = (s, areaH = 844) => {
  expect(sheet(s).flexShrink).toBe(1);
  return Math.min(sheet(s).maxHeight, areaH - (overlay(s).paddingTop || 0) - (overlay(s).paddingBottom || 0));
};

describe('Android: клавиатура не перекрывает лист', () => {
  beforeEach(() => setOS('android'));

  test('подложка получает отступ на высоту клавиатуры, лист укорочен на неё', async () => {
    // Подложка — во всё окно, как на устройстве.
    const screen = await show(<FormSheet />, WINDOW);
    expect(overlay(screen).paddingBottom).toBe(0);
    expect(room(screen, WINDOW)).toBe(FULL);

    await kbFrame(screen, 300);
    // Содержимое поднято ровно на H, а не на «H + что-то».
    expect(overlay(screen).paddingBottom).toBe(300);
    // Лист укорочен до оставшегося места: шапка не уезжает за верх экрана.
    expect(room(screen, WINDOW)).toBe(Math.min(FULL, WINDOW - 300 - spacing.md));
    // Безопасная зона (в тестах ноль) лежит под клавиатурой; ровный воздух
    // SHEET_BOTTOM_GAP — у содержимого и подвала.
    expect(sheet(screen).paddingBottom).toBe(0);

    await kbFrame(screen, 0);
    expect(overlay(screen).paddingBottom).toBe(0);
    expect(room(screen, WINDOW)).toBe(FULL);
  });

  test('лист едет за каждым кадром клавиатуры, а не за событием: keyboardDidShow его не двигает', async () => {
    const screen = await show(<FormSheet />);
    // Событие приходит, когда клавиатура уже встала: поднимай лист оно — он
    // прыгнул бы за один кадр. Теперь событие только будит докрутку до поля.
    await keyboard('keyboardDidShow', 844 - 300, 300);
    expect(overlay(screen).paddingBottom).toBe(0);
    // Подъём — промежуточные кадры хода клавиатуры, каждый — своя высота.
    for (const h of [40, 120, 210, 280, 300]) {
      await kbFrame(screen, h);
      expect(overlay(screen).paddingBottom).toBe(h);
      expect(room(screen)).toBe(Math.min(FULL, 844 - h - spacing.md));
    }
    // Покадрового обработчика в JS (useKeyboardHandler и т. п.) у листа нет:
    // кадр клавиатуры не трогает состояние React, стиль считает поток интерфейса.
    expect(keyboardController.useKeyboardHandler).not.toHaveBeenCalled();
    expect(keyboardController.useGenericKeyboardHandler).not.toHaveBeenCalled();
  });

  test('безопасная зона под листом не прыгает: подложка поднимается на клавиатуру за её вычетом', async () => {
    const insets = useSafeAreaInsets();
    const was = insets.bottom;
    insets.bottom = 24;
    try {
      const screen = await show(<FormSheet />);
      expect(sheet(screen).paddingBottom).toBe(24);
      // Клавиатура только тронулась и ещё ниже системной панели — лист стоит.
      await kbFrame(screen, 10);
      expect(overlay(screen).paddingBottom).toBe(0);
      expect(sheet(screen).paddingBottom).toBe(24);
      // Встала: низ содержимого листа ровно на её верху — зона под листом
      // остаётся (она под клавиатурой), подложка поднята на остальное.
      await kbFrame(screen, 370);
      expect(overlay(screen).paddingBottom).toBe(370 - 24);
      expect(sheet(screen).paddingBottom).toBe(24);
      expect(overlay(screen).paddingBottom + sheet(screen).paddingBottom).toBe(370);
    } finally {
      insets.bottom = was;
    }
  });

  test('шапка и подвал остаются в листе: над клавиатурой, не под ней', async () => {
    const screen = await show(<FormSheet />);
    await kbFrame(screen, 300);
    const box = screen.getByTestId('sheet');
    // Шапка, ScrollView с полем и подвал — дети одного листа, который встал
    // над клавиатурой целиком; ни шапка, ни подвал не внутри ScrollView.
    screen.getByText('Форма');
    screen.getByText('Сохранить');
    const ancestors = (n) => { const out = []; for (let p = n.parent; p; p = p.parent) out.push(p); return out; };
    for (const text of ['Форма', 'Сохранить']) {
      expect(ancestors(screen.getByText(text)).some((n) => n.type === 'RCTScrollView')).toBe(false);
      expect(ancestors(screen.getByText(text)).includes(box)).toBe(true);
    }
    expect(ancestors(screen.getByTestId('field')).some((n) => n.type === 'RCTScrollView')).toBe(true);
  });

  // Раньше окно Modal могло ужаться под клавиатуру само (adjustResize), и
  // подъём считался по геометрии, чтобы не поднять лист дважды. Теперь
  // keyboard-controller, увидев показ Modal, ставит окну диалога
  // SOFT_INPUT_ADJUST_NOTHING: окно не ужимается, перекрытие равно высоте
  // клавиатуры. Двойного подъёма не бывает по-другому — подложка в нём не
  // участвует: её замеры подъём не меняют и не копят.
  test('замер подложки подъём не меняет: второго подъёма нет, отступ не накапливается', async () => {
    const screen = await show(<FormSheet />);
    await kbFrame(screen, 300);
    expect(overlay(screen).paddingBottom).toBe(300);
    for (const height of [844 - 300, 844, 844 - 1, 844]) {
      await fireEvent(screen.getByTestId('sheet-overlay'), 'layout', { nativeEvent: { layout: { height } } });
      expect(overlay(screen).paddingBottom).toBe(300);
    }
    await kbFrame(screen, 300);
    expect(overlay(screen).paddingBottom).toBe(300);
  });

  test('высота клавиатуры сменилась — лист едет следом', async () => {
    const screen = await show(<FormSheet />);
    await kbFrame(screen, 300);
    await kbFrame(screen, 380);
    expect(overlay(screen).paddingBottom).toBe(380);
  });

  test('короткий лист просто стоит над клавиатурой', async () => {
    const screen = await show(<RateSheet lang="ru" initialValue={0} onSave={() => {}} />);
    await kbFrame(screen, 280);
    expect(overlay(screen).paddingBottom).toBe(280);
    // Лист обтекает содержимое, а не растягивается до maxHeight.
    expect(sheet(screen).height).toBeUndefined();
  });
});

describe('iOS: лист едет вместе с клавиатурой', () => {
  beforeEach(() => setOS('ios'));

  test('keyboardWillShow поднимает лист на высоту, а keyboardWillHide опускает', async () => {
    const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    const screen = await show(<FormSheet />);
    await keyboard('keyboardWillShow', 844 - 336, 336, { duration: 250 });
    expect(overlay(screen).paddingBottom).toBe(336);
    // Тем же временем, что у клавиатуры.
    expect(configure).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 250 }));
    await keyboard('keyboardWillHide', 844, 336, { duration: 250 });
    expect(overlay(screen).paddingBottom).toBe(0);
  });

  test('высота клавиатуры по кадрам (Android-путь) на iOS лист не двигает', async () => {
    jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    const screen = await show(<FormSheet />);
    await kbFrame(screen, 300);
    expect(overlay(screen).paddingBottom).toBe(0);
    expect(sheet(screen).maxHeight).toBe(FULL);
    await keyboard('keyboardWillShow', 844 - 300, 300, { duration: 250 });
    expect(overlay(screen).paddingBottom).toBe(300);
    expect(sheet(screen).maxHeight).toBe(Math.min(FULL, 844 - 300 - spacing.md));
  });

  test('кадр клавиатуры за краем экрана (уход) лист не поднимает', async () => {
    jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    const screen = await show(<FormSheet />);
    await keyboard('keyboardWillShow', 844 - 336, 336);
    await keyboard('keyboardWillChangeFrame', WINDOW, 336);
    // Уходом занимается keyboardWillHide; кадр за экраном — не новая высота.
    expect(overlay(screen).paddingBottom).toBe(336);
    await keyboard('keyboardWillHide', WINDOW, 336);
    expect(overlay(screen).paddingBottom).toBe(0);
  });

  test('смена высоты при открытой клавиатуре — лист следом', async () => {
    jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {});
    const screen = await show(<FormSheet />);
    await keyboard('keyboardWillShow', 844 - 291, 291);
    await keyboard('keyboardWillChangeFrame', 844 - 336, 336);
    expect(overlay(screen).paddingBottom).toBe(336);
  });
});

describe('докрутка до сфокусированного поля', () => {
  beforeEach(() => {
    setOS('android');
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  /** В фокусе поле высотой h, оно стоит в содержимом листа на y. */
  async function focusAt({ y, h = 44 }) {
    ScrollView.prototype.getInnerViewRef.mockReturnValue('inner');
    const input = { measureLayout: jest.fn((_inner, ok) => ok(0, y, 300, h)) };
    TextInput.State.currentlyFocusedInput.mockReturnValue(input);
    const screen = await show(<FormSheet />);
    return { screen, input };
  }

  const layoutScroll = (screen, height) => fireEvent(screen.getByTestId('sheet-scroll'), 'layout', { nativeEvent: { layout: { height } } });
  const scrollTo = (screen, y) => fireEvent.scroll(screen.getByTestId('sheet-scroll'), { nativeEvent: { contentOffset: { y } } });

  test('поле ниже видимой части — лист докручивается так, чтобы оно было над клавиатурой с воздухом', async () => {
    const { screen } = await focusAt({ y: 700 });
    await layoutScroll(screen, 300);
    await keyboard('keyboardDidShow', 844 - 300, 300);
    await act(async () => { jest.advanceTimersByTime(200); });
    // Низ поля (700 + 44) + воздух 12 — ровно на нижней границе видимой части 300.
    expect(ScrollView.prototype.scrollTo).toHaveBeenCalledWith({ y: 700 + 44 + 12 - 300, animated: true });
  });

  test('поле уже видно — лист не двигается', async () => {
    const { screen } = await focusAt({ y: 100 });
    await layoutScroll(screen, 300);
    await keyboard('keyboardDidShow', 844 - 300, 300);
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(ScrollView.prototype.scrollTo).not.toHaveBeenCalled();
  });

  test('поле выше видимой части (лист прокручен) — докручивается вверх', async () => {
    const { screen } = await focusAt({ y: 50 });
    await layoutScroll(screen, 300);
    await scrollTo(screen, 400);
    await keyboard('keyboardDidShow', 844 - 300, 300);
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(ScrollView.prototype.scrollTo).toHaveBeenCalledWith({ y: 50 - 12, animated: true });
  });

  test('ScrollView сжался под клавиатуру — докрутка по новой высоте', async () => {
    const { screen } = await focusAt({ y: 500 });
    await layoutScroll(screen, 600);
    await keyboard('keyboardDidShow', 844 - 300, 300);
    await act(async () => { jest.advanceTimersByTime(200); });
    ScrollView.prototype.scrollTo.mockClear();
    // Лист укоротился — видимая часть теперь 260, и поле оказалось ниже неё.
    await layoutScroll(screen, 260);
    expect(ScrollView.prototype.scrollTo).toHaveBeenCalledWith({ y: 500 + 44 + 12 - 260, animated: true });
  });

  test('человек сам прокрутил дальше — то же поле обратно не возвращается', async () => {
    const { screen, input } = await focusAt({ y: 700 });
    await layoutScroll(screen, 300);
    await keyboard('keyboardDidShow', 844 - 300, 300);
    await act(async () => { jest.advanceTimersByTime(200); });
    ScrollView.prototype.scrollTo.mockClear();
    await scrollTo(screen, 0);
    await fireEvent(screen.getByTestId('sheet-scroll'), 'touchEnd');
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(ScrollView.prototype.scrollTo).not.toHaveBeenCalled();
    expect(input.measureLayout).toHaveBeenCalledTimes(1);
  });

  test('фокус перешёл на другое поле при открытой клавиатуре — оно докручивается', async () => {
    const { screen } = await focusAt({ y: 100 });
    await layoutScroll(screen, 300);
    await keyboard('keyboardDidShow', 844 - 300, 300);
    await act(async () => { jest.advanceTimersByTime(200); });
    const next = { measureLayout: jest.fn((_inner, ok) => ok(0, 800, 300, 44)) };
    TextInput.State.currentlyFocusedInput.mockReturnValue(next);
    await fireEvent(screen.getByTestId('sheet-scroll'), 'touchEnd');
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(ScrollView.prototype.scrollTo).toHaveBeenLastCalledWith({ y: 800 + 44 + 12 - 300, animated: true });
  });

  test('клавиатуры нет — касания внутри листа ничего не докручивают', async () => {
    const { screen, input } = await focusAt({ y: 700 });
    await layoutScroll(screen, 300);
    await fireEvent(screen.getByTestId('sheet-scroll'), 'touchEnd');
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(input.measureLayout).not.toHaveBeenCalled();
    expect(ScrollView.prototype.scrollTo).not.toHaveBeenCalled();
  });
});

describe('закрытие и состояние клавиатуры', () => {
  beforeEach(() => setOS('android'));

  test('закрытие листа убирает клавиатуру', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const screen = await show(<FormSheet />);
    await keyboard('keyboardDidShow', 844 - 300, 300);
    await act(async () => { closeSheet(); });
    expect(dismiss).toHaveBeenCalled();
    void screen;
  });

  test('новый лист открывается с клавиатурой, которая уже на экране', async () => {
    // Клавиатура стоит: её высота уже в значении библиотеки, а события о ней прошли.
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    jest.spyOn(Keyboard, 'metrics').mockReturnValue({ screenX: 0, screenY: 844 - 300, width: 390, height: 300 });
    kbUi.value = -300;
    kbNative.setValue(-300);
    const screen = await show(<FormSheet />);
    expect(overlay(screen).paddingBottom).toBe(300);
    expect(room(screen)).toBe(Math.min(FULL, 844 - 300 - spacing.md));
  });

  test('без клавиатуры лист как прежде: максимальная высота, под ним — только безопасная зона', async () => {
    const screen = await show(<FormSheet />, WINDOW);
    expect(sheet(screen).maxHeight).toBe(FULL);
    expect(room(screen, WINDOW)).toBe(FULL);
    expect(overlay(screen).paddingBottom).toBe(0);
    expect(sheet(screen).paddingBottom).toBe(0); // insets в тестах — нули
  });

  test('жест «потянуть вниз» на шапке по-прежнему на месте', async () => {
    const screen = await show(<FormSheet />);
    await kbFrame(screen, 300);
    const header = screen.getByTestId('sheet-header');
    expect(typeof header.props.onMoveShouldSetResponderCapture).toBe('function');
    expect(typeof header.props.onResponderRelease).toBe('function');
  });
});

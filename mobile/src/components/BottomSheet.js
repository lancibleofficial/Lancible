import { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Keyboard, LayoutAnimation, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, FadeIn, FadeInRight, FadeInLeft, FadeOut, Easing as ReEasing } from 'react-native-reanimated';
import { KEYBOARD_NATIVE, useKeyboardAnimation, useReanimatedKeyboardAnimation } from '../lib/keyboard';
import { useSheetStore, closeSheet } from '../store/useSheetStore';
import { useAppStore } from '../store/useAppStore';
import Tap from './Tap';
import Icon from './Icon';
import Text from './AppText';
import { t } from '../lib/i18n';
import { HEADER_CONTENT_HEIGHT } from './AppHeader';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useColors, radius, spacing, screenPadding, typography } from '../theme';

/** Прокрутка листа для содержимого: открыть лист сразу на нужном разделе. */
export const SheetScrollContext = createContext({ scrollTo: () => {} });

const OPEN_MS = 260;
// Выезд на пружине. Недодемпфирована (ζ ≈ 0,76), поэтому на миг лист уходит выше
// своего места — см. «юбку» ниже: она закрывает щель, которую этот перелёт
// открыл бы между низом листа и низом экрана.
export const SHEET_SPRING = { stiffness: 230, damping: 22, mass: 0.9 };
const CLOSE_MS = 220;
const DRAG_CLOSE_DISTANCE = 100;
const DRAG_CLOSE_VELOCITY = 0.8;
/** Доля пройденного пути, на которую пружина перелетает цель: e^(−πζ/√(1−ζ²)),
 *  ζ = c / (2√(k·m)); критически и сверхдемпфированная не перелетает вовсе. */
export function springOvershoot({ stiffness, damping, mass }) {
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  return zeta >= 1 ? 0 : Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}

// Запас «юбки» сверх расчётного перелёта: округление, дробные пиксели и то,
// что Animated считает шаги по кадрам, а не по формуле.
const SKIRT_SAFE = spacing.md;

/** Высота «юбки» под листом: лист едет на всю высоту окна, пружина перелетает
 *  на springOvershoot этого пути — столько же фона нужно ниже экрана. */
export function skirtHeight(windowHeight) {
  return Math.ceil(windowHeight * springOvershoot(SHEET_SPRING)) + SKIRT_SAFE;
}

// Воздух между сфокусированным полем и краем видимой области, когда лист
// докручивается до поля над клавиатурой.
const FIELD_GAP = 12;
// Через сколько после касания проверять, не перешёл ли фокус на другое поле:
// фокус ставится после касания, а не вместе с ним.
const FOCUS_CHECK_MS = 80;

// Высота участков листа — содержимого и подвала — не прыгает, когда внутри
// листа меняется страница («Новый проект» → «Теги» → назад, выбор валюты):
// участок едет к новой высоте за SHEET_RESIZE_MS, ease out, без перехлёста —
// пружина тут дрожала бы, а лист и так выезжает на пружине.
export const SHEET_RESIZE_MS = 250;
const SHEET_RESIZE = { duration: SHEET_RESIZE_MS, easing: ReEasing.out(ReEasing.cubic) };
// Пока лист выезжает и ещё столько после открытия, высоты встают сразу: лист
// и так в движении, а замер нового содержимого приходит уже в первые кадры.
export const SHEET_SETTLE_MS = 350;
// Замер высоты шумит на пиксель экрана (см. useEasedHeight): уменьшение не
// больше этого — не новая высота, участок её не меняет. 1 dp перекрывает
// пиксель на любой плотности экрана (на mdpi — ровно он).
export const SHEET_RESIZE_EPS = 1;
// Заголовок и «назад» при смене страницы проявляются, а не выскакивают.
const HEAD_IN = FadeIn.duration(180);

// Страницы внутри листа (окно проекта, экспорт) идут в сторону навигации:
// вперёд новая въезжает справа, назад — слева, проявляясь; прежняя гаснет.
// Одни на все листы со страницами — здесь, рядом с остальным движением листа.
export const PAGE_IN_FWD = FadeInRight.duration(240).easing(ReEasing.out(ReEasing.cubic));
export const PAGE_IN_BACK = FadeInLeft.duration(240).easing(ReEasing.out(ReEasing.cubic));
export const PAGE_OUT = FadeOut.duration(100);

// Нижний отступ листа — один на все листы: под последней строкой содержимого
// (или под кнопками подвала) ровно SHEET_BOTTOM_GAP, ниже — только безопасная
// зона системы (insets.bottom). До 11 октября 2026 отступ складывался из трёх:
// содержимое листа (24), свой отступ у каждого листа (8–32) и «зона или 12»
// под листом — под последним пунктом меню проекта стояла пустота в полпальца.
// Свой нижний отступ листы больше не заводят (держит mobile/tests/sheetBottom.test.js).
export const SHEET_BOTTOM_GAP = spacing.md;
// Ниже этого видимая часть содержимого не бывает: страховка от кривого замера.
const MIN_BODY = 120;

/** Высота участка листа, которая едет к новой. Задаётся стилем на обёртку
 *  участка; пока не задана (−1) — обёртка по содержимому, как раньше.
 *  @param {function(): boolean} canAnimate — можно ли ехать сейчас (нет —
 *    «уменьшение движения» или лист ещё выезжает: высота встаёт сразу)
 *  @param {number} initial — высота до первого замера; −1 — по содержимому
 *  @returns {[object, function(number, number=): void]} стиль и go(to, cap) —
 *    куда ехать; cap — потолок: больше видимой части участок не бывает, и
 *    ехать до невидимого незачем (иначе сворачивание началось бы с
 *    «пустой» высоты и стояло на месте, пока она не дойдёт до видимой). */
function useEasedHeight(canAnimate, initial) {
  const h = useSharedValue(initial);
  const last = useRef(initial < 0 ? null : initial);
  const style = useAnimatedStyle(() => (h.value < 0 ? {} : { height: h.value }));
  function go(to, cap = Infinity) {
    // Вверх до целого пикселя: участок не короче содержимого, прокручиваться
    // на волосок ему незачем.
    const target = Math.ceil(Math.min(to, cap));
    const from = last.current;
    if (from === target) return;
    // Замер плавает на пиксель экрана: раскладка округляет края к пикселям, и
    // один и тот же подвал, смотря где стоит его верх, мерится то 123,8, то
    // 124,2 dp. Округление вверх раздувает эту долю до целого dp, а замер
    // кормит высоту, от которой зависит сам: 124 → замер 124,2 → 125 → замер
    // 123,8 → 124 → … Лист бесконечно дрожал на dp. Поэтому уменьшение не
    // больше SHEET_RESIZE_EPS — шум, а не новая высота: участок остаётся на
    // прежней (он не короче содержимого, лишний dp пустоты не виден), рост
    // принимается сразу.
    if (from !== null && from > target && from - target <= SHEET_RESIZE_EPS) return;
    last.current = target;
    if (from === null || !canAnimate()) { h.value = target; return; }
    // Едем оттуда, где участок сейчас: прежний ход (если ещё идёт) подхватывает
    // withTiming, а не обрывается скачком в свою конечную точку. Прыгнуть
    // приходится, только если участок выше потолка: от невидимой высоты ехать
    // незачем — он начинает с видимой (cap).
    if (from > cap) h.value = cap;
    h.value = withTiming(target, SHEET_RESIZE);
  }
  return [style, go];
}

/** Обёртка участка листа с едущей высотой — у каждого участка и у каждого
 *  открытия своя, а не одна на весь лист. Раньше высота жила в самом
 *  BottomSheet и переживала закрытие: новый лист открывался с высотой
 *  прежнего (его обёртка читала старое значение, пока не придёт первый
 *  замер), а потом схлопывался или распухал на выезде. Сбросить её записью в
 *  общее значение нельзя — запись уходит в поток интерфейса позже, чем
 *  монтируется обёртка, и гонку с ней не выиграть; поэтому обёртку ставят
 *  заново (key) и значение рождается свежим: −1, по содержимому.
 *  @param {{current: function}} goRef — сюда кладётся go(to, cap) обёртки
 *  @param {number} [initial] — высота при появлении: −1 — по содержимому,
 *    число — с него она поедет к первому замеру (подвал, выросший на глазах) */
function EasedBox({ goRef, canAnimate, initial = -1, style, children, ...rest }) {
  const [anim, go] = useEasedHeight(canAnimate, initial);
  const mine = useRef(null);
  mine.current = go;
  goRef.current = go;
  // Уходя, обёртка забирает свой go, но не чужой: на её место уже могла встать новая.
  useEffect(() => () => { if (goRef.current === mine.current) goRef.current = null; }, [goRef]);
  return <Reanimated.View {...rest} style={[style, anim]}>{children}</Reanimated.View>;
}

// Ушли от @gorhom/bottom-sheet на голый RN Modal+Animated+PanResponder — их
// BottomSheetModal стабильно не открывался (present() отрабатывал, состояние
// внутри библиотеки менялось, но на экране ничего не появлялось), это
// известный класс багов у этой библиотеки на Android без единой надёжной
// починки. Здесь всё построено из примитивов, которые можно проверить
// чтением исходников RN, а не поведением стороннего пакета:
// - Modal с transparent — отдельное нативное окно, гарантированно поверх
//   таббара и вообще всего (в отличие от абсолютного View внутри дерева).
// - Drag-to-dismiss висит ТОЛЬКО на шапке (ручка и строка заголовка), не на
//   всём листе, поэтому обычный TextInput внутри контента никогда не
//   конкурирует с этим жестом — их области на экране просто не пересекаются.
// - Шапка закреплена: ручка, а под ней одна строка «назад — заголовок —
//   крестик» по центру одной линии. Она стоит вне ScrollView и не уезжает при
//   прокрутке. Заголовок и «назад» листы отдают сами (useSheetHeader в
//   store/useSheetStore.js) и в содержимом их не рисуют. У листа без
//   заголовка и без «назад» (быстрая задача, профиль, вход) строки нет вовсе:
//   ни крестика, ни места под него — только ручка. Закрыть такой лист можно
//   свайпом вниз по ручке или нажатием на затемнение.
// - Под шапкой — волосяная линия, видимая только пока содержимое прокручено
//   вниз (contentOffset.y > 0): иначе обрезанная строка прилипала бы прямо к
//   заголовку. В покое линия прозрачна, но место держит — ничего не прыгает.
// - Высота листа — плитка maxHeight + ScrollView внутри (а не снаружи, как
//   раньше): если контент короче maxHeight, лист просто обтекает его; если
//   длиннее — ScrollView скроллится, а footer (снизу, вне ScrollView) всегда
//   виден.
// - «Юбка» под листом. Выезд — пружина с перелётом: на миг лист выше своего
//   места, и без запаса снизу открылся бы его нижний край (щель до низа
//   экрана). Фон продлён ниже экрана отдельным видом sheet-skirt: высота —
//   перелёт пружины на всю высоту окна плюс запас (skirtHeight), стоит
//   вплотную под листом и едет на том же translateY. Держит
//   mobile/tests/sheetSkirt.test.js.
// - Клавиатура. Лист прижат к низу (justifyContent:'flex-end'), а подложка
//   получает нижний отступ ровно на то, что клавиатура перекрывает: лист
//   встаёт над ней, его высота укорачивается на ту же величину (ScrollView
//   сжимается, шапка и подвал остаются на местах), а ScrollView докручивает
//   сфокусированное поле до видимой области с воздухом FIELD_GAP.
//   Android (11 октября 2026): лист едет вместе с клавиатурой, кадр за кадром.
//   Высоту клавиатуры по кадрам отдаёт react-native-keyboard-controller
//   (KeyboardProvider в App.js): Modal на Android — отдельное окно-диалог,
//   и библиотека, увидев его показ (topShow), вешает слушатель анимации
//   клавиатуры на окно диалога и ставит ему SOFT_INPUT_ADJUST_NOTHING — окно
//   под клавиатуру не ужимается, перекрытие равно её высоте. Отступ подложки
//   (liftStyle) считается в потоке интерфейса, без состояния JS на кадр;
//   укорачивает лист не maxHeight, а сама подложка: сверху у неё отступ
//   insets.top + spacing.md, лист сжимается (flexShrink). Безопасная зона
//   под листом остаётся всегда, а подложка поднимается на клавиатуру за
//   вычетом неё: панель системы лежит под клавиатурой, и содержимое листа
//   встаёт ровно на её верх, без скачка на высоту панели в начале хода.
//   Юбка едет следом на translateY (Animated, нативный драйвер). Раньше лист
//   поднимался по keyboardDidShow — событие приходит, когда клавиатура уже
//   встала, и лист прыгал за один кадр. Событие осталось только для докрутки
//   до поля — и для подъёма там, где нативной части библиотеки нет (Expo Go
//   без неё, lib/keyboard.js): там лист встаёт по нему, как прежде. useAnimatedKeyboard из Reanimated не годится: он слушает только
//   главное окно, а из диалога событий нет.
//   iOS: события Keyboard, keyboardWillShow (лист едет вместе с клавиатурой,
//   LayoutAnimation), подъём и maxHeight — из них, как ниже.
//   Перекрытие считается по геометрии: низ подложки (её высота из onLayout) минус
//   верх клавиатуры (endCoordinates.screenY). Так нет ни двойного вычета, ни
//   недовычета, из-за которых прежние версии мигали и закрывали поле: если ОС
//   сама ужала окно под клавиатуру (adjustResize), низ подложки уже над ней и
//   перекрытие — ноль; если не ужала, лист поднимает этот код. Modal с
//   statusBarTranslucent — отдельное окно во весь экран, и под клавиатуру оно
//   не ужимается: на эмуляторе при клавиатуре в 346 dp подложка осталась
//   914 dp, а screenY пришёл 544 — верх клавиатуры в координатах экрана (под
//   ней ещё 24 dp системной панели, которую подложка тоже закрывает, поэтому
//   отступ — 370, а не 346). Ранние версии: KeyboardAvoidingView с
//   behavior='padding' (на Android поле оставалось под клавиатурой) и ручной
//   сдвиг translateY на высоту клавиатуры (футер повисал под ней и не ловил
//   тапы). Оба пересчёта приходят разными кадрами — поэтому величина здесь
//   всегда выводится из текущих замеров, а не накапливается.
// - Смена страницы внутри листа. Высоты содержимого и подвала лежат на обёртках
//   (sheet-body и подвал) стилем из useEasedHeight: замер приходит из
//   onContentSizeChange и onLayout, обёртка едет к нему withTiming. Потолок —
//   что остаётся от листа за вычетом шапки и подвала, а когда клавиатура
//   сужает лист, лишнее по-прежнему отбирает flexShrink. Подвал, уходя,
//   сворачивается вместе с высотой, а кнопки стоят на нём до конца. Шапка
//   (заголовок и «назад») берётся из стора прямо в отрисовке и ложится в тот
//   же кадр, что содержимое (useSheetHeader — layout-эффект). «Уменьшение
//   движения» и первые SHEET_SETTLE_MS после открытия — без хода.
// - Дрожь высоты (11 октября 2026; держит mobile/tests/bottomSheetJitter.test.js).
//   а) Замер шумит на пиксель экрана, а округление вверх раздувает шум до
//   целого dp: подвал мерился 123,8 ↔ 124,2 (124 ↔ 125), и лист вечно дрожал
//   на dp. Уменьшение не больше SHEET_RESIZE_EPS — шум, рост принимается.
//   б) Высота жила в BottomSheet и переживала закрытие, новый лист открывался
//   по высоте прежнего. Теперь у каждого открытия (key = openId) и у каждого
//   появления подвала своя обёртка EasedBox со свежим значением — сбросом
//   записи в общее значение этого не добиться: она уходит в поток интерфейса
//   позже, чем монтируется обёртка. в) Ход начинается оттуда, где участок
//   стоит, а не с конца прежнего; подвал, пропавший из стора, остаётся
//   «призраком» в том же кадре (fading), а не на кадр уходит из дерева.
//   г) Подвал, вернувшийся, пока призрак сворачивается, едет обратно к
//   последнему замеру: обёртка та же, размер содержимого тот же, и onLayout
//   не придёт — без этого участок оставался на нуле, кнопки не видны.
export default function BottomSheet() {
  const content = useSheetStore((s) => s.content);
  const header = useSheetStore((s) => s.header);
  const footer = useSheetStore((s) => s.footer);
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = makeStyles(colors);

  const [visible, setVisible] = useState(false);
  const [renderedContent, setRenderedContent] = useState(null);
  const [renderedHeader, setRenderedHeader] = useState(null);
  const [renderedFooter, setRenderedFooter] = useState(null);
  // Содержимое прокручено вниз — под шапкой видна линия.
  const [scrolled, setScrolled] = useState(false);
  const translateY = useRef(new Animated.Value(windowHeight)).current;
  const scrollRef = useRef(null);
  const scrollApi = useRef({ scrollTo: (y) => scrollRef.current?.scrollTo({ y, animated: false }) }).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  // Клавиатура: { top, height } — верх в координатах экрана и высота; null —
  // её нет. areaH — высота подложки: меняется, если ОС ужала окно сама.
  const [kb, setKb] = useState(null);
  const [areaH, setAreaH] = useState(windowHeight);
  // Android: клавиатура по кадрам (react-native-keyboard-controller), высота
  // со знаком минус: 0 → −H. Подложка поднимается в потоке интерфейса на
  // перекрытие за вычетом безопасной зоны — она и так стоит под листом.
  // Юбке то же смещение нужно на translateY (Animated): слить его с ходом
  // листа можно только там. Нативной части библиотеки нет (Expo Go без неё,
  // lib/keyboard.js) — кадров тоже нет, и Android идёт прежним путём iOS-ветки
  // ниже: подъём по keyboardDidShow.
  const frames = Platform.OS === 'android' && KEYBOARD_NATIVE;
  const kbUi = useReanimatedKeyboardAnimation().height;
  const kbNative = useKeyboardAnimation().height;
  const zone = insets.bottom;
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -kbUi.value - zone) }), [zone]);
  // Тот же подъём со знаком минус: min(0, h + zone) при h = −H.
  const skirtY = useMemo(() => (frames
    ? Animated.add(translateY, kbNative.interpolate({ inputRange: [-zone - 1, -zone], outputRange: [-1, 0], extrapolateLeft: 'extend', extrapolateRight: 'clamp' }))
    : translateY), [frames, translateY, kbNative, zone]);
  // Замеры для докрутки до поля: текущая прокрутка, высота видимой части
  // ScrollView и поле, до которого уже докрутили (чтобы не возвращать его в
  // кадр, если человек сам прокрутил дальше).
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const revealed = useRef(null);
  const kbRef = useRef(null);
  kbRef.current = kb;
  // Смена страницы: можно ли ехать, высоты и подвал, который сворачивается.
  const reduced = useReduceMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const settling = useRef(false);
  const settleTimer = useRef(null);
  const canAnimate = () => !reducedRef.current && !settling.current;
  // Обёртки высоты содержимого и подвала (EasedBox) отдают сюда свой go.
  const bodyGo = useRef(null);
  const footGo = useRef(null);
  const goBody = (to, cap) => { if (bodyGo.current) bodyGo.current(to, cap); };
  const goFoot = (to, cap) => { if (footGo.current) footGo.current(to, cap); };
  // Номер открытия: ключ обёрток высоты. Лист, открытый поверх открытого,
  // получает свежие обёртки (и свой ScrollView с содержимым), а не
  // доживающие со стилем прежнего.
  const [openId, setOpenId] = useState(0);
  // Высота шапки с линией и подвала (куда он едет) — для потолка содержимого.
  const headH = useRef(0);
  const footH = useRef(0);
  // Последний замер живого подвала: footH на уходе обнуляется, а вернувшемуся
  // в ту же обёртку нужна его высота (см. эффект подвала ниже).
  const footMeasured = useRef(0);
  const [ghostFooter, setGhostFooter] = useState(null);
  const lastFooter = useRef(null);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  /** Довести сфокусированное поле до видимой области над клавиатурой.
   *  @param {boolean} force — и если это поле уже докручивали (клавиатура
   *    появилась заново или сменилась высота видимой части). */
  function revealFocused(force) {
    const state = TextInput.State;
    const input = state && state.currentlyFocusedInput ? state.currentlyFocusedInput() : null;
    const inner = scrollRef.current && scrollRef.current.getInnerViewRef && scrollRef.current.getInnerViewRef();
    if (!input || !inner || (!force && input === revealed.current)) return;
    // Положение поля — внутри содержимого, а не на экране: оно не зависит от
    // того, что лист в этот момент ещё едет вместе с клавиатурой.
    input.measureLayout(inner, (_x, y, _w, h) => {
      revealed.current = input;
      const view = viewportH.current;
      const top = scrollY.current;
      if (!view) return;
      if (y + h + FIELD_GAP > top + view) scrollRef.current?.scrollTo({ y: y + h + FIELD_GAP - view, animated: true });
      else if (y - FIELD_GAP < top) scrollRef.current?.scrollTo({ y: Math.max(0, y - FIELD_GAP), animated: true });
    }, () => {});
  }

  // Клавиатура: показ и скрытие. На iOS лист едет вместе с ней — тем же
  // временем и кривой, что сообщает событие (LayoutAnimation keyboard).
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const animate = (e) => {
      if (ios && e && e.duration) LayoutAnimation.configureNext({ duration: e.duration, update: { type: 'keyboard' } });
    };
    const show = (e) => {
      const { screenY, height } = e.endCoordinates;
      animate(e);
      revealed.current = null;
      setKb(height > 0 ? { top: screenY, height } : null);
    };
    const hide = (e) => { animate(e); revealed.current = null; setKb(null); };
    const subs = ios
      ? [
          Keyboard.addListener('keyboardWillShow', show),
          // Высота сменилась при открытой клавиатуре (эмодзи, подсказки). Кадр
          // за краем экрана — это уход клавиатуры: его ведёт keyboardWillHide.
          Keyboard.addListener('keyboardWillChangeFrame', (e) => {
            if (kbRef.current && e.endCoordinates.screenY < Dimensions.get('window').height) show(e);
          }),
          Keyboard.addListener('keyboardWillHide', hide),
        ]
      : [Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardDidHide', hide)];
    return () => subs.forEach((s) => s.remove());
  }, []);

  // Клавиатура появилась или сменила высоту — после того как лист пересчитал
  // размеры, поле докручивается. Сжатие ScrollView ловит и onLayout ниже, но
  // у короткого листа его размер не меняется, а докрутка всё равно нужна.
  useEffect(() => {
    if (!kb) return undefined;
    const id = setTimeout(() => revealFocused(true), FOCUS_CHECK_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kb && kb.height, kb && kb.top]);

  // Уход вниз: лист ease in, подложка гаснет вместе с ним.
  function animateClose() {
    // Клавиатура уходит вместе с листом, а не остаётся над пустым экраном.
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(translateY, { toValue: windowHeight, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: CLOSE_MS, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) { setVisible(false); setScrolled(false); }
    });
  }

  useEffect(() => {
    if (content) {
      setRenderedContent(content);
      setRenderedFooter(footer);
      setVisible(true);
      // Новый лист начинается с верха: ScrollView, оставшийся от прежнего,
      // хранит его прокрутку, а линия под шапкой должна говорить правду.
      setScrolled(false);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      scrollY.current = 0;
      revealed.current = null;
      // Высоты участков не помним: обёртки встают заново (см. EasedBox, key по
      // openId) — у доживающей остался бы стиль прежнего листа.
      footH.current = 0;
      footMeasured.current = 0;
      lastFooter.current = null;
      setGhostFooter(null);
      setOpenId((n) => n + 1);
      settling.current = true;
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => { settling.current = false; }, SHEET_SETTLE_MS);
      // Клавиатура могла остаться от прошлого листа (или от поля под ним), а
      // события о ней уже прошли — спрашиваем, а не ждём.
      const m = Keyboard.isVisible && Keyboard.isVisible() && Keyboard.metrics ? Keyboard.metrics() : null;
      setKb(m && m.height > 0 ? { top: m.screenY, height: m.height } : null);
      translateY.setValue(windowHeight);
      backdrop.setValue(0);
      requestAnimationFrame(() => {
        // Выезд на пружине: ease out с лёгким перелётом.
        Animated.parallel([
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...SHEET_SPRING }),
          Animated.timing(backdrop, { toValue: 1, duration: OPEN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      });
    } else if (visible) {
      animateClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    if (content) setRenderedFooter(footer);
  }, [footer, content]);

  useEffect(() => {
    if (content) setRenderedHeader(header);
  }, [header, content]);

  // Пока лист открыт, подвал берётся прямо из стора — как и шапка, в тот же
  // кадр, что содержимое; уходя, лист показывает последний.
  const liveFooter = content ? footer : renderedFooter;
  // Подвал появился — участок под него вырастает; исчез — сворачивается, а
  // прежние кнопки стоят на нём, пока он не стянется, а не гаснут в первый
  // кадр. Лист выезжает или движение уменьшено — сразу.
  useEffect(() => {
    if (liveFooter) {
      lastFooter.current = liveFooter;
      // Вернулся, пока призрак ещё сворачивается (фильтр: «Сбросить» снят и
      // тут же снова нужен; страница экспорта туда и обратно): обёртка та же,
      // размер содержимого тот же — onLayout не придёт, и участок застрял бы
      // на нуле со спрятанными кнопками. Едем обратно к последнему замеру.
      if (ghostFooter && footMeasured.current > 0) {
        footH.current = footMeasured.current;
        goFoot(footH.current);
      }
      setGhostFooter(null);
      return undefined;
    }
    const old = lastFooter.current;
    lastFooter.current = null;
    if (!old) return undefined;
    footH.current = 0;
    goFoot(0);
    if (!canAnimate()) return undefined;
    setGhostFooter(old);
    const id = setTimeout(() => setGhostFooter(null), SHEET_RESIZE_MS + 40);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFooter]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DRAG_CLOSE_DISTANCE || g.vy > DRAG_CLOSE_VELOCITY) {
          animateClose();
          closeSheet();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...SHEET_SPRING }).start();
        }
      },
    }),
  ).current;

  if (!visible) return null;

  // Раскрывается ровно до нижней границы шапки, а не на условные 90%
  // высоты экрана: прежняя доля не была ни к чему привязана и оставляла
  // произвольный зазор, который на разных экранах выглядел по-разному.
  const fullHeight = windowHeight - insets.top - HEADER_CONTENT_HEIGHT;
  // Клавиатура открыта: сколько из неё перекрывает подложку (ноль, если ОС
  // сама ужала окно). Лист укорачивается до оставшегося места — вместе с
  // клавиатурой он занимает экран целиком, поэтому зазор сверху уже не
  // шапка приложения, а обычный воздух. Под клавиатурой лежит и системная
  // панель, так что нижний отступ под неё не нужен. Так — на iOS; на Android
  // подъём и укорачивание ведёт поток интерфейса (liftStyle, sheetShrink),
  // а событие клавиатуры только будит докрутку до поля.
  const kbJs = frames ? null : kb;
  const lift = kbJs ? Math.max(0, areaH - (kbJs.top == null ? areaH - kbJs.height : kbJs.top)) : 0;
  const maxHeight = kbJs ? Math.min(fullHeight, areaH - lift - insets.top - spacing.md) : fullHeight;
  // Под листом — только безопасная зона (под клавиатурой её нет: панель
  // системы лежит под клавиатурой). Ровный воздух SHEET_BOTTOM_GAP — у
  // содержимого или подвала, а не здесь. На Android зона стоит всегда:
  // подложка поднимается на клавиатуру за её вычетом (liftStyle).
  const bottomPad = kbJs ? 0 : insets.bottom;
  const Overlay = frames ? Reanimated.View : View;
  // «Юбка» под листом: пружина на миг поднимает лист выше места (SHEET_SPRING
  // перелетает цель), и без неё снизу открылся бы его нижний край — щель до
  // низа экрана. Юбка — тот же фон, едет вместе с листом (общий translateY) и
  // лежит ниже видимой части; перелёт её лишь «втягивает» в кадр.
  const skirt = skirtHeight(windowHeight);
  // Пока лист открыт, шапка берётся прямо из стора — на кадр раньше, чем
  // через копию; уходя, лист показывает последнюю, чтобы заголовок не
  // пропадал посреди анимации.
  const shownHeader = content ? header : renderedHeader;
  // Строка шапки нужна, когда есть что в ней показать: заголовок или «назад».
  // Иначе листу хватает ручки, а крестика и места под него нет.
  const showHead = !!(shownHeader && (shownHeader.title || shownHeader.onBack));
  // Подвал пропал, а эффект выше ещё не поставил «призрак»: без этого обёртка
  // на кадр-другой уходила бы из дерева и возвращалась уже сворачиваться —
  // кнопки мигали бы, а go(0) не находил обёртки. Призрак берётся тут же, в
  // отрисовке, и обёртка стоит на месте всё время.
  const fading = !liveFooter && !ghostFooter && lastFooter.current && canAnimate() ? lastFooter.current : null;
  const shownFooter = liveFooter || ghostFooter || fading;
  // Потолок высоты содержимого: лист без клавиатуры минус нижний отступ, шапка и подвал.
  const bodyCap = () => Math.max(MIN_BODY, fullHeight - insets.bottom - headH.current - footH.current);
  // Новая страница заменила старую — заголовок и «назад» проявляются (не при открытии).
  const headIn = reduced || settling.current ? undefined : HEAD_IN;
  // Системная «назад» (Android) — как стрелка в шапке: со страницы листа на
  // шаг назад, а закрывает лист только там, где стрелки нет. Раньше она
  // закрывала лист целиком, со всем набранным на первой странице. Шапка
  // читается из стора в момент нажатия.
  const onSystemBack = () => {
    const head = useSheetStore.getState().header;
    if (head && head.onBack) head.onBack();
    else closeSheet();
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onSystemBack}>
      <Overlay
        style={frames ? [styles.overlay, { paddingTop: insets.top + spacing.md }, liftStyle] : [styles.overlay, { paddingBottom: lift }]}
        onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}
        testID="sheet-overlay"
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: backdrop }]} />
        <Pressable testID="sheet-scrim" style={StyleSheet.absoluteFill} onPress={closeSheet} />
        <Animated.View style={[styles.sheet, frames && styles.sheetShrink, { maxHeight, paddingBottom: bottomPad, transform: [{ translateY }] }]} testID="sheet">
          {/* Шапка листа, закреплённая: ручка посередине, под ней одна
              строка — «назад» (если есть куда), заголовок и крестик. За
              всю шапку тянут вниз. Крестик у всех листов один, в общем
              месте; у листа без заголовка строки нет, только ручка. */}
          <View
            {...panResponder.panHandlers}
            style={[styles.header, !showHead && styles.headerBare]}
            testID="sheet-header"
            onLayout={(e) => { headH.current = e.nativeEvent.layout.height + StyleSheet.hairlineWidth; }}
          >
            <View style={styles.grabber} />
            {showHead ? (
              <View style={styles.headRow} testID="sheet-head-row">
                {shownHeader.onBack ? (
                  <Reanimated.View entering={headIn}>
                    <Tap scale={0.9} hitSlop={8} onPress={shownHeader.onBack} style={styles.roundBtn} accessibilityRole="button" accessibilityLabel={t(lang, 'common.back')}>
                      <Icon name="chevron-left" size={16} color={colors.text} />
                    </Tap>
                  </Reanimated.View>
                ) : null}
                {/* Ключ — заголовок: сменился — коробка встаёт заново и проявляется. */}
                <Reanimated.View key={shownHeader.title || ''} style={styles.headTitleBox} entering={headIn}>
                  {shownHeader.title ? (
                    <Text style={styles.headTitle} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header">{shownHeader.title}</Text>
                  ) : null}
                </Reanimated.View>
                <Tap scale={0.9} hitSlop={8} onPress={closeSheet} style={styles.roundBtn} accessibilityRole="button" accessibilityLabel={t(lang, 'common.close')}>
                  <Icon name="x" size={13} color={colors.textDim} />
                </Tap>
              </View>
            ) : null}
          </View>
          <View style={[styles.headLine, scrolled && styles.headLineOn]} testID="sheet-head-line" />
          <EasedBox key={`body${openId}`} goRef={bodyGo} canAnimate={canAnimate} style={styles.scrollBox} testID="sheet-body">
          <ScrollView
            ref={scrollRef}
            testID="sheet-scroll"
            style={styles.scroll}
            contentContainerStyle={[styles.content, liveFooter && styles.contentWithFooter]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; setScrolled(e.nativeEvent.contentOffset.y > 0); }}
            onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; if (kbRef.current) revealFocused(true); }}
            onContentSizeChange={(_w, h) => goBody(h, bodyCap())}
            // Фокус мог перейти на другое поле, а клавиатура осталась —
            // события о ней в этом случае нет, поэтому после касания смотрим сами.
            onTouchEnd={() => { if (kbRef.current) setTimeout(() => revealFocused(false), FOCUS_CHECK_MS); }}
          >
            <SheetScrollContext.Provider value={scrollApi}>{renderedContent}</SheetScrollContext.Provider>
          </ScrollView>
          </EasedBox>
          {shownFooter ? (
            <EasedBox
              key={`foot${openId}`}
              goRef={footGo}
              canAnimate={canAnimate}
              // Появился на глазах — вырастает с нуля; вместе с листом — по содержимому.
              initial={canAnimate() ? 0 : -1}
              style={styles.footerBox}
              testID="sheet-footer"
              pointerEvents={liveFooter ? 'auto' : 'none'}
              importantForAccessibility={liveFooter ? 'auto' : 'no-hide-descendants'}
            >
              <View
                style={styles.footer}
                testID="sheet-footer-content"
                onLayout={(e) => {
                  if (!liveFooter) return;
                  footH.current = e.nativeEvent.layout.height;
                  footMeasured.current = footH.current;
                  goFoot(footH.current);
                }}
              >
                {shownFooter}
              </View>
            </EasedBox>
          ) : null}
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          testID="sheet-skirt"
          style={[styles.skirt, { height: skirt, bottom: lift - skirt, transform: [{ translateY: skirtY }] }]}
        />
      </Overlay>
    </Modal>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.panel, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  // Android: лист укорачивает подложка (её отступы сверху и снизу), а не maxHeight.
  sheetShrink: { flexShrink: 1 },
  // Шапка: ручка (8 сверху, 4 высотой) и под ней строка в 30 — по высоте
  // круглых кнопок. Строка одна для «назад», заголовка и крестика, поэтому
  // они стоят на одной линии: alignItems: 'center'. Воздух под строкой (8) —
  // до линии; в покое вместе с верхним отступом содержимого (4) выходит те же
  // 12, что были, а прокрученная строка не липнет к заголовку вплотную.
  header: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  // Без строки шапки — одна ручка; места под ней чуть больше, чтобы за неё
  // было удобно тянуть.
  headerBare: { paddingBottom: spacing.md },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  headRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 30, marginTop: spacing.xs,
    paddingHorizontal: screenPadding,
  },
  // minWidth: 0 — иначе длинный заголовок распирает строку и сдвигает крестик.
  headTitleBox: { flex: 1, minWidth: 0, justifyContent: 'center' },
  headTitle: { color: colors.text, ...typography.title },
  roundBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  // Линия под шапкой: место занято всегда, цвет — только при прокрутке.
  headLine: { height: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  headLineOn: { backgroundColor: colors.border },
  // Продление фона листа вниз за экран (см. skirtHeight): снизу от листа, на
  // всю ширину; bottom и height ставит разметка.
  skirt: { position: 'absolute', left: 0, right: 0, backgroundColor: colors.panel },
  // Обёртка содержимого: её высоту ведёт useEasedHeight, лишнее отбирает flexShrink.
  scrollBox: { flexShrink: 1 },
  scroll: { flexShrink: 1 },
  // Низ содержимого без подвала — SHEET_BOTTOM_GAP; с подвалом — воздух до
  // кнопок, а SHEET_BOTTOM_GAP стоит уже под ними.
  content: { paddingHorizontal: screenPadding, paddingTop: spacing.xs, paddingBottom: SHEET_BOTTOM_GAP },
  contentWithFooter: { paddingBottom: spacing.md },
  // Обёртка подвала: высоту ведёт useEasedHeight, кнопки внутри — своей высоты.
  footerBox: { overflow: 'hidden' },
  footer: {
    backgroundColor: colors.panel, paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: SHEET_BOTTOM_GAP, gap: spacing.sm,
  },
});

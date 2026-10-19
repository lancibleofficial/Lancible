// «Проекты» — колода (макет B2): проекты листаются вбок карточками, карточка
// во всю высоту до точек пагинации. В карточке: название, «✓ 3/9» и
// ближайший дедлайн его цветом, теги проекта, часы и деньги, задачи со
// своей прокруткой, внизу — поле новой задачи и «Перейти в проект».
//
// Порядок карточек (круг 21) — по свежести: первым, слева, — проект с
// последними изменениями, в его задачах или в нём самом (Core.projectsByActivity
// — то же правило, что у проектов веба); новый проект появляется слева.
// Закрепление больше не ставит проект первым. Пока экран в фокусе, порядок
// держится (Core.holdOrder): галочка или новая задача в карточке не
// перетасовывает колоду под пальцем, новый проект встаёт слева. Ушли с экрана
// — порядок считается заново, и к возврату колода уже стоит по свежести, а на
// экране — та же карточка, что была (страница идёт за проектом, а не за
// номером); после создания проекта — он. Страница встаёт за карточкой в той же
// отрисовке, что и новый порядок (deckNext), а не эффектом после неё. Колода,
// которая дочитывает данные в пустую (первая связь, вход, смена аккаунта),
// идёт за свежими данными и стоит на первой карточке, пока её не тронули и с
// неё не ушли: иначе она держала бы порядок первого шага и ехала за первой
// попавшейся карточкой (19 октября: карточки проявлялись по одной).
//
// Порядок задач — по последнему изменению, свежая сверху. Запущенная задача
// при этом не прыгает: запуск таймера задачу не меняет, а первой идущая
// стоит только на входе на экран (nextPinTop). Остановили — у задачи
// свежая отметка, и она плавно уезжает наверх (MOVE, hooks/useOrderHold.js:
// там же заморозка порядка, пока таймер идёт, и сброс с уходом с экрана).
// Выполненные задачи тоже в карточке — внизу, под активными, серые и
// зачёркнутые, как в ленте (cardDoneTasks): отмеченная уезжает к ним, снятая
// отметка возвращает строку наверх. Самый низ — отменённые (cardCancelledTasks):
// серый крестик вместо галочки, название серое без зачёркивания; нажатие на
// крестик возвращает задачу в работу, и строка уезжает наверх. Мета строки —
// по-прежнему только статус и срок.
//
// Галочка меняет задачу в тот же миг: шкала, «✓ 3/9» и статус строки не ждут.
// Строка при этом стоит на старом месте, пока налив играет (hold.markNow), и
// потом уезжает вниз.
//
// Колода едет на своём жесте, а не на прокрутке списка: так у неё настоящие
// пружины. По краям колоды спрятаны плашки, уходящие далеко за край экрана.
// Слева — «+»: тянешь первую карточку вправо — «+» выезжает на резинке, за
// порогом заливается акцентом и щёлкает хаптика; отпустил за порогом — лист
// нового проекта, колода пружиной встаёт на место. Справа — плашка с
// фразой: тянешь последнюю карточку влево — серая плашка проявляется, на ней
// короткая шутка или ободрение (каждый раз другая), от фразы летят искры
// (components/DeckSparks.js — за пальцем, а не по таймеру); на пороге плашка
// светлеет и щёлкает хаптика, а искры ждут на местах, пока палец на экране:
// разлетаются взрывом и гаснут только с отпусканием за порогом (отпустил
// раньше — просто тают вместе с плашкой), до следующей оттяжки не
// возвращаясь; колода пружиной встаёт на последнюю карточку, никуда не едет.
// Пасхалка: оттянул плашку совсем далеко (EGG_TRIGGER — палец прошёл почти
// весь экран, ~340 pt пути; двумя пальцами достаётся легче) — она плавно становится
// пурпурной (eggPlate), приглушённые искры жёлтыми (eggSpark), а фраза меняется
// на одну из пяти шуток deck.egg_* (случайная, не та же подряд); хаптика
// сильнее обычной, другого типа. Пасхалка идёт за пальцем, как и порог:
// вернулся под неё, не отпуская, — снова серая плашка с обычной фразой, и
// новый заход покажет другую шутку. С отпусканием пасхальное состояние
// снимается — плашка уходит серой, с обычной фразой, ничего не залипает; искры
// при этом разлетаются жёлтыми (fired = 2: взрыв в цвете пасхалки). «Уменьшение
// движения»: цвет и фраза меняются сразу, без перехода; хаптика остаётся.
// «+» — ещё одна позиция ряда точек пагинации: самая левая, слот точки на шаг
// левее первой, тем же размером. Окно ряда — пять позиций (MAX_SLOTS, считая
// «+» и уменьшенные крайние): «+» виден, пока окно у левого края, и уезжает из
// окна так же, как крайние точки; по нажатию открывает тот же лист.
//
// Колода — каруселью (12 октября): центральная карточка в полный рост, соседние
// меньше (SIDE_SCALE) и чуть приглушены (SIDE_DIM). Всё это — функция
// положения колоды x на UI-потоке (deckScale, deckShift, deckDim), а не
// остановки на карточке: карточка, подъезжая к центру, растёт до 1 вместе с
// пальцем, уезжая — уменьшается. Только трансформации и прозрачность
// подложки, раскладка не пересчитывается. За краем колоды те же правила:
// плашки «+» и с фразой — такие же уменьшенные соседки (SIDE_SCALE) и по мере
// оттяжки растут: по ширине до 1 + EDGE_GROW, по высоте только до 1 — выше
// центральной карточки (той же высоты, что область колоды) плашка не бывает,
// иначе её верх уходил бы под шапку, а низ на точки. Крайняя карточка проекта
// рядом с ними на оттяжке, наоборот, уменьшается до SIDE_SCALE и не растёт
// (deckPull). С отпусканием всё возвращается вместе с пружиной колоды.
//
// Окно карточек (20 октября, жалоба «прогрузка следующей карточки тормозит»):
// настоящими (ProjectCard) нарисованы карточки ±DECK_KEEP (2) от страницы, на
// которой колода в последний раз встала (win), и всегда — видимые (страница и
// края соседок, deckDrawn); остальные — пустые оболочки DeckSlot того же вида.
// Страница (page) меняется с отпусканием, а окно — только когда пружина
// доехала (колбэк withSpring → settle): монтаж дальней карточки (список задач,
// теги, поле ввода) и размонтирование ушедшей не ложатся на ход колоды. Раньше
// новая соседка монтировалась в миг отпускания, виды на новой архитектуре
// создаются на UI-потоке, и пружина спотыкалась под конец хода; теперь соседка
// новой страницы к отпусканию уже готова. Прерванная пружина (новый жест,
// точка) окна не двигает; перестановка и поворот ставят полосу сразу — и окно
// вместе с ней. Карточки — под memo со стабильными пропсами (hold — тот же
// объект, пока не поменялся; onOpen — по id), из стора — только задачи своего
// проекта и таймер своей задачи (часы тикают только у неё): смена страницы и
// правка чужой задачи остальных не перерисовывают. Жест — один объект (useMemo).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, useDerivedValue, withSpring, withTiming, interpolateColor, runOnJS,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import TaskRow from '../components/TaskRow';
import ConflictMark from '../components/ConflictMark';
import ProgressBar from '../components/ProgressBar';
import { TagBadgeRow } from '../components/TagBadge';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import NewProjectSheet from '../components/NewProjectSheet';
import ProjectsEmpty from '../components/ProjectsEmpty';
import EmptyState from '../components/EmptyState';
import DeckSparks from '../components/DeckSparks';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useOrderHold } from '../hooks/useOrderHold';
import { rubberBand } from '../components/SwipeRow';
import { useAppStore, tasksOf, projectMs, projectMoney } from '../store/useAppStore';
import { useRates, currencyOf } from '../hooks/useRates';
import { useModeFlags } from '../hooks/useModeFlags';
import { fmtDur, fmtMoney } from '../lib/format';
import { dueShort, dueState } from '../lib/due';
import { tagsOf } from '../lib/tags';
import { defaultStatusId, isCancelled } from '../lib/statuses';
import { useTicker } from '../hooks/useTicker';
import { openSheet, closeSheet } from '../store/useSheetStore';
import { useColors, spacing, screenPadding, radius, fontSize, displayFamily, tabBarClearance } from '../theme';
import { t } from '../lib/i18n';
import { pushTask } from '../navigation/openTask';
import Views from '../core/views.js';

// Край следующей карточки виден: по нему понятно, что колода продолжается.
const PEEK = 40;
const GAP = 10;
const PLUS_W = 84;
// Карточки «+» уходят далеко за край экрана: их внешнего края не видно,
// сколько ни тяни.
const PLUS_TAIL = 600;
/** Насколько вытянуть «+», чтобы отпускание создало проект. */
export const PULL_TRIGGER = 70;
/** Насколько оттянуть плашку у правого края, чтобы сработала пасхалка, — в
 *  тех же единицах, что PULL_TRIGGER (на сколько колода ушла за край). Резинка
 *  сжимает палец: ×0.8 до 87.5, дальше всё жёстче (rubberBand), — поэтому 170
 *  это палец, прошедший ~322 pt в счёт жеста, а на Android с люфтом активации
 *  (~18 pt, замер на эмуляторе) ~340 pt пути: 83% ширины телефона 411 pt, а на
 *  360 pt — от края до края. Потолок одним пальцем — около 180. Сильная
 *  оттяжка за первый порог (200–300 pt пальцем, это 137–166) её не включает,
 *  как и обычное пролистывание к последней карточке. Двумя пальцами и рывком
 *  достаётся легче. */
export const EGG_TRIGGER = 170;
// Пасхалка проявляется (и уходит) за столько мс.
const EGG_FADE = { duration: 260, easing: Easing.out(Easing.cubic) };
// Пружина колоды: быстрая, с небольшим перелётом.
const SNAP = { damping: 19, stiffness: 190, mass: 0.9 };
// Точки пагинации — круглые, с ровным зазором; текущая вытягивается в
// пилюлю, соседи расступаются. Ряд — «+» и по точке на проект; в окне не
// больше пяти позиций, считая «+» и крайние: у крайних, если за ними есть ещё,
// размер меньше, а следующая за ними растёт из нуля. Центр окна — пилюля, рядом
// полные точки, по краям — уменьшенные. Всё считается от положения колоды
// (сколько страниц она проехала), а не от остановки на карточке: пилюля
// перетекает из точки в точку вместе с пальцем.
export const MAX_SLOTS = 5;
const DOT = 7;
const DOT_ON = 22;
const DOT_GAP = 6;
const DOT_SLOT = DOT + DOT_GAP;
// Запас рамки с каждой стороны — слот точки: въезжающая и уезжающая точки
// видны уже уменьшенными и краем рамки не режутся.
const DOT_PAD = DOT_SLOT;
// «+» в ряду точек — в слоте точки слева от первой, с тем же шагом. Значок
// чуть больше точки (9 против 7): у креста площадь меньше, чем у круга, и
// так он выглядит её ровней. Зона нажатия — шире значка, во всю высоту ряда.
const PLUS_DOT = 9;
const PLUS_HIT = 26;
// Высота ряда точек и его рамки.
const DOTS_H = 26;
// Плашка с фразой у правого края: ширина блока текста на ней. С полями по 6
// на строку остаётся 92 pt — хватает на слово в двенадцать букв («продуктивный»),
// а на пороге оттяжки видимая плашка ~100.
const PHRASE_W = 104;
/** Фразы плашки у правого края колоды — ключи словаря, по одной на оттяжку. */
export const DECK_PHRASES = Array.from({ length: 30 }, (_, i) => `deck.phrase_${i + 1}`);
/** Фразы пасхалки — ключи словаря; русский текст продиктовал пользователь. */
export const DECK_EGG_PHRASES = Array.from({ length: 5 }, (_, i) => `deck.egg_${i + 1}`);
// Карусель: масштаб соседней карточки (и плашек «+» и с фразой, пока их не
// тянут), затемнение соседней (доля цвета фона поверх карточки) и насколько
// плашка у края перерастает полный размер по ширине на пороге оттяжки. По
// высоте плашка выше 1 не растёт: у неё та же коробка, что у карточки, и
// сверх неё верх уходил бы под шапку, а низ на точки.
export const SIDE_SCALE = 0.94;
export const SIDE_DIM = 0.3;
export const EDGE_GROW = 0.04;

/** Порядок задач в карточке — правило ядра (core/views.js), общее с
 *  десктопом и вебом. pinTop — { taskId } идущей, закреплённой на входе.
 *  Выполненных здесь нет: они идут под ними (cardDoneTasks), а отменённых —
 *  ещё ниже (cardCancelledTasks); statuses — чтобы узнать отменённую по виду
 *  статуса (без них — по флагу задачи). */
export function cardTasks(tasks, pinTop, statuses) {
  return Views.deckTasks(tasks.filter((task) => !isCancelled(task, statuses)), pinTop && pinTop.taskId);
}

/** Выполненные задачи карточки — внизу, под активными: свежеотмеченные выше
 *  (по последнему изменению). Серые, зачёркнутые — как в ленте (TaskRow). */
export function cardDoneTasks(tasks) {
  const at = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
  return tasks.filter((task) => task.done).sort((a, b) => at(b) - at(a));
}

/** Отменённые задачи карточки — самый низ, под выполненными: свежие выше.
 *  Серый крестик вместо галочки, название серое без зачёркивания (TaskRow). */
export function cardCancelledTasks(tasks, statuses) {
  const at = (task) => (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
  return tasks.filter((task) => isCancelled(task, statuses)).sort((a, b) => at(b) - at(a));
}

/** Какая задача стоит в карточках первой как идущая — тоже из ядра. */
export const nextPinTop = (pinTop, activeTimer) => Views.deckPinTop(pinTop, activeTimer);

// --- порядок колоды и карточка на экране (круг 21, правка 19 октября) ---
//
// Одно состояние { ids, page, win, viewed, loading, focused }, следующее считается
// в той же отрисовке из прошлого (deckNext): страница встаёт за карточкой
// сразу, вместе с новым порядком. Раньше порядок лежал в ref, менялся прямо в
// отрисовке, а страницу догонял эффект после неё: отрисовка с новым порядком
// и старой страницей успевала на экран — посередине чужая карточка, нужная —
// пустой оболочкой (окно ±1 стояло на старом номере), и карточки
// пересоздавались и проявлялись по одной, на каждый шаг дочитывания данных.
//   ids     — порядок карточек (id проектов);
//   page    — какая на экране, номер;
//   win     — на какой странице колода в последний раз встала (пружина
//             доехала, deckSettle): вокруг неё окно настоящих карточек
//             (deckDrawn). page меняется с отпусканием, win — с остановкой;
//             перестановка ставит полосу на место сразу, и win = page;
//   viewed  — её id, если её надо держать при перестановке (выбрал человек,
//             видели перед уходом с экрана); null — на экране первая;
//   loading — колода дочитывает данные в пустую (первая связь, вход, смена
//             аккаунта): порядок идёт за свежими данными, на экране первая,
//             пока колоду не тронули и с неё не ушли;
//   focused — экран в фокусе (по смене виден уход).

const sameList = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const sameSet = (ids, have) => {
  if (ids.length !== have.length) return false;
  const set = new Set(ids);
  return have.every((id) => set.has(id));
};

/** id проектов по свежести — правило ядра (Core.projectsByActivity). */
export const deckFreshIds = (projects, tasks) => Views.projectsByActivity(projects, tasks).map((project) => project.id);

/** Колода на входе: порядок свежий, на экране первая. Пустая — дочитывает. */
export function deckStart(freshIds, focused) {
  return { ids: freshIds, page: 0, win: 0, viewed: null, loading: freshIds.length === 0, focused };
}

/** Следующее состояние колоды по данным. have — id проектов в сторе (в любом
 *  порядке); fresh() — id по свежести (Core.projectsByActivity), зовётся,
 *  только когда нужен; focused — экран в фокусе. Ничего не поменялось — тот
 *  же объект.
 *  - В фокусе порядок держится (Core.holdOrder): меняется, только когда
 *    проект завели или удалили, а на экране остаётся та же карточка.
 *  - Ушли с экрана — запоминается карточка на экране; вне фокуса порядок идёт
 *    за свежими данными, страница — за запомненной карточкой.
 *  - Дочитывая (loading) — порядок свежий, на экране первая.
 *  - Карточку на экране удалили — встаёт соседняя, за край колоды не уходит. */
export function deckNext(prev, { have, fresh, focused }) {
  let { viewed, loading } = prev;
  if (prev.focused && !focused && prev.ids.length) {
    viewed = viewed || prev.ids[prev.page] || null;
    loading = false;
  }
  let ids = prev.ids;
  if (!focused || loading) ids = fresh();
  else if (!sameSet(prev.ids, have)) ids = Views.holdOrder(prev.ids, fresh());
  if (sameList(ids, prev.ids)) ids = prev.ids;
  let { page, win } = prev;
  if (ids !== prev.ids) {
    // Держать карточку на экране: выбранную или запомненную, а в фокусе —
    // ту, что сейчас видна. Дочитывая — никакую: на экране первая.
    const anchor = loading ? null : viewed || (focused ? prev.ids[prev.page] || null : null);
    const at = anchor ? ids.indexOf(anchor) : -1;
    if (!ids.length) {
      page = 0;
      viewed = null;
      loading = true;
    } else if (at >= 0) {
      page = at;
      viewed = anchor;
    } else if (anchor) {
      page = Math.min(prev.page, ids.length - 1);
      viewed = ids[page];
    } else {
      page = 0;
    }
    // Новый порядок — полоса встаёт на страницу сразу, без движения
    // (layout-эффект экрана): окно карточек — вокруг неё же.
    win = page;
  }
  if (ids === prev.ids && page === prev.page && viewed === prev.viewed && loading === prev.loading && focused === prev.focused) return prev;
  return { ids, page, win, viewed, loading, focused };
}

/** Человек встал на страницу p — отпустил колоду, нажал точку. Окно карточек
 *  (win) не трогается: оно сдвинется, когда пружина доедет (deckSettle). */
export function deckChoose(prev, p) {
  const viewed = prev.ids[p] || null;
  if (prev.page === p && prev.viewed === viewed && !prev.loading) return prev;
  return { ...prev, page: p, viewed, loading: false };
}

/** Пружина колоды доехала до страницы p — окно карточек сдвигается к ней.
 *  Устаревшая остановка (страница с тех пор другая) ничего не делает. */
export function deckSettle(prev, p) {
  if (prev.page !== p || prev.win === p) return prev;
  return { ...prev, win: p };
}

/** Насколько далеко от страницы, на которой колода стоит, карточки нарисованы
 *  настоящими. Соседка соседки уже готова: перелистнули — новая соседка не
 *  монтируется на ходу пружины. */
export const DECK_KEEP = 2;

/** Рисовать ли карточку i настоящей (ProjectCard), а не пустой оболочкой
 *  (DeckSlot). Окно — ±DECK_KEEP от win, страницы, на которой колода в
 *  последний раз встала: сдвигается оно только с остановкой пружины, поэтому
 *  монтаж дальней карточки и размонтирование ушедшей из окна не ложатся на
 *  ход колоды. И всегда настоящие — видимые: страница page и её соседки (их
 *  края видны), даже если колоду перелистнули дальше окна, не дав ей встать
 *  (жесты подряд, точка через несколько страниц). */
export function deckDrawn(i, page, win) {
  return Math.abs(i - win) <= DECK_KEEP || Math.abs(i - page) <= 1;
}

/** Колоду тронули: дочитывание кончилось, дальше порядок держится. */
export function deckTouched(prev) {
  return prev.loading && prev.ids.length ? { ...prev, loading: false } : prev;
}

/** Куда встать колоде после отпускания: по положению с поправкой на
 *  скорость, не дальше соседней с той, с которой начали, и в пределах
 *  колоды. x — сдвиг полосы (страница p стоит при x = -p·step). */
export function deckTarget(x, vx, step, fromPage, count) {
  'worklet';
  const projected = Math.round(-(x + vx * 0.12) / step);
  const near = Math.max(fromPage - 1, Math.min(fromPage + 1, projected));
  return Math.max(0, Math.min(count - 1, near));
}

/** Окно ряда: с какой позиции начинается видимая пятёрка, когда текущая
 *  точка — active. Позиции ряда считаются с «+» (0), точка проекта i —
 *  позиция i + 1. Текущая стоит посередине (третьей), пока окну есть куда
 *  ехать, — у краёв колоды окно упирается в край ряда. */
export function dotsStart(active, count) {
  'worklet';
  const n = count + 1;
  if (n <= MAX_SLOTS) return 0;
  return Math.max(0, Math.min(n - MAX_SLOTS, active + 1 - (MAX_SLOTS - 1) / 2));
}

/** Ширина окна ряда: все позиции круглые, одна вытянутая. */
export function dotsWidth(count) {
  const n = Math.min(count + 1, MAX_SLOTS);
  return count > 0 ? (n - 1) * DOT_SLOT + DOT_ON : 0;
}

/** Ширина рамки ряда: окно и запас с обеих сторон. Не меньше суммы
 *  наибольших размеров позиций окна — ни одна точка краем не режется. */
export function dotsFrameWidth(count) {
  return count ? dotsWidth(count) + 2 * DOT_PAD : 0;
}

/** Кусочно-линейная по трём точкам, с обрезкой по краям. Своя, а не
 *  interpolate из reanimated: функция чистая и проверяется в Node, где
 *  reanimated подменён пустышками. */
function piecewise(v, x0, x1, x2, y0, y1, y2) {
  'worklet';
  if (v <= x0) return y0;
  if (v >= x2) return y2;
  if (v <= x1) return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
  return y1 + ((v - x1) / (x2 - x1)) * (y2 - y1);
}

/** Линейно от y0 к y1, пока v идёт от v0 к v1; за пределами — крайние. */
function ramp(v, v0, v1, y0, y1) {
  'worklet';
  const k = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
  return y0 + (y1 - y0) * k;
}

/** Где колода, в страницах: 0 — первая карточка, count − 1 — последняя.
 *  Дробное, пока колода едет; за краями (резинка) не выходит из колоды.
 *  x — сдвиг полосы, step — шаг карточки. */
export function dotsProgress(x, step, count) {
  'worklet';
  if (!step || count < 2) return 0;
  return Math.max(0, Math.min(count - 1, -x / step));
}

/** Насколько точка i «текущая» при положении p: 1 — колода стоит на ней,
 *  0 — на соседней и дальше. Между — доля пилюли, перетекающей к соседу. */
export function dotOn(i, p) {
  'worklet';
  return Math.max(0, 1 - Math.abs(p - i));
}

/** Ширина точки i при положении колоды p: от круглой (DOT) до пилюли (DOT_ON). */
export function dotWidth(i, p) {
  'worklet';
  return DOT + (DOT_ON - DOT) * dotOn(i, p);
}

/** Размер позиции q ряда («+» — 0, точка проекта i — i + 1) из n позиций у
 *  края окна, начало окна — start (дробное, пока окно едет): у края, за
 *  которым есть ещё позиции, она меньше (0.55); уходя за край — исчезает, а
 *  следующая за краем растёт из нуля. Крайняя позиция самого ряда («+» и
 *  последняя точка) в окне полная, но за его краем тоже растёт из нуля, а не
 *  появляется сразу полной и обрезанной. 1 — полный размер. */
function slotScale(q, start, n) {
  'worklet';
  if (n <= MAX_SLOTS) return 1;
  const rel = q - start;
  const lastRel = MAX_SLOTS - 1;
  // Слева: у первой позиции ряда за краем окна нет ничего — она в окне в
  // полный рост; у остальных у края шаг в 0.55.
  const left = q > 0 ? piecewise(rel, -1, 0, 1, 0, 0.55, 1) : piecewise(rel, -1, 0, 1, 0, 1, 1);
  const right = q < n - 1 ? piecewise(rel, lastRel - 1, lastRel, MAX_SLOTS, 1, 0.55, 0) : piecewise(rel, lastRel - 1, lastRel, MAX_SLOTS, 1, 1, 0);
  return Math.min(left, right);
}

/** Размер точки проекта i при начале окна start (то же, что dotsStart). */
export function dotScale(i, start, count) {
  'worklet';
  return slotScale(i + 1, start, count + 1);
}

/** Насколько вытянута плашка у края, 0…1: offset — на сколько колода
 *  оттянута за край (в пикселях), 1 — порог срабатывания. */
export function pullAmount(offset) {
  'worklet';
  return ramp(offset, 0, PULL_TRIGGER, 0, 1);
}

/** Где карточка i относительно центра колоды при сдвиге полосы x: −1…1 в
 *  страницах, 0 — карточка в центре, ±1 — соседняя и дальше. Знак:
 *  положительный — карточка левее центра. Положение колоды не выходит за
 *  колоду (dotsProgress), поэтому у резинки крайняя карточка остаётся «в
 *  центре», а не уезжает в соседки. */
export function deckAway(i, x, step, count) {
  'worklet';
  return Math.max(-1, Math.min(1, dotsProgress(x, step, count) - i));
}

/** Насколько оттянута за край колоды карточка i, −1…1 (знак — как у deckAway):
 *  первую тянут вправо (x > 0) — она уходит вправо от «+», −1 на пороге;
 *  последнюю влево — уходит влево от плашки с фразой, 1 на пороге. Идёт с
 *  оттяжкой, как сама плашка у края (pullAmount). Остальные карточки не
 *  тянут: 0. У единственной — в ту сторону, в какую тянут. */
export function deckPull(i, x, step, count) {
  'worklet';
  const left = i === 0 ? pullAmount(x) : 0;
  const right = i === count - 1 ? pullAmount(-x - (count - 1) * step) : 0;
  return right - left;
}

/** Где карточка i относительно центра с учётом оттяжки за край, −1…1. У
 *  карусели (deckAway) и у оттяжки (deckPull) одна шкала: потянутая крайняя
 *  карточка уходит от центра так же, как соседка, а в центр выезжает плашка.
 *  Вместе они не бывают ненулевыми: положение колоды за краем не выходит
 *  (dotsProgress), и у крайней deckAway там нулевой. still — «уменьшение
 *  движения»: оттяжка не меняет ни масштаб, ни сдвиг, остаётся плавная
 *  функция положения. */
function deckLean(i, x, step, count, still) {
  'worklet';
  const a = deckAway(i, x, step, count);
  return still ? a : Math.max(-1, Math.min(1, a + deckPull(i, x, step, count)));
}

/** Масштаб карточки i: SIDE_SCALE у соседних и дальше, 1 в центре, между —
 *  линейно по положению колоды. Крайнюю карточку оттяжка за край уменьшает
 *  до SIDE_SCALE (deckLean), а не увеличивает. Один на обе оси. */
export function deckScale(i, x, step, count, still) {
  'worklet';
  return 1 - (1 - SIDE_SCALE) * Math.abs(deckLean(i, x, step, count, still));
}

/** Сдвиг карточки i по горизонтали: масштаб идёт от центра карточки, и
 *  без поправки соседка отъезжала бы от центральной, а зазор между ними
 *  рос. Сдвиг к центру на ту долю, что съела уменьшенная ширина, оставляет
 *  ближний край на месте — край следующей карточки виден как прежде. У
 *  оттянутой крайней — к плашке, которая выезжает в центр. */
export function deckShift(i, x, step, count, cardW, still) {
  'worklet';
  const a = deckLean(i, x, step, count, still);
  return Math.sign(a) * (1 - SIDE_SCALE) * Math.abs(a) * cardW / 2;
}

/** Масштаб плашки у края колоды («+» слева, фраза справа) по ширине при
 *  оттяжке pull (0…1, pullAmount): уменьшенная соседка, SIDE_SCALE, растёт
 *  с оттяжкой до 1 + EDGE_GROW на пороге — по ширине чуть больше центральной
 *  карточки (по высоте — только до неё, edgeScaleY).
 *  still — «уменьшение движения»: масштаба нет. */
export function edgeScale(pull, still) {
  'worklet';
  return still ? 1 : SIDE_SCALE + (1 + EDGE_GROW - SIDE_SCALE) * pull;
}

/** То же по высоте, но не выше 1: плашка стоит в той же коробке, что
 *  центральная карточка, и выше неё не бывает — ни верх не уходит под шапку,
 *  ни низ на точки. */
export function edgeScaleY(pull, still) {
  'worklet';
  return still ? 1 : SIDE_SCALE + (1 - SIDE_SCALE) * Math.min(1, pull);
}

/** Сдвиг плашки у края: масштаб идёт от её центра, а плашка уходит далеко за
 *  край экрана, поэтому без поправки её видимый край уезжал бы на половину
 *  съеденной ширины. Поправка оставляет на месте край, обращённый к
 *  карточкам: dir = 1 — плашка слева («+»), −1 — справа (фраза). */
export function edgeShift(pull, still, dir) {
  'worklet';
  return dir * (1 - edgeScale(pull, still)) * ((PLUS_W + PLUS_TAIL) / 2);
}

/** Затемнение карточки i: 0 в центре, SIDE_DIM у соседних и дальше. */
export function deckDim(i, x, step, count) {
  'worklet';
  return SIDE_DIM * Math.abs(deckAway(i, x, step, count));
}

/** Размер «+» в ряду при начале окна start (то же, что у dotScale): «+» —
 *  самая левая позиция ряда, на шаг левее первой точки, и из окна он уходит
 *  как крайняя позиция, уменьшаясь до нуля за шаг окна. Пока окно у левого
 *  края (start = 0) он в полный рост; ряд не длиннее окна (проектов не
 *  больше четырёх) — окно не ездит, и «+» всегда на месте. */
export function plusScale(start, count) {
  'worklet';
  return slotScale(0, start, count + 1);
}

/** Сдвиг ряда («+» в его начале и точки за ним) при положении колоды p: окно
 *  едет вместе с ней, а запас рамки (DOT_PAD) оставляет место уходящей и
 *  въезжающей позициям. */
export function dotsStripShift(p, count) {
  'worklet';
  return DOT_PAD - dotsStart(p, count) * DOT_SLOT;
}

/** Раскладка ряда пагинации, в pt от левого края его рамки. В ряду «+» и
 *  точки; рамка шире окна на слот с каждой стороны (DOT_PAD) и ещё на reach —
 *  поле под зону нажатия «+», шире самого значка: то, что за рамкой, не
 *  нажимается. Окно у левого края (start = 0): «+» стоит первым в окне, а
 *  первая точка — ровно на шаг правее него. */
export function dotsLayout(count) {
  const reach = (PLUS_HIT - DOT) / 2;
  const plus = dotsStripShift(0, count);
  return {
    reach,
    frameWidth: dotsFrameWidth(count) + 2 * reach,
    plusLeft: reach + plus,
    firstDot: reach + plus + DOT_SLOT,
  };
}

/** Следующая фраза плашки: случайная из n, но не та же, что prev
 *  (-1 — прошлой не было). rnd — источник случайности, 0…1. */
export function nextPhrase(prev, n, rnd = Math.random) {
  if (n < 2) return 0;
  if (prev < 0 || prev >= n) return Math.min(n - 1, Math.floor(rnd() * n));
  const i = Math.min(n - 2, Math.floor(rnd() * (n - 1)));
  return i >= prev ? i + 1 : i;
}

export default function ProjectsScreen({ navigation }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const cardW = width - screenPadding - PEEK;
  const step = cardW + GAP;
  // На iOS панель вкладок нативная и лежит поверх экрана (на iOS 26 ещё и
  // плавает): без отступа низ карточки и точки уходили под неё. На Android
  // панель занимает место в раскладке сама.
  // На iOS панель вкладок плавает поверх экрана — снизу запас под неё. Только
  // под неё: плашка идущей задачи лежит поверх колоды и не сжимает её.
  const bottomPad = Platform.OS === 'ios' ? tabBarClearance : 0;
  const styles = useMemo(() => makeStyles(colors, cardW), [colors, cardW]);
  const projects = useAppStore((s) => s.projects);
  const activeTimer = useAppStore((s) => s.activeTimer);
  const openProject = useAppStore((s) => s.openProject);
  const lang = useAppStore((s) => s.settings.lang);
  // Часы идущей задачи тикают в её карточке (ProjectCard), а не всем экраном:
  // раньше колода целиком перерисовывалась раз в секунду.
  const still = useReduceMotion();

  const [pinTop, setPinTop] = useState(() => (activeTimer ? activeTimer.taskId : null));
  // Порядок задач в карточках: запуск его не трогает, остановка — плавный
  // переезд, уход с экрана — пересчёт без движения. Layout у колоды задан
  // всегда: после галочки соседи подъезжают и без таймера.
  const hold = useOrderHold(navigation, { always: true });

  // Порядок карточек — по свежести, и какая на экране (шапка файла, deckNext):
  // одно состояние, следующее — в этой же отрисовке, без ref и без эффекта
  // вдогонку. Задачи экран читает, только пока порядок идёт за свежими
  // данными (вне фокуса, дочитывая): в фокусе он держится, и галочка в
  // карточке колоду целиком не перерисовывает — порядок меняют лишь новый и
  // удалённый проект, места для них считаются по задачам из стора разово.
  const [deckState, setDeck] = useState(() => deckStart(deckFreshIds(projects, useAppStore.getState().tasks), hold.focused));
  const follow = !hold.focused || deckState.loading;
  const tasks = useAppStore((s) => (follow ? s.tasks : null));
  const freshIds = useMemo(() => (tasks ? deckFreshIds(projects, tasks) : null), [projects, tasks]);
  const have = useMemo(() => projects.map((project) => project.id), [projects]);
  const deckNow = deckNext(deckState, {
    have,
    fresh: () => freshIds || deckFreshIds(projects, useAppStore.getState().tasks),
    focused: hold.focused,
  });
  // Новое состояние — сразу: React перерисует экран до того, как что-то
  // попадёт на экран (данные из прошлых отрисовок, а не эффект).
  if (deckNow !== deckState) setDeck(deckNow);
  const { page, win } = deckNow;
  const ordered = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    return deckNow.ids.map((id) => byId.get(id)).filter(Boolean);
  }, [projects, deckNow.ids]);
  const count = ordered.length;
  // Вход на экран (и возврат с задачи или другой вкладки) — идущая первой.
  // Пока экран не в фокусе, закрепление следует за идущей, и на возврате
  // порядок уже готов: переставлять на глазах нечего.
  useEffect(() => {
    if (!navigation.addListener) return undefined;
    return navigation.addListener('focus', () => {
      const timer = useAppStore.getState().activeTimer;
      setPinTop(timer ? timer.taskId : null);
    });
  }, [navigation]);
  useEffect(() => { if (!hold.focused) setPinTop(activeTimer ? activeTimer.taskId : null); }, [hold.focused, activeTimer ? activeTimer.taskId : null]);
  // Пока экран открыт: остановили — задача уезжает на своё место.
  useEffect(() => { setPinTop((p) => nextPinTop(p, activeTimer)); }, [activeTimer ? activeTimer.taskId : null]);

  const x = useSharedValue(0);
  const startX = useSharedValue(0);
  const startPage = useSharedValue(0);
  const pageSV = useSharedValue(0);
  const armedL = useSharedValue(0);
  const armedR = useSharedValue(0);
  // Взрыв искр на правом краю: 1 с отпускания за порогом и до начала
  // следующей оттяжки; 2 — то же, но отпустили в пасхалке: искры разлетаются
  // жёлтыми (DeckSparks). Пока палец на экране, искры ждут на местах — даже за
  // порогом. В отличие от armedR с самим отпусканием не сбрасывается: искры
  // разлетелись раз и до новой оттяжки не появляются, как бы ни шла пружина.
  const firedR = useSharedValue(0);
  // Пасхалка: 1, пока оттяжка справа дальше EGG_TRIGGER. Идёт за пальцем (вернулся
  // под порог — 0) и снимается отпусканием: плашка уходит обычной серой, с
  // обычной фразой, а следующая оттяжка начинается с неё же. Цвет искр взрыва
  // переживает отпускание отдельно — в firedR = 2.
  const eggR = useSharedValue(0);
  // Тянут ли сейчас за последнюю карточку: с началом каждой оттяжки — новая фраза.
  const pullingR = useSharedValue(0);
  const phraseNext = useRef(null);
  const nextDeckPhrase = useCallback(() => { if (phraseNext.current) phraseNext.current(); }, []);
  // Плашка меняет фразу на шутку пасхалки (и обратно): с JS-потока, где живёт
  // выбор фразы.
  const eggPhrase = useRef(null);
  const showEgg = useCallback((on) => { if (eggPhrase.current) eggPhrase.current(on); }, []);

  // На какой странице стоит полоса (x) — по тому, что двигал JS: жест ставит
  // её сам (onEnd), точки — goTo, перестановка — эффект ниже.
  const stripPage = useRef(0);
  // Пружина доехала до страницы p — окно настоящих карточек сдвигается к ней
  // (deckDrawn): дальняя монтируется, ушедшая из окна размонтируется, когда
  // колода уже стоит. Раньше это делала сама смена страницы, в миг отпускания:
  // новая соседка (список задач, теги, поле ввода) монтировалась, пока
  // пружина ехала, и колода спотыкалась под конец хода (жалоба 20 октября).
  // Прерванная пружина (новый жест, точка, перестановка) окна не двигает.
  const settle = useCallback((p) => setDeck((d) => deckSettle(d, p)), []);
  const goTo = useCallback((p) => {
    pageSV.value = p;
    stripPage.current = p;
    setDeck((d) => deckChoose(d, p));
    x.value = withSpring(-p * step, SNAP, (finished) => {
      'worklet';
      if (finished) runOnJS(settle)(p);
    });
  }, [step, settle]);
  // Страница, на которой отпустили колоду.
  const showPage = useCallback((p) => {
    stripPage.current = p;
    setDeck((d) => deckChoose(d, p));
  }, []);
  // Порядок поменялся, а карточка на экране та же (или удалили ту, на которой
  // стояли) — полоса встаёт на её новый номер сразу, без движения, в той же
  // фиксации, что и новый порядок (layout-эффект, до кадра). Окно карточек
  // встало вокруг неё ещё в deckNext (win = page): колода не едет, ждать нечего.
  useLayoutEffect(() => {
    if (stripPage.current === page) return;
    stripPage.current = page;
    pageSV.value = page;
    x.value = -page * step;
  }, [page, step]);
  // Колоду тронули, пока она дочитывала данные: дальше порядок держится.
  const touchDeck = useCallback(() => setDeck((d) => deckTouched(d)), []);
  // Поменялась ширина (поворот) — встать ровно на свою страницу. Колода стоит:
  // окно карточек — вокруг неё.
  useEffect(() => {
    x.value = -pageSV.value * step;
    setDeck((d) => deckSettle(d, d.page));
  }, [step]);

  // Стабильные колбэки: карточки под memo, новое замыкание на каждую
  // отрисовку перерисовывало бы их все со сменой страницы.
  const openProjectScreen = useCallback((id) => { openProject(id); navigation.navigate('Project', { projectId: id }); }, [openProject, navigation]);
  // Задача — поверх колоды, «назад» сюда же (navigation/openTask.js).
  const openTask = useCallback((taskId) => pushTask(navigation, taskId), [navigation]);

  // Без защёлки «лист уже открыт»: лист закрывают и мимо onCancel (тап по
  // подложке, свайп вниз), и защёлка оставалась взведённой — после первой
  // отмены рывок больше ничего не открывал.
  const openNewProject = useCallback(() => {
    openSheet(
      <NewProjectSheet
        onCancel={closeSheet}
        onCreated={(project) => {
          // Заведённый из колоды — на экране: он уже в сторе, место ему —
          // по тому же правилу, что любому новому (слева).
          setDeck((d) => {
            const s = useAppStore.getState();
            return deckNext({ ...d, viewed: project.id, loading: false }, {
              have: s.projects.map((p) => p.id), fresh: () => deckFreshIds(s.projects, s.tasks), focused: d.focused,
            });
          });
          closeSheet();
          openProjectScreen(project.id);
        }}
      />,
    );
  }, []);
  const buzz = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }, []);
  // Пасхалка щёлкает сильнее и по-другому, чем порог: тяжёлый удар.
  const thump = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); }, []);

  // Жест — один объект, пока не поменялись число карточек и шаг: новый на
  // каждую отрисовку заново передавал бы обработчики на UI-поток, и как раз в
  // отрисовке отпускания, пока едет пружина.
  const pan = useMemo(() => Gesture.Pan()
    .withTestId('deck-pan')
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onStart(() => {
      startX.value = x.value;
      startPage.value = pageSV.value;
      firedR.value = 0;
      // Новая оттяжка — серая плашка с обычной фразой. Пасхалка снята ещё
      // отпусканием; здесь на случай, когда жест оборвался без него.
      if (eggR.value) { eggR.value = 0; runOnJS(showEgg)(false); }
    })
    .onUpdate((e) => {
      const minX = -Math.max(0, count - 1) * step;
      let nx = startX.value + e.translationX;
      if (nx > 0) nx = rubberBand(nx * 0.8, PULL_TRIGGER * 1.25);
      else if (nx < minX) nx = minX - rubberBand((minX - nx) * 0.8, PULL_TRIGGER * 1.25);
      x.value = nx;
      const l = nx >= PULL_TRIGGER ? 1 : 0;
      // Правый край ничего не делает — только щёлкает за порогом: на плашке
      // фраза, а не действие.
      const r = minX - nx >= PULL_TRIGGER ? 1 : 0;
      // Пасхалка — оттяжка ещё дальше. Вошли — шутка на плашке и тяжёлый удар
      // (щелчок порога в тот же кадр не нужен: рывок через оба порога сразу —
      // один удар); вышли, не отпуская, — обычная плашка, без хаптики.
      const deep = minX - nx >= EGG_TRIGGER ? 1 : 0;
      // Начали тянуть за последнюю — на плашке новая фраза; пока плашка ещё
      // не проявилась, подмена не видна.
      const over = minX - nx > 0 ? 1 : 0;
      if (over !== pullingR.value) { pullingR.value = over; if (over) runOnJS(nextDeckPhrase)(); }
      if (l !== armedL.value) { armedL.value = l; runOnJS(buzz)(); }
      if (r !== armedR.value) { armedR.value = r; if (!deep) runOnJS(buzz)(); }
      if (deep !== eggR.value) {
        eggR.value = deep;
        runOnJS(showEgg)(deep === 1);
        if (deep) runOnJS(thump)();
      }
    })
    .onEnd((e) => {
      const create = armedL.value === 1;
      const target = create ? 0 : deckTarget(x.value, e.velocityX, step, startPage.value, Math.max(1, count));
      // Отпустили за порогом справа — искры разлетаются (в пасхалке жёлтыми, 2);
      // не дотянули — оттяжка уходит к нулю, и они тают вместе с плашкой.
      if (armedR.value === 1) firedR.value = eggR.value === 1 ? 2 : 1;
      // Пасхалка с отпусканием снимается: плашка уходит серой, ничего не залипает.
      if (eggR.value) { eggR.value = 0; runOnJS(showEgg)(false); }
      armedL.value = 0;
      armedR.value = 0;
      pullingR.value = 0;
      pageSV.value = target;
      // Страница — сразу (на экране та карточка, к которой едет колода), а
      // окно настоящих карточек — только когда пружина доехала (settle):
      // монтаж не ложится на её ход. Страница — до пружины: подмена пружины
      // в тестах доезжает сразу, и остановка не должна обогнать выбор.
      runOnJS(showPage)(target);
      x.value = withSpring(-target * step, { ...SNAP, velocity: e.velocityX }, (finished) => {
        'worklet';
        if (finished) runOnJS(settle)(target);
      });
      if (create) runOnJS(openNewProject)();
    }), [count, step, x, startX, startPage, pageSV, armedL, armedR, firedR, eggR, pullingR, showEgg, nextDeckPhrase, buzz, thump, showPage, settle, openNewProject]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // Всё, что карточке нужно для вида каруселью, — одним объектом.
  const deck = useMemo(() => ({ x, step, count, cardW, still }), [x, step, count, cardW, still]);

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
      <TabHeader title={t(lang, 'nav.projects')} count={count || null}>
        <HeaderButton icon="search" label={t(lang, 'search.placeholder')} onPress={() => navigation.navigate('Search')} />
        <NotificationsButton navigation={navigation} />
      </TabHeader>

      {count === 0 ? (
        // Ни одного проекта — свой экран: колода-сценка, что даёт проект, и
        // кнопка того же листа, что «+» у колоды (components/ProjectsEmpty.js).
        <ProjectsEmpty lang={lang} onCreate={openNewProject} />
      ) : (
        <GestureDetector gesture={pan}>
          <View style={styles.deck} collapsable={false} onTouchStart={deckNow.loading ? touchDeck : undefined} testID="deck">
            <Animated.View style={[styles.strip, stripStyle]}>
              <PlusCard x={x} armed={armedL} styles={styles} lang={lang} />
              {/* Настоящие — окно вокруг страницы, на которой колода встала, и
                  видимые (deckDrawn); остальные — пустые оболочки того же вида. */}
              {ordered.map((project, i) => (deckDrawn(i, page, win) ? (
                <ProjectCard
                  key={project.id}
                  project={project}
                  pinTop={pinTop}
                  hold={hold}
                  styles={styles}
                  deck={deck}
                  index={i}
                  onOpen={openProjectScreen}
                  onOpenTask={openTask}
                />
              ) : <DeckSlot key={project.id} deck={deck} index={i} styles={styles} />))}
              <PhraseCard x={x} armed={armedR} fired={firedR} egg={eggR} count={count} step={step} width={width} styles={styles} lang={lang} nextRef={phraseNext} eggRef={eggPhrase} />
            </Animated.View>
          </View>
        </GestureDetector>
      )}

      {count > 0 ? <Dots x={x} step={step} count={count} armed={armedL} onGo={goTo} onNew={openNewProject} styles={styles} lang={lang} /> : null}
    </View>
  );
}

/** Карточка «+» у левого края колоды. Уходит далеко за край экрана; плюс и
 *  подпись стоят посередине видимой части и едут вместе с ней. Пока её не
 *  тянут — уменьшенная соседка (SIDE_SCALE), с оттяжкой растёт: по ширине до
 *  размера центральной карточки и чуть больше (edgeScale), по высоте — не выше
 *  неё (edgeScaleY); край, обращённый к карточкам, стоит на
 *  месте. За порогом карточка заливается акцентом, плюс и подпись темнеют. */
export const PlusCard = memo(function PlusCard({ x, armed, styles, lang }) {
  const colors = useColors();
  const still = useReduceMotion();
  const fill = useAnimatedStyle(() => ({ opacity: withTiming(armed.value, { duration: 120 }) }));
  const edge = useAnimatedStyle(() => {
    const pull = pullAmount(x.value);
    return {
      transform: [{ translateX: edgeShift(pull, still, 1) }, { scaleX: edgeScale(pull, still) }, { scaleY: edgeScaleY(pull, still) }],
    };
  });
  const body = useAnimatedStyle(() => {
    // Видимая ширина карточки на экране.
    const w = screenPadding - GAP + x.value;
    return {
      opacity: ramp(x.value, 0, PULL_TRIGGER * 0.5, 0, 1),
      transform: [{ translateX: Math.min(0, (PLUS_W - w) / 2) }],
    };
  });
  const icon = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(armed.value ? 1.15 : ramp(x.value, 0, PULL_TRIGGER, 0.7, 1), { damping: 11, stiffness: 300 }) },
      { rotate: `${ramp(x.value, 0, PULL_TRIGGER, -90, 0)}deg` },
    ],
  }));
  const label = t(lang, 'deck.new_project');
  return (
    <Animated.View style={[styles.plusCard, styles.plusLeft, edge]} accessibilityLabel={label}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.plusOn, fill]} />
      <Animated.View style={[styles.plusBody, { right: 0 }, body]}>
        <Animated.View style={icon}>
          <Icon name="plus" size={26} color={colors.text} />
          <Animated.View style={[styles.plusOver, fill]}><Icon name="plus" size={26} color={colors.accentText} /></Animated.View>
        </Animated.View>
        <View>
          <Text style={styles.plusText} numberOfLines={2}>{label}</Text>
          <Animated.View style={[styles.plusOver, fill]}>
            <Text style={[styles.plusText, { color: colors.accentText }]} numberOfLines={2}>{label}</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
});

/** Плашка у правого края колоды. Серая, без значка: тянешь последнюю
 *  карточку влево — она проявляется, и на ней короткая фраза: шутка или
 *  ободрение, на каждую оттяжку новая (не та же, что в прошлый раз). От
 *  фразы летят искры (DeckSparks) — по мере оттяжки, а не по таймеру. За
 *  порогом плашка светлеет на ступень (raise), фраза — на ступень ярче и
 *  щёлкает хаптика; искры ждут на местах, а разлетаются взрывом (раз за
 *  оттяжку: fired) с отпусканием за порогом. Отпустил — колода пружиной
 *  встаёт на последнюю карточку, не дойдя до порога искры гаснут вместе с
 *  плашкой: она никуда не ведёт, это просто привет у края колоды. Пока её не
 *  тянут — уменьшенная соседка (SIDE_SCALE), с оттяжкой растёт: по ширине до
 *  размера центральной карточки и чуть больше (edgeScale), по высоте — не выше
 *  неё (edgeScaleY); край, обращённый к карточкам, стоит на
 *  месте.
 *
 *  Пасхалка (egg — 1, пока оттяжка дальше EGG_TRIGGER; ставит жест колоды): поверх
 *  серой плашки плавно (EGG_FADE) проступает пурпурная (eggPlate), серая фраза
 *  гаснет, и проявляется шутка белым (textOnColor) — одна из DECK_EGG_PHRASES, новая на
 *  каждый заход и не той же подряд, — а приглушённые искры желтеют (DeckSparks).
 *  Фраза пасхалки выбирается на JS-потоке по eggRef(true); вернулся под порог
 *  или отпустил — eggRef(false), и плашка уходит обычной серой. «Уменьшение
 *  движения»: смена мгновенная, без перехода. */
export const PhraseCard = memo(function PhraseCard({ x, armed, fired, egg, count, step, width, styles, lang, nextRef, eggRef }) {
  const colors = useColors();
  const still = useReduceMotion();
  const [idx, setIdx] = useState(() => nextPhrase(-1, DECK_PHRASES.length));
  useEffect(() => {
    if (!nextRef) return undefined;
    nextRef.current = () => setIdx((i) => nextPhrase(i, DECK_PHRASES.length));
    return () => { nextRef.current = null; };
  }, [nextRef]);
  // Шутка пасхалки: с каждым заходом новая, не та же подряд. eggOn — показана ли
  // она сейчас (для подписи плашки; сам вид ведёт общее значение egg).
  const [eggIdx, setEggIdx] = useState(() => nextPhrase(-1, DECK_EGG_PHRASES.length));
  const [eggOn, setEggOn] = useState(false);
  useEffect(() => {
    if (!eggRef) return undefined;
    eggRef.current = (on) => {
      if (on) setEggIdx((i) => nextPhrase(i, DECK_EGG_PHRASES.length));
      setEggOn(!!on);
    };
    return () => { eggRef.current = null; };
  }, [eggRef]);
  // Пасхалка не передана (плашку рисуют без жеста) — своя, выключенная.
  const ownEgg = useSharedValue(0);
  const eggSV = egg || ownEgg;
  // Её плавный ход 0…1: переход идёт по времени, а не за пальцем.
  const eggK = useDerivedValue(() => (still ? eggSV.value : withTiming(eggSV.value, EGG_FADE)));
  const eggFill = useAnimatedStyle(() => ({ opacity: eggK.value }));
  // Фразы меняются не перекрёстным затуханием, а по очереди: первая половина
  // хода гасит прежнюю, вторая проявляет новую — два текста друг на друге в
  // середине перехода (одна и та же середина плашки) читались бы кашей.
  const grayText = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - 2 * eggK.value) }));
  const eggText = useAnimatedStyle(() => ({
    opacity: Math.max(0, 2 * eggK.value - 1),
    transform: [{ translateY: still ? 0 : 5 * (1 - eggK.value) }],
  }));
  // Насколько оттянута за последнюю карточку влево.
  const pullOf = (v) => {
    'worklet';
    return -(count - 1) * step - v;
  };
  const fill = useAnimatedStyle(() => ({ opacity: withTiming(armed.value, { duration: 140 }) }));
  // Для искр: оттяжка в долях порога и видимая ширина плашки.
  const amount = useDerivedValue(() => pullAmount(pullOf(x.value)));
  const room = useDerivedValue(() => width - (screenPadding + count * step + x.value));
  const body = useAnimatedStyle(() => {
    // Видимая ширина плашки на экране: фраза стоит посередине видимого.
    const w = width - (screenPadding + count * step + x.value);
    const pull = pullOf(x.value);
    return {
      opacity: ramp(pull, PULL_TRIGGER * 0.15, PULL_TRIGGER * 0.8, 0, 1),
      transform: [{ translateX: Math.max(0, (w - PHRASE_W) / 2) }, { translateY: ramp(pull, 0, PULL_TRIGGER, 6, 0) }],
    };
  });
  const edge = useAnimatedStyle(() => {
    const pull = pullAmount(pullOf(x.value));
    return {
      transform: [{ translateX: edgeShift(pull, still, -1) }, { scaleX: edgeScale(pull, still) }, { scaleY: edgeScaleY(pull, still) }],
    };
  });
  const phrase = t(lang, DECK_PHRASES[idx]);
  const joke = t(lang, DECK_EGG_PHRASES[eggIdx]);
  return (
    <Animated.View style={[styles.plusCard, styles.plusRight, { left: screenPadding + count * step }, edge]} accessibilityLabel={eggOn ? joke : phrase} testID="deck-phrase">
      <Animated.View style={[StyleSheet.absoluteFill, styles.phraseOn, fill]} testID="deck-phrase-on" />
      <Animated.View style={[StyleSheet.absoluteFill, styles.phraseEgg, eggFill]} testID="deck-phrase-egg" />
      <DeckSparks amount={amount} room={room} fired={fired} egg={eggK} still={still} />
      <Animated.View style={[styles.phraseBody, body]}>
        <Animated.View style={grayText} testID="deck-phrase-gray">
          <View>
            <Text style={styles.phraseText} numberOfLines={4}>{phrase}</Text>
            <Animated.View style={[StyleSheet.absoluteFill, fill]}>
              <Text style={[styles.phraseText, { color: colors.text }]} numberOfLines={4}>{phrase}</Text>
            </Animated.View>
          </View>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.eggBody, eggText]} testID="deck-phrase-joke">
          <Text style={styles.eggText} numberOfLines={4}>{joke}</Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
});

/** Точки пагинации. Всё идёт от положения колоды x, а не от остановки на
 *  карточке: пока палец ведёт колоду, пилюля перетекает из точки в точку, а
 *  окно едет следом — одновременно с прокруткой. В окне пять позиций, считая
 *  «+»: пилюля в центре, рядом полные точки, у краёв, если за ними есть ещё,
 *  уменьшенные; уходящая за край — до нуля, следующая появляется из нуля.
 *  Рамка шире окна на слот с каждой стороны, поэтому ни одна точка краем не
 *  режется. Тап по точке — к проекту. Первым в ряду — «+»: тот же новый
 *  проект, что за левым краем колоды. Он такая же позиция ряда, как точка:
 *  слот на шаг левее первой, едет вместе с окном и из окна уходит как
 *  крайняя позиция (plusScale). */
export const Dots = memo(function Dots({ x, step, count, armed, onGo, onNew, styles, lang }) {
  const lay = dotsLayout(count);
  const row = useAnimatedStyle(() => ({
    transform: [{ translateX: dotsStripShift(dotsProgress(x.value, step, count), count) }],
  }));
  return (
    <View style={styles.dots}>
      <View style={[styles.dotsFrame, { width: lay.frameWidth }]} testID="deck-dots-frame">
        <Animated.View style={[styles.dotsRow, { paddingLeft: lay.reach }, row]} testID="deck-dots-row">
          <PlusDot x={x} step={step} count={count} armed={armed} reach={lay.reach} onPress={onNew} styles={styles} lang={lang} />
          {Array.from({ length: count }, (_, i) => (
            <Dot key={i} i={i} x={x} step={step} count={count} onGo={onGo} styles={styles} lang={lang} />
          ))}
        </Animated.View>
      </View>
    </View>
  );
});

/** «+» — первая позиция ряда точек. Размером с точку и цветом точки; в
 *  раскладке занимает ровно слот точки (зона нажатия шире — на reach с
 *  каждой стороны — и заезжает на поле ряда и на зазор). Когда тянут первую
 *  карточку вправо, не растёт, а светлеет — понемногу по мере оттяжки и
 *  целиком (accentInk) за порогом. Масштаб — на самой нажимаемой зоне: у
 *  уехавшего из окна «+» (нулевой) нет площади, и он не ловит нажатий. */
function PlusDot({ x, step, count, armed, reach, onPress, styles, lang }) {
  const colors = useColors();
  const slot = useAnimatedStyle(() => ({
    transform: [{ scale: plusScale(dotsStart(dotsProgress(x.value, step, count), count), count) }],
  }));
  const lit = useAnimatedStyle(() => ({
    opacity: armed.value ? withTiming(1, { duration: 120 }) : 0.45 * pullAmount(x.value),
  }));
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(lang, 'deck.new_project')}
      testID="deck-plus-dot"
      style={[styles.plusDot, { width: PLUS_HIT, height: DOTS_H, marginLeft: -reach, marginRight: -reach }, slot]}
    >
      <View style={styles.plusGlyph} testID="deck-plus-glyph">
        <Icon name="plus" size={PLUS_DOT} color={colors.borderStrong} />
        <Animated.View style={[styles.plusOver, lit]}><Icon name="plus" size={PLUS_DOT} color={colors.accentInk} /></Animated.View>
      </View>
    </AnimatedPressable>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function Dot({ i, x, step, count, onGo, styles, lang }) {
  const colors = useColors();
  const dot = useAnimatedStyle(() => {
    const p = dotsProgress(x.value, step, count);
    return {
      width: dotWidth(i, p),
      backgroundColor: interpolateColor(dotOn(i, p), [0, 1], [colors.borderStrong, colors.accent]),
      transform: [{ scale: dotScale(i, dotsStart(p, count), count) }],
    };
  });
  // Масштаб на самой нажимаемой точке: у скрытой (нулевой) нет площади, и
  // она не ловит нажатий.
  return (
    <AnimatedPressable
      onPress={() => onGo(i)}
      hitSlop={{ top: 10, bottom: 10, left: 3, right: 3 }}
      accessibilityRole="button"
      accessibilityLabel={`${t(lang, 'nav.projects')} ${i + 1}`}
      style={[styles.dotPill, dot]}
    />
  );
}

/** Строка задачи в карточке — активная, выполненная (серая, зачёркнутая,
 *  внизу списка) или отменённая (серый крестик, самый низ). Галочка меняет
 *  задачу сразу — шкала и счётчики не ждут, — а саму строку не переставляет:
 *  она стоит на месте, пока в галочку наливается акцент с «попом» и брызгами
 *  (LiquidCheck), потом уезжает вниз, к выполненным, соседи подъезжают (layout
 *  списка, у колоды он задан всегда; hold.markNow). Выполненную вернули или
 *  отменённую вернули в работу — акцент стекает (крестик стирается), строка
 *  уезжает наверх, к активным. */
function CardRow({ task, first, hold, onOpenTask }) {
  const onToggle = (_task, change, closed) => {
    Haptics.selectionAsync().catch(() => {});
    // Открывающая правка: layout колоды и так стоит всегда — строка сразу едет.
    if (closed) change();
    else hold.markNow(change, task);
  };
  return <TaskRow task={task} first={first} compact checked={hold.marked(task.id)} onToggleDone={onToggle} onPress={() => onOpenTask(task.id)} />;
}

/** Вид карточки i каруселью: масштаб со сдвигом — трансформация карточки,
 *  затемнение — прозрачность подложки поверх неё. Оба — функции положения
 *  колоды x на UI-потоке: пока палец ведёт колоду, карточка растёт и тает
 *  вместе с ним. Раскладка не трогается — только transform и opacity. */
function useDeckLook({ x, step, count, cardW, still }, i) {
  const look = useAnimatedStyle(() => ({
    transform: [
      { translateX: deckShift(i, x.value, step, count, cardW, still) },
      { scale: deckScale(i, x.value, step, count, still) },
    ],
  }));
  const dim = useAnimatedStyle(() => ({ opacity: deckDim(i, x.value, step, count) }));
  return { look, dim };
}

/** Подложка цвета фона поверх карточки: приглушает соседние. Нажатий не ловит. */
function DeckScrim({ dim, styles, index }) {
  return <Animated.View pointerEvents="none" style={[styles.scrim, dim]} testID={`deck-dim-${index}`} />;
}

/** Пустая оболочка карточки, пока та не нужна (вне окна, deckDrawn): вид у
 *  неё тот же, что у настоящей, — иначе при подмене карточка дёрнулась бы из
 *  полного размера в соседский. */
export const DeckSlot = memo(function DeckSlot({ deck, index, styles }) {
  const { look, dim } = useDeckLook(deck, index);
  return (
    <Animated.View style={[styles.slot, look]} testID={`deck-card-${index}`}>
      <DeckScrim dim={dim} styles={styles} index={index} />
    </Animated.View>
  );
});

/** Карточка проекта: шапка, теги, числа, задачи со своей прокруткой,
 *  поле новой задачи, переход на страницу проекта. deck/index — вид
 *  каруселью (useDeckLook). Под memo, пропсы стабильные (onOpen — по id
 *  проекта): смена страницы карточку не перерисовывает. Из стора — только
 *  задачи своего проекта и таймер, если идёт её задача: правка чужой задачи
 *  и запуск в другом проекте её тоже не трогают. */
const ProjectCard = memo(function ProjectCard({ project, pinTop, hold, styles, deck, index, onOpen, onOpenTask }) {
  const colors = useColors();
  const { look, dim } = useDeckLook(deck, index);
  // Задачи как они лежат в сторе — по ним шапка, шкала и срок: отметка
  // меняет их в тот же миг, а не после налива. useShallow — тот же массив,
  // пока задачи проекта те же.
  const own = useAppStore(useShallow((s) => tasksOf(s.tasks, project.id)));
  const statuses = useAppStore((s) => s.statuses);
  const allTags = useAppStore((s) => s.tags);
  const activeTimer = useAppStore((s) => (s.activeTimer && s.tasks.some((task) => task.id === s.activeTimer.taskId && task.projectId === project.id) ? s.activeTimer : null));
  // Часы и деньги идущей задачи тикают только в её карточке.
  useTicker(!!activeTimer);
  const settings = useAppStore((s) => s.settings);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const rates = useRates();
  // Сумма на карточке — деньги (Core.modeFlags): в «личном» её нет.
  const { money } = useModeFlags();
  const lang = settings.lang;
  const [draft, setDraft] = useState('');

  const done = own.filter((task) => task.done).length;
  // Список строк — по задачам, какими их показывать: пока налив отмеченной
  // играет, она стоит прежней и на своём месте (hold.view).
  const shownOwn = hold.view(own);
  // Порядок задач — по правилу ядра, но запуск таймера его не двигает:
  // заморозка и переезд после остановки — в hold (hooks/useOrderHold.js).
  // Выполненные — внизу, под активными, и в заморозку не входят: отмеченная
  // задача уезжает к ним сразу, даже пока идёт таймер. Отменённые — самый низ.
  const list = [
    ...hold.rows(`deck:${project.id}`, cardTasks(shownOwn, pinTop ? { taskId: pinTop } : null, statuses)),
    ...cardDoneTasks(shownOwn),
    ...cardCancelledTasks(shownOwn, statuses),
  ];
  const nextDue = own.filter((task) => !task.done && !isCancelled(task, statuses) && task.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  const due = nextDue ? dueState(nextDue) : null;
  // «Скоро» — accentInk, как в строках задач. Прежде здесь брался токен warn, а
  // такого в палитре нет: color: undefined перебивал цвет стиля, и срок
  // рисовался чёрным системным цветом — на тёмной карточке его не было видно.
  const dueColor = due === 'overdue' ? colors.danger : due === 'soon' ? colors.accentInk : colors.textDim;
  const tags = tagsOf(allTags, project.tagIds || []);
  const pct = own.length ? Math.round((done / own.length) * 100) : 0;

  /** Завести задачу и сразу открыть её страницу. */
  function submit() {
    const title = draft.trim();
    if (!title) return;
    const task = createTaskInStatus(project.id, defaultStatusId(statuses, project.id, false), null, title);
    setDraft('');
    onOpenTask(task.id);
  }

  return (
    <Animated.View style={[styles.card, look]} testID={`deck-card-${index}`}>
      <Tap style={styles.cardHead} onPress={() => onOpen(project.id)} accessibilityRole="button">
        <View style={[styles.dot, { backgroundColor: project.color || colors.accent }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
          <View style={styles.subRow}>
            <Icon name="check" size={12} color={colors.textFaint} />
            <Text style={styles.sub}>{`${done}/${own.length}`}</Text>
            {nextDue ? <Text style={[styles.sub, styles.subDue, { color: dueColor }]} numberOfLines={1}>{`· ${dueShort(nextDue, lang)}`}</Text> : null}
          </View>
        </View>
        {/* «Другая версия» у проекта (журнал правок, 17 октября 2026). */}
        <ConflictMark entity="project" id={project.id} size={13} />
        <Icon name="chevron-right" size={14} color={colors.textFaint} />
      </Tap>

      {tags.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled style={styles.tagsBar} contentContainerStyle={styles.tags}>
          <TagBadgeRow tags={tags} style={styles.tagsRow} />
        </ScrollView>
      ) : null}

      <View style={styles.kpis}>
        <Text style={styles.kpiTime}>{fmtDur(projectMs(own, project.id, activeTimer), lang)}</Text>
        {money ? <Text style={styles.kpiMoney} testID={`deck-money-${index}`}>{fmtMoney(projectMoney(own, project.id, rates, activeTimer), lang, currencyOf(project, settings))}</Text> : null}
      </View>
      {/* Шкала натекает к новому значению жидко (components/ProgressBar.js). */}
      <ProgressBar
        value={pct / 100}
        color={project.color || colors.accent}
        style={styles.bar}
        accessibilityLabel={`${t(lang, 'project.progress')} ${pct}%`}
        testID={`deck-progress-${index}`}
      />

      {/* Поле новой задачи — сразу под шкалой, а не внизу карточки: при
          открытой клавиатуре видно, что вводится. */}
      <View style={styles.qa}>
        <Icon name="plus" size={14} color={colors.textFaint} />
        <TextInput
          style={styles.qaInput}
          value={draft}
          onChangeText={setDraft}
          placeholder={t(lang, 'tasks.new_ph')}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel={t(lang, 'tasks.new_ph')}
        />
        <Tap scale={0.92} hitSlop={6} onPress={submit} style={[styles.qaGo, draft.trim() && styles.qaGoOn]} accessibilityRole="button" accessibilityLabel={t(lang, 'agenda.create_btn')}>
          <Text style={[styles.qaGoText, draft.trim() && styles.qaGoTextOn]}>{t(lang, 'agenda.create_btn')}</Text>
        </Tap>
      </View>

      <Animated.FlatList
        style={styles.rows}
        // Остановленная задача уезжает наверх спокойным ease out; остановленная
        // на время переезда — поверх соседей: без этого строки на пересечении
        // просвечивали друг сквозь друга.
        itemLayoutAnimation={hold.layout}
        CellRendererComponentStyle={({ item }) => ({ backgroundColor: colors.panel, zIndex: item.id === hold.rising ? 2 : 1 })}
        // Прокрутка от gesture-handler: договаривается с жестом колоды.
        renderScrollComponent={(props) => <GHScrollView {...props} />}
        data={list}
        keyExtractor={(task) => task.id}
        renderItem={({ item, index }) => <CardRow task={item} first={index === 0} hold={hold} onOpenTask={onOpenTask} />}
        // Задач нет — пустой экран посередине карточки, на ступень мельче
        // страничного (size="md"); кнопки нет: строка новой задачи прямо над
        // списком.
        contentContainerStyle={list.length ? null : styles.rowsEmpty}
        ListEmptyComponent={(
          <View style={styles.cardEmpty}>
            <EmptyState size="md" art="tasks" title={t(lang, 'deck.no_tasks')} text={t(lang, 'empty.tasks_text')} />
          </View>
        )}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={5}
      />

      <Tap style={styles.more} onPress={() => onOpen(project.id)} accessibilityRole="button">
        <Text style={styles.moreText} numberOfLines={1}>{t(lang, 'deck.open')}</Text>
        <Icon name="chevron-right" size={12} color={colors.textFaint} />
      </Tap>
      <DeckScrim dim={dim} styles={styles} index={index} />
    </Animated.View>
  );
});

const QA_H = 42;
const QA_BTN_H = 30;
// Отступ кнопки «Создать» справа — тот же, что сверху и снизу.
const QA_INSET = (QA_H - QA_BTN_H) / 2;

const makeStyles = (colors, cardW) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  deck: { flex: 1, paddingTop: 2 },
  strip: { flex: 1, flexDirection: 'row', paddingLeft: screenPadding },
  // Пустая оболочка карточки, пока та не нужна: колода проезжает мимо неё
  // быстро (возврат к первой), и пустое место вместо карточек бросалось бы в глаза.
  slot: { width: cardW, marginRight: GAP, backgroundColor: colors.panel, borderRadius: 18, overflow: 'hidden' },
  card: { width: cardW, marginRight: GAP, backgroundColor: colors.panel, borderRadius: 18, overflow: 'hidden' },
  // Подложка приглушения соседних карточек: цвет фона, прозрачность — от положения колоды.
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg },
  plusCard: { position: 'absolute', top: 0, bottom: 0, width: PLUS_W + PLUS_TAIL, backgroundColor: colors.panel2, overflow: 'hidden' },
  plusLeft: { left: screenPadding - GAP - PLUS_W - PLUS_TAIL, borderTopRightRadius: 18, borderBottomRightRadius: 18 },
  plusRight: { borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  plusOn: { backgroundColor: colors.accent },
  plusBody: { position: 'absolute', top: 0, bottom: 0, width: PLUS_W, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: 6 },
  plusOver: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  plusText: { color: colors.textDim, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  // Плашка с фразой: серая, за порогом — ступенью светлее.
  phraseOn: { backgroundColor: colors.raise },
  phraseBody: { position: 'absolute', top: 0, bottom: 0, left: 0, width: PHRASE_W, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  phraseText: { color: colors.textDim, fontSize: 12.5, lineHeight: 17, fontWeight: '600', textAlign: 'center' },
  // Пасхалка: пурпурная плашка поверх серой, на ней шутка белым, тем же блоком и
  // той же посередине видимого, что обычная фраза.
  phraseEgg: { backgroundColor: colors.eggPlate },
  eggBody: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  eggText: { color: colors.textOnColor, fontSize: 12.5, lineHeight: 17, fontWeight: '700', textAlign: 'center' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: spacing.md, paddingBottom: 6 },
  dot: { width: 11, height: 11, borderRadius: 4 },
  name: { color: colors.text, fontSize: 17, fontFamily: displayFamily.bold },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sub: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  subDue: { fontWeight: '600', flexShrink: 1 },
  tagsBar: { flexGrow: 0, flexShrink: 0, marginBottom: spacing.sm },
  tags: { paddingHorizontal: spacing.md },
  tagsRow: { flexWrap: 'nowrap' },
  kpis: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  kpiTime: { color: colors.text, fontSize: 19, fontFamily: displayFamily.bold, fontVariant: ['tabular-nums'] },
  kpiMoney: { color: colors.textDim, fontSize: fontSize.sm, fontFamily: displayFamily.bold },
  // Шкала — общий ProgressBar (толщина 4, дорожка panel2); здесь только поля.
  bar: { marginHorizontal: spacing.md, marginBottom: 6 },
  rows: { flex: 1 },
  rowsEmpty: { flexGrow: 1 },
  cardEmpty: { flex: 1, justifyContent: 'center', paddingBottom: spacing.lg },
  qa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 10, marginVertical: spacing.sm, height: QA_H, paddingLeft: 10, paddingRight: QA_INSET, borderRadius: radius.md, backgroundColor: colors.panel2 },
  qaInput: { flex: 1, color: colors.text, fontSize: 13.5, backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  qaGo: { height: QA_BTN_H, paddingHorizontal: 11, borderRadius: 8, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  qaGoOn: { backgroundColor: colors.accent },
  qaGoText: { color: colors.textDim, fontSize: 12.5, fontWeight: '700' },
  qaGoTextOn: { color: colors.accentText },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.md },
  moreText: { color: colors.textDim, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  dots: { height: DOTS_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  // Рамка точек шире окна (dotsLayout): края рамки режут только то, что ушло в ноль.
  dotsFrame: { height: DOTS_H, overflow: 'hidden', justifyContent: 'center' },
  // Ряд — по ширине всего содержимого, а не рамки: иначе точки за его правым
  // краем (окно уехало) оказались бы вне его границ и не принимали нажатий.
  dotsRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: DOT_GAP },
  plusDot: { alignItems: 'center', justifyContent: 'center' },
  plusGlyph: { width: PLUS_DOT, height: PLUS_DOT },
  dotPill: { height: DOT, borderRadius: DOT / 2 },
});

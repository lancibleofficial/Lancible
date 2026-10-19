// Порядок строк: запуск таймера списки не переставляет, остановка — плавный
// переезд.
//
// Просили: «включаешь задачу — она резко прыгает вверх списка». «Недавние»,
// проекты на «Сегодня» и задачи в карточках колоды ставят строки по свежести,
// а у идущей задачи она — «сейчас», то есть первая; в ленте «Задачи» идущая
// сразу уходит в «Сейчас». Строка выпрыгивала сама, в момент нажатия. То же
// правило, что на вебе (app.js: shownOrder, listRows, holdOrders), только
// вместо FLIP — анимация переезда Reanimated.
//
// - Запуск, пока экран в фокусе: хук запоминает, как списки стояли
//   (rows записывает каждый показанный порядок), и держит его, пока таймер
//   идёт (Core.holdOrder: ушедшие строки пропадают, новые встают по
//   обычному правилу). frozen — для списков, чей порядок задан разделами, а
//   не рядом id: пока он true, разделы считаются без таймера (лента «Задачи»,
//   остров последней задачи).
// - Остановка: заморозка снята, строки встают по обычному правилу, а у
//   списка есть layout (itemLayoutAnimation у Animated.FlatList, layout у
//   Animated.View) — переезд идёт сам, за MOVE_MS. Остановленная (rising)
//   на это время лежит поверх соседей. Тик раз в секунду переезд не
//   сбрасывает: раскладка в тике не меняется.
// - Уход с экрана (blur навигации — вкладка, переход на задачу): заморозка
//   снята, порядок считается заново и без движения. Reanimated берёт конфиг
//   переезда из предыдущей фиксации, а не из той, где строки уже переставлены,
//   поэтому с уходом сначала снимается layout (отрисовка 1), а порядок
//   меняется следующей отрисовкой (эффект): к возврату всё уже на местах, и
//   вернувшийся экран ничего не двигает.
// - layout задан, только пока он нужен: идёт таймер (чтобы к остановке конфиг
//   уже стоял — в той же фиксации, что и перестановка, он не успевает),
//   ещё MOVE_MS с остановки, а у колоды (always) — всегда, пока экран в
//   фокусе: там соседи подъезжают и после галочки. «Уменьшение движения» —
//   layout нет, строки встают сразу.
//
// - Правка, которая сама переставит строки (закрепление свайпом — строка
//   уезжает в «Закреплённые» и обратно): moveSoon(правка, id). Конфиг
//   переезда должен стоять в фиксации раньше перестановки, поэтому сначала
//   ставится layout (отрисовка), а правка идёт через ARM_MS; строка на время
//   переезда — поверх соседей (rising). Не в фокусе и при «уменьшении
//   движения» — правка сразу. Второе нажатие, пока правка той же строки
//   ждёт, ничего не делает.
//
// - Галочка «выполнено» (markNow): правка идёт сразу, в тот же миг, что
//   нажатие, — шкала, статус и счётчики меняются без задержки (раньше правка
//   ждала конца налива, ~0,3 с, и шкала запаздывала). Сама строка при этом
//   остаётся на старом месте: view(tasks) отдаёт задачу такой, какой она была
//   до правки, и экран считает группы и списки по ней, пока налив играет
//   (marked(id) — рисовать галочку отмеченной). Потом строка отпускается и
//   уезжает на новое место (или уходит из списка: «Сегодня») — layout к этому
//   моменту уже стоит, как у moveSoon. Не в фокусе и при «уменьшении движения»
//   — всё сразу. Нажатие на строку, которую держат, ничего не делает.
//
// Ответ хука — тот же объект, пока в нём ничего не поменялось (20 октября):
// колода отдаёт его карточкам под memo, и смена страницы не перерисовывает
// карточки, у которых ничего не поменялось. Всё, что меняет ответ, — в ключе:
// свои правки хук делает через redraw (счётчик), таймер, фокус и «уменьшение
// движения» приходят сами, layout зависит ещё и от времени.
//
// Хук ничего не знает про экраны: ему нужен только navigation (blur/focus;
// без него — вечно в фокусе, как в тестах без навигатора) и таймер из стора.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LinearTransition, Easing } from 'react-native-reanimated';
import { useAppStore } from '../store/useAppStore';
import { useReduceMotion } from './useReduceMotion';
import { LIQUID } from '../lib/liquid';
import Views from '../core/views.js';

/** Сколько едет строка на новое место, мс: спокойный ease out, без пружины. */
export const MOVE_MS = 220;
/** Переезд строки — itemLayoutAnimation списка и layout строки. */
export const MOVE = LinearTransition.duration(MOVE_MS).easing(Easing.out(Easing.cubic));
// Запас к переезду: layout снимается не в тот же кадр, когда строка встала.
const TAIL_MS = MOVE_MS + 250;
/** moveSoon: через сколько после постановки layout идёт сама правка — пара
 *  кадров, чтобы конфиг переезда успел попасть в фиксацию. */
export const ARM_MS = 50;
// moveSoon: запас к хвосту на то, что отрисовка перестановки сама приходит
// позже правки (на эмуляторе — до ~0,4 с). Лишнее время с layout безвредно.
const SLOW_MS = 400;
/** markNow: сколько строка остаётся на старом месте — пока играет налив галочки. */
export const MARK_MS = LIQUID.check.duration;

/**
 * @param navigation навигация экрана (addListener: blur, focus) или ничего
 * @param always      layout задан всегда, пока экран в фокусе (колода:
 *                    после галочки соседи подъезжают и без таймера)
 * @returns {{
 *   rows: (key: string, rows: object[], idOf?: (row: object) => string) => object[],
 *   frozen: boolean, layout: object|undefined, rising: string|null, focused: boolean,
 *   moveSoon: (change: () => void, id?: string) => void,
 *   markNow: (change: () => void, task: object, holdMs?: number) => void,
 *   view: (tasks: object[]) => object[], marked: (id: string) => boolean, holding: boolean,
 * }}
 *   rows — строки в показанном порядке (key — список на экране; rows — в
 *   обычном порядке); frozen — идёт заморозка; layout — что отдать
 *   itemLayoutAnimation / layout (undefined — без движения); rising — id
 *   только что остановленной задачи (на время переезда); focused — экран
 *   сейчас в фокусе; view — задачи, какими их показывать (отмеченные держатся
 *   прежними; без них — тот же массив); marked — держится ли строка сейчас;
 *   holding — держится ли хоть одна.
 */
export function useOrderHold(navigation, { always = false } = {}) {
  const still = useReduceMotion();
  const timerId = useAppStore((s) => (s.activeTimer ? s.activeTimer.taskId : null));
  const [focused, setFocused] = useState(() => !navigation || !navigation.isFocused || navigation.isFocused());
  const [away, setAway] = useState(0);
  const [drawn, redraw] = useState(0);
  const ref = useRef(null);
  if (!ref.current) ref.current = { timerId, shown: new Map(), held: null, frozen: false, rising: null, tail: 0, marks: new Map(), timers: new Set(), pending: new Set() };
  const st = ref.current;

  // Таймер переключился. Это решается здесь, в отрисовке, а не в эффекте:
  // первый же кадр после запуска обязан показать прежний порядок.
  if (st.timerId !== timerId) {
    const was = st.timerId;
    st.timerId = timerId;
    st.frozen = !!timerId && focused;
    st.held = st.frozen ? new Map(st.shown) : null;
    if (was && focused) { st.rising = was; st.tail = Date.now() + TAIL_MS; }
  }

  useEffect(() => {
    if (!navigation || !navigation.addListener) return undefined;
    const subs = [
      navigation.addListener('blur', () => { setFocused(false); setAway((n) => n + 1); }),
      navigation.addListener('focus', () => setFocused(true)),
    ];
    return () => subs.forEach((off) => { if (typeof off === 'function') off(); });
  }, [navigation]);

  // Ушли с экрана: layout уже снят (focused = false), теперь порядок — заново.
  useEffect(() => {
    if (!away) return;
    if (st.held || st.frozen || st.rising || st.marks.size) {
      st.held = null;
      st.frozen = false;
      st.rising = null;
      st.tail = 0;
      st.marks.clear();
      redraw((n) => n + 1);
    }
  }, [away]);

  // Экран закрыт — отложенные отпускания строк больше не нужны.
  useEffect(() => () => {
    st.timers.forEach(clearTimeout);
    st.timers.clear();
  }, []);

  // Переезд кончился — снять layout и «поверх соседей».
  const tail = st.tail;
  useEffect(() => {
    const left = tail - Date.now();
    if (left <= 0) return undefined;
    const id = setTimeout(() => { st.rising = null; redraw((n) => n + 1); }, left);
    return () => clearTimeout(id);
  }, [tail]);

  const armed = !still && focused && (always || timerId !== null || Date.now() < st.tail);

  function rows(key, list, idOf = (row) => row.id) {
    const ids = Views.holdOrder(st.held && st.held.get(key), list.map(idOf));
    st.shown.set(key, ids);
    const byId = new Map(list.map((row) => [idOf(row), row]));
    return ids.map((id) => byId.get(id));
  }

  function moveSoon(change, id = null) {
    if (still || !focused) {
      change();
      return;
    }
    // Правка этой строки уже ждёт своих ARM_MS — второе нажатие ничего не
    // делает, как и у markNow: иначе правка прошла бы дважды (закрепить и тут
    // же открепить).
    if (id != null && st.pending.has(id)) return;
    if (id != null) st.pending.add(id);
    st.tail = Math.max(st.tail, Date.now() + ARM_MS + TAIL_MS);
    if (id != null) st.rising = id;
    redraw((n) => n + 1);
    setTimeout(() => {
      if (id != null) st.pending.delete(id);
      // Хвост — от самой правки, а не от постановки: на медленном телефоне
      // перестановка приходит позже, и снятый посреди переезда layout
      // оставлял строки замершими на старых местах (эмулятор, 12 октября).
      // Запас SLOW_MS — на отрисовку самой перестановки, она тоже запаздывает.
      st.tail = Math.max(st.tail, Date.now() + TAIL_MS + SLOW_MS);
      change();
    }, ARM_MS);
  }

  /**
   * Отметка «выполнено»: правка — сразу, строка — на старом месте до конца
   * налива. task — строка такой, какой она сейчас на экране (до правки).
   */
  function markNow(change, task, holdMs = MARK_MS) {
    if (still || !focused || !task) {
      change();
      return;
    }
    // Строка уже держится (налив идёт) — второе нажатие ничего не делает.
    if (st.marks.has(task.id)) return;
    st.marks.set(task.id, task);
    // Layout переезда стоит с этой же отрисовки — к отпусканию он уже в фиксации.
    st.tail = Math.max(st.tail, Date.now() + holdMs + TAIL_MS + SLOW_MS);
    change();
    redraw((n) => n + 1);
    const timer = setTimeout(() => {
      st.timers.delete(timer);
      // Ушли с экрана — строки уже отпущены без движения.
      if (!st.marks.delete(task.id)) return;
      st.rising = task.id;
      st.tail = Math.max(st.tail, Date.now() + TAIL_MS + SLOW_MS);
      redraw((n) => n + 1);
    }, holdMs);
    st.timers.add(timer);
  }

  const view = (tasks) => (st.marks.size ? tasks.map((task) => st.marks.get(task.id) || task) : tasks);

  // Тот же объект, пока ответ тот же (шапка файла): функции читают st —
  // он один на весь век хука, — а из отрисовки берут только still и focused,
  // и оба в ключе.
  const layout = armed ? MOVE : undefined;
  const holding = st.marks.size > 0;
  return useMemo(() => ({
    rows, frozen: st.frozen, layout, rising: st.rising, focused, moveSoon,
    markNow, view, marked: (id) => st.marks.has(id), holding,
  }), [drawn, timerId, focused, still, layout, st.frozen, st.rising, holding]);
}

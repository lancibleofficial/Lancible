// Пролистывание вкладок — сторона и события.
//
// Android: вкладки свои, на JS, и пролистывает их сам навигатор —
// forSlide ниже, страницы едут во всю ширину, как при листании.
//
// iOS: вкладки нативные (UITabBarController), переключаются мгновенно, а
// шапка у каждой своя — анимировать смену и перелить стекло шапки система
// не даёт. Поэтому едет содержимое: MainTabs.ios.js сообщает, какая
// вкладка открылась, а TabPage и заголовок шапки (components/TabSlide.js)
// въезжают со стороны этой вкладки на панели.
//
// Система показывает вкладку раньше, чем JS узнаёт о переключении. Поэтому
// въезд не может начаться «с нуля»: прятать страницу до него — значит
// показать пустую (это и моргало). Вместо этого остальные вкладки заранее
// стоят сдвинутыми в ту сторону, откуда въедут, и при показе только
// доезжают на место.

/** Порядок вкладок на панели — по нему понятно, с какой стороны въезжать. */
export const TAB_ORDER = ['Projects', 'Tasks', 'Home', 'Stats', 'Menu'];

/** Сторона въезда: 1 — справа (вкладка правее прежней), -1 — слева,
 *  0 — без сдвига (первый показ или та же вкладка). */
export function slideSide(prev, next) {
  const a = TAB_ORDER.indexOf(prev);
  const b = TAB_ORDER.indexOf(next);
  if (a < 0 || b < 0 || a === b) return 0;
  return b > a ? 1 : -1;
}

/** Android: страницы едут во всю ширину экрана, как при листании. */
export function forSlide(width) {
  return ({ current }) => ({
    sceneStyle: {
      transform: [{
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-width, 0, width],
        }),
      }],
    },
  });
}

// Подписчики по вкладкам и последнее «въезжание»: экран вкладки, открытой
// впервые, монтируется уже после события и узнаёт сторону отсюда.
const subs = new Map();
const lastIn = new Map();
let current = null;
const FRESH_MS = 400;

function emit(name, event) {
  const set = subs.get(name);
  if (set) for (const fn of set) fn(event);
}

/** Вкладка открылась: ей — доехать на место с нужной стороны, остальным —
 *  встать сдвинутыми туда, откуда они въедут в следующий раз. */
export function tabFocused(name, now = Date.now()) {
  const side = slideSide(current, name);
  current = name;
  lastIn.set(name, { side, at: now });
  emit(name, { type: 'in', side });
  for (const other of TAB_ORDER) {
    if (other !== name) emit(other, { type: 'park', side: slideSide(name, other) });
  }
}

/** Сторона, если вкладка открылась только что, иначе 0. */
export function freshSide(name, now = Date.now()) {
  const e = lastIn.get(name);
  return e && now - e.at < FRESH_MS ? e.side : 0;
}

export function subscribeTab(name, fn) {
  if (!subs.has(name)) subs.set(name, new Set());
  subs.get(name).add(fn);
  return () => { subs.get(name).delete(fn); };
}

/** Для тестов: начать с чистого листа. */
export function resetTabSlide() {
  subs.clear();
  lastIn.clear();
  current = null;
}

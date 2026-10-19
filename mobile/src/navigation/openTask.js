// Открыть задачу — одно правило на всё приложение (17 октября 2026: «страницы
// телепортируют не пойми куда, стрелки назад возвращают не на предыдущую
// страницу»):
//
// - задача встаёт ПОВЕРХ текущего экрана, в стек той вкладки, где человек
//   сейчас, и «назад» возвращает ровно на этот экран;
// - стек не перестраивается: ни переходом на другую вкладку, ни заменой
//   экрана под ногами.
//
// Что ломалось (до 18 октября 2026 третьей вкладкой была «Сегодня», Home;
// теперь там «Чат-бот», и своей вкладки для задач нет ни у кого). Плашка
// идущего таймера (MainTabBar, MainTabs.ios) открывала
// задачу через navigate('Home', { screen: 'TaskDetail' }): из «Проектов» или
// «Задач» человек улетал во вкладку «Сегодня», «назад» уводил на её корень
// или на первую вкладку, а если «Сегодня» ещё не открывали, задача
// становилась КОРНЕМ её стека — вкладка «Сегодня» потом открывалась сразу
// задачей, с таббаром и чужой шапкой. А navigate('TaskDetail') со страницы
// задачи (копия после «Дублировать») по правилам React Navigation 7 не
// кладёт новый экран, а подменяет параметры текущего: «назад» из копии
// проскакивал оригинал.
import { StackActions } from '@react-navigation/native';

export const TASK_ROUTE = 'TaskDetail';

const isTask = (route, taskId) => !!route && route.name === TASK_ROUTE && !!route.params && route.params.taskId === taskId;

/** С экрана внутри стека вкладки: задача поверх него (push, а не navigate).
 *  Та же задача уже сверху (двойное касание) — второй раз не кладётся. */
export function pushTask(navigation, taskId) {
  const st = typeof navigation.getState === 'function' ? navigation.getState() : null;
  if (st && st.routes && isTask(st.routes[st.index], taskId)) return;
  if (typeof navigation.push === 'function') navigation.push(TASK_ROUTE, { taskId });
  else navigation.navigate(TASK_ROUTE, { taskId });
}

/** Снаружи стеков — с таббара (плашка таймера) или по касанию уведомления:
 *  задача поверх стека открытой сейчас вкладки, вкладка не меняется.
 *  nav — навигация навигатора вкладок или ref контейнера (getRootState). */
export function openTaskOnTop(nav, taskId) {
  const tabs = typeof nav.getRootState === 'function' ? nav.getRootState() : nav.getState();
  if (!tabs || !tabs.routes) return;
  const tab = tabs.routes[tabs.index];
  if (!tab) return;
  const stack = tab.state;
  if (stack && stack.key && stack.routes) {
    if (isTask(stack.routes[stack.index], taskId)) return;
    nav.dispatch({ ...StackActions.push(TASK_ROUTE, { taskId }), target: stack.key });
    return;
  }
  // Стек вкладки ещё не построен: задача встаёт над его корнем, а не вместо
  // него (initial: false).
  nav.navigate(tab.name, { screen: TASK_ROUTE, params: { taskId }, initial: false });
}

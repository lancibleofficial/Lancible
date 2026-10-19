import { useEffect, useRef } from 'react';
import MainTabs from './MainTabs';
import { AppSkeleton, SwitchingScreen, ScopeErrorScreen } from '../components/Skeleton';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { navigationRef } from './navRef';
import { useNotificationOpen } from './useNotificationOpen';

// Вход опционален — офлайн-первое приложение всегда показывает основной UI
// (см. план: "Необязательно — приложение и так работает офлайн"). Экраны
// входа/онбординга живут внутри таба "Профиль", а не за гейтом здесь.
// Единственное, что решается на этом уровне — подождать, пока разрешится
// начальная сессия Supabase и восстановится локальный стор из AsyncStorage,
// чтобы не мигало пустым состоянием на старте.
//
// Смена аккаунта (17 октября 2026): пока открывается другая область данных,
// вместо вкладок — «Переключаю…». Вкладки уходят целиком: экраны прежней
// области (проект, задача, редактор) смотрели бы на чужие id. Открылась —
// человек возвращается туда, откуда переключал (раздел «Аккаунт», «Меню»,
// «Чат-бот»: «Войти» на экране чата — главный призыв войти, и после входа
// человек остаётся в чате, а не попадает в «Проекты»).
//
// Область не прочиталась (useAppStore: scopeError, 19 октября 2026) — вместо
// вкладок ошибка с «Повторить»: данных этой области в памяти нет, а
// нечитаемая запись цела (запись закрыта).

/** Где человек сейчас: экран сверху и вкладка, в чьём стеке он лежит
 *  (экран чата — деталь любого стека). null — навигации ещё нет. */
export function placeOf(nav) {
  if (!nav || !nav.isReady()) return null;
  const route = nav.getCurrentRoute();
  if (!route) return null;
  const root = nav.getRootState();
  const tab = root && Array.isArray(root.routes) ? root.routes[Number.isInteger(root.index) ? root.index : 0] : null;
  return { name: route.name, params: route.params, tab: tab ? tab.name : null };
}

/** Вернуть человека на место (placeOf) после смены области. Чат — только
 *  свой id: первое сообщение с поля главного (send), проявление на месте
 *  (quiet) и место поля (from) уже отыграли. */
export function returnToPlace(nav, place) {
  if (!place) return;
  const { name, params } = place;
  if (name === 'SettingsSection') nav.navigate('Menu', { screen: 'SettingsSection', params, initial: false });
  else if (name === 'MenuMain' || name === 'Feedback') nav.navigate('Menu', { screen: 'MenuMain' });
  else if (name === 'ChatMain') nav.navigate('Chat', { screen: 'ChatMain' });
  else if (name === 'ChatThread') {
    const chatId = params && params.chatId;
    if (chatId) nav.navigate(place.tab || 'Chat', { screen: 'ChatThread', params: { chatId }, initial: false });
    else nav.navigate('Chat', { screen: 'ChatMain' });
  }
}

export default function RootNavigator() {
  const authStatus = useAuthStore((s) => s.status);
  const switching = useAuthStore((s) => s.switching);
  const initAuth = useAuthStore((s) => s.init);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const scopeError = useAppStore((s) => s.scopeError);
  const returnTo = useRef(null);

  useEffect(() => { initAuth(); }, [initAuth]);

  // Откуда переключали — запоминается в тот же миг, когда встаёт
  // «Переключаю…», пока вкладки ещё на экране.
  useEffect(() => useAuthStore.subscribe((s, prev) => {
    if (s.switching && !prev.switching && navigationRef.isReady()) returnTo.current = placeOf(navigationRef);
  }), []);

  const ready = authStatus !== 'loading' && hasHydrated;
  // Касание напоминания — его задача поверх текущего экрана.
  useNotificationOpen(navigationRef, ready);

  useEffect(() => {
    if (switching || !hasHydrated || !returnTo.current) return undefined;
    const route = returnTo.current;
    let tries = 0;
    let timer = null;
    const go = () => {
      if (!navigationRef.isReady()) {
        if ((tries += 1) < 20) timer = setTimeout(go, 16);
        return;
      }
      returnTo.current = null;
      returnToPlace(navigationRef, route);
    };
    go();
    return () => clearTimeout(timer);
  }, [switching, hasHydrated]);

  // На старте (вход ещё разрешается) область открывается под заглушкой запуска,
  // «Переключаю…» — только когда переключает человек.
  if (switching && authStatus !== 'loading') return <SwitchingScreen />;
  if (scopeError && authStatus !== 'loading') {
    return (
      <ScopeErrorScreen
        scope={scopeError}
        onRetry={() => useAuthStore.getState().reopenScope()}
        onGuest={() => useAuthStore.getState().switchAccount(null)}
      />
    );
  }
  // Пока читается локальное хранилище и разрешается сессия, показываем не
  // спиннер по центру пустого экрана, а заглушку будущей главной: так видно,
  // что именно грузится, и переход к готовому экрану не выглядит рывком.
  if (!ready) return <AppSkeleton />;
  return <MainTabs />;
}

import { useEffect } from 'react';
import MainTabs from './MainTabs';
import { HomeSkeleton } from '../components/Skeleton';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';

// Вход опционален — офлайн-первое приложение всегда показывает основной UI
// (см. план: "Необязательно — приложение и так работает офлайн"). Экраны
// входа/онбординга живут внутри таба "Профиль", а не за гейтом здесь.
// Единственное, что решается на этом уровне — подождать, пока разрешится
// начальная сессия Supabase и восстановится локальный стор из AsyncStorage,
// чтобы не мигало пустым состоянием на старте.
export default function RootNavigator() {
  const authStatus = useAuthStore((s) => s.status);
  const initAuth = useAuthStore((s) => s.init);
  const hasHydrated = useAppStore((s) => s.hasHydrated);

  useEffect(() => { initAuth(); }, [initAuth]);

  // Пока читается локальное хранилище и разрешается сессия, показываем не
  // спиннер по центру пустого экрана, а заглушку будущей главной: так видно,
  // что именно грузится, и переход к готовому экрану не выглядит рывком.
  if (authStatus === 'loading' || !hasHydrated) return <HomeSkeleton />;
  return <MainTabs />;
}

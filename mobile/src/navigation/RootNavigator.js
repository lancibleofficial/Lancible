import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import MainTabs from './MainTabs';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { useColors } from '../theme';

// Вход опционален — офлайн-первое приложение всегда показывает основной UI
// (см. план: "Необязательно — приложение и так работает офлайн"). Экраны
// входа/онбординга живут внутри таба "Профиль", а не за гейтом здесь.
// Единственное, что решается на этом уровне — подождать, пока разрешится
// начальная сессия Supabase и восстановится локальный стор из AsyncStorage,
// чтобы не мигало пустым состоянием на старте.
export default function RootNavigator() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const authStatus = useAuthStore((s) => s.status);
  const initAuth = useAuthStore((s) => s.init);
  const hasHydrated = useAppStore((s) => s.hasHydrated);

  useEffect(() => { initAuth(); }, [initAuth]);

  if (authStatus === 'loading' || !hasHydrated) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  return <MainTabs />;
}

const makeStyles = (colors) => StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});

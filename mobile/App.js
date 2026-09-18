import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import RootNavigator from './src/navigation/RootNavigator';
import Toast from './src/components/Toast';
import BottomSheet from './src/components/BottomSheet';
import { useColors, useThemeMode } from './src/theme';
import { useAppStore } from './src/store/useAppStore';
import { prepareAndroidChannel, rescheduleAll } from './src/lib/notifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  // Keys equal each file's PostScript name. The .ttf files were rebuilt with
  // unique PostScript names and real weight classes -- originally all four
  // declared the same PostScript name ("Basique") and weight 400, so iOS
  // (which registers fonts by PostScript name) treated them as one font and
  // every weight rendered identically. The keys were also deliberately
  // changed from the previous "Basique Pro ..." aliases: expo-font skips
  // loadAsync for any alias the native side already reports as loaded, and
  // that list survives JS reloads in Expo Go -- so keeping the old names
  // would have kept serving the broken registration until the app process
  // was killed. See AppText.js.
  const [fontsLoaded] = useFonts({
    'BasiquePro-Light': require('./assets/fonts/BasiquePro-Light.ttf'),
    'BasiquePro-Regular': require('./assets/fonts/BasiquePro-Regular.ttf'),
    'BasiquePro-Bold': require('./assets/fonts/BasiquePro-Bold.ttf'),
    'BasiquePro-Black': require('./assets/fonts/BasiquePro-Black.ttf'),
  });
  const colors = useColors();
  const mode = useThemeMode();

  // Система хранит расписание уведомлений отдельно от нашего state, и
  // после синхронизации с другого устройства они расходятся — поэтому на
  // старте (когда данные уже подняты из хранилища) собираем его заново.
  const hydrated = useAppStore((s) => s.hasHydrated);
  useEffect(() => {
    if (!hydrated) return;
    const { tasks, settings } = useAppStore.getState();
    prepareAndroidChannel(settings.lang);
    rescheduleAll(tasks, settings.lang, settings.notifyEnabled !== false);
  }, [hydrated]);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // app.json задаёт нативный фон окна СТАТИЧЕСКИ (#2a2b2e, тёмная тема) — на
  // холодном старте это нормально, но при переходах между экранами на
  // светлой теме нативный Android-фон окна на кадр-два просвечивал ИЗ-ПОД
  // JS-отрисованного экрана этим тёмным цветом (не завязан на состояние
  // темы) — выглядело как чёрная вспышка. Синхронизируем нативный фон окна с
  // текущей темой при каждой смене.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  if (!fontsLoaded) return null;

  const base = mode === 'light' ? DefaultTheme : DarkTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: colors.bg, card: colors.panel, text: colors.text, border: colors.border, primary: colors.accent },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
        </NavigationContainer>
        <Toast />
        <BottomSheet />
        <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

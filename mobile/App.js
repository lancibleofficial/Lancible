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

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  // Keys match each file's full name (nameID 4). The .ttf files themselves
  // were rebuilt with unique PostScript names and real weight classes --
  // originally all four declared the same PostScript name ("Basique") and
  // weight 400, so iOS (which registers fonts by PostScript name) treated
  // them as one font and every weight rendered identically. See AppText.js.
  const [fontsLoaded] = useFonts({
    'Basique Pro Light': require('./assets/fonts/BasiquePro-Light.ttf'),
    'Basique Pro': require('./assets/fonts/BasiquePro-Regular.ttf'),
    'Basique Pro Bold': require('./assets/fonts/BasiquePro-Bold.ttf'),
    'Basique Pro Black': require('./assets/fonts/BasiquePro-Black.ttf'),
  });
  const colors = useColors();
  const mode = useThemeMode();

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

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from '../screens/SettingsScreen';
import { useAppStore } from '../store/useAppStore';
import AppHeader from '../components/AppHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

const Stack = createNativeStackNavigator();

/** Вкладка «Меню»: настройки; документы и редактор открываются внутри. */
export default function MenuStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <Stack.Navigator
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        animation: 'ios_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="MenuMain" component={SettingsScreen} options={{ headerShown: false }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

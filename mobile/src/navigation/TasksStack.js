import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TasksScreen from '../screens/TasksScreen';
import { useAppStore } from '../store/useAppStore';
import AppHeader from '../components/AppHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

const Stack = createNativeStackNavigator();

/** Вкладка «Задачи»: лента по срочности из всех проектов, внутри — те же
 *  экраны деталей, что у остальных вкладок. */
export default function TasksStack() {
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
      <Stack.Screen name="TasksMain" component={TasksScreen} options={{ headerShown: false }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

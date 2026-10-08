import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TasksScreen from '../screens/TasksScreen';
import { withTabPage } from '../components/TabSlide';
import { useAppStore } from '../store/useAppStore';
import { IOS_NATIVE_HEADER, stackHeaderOptions } from './nativeHeader';
import { useColors } from '../theme';
import { detailScreens } from './detailScreens';

// Корень вкладки въезжает при смене вкладок (iOS; на Android листает навигатор).
const TasksPage = withTabPage(TasksScreen, 'Tasks');

const Stack = createNativeStackNavigator();

/** Вкладка «Задачи»: лента по срочности из всех проектов, внутри — те же
 *  экраны деталей, что у остальных вкладок. */
export default function TasksStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <Stack.Navigator
      screenOptions={{
        ...stackHeaderOptions(colors),
        animation: 'ios_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="TasksMain" component={TasksPage} options={{ headerShown: IOS_NATIVE_HEADER }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

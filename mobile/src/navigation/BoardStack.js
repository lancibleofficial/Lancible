import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BoardScreen from '../screens/BoardScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import ProjectStatusesScreen from '../screens/ProjectStatusesScreen';
import AppHeader from '../components/AppHeader';
import { useAppStore } from '../store/useAppStore';
import { t } from '../lib/i18n';
import { useColors } from '../theme';

// Доска — не один экран, а маленький стек: с карточки открывается задача, из
// меню — набор статусов, и с обоих «назад» должно возвращать на доску в то
// же место, а не на «Главную».
//
// Задача переиспользуется та же, что в стеке «Главной» (TaskDetailScreen):
// редактор один, а какой стек его показал — дело навигации, не экрана.
//
// Таббар на вложенных экранах прячется не здесь: вложенный стек сам по себе
// на родительский таббар не влияет, это делает MainTabs через
// getFocusedRouteNameFromRoute — тем же способом, что и для HomeStack.
const Stack = createNativeStackNavigator();

export default function BoardStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  return (
    <Stack.Navigator
      screenOptions={{
        header: (props) => <AppHeader {...props} />,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Шапка доски — общая SearchHeader внутри экрана, как на Главной. */}
      <Stack.Screen name="BoardMain" component={BoardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: '' }} />
      <Stack.Screen
        name="ProjectStatuses"
        component={ProjectStatusesScreen}
        options={{ title: t(lang, 'board.project_statuses') }}
      />
    </Stack.Navigator>
  );
}

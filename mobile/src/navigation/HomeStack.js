import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import ProjectScreen from '../screens/ProjectScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import { useColors, fontSize } from '../theme';

const Stack = createNativeStackNavigator();

// Project и TaskDetail теперь живут ВНУТРИ таба Home (а не поверх всего
// Tab.Navigator, как раньше), чтобы при открытом проекте нижний таббар
// оставался виден — стек, вложенный ВНУТРЬ таба, по умолчанию не прячет
// родительский таббар (в отличие от стека, обёрнутого СНАРУЖИ табов, как
// было). Таббар на TaskDetail прячется отдельно, в MainTabs.js, через
// getFocusedRouteNameFromRoute — вложенный стек сам по себе не может на
// него повлиять.
export default function HomeStack() {
  const colors = useColors();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: 'BasiquePro-Regular', fontWeight: 'normal', fontSize: fontSize.lg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="Project" component={ProjectScreen} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}

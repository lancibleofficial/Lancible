import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatListScreen from '../screens/ChatListScreen';
import { withTabPage } from '../components/TabSlide';
import { ChatSkeleton } from '../components/Skeleton';
import { useAppStore } from '../store/useAppStore';
import { IOS_NATIVE_HEADER, stackHeaderOptions } from './nativeHeader';
import { useColors } from '../theme';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { detailScreens } from './detailScreens';

// Корень вкладки въезжает при смене вкладок (iOS; на Android листает навигатор).
const ChatPage = withTabPage(ChatListScreen, 'Chat', ChatSkeleton);

const Stack = createNativeStackNavigator();

// Вкладка «Чат-бот» (18 октября 2026, на месте «Сегодня» — та же третья
// позиция). Корень — главный экран (ChatMain: поле посередине, под ним
// прежние чаты), над ним — чат (ChatThread, экран деталей — с круга 21 он в
// detailScreens, как задача: поиск открывает его с любой вкладки). Касание
// строки кладёт чат в этот стек ходом ios_from_right (с «уменьшением
// движения» — fade на месте), «назад» возвращает к списку; отправка с поля
// главного экрана — без хода стека, проявлением на месте (chatThreadOptions:
// params.quiet). Остальные экраны деталей — те же, что у других вкладок:
// задача или проект, открытые ссылкой из карточки предложения, встают поверх
// чата, и «назад» возвращает в разговор. Плашка таймера и касание
// уведомления, пока открыт список, кладут задачу сюда же (navigation/openTask.js).
export default function ChatStack() {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  const reduced = useReduceMotion();
  return (
    <Stack.Navigator
      screenOptions={{
        ...stackHeaderOptions(colors),
        animation: reduced ? 'fade' : 'ios_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="ChatMain" component={ChatPage} options={{ headerShown: IOS_NATIVE_HEADER }} />
      {detailScreens(Stack, lang)}
    </Stack.Navigator>
  );
}

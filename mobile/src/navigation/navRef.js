// Ссылка на контейнер навигации — для переходов снаружи экранов: касание
// системного уведомления (navigation/useNotificationOpen.js).
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

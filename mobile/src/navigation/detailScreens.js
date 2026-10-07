// Экраны деталей — одни и те же в каждом стеке вкладок: проект, задача,
// документы, редактор, статусы проекта. С любой вкладки их открывают
// внутри неё, и «назад» возвращает туда, откуда пришли, а не на «Сегодня».
//
// Таббар на них прячется — в MainTabs по имени сфокусированного маршрута,
// списком DETAIL_ROUTES.
import ProjectScreen from '../screens/ProjectScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import EditorScreen from '../screens/EditorScreen';
import ProjectStatusesScreen from '../screens/ProjectStatusesScreen';
import { t } from '../lib/i18n';

export const DETAIL_ROUTES = ['Project', 'TaskDetail', 'ProjectStatuses', 'Editor', 'Documents'];

/** Экраны деталей для Stack.Navigator. Зовётся внутри навигатора, язык —
 *  для заголовков, которые не ставит сам экран. */
export function detailScreens(Stack, lang) {
  return [
    <Stack.Screen key="Project" name="Project" component={ProjectScreen} />,
    <Stack.Screen key="TaskDetail" name="TaskDetail" component={TaskDetailScreen} options={{ title: '' }} />,
    <Stack.Screen key="Documents" name="Documents" component={DocumentsScreen} options={{ title: t(lang, 'docs.title') }} />,
    <Stack.Screen key="Editor" name="Editor" component={EditorScreen} options={{ title: '' }} />,
    <Stack.Screen key="ProjectStatuses" name="ProjectStatuses" component={ProjectStatusesScreen} options={{ title: t(lang, 'board.project_statuses') }} />,
  ];
}

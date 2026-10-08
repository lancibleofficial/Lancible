// Экраны деталей — одни и те же в каждом стеке вкладок: проект, задача,
// документы, редактор, статусы проекта, уведомления, поиск, теги. С любой
// вкладки их открывают внутри неё, и «назад» возвращает туда, откуда
// пришли, а не на первую вкладку.
//
// Таббар на них прячется — в MainTabs по имени сфокусированного маршрута,
// списком DETAIL_ROUTES.
import ProjectScreen from '../screens/ProjectScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import EditorScreen from '../screens/EditorScreen';
import ProjectStatusesScreen from '../screens/ProjectStatusesScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import SearchScreen from '../screens/SearchScreen';
import TagsScreen from '../screens/TagsScreen';
import { t } from '../lib/i18n';
import { IOS_NATIVE_HEADER, leftTitleOptions } from './nativeHeader';

export const DETAIL_ROUTES = ['Project', 'TaskDetail', 'ProjectStatuses', 'Editor', 'Documents', 'Notifications', 'Search', 'Tags'];

/** Экраны деталей для Stack.Navigator. Зовётся внутри навигатора, язык —
 *  для заголовков, которые не ставит сам экран. */
export function detailScreens(Stack, lang) {
  return [
    <Stack.Screen key="Project" name="Project" component={ProjectScreen} />,
    <Stack.Screen key="TaskDetail" name="TaskDetail" component={TaskDetailScreen} options={{ headerShown: IOS_NATIVE_HEADER, title: '' }} />,
    <Stack.Screen key="Documents" name="Documents" component={DocumentsScreen} options={leftTitleOptions(t(lang, 'docs.title'))} />,
    <Stack.Screen key="Editor" name="Editor" component={EditorScreen} options={{ headerShown: IOS_NATIVE_HEADER, title: '' }} />,
    <Stack.Screen key="ProjectStatuses" name="ProjectStatuses" component={ProjectStatusesScreen} options={leftTitleOptions(t(lang, 'board.project_statuses'))} />,
    <Stack.Screen key="Notifications" name="Notifications" component={NotificationsScreen} options={leftTitleOptions(t(lang, 'notif.title'))} />,
    <Stack.Screen key="Search" name="Search" component={SearchScreen} options={{ headerShown: IOS_NATIVE_HEADER, title: '' }} />,
    <Stack.Screen key="Tags" name="Tags" component={TagsScreen} options={leftTitleOptions(t(lang, 'settings.section_tags'))} />,
  ];
}

import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { RootHeaderHost } from '../components/TabHeader';
import { DETAIL_ROUTES } from './detailScreens';

// layout навигатора вкладок: общая шапка корневых экранов над страницами.
// Она не пролистывается при смене вкладки и не гаснет — слой фона один и тот
// же, меняется только содержимое, сразу (components/TabHeader.js). На
// экранах деталей, открытых поверх вкладки, шапка спрятана: у них своя, в
// стеке (DetailHeader / AppHeader), а экран вкладки под ними рисует свою.
//
// Признак «на деталях» — тот же, что прячет таббар в MainTabs: имя
// сфокусированного маршрута вложенного стека.
export function rootHeaderLayout({ state, children }) {
  const route = state.routes[state.index];
  return (
    <RootHeaderHost tab={route.name} hidden={DETAIL_ROUTES.includes(getFocusedRouteNameFromRoute(route))}>
      {children}
    </RootHeaderHost>
  );
}

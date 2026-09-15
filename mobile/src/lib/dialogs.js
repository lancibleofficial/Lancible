import ActionSheetContent from '../components/ActionSheetContent';
import { openSheet } from '../store/useSheetStore';

/** Замена Alert.alert(...) на нижний лист — та же форма вызова (title,
 * message, actions), но с оформлением и шрифтом приложения: системный
 * Alert нельзя стилизовать вообще (ни тему, ни Basique Pro). */
export function confirmSheet({ title, message, actions }) {
  openSheet(<ActionSheetContent title={title} message={message} actions={actions} />);
}

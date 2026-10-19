// Значок «другая версия» у задачи (17 октября 2026, журнал правок): одна
// деталь на строку ленты и колоды (TaskRow), строку списка проекта
// (TaskListItem) и карточку доски (BoardCard). Две правки одного поля,
// сделанные на разных устройствах не видя друг друга, — конфликт: видна
// одна версия, другая лежит рядом, пока человек не выберет («Другая версия ›»
// на странице задачи). Значок — тот же, что у веба (copy), цветом акцента: это
// не ошибка, а «посмотрите, когда будет удобно».
import { View } from 'react-native';
import Icon from './Icon';
import { useHasConflict } from '../hooks/useConflicts';
import { useAppStore } from '../store/useAppStore';
import { useColors } from '../theme';
import { t } from '../lib/i18n';

export default function ConflictMark({ entity = 'task', id, size = 12, style }) {
  const colors = useColors();
  const lang = useAppStore((s) => s.settings.lang);
  const has = useHasConflict(entity, id);
  if (!has) return null;
  return (
    <View style={style} testID={`conflict-mark-${id}`} accessible accessibilityLabel={t(lang, 'sync.conflict_badge')}>
      <Icon name="copy" size={size} color={colors.accentInk} />
    </View>
  );
}

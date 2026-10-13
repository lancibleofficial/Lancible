import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Text from './AppText';
import PrimaryButton from './PrimaryButton';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { useColors, fontSize } from '../theme';

// Содержимое нижнего листа для меню/подтверждений — замена Alert.alert(...)
// (см. lib/dialogs.js). actions: [{label, onPress, destructive?, cancel?}].
// Заголовок уходит в общую шапку листа, в содержимом остаётся пояснение.
//
// embedded (12 октября 2026) — подтверждение страницей внутри другого листа
// («Удалить запись?», «Удалить аккаунт?»): из листа другой лист не
// открывается, иначе он закрыл бы собой этот. Заголовок и «назад» ставит
// тот, кто держит страницу; «Отмена» возвращает к нему (onCancel), а не
// закрывает лист. Кнопки — тот же подвал: главная, danger, серая «Отмена».
export default function ActionSheetContent({ title, message, actions, embedded, onCancel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  useSheetHeader(embedded ? null : title);

  useEffect(() => {
    const footer = (
      <>
        {actions.map((a, i) => (
          <PrimaryButton
            key={i}
            title={a.label}
            variant={a.destructive ? 'danger' : a.cancel ? 'ghost' : 'primary'}
            onPress={() => {
              if (a.cancel && embedded) { if (onCancel) onCancel(); return; }
              closeSheet();
              if (a.onPress) a.onPress();
            }}
          />
        ))}
      </>
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [actions]);

  if (!message) return null;
  return <Text style={styles.message}>{message}</Text>;
}

const makeStyles = (colors) => StyleSheet.create({
  message: { color: colors.textDim, fontSize: fontSize.sm },
});

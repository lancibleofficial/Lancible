// Ставка в час — один лист на общую ставку «Меню» и ставку задачи (строка
// «Ставка» в сведениях задачи, 12 октября 2026: поле на самой панели ушло,
// там теперь строка со значением словами, как у остальных настроек).
//
// У задачи ставка может быть не своей: пустое поле — «как у проекта» или
// общая. Поэтому у листа задачи есть nullable — пусто сохраняется как null, —
// серый плейсхолдер со ставкой, по которой считается, и подсказка об этом.
import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { Hint } from './RepeatControls';
import { parseNum } from '../lib/format';
import { setSheetFooter, closeSheet, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing, fontSize } from '../theme';
import { t } from '../lib/i18n';

/** @param title заголовок листа (по умолчанию — «Ставка по умолчанию»)
 *  @param placeholder серым в пустом поле — ставка, по которой считается
 *  @param unit единица справа от поля («₸/ч»)
 *  @param hint подсказка под полем
 *  @param nullable пустое поле — null (ставка не своя), а не 0 */
export default function RateSheet({ lang, initialValue, onSave, title, placeholder = '0', unit, hint, nullable }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  useSheetHeader(title || t(lang, 'settings.rate_label'));
  const [text, setText] = useState(initialValue ? String(initialValue) : '');

  function save() {
    onSave(nullable && text.trim() === '' ? null : parseNum(text));
    closeSheet();
  }

  useEffect(() => {
    setSheetFooter(<PrimaryButton title={t(lang, 'common.save')} onPress={save} />);
    return () => setSheetFooter(null);
  }, [text]);

  return (
    <View style={styles.content}>
      <View style={styles.row}>
        <Field
          style={styles.field}
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          accessibilityLabel={title || t(lang, 'settings.rate_label')}
          autoFocus
          testID="rate-input"
        />
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {hint ? <Hint>{hint}</Hint> : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.sm },
  // Поле с единицей справа — как «Ставка проекта» в окне проекта.
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: { flex: 1 },
  unit: { color: colors.textDim, fontSize: fontSize.sm },
});

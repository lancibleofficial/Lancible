// Быстрый ввод задачи прямо из ячейки доски.
//
// Лист не закрывается после создания: заполняя колонку, задач заводят
// несколько подряд, и закрытие после каждой превращало бы это в десять
// одинаковых движений. Поле очищается, фокус остаётся — набрал, «Создать»,
// набрал дальше. Выход — отдельной кнопкой «Готово».
//
// Пустых задач здесь не бывает: в вебе название вводят уже в редакторе,
// куда доска и перебрасывает, а на телефоне спрашивают до создания — значит
// и создавать нечего, пока поле пустое.
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function QuickTaskSheet({ projectId, statusId, versionId, contextLabel }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const createTaskInStatus = useAppStore((s) => s.createTaskInStatus);
  const [title, setTitle] = useState('');
  const inputRef = useRef(null);
  // Свежее название в замыкании футера: сам футер пересобирается эффектом
  // ниже, но обработчик всё равно читает значение через ref — так кнопка не
  // зависит от того, успел ли эффект отработать.
  const latest = useRef('');
  latest.current = title;

  function onCreate() {
    const trimmed = latest.current.trim();
    if (!trimmed) return;
    createTaskInStatus(projectId, statusId, versionId, trimmed);
    setTitle('');
    if (inputRef.current) inputRef.current.focus();
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, 'board.create')} onPress={onCreate} disabled={!title.trim()} />
        <PrimaryButton title={t(lang, 'common.done')} variant="ghost" onPress={closeSheet} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [lang, title]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.context} numberOfLines={1}>{contextLabel}</Text>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={t(lang, 'board.task_title_ph')}
        placeholderTextColor={colors.textDim}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onCreate}
        // Клавиатура не прячется между задачами: следующая вводится сразу.
        blurOnSubmit={false}
      />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { gap: spacing.sm, paddingBottom: spacing.sm },
  context: { color: colors.textDim, fontSize: fontSize.sm },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.text, fontSize: fontSize.md,
  },
});

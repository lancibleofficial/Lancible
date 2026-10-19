// График в тексте — нижний лист телефона (17 октября 2026). Раньше вставка
// и правка графика открывали окно редактора внутри WebView: мелкие поля
// таблицы под пальцем и клавиатура поверх окна. Теперь редактор шлёт
// сообщение chart, а данные правятся здесь, нативно (lib/chartSpec.js —
// разбор и сборка spec, протокол — lib/editorBridge.js).
//
// Собран из общих кирпичей: название — Field big; вид — шесть видов
// редактора (bar, hbar, line, area, pie, donut) строками с галочкой
// (ChoiceList: сегментов в листах нет, и шесть подписей в одну дорожку на
// 360 dp не влезают); данные — остров строк (RowGroup), в
// каждой — поле подписи и поле числа, крестик убирает строку; последней —
// строка-действие «+ Строка»; подсказка — note острова. Подвал — одна
// главная: «Вставить» для нового графика, «Сохранить» для правки. Закрыли
// лист крестиком или свайпом — редактору уходит отмена (onCancel).
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import TextInput, { Field } from './AppTextInput';
import ChoiceList from './ChoiceList';
import PrimaryButton from './PrimaryButton';
import Tap from './Tap';
import Icon from './Icon';
import { RowGroup, SettingRow, IslandRow } from './Island';
import { Block } from './RepeatControls';
import { CHART_KINDS, CHART_MAX_ROWS, specToDraft, draftToSpec, filledRows, emptyRow } from '../lib/chartSpec';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing, fontSize } from '../theme';
import { t } from '../lib/i18n';

// Число со знаком и дробью: на iOS у «decimal-pad» нет минуса.
const NUMBER_KEYBOARD = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric';

/**
 * @param id     узел графика или null — новый, у курсора
 * @param spec   данные из сообщения chart (форма — lib/chartSpec.js)
 * @param onSave (spec) — ответ редактору; лист закрывается сам
 * @param onCancel лист закрыли без сохранения
 */
export default function ChartSheet({ lang, id = null, spec, onSave, onCancel }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isNew = id === null || id === undefined;
  useSheetHeader(t(lang, isNew ? 'chart.sheet_new' : 'chart.sheet_edit'));
  const [draft, setDraft] = useState(() => specToDraft(spec));
  const canSave = filledRows(draft.rows).length > 0;
  // Ушёл ли ответ: лист размонтируется и при «Вставить», и при крестике.
  const answered = useRef(false);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => () => { if (!answered.current && cancelRef.current) cancelRef.current(); }, []);

  const patch = (next) => setDraft((d) => ({ ...d, ...next }));
  const patchRow = (key, next) => setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...next } : r)) }));
  const removeRow = (key) => setDraft((d) => ({ ...d, rows: d.rows.filter((r) => r.key !== key) }));
  const addRow = () => setDraft((d) => (d.rows.length >= CHART_MAX_ROWS ? d : { ...d, rows: [...d.rows, emptyRow()] }));

  useEffect(() => {
    const footer = (
      <PrimaryButton
        title={t(lang, isNew ? 'chart.insert' : 'common.save')}
        disabled={!canSave}
        onPress={() => { answered.current = true; if (onSave) onSave(draftToSpec(draft)); closeSheet(); }}
        testID="chart-save"
      />
    );
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [draft, lang, isNew, canSave, onSave]);

  return (
    <View style={styles.content} testID="chart-sheet">
      <Field
        big
        value={draft.title}
        onChangeText={(title) => patch({ title })}
        placeholder={t(lang, 'chart.name_ph')}
        accessibilityLabel={t(lang, 'chart.name_ph')}
        testID="chart-title"
      />

      <Block label={t(lang, 'chart.kind_label')}>
        <ChoiceList
          testID="chart-kinds"
          value={draft.kind}
          onSelect={(kind) => patch({ kind })}
          options={CHART_KINDS.map((k) => ({ value: k, label: t(lang, `chart.kind_${k}`), testID: `chart-kind-${k}` }))}
        />
      </Block>

      <RowGroup label={t(lang, 'chart.rows_label')} note={t(lang, 'chart.hint')} testID="chart-rows">
        {draft.rows.map((row, i) => (
          <DataRow
            key={row.key}
            row={row}
            index={i}
            lang={lang}
            styles={styles}
            colors={colors}
            onChange={(next) => patchRow(row.key, next)}
            onRemove={() => removeRow(row.key)}
          />
        ))}
        {draft.rows.length < CHART_MAX_ROWS ? (
          <SettingRow icon="plus" label={t(lang, 'chart.add_row')} chevron={false} onPress={addRow} testID="chart-add-row" />
        ) : null}
      </RowGroup>
    </View>
  );
}

/** Строка данных: поле подписи, поле числа справа, крестик. Линию сверху и
 *  первую строку отмечает RowGroup (first). */
function DataRow({ first, row, index, lang, styles, colors, onChange, onRemove }) {
  return (
    <IslandRow first={first} style={styles.row} testID={`chart-row-${index}`}>
      <TextInput
        style={styles.label}
        value={row.label}
        onChangeText={(label) => onChange({ label })}
        placeholder={t(lang, 'chart.label_ph')}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={`${t(lang, 'chart.label_ph')} ${index + 1}`}
        testID={`chart-label-${index}`}
      />
      <TextInput
        style={styles.value}
        value={row.value}
        onChangeText={(v) => onChange({ value: v.replace(/[^0-9.,\-−\s]/g, '') })}
        placeholder={t(lang, 'chart.value_ph')}
        placeholderTextColor={colors.textFaint}
        keyboardType={NUMBER_KEYBOARD}
        accessibilityLabel={`${t(lang, 'chart.value_ph')} ${index + 1}`}
        testID={`chart-value-${index}`}
      />
      <Tap onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={t(lang, 'chart.remove_row')} testID={`chart-remove-${index}`}>
        <Icon name="x" size={14} color={colors.textFaint} />
      </Tap>
    </IslandRow>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  // Строка данных — та же высота и поля, что у SettingRow (46, spacing.md);
  // по высоте строки — сами поля: касание в любой точке строки ставит курсор.
  row: { paddingHorizontal: spacing.md, paddingVertical: 0, minHeight: 46, gap: spacing.md },
  label: { flex: 1, minWidth: 0, minHeight: 46, color: colors.text, fontSize: fontSize.sm, paddingVertical: 0 },
  value: { width: 96, minHeight: 46, color: colors.text, fontSize: fontSize.sm, textAlign: 'right', fontVariant: ['tabular-nums'], paddingVertical: 0 },
});

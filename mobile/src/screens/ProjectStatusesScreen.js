// Набор статусов проекта: столбцы его доски.
//
// Экран открывается с доски, а не из общих настроек, потому что набор свой у
// каждого проекта: у разных работ разный процесс. Порт диалога статусов из
// веба (renderStatusDialog/addStatus/deleteStatus) — те же действия и те же
// запреты, только правила лежат в общем ядре, а не переписаны заново.
import { useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import TextInput from '../components/AppTextInput';
import Icon from '../components/Icon';
import PickerSheet from '../components/PickerSheet';
import ColorPickerSheet from '../components/ColorPickerSheet';
import { useAppStore } from '../store/useAppStore';
import { orderedStatuses, planStatusDelete, STATUS_KINDS } from '../lib/statuses';
import { openSheet } from '../store/useSheetStore';
import { confirmSheet } from '../lib/dialogs';
import { useColors, spacing, radius, fontSize } from '../theme';
import { t } from '../lib/i18n';

export default function ProjectStatusesScreen({ route }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const { projectId } = route.params;

  const statuses = useAppStore((s) => s.statuses);
  const tasks = useAppStore((s) => s.tasks);
  const lang = useAppStore((s) => s.settings.lang);
  const addStatus = useAppStore((s) => s.addStatus);
  const updateStatus = useAppStore((s) => s.updateStatus);
  const setStatusKind = useAppStore((s) => s.setStatusKind);
  const moveStatus = useAppStore((s) => s.moveStatus);
  const deleteStatus = useAppStore((s) => s.deleteStatus);
  const showToast = useAppStore((s) => s.showToast);

  const list = orderedStatuses(statuses, projectId);
  // Какой строке отдать фокус после создания: как в вебе, новый статус сразу
  // готов к переименованию — имя по умолчанию всё равно временное.
  const [focusId, setFocusId] = useState(null);

  function onAdd() {
    setFocusId(addStatus(projectId));
  }

  function onKind(status) {
    openSheet(
      <PickerSheet
        title={t(lang, 'status.kind_label')}
        value={status.kind}
        options={STATUS_KINDS.map((k) => ({ value: k, label: t(lang, `status.kind_${k}`) }))}
        onSelect={(kind) => setStatusKind(status.id, kind)}
      />,
    );
  }

  function onColor(status) {
    openSheet(
      <ColorPickerSheet
        title={t(lang, 'tag.color_label')}
        value={status.color}
        onSelect={(color) => updateStatus(status.id, { color })}
      />,
    );
  }

  function onDelete(status) {
    // Оба запрета — не про удобство: без единственного статуса задачам негде
    // стоять, а без последнего «готово» их нечем закрыть.
    const plan = planStatusDelete(statuses, tasks, status.id);
    if (plan.blocked === 'last') { showToast(t(lang, 'status.delete_last')); return; }
    if (plan.blocked === 'last_done') { showToast(t(lang, 'status.delete_last_done')); return; }
    if (plan.blocked) return;
    // Спрашиваем только когда переезжать действительно есть чему.
    if (!plan.moving.length) { deleteStatus(status.id); return; }
    confirmSheet({
      title: t(lang, 'common.delete_q'),
      message: t(lang, 'status.move_tasks', { name: plan.target.name }),
      actions: [
        { label: t(lang, 'common.delete'), destructive: true, onPress: () => deleteStatus(status.id) },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {list.map((status, i) => (
        <StatusRow
          key={status.id}
          status={status}
          first={i === 0}
          last={i === list.length - 1}
          autoFocus={status.id === focusId}
          styles={styles}
          colors={colors}
          lang={lang}
          onRename={(name) => updateStatus(status.id, { name })}
          onColor={() => onColor(status)}
          onKind={() => onKind(status)}
          onMove={(dir) => moveStatus(status.id, dir)}
          onDelete={() => onDelete(status)}
        />
      ))}

      <Pressable style={styles.add} onPress={onAdd}>
        <Icon name="plus" size={13} color={colors.textDim} />
        <Text style={styles.addText}>{t(lang, 'status.add')}</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Строка статуса. Название правится на месте и сохраняется по расфокусу или
 *  по Enter; пустое имя не сохраняется — строка молча возвращается к
 *  прежнему, потому что статус без названия неотличим от соседнего. */
function StatusRow({
  status, first, last, autoFocus, styles, colors, lang,
  onRename, onColor, onKind, onMove, onDelete,
}) {
  const [draft, setDraft] = useState(status.name);
  const inputRef = useRef(null);
  // Имя могли поменять с другого устройства, пока экран открыт.
  useEffect(() => { setDraft(status.name); }, [status.name]);
  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) { setDraft(status.name); return; }
    if (trimmed !== status.name) onRename(trimmed);
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Pressable onPress={onColor} hitSlop={8} style={[styles.color, { backgroundColor: status.color }]} />
        <TextInput
          ref={inputRef}
          style={styles.name}
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder={t(lang, 'status.name_ph')}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
        />
        <Pressable onPress={() => onMove('up')} disabled={first} hitSlop={6} style={styles.iconBtn}>
          <Icon name="chevron-up" size={13} color={first ? colors.textFaint : colors.textDim} />
        </Pressable>
        <Pressable onPress={() => onMove('down')} disabled={last} hitSlop={6} style={styles.iconBtn}>
          <Icon name="chevron-down" size={13} color={last ? colors.textFaint : colors.textDim} />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={6} style={styles.iconBtn}>
          <Icon name="trash" size={15} color={colors.danger} />
        </Pressable>
      </View>
      <Pressable style={styles.kind} onPress={onKind} hitSlop={4}>
        <Text style={styles.kindLabel}>{t(lang, 'status.kind_label')}</Text>
        <Text style={styles.kindValue}>{t(lang, `status.kind_${status.kind}`)}</Text>
        <Icon name="chevron-right" size={11} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.sm },

  row: {
    backgroundColor: colors.panel, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  color: { width: 26, height: 26, borderRadius: radius.sm },
  name: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '600', paddingVertical: spacing.xs },
  iconBtn: { padding: spacing.xs },

  kind: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingBottom: spacing.xs },
  kindLabel: { color: colors.textDim, fontSize: fontSize.xs },
  kindValue: { color: colors.text, fontSize: fontSize.xs, fontWeight: '600' },

  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    marginTop: spacing.sm,
  },
  addText: { color: colors.textDim, fontSize: fontSize.sm },
});

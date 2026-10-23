// Корзина (17 октября 2026, журнал правок) — раздел «Данные» в «Меню».
//
// Удалённое здесь и на других устройствах не исчезает сразу: ядро
// (core/oplog.js) держит его рядом с данными 30 дней (trashSweep при каждом
// открытии области). Строки — что удалено, какого вида и когда (lib/trash.js:
// ушедшее вместе с проектом — не отдельной строкой, как у веба), справа —
// «Восстановить»: тап возвращает сразу, правками ядра (restoreFromTrash через
// lib/sync.js) — возврат доедет и до остальных устройств, а удалить снова
// можно как обычно.
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SettingRow, RowGroup } from './Island';
import EmptyState from './EmptyState';
import { useTrash } from '../hooks/useConflicts';
import { useAppStore } from '../store/useAppStore';
import { useSheetHeader } from '../store/useSheetStore';
import { restoreFromTrash } from '../lib/sync';
import { TRASH_DAYS } from '../lib/oplogScope';
import { trashRows } from '../lib/trash';
import { nameOf, entityKind, whenText } from '../lib/conflictText';
import { useColors } from '../theme';
import { t } from '../lib/i18n';

export default function TrashSheet() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const trash = useTrash();
  const rows = useMemo(() => trashRows(trash), [trash]);
  useSheetHeader(t(lang, 'sync.trash'));

  if (!rows.length) {
    return <EmptyState size="sm" art="tasks" title={t(lang, 'sync.trash_empty')} text={t(lang, 'sync.trash_empty_text', { days: TRASH_DAYS })} testID="trash-empty" />;
  }
  return (
    <RowGroup note={t(lang, 'sync.trash_note', { days: TRASH_DAYS })} testID="trash-items">
      {rows.map((tr) => {
        const name = nameOf(tr.entity, tr.data, lang);
        return (
          <SettingRow
            key={`${tr.entity}:${tr.entityId}`}
            icon="trash"
            label={name}
            value={t(lang, 'sync.restore')}
            valueStyle={styles.restore}
            sub={`${entityKind(tr.entity, lang)} · ${t(lang, 'sync.deleted_on', { date: whenText(tr.deletedAt, lang) })}`}
            chevron={false}
            onPress={() => { if (restoreFromTrash(tr.entity, tr.entityId)) showToast(t(lang, 'sync.restored_one', { name })); }}
            accessibilityLabel={`${t(lang, 'sync.restore')}: ${name}`}
            testID={`trash-row-${tr.entityId}`}
          />
        );
      })}
    </RowGroup>
  );
}

// Счётчик экранов (lib/screenStats.js): корзина — заметный лист, считается экраном.
TrashSheet.screenId = 'trash';

const makeStyles = (colors) => StyleSheet.create({
  restore: { color: colors.accentInk, fontWeight: '600' },
});

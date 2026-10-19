// Лист «Другая версия» (17 октября 2026, журнал правок). Две правки одного
// поля, сделанные на разных устройствах не видя друг друга, — конфликт (ядро,
// core/oplog.js): видна одна версия, остальные лежат рядом, пока человек не
// выберет. Работать можно и до выбора. То же окно, что у веба
// (src/renderer/app.js: renderSyncDialog): у сущности — все её спорные поля
// блоками, в блоке — версии, новые сверху, у каждой значение, устройство и
// время, «Сейчас показана» и «Оставить эту».
//
// Открывается со страницы задачи («Другая версия ›» — конфликты этой задачи;
// у проекта то же — страницей его настроек, ConflictBlocks) и из «Данных» в
// «Меню» («Конфликты ›»: список сущностей, тап — страница этого же листа со
// стрелкой «назад», SheetPage, как во всех листах). Решили последний у
// сущности — из списка назад к списку, иначе лист закрывается.
// «Оставить эту» — resolveConflict ядра через lib/sync.js: обычная правка
// поля плюс пометка «решено», обе версии остаются в журнале.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import Island, { SettingRow, RowGroup } from './Island';
import PrimaryButton from './PrimaryButton';
import EmptyState from './EmptyState';
import SheetPage, { usePageMotion } from './SheetPage';
import { Block } from './RepeatControls';
import { useConflicts } from '../hooks/useConflicts';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, useSheetHeader } from '../store/useSheetStore';
import { resolveConflict } from '../lib/sync';
import { deviceId } from '../lib/device';
import { conflictLabel, fieldsLabel, entityTitle, entityKind, valueText, deviceLabel, whenText } from '../lib/conflictText';
import { useColors, spacing, fontSize, radius } from '../theme';
import { t } from '../lib/i18n';

const isOf = (entity, id) => (c) => c && c.entity === entity && String(c.entityId) === String(id);

/** @param entity, entityId — конфликты этой сущности (страница задачи); без
 *  них — список всех конфликтов области («Данные»). */
export default function ConflictSheet({ entity = null, entityId = null }) {
  const lang = useAppStore((s) => s.settings.lang);
  const all = useConflicts();
  const direct = useRef(!!entity).current;
  const [picked, setPicked] = useState(() => (entity ? { entity, entityId } : null));
  const list = picked ? all.filter(isOf(picked.entity, picked.entityId)) : [];
  const motion = usePageMotion(picked && !direct ? 1 : 0);
  const back = direct ? null : () => setPicked(null);
  useSheetHeader(t(lang, picked ? 'sync.other_version' : 'sync.conflicts'), picked ? back : null);

  // Решили последний у сущности: из списка — назад к нему, иначе — закрыть.
  useEffect(() => {
    if (!picked || list.length) return;
    if (!direct && all.length) setPicked(null);
    else closeSheet();
  }, [picked, list.length, all.length, direct]);

  if (picked) {
    return (
      <SheetPage key={`${picked.entity}:${picked.entityId}`} motion={motion} testID="conflict-page">
        <ConflictBlocks entity={picked.entity} entityId={picked.entityId} />
      </SheetPage>
    );
  }
  return (
    <SheetPage key="list" motion={motion} testID="conflict-list">
      <ConflictList conflicts={all} lang={lang} onSelect={setPicked} />
    </SheetPage>
  );
}

/** Список всех конфликтов: строка на сущность — название, вид и поля. */
function ConflictList({ conflicts, lang, onSelect }) {
  const state = useAppStore((s) => s);
  const groups = useMemo(() => {
    const map = new Map();
    for (const c of conflicts) {
      const key = `${c.entity}:${c.entityId}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return [...map.values()];
  }, [conflicts]);
  if (!groups.length) {
    return <EmptyState size="sm" art="tasks" title={t(lang, 'sync.conflicts_empty')} text={t(lang, 'sync.conflicts_empty_text')} />;
  }
  return (
    <RowGroup testID="conflict-groups">
      {groups.map((list) => {
        const c = list[0];
        return (
          <SettingRow
            key={`${c.entity}:${c.entityId}`}
            icon="copy"
            label={entityTitle(state, c.entity, c.entityId, lang)}
            value={`${entityKind(c.entity, lang)} · ${fieldsLabel(list, lang)}`}
            onPress={() => onSelect({ entity: c.entity, entityId: c.entityId })}
            testID={`conflict-row-${c.entity}-${c.entityId}`}
          />
        );
      })}
    </RowGroup>
  );
}

/** Спорные поля одной сущности — блоками с версиями. Одна деталь на лист и
 *  на страницу настроек проекта. */
export function ConflictBlocks({ entity, entityId }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const state = useAppStore((s) => s);
  const all = useConflicts();
  const list = all.filter(isOf(entity, entityId));
  const mine = deviceId();

  function keep(c, v) {
    if (resolveConflict(c.id, v.opId)) showToast(t(lang, 'sync.kept_toast'));
  }

  return (
    <View style={styles.page}>
      <Text style={styles.sub} numberOfLines={2} testID="conflict-entity">{`${entityKind(entity, lang)} · ${entityTitle(state, entity, entityId, lang)}`}</Text>
      {list.map((c) => {
        const shownId = c.shownId || (c.shown === 'ours' ? c.ours && c.ours.opId : c.theirs && c.theirs.opId);
        const versions = (c.versions || []).slice().sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
        const long = c.field === 'notes' || c.field === 'body';
        return (
          <Block key={c.id} label={conflictLabel(c, lang)}>
            {versions.map((v) => {
              const shown = v.opId === shownId;
              const text = valueText(c, v.value, state, lang);
              return (
                <Island key={v.opId} tone="inset" style={styles.version} testID={`conflict-version-${v.opId}`}>
                  {c.field === 'color' && typeof v.value === 'string' ? (
                    <View style={styles.colorRow}>
                      <View style={[styles.swatch, { backgroundColor: v.value }]} />
                      <Text style={styles.value} testID={`conflict-text-${v.opId}`}>{text}</Text>
                    </View>
                  ) : long ? (
                    <ScrollView style={styles.textBox} nestedScrollEnabled showsVerticalScrollIndicator testID={`conflict-text-${v.opId}`}>
                      <Text style={styles.value} selectable>{text}</Text>
                    </ScrollView>
                  ) : (
                    <Text style={styles.value} selectable testID={`conflict-text-${v.opId}`}>{text}</Text>
                  )}
                  <View style={styles.foot}>
                    <Text style={styles.who} numberOfLines={1} testID={`conflict-who-${v.opId}`}>{`${deviceLabel(v.deviceId, mine, lang)} · ${whenText(v.at, lang)}`}</Text>
                    {shown ? <Text style={styles.shown} testID={`conflict-shown-${v.opId}`}>{t(lang, 'sync.shown_now')}</Text> : null}
                  </View>
                  <PrimaryButton
                    variant={shown ? 'ghost' : 'primary'}
                    title={t(lang, 'sync.keep_this')}
                    onPress={() => keep(c, v)}
                    testID={`conflict-keep-${v.opId}`}
                  />
                </Island>
              );
            })}
          </Block>
        );
      })}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  page: { gap: spacing.md },
  sub: { color: colors.textDim, fontSize: fontSize.sm },
  version: { gap: spacing.sm },
  value: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  // Длинный текст — в своей прокрутке: обе версии заметок должны помещаться
  // на одном экране рядом, а не уводить вторую за край листа.
  textBox: { maxHeight: 220, borderRadius: radius.sm },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  who: { flexShrink: 1, color: colors.textFaint, fontSize: fontSize.xs },
  shown: { marginLeft: 'auto', color: colors.accentInk, fontSize: fontSize.xs, fontWeight: '600' },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 14, height: 14, borderRadius: 4 },
});

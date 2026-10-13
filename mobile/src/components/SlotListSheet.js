// «Время работы» задачи списком — лист за строкой «Время работы» в сведениях
// (12 октября 2026). Отрезков у задачи может быть несколько, поэтому строка
// сведений показывает первый и «+N», а все — здесь: по строке на отрезок
// (часы · день или дни повтора задачи ›) и последней строкой «Добавить
// время». Тап по строке открывает отрезок (SlotSheet) страницей этого же
// листа со стрелкой «назад» к списку; сохранение и удаление тоже
// возвращают к списку. Другой лист отсюда не открывается.
//
// Своего вида у листа нет: группа строк — общий остров SettingRow, как в
// «Меню» и настройках проекта. Без отрезков сведения открывают сразу
// SlotSheet на создание — пустой список был бы лишним шагом.
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import Island, { SettingRow } from './Island';
import SlotSheet from './SlotSheet';
import SheetPage, { usePageMotion } from './SheetPage';
import { useAppStore } from '../store/useAppStore';
import { useSheetHeader } from '../store/useSheetStore';
import Slots from '../core/slots.js';
import { rangeText, slotWhen } from '../lib/slotText';
import { spacing } from '../theme';
import { t } from '../lib/i18n';

export default function SlotListSheet({ taskId }) {
  const lang = useAppStore((s) => s.settings.lang);
  const task = useAppStore((s) => s.tasks.find((x) => x.id === taskId)) || null;
  // Страница: null — список; { slotId } — отрезок (undefined — новый).
  const [page, setPage] = useState(null);
  const motion = usePageMotion(page ? 1 : 0);
  // Пока открыт отрезок, шапку ведёт он (заголовок и «назад» к списку).
  useSheetHeader(page ? null : t(lang, 'slot.label'));
  const slots = task ? Slots.slotsOf(task) : [];
  const rule = task ? Slots.slotRule(task) : null;

  if (page) {
    return (
      <SheetPage key="slot" motion={motion} testID="slot-list-page">
        <SlotSheet taskId={taskId} slotId={page.slotId} onBack={() => setPage(null)} />
      </SheetPage>
    );
  }

  return (
    <SheetPage key="list" motion={motion} style={styles.content} testID="slot-list">
      <Island tone="inset" padded={false} testID="slot-list-island">
        {slots.map((sl, i) => (
          <SettingRow
            key={sl.id || `${sl.start}-${i}`}
            first={i === 0}
            icon="clock"
            label={rangeText(sl.start, sl.end)}
            value={slotWhen(sl, lang, rule)}
            onPress={() => setPage({ slotId: sl.id })}
            testID={`slot-list-${sl.id}`}
          />
        ))}
        <SettingRow
          first={!slots.length}
          icon="plus"
          label={t(lang, 'slot.add')}
          chevron={false}
          onPress={() => setPage({ slotId: undefined })}
          testID="slot-list-add"
        />
      </Island>
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
});

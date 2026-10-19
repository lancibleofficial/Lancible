// Конфликты и корзина открытой области — из пачки журнала правок в сторе
// (store/useAppStore.js: oplog; ведёт её ядро, core/oplog.js). Экраны только
// читают: выбор и возврат — lib/sync.js (resolveConflict, restoreFromTrash).
import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

const EMPTY = [];

/** Все открытые конфликты области. */
export const useConflicts = () => useAppStore((s) => (s.oplog ? s.oplog.conflicts : EMPTY));

/** Корзина области — удалённое за последние 30 дней. */
export const useTrash = () => useAppStore((s) => (s.oplog ? s.oplog.trash : EMPTY));

const isOf = (entity, id) => (c) => c && c.entity === entity && String(c.entityId) === String(id);

/** Конфликты одной сущности (задачи, проекта, документа…). */
export function useEntityConflicts(entity, id) {
  const all = useConflicts();
  return useMemo(() => all.filter(isOf(entity, id)), [all, entity, id]);
}

/** Есть ли у сущности «другая версия» — для значка в строке и карточке. */
export const useHasConflict = (entity, id) => useAppStore((s) => !!s.oplog && s.oplog.conflicts.some(isOf(entity, id)));

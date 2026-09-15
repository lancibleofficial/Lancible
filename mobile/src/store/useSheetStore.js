// Единый глобальный "слот" для нижнего листа (создание проекта, выбор
// периода экспорта, замена Alert.alert — см. lib/dialogs.js). content и
// footer раздельно: контент — то, что скроллится, footer — кнопки,
// закреплённые снизу листа и всегда видимые (см. BottomSheet.js — свой
// Modal+Animated, footer рендерится отдельным View вне ScrollView).
// Компонент-содержимое сам регистрирует свой footer через setSheetFooter в
// useEffect — так кнопки (например "Создать" с disabled от локального
// state) остаются рядом со своим состоянием, а не поднимаются в родителя.
import { create } from 'zustand';

export const useSheetStore = create((set) => ({
  content: null,
  footer: null,
  open(content) {
    set({ content, footer: null });
  },
  close() {
    set({ content: null, footer: null });
  },
  setFooter(footer) {
    set({ footer });
  },
}));

export const openSheet = (content) => useSheetStore.getState().open(content);
export const closeSheet = () => useSheetStore.getState().close();
export const setSheetFooter = (footer) => useSheetStore.getState().setFooter(footer);

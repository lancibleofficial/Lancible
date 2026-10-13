// Единый глобальный "слот" для нижнего листа (создание проекта, выбор
// периода экспорта, замена Alert.alert — см. lib/dialogs.js). content,
// header и footer раздельно: контент — то, что скроллится, header и footer —
// закреплённые сверху и снизу и всегда видимые (см. BottomSheet.js — свой
// Modal+Animated, шапка и footer рендерятся отдельными View вне ScrollView).
// Компонент-содержимое сам регистрирует свой footer через setSheetFooter в
// useEffect — так кнопки (например "Создать" с disabled от локального
// state) остаются рядом со своим состоянием, а не поднимаются в родителя.
// Заголовок и стрелка «назад» — тем же путём, через useSheetHeader.
import { useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';

export const useSheetStore = create((set) => ({
  content: null,
  header: null,
  footer: null,
  // header при открытии не сбрасывается, в отличие от footer: прежнее
  // содержимое уходит с экрана позже, чем меняется стор, и пустая шапка над
  // ним на кадр выглядела бы миганием. Своё содержимое уходя убирает сам —
  // в useSheetHeader.
  open(content) {
    set({ content, footer: null });
  },
  close() {
    set({ content: null, header: null, footer: null });
  },
  setHeader(header) {
    set({ header });
  },
  setFooter(footer) {
    set({ footer });
  },
}));

export const openSheet = (content) => useSheetStore.getState().open(content);
export const closeSheet = () => useSheetStore.getState().close();
export const setSheetFooter = (footer) => useSheetStore.getState().setFooter(footer);
export const setSheetHeader = (header) => useSheetStore.getState().setHeader(header);

/** Убрать подвал, только если в сторе всё ещё свой. Лист и страница внутри
 *  него (страница повтора в «Времени работы», новый тег в выборе меток,
 *  подтверждение удаления) ставят подвал разными эффектами — у одних
 *  layout, у других обычный, — и уходящий, убирая свой, не должен стирать
 *  подвал, который уже поставил пришедший. */
export const clearSheetFooter = (footer) => {
  if (useSheetStore.getState().footer === footer) useSheetStore.getState().setFooter(null);
};

/** Заголовок и «назад» листа — в общую закреплённую шапку, а не в содержимое.
 *  @param {string} [title] — пусто: заголовка нет, шапка — только крестик.
 *  @param {function} [onBack] — есть куда вернуться: слева встанет стрелка.
 *    Обработчик читается в момент нажатия, поэтому новая функция на каждый
 *    рендер шапку не переписывает — только смена заголовка или появление и
 *    пропажа самой стрелки. */
export function useSheetHeader(title, onBack) {
  const back = useRef(onBack);
  back.current = onBack;
  const hasBack = !!onBack;
  // Layout-эффект: заголовок ложится в шапку в тот же кадр, что страница
  // содержимого, а не на кадр позже (на глаз — «шапка отстаёт»).
  useLayoutEffect(() => {
    // Нечего показывать — шапку не трогаем: встроенные страницы листа
    // (embedded) не должны затирать заголовок того, кто их держит.
    if (!title && !hasBack) return undefined;
    setSheetHeader({ title: title || '', onBack: hasBack ? () => back.current && back.current() : null });
    return () => setSheetHeader(null);
  }, [title, hasBack]);
}

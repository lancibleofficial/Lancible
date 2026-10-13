// Страница внутри листа — одна деталь на все листы со страницами («Время
// работы» → «Повторение задачи», «Новая запись» → «Проект», «Профиль» →
// «Изменить пароль», выбор меток с «Новым тегом»). Из листа другой лист не
// открывается (DESIGN.md, «Нижние листы»): лист в приложении один, и
// открытый поверх закрывал бы собой этот вместе с набранным. Поэтому
// вложенное — страница этого же листа со стрелкой «назад» в шапке.
//
// Переход идёт в сторону навигации: вперёд новая въезжает справа, назад —
// слева (PAGE_IN_FWD, PAGE_IN_BACK, PAGE_OUT — общие, из BottomSheet.js).
// Первая отрисовка и «уменьшение движения» — без хода. Глубину помнит лист:
// usePageMotion живёт в нём, а SheetPage меняется ключом и монтируется заново.
import { useEffect, useRef } from 'react';
import Animated from 'react-native-reanimated';
import { PAGE_IN_FWD, PAGE_IN_BACK, PAGE_OUT } from './BottomSheet';
import { useReduceMotion } from '../hooks/useReduceMotion';

/** Ход страниц листа по глубине: 0 — главная, 1 — страница строки, 2 — глубже. */
export function usePageMotion(depth) {
  const prev = useRef(depth);
  const reduced = useReduceMotion();
  useEffect(() => { prev.current = depth; }, [depth]);
  const enter = reduced || depth === prev.current ? undefined : depth > prev.current ? PAGE_IN_FWD : PAGE_IN_BACK;
  return { enter, leave: reduced ? undefined : PAGE_OUT };
}

/** Обёртка страницы: ставится с key страницы, ход берёт из usePageMotion. */
export default function SheetPage({ motion, style, children, testID = 'sheet-page' }) {
  return (
    <Animated.View entering={motion.enter} exiting={motion.leave} style={style} testID={testID}>
      {children}
    </Animated.View>
  );
}

// «Уменьшение движения» в системе: включено — анимации украшения не играют,
// всё сразу стоит на месте (сценка пустых «Проектов» и подобное).
//
// Системный ответ асинхронный и идёт через мост, поэтому спрашивают его один
// раз, при загрузке модуля: к первому показу экрана он обычно уже известен, и
// сценка не дёрнется из анимации в покой. Следит за переключением в настройках
// тоже один слушатель на весь модуль. Хуков же в приложении десятки (каждая
// кнопка, переключатель, строка ленты), и у каждого своя подписка стоила бы
// вызовов моста на каждую прокрутку: они читают общее значение через
// useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let known = false;
// Событие пришло раньше ответа на вопрос — значит, оно свежее ответа.
let heard = false;
const listeners = new Set();

function publish(value) {
  const next = !!value;
  if (next === known) return;
  known = next;
  listeners.forEach((notify) => notify());
}

function onAnswer(value) {
  if (!heard) publish(value);
}

function onChange(value) {
  heard = true;
  publish(value);
}

try {
  const asked = AccessibilityInfo.isReduceMotionEnabled && AccessibilityInfo.isReduceMotionEnabled();
  if (asked && asked.then) asked.then(onAnswer, () => {});
  if (AccessibilityInfo.addEventListener) AccessibilityInfo.addEventListener('reduceMotionChanged', onChange);
} catch {
  // Нет нативной части (jest, веб): движение остаётся включённым.
}

const subscribe = (notify) => {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
};
const snapshot = () => known;

export function useReduceMotion() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

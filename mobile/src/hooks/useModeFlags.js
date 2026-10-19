// Режимы на телефоне (17 октября 2026): что показывать — деньги, счётчики
// заработка, кнопки таймера. Правило одно на три поверхности — Core.modeFlags
// (core/modes.js, побайтная копия ядра). Экраны берут флаги только отсюда и
// settings.mode / showTimer / showEarnings сами не читают: «личное» прячет
// деньги целиком, и пересказ правила в экране разошёлся бы с вебом.
//
//   money    — ставки, валюта, суммы в проектах, истории и выгрузке;
//   earnings — «заработано» за день и неделю, строка в таймере;
//   timer    — кнопки запуска и плашка идущего таймера.
//
// Кнопка «стоп» у идущей задачи остаётся и при выключенном таймере: запуск
// убран, а остановить уже идущий — нужно (иначе он шёл бы невидимо).
import { useMemo } from 'react';
import Modes from '../core/modes.js';
import { useAppStore } from '../store/useAppStore';

/** Флаги режимов для экрана: { mode, money, timer, earnings }. */
export function useModeFlags() {
  const settings = useAppStore((s) => s.settings);
  return useMemo(() => Modes.modeFlags(settings), [settings]);
}

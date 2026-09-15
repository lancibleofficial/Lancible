import { useEffect, useState } from 'react';

/** Форсирует перерисовку раз в intervalMs, пока enabled — для живого счётчика
 * времени, не коммитя ничего в стор (см. план: избегать записи в
 * AsyncStorage на каждый тик). */
export function useTicker(enabled, intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}

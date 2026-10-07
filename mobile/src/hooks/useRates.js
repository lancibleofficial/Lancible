// Хуки над ставками (lib/rates.js) — для экранов.
//
// Ставка проекта и валюта проекта появились на вебе 7 октября 2026; до того
// телефон передавал в ядро одно число. Ядро принимает и число, и объект, но
// с числом ставка проекта молча не учитывалась — поэтому экраны переходят
// на useRates() и currencyOf(), а не на settings.hourlyRate напрямую.
import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ratesOf, ratesMainOf, currencyOf } from '../lib/rates';

export { ratesOf, ratesMainOf, currencyOf };

export function useRates() {
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const projects = useAppStore((s) => s.projects);
  return useMemo(() => ratesOf({ hourlyRate }, projects), [hourlyRate, projects]);
}

export function useRatesMain() {
  const hourlyRate = useAppStore((s) => s.settings.hourlyRate);
  const currency = useAppStore((s) => s.settings.currency);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  return useMemo(() => ratesMainOf({ hourlyRate, currency }, projects, tasks), [hourlyRate, currency, projects, tasks]);
}

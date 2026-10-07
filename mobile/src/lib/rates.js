// Ставки для ядра денег (src/core/money.js): общая из настроек и свои у
// проектов — та же форма, что rates()/ratesMain() в app.js десктопа.
//
// Чистые функции лежат отдельно от хуков (hooks/useRates.js), потому что их
// зовёт стор: иначе стор тянул бы хук, хук — стор, и Metro предупреждал о
// кольце импортов.
import CoreMoney from '../core/money.js';

/** Ставки из снимка состояния — для кода вне компонентов (стор, выгрузка). */
export function ratesOf(settings, projects) {
  const byProject = {};
  for (const p of projects || []) {
    if (p.rate !== null && p.rate !== undefined && p.rate !== '') byProject[p.id] = p.rate;
  }
  return { default: Number(settings && settings.hourlyRate) || 0, byProject };
}

/** То же, но деньги считаются только по проектам в основной валюте — для
 *  общих итогов по всем проектам: складывать рубли с долларами нельзя. */
export function ratesMainOf(settings, projects, tasks) {
  return { ...ratesOf(settings, projects), scope: CoreMoney.moneyScope(tasks || [], projects || [], settings.currency) };
}

/** Валюта проекта: своя или основная из настроек. */
export const currencyOf = (project, settings) => CoreMoney.projectCurrency(project, settings.currency);

/* Режимы использования — чистая логика, без DOM и без state.
 *
 * Пользователь попросил 17 октября 2026: «режим фрилансеров, личное
 * использование, вкл/выкл таймера и счётчика заработка». Правило одно на все
 * три поверхности, иначе на телефоне деньги спрячутся, а на вебе нет.
 *
 *   settings.mode          'freelance' | 'personal'   — пресет; умолчание freelance
 *   settings.showTimer     boolean                    — таймер (кнопки, капсула); умолчание true
 *   settings.showEarnings  boolean                    — счётчики заработка; умолчание true
 *
 * Что скрывает каждый флаг — решают экраны по modeFlags, а не по settings
 * напрямую: «личное» прячет деньги целиком, и отдельный переключатель
 * заработка в нём не действует. Настройки — данные устройства, как язык и
 * тема: в синхронизацию не идут.
 */
(function (global) {
  const MODES = ['freelance', 'personal'];
  const DEFAULT_MODE = 'freelance';

  /** 'freelance' | 'personal'; всё незнакомое — умолчание. */
  function normalizeMode(v) {
    return MODES.includes(v) ? v : DEFAULT_MODE;
  }

  /** Что показывать при этих настройках.
   *
   *  money    — ставки, валюта, суммы в отчётах и выгрузке;
   *  earnings — счётчики «заработано» (сегодня, неделя, месяц, в таймере);
   *  timer    — кнопки запуска, капсула в шапке, «Сейчас идёт». Записи времени
   *             и их история остаются при любом режиме: это данные, а не кнопки.
   */
  function modeFlags(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const mode = normalizeMode(s.mode);
    const money = mode === 'freelance';
    const timer = s.showTimer !== false;
    const earnings = money && s.showEarnings !== false;
    return { mode, money, timer, earnings };
  }

  const api = { MODES, DEFAULT_MODE, normalizeMode, modeFlags };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

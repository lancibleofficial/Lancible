/* Решения синхронизации — чистая логика, без сети, без DOM и без state.
 *
 * Сама синхронизация сюда не входит и не должна: запросы к базе, подписка на
 * изменения, повтор после сбоя — всё это у платформ своё. Здесь только выбор,
 * который делается ПЕРЕД запросом, и именно он обязан совпадать.
 *
 * Цена расхождения тут выше, чем где-либо ещё в проекте: ошибиться веткой
 * значит затереть данные пользователя — его собственными, но не теми.
 */
(function (global) {
  /** Есть ли в наборе хоть что-то, что жалко потерять.
   *
   *  Смотрим на проекты и задачи, а не на настройки: пустой аккаунт с
   *  выбранным языком — это всё равно пустой аккаунт, и спрашивать о нём
   *  «чьи данные оставить» бессмысленно. */
  const hasData = (data) => !!(data
    && (((data.projects || []).length > 0) || ((data.tasks || []).length > 0)
      || ((data.documents || []).length > 0)));

  /** Что делать при входе в аккаунт.
   *
   *  @param {{localHasData: boolean, remoteHasData: boolean, resolved: boolean}} s
   *    resolved — пользователь уже разрешал это расхождение раньше, и
   *    спрашивать второй раз нельзя: иначе диалог «какие данные оставить»
   *    всплывал бы на каждом запуске из-за обычной, уже синхронизированной
   *    правки.
   *  @returns {'push'|'pull'|'ask'|'none'}
   *    push — отправить местное на сервер;
   *    pull — взять серверное, местного нет;
   *    ask  — данные есть с обеих сторон и расхождение не разрешено: спросить;
   *    none — делать нечего.
   */
  function planSignInSync(s) {
    const localHasData = !!(s && s.localHasData);
    const remoteHasData = !!(s && s.remoteHasData);
    // Сервер пуст: либо заливаем своё, либо заливать нечего.
    if (!remoteHasData) return localHasData ? 'push' : 'none';
    // Своего нет — берём серверное молча, терять нечего.
    if (!localHasData) return 'pull';
    return s && s.resolved ? 'none' : 'ask';
  }

  /** Документы из пришедшего с сервера набора.
   *
   *  Раздел «Документы» появился 7 октября 2026, и версии приложения до
   *  него шлют набор без поля documents вовсе. Принять такой набор как «у
   *  пользователя ноль документов» значило бы стереть их правкой с
   *  телефона, на котором просто не обновили приложение. Поэтому
   *  отсутствие поля — «не знаю», и своё остаётся; пустой массив — это
   *  уже настоящее «удалил все». */
  function pickDocuments(localDocs, remoteData) {
    if (remoteData && Array.isArray(remoteData.documents)) return remoteData.documents;
    return Array.isArray(localDocs) ? localDocs : [];
  }

  const api = { hasData, planSignInSync, pickDocuments };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Интервалы, которые тестовый файл оставил работать.
//
// jest выгружает модули файла, а настоящий setInterval продолжает тикать в
// том же процессе: опрос синхронизации (lib/sync.js, SYNC_POLL_MS = 60 с),
// запущенный одним файлом, срабатывал посреди чужого — уже без своих
// подмен (AppState undefined) — и ронял случайный тест (20 октября 2026,
// CI: tests/skeleton.test.js). jest.after-env.js подключает это к каждому
// файлу: после всех его тестов оставшиеся интервалы снимаются.
//
// track(scope) подменяет scope.setInterval и scope.clearInterval так, чтобы
// помнить живые интервалы; clearAll() снимает их; restore() возвращает
// исходные функции.

function track(scope) {
  const realSet = scope.setInterval;
  const realClear = scope.clearInterval;
  const live = new Set();
  scope.setInterval = function setIntervalTracked(...args) {
    const id = realSet.apply(this, args);
    live.add(id);
    return id;
  };
  scope.clearInterval = function clearIntervalTracked(id) {
    live.delete(id);
    return realClear.call(this, id);
  };
  return {
    size: () => live.size,
    clearAll() {
      for (const id of live) realClear.call(scope, id);
      live.clear();
    },
    restore() {
      scope.setInterval = realSet;
      scope.clearInterval = realClear;
    },
  };
}

module.exports = { track };

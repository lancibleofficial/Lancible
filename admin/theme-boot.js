// Тема до первой отрисовки: выбранную руками ставим на <html> раньше стилей,
// иначе страница мигнёт системной. Отдельный файл, а не строка в <head>:
// политика безопасности сайта (vercel.json) запрещает встроенные скрипты.
// Ключ — THEME_KEY в js/config.js.
(function () {
  try {
    var t = localStorage.getItem('lancible-admin-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* хранилище закрыто — тема системная */ }
})();

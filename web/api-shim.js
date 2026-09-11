'use strict';

// CSP (script-src 'self') блокирует инлайн-скрипты, поэтому платформенный
// флаг выставляется здесь — в обычном внешнем файле, а не тегом <script>
// в index.html. Должен выполниться до app.js (см. порядок <script> тегов).
window.__LANCIBLE_PLATFORM__ = 'web';

// Браузерная реализация window.api — то же самое, что preload.js даёт
// рендереру в Electron, только через localStorage/navigator.clipboard/Blob
// вместо IPC в главный процесс. Должен грузиться ДО app.js (см. index.html).
// Методы автообновления (checkForUpdate/downloadUpdate/installUpdate/
// onUpdate*) и OAuth-редирект-через-IPC (openExternal/onOAuthCallback)
// намеренно не определены — на вебе они не нужны, а app.js либо явно
// проверяет их наличие (`if (window.api.onUpdateAvailable)`), либо просто
// не вызывает их в web-ветке (см. IS_WEB в app.js).
(function () {
  const STORAGE_KEY = 'lancible:data';

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { tasks: [], activeTimer: null };
    } catch {
      return { tasks: [], activeTimer: null };
    }
  }

  function saveLocal(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  window.api = {
    load: () => Promise.resolve(loadLocal()),
    save: (data) => {
      saveLocal(data);
      return Promise.resolve(true);
    },
    copy: (text) => navigator.clipboard.writeText(String(text ?? '')),
    setTitlebarOverlay: () => Promise.resolve(true), // на вебе нет нативного заголовка окна

    exportXlsx: ({ defaultName, sheets }) => {
      try {
        const bytes = window.buildWorkbook(sheets);
        const blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const safeName = String(defaultName || 'export').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return Promise.resolve({ ok: true });
      } catch (err) {
        return Promise.resolve({ ok: false, error: err.message });
      }
    },
  };
})();

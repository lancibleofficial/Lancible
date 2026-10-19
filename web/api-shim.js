'use strict';

// CSP (script-src 'self') блокирует инлайн-скрипты, поэтому платформенный
// флаг выставляется здесь — в обычном внешнем файле, а не тегом <script>
// в index.html. Должен выполниться до app.js (см. порядок <script> тегов).
window.__LANCIBLE_PLATFORM__ = 'web';

// Браузерная реализация window.api — то же самое, что preload.js даёт
// рендереру в Electron, только через localStorage/navigator.clipboard/Blob
// вместо IPC в главный процесс. Должен грузиться ДО app.js (см. index.html).
// Методы автообновления (checkForUpdate/getUpdateStatus/downloadUpdate/
// installUpdate/onUpdate*) и OAuth-редирект-через-IPC (openExternal/onOAuthCallback)
// намеренно не определены — на вебе они не нужны, а app.js либо явно
// проверяет их наличие (`if (window.api.onUpdateAvailable)`), либо просто
// не вызывает их в web-ветке (см. IS_WEB в app.js).
(function () {
  // Несколько аккаунтов (17 октября 2026): у каждого своя область данных.
  // Гость — прежний ключ lancible:data, его данные никуда не переезжают;
  // аккаунт — lancible:data:<uid>. Правило ключа — core/accounts.js
  // (dataScope). Шим грузится раньше ядра, поэтому ядро зовётся в момент
  // вызова, а не при загрузке: к первому setDataScope оно уже на месте.
  const GUEST_KEY = 'lancible:data';
  const ACCOUNTS_KEY = 'lancible:accounts';
  // Случайный id этой установки (17 октября 2026, журнал правок): по нему
  // устройство отличает свои правки от чужих, а окно конфликта говорит, с
  // какого устройства версия. Один на браузер, не на аккаунт; ничего о
  // человеке или железе в нём нет — «web-» и случайный uuid.
  const DEVICE_KEY = 'lancible:device';
  const core = () => window.Core;
  const keyOf = (uid) => core().dataScope(uid);
  let storageKey = GUEST_KEY;

  function loadLocal() {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : { tasks: [], activeTimer: null };
    } catch {
      return { tasks: [], activeTimer: null };
    }
  }

  function saveLocal(data) {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }

  const readJSON = (key) => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
  };

  window.api = {
    load: () => Promise.resolve(loadLocal()),
    save: (data) => {
      saveLocal(data);
      return Promise.resolve(true);
    },
    // Чья область открыта: uid аккаунта или null — гость. Зовётся до load().
    setDataScope: (uid) => {
      storageKey = keyOf(uid);
      return Promise.resolve(true);
    },
    deviceId: () => {
      let id = null;
      try { id = localStorage.getItem(DEVICE_KEY); } catch { /* хранилище закрыто — id на сеанс */ }
      if (!id || !/^web-[0-9a-f-]{36}$/.test(id)) {
        const uuid = crypto.randomUUID ? crypto.randomUUID()
          : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
        id = `web-${uuid}`;
        try { localStorage.setItem(DEVICE_KEY, id); } catch { /* см. выше */ }
      }
      return Promise.resolve(id);
    },
    // Список аккаунтов устройства с сеансами неактивных — core/accounts.js.
    accountsLoad: () => Promise.resolve(readJSON(ACCOUNTS_KEY)),
    accountsSave: (acc) => {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(acc));
      return Promise.resolve(true);
    },
    // Список переписала другая вкладка (событие storage приходит только в
    // чужие вкладки, своя запись его не будит). cb получает запись как она
    // лежит (null — стёрта); сменился ли там текущий, решает app.js
    // (Core.accountChangedElsewhere). Область данных у вкладки своя —
    // storageKey выше, — а список и сеанс supabase-js общие.
    onAccountsChanged: (cb) => {
      window.addEventListener('storage', (e) => {
        if (e.storageArea && e.storageArea !== localStorage) return;
        if (e.key !== ACCOUNTS_KEY && e.key !== null) return;
        let value = null;
        try { value = e.newValue ? JSON.parse(e.newValue) : null; } catch { value = null; }
        cb(value);
      });
    },
    // Какие области лежат на устройстве: гость и аккаунты, в том числе те, из
    // которых уже вышли (копия остаётся до «Удалить данные с устройства»).
    // Подпись берётся из области: settings.account — почта и имя на момент
    // последнего входа.
    dataScopes: () => {
      const out = [{ uid: null, email: '', name: '', hasData: core().hasData(readJSON(GUEST_KEY)) }];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(`${GUEST_KEY}:`)) continue;
        const uid = key.slice(GUEST_KEY.length + 1);
        if (!core().isValidUid(uid)) continue;
        const d = readJSON(key);
        const who = (d && d.settings && d.settings.account) || {};
        out.push({ uid, email: String(who.email || ''), name: String(who.name || ''), hasData: core().hasData(d) });
      }
      return Promise.resolve(out);
    },
    // Данные чужой области, не открывая её, — перенос «Без аккаунта» в аккаунт.
    dataPeek: (uid) => Promise.resolve(readJSON(keyOf(uid))),
    dataWrite: (uid, data) => {
      localStorage.setItem(keyOf(uid), JSON.stringify(data));
      return Promise.resolve(true);
    },
    // Стереть копию данных аккаунта с устройства. Гостя этим не стереть.
    dataRemove: (uid) => {
      if (keyOf(uid) === GUEST_KEY) return Promise.resolve(false);
      localStorage.removeItem(keyOf(uid));
      return Promise.resolve(true);
    },
    copy: (text) => navigator.clipboard.writeText(String(text ?? '')),
    setTitlebarOverlay: () => Promise.resolve(true), // на вебе нет нативного заголовка окна

    // Версия — та же строка, что на десктопе: version.js собирается из
    // корневого package.json (scripts/sync-web-assets.js), десктоп берёт её у
    // main-процесса. Грузится раньше этого файла (см. index.html).
    getVersion: () => Promise.resolve(window.__LANCIBLE_VERSION__ || ''),

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

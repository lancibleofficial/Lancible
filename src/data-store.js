// Данные десктопа на диске: области аккаунтов и список аккаунтов.
//
// С 17 октября 2026 на одном устройстве может быть несколько аккаунтов, и у
// каждого своя область данных (core/accounts.js, dataFileName): гость — как
// и раньше data.json, его данные никуда не переезжают; аккаунт —
// data-<uid>.json рядом. Список аккаунтов с сеансами неактивных —
// accounts.json там же, в userData, где supabase-js держит сеанс текущего.
//
// Отдельным файлом, а не внутри main.js, — чтобы смоук (scripts/smoke.js)
// гонял по временной папке ровно этот код, а не свою копию.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { dataFileName, isValidUid } = require('./renderer/core/accounts.js');
const { hasData } = require('./renderer/core/sync.js');

const EMPTY_STATE = { tasks: [], activeTimer: null };

const readJSON = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
};

/** Атомарная запись: сначала соседний .tmp, потом замена — сбой посреди
 *  записи не оставит полфайла. */
function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * @param {string} dir         папка данных (userData)
 * @param {{ legacyFile?: string }} opts
 *        legacyFile — data.json со старого имени приложения: его забирает
 *        только гость, аккаунтов тогда не было.
 */
function createDataStore(dir, { legacyFile } = {}) {
  const guestFile = path.join(dir, 'data.json');
  const accountsFile = path.join(dir, 'accounts.json');
  const deviceFile = path.join(dir, 'device.json');
  let file = guestFile;
  let device = null;

  function load() {
    const own = readJSON(file);
    if (own) return own;
    if (file === guestFile && legacyFile) {
      try {
        if (fs.existsSync(legacyFile)) {
          const data = JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
          writeAtomic(guestFile, data); // переносим в папку нового имени
          return data;
        }
      } catch { /* начнём с чистого состояния */ }
    }
    return structuredClone(EMPTY_STATE);
  }

  return {
    load,
    save: (data) => { writeAtomic(file, data); return true; },
    /** uid аккаунта или null — гость. Всё, что не годится в uid, — гость: из
     *  uid складывается имя файла, и «../» не выведет запись из папки. */
    setScope: (uid) => { file = path.join(dir, dataFileName(isValidUid(uid) ? uid : null)); return true; },
    scopeFile: () => file,
    /** Данные области без смены текущей — теме окна до первой загрузки и
     *  переносу «Без аккаунта» в аккаунт. */
    peek: (uid) => readJSON(path.join(dir, dataFileName(isValidUid(uid) ? uid : null))),
    write: (uid, data) => { writeAtomic(path.join(dir, dataFileName(isValidUid(uid) ? uid : null)), data); return true; },
    /** Какие области лежат на устройстве: гость и аккаунты, в том числе те,
     *  из которых вышли. Подпись — settings.account внутри области. */
    listScopes() {
      const out = [{ uid: null, email: '', name: '', hasData: hasData(readJSON(guestFile)) }];
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* папки ещё нет */ }
      for (const name of names) {
        const m = /^data-(.+)\.json$/.exec(name);
        if (!m || !isValidUid(m[1])) continue;
        const d = readJSON(path.join(dir, name));
        const who = (d && d.settings && d.settings.account) || {};
        out.push({ uid: m[1], email: String(who.email || ''), name: String(who.name || ''), hasData: hasData(d) });
      }
      return out;
    },
    /** Стереть копию данных аккаунта. Гостя этим не стереть. */
    removeScope(uid) {
      if (!isValidUid(uid)) return false;
      try { fs.rmSync(path.join(dir, dataFileName(uid)), { force: true }); } catch { return false; }
      return true;
    },
    loadAccounts: () => readJSON(accountsFile),
    saveAccounts: (acc) => { writeAtomic(accountsFile, acc); return true; },
    /** Случайный id этой установки (журнал правок, 17 октября 2026): по нему
     *  устройство отличает свои правки от чужих, а окно конфликта говорит, с
     *  какого устройства версия. Один на установку, не на аккаунт — файл
     *  device.json рядом со списком аккаунтов. В нём только система
     *  («win-», «mac-», «linux-») и случайный uuid: о человеке и железе — ничего. */
    deviceId() {
      if (device) return device;
      const own = readJSON(deviceFile);
      if (own && typeof own.id === 'string' && /^[a-z]+-[0-9a-f-]{36}$/.test(own.id)) { device = own.id; return device; }
      const os = { win32: 'win', darwin: 'mac' }[process.platform] || 'linux';
      device = `${os}-${crypto.randomUUID()}`;
      try { writeAtomic(deviceFile, { id: device }); } catch { /* не записался — id на этот запуск */ }
      return device;
    },
  };
}

/** Обработчики областей и списка аккаунтов — одни у main.js и смоука.
 *  data:load и data:save каждый ставит сам: у смоука там своя подмена. */
function registerAccountHandlers(ipcMain, store) {
  ipcMain.handle('data:scope', (_e, uid) => store.setScope(uid));
  ipcMain.handle('data:scopes', () => store.listScopes());
  ipcMain.handle('data:remove', (_e, uid) => store.removeScope(uid));
  ipcMain.handle('data:peek', (_e, uid) => store.peek(uid));
  ipcMain.handle('data:write', (_e, uid, data) => store.write(uid, data));
  ipcMain.handle('accounts:load', () => store.loadAccounts());
  ipcMain.handle('accounts:save', (_e, acc) => store.saveAccounts(acc));
  ipcMain.handle('device:id', () => store.deviceId());
}

module.exports = { createDataStore, registerAccountHandlers, EMPTY_STATE };

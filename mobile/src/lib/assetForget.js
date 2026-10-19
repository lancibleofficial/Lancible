// Очередь «стереть картинки аккаунта с устройства» (19 октября 2026, протокол
// 5 редактора, src/editor/host.js: assets-forget).
//
// «Удалить данные аккаунта с устройства» (store/useAuthStore.js:
// forgetDeviceData) стирает копию данных и переписку с агентом сразу, а
// картинки редактора живут в IndexedDB страницы WebView — стереть их может
// только открытая страница редактора. Открытой сейчас может не быть, поэтому
// uid встаёт в очередь, очередь лежит в AsyncStorage (переживает перезапуск),
// и ближайший редактор (components/DocEditor.js) шлёт
// { type: 'assets-forget', userId } по своему ready, а uid уходит из очереди
// по ответу { type: 'assets-forgotten', userId }. Хранилище картинок у всех
// страниц редактора общее — хватает одного ответа.
//
// Аккаунт снова открыли на этом телефоне раньше, чем очередь дошла до
// редактора, — uid из очереди уходит (dropAssetForget при открытии области):
// иначе редактор стёр бы картинки, вставленные уже после возвращения.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import Accounts from '../core/accounts.js';

export const ASSET_FORGET_KEY = 'lancible-asset-forget';

/** uids — чьи картинки стереть; loaded — очередь из хранилища прочитана. */
export const useAssetForget = create(() => ({ uids: [], loaded: false }));

const clean = (list) => [...new Set((Array.isArray(list) ? list : []).filter(Accounts.isValidUid))];

let loading = null;
let writing = Promise.resolve();

/** Прочитать очередь из хранилища и слить с той, что в памяти. Зовётся на
 *  импорте и перед каждой правкой (первая правка ждёт чтения, чтобы не
 *  переписать сохранённое пустым). */
export function loadAssetForget() {
  loading = AsyncStorage.getItem(ASSET_FORGET_KEY)
    .then((raw) => {
      let stored = [];
      try { stored = clean(JSON.parse(raw || '[]')); } catch { stored = []; }
      useAssetForget.setState((s) => ({ uids: clean([...stored, ...s.uids]), loaded: true }));
    })
    .catch((err) => {
      console.error('Не удалось прочитать очередь стирания картинок:', err);
      useAssetForget.setState({ loaded: true });
    });
  return loading;
}

function save() {
  const json = JSON.stringify(useAssetForget.getState().uids);
  writing = writing
    .then(() => AsyncStorage.setItem(ASSET_FORGET_KEY, json))
    .catch((err) => console.error('Не удалось сохранить очередь стирания картинок:', err));
  return writing;
}

/** Поставить аккаунт uid в очередь: его картинки сотрёт ближайший редактор. */
export async function queueAssetForget(uid) {
  if (!Accounts.isValidUid(uid)) return;
  await (loading || loadAssetForget());
  if (useAssetForget.getState().uids.includes(uid)) return;
  useAssetForget.setState((s) => ({ uids: [...s.uids, uid] }));
  await save();
}

/** Снять uid с очереди: редактор ответил assets-forgotten или аккаунт снова
 *  открыт на этом телефоне. */
export async function dropAssetForget(uid) {
  await (loading || loadAssetForget());
  if (!useAssetForget.getState().uids.includes(uid)) return;
  useAssetForget.setState((s) => ({ uids: s.uids.filter((x) => x !== uid) }));
  await save();
}

loadAssetForget();

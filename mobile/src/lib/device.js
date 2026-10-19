// Идентификатор установки (17 октября 2026, журнал правок — core/oplog.js).
//
// Случайный uuid с приставкой платформы ('android-…' / 'ios-…'), один на
// установку приложения: не на аккаунт и не на железо. По приставке окно
// конфликта пишет, откуда версия («Android», «iPhone»; у веба — 'web-', у
// десктопа — 'win-' / 'mac-' / 'linux-'). По нему журнал отличает свои
// правки от чужих (свои, вернувшиеся с сервера, только подтверждаются).
// Персональных данных в нём нет; переустановка
// приложения — новый id. Лежит в AsyncStorage под `lancible-device`, рядом с
// областями данных, но не в них: у всех аккаунтов телефона он один.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEVICE_KEY = 'lancible-device';

let current = null;
let loading = null;

/** uuid v4. На Hermes crypto.randomUUID может не быть — тогда
 *  getRandomValues, без него Math.random: id — не секрет, а метка. */
export function randomUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    const u = new Uint8Array(16);
    c.getRandomValues(u);
    for (let i = 0; i < 16; i++) b[i] = u[i];
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => (x + 0x100).toString(16).slice(1)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Колонка device_id в журнале — текст от 1 до 100 знаков (supabase/sync2.sql).
const VALID = /^(android|ios)-[0-9a-f-]{36}$/i;
const prefix = () => (Platform.OS === 'ios' ? 'ios' : 'android');

/** Прочитать (или завести) id установки. Хранилище не прочиталось — id на
 *  этот запуск, без записи: перезаписать настоящий из-за сбоя чтения нельзя,
 *  иначе свои правки прошлых запусков стали бы для телефона чужими. */
export function loadDeviceId() {
  if (current) return Promise.resolve(current);
  if (!loading) {
    loading = (async () => {
      let stored = null;
      let readable = true;
      try {
        stored = await AsyncStorage.getItem(DEVICE_KEY);
      } catch (err) {
        readable = false;
        console.error('Не удалось прочитать id установки:', err);
      }
      if (stored && VALID.test(stored)) {
        current = stored;
        return current;
      }
      const id = `${prefix()}-${randomUuid()}`;
      if (readable) {
        try {
          await AsyncStorage.setItem(DEVICE_KEY, id);
        } catch (err) {
          console.error('Не удалось сохранить id установки:', err);
        }
      }
      current = id;
      return current;
    })().finally(() => { loading = null; });
  }
  return loading;
}

/** id установки, если уже прочитан (иначе null — см. loadDeviceId). */
export const deviceId = () => current;

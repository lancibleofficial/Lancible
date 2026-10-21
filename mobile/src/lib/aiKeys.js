// Ключи переписки с агентом в AsyncStorage (lib/aiChat.js, круг 20, 18 октября
// 2026). Отдельно от aiChat.js, чтобы стирание данных аккаунта с телефона
// (lib/accounts.js: removeScope) знало их, не таща за собой чат целиком:
//
//   lancible-ai:<uid>             прежняя одиночная история (до 18 октября)
//   lancible-ai:<uid>:chats       индекс чатов аккаунта
//   lancible-ai:<uid>:chat:<id>   сообщения одного чата
//   lancible-ai:<uid>:access-request  запрос доступа к агенту ушёл
//                                 (lib/aiAccess.js, 21 октября 2026)

/** Прежняя одиночная история аккаунта (до 18 октября 2026) — только для переноса. */
export const aiKey = (id) => `lancible-ai:${id}`;
/** Индекс чатов аккаунта. */
export const aiChatsKey = (id) => `lancible-ai:${id}:chats`;
/** Сообщения одного чата. */
export const aiChatKey = (id, chatId) => `lancible-ai:${id}:chat:${chatId}`;
/** Запрос доступа к агенту с этого устройства ушёл: { at } — когда. */
export const aiRequestKey = (id) => `lancible-ai:${id}:access-request`;

/** Ключ переписки аккаунта uid — ровно его: у uid «u1» не берётся «u10». */
export const isAiKeyOf = (key, uid) => !!uid && (key === aiKey(uid) || String(key).startsWith(`${aiKey(uid)}:`));

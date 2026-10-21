// Доступ к ИИ-агенту в тестах (21 октября 2026). Не тест — помощник: jest
// берёт только *.test.js.
//
// Агент открыт по приглашению: экраны спрашивают базу RPC ai_has_access
// (lib/aiAccess.js). Настоящей базы в Node нет, поэтому sb.rpc подменяется:
// 'ai_has_access' отвечает тем, что сказал тест, остальные вызовы идут как
// шли. Память о доступе (кто уже проверен) и отметки о запросе — с чистого
// листа, иначе прошлый тест подсказал бы ответ следующему.
//
//   grantAi()            доступ есть — чат как раньше
//   grantAi(false)       закрытый тест
//   grantAi(() => v)     ответ на каждый вызов свой (можно промис — ответ,
//                        которого ещё нет)
//   grantAi({ error })   база не ответила
//
// @returns шпион sb.rpc (mockRestore — в afterEach)

const { sb } = require('../../src/lib/supabaseClient');
const { useAiAccess } = require('../../src/lib/aiAccess');

function grantAi(answer = true) {
  useAiAccess.setState({ by: {}, sent: {} });
  const real = sb.rpc.bind(sb);
  return jest.spyOn(sb, 'rpc').mockImplementation(async (name, ...rest) => {
    if (name !== 'ai_has_access') return real(name, ...rest);
    const v = await (typeof answer === 'function' ? answer() : answer);
    if (v && typeof v === 'object' && v.error) return { data: null, error: v.error };
    return { data: v, error: null };
  });
}

/** Вызовы RPC ai_has_access у шпиона. */
const accessCalls = (spy) => spy.mock.calls.filter(([name]) => name === 'ai_has_access').length;

module.exports = { grantAi, accessCalls };

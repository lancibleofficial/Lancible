// Статика админки, которая грузится по требованию: текст раздела
// «Устройство» (content/architecture.html), данные графа (graph/graph.json) и
// библиотека графа (vendor/). Всё — со своего адреса: политика сайта
// (vercel.json) пускает скрипты и запросы только к нему и к Supabase.
//
// Ошибки — те же ApiError, что у функции admin: errorBox из ui.js говорит
// «нет связи» про сеть и «HTTP 404» про сервер.
import { ApiError } from './api.js';

/** Файл админки текстом или JSON. Без кэша браузера: после выката раздел
 *  видит свежий граф, а не прошлый. */
export async function fetchStatic(path, as = 'text') {
  let res;
  try {
    res = await fetch(path, { cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new ApiError('network', 'network');
  }
  if (!res.ok) throw new ApiError('server', `HTTP ${res.status}`, res.status);
  try {
    return as === 'json' ? await res.json() : await res.text();
  } catch {
    throw new ApiError('server', 'bad body', res.status, 'bad body');
  }
}

const scripts = new Map();

/** Скрипт со своего адреса — один раз на вкладку. → Promise, который
 *  выполняется, когда скрипт отработал. Не загрузился — следующий вызов
 *  пробует снова. */
export function loadScript(src, { beforeLoad, afterLoad } = {}) {
  if (scripts.has(src)) return scripts.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    const done = (ok) => {
      if (afterLoad) afterLoad();
      if (ok) resolve();
      else {
        scripts.delete(src);
        el.remove();
        reject(new ApiError('network', 'network'));
      }
    };
    el.addEventListener('load', () => done(true), { once: true });
    el.addEventListener('error', () => done(false), { once: true });
    if (beforeLoad) beforeLoad();
    document.body.append(el);
  });
  scripts.set(src, p);
  return p;
}

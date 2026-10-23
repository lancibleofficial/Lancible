// Устройство: как устроен Lancible — четыре поверхности, ядро, данные, дизайн,
// выкат и проверка. До 23 октября 2026 это была служебная страница
// /architecture лендинга; теперь — раздел админки.
//
// Текст — статикой из content/architecture.html (числа в нём пересчитывает
// npm run site:refresh, число файлов ядра сторожит
// tests/unit/architecture.test.js) и грузится, только когда раздел открыт.
// Разметка — наш же файл, без данных пользователей; скриптов и стилей строкой
// в нём нет (политика сайта их и не пустит), а на всякий случай разбор их
// выбрасывает.
import { h, page, loadInto } from '../ui.js';
import { fetchStatic } from '../static.js';

// Без .html: сайт отдаёт страницы чистыми адресами (cleanUrls в vercel.json), и
// адрес с .html ответил бы перенаправлением; локальный сервер понимает оба.
export const CONTENT = 'content/architecture';

/** Текст файла → узлы для раздела. Без исполняемого и без стилей строкой. */
export function contentNodes(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.body.querySelectorAll('script, style, link, iframe, object, embed, base, meta')) el.remove();
  for (const el of doc.body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || a.name === 'style') el.removeAttribute(a.name);
  }
  return [...doc.body.childNodes].map((n) => document.importNode(n, true));
}

export function mount(root) {
  const { body } = page(root, 'Устройство');
  const box = h('div', { class: 'arch', id: 'arch' });
  body.append(box);
  loadInto(box, () => fetchStatic(CONTENT), (html) => {
    box.replaceChildren(...contentNodes(html));
  });
}

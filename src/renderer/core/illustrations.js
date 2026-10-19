/* Иллюстрации пустых экранов — один набор сценок на десктоп, веб и телефон.
 *
 * Сценка — несколько простых форм: подложка-круг, листы, линии на них и
 * одно маленькое пятно акцента. Цвета здесь нет ни одного: у каждой формы
 * класс, а заливку ему даёт styles.css из токенов палитры (--art-plate,
 * --art-sheet, --art-ink, --accent) — поэтому сценка сама верна обеим темам
 * и лежит одинаково на земле и на острове. Где что — DESIGN.md, «Пустой
 * экран».
 *
 * Рамка у всех сценок одна, 120 × 88: на большом пустом экране она такая и
 * есть, в компактном (.empty-state-sm) CSS ужимает её до 56 × 40. Мелких
 * деталей поэтому нет — линия тоньше трёх единиц на компактном пропала бы.
 *
 * Телефону файл приезжает побайтной копией (scripts/sync-mobile-core.js):
 * mobile/src/lib/art.js разбирает ту же разметку и красит роли из theme.js.
 * Новая сценка рисуется здесь — и сразу есть на всех поверхностях.
 */
(function (global) {
  const ART_VIEWBOX = '0 0 120 88';

  /** Части сценки. Класс — роль формы, цвет роли — в styles.css. */
  const ART_PARTS = ['es-plate', 'es-sheet', 'es-back', 'es-ink', 'es-ink-soft', 'es-dash', 'es-mark', 'es-caret', 'es-on-mark'];

  const rect = (cls, x, y, w, h, rx, extra) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"${extra || ''}/>`;
  const circle = (cls, cx, cy, r) => `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}"/>`;
  const path = (cls, d) => `<path class="${cls}" d="${d}"/>`;
  /** Четырёхлучевая искра с вогнутыми сторонами — акцент «здесь что-то
   *  появится», без единой мелкой детали. */
  const spark = (cx, cy, s) => path('es-mark',
    `M${cx} ${cy - s}Q${cx} ${cy} ${cx + s} ${cy}Q${cx} ${cy} ${cx} ${cy + s}Q${cx} ${cy} ${cx - s} ${cy}Q${cx} ${cy} ${cx} ${cy - s}Z`);
  /** Подложка — мягкий «камешек» во всю рамку. Формы держатся внутри него:
   *  в светлой теме белый лист на белом острове без подложки пропал бы. */
  const plate = () => path('es-plate', 'M57 5C86 3 113 15 114 42C115 69 93 85 63 84C33 83 6 72 6 46C6 20 29 7 57 5Z');

  const SCENES = {
    /** Проекты: колода карточек, как на экране «Проекты», — передняя с
     *  цветом проекта, названием, прогрессом и пунктирным местом под задачу. */
    projects: () => [
      plate(),
      rect('es-sheet es-back', 40, 22, 40, 50, 8, ' transform="rotate(-12 60 47) translate(-17 3)"'),
      rect('es-sheet es-back', 40, 22, 40, 50, 8, ' transform="rotate(10 60 47) translate(17 1)"'),
      rect('es-sheet', 38, 17, 44, 56, 8),
      rect('es-mark', 45, 24, 8, 8, 2.5),
      rect('es-ink', 56, 25.5, 19, 5, 2.5),
      rect('es-ink-soft', 45, 37, 24, 4, 2),
      rect('es-ink-soft', 45, 45, 30, 3, 1.5),
      rect('es-ink', 45, 45, 13, 3, 1.5),
      rect('es-dash', 45, 54, 30, 12, 3.5),
      spark(96, 17, 6),
    ].join(''),

    /** Документы: лист с загнутым углом, заголовок и строки, на последней —
     *  мигающий курсор акцентом: «начните писать». */
    docs: () => [
      plate(),
      rect('es-sheet es-back', 50, 15, 38, 50, 7, ' transform="rotate(11 69 40)"'),
      path('es-sheet', 'M38 17H63L76 30V67A6 6 0 0 1 70 73H38A6 6 0 0 1 32 67V23A6 6 0 0 1 38 17Z'),
      path('es-ink-soft', 'M63 17V26A4 4 0 0 0 67 30H76Z'),
      rect('es-ink', 39, 28, 17, 5, 2.5),
      rect('es-ink-soft', 39, 40, 29, 3.5, 1.75),
      rect('es-ink-soft', 39, 48, 24, 3.5, 1.75),
      rect('es-ink-soft', 39, 56, 13, 3.5, 1.75),
      rect('es-mark es-caret', 55, 53, 2.5, 9, 1.25),
      spark(97, 62, 5),
    ].join(''),

    /** Время: листок календаря с отмеченным «сегодня» и часы у его угла.
     *  Вокруг часов — кольцо цвета подложки: белое на белом в светлой теме
     *  иначе слилось бы. */
    time: () => [
      plate(),
      rect('es-sheet', 22, 22, 54, 46, 8),
      path('es-ink', 'M30 22H68A8 8 0 0 1 76 30V33H22V30A8 8 0 0 1 30 22Z'),
      rect('es-sheet', 32, 16, 4, 10, 2),
      rect('es-sheet', 62, 16, 4, 10, 2),
      ...[0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((col) => {
        const x = 28 + col * 11;
        const y = 39 + row * 9;
        return row === 1 && col === 2 ? rect('es-mark', x, y, 8, 6, 2) : rect('es-ink-soft', x, y, 8, 6, 2);
      })),
      circle('es-plate', 86, 58, 19),
      circle('es-sheet', 86, 58, 15.5),
      rect('es-ink', 84.75, 47.5, 2.5, 11.5, 1.25),
      rect('es-ink', 85, 56.75, 10, 2.5, 1.25),
      circle('es-ink', 86, 58, 2.5),
    ].join(''),

    /** Уведомления (компактный образец): колокольчик и галочка акцентом —
     *  «всё спокойно, ждать нечего». */
    bell: () => [
      plate(),
      circle('es-sheet', 60, 20, 3.5),
      path('es-sheet', 'M60 21C49 21 42 29 42 40V49L37 57A2 2 0 0 0 39 60H81A2 2 0 0 0 83 57L78 49V40C78 29 71 21 60 21Z'),
      rect('es-ink-soft', 46, 48, 28, 3, 1.5),
      circle('es-ink', 60, 66, 5),
      circle('es-mark', 80, 26, 8),
      path('es-on-mark', 'M76.2 26.3L78.9 29L83.9 23.6L82.6 22.4L78.9 26.4L77.5 25Z'),
    ].join(''),

    /** Задачи: лист-чеклист, первая строка отмечена акцентом, остальные ждут;
     *  за ним второй лист. */
    tasks: () => [
      plate(),
      rect('es-sheet es-back', 48, 16, 40, 52, 7, ' transform="rotate(10 68 42)"'),
      rect('es-sheet', 30, 18, 50, 56, 8),
      rect('es-mark', 37, 26, 10, 10, 3),
      path('es-on-mark', 'M39.6 30.9L41.6 32.9L45 29.2L43.9 28.2L41.6 30.7L40.7 29.8Z'),
      rect('es-ink-soft', 51, 29, 22, 4, 2),
      rect('es-ink-soft', 37, 41, 10, 10, 3),
      rect('es-ink', 51, 44, 20, 4, 2),
      rect('es-ink-soft', 37, 56, 10, 10, 3),
      rect('es-ink', 51, 59, 15, 4, 2),
      spark(94, 66, 5),
    ].join(''),

    /** Фильтр: воронка, над ней — то, что в неё падает; снизу не выходит
     *  ничего. Искра — «отбор включён». */
    filter: () => [
      plate(),
      circle('es-ink-soft', 44, 15, 4),
      rect('es-ink-soft', 54, 9, 9, 9, 2.5),
      circle('es-ink-soft', 73, 14, 4),
      path('es-sheet', 'M31 22H89A4 4 0 0 1 91.9 28.8L69 52.6V69.4A3 3 0 0 1 67.2 72.1L55.2 77.4A2.5 2.5 0 0 1 51.7 75.1V52.6L28.1 28.8A4 4 0 0 1 31 22Z'),
      rect('es-ink', 39, 26.5, 42, 4, 2),
      spark(97, 58, 5),
    ].join(''),

    /** Записи времени: секундомер, прошедшая четверть — сектор акцентом,
     *  стрелка на его краю. */
    timer: () => [
      plate(),
      rect('es-sheet', 54, 12, 12, 6, 3),
      rect('es-sheet', 58, 16, 4, 10, 2),
      rect('es-sheet', 77, 26, 9, 5, 2.5, ' transform="rotate(45 81.5 28.5)"'),
      circle('es-sheet', 60, 50, 26),
      rect('es-ink-soft', 58.75, 27, 2.5, 5, 1.25),
      rect('es-ink-soft', 78, 48.75, 5, 2.5, 1.25),
      rect('es-ink-soft', 58.75, 68, 2.5, 5, 1.25),
      rect('es-ink-soft', 37, 48.75, 5, 2.5, 1.25),
      path('es-mark', 'M60 50V34A16 16 0 0 1 76 50Z'),
      rect('es-ink', 58.75, 35, 2.5, 16, 1.25, ' transform="rotate(90 60 50)"'),
      circle('es-ink', 60, 50, 3.5),
    ].join(''),

    /** Поиск: лист со строками и лупа над его краем. Между ними кольцо цвета
     *  подложки — как у часов в сценке «Время». */
    search: () => [
      plate(),
      rect('es-sheet', 24, 16, 46, 56, 8),
      rect('es-ink', 31, 25, 20, 5, 2.5),
      rect('es-ink-soft', 31, 36, 30, 3.5, 1.75),
      rect('es-ink-soft', 31, 44, 24, 3.5, 1.75),
      rect('es-ink-soft', 31, 52, 16, 3.5, 1.75),
      circle('es-plate', 72, 47, 19.5),
      circle('es-ink', 72, 47, 16),
      circle('es-sheet', 72, 47, 11.5),
      rect('es-ink-soft', 65, 43.5, 14, 3.5, 1.75),
      rect('es-ink-soft', 65, 50, 9, 3.5, 1.75),
      rect('es-ink', 85.5, 56, 7, 16, 3.5, ' transform="rotate(-45 89 64)"'),
      spark(97, 22, 5),
    ].join(''),

    /** Теги: бирка с отверстием-акцентом, за ней — вторая, наискосок. */
    tags: () => [
      plate(),
      rect('es-sheet es-back', 28, 18, 46, 28, 7, ' transform="rotate(-14 51 32)"'),
      path('es-sheet', 'M30 28A6 6 0 0 1 36 22H70.5A6 6 0 0 1 74.7 23.8L90.2 39.3A6 6 0 0 1 90.2 47.7L74.7 63.2A6 6 0 0 1 70.5 65H36A6 6 0 0 1 30 59Z'),
      circle('es-mark', 78, 43.5, 5),
      rect('es-ink', 37, 32, 24, 5, 2.5),
      rect('es-ink-soft', 37, 43, 18, 4, 2),
      rect('es-ink-soft', 37, 52, 12, 4, 2),
      spark(98, 66, 5),
    ].join(''),

    /** Версии: стопка выпусков, на верхнем — метка версии акцентом. Слои
     *  разделены кольцом цвета подложки, иначе листы слились бы в один. */
    versions: () => [
      plate(),
      rect('es-sheet es-back', 40, 58, 40, 13, 6),
      rect('es-plate', 32, 45, 56, 18, 8),
      rect('es-sheet', 34, 47, 52, 14, 6.5),
      rect('es-plate', 26, 17, 68, 34, 9.5),
      rect('es-sheet', 28, 19, 64, 30, 8),
      rect('es-mark', 35, 26, 20, 7, 3.5),
      rect('es-ink', 59, 27, 24, 5, 2.5),
      rect('es-ink-soft', 35, 38, 40, 3.5, 1.75),
    ].join(''),

    /** Чат с агентом (19 октября 2026, главный экран чата): облачко вопроса
     *  со строками и под ним облачко ответа, который пишется, — три точки.
     *  Облачка разделены кольцом цвета подложки, искра — «спроси». */
    chat: () => [
      plate(),
      path('es-sheet', 'M30 17H64A9 9 0 0 1 73 26V39A9 9 0 0 1 64 48H38L28 56V47.2A9 9 0 0 1 21 39V26A9 9 0 0 1 30 17Z'),
      rect('es-ink', 29, 25, 26, 5, 2.5),
      rect('es-ink-soft', 29, 35, 36, 4, 2),
      rect('es-plate', 46, 41, 56, 31, 12),
      path('es-sheet', 'M58 44H90A9 9 0 0 1 99 53V58A9 9 0 0 1 93.6 66.3L97 74L86.6 67H58A9 9 0 0 1 49 58V53A9 9 0 0 1 58 44Z'),
      circle('es-ink-soft', 63, 55.5, 3),
      circle('es-ink-soft', 73, 55.5, 3),
      circle('es-ink', 83, 55.5, 3),
      spark(94, 22, 6),
    ].join(''),
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /** Формы сценки разметкой — чтобы вписать их в готовый <svg data-art>. */
  function artShapes(name) {
    const scene = SCENES[name];
    return scene ? scene() : '';
  }

  /** <svg> сценки для строк HTML. Картинка декоративная: что пусто, говорят
   *  заголовок и текст рядом, поэтому скринридеру она не нужна. */
  function artSvg(name, cls) {
    if (!SCENES[name]) return '';
    return `<svg class="${esc(cls || 'es-art')}" data-art="${esc(name)}" viewBox="${ART_VIEWBOX}" aria-hidden="true" focusable="false">${artShapes(name)}</svg>`;
  }

  const api = { ART_VIEWBOX, ART_PARTS, ART_SCENES: Object.keys(SCENES), artShapes, artSvg };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

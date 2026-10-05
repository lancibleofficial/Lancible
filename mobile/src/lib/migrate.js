// Форма состояния телефона и её починка при загрузке — тонкий слой над ядром.
//
// Сама миграция лежит в src/core/migrate.js, побайтной копии десктопного
// ядра (scripts/sync-mobile-core.js, сверка — tests/unit/mobile-core.test.js).
// Раньше здесь была своя реализация тех же правил, и две копии успели
// разойтись — в обе стороны:
//
//   • телефон чинил sessions и totalMs, а десктоп нет: задача с
//     sessions: null роняла десктоп на первом же подсчёте времени;
//   • десктоп чинил статусы неизвестного вида, нумеровал версии подряд,
//     выбрасывал мусор вместо правила повторения и выводил «отменена» из
//     статуса — телефон ничего этого не делал.
//
// Это самая опасная функция в приложении: она трогает всё, что пользователь
// накопил, при каждом запуске, и её ошибка необратима. Держать её в двух
// экземплярах значило ждать, когда они разойдутся в следующий раз.
//
// Своим здесь остаётся только то, что у телефона и правда своё: генератор
// идентификаторов, начальная форма состояния и поля интерфейса — положение
// доски, проект быстрого добавления, подсказка про свайп. Ядро их не знает и
// знать не должно; оно даёт для них крючок и список живых проектов.
import { T, t } from './i18n';
import Catalog from '../core/catalog.js';
import Core from '../core/migrate.js';

// Справочники продукта — палитра, валюты, ключ имени проекта — общие с
// десктопом (src/core/catalog.js). Экспортируются отсюда по-прежнему: на них
// ссылаются экраны выбора цвета и настроек.
export const { DEFAULT_PROJECT_NAME_KEY, PALETTE, CURRENCIES, SYM2CODE } = Catalog;

export function uid() {
  return (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function emptyState() {
  return {
    projects: [],
    tasks: [],
    // Теги общие на всё приложение — такие же пользовательские данные, как
    // проекты и задачи, и ездят в синхронизации вместе с ними.
    tags: [],
    // Статусы принадлежат проекту и задают столбцы доски. Версии тоже
    // принадлежат проекту: «в какой выпуск это уезжает».
    statuses: [],
    versions: [],
    activeTimer: null,
    // boardVersion и boardCollapsed — положение доски, по проекту:
    // какой отбор по версии выбран и какие ряды свёрнуты. Живут в ui,
    // а значит остаются на устройстве и не ездят в синхронизации.
    ui: {
      view: 'home', projectId: null, boardProjectId: null,
      boardVersion: {}, boardCollapsed: {},
      quickAddProjectId: null, homeSwipeHintShown: false,
    },
    settings: { hourlyRate: 0, currency: 'RUB', theme: 'system', lang: 'ru', syncEnabled: true, notifyEnabled: true, syncResolvedFor: null },
  };
}

/** Поля интерфейса телефона. Ссылки на проекты в них чинятся по списку
 *  живых проектов, который даёт ядро: мусор из старого хранилища не должен
 *  ронять экран, а проект, удалённый на другом устройстве, — оставлять доску
 *  смотреть в пустоту. */
function fixUi(state, { known, fallback }) {
  if (!known.has(state.ui.boardProjectId)) state.ui.boardProjectId = fallback;
  if (!known.has(state.ui.quickAddProjectId)) state.ui.quickAddProjectId = fallback;
  state.ui.homeSwipeHintShown = !!state.ui.homeSwipeHintShown;

  // Положение доски хранится по проектам — записи исчезнувших выбрасываются.
  const byProject = (value) => {
    if (!value || typeof value !== 'object') return {};
    const out = {};
    for (const id of Object.keys(value)) if (known.has(id)) out[id] = value[id];
    return out;
  };
  state.ui.boardVersion = byProject(state.ui.boardVersion);
  state.ui.boardCollapsed = byProject(state.ui.boardCollapsed);
  for (const id of Object.keys(state.ui.boardCollapsed)) {
    if (!Array.isArray(state.ui.boardCollapsed[id])) state.ui.boardCollapsed[id] = [];
  }
}

/** Нормализует загруженное состояние на месте и возвращает его же. */
export function migrate(state) {
  return Core.migrate(state, {
    // Язык читается в момент вызова, а не заранее: ядро сперва чинит
    // settings.lang и только потом зовёт перевод — для имён статусов и
    // проекта по умолчанию.
    t: (key) => t(state.settings.lang, key),
    uid,
    langs: Object.keys(T),
    palette: PALETTE,
    currencies: CURRENCIES,
    sym2code: SYM2CODE,
    defaultProjectNameKey: DEFAULT_PROJECT_NAME_KEY,
    ui: fixUi,
  });
}

// Заметки хранятся в общем формате Quill Delta (совместимо с десктопом/
// вебом) — RichTextEditor.js читает/пишет task.notes как есть (массив ops),
// без промежуточного текстового представления.

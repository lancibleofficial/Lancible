// Порт формы state + uid() + migrate() из src/renderer/app.js (app.js:7-13,
// 19-27, 621-623, 3203-3238). Чистая логика — работает над обычным объектом,
// без обращений к DOM/платформе.
import { T, t } from './i18n';

export const DEFAULT_PROJECT_NAME_KEY = 'app.default_project_name';

export const PALETTE = [
  '#87ff65', '#5ec8f2', '#b98cf0', '#f5c451', '#f0736b', '#f58cc0', '#a4c2a8', '#8a93a5',
  '#e63950', '#2dd4bf', '#5468ff', '#ff9142', '#d946a8', '#6ee7b7', '#c8956d', '#6b7cad',
];

export const CURRENCIES = {
  USD: '$', EUR: '€', GBP: '£', RUB: '₽', KZT: '₸',
  UAH: '₴', KGS: 'сом', BYN: 'Br', PLN: 'zł', TRY: '₺',
};
export const SYM2CODE = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₽': 'RUB', '₸': 'KZT', '₴': 'UAH', '₺': 'TRY', 'Br': 'BYN', 'zł': 'PLN' };

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
    // Статусы и версии мобильное приложение пока не показывает, но обязано
    // не терять: они приходят с десктопа и должны уехать обратно целыми.
    // Здесь их только проносят через себя, не трогая содержимое.
    statuses: [],
    versions: [],
    activeTimer: null,
    ui: { view: 'home', projectId: null },
    settings: { hourlyRate: 0, currency: 'RUB', theme: 'system', lang: 'ru', syncEnabled: true, notifyEnabled: true, syncResolvedFor: null },
  };
}

/** Нормализует загруженный state в-месте (и возвращает его же) — тот же
 * набор проверок, что и в десктопной/веб-версии. */
export function migrate(state) {
  if (!Array.isArray(state.tasks)) state.tasks = [];
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!Array.isArray(state.tags)) state.tags = [];
  if (!Array.isArray(state.statuses)) state.statuses = [];
  if (!Array.isArray(state.versions)) state.versions = [];
  if (!state.ui || typeof state.ui !== 'object') state.ui = {};
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  if (!Number.isFinite(Number(state.settings.hourlyRate))) state.settings.hourlyRate = 0;
  if (!['system', 'light', 'dark'].includes(state.settings.theme)) state.settings.theme = 'system';
  if (!T[state.settings.lang]) state.settings.lang = 'ru';
  if (typeof state.settings.syncEnabled !== 'boolean') state.settings.syncEnabled = true;
  if (typeof state.settings.notifyEnabled !== 'boolean') state.settings.notifyEnabled = true;
  if (!state.settings.syncResolvedFor || typeof state.settings.syncResolvedFor !== 'object') state.settings.syncResolvedFor = null;

  let cur = state.settings.currency || 'RUB';
  if (SYM2CODE[cur]) cur = SYM2CODE[cur];
  if (!CURRENCIES[cur]) cur = 'RUB';
  state.settings.currency = cur;

  state.tags.forEach((tg, i) => {
    if (!tg.color) tg.color = PALETTE[i % PALETTE.length];
    if (typeof tg.name !== 'string') tg.name = '';
  });
  // Ссылки на исчезнувшие теги вычищаются, иначе на карточке остался бы
  // пустой бейдж: тег удалили на другом устройстве, а ссылка доехала.
  const tagIds = new Set(state.tags.map((tg) => tg.id));
  const keepTags = (arr) => (Array.isArray(arr) ? arr.filter((id) => tagIds.has(id)) : []);

  state.projects.forEach((p, i) => {
    if (!p.color) p.color = PALETTE[i % PALETTE.length];
    if (typeof p.description !== 'string') p.description = '';
    if (p.pinnedAt === undefined) p.pinnedAt = null;
    p.tagIds = keepTags(p.tagIds);
  });
  state.tasks.forEach((task) => {
    if (task.pinnedAt === undefined) task.pinnedAt = null;
    if (task.rate === undefined) task.rate = null;
    if (!Array.isArray(task.sessions)) task.sessions = [];
    if (!Number.isFinite(task.totalMs)) task.totalMs = 0;
    // Дедлайн и напоминание — те же поля и та же трактовка, что на
    // десктопе: они едут в одном блоке синхронизации (см. lib/due.js).
    if (task.dueAt === undefined) task.dueAt = null;
    if (task.remindOffsetMin === undefined) task.remindOffsetMin = null;
    if (task.remindAt === undefined) task.remindAt = null;
    if (task.notifiedAt === undefined) task.notifiedAt = null;
    task.tagIds = keepTags(task.tagIds);
  });

  if (state.projects.length === 0 && state.tasks.length > 0) {
    state.projects.push({
      id: uid(),
      name: t(state.settings.lang, DEFAULT_PROJECT_NAME_KEY),
      createdAt: new Date().toISOString(),
      color: PALETTE[0],
      description: '',
      pinnedAt: null,
    });
  }
  const known = new Set(state.projects.map((p) => p.id));
  const fallback = state.projects[0] ? state.projects[0].id : null;
  for (const task of state.tasks) if (!task.projectId || !known.has(task.projectId)) task.projectId = fallback;
  if (!known.has(state.ui.projectId)) state.ui.projectId = fallback;

  return state;
}

// Заметки хранятся в общем формате Quill Delta (совместимо с десктопом/
// вебом) — RichTextEditor.js читает/пишет task.notes как есть (массив ops),
// без промежуточного текстового представления.

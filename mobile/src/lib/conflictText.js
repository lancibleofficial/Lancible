// Конфликты и корзина словами (17 октября 2026). Сами конфликты, их версии и
// корзину ведёт ядро (core/oplog.js); здесь только подписи для листа
// «Другая версия», списков в «Данных» и тостов — те же, что у веба
// (src/renderer/app.js: fieldLabel, entityName, deviceLabel, syncWhen,
// versionValueNode), чтобы устройства называли одно и то же одинаково.
import DocCore from '../core/doc.js';
import { fmtShort, fmtDateShort } from './format';
import { hm } from './sessions';
import { ruleText } from './slotText';
import { LIST_OF } from './oplogScope';
import { t } from './i18n';

/** Подпись поля — ключ словаря. Поля без подписи — своим именем. */
export const FIELD_LABEL_KEYS = {
  title: 'sync.f_title',
  name: 'sync.f_name',
  notes: 'sync.f_notes',
  body: 'sync.f_body',
  description: 'sync.f_description',
  color: 'sync.f_color',
  sessions: 'sync.f_session',
  done: 'sync.f_done',
  projectId: 'sync.f_project',
  dueAt: 'due.label',
  statusId: 'task.status_label',
  versionId: 'version.label',
  tagIds: 'tag.pick',
  rate: 'task.rate_label',
  repeat: 'repeat.label',
  reminders: 'remind.label',
  slots: 'slot.label',
  currency: 'sync.f_currency',
  releasedAt: 'sync.f_released',
};

/** Подпись вида сущности: «Задача», «Проект»… */
export const ENTITY_LABEL_KEYS = {
  project: 'sync.k_project',
  task: 'sync.k_task',
  document: 'sync.k_document',
  status: 'sync.k_status',
  tag: 'sync.k_tag',
  version: 'sync.k_version',
};

// С какого устройства — по началу id установки (lib/device.js и у других
// клиентов: web-, win-, mac-, linux-, android-, ios-).
const DEVICE_KEYS = {
  web: 'sync.device_web', win: 'sync.device_win', mac: 'sync.device_mac', linux: 'sync.device_linux', android: 'sync.device_android', ios: 'sync.device_ios',
};

export function fieldLabel(entity, field, lang) {
  if (entity === 'document' && field === 'title') return t(lang, 'sync.f_title');
  const key = FIELD_LABEL_KEYS[field];
  return key ? t(lang, key) : field;
}

/** Подпись поля конфликта: у записи времени — «Запись времени». */
export const conflictLabel = (c, lang) => (c.sessionId ? t(lang, 'sync.f_session') : fieldLabel(c.entity, c.field, lang));

/** Поля конфликтов словами: «Название, Заметки». */
export const fieldsLabel = (list, lang) => [...new Set(list.map((c) => conflictLabel(c, lang)))].join(', ');

export const entityKind = (entity, lang) => t(lang, ENTITY_LABEL_KEYS[entity] || 'sync.k_task');

/** Сущность из стора или из корзины. @param state — состояние стора */
export function findEntity(state, entity, id) {
  const list = state && state[LIST_OF[entity]];
  const found = Array.isArray(list) ? list.find((x) => x && String(x.id) === String(id)) : null;
  if (found) return found;
  const tr = state && state.oplog && state.oplog.trash.find((x) => x && x.entity === entity && String(x.entityId) === String(id));
  return tr ? tr.data : null;
}

/** Название сущности (или записи корзины — по её данным). */
export function nameOf(entity, e, lang) {
  if (!e) return t(lang, 'task.no_name');
  if (entity === 'task') return e.title || t(lang, 'task.no_name');
  if (entity === 'document') return e.title || DocCore.docTitleGuess(DocCore.readNotes(e.body).doc) || t(lang, 'docs.untitled');
  return e.name || t(lang, 'task.no_name');
}

export const entityTitle = (state, entity, id, lang) => nameOf(entity, findEntity(state, entity, id), lang);

export function deviceLabel(id, mine, lang) {
  if (!id) return t(lang, 'sync.device_other');
  if (mine && id === mine) return t(lang, 'sync.device_this');
  if (id === 'legacy') return t(lang, 'sync.device_legacy');
  const key = DEVICE_KEYS[String(id).split('-')[0]];
  return t(lang, key || 'sync.device_other');
}

/** «17 окт., 10:05». */
export function whenText(iso, lang) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${fmtDateShort(d.toISOString(), lang)}, ${hm(d)}`;
}

const REF_LIST = { statusId: 'statuses', versionId: 'versions', projectId: 'projects' };

/** Значение версии словами. Текст заметки и документа — целиком, простым
 *  текстом (docPlainText); запись времени — промежутком и длительностью. */
export function valueText(c, value, state, lang) {
  const field = c.field;
  if (value === null || value === undefined || value === '') return t(lang, c.sessionId ? 'sync.session_removed' : 'sync.value_empty');
  if (field === 'notes' || field === 'body') return DocCore.docPlainText(DocCore.readNotes(value).doc).trim() || t(lang, 'sync.value_empty');
  if (c.sessionId || field === 'sessions') {
    const s = value || {};
    return `${whenText(s.start, lang)}${s.end ? `–${hm(new Date(s.end))}` : ''} · ${fmtShort(Number(s.ms) || 0, lang)}`;
  }
  const st = state || {};
  let text;
  if (REF_LIST[field]) text = ((st[REF_LIST[field]] || []).find((x) => x && x.id === value) || {}).name;
  else if (field === 'tagIds' && Array.isArray(value)) text = value.map((id) => ((st.tags || []).find((g) => g && g.id === id) || {}).name).filter(Boolean).join(', ');
  else if (field === 'repeat') text = value && typeof value === 'object' ? ruleText(value, lang) : '';
  else if (/At$/.test(field) && typeof value === 'string') text = whenText(value, lang);
  else if (typeof value === 'boolean') text = t(lang, value ? 'sync.value_yes' : 'sync.value_no');
  else if (typeof value === 'string' || typeof value === 'number') text = String(value);
  else if (Array.isArray(value)) text = t(lang, 'sync.value_items', { n: value.length });
  else text = JSON.stringify(value);
  return text || t(lang, 'sync.value_empty');
}

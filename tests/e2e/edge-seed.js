// Данные с краю: длинные названия, много тегов и статусов. Одни и те же для
// замеров (edge.spec.js) и для снимков (tests/visual/web.spec.js), чтобы
// глаз и тест смотрели на одно.
//
// Функция сериализуется в строку и выполняется в странице — снаружи ей ничего
// не передать, поэтому всё, что нужно, лежит внутри.
function seedEdge() {
  const now = new Date();
  const HOUR = 3_600_000;
  state.settings.hourlyRate = 2500;
  const tags = ['Срочное', 'Клиент', 'Дизайн', 'Бэкенд', 'Правки', 'Оплачено', 'Тесты'].map((name, i) => ({
    id: `tag-${i}`, name, color: ['#ef7a72', '#5ec8f2', '#c084fc', '#f5c451', '#87ff65', '#f472b6', '#9aa0ab'][i],
  }));
  state.tags.push(...tags);
  const p = {
    id: 'p-edge', name: 'Очень длинное название проекта для проверки ширины шапки', color: '#f5c451',
    description: 'Описание тоже длинное: вёрстка лендинга, личного кабинета и админки по макетам заказчика',
    pinnedAt: null, createdAt: now.toISOString(), tagIds: tags.map((t) => t.id),
  };
  state.projects.push(p);
  seedProjectStatuses(p.id);
  const extra = ['Ожидает ответа заказчика по макету', 'На проверке у тестировщиков', 'Отложено до следующего релиза'];
  extra.forEach((name, i) => state.statuses.push({
    id: `st-edge-${i}`, projectId: p.id, name, color: ['#c084fc', '#5ec8f2', '#9aa0ab'][i], kind: 'progress',
    order: orderedStatuses(p.id).length, builtin: false,
  }));
  state.versions.push({ id: 'v-edge', projectId: p.id, name: 'Версия 2.0 — большой редизайн', releasedAt: null, order: 0 });
  const cols = orderedStatuses(p.id);
  const add = (title, statusId, hours, tagIds, due) => state.tasks.push({
    id: uid(), projectId: p.id, title, done: false, notes: null, totalMs: hours * HOUR,
    sessions: hours ? [{ start: new Date(now.getTime() - hours * HOUR).toISOString(), end: now.toISOString(), ms: hours * HOUR }] : [],
    rate: null, pinnedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    statusId, tagIds, versionId: 'v-edge', repeat: null,
    dueAt: due ? new Date(now.getTime() + due * 86_400_000).toISOString() : null, remindOffsetMin: null, remindAt: null, notifiedAt: null,
  });
  add('Переверстать главную страницу под новый макет с учётом всех правок заказчика', cols[0].id, 12.5, tags.map((t) => t.id), 2);
  add('Короткая', cols[0].id, 0, [], null);
  add('Личный кабинет: авторизация, восстановление пароля, профиль и настройки', 'st-edge-0', 3, [tags[0].id, tags[1].id], -1);
  add('Админка', 'st-edge-1', 1, [tags[2].id], 5);
  state.ui.projectId = p.id;
}

module.exports = { seedEdge };

/* Несколько аккаунтов на одном устройстве — чистая логика, без DOM, без сети
 * и без state.
 *
 * Пользователь попросил 17 октября 2026: «добавить возможность добавлять
 * несколько аккаунтов». У каждого аккаунта свои данные на устройстве (проекты,
 * задачи, документы, таймер, настройки синхронизации), гостевые данные —
 * отдельная запись «Без аккаунта», и никуда не переезжают.
 *
 * Где что лежит — решает одно правило на три поверхности:
 *
 *   гость               аккаунт <uid>
 *   lancible:data       lancible:data:<uid>        веб, localStorage
 *   data.json           data-<uid>.json            десктоп, userData
 *   lancible-data       lancible-data:<uid>        телефон, AsyncStorage
 *
 * Список аккаунтов устройства — { list: [запись…], current: uid | null }:
 *
 *   { uid, email, name, accessToken, refreshToken, lastUsedAt, needsSignIn }
 *
 * Токены неактивных аккаунтов лежат в том же хранилище, где supabase-js и так
 * держит сеанс текущего (sb-…-auth-token). Refresh-токены ротируются: каждый
 * TOKEN_REFRESHED/SIGNED_IN текущего аккаунта переписывает его запись, иначе
 * при возврате старый токен даст refresh_token_already_used. Отказ setSession
 * не убирает аккаунт: запись остаётся с needsSignIn, данные на устройстве
 * открываются без синхронизации, строка предлагает войти заново.
 */
(function (global) {
  /** Идентификатор пользователя Supabase — uuid. Пускаем только буквы, цифры
   *  и дефис: из uid складывается имя файла на десктопе, и «../» в нём
   *  вывел бы запись за пределы userData. */
  const UID_RE = /^[A-Za-z0-9-]{1,64}$/;
  const isValidUid = (uid) => typeof uid === 'string' && UID_RE.test(uid);

  /** uid или null для гостя: всё, что не годится в uid, — гость. */
  const scopeUid = (uid) => (isValidUid(uid) ? uid : null);

  /** Ключ данных веба в localStorage. Гость — прежний ключ, как было до
   *  аккаунтов: его данные не переезжают. */
  const dataScope = (uid) => (scopeUid(uid) ? `lancible:data:${uid}` : 'lancible:data');

  /** Имя файла данных десктопа в userData. */
  const dataFileName = (uid) => (scopeUid(uid) ? `data-${uid}.json` : 'data.json');

  /** Имя хранилища телефона в AsyncStorage (zustand persist). */
  const mobileDataName = (uid) => (scopeUid(uid) ? `lancible-data:${uid}` : 'lancible-data');

  const str = (v) => (typeof v === 'string' ? v : '');
  const num = (v) => (Number.isFinite(v) ? v : 0);

  /** Одна запись к виду, который понимают все: строки — строками, время —
   *  числом. Без refresh-токена сеанс не поднять — это «нужно войти заново». */
  function cleanEntry(e) {
    if (!e || typeof e !== 'object' || !isValidUid(e.uid)) return null;
    const refreshToken = str(e.refreshToken);
    return {
      uid: e.uid,
      email: str(e.email),
      name: str(e.name),
      accessToken: str(e.accessToken),
      refreshToken,
      lastUsedAt: num(e.lastUsedAt),
      needsSignIn: !refreshToken || e.needsSignIn === true,
    };
  }

  /** Список из хранилища — к виду { list, current }.
   *
   *  Принимает и голый массив (на всякий случай: так проще читать руками
   *  записанное). Записи без uid выкидываются; дубли по uid сливаются в одну
   *  — остаётся место первой, поля берутся у той, что использовалась
   *  позже. current, которого нет в списке, — гость. */
  function normalizeAccounts(raw) {
    const src = Array.isArray(raw) ? { list: raw } : (raw && typeof raw === 'object' ? raw : {});
    const list = [];
    const at = new Map();
    for (const item of Array.isArray(src.list) ? src.list : []) {
      const e = cleanEntry(item);
      if (!e) continue;
      if (!at.has(e.uid)) { at.set(e.uid, list.length); list.push(e); continue; }
      const i = at.get(e.uid);
      if (e.lastUsedAt >= list[i].lastUsedAt) list[i] = e;
    }
    const current = isValidUid(src.current) && at.has(src.current) ? src.current : null;
    return { list, current };
  }

  const findAccount = (acc, uid) => normalizeAccounts(acc).list.find((e) => e.uid === uid) || null;

  /** Завести или обновить запись. Поля, которых нет в entry, остаются
   *  прежними; новый refresh-токен снимает пометку «нужно войти заново».
   *  Новая запись встаёт в конец: строки в списке не прыгают от входа к
   *  входу. current не трогается — его ставит setCurrentAccount. */
  function upsertAccount(acc, entry) {
    const base = normalizeAccounts(acc);
    if (!entry || !isValidUid(entry.uid)) return base;
    const i = base.list.findIndex((e) => e.uid === entry.uid);
    const prev = i >= 0 ? base.list[i] : { uid: entry.uid };
    const patch = {};
    for (const k of ['email', 'name', 'accessToken', 'refreshToken', 'lastUsedAt', 'needsSignIn']) {
      if (entry[k] !== undefined) patch[k] = entry[k];
    }
    if (str(entry.refreshToken) && entry.needsSignIn === undefined) patch.needsSignIn = false;
    const next = cleanEntry({ ...prev, ...patch });
    const list = base.list.slice();
    if (i >= 0) list[i] = next; else list.push(next);
    return { list, current: base.current };
  }

  /** Сделать аккаунт текущим (null — гость). Аккаунта нет в списке — гость. */
  function setCurrentAccount(acc, uid) {
    const base = normalizeAccounts(acc);
    return { list: base.list, current: base.list.some((e) => e.uid === uid) ? uid : null };
  }

  /** Сеанс не поднялся: токены стираются, запись остаётся с пометкой. */
  const markNeedsSignIn = (acc, uid) => upsertAccount(acc, { uid, accessToken: '', refreshToken: '', needsSignIn: true });

  /** Убрать аккаунт из списка («Выйти»). Убрали текущий — текущим
   *  становится гость; кого открыть следом, говорит nextAccount. */
  function removeAccount(acc, uid) {
    const base = normalizeAccounts(acc);
    return {
      list: base.list.filter((e) => e.uid !== uid),
      current: base.current === uid ? null : base.current,
    };
  }

  /** Кого открыть после того, как ушёл аккаунт except: последнего по времени
   *  из тех, у кого сеанс живой. Никого — гость (null). */
  function nextAccount(acc, except) {
    const live = normalizeAccounts(acc).list.filter((e) => e.uid !== except && !e.needsSignIn);
    if (!live.length) return null;
    return live.reduce((a, b) => (b.lastUsedAt > a.lastUsedAt ? b : a)).uid;
  }

  /** Что делать при переключении на nextUid (null — гость).
   *
   *   save         — чью область сохранить перед уходом (null — гостя);
   *   load         — чью область открыть;
   *   sameAccount  — переключаться некуда, ничего не делать;
   *   signOut      — уходим из аккаунта: сеанс снять локально
   *                  (signOut({ scope: 'local' }) — сервер его не отзывает);
   *   needSession  — идём в аккаунт: поднять его сеанс setSession;
   *   canResume    — у записи есть refresh-токен, поднимать есть чем;
   *                  нет — данные открываются без синхронизации. */
  function planSwitch(acc, nextUid) {
    const base = normalizeAccounts(acc);
    const load = scopeUid(nextUid) && base.list.some((e) => e.uid === nextUid) ? nextUid : null;
    const save = base.current;
    const sameAccount = save === load;
    const entry = load ? base.list.find((e) => e.uid === load) : null;
    return {
      save,
      load,
      sameAccount,
      signOut: !sameAccount && !!save,
      needSession: !sameAccount && !!load,
      canResume: !!(entry && !entry.needsSignIn),
    };
  }

  /** Подпись строки: имя, иначе почта, иначе «Без аккаунта». t — словарь
   *  поверхности: t('accounts.guest'). */
  function accountLabel(entry, t) {
    const name = entry ? str(entry.name).trim() : '';
    const email = entry ? str(entry.email).trim() : '';
    if (name) return name;
    if (email) return email;
    return typeof t === 'function' ? t('accounts.guest') : '';
  }

  /** Буква на аватаре. Гость — «?», как и раньше в настройках. */
  function accountInitial(entry) {
    const s = entry ? (str(entry.name).trim() || str(entry.email).trim()) : '';
    return s ? s.charAt(0).toUpperCase() : '?';
  }

  /** Цвет аватара — номер из n цветов поверхности (у веба — токены палитры
   *  проектов, у телефона — theme.js). Считается от uid, а не от имени:
   *  переименовался — цвет остался. */
  function accountColorIndex(uid, n) {
    const size = Number.isInteger(n) && n > 0 ? n : 1;
    let h = 0;
    for (const ch of str(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % size;
  }

  const isNode = typeof module !== 'undefined' && module.exports;
  // Деньги — при вызове, а не при загрузке (как reminders в slots.js):
  // порядок <script> в index.html тогда не важен.
  const money = () => (isNode ? require('./money.js') : global.Core);
  const timeOf = (v) => (typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : NaN);

  /** Ставки области — та же форма, что rates() в app.js и ratesOf телефона
   *  (lib/rates.js): общая из настроек и свои у проектов. */
  function scopeRates(data) {
    const byProject = {};
    for (const p of Array.isArray(data.projects) ? data.projects : []) {
      if (p && p.rate !== null && p.rate !== undefined && p.rate !== '') byProject[p.id] = p.rate;
    }
    return { default: Number(data.settings && data.settings.hourlyRate) || 0, byProject };
  }

  /** Закрывает таймер timer записью времени на его задаче в tasks — как
   *  обычная остановка (stopTimer в app.js и в сторе телефона): конец —
   *  now, меньше секунды — без записи, ставка — задачи по ставкам rates.
   *  Арифметика записи — ядра (money.js, planSessionEdit). id записи — от
   *  начала таймера, s@<начало>, тем же ключом журнал правок узнаёт записи
   *  без id (core/oplog.js, sessionKeys): такая запись у задачи уже есть —
   *  ничего не добавляется. Возвращает новый список; задачи нет — тот же. */
  function closeTimerOn(tasks, timer, rates, now) {
    const start = timeOf(timer.startedAt);
    const end = Number.isFinite(now) ? now : Date.now();
    const ms = Math.max(0, end - start);
    const i = tasks.findIndex((x) => x && x.id === timer.taskId);
    if (i < 0 || !Number.isFinite(start) || ms < 1000) return tasks;
    const task = tasks[i];
    const id = `s@${new Date(start).toISOString()}`;
    if ((Array.isArray(task.sessions) ? task.sessions : []).some((x) => x && x.id === id)) return tasks;
    const plan = money().planSessionEdit(task, null, { start, end, ms }, rates, end);
    const entry = { ...plan.sessions[plan.sessions.length - 1], id };
    delete entry.manual; // остановка таймера, а не запись руками
    const next = tasks.slice();
    next[i] = { ...task, sessions: [...plan.sessions.slice(0, -1), entry], totalMs: plan.totalMs, updatedAt: plan.updatedAt };
    return next;
  }

  /** Гостевой таймер надо закрыть: в target идёт свой, и это не тот же
   *  самый (тот же — значит, гостевой уже переехал прошлым переносом). */
  const clash = (t, s) => !!(t.activeTimer && s.activeTimer)
    && !(t.activeTimer.taskId === s.activeTimer.taskId && t.activeTimer.startedAt === s.activeTimer.startedAt);

  /** Таймер гостя перед переносом (19 октября 2026). Таймер в области
   *  один: идёт и у гостя, и в target — гостевой остаться активным не может,
   *  а его время пропадать не должно. Он закрывается записью времени на
   *  своей задаче (closeTimerOn — как обычная остановка, ставки гостя).
   *  В target таймер не идёт — source возвращается как есть: его таймер
   *  переедет (mergeScopeData; после adoptGuestState — сам клиент).
   *
   *  Звать до переноса и с журналом (adoptGuestState), и без него: запись
   *  ляжет в задачу гостя и уедет вместе с ней. mergeScopeData делает то же
   *  сам, так что двойной вызов записи не удвоит.
   *  @param target — область аккаунта (нужен только activeTimer)
   *  @param {{now?: number}} [opts] — «сейчас» числом, по умолчанию Date.now()
   *  @returns копия source с activeTimer: null и записью у задачи; или source */
  function settleGuestTimer(target, source, opts) {
    const t = target && typeof target === 'object' ? target : {};
    const s = source && typeof source === 'object' ? source : null;
    if (!s || !clash(t, s)) return source;
    const now = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
    const tasks = Array.isArray(s.tasks) ? closeTimerOn(s.tasks, s.activeTimer, scopeRates(s), now) : s.tasks;
    return { ...s, tasks, activeTimer: null };
  }

  /** Перенос данных «Без аккаунта» в аккаунт: сущности source (гость)
   *  добавляются к target (область аккаунта). Это объединение, а не замена:
   *
   *   - проекты, задачи и документы — объединение по id, без дублей; что
   *     уже есть в target, остаётся его версией;
   *   - статусы, версии и теги проекта едут за своим проектом: берутся у
   *     source только для проектов, которые пришли из source, — у проекта,
   *     который в target уже был, свои статусы, и чужие ему не подкладываются;
   *   - общие теги (без projectId) сливаются по id;
   *   - таймер: в target не идёт — переезжает таймер source; идёт — остаётся
   *     он, а таймер source закрывается записью времени на своей задаче
   *     (closeTimerOn, как в settleGuestTimer; задача уже была в target —
   *     запись ложится в её версию). До 19 октября 2026 таймер гостя здесь
   *     пропадал вместе со своим временем;
   *   - настройки и интерфейс — target: это данные области, а не переносимые.
   *
   *  Идентификаторы не меняются, поэтому повторный перенос того же source
   *  ничего не добавляет (идемпотентно). Возвращает новый объект; входы не
   *  меняются.
   *  @param {{now?: number}} [opts] — «сейчас» для остановки таймера гостя */
  function mergeScopeData(target, source, opts) {
    const t = target && typeof target === 'object' ? target : {};
    const s = source && typeof source === 'object' ? source : {};
    const arr = (v) => (Array.isArray(v) ? v : []);
    const ids = (list) => new Set(arr(list).map((x) => x && x.id));
    const union = (a, b, keep = () => true) => {
      const have = ids(a);
      return [...arr(a), ...arr(b).filter((x) => x && !have.has(x.id) && keep(x))];
    };
    const targetProjects = ids(t.projects);
    const moved = new Set(arr(s.projects).filter((p) => p && !targetProjects.has(p.id)).map((p) => p.id));
    const followsProject = (x) => (x.projectId ? moved.has(x.projectId) : true);
    let tasks = union(t.tasks, s.tasks);
    if (clash(t, s)) {
      tasks = closeTimerOn(tasks, s.activeTimer, scopeRates(s), opts && Number.isFinite(opts.now) ? opts.now : Date.now());
    }
    return {
      ...t,
      projects: union(t.projects, s.projects),
      tasks,
      statuses: union(t.statuses, s.statuses, followsProject),
      versions: union(t.versions, s.versions, followsProject),
      tags: union(t.tags, s.tags, followsProject),
      documents: union(t.documents, s.documents),
      activeTimer: t.activeTimer || s.activeTimer || null,
    };
  }

  /** Что остаётся у source после переноса: те же настройки, без сущностей. */
  const emptiedScopeData = (source) => ({
    ...(source && typeof source === 'object' ? source : {}),
    projects: [], tasks: [], statuses: [], versions: [], tags: [], documents: [], activeTimer: null,
  });

  /** Список переписала другая вкладка (веб: список в localStorage общий у
   *  вкладок, а открытая область — у каждой своя). raw — запись как она
   *  лежит в хранилище (null — стёрта). true — там открыт уже не тот
   *  аккаунт, что в этой вкладке (scopeUid; null — гость): сеанс в общем
   *  хранилище теперь чужой, и вкладке пора перезагрузиться. Другие правки
   *  списка — добавили аккаунт, освежили токены — не в счёт. */
  function accountChangedElsewhere(raw, scopeUid) {
    const mine = isValidUid(scopeUid) ? scopeUid : null;
    return normalizeAccounts(raw).current !== mine;
  }

  const api = {
    mergeScopeData, emptiedScopeData, settleGuestTimer,
    isValidUid, dataScope, dataFileName, mobileDataName,
    normalizeAccounts, findAccount, upsertAccount, setCurrentAccount, markNeedsSignIn,
    removeAccount, nextAccount, planSwitch, accountLabel, accountInitial, accountColorIndex,
    accountChangedElsewhere,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

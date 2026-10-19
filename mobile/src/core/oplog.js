/* Журнал правок — синхронизация без потерь. Чистая логика: без сети, без DOM
 * и без state. Проект — 17 октября 2026 (согласован с пользователем): единица
 * синхронизации — правка одного поля одной сущности, а не весь набор данных.
 *
 * Почему. До этого в облако уходило всё состояние одним JSON (sync_state):
 * кто последним отправил, тот и прав, и правки второго устройства, сделанные
 * офлайн, исчезали целиком. Теперь сервер хранит журнал правок (таблица
 * changes, supabase/sync2.sql) и ничего не стирает, а устройство применяет
 * чужие правки к своему состоянию по полям. Две правки одного поля — конфликт,
 * только если каждая сделана, НЕ видя другую (одновременно или офлайн);
 * правки по очереди конфликтом не считаются. В момент слияния ничего не
 * спрашивается: показывается одна версия, другая лежит рядом, пока человек
 * не выберет.
 *
 * ── Правка (op) ─────────────────────────────────────────────────────────────
 *   { id, entity, entityId, field, value, at, deviceId, baseSeq, seq }
 *   id       — uuid, его даёт устройство: повтор отправки той же правки сервер
 *              отбивает уникальностью (user_id, op_id), применение — тоже по
 *              нему и по seq;
 *   entity   — project | task | status | tag | version | document;
 *   field    — поле верхнего уровня сущности, всегда целиком. notes у задачи и
 *              body у документа (в проекте — «doc»: так у документа называется
 *              именно поле body) — тоже одно поле: текст не сливается;
 *              '*'         — создание, value — вся сущность;
 *              'deleted'   — удаление, value — время; null — возврат из корзины;
 *              'sessions+' / 'sessions~' — запись времени задачи (value — сама
 *              запись с id), 'sessions-' — снятие (value — id записи);
 *              'conflict'  — пометка о конфликте: версии со значениями (см.
 *              «Конфликт» ниже); 'resolved' — выбор в конфликте;
 *   at       — время правки на устройстве. Дальше 5 минут в будущее не бывает:
 *              сервер режет триггером, ядро — так же при приёме;
 *   baseSeq  — до какого seq устройство применило журнал, когда правку делало;
 *   seq      — место в журнале; null, пока сервер правку не принял.
 *
 * «Видела» и «параллельно». Правка x видела правку h, если x.baseSeq ≥ h.seq
 * или обе с одного устройства и x позже. Не видели друг друга — параллельны
 * (isConcurrent). Своя неотправленная правка (seq null) не видна никому, а
 * сама видела всё, что устройство применило к моменту её создания.
 *
 * «Своя» — по op_id, не по deviceId (19 октября 2026). Один deviceId бывает у
 * двух экземпляров: вкладки веба делят lancible:device, телефон из резервной
 * копии и скопированная папка десктопа уносят свой id. Своё — то, что в
 * очереди (pending) или среди отправленных, но ещё не прочитанных (meta, s);
 * строка журнала с тем же deviceId и чужим op_id применяется, как чужая.
 * «По очереди одного устройства» в истории поля — тоже только для своих:
 * своя против такой строки — по baseSeq (sawBy). Остальные устройства копий
 * не различают и считают их правки идущими по очереди; итог у всех один,
 * потому что из правок одного deviceId показывается последняя в журнале
 * (pick), а спор, который застала копия, она объявляет пометкой. Удаление и
 * возврат решаются по очереди deviceId у всех, копии тоже; известный
 * остаток — удаление против правки, когда у копий одного deviceId в споре
 * участвует ещё и третье устройство: своё удаление ложится у себя раньше,
 * чем встанет в журнал, и в редком переплетении копии расходятся (в
 * генераторе — около 4 историй из 100, без удалений — ни одной).
 *
 * ── Пачка (bundle) ──────────────────────────────────────────────────────────
 * Всё, что устройство хранит про синхронизацию аккаунта, — одним объектом
 * (ключ хранилища — с userId):
 *   { state, pending, lastSeq, conflicts, trash, meta, deferred }
 *   state     — шесть списков (projects, tasks, statuses, tags, versions,
 *               documents) в том виде, в каком они совпадают с журналом.
 *               Пачка владеет этой копией и никогда не меняет её на месте;
 *               клиент берёт себе глубокую копию (app.js правит state на месте);
 *   pending   — свои правки, ещё не принятые сервером (очередь отправки);
 *   lastSeq   — докуда применён журнал;
 *   conflicts — нерешённые конфликты, см. ниже;
 *   trash     — удалённое: [{ entity, entityId, data, deletedAt, deviceId,
 *               opId, ref }], 30 дней (trashSweep). Корзина лежит рядом с
 *               состоянием, а не внутри него (в проекте — «удаление мягкое»):
 *               иначе каждый список в app.js и на телефоне пришлось бы учить
 *               пропускать удалённое, а удаление в клиентах сегодня — filter;
 *   meta      — по каждой сущности: какая правка создала её (c), удалила (d),
 *               вернула (r), какие правки сейчас «наверху» у каждого поля (f)
 *               и записи о конфликтах полей (k). Без этого третье устройство,
 *               получившее две параллельные правки по очереди, не узнало бы,
 *               что они параллельны, и показало бы не то, что первые два:
 *               устройства разошлись бы. Растёт с числом правленых полей; в
 *               слепок (compactSnapshot) уходит целиком, кроме s: s — op_id
 *               своих правок, принятых сервером (ackPending), но ещё не
 *               прочитанных из журнала, не больше 500 на сущность. Лежит в
 *               meta, чтобы клиенты сохраняли его, ничего не меняя у себя;
 *               в пачке без s (сохранённой раньше) своё узнаётся по истории
 *               сущности (inHistory);
 *   deferred  — правки сущностей, которых ещё нет (ждут своего создания).
 *
 * ── Правила слияния (mergeIncoming) ─────────────────────────────────────────
 *   1. Разные поля одной сущности — применяются все.
 *   2. Одно поле по очереди (новая видела прежнюю) — новая побеждает, даже
 *      если часы её устройства отстают.
 *   3. Одно поле параллельно — конфликт: показывается более поздняя по at, при
 *      равенстве — с большим id. В проекте вторым ключом стоит seq, но у своей
 *      неотправленной правки seq ещё нет, а id известен всем устройствам
 *      сразу — с ним выбор одинаков везде. Обе версии остаются в conflicts.
 *      Равные значения — не конфликт.
 *   4. Удаление против правки: параллельно — сущность остаётся (событие
 *      restored, тост «восстановлена: правили на другом устройстве»);
 *      удалили, видя правку, — уходит в корзину. Удаление сущности, создания
 *      которой удалявший не видел, не действует: так старый клиент со старым
 *      набором не «удалит» то, чего у него никогда не было. Спасла своя
 *      поздняя правка удаление старше 7 дней — сущность уходит в журнал
 *      заново целиком ('*'): у остальных корзину могли уже вычистить, и
 *      поздняя правка ждала бы создания, которого не будет. Время чужого
 *      удаления в корзине — created_at строки (часы сервера), а не часы
 *      автора.
 *   5. Записи времени — множество по id: параллельное добавление даёт обе,
 *      правка против снятия — правка остаётся, две правки одной записи —
 *      конфликт по записи. totalMs — производное: при каждой перемене записи
 *      он сдвигается на разницу её ms, сам по себе в журнал не уходит.
 *   6. Создание ('*') не конфликтует. '*' уже существующей сущности (возврат
 *      из корзины, отмена удаления) — правка каждого её поля сразу, и у автора
 *      тоже. Гость при входе общие с аккаунтом сущности шлёт не '*', а
 *      правками по полям: сравнивает с аккаунтом сам (guestImportOps с into),
 *      более свежая по updatedAt сторона побеждает, обе версии — в пометку
 *      'conflict'. Существующее в аккаунте молча не затирается.
 *   7. Повтор той же правки ничего не меняет (по id и по seq).
 *   8. Заметки и документы — одно поле, параллельная правка — конфликт с
 *      «другой версией» целиком; автоматического слияния текста нет.
 *
 * Тихие поля (updatedAt, createdAt, notifiedAt, doneAt, reopenAt, cancelled,
 * pinnedAt, order) параллельно решаются так же по at, но конфликтом не
 * считаются и удаление не отменяют. Это служебные отметки: одновременное
 * «закрыли» на двух устройствах даёт два разных doneAt, а «другая версия»
 * времени закрытия человеку не нужна.
 *
 * Конфликт (bundle.conflicts — только открытые, для экрана):
 *   { id, entity, entityId, field, sessionId?, versions, shownId, at,
 *     ours, theirs, shown }
 * id — `${entity}:${entityId}:${поле}`, одинаковый на всех устройствах:
 * открытый конфликт у поля один. versions — версии {opId, value, at,
 * deviceId, seq, baseSeq}; обычно две, бывает больше (три устройства
 * офлайн). shownId — та, что сейчас в состоянии. ours/theirs/shown — подписи
 * относительно этого устройства: ours — своя версия (на чужом — показанная),
 * theirs — другая.
 *
 * Почему пометка в журнале нужна. Какие правки устройство застанет
 * параллельными, зависит от порядка, в котором они к нему пришли, а свои оно
 * применяет раньше их места в журнале — устройства видят спор по-разному.
 * Поэтому запись о конфликте — множество «добавлено минус снято»: версии,
 * которые устройство застало само, оно объявляет пометкой 'conflict' (со
 * значениями, как только у своих есть seq); пометки других добавляют их
 * версии; 'resolved' снимает увиденные навсегда. Объединение одинаково у
 * всех — одинакова и пометка. Черновик, который его же автор потом
 * переписал, ещё не видя соперника, не показывается: автор сам ушёл дальше.
 * Переписанный уже после — показывается: автор мог переписать чужой текст,
 * и своё уникальное осталось только в черновике.
 *
 * Конфликт живёт, пока его не решили явно: дальнейшая правка поля его не
 * закрывает, иначе первая же буква в заметке молча выбросила бы «другую
 * версию». Сходятся значения — пометка гаснет сама. Решение
 * (resolveConflict) — обычная правка поля выбранным значением плюс
 * 'resolved' со списком увиденного; версия, пришедшая параллельно решению,
 * остаётся конфликтом.
 *
 * Порядок в массивах (state.tasks.unshift) — не поле, его не синхронизируем:
 * поля order у задачи нет, а выдумывать его незачем. Пришедшая задача или
 * документ встаёт в начало списка (как своя новая), остальное — в конец.
 * Порядок статусов и версий — их поле order, оно синхронизируется.
 *
 * Записи времени без id (все, что заведены до журнала) узнаются по началу:
 * 's@<start ISO>' (+'#n' для одинаковых). stampSessionIds проставляет такие
 * id заранее — тогда сдвиг начала записи остаётся правкой той же записи.
 * Новые записи клиент заводит сразу с id, а правка записи id сохраняет.
 *
 * Строки правок, которые ложатся в очередь, — без \u0000 (scrub): Postgres
 * не берёт его в jsonb, а вставка очереди — одна транзакция, и одна такая
 * правка останавливала бы отправку всех. Состояние пачки после commitLocal —
 * тоже без него; opToRow чистит и то, что легло в очередь раньше.
 *
 * ── Протокол клиента ────────────────────────────────────────────────────────
 *   сохранение:  commitLocal(bundle, live, meta) → правки в pending;
 *   отправка:    insert(pending.map(opToRow)) с игнором повторов
 *                (on_conflict user_id,op_id) → ackPending(bundle, rows):
 *                принятые — из pending в отправленные (meta, s);
 *   приём:       на событие realtime НЕ брать строку из события, а читать
 *                `seq > lastSeq order by seq` и отдать всё mergeIncoming:
 *                сервер выдаёт seq под замком пользователя, поэтому видимая
 *                строка значит, что все меньшие уже видны, — а одиночная
 *                строка из события могла обогнать соседку;
 *   после приёма — глубокая копия bundle.state в живое состояние; в pending
 *                могли добавиться пометки 'conflict' — отправить и их;
 *   первый вход: bootstrapFromSnapshot (последний слепок + правки после;
 *                нет журнала — sync_state как слепок seq 0), затем своё
 *                несинхронизированное — adoptGuestState;
 *   старые клиенты: после слияния mirrorSyncState → sync_state (+ mirror_seq),
 *                чужую запись sync_state → legacyBridgeOps → insert.
 *   Остальное — у функций ниже.
 */
(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;

  const LISTS = {
    project: 'projects', task: 'tasks', status: 'statuses', tag: 'tags', version: 'versions', document: 'documents',
  };
  const KINDS = Object.keys(LISTS);
  // Новая задача и новый документ у клиентов встают в начало списка.
  const AT_FRONT = new Set(['task', 'document']);
  const QUIET = new Set(['updatedAt', 'createdAt', 'notifiedAt', 'doneAt', 'reopenAt', 'cancelled', 'pinnedAt', 'order']);
  // Не уходит в журнал: сумма записей времени, держится разницами (правило 5).
  const DERIVED = { task: new Set(['totalMs']) };
  // Имена, занятые служебными правками: поле сущности с таким именем не
  // синхронизируется (таких полей нет ни у одной сущности).
  const RESERVED = new Set(['id', '*', 'deleted', 'conflict', 'resolved', 'sessions+', 'sessions-', 'sessions~']);
  const SKEW_MS = 5 * 60 * 1000;
  const DAY_MS = 86400000;
  const LEGACY = 'legacy';
  const SESSION = 'sessions:';
  // Своих отправленных, ещё не прочитанных из журнала правок у одной сущности
  // (meta, s) — не больше стольких: чтение идёт следом за каждой отправкой, и
  // до предела дойдёт только устройство, которое шлёт, но не может читать.
  const SENT_MAX = 500;
  // Сущность, которую своя поздняя правка спасла от удаления старше стольких
  // дней, уходит в журнал заново целиком: корзину (30 дней) кто-то уже мог
  // вычистить — с запасом на часы, ушедшие вперёд.
  const RESCUE_AFTER_DAYS = 7;
  const NUL = /\u0000/g;

  // ---------------------------------------------------------------------------
  // Мелочи
  // ---------------------------------------------------------------------------

  const msOf = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && v ? Date.parse(v) : NaN));
  const isoOf = (v) => { const t = msOf(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ekOf = (kind, id) => `${kind}:${id}`;
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /** Значение без \u0000 в строках (и в ключах), на любой глубине. Postgres
   *  не берёт этот символ в jsonb, а вставка очереди — одна транзакция: одна
   *  такая правка останавливала бы отправку всех. Тот же объект, если чистить
   *  нечего; иначе копия по изменённому пути. */
  function scrub(v) {
    if (typeof v === 'string') return v.indexOf('\u0000') < 0 ? v : v.replace(NUL, '');
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      let out = null;
      for (let i = 0; i < v.length; i++) {
        const s = scrub(v[i]);
        if (s !== v[i]) { if (!out) out = v.slice(); out[i] = s; }
      }
      return out || v;
    }
    let out = null;
    for (const k of Object.keys(v)) {
      const s = scrub(v[k]);
      if (k.indexOf('\u0000') >= 0) {
        if (!out) out = Object.assign({}, v);
        delete out[k];
        out[k.replace(NUL, '')] = s;
      } else if (s !== v[k]) {
        if (!out) out = Object.assign({}, v);
        out[k] = s;
      }
    }
    return out || v;
  }

  /** Глубокая копия списка, сразу без \u0000 (обход — только если он есть). */
  function cleanCopy(list) {
    const json = JSON.stringify(list);
    const copy = JSON.parse(json);
    return json.indexOf('\\u0000') >= 0 ? scrub(copy) : copy;
  }

  /** Равенство JSON-значений; отсутствие и null — одно и то же (в журнале их
   *  не различить: value — jsonb, undefined туда не доезжает). */
  function same(a, b) {
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!has(b, k) || !same(a[k], b[k])) return false;
    return true;
  }

  function uuidOf(bytes, version) {
    bytes[6] = (bytes[6] & 0x0f) | (version << 4);
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = bytes.map((b) => (b + 0x100).toString(16).slice(1)).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /** uuid для новой правки. На телефоне (Hermes) crypto.randomUUID нет —
   *  тогда getRandomValues, а без него Math.random: колонка op_id — uuid,
   *  и формат обязан сойтись. */
  function randomId() {
    const c = global.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Array(16);
    if (c && typeof c.getRandomValues === 'function') {
      const u = new Uint8Array(16);
      c.getRandomValues(u);
      for (let i = 0; i < 16; i++) bytes[i] = u[i];
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return uuidOf(bytes, 4);
  }

  /** uuid из строки, одинаковый на всех устройствах (cyrb128). Нужен мосту:
   *  правку старого клиента превращает в правки каждое новое устройство, и
   *  одинаковый id даёт серверу отбить повтор. */
  function stableId(text) {
    let h1 = 1779033703; let h2 = 3144134277; let h3 = 1013904242; let h4 = 2773480762;
    for (let i = 0; i < text.length; i++) {
      const k = text.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    const bytes = [];
    for (const h of [h1, h2, h3, h4]) for (let s = 24; s >= 0; s -= 8) bytes.push((h >>> s) & 0xff);
    return uuidOf(bytes, 5);
  }

  // ---------------------------------------------------------------------------
  // Записи времени
  // ---------------------------------------------------------------------------

  const hasId = (s) => isObj(s) && typeof s.id === 'string' && s.id !== '';

  /** Ключи записей списка: свой id, а у записи без id — 's@<начало ISO>'.
   *  Одинаковые — с '#n' по порядку в списке. */
  function sessionKeys(list) {
    const arr = Array.isArray(list) ? list : [];
    const explicit = new Set(arr.filter(hasId).map((s) => s.id));
    const used = new Set();
    return arr.map((s) => {
      if (hasId(s) && !used.has(s.id)) { used.add(s.id); return s.id; }
      const base = hasId(s) ? s.id : `s@${(isObj(s) && isoOf(s.start)) || String(isObj(s) ? s.start : s)}`;
      let key = base;
      let n = 0;
      while (used.has(key) || (key !== base && explicit.has(key)) || (!hasId(s) && explicit.has(key))) key = `${base}#${++n}`;
      used.add(key);
      return key;
    });
  }

  const withoutId = (s) => { if (!isObj(s)) return s; const c = Object.assign({}, s); delete c.id; return c; };
  const sameSession = (a, b) => same(withoutId(a), withoutId(b));
  const msNum = (s) => (isObj(s) && Number.isFinite(Number(s.ms)) ? Number(s.ms) : 0);

  /** Проставляет записям времени без id их ключ (тот же, по которому журнал
   *  узнаёт их и без id). Повторный прогон ничего не меняет. Копия там, где
   *  что-то поменялось; без перемен — тот же объект. */
  function stampSessionIds(state) {
    if (!state || !Array.isArray(state.tasks)) return state;
    let changed = false;
    const tasks = state.tasks.map((task) => {
      if (!task || !Array.isArray(task.sessions) || !task.sessions.length) return task;
      const keys = sessionKeys(task.sessions);
      if (task.sessions.every((s, i) => !isObj(s) || s.id === keys[i])) return task;
      changed = true;
      return Object.assign({}, task, {
        sessions: task.sessions.map((s, i) => (isObj(s) && s.id !== keys[i] ? Object.assign({}, s, { id: keys[i] }) : s)),
      });
    });
    return changed ? Object.assign({}, state, { tasks }) : state;
  }

  // ---------------------------------------------------------------------------
  // Правки: форма, «видела», победитель, часы
  // ---------------------------------------------------------------------------

  function normOp(op) {
    if (!op || typeof op !== 'object' || !op.entity || op.entityId === undefined || op.entityId === null || !op.field) return null;
    const out = {
      id: op.id === undefined || op.id === null ? null : String(op.id),
      entity: String(op.entity),
      entityId: String(op.entityId),
      field: String(op.field),
      value: op.value === undefined ? null : op.value,
      at: op.at,
      deviceId: op.deviceId === undefined || op.deviceId === null ? '' : String(op.deviceId),
      baseSeq: op.baseSeq === undefined || op.baseSeq === null || !Number.isFinite(Number(op.baseSeq)) ? null : Number(op.baseSeq),
      seq: op.seq === undefined || op.seq === null || op.seq === '' ? null : Number(op.seq),
      createdAt: op.createdAt || null,
    };
    if (!out.id) out.id = stableId(JSON.stringify([out.entity, out.entityId, out.field, out.value, out.at, out.deviceId, out.seq]));
    return out;
  }

  /** Короткая ссылка на правку — то, что хранится в meta. */
  const refOf = (x) => ({ id: x.id, seq: x.seq, base: x.baseSeq === null || x.baseSeq === undefined ? 0 : x.baseSeq, at: x.at, dev: x.deviceId || '' });
  const stripV = (h) => { if (!has(h, 'v')) return h; const c = Object.assign({}, h); delete c.v; return c; };

  /** Побеждает ли a у b: позже по at, при равенстве — больший id. */
  function beats(a, b) {
    const ta = msOf(a.at);
    const tb = msOf(b.at);
    const va = Number.isFinite(ta) ? ta : -Infinity;
    const vb = Number.isFinite(tb) ? tb : -Infinity;
    if (va !== vb) return va > vb;
    return String(a.id) > String(b.id);
  }

  /** Видела ли правка x правку h (обе — ссылки refOf). */
  function saw(x, h) {
    if (x.id === h.id) return true;
    if (x.dev && x.dev === h.dev) {
      if (x.seq !== null && h.seq !== null) return x.seq > h.seq;
      if (h.seq !== null) return true; // своя неотправленная новее всего своего отправленного
      if (x.seq !== null) return false;
      return beats(x, h);
    }
    return h.seq !== null && x.base >= h.seq;
  }

  /** «Видела» для истории поля на этом устройстве. Одна правка своя (её op_id
   *  в очереди или среди отправленных — w.ownOps), другая пришла из журнала с
   *  тем же deviceId: это не то же устройство, а его копия (вторая вкладка,
   *  телефон из резервной копии, скопированная папка десктопа), и «по
   *  очереди» здесь неправда — только по baseSeq. Остальные устройства
   *  копий не различают и считают такие правки идущими по очереди; итог у
   *  всех один, потому что из правок одного deviceId показывается последняя
   *  в журнале (pick), а спор, который застала копия, она объявляет пометкой. */
  function sawBy(w, x, h) {
    const own = w.ownOps;
    if (own && x.dev && x.dev === h.dev && x.id !== h.id && own.has(x.id) !== own.has(h.id)) {
      return h.seq !== null && x.base >= h.seq;
    }
    return saw(x, h);
  }

  /** Параллельны ли две правки: ни одна не видела другую. Своя неотправленная
   *  (seq null) не видна никому; правка без baseSeq считается сделанной на
   *  ctx.lastSeq — так ядро понимает правки, которые клиент собрал сам. */
  function isConcurrent(a, b, ctx) {
    const last = ctx && Number.isFinite(Number(ctx.lastSeq)) ? Number(ctx.lastSeq) : 0;
    const r = (o) => ({
      id: o && o.id !== undefined && o.id !== null ? String(o.id) : '',
      seq: o && o.seq !== undefined && o.seq !== null ? Number(o.seq) : null,
      base: o && o.baseSeq !== undefined && o.baseSeq !== null ? Number(o.baseSeq) : last,
      at: o && o.at,
      dev: (o && o.deviceId) || '',
    });
    const ra = r(a);
    const rb = r(b);
    if (ra.id && ra.id === rb.id) return false;
    return !saw(ra, rb) && !saw(rb, ra);
  }

  /** Часы. Время правки не дальше 5 минут в будущее от момента, когда её
   *  принял сервер (createdAt строки), а если его нет — от ctx.now. Сервер
   *  режет так же триггером; ссылка на его время, а не на свои часы, даёт
   *  одинаковый результат на всех устройствах. */
  function clampAt(op, nowMs) {
    const created = msOf(op.createdAt);
    const ref = Number.isFinite(created) ? created : nowMs;
    const t = msOf(op.at);
    if (!Number.isFinite(t)) return Object.assign({}, op, { at: new Date(ref).toISOString() });
    if (t > ref + SKEW_MS) return Object.assign({}, op, { at: new Date(ref + SKEW_MS).toISOString() });
    return op;
  }

  /** Строка таблицы changes → правка. */
  function rowToOp(row) {
    return {
      id: row.op_id,
      entity: row.entity,
      entityId: row.entity_id,
      field: row.field,
      value: row.value === undefined ? null : row.value,
      at: row.at,
      deviceId: row.device_id,
      baseSeq: row.base_seq === undefined || row.base_seq === null ? 0 : Number(row.base_seq),
      seq: row.seq === undefined || row.seq === null ? null : Number(row.seq),
      createdAt: row.created_at || null,
    };
  }

  /** Правка → строка для insert. user_id сервер ставит сам (default
   *  auth.uid()), но его можно передать. seq и created_at — только сервер.
   *  value — без \u0000: очередь чистится при записи, а здесь — то, что
   *  легло в очередь раньше этой чистки. */
  function opToRow(op, userId) {
    const row = {
      op_id: op.id,
      device_id: op.deviceId,
      entity: op.entity,
      entity_id: String(op.entityId),
      field: op.field,
      value: op.value === undefined ? null : scrub(op.value),
      at: op.at,
      base_seq: Number(op.baseSeq) || 0,
    };
    if (userId) row.user_id = userId;
    return row;
  }

  // ---------------------------------------------------------------------------
  // Рабочая копия пачки: копируется только то, что меняется
  // ---------------------------------------------------------------------------

  function bundleOf(b) {
    const x = b || {};
    return {
      state: x.state && typeof x.state === 'object' ? x.state : {},
      pending: Array.isArray(x.pending) ? x.pending : [],
      lastSeq: Number.isFinite(Number(x.lastSeq)) ? Number(x.lastSeq) : 0,
      conflicts: Array.isArray(x.conflicts) ? x.conflicts : [],
      trash: Array.isArray(x.trash) ? x.trash : [],
      meta: isObj(x.meta) ? x.meta : {},
      deferred: Array.isArray(x.deferred) ? x.deferred : [],
    };
  }

  function begin(b) {
    const x = bundleOf(b);
    return {
      state: Object.assign({}, x.state),
      lists: {},
      own: new Set(),
      ownArr: new Set(),
      pending: x.pending.slice(),
      pendingIds: new Set(x.pending.map((p) => p && p.id)),
      lastSeq: x.lastSeq,
      conflicts: new Map(x.conflicts.filter((c) => c && c.id).map((c) => [c.id, c])),
      trash: new Map(x.trash.filter((t) => t && t.entity).map((t) => [ekOf(t.entity, t.entityId), t])),
      meta: Object.assign({}, x.meta),
      deferred: x.deferred.slice(),
      restored: [],
      events: [],
      touched: new Map(), // конфликты, чей вид надо пересчитать: cid → [kind, id, fk]
      ownOps: null, // op_id своих правок (очередь и отправленные) — для sawBy; только при приёме
      rescue: new Map(), // ek → [kind, id]: спасены своей правкой от чужого удаления — '*' заново
    };
  }

  // Свои отправленные правки, которых журнал ещё не вернул (meta, s): по ним
  // приём узнаёт своё, когда очереди правка уже покинула (ackPending), — не
  // по deviceId, который бывает общим у копий одного устройства.
  const sentOf = (m) => (m && Array.isArray(m.s) ? m.s : null);
  function markSent(w, ek, id) {
    const m = w.meta[ek] || {};
    const s = (sentOf(m) || []).filter((x) => x !== id);
    s.push(id);
    w.meta[ek] = Object.assign({}, m, { s: s.length > SENT_MAX ? s.slice(s.length - SENT_MAX) : s });
  }
  function unmarkSent(w, ek, id) {
    const m = w.meta[ek];
    const s = sentOf(m);
    if (!s || !s.includes(id)) return;
    const next = Object.assign({}, m);
    const left = s.filter((x) => x !== id);
    if (left.length) next.s = left; else delete next.s;
    if (Object.keys(next).length) w.meta[ek] = next; else delete w.meta[ek];
  }
  /** meta без s: в слепке и при старте с него чужие «отправленные» не нужны. */
  function withoutSent(meta) {
    const out = {};
    for (const ek of Object.keys(meta || {})) {
      const m = meta[ek];
      if (!isObj(m) || !has(m, 's')) { out[ek] = m; continue; }
      const c = Object.assign({}, m);
      delete c.s;
      if (Object.keys(c).length) out[ek] = c;
    }
    return out;
  }
  /** Правка уже стоит в истории своей сущности (создание, удаление, возврат,
   *  верхняя правка поля). Так узнаются свои правки, отправленные пачкой,
   *  сохранённой до списка s. */
  function inHistory(w, ek, id) {
    const m = w.meta[ek];
    if (m) {
      if ((m.c && m.c.id === id) || (m.d && m.d.id === id) || (m.r && m.r.id === id)) return true;
      for (const fk of Object.keys(m.f || {})) if (m.f[fk].some((h) => h.id === id)) return true;
    }
    const t = w.trash.get(ek);
    return !!(t && t.ref && t.ref.id === id);
  }

  function listOf(w, kind) {
    let l = w.lists[kind];
    if (!l) {
      const coll = LISTS[kind];
      const arr = Array.isArray(w.state[coll]) ? w.state[coll].slice() : [];
      w.state[coll] = arr;
      const map = new Map();
      for (const e of arr) if (e && e.id !== undefined && e.id !== null) map.set(String(e.id), e);
      l = { arr, map };
      w.lists[kind] = l;
    }
    return l;
  }

  const getEnt = (w, kind, id) => listOf(w, kind).map.get(id) || null;

  function editable(w, kind, id) {
    const l = listOf(w, kind);
    const cur = l.map.get(id);
    if (!cur) return null;
    if (w.own.has(cur)) return cur;
    const copy = Object.assign({}, cur);
    w.own.add(copy);
    const i = l.arr.indexOf(cur);
    if (i >= 0) l.arr[i] = copy;
    l.map.set(id, copy);
    return copy;
  }

  function insertEnt(w, kind, ent) {
    const l = listOf(w, kind);
    w.own.add(ent);
    if (AT_FRONT.has(kind)) l.arr.unshift(ent); else l.arr.push(ent);
    l.map.set(String(ent.id), ent);
  }

  function removeEnt(w, kind, id) {
    const l = listOf(w, kind);
    const cur = l.map.get(id);
    if (!cur) return null;
    l.arr.splice(l.arr.indexOf(cur), 1);
    l.map.delete(id);
    return cur;
  }

  /** Сущность там, где она есть: в состоянии или в корзине. */
  function peek(w, kind, id) {
    const e = getEnt(w, kind, id);
    if (e) return { ent: e, trash: false };
    const t = w.trash.get(ekOf(kind, id));
    return t ? { ent: t.data, trash: true } : null;
  }

  /** Правимая копия сущности — в состоянии или в корзине. */
  function mut(w, kind, id) {
    const e = editable(w, kind, id);
    if (e) return e;
    const key = ekOf(kind, id);
    const t = w.trash.get(key);
    if (!t) return null;
    if (w.own.has(t.data)) return t.data;
    const data = Object.assign({}, t.data);
    w.own.add(data);
    w.trash.set(key, Object.assign({}, t, { data }));
    return data;
  }

  function setMetaKey(w, ek, key, val) {
    const m = w.meta[ek] || {};
    w.meta[ek] = Object.assign({}, m, { [key]: val });
  }
  const headsOf = (w, ek, fk) => { const m = w.meta[ek]; return (m && m.f && m.f[fk]) || null; };
  function setHeads(w, ek, fk, heads) {
    const m = w.meta[ek] || {};
    w.meta[ek] = Object.assign({}, m, { f: Object.assign({}, m.f, { [fk]: heads }) });
  }
  /** Верхние правки поля. Пока их больше одной, каждая хранит своё значение:
   *  иначе, когда одну из них перекроют, вторую нечем было бы показать. */
  function storeHeads(w, ek, fk, cand) {
    const heads = cand.length > 1
      ? cand.map(({ h, v }) => Object.assign({}, stripV(h), { v: clone(v) }))
      : cand.map(({ h }) => stripV(h));
    setHeads(w, ek, fk, heads);
  }

  function plainIO(w, kind, id, field) {
    return {
      get: () => { const p = peek(w, kind, id); return p ? p.ent[field] : null; },
      put: (v) => {
        const p = peek(w, kind, id);
        if (!p || same(p.ent[field], v)) return;
        mut(w, kind, id)[field] = clone(v);
      },
    };
  }

  function sessionAt(ent, sid) {
    const arr = ent && Array.isArray(ent.sessions) ? ent.sessions : [];
    const i = sessionKeys(arr).indexOf(sid);
    return i < 0 ? null : arr[i];
  }

  /** Кладёт запись времени (или снимает, v = null) и сдвигает totalMs на
   *  разницу её ms — так сумма сходится на всех устройствах, в каком бы
   *  порядке ни шли правки, и переживает старые расхождения суммы. */
  function sessionPut(w, kind, id, sid, v) {
    const p = peek(w, kind, id);
    if (!p) return;
    const cur = Array.isArray(p.ent.sessions) ? p.ent.sessions : [];
    const i = sessionKeys(cur).indexOf(sid);
    if (i < 0 && (v === null || v === undefined)) return;
    if (i >= 0 && v !== null && v !== undefined && sameSession(cur[i], v)) return;
    const e = mut(w, kind, id);
    let arr = e.sessions;
    if (!w.ownArr.has(arr)) {
      arr = Array.isArray(arr) ? arr.slice() : [];
      e.sessions = arr;
      w.ownArr.add(arr);
    }
    const oldMs = i >= 0 ? msNum(arr[i]) : 0;
    let newMs = 0;
    if (v === null || v === undefined) arr.splice(i, 1);
    else {
      const rec = clone(v);
      if (!hasId(rec)) rec.id = sid;
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      newMs = msNum(rec);
    }
    if (newMs !== oldMs) e.totalMs = (Number(e.totalMs) || 0) + newMs - oldMs;
  }

  function sessionIO(w, kind, id, sid) {
    return {
      get: () => { const p = peek(w, kind, id); return p ? sessionAt(p.ent, sid) : null; },
      put: (v) => sessionPut(w, kind, id, sid, v),
    };
  }

  const ioFor = (w, kind, id, fk) => (fk.startsWith(SESSION)
    ? sessionIO(w, kind, id, fk.slice(SESSION.length))
    : plainIO(w, kind, id, fk));

  // ---------------------------------------------------------------------------
  // Сердце: одна правка одного поля
  // ---------------------------------------------------------------------------

  /** Из двух правок одного deviceId позже та, что дальше в журнале; ещё не
   *  отправленная — позже всех. */
  function laterOnDevice(a, b) {
    const sa = a.seq === null || a.seq === undefined ? Infinity : Number(a.seq);
    const sb = b.seq === null || b.seq === undefined ? Infinity : Number(b.seq);
    if (sa !== sb) return sa > sb;
    return beats(a, b);
  }

  /** Выбор показываемой версии. Из правок одного deviceId в спор идёт только
   *  последняя (laterOnDevice): так видят их устройства, для которых это
   *  правки «по очереди», и копия устройства, застав их параллельными,
   *  покажет то же самое. Обычно у поля одна правка на устройство — тогда
   *  это ничего не меняет. У записи времени живая побеждает снятую. */
  function pick(cand, session) {
    const last = new Map();
    for (const c of cand) {
      const d = c.h.dev;
      if (!d) continue;
      const prev = last.get(d);
      if (!prev || laterOnDevice(c.h, prev.h)) last.set(d, c);
    }
    let pool = cand.filter((c) => !c.h.dev || last.get(c.h.dev) === c);
    if (session) {
      const alive = pool.filter((c) => c.v !== null && c.v !== undefined);
      if (alive.length) pool = alive;
    }
    return pool.reduce((best, c) => (beats(c.h, best.h) ? c : best));
  }

  /**
   * Правка x поля fk. Верхние правки поля — те, которых никто не перекрыл
   * (не видел позже). x, которую верхняя уже видела, устарела; x, видевшая
   * все верхние, побеждает; иначе она встаёт рядом, и показывается более
   * поздняя по at. Результат не зависит от порядка прихода.
   * flags: { quiet, session }.
   */
  function absorbField(w, ctx, x, kind, id, fk, value, io, flags) {
    const ek = ekOf(kind, id);
    const xr = refOf(x);
    let heads = headsOf(w, ek, fk);
    if (!heads || !heads.length) {
      // Своей истории у поля нет — его значение пришло с созданием, и спорит
      // создание ('*' и при возврате из корзины тоже создание). Нет и его —
      // значение из снимка: спорить не с чем.
      const m = w.meta[ek];
      heads = m && m.c ? [m.c] : [];
    }
    if (heads.some((h) => h.id === xr.id || sawBy(w, h, xr))) return 'stale';
    const rest = heads.filter((h) => !sawBy(w, xr, h));
    if (!rest.length) {
      storeHeads(w, ek, fk, [{ h: xr }]);
      io.put(value);
      return 'applied';
    }
    const current = io.get();
    const cand = rest.map((h) => ({ h: stripV(h), v: has(h, 'v') ? h.v : current })).concat([{ h: xr, v: value }]);
    const win = pick(cand, flags.session);
    storeHeads(w, ek, fk, cand);
    io.put(win.v);
    if (!flags.quiet) noteConflict(w, ctx, x, kind, id, fk, cand, win, flags.session);
    return 'concurrent';
  }

  const verRef = (v) => ({ id: v.opId, seq: v.seq === undefined ? null : v.seq, base: v.baseSeq || 0, at: v.at, dev: v.deviceId || '' });

  // Запись о конфликте поля — множество «добавлено минус снято» (в meta, k):
  //   { versions: [{opId, value, at, deviceId, seq, baseSeq}], gone: [opId], told: [opId] }
  // Версии добавляет то устройство, которое застало параллельные правки с
  // разными значениями; оно же объявляет их пометкой 'conflict' в журнале
  // (told — уже объявленные). Снимает их только 'resolved' (gone). Что именно
  // застанет устройство, зависит от того, в каком порядке к нему пришли
  // правки (свои оно применяет раньше их места в журнале), а объединение
  // объявленного одинаково у всех — так одинакова и пометка.
  const fkOf = (field, sessionId) => (sessionId ? SESSION + sessionId : field);
  const cidOf = (kind, id, fk) => `${ekOf(kind, id)}:${fk}`;
  const recOf = (w, ek, fk) => { const m = w.meta[ek]; return (m && m.k && m.k[fk]) || null; };
  function putRec(w, kind, id, fk, rec) {
    const ek = ekOf(kind, id);
    const m = w.meta[ek] || {};
    const k = Object.assign({}, m.k);
    if (rec) k[fk] = rec; else delete k[fk];
    w.meta[ek] = Object.assign({}, m, { k });
    w.touched.set(cidOf(kind, id, fk), [kind, id, fk]);
  }

  function addVersions(w, kind, id, fk, vers, told) {
    const old = recOf(w, ekOf(kind, id), fk) || { versions: [], gone: [], told: [] };
    const gone = new Set(old.gone);
    const versions = old.versions.slice();
    const toldSet = new Set(old.told);
    let changed = false;
    for (const raw of vers) {
      if (!raw || !raw.opId || gone.has(raw.opId)) continue;
      // Пометка могла уйти, пока правка версии ещё ждала seq, — а здесь
      // правка уже применена, и её seq известен: берём его, как у всех.
      const known = raw.seq === null || raw.seq === undefined ? knownSeq(w, ekOf(kind, id), raw.opId) : null;
      const v = known ? Object.assign({}, raw, { seq: known.seq, at: known.at }) : raw;
      const i = versions.findIndex((x) => x.opId === v.opId);
      if (i < 0) { versions.push(clone(v)); changed = true; } else if (versions[i].seq === null && v.seq !== null && v.seq !== undefined) {
        versions[i] = Object.assign({}, versions[i], { seq: v.seq, at: v.at });
        changed = true;
      }
      if (told && !toldSet.has(v.opId)) { toldSet.add(v.opId); changed = true; }
    }
    if (changed) putRec(w, kind, id, fk, { versions, gone: old.gone, told: [...toldSet] });
  }

  function knownSeq(w, ek, opId) {
    const m = w.meta[ek];
    if (!m) return null;
    const refs = [m.c, m.d, m.r];
    for (const fk of Object.keys(m.f || {})) refs.push(...m.f[fk]);
    const r = refs.find((h) => h && h.id === opId && h.seq !== null && h.seq !== undefined);
    return r ? { seq: r.seq, at: r.at } : null;
  }

  function noteConflict(w, ctx, x, kind, id, fk, cand, win, session) {
    const vals = session ? cand.filter((c) => c.v !== null && c.v !== undefined) : cand;
    const live = recOf(w, ekOf(kind, id), fk);
    // Равные значения — спорить не о чем, но если запись уже есть, правки
    // ложатся и в неё: по ним видно, что спор сошёлся (см. visibleVersions).
    if (!(live && live.versions.length) && !vals.some((c) => !same(c.v, win.v))) return;
    addVersions(w, kind, id, fk, vals.map((c) => ({
      opId: c.h.id, value: c.v, at: c.h.at, deviceId: c.h.dev, seq: c.h.seq, baseSeq: c.h.base,
    })), false);
  }

  /** Версии, которые стоит показать. Черновик скрывается, если его же
   *  устройство потом правило поле, ещё не видя соперника, — автор сам
   *  ушёл дальше, и это не «другая версия», а ступенька. Если же автор
   *  правил, уже видя соперника, черновик остаётся: он мог переписать текст
   *  соперника, и тогда своё уникальное — только в черновике. Правило
   *  зависит лишь от содержимого записи, поэтому одинаково на всех. */
  function visibleVersions(vs) {
    const refs = vs.map(verRef);
    return vs.filter((v, i) => {
      const rv = refs[i];
      const rivals = refs.filter((r, j) => j !== i && r.dev !== rv.dev && !saw(r, rv) && !saw(rv, r));
      if (!rivals.length) return true;
      return !refs.some((rw, j) => j !== i && rw.dev && rw.dev === rv.dev && saw(rw, rv) && rivals.some((c) => !saw(rw, c)));
    });
  }

  /** Открытый конфликт для экрана или null: видимых версий с разными
   *  значениями меньше двух — спор сошёлся. */
  function viewOf(w, kind, id, fk) {
    const rec = recOf(w, ekOf(kind, id), fk);
    if (!rec) return null;
    const vis = visibleVersions(rec.versions);
    const distinct = [];
    for (const v of vis) if (!distinct.some((d) => same(d.value, v.value))) distinct.push(v);
    if (distinct.length < 2) return null;
    const sorted = vis.slice().sort((a, b) => (beats(verRef(a), verRef(b)) ? 1 : -1));
    const p = peek(w, kind, id);
    const current = p ? (fk.startsWith(SESSION) ? sessionAt(p.ent, fk.slice(SESSION.length)) : p.ent[fk]) : undefined;
    const shown = sorted.slice().reverse().find((v) => same(v.value, current)) || sorted[sorted.length - 1];
    const out = {
      id: cidOf(kind, id, fk),
      entity: kind,
      entityId: id,
      field: fk.startsWith(SESSION) ? 'sessions' : fk,
      versions: sorted,
      shownId: shown.opId,
      at: sorted[sorted.length - 1].at,
    };
    if (fk.startsWith(SESSION)) out.sessionId = fk.slice(SESSION.length);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Виды правок
  // ---------------------------------------------------------------------------

  function defer(w, ctx, x) {
    if (w.deferred.some((d) => d.id === x.id)) return;
    w.deferred.push(Object.assign({}, x, { deferredAt: isoOf(ctx.nowMs) }));
  }

  function restore(w, kind, id, type, deviceId) {
    const ek = ekOf(kind, id);
    const t = w.trash.get(ek);
    if (!t) return;
    w.trash.delete(ek);
    const ent = w.own.has(t.data) ? t.data : Object.assign({}, t.data);
    insertEnt(w, kind, ent);
    if (type === 'restored') w.restored.push({ entity: kind, entityId: id, deviceId: t.deviceId, at: t.deletedAt });
    w.events.push({ type, entity: kind, entityId: id, deviceId: type === 'restored' ? t.deviceId : deviceId });
  }

  /** Добралась ли правка до сущности. Нет нигде — ждёт создания. В корзине,
   *  а правка и удаление друг друга не видели (параллельны) — сущность
   *  возвращается (правило 4); тихие поля не возвращают. «Удаление видело
   *  правку» при приходе правки после удаления бывает только у копий одного
   *  deviceId (своё удаление легло раньше правки копии): так, как у всех. */
  function reach(w, ctx, x, kind, id) {
    const p = peek(w, kind, id);
    if (!p) { defer(w, ctx, x); return false; }
    if (p.trash && !QUIET.has(x.field)) {
      const t = w.trash.get(ekOf(kind, id));
      const xr = refOf(x);
      if (t.ref && !saw(xr, t.ref) && !saw(t.ref, xr)) restore(w, kind, id, 'restored');
    }
    return true;
  }

  /** Что удаление xr не видело среди возврата и верхних правок полей (тихие
   *  не в счёт): параллельное ему оставляет сущность (правило 4). «Не
   *  видели друг друга» — своя неотправленная правка копии устройства (тот
   *  же deviceId) у остальных встанет в журнал после удаления и будет
   *  «видевшей» его — так её считает и эта копия. */
  function unseenBy(m, xr) {
    const apart = (h) => !saw(xr, h) && !saw(h, xr);
    const out = [];
    if (m.r && apart(m.r)) out.push(m.r);
    for (const fk of Object.keys(m.f || {})) {
      if (!QUIET.has(fk)) for (const h of m.f[fk]) if (apart(h)) out.push(h);
    }
    return out;
  }

  function absorbPlain(w, ctx, x) {
    const kind = x.entity;
    const id = x.entityId;
    if (!reach(w, ctx, x, kind, id)) return;
    absorbField(w, ctx, x, kind, id, x.field, x.value, plainIO(w, kind, id, x.field), { quiet: QUIET.has(x.field) });
  }

  function absorbSession(w, ctx, x) {
    const kind = x.entity;
    const id = x.entityId;
    let sid;
    let value = null;
    if (x.field === 'sessions-') sid = typeof x.value === 'string' ? x.value : (isObj(x.value) ? x.value.id : null);
    else {
      if (!isObj(x.value)) return;
      value = x.value;
      sid = hasId(value) ? value.id : sessionKeys([value])[0];
    }
    if (!sid) return;
    if (!reach(w, ctx, x, kind, id)) return;
    absorbField(w, ctx, x, kind, id, SESSION + sid, value, sessionIO(w, kind, id, sid), { session: true });
  }

  /** Время чужого удаления для корзины — когда журнал принял правку
   *  (created_at, часы сервера), а не часы автора: отставшие на месяц часы
   *  иначе выметали бы удалённое у всех сразу, без 30 дней на возврат и без
   *  спасения поздней правкой. Строка без created_at (старый вид) — как
   *  раньше: время из правки. */
  const trashedAt = (x) => isoOf(x.createdAt) || isoOf(x.value) || isoOf(x.at);
  /** Самое раннее из времён удаления (сервер, автор): по нему корзину может
   *  вычистить хоть кто-то — сам автор считает по своим часам. */
  function earliestOf(x) {
    const ts = [x.createdAt, x.value, x.at].map(msOf).filter(Number.isFinite);
    return ts.length ? Math.min(...ts) : NaN;
  }

  function absorbDelete(w, ctx, x) {
    const kind = x.entity;
    const id = x.entityId;
    const ek = ekOf(kind, id);
    const xr = refOf(x);
    const m = w.meta[ek] || {};
    if (m.c && !saw(xr, m.c)) return; // удаляли то, чего не видели
    if (m.d && (m.d.id === xr.id || saw(m.d, xr))) return;
    setMetaKey(w, ek, 'd', xr);
    const p = peek(w, kind, id);
    if (!p || p.trash) return;
    // Возврат или правка поля, параллельные удалению, — сущность остаётся.
    const unseen = unseenBy(m, xr);
    if (unseen.length) {
      w.restored.push({ entity: kind, entityId: id, deviceId: x.deviceId, at: x.at });
      w.events.push({ type: 'restored', entity: kind, entityId: id, deviceId: x.deviceId });
      // Спасла своя поздняя правка давнего удаления — сущность уходит в
      // журнал заново целиком: остальные могли уже вычистить её из корзины
      // (trashSweep), и поздняя правка ждала бы у них создания, которого не
      // будет. Свежее удаление у всех ещё в корзине: туда правка и вернёт.
      const old = earliestOf(x);
      if (!ctx.replay && Number.isFinite(old) && ctx.nowMs - old >= RESCUE_AFTER_DAYS * DAY_MS
        && unseen.some((h) => (w.ownOps && w.ownOps.has(h.id)) || (ctx.deviceId && h.dev === String(ctx.deviceId)))) {
        w.rescue.set(ek, [kind, id]);
      }
      return;
    }
    const ent = removeEnt(w, kind, id);
    w.trash.set(ek, {
      entity: kind, entityId: id, data: ent, deletedAt: trashedAt(x), deviceId: x.deviceId, opId: x.id, ref: xr,
    });
    w.events.push({ type: 'deleted', entity: kind, entityId: id, deviceId: x.deviceId });
  }

  function absorbUndelete(w, ctx, x) {
    const kind = x.entity;
    const id = x.entityId;
    const ek = ekOf(kind, id);
    const xr = refOf(x);
    const m = w.meta[ek] || {};
    if (m.r && (m.r.id === xr.id || saw(m.r, xr))) return;
    setMetaKey(w, ek, 'r', xr);
    const t = w.trash.get(ek);
    if (t && !(t.ref && saw(t.ref, xr))) restore(w, kind, id, 'undeleted', x.deviceId);
  }

  function absorbCreate(w, ctx, x) {
    const kind = x.entity;
    const id = x.entityId;
    const ek = ekOf(kind, id);
    if (!isObj(x.value)) return;
    const xr = refOf(x);
    const p = peek(w, kind, id);
    if (!p) {
      const ent = clone(x.value);
      if (ent.id === undefined || ent.id === null) ent.id = id;
      insertEnt(w, kind, ent);
      setMetaKey(w, ek, 'c', xr);
      retryDeferred(w, ctx, ek);
      return;
    }
    if (p.trash) {
      const t = w.trash.get(ek);
      // Удаление видело это создание: сущность остаётся в корзине, но с его
      // полями — у остальных '*' легла до удаления. Позже удаления в журнале
      // такое создание приходит только к копии устройства (тот же deviceId).
      if (t.ref && saw(t.ref, xr)) { mergeCreate(w, ctx, x, kind, id, x.value); return; }
      const deliberate = t.ref && saw(xr, t.ref);
      if (deliberate) setMetaKey(w, ek, 'r', xr);
      restore(w, kind, id, deliberate ? 'undeleted' : 'restored', x.deviceId);
    }
    mergeCreate(w, ctx, x, kind, id, x.value);
  }

  /** '*' уже существующей сущности — по полям (правило 6). */
  function mergeCreate(w, ctx, x, kind, id, value) {
    // Каждое поле — даже равное: автор '*' считает её верхней правкой всех
    // своих полей (ownWhole), и здесь должно выйти то же самое.
    for (const key of fieldsOf(kind, value)) {
      absorbField(w, ctx, x, kind, id, key, value[key], plainIO(w, kind, id, key), { quiet: QUIET.has(key) });
    }
    for (const [sid, rec] of sessionsOf(kind, value)) {
      absorbField(w, ctx, x, kind, id, SESSION + sid, rec, sessionIO(w, kind, id, sid), { session: true });
    }
  }

  /** Поля сущности, которые несёт '*' (кроме служебных и производных). */
  function fieldsOf(kind, value) {
    const skip = DERIVED[kind];
    return Object.keys(value).filter((k) => !RESERVED.has(k) && !(skip && skip.has(k)) && !(kind === 'task' && k === 'sessions'));
  }

  /** Записи времени, которые несёт '*': [ключ, запись с id]. */
  function sessionsOf(kind, value) {
    if (kind !== 'task' || !Array.isArray(value.sessions)) return [];
    const recs = value.sessions.filter(isObj);
    const keys = sessionKeys(recs);
    return recs.map((rec, i) => [keys[i], hasId(rec) ? rec : Object.assign({}, rec, { id: keys[i] })]);
  }

  /** Выбор в конфликте: увиденные версии снимаются навсегда (gone) — и те,
   *  что придут потом пометкой запоздавшего устройства. Кроме правки самого
   *  выбора: если параллельно ему пришла ещё версия, спор продолжается. */
  function absorbResolved(w, ctx, x) {
    const v = isObj(x.value) ? x.value : {};
    if (!v.field) return;
    const fk = fkOf(v.field, v.sessionId);
    const seen = new Set(Array.isArray(v.seen) ? v.seen : []);
    if (v.op) seen.delete(v.op);
    dropVersions(w, x.entity, x.entityId, fk, seen);
    w.events.push({ type: 'resolved', entity: x.entity, entityId: x.entityId, field: v.field, conflictId: cidOf(x.entity, x.entityId, fk) });
  }

  function dropVersions(w, kind, id, fk, seen) {
    const old = recOf(w, ekOf(kind, id), fk) || { versions: [], gone: [], told: [] };
    const gone = new Set(old.gone);
    for (const s of seen) gone.add(s);
    putRec(w, kind, id, fk, {
      versions: old.versions.filter((ver) => !gone.has(ver.opId)),
      gone: [...gone],
      told: old.told.filter((t) => !gone.has(t)),
    });
  }

  /** Пометка о конфликте из журнала: её версии — в запись (объявленными). */
  function absorbMark(w, ctx, x) {
    const v = isObj(x.value) ? x.value : {};
    if (!v.field || !Array.isArray(v.versions)) return;
    const vers = v.versions.filter((ver) => isObj(ver) && ver.opId);
    addVersions(w, x.entity, x.entityId, fkOf(v.field, v.sessionId), vers, true);
  }

  function absorb(w, ctx, x) {
    if (!LISTS[x.entity]) return; // сущность из будущей версии — не наша забота
    switch (x.field) {
      case '*': absorbCreate(w, ctx, x); break;
      case 'deleted': if (x.value === null || x.value === undefined) absorbUndelete(w, ctx, x); else absorbDelete(w, ctx, x); break;
      case 'resolved': absorbResolved(w, ctx, x); break;
      case 'conflict': absorbMark(w, ctx, x); break;
      case 'sessions+': case 'sessions~': case 'sessions-':
        if (x.entity === 'task') absorbSession(w, ctx, x); else absorbPlain(w, ctx, x);
        break;
      default: absorbPlain(w, ctx, x);
    }
  }

  function retryDeferred(w, ctx, onlyEk) {
    if (!w.deferred.length) return;
    const ready = [];
    const keep = [];
    for (const op of w.deferred) {
      const ek = ekOf(op.entity, op.entityId);
      if ((!onlyEk || ek === onlyEk) && peek(w, op.entity, op.entityId)) ready.push(op); else keep.push(op);
    }
    if (!ready.length) return;
    w.deferred = keep;
    ready.sort(bySeq);
    for (const op of ready) { const o = Object.assign({}, op); delete o.deferredAt; absorb(w, ctx, o); }
  }

  function bySeq(a, b) {
    const na = a.seq === null || a.seq === undefined;
    const nb = b.seq === null || b.seq === undefined;
    if (na !== nb) return na ? 1 : -1;
    if (na) return 0;
    return a.seq - b.seq;
  }

  /** Своя правка вернулась с сервера: запомнить её seq и серверное время.
   *  @returns ключ сущности или null */
  function confirm(w, ctx, x) {
    let orig = null;
    if (w.pendingIds.has(x.id)) {
      const i = w.pending.findIndex((p) => p && p.id === x.id);
      if (i >= 0) { orig = w.pending[i]; w.pending.splice(i, 1); }
      w.pendingIds.delete(x.id);
    }
    const kind = x.entity || (orig && orig.entity);
    const id = x.entityId !== undefined && x.entityId !== null ? String(x.entityId) : (orig && String(orig.entityId));
    if (!kind || id === undefined || id === null) return null;
    const ek = ekOf(kind, id);
    const at = x.at || (orig && orig.at);
    const upd = (h) => (h && h.id === x.id
      ? Object.assign({}, h, { seq: x.seq, at: at || h.at, base: x.baseSeq !== null && x.baseSeq !== undefined ? Math.min(h.base, Number(x.baseSeq)) : h.base })
      : h);
    const m = w.meta[ek];
    const moved = [];
    if (m) {
      const next = Object.assign({}, m);
      if (m.c) next.c = upd(m.c);
      if (m.d) next.d = upd(m.d);
      if (m.r) next.r = upd(m.r);
      if (m.f) {
        next.f = {};
        for (const fk of Object.keys(m.f)) {
          const hs = m.f[fk];
          next.f[fk] = hs.map(upd);
          const was = hs.find((h) => h.id === x.id);
          // Сервер обрезал время — или рядом правка копии с тем же deviceId:
          // своя получила seq, и «последняя в журнале» (pick) могла смениться.
          if (was && hs.length > 1 && (msOf(was.at) !== msOf(at) || hs.some((h) => h.id !== x.id && h.dev && h.dev === was.dev))) moved.push(fk);
        }
      }
      w.meta[ek] = next;
      for (const fk of Object.keys(m.k || {})) {
        const rec = m.k[fk];
        if (!rec.versions.some((v) => v.opId === x.id)) continue;
        putRec(w, kind, id, fk, Object.assign({}, rec, {
          versions: rec.versions.map((v) => (v.opId === x.id ? Object.assign({}, v, { seq: x.seq, at: at || v.at }) : v)),
        }));
      }
    }
    const t = w.trash.get(ek);
    if (t && t.ref && t.ref.id === x.id) w.trash.set(ek, Object.assign({}, t, { ref: upd(t.ref) }));
    // Победитель поля мог смениться (см. moved).
    for (const fk of moved) rewin(w, kind, id, fk);
    return ek;
  }

  function rewin(w, kind, id, fk) {
    const ek = ekOf(kind, id);
    const heads = headsOf(w, ek, fk);
    if (!heads || heads.length < 2 || !peek(w, kind, id)) return;
    const cand = heads.map((h) => ({ h: stripV(h), v: h.v }));
    const win = pick(cand, fk.startsWith(SESSION));
    ioFor(w, kind, id, fk).put(win.v);
    if (recOf(w, ek, fk)) w.touched.set(cidOf(kind, id, fk), [kind, id, fk]);
  }

  // ---------------------------------------------------------------------------
  // Итог: подписи конфликтов для экрана
  // ---------------------------------------------------------------------------

  const pub = (v) => (v ? { value: v.value, at: v.at, deviceId: v.deviceId, opId: v.opId } : null);

  function label(rec, deviceId) {
    const base = Object.assign({}, rec);
    delete base.ours; delete base.theirs; delete base.shown;
    const vs = rec.versions.slice().sort((a, b) => (beats(verRef(a), verRef(b)) ? 1 : -1));
    const shown = vs.find((v) => v.opId === rec.shownId) || vs[vs.length - 1];
    const mine = deviceId ? vs.filter((v) => v.deviceId === deviceId) : [];
    const ours = mine.length ? mine[mine.length - 1] : shown;
    const others = vs.filter((v) => v !== ours);
    const theirs = ours === shown ? others[others.length - 1] : shown;
    return Object.assign(base, { ours: pub(ours), theirs: pub(theirs), shown: ours === shown ? 'ours' : 'theirs' });
  }

  /** Пересчёт вида тронутых конфликтов и пометки о том, что нашло само это
   *  устройство и ещё никто не объявил. Без deviceId объявлять некому. */
  function finish(w, ctx) {
    const c = ctx || {};
    for (const [cid, [kind, id, fk]] of w.touched) {
      const before = w.conflicts.get(cid);
      const view = viewOf(w, kind, id, fk);
      if (view) {
        w.conflicts.set(cid, view);
        const grew = !before || before.versions.length !== view.versions.length;
        if (grew) w.events.push({ type: 'conflict', entity: kind, entityId: id, field: view.field, sessionId: view.sessionId, conflictId: cid });
      } else {
        w.conflicts.delete(cid);
      }
      const rec = recOf(w, ekOf(kind, id), fk);
      if (!rec || !c.deviceId) continue;
      const told = new Set(rec.told);
      // Своя версия объявляется, когда сервер уже дал ей seq: иначе у
      // получателей она легла бы без seq, а у автора — с ним.
      const fresh = rec.versions.filter((v) => !told.has(v.opId) && v.seq !== null && v.seq !== undefined);
      if (!fresh.length) continue;
      const field = fk.startsWith(SESSION) ? 'sessions' : fk;
      w.pending.push({
        id: c.newId ? String(c.newId()) : randomId(),
        entity: kind,
        entityId: id,
        field: 'conflict',
        value: scrub({ key: cid, field, sessionId: fk.startsWith(SESSION) ? fk.slice(SESSION.length) : null, versions: clone(fresh) }),
        at: isoOf(c.nowMs) || new Date().toISOString(),
        deviceId: String(c.deviceId),
        baseSeq: w.lastSeq,
        seq: null,
      });
      const m = w.meta[ekOf(kind, id)];
      w.meta[ekOf(kind, id)] = Object.assign({}, m, {
        k: Object.assign({}, m.k, { [fk]: Object.assign({}, rec, { told: rec.told.concat(fresh.map((v) => v.opId)) }) }),
      });
    }
    w.touched = new Map();
    return {
      state: w.state,
      pending: w.pending,
      lastSeq: w.lastSeq,
      conflicts: [...w.conflicts.values()].map((r) => label(r, c.deviceId)),
      trash: [...w.trash.values()],
      meta: w.meta,
      deferred: w.deferred,
      restored: w.restored,
      events: w.events,
    };
  }

  const strip = (out) => {
    const b = Object.assign({}, out);
    delete b.restored; delete b.events; delete b.applied;
    return b;
  };

  const nowOf = (ctx) => { const t = msOf(ctx && ctx.now); return Number.isFinite(t) ? t : Date.now(); };

  // ---------------------------------------------------------------------------
  // Дифф
  // ---------------------------------------------------------------------------

  /** Правки, которые превращают prev в next: по сущностям и полям верхнего
   *  уровня, записи времени — по id. Список, которого в next нет вовсе
   *  (не массив), пропускается: «не знаю» — не «удалил всё», как в
   *  pickDocuments (core/sync.js) для версий без документов.
   *  meta: { deviceId, at, baseSeq, newId(op, key) } */
  function diffStates(prev, next, meta) {
    const m = meta || {};
    const at = isoOf(m.at) || new Date().toISOString();
    const base = Number.isFinite(Number(m.baseSeq)) ? Number(m.baseSeq) : 0;
    const dev = m.deviceId === undefined || m.deviceId === null ? '' : String(m.deviceId);
    const mk = (entity, entityId, field, value, key) => {
      const o = { id: null, entity, entityId: String(entityId), field, value: scrub(value), at, deviceId: dev, baseSeq: base, seq: null };
      o.id = m.newId ? String(m.newId(o, key)) : randomId();
      return o;
    };
    const p = prev || {};
    const n = next || {};
    const creates = [];
    const edits = [];
    const drops = [];
    for (const kind of KINDS) {
      const coll = LISTS[kind];
      if (!Array.isArray(n[coll])) continue;
      const before = new Map();
      for (const e of (Array.isArray(p[coll]) ? p[coll] : [])) if (e && e.id !== undefined && e.id !== null) before.set(String(e.id), e);
      const after = new Set();
      for (const e of n[coll]) {
        if (!e || e.id === undefined || e.id === null) continue;
        const id = String(e.id);
        if (after.has(id)) continue;
        after.add(id);
        const old = before.get(id);
        if (!old) creates.push(mk(kind, id, '*', clone(e)));
        else diffEntity(kind, id, old, e, mk, edits);
      }
      for (const id of before.keys()) if (!after.has(id)) drops.push(mk(kind, id, 'deleted', at));
    }
    return creates.concat(edits, drops);
  }

  function diffEntity(kind, id, a, b, mk, out) {
    const skip = DERIVED[kind];
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) {
      if (RESERVED.has(k) || (skip && skip.has(k))) continue;
      if (kind === 'task' && k === 'sessions') { diffSessions(id, a.sessions, b.sessions, mk, out); continue; }
      if (!same(a[k], b[k])) out.push(mk(kind, id, k, clone(b[k])));
    }
  }

  function diffSessions(id, a, b, mk, out) {
    const la = (Array.isArray(a) ? a : []).filter(isObj);
    const lb = (Array.isArray(b) ? b : []).filter(isObj);
    const ka = sessionKeys(la);
    const kb = sessionKeys(lb);
    const before = new Map(ka.map((k, i) => [k, la[i]]));
    const after = new Map(kb.map((k, i) => [k, lb[i]]));
    for (const [k, rec] of after) {
      const old = before.get(k);
      const v = Object.assign(clone(rec), { id: k });
      if (!old) out.push(mk('task', id, 'sessions+', v, k));
      else if (!sameSession(old, rec)) out.push(mk('task', id, 'sessions~', v, k));
    }
    for (const k of before.keys()) if (!after.has(k)) out.push(mk('task', id, 'sessions-', k, k));
  }

  const SYNCED = KINDS.map((k) => LISTS[k]);

  /** Блоб для старых клиентов — тот же состав, что syncPayload в app.js. */
  function mirrorSyncState(state) {
    const s = state && state.state && !Array.isArray(state.tasks) ? state.state : (state || {});
    const out = {};
    for (const coll of SYNCED) out[coll] = Array.isArray(s[coll]) ? s[coll].slice() : [];
    return out;
  }

  // ---------------------------------------------------------------------------
  // Применение
  // ---------------------------------------------------------------------------

  /** Механическое применение правок по порядку — без журнала, конфликтов и
   *  корзины (для этого mergeIncoming). Неизвестные сущности создаются из
   *  '*', правка несуществующей без '*' возвращается в deferred. Идемпотентно:
   *  повтор id (opts.appliedIds) и seq ≤ opts.lastSeq пропускаются, а сами
   *  правки ставят значения, а не прибавляют.
   *  @returns {{state, applied, deferred}} */
  function applyOps(state, ops, opts) {
    const o = opts || {};
    const nowMs = nowOf(o);
    const w = begin({ state });
    const done = new Set(o.appliedIds || []);
    const after = Number.isFinite(Number(o.lastSeq)) ? Number(o.lastSeq) : null;
    const applied = [];
    const waiting = [];
    const one = (x) => {
      if (!LISTS[x.entity]) return true;
      const kind = x.entity;
      const id = x.entityId;
      switch (x.field) {
        case '*':
          if (!getEnt(w, kind, id) && isObj(x.value)) {
            const ent = clone(x.value);
            if (ent.id === undefined || ent.id === null) ent.id = id;
            insertEnt(w, kind, ent);
          }
          return true;
        case 'deleted':
          if (x.value !== null && x.value !== undefined) removeEnt(w, kind, id);
          return true;
        case 'conflict': case 'resolved':
          return true;
        case 'sessions+': case 'sessions~': case 'sessions-': {
          if (kind !== 'task') break;
          if (!getEnt(w, kind, id)) return false;
          if (x.field === 'sessions-') {
            const sid = typeof x.value === 'string' ? x.value : (isObj(x.value) ? x.value.id : null);
            if (sid) sessionPut(w, kind, id, sid, null);
          } else if (isObj(x.value)) {
            sessionPut(w, kind, id, hasId(x.value) ? x.value.id : sessionKeys([x.value])[0], x.value);
          }
          return true;
        }
        default:
      }
      if (!getEnt(w, kind, id)) return false;
      plainIO(w, kind, id, x.field).put(x.value);
      return true;
    };
    for (const raw of (ops || []).map(normOp).filter(Boolean)) {
      if (done.has(raw.id)) continue;
      if (after !== null && raw.seq !== null && raw.seq <= after) continue;
      done.add(raw.id);
      const x = clampAt(raw, nowMs);
      if (one(x)) applied.push(x); else waiting.push(x);
    }
    let progress = true;
    while (progress && waiting.length) {
      progress = false;
      for (let i = 0; i < waiting.length; i++) {
        if (one(waiting[i])) { applied.push(waiting[i]); waiting.splice(i, 1); i -= 1; progress = true; }
      }
    }
    return { state: w.state, applied, deferred: waiting };
  }

  /**
   * Приём правок из журнала: правила 1–8. local — пачка; incoming — правки
   * или строки таблицы (op_id…), подряд после lastSeq, в любом порядке внутри.
   * ctx: { deviceId, now, newId, replay } — replay: применять и свои (снимок).
   *
   * Своя правка — по op_id, не по deviceId: в очереди, среди отправленных
   * (meta, s — их туда кладёт ackPending) или уже в истории сущности с этим
   * deviceId (пачка, сохранённая до списка s). Её только подтверждают. Строка
   * с тем же deviceId, но чужим op_id — правка копии устройства (вторая
   * вкладка, телефон из резервной копии, скопированная папка десктопа): она
   * применяется, как любая чужая, иначе копии разошлись бы навсегда — lastSeq
   * ушёл бы за правку, которой в состоянии нет.
   * @returns {{state, pending, lastSeq, conflicts, trash, meta, deferred,
   *            restored, events}} restored — сущности, спасённые от удаления;
   *   events — для тостов: restored | undeleted | deleted | conflict | resolved.
   */
  function mergeIncoming(local, incoming, ctx) {
    const c = Object.assign({}, ctx || {});
    c.nowMs = nowOf(c);
    const w = begin(local);
    const dev = c.deviceId === undefined || c.deviceId === null ? '' : String(c.deviceId);
    if (!c.replay) {
      w.ownOps = new Set(w.pendingIds);
      for (const ek of Object.keys(w.meta)) for (const id of sentOf(w.meta[ek]) || []) w.ownOps.add(id);
    }
    const ops = (incoming || [])
      .map((o) => (o && o.op_id !== undefined ? rowToOp(o) : o))
      .map(normOp)
      .filter(Boolean)
      .sort(bySeq);
    const seen = new Set();
    for (const raw of ops) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      const x = clampAt(raw, c.nowMs);
      const ek = ekOf(x.entity, x.entityId);
      const mine = !c.replay && (w.ownOps.has(x.id) || (dev !== '' && x.deviceId === dev && inHistory(w, ek, x.id)));
      if (mine) {
        if (x.seq !== null) { confirm(w, c, x); unmarkSent(w, ek, x.id); }
      } else if (x.seq === null || x.seq > w.lastSeq) {
        absorb(w, c, x);
        if (x.seq !== null) seqIntoVersions(w, x);
      }
      if (x.seq !== null && x.seq > w.lastSeq) w.lastSeq = x.seq;
    }
    retryDeferred(w, c);
    rescueAll(w, c);
    return finish(w, c);
  }

  /** Спасённое своей правкой от давнего чужого удаления (absorbDelete) — в
   *  очередь заново целиком, '*' с тем, что сейчас в состоянии. У того, кто
   *  сущность уже вычистил из корзины, это создание, и ждавшая поздняя
   *  правка ложится следом; у того, кто её держит, — правка каждого поля тем
   *  же значением. Время '*' — самой поздней известной правки сущности, а не
   *  «сейчас»: в споре с чьей-то параллельной правкой поля старое значение
   *  из '*' не должно выигрывать только потому, что ушло позже. */
  function rescueAll(w, c) {
    if (!w.rescue.size || c.deviceId === undefined || c.deviceId === null || c.deviceId === '') return;
    for (const [kind, id] of w.rescue.values()) {
      const ent = getEnt(w, kind, id);
      if (!ent) continue; // удалили следом, в том же приёме
      const m = w.meta[ekOf(kind, id)] || {};
      const refs = [m.c, m.r];
      for (const fk of Object.keys(m.f || {})) refs.push(...m.f[fk]);
      const ats = refs.map((h) => (h ? msOf(h.at) : NaN)).filter(Number.isFinite);
      const op = {
        id: c.newId ? String(c.newId()) : randomId(),
        entity: kind,
        entityId: id,
        field: '*',
        value: scrub(clone(ent)),
        at: isoOf(ats.length ? Math.min(Math.max(...ats), c.nowMs) : c.nowMs) || new Date().toISOString(),
        deviceId: String(c.deviceId),
        baseSeq: w.lastSeq,
        seq: null,
      };
      w.pending.push(op);
      w.pendingIds.add(op.id);
      ownWhole(w, op, refOf(op));
    }
    w.rescue = new Map();
  }

  /** Версия конфликта могла лечь из пометки раньше своей правки и без seq —
   *  пришла правка, seq известен всем одинаково. */
  function seqIntoVersions(w, x) {
    const m = w.meta[ekOf(x.entity, x.entityId)];
    if (!m || !m.k) return;
    for (const fk of Object.keys(m.k)) {
      const rec = m.k[fk];
      if (!rec.versions.some((v) => v.opId === x.id && (v.seq === null || v.seq === undefined))) continue;
      putRec(w, x.entity, x.entityId, fk, Object.assign({}, rec, {
        versions: rec.versions.map((v) => (v.opId === x.id ? Object.assign({}, v, { seq: x.seq, at: x.at }) : v)),
      }));
    }
  }

  /** Ответ сервера на отправку: свои правки получили seq. lastSeq не
   *  двигается — журнал до них ещё мог быть не прочитан. Правка уходит из
   *  очереди в отправленные (meta, s), пока журнал её не вернёт: по op_id
   *  приём узнает её своей. rows — строки таблицы или правки. */
  function ackPending(bundle, rows, ctx) {
    const c = Object.assign({}, ctx || {});
    c.nowMs = nowOf(c);
    const w = begin(bundle);
    for (const r of rows || []) {
      const x = normOp(r && r.op_id !== undefined ? rowToOp(r) : r);
      if (!x || x.seq === null) continue;
      const queued = w.pendingIds.has(x.id);
      const ek = confirm(w, c, clampAt(x, c.nowMs));
      if (queued && ek && x.seq > w.lastSeq) markSent(w, ek, x.id);
    }
    return strip(finish(w, c));
  }

  /** Своя '*' существующей сущности — верхняя правка каждого её поля. */
  function ownWhole(w, op, r) {
    if (!isObj(op.value)) return;
    const ek = ekOf(op.entity, op.entityId);
    for (const key of fieldsOf(op.entity, op.value)) setHeads(w, ek, key, [r]);
    for (const [sid] of sessionsOf(op.entity, op.value)) setHeads(w, ek, SESSION + sid, [r]);
  }

  /** Своя правка — без конфликтов: она видела всё, что устройство применило. */
  function ownOp(w, op, prevState) {
    const ek = ekOf(op.entity, op.entityId);
    const r = refOf(op);
    switch (op.field) {
      case '*':
        if (w.trash.has(ek)) {
          // Вернули своё удалённое (отмена на месте): это '*' существующей
          // сущности — верхняя правка всех её полей, как и у получателей.
          setMetaKey(w, ek, 'r', r);
          w.trash.delete(ek);
          ownWhole(w, op, r);
        } else {
          setMetaKey(w, ek, 'c', r);
        }
        break;
      case 'deleted': {
        setMetaKey(w, ek, 'd', r);
        const coll = LISTS[op.entity];
        const prev = (Array.isArray(prevState[coll]) ? prevState[coll] : []).find((e) => e && String(e.id) === op.entityId);
        if (prev) {
          w.trash.set(ek, {
            entity: op.entity, entityId: op.entityId, data: prev, deletedAt: op.value, deviceId: op.deviceId, opId: op.id, ref: r,
          });
        }
        break;
      }
      case 'sessions+': case 'sessions~': setHeads(w, ek, SESSION + op.value.id, [r]); break;
      case 'sessions-': setHeads(w, ek, SESSION + op.value, [r]); break;
      default: setHeads(w, ek, op.field, [r]);
    }
  }

  /** Сохранение на устройстве: дифф с последним сохранённым → правки в
   *  pending, удалённое — в корзину, состояние пачки — копия next. Копия —
   *  без \u0000 в строках (scrub), и дифф считается с ней: правка уходит
   *  чистой, а то, что живое состояние клиента ещё держит символ, следующего
   *  сохранения не тревожит.
   *  meta: { deviceId, at, newId }. @returns {{bundle, ops}} */
  function commitLocal(bundle, next, meta) {
    const b = bundleOf(bundle);
    const m = meta || {};
    const clean = {};
    for (const coll of SYNCED) if (next && Array.isArray(next[coll])) clean[coll] = cleanCopy(next[coll]);
    const ops = diffStates(b.state, clean, { deviceId: m.deviceId, at: m.at, baseSeq: b.lastSeq, newId: m.newId });
    const state = Object.assign({}, b.state, clean);
    if (!ops.length) return { bundle: Object.assign({}, b, { state }), ops };
    const w = begin(b);
    for (const op of ops) ownOp(w, op, b.state);
    w.pending = w.pending.concat(ops);
    const out = strip(finish(w, { deviceId: m.deviceId }));
    out.state = state;
    return { bundle: out, ops };
  }

  /** Выбор в конфликте. choice — 'ours' | 'theirs' | opId версии.
   *  @returns {{bundle, ops}} ops — правка поля выбранным значением и
   *    'resolved' со списком увиденных версий. */
  function resolveConflict(bundle, conflictId, choice, meta) {
    const b = bundleOf(bundle);
    const m = meta || {};
    const raw = b.conflicts.find((r) => r && r.id === conflictId);
    if (!raw) return { bundle: b, ops: [] };
    const rec = label(raw, m.deviceId);
    const ver = choice === 'ours' ? rec.ours : choice === 'theirs' ? rec.theirs : pub(rec.versions.find((v) => v.opId === choice));
    if (!ver) return { bundle: b, ops: [] };
    const at = isoOf(m.at) || new Date().toISOString();
    const mk = (field, value) => ({
      id: m.newId ? String(m.newId()) : randomId(),
      entity: rec.entity, entityId: rec.entityId, field, value: scrub(value), at, deviceId: m.deviceId === undefined ? '' : String(m.deviceId), baseSeq: b.lastSeq, seq: null,
    });
    let fieldOp;
    let fk;
    if (rec.sessionId) {
      fk = SESSION + rec.sessionId;
      fieldOp = ver.value === null || ver.value === undefined
        ? mk('sessions-', rec.sessionId)
        : mk('sessions~', Object.assign(clone(ver.value), { id: rec.sessionId }));
    } else {
      fk = rec.field;
      fieldOp = mk(rec.field, clone(ver.value));
    }
    const ek = ekOf(rec.entity, rec.entityId);
    // Увиденное — все версии записи (и скрытые черновики) и все верхние
    // правки поля: снять у других устройств надо ровно то, из чего выбирали.
    const hm = b.meta[ek];
    const seen = new Set(rec.versions.map((v) => v.opId));
    for (const v of (hm && hm.k && hm.k[fk] && hm.k[fk].versions) || []) seen.add(v.opId);
    for (const h of (hm && hm.f && hm.f[fk]) || []) seen.add(h.id);
    const done = mk('resolved', { key: rec.id, field: rec.field, sessionId: rec.sessionId || null, keep: ver.opId, op: fieldOp.id, seen: [...seen] });
    const w = begin(b);
    if (peek(w, rec.entity, rec.entityId)) ioFor(w, rec.entity, rec.entityId, fk).put(fieldOp.field === 'sessions-' ? null : fieldOp.value);
    setHeads(w, ek, fk, [refOf(fieldOp)]);
    dropVersions(w, rec.entity, rec.entityId, fk, seen);
    w.pending.push(fieldOp, done);
    return { bundle: strip(finish(w, { deviceId: m.deviceId })), ops: [fieldOp, done] };
  }

  /** Вернуть из корзины. Правки: 'deleted' = null (возврат) и '*' со всей
   *  сущностью — второе нужно устройству, которое уже вычистило корзину.
   *  @returns {{bundle, ops}} */
  function restoreFromTrash(bundle, entity, entityId, meta) {
    const b = bundleOf(bundle);
    const m = meta || {};
    const id = String(entityId);
    const t = b.trash.find((x) => x && x.entity === entity && String(x.entityId) === id);
    if (!t) return { bundle: b, ops: [] };
    const at = isoOf(m.at) || new Date().toISOString();
    const mk = (field, value) => ({
      id: m.newId ? String(m.newId()) : randomId(),
      entity, entityId: id, field, value: scrub(value), at, deviceId: m.deviceId === undefined ? '' : String(m.deviceId), baseSeq: b.lastSeq, seq: null,
    });
    const back = mk('deleted', null);
    const copy = clone(t.data);
    const whole = mk('*', copy);
    const w = begin(b);
    // Удалённое до чистки \u0000 возвращается уже без него — как ушло в '*'.
    if (whole.value !== copy) w.trash.set(ekOf(entity, id), Object.assign({}, t, { data: clone(whole.value) }));
    restore(w, entity, id, 'undeleted', m.deviceId);
    const ek = ekOf(entity, id);
    setMetaKey(w, ek, 'r', refOf(back));
    ownWhole(w, whole, refOf(whole));
    w.pending.push(back, whole);
    return { bundle: strip(finish(w, { deviceId: m.deviceId })), ops: [back, whole] };
  }

  /** Окончательно убрать из корзины удалённое раньше, чем days дней назад:
   *  из корзины, meta, конфликтов и отложенных правок. На сервере журнал
   *  остаётся. Отложенные правки старше того же срока тоже уходят — их
   *  сущность так и не пришла. @returns пачка */
  function trashSweep(bundle, now, days) {
    const b = bundleOf(bundle);
    const span = Number.isFinite(Number(days)) ? Number(days) : 30;
    const limit = (Number.isFinite(msOf(now)) ? msOf(now) : Date.now()) - span * DAY_MS;
    const gone = new Set();
    const trash = b.trash.filter((t) => {
      const d = msOf(t.deletedAt);
      if (Number.isFinite(d) && d < limit) { gone.add(ekOf(t.entity, t.entityId)); return false; }
      return true;
    });
    if (!gone.size && !b.deferred.some((d) => msOf(d.deferredAt) < limit)) return Object.assign({}, bundle, b);
    const meta = Object.assign({}, b.meta);
    for (const ek of gone) delete meta[ek];
    return Object.assign({}, bundle, b, {
      trash,
      meta,
      conflicts: b.conflicts.filter((c) => !gone.has(ekOf(c.entity, c.entityId))),
      deferred: b.deferred.filter((d) => !gone.has(ekOf(d.entity, d.entityId)) && !(msOf(d.deferredAt) < limit)),
    });
  }

  // ---------------------------------------------------------------------------
  // Снимок, мост, гость
  // ---------------------------------------------------------------------------

  /** Слепок для таблицы snapshots: новое устройство не читает весь журнал.
   *  Берёт пачку (или голое состояние). С неотправленными правками — null:
   *  их уже видно в состоянии, а в журнале до seq их ещё нет, и снимок
   *  соврал бы. data — блоб (как sync_state) плюс oplog: корзина, конфликты,
   *  meta и отложенные правки. */
  function compactSnapshot(source, seq) {
    const isBundle = source && isObj(source.state) && !Array.isArray(source.tasks);
    const b = isBundle ? bundleOf(source) : bundleOf({ state: source || {} });
    if (b.pending.length) return null;
    const at = Number.isFinite(Number(seq)) ? Number(seq) : b.lastSeq;
    const data = clone(mirrorSyncState(b.state));
    data.oplog = clone({
      trash: b.trash,
      conflicts: b.conflicts.map((r) => { const c = Object.assign({}, r); delete c.ours; delete c.theirs; delete c.shown; return c; }),
      meta: withoutSent(b.meta), // «отправленные» — знание этого устройства, не журнала
      deferred: b.deferred,
    });
    return { seq: at, data };
  }

  /** Пачка из снимка и правок после него. Снимок старого sync_state — это
   *  { seq: 0, data: блоб } (переход со старой схемы). Свои правки после
   *  снимка применяются как чужие (replay). */
  function bootstrapFromSnapshot(snapshot, opsAfter, ctx) {
    const snap = snapshot || {};
    const data = isObj(snap.data) ? snap.data : {};
    const extra = isObj(data.oplog) ? data.oplog : {};
    const state = {};
    for (const coll of SYNCED) state[coll] = Array.isArray(data[coll]) ? clone(data[coll]) : [];
    const b = {
      state,
      pending: [],
      lastSeq: Number.isFinite(Number(snap.seq)) ? Number(snap.seq) : 0,
      conflicts: Array.isArray(extra.conflicts) ? clone(extra.conflicts) : [],
      trash: Array.isArray(extra.trash) ? clone(extra.trash) : [],
      meta: isObj(extra.meta) ? withoutSent(clone(extra.meta)) : {},
      deferred: Array.isArray(extra.deferred) ? clone(extra.deferred) : [],
    };
    return mergeIncoming(b, opsAfter || [], Object.assign({}, ctx || {}, { replay: true }));
  }

  /** Мост к старым клиентам (десктоп ≤ 0.4.4, телефон ≤ 1.2.3): два блоба
   *  sync_state → правки устройства 'legacy'. meta: { at, baseSeq, stamp } —
   *  baseSeq — seq зеркала, на котором старый клиент стоял (sync_state.
   *  mirror_seq); stamp (updated_at строки) делает id правок одинаковыми на
   *  всех новых устройствах, и повтор отбивает сервер. */
  function legacyBridgeOps(prevSyncState, nextSyncState, meta) {
    const m = meta || {};
    const stamp = m.stamp === undefined || m.stamp === null ? null : String(m.stamp);
    return diffStates(prevSyncState || {}, nextSyncState || {}, {
      deviceId: LEGACY,
      at: m.at,
      baseSeq: m.baseSeq || 0,
      newId: m.newId || (stamp !== null
        ? (o, key) => stableId(`legacy|${stamp}|${o.entity}|${o.entityId}|${o.field}|${key || ''}`)
        : undefined),
    });
  }

  /** Гость → вход: правки создания всего локального, baseSeq 0 — не видели
   *  ничего из аккаунта. Время правки — updatedAt сущности (не позже meta.at).
   *
   *  meta.into — пачка аккаунта (уже прочитанная с сервера). С ней сущность,
   *  которая есть и у гостя, и в аккаунте (то же id: устройство когда-то
   *  синхронизировалось, вышло и работало без входа), не шлётся целиком:
   *  по каждому расходящемуся полю побеждает более свежая по updatedAt
   *  сторона (поровну — аккаунт), гостевая победа уходит обычной правкой, а
   *  обе версии — пометкой 'conflict'. Без into такая сущность пришла бы
   *  '*' поверх значений аккаунта, у которых нет истории в журнале (снимок),
   *  и молча их заменила бы. Записи времени, которых в аккаунте нет, просто
   *  добавляются; чего нет у гостя — остаётся. */
  function guestImportOps(state, meta) {
    const m = meta || {};
    const cap = Number.isFinite(msOf(m.at)) ? msOf(m.at) : Date.now();
    const at = new Date(cap).toISOString();
    const ops = diffStates({}, state || {}, { deviceId: m.deviceId, at, baseSeq: 0, newId: m.newId });
    for (const op of ops) {
      const t = msOf(op.value && (op.value.updatedAt || op.value.createdAt));
      if (Number.isFinite(t) && t < cap) op.at = new Date(t).toISOString();
    }
    if (!m.into) return ops;
    const into = bundleOf(m.into);
    const w = begin(into);
    const out = [];
    for (const op of ops) {
      const p = peek(w, op.entity, op.entityId);
      if (!p || p.trash) out.push(op);
      else out.push(...sharedOps(w, op, p.ent, into.lastSeq, Object.assign({}, m, { at })));
    }
    return out;
  }

  function sharedOps(w, op, acc, lastSeq, m) {
    const kind = op.entity;
    const id = op.entityId;
    const ek = ekOf(kind, id);
    const g = op.value;
    const dev = m.deviceId === undefined || m.deviceId === null ? '' : String(m.deviceId);
    const accAt = acc.updatedAt || acc.createdAt || null;
    const guestWins = msOf(op.at) > msOf(accAt) || (!Number.isFinite(msOf(accAt)) && Number.isFinite(msOf(op.at)));
    const mk = (field, value) => ({
      id: m.newId ? String(m.newId()) : randomId(),
      entity: kind, entityId: id, field, value, at: m.at, deviceId: dev, baseSeq: lastSeq, seq: null,
    });
    const ops = [];
    const marks = [];
    const accVersion = (fk, value) => {
      const heads = headsOf(w, ek, fk) || [];
      const h = heads.length === 1 ? heads[0] : null;
      return {
        opId: stableId(`account|${ek}|${fk}|${op.id}`), value: clone(value), at: h ? h.at : accAt, deviceId: h ? h.dev : '', seq: null, baseSeq: 0,
      };
    };
    const one = (fk, accV, gV, opFor) => {
      if (gV === null || gV === undefined) return; // гостю нечего добавить
      if (accV === null || accV === undefined) { ops.push(opFor()); return; } // в аккаунте пусто — терять нечего
      if (fk.startsWith(SESSION) ? sameSession(accV, gV) : same(accV, gV)) return;
      if (!fk.startsWith(SESSION) && QUIET.has(fk)) { if (guestWins) ops.push(opFor()); return; }
      let gVer;
      if (guestWins) {
        const o = opFor();
        ops.push(o);
        gVer = { opId: o.id, value: clone(gV), at: op.at, deviceId: dev, seq: null, baseSeq: lastSeq };
      } else {
        gVer = { opId: stableId(`guest|${ek}|${fk}|${op.id}`), value: clone(gV), at: op.at, deviceId: dev, seq: null, baseSeq: 0 };
      }
      const session = fk.startsWith(SESSION);
      marks.push(mk('conflict', {
        key: cidOf(kind, id, fk), field: session ? 'sessions' : fk, sessionId: session ? fk.slice(SESSION.length) : null, versions: [accVersion(fk, accV), gVer],
      }));
    };
    for (const key of fieldsOf(kind, g)) one(key, acc[key], g[key], () => mk(key, clone(g[key])));
    for (const [sid, rec] of sessionsOf(kind, g)) {
      const accRec = sessionAt(acc, sid);
      one(SESSION + sid, accRec, rec, () => mk(accRec ? 'sessions~' : 'sessions+', clone(rec)));
    }
    return ops.concat(marks);
  }

  /** Вход гостя одним вызовом: guestImportOps с into, применение к пачке
   *  аккаунта, правки — в pending (вернувшись с сервера, они только
   *  подтвердятся). @returns {{bundle, ops, restored, events}} */
  function adoptGuestState(bundle, guestState, meta) {
    const m = meta || {};
    const ops = guestImportOps(guestState, Object.assign({}, m, { into: bundle }));
    const before = bundleOf(bundle).pending.length;
    const out = mergeIncoming(bundle, ops, { deviceId: m.deviceId, now: m.at, newId: m.newId, replay: true });
    const restored = out.restored;
    const events = out.events;
    const b = strip(out);
    // Сами правки — до пометок о конфликтах, которые они вызвали.
    b.pending = b.pending.slice(0, before).concat(ops, b.pending.slice(before));
    b.conflicts = b.conflicts.map((r) => label(r, m.deviceId));
    return { bundle: b, ops, restored, events };
  }

  const api = {
    diffStates,
    applyOps,
    mergeIncoming,
    isConcurrent,
    resolveConflict,
    trashSweep,
    compactSnapshot,
    bootstrapFromSnapshot,
    legacyBridgeOps,
    mirrorSyncState,
    guestImportOps,
    adoptGuestState,
    commitLocal,
    ackPending,
    restoreFromTrash,
    stampSessionIds,
    opToRow,
    rowToOp,
  };

  if (isNode) module.exports = api;
  else Object.assign((global.Core = global.Core || {}), api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Стор аутентификации, отдельный от useAppStore — данные проектов/задач
// сохраняются локально независимо от того, вошёл ли пользователь (офлайн-
// первый принцип, как на десктопе/вебе). status используется SettingsScreen
// для переключения между экраном входа и профилем (вход опционален, гейта
// на уровне навигации нет — см. RootNavigator).
//
// Несколько аккаунтов (17 октября 2026). У каждого аккаунта своя область
// данных на телефоне (lancible-data:<uid>), у гостя — прежняя lancible-data;
// какая открыта — current. Список аккаунтов с токенами неактивных —
// lib/accounts.js, правила — ядро (core/accounts.js). status и user — про
// сеанс ТЕКУЩЕГО: у гостя — 'signedOut', у аккаунта без живого сеанса
// («нужно войти заново», нет сети) — тоже 'signedOut', а его запись — в
// accounts.
//
// Почему переключение не зовёт sb.auth.signOut({ scope: 'local' }):
// supabase-js 2.116 и с этим scope шлёт на сервер POST /logout?scope=local,
// и сервер удаляет сеанс — сохранённый в списке refresh-токен потом не
// поднять. Поэтому сеанс следующего аккаунта просто ставится поверх
// (setSession), а уходя к гостю (или к аккаунту, чей сеанс не поднялся), сеанс
// снимается только на телефоне — dropLocalSession. Отзывает сеанс на сервере
// только «Выйти».
import { useMemo } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { sb } from '../lib/supabaseClient';
import * as auth from '../lib/auth';
import {
  loadAccounts, saveAccounts, scopeHasData, storedScopes, removeScope, sessionEntry,
  upsertEntry, setCurrent, markStale, removeEntry, forgetLabel,
  askMoveGuest, readGuestScope, writeGuestScope,
} from '../lib/accounts';
import { t } from '../lib/i18n';
import { setSyncUser, syncOnSignIn, flushSync, adoptGuestData } from '../lib/sync';
import { queueAssetForget, dropAssetForget } from '../lib/assetForget';
import { openDataScope, useAppStore } from './useAppStore';
import { closeSheet } from './useSheetStore';
import Accounts from '../core/accounts.js';
import CoreSync from '../core/sync.js';

// Идёт своё действие со входом (переключение, вход, выход): события
// supabase в это время только обновляют токены в списке, а что открыть и
// какой статус — решает само действие.
let busy = 0;
let initStarted = false;
// uid последнего живого сеанса supabase — чей сеанс пропал, если пришёл
// SIGNED_OUT не от нас.
let liveUid = null;
// Кому предложить перенести гостевые данные, когда вход дойдёт до согласия:
// вошли из гостя с данными в аккаунт, пустой на этом телефоне.
let offerMoveFor = null;

// Настоящий отказ сервера (refresh-токен отозван, использован, не найден) —
// ответ 4xx. Сеть, таймаут, 5xx — не отказ: запись не помечается «нужно войти
// заново», попробуем снова при возврате на экран.
const isRefusal = (err) => !!err && typeof err.status === 'number' && err.status >= 400 && err.status < 500;
const defer = (fn) => setTimeout(fn, 0);

/** Снять сеанс только на телефоне, без сервера. Публичного способа у
 *  supabase-js нет (signOut с любым scope идёт на сервер), поэтому —
 *  приватный _removeSession() клиента 2.116: стирает ключ сеанса в хранилище
 *  и не даёт идущему обновлению токена записать его обратно. Нет такого
 *  метода (другая версия) — стираем ключ сами: клиент читает сеанс из
 *  хранилища при каждом обращении. Токены к этому времени уже в списке. */
async function dropLocalSession() {
  try {
    if (typeof sb.auth._removeSession === 'function') await sb.auth._removeSession();
    else if (sb.auth.storageKey) await AsyncStorage.multiRemove([sb.auth.storageKey, `${sb.auth.storageKey}-user`]);
  } catch (err) {
    console.error('Не удалось снять сеанс на телефоне:', err);
  }
  liveUid = null;
}

async function liveSession() {
  try {
    const { data } = await sb.auth.getSession();
    return (data && data.session) || null;
  } catch {
    return null;
  }
}

export const useAuthStore = create((set, get) => {
  /** Правка списка: сразу в стор (следующая правка увидит её), потом в хранилище. */
  function editAccounts(fn) {
    const prev = get().accounts;
    const next = fn(prev);
    set({ accounts: next, current: next.current });
    saveAccounts(next);
    return next;
  }

  /** Свежие токены сеанса — в его запись: refresh-токены ротируются, и
   *  старый при возврате дал бы refresh_token_already_used. */
  function rememberSession(session) {
    if (!session || !session.user) return;
    liveUid = session.user.id;
    editAccounts((acc) => upsertEntry(acc, sessionEntry(session)));
  }

  async function saveLiveTokens() {
    const s = await liveSession();
    if (s) rememberSession(s);
  }

  async function withBusy(fn) {
    busy += 1;
    try {
      return await fn();
    } finally {
      busy -= 1;
    }
  }

  /** Гостевые данные и области аккаунтов на телефоне — для строк «Без
   *  аккаунта» и «Удалить данные аккаунта с устройства». */
  async function refreshDevice() {
    const [guestHasData, scopes] = await Promise.all([scopeHasData(null), storedScopes()]);
    const withData = [];
    for (const uid of scopes) if (await scopeHasData(uid)) withData.push(uid);
    set({ guestHasData, deviceScopes: withData });
  }

  const lang = () => useAppStore.getState().settings.lang;
  const toast = (key, vars) => useAppStore.getState().showToast(t(lang(), key, vars));
  const nameOf = (uid) => Accounts.accountLabel(Accounts.findAccount(get().accounts, uid), (k) => t(lang(), k));

  /** Открыть область uid (null — гость): экран «Переключаю…», пока она
   *  читается, — старые данные не мигают. Лист закрывается: он был про
   *  прежний аккаунт. offerMove — это вход: если пришли из гостя с данными, а
   *  область аккаунта пуста, после согласия спросим, перенести ли их. */
  async function openScope(uid, { offerMove = false } = {}) {
    const fromGuest = get().current === null;
    set({ switching: true });
    closeSheet();
    // Кадр на то, чтобы экраны прежней области ушли (и редактор успел
    // сохраниться в свою область, store/useAppStore.js закрывает запись).
    await new Promise((r) => setTimeout(r, 0));
    let read = false;
    try {
      // Аккаунт снова на телефоне — его картинки больше не стирать: в очереди
      // (lib/assetForget.js) он мог остаться, пока не открылся редактор.
      if (uid) await dropAssetForget(uid);
      editAccounts((acc) => setCurrent(uid ? upsertEntry(acc, { uid, lastUsedAt: Date.now() }) : acc, uid));
      read = await openDataScope(uid);
    } finally {
      set({ switching: false });
    }
    refreshDevice();
    // Не прочиталась — пустой она только кажется: переносить в неё нечего.
    if (read && offerMove && uid && fromGuest && !CoreSync.hasData(useAppStore.getState()) && await scopeHasData(null)) offerMoveFor = uid;
    return read;
  }

  /** Перенести гостевые данные в открытый аккаунт. Слияние — журналом
   *  правок, как у веба (lib/sync.js: adoptGuestData, 17 октября 2026):
   *  область связана с журналом — сразу adoptGuestState (гостевое приходит
   *  правками, общее с аккаунтом — по полям, обе версии расходящегося
   *  остаются конфликтом, ничего не затирается молча); ещё не связана —
   *  объединение без дублей, а слияние сделает первая связь. Таймер гостя
   *  переезжает, если у аккаунта своего нет. Гостевая область переписывается
   *  пустой (emptiedScopeData: его настройки остаются), а не удаляется. */
  async function moveGuest() {
    const stored = await readGuestScope();
    const guest = stored && stored.state;
    if (!get().current || !CoreSync.hasData(guest)) return false;
    if (!adoptGuestData(guest)) return false;
    // Картинки гостя в хранилище редактора — тоже этому аккаунту: отдаст их
    // ближайшая открытая страница редактора (DocEditor: assets-adopt).
    useAppStore.getState().queueAssetAdopt(get().current);
    await writeGuestScope({ ...stored, state: Accounts.emptiedScopeData(guest) });
    set({ guestHasData: false });
    refreshDevice();
    return true;
  }

  /** Состояние входа после afterSignedIn. Синхронизация — только с
   *  принятым согласием и только у текущего аккаунта. */
  function applyAuthResult(result) {
    if (!result.user || result.user.id !== get().current) return;
    const status = result.needsOnboarding ? 'needsOnboarding' : result.needsConsent ? 'needsConsent' : 'signedIn';
    set({ status, user: result.user });
    editAccounts((acc) => upsertEntry(acc, { uid: result.user.id, email: result.user.email || '', name: result.user.name || '' }));
    // Подпись области — в её же настройки: по ней веб и десктоп называют
    // копию аккаунта, из которого вышли (у телефона для этого есть и known).
    const label = { email: result.user.email || '', name: result.user.name || '' };
    const had = useAppStore.getState().settings.account;
    if (!had || had.email !== label.email || had.name !== label.name) useAppStore.getState().setSettings({ account: label });
    if (status !== 'signedIn') return;
    const uid = result.user.id;
    const startSync = () => {
      if (get().current !== uid) return;
      setSyncUser(uid);
      syncOnSignIn(uid);
    };
    if (offerMoveFor !== uid) {
      startSync();
      return;
    }
    // Перенос гостевых данных — после согласия и до синхронизации: облако
    // увидит уже то, что человек решил оставить.
    offerMoveFor = null;
    askMoveGuest(lang()).then(async (choice) => {
      if (choice === 'move' && get().current === uid && await moveGuest()) toast('accounts.moved_toast');
      startSync();
    });
  }

  /** Поднять сеанс текущего аккаунта uid: живой — взять, нет — setSession
   *  из списка. Отказ сервера — «нужно войти заново»; нет сети — данные
   *  открыты как есть, без синхронизации, попробуем при возврате на экран. */
  async function resumeSession(uid) {
    const live = await liveSession();
    if (live && live.user && live.user.id !== uid) {
      // Сеанс другого аккаунта (его токены уже в списке) — у текущего ему не
      // место: снимаем на телефоне, на сервере он остаётся живым.
      rememberSession(live);
      await dropLocalSession();
    }
    if (!uid) {
      set({ status: 'signedOut', user: null });
      return;
    }
    if (!(live && live.user && live.user.id === uid)) {
      const entry = Accounts.findAccount(get().accounts, uid);
      set({ status: 'signedOut', user: null });
      if (!entry || entry.needsSignIn || !entry.refreshToken) return;
      let res;
      try {
        res = await sb.auth.setSession({ access_token: entry.accessToken, refresh_token: entry.refreshToken });
      } catch (err) {
        res = { data: null, error: err };
      }
      if (get().current !== uid) return;
      const session = res && res.data && res.data.session;
      if (res.error || !session) {
        if (isRefusal(res.error)) {
          editAccounts((acc) => markStale(acc, uid));
          toast('accounts.session_lost_toast', { name: nameOf(uid) });
        }
        return;
      }
      rememberSession(session);
    }
    const result = await auth.afterSignedIn();
    if (get().current !== uid) return;
    if (!result.ok || !result.user || result.user.id !== uid) {
      set({ status: 'signedOut', user: null });
      return;
    }
    applyAuthResult(result);
  }

  /** Перед уходом из текущего: свежие токены — в список, ждущая правка — в
   *  облако, синхронизация — закрыта. */
  async function leaveCurrent() {
    offerMoveFor = null;
    await saveLiveTokens();
    await flushSync();
    setSyncUser(null);
    set({ status: 'signedOut', user: null });
  }

  /** Вход любым способом (почта, регистрация, Google): прежний аккаунт
   *  остаётся в списке, вошедший становится текущим со своей областью.
   *  Гостевые данные в новый аккаунт не вливаются — они остаются «Без
   *  аккаунта». */
  function runSignIn(attempt, { quietCancel = false } = {}) {
    set({ authError: null });
    return withBusy(async () => {
      const prev = get().current;
      const prevSignedIn = get().status === 'signedIn';
      const prevUser = get().user;
      const before = await liveSession();
      if (before) rememberSession(before);
      await flushSync();
      setSyncUser(null);
      const result = await attempt();
      if (!result.ok) {
        if (!(quietCancel && result.cancelled)) set({ authError: result.errorKey });
        const live = await liveSession();
        const beforeUid = before && before.user ? before.user.id : null;
        if (live && live.user && live.user.id !== beforeUid && live.user.id !== prev) {
          // Сервер впустил, а профиль не прочитался (сеть): аккаунт всё равно
          // новый — его область, без синхронизации до возврата на экран.
          rememberSession(live);
          await openScope(live.user.id);
          set({ status: 'signedOut', user: null });
        } else if (prevSignedIn && prev) {
          // Вход не удался — прежний сеанс на месте, синхронизация тоже.
          set({ status: 'signedIn', user: prevUser });
          setSyncUser(prev);
          syncOnSignIn(prev);
        }
        return result;
      }
      const live = await liveSession();
      if (live) rememberSession(live);
      // Вошли из гостя с данными в пустой аккаунт — после согласия спросим,
      // перенести ли их (applyAuthResult). Из открытого аккаунта — не спрашиваем.
      if (result.user.id !== get().current) await openScope(result.user.id, { offerMove: true });
      applyAuthResult(result);
      return result;
    });
  }

  /** События supabase. Свои действия (busy) решают сами — здесь только
   *  токены. Остальное: старт (INITIAL_SESSION), сеанс пропал (SIGNED_OUT),
   *  обновление токена. */
  function onAuthEvent(event, session) {
    const uid = session && session.user ? session.user.id : null;
    const listed = uid ? !!Accounts.findAccount(get().accounts, uid) : false;
    if (uid) rememberSession(session);
    if (busy) return;
    const current = get().current;
    if (uid) {
      if (uid === current) {
        // Уже вошли этим аккаунтом — обновился токен или пароль: токены уже
        // в списке, больше делать нечего.
        if (get().status === 'signedIn' && get().user && get().user.id === uid) return;
        defer(() => withBusy(() => resumeSession(uid)));
        return;
      }
      if (!listed) {
        // Сеанс аккаунта, которого нет в списке: телефон обновился до
        // аккаунтов, а вход уже был. Этот аккаунт и есть текущий — его
        // область (данные без аккаунта остаются гостю, ничего не вливается).
        // В прошлый раз был открыт гость, а сеанс есть: как вход из гостя —
        // с вопросом о переносе (у телефона до аккаунтов это и были его данные).
        defer(() => withBusy(async () => { await openScope(uid, { offerMove: true }); await resumeSession(uid); }));
        return;
      }
      // Сеанс другого аккаунта из списка (приложение закрыли посреди
      // переключения): он снимается на телефоне, поднимается сеанс текущего.
      if (event === 'INITIAL_SESSION') defer(() => withBusy(() => resumeSession(current)));
      return;
    }
    // Сеанса нет.
    if (event === 'SIGNED_OUT' && liveUid) {
      // supabase снял сеанс сам (refresh-токен отозван): запись остаётся,
      // но войти в неё нужно заново.
      const gone = liveUid;
      editAccounts((acc) => markStale(acc, gone));
    }
    liveUid = null;
    if (current && event === 'INITIAL_SESSION') {
      defer(() => withBusy(() => resumeSession(current)));
      return;
    }
    setSyncUser(null);
    set({ status: 'signedOut', user: null });
  }

  return {
    status: 'loading', // loading | signedOut | needsOnboarding | needsConsent | signedIn
    user: null,
    authError: null,
    // Аккаунты устройства: { list, current, known } (lib/accounts.js).
    accounts: { list: [], current: null, known: {} },
    // Чья область данных открыта: uid или null (гость).
    current: null,
    // Открывается другая область — RootNavigator показывает «Переключаю…».
    switching: false,
    // Идёт переключение аккаунта — с первого касания, ещё до «Переключаю…»
    // (пока уходят правки прежнего, flushSync — это сеть): строки аккаунтов
    // в «Аккаунте» в это время не нажимаются, второй switchAccount — отказ.
    switchPending: false,
    // У гостя есть данные — в списке аккаунтов есть строка «Без аккаунта».
    guestHasData: false,
    // uid аккаунтов, чьи данные лежат на телефоне (не пустые).
    deviceScopes: [],

    init() {
      if (initStarted) return;
      initStarted = true;
      (async () => {
        const acc = await loadAccounts();
        set({ accounts: acc, current: acc.current });
        await openDataScope(acc.current);
        refreshDevice();
        sb.auth.onAuthStateChange((event, session) => { onAuthEvent(event, session); });
        // Сеанс текущего не поднялся из-за сети — пробуем, когда приложение
        // вернули на экран.
        AppState.addEventListener('change', (state) => {
          if (state !== 'active' || busy) return;
          const { current, status } = get();
          const entry = current ? Accounts.findAccount(get().accounts, current) : null;
          if (entry && !entry.needsSignIn && status === 'signedOut') withBusy(() => resumeSession(current));
        });
      })();
    },

    signIn(email, password) {
      return runSignIn(() => auth.signInWithPassword(email, password));
    },

    signUp(email, password) {
      return runSignIn(() => auth.signUp(email, password));
    },

    // cancelled — пользователь сам закрыл вкладку браузера, не показываем
    // это как ошибку.
    signInWithGoogle() {
      return runSignIn(() => auth.signInWithGoogle(), { quietCancel: true });
    },

    async completeOnboarding(name, useCase, opts) {
      const result = await auth.saveOnboarding(name, useCase, opts);
      if (result.ok) applyAuthResult(result);
      return result;
    },

    /** Переключиться на аккаунт uid или на гостя (null). На тот же — ничего.
     *  plan.signOut ядра здесь — не запрос к серверу: сеанс прежнего снимается
     *  только на телефоне (resumeSession → dropLocalSession), его токены — в списке. */
    switchAccount(uid) {
      // Уже переключаемся: второе касание (той же строки или другой) — не
      // второй круг. planSwitch ещё видит прежний current, и два
      // openDataScope подряд открыли бы запись посреди чужого чтения, а два
      // resumeSession наперегонки — чужой сеанс.
      if (get().switchPending || get().switching) return Promise.resolve({ ok: false, busy: true });
      const plan = Accounts.planSwitch(get().accounts, uid || null);
      if (plan.sameAccount) return Promise.resolve({ ok: true, same: true });
      set({ switchPending: true });
      return withBusy(async () => {
        try {
          await leaveCurrent();
          const read = await openScope(plan.load);
          if (read) {
            if (plan.load) toast('accounts.switched_toast', { name: nameOf(plan.load) });
            else toast('accounts.guest_toast');
          }
          await resumeSession(plan.load);
          return { ok: true };
        } finally {
          set({ switchPending: false });
        }
      });
    },

    /** Область не прочиталась (useAppStore: scopeError) — «Повторить»:
     *  прочитать её снова; прочиталась — синхронизация, если вход живой. */
    reopenScope() {
      if (!useAppStore.getState().scopeError || get().switchPending || get().switching) return Promise.resolve(false);
      return withBusy(async () => {
        const uid = get().current;
        if (!(await openScope(uid))) return false;
        const { status, user } = get();
        if (uid && status === 'signedIn' && user && user.id === uid) {
          setSyncUser(uid);
          syncOnSignIn(uid);
        }
        return true;
      });
    },

    /** «Выйти»: аккаунт уходит из списка и его сеанс снимается, данные на
     *  телефоне остаются (стереть — forgetDeviceData). Открывается
     *  следующий аккаунт с живым сеансом или гость. */
    signOut() {
      return withBusy(async () => {
        const uid = get().current;
        await flushSync();
        setSyncUser(null);
        // Сеанс снимается, только если он этого аккаунта: у аккаунта «войти
        // заново» живым может быть сеанс прежнего — его не трогаем.
        const live = await liveSession();
        if (live && live.user && live.user.id === uid) {
          try { await auth.signOut(); } catch (err) { console.error('Не удалось выйти:', err); }
          liveUid = null;
        }
        set({ status: 'signedOut', user: null });
        if (!uid) return;
        editAccounts((acc) => removeEntry(acc, uid));
        const next = Accounts.nextAccount(get().accounts, uid);
        await openScope(next);
        await resumeSession(next);
      });
    },

    /** Удалить аккаунт на сервере. Удалён — уходит из списка, открывается
     *  следующий или гость. Копия на телефоне остаётся, как обещают окно
     *  подтверждения (account.delete_confirm — правовая строка, одна на
     *  телефон и десктоп) и страница delete-account: стереть её —
     *  «Данные» → «Удалить данные аккаунта с устройства», подпись помнится. */
    deleteAccount() {
      return withBusy(async () => {
        const uid = get().current;
        const result = await auth.deleteAccount();
        if (!result.ok) return result;
        liveUid = null;
        setSyncUser(null);
        set({ status: 'signedOut', user: null });
        if (!uid) return result;
        editAccounts((acc) => removeEntry(acc, uid));
        const next = Accounts.nextAccount(get().accounts, uid);
        await openScope(next);
        await resumeSession(next);
        return result;
      });
    },

    /** Стереть данные аккаунта uid с телефона; аккаунт уходит из списка (как
     *  на вебе: «Аккаунт уйдёт из списка»). Его сеанс отзывается на сервере
     *  (17 октября 2026, как у веба): токены стираются вместе с копией, и
     *  держать живой сеанс на сервере незачем. Отзывает отдельный клиент
     *  (auth.revokeAccountSession) и без ожидания: сеть копии не держит.
     *  Открытый аккаунт сначала снимается на телефоне (как «Выйти»), потом
     *  открывается следующий аккаунт или гость. Облако данных не трогается. */
    forgetDeviceData(uid) {
      if (!Accounts.isValidUid(uid)) return Promise.resolve({ ok: false });
      return withBusy(async () => {
        if (uid === get().current) {
          // Свежие токены — в список (leaveCurrent), из списка — отзыву.
          await leaveCurrent();
          const entry = Accounts.findAccount(get().accounts, uid);
          // Сеанс снимается на телефоне до того, как откроется следующий:
          // иначе resumeSession запомнил бы его в списке заново. Только свой —
          // живым может быть сеанс прежнего аккаунта («войти заново»).
          const live = await liveSession();
          if (live && live.user && live.user.id === uid) await dropLocalSession();
          auth.revokeAccountSession(entry);
          editAccounts((acc) => forgetLabel(removeEntry(acc, uid), uid));
          const next = Accounts.nextAccount(get().accounts, uid);
          await openScope(next);
          await resumeSession(next);
        } else {
          auth.revokeAccountSession(Accounts.findAccount(get().accounts, uid));
        }
        // Картинки редактора живут в странице WebView — их сотрёт ближайший
        // открытый редактор (assets-forget, протокол 5); очередь — до записи
        // о стирании, чтобы оборвавшееся на полпути стирание не потеряло их.
        await queueAssetForget(uid);
        await removeScope(uid);
        editAccounts((acc) => forgetLabel(removeEntry(acc, uid), uid));
        await refreshDevice();
        return { ok: true };
      });
    },

    /** «Перенести данные без аккаунта в текущий аккаунт» — строка в «Данных». */
    async moveGuestData() {
      return { ok: await moveGuest() };
    },

    async updateName(name) {
      const result = await auth.updateProfileName(name);
      if (result.ok) {
        set({ user: result.user });
        editAccounts((acc) => upsertEntry(acc, { uid: result.user.id, name: result.user.name || '' }));
      }
      return result;
    },

    async changePassword(newPassword) {
      return auth.changePassword(newPassword);
    },

    clearAuthError() {
      set({ authError: null });
    },
  };
});

/** Запись текущего аккаунта (или null — гость). */
export const currentAccount = (s) => (s.current ? s.accounts.list.find((e) => e.uid === s.current) || null : null);

/** Аккаунты, чьи данные лежат на телефоне, — для «Удалить данные аккаунта с
 *  устройства». Открытый аккаунт — по тому, что уже в сторе: его область могла
 *  наполниться (приём из облака) позже, чем список пересчитывался. */
export function useDeviceScopes() {
  const scopes = useAuthStore((s) => s.deviceScopes);
  const current = useAuthStore((s) => s.current);
  const hasData = useAppStore((s) => CoreSync.hasData(s));
  return useMemo(
    () => (current && hasData && !scopes.includes(current) ? [...scopes, current] : scopes),
    [scopes, current, hasData],
  );
}

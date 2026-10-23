// Раздел настроек — экран стека из «Меню» (17 октября 2026). Разделы и их
// порядок — те же, что на вебе: Основное, Работа, Аккаунт, Данные, О
// приложении, Обратная связь (у последней свой экран — FeedbackScreen).
// Раздел приходит параметром маршрута: { section: 'main' | 'work' |
// 'account' | 'data' | 'about' }; «назад» — на «Меню».
//
// В «Данных» у области аккаунта — выключатель «Статистика экранов»
// (settings.usageStats, lib/screenStats.js).
//
// Строки — общие SettingRow в RowGroup (остров panel на земле, подпись
// группы — Block), объяснение — подсказкой под островом. Режим — сегментами:
// это экран, а не лист. Что показывать при режиме — только Core.modeFlags
// (useModeFlags): «личное» убирает ставку, валюту и счётчик заработка.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import Switch from '../components/Switch';
import Segmented from '../components/Segmented';
import { RowGroup, SettingRow } from '../components/Island';
import { Block, Hint } from '../components/RepeatControls';
import PickerSheet from '../components/PickerSheet';
import RateSheet from '../components/RateSheet';
import WorkHoursSheet from '../components/WorkHoursSheet';
import ProfileSheet from '../components/ProfileSheet';
import ChangePasswordSheet from '../components/ChangePasswordSheet';
import AuthSheet from '../components/AuthSheet';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import DeviceDataSheet from '../components/DeviceDataSheet';
import ConflictSheet from '../components/ConflictSheet';
import TrashSheet from '../components/TrashSheet';
import ChoiceList from '../components/ChoiceList';
import ActionSheetContent from '../components/ActionSheetContent';
import Ai from '../core/ai.js';
import Accounts from '../core/accounts.js';
import { useAuthStore, currentAccount, useDeviceScopes } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { useConflicts, useTrash } from '../hooks/useConflicts';
import { trashRows } from '../lib/trash';
import { openSheet } from '../store/useSheetStore';
import { CURRENCIES } from '../lib/migrate';
import { CURRENCY_SYMBOLS, fmtMoney } from '../lib/format';
import { setSyncEnabled } from '../lib/sync';
import { permissionStatus, ensurePermission } from '../lib/notifications';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { useModeFlags } from '../hooks/useModeFlags';
import { useThemeMode, useColors, spacing, screenPadding, gap } from '../theme';
import { t, LANG_NAMES } from '../lib/i18n';
import { LANDING_URL, openLegal } from '../lib/legalLinks';
import { accountColor } from '../lib/accounts';

/** Разделы «Меню» — порядок и названия как на вебе. */
export const SETTINGS_SECTIONS = [
  { key: 'main', icon: 'tuning', title: 'settings.section_main' },
  { key: 'work', icon: 'stopwatch', title: 'settings.section_work' },
  { key: 'account', icon: 'account', title: 'settings.section_account' },
  { key: 'data', icon: 'folder', title: 'settings.section_data' },
  { key: 'about', icon: 'info', title: 'settings.section_about' },
  { key: 'feedback', icon: 'comment', title: 'settings.section_feedback' },
];

/** Строки разделов в «Меню». «Аккаунта» среди них нет (круг 21): его
 *  повторяла плашка профиля над ними — она и ведёт в раздел. Гостю без
 *  аккаунтов вход и регистрация — кнопками на той же плашке. */
export const MENU_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.key !== 'account');

/** Ключ названия раздела. */
export const sectionTitle = (key) => (SETTINGS_SECTIONS.find((s) => s.key === key) || SETTINGS_SECTIONS[0]).title;

/** Сводка раздела словами — значение строки в «Меню». */
export function sectionSummary(key, { lang, settings, flags, appVersion }) {
  switch (key) {
    case 'main': return [LANG_NAMES[lang], t(lang, `mode.${flags.mode}`)].filter(Boolean).join(' · ');
    case 'work': return flags.money ? `${fmtMoney(settings.hourlyRate || 0, lang, settings.currency)}${t(lang, 'rate.per_hour')}` : '';
    case 'about': return appVersion || '';
    default: return '';
  }
}

const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** «Пн–Пт 09:00–18:00»: подряд идущие дни — промежутком. */
export function workHoursText(wh, lang) {
  const days = [...(wh.days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const name = (d) => t(lang, `weekday.${WEEKDAY[d]}`);
  const run = days.length > 2 && days.every((d, i) => i === 0 || ((days[i - 1] + 1) % 7) === d);
  const dayText = run ? `${name(days[0])}–${name(days[days.length - 1])}` : days.map(name).join(', ');
  return [dayText, `${wh.start}–${wh.end}`].filter(Boolean).join(' ');
}

export default function SettingsSectionScreen({ route, navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  const section = (route && route.params && route.params.section) || 'main';
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const deviceScopes = useDeviceScopes();
  // Открыт аккаунт, а у гостя есть данные — их можно перенести сюда.
  const canMoveGuest = useAuthStore((s) => !!s.current && s.guestHasData);
  // Открыта область аккаунта (с сеансом или без) — её настройки.
  const accountOpen = useAuthStore((s) => !!s.current);
  const moveGuestData = useAuthStore((s) => s.moveGuestData);
  const showToast = useAppStore((s) => s.showToast);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const setNotifyEnabled = useAppStore((s) => s.setNotifyEnabled);
  const conflicts = useConflicts();
  const trash = useTrash();
  const linked = useAppStore((s) => !!s.oplog);
  const resolvedMode = useThemeMode();
  const flags = useModeFlags();
  const lang = settings.lang;
  const signedIn = authStatus === 'signedIn' && !!user;

  const toggle = (value, onValueChange, label, testID) => (
    <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} testID={testID} />
  );

  let body = null;
  if (section === 'main') body = <MainSection lang={lang} settings={settings} setSettings={setSettings} setNotifyEnabled={setNotifyEnabled} flags={flags} dark={resolvedMode === 'dark'} toggle={toggle} />;
  else if (section === 'work') body = <WorkSection lang={lang} settings={settings} setSettings={setSettings} flags={flags} toggle={toggle} />;
  else if (section === 'account') body = <AccountSection lang={lang} settings={settings} toggle={toggle} colors={colors} />;
  else if (section === 'data') {
    body = (
      <>
        <RowGroup tone="panel">
          <SettingRow icon="download" label={t(lang, 'menu.export_excel')} value={t(lang, 'export.all_projects')} onPress={() => openSheet(<ExportPeriodSheet lang={lang} />)} testID="settings-export" />
        </RowGroup>
        {/* Статистика экранов (23 октября 2026): какие экраны открывают, без
            содержимого (lib/screenStats.js). Только у области аккаунта (и
            открытой без сеанса — настройка её) — гость и так ничего не шлёт;
            нет значения — включено. Место и значок — как у веба: под
            экспортом, над конфликтами и корзиной. */}
        {signedIn || accountOpen ? (
          <RowGroup tone="panel" note={t(lang, 'settings.usage_hint')} testID="settings-usage-group">
            <SettingRow
              icon="chart"
              label={t(lang, 'settings.usage_title')}
              right={toggle(settings.usageStats !== false, (v) => setSettings({ usageStats: v }), t(lang, 'settings.usage_title'), 'settings-usage')}
            />
          </RowGroup>
        ) : null}
        {/* Журнал правок (17 октября 2026): «Конфликты · N ›» и «Корзина · N ›»
            — как в «Данных» веба, и, как там, только у области, связанной с
            журналом (у гостя ни конфликтов, ни корзины не бывает). */}
        {linked ? (
          <RowGroup tone="panel" label={t(lang, 'sync.group')} testID="settings-sync-data">
            <SettingRow icon="copy" label={t(lang, 'sync.conflicts')} value={String(conflicts.length)} onPress={() => openSheet(<ConflictSheet />)} testID="settings-conflicts" valueTestID="settings-conflicts-count" />
            <SettingRow icon="trash" label={t(lang, 'sync.trash')} value={String(trashRows(trash).length)} onPress={() => openSheet(<TrashSheet />)} testID="settings-trash" valueTestID="settings-trash-count" />
          </RowGroup>
        ) : null}
        {canMoveGuest ? (
          <RowGroup tone="panel">
            <SettingRow
              icon="arrow-right"
              label={t(lang, 'accounts.move_row')}
              chevron={false}
              testID="settings-move-guest"
              onPress={() => openSheet(
                <ActionSheetContent
                  title={t(lang, 'accounts.move_title')}
                  message={t(lang, 'accounts.move_text')}
                  actions={[
                    { label: t(lang, 'accounts.move_ok'), onPress: async () => { if ((await moveGuestData()).ok) showToast(t(lang, 'accounts.moved_toast')); } },
                    { label: t(lang, 'common.cancel'), cancel: true },
                  ]}
                />,
              )}
            />
          </RowGroup>
        ) : null}
        {/* Копии аккаунтов на телефоне — стереть, не трогая облако (и тех,
            из которых уже вышли: «Выйти» данные не стирает). */}
        {deviceScopes.length ? (
          <RowGroup tone="panel">
            <SettingRow icon="trash" danger label={t(lang, 'accounts.forget')} onPress={() => openSheet(<DeviceDataSheet />)} chevron={false} testID="settings-forget-device" />
          </RowGroup>
        ) : null}
        {signedIn ? (
          <RowGroup tone="panel">
            <SettingRow icon="trash" danger label={t(lang, 'account.delete')} onPress={() => openSheet(<ProfileSheet page="delete" />)} chevron={false} testID="settings-delete-account" />
          </RowGroup>
        ) : null}
      </>
    );
  } else if (section === 'about') body = <AboutSection lang={lang} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} testID={`settings-${section}`}>
      {body}
    </ScrollView>
  );
}

const ADD = '__add';
const GUEST = '__guest';

/** Аккаунт (17 октября 2026 — несколько аккаунтов): список аккаунтов
 *  телефона строками с галочкой у текущего (ChoiceList — тот же, что в
 *  листах; на земле экрана — подложкой острова), «Без аккаунта», если у гостя
 *  есть данные, и строка-действие «Добавить аккаунт». Под ним — «Имя ›»
 *  (лист имени), пароль и синхронизация текущего, «Выйти»; удаление — в
 *  «Данных». В «Меню» строки раздела нет: туда ведёт плашка профиля (круг
 *  21). Аккаунтов нет и открыт гость —
 *  как раньше: «Войти» и «Создать аккаунт». */
function AccountSection({ lang, settings, toggle, colors }) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const accounts = useAuthStore((s) => s.accounts);
  const current = useAuthStore((s) => s.current);
  const entry = useAuthStore(currentAccount);
  const guestHasData = useAuthStore((s) => s.guestHasData);
  const switchAccount = useAuthStore((s) => s.switchAccount);
  // Идёт переключение (ещё уходят правки прежнего) — строки не нажимаются:
  // второе касание запустило бы второй круг (useAuthStore: switchPending).
  const switchPending = useAuthStore((s) => s.switchPending || s.switching);
  const signOut = useAuthStore((s) => s.signOut);
  const signedIn = status === 'signedIn' && !!user;
  const currentUid = signedIn ? user.id : current;
  const tr = (key) => t(lang, key);

  // Вошедший, которого ещё нет в списке (сеанс старше списка), — тоже строка.
  const list = signedIn && !accounts.list.some((e) => e.uid === user.id)
    ? [{ uid: user.id, email: user.email || '', name: user.name || '' }, ...accounts.list]
    : accounts.list;

  if (!list.length && !currentUid) {
    return (
      <RowGroup tone="panel" note={t(lang, 'profile.guest_sub')} testID="settings-account-guest">
        <SettingRow icon="account" label={t(lang, 'auth.sign_in')} onPress={() => openSheet(<AuthSheet initialTab="signin" />)} testID="settings-sign-in" />
        <SettingRow icon="plus" label={t(lang, 'auth.create_account')} onPress={() => openSheet(<AuthSheet initialTab="signup" />)} testID="settings-sign-up" />
      </RowGroup>
    );
  }

  const selected = currentUid || GUEST;
  const options = [
    ...list.map((e) => ({
      value: e.uid,
      label: Accounts.accountLabel(e, tr),
      note: e.needsSignIn ? t(lang, 'accounts.needs_sign_in') : (e.name ? e.email : ''),
      color: accountColor(e.uid),
      testID: `account-row-${e.uid}`,
    })),
    ...(guestHasData || !currentUid ? [{ value: GUEST, label: t(lang, 'accounts.guest'), testID: 'account-row-guest' }] : []),
    { value: ADD, label: t(lang, 'accounts.add'), icon: 'plus', iconColor: colors.accentInk, testID: 'account-add' },
  ].map((o) => (switchPending && o.value !== selected ? { ...o, disabled: true } : o));

  return (
    <>
      <Block label={t(lang, 'accounts.group')}>
        <ChoiceList testID="settings-accounts" options={options} value={selected}
          onSelect={(value) => (value === ADD ? openSheet(<AuthSheet initialTab="signin" mode="add" />) : switchAccount(value === GUEST ? null : value))} style={{ backgroundColor: colors.panel }} />
        <Hint>{t(lang, 'accounts.hint')}</Hint>
      </Block>
      {signedIn ? (
        <>
          <RowGroup tone="panel" testID="settings-account-profile">
            {/* «Имя ›» — лист с одним полем, как на вебе (круг 21). Почта —
                в строке аккаунта списком выше. */}
            <SettingRow icon="account" label={t(lang, 'profile.name_label')} value={user.name || t(lang, 'profile.no_name')} onPress={() => openSheet(<ProfileSheet />)} testID="settings-name" valueTestID="settings-name-value" />
            <SettingRow icon="lock" label={t(lang, 'profile.change_password')} onPress={() => openSheet(<ChangePasswordSheet />)} testID="settings-password" />
            <SettingRow icon="cloud" label={t(lang, 'sync.toggle_label')} right={toggle(settings.syncEnabled !== false, setSyncEnabled, t(lang, 'sync.toggle_label'), 'settings-sync')} />
          </RowGroup>
          <RowGroup tone="panel" note={t(lang, 'accounts.sign_out_hint')}>
            <SettingRow icon="logout" danger label={t(lang, 'auth.sign_out')} onPress={signOut} chevron={false} testID="settings-sign-out" />
          </RowGroup>
        </>
      ) : entry ? (
        // Аккаунт открыт, а сеанса нет: данные на месте, синхронизации нет.
        <RowGroup tone="panel" note={t(lang, 'accounts.offline_hint')} testID="settings-account-offline">
          <SettingRow icon="account" label={t(lang, 'accounts.sign_in_again')} value={entry.email} onPress={() => openSheet(<AuthSheet initialTab="signin" email={entry.email} />)} testID="settings-sign-in-again" />
          <SettingRow icon="logout" danger label={t(lang, 'auth.sign_out')} onPress={signOut} chevron={false} testID="settings-sign-out" />
        </RowGroup>
      ) : null}
    </>
  );
}

/** Основное: язык, тема, режим; напоминания. */
function MainSection({ lang, settings, setSettings, setNotifyEnabled, flags, dark, toggle }) {
  const [notifPerm, setNotifPerm] = useState('ask');
  // Разрешение могли поменять в системных настройках, пока приложение было
  // в фоне, — перечитываем его при заходе на экран.
  useEffect(() => { permissionStatus().then(setNotifPerm); }, []);

  async function onToggleNotify(value) {
    if (value) {
      await ensurePermission();
      setNotifPerm(await permissionStatus());
    }
    setNotifyEnabled(value);
  }
  async function onOpenSystemNotifications() {
    if (notifPerm === 'ask') { await ensurePermission(); setNotifPerm(await permissionStatus()); return; }
    Linking.openSettings();
  }
  function onOpenLanguage() {
    openSheet(
      <PickerSheet
        title={t(lang, 'nav.language')}
        options={Object.keys(LANG_NAMES).map((code) => ({ value: code, label: LANG_NAMES[code] }))}
        value={lang}
        onSelect={(code) => setSettings({ lang: code })}
      />,
    );
  }
  return (
    <>
      <RowGroup tone="panel" testID="settings-main-app">
        <SettingRow icon="globe" label={t(lang, 'nav.language')} value={LANG_NAMES[lang]} onPress={onOpenLanguage} testID="settings-language" />
        <SettingRow icon="moon" label={t(lang, 'menu.theme_dark')} right={toggle(dark, (v) => setSettings({ theme: v ? 'dark' : 'light' }), t(lang, 'menu.theme_dark'))} />
      </RowGroup>

      <Block label={t(lang, 'mode.label')}>
        <Segmented
          items={['freelance', 'personal'].map((key) => ({ key, label: t(lang, `mode.${key}`) }))}
          value={flags.mode}
          onChange={(mode) => setSettings({ mode })}
          testID="settings-mode"
        />
        <Hint testID="settings-mode-hint">{t(lang, flags.mode === 'personal' ? 'mode.hint_personal' : 'mode.hint_freelance')}</Hint>
      </Block>

      <RowGroup tone="panel" label={t(lang, 'remind.label')}>
        <SettingRow icon="bell-bing" label={t(lang, 'menu.remind')} right={toggle(settings.notifyEnabled !== false, onToggleNotify, t(lang, 'menu.remind'))} />
        <SettingRow icon="settings" label={t(lang, 'notif.system')} value={t(lang, `notif.perm_${notifPerm === 'granted' ? 'granted' : notifPerm === 'denied' ? 'denied' : 'ask'}`)} onPress={onOpenSystemNotifications} />
      </RowGroup>
    </>
  );
}

/** Работа: ставка и валюта (только с деньгами), таймер, счётчик заработка,
 *  рабочие часы (пока только показ — правка «скоро»). */
function WorkSection({ lang, settings, setSettings, flags, toggle }) {
  // Рабочие часы — только для агента (свободные окна), задачам они ничего не
  // запрещают; свои — settings.workHours, нет своих — умолчание ядра.
  const workHours = Ai.aiWorkHours(settings);
  function onOpenHours() {
    openSheet(<WorkHoursSheet lang={lang} value={workHours} onSave={(wh) => setSettings({ workHours: wh })} />);
  }
  function onOpenRate() {
    openSheet(<RateSheet lang={lang} initialValue={settings.hourlyRate} onSave={(n) => setSettings({ hourlyRate: n })} />);
  }
  function onOpenCurrency() {
    openSheet(
      <PickerSheet
        title={t(lang, 'settings.currency_label')}
        options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: `${code} (${CURRENCY_SYMBOLS[code] || code})` }))}
        value={settings.currency}
        onSelect={(code) => setSettings({ currency: code })}
      />,
    );
  }
  return (
    <>
      {flags.money ? (
        <RowGroup tone="panel" testID="settings-work-money">
          <SettingRow icon="wallet" label={t(lang, 'settings.rate_label')} value={fmtMoney(settings.hourlyRate || 0, lang, settings.currency) + t(lang, 'rate.per_hour')} onPress={onOpenRate} testID="settings-rate" />
          <SettingRow icon="currency" label={t(lang, 'settings.currency_label')} value={settings.currency} onPress={onOpenCurrency} testID="settings-currency" />
        </RowGroup>
      ) : null}
      <RowGroup tone="panel" note={t(lang, 'settings.timer_hint')}>
        <SettingRow icon="play" label={t(lang, 'settings.timer')} right={toggle(flags.timer, (v) => setSettings({ showTimer: v }), t(lang, 'settings.timer'), 'settings-timer')} />
      </RowGroup>
      {flags.money ? (
        <RowGroup tone="panel" note={t(lang, 'settings.earnings_hint')}>
          <SettingRow icon="chart-bars" label={t(lang, 'settings.earnings')} right={toggle(flags.earnings, (v) => setSettings({ showEarnings: v }), t(lang, 'settings.earnings'), 'settings-earnings')} />
        </RowGroup>
      ) : null}
      <RowGroup tone="panel" note={t(lang, 'settings.work_hours_hint')}>
        <SettingRow icon="clock" label={t(lang, 'settings.work_hours')} value={workHoursText(workHours, lang)} onPress={onOpenHours} testID="settings-work-hours" valueTestID="settings-work-hours-value" />
      </RowGroup>
    </>
  );
}

/** О приложении: версия и обновление, ссылки на документы и блог. */
function AboutSection({ lang }) {
  const appVersion = (Constants.expoConfig && Constants.expoConfig.version) || '1.0.0';
  const { update, updating, progress, install } = useAppUpdate(lang);
  return (
    <>
      <RowGroup tone="panel">
        <SettingRow icon="info" label={t(lang, 'settings.version')} value={appVersion} testID="settings-version" />
        {update ? (
          <SettingRow
            icon="download"
            label={updating
              ? t(lang, 'settings.update_downloading', { percent: Math.round(progress * 100) })
              : t(lang, 'settings.update_available', { version: update.version })}
            onPress={updating ? undefined : install}
            testID="settings-update"
          />
        ) : null}
      </RowGroup>
      <RowGroup tone="panel">
        <SettingRow icon="info" label={t(lang, 'about.us')} onPress={() => Linking.openURL(LANDING_URL)} />
        <SettingRow icon="blog" label={t(lang, 'about.blog')} onPress={() => Linking.openURL(`${LANDING_URL}/blog.html`)} />
        <SettingRow icon="doc" label={t(lang, 'about.privacy')} onPress={() => openLegal('privacy', lang)} />
        <SettingRow icon="doc" label={t(lang, 'about.terms')} onPress={() => openLegal('terms', lang)} />
        <SettingRow icon="doc" label={t(lang, 'about.legal')} onPress={() => openLegal('legal', lang)} />
      </RowGroup>
    </>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: screenPadding, paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xl, gap },
});

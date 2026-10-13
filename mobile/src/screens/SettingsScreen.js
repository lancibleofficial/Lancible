// «Меню» (макет B2): профиль-остров, затем острова Документы · Дедлайны и
// напоминания · Теги, «Работа» (ставка, валюта, Excel), «Приложение»
// (язык, тема, напоминания, о приложении и юридические страницы).
import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Linking } from 'react-native';
import Tap from '../components/Tap';
import Constants from 'expo-constants';
import Text from '../components/AppText';
import PrimaryButton from '../components/PrimaryButton';
import Switch from '../components/Switch';
import Island, { SettingRow } from '../components/Island';
import TabHeader, { NotificationsButton } from '../components/TabHeader';
import PickerSheet from '../components/PickerSheet';
import RateSheet from '../components/RateSheet';
import ProfileSheet from '../components/ProfileSheet';
import AuthSheet from '../components/AuthSheet';
import ExportPeriodSheet from '../components/ExportPeriodSheet';
import Icon from '../components/Icon';
import OnboardingScreen from './auth/OnboardingScreen';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { CURRENCIES } from '../lib/migrate';
import { isGlobalTag } from '../lib/tags';
import { CURRENCY_SYMBOLS, fmtMoney } from '../lib/format';
import { notificationFeed } from '../lib/due';
import { openSheet } from '../store/useSheetStore';
import { confirmSheet } from '../lib/dialogs';
import { setSyncEnabled } from '../lib/sync';
import { permissionStatus, ensurePermission } from '../lib/notifications';
import { checkForUpdate, downloadAndInstall } from '../lib/updateCheck';
import { useColors, useThemeMode, spacing, screenPadding, radius, fontSize, gap } from '../theme';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { t, LANG_NAMES } from '../lib/i18n';
import { LANDING_URL, openLegal } from '../lib/legalLinks';

export default function SettingsScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const styles = makeStyles(colors, clearance);
  const [notifPerm, setNotifPerm] = useState('ask');
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const settings = useAppStore((s) => s.settings);
  const documentsCount = useAppStore((s) => (s.documents || []).length);
  const setNotifyEnabled = useAppStore((s) => s.setNotifyEnabled);
  const setSettings = useAppStore((s) => s.setSettings);
  const setTheme = (nextIsDark) => setSettings({ theme: nextIsDark ? 'dark' : 'light' });
  const tags = useAppStore((s) => s.tags);
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const resolvedMode = useThemeMode();
  const lang = settings.lang;
  const appVersion = (Constants.expoConfig && Constants.expoConfig.version) || '1.0.0';
  const [update, setUpdate] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const unread = notificationFeed(tasks, seenAt).filter((n) => n.unread).length;

  // Android: качаем APK прямо здесь и отдаём системному установщику. iOS
  // такого не позволяет — там остаётся переход по ссылке.
  //
  // Не вышло — говорим, что именно, и даём выбрать. Раньше экран молча
  // открывал страницу релиза, и поломка самого обновления с 1.1.1 по 1.2.0
  // выглядела как «так задумано».
  async function onUpdatePress() {
    if (!update) return;
    if (!update.canInstall) { Linking.openURL(update.url); return; }
    setUpdating(true);
    setUpdateProgress(0);
    const res = await downloadAndInstall(update, setUpdateProgress);
    setUpdating(false);
    if (res.ok) return;
    const why = {
      download: t(lang, 'settings.update_error_download'),
      size: t(lang, 'settings.update_error_size'),
      install: t(lang, 'settings.update_error_install'),
    };
    confirmSheet({
      title: t(lang, 'settings.update_failed'),
      message: why[res.reason] || why.download,
      actions: [
        { label: t(lang, 'settings.update_retry'), onPress: onUpdatePress },
        { label: t(lang, 'settings.update_in_browser'), onPress: () => Linking.openURL(update.url) },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  }

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then((result) => { if (!cancelled && result.available) setUpdate(result); });
    return () => { cancelled = true; };
  }, []);

  // Разрешение могли поменять в системных настройках, пока приложение было
  // в фоне, — перечитываем его при заходе на экран.
  useEffect(() => { permissionStatus().then(setNotifPerm); }, []);

  if (authStatus === 'needsOnboarding') return <OnboardingScreen />;
  if (authStatus === 'needsConsent') return <OnboardingScreen consentOnly />;

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
  function onOpenRate() {
    openSheet(<RateSheet lang={lang} initialValue={settings.hourlyRate} onSave={(n) => setSettings({ hourlyRate: n })} />);
  }
  function onExcel() {
    // Лист экспорта сам собирает файл по периоду и проектам.
    openSheet(<ExportPeriodSheet lang={lang} />);
  }

  const chevron = <Icon name="chevron-right" size={13} color={colors.textFaint} />;
  // Строка — общая SettingRow (components/Island.js): та же, что в сведениях
  // задачи и настройках проекта.
  const toggle = (value, onValueChange, label) => (
    <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
  );

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.menu')}>
        <NotificationsButton navigation={navigation} />
      </TabHeader>
      <ScrollView testID="menu-scroll" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {update ? (
          <Tap style={styles.updateBanner} onPress={onUpdatePress} disabled={updating}>
            <Icon name="download" size={18} color={colors.accentText} />
            <Text style={styles.updateText} numberOfLines={1}>
              {updating
                ? t(lang, 'settings.update_downloading', { percent: Math.round(updateProgress * 100) })
                : t(lang, 'settings.update_available', { version: update.version })}
            </Text>
            {updating ? null : <Text style={styles.updateAction}>{t(lang, update.canInstall ? 'settings.update_install' : 'settings.update_download')}</Text>}
          </Tap>
        ) : null}

        {authStatus === 'signedIn' ? (
          <Island onPress={() => openSheet(<ProfileSheet />)} style={styles.profile}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{(user.name || user.email || '?')[0].toUpperCase()}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileName} numberOfLines={1}>{user.name || user.email}</Text>
              <Text style={styles.profileSub} numberOfLines={1}>
                {[user.name ? user.email : null, t(lang, settings.syncEnabled !== false ? 'menu.sync_on' : 'menu.sync_off')].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {chevron}
          </Island>
        ) : (
          <Island style={{ gap: spacing.md }}>
            <View style={styles.profile}>
              <View style={[styles.avatar, { backgroundColor: colors.panel2 }]}><Text style={[styles.avatarText, { color: colors.textDim }]}>?</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{t(lang, 'profile.guest')}</Text>
                <Text style={styles.profileSub}>{t(lang, 'profile.guest_sub')}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 0.8 }}><PrimaryButton size="sm" shrinkText title={t(lang, 'auth.sign_in')} variant="ghost" onPress={() => openSheet(<AuthSheet initialTab="signin" />)} /></View>
              <View style={{ flex: 1.2 }}><PrimaryButton size="sm" shrinkText title={t(lang, 'auth.create_account')} onPress={() => openSheet(<AuthSheet initialTab="signup" />)} /></View>
            </View>
          </Island>
        )}

        <Island padded={false}>
          <SettingRow first icon="docs" label={t(lang, 'nav.docs')} value={documentsCount ? String(documentsCount) : ''} onPress={() => navigation.navigate('Documents')} />
          <SettingRow icon="bell" label={t(lang, 'menu.deadlines_row')} onPress={() => navigation.navigate('Notifications')}
            right={<View style={styles.rowRight}>{unread ? <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View> : null}{chevron}</View>} />
          <SettingRow icon="tag" label={t(lang, 'settings.section_tags')} value={String(tags.filter(isGlobalTag).length)} onPress={() => navigation.navigate('Tags')} />
        </Island>

        <Island padded={false}>
          <Text style={styles.sectionLabel}>{t(lang, 'settings.section_work')}</Text>
          <SettingRow first icon="wallet" label={t(lang, 'settings.rate_label')} value={fmtMoney(settings.hourlyRate || 0, lang, settings.currency) + t(lang, 'rate.per_hour')} onPress={onOpenRate} />
          <SettingRow icon="currency" label={t(lang, 'settings.currency_label')} value={settings.currency} onPress={onOpenCurrency} />
          <SettingRow icon="download" label={t(lang, 'menu.export_excel')} value={t(lang, 'export.all_projects')} onPress={onExcel} />
        </Island>

        <Island padded={false}>
          <Text style={styles.sectionLabel}>{t(lang, 'menu.section_app')}</Text>
          <SettingRow first icon="globe" label={t(lang, 'nav.language')} value={LANG_NAMES[lang]} onPress={onOpenLanguage} />
          <SettingRow icon="moon" label={t(lang, 'menu.theme_dark')} right={toggle(resolvedMode === 'dark', setTheme, t(lang, 'menu.theme_dark'))} />
          <SettingRow icon="bell-bing" label={t(lang, 'menu.remind')} right={toggle(settings.notifyEnabled !== false, onToggleNotify, t(lang, 'menu.remind'))} />
          <SettingRow icon="settings" label={t(lang, 'notif.system')} value={t(lang, `notif.perm_${notifPerm === 'granted' ? 'granted' : notifPerm === 'denied' ? 'denied' : 'ask'}`)} onPress={onOpenSystemNotifications} />
          {authStatus === 'signedIn' ? <SettingRow icon="cloud" label={t(lang, 'sync.toggle_label')} right={toggle(settings.syncEnabled !== false, setSyncEnabled, t(lang, 'sync.toggle_label'))} /> : null}
        </Island>

        <Island padded={false}>
          <Text style={styles.sectionLabel}>{t(lang, 'settings.section_about')}</Text>
          <SettingRow first icon="info" label={t(lang, 'about.us')} onPress={() => Linking.openURL(LANDING_URL)} />
          <SettingRow icon="blog" label={t(lang, 'about.blog')} onPress={() => Linking.openURL(`${LANDING_URL}/blog.html`)} />
          <SettingRow icon="doc" label={t(lang, 'about.privacy')} onPress={() => openLegal('privacy', lang)} />
          <SettingRow icon="doc" label={t(lang, 'about.terms')} onPress={() => openLegal('terms', lang)} />
          <SettingRow icon="doc" label={t(lang, 'about.legal')} onPress={() => openLegal('legal', lang)} />
        </Island>

        <Text style={styles.footer}>Lancible · {appVersion}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: screenPadding, paddingTop: 2, paddingBottom: clearance, gap },
  updateBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.lg, padding: spacing.md },
  updateText: { flex: 1, color: colors.accentText, fontSize: fontSize.sm, fontWeight: '700' },
  updateAction: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '800', textDecorationLine: 'underline' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontSize: fontSize.md, fontWeight: '800' },
  profileName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  profileSub: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 1 },
  sectionLabel: { color: colors.textFaint, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: spacing.md, paddingTop: 9 },
  // Справа у «Дедлайнов» — бейдж непрочитанных и шеврон тем же рядом, что у
  // значения общей строки.
  rowRight: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 999, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.textOnColor, fontSize: 10.5, fontWeight: '700', lineHeight: 13 },
  footer: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.sm },
});

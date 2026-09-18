import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, Linking, Switch } from 'react-native';
import Constants from 'expo-constants';
import Text from '../components/AppText';
import PrimaryButton from '../components/PrimaryButton';
import ThemeSwitch from '../components/ThemeSwitch';
import SettingsRow, { SettingsCard } from '../components/SettingsRow';
import PickerSheet from '../components/PickerSheet';
import RateSheet from '../components/RateSheet';
import ProfileSheet from '../components/ProfileSheet';
import AuthSheet from '../components/AuthSheet';
import Icon from '../components/Icon';
import OnboardingScreen from './auth/OnboardingScreen';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { CURRENCIES } from '../lib/migrate';
import { CURRENCY_SYMBOLS, fmtMoney } from '../lib/format';
import { openSheet } from '../store/useSheetStore';
import { setSyncEnabled } from '../lib/sync';
import { permissionStatus, ensurePermission } from '../lib/notifications';
import { checkForUpdate } from '../lib/updateCheck';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, useThemeMode, spacing, radius, fontSize, tabBarClearance } from '../theme';
import { t, LANG_NAMES } from '../lib/i18n';

// Лендинг: главная и страница блога. Тот же адрес, что и в десктопной версии.
const LANDING_URL = 'https://lancible.vercel.app';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [notifPerm, setNotifPerm] = useState('ask');
  const styles = makeStyles(colors, insets);
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const settings = useAppStore((s) => s.settings);
  const setNotifyEnabled = useAppStore((s) => s.setNotifyEnabled);
  const setSettings = useAppStore((s) => s.setSettings);
  const resolvedMode = useThemeMode();
  const appVersion = (Constants.expoConfig && Constants.expoConfig.version) || '1.0.0';
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then((result) => {
      if (!cancelled && result.available) setUpdate(result);
    });
    return () => { cancelled = true; };
  }, []);

  // Разрешение могли поменять в системных настройках, пока приложение было
  // в фоне, — перечитываем его при заходе на экран.
  useEffect(() => { permissionStatus().then(setNotifPerm); }, []);

  if (authStatus === 'needsOnboarding') return <OnboardingScreen />;

  async function onToggleNotify(value) {
    // Включение имеет смысл только вместе с разрешением: без него мы бы
    // молча ничего не планировали, а тумблер показывал бы «включено».
    if (value) {
      await ensurePermission();
      setNotifPerm(await permissionStatus());
    }
    setNotifyEnabled(value);
  }

  async function onOpenSystemNotifications() {
    if (notifPerm === 'ask') {
      await ensurePermission();
      setNotifPerm(await permissionStatus());
      return;
    }
    Linking.openSettings();
  }

  function onOpenLanguage() {
    openSheet(
      <PickerSheet
        title={t(settings.lang, 'nav.language')}
        options={Object.keys(LANG_NAMES).map((code) => ({ value: code, label: LANG_NAMES[code] }))}
        value={settings.lang}
        onSelect={(code) => setSettings({ lang: code })}
      />,
    );
  }

  function onOpenCurrency() {
    openSheet(
      <PickerSheet
        title={t(settings.lang, 'settings.currency_label')}
        options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: `${code} (${CURRENCY_SYMBOLS[code] || code})` }))}
        value={settings.currency}
        onSelect={(code) => setSettings({ currency: code })}
      />,
    );
  }

  function onOpenRate() {
    openSheet(
      <RateSheet lang={settings.lang} initialValue={settings.hourlyRate} onSave={(n) => setSettings({ hourlyRate: n })} />,
    );
  }

  function onToggleTheme(nextIsDark) {
    setSettings({ theme: nextIsDark ? 'dark' : 'light' });
  }

  function onOpenProfile() {
    openSheet(<ProfileSheet />);
  }

  function onOpenAuth(tab) {
    openSheet(<AuthSheet initialTab={tab} />);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {update ? (
        <Pressable style={styles.updateBanner} onPress={() => Linking.openURL(update.url)}>
          <Icon name="download" size={18} color={colors.accentText} />
          <Text style={styles.updateBannerText} numberOfLines={1}>
            {t(settings.lang, 'settings.update_available', { version: update.version })}
          </Text>
          <Text style={styles.updateBannerAction}>{t(settings.lang, 'settings.update_download')}</Text>
        </Pressable>
      ) : null}

      {authStatus === 'signedIn' ? (
        <Pressable style={styles.profileCard} onPress={onOpenProfile}>
          <View style={styles.profileCardTop}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{(user.name || user.email || '?')[0].toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName} numberOfLines={1}>{user.name || user.email}</Text>
              {user.name ? <Text style={styles.profileSub} numberOfLines={1}>{user.email}</Text> : null}
            </View>
            <Icon name="chevron-right" size={15} color={colors.textDim} />
          </View>
        </Pressable>
      ) : (
        <View style={styles.profileCard}>
          <View style={styles.profileCardTop}>
            <View style={[styles.avatar, { backgroundColor: colors.panel2 }]}><Text style={[styles.avatarText, { color: colors.textDim }]}>?</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{t(settings.lang, 'profile.guest')}</Text>
              <Text style={styles.profileSub}>{t(settings.lang, 'profile.guest_sub')}</Text>
            </View>
          </View>
          <View style={styles.guestActions}>
            <View style={{ flex: 0.8 }}><PrimaryButton compact shrinkText title={t(settings.lang, 'auth.sign_in')} variant="ghost" onPress={() => onOpenAuth('signin')} /></View>
            <View style={{ flex: 1.2 }}><PrimaryButton compact shrinkText title={t(settings.lang, 'auth.create_account')} onPress={() => onOpenAuth('signup')} /></View>
          </View>
        </View>
      )}

      <Text style={styles.sectionLabel}>{t(settings.lang, 'settings.section_main')}</Text>
      <SettingsCard>
        <SettingsRow icon="globe" label={t(settings.lang, 'nav.language')} value={LANG_NAMES[settings.lang]} onPress={onOpenLanguage} />
        <SettingsRow
          icon="sun"
          label={t(settings.lang, 'settings.theme_label')}
          right={<ThemeSwitch value={resolvedMode === 'dark'} onValueChange={onToggleTheme} />}
          last
        />
      </SettingsCard>

      {authStatus === 'signedIn' ? (
        <>
          <Text style={styles.sectionLabel}>{t(settings.lang, 'settings.section_data')}</Text>
          <SettingsCard>
            <SettingsRow
              icon="cloud"
              label={t(settings.lang, 'sync.toggle_label')}
              right={(
                <Switch
                  value={settings.syncEnabled !== false}
                  onValueChange={setSyncEnabled}
                  trackColor={{ false: colors.panel2, true: colors.accent }}
                  ios_backgroundColor={colors.panel2}
                  thumbColor="#fff"
                />
              )}
              last
            />
          </SettingsCard>
        </>
      ) : null}

      <Text style={styles.sectionLabel}>{t(settings.lang, 'settings.section_notifications')}</Text>
      <SettingsCard>
        <SettingsRow
          icon="bell"
          label={t(settings.lang, 'notif.enable')}
          right={(
            <Switch
              value={settings.notifyEnabled !== false}
              onValueChange={onToggleNotify}
              trackColor={{ false: colors.panel2, true: colors.accent }}
              ios_backgroundColor={colors.panel2}
              thumbColor="#fff"
            />
          )}
        />
        <SettingsRow
          icon="settings"
          label={t(settings.lang, 'notif.system')}
          value={t(settings.lang, `notif.perm_${notifPerm === 'granted' ? 'granted' : notifPerm === 'denied' ? 'denied' : 'ask'}`)}
          onPress={onOpenSystemNotifications}
          last
        />
      </SettingsCard>

      <Text style={styles.sectionLabel}>{t(settings.lang, 'settings.section_work')}</Text>
      <SettingsCard>
        <SettingsRow icon="wallet" label={t(settings.lang, 'settings.rate_label')} value={fmtMoney(settings.hourlyRate || 0, settings.lang, settings.currency)} onPress={onOpenRate} />
        <SettingsRow icon="wallet" label={t(settings.lang, 'settings.currency_label')} value={settings.currency} onPress={onOpenCurrency} last />
      </SettingsCard>

      <Text style={styles.sectionLabel}>{t(settings.lang, 'settings.section_about')}</Text>
      <SettingsCard>
        <SettingsRow icon="link" label={t(settings.lang, 'about.us')} onPress={() => Linking.openURL(LANDING_URL)} />
        <SettingsRow icon="list-bullet" label={t(settings.lang, 'about.blog')} onPress={() => Linking.openURL(`${LANDING_URL}/blog.html`)} last />
      </SettingsCard>

      <Text style={styles.footer}>Lancible · {appVersion}</Text>
    </ScrollView>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: insets.bottom + tabBarClearance, gap: spacing.md },
  profileCard: {
    gap: spacing.md,
    backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg,
  },
  updateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radius.lg, padding: spacing.md,
  },
  updateBannerText: { flex: 1, color: colors.accentText, fontSize: fontSize.sm, fontWeight: '700' },
  updateBannerAction: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '800', textDecorationLine: 'underline' },
  profileCardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: fontSize.lg, fontWeight: '800' },
  profileName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  profileSub: { color: colors.textDim, fontSize: fontSize.sm, marginTop: 2 },
  guestActions: { flexDirection: 'row', gap: spacing.sm },
  sectionLabel: {
    color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: spacing.sm, marginLeft: spacing.xs,
  },
  footer: { color: colors.textDim, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.lg },
});

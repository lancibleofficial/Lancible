// «Меню»: профиль-остров, острова «Документы · Дедлайны и напоминания ·
// Теги» и разделы настроек — те же, что на вебе, в том же порядке:
// Основное, Работа, Данные, О приложении, Обратная связь (17 октября 2026; до
// этого всё лежало одной лентой). «Аккаунт» — не строкой, а плашкой профиля
// сверху (круг 21: строка её повторяла). Строка раздела — значок, название,
// сводка словами и шеврон; тап открывает раздел экраном стека
// (SettingsSectionScreen, «Обратная связь» — FeedbackScreen), «назад»
// возвращает сюда. В шапке — поиск и колокольчик.
import { View, ScrollView, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import Tap from '../components/Tap';
import Text from '../components/AppText';
import PrimaryButton from '../components/PrimaryButton';
import Island, { SettingRow } from '../components/Island';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import AuthSheet from '../components/AuthSheet';
import Icon from '../components/Icon';
import OnboardingScreen from './auth/OnboardingScreen';
import { MENU_SECTIONS, sectionSummary } from './SettingsSectionScreen';
import { useAuthStore, currentAccount } from '../store/useAuthStore';
import Accounts from '../core/accounts.js';
import { useAppStore } from '../store/useAppStore';
import { isGlobalTag } from '../lib/tags';
import { notificationFeed } from '../lib/due';
import { openSheet } from '../store/useSheetStore';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { useModeFlags } from '../hooks/useModeFlags';
import { useColors, spacing, screenPadding, radius, fontSize, gap } from '../theme';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import { t } from '../lib/i18n';

export default function SettingsScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const styles = makeStyles(colors, clearance);
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  // Открытый аккаунт без живого сеанса и гость при аккаунтах в списке —
  // плашка тоже ведёт в «Аккаунт» (17 октября 2026).
  const account = useAuthStore(currentAccount);
  const hasAccounts = useAuthStore((s) => s.accounts.list.length > 0);
  const settings = useAppStore((s) => s.settings);
  const documentsCount = useAppStore((s) => (s.documents || []).length);
  const tags = useAppStore((s) => s.tags);
  const tasks = useAppStore((s) => s.tasks);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const flags = useModeFlags();
  const lang = settings.lang;
  const appVersion = (Constants.expoConfig && Constants.expoConfig.version) || '1.0.0';
  const { update, updating, progress, install } = useAppUpdate(lang);
  const unread = notificationFeed(tasks, seenAt).filter((n) => n.unread).length;

  if (authStatus === 'needsOnboarding') return <OnboardingScreen />;
  if (authStatus === 'needsConsent') return <OnboardingScreen consentOnly />;

  const chevron = <Icon name="chevron-right" size={13} color={colors.textFaint} />;
  const openSection = (key) => (key === 'feedback' ? navigation.navigate('Feedback') : navigation.navigate('SettingsSection', { section: key }));
  const summaryCtx = { lang, settings, flags, appVersion };
  const tr = (key) => t(lang, key);
  // Аккаунт без сеанса: «нужно войти заново» или почта; гость — подсказка.
  const profileSub = account
    ? (account.needsSignIn ? t(lang, 'accounts.needs_sign_in') : (account.name ? account.email : ''))
    : t(lang, 'accounts.guest_sub');

  return (
    <View style={styles.container}>
      <TabHeader title={t(lang, 'nav.menu')}>
        <HeaderButton icon="search" label={t(lang, 'search.placeholder')} onPress={() => navigation.navigate('Search')} testID="menu-search" />
        <NotificationsButton navigation={navigation} />
      </TabHeader>
      <ScrollView testID="menu-scroll" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {update ? (
          <Tap style={styles.updateBanner} onPress={install} disabled={updating}>
            <Icon name="download" size={18} color={colors.accentText} />
            <Text style={styles.updateText} numberOfLines={1}>
              {updating
                ? t(lang, 'settings.update_downloading', { percent: Math.round(progress * 100) })
                : t(lang, 'settings.update_available', { version: update.version })}
            </Text>
            {updating ? null : <Text style={styles.updateAction}>{t(lang, update.canInstall ? 'settings.update_install' : 'settings.update_download')}</Text>}
          </Tap>
        ) : null}

        {authStatus === 'signedIn' ? (
          <Island onPress={() => openSection('account')} style={styles.profile} testID="menu-profile">
            <View style={styles.avatar}><Text style={styles.avatarText}>{(user.name || user.email || '?')[0].toUpperCase()}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileName} numberOfLines={1}>{user.name || user.email}</Text>
              <Text style={styles.profileSub} numberOfLines={1}>
                {[user.name ? user.email : null, t(lang, settings.syncEnabled !== false ? 'menu.sync_on' : 'menu.sync_off')].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {chevron}
          </Island>
        ) : account || hasAccounts ? (
          <Island onPress={() => openSection('account')} style={styles.profile} testID="menu-profile">
            <View style={[styles.avatar, !account && { backgroundColor: colors.panel2 }]}>
              <Text style={[styles.avatarText, !account && { color: colors.textDim }]}>{Accounts.accountInitial(account)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileName} numberOfLines={1}>{Accounts.accountLabel(account, tr)}</Text>
              {profileSub ? <Text style={styles.profileSub} numberOfLines={1} testID="menu-profile-sub">{profileSub}</Text> : null}
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

        {/* Разделы настроек — тот же набор и порядок, что на вебе; «Аккаунт» —
            плашка профиля выше. */}
        <Island padded={false} testID="menu-sections">
          {MENU_SECTIONS.map((s, i) => (
            <SettingRow
              key={s.key}
              first={i === 0}
              icon={s.icon}
              label={t(lang, s.title)}
              value={sectionSummary(s.key, summaryCtx)}
              onPress={() => openSection(s.key)}
              testID={`menu-section-${s.key}`}
              valueTestID={`menu-section-${s.key}-value`}
            />
          ))}
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
  // Справа у «Дедлайнов» — бейдж непрочитанных и шеврон тем же рядом, что у
  // значения общей строки.
  rowRight: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 999, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.textOnColor, fontSize: 10.5, fontWeight: '700', lineHeight: 13 },
  footer: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.sm },
});

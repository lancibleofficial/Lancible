// Шапка корневой вкладки: заголовок слева, справа квадратные кнопки
// действий (поиск, уведомления с бейджем, своё). Компактная, как на
// макете B2: заголовок 22, кнопки 36.
//
// Навигационная шапка на вкладках выключена, поэтому отступ под статус-бар
// берётся здесь.
import { Children, isValidElement, useContext, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Tap from './Tap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import Icon from './Icon';
import { GlassBg, headerButtonRadius, NativeHeaderScope } from './Glass';
import { TabNameContext, TabTitleSlide } from './TabSlide';
import { IOS_NATIVE_HEADER, useNativeOptions, nativeItems, elementSignature, leftElementItems } from '../navigation/nativeHeader';
import { useAppStore } from '../store/useAppStore';
import { notificationFeed } from '../lib/due';
import { useColors, spacing, radius, fontSize, displayFamily } from '../theme';
import { t } from '../lib/i18n';

/** Кнопка шапки: квадрат 36 с иконкой, при badge — красный счётчик. */
export function HeaderButton({ icon, label, onPress, badge, accent, testID }) {
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  return (
    <Tap
      onPress={onPress}
      hitSlop={6}
      style={[styles.btn, { borderRadius: headerButtonRadius(36, radius.md) }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <GlassBg radius={headerButtonRadius(36, radius.md)} backgroundColor={accent ? colors.accent : colors.panel} tint={accent ? colors.accent : undefined} />
      <Icon name={icon} size={18} color={accent ? colors.accentText : colors.textDim} />
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
    </Tap>
  );
}

/** Сколько непрочитанных в ленте уведомлений; подпись для бейджа. */
function useUnreadBadge() {
  const tasks = useAppStore((s) => s.tasks);
  const seenAt = useAppStore((s) => s.ui.notifSeenAt);
  const unread = notificationFeed(tasks, seenAt).filter((n) => n.unread).length;
  return unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null;
}

/** Колокольчик с числом непрочитанных — одна на все вкладки. */
export function NotificationsButton({ navigation }) {
  const lang = useAppStore((s) => s.settings.lang);
  const badge = useUnreadBadge();
  return (
    <HeaderButton
      icon="bell"
      label={t(lang, 'notif.title')}
      badge={badge}
      onPress={() => navigation.navigate('Notifications')}
    />
  );
}

/** iOS 26+: заголовок и кнопки уходят в нативную шапку — её кнопки
 *  система кладёт на жидкое стекло. Сам компонент ничего не рисует. */
function NativeTabHeader({ title, count, children }) {
  const navigation = useNavigation();
  const colors = useColors();
  const styles = makeStyles(colors, { top: 0 });
  const lang = useAppStore((s) => s.settings.lang);
  const badge = useUnreadBadge();
  const tab = useContext(TabNameContext);
  const list = Children.toArray(children).filter(isValidElement);
  const latest = useRef(list);
  latest.current = list;
  const toItem = (el) => {
    if (el.type === HeaderButton) {
      const p = el.props;
      return { icon: p.icon, label: p.label, onPress: p.onPress, badge: p.badge, prominent: !!p.accent, tint: p.accent ? colors.accentInk : undefined };
    }
    if (el.type === NotificationsButton) {
      return { icon: 'bell', label: t(lang, 'notif.title'), onPress: () => el.props.navigation.navigate('Notifications'), badge };
    }
    return null;
  };
  useNativeOptions(navigation, `${tab}|${title}|${count}|${lang}|${badge}|${colors.accentInk}|${colors.text}|${elementSignature(list)}`, () => ({
    title,
    // Заголовок слева нашим шрифтом и размером, как на других платформах;
    // при смене вкладки въезжает вместе со страницей (TabSlide).
    headerTitle: '',
    unstable_headerLeftItems: () => {
      const text = (
        <Text style={[styles.title, styles.titleNative]} numberOfLines={1}>
          {title}{count != null ? <Text style={styles.count}> {count}</Text> : null}
        </Text>
      );
      return leftElementItems(tab ? <TabTitleSlide tab={tab}>{text}</TabTitleSlide> : text);
    },
    unstable_headerRightItems: () => nativeItems(latest, toItem, (el) => <NativeHeaderScope>{el}</NativeHeaderScope>),
  }));
  return null;
}

export default function TabHeader({ title, count, children }) {
  if (IOS_NATIVE_HEADER) return <NativeTabHeader title={title} count={count}>{children}</NativeTabHeader>;
  return <JsTabHeader title={title} count={count}>{children}</JsTabHeader>;
}

function JsTabHeader({ title, count, children }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, insets);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={1}>
        {title}{count != null ? <Text style={styles.count}> {count}</Text> : null}
      </Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingTop: insets.top + spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg,
  },
  title: { flex: 1, minWidth: 0, color: colors.text, fontSize: 22, fontFamily: displayFamily.bold },
  // В нативной шапке у заголовка нет ширины родителя — тянуть нечего.
  titleNative: { flex: 0, maxWidth: 240 },
  count: { color: colors.textFaint, fontSize: 15, fontFamily: displayFamily.regular },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Подложку даёт GlassBg: стекло на iOS 26+, заливка panel/accent ниже.
  btn: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 999,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.textOnColor, fontSize: 10, lineHeight: 13, fontWeight: '700' },
});

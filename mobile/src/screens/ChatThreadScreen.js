// Чат с агентом — экран стека вкладки «Чат-бот» (круг 20, 18 октября 2026):
// список чатов (ChatListScreen) открывает его касанием, «назад» в шапке
// возвращает к списку, название чата — в шапке, рядом справа — «47 из 50
// сегодня» и «⋯» (меню чата: «Удалить чат»). Тот же агент, что панель на вебе и десктопе: разговор, вложения,
// круг инструментов и решения по карточкам — lib/aiChat.js, правила — ядро
// (core/ai.js). Здесь — экран: лента и поле над клавиатурой; без входа —
// пустой экран с «Войти» (общий AuthSheet).
//
// Экран — деталь стека (DETAIL_ROUTES): таббар и плашка таймера под ним
// прячутся, и поле стоит у нижнего края с безопасным полем снизу. Над
// клавиатурой поле держит KeyboardAvoidingView с automaticOffset (19 октября
// 2026): без него перекрытие считалось от верха экрана под шапкой, а не от
// верха окна, и поле оставалось за клавиатурой на высоту шапки.
//
// Название в шапке — на ступень мельче названий страниц (typography.title,
// круг 21): это первые слова разговора, а не имя раздела.
//
// С поля главного экрана (круг 21): params.send — первое сообщение, его
// отправляет этот экран, когда встал (и оно появляется, как обычно); quiet —
// экран проявляется на месте без хода стека (chatThreadOptions); from — верх
// поля главного в окне: поле этого экрана начинает путь оттуда и едет к
// своему месту внизу (fieldShift, FIELD_MOVE). После перехода «назад» —
// обычным ходом стека.
//
// Лента — обычная прокрутка (строк не больше 120): строки не пересоздаются
// при прокрутке, и появление каждой играет один раз. Вниз она докручивается
// сама, только если человек и так внизу (или только что отправил своё): кто
// листает историю, того поток не уводит. Пустая лента — что умеет агент и
// три примера; касание подставляет пример в поле.
//
// Агент — по приглашению (21 октября 2026, lib/aiAccess.js): чат, открытый
// без доступа (уведомление, поиск, восстановление места), — тот же экран
// «закрытый тест», что на главном (chat/ChatLocked.js), без ленты, поля и
// названия чата; переписка на устройстве остаётся. Ответа ещё нет — прежнее
// известное этого аккаунта или скелет поля. Ответ функции 403 no access
// посреди разговора закрывает экран так же.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedStyle, useSharedValue, withTiming, measure } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import Tap from '../components/Tap';
import EmptyState from '../components/EmptyState';
import MenuSheet from '../components/MenuSheet';
import AuthSheet from '../components/AuthSheet';
import { HeaderButton } from '../components/TabHeader';
import { confirmDeleteChat } from './ChatListScreen';
import ChatRow, { markShown } from '../components/chat/ChatRow';
import ChatTyping from '../components/chat/ChatTyping';
import ChatCompose, { openAttachSheet } from '../components/chat/ChatCompose';
import ChatLocked from '../components/chat/ChatLocked';
import { Skeleton } from '../components/Skeleton';
import { HANDOFF_FADE_MS, FIELD_MOVE, fieldShift } from '../components/chat/chatMotion';
import { KeyboardAvoidingView } from '../lib/keyboard';
import {
  useAiChat, aiAccount, aiOpenChat, aiSend, aiRetry, aiApplyCard, aiDeclineCard, aiUndoCard, aiDetach, aiDropPending,
  lastApplied, AI_EXAMPLES,
} from '../lib/aiChat';
import { useAccess, aiCheckAccess } from '../lib/aiAccess';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { openSheet } from '../store/useSheetStore';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { pushTask } from '../navigation/openTask';
import { IOS_NATIVE_HEADER, leftElementItems, headerIcon } from '../navigation/nativeHeader';
import { useColors, spacing, screenPadding, radius, fontSize, typography, buttonHeight } from '../theme';
import { t } from '../lib/i18n';

/** Опции экрана чата в стеке. С поля главного экрана (params.quiet) — без
 *  хода стека: проявление на месте, 150 мс; иначе — ход стека, как у всех. */
export function chatThreadOptions({ route }) {
  const quiet = !!(route && route.params && route.params.quiet);
  return quiet ? { title: '', animation: 'fade', animationDuration: HANDOFF_FADE_MS } : { title: '' };
}

/** Название чата в шапке — на ступень мельче названия страницы. */
function ChatTitle({ text, colors }) {
  return <Text style={[typography.title, { color: colors.text, flexShrink: 1, maxWidth: 260 }]} numberOfLines={1} testID="chat-title">{text}</Text>;
}

/** Насколько близко к низу ленты — уже «внизу», пт. */
const NEAR_END = 48;

/** Пустая лента: что умеет агент и три примера. */
function ChatEmpty({ lang, onPick, s }) {
  return (
    <View style={s.empty} testID="chat-empty">
      <EmptyState art="tasks" title={t(lang, 'ai.title')} text={t(lang, 'ai.empty_hint')} />
      <View style={s.examples}>
        {AI_EXAMPLES.map((key) => (
          <Tap key={key} style={s.example} onPress={() => onPick(t(lang, key))} accessibilityRole="button" testID={`chat-example-${key}`}>
            <Text style={s.exampleText}>{t(lang, key)}</Text>
          </Tap>
        ))}
      </View>
    </View>
  );
}

/** Счётчик сообщений на сегодня — справа в шапке. */
function Quota({ text, s }) {
  return <Text style={s.quota} numberOfLines={1} testID="chat-quota">{text}</Text>;
}

export default function ChatThreadScreen({ navigation, route }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Таббара и плашки таймера на экране нет — под полем только безопасное поле.
  const clearance = insets.bottom + spacing.sm;
  const s = makeStyles(colors, clearance);
  const lang = useAppStore((st) => st.settings.lang);
  const openProject = useAppStore((st) => st.openProject);
  const status = useAuthStore((st) => st.status);
  const user = useAuthStore((st) => st.user);
  const uid = status === 'signedIn' && user ? user.id : null;
  const access = useAccess(uid);
  const chatId = (route && route.params && route.params.chatId) || null;
  const {
    items, busy, waiting, loaded, opened, needAuth, remaining, limit, chats, pending, attaching, attachError,
  } = useAiChat();
  const own = useAiChat((st) => st.chatId === chatId);
  const reduced = useReduceMotion();
  const [draft, setDraft] = useState(() => (route && route.params && route.params.draft) || '');
  const input = useRef(null);
  const scroll = useRef(null);
  const atEnd = useRef(true);
  // С поля главного экрана: первое сообщение и откуда едет поле. Берутся
  // один раз, при первой отрисовке.
  const [handoff] = useState(() => {
    const p = (route && route.params) || {};
    return { send: typeof p.send === 'string' ? p.send : null, from: Number.isFinite(p.from) ? p.from : null };
  });
  const sent = useRef(false);
  const box = useAnimatedRef();
  const travel = useSharedValue(handoff.from == null || reduced ? 1 : 0);
  const started = useRef(false);

  const signed = !!uid && !needAuth;

  // Чья история: вход, выход и другой аккаунт — как у списка под этим
  // экраном (тот же аккаунт — no-op; после 401 вход заново снимает «нужен
  // вход»: user — новый объект). Заодно — открыт ли агент этому аккаунту.
  useEffect(() => { aiAccount(uid); aiCheckAccess(uid); }, [uid, user]);
  // Свой чат — в ленту (тот же, уже открытый, — как есть).
  useEffect(() => { if (signed && loaded && chatId) aiOpenChat(chatId); }, [signed, loaded, chatId, uid]);
  // Экран вернулся в фокус — снова свой чат. Лента одна на все экраны чата, а
  // экран чата — деталь любого стека: пока этот ждал во вкладке «Чат-бот»,
  // поиск в «Проектах» мог открыть поверх другой чат, и без этого экран стоял
  // бы пустым, с закрытым полем.
  const reopen = useRef(null);
  reopen.current = () => { if (signed && loaded && chatId) aiOpenChat(chatId); };
  useEffect(() => {
    if (typeof navigation.addListener !== 'function') return undefined;
    return navigation.addListener('focus', () => reopen.current());
  }, [navigation]);
  // Ушли из чата — недоотправленные вложения уходят из кеша. Только свои:
  // если поле сейчас у другого чата, его вложения остаются.
  useEffect(() => () => aiDropPending(chatId), [chatId]);
  // Первое сообщение с поля главного экрана — отсюда, когда экран встал:
  // оно появляется в ленте, как любое своё. Не ушло (нет входа, идёт ответ)
  // — остаётся в поле. Параметр снимается, чтобы не уйти второй раз. Пока не
  // известно, открыт ли агент, — ждёт; закрыт — не уходит.
  useEffect(() => {
    if (sent.current || !handoff.send || !signed || !loaded || access !== 'open') return;
    sent.current = true;
    atEnd.current = true;
    if (!aiSend(handoff.send)) setDraft(handoff.send);
    if (typeof navigation.setParams === 'function') navigation.setParams({ send: undefined });
  }, [signed, loaded, access]);
  // Переход кончился — «назад» обычным ходом стека.
  useEffect(() => {
    if (typeof navigation.addListener !== 'function') return undefined;
    return navigation.addListener('transitionEnd', (e) => {
      if (e && e.data && e.data.closing) return;
      if (route && route.params && route.params.quiet && typeof navigation.setParams === 'function') navigation.setParams({ quiet: undefined });
    });
  }, [navigation]);

  // Строки, что уже стояли, когда лента открылась, — без появления.
  useState(() => markShown(useAiChat.getState().items));

  const locked = signed && access === 'locked';
  const chat = locked ? null : chats.find((c) => c.id === chatId);
  const title = locked ? '' : (chat && chat.title) || t(lang, 'ai.new_chat');
  const quota = signed && !locked && remaining !== null && limit !== null ? t(lang, 'ai.quota', { remaining, limit }) : null;

  // Меню чата — «Удалить чат», как «⋯» строки на вебе. У чата, которого ещё
  // нет в списке (ни одного сообщения), удалять нечего — меню нет.
  const openMenu = () => openSheet(
    <MenuSheet
      title={t(lang, 'ai.menu')}
      items={[{
        key: 'delete-chat', label: t(lang, 'ai.delete_chat'), icon: 'trash', danger: true,
        onPress: () => confirmDeleteChat(chat, lang, () => navigation.goBack()),
      }]}
    />,
  );
  const menuRef = useRef(openMenu);
  menuRef.current = openMenu;

  useLayoutEffect(() => {
    const quotaNode = quota ? <Quota text={quota} s={s} /> : null;
    const menu = signed && chat;
    const titleNode = <ChatTitle text={title} colors={colors} />;
    navigation.setOptions({
      title,
      ...(IOS_NATIVE_HEADER
        ? {
          headerTitle: '',
          headerBackVisible: true,
          unstable_headerLeftItems: () => leftElementItems(titleNode),
          unstable_headerRightItems: () => [
            ...(quotaNode ? leftElementItems(quotaNode) : []),
            ...(menu ? [{ type: 'button', label: t(lang, 'ai.menu'), accessibilityLabel: t(lang, 'ai.menu'), icon: headerIcon('kebab'), onPress: () => menuRef.current() }] : []),
          ],
        }
        : {
          headerTitle: () => titleNode,
          headerRight: quotaNode || menu ? () => (
            <View style={s.headActions}>
              {quotaNode}
              {menu ? <HeaderButton icon="kebab" label={t(lang, 'ai.menu')} onPress={() => menuRef.current()} testID="chat-menu" /> : null}
            </View>
          ) : undefined,
        }),
    });
  }, [navigation, title, quota, colors, signed, !!chat, lang, locked]);

  const stick = useCallback(() => {
    if (atEnd.current && scroll.current) scroll.current.scrollToEnd({ animated: false });
  }, []);
  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_END;
  }, []);

  const send = () => {
    atEnd.current = true;
    if (aiSend(draft)) setDraft('');
  };
  const pick = (text) => {
    setDraft(text);
    if (input.current && input.current.focus) input.current.focus();
  };
  const onOpen = useCallback((link) => {
    if (link.kind === 'task') pushTask(navigation, link.id);
    else { openProject(link.id); navigation.navigate('Project', { projectId: link.id }); }
  }, [navigation, openProject]);

  // Скрепка: «Фото» или «Файл» (общий лист поля — ChatCompose).
  const openAttach = () => openAttachSheet(lang);

  // Поле с главного экрана: едет от его места к своему. Своё место берётся
  // на каждом кадре хода (measure на потоке интерфейса) — его двигает и
  // клавиатура, которая в это время уходит. Пока места нет — поля не видно.
  const onBoxLayout = () => {
    if (started.current || travel.value >= 1) return;
    started.current = true;
    travel.value = withTiming(1, FIELD_MOVE);
  };
  const fromY = handoff.from;
  const move = useAnimatedStyle(() => {
    if (fromY == null || travel.value >= 1) return { opacity: 1, transform: [{ translateY: 0 }] };
    const m = measure(box);
    if (!m) return { opacity: 0, transform: [{ translateY: 0 }] };
    return { opacity: 1, transform: [{ translateY: fieldShift(fromY, m.pageY, travel.value) }] };
  });

  const signIn = () => {
    // Онбординг и согласие живут в «Меню» — туда, а не в лист входа.
    if (status === 'needsOnboarding' || status === 'needsConsent') navigation.navigate('Menu');
    else openSheet(<AuthSheet initialTab="signin" email={user && user.email ? user.email : ''} />);
  };

  const shown = own && opened;
  const rows = shown ? items : [];
  const last = lastApplied(rows);

  if (!signed) {
    return (
      <View style={s.container}>
        <ScrollView contentContainerStyle={s.signin} testID="chat-signin">
          <EmptyState
            art="tasks"
            title={t(lang, 'ai.signin_title')}
            text={t(lang, 'ai.signin_text')}
            actionLabel={t(lang, 'ai.signin_btn')}
            onAction={signIn}
            primary
          />
        </ScrollView>
      </View>
    );
  }

  if (locked) {
    return (
      <View style={s.container}>
        <ChatLocked lang={lang} uid={uid} email={user && user.email ? user.email : ''} clearance={clearance} />
      </View>
    );
  }

  if (access !== 'open') {
    // Ответа ещё нет: лента пуста, на месте поля — его скелет.
    return (
      <View style={s.container} testID="chat-access-wait">
        <View style={s.body} />
        <View style={s.wait}>
          <Skeleton width="100%" height={buttonHeight} radius={radius.lg} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <KeyboardAvoidingView behavior="padding" automaticOffset style={s.body} testID="chat-avoid">
        <ScrollView
          ref={scroll}
          style={s.log}
          contentContainerStyle={s.content}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={stick}
          onLayout={stick}
          keyboardShouldPersistTaps="handled"
          // iOS — клавиатура уходит вслед за пальцем; на Android такого нет,
          // там она уходит, как только ленту потянули.
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          testID="chat-log"
        >
          {shown && !rows.length && !busy && !(handoff.send && !sent.current) ? <ChatEmpty lang={lang} onPick={pick} s={s} /> : null}
          {rows.map((it) => (
            <ChatRow
              key={it.id}
              item={it}
              lang={lang}
              reduced={reduced}
              isLast={it === last}
              onRetry={aiRetry}
              onApply={aiApplyCard}
              onDecline={aiDeclineCard}
              onUndo={aiUndoCard}
              onOpen={onOpen}
            />
          ))}
          {shown && busy && waiting ? <ChatTyping /> : null}
        </ScrollView>
        <Animated.View ref={box} collapsable={false} onLayout={onBoxLayout} testID="chat-field">
          <Animated.View style={move} testID="chat-field-move">
            <ChatCompose
              ref={input}
              value={draft}
              onChangeText={setDraft}
              onSend={send}
              busy={busy || !shown}
              clearance={clearance}
              pending={shown ? pending : []}
              attaching={attaching}
              attachError={attachError}
              onAttach={openAttach}
              onDetach={aiDetach}
            />
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  log: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md },
  signin: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: screenPadding, paddingBottom: clearance },
  wait: { paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: clearance },
  empty: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.lg },
  examples: { gap: spacing.sm },
  example: { backgroundColor: colors.panel, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  exampleText: { color: colors.text, fontSize: fontSize.sm, lineHeight: 19 },
  quota: { color: colors.textFaint, fontSize: fontSize.xs, maxWidth: 160 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});

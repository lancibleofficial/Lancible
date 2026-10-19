// «Чат-бот» — третья вкладка (18 октября 2026, на месте «Сегодня»). С круга
// 21 (19 октября 2026) её главный экран — поле посередине: над ним сценка chat
// и фраза (Core.aiGreeting: приветствие по времени суток — с именем, если оно
// есть, — или подталкивание; каждый вход на экран — следующий seed), под ним
// — прежние чаты строками-островами: название (из первого сообщения), превью
// последнего ответа, число сообщений и время; свежие сверху
// (Core.aiChatsNormalize). Чатов нет — под полем что умеет агент и три
// примера: пример встаёт в поле.
//
// Отправка с поля — новый чат (ChatThreadScreen), и переход почти незаметен:
// экран чата проявляется на месте (fade 150 мс вместо хода стека), поле того
// же вида встаёт туда, где было это, и едет к низу экрана, а первое
// сообщение появляется, как обычно, — его отправляет уже экран чата
// (params.send). Клавиатура уходит вместе с полем. Касание строки — чат
// прежним ходом стека (push, «назад» — сюда); долгое нажатие (и действие
// «Удалить чат» у читалки экрана) — «Удалить чат?» общим листом
// подтверждения (lib/dialogs.js). Скрепка поля заводит новый чат сразу:
// вложения ждут отправки в нём.
//
// В шапке — поиск (находит и чаты) и колокольчик, как у других вкладок;
// рядом с названием — «47 из 50 сегодня» (лимит на человека, а не на чат).
// Без входа — «Войти» (общий AuthSheet), поля нет.
//
// Строки — острова (Island) без появления: страница въезжает уже собранной,
// как все списки приложения.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Keyboard, StyleSheet } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Text from '../components/AppText';
import Tap from '../components/Tap';
import Island from '../components/Island';
import EmptyState from '../components/EmptyState';
import AuthSheet from '../components/AuthSheet';
import { Block } from '../components/RepeatControls';
import TabHeader, { HeaderButton, NotificationsButton } from '../components/TabHeader';
import { useBottomClearance } from '../components/TimerMiniPlayer';
import ChatGreeting from '../components/chat/ChatGreeting';
import ChatCompose, { openAttachSheet } from '../components/chat/ChatCompose';
import Ai from '../core/ai.js';
import { KeyboardAwareScrollView, measurePageTop } from '../lib/keyboard';
import { useAiChat, aiAccount, aiNewChat, aiDeleteChat, aiDetach, AI_EXAMPLES } from '../lib/aiChat';
import { confirmSheet } from '../lib/dialogs';
import { fmtTimeShort } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { openSheet } from '../store/useSheetStore';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useKeyboardState } from '../hooks/useKeyboardState';
import { useColors, spacing, screenPadding, radius, fontSize, typography, buttonHeight } from '../theme';
import { t, pluralForm, LOCALE_MAP } from '../lib/i18n';

/** Когда чат менялся — как у веба: «сегодня 14:20», «вчера», «12 окт.»;
 *  прошлый год — с годом. */
export function chatWhen(iso, lang, now = Date.now()) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const today = new Date(now);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(today) - day(d)) / 86400000);
  if (ago === 0) return t(lang, 'ai.when_today', { time: fmtTimeShort(iso, lang) });
  if (ago === 1) return t(lang, 'ai.when_yesterday');
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(LOCALE_MAP[lang] || 'ru-RU', opts);
}

/** «6 сообщений». */
export const chatCount = (n, lang) => t(lang, 'ai.chat_count', { n, plural: pluralForm(lang, n, 'plural.message') });

/** «Удалить чат?» — общий лист подтверждения; после удаления — then(). Тот
 *  же вопрос у строки списка и в меню чата (ChatThreadScreen). */
export function confirmDeleteChat(chat, lang, then) {
  confirmSheet({
    title: t(lang, 'ai.delete_chat_q'),
    message: t(lang, 'ai.delete_chat_text', { name: chat.title || t(lang, 'ai.new_chat') }),
    actions: [
      { label: t(lang, 'ai.delete_chat'), destructive: true, onPress: () => { aiDeleteChat(chat.id); if (then) then(); } },
      { label: t(lang, 'common.cancel'), cancel: true },
    ],
  });
}

// Счётчик входов на главный экран — seed фразы (Core.aiGreeting: чётный —
// приветствие, нечётный — подталкивание, без повтора подряд). Начало —
// случайное чётное: первым после запуска здоровается. Один на приложение —
// экран, построенный заново, продолжает счёт, а не начинает его.
let entries = Math.floor(Math.random() * 1e6) * 2 - 1;

/** Следующий вход на экран — следующий seed. */
export function nextGreetingSeed() {
  entries += 1;
  return entries;
}

/** Фраза над полем: ядро выбирает ключ, словарь — слова. */
export function greetingText(lang, { now, name, seed }) {
  const g = Ai.aiGreeting({ now, name, seed });
  return t(lang, g.key, g.vars);
}

/** Высота поля в покое: строка поля (кнопка) и поля сверху и снизу. От неё
 *  поле встаёт серединой посередине экрана. */
const FIELD_H = buttonHeight + spacing.sm * 2;

function ChatItem({ chat, lang, onOpen, onDelete, s }) {
  const title = chat.title || t(lang, 'ai.new_chat');
  return (
    <Island
      style={s.item}
      onPress={() => onOpen(chat.id)}
      onLongPress={() => onDelete(chat)}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityActions={[{ name: 'delete', label: t(lang, 'ai.delete_chat') }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'delete') onDelete(chat); }}
      testID={`chat-item-${chat.id}`}
    >
      <View style={s.head}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <Text style={s.time}>{chatWhen(chat.updatedAt, lang)}</Text>
      </View>
      {chat.preview ? <Text style={s.preview} numberOfLines={2}>{chat.preview}</Text> : null}
      <Text style={s.meta}>{chatCount(chat.count || 0, lang)}</Text>
    </Island>
  );
}

export default function ChatListScreen({ navigation }) {
  const colors = useColors();
  const clearance = useBottomClearance();
  const s = makeStyles(colors, clearance);
  const lang = useAppStore((st) => st.settings.lang);
  const status = useAuthStore((st) => st.status);
  const user = useAuthStore((st) => st.user);
  const uid = status === 'signedIn' && user ? user.id : null;
  const chats = useAiChat((st) => st.chats);
  const loaded = useAiChat((st) => st.loaded);
  const needAuth = useAiChat((st) => st.needAuth);
  const remaining = useAiChat((st) => st.remaining);
  const limit = useAiChat((st) => st.limit);
  const busy = useAiChat((st) => st.busy);
  const attaching = useAiChat((st) => st.attaching);
  const reduced = useReduceMotion();
  const [draft, setDraft] = useState('');
  // Чат, заведённый скрепкой этого поля: вложения ждут отправки в нём.
  const [freshId, setFreshId] = useState(null);
  const fresh = useAiChat((st) => !!freshId && st.chatId === freshId && !st.items.length);
  const pending = useAiChat((st) => st.pending);
  const attachError = useAiChat((st) => st.attachError);
  const [entry, setEntry] = useState(() => ({ seed: nextGreetingSeed(), at: Date.now() }));
  const [viewH, setViewH] = useState(0);
  // Пока открыта клавиатура, панели вкладок нет и страница выше — середина
  // считается по высоте без клавиатуры, иначе поле съехало бы к ней.
  const kb = useKeyboardState();
  const kbShown = useRef(kb.shown);
  kbShown.current = kb.shown;
  const input = useRef(null);
  const fieldBox = useAnimatedRef();

  // Чьи чаты: вход, выход и другой аккаунт. После 401 тот же аккаунт,
  // вошедший заново, снимает «нужен вход» (user — новый объект).
  useEffect(() => { aiAccount(uid); }, [uid, user]);

  // Каждый вход на экран — новая фраза. Вход — фокус после ухода (blur):
  // первый вход и так со своей фразой, а фокус при построении экрана
  // приходит не всегда (вкладка строится после заглушки, уже в фокусе) —
  // по нему фраза мигнула бы или следующий вход прошёл бы без новой.
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return undefined;
    let away = false;
    const offBlur = navigation.addListener('blur', () => { away = true; });
    const offFocus = navigation.addListener('focus', () => {
      if (!away) return;
      away = false;
      setEntry({ seed: nextGreetingSeed(), at: Date.now() });
    });
    return () => {
      if (typeof offBlur === 'function') offBlur();
      if (typeof offFocus === 'function') offFocus();
    };
  }, [navigation]);

  const signed = !!uid && !needAuth;
  const quota = signed && remaining !== null && limit !== null ? t(lang, 'ai.quota', { remaining, limit }) : null;
  const name = user && typeof user.name === 'string' ? user.name : '';
  const phrase = useMemo(() => greetingText(lang, { now: entry.at, name, seed: entry.seed }), [lang, name, entry]);

  const open = (chatId) => navigation.push('ChatThread', { chatId });
  const remove = (chat) => confirmDeleteChat(chat, lang);
  const pick = (text) => {
    setDraft(text);
    if (input.current && input.current.focus) input.current.focus();
  };
  // Скрепка: вложениям нужен чат — новый, сразу (в список он попадёт с
  // первым сообщением).
  const attach = () => {
    if (!fresh) setFreshId(aiNewChat());
    openAttachSheet(lang);
  };
  const send = () => {
    const text = String(draft || '').trim();
    if (!text || busy || attaching) return;
    const chatId = fresh ? freshId : aiNewChat();
    setDraft('');
    setFreshId(null);
    // Верх поля — с него поле экрана чата начинает путь вниз; мерится там же,
    // где его мерит экран чата (measurePageTop), — тогда они совпадут.
    measurePageTop(fieldBox, (from) => {
      Keyboard.dismiss();
      navigation.push('ChatThread', { chatId, send: text, quiet: true, ...(Number.isFinite(from) ? { from } : null) });
    });
  };
  const signIn = () => {
    // Онбординг и согласие живут в «Меню» — туда, а не в лист входа.
    if (status === 'needsOnboarding' || status === 'needsConsent') navigation.navigate('Menu');
    else openSheet(<AuthSheet initialTab="signin" email={user && user.email ? user.email : ''} />);
  };

  let body = null;
  if (!signed) {
    body = (
      <ScrollView contentContainerStyle={s.center} testID="chat-signin">
        <EmptyState
          art="tasks"
          title={t(lang, 'ai.signin_title')}
          text={t(lang, 'ai.signin_text')}
          actionLabel={t(lang, 'ai.signin_btn')}
          onAction={signIn}
          primary
        />
      </ScrollView>
    );
  } else if (loaded) {
    // Поле — серединой посередине видимой части (над нижним запасом):
    // сценка и фраза над ним, чаты под ним.
    const heroMin = viewH ? Math.max(0, (viewH - clearance) / 2 + FIELD_H / 2) : 0;
    body = (
      <KeyboardAwareScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        bottomOffset={spacing.md}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onLayout={(e) => { if (!kbShown.current || !viewH) setViewH(e.nativeEvent.layout.height); }}
        testID={chats.length ? 'chat-list' : 'chat-list-empty'}
      >
        <View style={[s.hero, { minHeight: heroMin }]} testID="chat-hero">
          <ChatGreeting phrase={phrase} reduced={reduced} />
          <Animated.View ref={fieldBox} collapsable={false} style={s.field} testID="chat-field">
            <ChatCompose
              ref={input}
              value={draft}
              onChangeText={setDraft}
              onSend={send}
              busy={busy}
              editable
              clearance={spacing.sm}
              pending={fresh ? pending : []}
              attaching={attaching}
              attachError={fresh ? attachError : null}
              onAttach={attach}
              onDetach={aiDetach}
            />
          </Animated.View>
        </View>
        {chats.length ? (
          <View style={s.list} testID="chat-rows">
            <Block label={t(lang, 'ai.chats_title')}>
              {chats.map((chat) => <ChatItem key={chat.id} chat={chat} lang={lang} onOpen={open} onDelete={remove} s={s} />)}
            </Block>
          </View>
        ) : (
          <View style={s.list} testID="chat-examples">
            <Text style={s.hint}>{t(lang, 'ai.empty_hint')}</Text>
            {AI_EXAMPLES.map((key) => (
              <Tap key={key} style={s.example} onPress={() => pick(t(lang, key))} accessibilityRole="button" testID={`chat-example-${key}`}>
                <Text style={s.exampleText}>{t(lang, key)}</Text>
              </Tap>
            ))}
          </View>
        )}
      </KeyboardAwareScrollView>
    );
  }

  return (
    <View style={s.container}>
      <TabHeader title={t(lang, 'ai.tab')} count={quota}>
        <HeaderButton icon="search" label={t(lang, 'search.placeholder')} onPress={() => navigation.navigate('Search')} testID="chat-search" />
        <NotificationsButton navigation={navigation} />
      </TabHeader>
      {body}
    </View>
  );
}

const makeStyles = (colors, clearance) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: clearance, gap: spacing.lg },
  center: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg, paddingHorizontal: screenPadding, paddingVertical: spacing.lg, paddingBottom: clearance },
  hero: { justifyContent: 'flex-end', gap: spacing.lg },
  // У поля боковое поле своё (ChatCompose) — то же, что в чате: здесь оно
  // выходит на край страницы, чтобы встать ровно там же.
  field: { marginHorizontal: -screenPadding },
  list: { gap: spacing.sm },
  // Поля строки — общие у острова (Island).
  item: { gap: 3 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { ...typography.body, flex: 1, minWidth: 0, color: colors.text, fontWeight: '600' },
  time: { ...typography.caption, color: colors.textFaint },
  preview: { ...typography.caption, color: colors.textDim },
  meta: { ...typography.caption, color: colors.textFaint },
  hint: { ...typography.caption, lineHeight: 20, color: colors.textDim, textAlign: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  example: { backgroundColor: colors.panel, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  exampleText: { color: colors.text, fontSize: fontSize.sm, lineHeight: 19 },
});

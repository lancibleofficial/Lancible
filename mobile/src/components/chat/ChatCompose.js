// Поле сообщения агенту — внизу экрана чата, над клавиатурой. Многострочное
// общее поле (Field) растёт с текстом до шести строк; скрепка (лист «Фото» /
// «Файл») — значок внутри поля у левого края, без подложки и рамки, у нижней
// строки (19 октября 2026; раньше стояла квадратной кнопкой с подложкой
// слева от поля): зона касания — CLIP_W × высота кнопки, текст поля
// начинается правее неё. Справа от поля — квадратная «Отправить» высотой с поле (как «+»
// у полей версий). Перенос строки — клавишей клавиатуры, отправка — только
// кнопкой. Пока идёт ответ, всё недоступно.
// Над полем — вложения (components/chat/ChatFiles.js: PendingFiles) и отказ
// последнего вложения строкой. Счётчик «47 из 50 сегодня» — в шапке чата.
//
// То же поле — посередине главного экрана «Чат-бота» (ChatListScreen, круг
// 21): одно и то же по виду, чтобы переход в чат после отправки был почти
// незаметен — поле экрана чата встаёт на место этого и едет к низу. Там
// печатать можно и пока где-то идёт ответ (editable), а отправить — нет.
//
// Над клавиатурой поле держит KeyboardAvoidingView экрана (lib/keyboard.js);
// здесь — только нижний отступ: в покое это clearance экрана (безопасное
// поле снизу). На iOS с открытой клавиатурой он по кадрам её хода сходит к
// малому: высота клавиатуры там считается от низа экрана. На Android — нет:
// библиотека отдаёт высоту без системной панели под клавиатурой (замер на
// эмуляторе 19 октября 2026: 336 dp у клавиатуры в 360), и, сойди отступ к
// малому, поле ушло бы под клавиатуру на высоту панели. Тот же счёт, что у
// нижнего листа (BottomSheet: «безопасная зона под листом остаётся всегда»).
import { forwardRef, useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Text from '../AppText';
import Icon from '../Icon';
import Tap from '../Tap';
import { Field } from '../AppTextInput';
import { PendingFiles } from './ChatFiles';
import MenuSheet from '../MenuSheet';
import { CLOSE_MS } from '../BottomSheet';
import { attachErrorText } from '../../lib/aiAttach';
import { aiAttach } from '../../lib/aiChat';
import { openSheet } from '../../store/useSheetStore';
import { KEYBOARD_NATIVE, useReanimatedKeyboardAnimation } from '../../lib/keyboard';
import { useKeyboardState } from '../../hooks/useKeyboardState';
import { useAppStore } from '../../store/useAppStore';
import { useColors, spacing, screenPadding, fontSize, buttonHeight, buttonRadius } from '../../theme';
import { t } from '../../lib/i18n';

/** Сообщение не длиннее стольких знаков — столько пропускает функция
 *  ai-chat (MAX_TEXT). */
export const AI_TEXT_MAX = 50000;

/** Потолок поля: шесть строк текста и поля сверху и снизу. */
export const COMPOSE_MAX = 6 * 21 + 26;

/** Ширина зоны скрепки внутри поля: не уже 40 под палец (на 4 меньше высоты
 *  кнопки). Значок 20 стоит в ней посередине — ровно там, где у общего поля
 *  боковой отступ (12), а текст поля начинается сразу за зоной. */
export const CLIP_W = buttonHeight - spacing.xs;

/** Доля хода клавиатуры: 0 — закрыта, 1 — открыта. Кадры — от библиотеки;
 *  без её нативной части — по событиям, своим ходом. */
function useKeyboardShare() {
  const kb = useKeyboardState();
  const frames = useReanimatedKeyboardAnimation();
  const fallback = useSharedValue(kb.shown ? 1 : 0);
  useEffect(() => {
    if (!KEYBOARD_NATIVE) fallback.value = withTiming(kb.shown ? 1 : 0, { duration: 220 });
  }, [kb.shown]);
  return { frames, fallback };
}

/** Лист скрепки: «Фото» или «Файл». Системный выбор — когда лист уже ушёл:
 *  поверх уходящего листа iOS окно выбора не покажет. */
export function openAttachSheet(lang) {
  const attach = (kind) => setTimeout(() => { aiAttach(kind); }, CLOSE_MS + 60);
  openSheet(
    <MenuSheet
      title={t(lang, 'ai.attach')}
      items={[
        { key: 'attach-photo', label: t(lang, 'ai.attach_photo'), icon: 'image', onPress: () => attach('photo') },
        { key: 'attach-file', label: t(lang, 'ai.attach_file'), icon: 'doc', onPress: () => attach('file') },
      ]}
    />,
  );
}

const ChatCompose = forwardRef(function ChatCompose({
  value, onChangeText, onSend, busy, editable, clearance, pending, attaching, attachError, onAttach, onDetach,
}, ref) {
  const colors = useColors();
  const s = makeStyles(colors);
  const lang = useAppStore((st) => st.settings.lang);
  const k = useKeyboardShare();
  const [down, setDown] = useState(false);
  const can = !busy && !attaching && !!String(value || '').trim();
  const canAttach = !busy && !attaching;
  const openPad = Platform.OS === 'ios' ? spacing.sm : clearance;
  const bottom = useAnimatedStyle(() => {
    const p = KEYBOARD_NATIVE ? k.frames.progress.value : k.fallback.value;
    return { paddingBottom: clearance + (openPad - clearance) * Math.min(1, Math.max(0, p)) };
  }, [clearance, openPad]);
  return (
    <Animated.View style={[s.compose, bottom]} testID="chat-compose">
      {attachError ? (
        <Text style={s.error} accessibilityLiveRegion="polite" testID="chat-attach-error">{attachErrorText(attachError, lang)}</Text>
      ) : null}
      <PendingFiles items={pending} lang={lang} onRemove={onDetach} />
      <View style={s.row}>
        <View style={s.box} testID="chat-input-box">
          <Field
            ref={ref}
            multiline
            value={value}
            onChangeText={onChangeText}
            editable={editable == null ? !busy : !!editable}
            maxLength={AI_TEXT_MAX}
            placeholder={t(lang, 'ai.placeholder')}
            accessibilityLabel={t(lang, 'ai.placeholder')}
            style={s.input}
            testID="chat-input"
          />
          <Tap
            onPress={() => { if (canAttach && onAttach) onAttach(); }}
            onPressIn={() => setDown(true)}
            onPressOut={() => setDown(false)}
            disabled={!canAttach}
            style={s.clip}
            accessibilityRole="button"
            accessibilityLabel={t(lang, 'ai.attach')}
            accessibilityState={{ disabled: !canAttach, busy: !!attaching }}
            testID="chat-attach"
          >
            <Icon name="paperclip" size={20} color={!canAttach ? colors.textFaint : down ? colors.text : colors.icon} />
          </Tap>
        </View>
        <Tap
          onPress={() => { if (can) onSend(); }}
          disabled={!can}
          style={[s.send, can ? s.sendOn : s.sendOff]}
          accessibilityRole="button"
          accessibilityLabel={t(lang, 'ai.send')}
          accessibilityState={{ disabled: !can }}
          testID="chat-send"
        >
          <Icon name="arrow-up" size={20} color={can ? colors.accentText : colors.textFaint} />
        </Tap>
      </View>
    </Animated.View>
  );
});

export default ChatCompose;

const makeStyles = (colors) => StyleSheet.create({
  compose: { paddingHorizontal: screenPadding, paddingTop: spacing.sm, gap: spacing.xs, backgroundColor: colors.bg },
  error: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 16, paddingHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  box: { flex: 1 },
  input: { minHeight: buttonHeight, maxHeight: COMPOSE_MAX, paddingTop: 13, paddingBottom: 13, paddingLeft: CLIP_W },
  send: { width: buttonHeight, height: buttonHeight, borderRadius: buttonRadius, alignItems: 'center', justifyContent: 'center' },
  // Скрепка — внутри поля, у левого края и у нижней строки (рядом с «Отправить»
  // по вертикали): без подложки и рамки, зона касания во всю её площадь.
  clip: { position: 'absolute', left: 0, bottom: 0, width: CLIP_W, height: buttonHeight, alignItems: 'center', justifyContent: 'center' },
  sendOn: { backgroundColor: colors.accent },
  sendOff: { backgroundColor: colors.panel2 },
});

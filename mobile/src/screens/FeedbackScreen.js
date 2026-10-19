// «Обратная связь» — экран стека из «Меню» (17 октября 2026). Форма одна на
// веб, десктоп и телефон: вид сегментами (Ошибка · Идея · Другое), текст до
// 4000 знаков, строка «Приложить снимок экрана» со скрепкой и «Отправить».
// Снимок — не переключателем (круг 21): нажатие на всю строку открывает выбор
// картинки (галерея, тем же выбором, что фото в редакторе: lib/photoPicker.js),
// выбранная — миниатюрой с крестиком справа в той же строке; повторное нажатие
// меняет картинку, крестик убирает. Платформа, версия, язык и модель уходят
// сами (lib/feedback.js). Гость шлёт без user_id.
//
// Ушло — тост «Спасибо, получили» и «назад». Не ушло — красная строка и
// «Повторить» на месте кнопки; черновик не теряется. С 19 октября 2026
// сначала уходит строка, потом снимок (lib/feedback.js): дошедшая строка
// второй раз не уходит, и если отказала только загрузка, строка говорит, что
// сообщение ушло без снимка, а «Повторить» его догружает. Отказ базы по
// частоте — своя строка (feedback.rate).
import { useMemo, useRef, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field } from '../components/AppTextInput';
import Segmented from '../components/Segmented';
import Tap from '../components/Tap';
import Icon from '../components/Icon';
import PrimaryButton from '../components/PrimaryButton';
import { RowGroup, SettingRow } from '../components/Island';
import { Hint, InfoRow } from '../components/RepeatControls';
import { KeyboardAwareScrollView } from '../lib/keyboard';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { FEEDBACK_KINDS, FEEDBACK_MAX, draft, saveDraft, clearDraft, sendFeedback } from '../lib/feedback';
import { pickPhoto, PHOTO_TOO_BIG, PHOTO_MAX_BYTES } from '../lib/photoPicker';
import { useColors, spacing, screenPadding, radius, gap } from '../theme';
import { t } from '../lib/i18n';

/** Воздух между полем в фокусе и клавиатурой — тот же, что в листах. */
const FIELD_GAP = spacing.md;
/** Сторона миниатюры снимка в строке. */
const THUMB = 36;

export default function FeedbackScreen({ navigation }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets), [colors, insets]);
  const lang = useAppStore((s) => s.settings.lang);
  const showToast = useAppStore((s) => s.showToast);
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const [kind, setKindState] = useState(() => draft().kind);
  const [text, setTextState] = useState(() => draft().text);
  const [shot, setShot] = useState(null);
  const [sending, setSending] = useState(false);
  // Ключ красной строки: feedback.failed, .rate или .shot_failed; null — нет.
  const [failed, setFailed] = useState(null);
  // Прошлая попытка (lib/feedback.js): её строка дошла — повтор только
  // догружает снимок.
  const attempt = useRef(null);

  const setKind = (v) => { setKindState(v); saveDraft({ kind: v }); };
  const setText = (v) => { setTextState(v); saveDraft({ text: v }); };
  // Сменили или убрали снимок, когда строка уже ушла, — это новое
  // сообщение: у прежней строки снимок назван по старому файлу.
  const takeShot = (next) => {
    if (attempt.current && attempt.current.sent) { attempt.current = null; setFailed(null); }
    setShot(next);
  };

  // Передумали выбирать — прежняя картинка (если была) остаётся.
  async function pick() {
    try {
      // Неподвижная картинка: бакет feedback GIF не принимает.
      const photo = await pickPhoto({ still: true });
      if (photo) takeShot(photo);
    } catch (err) {
      if (err && err.code === PHOTO_TOO_BIG) showToast(t(lang, 'editor.photo_too_big', { mb: Math.round(PHOTO_MAX_BYTES / (1024 * 1024)) }));
      else console.error('Не удалось выбрать картинку:', err);
    }
  }

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setFailed(null);
    const res = await sendFeedback({
      kind,
      text,
      lang,
      userId: authStatus === 'signedIn' && user ? user.id : null,
      shot,
      attempt: attempt.current,
    });
    setSending(false);
    attempt.current = res.attempt;
    if (res.ok) {
      attempt.current = null;
      clearDraft();
      showToast(t(lang, 'feedback.sent'));
      if (navigation && navigation.goBack) navigation.goBack();
      return;
    }
    console.error('Отзыв не ушёл:', res.error);
    setFailed(res.stage === 'shot' ? 'feedback.shot_failed' : res.rate ? 'feedback.rate' : 'feedback.failed');
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      bottomOffset={FIELD_GAP}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID="feedback-screen"
    >
      <Segmented
        items={FEEDBACK_KINDS.map((key) => ({ key, label: t(lang, `feedback.kind_${key}`) }))}
        value={kind}
        onChange={setKind}
        testID="feedback-kind"
      />

      <Field
        multiline
        value={text}
        onChangeText={setText}
        maxLength={FEEDBACK_MAX}
        placeholder={t(lang, `feedback.ph_${kind}`)}
        accessibilityLabel={t(lang, 'feedback.text_label')}
        style={styles.text}
        testID="feedback-text"
      />
      <Hint testID="feedback-count">{t(lang, 'feedback.count', { n: text.length, max: FEEDBACK_MAX })}</Hint>

      <RowGroup tone="panel" note={t(lang, 'feedback.attach_hint')} testID="feedback-attach-group">
        <SettingRow
          icon="paperclip"
          label={t(lang, 'feedback.attach')}
          onPress={pick}
          chevron={false}
          right={shot ? (
            <View style={styles.shot} testID="feedback-shot">
              <Image source={{ uri: shot.dataUrl }} style={styles.thumb} accessibilityLabel={shot.name} testID="feedback-thumb" />
              <Tap
                onPress={() => takeShot(null)}
                hitSlop={8}
                style={styles.remove}
                accessibilityRole="button"
                accessibilityLabel={t(lang, 'feedback.shot_remove')}
                testID="feedback-shot-remove"
              >
                <Icon name="x" size={10} color={colors.text} />
              </Tap>
            </View>
          ) : null}
          testID="feedback-attach"
        />
      </RowGroup>

      {failed ? <InfoRow danger icon="danger" text={t(lang, failed)} testID="feedback-error" /> : null}
      <PrimaryButton
        title={t(lang, failed ? 'feedback.retry' : 'feedback.send')}
        onPress={send}
        disabled={!text.trim()}
        loading={sending}
        testID="feedback-send"
      />
      <Hint>{t(lang, 'feedback.meta_hint')}</Hint>
    </KeyboardAwareScrollView>
  );
}

const makeStyles = (colors, insets) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: screenPadding, paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xl, gap },
  // Многострочное поле — общее (Field multiline), здесь только выше: в
  // сообщение об ошибке пишут несколько строк.
  text: { minHeight: 160 },
  // Миниатюра выбранной картинки справа в строке скрепки; крестик — кружок на
  // её правом верхнем углу, как у вложений над полем чата (chat/ChatFiles.js).
  shot: { width: THUMB, height: THUMB },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm, backgroundColor: colors.panel2 },
  remove: {
    position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raise,
  },
});

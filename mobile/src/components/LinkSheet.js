// Ссылка в тексте редактора — нижний лист приложения, а не поле в WebView:
// поле в странице прыгало под клавиатурой (DESIGN.md, «Редактор на
// телефоне»). Редактор просит адрес сообщением link ({ href, needText }) или
// его просит кнопка панели; лист отвечает onSave(href, text). Пустой адрес
// у ссылки, которая уже есть, — «Убрать ссылку».
import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Field } from './AppTextInput';
import PrimaryButton from './PrimaryButton';
import { setSheetFooter, closeSheet, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing } from '../theme';
import { t } from '../lib/i18n';

/** @param href адрес, если курсор уже в ссылке
 *  @param needText выделения нет — нужен и текст ссылки
 *  @param onSave(href, text) — '' снимает ссылку */
export default function LinkSheet({ lang, href = '', needText = false, onSave }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  useSheetHeader(t(lang, 'editor.link_title'));
  const [url, setUrl] = useState(href || '');
  const [text, setText] = useState('');

  function save() {
    onSave(url.trim(), needText ? text.trim() : '');
    closeSheet();
  }
  function remove() {
    onSave('', '');
    closeSheet();
  }

  useEffect(() => {
    setSheetFooter(
      <View style={styles.foot}>
        <PrimaryButton title={t(lang, 'common.save')} onPress={save} disabled={!url.trim()} testID="link-save" />
        {href ? <PrimaryButton title={t(lang, 'editor.link_remove')} variant="ghost" icon="unlink" onPress={remove} testID="link-remove" /> : null}
      </View>,
    );
    return () => setSheetFooter(null);
  }, [url, text]);

  return (
    <View style={styles.content}>
      <Field
        value={url}
        onChangeText={setUrl}
        placeholder="https://"
        accessibilityLabel={t(lang, 'editor.link_url')}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => { if (url.trim()) save(); }}
        testID="link-url"
      />
      {needText ? (
        <Field
          value={text}
          onChangeText={setText}
          placeholder={t(lang, 'editor.link_text')}
          accessibilityLabel={t(lang, 'editor.link_text')}
          testID="link-text"
        />
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  content: { gap: spacing.sm },
  foot: { gap: spacing.sm },
});

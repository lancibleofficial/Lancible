// Вложения в чате с агентом (круг 20, 18 октября 2026), два вида плашек:
//
// - PendingFiles — над полем, пока сообщение не ушло: у фото миниатюра из
//   перекодированного файла в кеше (lib/aiAttach.js — того самого, что уйдёт
//   агенту), у файла — значок, имя и размер; крестик убирает вложение.
//   Плашки — в строку, лишние листаются вбок.
// - SentFiles — над своим сообщением в ленте: «имя · тип · размер», без
//   байтов и без миниатюры (в истории их нет — только карточка).
//
// Подложка — panel2 (ступень над островом поля и сообщения), значки — icon.
import { View, ScrollView, Image, StyleSheet } from 'react-native';
import Text from '../AppText';
import Icon from '../Icon';
import Tap from '../Tap';
import { fileLine, fileSize } from '../../lib/aiAttach';
import { useColors, spacing, radius, fontSize } from '../../theme';
import { t } from '../../lib/i18n';

/** Сторона миниатюры фото над полем. */
export const THUMB = 52;

export function PendingFiles({ items, lang, onRemove }) {
  const colors = useColors();
  const s = makeStyles(colors);
  if (!items || !items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.row} testID="chat-pending">
      {items.map((it) => (
        <View key={it.id} style={it.kind === 'image' ? s.photo : s.file} testID={`chat-pending-${it.id}`}>
          {it.kind === 'image' ? (
            <Image source={{ uri: it.uri }} style={s.thumb} accessibilityLabel={it.name} testID="chat-pending-thumb" />
          ) : (
            <>
              <Icon name="doc" size={18} color={colors.icon} />
              <View style={s.fileMain}>
                <Text style={s.fileName} numberOfLines={1}>{it.name}</Text>
                <Text style={s.fileSize}>{fileSize(it.size, lang)}</Text>
              </View>
            </>
          )}
          <Tap
            onPress={() => onRemove(it.id)}
            hitSlop={8}
            style={s.remove}
            accessibilityRole="button"
            accessibilityLabel={`${t(lang, 'ai.attach_remove')}: ${it.name}`}
            testID="chat-pending-remove"
          >
            <Icon name="x" size={10} color={colors.text} />
          </Tap>
        </View>
      ))}
    </ScrollView>
  );
}

export function SentFiles({ files, lang }) {
  const colors = useColors();
  const s = makeStyles(colors);
  if (!files || !files.length) return null;
  return (
    <View style={s.sent}>
      {files.map((f, i) => (
        <View key={i} style={s.sentPlate} testID="chat-file">
          <Icon name={f.kind === 'image' ? 'image' : 'doc'} size={14} color={colors.icon} />
          <Text style={s.sentText} numberOfLines={1}>{fileLine(f, lang)}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: { gap: spacing.sm, paddingTop: 6, paddingRight: 6 },
  photo: { width: THUMB, height: THUMB },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md, backgroundColor: colors.panel2 },
  file: {
    height: THUMB, maxWidth: 220, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.panel2,
  },
  fileMain: { flexShrink: 1, minWidth: 0 },
  fileName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  fileSize: { color: colors.textFaint, fontSize: fontSize.xs },
  // Крестик — кружок на правом верхнем углу плашки, наполовину снаружи: не
  // заходит ни на миниатюру, ни на имя файла.
  remove: {
    position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel,
  },
  sent: { alignSelf: 'flex-end', alignItems: 'flex-end', gap: 4, maxWidth: '100%' },
  sentPlate: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.panel2,
  },
  sentText: { flexShrink: 1, color: colors.textDim, fontSize: fontSize.xs },
});

import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import TagBadge from './TagBadge';
import TagEditSheet from './TagEditSheet';
import PrimaryButton from './PrimaryButton';
import { useAppStore } from '../store/useAppStore';
import { searchTags, exactMatch, toggleTag, tagsOf } from '../lib/tags';
import { t } from '../lib/i18n';
import { openSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';

/** Пикер тегов — один на оба места, где теги вешают: задача и проект.
 *  Поле ввода служит и поиском, и входом в создание: если набранного имени
 *  нет ни у одного тега, внизу появляется «Создать тег».
 *  @param {string[]} value — выбранные теги
 *  @param {function} onChange — новый набор */
export default function TagPickerSheet({ value, onChange, onDone }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const lang = useAppStore((s) => s.settings.lang);
  const tags = useAppStore((s) => s.tags);
  const [ids, setIds] = useState(value || []);
  const [query, setQuery] = useState('');

  const apply = (next) => { setIds(next); onChange(next); };

  // Лист в приложении один: если пикер открыли поверх другого листа, тот
  // закрылся и сам не вернётся. Вызывающий передаёт onDone и возвращает себя
  // обратно — иначе набранные там поля пропали бы.
  useEffect(() => {
    if (!onDone) return undefined;
    setSheetFooter(<PrimaryButton title={t(lang, 'common.ok')} onPress={() => onDone(ids)} />);
    return () => setSheetFooter(null);
  }, [ids, lang]);

  const found = searchTags(tags, query);
  const typed = query.trim();
  const offerCreate = typed && !exactMatch(tags, typed);
  const picked = tagsOf(tags, ids);

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{t(lang, 'tag.pick')}</Text>

      {picked.length ? (
        <View style={styles.picked}>
          {picked.map((tag) => (
            <TagBadge key={tag.id} tag={tag} onRemove={() => apply(toggleTag(ids, tag.id))} />
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder={t(lang, 'tag.search_ph')}
        placeholderTextColor={colors.textDim}
        autoCorrect={false}
      />

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {found.map((tag) => {
          const on = ids.includes(tag.id);
          return (
            <Pressable key={tag.id} onPress={() => apply(toggleTag(ids, tag.id))} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: tag.color }]} />
              <Text style={styles.rowName} numberOfLines={1}>{tag.name}</Text>
              {on ? <Icon name="check" size={14} color={colors.accent} /> : null}
            </Pressable>
          );
        })}

        {offerCreate ? (
          <Pressable
            style={[styles.row, styles.createRow]}
            onPress={() => openSheet(
              <TagEditSheet presetName={typed} onSaved={(made) => apply([...ids, made.id])} />,
            )}
          >
            <Icon name="plus" size={14} color={colors.textDim} />
            <Text style={styles.createText} numberOfLines={1}>
              {t(lang, 'tag.create_named', { name: typed })}
            </Text>
          </Pressable>
        ) : null}

        {!tags.length && !typed ? <Text style={styles.empty}>{t(lang, 'tag.none')}</Text> : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  picked: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  // Высота ограничена: без неё список тегов растягивал лист на весь экран и
  // прятал поле ввода под клавиатурой.
  list: { maxHeight: 260 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  dot: { width: 10, height: 10, borderRadius: 3 },
  rowName: { flex: 1, color: colors.text, fontSize: fontSize.md },
  createRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, borderRadius: 0, marginTop: spacing.xs },
  createText: { flex: 1, color: colors.textDim, fontSize: fontSize.sm },
  empty: { color: colors.textDim, fontSize: fontSize.sm, padding: spacing.md, lineHeight: 20 },
});

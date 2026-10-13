import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Field } from './AppTextInput';
import ChoiceList from './ChoiceList';
import TagBadge from './TagBadge';
import TagEditSheet from './TagEditSheet';
import PrimaryButton from './PrimaryButton';
import EmptyState from './EmptyState';
import SheetPage, { usePageMotion } from './SheetPage';
import { useAppStore } from '../store/useAppStore';
import { searchTags, exactMatch, toggleTag, tagsOf, tagsForProject, isGlobalTag } from '../lib/tags';
import { t } from '../lib/i18n';
import { closeSheet, setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { spacing } from '../theme';

/** Пикер тегов — один на оба места, где теги вешают: задача и проект.
 *  Поле ввода служит и поиском, и входом в создание: если набранного имени
 *  нет ни у одного видимого тега, внизу появляется «Создать тег».
 *
 *  Видны общие теги и теги проекта (core/tags.js, tagsForProject); тег,
 *  заведённый отсюда с projectId, — проектный. Общий помечен подписью:
 *  у двух тегов с одним именем в разных областях иначе не понять, который
 *  чей.
 *  @param {string[]} value — выбранные теги
 *  @param {string} [projectId] — проект задачи: его теги видны и создаются
 *  @param {function} onChange — новый набор
 *  @param {string} [title] — заголовок листа; по умолчанию «Теги» (у задачи из
 *    списка проекта — «Теги задачи») */
/** @param embedded внутри другого листа: без своего заголовка и низа;
 *  «создать тег» отдаётся наверх (onCreate) — открывать лист поверх нельзя.
 *
 *  Сам по себе (теги задачи и проекта) лист применяет выбор кнопкой
 *  «Сохранить» в закреплённом подвале — как «Дедлайн», «Повторение»,
 *  «Изменить запись» и окно проекта: отметки копятся в листе, крестик и
 *  свайп вниз их отменяют. Кнопка активна всегда — сохранить можно и пустой
 *  набор, и тот же самый. Встроенный (страница окна проекта) отдаёт отметку
 *  сразу: у окна своя «Сохранить», и «назад» не должен терять выбор.
 *
 *  «Создать тег» у самостоятельного листа — страница этого же листа со
 *  стрелкой «назад» (12 октября 2026; раньше — лист тега поверх, и пикер
 *  открывался заново): по сохранении — снова выбор, с прежними отметками и
 *  новым тегом, ещё не сохранёнными. */
export default function TagPickerSheet({ value, projectId, onChange, onDone, embedded, onCreate, title }) {
  const lang = useAppStore((s) => s.settings.lang);
  const tags = useAppStore((s) => s.tags);
  const [ids, setIds] = useState(value || []);
  const [query, setQuery] = useState('');
  // Страница: null — выбор; { presetName } — новый тег.
  const [page, setPage] = useState(null);
  const motion = usePageMotion(page ? 1 : 0);
  useSheetHeader(
    embedded ? null : page ? t(lang, projectId ? 'tag.project_add' : 'tag.dialog_new') : title || t(lang, 'tag.pick'),
    !embedded && page ? () => setPage(null) : null,
  );

  const pick = (next) => { setIds(next); if (embedded) onChange(next); };

  // Лист в приложении один: если пикер открыли поверх другого листа, тот
  // закрылся и сам не вернётся. Вызывающий передаёт onDone и возвращает себя
  // обратно — иначе набранные там поля пропали бы. Без onDone «Сохранить»
  // закрывает лист.
  const latest = useRef(ids);
  latest.current = ids;
  useEffect(() => {
    // У страницы нового тега подвал свой (его ставит TagEditSheet).
    if (embedded || page) return undefined;
    const save = () => {
      onChange(latest.current);
      if (onDone) onDone(latest.current); else closeSheet();
    };
    const footer = <PrimaryButton title={t(lang, 'common.save')} onPress={save} />;
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [lang, page]);

  /** Новый тег из поля поиска: встроенный отдаёт его наверх (onCreate), сам
   *  по себе — открывает страницу нового тега. */
  function createTyped(typed) {
    if (embedded && onCreate) { onCreate(typed, (made) => pick([...ids, made.id])); return; }
    setPage({ presetName: typed });
  }

  if (page) {
    return (
      <SheetPage key="create" motion={motion}>
        <TagEditSheet
          embedded
          presetName={page.presetName}
          projectId={projectId}
          onSaved={(made) => { setIds((cur) => [...cur, made.id]); setQuery(''); }}
          onDone={() => setPage(null)}
        />
      </SheetPage>
    );
  }

  const pool = tagsForProject(tags, projectId);
  const found = searchTags(pool, query);
  const typed = query.trim();
  const offerCreate = typed && !exactMatch(pool, typed);
  const picked = tagsOf(tags, ids);

  return (
    <SheetPage key="pick" motion={motion} style={styles.content} testID={embedded ? 'tag-picker' : undefined}>
      {picked.length ? (
        <View style={styles.picked}>
          {picked.map((tag) => (
            <TagBadge key={tag.id} tag={tag} onRemove={() => pick(toggleTag(ids, tag.id))} />
          ))}
        </View>
      ) : null}

      <Field
        value={query}
        onChangeText={setQuery}
        placeholder={t(lang, 'tag.search_ph')}
        autoCorrect={false}
      />

      <ScrollView style={styles.list} contentContainerStyle={styles.listInner} keyboardShouldPersistTaps="handled">
        {found.length ? (
          <ChoiceList
            multi
            options={found.map((tag) => ({
              value: tag.id,
              label: tag.name,
              color: tag.color,
              note: projectId && isGlobalTag(tag) ? t(lang, 'tag.scope_global') : undefined,
            }))}
            selected={ids}
            onSelect={(id) => pick(toggleTag(ids, id))}
            testID="tag-list"
          />
        ) : null}

        {offerCreate ? (
          <ChoiceList
            options={[{ value: typed, label: t(lang, 'tag.create_named', { name: typed }), icon: 'plus' }]}
            onSelect={createTyped}
            testID="tag-create"
          />
        ) : null}

        {/* Тегов нет вовсе — строка со сценкой: тег заводится из поля выше. */}
        {!pool.length && !typed ? <EmptyState size="row" art="tags" title={t(lang, 'tag.none')} text={t(lang, 'empty.tag_pick_text')} style={styles.empty} /> : null}
      </ScrollView>
    </SheetPage>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  picked: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // Высота ограничена: без неё список тегов растягивал лист на весь экран и
  // прятал поле ввода под клавиатурой.
  list: { maxHeight: 260 },
  listInner: { gap: spacing.sm },
  empty: { paddingHorizontal: spacing.md },
});

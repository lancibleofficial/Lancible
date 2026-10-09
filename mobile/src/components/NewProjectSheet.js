import { useContext, useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated, { SlideInRight, SlideInLeft, Easing } from 'react-native-reanimated';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import Tap from './Tap';
import { useAppStore } from '../store/useAppStore';
import { PALETTE, CURRENCIES } from '../lib/migrate';
import { tagsOf, tagUsage } from '../lib/tags';
import { parseNum, moneyFmt, CURRENCY_SYMBOLS } from '../lib/format';
import TagPickerSheet from './TagPickerSheet';
import TagEditSheet from './TagEditSheet';
import PickerSheet from './PickerSheet';
import VersionsEditor from './VersionsEditor';
import { TagBadgeRow } from './TagBadge';
import { SheetScrollContext } from './BottomSheet';
import { t } from '../lib/i18n';
import PrimaryButton from './PrimaryButton';
import { setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';

// Переход на страницу внутри листа и обратно — сдвиг, ease out.
const PAGE_IN = SlideInRight.duration(240).easing(Easing.out(Easing.cubic));
const FORM_BACK = SlideInLeft.duration(240).easing(Easing.out(Easing.cubic));

/** Окно проекта: все разделы одной формой друг под другом — «Основное»,
 *  «Ставка и валюта», у существующего ещё «Теги», «Версии», «Статусы».
 *  Прокручивается содержимое листа, кнопки внизу стоят на месте.
 *
 *  Выбор тегов, валюты и правка тега — страницами внутри этого же листа со
 *  стрелкой «назад», а не листами поверх: лист в приложении один, и
 *  открытый поверх закрывал собой это окно.
 *
 *  @param {object} [project] — правим существующий.
 *  @param {string} [section] — к какому разделу сразу прокрутить.
 *  @param {object} [initial] — черновик полей.
 *  @param {function} [onOpenStatuses] — экран статусов; лист живёт вне
 *    навигатора, поэтому переход даёт экран. */
export default function NewProjectSheet({ onCreated, onCancel, initial, project, section, onOpenStatuses }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const settings = useAppStore((s) => s.settings);
  const lang = settings.lang;
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const createProject = useAppStore((s) => s.createProject);
  const updateProject = useAppStore((s) => s.updateProject);
  const allTags = useAppStore((s) => s.tags);
  const scroll = useContext(SheetScrollContext);
  const base = initial || project || {};
  const [name, setName] = useState(base.name || '');
  const [description, setDescription] = useState(base.description || '');
  const [color, setColor] = useState(base.color || PALETTE[projects.length % PALETTE.length]);
  const [tagIds, setTagIds] = useState(base.tagIds || []);
  const [rateText, setRateText] = useState(base.rate !== null && base.rate !== undefined ? String(base.rate) : '');
  const [currency, setCurrency] = useState(base.currency || null);
  // Страница внутри листа: null — форма; { kind: 'tags' | 'currency' | 'tagEdit', ... }.
  const [page, setPage] = useState(null);
  const [returned, setReturned] = useState(false);
  const jumped = useRef(false);
  const projectTags = tagsOf(allTags, tagIds);
  const ownTags = project ? allTags.filter((tg) => tg.projectId === project.id) : [];

  const fields = () => ({
    name: name.trim(), description: description.trim(), color, tagIds,
    rate: rateText.trim() === '' ? null : parseNum(rateText),
    currency: currency || null,
  });

  function onSave() {
    if (!name.trim()) { scroll.scrollTo(0); return; }
    if (project) {
      updateProject(project.id, fields());
      onCreated(project);
      return;
    }
    onCreated(createProject(fields()));
  }

  function open(next) { setPage(next); scroll.scrollTo(0); }
  function back() { setPage(null); setReturned(true); scroll.scrollTo(0); }

  function tagUsageLabel(tagId) {
    const u = tagUsage(projects, tasks, tagId);
    const parts = [];
    if (u.projects) parts.push(t(lang, 'tag.used_projects', { n: u.projects }));
    if (u.tasks) parts.push(t(lang, 'tag.used_tasks', { n: u.tasks }));
    return parts.length ? parts.join(' · ') : t(lang, 'tag.unused');
  }

  // Низ листа: у формы — «Создать»/«Сохранить» и «Отмена», у страницы
  // тегов — «Готово»; у валюты и правки тега своего низа нет.
  useEffect(() => {
    if (page && page.kind === 'tags') {
      setSheetFooter(<PrimaryButton title={t(lang, 'common.ok')} onPress={back} />);
    } else if (page) {
      setSheetFooter(null);
    } else {
      setSheetFooter(
        <>
          <PrimaryButton title={t(lang, project ? 'common.save' : 'home.create')} onPress={onSave} disabled={!name.trim()} />
          <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={onCancel} />
        </>,
      );
    }
    return () => setSheetFooter(null);
  }, [page, name, description, color, rateText, currency, tagIds, lang]);

  // Открыли на разделе — прокрутить к нему, как только он встал на место.
  const onSectionLayout = (key) => (e) => {
    if (jumped.current || !section || section === 'main' || key !== section) return;
    jumped.current = true;
    scroll.scrollTo(e.nativeEvent.layout.y);
  };

  const sym = CURRENCY_SYMBOLS[currency || settings.currency] || currency || settings.currency;

  if (page) {
    const title = page.kind === 'tags' ? t(lang, 'tag.pick')
      : page.kind === 'currency' ? t(lang, 'pdlg.currency_label')
        : t(lang, page.tag ? 'tag.dialog_edit' : 'tag.project_add');
    const toTags = page.kind === 'tagEdit' && page.returnTo === 'tags';
    return (
      <Animated.View key={page.kind} entering={PAGE_IN} style={styles.content}>
        <View style={styles.pageHead}>
          <Tap scale={0.9} hitSlop={8} onPress={toTags ? () => setPage({ kind: 'tags' }) : back} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t(lang, 'common.back')}>
            <Icon name="chevron-left" size={16} color={colors.text} />
          </Tap>
          <Text style={styles.pageTitle} numberOfLines={1}>{title}</Text>
        </View>

        {page.kind === 'tags' ? (
          <TagPickerSheet
            embedded
            value={tagIds}
            projectId={project ? project.id : undefined}
            onChange={setTagIds}
            onCreate={(typed) => setPage({ kind: 'tagEdit', presetName: typed, returnTo: 'tags' })}
          />
        ) : null}

        {page.kind === 'currency' ? (
          <PickerSheet
            embedded
            value={currency || ''}
            options={[
              { value: '', label: t(lang, 'pdlg.currency_default', { cur: settings.currency }) },
              ...Object.keys(CURRENCIES).map((code) => ({ value: code, label: `${code} (${CURRENCY_SYMBOLS[code] || code})` })),
            ]}
            onSelect={(code) => { setCurrency(code || null); back(); }}
          />
        ) : null}

        {page.kind === 'tagEdit' ? (
          <TagEditSheet
            embedded
            tag={page.tag}
            presetName={page.presetName}
            projectId={project ? project.id : undefined}
            onSaved={(made) => { if (toTags) setTagIds((ids) => [...ids, made.id]); }}
            onDone={toTags ? () => setPage({ kind: 'tags' }) : back}
          />
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={returned ? FORM_BACK : undefined} style={styles.content}>
      <Text style={styles.title}>{t(lang, project ? 'project.menu_settings' : 'project.new_title')}</Text>

      <View style={styles.section} onLayout={onSectionLayout('main')}>
        <Text style={styles.label}>{t(lang, 'pdlg.name_label')}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={t(lang, 'pdlg.name_ph')}
          placeholderTextColor={colors.textFaint}
        />
        <Text style={styles.label}>{t(lang, 'pdlg.desc_label')}</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder={t(lang, 'pdlg.desc_ph')}
          placeholderTextColor={colors.textFaint}
          multiline
        />
        <Text style={styles.label}>{t(lang, 'pdlg.color_label')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
          {PALETTE.map((c) => (
            <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatchRing, color === c && styles.swatchRingSel]}>
              <View style={[styles.swatch, { backgroundColor: c }]} />
            </Pressable>
          ))}
        </ScrollView>
        <Text style={styles.label}>{t(lang, 'pdlg.marks_label')}</Text>
        <Pressable style={styles.tagsRow} onPress={() => open({ kind: 'tags' })}>
          {projectTags.length
            ? <TagBadgeRow tags={projectTags} />
            : <Text style={styles.tagsEmpty}>{t(lang, 'tag.pick')}</Text>}
          <Icon name="chevron-right" size={12} color={colors.textFaint} />
        </Pressable>
      </View>

      <View style={styles.section} onLayout={onSectionLayout('money')}>
        <Text style={styles.secHead}>{t(lang, 'pdlg.sec_money')}</Text>
        <Text style={styles.label}>{t(lang, 'pdlg.rate_label')}</Text>
        <View style={styles.rateRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={rateText}
            onChangeText={setRateText}
            keyboardType="decimal-pad"
            placeholder={String(settings.hourlyRate || 0)}
            placeholderTextColor={colors.textFaint}
          />
          <Text style={styles.unit}>{sym}{t(lang, 'rate.per_hour')}</Text>
        </View>
        <Text style={styles.hint}>
          {t(lang, 'pdlg.rate_hint', { rate: `${moneyFmt(lang).format(settings.hourlyRate || 0)} ${CURRENCY_SYMBOLS[settings.currency] || settings.currency}` })}
        </Text>
        <Text style={styles.label}>{t(lang, 'pdlg.currency_label')}</Text>
        <Pressable style={styles.pickRow} onPress={() => open({ kind: 'currency' })}>
          <Text style={[styles.pickValue, !currency && styles.pickUnset]}>
            {currency ? `${currency} (${CURRENCY_SYMBOLS[currency] || currency})` : t(lang, 'pdlg.currency_default', { cur: settings.currency })}
          </Text>
          <Icon name="chevron-right" size={12} color={colors.textFaint} />
        </Pressable>
        <Text style={styles.hint}>{t(lang, 'pdlg.currency_hint')}</Text>
      </View>

      {project ? (
        <View style={styles.section} onLayout={onSectionLayout('tags')}>
          <Text style={styles.secHead}>{t(lang, 'pdlg.sec_tags')}</Text>
          {ownTags.length === 0 ? <Text style={styles.hint}>{t(lang, 'tag.project_empty')}</Text> : null}
          {ownTags.map((tag) => (
            <Pressable key={tag.id} style={styles.tagRow} onPress={() => open({ kind: 'tagEdit', tag })}>
              <View style={[styles.dot, { backgroundColor: tag.color }]} />
              <Text style={styles.tagName} numberOfLines={1}>{tag.name}</Text>
              <Text style={styles.tagUsage} numberOfLines={1}>{tagUsageLabel(tag.id)}</Text>
              <Icon name="chevron-right" size={12} color={colors.textFaint} />
            </Pressable>
          ))}
          <Pressable style={styles.tagRow} onPress={() => open({ kind: 'tagEdit' })}>
            <Icon name="plus" size={14} color={colors.textDim} />
            <Text style={styles.tagName}>{t(lang, 'tag.project_add')}</Text>
          </Pressable>
          <Text style={styles.hint}>{t(lang, 'tag.global_hint')}</Text>
        </View>
      ) : null}

      {project ? (
        <View style={styles.section} onLayout={onSectionLayout('versions')}>
          <Text style={styles.secHead}>{t(lang, 'pdlg.sec_versions')}</Text>
          <VersionsEditor projectId={project.id} lang={lang} />
        </View>
      ) : null}

      {project ? (
        <View style={styles.section} onLayout={onSectionLayout('statuses')}>
          <Text style={styles.secHead}>{t(lang, 'pdlg.sec_statuses')}</Text>
          <Text style={styles.hint}>{t(lang, 'pdlg.statuses_hint')}</Text>
          <PrimaryButton
            compact
            variant="ghost"
            icon="settings"
            title={t(lang, 'board.project_statuses')}
            onPress={() => { if (onOpenStatuses) onOpenStatuses(); }}
          />
        </View>
      ) : (
        <Text style={styles.hint}>{t(lang, 'pdlg.create_first')}</Text>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  title: { color: colors.text, ...typography.title },
  // Заголовок раздела в общей форме.
  secHead: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: spacing.md },
  pageHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { flex: 1, color: colors.text, ...typography.title },
  section: { gap: spacing.sm },
  label: { color: colors.textDim, fontSize: fontSize.xs, marginTop: spacing.xs },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.text, fontSize: fontSize.md,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unit: { color: colors.textDim, fontSize: fontSize.sm },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.inputBg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  pickValue: { flex: 1, color: colors.text, fontSize: fontSize.md },
  pickUnset: { color: colors.textDim },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  tagsEmpty: { flex: 1, color: colors.textDim, fontSize: fontSize.sm },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, minHeight: 44 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  tagName: { flex: 1, color: colors.text, fontSize: fontSize.md },
  tagUsage: { color: colors.textFaint, fontSize: fontSize.xs, maxWidth: 130 },
  swatchRow: { flexDirection: 'row', gap: spacing.xs / 2, paddingVertical: spacing.xs, paddingRight: spacing.md },
  swatchRing: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  swatchRingSel: { backgroundColor: colors.bg },
  swatch: { width: 32, height: 32, borderRadius: radius.sm },
});

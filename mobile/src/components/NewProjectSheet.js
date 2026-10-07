import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import Text from './AppText';
import TextInput from './AppTextInput';
import Icon from './Icon';
import { useAppStore } from '../store/useAppStore';
import { PALETTE, CURRENCIES } from '../lib/migrate';
import { tagsOf, tagUsage } from '../lib/tags';
import { parseNum, moneyFmt, CURRENCY_SYMBOLS } from '../lib/format';
import TagPickerSheet from './TagPickerSheet';
import TagEditSheet from './TagEditSheet';
import PickerSheet from './PickerSheet';
import VersionsEditor from './VersionsEditor';
import { TagBadgeRow } from './TagBadge';
import { t } from '../lib/i18n';
import PrimaryButton from './PrimaryButton';
import { openSheet, setSheetFooter } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize, typography } from '../theme';

const SECTIONS = ['main', 'money', 'tags', 'versions', 'statuses'];

/** Окно проекта с разделами — как на вебе: «Основное», «Ставка и валюта»,
 *  «Теги», «Версии», «Статусы». У нового проекта — только первые два.
 *
 *  @param {object} [project] — правим существующий.
 *  @param {string} [section] — с какого раздела открыть.
 *  @param {object} [initial] — черновик полей (см. onOpenTags).
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
  // Черновик перебивает сохранённое: он приходит, когда лист открывают
  // заново после выбора тегов, и набранное к этому моменту дороже.
  const base = initial || project || {};
  const [sec, setSec] = useState(section && SECTIONS.includes(section) ? section : 'main');
  const [name, setName] = useState(base.name || '');
  const [description, setDescription] = useState(base.description || '');
  const [color, setColor] = useState(base.color || PALETTE[projects.length % PALETTE.length]);
  const [tagIds, setTagIds] = useState(base.tagIds || []);
  const [rateText, setRateText] = useState(base.rate !== null && base.rate !== undefined ? String(base.rate) : '');
  const [currency, setCurrency] = useState(base.currency || null);
  const projectTags = tagsOf(allTags, tagIds);
  const ownTags = project ? allTags.filter((tg) => tg.projectId === project.id) : [];

  const fields = () => ({
    name: name.trim(), description: description.trim(), color, tagIds,
    rate: rateText.trim() === '' ? null : parseNum(rateText),
    currency: currency || null,
  });

  function onSave() {
    if (!name.trim()) { setSec('main'); return; }
    if (project) {
      updateProject(project.id, fields());
      onCreated(project);
      return;
    }
    onCreated(createProject(fields()));
  }

  // Лист в приложении один, поэтому пикер закрывает собой это окно. Чтобы
  // набранные поля не пропали, по «Готово» открываем себя же заново с теми
  // же полями и новым набором.
  const reopen = (patch, nextSec) => openSheet(
    <NewProjectSheet
      project={project}
      section={nextSec || sec}
      initial={{ ...fields(), name, description, ...patch }}
      onCreated={onCreated}
      onCancel={onCancel}
      onOpenStatuses={onOpenStatuses}
    />,
  );

  function onOpenMarks() {
    openSheet(
      <TagPickerSheet
        value={tagIds}
        projectId={project ? project.id : undefined}
        onChange={() => {}}
        onDone={(ids) => reopen({ tagIds: ids })}
      />,
    );
  }

  function onPickCurrency() {
    openSheet(
      <PickerSheet
        title={t(lang, 'pdlg.currency_label')}
        value={currency || ''}
        options={[
          { value: '', label: t(lang, 'pdlg.currency_default', { cur: settings.currency }) },
          ...Object.keys(CURRENCIES).map((code) => ({ value: code, label: `${code} (${CURRENCY_SYMBOLS[code] || code})` })),
        ]}
        onSelect={(code) => reopen({ currency: code || null }, 'money')}
      />,
    );
  }

  function onEditTag(tag) {
    openSheet(<TagEditSheet tag={tag} projectId={project.id} onSaved={() => reopen({}, 'tags')} />);
  }

  function tagUsageLabel(tagId) {
    const u = tagUsage(projects, tasks, tagId);
    const parts = [];
    if (u.projects) parts.push(t(lang, 'tag.used_projects', { n: u.projects }));
    if (u.tasks) parts.push(t(lang, 'tag.used_tasks', { n: u.tasks }));
    return parts.length ? parts.join(' · ') : t(lang, 'tag.unused');
  }

  useEffect(() => {
    setSheetFooter(
      <>
        <PrimaryButton title={t(lang, project ? 'common.save' : 'home.create')} onPress={onSave} disabled={!name.trim()} />
        <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={onCancel} />
      </>,
    );
    return () => setSheetFooter(null);
  }, [name, description, color, rateText, currency, tagIds, lang]);

  const sections = project ? SECTIONS : ['main', 'money'];
  const sym = CURRENCY_SYMBOLS[currency || settings.currency] || currency || settings.currency;

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{t(lang, project ? 'project.menu_settings' : 'project.new_title')}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.secRow}>
        {sections.map((key) => (
          <Pressable key={key} onPress={() => setSec(key)} style={[styles.secTab, sec === key && styles.secTabOn]}>
            <Text style={[styles.secText, sec === key && styles.secTextOn]}>{t(lang, `pdlg.sec_${key}`)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {sec === 'main' ? (
        <View style={styles.section}>
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
          <Pressable style={styles.tagsRow} onPress={onOpenMarks}>
            {projectTags.length
              ? <TagBadgeRow tags={projectTags} />
              : <Text style={styles.tagsEmpty}>{t(lang, 'tag.pick')}</Text>}
            <Icon name="chevron-right" size={12} color={colors.textFaint} />
          </Pressable>
          {!project ? <Text style={styles.hint}>{t(lang, 'pdlg.create_first')}</Text> : null}
        </View>
      ) : null}

      {sec === 'money' ? (
        <View style={styles.section}>
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
          <Pressable style={styles.pickRow} onPress={onPickCurrency}>
            <Text style={[styles.pickValue, !currency && styles.pickUnset]}>
              {currency ? `${currency} (${CURRENCY_SYMBOLS[currency] || currency})` : t(lang, 'pdlg.currency_default', { cur: settings.currency })}
            </Text>
            <Icon name="chevron-down" size={12} color={colors.textFaint} />
          </Pressable>
          <Text style={styles.hint}>{t(lang, 'pdlg.currency_hint')}</Text>
        </View>
      ) : null}

      {sec === 'tags' && project ? (
        <View style={styles.section}>
          {ownTags.length === 0 ? <Text style={styles.hint}>{t(lang, 'tag.project_empty')}</Text> : null}
          {ownTags.map((tag) => (
            <Pressable key={tag.id} style={styles.tagRow} onPress={() => onEditTag(tag)}>
              <View style={[styles.dot, { backgroundColor: tag.color }]} />
              <Text style={styles.tagName} numberOfLines={1}>{tag.name}</Text>
              <Text style={styles.tagUsage} numberOfLines={1}>{tagUsageLabel(tag.id)}</Text>
              <Icon name="chevron-right" size={12} color={colors.textFaint} />
            </Pressable>
          ))}
          <Pressable style={styles.tagRow} onPress={() => openSheet(<TagEditSheet projectId={project.id} onSaved={() => reopen({}, 'tags')} />)}>
            <Icon name="plus" size={14} color={colors.textDim} />
            <Text style={styles.tagName}>{t(lang, 'tag.project_add')}</Text>
          </Pressable>
          <Text style={styles.hint}>{t(lang, 'tag.global_hint')}</Text>
        </View>
      ) : null}

      {sec === 'versions' && project ? <VersionsEditor projectId={project.id} lang={lang} /> : null}

      {sec === 'statuses' && project ? (
        <View style={styles.section}>
          <Text style={styles.hint}>{t(lang, 'pdlg.statuses_hint')}</Text>
          <PrimaryButton
            compact
            variant="ghost"
            icon="settings"
            title={t(lang, 'board.project_statuses')}
            onPress={() => { if (onOpenStatuses) onOpenStatuses(); }}
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  title: { color: colors.text, ...typography.title },
  secRow: { flexDirection: 'row', gap: 4, backgroundColor: colors.panel2, borderRadius: radius.md, padding: 3 },
  secTab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  secTabOn: { backgroundColor: colors.tabActiveBg },
  secText: { color: colors.textDim, fontSize: fontSize.sm, fontWeight: '600' },
  secTextOn: { color: colors.text },
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

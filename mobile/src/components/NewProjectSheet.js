import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Text from './AppText';
import { Field } from './AppTextInput';
import Island, { SettingRow, RowGroup } from './Island';
import { useAppStore } from '../store/useAppStore';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { PALETTE, CURRENCIES } from '../lib/migrate';
import { tagsOf, tagUsage } from '../lib/tags';
import { parseNum, moneyFmt, fmtMoney, CURRENCY_SYMBOLS } from '../lib/format';
import { orderedStatuses } from '../lib/statuses';
import Versions from '../core/versions.js';
import TagPickerSheet from './TagPickerSheet';
import TagEditSheet from './TagEditSheet';
import PickerSheet from './PickerSheet';
import ColorPickerSheet from './ColorPickerSheet';
import VersionsEditor from './VersionsEditor';
import TagBadge from './TagBadge';
import { SheetScrollContext, PAGE_IN_FWD, PAGE_IN_BACK, PAGE_OUT } from './BottomSheet';
import { t } from '../lib/i18n';
import PrimaryButton from './PrimaryButton';
import EmptyState from './EmptyState';
import { Block, Hint } from './RepeatControls';
import { setSheetFooter, clearSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { useColors, spacing, radius, fontSize } from '../theme';

// Переход между страницами внутри листа идёт в сторону навигации: вперёд новая
// страница въезжает справа, назад — слева, проявляясь; прежняя гаснет. Высоту
// листа под новую ведёт сам BottomSheet (useEasedHeight), там же и сами
// переходы (PAGE_IN_FWD, PAGE_IN_BACK, PAGE_OUT) — одни на все листы со
// страницами. «Уменьшение движения» — без хода: страницы меняются сразу.

/** Раздел, с которого открыть настройки проекта (проп section), → страница.
 *  'main', 'statuses' (это экран, а не страница) и пусто — список строк. */
const SECTION_PAGE = {
  name: 'name', color: 'color', marks: 'marks', money: 'rate', rate: 'rate',
  currency: 'currency', versions: 'versions', tags: 'ownTags',
};

/** Окно проекта — два вида по трём правилам настроек телефона (DESIGN.md,
 *  «Настройки на телефоне: одна логика»).
 *
 *  Новый проект (без project) — как настройки, только с полем названия сверху
 *  и подвалом (12 октября 2026): крупное поле «Название» с фокусом, под ним
 *  строки «Проект» (цвет, описание, метки) и «Деньги» (ставка, валюта); каждая
 *  открывает свою страницу этого же листа и пишет в черновик; внизу «Создать
 *  проект» и «Отмена».
 *
 *  Настройки проекта (с project) — короткий список строк «название · значение
 *  ›» тремя группами: «Проект» (название и описание, цвет, метки), «Деньги»
 *  (ставка, валюта), «Устройство проекта» (статусы, версии, теги проекта).
 *  Каждая строка открывает свою страницу этого же листа; статусы — свой экран
 *  (ProjectStatusesScreen). Подвала у списка нет: выбор на странице
 *  сохраняется сразу, у полей названия и ставки — своя «Сохранить».
 *
 *  Страницы — внутри этого же листа со стрелкой «назад», а не листами
 *  поверх: лист в приложении один, и открытый поверх закрывал собой это окно.
 *
 *  @param {object} [project] — правим существующий.
 *  @param {string} [section] — сразу открыть страницу (SECTION_PAGE).
 *  @param {object} [initial] — черновик полей нового проекта.
 *  @param {function} [onOpenStatuses] — экран статусов; лист живёт вне
 *    навигатора, поэтому переход даёт экран. */
export default function NewProjectSheet({ onCreated, onCancel, initial, project, section, onOpenStatuses }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const settings = useAppStore((s) => s.settings);
  const lang = settings.lang;
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const statuses = useAppStore((s) => s.statuses);
  const versions = useAppStore((s) => s.versions);
  const createProject = useAppStore((s) => s.createProject);
  const updateProject = useAppStore((s) => s.updateProject);
  const allTags = useAppStore((s) => s.tags);
  const scroll = useContext(SheetScrollContext);
  // Поле названия берёт фокус только при открытии листа: форма монтируется
  // заново и после каждой страницы («назад» с «Цвета»), и клавиатура
  // выскакивала бы на каждом возврате.
  const focusName = useRef(true);
  useEffect(() => { focusName.current = false; }, []);
  const editing = !!project;
  // Правим живой проект из стора, а не снимок из пропа: значения строк должны
  // меняться сразу, как только страница их сохранила.
  const live = editing ? projects.find((p) => p.id === project.id) || project : null;
  const base = initial || project || {};
  const [name, setName] = useState(base.name || '');
  const [description, setDescription] = useState(base.description || '');
  const [color, setColor] = useState(base.color || PALETTE[projects.length % PALETTE.length]);
  const [tagIds, setTagIds] = useState(base.tagIds || []);
  const [rateText, setRateText] = useState(base.rate !== null && base.rate !== undefined ? String(base.rate) : '');
  const [currency, setCurrency] = useState(base.currency || null);
  // Страница внутри листа: null — форма или список строк;
  // { kind: 'name' | 'color' | 'marks' | 'rate' | 'currency' | 'versions' | 'ownTags' | 'tagEdit', ... }.
  const [page, setPage] = useState(() => (editing && SECTION_PAGE[section] ? { kind: SECTION_PAGE[section] } : null));
  const marks = tagsOf(allTags, editing ? live.tagIds || [] : tagIds);
  const ownTags = editing ? allTags.filter((tg) => tg.projectId === project.id) : [];

  const fields = () => ({
    name: name.trim(), description: description.trim(), color, tagIds,
    rate: rateText.trim() === '' ? null : parseNum(rateText),
    currency: currency || null,
  });

  function onCreate() {
    if (!name.trim()) { scroll.scrollTo(0); return; }
    onCreated(createProject(fields()));
  }

  /** Открыть страницу. Поля названия и ставки берут живое значение: правка,
   *  ушедшая «назад» без «Сохранить», не должна остаться в поле. */
  function open(next) {
    if (editing && next.kind === 'name') { setName(live.name || ''); setDescription(live.description || ''); }
    if (editing && next.kind === 'rate') setRateText(live.rate !== null && live.rate !== undefined ? String(live.rate) : '');
    setPage(next);
    scroll.scrollTo(0);
  }
  function back() { setPage(null); scroll.scrollTo(0); }
  const save = (patch) => { updateProject(live.id, patch); back(); };

  // Правка тега, открытая из выбора меток или из тегов проекта, возвращается туда же.
  const returnTo = page && page.kind === 'tagEdit' ? page.returnTo : null;
  const toReturn = () => setPage({ kind: returnTo });

  // Заголовок и стрелка «назад» — в общую закреплённую шапку листа: у формы и
  // списка стрелки нет, у страницы она ведёт к ним (или к выбору меток и тегам
  // проекта, если правку тега открыли оттуда). Заголовок списка — название
  // проекта, у страницы — название настройки, как в строке.
  const PAGE_TITLE = {
    name: 'pdlg.name_desc', desc: 'pdlg.desc_label', color: 'pdlg.color_label', marks: 'pdlg.marks_label', rate: 'pdlg.rate_label',
    currency: 'pdlg.currency_label', versions: 'pdlg.sec_versions', ownTags: 'pdlg.sec_tags',
  };
  const headTitle = !page ? (editing ? live.name || t(lang, 'project.menu_settings') : t(lang, 'project.new_title'))
    : page.kind === 'tagEdit' ? t(lang, page.tag ? 'tag.dialog_edit' : 'tag.project_add')
      : t(lang, PAGE_TITLE[page.kind]);
  useSheetHeader(headTitle, page ? (returnTo ? toReturn : back) : null);

  // Глубина страницы: форма и список 0, страницы 1, правка тега из выбора
  // меток или тегов проекта 2. Глубже прежней — идём вперёд (новая въезжает
  // справа), мельче — назад (слева).
  const depth = !page ? 0 : returnTo ? 2 : 1;
  const prevDepth = useRef(depth);
  const reduced = useReduceMotion();
  useEffect(() => { prevDepth.current = depth; }, [depth]);
  const enter = reduced || depth === prevDepth.current ? undefined : depth > prevDepth.current ? PAGE_IN_FWD : PAGE_IN_BACK;
  const leave = reduced ? undefined : PAGE_OUT;

  function tagUsageLabel(tagId) {
    const u = tagUsage(projects, tasks, tagId);
    const parts = [];
    if (u.projects) parts.push(t(lang, 'tag.used_projects', { n: u.projects }));
    if (u.tasks) parts.push(t(lang, 'tag.used_tasks', { n: u.tasks }));
    return parts.length ? parts.join(' · ') : t(lang, 'tag.unused');
  }

  // Низ листа: у формы нового — «Создать проект» и «Отмена»; у названия и
  // ставки проекта — «Сохранить»; у описания и ставки нового — «Готово»; у
  // выбора меток — «ОК». У правки тега подвал свой (его ставит TagEditSheet).
  // У списка строк и у страниц, где выбор сохраняется сразу, своего низа нет.
  useLayoutEffect(() => {
    if (page && page.kind === 'tagEdit') return undefined;
    let footer = null;
    if (page && page.kind === 'marks') {
      footer = <PrimaryButton title={t(lang, 'common.ok')} onPress={back} />;
    } else if (page && page.kind === 'name' && editing) {
      footer = <PrimaryButton title={t(lang, 'common.save')} onPress={() => save({ name: name.trim(), description: description.trim() })} disabled={!name.trim()} />;
    } else if (page && page.kind === 'rate' && editing) {
      footer = <PrimaryButton title={t(lang, 'common.save')} onPress={() => save({ rate: rateText.trim() === '' ? null : parseNum(rateText) })} />;
    } else if (page && (page.kind === 'desc' || page.kind === 'rate')) {
      footer = <PrimaryButton title={t(lang, 'common.done')} onPress={back} />;
    } else if (!page && !editing) {
      footer = (
        <>
          <PrimaryButton title={t(lang, 'home.create')} onPress={onCreate} disabled={!name.trim()} />
          <PrimaryButton title={t(lang, 'common.cancel')} variant="ghost" onPress={onCancel} />
        </>
      );
    }
    setSheetFooter(footer);
    return () => clearSheetFooter(footer);
  }, [page, name, description, color, rateText, currency, tagIds, lang, editing]);

  const mainCur = settings.currency;
  const curOf = (code) => `${code} (${CURRENCY_SYMBOLS[code] || code})`;
  const effCur = (editing ? live.currency : currency) || mainCur;
  const sym = CURRENCY_SYMBOLS[effCur] || effCur;
  const perHour = (n) => `${fmtMoney(n, lang, effCur)}${t(lang, 'rate.per_hour')}`;

  // Поле ставки — одно на страницу нового проекта и настроек.
  const rateField = (
    <>
      <View style={styles.rateRow}>
        <Field
          style={{ flex: 1 }}
          value={rateText}
          onChangeText={setRateText}
          keyboardType="decimal-pad"
          placeholder={String(settings.hourlyRate || 0)}
          accessibilityLabel={t(lang, 'pdlg.rate_label')}
          autoFocus={!editing}
          testID="project-form-rate"
        />
        <Text style={styles.unit}>{sym}{t(lang, 'rate.per_hour')}</Text>
      </View>
      <Hint>
        {t(lang, 'pdlg.rate_hint', { rate: `${moneyFmt(lang).format(settings.hourlyRate || 0)} ${CURRENCY_SYMBOLS[mainCur] || mainCur}` })}
      </Hint>
    </>
  );
  const nameField = (
    <Block label={t(lang, 'pdlg.name_label')}>
      <Field value={name} onChangeText={setName} placeholder={t(lang, 'pdlg.name_ph')} testID="project-form-name" />
    </Block>
  );
  const descField = (
    <Block label={t(lang, 'pdlg.desc_label')}>
      <Field value={description} onChangeText={setDescription} placeholder={t(lang, 'pdlg.desc_ph')} multiline testID="project-form-desc" />
    </Block>
  );
  const marksPicker = (
    <TagPickerSheet
      embedded
      value={editing ? live.tagIds || [] : tagIds}
      projectId={editing ? project.id : undefined}
      onChange={editing ? (ids) => updateProject(live.id, { tagIds: ids }) : setTagIds}
      onCreate={(typed) => setPage({ kind: 'tagEdit', presetName: typed, returnTo: 'marks' })}
    />
  );

  if (page) {
    return (
      <Animated.View key={page.kind} entering={enter} exiting={leave} style={styles.content} testID="sheet-page">
        {page.kind === 'name' ? <>{nameField}{descField}</> : null}

        {page.kind === 'desc' ? (
          <Field value={description} onChangeText={setDescription} placeholder={t(lang, 'pdlg.desc_ph')} multiline autoFocus accessibilityLabel={t(lang, 'pdlg.desc_label')} testID="project-form-desc" />
        ) : null}

        {page.kind === 'color' ? (
          <ColorPickerSheet
            embedded
            value={editing ? live.color : color}
            onSelect={(c) => { if (editing) { save({ color: c }); return; } setColor(c); back(); }}
          />
        ) : null}

        {page.kind === 'marks' ? marksPicker : null}

        {page.kind === 'rate' ? rateField : null}

        {page.kind === 'currency' ? (
          <>
            <PickerSheet
              embedded
              value={(editing ? live.currency : currency) || ''}
              options={[
                { value: '', label: t(lang, 'pdlg.currency_default', { cur: mainCur }) },
                ...Object.keys(CURRENCIES).map((code) => ({ value: code, label: curOf(code) })),
              ]}
              onSelect={(code) => {
                if (editing) { save({ currency: code || null }); return; }
                setCurrency(code || null);
                back();
              }}
            />
            <Hint>{t(lang, 'pdlg.currency_hint')}</Hint>
          </>
        ) : null}

        {page.kind === 'versions' ? <VersionsEditor projectId={project.id} lang={lang} /> : null}

        {page.kind === 'ownTags' ? (
          <>
            {/* Своих тегов нет — строка со сценкой; «Новый тег проекта» под ней. */}
            {ownTags.length === 0 ? <EmptyState size="row" art="tags" title={t(lang, 'tag.project_empty')} text={t(lang, 'empty.project_tags_text')} /> : null}
            <Island tone="inset" padded={false} testID="project-own-tags">
              {ownTags.map((tag, i) => (
                <SettingRow
                  key={tag.id}
                  first={i === 0}
                  lead={<View style={[styles.dot, { backgroundColor: tag.color }]} />}
                  label={tag.name}
                  value={tagUsageLabel(tag.id)}
                  onPress={() => setPage({ kind: 'tagEdit', tag, returnTo: 'ownTags' })}
                  testID={`project-own-tag-${tag.id}`}
                />
              ))}
              <SettingRow
                first={!ownTags.length}
                icon="plus"
                label={t(lang, 'tag.project_add')}
                chevron={false}
                onPress={() => setPage({ kind: 'tagEdit', returnTo: 'ownTags' })}
                testID="project-own-tag-add"
              />
            </Island>
            <Hint>{t(lang, 'tag.global_hint')}</Hint>
          </>
        ) : null}

        {page.kind === 'tagEdit' ? (
          <TagEditSheet
            embedded
            tag={page.tag}
            presetName={page.presetName}
            projectId={editing ? project.id : undefined}
            onSaved={(made) => {
              if (returnTo !== 'marks' || !made) return;
              if (editing) updateProject(live.id, { tagIds: [...(live.tagIds || []), made.id] });
              else setTagIds((ids) => [...ids, made.id]);
            }}
            onDone={returnTo ? toReturn : back}
          />
        ) : null}
      </Animated.View>
    );
  }

  // Значения строк — словами, одни на настройки и новый проект: метки —
  // первая плашкой и «+N», ставка — своя или общая, валюта — своя или «как в
  // настройках».
  const marksValue = marks.length ? (
    <View style={styles.marksValue} testID="project-row-marks-value">
      <TagBadge tag={marks[0]} />
      {marks.length > 1 ? <Text style={styles.more}>+{marks.length - 1}</Text> : null}
    </View>
  ) : t(lang, 'common.none_value');
  const rateValue = (rate) => (rate !== null && rate !== undefined && rate !== '' && Number.isFinite(Number(rate))
    ? perHour(Number(rate))
    : settings.hourlyRate ? t(lang, 'rate.shared', { rate: perHour(settings.hourlyRate) }) : t(lang, 'rate.none'));
  const currencyValue = (code) => (code ? curOf(code) : t(lang, 'pdlg.currency_inherit', { cur: mainCur }));

  if (editing) {
    // Список строк: значение каждой — словами, тап — её страница.
    const count = (n) => (n ? String(n) : t(lang, 'common.none_value'));
    return (
      <Animated.View key="list" entering={enter} exiting={leave} style={styles.content} testID="sheet-page">
        <RowGroup label={t(lang, 'pdlg.sec_project')} testID="project-group-project">
          <SettingRow icon="pen" label={t(lang, 'pdlg.name_desc')} value={live.name} onPress={() => open({ kind: 'name' })} testID="project-row-name" />
          <SettingRow
            icon="palette"
            label={t(lang, 'pdlg.color_label')}
            value={<View style={[styles.swatchMini, { backgroundColor: live.color }]} testID="project-row-color-value" />}
            onPress={() => open({ kind: 'color' })}
            testID="project-row-color"
          />
          <SettingRow icon="tag" label={t(lang, 'pdlg.marks_label')} value={marksValue} onPress={() => open({ kind: 'marks' })} testID="project-row-marks" />
        </RowGroup>

        <RowGroup label={t(lang, 'pdlg.sec_money')} testID="project-group-money">
          <SettingRow
            icon="wallet"
            label={t(lang, 'pdlg.rate_row')}
            value={rateValue(live.rate)}
            onPress={() => open({ kind: 'rate' })}
            testID="project-row-rate"
            valueTestID="project-row-rate-value"
          />
          <SettingRow
            icon="currency"
            label={t(lang, 'pdlg.currency_row')}
            value={currencyValue(live.currency)}
            onPress={() => open({ kind: 'currency' })}
            testID="project-row-currency"
            valueTestID="project-row-currency-value"
          />
        </RowGroup>

        <RowGroup label={t(lang, 'pdlg.sec_setup')} testID="project-group-setup">
          <SettingRow
            icon="board"
            label={t(lang, 'pdlg.sec_statuses')}
            value={count(orderedStatuses(statuses, project.id).length)}
            onPress={() => { if (onOpenStatuses) onOpenStatuses(); }}
            testID="project-row-statuses"
            valueTestID="project-row-statuses-value"
          />
          <SettingRow
            icon="layers"
            label={t(lang, 'pdlg.sec_versions')}
            value={count(Versions.versionsOf(versions, project.id).length)}
            onPress={() => open({ kind: 'versions' })}
            testID="project-row-versions"
            valueTestID="project-row-versions-value"
          />
          <SettingRow
            icon="list"
            label={t(lang, 'pdlg.sec_tags')}
            value={count(ownTags.length)}
            onPress={() => open({ kind: 'ownTags' })}
            testID="project-row-tags"
            valueTestID="project-row-tags-value"
          />
        </RowGroup>
      </Animated.View>
    );
  }

  // Новый проект: крупное поле названия и строки, как в настройках.
  const draftRate = rateText.trim() === '' ? null : parseNum(rateText);
  return (
    <Animated.View key="form" entering={enter} exiting={leave} style={styles.content} testID="sheet-page">
      <Field
        big
        value={name}
        onChangeText={setName}
        placeholder={t(lang, 'pdlg.name_ph')}
        accessibilityLabel={t(lang, 'pdlg.name_label')}
        autoFocus={focusName.current}
        testID="project-form-name"
      />

      <RowGroup label={t(lang, 'pdlg.sec_project')} testID="project-form-group-project">
        <SettingRow
          icon="palette"
          label={t(lang, 'pdlg.color_label')}
          value={<View style={[styles.swatchMini, { backgroundColor: color }]} testID="project-row-color-value" />}
          onPress={() => open({ kind: 'color' })}
          testID="project-row-color"
        />
        <SettingRow
          icon="pen"
          label={t(lang, 'pdlg.desc_label')}
          value={description.trim() || t(lang, 'common.none_value')}
          onPress={() => open({ kind: 'desc' })}
          testID="project-row-desc"
          valueTestID="project-row-desc-value"
        />
        <SettingRow icon="tag" label={t(lang, 'pdlg.marks_label')} value={marksValue} onPress={() => open({ kind: 'marks' })} testID="project-row-marks" />
      </RowGroup>

      <RowGroup label={t(lang, 'pdlg.sec_money')} testID="project-form-group-money">
        <SettingRow
          icon="wallet"
          label={t(lang, 'pdlg.rate_row')}
          value={rateValue(draftRate)}
          onPress={() => open({ kind: 'rate' })}
          testID="project-row-rate"
          valueTestID="project-row-rate-value"
        />
        <SettingRow
          icon="currency"
          label={t(lang, 'pdlg.currency_row')}
          value={currencyValue(currency)}
          onPress={() => open({ kind: 'currency' })}
          testID="project-row-currency"
          valueTestID="project-row-currency-value"
        />
      </RowGroup>
    </Animated.View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  content: { gap: spacing.md },
  // Поля — общие (Field из AppTextInput): своего вида у формы нет.
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unit: { color: colors.textDim, fontSize: fontSize.sm },
  // Значения строк: метки — первая плашкой и «+N»; цвет — кружок цвета.
  marksValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1, minWidth: 0 },
  more: { color: colors.textFaint, fontSize: 13 },
  swatchMini: { width: 18, height: 18, borderRadius: radius.pill },
  dot: { width: 10, height: 10, borderRadius: 3 },
});

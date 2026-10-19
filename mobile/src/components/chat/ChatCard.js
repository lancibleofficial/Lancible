// Карточка предложения агента — та же, что .ai-card на вебе: заголовок
// (summary), строки операций из ядра (Core.aiProposalRows: значок «создать»,
// «изменить» или «уже есть», что и название, подстрока — проект · статус ·
// версия · теги · дедлайн · время работы · повтор), ошибки проверки
// (Core.aiValidate) и решение: «Применить» / «Отклонить»; решённая —
// «Применено изменений: 2 · Отменить» (отменить — только у последней
// применённой), «Отклонено», «Изменения отменены». Созданное и изменённое у
// применённой — ссылками: касание открывает задачу или проект.
//
// Пересечения (18 октября 2026): задачи можно ставить на любое время, и
// друг на друга тоже. Отрезки предложения, которые ложатся на уже занятое
// время или друг на друга (Core.aiSlotConflicts), подписаны под своей
// строкой — «пересекается с «X» 10:00–11:00», — а «Применить» при них
// сначала спрашивает общим листом подтверждения: «В это время уже есть
// задачи: … Поставить в то же время?» («Поставить» / «Отмена»).
//
// Остров — panel на земле экрана, кнопки — общие PrimaryButton малого
// размера (тихая на острове — своей ступенью panel2).
import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from '../AppText';
import Icon from '../Icon';
import Tap from '../Tap';
import PrimaryButton from '../PrimaryButton';
import Ai from '../../core/ai.js';
import { useAppStore, getTask, getProject } from '../../store/useAppStore';
import { fmtDateShort, capFirst } from '../../lib/format';
import { hm } from '../../lib/sessions';
import { slotsSummary } from '../../lib/slotText';
import { statusName } from '../../lib/aiChat';
import { confirmSheet } from '../../lib/dialogs';
import { useColors, spacing, radius, fontSize } from '../../theme';
import { t } from '../../lib/i18n';

const WEEKDAY_KEY = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];

/** Дата подстроки: «17 окт.», а если время не полночь — «17 окт., 18:00». */
function when(iso, lang) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso);
  const time = hm(ms);
  return time === '00:00' ? fmtDateShort(iso, lang) : `${fmtDateShort(iso, lang)}, ${time}`;
}

/** Повтор словами — описание ядра ({key, vars} от describeRepeat). */
function repeatWords(desc, lang) {
  if (!desc || !desc.key) return '';
  const vars = desc.vars || {};
  return capFirst(t(lang, desc.key, { ...vars, days: (vars.days || []).map((d) => t(lang, WEEKDAY_KEY[d])).join(', ') }));
}

/** Подстрока строки предложения. Имена ядро уже подставило, даты — сырые. */
export function opSub(sub, lang) {
  if (!sub) return '';
  const name = (v) => (v && typeof v === 'object' ? v.name || v.title || '' : v || '');
  const parts = [name(sub.project), name(sub.status), name(sub.version)];
  if (Array.isArray(sub.tags)) parts.push(sub.tags.map(name).filter(Boolean).join(', '));
  if (sub.dueAt) parts.push(t(lang, 'ai.sub_due', { date: when(sub.dueAt, lang) }));
  const slots = Array.isArray(sub.slots) ? sub.slots.filter((s) => s && !Number.isNaN(Date.parse(s.start)) && !Number.isNaN(Date.parse(s.end))) : [];
  if (slots.length) parts.push(slotsSummary(slots, lang, null));
  if (sub.repeat) parts.push(typeof sub.repeat === 'string' ? sub.repeat : repeatWords(sub.repeat, lang));
  if (sub.done === true) parts.push(t(lang, 'ai.sub_done'));
  if (sub.done === false) parts.push(t(lang, 'ai.sub_open'));
  if (sub.notes) parts.push(t(lang, 'ai.sub_notes'));
  return parts.filter(Boolean).join(' · ');
}

/** «10:00–11:00» — время пересечения. */
const span = (a, b) => `${hm(Date.parse(a))}–${hm(Date.parse(b))}`;

/** Строка пересечения: с чем и когда. */
export const overlapText = (c, lang) => t(lang, 'ai.conflict', { title: c.title || t(lang, 'task.no_name'), time: span(c.start, c.end) });

function OpRow({ row, kind, link, onOpen, lang, colors, s, first, overlaps }) {
  const known = !!row.exists;
  const icon = known ? 'check' : /^update/.test(kind) ? 'pen-line' : 'plus';
  const word = known ? t(lang, kind === 'create_version' ? 'version.label' : 'tag.dialog_edit') : t(lang, `ai.op_${kind}`);
  const name = row.title || t(lang, 'task.no_name');
  const sub = opSub(row.sub, lang);
  return (
    <View style={[s.op, !first && s.opLine]} testID="chat-op">
      <View style={s.opIcon}><Icon name={icon} size={14} color={colors.icon} /></View>
      <View style={s.opMain}>
        <Text style={s.opTitle} numberOfLines={2}>
          <Text style={s.opKind}>{word}</Text>
          {' '}
          {link ? (
            <Text style={s.opLink} onPress={() => onOpen(link)} accessibilityRole="link" testID="chat-op-link">{name}</Text>
          ) : (
            <Text style={s.opName}>{name}</Text>
          )}
        </Text>
        {sub ? <Text style={s.opSub} numberOfLines={2}>{sub}</Text> : null}
        {overlaps && overlaps.length ? overlaps.map((c, i) => (
          <View key={i} style={s.overlap} testID="chat-op-overlap">
            <Icon name="danger" size={12} color={colors.icon} />
            <Text style={s.overlapText} numberOfLines={2}>{overlapText(c, lang)}</Text>
          </View>
        )) : null}
      </View>
    </View>
  );
}

/**
 * @param card строка ленты kind 'card' (lib/aiChat.js)
 * @param isLast последняя применённая — у неё «Отменить»
 * @param onApply, onDecline, onUndo — решения; onOpen(link) — ссылка
 */
export default function ChatCard({ card, isLast, onApply, onDecline, onUndo, onOpen }) {
  const colors = useColors();
  const s = makeStyles(colors);
  const lang = useAppStore((st) => st.settings.lang);
  const projects = useAppStore((st) => st.projects);
  const tasks = useAppStore((st) => st.tasks);
  const statuses = useAppStore((st) => st.statuses);
  const versions = useAppStore((st) => st.versions);
  const tags = useAppStore((st) => st.tags);
  const data = useMemo(() => ({ projects, tasks, statuses, versions, tags }), [projects, tasks, statuses, versions, tags]);

  const rows = useMemo(() => {
    try { return Ai.aiProposalRows(data, card.ops, { statusName }) || []; } catch (err) { console.error('Строки предложения не собрались:', err); return []; }
  }, [data, card.ops, lang]);
  const check = useMemo(() => {
    if (card.state !== 'open') return { ok: true, errors: [] };
    try { return Ai.aiValidate(data, card.ops); } catch (err) { console.error('Предложение не проверилось:', err); return { ok: false, errors: [] }; }
  }, [data, card.ops, card.state]);
  const overlaps = useMemo(() => {
    if (card.state !== 'open') return [];
    try { return Ai.aiSlotConflicts(data, card.ops) || []; } catch (err) { console.error('Пересечения не посчитались:', err); return []; }
  }, [data, card.ops, card.state]);

  // «Применить» при пересечениях — сначала вопрос.
  const apply = () => {
    if (!overlaps.length) { onApply(); return; }
    const seen = new Set();
    const list = overlaps.filter((c) => {
      const key = `${c.taskId || c.title}|${c.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((c) => `«${c.title || t(lang, 'task.no_name')}» ${span(c.start, c.end)}`).join(', ');
    confirmSheet({
      title: t(lang, 'ai.conflict_title'),
      message: t(lang, 'ai.conflict_confirm', { list }),
      actions: [
        { label: t(lang, 'ai.conflict_ok'), onPress: onApply },
        { label: t(lang, 'common.cancel'), cancel: true },
      ],
    });
  };

  // Куда ведёт строка применённого предложения — если созданное ещё есть.
  const linkOf = (i) => {
    const l = card.state === 'applied' && card.links ? card.links[i] : null;
    if (!l || !l.id) return null;
    if (l.kind === 'task' && getTask(tasks, l.id)) return l;
    if (l.kind === 'project' && getProject(projects, l.id)) return l;
    return null;
  };

  const errors = !check.ok ? check.errors || [] : [];
  const stateLabel = card.state === 'applied' ? t(lang, 'ai.applied', { n: card.ops.length })
    : card.state === 'undone' ? t(lang, 'ai.undone') : t(lang, 'ai.declined');

  return (
    <View style={s.card} testID={`chat-card-${card.id}`}>
      {card.summary ? <Text style={s.title}>{card.summary}</Text> : null}
      <View style={s.ops}>
        {rows.map((row, i) => (
          <OpRow
            key={i}
            first={i === 0}
            row={row}
            kind={row.kind || (card.ops[i] && card.ops[i].op) || ''}
            link={linkOf(i)}
            overlaps={overlaps.filter((c) => c.index === i)}
            onOpen={onOpen}
            lang={lang}
            colors={colors}
            s={s}
          />
        ))}
      </View>
      {card.state === 'open' ? (
        <>
          {errors.length || (card.failed && check.ok) ? (
            <View style={s.errors} testID="chat-card-error">
              {card.failed && check.ok ? <Text style={s.error}>{t(lang, 'ai.apply_failed')}</Text> : null}
              {errors.map((e, i) => {
                const msg = t(lang, (e && e.message) || 'ai.invalid', (e && e.params) || undefined);
                const row = e && Number.isInteger(e.index) && e.index >= 0 ? rows[e.index] : null;
                return <Text key={i} style={s.error}>{row && row.title ? `${row.title}: ${msg}` : msg}</Text>;
              })}
            </View>
          ) : null}
          {card.sent ? <Text style={s.note} testID="chat-card-pending">{t(lang, 'ai.pending')}</Text> : null}
          <View style={s.actions}>
            <View style={s.action}>
              <PrimaryButton size="sm" title={t(lang, 'ai.apply')} onPress={apply} disabled={!check.ok} testID="chat-card-apply" />
            </View>
            <View style={s.action}>
              <PrimaryButton size="sm" variant="ghost" title={t(lang, 'ai.decline')} onPress={onDecline} testID="chat-card-decline" />
            </View>
          </View>
        </>
      ) : (
        <View style={s.stateRow} testID="chat-card-state">
          <Text style={s.stateText}>{stateLabel}</Text>
          {isLast ? (
            <Tap onPress={onUndo} hitSlop={8} accessibilityRole="button" testID="chat-card-undo">
              <Text style={s.link}>{t(lang, 'ai.undo')}</Text>
            </Tap>
          ) : null}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  ops: {},
  op: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm },
  opLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  opIcon: { width: 18, paddingTop: 3, alignItems: 'center' },
  opMain: { flex: 1, minWidth: 0, gap: 2 },
  opTitle: { color: colors.text, fontSize: fontSize.sm, lineHeight: 19 },
  opKind: { color: colors.textDim },
  opName: { color: colors.text, fontWeight: '600' },
  opLink: { color: colors.accentInk, fontWeight: '600', textDecorationLine: 'underline' },
  opSub: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16 },
  overlap: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingTop: 2 },
  overlapText: { flex: 1, color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16 },
  errors: { gap: 2 },
  error: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 16 },
  note: { color: colors.textFaint, fontSize: fontSize.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  action: { flex: 1 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.xs },
  stateText: { color: colors.textDim, fontSize: fontSize.sm },
  link: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '600' },
});

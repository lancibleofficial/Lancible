import { useEffect, useState } from 'react';
import ChoiceList from './ChoiceList';
import PrimaryButton from './PrimaryButton';
import { useAppStore } from '../store/useAppStore';
import { closeSheet, setSheetFooter, useSheetHeader } from '../store/useSheetStore';
import { t } from '../lib/i18n';

// Лист фильтра ленты «Задачи» (проект, срок, статус). Список — общий
// ChoiceList; отметки применяются сразу, отдельной кнопки «Готово» нет, а
// пока что-то отмечено, в подвале стоит «Сбросить».
//
// Лист открывается через стор и своего экрана не знает: его элемент создаётся
// один раз при открытии, поэтому отметки живут в самом листе, а экрану уходят
// через onChange. Несколько значений (multi) лист не закрывает — отмечают
// подряд; один выбор закрывает, как PickerSheet, а «Сбросить» у него то же,
// что пункт по умолчанию.
/**
 * @param {string} title — заголовок листа
 * @param {Array<{value, label: string, color?: string}>} options
 * @param {boolean} [multi] — можно отметить несколько
 * @param {*} value — отмеченное при открытии: массив (multi) или одно значение
 * @param {*} empty — значение «без отбора»: [] (multi) или пункт по умолчанию
 * @param {function} onChange — новое отмеченное, сразу при каждом нажатии
 */
export default function FilterSheet({ title, options, multi = false, value, empty, onChange }) {
  const lang = useAppStore((s) => s.settings.lang);
  const [picked, setPicked] = useState(value);
  useSheetHeader(title);

  const dirty = multi ? picked.length > 0 : picked !== empty;

  const apply = (next) => { setPicked(next); onChange(next); };
  // Один выбор: отдаём и закрываем, а своё состояние не трогаем — иначе
  // подвал («Сбросить») перерисовался бы уже после закрытия листа.
  const pick = (v) => {
    if (!multi) { onChange(v); closeSheet(); return; }
    // Порядок — как в списке, а не как нажимали: «первый отмеченный» на чипе
    // не зависит от очерёдности нажатий.
    const on = new Set(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]);
    apply(options.map((o) => o.value).filter((x) => on.has(x)));
  };
  const reset = () => {
    if (multi) { apply(empty); return; }
    onChange(empty);
    closeSheet();
  };

  useEffect(() => {
    setSheetFooter(dirty ? (
      <PrimaryButton title={t(lang, 'tasks.filter_reset')} variant="ghost" onPress={reset} testID="filter-reset" />
    ) : null);
    return () => setSheetFooter(null);
  }, [dirty, lang]);

  return (
    <ChoiceList
      multi={multi}
      options={options}
      value={picked}
      selected={picked}
      onSelect={pick}
      testID="filter-list"
    />
  );
}

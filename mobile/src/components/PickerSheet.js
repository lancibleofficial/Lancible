import ChoiceList from './ChoiceList';
import { closeSheet, useSheetHeader } from '../store/useSheetStore';

// Простой список выбора одного варианта — язык, валюта и т.п. Выбор сразу
// закрывает лист, отдельная кнопка "Готово" не нужна. Сам список — общий
// ChoiceList: одна подложка, строки без своих плашек, выбранный — галочкой.
/** @param embedded внутри другого листа: без своего заголовка и не закрывает лист
 *  @param options [{value, label, color?}] — color: точка цвета (проект) */
export default function PickerSheet({ title, options, value, onSelect, embedded }) {
  useSheetHeader(embedded ? null : title);
  return (
    <ChoiceList
      options={options}
      value={value}
      onSelect={(v) => { onSelect(v); if (!embedded) closeSheet(); }}
      testID="picker-list"
    />
  );
}

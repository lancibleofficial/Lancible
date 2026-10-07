// Строки редактора на языках приложения (core/lang.js: ru, en, uk, kk).
//
// Живут здесь, а не в core/i18n.js: редактор один и тот же на десктопе, в
// вебе и в WebView телефона, а у телефона свой i18n. Набор ключей у всех
// языков один — это сторожит tests/unit/editor-strings.test.js.

const ru = {
  editor: 'Текст', toolbar: 'Панель инструментов', placeholder: 'Пишите или нажмите «/», чтобы вставить блок…', placeholder_line: '«/» — вставить блок',
  undo: 'Отменить', redo: 'Повторить', more: 'Ещё',
  'common.apply': 'Применить', 'common.cancel': 'Отмена', 'common.close': 'Закрыть', 'common.ok': 'Готово', 'common.save': 'Сохранить',

  'fmt.bold': 'Полужирный', 'fmt.italic': 'Курсив', 'fmt.underline': 'Подчёркнутый', 'fmt.strike': 'Зачёркнутый',
  'fmt.code': 'Код в строке', 'fmt.sup': 'Надстрочный', 'fmt.sub': 'Подстрочный', 'fmt.more': 'Ещё оформление',
  'fmt.clear': 'Убрать оформление', 'fmt.text_color': 'Цвет текста', 'fmt.highlight': 'Маркер', 'fmt.link': 'Ссылка',
  'fmt.indent': 'Сдвинуть вправо', 'fmt.outdent': 'Сдвинуть влево', 'fmt.align': 'Выравнивание',
  'fmt.align_left': 'По левому краю', 'fmt.align_center': 'По центру', 'fmt.align_right': 'По правому краю', 'fmt.align_justify': 'По ширине',

  'block.style': 'Стиль текста', 'block.paragraph': 'Текст', 'block.h1': 'Заголовок 1', 'block.h2': 'Заголовок 2',
  'block.h3': 'Заголовок 3', 'block.h4': 'Заголовок 4', 'block.bullet': 'Маркированный список', 'block.ordered': 'Нумерованный список',
  'block.tasks': 'Чек-лист', 'block.quote': 'Цитата', 'block.callout': 'Выноска', 'block.callout_warn': 'Выноска: внимание',
  'block.callout_idea': 'Выноска: идея', 'block.code': 'Блок кода', 'block.hr': 'Разделитель', 'block.table': 'Таблица',
  'block.image': 'Картинка', 'block.image_url': 'Картинка по ссылке', 'block.chart': 'График', 'block.drawing': 'Рисунок',
  'block.insert': 'Вставить', 'block.turn_into': 'Превратить в', 'block.add_below': 'Добавить блок ниже',
  'block.drag_hint': 'Перетащите, чтобы переместить; щёлкните — меню блока', 'block.move_up': 'Выше', 'block.move_down': 'Ниже',
  'block.duplicate': 'Дублировать', 'block.delete': 'Удалить',

  'turn.paragraph': 'Текст', 'turn.h1': 'Заголовок 1', 'turn.h2': 'Заголовок 2', 'turn.h3': 'Заголовок 3', 'turn.h4': 'Заголовок 4',
  'turn.bullet_list': 'Маркированный список', 'turn.ordered_list': 'Нумерованный список', 'turn.task_list': 'Чек-лист',
  'turn.quote': 'Цитата', 'turn.code_block': 'Код',

  'callout.info': 'Заметка', 'callout.warn': 'Внимание', 'callout.ok': 'Готово', 'callout.idea': 'Идея',

  'color.none': 'Без цвета', 'color.ink': 'Как текст', 'color.gray': 'Серый', 'color.red': 'Красный', 'color.orange': 'Оранжевый',
  'color.yellow': 'Жёлтый', 'color.green': 'Зелёный', 'color.teal': 'Бирюзовый', 'color.blue': 'Синий', 'color.purple': 'Фиолетовый', 'color.pink': 'Розовый',

  'link.url': 'Адрес ссылки', 'link.text': 'Текст ссылки', 'link.open': 'Открыть ссылку', 'link.remove': 'Убрать ссылку',

  'table.pick_size': 'Размер таблицы', 'table.with_header': 'Строка заголовков', 'table.tools': 'Таблица',
  'table.row_above': 'Строка выше', 'table.row_below': 'Строка ниже', 'table.col_left': 'Столбец слева', 'table.col_right': 'Столбец справа', 'table.merge': 'Объединить ячейки', 'table.split': 'Разделить ячейку',
  'table.header_row': 'Строка заголовков', 'table.fill': 'Заливка ячеек', 'table.to_chart': 'График из таблицы',
  'table.delete': 'Удалить таблицу', 'table.no_numbers': 'В таблице нет чисел для графика: нужна строка названий и столбец подписей',

  'image.resize': 'Потяните, чтобы изменить ширину', 'image.caption_ph': 'Подпись', 'image.align_left': 'Слева',
  'image.align_center': 'По центру', 'image.align_right': 'Справа', 'image.align_full': 'На всю ширину',
  'image.alt': 'Описание для незрячих', 'image.alt_prompt': 'Что на картинке', 'image.replace': 'Заменить', 'image.download': 'Скачать',
  'image.loading': 'Загружаю…', 'image.missing': 'Картинка ещё не доехала с другого устройства', 'image.adding': 'Добавляю картинку…',
  'image.url_prompt': 'Адрес картинки',

  'chart.edit': 'Изменить график', 'chart.edit_title': 'График', 'chart.title_ph': 'Название графика', 'chart.labels': 'Подписи',
  'chart.add_row': 'Строка', 'chart.del_row': 'Удалить строку', 'chart.add_series': 'Добавить ряд', 'chart.del_series': 'Удалить ряд',
  'chart.series_n': 'Ряд {n}', 'chart.legend': 'Легенда', 'chart.values': 'Подписи значений', 'chart.stacked': 'Накопительный',
  'chart.paste_hint': 'Можно вставить данные прямо из Excel или Google Таблиц', 'chart.sample_a': 'Янв', 'chart.sample_b': 'Фев',
  'chart.sample_c': 'Мар', 'chart.sample_d': 'Апр', 'chart.type_bar': 'Столбцы', 'chart.type_hbar': 'Полосы', 'chart.type_line': 'Линия',
  'chart.type_area': 'Области', 'chart.type_pie': 'Круговая', 'chart.type_donut': 'Кольцо',

  'code.copy': 'Копировать', 'code.copied': 'Скопировано', 'code.plain': 'текст',

  'comments.title': 'Комментарии', 'comments.add': 'Комментарий', 'comments.write': 'Комментарий…', 'comments.reply': 'Ответить…',
  'comments.send': 'Отправить', 'comments.resolve': 'Решено', 'comments.reopen': 'Открыть снова', 'comments.delete': 'Удалить ветку',
  'comments.delete_reply': 'Удалить ответ', 'comments.copy_quote': 'Копировать фрагмент', 'comments.show_resolved': 'Показать решённые',
  'comments.empty': 'Выделите текст и нажмите «Комментарий»', 'comments.all_resolved': 'Все ветки решены',
  'comments.orphan': 'Текст под комментарием удалён', 'comments.resolved_by': 'Решено · {name}', 'comments.someone': 'Кто-то',
  'comments.me': 'Я', 'comments.select_text': 'Сначала выделите текст',

  'find.title': 'Найти', 'find.placeholder': 'Найти', 'find.replace_ph': 'Заменить на', 'find.replace': 'Заменить',
  'find.replace_all': 'Заменить все', 'find.toggle_replace': 'Замена', 'find.case': 'Учитывать регистр', 'find.whole': 'Слово целиком',
  'find.regex': 'Регулярное выражение', 'find.prev': 'Предыдущее', 'find.next': 'Следующее', 'find.none': 'Нет совпадений',
  'find.replaced_n': 'Заменено: {n}',

  'outline.title': 'Оглавление', 'outline.empty': 'Заголовков пока нет',

  'view.title': 'Вид', 'view.page_width': 'Ширина полосы', 'view.width_narrow': 'Узкая', 'view.width_normal': 'Обычная',
  'view.width_wide': 'Широкая', 'view.width_full': 'Во всю ширину', 'view.font': 'Шрифт', 'view.font_sans': 'Без засечек',
  'view.font_serif': 'С засечками', 'view.font_mono': 'Моноширинный', 'view.size': 'Размер', 'view.focus': 'Режим фокуса',
  'view.typewriter': 'Строка по центру', 'view.smart': 'Типографика: «ёлочки», тире', 'view.spellcheck': 'Проверка орфографии',
  'view.stats': 'Счётчик слов', 'view.fullscreen': 'Во весь экран', 'view.exit_fullscreen': 'Выйти из полноэкранного',

  'stats.words': 'слов: {n}', 'stats.chars': 'знаков: {n}', 'stats.reading': '≈ {n} мин чтения', 'stats.selected': 'выделено слов: {n}',

  'export.markdown': 'Скачать Markdown', 'export.html': 'Скачать HTML', 'export.copy_md': 'Копировать как Markdown',
  'export.print': 'Печать или PDF', 'export.copied': 'Скопировано как Markdown', 'export.copy_failed': 'Не удалось скопировать',

  'help.shortcuts': 'Сочетания клавиш', 'help.keys': 'Клавиши', 'help.markdown': 'Быстрая разметка', 'help.check_item': 'Отметить пункт',
  'help.line_break': 'Перенос строки', 'help.slash': 'Меню блоков', 'help.ink': 'Рисование',
  'help.ink_text': 'Пером рисуйте сразу — по холсту или поверх текста в режиме пометок. Кнопка на пере — ластик. Задержите перо в конце штриха — он станет прямой, прямоугольником или эллипсом. P, B, M, E, L, S — перо, карандаш, маркер, ластик, лассо, фигура.',

  'draw.hint': 'Рисуйте пером или щёлкните, чтобы рисовать мышью и пальцем', 'draw.area': 'Холст',
  'draw.resize': 'Потяните, чтобы изменить высоту', 'draw.background': 'Фон', 'draw.full': 'Во весь экран',
  'draw.exit_full': 'Обычный размер', 'draw.done': 'Готово', 'draw.download': 'Скачать PNG', 'draw.clear': 'Очистить холст',
  'draw.bg_plain': 'Чистый', 'draw.bg_grid': 'Клетка', 'draw.bg_dots': 'Точки', 'draw.bg_lines': 'Линейка',

  'ink.toolbar': 'Рисование', 'ink.annotate': 'Пометки от руки поверх текста', 'ink.tool_pen': 'Ручка', 'ink.tool_pencil': 'Карандаш',
  'ink.tool_marker': 'Маркер', 'ink.tool_eraser': 'Ластик', 'ink.tool_lasso': 'Лассо: выделить и передвинуть', 'ink.tool_shape': 'Фигура',
  'ink.shape_line': 'Линия', 'ink.shape_arrow': 'Стрелка', 'ink.shape_rect': 'Прямоугольник', 'ink.shape_ellipse': 'Эллипс',
  'ink.color': 'Цвет', 'ink.custom_color': 'Свой цвет', 'ink.size': 'Толщина', 'ink.settings': 'Настройки рисования',
  'ink.opacity': 'Непрозрачность',
  'ink.finger_draws': 'Палец рисует. Нажмите, чтобы листать пальцем',
  'ink.finger_scrolls': 'Палец листает. Нажмите, чтобы рисовать пальцем',
  'ink.finger_draws_toast': 'Теперь палец рисует',
  'ink.finger_scrolls_toast': 'Теперь палец листает, рисует только стилус',
  'ink.hide': 'Скрыть пометки',
  'ink.hidden_toast': 'Пометки скрыты. Вернуть — кнопкой пометок или в меню «Вид»',
  'ink.clear_all': 'Стереть все пометки',
  'ink.clear_title': 'Стереть все пометки?',
  'ink.clear_body': 'Все пометки от руки в этой заметке исчезнут. Пока заметка открыта, их можно вернуть отменой.',
  'ink.clear_do': 'Стереть',
  'ink.nothing_to_clear': 'Пометок пока нет',
  'view.show_ink': 'Показывать пометки от руки',
  'ink.sel_duplicate': 'Дублировать выделенное', 'ink.sel_recolor': 'Перекрасить выделенное', 'ink.sel_delete': 'Удалить выделенное',
  'ink.preset_saved': 'Перо запомнено на этой кнопке', 'ink.stylus': 'Чем рисовать',
  'ink.stylus_hint': 'Только стилус — пальцы и ладонь прокручивают, а не рисуют', 'ink.stylus_auto': 'Авто',
  'ink.stylus_only': 'Только стилус', 'ink.stylus_any': 'Всем', 'ink.pressure': 'Учитывать нажим',
  'ink.pressure_hint': 'Сильнее нажали — линия толще', 'ink.pen_button': 'Кнопка пера — ластик',
  'ink.pen_button_hint': 'И обратный конец пера, если он есть', 'ink.hold_shape': 'Задержать — выпрямить',
  'ink.hold_shape_hint': 'Задержите перо в конце штриха: линия, прямоугольник, эллипс', 'ink.eraser_mode': 'Ластик стирает',
  'ink.eraser_stroke': 'Штрих целиком', 'ink.eraser_partial': 'По кусочку', 'ink.smoothing': 'Сглаживание',
  'ink.presets_hint': 'Правый щелчок или долгое касание по кружку пера — запомнить на нём текущее перо.',

  'image.align_wrap_left': 'Обтекание: картинка слева',
  'image.align_wrap_right': 'Обтекание: картинка справа',
  'image.add_beside': 'Добавить картинку рядом',
  'image.move_left': 'Левее',
  'image.move_right': 'Правее',
  'image.unwrap_row': 'Вынести из ряда',
  'table.line_menu': 'Строки и столбцы',
  'table.col_insert_here': 'Вставить столбец здесь',
  'table.col_delete_left': 'Удалить столбец слева',
  'table.col_delete_right': 'Удалить столбец справа',
  'table.row_insert_here': 'Вставить строку здесь',
  'table.row_delete_above': 'Удалить строку выше',
  'table.row_delete_below': 'Удалить строку ниже',
  'table.row_delete': 'Удалить строку',
  'table.col_delete': 'Удалить столбец',
};

const en = {
  editor: 'Text', toolbar: 'Toolbar', placeholder: 'Write, or press “/” to insert a block…', placeholder_line: '“/” to insert a block',
  undo: 'Undo', redo: 'Redo', more: 'More',
  'common.apply': 'Apply', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.ok': 'Done', 'common.save': 'Save',

  'fmt.bold': 'Bold', 'fmt.italic': 'Italic', 'fmt.underline': 'Underline', 'fmt.strike': 'Strikethrough',
  'fmt.code': 'Inline code', 'fmt.sup': 'Superscript', 'fmt.sub': 'Subscript', 'fmt.more': 'More formatting',
  'fmt.clear': 'Clear formatting', 'fmt.text_color': 'Text color', 'fmt.highlight': 'Highlight', 'fmt.link': 'Link',
  'fmt.indent': 'Indent', 'fmt.outdent': 'Outdent', 'fmt.align': 'Alignment',
  'fmt.align_left': 'Align left', 'fmt.align_center': 'Center', 'fmt.align_right': 'Align right', 'fmt.align_justify': 'Justify',

  'block.style': 'Text style', 'block.paragraph': 'Text', 'block.h1': 'Heading 1', 'block.h2': 'Heading 2',
  'block.h3': 'Heading 3', 'block.h4': 'Heading 4', 'block.bullet': 'Bulleted list', 'block.ordered': 'Numbered list',
  'block.tasks': 'Checklist', 'block.quote': 'Quote', 'block.callout': 'Callout', 'block.callout_warn': 'Callout: warning',
  'block.callout_idea': 'Callout: idea', 'block.code': 'Code block', 'block.hr': 'Divider', 'block.table': 'Table',
  'block.image': 'Image', 'block.image_url': 'Image from URL', 'block.chart': 'Chart', 'block.drawing': 'Drawing',
  'block.insert': 'Insert', 'block.turn_into': 'Turn into', 'block.add_below': 'Add a block below',
  'block.drag_hint': 'Drag to move; click for block menu', 'block.move_up': 'Move up', 'block.move_down': 'Move down',
  'block.duplicate': 'Duplicate', 'block.delete': 'Delete',

  'turn.paragraph': 'Text', 'turn.h1': 'Heading 1', 'turn.h2': 'Heading 2', 'turn.h3': 'Heading 3', 'turn.h4': 'Heading 4',
  'turn.bullet_list': 'Bulleted list', 'turn.ordered_list': 'Numbered list', 'turn.task_list': 'Checklist',
  'turn.quote': 'Quote', 'turn.code_block': 'Code',

  'callout.info': 'Note', 'callout.warn': 'Warning', 'callout.ok': 'Done', 'callout.idea': 'Idea',

  'color.none': 'No color', 'color.ink': 'Text color', 'color.gray': 'Gray', 'color.red': 'Red', 'color.orange': 'Orange',
  'color.yellow': 'Yellow', 'color.green': 'Green', 'color.teal': 'Teal', 'color.blue': 'Blue', 'color.purple': 'Purple', 'color.pink': 'Pink',

  'link.url': 'Link address', 'link.text': 'Link text', 'link.open': 'Open link', 'link.remove': 'Remove link',

  'table.pick_size': 'Table size', 'table.with_header': 'Header row', 'table.tools': 'Table',
  'table.row_above': 'Row above', 'table.row_below': 'Row below', 'table.col_left': 'Column left', 'table.col_right': 'Column right', 'table.merge': 'Merge cells', 'table.split': 'Split cell',
  'table.header_row': 'Header row', 'table.fill': 'Cell fill', 'table.to_chart': 'Chart from table',
  'table.delete': 'Delete table', 'table.no_numbers': 'No numbers for a chart: the table needs a header row and a label column',

  'image.resize': 'Drag to resize', 'image.caption_ph': 'Caption', 'image.align_left': 'Left',
  'image.align_center': 'Center', 'image.align_right': 'Right', 'image.align_full': 'Full width',
  'image.alt': 'Alt text', 'image.alt_prompt': 'What is in the picture', 'image.replace': 'Replace', 'image.download': 'Download',
  'image.loading': 'Loading…', 'image.missing': 'The image has not arrived from another device yet', 'image.adding': 'Adding image…',
  'image.url_prompt': 'Image address',

  'chart.edit': 'Edit chart', 'chart.edit_title': 'Chart', 'chart.title_ph': 'Chart title', 'chart.labels': 'Labels',
  'chart.add_row': 'Row', 'chart.del_row': 'Delete row', 'chart.add_series': 'Add series', 'chart.del_series': 'Delete series',
  'chart.series_n': 'Series {n}', 'chart.legend': 'Legend', 'chart.values': 'Value labels', 'chart.stacked': 'Stacked',
  'chart.paste_hint': 'You can paste data straight from Excel or Google Sheets', 'chart.sample_a': 'Jan', 'chart.sample_b': 'Feb',
  'chart.sample_c': 'Mar', 'chart.sample_d': 'Apr', 'chart.type_bar': 'Columns', 'chart.type_hbar': 'Bars', 'chart.type_line': 'Line',
  'chart.type_area': 'Area', 'chart.type_pie': 'Pie', 'chart.type_donut': 'Donut',

  'code.copy': 'Copy', 'code.copied': 'Copied', 'code.plain': 'plain',

  'comments.title': 'Comments', 'comments.add': 'Comment', 'comments.write': 'Comment…', 'comments.reply': 'Reply…',
  'comments.send': 'Send', 'comments.resolve': 'Resolve', 'comments.reopen': 'Reopen', 'comments.delete': 'Delete thread',
  'comments.delete_reply': 'Delete reply', 'comments.copy_quote': 'Copy quote', 'comments.show_resolved': 'Show resolved',
  'comments.empty': 'Select text and press “Comment”', 'comments.all_resolved': 'All threads are resolved',
  'comments.orphan': 'The commented text was deleted', 'comments.resolved_by': 'Resolved · {name}', 'comments.someone': 'Someone',
  'comments.me': 'Me', 'comments.select_text': 'Select some text first',

  'find.title': 'Find', 'find.placeholder': 'Find', 'find.replace_ph': 'Replace with', 'find.replace': 'Replace',
  'find.replace_all': 'Replace all', 'find.toggle_replace': 'Replace', 'find.case': 'Match case', 'find.whole': 'Whole word',
  'find.regex': 'Regular expression', 'find.prev': 'Previous', 'find.next': 'Next', 'find.none': 'No matches',
  'find.replaced_n': 'Replaced: {n}',

  'outline.title': 'Outline', 'outline.empty': 'No headings yet',

  'view.title': 'View', 'view.page_width': 'Page width', 'view.width_narrow': 'Narrow', 'view.width_normal': 'Normal',
  'view.width_wide': 'Wide', 'view.width_full': 'Full width', 'view.font': 'Font', 'view.font_sans': 'Sans serif',
  'view.font_serif': 'Serif', 'view.font_mono': 'Monospace', 'view.size': 'Size', 'view.focus': 'Focus mode',
  'view.typewriter': 'Typewriter scrolling', 'view.smart': 'Smart quotes and dashes', 'view.spellcheck': 'Spell check',
  'view.stats': 'Word count', 'view.fullscreen': 'Full screen', 'view.exit_fullscreen': 'Exit full screen',

  'stats.words': '{n} words', 'stats.chars': '{n} characters', 'stats.reading': '≈ {n} min read', 'stats.selected': '{n} words selected',

  'export.markdown': 'Download Markdown', 'export.html': 'Download HTML', 'export.copy_md': 'Copy as Markdown',
  'export.print': 'Print or PDF', 'export.copied': 'Copied as Markdown', 'export.copy_failed': 'Could not copy',

  'help.shortcuts': 'Keyboard shortcuts', 'help.keys': 'Keys', 'help.markdown': 'Quick formatting', 'help.check_item': 'Check item',
  'help.line_break': 'Line break', 'help.slash': 'Block menu', 'help.ink': 'Drawing',
  'help.ink_text': 'Draw with a pen right away — on a canvas, or over the text in annotation mode. The pen button erases. Hold the pen still at the end of a stroke to turn it into a line, rectangle or ellipse. P, B, M, E, L, S — pen, pencil, marker, eraser, lasso, shape.',

  'draw.hint': 'Draw with a pen, or click to draw with a mouse or finger', 'draw.area': 'Canvas',
  'draw.resize': 'Drag to change height', 'draw.background': 'Background', 'draw.full': 'Full screen',
  'draw.exit_full': 'Normal size', 'draw.done': 'Done', 'draw.download': 'Download PNG', 'draw.clear': 'Clear canvas',
  'draw.bg_plain': 'Plain', 'draw.bg_grid': 'Grid', 'draw.bg_dots': 'Dots', 'draw.bg_lines': 'Lined',

  'ink.toolbar': 'Drawing', 'ink.annotate': 'Handwritten notes over the text', 'ink.tool_pen': 'Pen', 'ink.tool_pencil': 'Pencil',
  'ink.tool_marker': 'Marker', 'ink.tool_eraser': 'Eraser', 'ink.tool_lasso': 'Lasso: select and move', 'ink.tool_shape': 'Shape',
  'ink.shape_line': 'Line', 'ink.shape_arrow': 'Arrow', 'ink.shape_rect': 'Rectangle', 'ink.shape_ellipse': 'Ellipse',
  'ink.color': 'Color', 'ink.custom_color': 'Custom color', 'ink.size': 'Thickness', 'ink.settings': 'Drawing settings',
  'ink.opacity': 'Opacity',
  'ink.finger_draws': 'Finger draws. Tap to scroll with your finger',
  'ink.finger_scrolls': 'Finger scrolls. Tap to draw with your finger',
  'ink.finger_draws_toast': 'Your finger draws now',
  'ink.finger_scrolls_toast': 'Your finger scrolls now; only the stylus draws',
  'ink.hide': 'Hide notes',
  'ink.hidden_toast': 'Handwritten notes hidden. Bring them back with the notes button or in the View menu',
  'ink.clear_all': 'Erase all notes',
  'ink.clear_title': 'Erase all handwritten notes?',
  'ink.clear_body': 'Every handwritten note in this document will be removed. While it is open, Undo brings them back.',
  'ink.clear_do': 'Erase',
  'ink.nothing_to_clear': 'No handwritten notes yet',
  'view.show_ink': 'Show handwritten notes',
  'ink.sel_duplicate': 'Duplicate selection', 'ink.sel_recolor': 'Recolor selection', 'ink.sel_delete': 'Delete selection',
  'ink.preset_saved': 'Pen saved to this button', 'ink.stylus': 'Draw with',
  'ink.stylus_hint': 'Stylus only — fingers and palm scroll instead of drawing', 'ink.stylus_auto': 'Auto',
  'ink.stylus_only': 'Stylus only', 'ink.stylus_any': 'Anything', 'ink.pressure': 'Pressure sensitivity',
  'ink.pressure_hint': 'Press harder for a thicker line', 'ink.pen_button': 'Pen button erases',
  'ink.pen_button_hint': 'And the back end of the pen, if it has one', 'ink.hold_shape': 'Hold to straighten',
  'ink.hold_shape_hint': 'Hold the pen at the end of a stroke: line, rectangle, ellipse', 'ink.eraser_mode': 'Eraser removes',
  'ink.eraser_stroke': 'Whole stroke', 'ink.eraser_partial': 'Bit by bit', 'ink.smoothing': 'Smoothing',
  'ink.presets_hint': 'Right-click or long-press a pen circle to save the current pen on it.',

  'image.align_wrap_left': 'Wrap text: image on the left',
  'image.align_wrap_right': 'Wrap text: image on the right',
  'image.add_beside': 'Add an image beside',
  'image.move_left': 'Move left',
  'image.move_right': 'Move right',
  'image.unwrap_row': 'Take out of the row',
  'table.line_menu': 'Rows and columns',
  'table.col_insert_here': 'Insert column here',
  'table.col_delete_left': 'Delete column on the left',
  'table.col_delete_right': 'Delete column on the right',
  'table.row_insert_here': 'Insert row here',
  'table.row_delete_above': 'Delete row above',
  'table.row_delete_below': 'Delete row below',
  'table.row_delete': 'Delete row',
  'table.col_delete': 'Delete column',
};

const uk = {
  editor: 'Текст', toolbar: 'Панель інструментів', placeholder: 'Пишіть або натисніть «/», щоб вставити блок…', placeholder_line: '«/» — вставити блок',
  undo: 'Скасувати', redo: 'Повторити', more: 'Ще',
  'common.apply': 'Застосувати', 'common.cancel': 'Скасувати', 'common.close': 'Закрити', 'common.ok': 'Готово', 'common.save': 'Зберегти',

  'fmt.bold': 'Жирний', 'fmt.italic': 'Курсив', 'fmt.underline': 'Підкреслений', 'fmt.strike': 'Закреслений',
  'fmt.code': 'Код у рядку', 'fmt.sup': 'Надрядковий', 'fmt.sub': 'Підрядковий', 'fmt.more': 'Ще оформлення',
  'fmt.clear': 'Прибрати оформлення', 'fmt.text_color': 'Колір тексту', 'fmt.highlight': 'Маркер', 'fmt.link': 'Посилання',
  'fmt.indent': 'Зсунути праворуч', 'fmt.outdent': 'Зсунути ліворуч', 'fmt.align': 'Вирівнювання',
  'fmt.align_left': 'За лівим краєм', 'fmt.align_center': 'По центру', 'fmt.align_right': 'За правим краєм', 'fmt.align_justify': 'За шириною',

  'block.style': 'Стиль тексту', 'block.paragraph': 'Текст', 'block.h1': 'Заголовок 1', 'block.h2': 'Заголовок 2',
  'block.h3': 'Заголовок 3', 'block.h4': 'Заголовок 4', 'block.bullet': 'Маркований список', 'block.ordered': 'Нумерований список',
  'block.tasks': 'Чек-лист', 'block.quote': 'Цитата', 'block.callout': 'Виноска', 'block.callout_warn': 'Виноска: увага',
  'block.callout_idea': 'Виноска: ідея', 'block.code': 'Блок коду', 'block.hr': 'Роздільник', 'block.table': 'Таблиця',
  'block.image': 'Зображення', 'block.image_url': 'Зображення за посиланням', 'block.chart': 'Графік', 'block.drawing': 'Малюнок',
  'block.insert': 'Вставити', 'block.turn_into': 'Перетворити на', 'block.add_below': 'Додати блок нижче',
  'block.drag_hint': 'Перетягніть, щоб перемістити; клацніть — меню блоку', 'block.move_up': 'Вище', 'block.move_down': 'Нижче',
  'block.duplicate': 'Дублювати', 'block.delete': 'Видалити',

  'turn.paragraph': 'Текст', 'turn.h1': 'Заголовок 1', 'turn.h2': 'Заголовок 2', 'turn.h3': 'Заголовок 3', 'turn.h4': 'Заголовок 4',
  'turn.bullet_list': 'Маркований список', 'turn.ordered_list': 'Нумерований список', 'turn.task_list': 'Чек-лист',
  'turn.quote': 'Цитата', 'turn.code_block': 'Код',

  'callout.info': 'Нотатка', 'callout.warn': 'Увага', 'callout.ok': 'Готово', 'callout.idea': 'Ідея',

  'color.none': 'Без кольору', 'color.ink': 'Як текст', 'color.gray': 'Сірий', 'color.red': 'Червоний', 'color.orange': 'Помаранчевий',
  'color.yellow': 'Жовтий', 'color.green': 'Зелений', 'color.teal': 'Бірюзовий', 'color.blue': 'Синій', 'color.purple': 'Фіолетовий', 'color.pink': 'Рожевий',

  'link.url': 'Адреса посилання', 'link.text': 'Текст посилання', 'link.open': 'Відкрити посилання', 'link.remove': 'Прибрати посилання',

  'table.pick_size': 'Розмір таблиці', 'table.with_header': 'Рядок заголовків', 'table.tools': 'Таблиця',
  'table.row_above': 'Рядок вище', 'table.row_below': 'Рядок нижче', 'table.col_left': 'Стовпець ліворуч', 'table.col_right': 'Стовпець праворуч', 'table.merge': "Об'єднати клітинки", 'table.split': 'Розділити клітинку',
  'table.header_row': 'Рядок заголовків', 'table.fill': 'Заливка клітинок', 'table.to_chart': 'Графік з таблиці',
  'table.delete': 'Видалити таблицю', 'table.no_numbers': 'У таблиці немає чисел для графіка: потрібні рядок назв і стовпець підписів',

  'image.resize': 'Потягніть, щоб змінити ширину', 'image.caption_ph': 'Підпис', 'image.align_left': 'Ліворуч',
  'image.align_center': 'По центру', 'image.align_right': 'Праворуч', 'image.align_full': 'На всю ширину',
  'image.alt': 'Опис для незрячих', 'image.alt_prompt': 'Що на зображенні', 'image.replace': 'Замінити', 'image.download': 'Завантажити',
  'image.loading': 'Завантажую…', 'image.missing': 'Зображення ще не надійшло з іншого пристрою', 'image.adding': 'Додаю зображення…',
  'image.url_prompt': 'Адреса зображення',

  'chart.edit': 'Змінити графік', 'chart.edit_title': 'Графік', 'chart.title_ph': 'Назва графіка', 'chart.labels': 'Підписи',
  'chart.add_row': 'Рядок', 'chart.del_row': 'Видалити рядок', 'chart.add_series': 'Додати ряд', 'chart.del_series': 'Видалити ряд',
  'chart.series_n': 'Ряд {n}', 'chart.legend': 'Легенда', 'chart.values': 'Підписи значень', 'chart.stacked': 'Накопичувальний',
  'chart.paste_hint': 'Можна вставити дані просто з Excel або Google Таблиць', 'chart.sample_a': 'Січ', 'chart.sample_b': 'Лют',
  'chart.sample_c': 'Бер', 'chart.sample_d': 'Кві', 'chart.type_bar': 'Стовпці', 'chart.type_hbar': 'Смуги', 'chart.type_line': 'Лінія',
  'chart.type_area': 'Області', 'chart.type_pie': 'Кругова', 'chart.type_donut': 'Кільце',

  'code.copy': 'Копіювати', 'code.copied': 'Скопійовано', 'code.plain': 'текст',

  'comments.title': 'Коментарі', 'comments.add': 'Коментар', 'comments.write': 'Коментар…', 'comments.reply': 'Відповісти…',
  'comments.send': 'Надіслати', 'comments.resolve': 'Вирішено', 'comments.reopen': 'Відкрити знову', 'comments.delete': 'Видалити гілку',
  'comments.delete_reply': 'Видалити відповідь', 'comments.copy_quote': 'Копіювати фрагмент', 'comments.show_resolved': 'Показати вирішені',
  'comments.empty': 'Виділіть текст і натисніть «Коментар»', 'comments.all_resolved': 'Усі гілки вирішено',
  'comments.orphan': 'Текст під коментарем видалено', 'comments.resolved_by': 'Вирішено · {name}', 'comments.someone': 'Хтось',
  'comments.me': 'Я', 'comments.select_text': 'Спершу виділіть текст',

  'find.title': 'Знайти', 'find.placeholder': 'Знайти', 'find.replace_ph': 'Замінити на', 'find.replace': 'Замінити',
  'find.replace_all': 'Замінити всі', 'find.toggle_replace': 'Заміна', 'find.case': 'Враховувати регістр', 'find.whole': 'Слово цілком',
  'find.regex': 'Регулярний вираз', 'find.prev': 'Попереднє', 'find.next': 'Наступне', 'find.none': 'Немає збігів',
  'find.replaced_n': 'Замінено: {n}',

  'outline.title': 'Зміст', 'outline.empty': 'Заголовків поки немає',

  'view.title': 'Вигляд', 'view.page_width': 'Ширина смуги', 'view.width_narrow': 'Вузька', 'view.width_normal': 'Звичайна',
  'view.width_wide': 'Широка', 'view.width_full': 'На всю ширину', 'view.font': 'Шрифт', 'view.font_sans': 'Без зарубок',
  'view.font_serif': 'Із зарубками', 'view.font_mono': 'Моноширинний', 'view.size': 'Розмір', 'view.focus': 'Режим фокусу',
  'view.typewriter': 'Рядок по центру', 'view.smart': 'Типографіка: «ялинки», тире', 'view.spellcheck': 'Перевірка правопису',
  'view.stats': 'Лічильник слів', 'view.fullscreen': 'На весь екран', 'view.exit_fullscreen': 'Вийти з повноекранного',

  'stats.words': 'слів: {n}', 'stats.chars': 'знаків: {n}', 'stats.reading': '≈ {n} хв читання', 'stats.selected': 'виділено слів: {n}',

  'export.markdown': 'Завантажити Markdown', 'export.html': 'Завантажити HTML', 'export.copy_md': 'Копіювати як Markdown',
  'export.print': 'Друк або PDF', 'export.copied': 'Скопійовано як Markdown', 'export.copy_failed': 'Не вдалося скопіювати',

  'help.shortcuts': 'Сполучення клавіш', 'help.keys': 'Клавіші', 'help.markdown': 'Швидка розмітка', 'help.check_item': 'Позначити пункт',
  'help.line_break': 'Перенесення рядка', 'help.slash': 'Меню блоків', 'help.ink': 'Малювання',
  'help.ink_text': 'Пером малюйте одразу — на полотні або поверх тексту в режимі позначок. Кнопка на пері — гумка. Затримайте перо наприкінці штриха — він стане прямою, прямокутником або еліпсом. P, B, M, E, L, S — ручка, олівець, маркер, гумка, ласо, фігура.',

  'draw.hint': 'Малюйте пером або клацніть, щоб малювати мишею чи пальцем', 'draw.area': 'Полотно',
  'draw.resize': 'Потягніть, щоб змінити висоту', 'draw.background': 'Тло', 'draw.full': 'На весь екран',
  'draw.exit_full': 'Звичайний розмір', 'draw.done': 'Готово', 'draw.download': 'Завантажити PNG', 'draw.clear': 'Очистити полотно',
  'draw.bg_plain': 'Чисте', 'draw.bg_grid': 'Клітинка', 'draw.bg_dots': 'Крапки', 'draw.bg_lines': 'Лінійка',

  'ink.toolbar': 'Малювання', 'ink.annotate': 'Позначки від руки поверх тексту', 'ink.tool_pen': 'Ручка', 'ink.tool_pencil': 'Олівець',
  'ink.tool_marker': 'Маркер', 'ink.tool_eraser': 'Гумка', 'ink.tool_lasso': 'Ласо: виділити й пересунути', 'ink.tool_shape': 'Фігура',
  'ink.shape_line': 'Лінія', 'ink.shape_arrow': 'Стрілка', 'ink.shape_rect': 'Прямокутник', 'ink.shape_ellipse': 'Еліпс',
  'ink.color': 'Колір', 'ink.custom_color': 'Свій колір', 'ink.size': 'Товщина', 'ink.settings': 'Налаштування малювання',
  'ink.opacity': 'Непрозорість',
  'ink.finger_draws': 'Палець малює. Натисніть, щоб гортати пальцем',
  'ink.finger_scrolls': 'Палець гортає. Натисніть, щоб малювати пальцем',
  'ink.finger_draws_toast': 'Тепер палець малює',
  'ink.finger_scrolls_toast': 'Тепер палець гортає, малює лише стилус',
  'ink.hide': 'Сховати позначки',
  'ink.hidden_toast': 'Позначки сховано. Повернути — кнопкою позначок або в меню «Вигляд»',
  'ink.clear_all': 'Стерти всі позначки',
  'ink.clear_title': 'Стерти всі позначки?',
  'ink.clear_body': 'Усі позначки від руки в цій нотатці зникнуть. Поки нотатку відкрито, їх можна повернути скасуванням.',
  'ink.clear_do': 'Стерти',
  'ink.nothing_to_clear': 'Позначок поки немає',
  'view.show_ink': 'Показувати позначки від руки',
  'ink.sel_duplicate': 'Дублювати виділене', 'ink.sel_recolor': 'Перефарбувати виділене', 'ink.sel_delete': 'Видалити виділене',
  'ink.preset_saved': 'Перо запам’ятовано на цій кнопці', 'ink.stylus': 'Чим малювати',
  'ink.stylus_hint': 'Лише стилус — пальці й долоня прокручують, а не малюють', 'ink.stylus_auto': 'Авто',
  'ink.stylus_only': 'Лише стилус', 'ink.stylus_any': 'Усім', 'ink.pressure': 'Враховувати натиск',
  'ink.pressure_hint': 'Сильніше натиснули — лінія товща', 'ink.pen_button': 'Кнопка пера — гумка',
  'ink.pen_button_hint': 'І зворотний кінець пера, якщо він є', 'ink.hold_shape': 'Затримати — випрямити',
  'ink.hold_shape_hint': 'Затримайте перо наприкінці штриха: лінія, прямокутник, еліпс', 'ink.eraser_mode': 'Гумка стирає',
  'ink.eraser_stroke': 'Штрих цілком', 'ink.eraser_partial': 'Потроху', 'ink.smoothing': 'Згладжування',
  'ink.presets_hint': 'Правий клік або довге торкання кружечка пера — запам’ятати на ньому поточне перо.',

  'image.align_wrap_left': 'Обтікання: зображення ліворуч',
  'image.align_wrap_right': 'Обтікання: зображення праворуч',
  'image.add_beside': 'Додати зображення поруч',
  'image.move_left': 'Лівіше',
  'image.move_right': 'Правіше',
  'image.unwrap_row': 'Винести з ряду',
  'table.line_menu': 'Рядки і стовпці',
  'table.col_insert_here': 'Вставити стовпець тут',
  'table.col_delete_left': 'Видалити стовпець ліворуч',
  'table.col_delete_right': 'Видалити стовпець праворуч',
  'table.row_insert_here': 'Вставити рядок тут',
  'table.row_delete_above': 'Видалити рядок вище',
  'table.row_delete_below': 'Видалити рядок нижче',
  'table.row_delete': 'Видалити рядок',
  'table.col_delete': 'Видалити стовпець',
};

const kk = {
  editor: 'Мәтін', toolbar: 'Құралдар тақтасы', placeholder: 'Жазыңыз немесе блок қою үшін «/» басыңыз…', placeholder_line: '«/» — блок қою',
  undo: 'Болдырмау', redo: 'Қайталау', more: 'Тағы',
  'common.apply': 'Қолдану', 'common.cancel': 'Болдырмау', 'common.close': 'Жабу', 'common.ok': 'Дайын', 'common.save': 'Сақтау',

  'fmt.bold': 'Жуан', 'fmt.italic': 'Көлбеу', 'fmt.underline': 'Асты сызылған', 'fmt.strike': 'Сызылған',
  'fmt.code': 'Жолдағы код', 'fmt.sup': 'Жоғарғы индекс', 'fmt.sub': 'Төменгі индекс', 'fmt.more': 'Тағы безендіру',
  'fmt.clear': 'Безендіруді алып тастау', 'fmt.text_color': 'Мәтін түсі', 'fmt.highlight': 'Маркер', 'fmt.link': 'Сілтеме',
  'fmt.indent': 'Оңға жылжыту', 'fmt.outdent': 'Солға жылжыту', 'fmt.align': 'Туралау',
  'fmt.align_left': 'Сол жақ шет', 'fmt.align_center': 'Ортасы', 'fmt.align_right': 'Оң жақ шет', 'fmt.align_justify': 'Ені бойынша',

  'block.style': 'Мәтін стилі', 'block.paragraph': 'Мәтін', 'block.h1': 'Тақырып 1', 'block.h2': 'Тақырып 2',
  'block.h3': 'Тақырып 3', 'block.h4': 'Тақырып 4', 'block.bullet': 'Таңбалы тізім', 'block.ordered': 'Нөмірлі тізім',
  'block.tasks': 'Чек-парақ', 'block.quote': 'Дәйексөз', 'block.callout': 'Ескертпе', 'block.callout_warn': 'Ескертпе: назар аударыңыз',
  'block.callout_idea': 'Ескертпе: идея', 'block.code': 'Код блогы', 'block.hr': 'Бөлгіш', 'block.table': 'Кесте',
  'block.image': 'Сурет', 'block.image_url': 'Сілтеме бойынша сурет', 'block.chart': 'График', 'block.drawing': 'Сызба',
  'block.insert': 'Қою', 'block.turn_into': 'Түрлендіру', 'block.add_below': 'Төменге блок қосу',
  'block.drag_hint': 'Жылжыту үшін сүйреңіз; басыңыз — блок мәзірі', 'block.move_up': 'Жоғары', 'block.move_down': 'Төмен',
  'block.duplicate': 'Көшірмесін жасау', 'block.delete': 'Жою',

  'turn.paragraph': 'Мәтін', 'turn.h1': 'Тақырып 1', 'turn.h2': 'Тақырып 2', 'turn.h3': 'Тақырып 3', 'turn.h4': 'Тақырып 4',
  'turn.bullet_list': 'Таңбалы тізім', 'turn.ordered_list': 'Нөмірлі тізім', 'turn.task_list': 'Чек-парақ',
  'turn.quote': 'Дәйексөз', 'turn.code_block': 'Код',

  'callout.info': 'Жазба', 'callout.warn': 'Назар аударыңыз', 'callout.ok': 'Дайын', 'callout.idea': 'Идея',

  'color.none': 'Түссіз', 'color.ink': 'Мәтін сияқты', 'color.gray': 'Сұр', 'color.red': 'Қызыл', 'color.orange': 'Қызғылт сары',
  'color.yellow': 'Сары', 'color.green': 'Жасыл', 'color.teal': 'Көгілдір-жасыл', 'color.blue': 'Көк', 'color.purple': 'Күлгін', 'color.pink': 'Қызғылт',

  'link.url': 'Сілтеме мекенжайы', 'link.text': 'Сілтеме мәтіні', 'link.open': 'Сілтемені ашу', 'link.remove': 'Сілтемені алып тастау',

  'table.pick_size': 'Кесте өлшемі', 'table.with_header': 'Тақырып жолы', 'table.tools': 'Кесте',
  'table.row_above': 'Жоғарыға жол', 'table.row_below': 'Төменге жол', 'table.col_left': 'Солға баған', 'table.col_right': 'Оңға баған', 'table.merge': 'Ұяшықтарды біріктіру', 'table.split': 'Ұяшықты бөлу',
  'table.header_row': 'Тақырып жолы', 'table.fill': 'Ұяшықтарды бояу', 'table.to_chart': 'Кестеден график',
  'table.delete': 'Кестені жою', 'table.no_numbers': 'Кестеде график үшін сан жоқ: атаулар жолы мен белгілер бағаны керек',

  'image.resize': 'Енін өзгерту үшін сүйреңіз', 'image.caption_ph': 'Жазу', 'image.align_left': 'Сол жақта',
  'image.align_center': 'Ортада', 'image.align_right': 'Оң жақта', 'image.align_full': 'Толық енімен',
  'image.alt': 'Көрмейтіндерге сипаттама', 'image.alt_prompt': 'Суретте не бар', 'image.replace': 'Ауыстыру', 'image.download': 'Жүктеп алу',
  'image.loading': 'Жүктелуде…', 'image.missing': 'Сурет басқа құрылғыдан әлі келген жоқ', 'image.adding': 'Сурет қосылуда…',
  'image.url_prompt': 'Сурет мекенжайы',

  'chart.edit': 'Графикті өзгерту', 'chart.edit_title': 'График', 'chart.title_ph': 'График атауы', 'chart.labels': 'Белгілер',
  'chart.add_row': 'Жол', 'chart.del_row': 'Жолды жою', 'chart.add_series': 'Қатар қосу', 'chart.del_series': 'Қатарды жою',
  'chart.series_n': '{n}-қатар', 'chart.legend': 'Шартты белгілер', 'chart.values': 'Мән белгілері', 'chart.stacked': 'Жинақталған',
  'chart.paste_hint': 'Деректерді Excel немесе Google Кестелерден тікелей қоюға болады', 'chart.sample_a': 'Қаң', 'chart.sample_b': 'Ақп',
  'chart.sample_c': 'Нау', 'chart.sample_d': 'Сәу', 'chart.type_bar': 'Бағандар', 'chart.type_hbar': 'Жолақтар', 'chart.type_line': 'Сызық',
  'chart.type_area': 'Аймақтар', 'chart.type_pie': 'Дөңгелек', 'chart.type_donut': 'Сақина',

  'code.copy': 'Көшіру', 'code.copied': 'Көшірілді', 'code.plain': 'мәтін',

  'comments.title': 'Пікірлер', 'comments.add': 'Пікір', 'comments.write': 'Пікір…', 'comments.reply': 'Жауап беру…',
  'comments.send': 'Жіберу', 'comments.resolve': 'Шешілді', 'comments.reopen': 'Қайта ашу', 'comments.delete': 'Тармақты жою',
  'comments.delete_reply': 'Жауапты жою', 'comments.copy_quote': 'Үзіндіні көшіру', 'comments.show_resolved': 'Шешілгендерді көрсету',
  'comments.empty': 'Мәтінді белгілеп, «Пікір» басыңыз', 'comments.all_resolved': 'Барлық тармақ шешілді',
  'comments.orphan': 'Пікір астындағы мәтін жойылды', 'comments.resolved_by': 'Шешілді · {name}', 'comments.someone': 'Біреу',
  'comments.me': 'Мен', 'comments.select_text': 'Алдымен мәтінді белгілеңіз',

  'find.title': 'Табу', 'find.placeholder': 'Табу', 'find.replace_ph': 'Мынаған ауыстыру', 'find.replace': 'Ауыстыру',
  'find.replace_all': 'Барлығын ауыстыру', 'find.toggle_replace': 'Ауыстыру', 'find.case': 'Регистрді ескеру', 'find.whole': 'Тұтас сөз',
  'find.regex': 'Тұрақты өрнек', 'find.prev': 'Алдыңғы', 'find.next': 'Келесі', 'find.none': 'Сәйкестік жоқ',
  'find.replaced_n': 'Ауыстырылды: {n}',

  'outline.title': 'Мазмұны', 'outline.empty': 'Әзірге тақырыптар жоқ',

  'view.title': 'Көрініс', 'view.page_width': 'Жолақ ені', 'view.width_narrow': 'Тар', 'view.width_normal': 'Кәдімгі',
  'view.width_wide': 'Кең', 'view.width_full': 'Толық енімен', 'view.font': 'Қаріп', 'view.font_sans': 'Кертіксіз',
  'view.font_serif': 'Кертікті', 'view.font_mono': 'Бірдей енді', 'view.size': 'Өлшем', 'view.focus': 'Назар режимі',
  'view.typewriter': 'Жол ортада', 'view.smart': 'Типографика: «тырнақша», сызықша', 'view.spellcheck': 'Емлені тексеру',
  'view.stats': 'Сөз санауыш', 'view.fullscreen': 'Толық экран', 'view.exit_fullscreen': 'Толық экраннан шығу',

  'stats.words': 'сөз: {n}', 'stats.chars': 'таңба: {n}', 'stats.reading': '≈ {n} мин оқу', 'stats.selected': 'белгіленген сөз: {n}',

  'export.markdown': 'Markdown жүктеп алу', 'export.html': 'HTML жүктеп алу', 'export.copy_md': 'Markdown ретінде көшіру',
  'export.print': 'Басып шығару немесе PDF', 'export.copied': 'Markdown ретінде көшірілді', 'export.copy_failed': 'Көшіру мүмкін болмады',

  'help.shortcuts': 'Пернелер тіркесімі', 'help.keys': 'Пернелер', 'help.markdown': 'Жылдам белгілеу', 'help.check_item': 'Тармақты белгілеу',
  'help.line_break': 'Жол ауыстыру', 'help.slash': 'Блоктар мәзірі', 'help.ink': 'Сурет салу',
  'help.ink_text': 'Қаламмен бірден салыңыз — кенепте немесе белгілер режимінде мәтіннің үстінен. Қаламдағы түйме — өшіргіш. Сызықтың соңында қаламды ұстап тұрыңыз — ол түзу, тіктөртбұрыш немесе эллипс болады. P, B, M, E, L, S — қалам, қарындаш, маркер, өшіргіш, лассо, фигура.',

  'draw.hint': 'Қаламмен салыңыз немесе тінтуір не саусақпен салу үшін басыңыз', 'draw.area': 'Кенеп',
  'draw.resize': 'Биіктігін өзгерту үшін сүйреңіз', 'draw.background': 'Фон', 'draw.full': 'Толық экран',
  'draw.exit_full': 'Кәдімгі өлшем', 'draw.done': 'Дайын', 'draw.download': 'PNG жүктеп алу', 'draw.clear': 'Кенепті тазалау',
  'draw.bg_plain': 'Таза', 'draw.bg_grid': 'Тор', 'draw.bg_dots': 'Нүктелер', 'draw.bg_lines': 'Сызықтар',

  'ink.toolbar': 'Сурет салу', 'ink.annotate': 'Мәтін үстінен қолжазба белгілер', 'ink.tool_pen': 'Қалам', 'ink.tool_pencil': 'Қарындаш',
  'ink.tool_marker': 'Маркер', 'ink.tool_eraser': 'Өшіргіш', 'ink.tool_lasso': 'Лассо: белгілеу және жылжыту', 'ink.tool_shape': 'Фигура',
  'ink.shape_line': 'Сызық', 'ink.shape_arrow': 'Көрсеткі', 'ink.shape_rect': 'Тіктөртбұрыш', 'ink.shape_ellipse': 'Эллипс',
  'ink.color': 'Түс', 'ink.custom_color': 'Өз түсі', 'ink.size': 'Қалыңдық', 'ink.settings': 'Сурет салу баптаулары',
  'ink.opacity': 'Мөлдірсіздік',
  'ink.finger_draws': 'Саусақ сызады. Саусақпен парақтау үшін басыңыз',
  'ink.finger_scrolls': 'Саусақ парақтайды. Саусақпен сызу үшін басыңыз',
  'ink.finger_draws_toast': 'Енді саусақ сызады',
  'ink.finger_scrolls_toast': 'Енді саусақ парақтайды, тек стилус сызады',
  'ink.hide': 'Белгілерді жасыру',
  'ink.hidden_toast': 'Белгілер жасырылды. Қайтару — белгілер батырмасымен немесе «Көрініс» мәзірінде',
  'ink.clear_all': 'Барлық белгілерді өшіру',
  'ink.clear_title': 'Барлық белгілерді өшіру керек пе?',
  'ink.clear_body': 'Осы жазбадағы қолмен салынған барлық белгілер жойылады. Жазба ашық тұрғанда оларды болдырмау арқылы қайтаруға болады.',
  'ink.clear_do': 'Өшіру',
  'ink.nothing_to_clear': 'Әзірге белгілер жоқ',
  'view.show_ink': 'Қолмен салынған белгілерді көрсету',
  'ink.sel_duplicate': 'Белгіленгеннің көшірмесі', 'ink.sel_recolor': 'Белгіленгенді қайта бояу', 'ink.sel_delete': 'Белгіленгенді жою',
  'ink.preset_saved': 'Қалам осы түймеге сақталды', 'ink.stylus': 'Немен салу',
  'ink.stylus_hint': 'Тек стилус — саусақ пен алақан салмайды, айналдырады', 'ink.stylus_auto': 'Авто',
  'ink.stylus_only': 'Тек стилус', 'ink.stylus_any': 'Бәрімен', 'ink.pressure': 'Басуды ескеру',
  'ink.pressure_hint': 'Қаттырақ бассаңыз — сызық жуанырақ', 'ink.pen_button': 'Қалам түймесі — өшіргіш',
  'ink.pen_button_hint': 'Қаламның арт жағы да, егер бар болса', 'ink.hold_shape': 'Ұстап тұру — түзету',
  'ink.hold_shape_hint': 'Сызықтың соңында қаламды ұстаңыз: түзу, тіктөртбұрыш, эллипс', 'ink.eraser_mode': 'Өшіргіш өшіреді',
  'ink.eraser_stroke': 'Тұтас сызықты', 'ink.eraser_partial': 'Бөлшектеп', 'ink.smoothing': 'Тегістеу',
  'ink.presets_hint': 'Қалам дөңгелегін оң жақпен басыңыз немесе ұзақ басыңыз — ағымдағы қаламды соған сақтау.',

  'image.align_wrap_left': 'Ағын: сурет сол жақта',
  'image.align_wrap_right': 'Ағын: сурет оң жақта',
  'image.add_beside': 'Қасына сурет қосу',
  'image.move_left': 'Солға',
  'image.move_right': 'Оңға',
  'image.unwrap_row': 'Қатардан шығару',
  'table.line_menu': 'Жолдар мен бағандар',
  'table.col_insert_here': 'Осы жерге баған қою',
  'table.col_delete_left': 'Сол жақтағы бағанды жою',
  'table.col_delete_right': 'Оң жақтағы бағанды жою',
  'table.row_insert_here': 'Осы жерге жол қою',
  'table.row_delete_above': 'Жоғарыдағы жолды жою',
  'table.row_delete_below': 'Төмендегі жолды жою',
  'table.row_delete': 'Жолды жою',
  'table.col_delete': 'Бағанды жою',
};

// Ключи, которые собираются в коде из частей, — чтобы их было видно поиском.
// comments.write comments.reply comments.resolve comments.reopen comments.empty comments.all_resolved
// draw.full draw.exit_full view.fullscreen view.exit_fullscreen

export const STRINGS = { ru, en, uk, kk };

export function translate(lang, key, vars) {
  const dict = STRINGS[lang] || ru;
  let s = dict[key];
  if (s == null) s = ru[key];
  if (s == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

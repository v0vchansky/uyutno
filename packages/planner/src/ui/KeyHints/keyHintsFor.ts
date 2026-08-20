import type { ToolKind } from '../../engine/tools/ToolState';
import type { LengthInputFocus } from '../PlannerOverlayContext';

/**
 * Контекстная подсказка горячих клавиш (решение 3 брифа `docs/ui/briefs/planner-editor.md`, P0.9): чистая таблица
 * «состояние автомата инструментов → пары подсказок». Нормативный источник текстов и правил обрезки — handoff
 * `docs/ui/handoffs/planner/planner-editor-ui.md`, «Полоса подсказки клавиш».
 *
 * Логика вынесена из компонента, чтобы таблица проверялась node-тестом без jsdom, а `KeyHints` остался вёрсткой.
 * Это **не** справка и не онбординг: подсказка показывает только то, что осмысленно прямо сейчас.
 */

/**
 * Пара «действие → клавиша».
 *
 * `key` — либо название клавиши (`Esc`, `Ctrl`, `Tab`), либо мышиный жест: его полоса рисует иконкой мыши с
 * подсвеченной кнопкой, а не словами «правая кнопка» (handoff, «Что показывает»). Поле необязательное — в строке
 * «выделено ребро, правка длины» той же таблицы есть пара без клавиши («формы `+N` / `−N`»).
 */
export interface KeyHint {
  action: string;
  key?: string | { mouse: 'right' };
}

/**
 * Максимум три пары, всегда одна строка (handoff, «Полоса подсказки клавиш»). Перенос на вторую строку запрещён,
 * поэтому лишнее не сжимается и не скроллится, а обрезается.
 */
export const MAX_KEY_HINTS = 3;

/** Замораживает набор целиком (пары тоже): подсказки — общие константы, их не правят «на минутку». */
const freezeHints = (hints: readonly KeyHint[]): readonly KeyHint[] =>
  Object.freeze(hints.map(hint => Object.freeze(hint)));

/**
 * Обрезка по приоритету: первые пары набора важнее, при переполнении отбрасываются правые (handoff, «При
 * переполнении пары обрезаются по приоритету справа»). Набор длиной ≤ `MAX_KEY_HINTS` возвращается той же ссылкой —
 * селекторы и `KeyHints` рассчитывают на стабильность.
 */
export const clampKeyHints = (hints: readonly KeyHint[]): readonly KeyHint[] =>
  hints.length <= MAX_KEY_HINTS ? hints : hints.slice(0, MAX_KEY_HINTS);

/** `editing`: единственное, что стоит подсказать в хабе, — панорамирование правой кнопкой. */
const EDITING_HINTS = freezeHints([{ action: 'Панорамирование', key: { mouse: 'right' } }]);

/** «Стены» и «Комната по точкам»: выход из режима и временное отключение снапа. */
const DRAWING_HINTS = freezeHints([
  { action: 'Отменить рисование', key: 'Esc' },
  { action: 'Без снапа', key: 'Ctrl' },
]);

/** «Прямоугольная комната»: то же плюс Tab — у прямоугольника пара полей длины, между ними ходят табом. */
const RECT_HINTS = freezeHints([...DRAWING_HINTS, { action: 'Другое поле', key: 'Tab' }]);

/**
 * Драг вершины и драг стороны: порядок пар обратный рисованию — во время жеста Ctrl нужнее, чем Esc
 * (handoff, строка «`dragging-point`, `dragging-wall`»).
 */
const DRAGGING_HINTS = freezeHints([
  { action: 'Без снапа', key: 'Ctrl' },
  { action: 'Отменить жест', key: 'Esc' },
]);

/** Нормативная таблица handoff'а один-в-один: шесть состояний автомата, ни одного «прочего». */
const HINTS_BY_KIND: Readonly<Record<ToolKind, readonly KeyHint[]>> = Object.freeze({
  editing: EDITING_HINTS,
  'making-walls': DRAWING_HINTS,
  'making-room': DRAWING_HINTS,
  'making-rect': RECT_HINTS,
  'dragging-point': DRAGGING_HINTS,
  'dragging-wall': DRAGGING_HINTS,
});

/** Подсказки для состояния автомата, уже обрезанные до `MAX_KEY_HINTS`; ссылка стабильна между вызовами. */
export const keyHintsFor = (kind: ToolKind): readonly KeyHint[] => clampKeyHints(HINTS_BY_KIND[kind]);

/**
 * Две строки нормативной таблицы, которых автомат не различает: их источник — слой полей ввода длины (0060),
 * общий контекст скина `ui/PlannerOverlayContext.tsx`. Фокус в DOM-поле не факт домена, поэтому событий о нём на
 * шине нет и быть не должно (инварианты `packages/planner/CLAUDE.md`, «События — свершившиеся факты»).
 */

/** «Фокус в поле длины» при рисовании: Enter ставит точку — ключевой случай, ради которого полоса и заведена. */
const LENGTH_INPUT_DRAWING_HINTS = freezeHints([
  { action: 'Другое поле', key: 'Tab' },
  { action: 'Поставить точку', key: 'Enter' },
  { action: 'Отменить', key: 'Esc' },
]);

/** То же без Tab: видимое поле одно, переносить фокус некуда. */
const LENGTH_INPUT_DRAWING_SOLO_HINTS = freezeHints([
  { action: 'Поставить точку', key: 'Enter' },
  { action: 'Отменить', key: 'Esc' },
]);

/** «Выделено ребро, правка длины»: Enter применяет, и здесь же — напоминание про формы `+N` / `−N` (пара без клавиши). */
const LENGTH_EDIT_HINTS = freezeHints([
  { action: 'Применить', key: 'Enter' },
  { action: 'Отменить', key: 'Esc' },
  { action: 'Формы +N / −N' },
]);

/** Подсказки по фокусу в полях длины; ссылка стабильна между вызовами. */
export const keyHintsForFocus = (focus: LengthInputFocus): readonly KeyHint[] => {
  if (focus.mode === 'editing') return LENGTH_EDIT_HINTS;
  return focus.hasSiblings ? LENGTH_INPUT_DRAWING_HINTS : LENGTH_INPUT_DRAWING_SOLO_HINTS;
};

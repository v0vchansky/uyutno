import type { HistoryState } from '../../engine/HistoryNamespace';
import type { ToolState } from '../../engine/tools/ToolState';
import { usePlannerSelector } from '../usePlannerSelector';

/**
 * Доступность кнопок «Отменить»/«Повторить» строки истории (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`,
 * «Панель инструментов»: «Обе кнопки `disabled`, когда откатывать нечего»; спека
 * `docs/product/features/planner/09-undo-redo.md`, «Клавиши и UI-триггеры»).
 *
 * Смысл Ctrl+Z зависит от состояния автомата (ADR 0019 E1): в рисовании undo/redo идут в **локальный стек
 * инструмента**, в `editing` — в историю документа. Значит и `disabled` считается не по `history.get()`, а по
 * тому же разбору `kind`, что и в `engine/tools/*.ts` — иначе кнопка врала бы про то, что произойдёт по клику.
 */
export interface HistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Чистая функция доступности: состояние автомата + снимок истории документа → что можно нажать.
 * Нормативный источник каждой ветки — обработчик `key` соответствующего состояния.
 */
export const historyAvailability = (state: ToolState, history: HistoryState): HistoryAvailability => {
  switch (state.kind) {
    // `editing.key` зовёт `historyUndo`/`historyRedo` — ровно флаги активной зоны истории (`engine/tools/editing.ts`).
    case 'editing':
      return { canUndo: history.canUndo, canRedo: history.canRedo };
    // «Стены» и «Комната по точкам» держат локальные стеки снимков `points` (ADR 0018 D8): пустой стек — no-op
    // (`undoPoint`/`redoPoint` в `makingWalls.ts` / `makingRoom.ts`), история документа о рисовании не знает.
    case 'making-walls':
    case 'making-room':
      return { canUndo: state.undo.length > 0, canRedo: state.redo.length > 0 };
    // У прямоугольника локальных стеков нет (`makingRect.ts`): Ctrl+Z при поставленном угле — «undo до пустого
    // холста» → `editing` (спека 09), без угла — no-op; Ctrl+Y — no-op всегда, поэтому redo недоступен.
    case 'making-rect':
      return { canUndo: state.origin !== null, canRedo: false };
    // Обе `true` намеренно, а не `history.get()`: во время жеста Ctrl+Z **и** Ctrl+Y отменяют сам жест и историю
    // не трогают (ADR 0019 E1, `draggingPoint.ts` / `draggingWall.ts` → `abort`). Нажатие всегда что-то делает —
    // даже на пустой истории, — поэтому гасить кнопки по флагам документа было бы враньём.
    case 'dragging-point':
    case 'dragging-wall':
      return { canUndo: true, canRedo: true };
  }
};

/** Пара флагов, упакованная в биты одного числа. */
const CAN_UNDO_BIT = 1;
const CAN_REDO_BIT = 2;

/**
 * Тот же расчёт от живого фасада — **один** вызов `historyAvailability` на событие шины.
 *
 * Селектор `usePlannerSelector` обязан возвращать примитив или снимок фасада как есть: новый объект на каждый
 * вызов дал бы бесконечный ре-рендер (`tools:changed` летит на каждый `pointerMove`, ADR 0015 «Что важно знать»),
 * а два селектора по одному полю считали бы доступность дважды. Поэтому селектор отдаёт **число** — два флага в
 * битах, — и он же остаётся единственной подпиской хука; булевы значения разбираются уже вне селектора.
 */
export const useHistoryButtons = (): HistoryAvailability => {
  const bits = usePlannerSelector(manager => {
    const { canUndo, canRedo } = historyAvailability(manager.tools.get(), manager.history.get());
    return (canUndo ? CAN_UNDO_BIT : 0) | (canRedo ? CAN_REDO_BIT : 0);
  });
  return { canUndo: (bits & CAN_UNDO_BIT) !== 0, canRedo: (bits & CAN_REDO_BIT) !== 0 };
};

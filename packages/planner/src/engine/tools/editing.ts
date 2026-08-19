import type { ToolHandler } from './ToolHandler';
import { createEditingState, type EditingState } from './ToolState';

/**
 * Хаб `editing` (ADR 0019 E1/E4). В шаге 2 задачи 0057 — без хит-теста и драга (0059): указатель состояния не
 * меняет; Esc снимает выделение; Ctrl+Z/Ctrl+Y — `history.undo()/redo()` (единственное место, где клавиши доходят
 * до истории документа, ADR 0018 D8); `nudge` без выделения — `{ handled: false }` (вьювер панорамирует, E5).
 */
export const editingHandler: ToolHandler<EditingState> = {
  pointerCancel: state => ({ state }),

  cancel: state => ({ state: state.selection === null ? state : { ...state, selection: null } }),

  interrupt: state => (state.hover === null && state.selection === null ? state : createEditingState()),

  leaveConstructor: state => (state.hover === null ? state : { ...state, hover: null }),

  key: (state, action, ctx) => {
    const restore = (run: () => { ok: boolean }, what: string) => (): void => {
      // Пустой стек — не ошибка автомата: клавиша его, откатывать нечего (спека 09).
      if (!run().ok) ctx.logger.debug(`@uyutno/planner: nothing to ${what}`);
    };
    switch (action.kind) {
      case 'undo':
        return { state, handled: true, effect: restore(ctx.historyUndo, 'undo') };
      case 'redo':
        return { state, handled: true, effect: restore(ctx.historyRedo, 'redo') };
      case 'nudge':
        // Нудж выделения — задача 0059; без выделения стрелки — панорамирование вьювера.
        return { state, handled: false };
    }
  },
};

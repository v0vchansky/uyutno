import { err, type Result } from './Result';

/** Снимок истории для UI (`history.get()`) и payload `history:changed`; реализация — ADR D. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

export type HistoryError = { kind: 'nothing-to-undo' } | { kind: 'nothing-to-redo' };

/** Пустая история — стабильный замороженный снимок для селекторов (`history.get()` — ссылка не меняется). */
const EMPTY_HISTORY: HistoryState = Object.freeze({ canUndo: false, canRedo: false });

/**
 * Неймспейс `history` фасада (ADR 0015 A2) — контракт для UI и заглушка до ADR D (шаг 2): история пуста,
 * `undo`/`redo` честно отвечают «нечего откатывать», событие `history:changed` объявлено в шине, но здесь
 * не эмитится. Реализация поверх замороженных immer-снимков `floors[].layout` / `floors[].scene` — ADR D.
 */
export class HistoryNamespace {
  get(): HistoryState {
    return EMPTY_HISTORY;
  }

  undo(): Result<void, HistoryError> {
    return err({ kind: 'nothing-to-undo' });
  }

  redo(): Result<void, HistoryError> {
    return err({ kind: 'nothing-to-redo' });
  }
}

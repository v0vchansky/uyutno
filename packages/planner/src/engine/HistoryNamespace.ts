import type { HistoryError, HistoryState } from './history/HistoryLog';
import type { PlannerStore } from './PlannerStore';
import type { Result } from './Result';

export type { HistoryError, HistoryState, HistoryZone } from './history/HistoryLog';

/**
 * Неймспейс `history` фасада (ADR 0015 A2, ADR 0018 D3–D6): undo/redo по активной зоне (`layout` в
 * конструкторе, `scene` в остальных видах; последняя запись/undo/redo переключает зону до смены вида — D4).
 * Записи и restore живут в `PlannerStore` (снимки поддеревьев `floors[].layout` / `.scene` по ссылке);
 * событие `history:changed` — при смене флагов `get()`. Разрыв серии коалесинга при смене выделения (D5) —
 * внутренний `PlannerStore.breakSeries()`, зовёт `tools` (0057); в публичном контракте фасада его нет.
 */
export class HistoryNamespace {
  constructor(private readonly store: PlannerStore) {}

  /** `{ canUndo, canRedo }` активной зоны — стабильный замороженный снимок для селекторов. */
  get(): HistoryState {
    return this.store.getHistoryState();
  }

  undo(): Result<void, HistoryError> {
    return this.store.restore('undo');
  }

  redo(): Result<void, HistoryError> {
    return this.store.restore('redo');
  }
}

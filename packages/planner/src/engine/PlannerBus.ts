import mitt, { type Emitter } from 'mitt';

import type { DocumentView, PlannerDocument } from '../document/PlannerDocument';
import type { HistoryState } from './history/HistoryLog';

/**
 * Карта событий шины (ADR 0015 A5). Имя — `<неймспейс>:<факт в прошедшем времени>`, payload — plain-данные
 * (снимки документа/вида, без Three-объектов и UI-подсказок), одно событие на факт, без edge-triggered пар.
 * Шина наружу пакета не отдаётся: подписка только через `subscribe`/`on` фасада.
 */
export type PlannerEvents = {
  /** Изменилось содержимое документа: `floors`, `settings` (не `view`). */
  'document:changed': { document: PlannerDocument };
  /** Изменился активный вид или камера вида (`Document.view`, ADR 0016 B7). */
  'view:changed': DocumentView;
  /**
   * Сменился dirty-флаг проекта (ADR 0018 D7) — единственное событие с флагом; `document:changed`
   * подразумевает `dirty = true`, но не несёт его. Только при фактической смене значения.
   */
  'document:dirty-changed': { dirty: boolean };
  /**
   * Изменилась доступность undo/redo активной зоны — одно событие вместо трёх каналов (аудит roomtodo).
   * Может прийти без изменения документа: смена вида меняет активную зону (ADR 0018 D4).
   */
  'history:changed': HistoryState;
};

export type PlannerEventType = keyof PlannerEvents;

export type PlannerBus = Emitter<PlannerEvents>;

export const createPlannerBus = (): PlannerBus => mitt<PlannerEvents>();
